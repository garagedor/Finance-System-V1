import { PageHeader } from "../../_components/page-helpers";
import ChatPanel from "../ChatPanel";
import { aiSession, engineReady } from "../access";
import { EngineBanner, RestrictedNotice } from "../parts";

export const dynamic = "force-dynamic";

export default async function AskTheTeam() {
  const s = await aiSession();
  if (!s) return <RestrictedNotice />;
  const ready = engineReady();

  return (
    <>
      <PageHeader
        kicker="AI Workspace"
        title="Ask the Team"
        subtitle="Ask anything about the business — the right executive pulls the numbers and answers."
      />
      {!ready && <EngineBanner />}
      <ChatPanel
        enabled={ready}
        title="the team"
        greeting="Ask anything about finance, jobs, technicians, locations, banking, or reports. I'll pull the real numbers and answer."
        starters={[
          "How much money can I safely spend today?",
          "Which location is underperforming this month, and why?",
          "Who owes us money right now?",
          "Did we pay any supplier twice recently?",
        ]}
      />
    </>
  );
}
