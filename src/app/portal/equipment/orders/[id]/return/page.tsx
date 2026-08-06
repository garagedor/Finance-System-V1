import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { readSession, hasPermission } from "@/lib/rbac";
import { priorReturnedByProduct } from "@/lib/equipment/returns";
import type { EquipmentOrder } from "@/types/equipment";
import { PageHeader, CardShell, Empty, BackLink } from "../../../../_components/page-helpers";
import ReturnBuilder, { type ReturnableItem } from "../../../_components/ReturnBuilder";

export const dynamic = "force-dynamic";

export default async function NewReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await readSession();
  if (!hasPermission(session, "finance:equipment_returns:create")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Create Return" />
        <CardShell title="No access"><Empty message="You don't have permission to create equipment returns." /></CardShell>
      </div>
    );
  }
  await ensureFinanceIndexes();
  const order = await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder).findOne({ _id: id });
  if (!order) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Order not found" subtitle={<BackLink href="/portal/equipment/orders" label="Back" />} />
      </div>
    );
  }
  if (!["Delivered", "ChargedToLedger", "PartiallyReturned"].includes(order.status)) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title={`Return — ${order.orderNumber}`} subtitle={<BackLink href={`/portal/equipment/orders/${order._id}`} label="Back to order" />} />
        <CardShell title="Not returnable"><Empty message={`Returns are only allowed on delivered or charged orders (this order is ${order.status}).`} /></CardShell>
      </div>
    );
  }

  // Remaining returnable per product = ordered − already returned.
  const prior = await priorReturnedByProduct(order._id);
  const orderedByProduct = new Map<string, ReturnableItem>();
  for (const it of order.items) {
    const cur = orderedByProduct.get(it.productId);
    if (cur) cur.remaining += it.qty;
    else orderedByProduct.set(it.productId, { productId: it.productId, name: it.productNameSnapshot, sku: it.skuSnapshot, amPrice: it.amPriceSnapshot, remaining: it.qty });
  }
  const returnable = [...orderedByProduct.values()]
    .map((r) => ({ ...r, remaining: r.remaining - (prior.get(r.productId) ?? 0) }))
    .filter((r) => r.remaining > 0);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Equipment"
        title={`Return — order ${order.orderNumber}`}
        subtitle={<BackLink href={`/portal/equipment/orders/${order._id}`} label="Back to order" />}
      />
      {returnable.length === 0 ? (
        <CardShell title="Nothing to return"><Empty message="Every unit on this order has already been returned." /></CardShell>
      ) : (
        <ReturnBuilder orderId={order._id} orderNumber={order.orderNumber} returnable={returnable} />
      )}
    </div>
  );
}
