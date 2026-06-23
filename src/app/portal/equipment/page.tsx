import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { EquipmentRecord } from "@/types/finance";
import { fmt$, fmtDate, lastNDays } from "../format";
import { PageHeader, StatPill, FilterBar, FilterField, CardShell, Empty, StatusPill } from "../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../_components/EntryFormModal";
import RowActions from "../_components/RowActions";

export const dynamic = "force-dynamic";

interface SP {
  type?: string;
  from?: string;
  to?: string;
}

const EQUIPMENT_FIELDS: FieldDef[] = [
  { name: "date", label: "Date", kind: "date", required: true, width: "half",
    defaultValue: new Date().toISOString().slice(0, 10) },
  { name: "type", label: "Transaction type", kind: "select", required: true, width: "half",
    options: [
      { value: "purchase", label: "Purchase (cost)" },
      { value: "sale_to_am", label: "Sale to area manager" },
      { value: "internal_use", label: "Internal use" },
      { value: "scrap", label: "Scrap / disposal" },
    ],
    defaultValue: "purchase" },
  { name: "description", label: "Description", kind: "text", required: true,
    placeholder: "What is being purchased / sold?" },
  { name: "sku", label: "SKU", kind: "text", width: "half" },
  { name: "qty", label: "Quantity", kind: "number", width: "half" },
  { name: "unit_cost", label: "Unit cost", kind: "money", width: "half" },
  { name: "unit_price", label: "Unit price (sale)", kind: "money", width: "half" },
  { name: "amount", label: "Total amount", kind: "money", required: true, width: "half",
    help: "Positive = revenue / outflow value; for purchases enter the cost." },
  { name: "profit", label: "Profit (if sale)", kind: "money", width: "half" },
  { name: "counterparty_name", label: "Counterparty", kind: "text", width: "half",
    placeholder: "Vendor or AM name" },
  { name: "related_area", label: "Related area", kind: "text", width: "half" },
  { name: "paid_amount", label: "Paid so far", kind: "money", width: "half", defaultValue: 0 },
  { name: "status", label: "Status", kind: "select", required: true, width: "half",
    options: [{ value: "unpaid", label: "Unpaid" }, { value: "paid", label: "Paid" }],
    defaultValue: "unpaid" },
  { name: "notes", label: "Notes", kind: "textarea" },
];

async function load(sp: SP) {
  await ensureFinanceIndexes();
  const range = {
    from: sp.from ?? lastNDays(90).from,
    to: sp.to ?? lastNDays(90).to,
  };
  const filter: Record<string, unknown> = { date: { $gte: range.from, $lte: range.to } };
  if (sp.type) filter.type = sp.type;

  const rows = await coll<EquipmentRecord>(FINANCE_COLLECTIONS.equipment)
    .find(filter)
    .sort({ date: -1 })
    .toArray();

  const purchases = rows.filter((r) => r.type === "purchase").reduce((s, r) => s + r.amount, 0);
  const sales = rows.filter((r) => r.type === "sale_to_am").reduce((s, r) => s + r.amount, 0);
  const profit = rows.reduce((s, r) => s + (r.profit ?? 0), 0);
  const openAmount = rows.filter((r) => r.status === "unpaid").reduce((s, r) => s + (r.open_amount ?? r.amount), 0);

  return { range, rows, purchases, sales, profit, openAmount };
}

export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const d = await load(sp);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Tracking"
        title="Equipment Finance"
        subtitle="Door / motor / parts purchases and sales to AMs — finance side only. Full inventory comes later."
        actions={
          <EntryFormModal
            endpoint="/api/portal/equipment"
            title="Equipment transaction"
            fields={EQUIPMENT_FIELDS}
            triggerLabel="+ Record equipment"
            primary
          />
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Purchases (period)" value={<span className="money-neg">{fmt$(d.purchases)}</span>} />
        <StatPill label="Sales to AMs" value={<span className="money-pos">{fmt$(d.sales)}</span>} />
        <StatPill label="Profit (sales − cost)" value={fmt$(d.profit)} />
        <StatPill label="Open balance" value={fmt$(d.openAmount)} />
      </section>

      <FilterBar>
        <FilterField label="From">
          <input type="date" name="from" defaultValue={d.range.from} className="portal-input" />
        </FilterField>
        <FilterField label="To">
          <input type="date" name="to" defaultValue={d.range.to} className="portal-input" />
        </FilterField>
        <FilterField label="Type">
          <select name="type" defaultValue={sp.type ?? ""} className="portal-select">
            <option value="">All</option>
            <option value="purchase">Purchase</option>
            <option value="sale_to_am">Sale to AM</option>
            <option value="internal_use">Internal use</option>
            <option value="scrap">Scrap</option>
          </select>
        </FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/equipment" className="portal-btn">Clear</Link>
      </FilterBar>

      <CardShell title="Equipment ledger" subtitle={`${d.rows.length} entries`}>
        {d.rows.length === 0 ? (
          <Empty
            message="No equipment activity in this window."
            action={
              <EntryFormModal
                endpoint="/api/portal/equipment"
                title="Equipment transaction"
                fields={EQUIPMENT_FIELDS}
                triggerLabel="+ Add first entry"
              />
            }
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th>Counterparty</th>
                <th>Area</th>
                <th className="right">Qty</th>
                <th className="right">Amount</th>
                <th className="right">Profit</th>
                <th>Status</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r._id}>
                  <td className="small mono">{fmtDate(r.date)}</td>
                  <td className="small">{labelForType(r.type)}</td>
                  <td>
                    {r.description}
                    {r.sku && <div className="muted small">SKU: {r.sku}</div>}
                  </td>
                  <td className="muted small">{r.counterparty_name ?? "—"}</td>
                  <td className="muted small">{r.related_area ?? "—"}</td>
                  <td className="right small">{r.qty ?? "—"}</td>
                  <td className={`right money ${r.type === "purchase" ? "money-neg" : "money-pos"}`}>
                    {r.type === "purchase" ? "−" : "+"}{fmt$(r.amount)}
                  </td>
                  <td className="right money muted">{r.profit !== null && r.profit !== undefined ? fmt$(r.profit) : "—"}</td>
                  <td><StatusPill status={r.status} /></td>
                  <td className="right">
                    <RowActions endpoint="/api/portal/equipment" id={r._id} currentStatus={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>
    </div>
  );
}

function labelForType(t: string): string {
  return ({
    purchase: "Purchase",
    sale_to_am: "Sale to AM",
    internal_use: "Internal use",
    scrap: "Scrap",
  } as Record<string, string>)[t] ?? t;
}
