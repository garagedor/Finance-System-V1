import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { readSession, hasPermission } from "@/lib/rbac";
import type { EquipmentOrder, EquipmentReturn } from "@/types/equipment";
import { fmt$, fmtDate, fmtDateTime } from "../../../format";
import { PageHeader, CardShell, Empty, BackLink } from "../../../_components/page-helpers";
import { ReturnStatusPill } from "../../_components/EquipmentStatusPill";
import ReturnActions from "../../_components/ReturnActions";

export const dynamic = "force-dynamic";

export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await readSession();
  if (!hasPermission(session, "finance:equipment_orders:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Return" />
        <CardShell title="No access"><Empty message="You don't have permission to view equipment returns." /></CardShell>
      </div>
    );
  }
  await ensureFinanceIndexes();
  const ret = await coll<EquipmentReturn>(FINANCE_COLLECTIONS.equipmentReturn).findOne({ _id: id });
  if (!ret) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Return not found" subtitle={<BackLink href="/portal/equipment/returns" label="Back to returns" />} />
      </div>
    );
  }
  const order = await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder).findOne({ _id: ret.orderId });
  const canApprove = hasPermission(session, "finance:equipment_returns:approve");
  const suggested = ret.items.reduce((s, it) => s + it.creditLineTotal, 0);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Equipment"
        title={`Return ${ret.returnNumber}`}
        subtitle={<BackLink href="/portal/equipment/returns" label="Back to returns" />}
        actions={<ReturnStatusPill status={ret.status} />}
      />

      <div className="portal-grid-4">
        <Field label="Order" value={ret.orderNumber} href={`/portal/equipment/orders/${ret.orderId}`} />
        <Field label="Area Manager" value={ret.areaManagerName} />
        <Field label="Created" value={fmtDate(ret.created_at)} />
        <Field label="Credit amount" value={fmt$(ret.creditAmount)} strong />
        <Field label="Condition" value={ret.condition || "—"} />
        <Field label="Reason" value={ret.reason || "—"} />
      </div>

      {ret.notes && <CardShell title="Notes"><div style={{ padding: 16 }} className="muted">{ret.notes}</div></CardShell>}

      <CardShell title="Returned items">
        <div style={{ overflowX: "auto" }}>
          <table className="portal-table">
            <thead><tr><th>Product</th><th>SKU</th><th className="right">Unit price</th><th className="right">Qty returned</th><th className="right">Credit line</th></tr></thead>
            <tbody>
              {ret.items.map((it, i) => (
                <tr key={`${it.productId}-${i}`}>
                  <td>{it.productNameSnapshot}</td>
                  <td className="small mono">{it.skuSnapshot}</td>
                  <td className="right money">{fmt$(it.amPriceSnapshot)}</td>
                  <td className="right">{it.qtyReturned}</td>
                  <td className="right money">{fmt$(it.creditLineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4} className="right"><strong>Suggested credit</strong></td><td className="right money"><strong>{fmt$(suggested)}</strong></td></tr></tfoot>
          </table>
        </div>
      </CardShell>

      {ret.status === "Credited" ? (
        <CardShell title="Credit posted">
          <div style={{ padding: 16, display: "grid", gap: 6 }}>
            <div className="pill pill-paid" style={{ width: "fit-content" }}>Credited</div>
            <div className="small">Credit of <strong>{fmt$(ret.creditAmount)}</strong> posted to <strong>{ret.areaManagerName}</strong>&apos;s ledger (reduces what they owe).</div>
            <div className="muted small mono">Entry: {ret.creditLedgerEntryId} · {ret.creditPostedAt ? fmtDateTime(ret.creditPostedAt) : ""} by {ret.creditPostedBy}</div>
            {order?.ledgerId && <Link href={`/portal/ledger/${order.ledgerId}`} className="portal-btn" style={{ width: "fit-content" }}>View ledger →</Link>}
          </div>
        </CardShell>
      ) : (
        <ReturnActions
          returnId={ret._id}
          returnNumber={ret.returnNumber}
          areaManagerName={ret.areaManagerName}
          status={ret.status}
          creditApproved={ret.creditApproved}
          creditAmount={ret.creditAmount}
          suggested={suggested}
          orderCharged={!!order?.ledgerId}
          canApprove={canApprove}
        />
      )}
    </div>
  );
}

function Field({ label, value, strong, href }: { label: string; value: string; strong?: boolean; href?: string }) {
  return (
    <div className="portal-kpi" style={{ padding: "12px 14px" }}>
      <div className="portal-kpi-label">{label}</div>
      <div className="portal-kpi-value" style={{ fontSize: strong ? 18 : 15 }}>
        {href ? <Link href={href} style={{ color: "#818cf8", textDecoration: "none" }}>{value}</Link> : value}
      </div>
    </div>
  );
}
