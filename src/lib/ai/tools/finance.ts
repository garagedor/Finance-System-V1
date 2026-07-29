import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { fetchDashboardData } from "@/lib/portal-data";
import type { BankAccountSyncedRecord, ConnectedInstitutionRecord } from "@/types/finance-plaid";
import type { ToolDef } from "../types";

// Read-only finance tools. Each wraps EXISTING business logic (no reimplemented
// math), returns raw data for the model to reason over, and reports where the
// data came from + how fresh it is. NONE of these mutate anything.

type Row = Record<string, unknown>;

function defaultWindow(args: Record<string, unknown>): { from: string; to: string } {
  const to = typeof args.to === "string" ? args.to : new Date().toISOString().slice(0, 10);
  let from: string;
  if (typeof args.from === "string") {
    from = args.from;
  } else {
    const d = new Date(to + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 30);
    from = d.toISOString().slice(0, 10);
  }
  return { from, to };
}

async function bankFreshness(): Promise<{ source: string; lastSync: string }[]> {
  await ensureFinanceIndexes();
  const insts = await coll<ConnectedInstitutionRecord>(FINANCE_COLLECTIONS.plaidInstitution)
    .find({})
    .toArray();
  return insts.map((i) => ({
    source: `Bank: ${i.institution_name ?? i.item_id}`,
    lastSync: i.last_sync_at ?? i.last_balance_refresh_at ?? "never",
  }));
}

export const FINANCE_TOOLS: ToolDef[] = [
  {
    name: "get_financial_overview",
    description:
      "The company's financial overview for a date range: revenue, profit, expenses, income, bank balances & cash flow, pending payouts, open disputes/refunds, top areas, and per-day breakdowns. Use this first for most finance and cash questions. Defaults to the last 30 days if no dates are given.",
    permission: "finance:dashboard:view",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date YYYY-MM-DD (optional)" },
        to: { type: "string", description: "End date YYYY-MM-DD (optional)" },
      },
    },
    run: async (args) => {
      const range = defaultWindow(args);
      const d = await fetchDashboardData(range);
      return {
        data: { ...d, range },
        summary: `Financial overview ${range.from}..${range.to}`,
        freshness: await bankFreshness(),
      };
    },
  },
  {
    name: "get_bank_balances",
    description:
      "Current balances for every connected bank account (from Plaid): current and available balance per account, plus the total. Credit-card balances count as negative cash. Reports when each bank last synced.",
    permission: "finance:banking:view",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      await ensureFinanceIndexes();
      const accts = await coll<BankAccountSyncedRecord>(FINANCE_COLLECTIONS.bankAccountSynced)
        .find({ active: true })
        .toArray();
      const rows = accts.map((a) => {
        const isCredit =
          (a.type ?? "").toLowerCase() === "credit" ||
          (a.subtype ?? "").toString().toLowerCase() === "credit_card";
        const cashContribution = isCredit ? -(a.current_balance ?? 0) : a.current_balance ?? 0;
        return {
          account: a.name + (a.mask ? ` ··${a.mask}` : ""),
          institution: a.institution_name ?? null,
          type: a.subtype ?? a.type ?? null,
          current_balance: a.current_balance ?? null,
          available_balance: a.available_balance ?? null,
          is_credit: isCredit,
          cash_contribution: cashContribution,
          last_balance_at: a.last_balance_at ?? null,
        };
      });
      const total = rows.reduce((s, r) => s + (r.cash_contribution ?? 0), 0);
      return {
        data: { accounts: rows, total_cash: total },
        summary: `${rows.length} bank accounts, total cash ${total.toFixed(2)}`,
        freshness: await bankFreshness(),
      };
    },
  },
  {
    name: "get_upcoming_payouts",
    description:
      "Payouts that are recorded but not yet paid (money committed to leave). Useful for cash-flow and 'how much can I spend' questions.",
    permission: "finance:payouts:view",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      await ensureFinanceIndexes();
      const rows = await coll<Row>(FINANCE_COLLECTIONS.payout)
        .find({ status: "unpaid" })
        .sort({ period_end: -1 })
        .limit(200)
        .toArray();
      const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      return {
        data: { pending_payouts: rows, count: rows.length, total },
        summary: `${rows.length} unpaid payouts totaling ${total.toFixed(2)}`,
      };
    },
  },
  {
    name: "get_recurring_expenses",
    description:
      "Recurring / fixed expenses configured in the system (subscriptions, rent, storage, software). Useful for committed monthly outflow, waste detection, and cash forecasting.",
    permission: "finance:recurring_expenses:view",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      await ensureFinanceIndexes();
      const rows = await coll<Row>(FINANCE_COLLECTIONS.recurringExpense).find({}).limit(500).toArray();
      const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      return {
        data: { recurring_expenses: rows, count: rows.length, approx_total_per_cycle: total },
        summary: `${rows.length} recurring expenses`,
      };
    },
  },
  {
    name: "get_ledger_balances",
    description:
      "Running balance for every area-manager / technician ledger (balance = sum of all ledger entries). Negative = the company owes them; positive = they owe the company.",
    permission: "finance:area_managers:view",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      await ensureFinanceIndexes();
      const [balances, ledgers] = await Promise.all([
        coll<Row>(FINANCE_COLLECTIONS.ledgerEntry)
          .aggregate([{ $group: { _id: "$ledger_id", balance: { $sum: "$amount" }, entries: { $sum: 1 } } }])
          .toArray(),
        coll<Row>(FINANCE_COLLECTIONS.ledger).find({}).toArray(),
      ]);
      const byId = new Map(ledgers.map((l) => [String(l._id), l]));
      const rows = balances.map((b) => {
        const l = byId.get(String(b._id));
        return {
          ledger: (l?.name as string) ?? (l?.person as string) ?? String(b._id),
          role: (l?.role as string) ?? null,
          location: (l?.location as string) ?? null,
          balance: Number(b.balance) || 0,
          entries: Number(b.entries) || 0,
        };
      });
      const weOwe = rows.filter((r) => r.balance < 0).reduce((s, r) => s + r.balance, 0);
      const theyOwe = rows.filter((r) => r.balance > 0).reduce((s, r) => s + r.balance, 0);
      return {
        data: { ledgers: rows, company_owes_total: weOwe, owed_to_company_total: theyOwe },
        summary: `${rows.length} ledgers; company owes ${Math.abs(weOwe).toFixed(2)}, owed ${theyOwe.toFixed(2)}`,
      };
    },
  },
];
