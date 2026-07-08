import { fetchLocations } from "@/lib/portal-people";
import { fmt$, fmtDate } from "../format";
import { PageHeader, StatPill, CardShell, Empty } from "../_components/page-helpers";

export const dynamic = "force-dynamic";

export default async function AreaManagersPage() {
  const locations = await fetchLocations();
  const totalDebt = locations.reduce((s, l) => s + l.totalDebt, 0);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="People"
        title="Area Managers"
        subtitle="One AM per location in CRM. Manager profit % drives the 40% (or per-location) payout split."
      />

      <section className="portal-grid-3">
        <StatPill label="Locations" value={locations.length.toLocaleString()} />
        <StatPill label="Avg manager %" value={`${avgManagerPct(locations).toFixed(1)}%`} />
        <StatPill label="Total open debt" value={fmt$(totalDebt)} />
      </section>

      <CardShell title="Locations / Area Managers" subtitle={`${locations.length} total`}>
        {locations.length === 0 ? (
          <Empty message="No locations found." />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>Default tech</th>
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
