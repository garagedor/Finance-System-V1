// Accountant Financial Report builder page. Filters + section toggles live in
// the client island; all data comes from /api/portal/finance-report and the
// PDF from /api/finance-report/pdf (both gated by readPortalSession).

import { PageHeader } from "../_components/page-helpers";
import FinanceReportBuilder from "./FinanceReportBuilder";

export const dynamic = "force-dynamic";

export default function FinanceReportPage() {
  return (
    <div className="portal-page">
      <PageHeader
        kicker="Money"
        title="Financial Report"
        subtitle="Build a full financial picture for your accountant — filter the period and scope, choose which sections appear, then export a branded PDF."
      />
      <FinanceReportBuilder />
    </div>
  );
}
