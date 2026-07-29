import "server-only";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";
import { cfgNum, type DetectorDefinition, type RawFinding } from "./framework";

// FINANCE detectors. Each is an isolated definition — add a new one to the
// array (or a new category file) and it lights up with zero engine changes.
// This file is the reference pattern for the other business areas.

function money(n: number): string {
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export const FINANCE_DETECTORS: DetectorDefinition[] = [
  {
    id: "finance.negative_cash",
    title: "Negative net cash",
    description: "Net cash across connected accounts is negative (card balances exceed available cash).",
    category: "finance",
    executives: ["cfo"],
    defaultSeverity: "high",
    enabledByDefault: true,
    detect: (ctx) => {
      const net = ctx.dashboard30.bankBalanceTotal ?? 0;
      if (net >= 0) return [];
      return [
        {
          key: "negative_cash",
          title: "Net cash position is negative",
          detail: `Across connected accounts, net cash is ${money(net)} — credit-card balances exceed available cash.`,
          metric: money(net),
          financialImpact: Math.abs(net),
          confidence: 0.95,
          urgency: 0.95,
          businessRisk: 0.9,
          estimatedMinutes: 60,
          whyItMatters: "Negative net cash means the business is technically underwater on liquid funds.",
          recommendedAction: "Accelerate collections and pay down the highest-interest balance first.",
          estimatedEffort: "~1 hour to plan",
        } as RawFinding,
      ];
    },
  },
  {
    id: "finance.cashflow_decline",
    title: "Cash flow declining",
    description: "Net bank flow over the last 30 days is negative and worse than the prior 30 days.",
    category: "finance",
    executives: ["cfo"],
    defaultSeverity: "medium",
    enabledByDefault: true,
    detect: (ctx) => {
      const net = ctx.dashboard30.bankNet ?? 0;
      const prev = ctx.dashboardPrev30.bankNet ?? 0;
      if (!(net < 0 && net < prev)) return [];
      return [
        {
          key: "cashflow_decline",
          title: "Cash flow turned more negative",
          detail: `Net bank flow over the last 30 days is ${money(net)}, down from ${money(prev)} the prior 30 days.`,
          metric: money(net),
          financialImpact: Math.abs(net - prev),
          confidence: 0.8,
          urgency: 0.6,
          recommendedAction: "Review the largest new outflows and defer non-essential spend.",
          estimatedEffort: "~30 minutes",
        },
      ];
    },
  },
  {
    id: "finance.expense_spike",
    title: "Expense spike",
    description: "Money out over the last 30 days is materially higher than the prior 30 days.",
    category: "finance",
    executives: ["cfo", "analyst"],
    defaultSeverity: "medium",
    enabledByDefault: true,
    configFields: [
      { key: "pctThreshold", label: "Increase % to flag", type: "number", default: 25 },
      { key: "minDelta", label: "Minimum $ increase", type: "number", default: 2000 },
    ],
    detect: (ctx) => {
      const out = Math.abs(ctx.dashboard30.bankOutflow ?? 0);
      const prev = Math.abs(ctx.dashboardPrev30.bankOutflow ?? 0);
      const pctT = cfgNum(ctx, "pctThreshold", 25) / 100;
      const minDelta = cfgNum(ctx, "minDelta", 2000);
      if (!(prev > 0 && out > prev * (1 + pctT) && out - prev > minDelta)) return [];
      const pct = Math.round(((out - prev) / prev) * 100);
      return [
        {
          key: "expense_spike",
          title: `Spending up ${pct}% vs the prior 30 days`,
          detail: `Money out over the last 30 days is ${money(out)} vs ${money(prev)} before — a ${money(out - prev)} increase.`,
          metric: `+${pct}%`,
          financialImpact: out - prev,
          confidence: 0.75,
          recommendedAction: "Have the Auditor break the increase down by merchant and category.",
          estimatedEffort: "~20 minutes",
        },
      ];
    },
  },
  {
    id: "finance.duplicate_payments",
    title: "Duplicate payments",
    description: "Two outgoing payments of the same amount to the same payee within a short window.",
    category: "finance",
    executives: ["auditor"],
    defaultSeverity: "medium",
    enabledByDefault: true,
    configFields: [
      { key: "windowDays", label: "Days between payments", type: "number", default: 10 },
      { key: "minAmount", label: "Minimum $ to flag", type: "number", default: 100 },
    ],
    detect: (ctx) => {
      const windowDays = cfgNum(ctx, "windowDays", 10);
      const minAmount = cfgNum(ctx, "minAmount", 100);
      const outflows = ctx.bankTxns.filter((t) => t.amount < 0 && Math.abs(t.amount) >= minAmount);
      const groups = new Map<string, BankTransactionSyncedRecord[]>();
      for (const t of outflows) {
        const label = (t.merchant_name || t.description || "").trim().toLowerCase();
        if (!label) continue;
        const k = `${Math.round(Math.abs(t.amount) * 100)}|${label}`;
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
      }
      const findings: RawFinding[] = [];
      for (const arr of groups.values()) {
        if (arr.length < 2) continue;
        arr.sort((a, b) => a.date.localeCompare(b.date));
        for (let i = 1; i < arr.length; i++) {
          const gap = (Date.parse(arr[i].date) - Date.parse(arr[i - 1].date)) / 86_400_000;
          if (gap <= windowDays) {
            const amt = Math.abs(arr[i].amount);
            const who = arr[i].merchant_name || arr[i].description || "unknown";
            findings.push({
              key: `dup_${Math.round(amt * 100)}_${who.slice(0, 24)}`,
              severity: amt > 1000 ? "high" : "medium",
              title: "Possible duplicate payment",
              detail: `Two payments of ${money(-amt)} to "${who}" on ${arr[i - 1].date} and ${arr[i].date}.`,
              metric: money(-amt),
              financialImpact: amt,
              confidence: 0.75,
              probability: 0.7,
              estimatedMinutes: 8,
              whyItMatters: "A double payment is cash out the door that can usually be reclaimed.",
              rootCause: "Same amount paid to the same payee twice within the window — may be a genuine repeat charge.",
              recommendedAction: "Review the transaction pair; if it's a duplicate, request a refund/credit.",
              estimatedEffort: "~8 minutes",
              evidence: { merchant: who, dates: [arr[i - 1].date, arr[i].date], amount: amt },
            });
            break;
          }
        }
      }
      return findings;
    },
  },
  {
    id: "finance.unusual_outflow",
    title: "Unusually large payment",
    description: "A recent payment far above the typical transaction size.",
    category: "finance",
    executives: ["auditor", "cfo"],
    defaultSeverity: "medium",
    enabledByDefault: true,
    configFields: [
      { key: "multiplier", label: "× above median to flag", type: "number", default: 3 },
      { key: "minAmount", label: "Minimum $ to flag", type: "number", default: 3000 },
    ],
    detect: (ctx) => {
      const multiplier = cfgNum(ctx, "multiplier", 3);
      const minAmount = cfgNum(ctx, "minAmount", 3000);
      const outflows = ctx.bankTxns.filter((t) => t.amount < 0);
      const mags = outflows.map((t) => Math.abs(t.amount)).sort((a, b) => a - b);
      const median = mags.length ? mags[Math.floor(mags.length / 2)] : 0;
      const recent = outflows
        .filter((t) => t.date >= ctx.windows.last7.from)
        .sort((a, b) => a.amount - b.amount)
        .slice(0, 3);
      const findings: RawFinding[] = [];
      for (const t of recent) {
        const amt = Math.abs(t.amount);
        if (median > 0 && amt > median * multiplier && amt > minAmount) {
          const who = t.merchant_name || t.description || "unknown";
          findings.push({
            key: `unusual_${t._id}`,
            title: "Unusually large payment",
            detail: `A ${money(-amt)} payment to "${who}" on ${t.date} is well above your typical transaction (${money(median)} median).`,
            metric: money(-amt),
            financialImpact: amt,
            confidence: 0.55,
            estimatedMinutes: 10,
            recommendedAction: "Confirm this payment was expected and correctly categorized.",
            estimatedEffort: "~10 minutes",
          });
        }
      }
      return findings;
    },
  },
  {
    id: "finance.unmatched_txns",
    title: "Unreconciled bank transactions",
    description: "Bank transactions not matched to CRM activity.",
    category: "finance",
    executives: ["controller"],
    defaultSeverity: "low",
    enabledByDefault: true,
    detect: (ctx) => {
      const n = ctx.dashboard30.bankUnmatched ?? 0;
      if (n <= 0) return [];
      return [
        {
          key: "unmatched_txns",
          severity: n > 20 ? "medium" : "low",
          title: `${n} bank transactions not reconciled`,
          detail: `${n} transactions in the last 30 days aren't matched to CRM activity.`,
          metric: String(n),
          businessRisk: 0.4,
          confidence: 0.9,
          estimatedMinutes: Math.min(120, n * 2),
          recommendedAction: "Reconcile them so the books tie out.",
          estimatedEffort: `~${Math.min(120, n * 2)} minutes`,
        },
      ];
    },
  },
  {
    id: "finance.open_disputes",
    title: "Open disputes",
    description: "Disputes that are still open and unresolved.",
    category: "finance",
    executives: ["auditor"],
    defaultSeverity: "low",
    enabledByDefault: true,
    detect: (ctx) => {
      const count = ctx.dashboard30.openDisputes ?? 0;
      if (count <= 0) return [];
      const amt = ctx.dashboard30.openDisputesAmount ?? 0;
      return [
        {
          key: "open_disputes",
          severity: amt > 5000 ? "medium" : "low",
          title: `${count} open disputes`,
          detail: `${count} disputes are open, totaling ${money(amt)}.`,
          metric: money(amt),
          financialImpact: amt,
          confidence: 0.9,
          recommendedAction: "Work the highest-dollar disputes first.",
          estimatedEffort: "varies",
        },
      ];
    },
  },
  {
    id: "finance.ledger_outliers",
    title: "Large outstanding ledger balances",
    description: "Area-manager / technician ledgers with a large running balance.",
    category: "area_managers",
    executives: ["controller", "operations"],
    defaultSeverity: "low",
    enabledByDefault: true,
    configFields: [{ key: "threshold", label: "$ balance to flag", type: "number", default: 5000 }],
    detect: (ctx) => {
      const threshold = cfgNum(ctx, "threshold", 5000);
      return ctx.ledgerBalances
        .filter((l) => Math.abs(l.balance) > threshold)
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
        .slice(0, 5)
        .map((l) => ({
          key: `ledger_${l.ledgerId}`,
          title: `Large outstanding balance: ${l.name}`,
          detail: `${l.name} has a running balance of ${money(l.balance)} — ${l.balance < 0 ? "the company owes them" : "they owe the company"}.`,
          metric: money(l.balance),
          financialImpact: Math.abs(l.balance),
          confidence: 0.85,
          recommendedAction: "Review and settle if overdue.",
          estimatedEffort: "~15 minutes",
        }));
    },
  },
];
