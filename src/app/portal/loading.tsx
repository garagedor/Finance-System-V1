// Instant loading skeleton for every /portal page. App Router renders this the
// moment you navigate — before the server component finishes fetching — so pages
// feel responsive despite the Frankfurt<->US round-trip. The sidebar/shell stays
// mounted; only this content area shows the shimmer.
const block = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
  ...extra,
});

export default function PortalLoading() {
  return (
    <div className="animate-pulse" style={{ padding: 24 }} aria-busy="true" aria-label="Loading">
      {/* Page title */}
      <div style={{ ...block(), height: 26, width: 220, borderRadius: 8, marginBottom: 8, border: 'none' }} />
      <div style={{ ...block(), height: 13, width: 320, borderRadius: 6, marginBottom: 24, border: 'none', background: 'rgba(255,255,255,0.035)' }} />

      {/* KPI cards row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={block({ height: 96 })} />
        ))}
      </div>

      {/* Main content panel */}
      <div style={block({ height: 340, background: 'rgba(255,255,255,0.03)' })} />
    </div>
  );
}
