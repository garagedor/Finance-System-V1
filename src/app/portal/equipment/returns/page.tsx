import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { readSession, hasPermission } from "@/lib/rbac";
import type { EquipmentReturn } from "@/types/equipment";
import { fmt$, fmtDate } from "../../format";
import { PageHeader, CardShell, Empty } from "../../_components/page-helpers";
import { ReturnStatusPill } from "../_components/EquipmentStatusPill";
import EquipmentTabs from "../_components/EquipmentTabs";

export const dynamic = "force-dynamic";

export default async function EquipmentReturnsPage() {
  const session = await readSession();
  if (!hasPermission(session, "finance:equipment_orders:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Equipment Returns" />
        <CardShell title="No access"><Empty message="You don't have permission to view equipment returns." /></CardShell>
      </div>
    );
  }
  await ensureFinanceIndexes();
  const rows = await coll<EquipmentReturn>(FINANCE_COLLECTIONS.equipmentReturn)
    .find({}).sort({ created_at: -1 }).limit(500).toArray();

  return (
    <div className="portal-page">
      <PageHeader kicker="Equipment" title="Equipment Returns" subtitle="Returns and credits against equipment orders." />
      <EquipmentTabs active="returns" />
      <CardShell title="Returns" subtitle={`${rows.length} return${rows.length === 1 ? "" : "s"}`}>
        {rows.length === 0 ? (
          <Empty message="No returns yet. Start one from an order's page." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="portal-table">
              <thead>
                <tr><th>Return #</th><th>Order</th><th>Area Manager</th><th className="right">Units</th><th className="right">Credit</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td className="mono small"><Link href={`/portal/equipment/returns/${r._id}`} style={{ color: "#818cf8", textDecoration: "none" }}>{r.returnNumber}</Link></td>
                    <td className="mono small"><Link href={`/portal/equipment/orders/${r.orderId}`} style={{ color: "#818cf8", textDecoration: "none" }}>{r.orderNumber}</Link></td>
                    <td>{r.areaManagerName}</td>
                    <td className="right small">{r.items.reduce((s, it) => s + it.qtyReturned, 0)}</td>
                    <td className="right money">{fmt$(r.creditAmount)}</td>
                    <td><ReturnStatusPill status={r.status} /></td>
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
