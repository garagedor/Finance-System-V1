import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { readSession, hasPermission } from "@/lib/rbac";
import type { EquipmentProduct } from "@/types/equipment";
import { SELLING_UNITS } from "@/types/equipment";
import { fmt$ } from "../../format";
import { PageHeader, CardShell, Empty, BackLink } from "../../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../../_components/EntryFormModal";
import RowActions from "../../_components/RowActions";
import EquipmentTabs from "../_components/EquipmentTabs";

export const dynamic = "force-dynamic";

function productFields(canEditCost: boolean): FieldDef[] {
  const fields: FieldDef[] = [
    { name: "name", label: "Product name", kind: "text", required: true },
    { name: "sku", label: "SKU / code", kind: "text", width: "half", help: "Optional" },
    { name: "category", label: "Category", kind: "text", width: "half" },
    { name: "sellingUnit", label: "Selling unit", kind: "select", width: "half",
      options: SELLING_UNITS.map((u) => ({ value: u, label: u })), defaultValue: "unit" },
    { name: "amPrice", label: "AM selling price", kind: "money", required: true, width: "half",
      help: "The amount charged to the Area Manager (posted to the ledger)." },
  ];
  if (canEditCost) {
    fields.push({ name: "companyCost", label: "Company cost", kind: "money", width: "half",
      help: "Internal cost — profitability only. Never charged to the AM." });
  }
  fields.push(
    { name: "active", label: "Active", kind: "boolean", width: "half", defaultValue: true, help: "Available for ordering" },
    { name: "trackInventory", label: "Track inventory", kind: "boolean", width: "half", help: "Optional stock tracking" },
    { name: "stockQty", label: "Stock quantity", kind: "number", width: "half" },
    { name: "description", label: "Description", kind: "textarea" },
    { name: "notes", label: "Internal notes", kind: "textarea" },
  );
  return fields;
}

export default async function EquipmentProductsPage() {
  const session = await readSession();
  const canView = hasPermission(session, "finance:equipment_products:view");
  if (!canView) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Product Catalog" />
        <CardShell title="No access"><Empty message="You don't have permission to view the product catalog." /></CardShell>
      </div>
    );
  }
  const canCreate = hasPermission(session, "finance:equipment_products:create");
  const canEdit = hasPermission(session, "finance:equipment_products:edit");
  const canSeeCost = hasPermission(session, "finance:equipment_cost:view");
  const canEditCost = hasPermission(session, "finance:equipment_cost:edit");

  await ensureFinanceIndexes();
  const rows = await coll<EquipmentProduct>(FINANCE_COLLECTIONS.equipmentProduct)
    .find({}).sort({ active: -1, name: 1 }).limit(1000).toArray();

  const fields = productFields(canEditCost);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Equipment"
        title="Product Catalog"
        subtitle={<><BackLink href="/portal/equipment/orders" label="Orders" /> · Company cost is internal — only the AM price is ever charged.</>}
        actions={canCreate ? (
          <EntryFormModal endpoint="/api/portal/equipment/products" title="product" fields={fields} triggerLabel="+ New product" primary />
        ) : null}
      />
      <EquipmentTabs active="products" />

      <CardShell title="Products" subtitle={`${rows.length} product${rows.length === 1 ? "" : "s"}`}>
        {rows.length === 0 ? (
          <Empty message="No products yet." action={canCreate ? (
            <EntryFormModal endpoint="/api/portal/equipment/products" title="product" fields={fields} triggerLabel="+ Add first product" />
          ) : undefined} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Category</th>
                  <th>Unit</th>
                  <th className="right">AM price</th>
                  {canSeeCost && <th className="right">Company cost</th>}
                  {canSeeCost && <th className="right">Margin</th>}
                  <th>Status</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const margin = p.amPrice > 0 ? ((p.amPrice - p.companyCost) / p.amPrice) * 100 : 0;
                  return (
                    <tr key={p._id} style={{ opacity: p.active ? 1 : 0.5 }}>
                      <td>{p.name}{p.description && <div className="muted small">{p.description}</div>}</td>
                      <td className="small mono">{p.sku}</td>
                      <td className="muted small">{p.category || "—"}</td>
                      <td className="small">{p.sellingUnit}</td>
                      <td className="right money">{fmt$(p.amPrice)}</td>
                      {canSeeCost && <td className="right money muted">{fmt$(p.companyCost)}</td>}
                      {canSeeCost && <td className="right small">{margin.toFixed(1)}%</td>}
                      <td><span className={`pill ${p.active ? "pill-paid" : "pill-draft"}`}>{p.active ? "active" : "inactive"}</span></td>
                      <td className="right">
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          {canEdit && (
                            <EntryFormModal endpoint="/api/portal/equipment/products" title="product" fields={fields} initial={p as unknown as Record<string, unknown>} triggerLabel="Edit" />
                          )}
                          {canEdit && <RowActions endpoint="/api/portal/equipment/products" id={p._id} canToggleStatus={false} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardShell>
    </div>
  );
}
