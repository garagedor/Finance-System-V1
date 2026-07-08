import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { SettlementRecord } from "@/types/finance";
import type { Filter } from "mongodb";
import { fmt$, fmtDate, lastNDays } from "../../format";
import {
  PageHeader, StatPill, FilterBar, FilterField, CardShell, Empty,
} from "../../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../../_components/EntryFormModal";
import RowActions from "../../_components/RowActions";
import BankingTabs from "../BankingTabs";

export const dynamic = "force-dynamic";

interface SP {
  from?: string;
  to?: string;
  party?: string;
}

const SETTLEMENT_FIELDS: FieldDef[] = [
  { name: "date", label: "Date", kind: "date", required: true, width: "half",
    defaultValue: new Date().toISOString().slice(0, 10) },
  { name: "amount", label: "Amount", kind: "money", required: true, width: "half" },
  { name: "from_party_name", label: "Paid by (from)", kind: "text", required: true, width: "half" },
  { name: "to_party_name", label: "Paid to", kind: "text", required: true, width: "half" },
  { name: "payment_method", label: "Method", kind: "select", width: "half",
    options: [
      { value: "ach", label: "ACH" },
      { value: "wire", label: "Wire" },
      { value: "zelle", label: "Zelle" },
      { value: "venmo", label: "Venmo" },
      { value: "check", label: "Check" },
      { value: "cash", label: "Cash" },
    ] },
  { name: "reference", label: "Reference / memo", kind: "text", width: "half" },
  { name: "notes", label: "Notes", kind: "textarea" },
];

async function load(sp: SP) {
  await ensureFinanceIndexes();
  const range = {
    from: sp.from ?? lastNDays(90).from,
    to: sp.to ?? lastNDays(90).to,
  };
  const filter: Filter<SettlementRecord> = {
    date: { $gte: range.from, $lte: range.to },
  };
  if (sp.party) {
    filter.$or = [
      { from_party_name: { $regex: sp.party, $options: "i" } },
      { to_party_name: { $regex: sp.party, $options: "i" } },
    ];
  }
  const settlements = await coll<SettlementRecord>(FINANCE_COLLECTIONS.settlement)
    .find(filter)
    .sort({ date: -1 })
    .toArray();
  const total = settlements.reduce((s, x) => s + x.amount, 0);
  return { range, settlements, total };
}

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const d = await load(sp);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="System · Banking"
        title="Settlements"
        subtitle="Record payments between parties — e.g. company → AM, AM → tech, vendor invoices paid."
        actions={
          <EntryFormModal
            endpoint="/api/portal/settlements"
            title="Settlement"
            fields={SETTLEMENT_FIELDS}
            triggerLabel="+ Record settlement"
            primary
          />
        }
      />

      <BankingTabs active="settlements" />

      <section className="portal-grid-3">
        <StatPill label="Settlements (period)" value={d.settlements.length.toLocaleString()} />
        <StatPill label="Total amount" value={fmt$(d.total)} />
        <StatPill
          label="Avg per settlement"
          value={d.settlements.length > 0 ? fmt$(d.total / d.settlements.length) : "—"}
        />
      </section>

      <FilterBar>
        <FilterField label="From">
          <input type="date" name="from" defaultValue={d.range.from} className="portal-input" />
        </FilterField>
        <FilterField label="To">
          <input type="date" name="to" defaultValue={d.range.to} className="portal-input" />
        </FilterField>
        <FilterField label="Party contains">
          <input type="text" name="party" defaultValue={sp.party ?? ""} className="portal-input" />
        </FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/banking/settlements" className="portal-btn">Clear</Link>
      </FilterBar>

      <CardShell title="Settlements" subtitle={`${d.settlements.length} in window · ${fmt$(d.total)} total`}>
        {d.settlements.length === 0 ? (
          <Empty
            message="No settlements recorded in this window."
            action={
              <EntryFormModal
                endpoint="/api/portal/settlements"
                title="Settlement"
                fields={SETTLEMENT_FIELDS}
                triggerLabel="+ Add settlement"
              />
            }
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>From</th>
                <th>To</th>
                <th>Method</th>
                <th>Reference</th>
                <th className="right">Amount</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.settlements.map((s) => (
                <tr key={s._id}>
                  <td className="small mono">{fmtDate(s.date)}</td>
                  <td><strong>{s.from_party_name}</strong></td>
                  <td><strong>{s.to_party_name}</strong></td>
                  <td className="small muted">{s.payment_method ?? "—"}</td>
                  <td className="small muted">{s.reference ?? "—"}</td>
                  <td className="right money money-pos">{fmt$(s.amount)}</td>
                  <td className="right">
                    <RowActions
                      endpoint="/api/portal/settlements"
                      id={s._id}
                      canToggleStatus={false}
                    />
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
