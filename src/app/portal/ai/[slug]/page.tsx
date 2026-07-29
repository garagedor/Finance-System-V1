import { notFound } from "next/navigation";
import { PageHeader, CardShell } from "../../_components/page-helpers";
import ChatPanel from "../ChatPanel";
import { getExecutive } from "../executives";
import { aiSession, engineReady } from "../access";
import { EngineBanner, RestrictedNotice } from "../parts";
import { getAlerts } from "@/lib/ai/brief";
import AlertFeed, { type FeedAlert } from "../AlertFeed";

export const dynamic = "force-dynamic";

export default async function ExecutiveDesk({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const exec = getExecutive(slug);
  if (!exec) notFound();

  const s = await aiSession();
  if (!s) return <RestrictedNotice />;
  const ready = engineReady();
  const Icon = exec.icon;
  const alerts = await getAlerts({ executive: exec.slug, status: "open", limit: 30 }).catch(() => []);

  return (
    <>
      <PageHeader
        kicker={exec.role}
        title={exec.name}
        subtitle={exec.tagline}
        actions={
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              display: "grid",
              placeItems: "center",
              background: `${exec.accent}22`,
              color: exec.accent,
            }}
          >
            <Icon size={20} />
          </span>
        }
      />
      {!ready && <EngineBanner />}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(240px, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <ChatPanel
          enabled={ready}
          executiveSlug={exec.slug}
          title={exec.name}
          greeting={exec.greeting}
          starters={exec.starters}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <CardShell title={`🚨 What I've flagged${alerts.length ? ` (${alerts.length})` : ""}`}>
            <div style={{ padding: 12 }}>
              <AlertFeed
                alerts={alerts as unknown as FeedAlert[]}
                emptyMessage={ready ? "Nothing flagged right now." : "Connect the engine to start monitoring."}
              />
            </div>
          </CardShell>
          <CardShell title="👀 What I'm watching">
            <ul
              style={{
                margin: 0,
                padding: "12px 18px 16px 32px",
                color: "#94a3b8",
                fontSize: 12.5,
                lineHeight: 1.9,
              }}
            >
              {exec.watches.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </CardShell>
          <CardShell title="🗂 Desks I run">
            <div style={{ padding: "12px 16px 16px", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {exec.owns.map((o) => (
                <span key={o} className="pill pill-draft">
                  {o}
                </span>
              ))}
            </div>
          </CardShell>
        </div>
      </div>
    </>
  );
}
