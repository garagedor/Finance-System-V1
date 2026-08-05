import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { LedgerRecord, LedgerEntryRecord } from "@/types/finance-ledger";
import { fmt$ } from "../format";
import { PageHeader, StatPill, CardShell, Empty, FilterBar, FilterField } from "../_components/page-helpers";
import MultiSelect from "../_components/MultiSelect";
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

  // One section per role. Canonical roles first, then the rest alphabetically.
  const ROLE_ORDER = ["area_manager", "technician"];
  const byRole = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byRole.get(r.role) ?? [];
    arr.push(r);
    byRole.set(r.role, arr);
  }
  const groups = [...byRole.entries()]
    .map(([role, rs]) => ({
      role,
      label: ROLE_LABEL[role] ?? role,
      rows: rs,
      weOwe: rs.filter((x) => x.balance < 0).reduce((s, x) => s + x.balance, 0),
      theyOwe: rs.filter((x) => x.balance > 0).reduce((s, x) => s + x.balance, 0),
    }))
    .sort((a, b) => {
      const ai = ROLE_ORDER.indexOf(a.role), bi = ROLE_ORDER.indexOf(b.role);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.label.localeCompare(b.label);
    });

  return { rows, weOwe, theyOwe, groups };
}

export default async function LedgerListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const d = await load();

  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  const arr = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
  const q = str(sp.q).trim().toLowerCase();
  const balance = str(sp.balance);            // "" | owe | owed | settled
  const locFilter = arr(sp.loc);

  // Active role tab (a role present in the data, or "all").
  const active = sp.role && d.groups.some((g) => g.role === str(sp.role)) ? str(sp.role) : "all";
  const activeGroup = d.groups.find((g) => g.role === active);
  const baseRows = active === "all" ? d.rows : activeGroup?.rows ?? [];

  // Distinct locations in this tab (for the filter dropdown).
  const locOptions = [...new Set(baseRows.map((r) => r.location).filter(Boolean))].sort();

  // Search + filter within the tab.
  const rows = baseRows.filter((r) => {
    if (q && !`${r.holder_name} ${r.location ?? ""} ${r.label ?? ""}`.toLowerCase().includes(q)) return false;
    if (locFilter.length && !locFilter.includes(r.location)) return false;
    if (balance === "owe" && !(r.balance < -0.005)) return false;
    if (balance === "owed" && !(r.balance > 0.005)) return false;
    if (balance === "settled" && Math.abs(r.balance) > 0.005) return false;
    return true;
  });
  const weOwe = rows.filter((r) => r.balance < 0).reduce((s, r) => s + r.balance, 0);
  const theyOwe = rows.filter((r) => r.balance > 0).reduce((s, r) => s + r.balance, 0);
  const heading = active === "all" ? "All ledgers" : activeGroup?.label ?? "Ledgers";
  const filtered = !!q || !!balance || locFilter.length > 0;

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Tracking"
        title="Ledger"
        subtitle="Running balance with each party · one tab per role · balance = sum of all entries"
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
        <StatPill label={active === "all" ? "Ledgers" : `${heading} ledgers`} value={rows.length.toLocaleString()} />
        <StatPill label="We owe" value={<span className="money-neg">{fmt$(weOwe)}</span>} />
        <StatPill label="They owe" value={<span className="money-pos">+{fmt$(theyOwe)}</span>} />
        <StatPill label="Net" value={<BalanceText n={weOwe + theyOwe} />} />
      </section>

      {/* One tab per role */}
      {d.groups.length > 0 && (
        <div className="portal-tabs" style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
          <Link href="/portal/ledger" className={`portal-btn ${active === "all" ? "portal-btn-primary" : ""}`}>
            All ({d.rows.length})
          </Link>
          {d.groups.map((g) => (
            <Link
              key={g.role}
              href={`/portal/ledger?role=${encodeURIComponent(g.role)}`}
              className={`portal-btn ${active === g.role ? "portal-btn-primary" : ""}`}
            >
              {g.label} ({g.rows.length})
            </Link>
          ))}
        </div>
      )}

      {/* Search + filter within the active tab */}
      {baseRows.length > 0 && (
        <FilterBar>
          <FilterField label="Search">
            <input className="portal-input" type="search" name="q" defaultValue={q} placeholder="name / location / label" />
          </FilterField>
          <FilterField label="Balance">
            <select className="portal-select" name="balance" defaultValue={balance}>
              <option value="">All</option>
              <option value="owe">We owe (negative)</option>
              <option value="owed">They owe (positive)</option>
              <option value="settled">Settled ($0)</option>
            </select>
          </FilterField>
          <FilterField label="Location">
            <MultiSelect name="loc" selected={locFilter} options={locOptions} />
          </FilterField>
          {active !== "all" && <input type="hidden" name="role" value={active} />}
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
            <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
            <Link href={active === "all" ? "/portal/ledger" : `/portal/ledger?role=${encodeURIComponent(active)}`} className="portal-btn">Clear</Link>
          </div>
        </FilterBar>
      )}

      <CardShell
        title={heading}
        subtitle={baseRows.length ? `${rows.length}${filtered ? ` of ${baseRows.length}` : ""} ledger(s) · we owe ${fmt$(weOwe)} · they owe +${fmt$(theyOwe)}` : undefined}
      >
        {rows.length === 0 ? (
          filtered ? (
            <Empty message="No ledgers match the search / filters." />
          ) : (
            <Empty
              message="No ledgers yet. Create one per party (area manager, technician, provider, …) you settle with."
              action={
                <EntryFormModal
                  endpoint="/api/portal/ledger"
                  title="Ledger"
                  fields={LEDGER_FIELDS}
                  triggerLabel="+ Create your first ledger"
                />
              }
            />
          )
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Person</th>
                {active === "all" && <th>Role</th>}
                <th>Location / Area</th>
                <th className="right">Entries</th>
                <th className="right">Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id}>
                  <td>
                    <Link href={`/portal/ledger/${r._id}`} style={{ color: "#cbd5e1", fontWeight: 600 }}>
                      {r.holder_name}
                    </Link>
                    {r.label && <div className="muted small">{r.label}</div>}
                  </td>
                  {active === "all" && <td className="small">{ROLE_LABEL[r.role] ?? r.role}</td>}
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
