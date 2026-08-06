import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes, getDb } from "@/lib/finance-db";
import { readSession, hasPermission } from "@/lib/rbac";
import type { EquipmentProduct } from "@/types/equipment";
import { PageHeader, CardShell, Empty, BackLink } from "../../../_components/page-helpers";
import OrderBuilder, { type BuilderProduct, type BuilderAM } from "../../_components/OrderBuilder";

export const dynamic = "force-dynamic";

export default async function NewEquipmentOrderPage() {
  const session = await readSession();
  if (!hasPermission(session, "finance:equipment_orders:create")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Create Order" />
        <CardShell title="No access"><Empty message="You don't have permission to create equipment orders." /></CardShell>
      </div>
    );
  }
  const canSeeCost = hasPermission(session, "finance:equipment_cost:view");

  await ensureFinanceIndexes();
  const db = await getDb();

  // Area Manager roster (CRM `AreaManager` collection, keyed by name for ledgers).
  const amDocs = await db.collection("AreaManager")
    .find({}, { projection: { name: 1 } }).sort({ name: 1 }).toArray();
  const ams: BuilderAM[] = amDocs
    .map((a) => ({ id: String(a._id), name: String((a as { name?: unknown }).name ?? "").trim() }))
    .filter((a) => a.name);

  const productDocs = await coll<EquipmentProduct>(FINANCE_COLLECTIONS.equipmentProduct)
    .find({ active: true }).sort({ name: 1 }).limit(2000).toArray();
  const products: BuilderProduct[] = productDocs.map((p) => ({
    _id: p._id,
    name: p.name,
    sku: p.sku,
    category: p.category ?? "",
    sellingUnit: String(p.sellingUnit),
    amPrice: Number(p.amPrice) || 0,
    companyCost: canSeeCost ? Number(p.companyCost) || 0 : 0,
  }));

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Equipment"
        title="Create Order"
        subtitle={<BackLink href="/portal/equipment/orders" label="Back to orders" />}
      />
      {ams.length === 0 ? (
        <CardShell title="No Area Managers"><Empty message="Add an Area Manager first — orders are charged to an AM's ledger." /></CardShell>
      ) : products.length === 0 ? (
        <CardShell title="No products"><Empty message="Add products to the catalog before building an order." /></CardShell>
      ) : (
        <OrderBuilder ams={ams} products={products} canSeeCost={canSeeCost} />
      )}
    </div>
  );
}
