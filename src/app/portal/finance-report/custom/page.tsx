// Custom itemized report builder page.

import { PageHeader, BackLink } from "../../_components/page-helpers";
import CustomReportBuilder from "./CustomReportBuilder";

export const dynamic = "force-dynamic";

export default function CustomReportPage() {
  return (
    <div className="portal-page">
      <div style={{ marginBottom: 8 }}>
        <BackLink href="/portal/finance-report" label="Financial Report" />
      </div>
      <PageHeader
        kicker="Money"
        title="Custom Report"
        subtitle="Cherry-pick specific items — ledger lines, provider jobs, payouts, penalties, disputes/refunds, expenses, income — over a date range, then export one PDF grouped by category with subtotals and a grand total."
      />
      <CustomReportBuilder />
    </div>
  );
}
