import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { readSession, hasPermission } from "@/lib/rbac";
import { fetchAreaManagerNames, fetchActiveProducts } from "@/lib/equipment/roster";
import type { EquipmentOrder } from "@/types/equipment";
import { PageHeader, CardShell, Empty, BackLink } from "@/app/portal/_components/page-helpers";
import OrderBuilder, { type BuilderProduct, type BuilderAM, type OrderBuilderInitial } from "@/app/portal/equipment/_components/OrderBuilder";

export const dynamic = "force-dynamic";

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await readSession();
  if (!hasPermission(session, "finance:equipment_orders:create")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Edit Order" />
        <CardShell title="No access"><Empty message="You don't have permission to edit equipment orders." /></CardShell>
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
  if (!["Draft", "PendingApproval"].includes(order.status)) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title={`Edit ${order.orderNumber}`} subtitle={<BackLink href={`/portal/equipment/orders/${order._id}`} label="Back to order" />} />
        <CardShell title="Locked"><Empty message={`This order is ${order.status} and can no longer be edited. Only Draft orders are editable.`} /></CardShell>
      </div>
    );
  }

  const canSeeCost = hasPermission(session, "finance:equipment_cost:view");
  const [amNames, activeProducts] = await Promise.all([fetchAreaManagerNames(), fetchActiveProducts()]);

  const products: BuilderProduct[] = activeProducts.map((p) => ({
    _id: p._id, name: p.name, sku: p.sku, category: p.category ?? "",
    sellingUnit: String(p.sellingUnit), amPrice: Number(p.amPrice) || 0,
    companyCost: canSeeCost ? Number(p.companyCost) || 0 : 0,
  }));

  // Ensure the order's current AM is selectable even if it's not in the ledger list.
  const amSet = new Map(amNames.map((n) => [n.toLowerCase(), n]));
  if (order.areaManagerName && !amSet.has(order.areaManagerName.toLowerCase())) amSet.set(order.areaManagerName.toLowerCase(), order.areaManagerName);
  const ams: BuilderAM[] = [...amSet.values()].sort((a, b) => a.localeCompare(b)).map((name) => ({ id: name, name }));

  // Each existing item → a pre-filled, editable line (snapshots carry the price).
  const initial: OrderBuilderInitial = {
    areaManagerName: order.areaManagerName,
    area: order.area ?? "",
    orderDate: order.orderDate,
    deliveryMethod: String(order.deliveryMethod ?? "pickup"),
    expectedDeliveryAt: order.expectedDeliveryAt ?? "",
    notes: order.notes ?? "",
    lines: order.items.map((it, i) => ({
      key: `${it.productId}-${i}`,
      productId: it.productId,
      name: it.productNameSnapshot,
      sku: it.skuSnapshot,
      sellingUnit: String(it.sellingUnitSnapshot),
      qty: it.qty,
      amPrice: it.amPriceSnapshot,
      companyCost: canSeeCost ? it.companyCostSnapshot : 0,
      custom: String(it.productId).startsWith("custeq"),
    })),
  };

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Equipment"
        title={`Edit order ${order.orderNumber}`}
        subtitle={<BackLink href={`/portal/equipment/orders/${order._id}`} label="Back to order" />}
      />
      <OrderBuilder ams={ams} products={products} canSeeCost={canSeeCost} orderId={order._id} initial={initial} />
    </div>
  );
}
