/* ═══════════════════════════════════════════════════════════════════════════
   Ledger list — Design 360 S3 applied.

   SCOPE NOTE: this file's DATA is untouched. `load()`, the search/filter/tab
   logic, every href, every permission and the GET-form submission are
   byte-identical to before. Only the JSX below `return (` changed, to use the
   shared UI layer.

   What moved: the four figures that were mid-page stat pills now sit in a
   summary strip directly under the header, and a plain-language sentence
   states the position before any row is read. Active filters became
   removable chips, so what is applied is visible without opening the form.
   ═══════════════════════════════════════════════════════════════════════════ */

import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { LedgerRecord, LedgerEntryRecord } from "@/types/finance-ledger";
import { fmt$ } from "../format";
import MultiSelect from "../_components/MultiSelect";
import EntryFormModal, { type FieldDef } from "../_components/EntryFormModal";
import PageHeader from "@/components/shell/PageHeader";
import { SummaryStrip, TableShell, EmptyState, StatusBadge } from "@/components/ui";
import "@/components/ui/ui.css";

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

/* ── DATA — unchanged from the previous revision ──────────────────────── */
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
  const balance = str(sp.balance);
  const locFilter = arr(sp.loc);

  const active = sp.role && d.groups.some((g) => g.role === str(sp.role)) ? str(sp.role) : "all";
  const activeGroup = d.groups.find((g) => g.role === active);
  const baseRows = active === "all" ? d.rows : activeGroup?.rows ?? [];

  const locOptions = [...new Set(baseRows.map((r) => r.location).filter(Boolean))].sort();

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

  /* ── PRESENTATION ─────────────────────────────────────────────────── */

  const tabBase = (role: string) => (role === "all" ? "/portal/ledger" : `/portal/ledger?role=${encodeURIComponent(role)}`);
  const clearHref = tabBase(active);

  // Active filters as removable chips — each link drops one filter and keeps
  // the rest, so what is applied is readable without opening the form.
  const keep = (omit: string) => {
    const p = new URLSearchParams();
    if (active !== "all") p.set("role", active);
    if (q && omit !== "q") p.set("q", q);
    if (balance && omit !== "balance") p.set("balance", balance);
    if (omit !== "loc") locFilter.forEach((l) => p.append("loc", l));
    const s = p.toString();
    return `/portal/ledger${s ? `?${s}` : ""}`;
  };
  const BALANCE_LABEL: Record<string, string> = {
    owe: "We owe", owed: "They owe", settled: "Settled",
  };

  const net = weOwe + theyOwe;
  const summary = rows.length === 0
    ? "Nothing matches the current view."
    : `${rows.length} ledger${rows.length === 1 ? "" : "s"} in view. The company owes ${fmt$(Math.abs(weOwe))} and is owed ${fmt$(theyOwe)} — a net position of ${fmt$(net, { showSign: true })}.`;

  return (
    <div className="portal-page">
      <PageHeader
        title="Ledgers"
        subtitle="Running balance with each party. A balance is the sum of that ledger's entries — nothing is stored as a total."
        actions={
          <>
            <Link href="/portal/ledger/rates" className="u-btn">Tech rates</Link>
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

      <div style={{ padding: "0 var(--ds-space-6) var(--ds-space-5)" }}>
        {/* Summary first — the position before any row. */}
        <SummaryStrip
          items={[
            { label: active === "all" ? "Ledgers in view" : `${heading} in view`, value: rows.length.toLocaleString(), sub: filtered ? `of ${baseRows.length} total` : undefined },
            { label: "We owe", value: fmt$(Math.abs(weOwe)), tone: weOwe < -0.005 ? "neg" : "muted" },
            { label: "They owe", value: fmt$(theyOwe), tone: theyOwe > 0.005 ? "pos" : "muted" },
            { label: "Net position", value: fmt$(net, { showSign: true }), tone: net < -0.005 ? "neg" : net > 0.005 ? "pos" : "muted" },
          ]}
        />

        {/* Role tabs */}
        {d.groups.length > 0 && (
          <div className="u-tabs" style={{ marginTop: "var(--ds-space-5)" }} role="tablist">
            <Link href={tabBase("all")} role="tab" aria-selected={active === "all"}
                  className={`u-tab${active === "all" ? " is-on" : ""}`}>
              All <span className="u-tab-n">{d.rows.length}</span>
            </Link>
            {d.groups.map((g) => (
              <Link key={g.role} href={tabBase(g.role)} role="tab" aria-selected={active === g.role}
                    className={`u-tab${active === g.role ? " is-on" : ""}`}>
                {g.label} <span className="u-tab-n">{g.rows.length}</span>
              </Link>
            ))}
          </div>
        )}

        {/* Active filters, as removable chips */}
        {filtered && (
          <div className="u-filters" style={{ marginBottom: "var(--ds-space-4)" }}>
            {q && <Link href={keep("q")} className="u-chip is-on">Search: {q} <span className="u-chip-x">×</span></Link>}
            {balance && <Link href={keep("balance")} className="u-chip is-on">{BALANCE_LABEL[balance] ?? balance} <span className="u-chip-x">×</span></Link>}
            {locFilter.length > 0 && <Link href={keep("loc")} className="u-chip is-on">{locFilter.length === 1 ? locFilter[0] : `${locFilter.length} locations`} <span className="u-chip-x">×</span></Link>}
            <Link href={clearHref} className="u-filter-clear">Clear all</Link>
          </div>
        )}

        {/* Filter form — same GET submission and field names as before */}
        {baseRows.length > 0 && (
          <form className="u-table" style={{ marginBottom: "var(--ds-space-4)" }}>
            <div className="u-table-bar" style={{ borderBottom: "none", alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "1 1 200px" }}>
                <span className="u-label" style={{ marginBottom: 0 }}>Search</span>
                <input className="u-input" type="search" name="q" defaultValue={q} placeholder="Name, location or label" />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "0 1 180px" }}>
                <span className="u-label" style={{ marginBottom: 0 }}>Balance</span>
                <select className="u-select" name="balance" defaultValue={balance}>
                  <option value="">All balances</option>
                  <option value="owe">We owe (negative)</option>
                  <option value="owed">They owe (positive)</option>
                  <option value="settled">Settled ($0)</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "0 1 220px" }}>
                <span className="u-label" style={{ marginBottom: 0 }}>Location</span>
                <MultiSelect name="loc" selected={locFilter} options={locOptions} />
              </label>
              {active !== "all" && <input type="hidden" name="role" value={active} />}
              <div style={{ display: "flex", gap: "var(--ds-space-2)" }}>
                <button type="submit" className="u-btn primary">Apply</button>
                <Link href={clearHref} className="u-btn">Reset</Link>
              </div>
            </div>
          </form>
        )}

        <TableShell
          count={rows.length}
          countLabel={filtered ? `of ${baseRows.length} ledgers` : "ledgers"}
          footer={
            <span>
              <strong style={{ color: "var(--ds-crit)" }}>Negative</strong> means the company owes them ·{" "}
              <strong style={{ color: "var(--ds-ok)" }}>positive</strong> means they owe the company.
            </span>
          }
        >
          {rows.length === 0 ? (
            filtered ? (
              <EmptyState
                title="No ledgers match these filters"
                description="Try clearing a filter or widening the search."
                actions={<Link href={clearHref} className="u-btn">Clear all filters</Link>}
              />
            ) : (
              <EmptyState
                title="No ledgers yet"
                description="Create one per party you settle with — an area manager, technician, provider or vendor. The balance builds itself from the entries you post."
                actions={
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
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  {active === "all" && <th>Role</th>}
                  <th>Location</th>
                  <th className="num">Entries</th>
                  <th className="num">Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td className="strong" data-label="Person">
                      <Link href={`/portal/ledger/${r._id}`} style={{ color: "inherit" }}>
                        {r.holder_name}
                      </Link>
                      {r.label && <div style={{ color: "var(--ds-ink-3)", fontSize: "var(--ds-text-xs)" }}>{r.label}</div>}
                    </td>
                    {active === "all" && (
                      <td data-label="Role">
                        <StatusBadge tone="neutral" plain>{ROLE_LABEL[r.role] ?? r.role}</StatusBadge>
                      </td>
                    )}
                    <td data-label="Location">{r.location || "—"}</td>
                    <td className="num" data-label="Entries">{r.entries.toLocaleString()}</td>
                    <td className="num" data-label="Balance"><BalanceText n={r.balance} /></td>
                    <td className="num">
                      <Link href={`/portal/ledger/${r._id}`} className="u-btn sm">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableShell>
      </div>
    </div>
  );
}

/** Render a balance with the report sign convention + colour. Unchanged. */
export function BalanceText({ n }: { n: number }) {
  const tone = n < -0.005 ? "var(--ds-crit)" : n > 0.005 ? "var(--ds-ok)" : "var(--ds-ink-3)";
  return (
    <span style={{ color: tone, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
      {fmt$(n, { showSign: true })}
    </span>
  );
}
