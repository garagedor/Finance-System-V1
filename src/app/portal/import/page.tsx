import { redirect } from "next/navigation";
import { readSession, hasAnyPermission } from "@/lib/rbac";
import { PageHeader, CardShell } from "../_components/page-helpers";
import ImportClient from "./ImportClient";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await readSession();
  if (!session) redirect("/?next=/portal/import");
  if (!hasAnyPermission(session, ["finance:expenses:create", "finance:income:create"])) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Tools" title="CSV import" />
        <div className="portal-alert portal-alert-error">
          You need permission to create expenses or income to use the importer.
        </div>
      </div>
    );
  }
  return (
    <div className="portal-page">
      <PageHeader
        kicker="Tools"
        title="CSV import"
        subtitle="Bulk-load historical expenses or income from a spreadsheet. Drag a file, map the columns, preview, then commit."
      />
      <CardShell title="Upload">
        <ImportClient />
      </CardShell>
    </div>
  );
}
