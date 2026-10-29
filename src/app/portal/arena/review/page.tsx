import { readSession, hasPermission } from "@/lib/rbac";
import { BackLink, PageHeader } from "../../_components/page-helpers";
import ReviewQueue from "./ReviewQueue";

export const dynamic = "force-dynamic";

export default async function ArenaReviewPage() {
  const session = await readSession();
  const allowed = hasPermission(session, "arena:console:view");
  return (
    <div className="portal-page">
      <BackLink href="/portal/arena" label="Arena Control Center" />
      <PageHeader
        kicker="317 Live Arena"
        title="Data review"
        subtitle="Suspected duplicate jobs, CRM names without a verified person, and missing English display names. Decisions here never change a CRM job or any financial number."
      />
      {allowed ? (
        <ReviewQueue />
      ) : (
        <div className="portal-alert portal-alert-warn" style={{ maxWidth: 560 }}>
          <strong>Restricted.</strong> Your account doesn&apos;t have access to the Arena review queue.
        </div>
      )}
    </div>
  );
}
