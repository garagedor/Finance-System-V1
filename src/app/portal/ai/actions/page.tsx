import { PageHeader, CardShell, Empty } from "../../_components/page-helpers";
import { aiSession } from "../access";
import { RestrictedNotice } from "../parts";

export const dynamic = "force-dynamic";

export default async function ActionCenter() {
  const s = await aiSession();
  if (!s) return <RestrictedNotice />;

  return (
    <>
      <PageHeader
        kicker="AI Workspace"
        title="Action Center"
        subtitle="When the AI wants to act, it proposes here — you Approve, Reject, or Modify before anything runs."
      />
      <CardShell title="Pending actions">
        <Empty message="No pending actions. When the executive team recommends something it can execute — a ledger entry, a payout, a categorization — it will appear here with its full reasoning for your approval. (This goes live after the database credentials are secured.)" />
      </CardShell>
    </>
  );
}
