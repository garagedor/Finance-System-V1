import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { LedgerRecord, LedgerEntryRecord } from "@/types/finance-ledger";
import { fmt$ } from "../format";
import { PageHeader, StatPill, CardShell, Empty } from "../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../_components/EntryFormModal";

export const dynamic = "force-dynamic";

const LEDGER_FIELDS: FieldDef[] = [
  { name: "holder_name", label: "Person", kind: "text", required: true, placeholder: "e.g. Yuval" },
  { name: "role", label: "Role", kind: "combo", width: "half", required: true,
    placeholder: "Pick or type a new role",
    options: [
      { value: "Area Manager", label: "Area Manager" },
      { value: "Technician", label: "Technician" },
      { value: "Provider", label: "Provider" },
      { value: "Subcontractor", label: "Subcontractor" },
      { value: "Office", label: "Office" },
      { value: "Vendor", label: "Vendor" },
      { value: "Partner", label: "Partner" },
      { value: "Lead Manager", label: "Lead Manager" },
    ],
    defaultValue: "Area Manager" },
  { name: "location", label: "Location / Area", kind: "text", width: "half", required: true,
    placeholder: "e.g. Minnesota" },
  { name: "label", label: "Label (optional)", kind: "text", placeholder: "e.g. old card" },
  { name: "notes", label: "Notes", kind: "textarea" },
];

const ROLE_LABEL: Record<string, string> = {
  area_manager: "Area Manager",
  technician: "Technician",
};

async function load() {
  await ensureFinanceIndexes();
  const [ledgers, balances] = await Promise.all([
    coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).find({}).sort({ holder_name: 1 }).toArray(),
    coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry)
      .aggregate<{ _id: string; balance: number; count: number }>([
        { $group: { _id: "$ledger_id", balance: { $sum: "$amount" }, count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const byId = new Map(balances.map((b) => [b._id, b]));
  const rows = ledgers.map((l) => ({
    ...l,
    balance: byId.get(l._id)?.balance ?? 0,
    entries: byId.get(l._id)?.count ?? 0,
  }));
  const weOwe = rows.filter((r) => r.balance < 0).reduce((s, r) => s + r.balance, 0);
  const theyOwe = rows.filter((r) => r.balance > 0).reduce((s, r) => s + r.balance, 0);
  return { rows, weOwe, theyOwe };
}

export default async function LedgerListPage() {
  const d = await load();

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Tracking"
        title="Manager & Tech Ledgers"
        subtitle="Running balance with each area manager / technician · balance = sum of all entries"
        actions={
          <>
            <Link href="/portal/ledger/rates" className="portal-btn">
              ⚙ Tech rates
            </Link>
            <EntryFormModal
              endpoint="/api/portal/ledger"
              title="Ledger"
              fields={LEDGER_FIELDS}
              triggerLabel="+ New ledger"
              primary
            />
          </>
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Ledgers" value={d.rows.length.toLocaleString()} />
        <StatPill label="We owe (total)" value={<span className="money-neg">{fmt$(d.weOwe)}</span>} />
        <StatPill label="They owe (total)" value={<span className="money-pos">+{fmt$(d.theyOwe)}</span>} />
        <StatPill label="Net" value={<BalanceText n={d.weOwe + d.theyOwe} />} />
      </section>

      <CardShell title="Ledgers" subtitle={`${d.rows.length} total`}>
        {d.rows.length === 0 ? (
          <Empty
            message="No ledgers yet. Create one per area manager / technician you settle with."
            action={
              <EntryFormModal
                endpoint="/api/portal/ledger"
                title="Ledger"
                fields={LEDGER_FIELDS}
                triggerLabel="+ Create your first ledger"
              />
            }
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Location / Area</th>
                <th className="right">Entries</th>
                <th className="right">Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r._id}>
                  <td>
                    <Link href={`/portal/ledger/${r._id}`} style={{ color: "#cbd5e1", fontWeight: 600 }}>
                      {r.holder_name}
                    </Link>
                    {r.label && <div className="muted small">{r.label}</div>}
                  </td>
                  <td className="small">{ROLE_LABEL[r.role] ?? r.role}</td>
                  <td className="muted small">{r.location || "—"}</td>
                  <td className="right muted small">{r.entries.toLocaleString()}</td>
                  <td className="right"><BalanceText n={r.balance} /></td>
                  <td className="right">
                    <Link href={`/portal/ledger/${r._id}`} className="portal-btn"
                      style={{ padding: "4px 10px", fontSize: 11 }}>
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>

      <p className="muted small" style={{ marginTop: 4 }}>
        <span className="money-neg">Red / negative</span> = company owes them ·{" "}
        <span className="money-pos">Green / positive</span> = they owe the company.
      </p>
    </div>
  );
}

/** Render a balance with the report sign convention + color. */
export function BalanceText({ n }: { n: number }) {
  const cls = n < -0.005 ? "money-neg" : n > 0.005 ? "money-pos" : "money-zero";
  return (
    <span className={`money ${cls}`} style={{ fontWeight: 600 }}>
      {fmt$(n, { showSign: true })}
    </span>
  );
}
