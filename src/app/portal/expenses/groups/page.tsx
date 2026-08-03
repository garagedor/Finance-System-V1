import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { ExpenseGroupRecord } from "@/types/finance";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";
import { fmt$, fmtDate } from "../../format";
import { PageHeader, StatPill, CardShell, Empty, BackLink } from "../../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../../_components/EntryFormModal";
import RowActions from "../../_components/RowActions";

export const dynamic = "force-dynamic";

const GROUP_FIELDS: FieldDef[] = [
  { name: "name", label: "Name", kind: "text", required: true,
    placeholder: "e.g. Chicago trip — Aug 2026, Emergency HVAC, Trade show" },
  { name: "note", label: "Note (optional)", kind: "textarea", placeholder: "What is this for?" },
];

interface GroupStat { count: number; spent: number; net: number }

async function load() {
  await ensureFinanceIndexes();
  const gColl = coll<ExpenseGroupRecord>(FINANCE_COLLECTIONS.expenseGroup);
  const tColl = coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced);
  const groups = await gColl.find({}).sort({ created_at: -1 }).toArray();

  const stats = new Map<string, GroupStat>();
  if (groups.length) {
    const agg = await tColl.aggregate<{ _id: string; count: number; net: number; out: number }>([
      { $match: { group_id: { $in: groups.map((g) => g._id) } } },
      { $group: {
          _id: "$group_id",
          count: { $sum: 1 },
          net: { $sum: "$amount" },
          out: { $sum: { $cond: [{ $lt: ["$amount", 0] }, "$amount", 0] } },
        } },
    ]).toArray();
    for (const a of agg) stats.set(a._id, { count: a.count, spent: -a.out, net: a.net });
  }

  const totalSpent = [...stats.values()].reduce((s, v) => s + v.spent, 0);
  const openCount = groups.filter((g) => g.status !== "closed").length;
  return { groups, stats, totalSpent, openCount };
}

export default async function ExpenseGroupsPage() {
  const d = await load();

  return (
    <div className="portal-page">
      <BackLink href="/portal/expenses" label="All expenses" />
      <PageHeader
        kicker="Money · Expenses"
        title="Unexpected expenses"
        subtitle="Group bank transactions into a trip, project, or one-off situation to see what it cost and how it breaks down by category."
        actions={
          <EntryFormModal
            endpoint="/api/portal/expense-groups"
            title="Group"
            fields={GROUP_FIELDS}
            triggerLabel="+ New group"
            primary
          />
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Groups" value={d.groups.length.toLocaleString()} />
        <StatPill label="Open" value={d.openCount.toLocaleString()} />
        <StatPill label="Total spent (grouped)" value={<span className="money-neg">{fmt$(d.totalSpent)}</span>} />
      </section>

      <CardShell title="Groups" subtitle="Each row totals the bank transactions tagged to it">
        {d.groups.length === 0 ? (
          <Empty
            message="No groups yet. Create one for your trip, project, or any situation you want to track."
            action={
              <EntryFormModal
                endpoint="/api/portal/expense-groups"
                title="Group"
                fields={GROUP_FIELDS}
                triggerLabel="+ Create your first group"
              />
            }
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th className="right">Txns</th>
                <th className="right">Spent</th>
                <th className="right">Net</th>
                <th>Created</th>
                <th className="right"></th>
              </tr>
            </thead>
            <tbody>
              {d.groups.map((g) => {
                const s = d.stats.get(g._id) ?? { count: 0, spent: 0, net: 0 };
                return (
                  <tr key={g._id}>
                    <td>
                      <Link href={`/portal/expenses/groups/${g._id}`} style={{ color: "#818cf8", fontWeight: 600, textDecoration: "none" }}>
                        {g.name}
                      </Link>
                      {g.note && <div className="muted small">{g.note}</div>}
                    </td>
                    <td>
                      <span className={`pill ${g.status === "closed" ? "pill-draft" : "pill-open"}`}>{g.status}</span>
                    </td>
                    <td className="right small">{s.count}</td>
                    <td className="right money money-neg">{fmt$(s.spent)}</td>
                    <td className="right money">{fmt$(s.net, { showSign: true })}</td>
                    <td className="small mono muted">{fmtDate(g.created_at)}</td>
                    <td className="right">
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <Link href={`/portal/expenses/groups/${g._id}`} className="portal-btn" style={{ padding: "4px 10px", fontSize: 12 }}>
                          Open
                        </Link>
                        <RowActions endpoint="/api/portal/expense-groups" id={g._id} canToggleStatus={false} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardShell>
    </div>
  );
}
