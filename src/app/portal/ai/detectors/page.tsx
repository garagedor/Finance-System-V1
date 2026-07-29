import { PageHeader, CardShell } from "../../_components/page-helpers";
import { aiSession } from "../access";
import { RestrictedNotice } from "../parts";
import { ALL_DETECTORS } from "@/lib/ai/monitors/registry";
import { getAllDetectorConfig, type DetectorConfigMap } from "@/lib/ai/monitors/config";
import type { DetectorCategory } from "@/lib/ai/monitors/framework";
import DetectorToggle from "../DetectorToggle";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<DetectorCategory, string> = {
  finance: "💰 Finance",
  technicians: "👷 Technicians",
  area_managers: "🗺 Area Managers",
  customers: "👥 Customers",
  operations: "⚙️ Operations",
  inventory: "📦 Inventory",
  strategy: "🧭 Strategy",
};

const SEV_COLOR: Record<string, string> = { high: "#f87171", medium: "#f59e0b", low: "#60a5fa", info: "#94a3b8" };

export default async function DetectorsPage() {
  const s = await aiSession();
  if (!s) return <RestrictedNotice />;

  const cfg: DetectorConfigMap = await getAllDetectorConfig().catch(() => ({}));
  const cats = [...new Set(ALL_DETECTORS.map((d) => d.category))];
  const enabledCount = ALL_DETECTORS.filter((d) => cfg[d.id]?.enabled ?? d.enabledByDefault).length;

  return (
    <>
      <PageHeader
        kicker="AI Workspace"
        title="Detectors"
        subtitle={`The proactive intelligence framework — ${enabledCount} of ${ALL_DETECTORS.length} monitors active. Each runs in isolation; add a detector definition and it appears here automatically.`}
      />

      {cats.map((cat) => {
        const list = ALL_DETECTORS.filter((d) => d.category === cat);
        return (
          <div key={cat} style={{ marginBottom: 16 }}>
            <CardShell title={CATEGORY_LABEL[cat] ?? cat}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {list.map((d, i) => {
                  const enabled = cfg[d.id]?.enabled ?? d.enabledByDefault;
                  const sc = SEV_COLOR[d.defaultSeverity] ?? "#94a3b8";
                  return (
                    <div
                      key={d.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "13px 16px",
                        borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: "#e2e8f0" }}>{d.title}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: sc, letterSpacing: 0.4 }}>
                            {d.defaultSeverity.toUpperCase()}
                          </span>
                          <span style={{ fontSize: 10.5, color: "#64748b" }}>{d.executives.join(" · ")}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{d.description}</div>
                        <div style={{ fontSize: 10.5, color: "#475569", marginTop: 3, fontFamily: "monospace" }}>{d.id}</div>
                      </div>
                      <DetectorToggle id={d.id} enabled={enabled} />
                    </div>
                  );
                })}
              </div>
            </CardShell>
          </div>
        );
      })}

      <p className="portal-subtitle" style={{ marginTop: 4 }}>
        Coverage grows gradually across Finance, Technicians, Area Managers, Customers, Operations, Inventory (when that
        module exists) and Strategy — each new detector is just a definition, no engine changes.
      </p>
    </>
  );
}
