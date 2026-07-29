import Link from "next/link";
import { PageHeader, CardShell } from "../_components/page-helpers";
import { EXECUTIVES } from "./executives";
import { aiSession, engineReady } from "./access";
import { EngineBanner, RestrictedNotice } from "./parts";
import { getAlerts, getLatestBrief } from "@/lib/ai/brief";
import type { BriefSection } from "@/lib/ai/monitors/types";
import AlertFeed, { type FeedAlert } from "./AlertFeed";
import RunBriefButton from "./RunBriefButton";

export const dynamic = "force-dynamic";

function SectionList({ emoji, title, items }: { emoji: string; title: string; items: BriefSection[] }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
        {emoji} {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {items.map((it, i) => (
          <div key={i} style={{ borderLeft: "2px solid rgba(99,102,241,0.4)", paddingLeft: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{it.title}</div>
            {it.detail && <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.5 }}>{it.detail}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function AiCommandCenter() {
  const s = await aiSession();
  if (!s) return <RestrictedNotice />;
  const ready = engineReady();

  const [brief, alerts] = await Promise.all([
    getLatestBrief().catch(() => null),
    getAlerts({ status: "open", limit: 50 }).catch(() => []),
  ]);

  return (
    <>
      <PageHeader
        kicker="AI Workspace"
        title="Command Center"
        subtitle="Your AI executive team — watching the business around the clock."
        actions={ready ? <RunBriefButton /> : undefined}
      />
      {!ready && <EngineBanner />}

      <CardShell
        title="☀️ Morning Brief"
        subtitle={brief ? `Generated ${new Date(brief.generatedAt).toLocaleString()}` : "Not generated yet"}
      >
        <div style={{ padding: 18 }}>
          {brief ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", lineHeight: 1.5 }}>{brief.headline}</div>
              {brief.overnight.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>🌙 What changed overnight</div>
                  <ul style={{ margin: 0, paddingLeft: 18, color: "#94a3b8", fontSize: 12.5, lineHeight: 1.8 }}>
                    {brief.overnight.map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                </div>
              )}
              <SectionList emoji="⚠️" title="Needs your attention" items={brief.attention} />
              <SectionList emoji="🧭" title="Decisions to make today" items={brief.decisions} />
              <SectionList emoji="⛰" title="Risks" items={brief.risks} />
              <SectionList emoji="🚀" title="Opportunities" items={brief.opportunities} />
              <SectionList emoji="✅" title="Do first" items={brief.doFirst} />
            </>
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 13.5, lineHeight: 1.7 }}>
              Each morning your executive team briefs you here: what changed overnight, what needs attention, what to
              decide, and what to do first.
              <div style={{ marginTop: 12 }}>
                {ready ? <RunBriefButton label="Generate the first brief" /> : "Connect the engine to activate the daily brief."}
              </div>
            </div>
          )}
        </div>
      </CardShell>

      <div style={{ marginTop: 18 }}>
        <CardShell title="🚨 AI Alerts" subtitle={`${alerts.length} open`}>
          <div style={{ padding: 14 }}>
            <AlertFeed
              alerts={alerts as unknown as FeedAlert[]}
              emptyMessage={ready ? "No open alerts. Run the brief to scan for issues." : "Connect the engine to start monitoring."}
            />
          </div>
        </CardShell>
      </div>

      <section style={{ marginTop: 18 }}>
        <div className="portal-kicker" style={{ marginBottom: 10 }}>Your executive team</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: 14 }}>
          {EXECUTIVES.map((e) => {
            const Icon = e.icon;
            const count = (alerts as FeedAlert[]).filter((a) => a.executives?.includes(e.slug)).length;
            return (
              <Link key={e.slug} href={`/portal/ai/${e.slug}`} className="portal-card" style={{ padding: 16, textDecoration: "none", display: "block" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 10 }}>
                  <span style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: `${e.accent}22`, color: e.accent, flexShrink: 0 }}>
                    <Icon size={18} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 14 }}>{e.name}</div>
                    <div style={{ fontSize: 11.5, color: "#64748b" }}>{e.role}</div>
                  </div>
                  {count > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.15)", borderRadius: 20, padding: "2px 8px" }}>
                      {count}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.5 }}>{e.tagline}</div>
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}
