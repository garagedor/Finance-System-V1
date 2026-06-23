import { getTechRates } from "@/lib/portal-tech-rates";
import { PageHeader, CardShell, BackLink } from "../../_components/page-helpers";
import TechRatesTable from "./TechRatesTable";

export const dynamic = "force-dynamic";

export default async function TechRatesPage() {
  const rates = await getTechRates();
  const overrides = rates.filter((r) => r.override_pct != null).length;

  return (
    <div className="portal-page">
      <div style={{ marginBottom: 8 }}>
        <BackLink href="/portal/ledger" label="All ledgers" />
      </div>

      <PageHeader
        kicker="Ledger · Configuration"
        title="Technician Dispute / Refund Rates"
        subtitle="Default rate = the CRM profit %. Set an override only for special agreements that differ."
      />

      <CardShell
        title="Rates"
        subtitle={`${rates.length} technicians · ${overrides} override(s)`}
      >
        <TechRatesTable initial={rates} />
      </CardShell>

      <p className="muted small" style={{ marginTop: 4 }}>
        These rates pre-fill the dispute/refund calculator on a ledger. You can still override the %
        on an individual entry.
      </p>
    </div>
  );
}
