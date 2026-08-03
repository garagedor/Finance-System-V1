import { notFound } from "next/navigation";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { ExpenseGroupRecord } from "@/types/finance";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";
import { fmt$, fmtDate } from "../../../format";
import { PageHeader, StatPill, CardShell, Empty, BackLink } from "../../../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../../../_components/EntryFormModal";
import AddTxnsModal from "./AddTxnsModal";
import GroupTxnControls from "./GroupTxnControls";
import { CategoryChip } from "../category-color";

export const dynamic = "force-dynamic";

// General category suggestions — works for trips, projects, emergencies, etc.
export const CATEGORY_SUGGESTIONS = [
  "Travel", "Lodging", "Meals", "Fuel", "Supplies", "Equipment",
  "Parts", "Software", "Marketing", "Shipping", "Fees", "Repairs", "Other",
];

const EDIT_FIELDS: FieldDef[] = [
  { name: "name", label: "Name", kind: "text", required: true },
  { name: "note", label: "Note", kind: "textarea" },
  { name: "status", label: "Status", kind: "select", required: true,
    options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }] },
];

async function load(id: string) {
  await ensureFinanceIndexes();
  const group = await coll<ExpenseGroupRecord>(FINANCE_COLLECTIONS.expenseGroup).findOne({ _id: id });
  if (!group) return null;
  const txns = await coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced)
    .find({ group_id: id }).sort({ date: -1, _id: -1 }).toArray();

  let spent = 0, net = 0;
  const byCat = new Map<string, { spent: number; count: number }>();
  for (const t of txns) {
    net += t.amount;
    if (t.amount < 0) spent += -t.amount;
    const cat = t.group_category || "other";
    const cur = byCat.get(cat) ?? { spent: 0, count: 0 };
    cur.count++;
    if (t.amount < 0) cur.spent += -t.amount;
    byCat.set(cat, cur);
  }
  const breakdown = [...byCat.entries()].map(([cat, v]) => ({ cat, ...v })).sort((a, b) => b.spent - a.spent);
  return { group, txns, spent, net, breakdown };
}

export default async function ExpenseGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await load(id);
  if (!d) notFound();

  return (
    <div className="portal-page">
      <BackLink href="/portal/expenses/groups" label="All groups" />
      <PageHeader
        kicker="Money · Unexpected expenses"
        title={d.group.name}
        subtitle={d.group.note ?? undefined}
        actions={
          <>
            <AddTxnsModal groupId={d.group._id} suggestions={CATEGORY_SUGGESTIONS} />
            <EntryFormModal
              endpoint="/api/portal/expense-groups"
              title="Group"
              fields={EDIT_FIELDS}
              initial={d.group as unknown as Record<string, unknown> & { _id?: string }}
              triggerLabel="Edit"
            />
          </>
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Total spent" value={<span className="money-neg">{fmt$(d.spent)}</span>} />
        <StatPill label="Net" value={fmt$(d.net, { showSign: true })} />
        <StatPill label="Transactions" value={d.txns.length.toLocaleString()} />
        <StatPill label="Categories" value={d.breakdown.length.toLocaleString()} />
      </section>

      {d.breakdown.length > 0 && (
        <CardShell title="Breakdown by category">
          <table className="portal-table">
            <thead>
              <tr><th>Category</th><th className="right">Txns</th><th className="right">Spent</th><th className="right">% of spend</th></tr>
            </thead>
            <tbody>
              {d.breakdown.map((b) => (
                <tr key={b.cat}>
                  <td><CategoryChip category={b.cat} /></td>
                  <td className="right small">{b.count}</td>
                  <td className="right money money-neg">{fmt$(b.spent)}</td>
                  <td className="right muted small">{d.spent > 0 ? `${((b.spent / d.spent) * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardShell>
      )}

      <CardShell
        title="Transactions"
        subtitle={`${d.txns.length} tagged to this group`}
        actions={<AddTxnsModal groupId={d.group._id} suggestions={CATEGORY_SUGGESTIONS} label="+ Add transactions" />}
      >
        {d.txns.length === 0 ? (
          <Empty
            message="No transactions yet. Add bank transactions to this group."
            action={<AddTxnsModal groupId={d.group._id} suggestions={CATEGORY_SUGGESTIONS} label="+ Add transactions" />}
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Date</th><th>Description</th><th>Category</th>
                <th className="right">Amount</th><th className="right"></th>
              </tr>
            </thead>
            <tbody>
              {d.txns.map((t) => (
                <tr key={t._id}>
                  <td className="small mono">{fmtDate(t.date)}</td>
                  <td>
                    {t.description}
                    {t.merchant_name && t.merchant_name !== t.description && (
                      <div className="muted small">{t.merchant_name}</div>
                    )}
                  </td>
                  <td>
                    <GroupTxnControls txnId={t._id} category={t.group_category ?? "other"} suggestions={CATEGORY_SUGGESTIONS} />
                  </td>
                  <td className={`right money ${t.amount < 0 ? "money-neg" : "money-pos"}`}>
                    {t.amount < 0 ? "−" : "+"}{fmt$(Math.abs(t.amount))}
                  </td>
                  <td className="right">
                    <GroupTxnControls txnId={t._id} remove />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>
    </div>
  );
}
