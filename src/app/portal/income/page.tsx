import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { getDb } from "@/lib/finance-db";
import type { ManualIncomeRecord } from "@/types/finance";
import { fmt$, fmtDate, lastNDays } from "../format";
import { PageHeader, StatPill, FilterBar, FilterField, CardShell, Empty } from "../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../_components/EntryFormModal";
import RowActions from "../_components/RowActions";
import type { Document } from "mongodb";

export const dynamic = "force-dynamic";

interface SP {
  from?: string;
  to?: string;
  source?: string;
}

const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "crm_jobs", label: "CRM Jobs" },
  { value: "installations", label: "Installations" },
  { value: "parts_sales", label: "Parts Sales (to AMs)" },
  { value: "card_fee_margin", label: "Card Fee Margin" },
  { value: "finance_fee_margin", label: "Finance Fee Margin" },
  { value: "company_parts_margin", label: "Company Parts Margin" },
  { value: "inventory", label: "Inventory" },
  { value: "other", label: "Other" },
];

const INCOME_FIELDS: FieldDef[] = [
  {
    name: "date", label: "Date", kind: "date", width: "half", required: true,
    defaultValue: new Date().toISOString().slice(0, 10),
  },
  {
    name: "amount", label: "Amount (USD)", kind: "money", width: "half", required: true,
    placeholder: "0.00",
  },
  {
    name: "source", label: "Source", kind: "select", required: true,
    options: SOURCE_OPTIONS, defaultValue: "manual",
  },
  {
    name: "description", label: "Description", kind: "text", required: true,
    placeholder: "What is this income?",
  },
  { name: "category", label: "Sub-category (optional)", kind: "text", width: "half" },
  {
    name: "payment_method", label: "Payment method", kind: "select", width: "half",
    options: [
      { value: "cash", label: "Cash" },
      { value: "card", label: "Card" },
      { value: "check", label: "Check" },
      { value: "ach", label: "ACH" },
      { value: "wire", label: "Wire" },
      { value: "zelle", label: "Zelle" },
      { value: "venmo", label: "Venmo" },
      { value: "other", label: "Other" },
    ],
  },
  { name: "related_area", label: "Related area (optional)", kind: "text", width: "half" },
  { name: "related_person_id", label: "Related person (optional)", kind: "text", width: "half" },
  { name: "notes", label: "Notes", kind: "textarea" },
];

async function loadIncome(sp: SP) {
  await ensureFinanceIndexes();
  const range = {
    from: sp.from ?? lastNDays(30).from,
    to: sp.to ?? lastNDays(30).to,
  };

  const filter: Record<string, unknown> = {
    date: { $gte: range.from, $lte: range.to },
  };
  if (sp.source) filter.source = sp.source;

  const c = await coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income);
  const rows = await c.find(filter).sort({ date: -1, _id: -1 }).limit(500).toArray();

  // Source totals (manual entries)
  const bySource: Record<string, number> = {};
  for (const r of rows) bySource[r.source] = (bySource[r.source] ?? 0) + r.amount;
  const manualTotal = rows.reduce((s, r) => s + r.amount, 0);

  // CRM jobs revenue for the same window (separate aggregation)
  const db = await getDb();
  const toNum = (field: string) => ({
    $convert: { input: `$${field}`, to: "double", onError: 0, onNull: 0 },
  });
  const crmAgg = await db
    .collection("Job")
    .aggregate<{ total: number; count: number }>([
      { $match: { date: { $gte: range.from, $lte: range.to }, status: { $regex: /^closed$/i } } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $add: [
                toNum("techPaidCash"),
                toNum("paidCard"),
                toNum("paidCompanyCheck"),
                toNum("paidFinance"),
                toNum("paidCompanyCash"),
                toNum("lmCash"),
                toNum("lmCheck"),
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
    ] as Document[])
    .toArray();
  const crmRevenue = crmAgg[0]?.total ?? 0;
  const crmJobCount = crmAgg[0]?.count ?? 0;

  return { range, rows, bySource, manualTotal, crmRevenue, crmJobCount };
}

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const d = await loadIncome(sp);
  const grandTotal = d.crmRevenue + d.manualTotal;

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Money"
        title="Income"
        subtitle={
          <>
            {d.range.from} → {d.range.to} · CRM jobs + manual entries
          </>
        }
        actions={
          <EntryFormModal
            endpoint="/api/portal/income"
            title="Income"
            fields={INCOME_FIELDS}
            triggerLabel="+ Add manual income"
            primary
          />
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Total revenue" value={fmt$(grandTotal)} anchorId="ai-inc-total" />
        <StatPill label="CRM jobs revenue" value={fmt$(d.crmRevenue)} anchorId="ai-inc-crm" />
        <StatPill label="Manual income" value={fmt$(d.manualTotal)} anchorId="ai-inc-manual" />
        <StatPill label="Closed CRM jobs" value={d.crmJobCount.toLocaleString()} />
      </section>

      <FilterBar>
        <FilterField label="From">
          <input type="date" name="from" defaultValue={d.range.from} className="portal-input" />
        </FilterField>
        <FilterField label="To">
          <input type="date" name="to" defaultValue={d.range.to} className="portal-input" />
        </FilterField>
        <FilterField label="Source (manual only)">
          <select name="source" defaultValue={sp.source ?? ""} className="portal-select">
            <option value="">All</option>
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/income" className="portal-btn">Clear</Link>
      </FilterBar>

      <CardShell
        title="Manual income entries"
        subtitle={`${d.rows.length} entries · ${fmt$(d.manualTotal)} total`}
      >
        {d.rows.length === 0 ? (
          <Empty
            message="No manual income in this window."
            action={
              <EntryFormModal
                endpoint="/api/portal/income"
                title="Income"
                fields={INCOME_FIELDS}
                triggerLabel="+ Add first entry"
              />
            }
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th>Description</th>
                <th>Area</th>
                <th>Method</th>
                <th className="right">Amount</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r._id}>
                  <td className="small mono">{fmtDate(r.date)}</td>
                  <td className="small">{labelForSource(r.source)}</td>
                  <td>
                    {r.description}
                    {r.notes && <div className="muted small">{r.notes}</div>}
                  </td>
                  <td className="muted small">{r.related_area ?? "—"}</td>
                  <td className="muted small">{r.payment_method ?? "—"}</td>
                  <td className="right money money-pos">+{fmt$(r.amount)}</td>
                  <td className="right">
                    <RowActions
                      endpoint="/api/portal/income"
                      id={r._id}
                      canToggleStatus={false}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>

      {Object.keys(d.bySource).length > 0 && (
        <CardShell title="Manual income — breakdown by source">
          <table className="portal-table">
            <thead>
              <tr>
                <th>Source</th>
                <th className="right">Total</th>
                <th className="right">% of manual</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(d.bySource)
                .sort(([, a], [, b]) => b - a)
                .map(([source, total]) => (
                  <tr key={source}>
                    <td>{labelForSource(source)}</td>
                    <td className="right money">{fmt$(total)}</td>
                    <td className="right muted small">
                      {d.manualTotal > 0 ? `${((total / d.manualTotal) * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardShell>
      )}
    </div>
  );
}

function labelForSource(s: string): string {
  return SOURCE_OPTIONS.find((o) => o.value === s)?.label ?? s;
}
