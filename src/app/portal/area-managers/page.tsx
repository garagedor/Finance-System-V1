import { fetchLocations } from "@/lib/portal-people";
import { getDb } from "@/lib/finance-db";
import { fmt$, fmtDate } from "../format";
import { PageHeader, StatPill, CardShell, Empty } from "../_components/page-helpers";
import AssignAmCell from "./AssignAmCell";

export const dynamic = "force-dynamic";

export default async function AreaManagersPage() {
  const locations = await fetchLocations();
  const totalDebt = locations.reduce((s, l) => s + l.totalDebt, 0);

  // Explicit AM assignments + name suggestions (see AssignAmCell / the engine).
  const db = await getDb();
  const [locDocs, ledgerNames] = await Promise.all([
    db.collection("Location").find({}, { projection: { _id: 1, areaManagerName: 1 } }).toArray(),
    db.collection("finance_ledger").distinct("holder_name", { role: "area_manager" }),
  ]);
  const amByLocation = new Map(locDocs.map((l) => [String(l._id), String(l.areaManagerName ?? "")]));
  const amOptions = [...new Set([
    ...ledgerNames.map(String),
    ...locDocs.map((l) => String(l.areaManagerName ?? "")),
  ].map((s) => s.trim()).filter(Boolean))].sort();
  const unassigned = locations.filter((l) => !amByLocation.get(String(l._id))).length;

  return (
    <div className="portal-page">
      <PageHeader
        kicker="People"
        title="Area Managers"
        subtitle="One AM per location in CRM. Manager profit % drives the 40% (or per-location) payout split."
      />

      <section className="portal-grid-4">
        <StatPill label="Locations" value={locations.length.toLocaleString()} />
        <StatPill label="Avg manager %" value={`${avgManagerPct(locations).toFixed(1)}%`} />
        <StatPill label="Total open debt" value={fmt$(totalDebt)} />
        <StatPill label="AM unassigned" value={unassigned > 0 ? <span className="money-neg">{unassigned}</span> : "0"} />
      </section>

      <CardShell title="Locations / Area Managers" subtitle={`${locations.length} total`}>
        {locations.length === 0 ? (
          <Empty message="No locations found." />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>Area Manager (charged for disputes)</th>
                <th className="muted">Legacy default tech</th>
                <th className="right">Manager %</th>
                <th className="right">Open debts</th>
                <th className="right">Debt amount</th>
                <th>Last payout</th>
              </tr>
            </thead>
            <tbody>
              {locations
                .slice()
                .sort((a, b) => String(a._id).localeCompare(String(b._id)))
                .map((l) => (
                  <tr key={String(l._id)}>
                    <td><strong>{String(l._id)}</strong></td>
                    <td>
                      <AssignAmCell
                        location={String(l._id)}
                        current={amByLocation.get(String(l._id)) ?? ""}
                        options={amOptions}
                      />
                    </td>
                    <td className="muted small">{l.technician ?? "—"}</td>
                    <td className="right small">
                      {l.managerProfitPercent !== undefined ? `${l.managerProfitPercent}%` : "—"}
                    </td>
                    <td className="right">{l.openDebts || ""}</td>
                    <td className={`right money ${l.totalDebt > 0 ? "money-neg" : "money-zero"}`}>
                      {fmt$(l.totalDebt)}
                    </td>
                    <td className="muted small mono">{l.lastPayout ? fmtDate(l.lastPayout) : "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </CardShell>
    </div>
  );
}

function avgManagerPct(locations: Array<{ managerProfitPercent?: number | string }>): number {
  const vals = locations
    .map((l) => Number(l.managerProfitPercent))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (vals.length === 0) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}
