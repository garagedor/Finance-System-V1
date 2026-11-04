import { readSession } from "@/lib/rbac";
import { isStatsXlsxOwner } from "@/lib/stats-owner";
import { PageHeader } from "../_components/page-helpers";
import ScanpayActionsClient from "./ScanpayActionsClient";

export const dynamic = "force-dynamic";

// Create invoices, link invoices, mark paid and refund — in ScanPay, from the
// CRM. Owner account only; every action is confirmed and logged.
export default async function ScanpayActionsPage() {
  const s = await readSession();
  if (!isStatsXlsxOwner(s)) {
    return <div className="portal-page"><div className="portal-alert portal-alert-error">Restricted.</div></div>;
  }
  return (
    <div className="portal-page">
      <PageHeader
        kicker="ScanPay"
        title="ScanPay actions"
        subtitle="Create & send invoices, link invoices to jobs, mark paid, refund — every action is confirmed and logged"
      />
      <ScanpayActionsClient />
    </div>
  );
}
