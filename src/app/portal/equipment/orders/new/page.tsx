import { readSession, hasPermission } from "@/lib/rbac";
import { fetchAreaManagerNames, fetchActiveProducts } from "@/lib/equipment/roster";
import { PageHeader, CardShell, Empty, BackLink } from "@/app/portal/_components/page-helpers";
import OrderBuilder, { type BuilderProduct, type BuilderAM } from "@/app/portal/equipment/_components/OrderBuilder";

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

  const [amNames, productDocs] = await Promise.all([fetchAreaManagerNames(), fetchActiveProducts()]);
  const ams: BuilderAM[] = amNames.map((name) => ({ id: name, name }));
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
        <CardShell title="No Area Managers"><Empty message="No Area Manager ledger accounts found — create one first (orders charge to an AM's ledger)." /></CardShell>
      ) : products.length === 0 ? (
        <CardShell title="No products"><Empty message="Add products to the catalog before building an order." /></CardShell>
      ) : (
        <OrderBuilder ams={ams} products={products} canSeeCost={canSeeCost} />
      )}
    </div>
  );
}
