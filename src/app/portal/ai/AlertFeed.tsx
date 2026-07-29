// Renders priority-ranked proactive alerts (server component — data passed in).

export type FeedAlert = {
  _id: string;
  priority?: number;
  severity: string;
  title: string;
  detail: string;
  metric?: string;
  financialImpact?: number;
  confidence?: number;
  estimatedEffort?: string;
  recommendedAction?: string;
  category?: string;
  executives?: string[];
  date: string;
};

function prioColor(p: number): string {
  if (p >= 80) return "#f87171";
  if (p >= 60) return "#f59e0b";
  if (p >= 40) return "#60a5fa";
  return "#94a3b8";
}

export default function AlertFeed({ alerts, emptyMessage }: { alerts: FeedAlert[]; emptyMessage: string }) {
  if (!alerts.length) return <div className="portal-empty">{emptyMessage}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px" }}>
      {alerts.map((a) => {
        const p = a.priority ?? 0;
        const c = prioColor(p);
        const facts: string[] = [];
        if (a.financialImpact != null && a.financialImpact > 0)
          facts.push(`Exposure ${a.metric ?? "$" + a.financialImpact.toLocaleString("en-US")}`);
        if (a.confidence != null) facts.push(`Confidence ${Math.round(a.confidence * 100)}%`);
        if (a.estimatedEffort) facts.push(`Fix ${a.estimatedEffort}`);
        return (
          <div
            key={a._id}
            style={{ display: "flex", gap: 11, background: `${c}0f`, border: `1px solid ${c}33`, borderRadius: 11, padding: "11px 13px" }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 42,
                height: 42,
                borderRadius: 10,
                display: "grid",
                placeItems: "center",
                background: `${c}22`,
                color: c,
                fontWeight: 800,
                fontSize: 15,
                lineHeight: 1,
              }}
              title={`Priority ${p}/100`}
            >
              {p}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{a.title}</span>
                {a.metric && a.financialImpact == null && (
                  <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, color: c }}>{a.metric}</span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.5, marginTop: 2 }}>{a.detail}</div>
              {facts.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {facts.map((f) => (
                    <span key={f} style={{ fontSize: 11, color: "#cbd5e1", background: "rgba(255,255,255,0.05)", borderRadius: 6, padding: "2px 7px" }}>
                      {f}
                    </span>
                  ))}
                </div>
              )}
              {a.recommendedAction && (
                <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 6 }}>
                  <strong style={{ color: "#a5b4fc" }}>→ </strong>
                  {a.recommendedAction}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
