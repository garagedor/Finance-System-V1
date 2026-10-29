import { readSession, hasPermission } from "@/lib/rbac";
import { PageHeader } from "../_components/page-helpers";
import ArenaConsole from "./ArenaConsole";

export const dynamic = "force-dynamic";

export default async function ArenaPage() {
  // Checked on the server: the portal layout's own check is client-side only.
  const session = await readSession();
  const allowed = hasPermission(session, "arena:console:view");
  return (
    <div className="portal-page">
      <PageHeader
        kicker="317 Live Arena"
        title="Admin Control Center"
        subtitle="Competition weeks, rules, templates, owner settings and the audit log. Technicians can't see any of this."
      />
      {allowed ? (
        <ArenaConsole />
      ) : (
        <div className="portal-alert portal-alert-warn" style={{ maxWidth: 560 }}>
          <strong>Restricted.</strong> Your account doesn&apos;t have access to the Arena Control Center.
        </div>
      )}
    </div>
  );
}
