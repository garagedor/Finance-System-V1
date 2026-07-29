import { PageHeader } from "../../_components/page-helpers";
import { aiSession } from "../access";
import { RestrictedNotice } from "../parts";
import VoiceSettings from "./VoiceSettings";

export const dynamic = "force-dynamic";

export default async function VoiceSettingsPage() {
  const s = await aiSession();
  if (!s) return <RestrictedNotice />;
  const canManage = s.type === "admin" || s.permissions.includes("system:ai:manage");

  return (
    <>
      <PageHeader
        kicker="AI Workspace"
        title="Voice"
        subtitle="Choose and tune the executive assistant's spoken voice. A premium, natural, male voice by default — with the device voice as a free fallback. The provider key stays server-side."
      />
      <VoiceSettings canManage={canManage} />
    </>
  );
}
