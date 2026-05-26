import { fetchTechnicians } from "@/lib/portal-people";
import { fmt$, fmtDate } from "../format";
import { PageHeader, StatPill, CardShell, Empty } from "../_components/page-helpers";

export const dynamic = "force-dynamic";

export default async function TechniciansPage() {
  const techs = await fetchTechnicians();
  const totalDebt = techs.reduce((s, t) => s + t.totalDebt, 0);
  const withOpenDebt = techs.filter((t) => t.openDebts > 0).length;

  return (
    <div className="portal-page">
      <PageHeader
        kicker="People"
        title="Technicians"
        subtitle="From CRM Technician collection, augmented with portal debts & payouts."
      />

      <section className="portal-grid-3">
        <StatPill label="Total technicians" value={techs.length.toLocaleString()} />
        <StatPill label="With open debts" value={withOpenDebt.toLocaleString()} />
        <StatPill label="Total open debt" value={fmt$(totalDebt)} />
      </section>

      <CardShell title="Roster" subtitle={`${techs.length} technicians`}>
        {techs.length === 0 ? (
          <Empty message="No technicians found in CRM." />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Area / Location</th>
                <th className="right">Profit %</th>
                <th className="right">Open debts</th>
                <th className="right">Debt amount</th>
                <th>Last payout</th>
                <th className="right">Payouts</th>
              </tr>
            </thead>
            <tbody>
              {techs
                .slice()
                .sort((a, b) => String(a._id).localeCompare(String(b._id)))
                .map((t) => (
                  <tr key={String(t._id)}>
                    <td><strong>{String(t._id)}</strong></td>
                    <td className="muted small">{t.location ?? "—"}</td>
                    <td className="right small">
                      {t.profitPercent !== undefined ? `${t.profitPercent}%` : "—"}
                    </td>
                    <td className="right">{t.openDebts || ""}</td>
                    <td className={`right money ${t.totalDebt > 0 ? "money-neg" : "money-zero"}`}>
                      {fmt$(t.totalDebt)}
                    </td>
                    <td className="muted small mono">{t.lastPayout ? fmtDate(t.lastPayout) : "—"}</td>
                    <td className="right muted small">{t.payoutsCount || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </CardShell>
    </div>
  );
}
