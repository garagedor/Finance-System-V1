import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { readSession, hasPermission } from "@/lib/rbac";
import type { EquipmentOrder } from "@/types/equipment";
import { fmt$, fmtDate } from "../../format";
import { PageHeader, CardShell, Empty, StatPill } from "../../_components/page-helpers";
import { EquipmentStatusPill } from "../_components/EquipmentStatusPill";

export const dynamic = "force-dynamic";

export default async function EquipmentOrdersPage() {
  const session = await readSession();
  if (!hasPermission(session, "finance:equipment_orders:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Equipment Orders" />
        <CardShell title="No access"><Empty message="You don't have permission to view equipment orders." /></CardShell>
      </div>
    );
  }
  const canCreate = hasPermission(session, "finance:equipment_orders:create");
  const canSeeCost = hasPermission(session, "finance:equipment_cost:view")
    || hasPermission(session, "finance:equipment_profitability:view");

  await ensureFinanceIndexes();
  const rows = await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder)
    .find({}).sort({ orderDate: -1, _id: -1 }).limit(500).toArray();

  const openApproved = rows.filter((r) => r.status === "Approved").length;
  const deliveredUnposted = rows.filter((r) => r.status === "Delivered").length;
  const chargedTotal = rows.filter((r) => r.status === "ChargedToLedger")
    .reduce((s, r) => s + (r.totals?.amChargeTotal ?? 0), 0);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Equipment"
        title="Equipment Orders"
        subtitle="Order equipment for Area Managers and charge the AM selling total to their ledger."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/portal/equipment/products" className="portal-btn">Product catalog</Link>
            {canCreate && <Link href="/portal/equipment/orders/new" className="portal-btn portal-btn-primary">+ Create Order</Link>}
          </div>
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Approved (awaiting charge)" value={openApproved} />
        <StatPill label="Delivered (not posted)" value={deliveredUnposted} />
        <StatPill label="Charged to ledgers" value={fmt$(chargedTotal)} />
        <StatPill label="Total orders" value={rows.length} />
      </section>

      <CardShell title="Orders" subtitle={`${rows.length} order${rows.length === 1 ? "" : "s"}`}>
        {rows.length === 0 ? (
          <Empty message="No equipment orders yet." action={canCreate ? (
            <Link href="/portal/equipment/orders/new" className="portal-btn portal-btn-primary">+ Create the first order</Link>
          ) : undefined} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Date</th>
                  <th>Area Manager</th>
                  <th className="right">Units</th>
                  <th className="right">AM charge</th>
                  {canSeeCost && <th className="right">Gross profit</th>}
                  {canSeeCost && <th className="right">Margin</th>}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o._id}>
                    <td className="mono small"><Link href={`/portal/equipment/orders/${o._id}`} style={{ color: "#818cf8", textDecoration: "none" }}>{o.orderNumber}</Link></td>
                    <td className="small mono">{fmtDate(o.orderDate)}</td>
                    <td>{o.areaManagerName}{o.area && <div className="muted small">{o.area}</div>}</td>
                    <td className="right small">{o.totals?.itemCount ?? 0}</td>
                    <td className="right money">{fmt$(o.totals?.amChargeTotal ?? 0)}</td>
                    {canSeeCost && <td className="right money muted">{fmt$(o.totals?.grossProfit ?? 0)}</td>}
                    {canSeeCost && <td className="right small">{(o.totals?.grossMarginPct ?? 0).toFixed(1)}%</td>}
                    <td><EquipmentStatusPill status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardShell>
    </div>
  );
}
