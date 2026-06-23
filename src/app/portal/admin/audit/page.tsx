import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession, hasPermission } from "@/lib/rbac";
import { ensureRbacReady } from "@/lib/rbac-seed";
import { coll, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import type { AuditRecord } from "@/types/rbac";
import { PageHeader, CardShell, FilterBar, FilterField, StatPill } from "../../_components/page-helpers";
import AdminTabs from "../AdminTabs";

export const dynamic = "force-dynamic";

interface SP {
  kind?: string;
  by?: string;
  q?: string;
}

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "role", label: "Role" },
  { value: "user", label: "User" },
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "payout", label: "Payout" },
  { value: "refund", label: "Refund" },
  { value: "debt", label: "Debt" },
  { value: "dispute", label: "Dispute" },
  { value: "settlement", label: "Settlement" },
  { value: "recurring_expense", label: "Recurring expense" },
  { value: "bank_txn", label: "Bank transaction" },
  { value: "recon_match", label: "Reconciliation" },
  { value: "report", label: "Report" },
  { value: "auth", label: "Auth event" },
];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await readSession();
  if (!session) redirect("/?next=/portal/admin/audit");
  if (!hasPermission(session, "system:roles:view") && !hasPermission(session, "system:users:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Admin" title="Audit log" />
        <div className="portal-alert portal-alert-error">No access to the audit log.</div>
      </div>
    );
  }
  await ensureRbacReady();
  const sp = await searchParams;

  const filter: Record<string, unknown> = {};
  if (sp.kind) filter.target_kind = sp.kind;
  if (sp.by) filter.changed_by = sp.by;
  if (sp.q) filter.summary = { $regex: sp.q, $options: "i" };

  const auditColl = coll<AuditRecord>(FINANCE_COLLECTIONS.auditLog);
  const [rows, total, perKindAgg] = await Promise.all([
    auditColl.find(filter).sort({ changed_at: -1 }).limit(500).toArray(),
    auditColl.countDocuments(filter),
    auditColl.aggregate([
      { $group: { _id: "$target_kind", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
  ]);

  const totalAll = perKindAgg.reduce((s, r) => s + (r.count as number), 0);
  const topKind = perKindAgg[0]?._id as string | undefined;
  const uniqueActors = new Set(rows.map((r) => r.changed_by)).size;

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Admin"
        title="Audit log"
        subtitle="Append-only record of every role, user, and money mutation. Last 500 matching entries."
      />
      <AdminTabs />

      <section className="portal-grid-3">
        <StatPill label="Total entries" value={totalAll.toLocaleString()} />
        <StatPill label="Matching" value={total.toLocaleString()} />
        <StatPill label="Distinct actors shown" value={uniqueActors.toLocaleString()} />
      </section>

      <FilterBar>
        <FilterField label="Kind">
          <select name="kind" defaultValue={sp.kind ?? ""} className="portal-select">
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="By user">
          <input type="text" name="by" defaultValue={sp.by ?? ""} className="portal-input" placeholder="username" />
        </FilterField>
        <FilterField label="Summary contains">
          <input type="text" name="q" defaultValue={sp.q ?? ""} className="portal-input" />
        </FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/admin/audit" className="portal-btn">Clear</Link>
      </FilterBar>

      <CardShell
        title="Changes"
        subtitle={topKind ? `${rows.length} shown · most active kind: ${topKind}` : `${rows.length} shown`}
      >
        <table className="portal-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Summary</th>
              <th>By</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id}>
                <td className="small mono">{r.changed_at.slice(0, 19).replace("T", " ")}</td>
                <td>
                  <span className={`pill ${pillFor(r.target_kind)}`}>{r.target_kind}</span>
                </td>
                <td className="small">{r.summary}</td>
                <td className="small mono">{r.changed_by}</td>
                <td className="small mono muted">{r.target_id.slice(-10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardShell>
    </div>
  );
}

function pillFor(kind: string): string {
  if (kind === "role" || kind === "user") return "pill-open";
  if (kind === "auth") return "pill-unpaid";
  if (["expense", "refund", "debt"].includes(kind)) return "pill-pending";
  if (["income", "payout", "settlement", "report"].includes(kind)) return "pill-paid";
  return "pill-draft";
}
