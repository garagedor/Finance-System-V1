// Accountant Financial Report builder page. Filters + section toggles live in
// the client island; all data comes from /api/portal/finance-report and the
// PDF from /api/finance-report/pdf (both gated by readPortalSession).

import Link from "next/link";
import { PageHeader } from "../_components/page-helpers";
import FinanceReportBuilder from "./FinanceReportBuilder";

export const dynamic = "force-dynamic";

export default function FinanceReportPage() {
  return (
    <div className="portal-page">
      <PageHeader
        kicker="Money"
        title="Financial Report"
        subtitle="Build a report from every part of the system — pick a period, tick as many sections as you want (or one-click the full system report), then export one branded PDF for your accountant."
        actions={<Link href="/portal/finance-report/custom" className="portal-btn">🧾 Custom itemized report →</Link>}
      />
      <FinanceReportBuilder />
    </div>
  );
}
