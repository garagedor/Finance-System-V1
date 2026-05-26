import { fetchProviders } from "@/lib/portal-people";
import { fmt$ } from "../format";
import { PageHeader, StatPill, CardShell, Empty } from "../_components/page-helpers";

export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  const providers = await fetchProviders();
  const totalDebt = providers.reduce((s, p) => s + p.totalDebt, 0);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="People"
        title="Providers"
        subtitle="Advertisers / referral partners. From CRM Provider collection."
      />

      <section className="portal-grid-2">
        <StatPill label="Total providers" value={providers.length.toLocaleString()} />
        <StatPill label="Total open debt" value={fmt$(totalDebt)} />
      </section>

      <CardShell title="Providers" subtitle={`${providers.length} total`}>
        {providers.length === 0 ? (
          <Empty message="No providers found." />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Name / ID</th>
                <th>Initials</th>
                <th className="right">Profit %</th>
                <th className="right">Open debts</th>
                <th className="right">Debt amount</th>
              </tr>
            </thead>
            <tbody>
              {providers
                .slice()
                .sort((a, b) => String(a._id).localeCompare(String(b._id)))
                .map((p) => (
                  <tr key={String(p._id)}>
                    <td><strong>{String(p._id)}</strong></td>
                    <td className="muted small">{p.initials ?? "—"}</td>
                    <td className="right small">
                      {p.profitPercent !== undefined ? `${p.profitPercent}%` : "—"}
                    </td>
                    <td className="right">{p.openDebts || ""}</td>
                    <td className={`right money ${p.totalDebt > 0 ? "money-neg" : "money-zero"}`}>
                      {fmt$(p.totalDebt)}
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
