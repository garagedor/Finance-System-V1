import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { readSession, hasPermission } from "@/lib/rbac";
import type { EquipmentOrder } from "@/types/equipment";
import { fmt$, fmtDate, fmtDateTime } from "../../../format";
import { PageHeader, CardShell, Empty, BackLink } from "../../../_components/page-helpers";
import { EquipmentStatusPill } from "../../_components/EquipmentStatusPill";
import OrderActions from "../../_components/OrderActions";

export const dynamic = "force-dynamic";

export default async function EquipmentOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await readSession();
  if (!hasPermission(session, "finance:equipment_orders:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Order" />
        <CardShell title="No access"><Empty message="You don't have permission to view equipment orders." /></CardShell>
      </div>
    );
  }
  await ensureFinanceIndexes();
  const order = await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder).findOne({ _id: id });
  if (!order) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Order not found" subtitle={<BackLink href="/portal/equipment/orders" label="Back to orders" />} />
      </div>
    );
  }

  const canSeeCost = hasPermission(session, "finance:equipment_cost:view")
    || hasPermission(session, "finance:equipment_profitability:view");
  const perms = {
    approve: hasPermission(session, "finance:equipment_orders:approve"),
    deliver: hasPermission(session, "finance:equipment_orders:deliver"),
    postLedger: hasPermission(session, "finance:equipment_orders:post_ledger"),
  };
  const t = order.totals;

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Equipment"
        title={`Order ${order.orderNumber}`}
        subtitle={<BackLink href="/portal/equipment/orders" label="Back to orders" />}
        actions={<EquipmentStatusPill status={order.status} />}
      />

      {/* Summary */}
      <div className="portal-grid-4">
        <Field label="Area Manager" value={order.areaManagerName} />
        <Field label="Area" value={order.area || "—"} />
        <Field label="Order date" value={fmtDate(order.orderDate)} />
        <Field label="Created by" value={order.createdBy} />
        <Field label="Delivery method" value={order.deliveryMethod || "—"} />
        <Field label="Expected delivery" value={order.expectedDeliveryAt ? fmtDate(order.expectedDeliveryAt) : "—"} />
        <Field label="Units / lines" value={`${t.itemCount} / ${t.lineCount}`} />
        <Field label="AM charge total" value={fmt$(t.amChargeTotal)} strong />
      </div>

      {order.notes && <CardShell title="Notes"><div style={{ padding: 16 }} className="muted">{order.notes}</div></CardShell>}

      {/* Line items */}
      <CardShell title="Line items" subtitle="Prices are snapshots frozen at order time.">
        <div style={{ overflowX: "auto" }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>Product</th><th>SKU</th><th>Unit</th>
                {canSeeCost && <th className="right">Unit cost</th>}
                <th className="right">Unit price</th>
                <th className="right">Qty</th>
                {canSeeCost && <th className="right">Line cost</th>}
                <th className="right">Line charge</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it, i) => (
                <tr key={`${it.productId}-${i}`}>
                  <td>{it.productNameSnapshot}</td>
                  <td className="small mono">{it.skuSnapshot}</td>
                  <td className="small">{it.sellingUnitSnapshot}</td>
                  {canSeeCost && <td className="right money muted">{fmt$(it.companyCostSnapshot)}</td>}
                  <td className="right money">{fmt$(it.amPriceSnapshot)}</td>
                  <td className="right">{it.qty}</td>
                  {canSeeCost && <td className="right money muted">{fmt$(it.costLineTotal)}</td>}
                  <td className="right money">{fmt$(it.chargeLineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={canSeeCost ? 6 : 4} className="right"><strong>Totals</strong></td>
                {canSeeCost && <td className="right money muted"><strong>{fmt$(t.companyCostTotal)}</strong></td>}
                <td className="right money"><strong>{fmt$(t.amChargeTotal)}</strong></td>
              </tr>
              {canSeeCost && (
                <tr>
                  <td colSpan={7} className="right muted small">Gross profit {fmt$(t.grossProfit)} · Margin {t.grossMarginPct.toFixed(1)}%</td>
                  <td></td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </CardShell>

      {/* Ledger status / actions */}
      {order.status === "ChargedToLedger" ? (
        <CardShell title="Ledger">
          <div style={{ padding: 16, display: "grid", gap: 6 }}>
            <div className="pill pill-paid" style={{ width: "fit-content" }}>Charged to ledger</div>
            <div className="small">Debit of <strong>{fmt$(t.amChargeTotal)}</strong> posted to <strong>{order.areaManagerName}</strong>&apos;s ledger.</div>
            <div className="muted small mono">Entry: {order.ledgerEntryId} · {order.ledgerPostedAt ? fmtDateTime(order.ledgerPostedAt) : ""} by {order.ledgerPostedBy}</div>
            {order.ledgerId && <Link href={`/portal/ledger/${order.ledgerId}`} className="portal-btn" style={{ width: "fit-content" }}>View ledger →</Link>}
          </div>
        </CardShell>
      ) : (
        <OrderActions
          orderId={order._id}
          orderNumber={order.orderNumber}
          status={order.status}
          areaManagerName={order.areaManagerName}
          amChargeTotal={t.amChargeTotal}
          itemCount={t.itemCount}
          lineCount={t.lineCount}
          perms={perms}
        />
      )}
    </div>
  );
}

function Field({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="portal-kpi" style={{ padding: "12px 14px" }}>
      <div className="portal-kpi-label">{label}</div>
      <div className="portal-kpi-value" style={{ fontSize: strong ? 18 : 15 }}>{value}</div>
    </div>
  );
}
