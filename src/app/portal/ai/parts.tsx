// Small shared pieces for the AI Workspace pages.

export function EngineBanner() {
  return (
    <div
      className="portal-card"
      style={{
        padding: "12px 16px",
        marginBottom: 16,
        borderColor: "rgba(245,158,11,0.35)",
        background: "rgba(245,158,11,0.08)",
        fontSize: 13,
        color: "#fcd9a3",
      }}
    >
      <strong>🔌 Engine not connected.</strong> Add <code className="mono">ANTHROPIC_API_KEY</code> to{" "}
      <code className="mono">.env.local</code> and restart the dev server to bring the executive team online.
    </div>
  );
}

export function RestrictedNotice() {
  return (
    <div className="portal-card" style={{ padding: 22 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Restricted</div>
      <p className="portal-subtitle" style={{ marginTop: 0 }}>
        You need the &ldquo;View AI Workspace&rdquo; permission to access this area.
      </p>
    </div>
  );
}
