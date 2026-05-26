"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

// ── Week math ──────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Start of week (Monday) for a given date. */
function startOfWeek(d: Date): Date {
  const day = d.getUTCDay();          // 0 = Sun … 6 = Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() + diff);
  m.setUTCHours(0, 0, 0, 0);
  return m;
}

function addDays(d: Date, n: number): Date {
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() + n);
  return m;
}

/** Generate [Mon, Sun] tuples spanning `from`..`to`, inclusive. */
function weeksBetween(fromStr: string, toStr: string): Array<{ start: string; end: string }> {
  const from = startOfWeek(new Date(fromStr));
  const to = new Date(toStr);
  const out: Array<{ start: string; end: string }> = [];
  let cur = from;
  while (cur <= to) {
    const end = addDays(cur, 6);
    out.push({ start: isoDate(cur), end: isoDate(end) });
    cur = addDays(cur, 7);
  }
  return out;
}

// ── Component ──────────────────────────────────────────────────────────────

interface StatsBucket {
  key: string;
  count: number;
  totalAmount?: number;
  totalPaid?: number;
}

interface Progress {
  weeksDone: number;
  weeksTotal: number;
  currentWeek: string;
  techReportsCreated: number;
  amReportsCreated: number;
  skipped: number;
  errors: number;
  log: string[];
}

const empty: Progress = {
  weeksDone: 0,
  weeksTotal: 0,
  currentWeek: "",
  techReportsCreated: 0,
  amReportsCreated: 0,
  skipped: 0,
  errors: 0,
  log: [],
};

export default function ImportHistoricalButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [progress, setProgress] = useState<Progress>(empty);

  // Defaults: last 90 days, snapped to weeks
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 90);
    return isoDate(startOfWeek(d));
  });
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [includeTech, setIncludeTech] = useState(true);
  const [includeAM, setIncludeAM] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const log = (line: string) =>
    setProgress((p) => ({ ...p, log: [...p.log.slice(-200), line] }));

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setCancelRequested(false);
    setProgress({ ...empty });

    const weeks = weeksBetween(from, to);
    setProgress((p) => ({ ...p, weeksTotal: weeks.length }));
    log(`Starting: ${weeks.length} week(s) from ${from} to ${to}`);

    // 1. Fetch existing reports for dedup
    const existingKeys = new Set<string>();
    if (skipDuplicates) {
      try {
        const r = await fetch("/api/portal/reports?limit=1000");
        const j = await r.json();
        for (const row of j.rows ?? []) {
          existingKeys.add(`${row.type}::${row.subject_name ?? ""}::${row.period_start}::${row.period_end}`);
        }
        log(`Loaded ${existingKeys.size} existing report(s) for dedup`);
      } catch (e) {
        log(`⚠ Failed to load existing reports: ${(e as Error).message}`);
      }
    }

    for (let i = 0; i < weeks.length; i++) {
      if (cancelRequested) {
        log("Cancelled by user.");
        break;
      }
      const w = weeks[i];
      setProgress((p) => ({ ...p, currentWeek: `${w.start} → ${w.end}` }));

      try {
        // Discover who was active this week via /api/stats
        const statsRes = await fetch(`/api/stats?startDate=${w.start}&endDate=${w.end}`);
        if (!statsRes.ok) {
          log(`⚠ Week ${w.start}: stats fetch failed (${statsRes.status})`);
          setProgress((p) => ({ ...p, errors: p.errors + 1 }));
          continue;
        }
        const stats = await statsRes.json();
        const techs: StatsBucket[] = stats.byTech ?? [];
        const locations: StatsBucket[] = stats.byLocation ?? [];
        const activeTechs = techs.filter((t) => t.count > 0).map((t) => t.key);
        const activeLocs = locations.filter((l) => l.count > 0).map((l) => l.key);

        log(`Week ${w.start} → ${w.end}: ${activeTechs.length} techs, ${activeLocs.length} locations`);

        // Tech reports
        if (includeTech) {
          for (const tech of activeTechs) {
            if (cancelRequested) break;
            const key = `tech_report::${tech}::${w.start}::${w.end}`;
            if (existingKeys.has(key)) {
              setProgress((p) => ({ ...p, skipped: p.skipped + 1 }));
              continue;
            }
            try {
              const balRes = await fetch(
                `/api/balance-report?tech=${encodeURIComponent(tech)}&mode=tech&startDate=${w.start}&endDate=${w.end}`
              );
              if (!balRes.ok) {
                setProgress((p) => ({ ...p, errors: p.errors + 1 }));
                continue;
              }
              const snapshot = await balRes.json();
              const saveRes = await fetch("/api/portal/reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "tech_report",
                  title: `Tech Report · ${tech} · ${w.start} → ${w.end}`,
                  subject_name: tech,
                  period_start: w.start,
                  period_end: w.end,
                  snapshot,
                  status: "unpaid",
                }),
              });
              if (saveRes.ok) {
                existingKeys.add(key);
                setProgress((p) => ({ ...p, techReportsCreated: p.techReportsCreated + 1 }));
              } else {
                setProgress((p) => ({ ...p, errors: p.errors + 1 }));
              }
            } catch {
              setProgress((p) => ({ ...p, errors: p.errors + 1 }));
            }
          }
        }

        // AM reports (per location)
        if (includeAM) {
          for (const loc of activeLocs) {
            if (cancelRequested) break;
            const key = `area_manager_report::${loc}::${w.start}::${w.end}`;
            if (existingKeys.has(key)) {
              setProgress((p) => ({ ...p, skipped: p.skipped + 1 }));
              continue;
            }
            try {
              const balRes = await fetch(
                `/api/balance-report?tech=${encodeURIComponent(loc)}&mode=location&startDate=${w.start}&endDate=${w.end}`
              );
              if (!balRes.ok) {
                setProgress((p) => ({ ...p, errors: p.errors + 1 }));
                continue;
              }
              const snapshot = await balRes.json();
              const saveRes = await fetch("/api/portal/reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "area_manager_report",
                  title: `Area Manager Report · ${loc} · ${w.start} → ${w.end}`,
                  subject_name: loc,
                  period_start: w.start,
                  period_end: w.end,
                  snapshot,
                  status: "unpaid",
                }),
              });
              if (saveRes.ok) {
                existingKeys.add(key);
                setProgress((p) => ({ ...p, amReportsCreated: p.amReportsCreated + 1 }));
              } else {
                setProgress((p) => ({ ...p, errors: p.errors + 1 }));
              }
            } catch {
              setProgress((p) => ({ ...p, errors: p.errors + 1 }));
            }
          }
        }

        setProgress((p) => ({ ...p, weeksDone: i + 1 }));
      } catch (err) {
        log(`✗ Week ${w.start} error: ${(err as Error).message}`);
        setProgress((p) => ({ ...p, errors: p.errors + 1 }));
      }
    }

    setRunning(false);
    log(
      `Done. Tech reports: ${progress.techReportsCreated} · AM reports: ${progress.amReportsCreated} · skipped: ${progress.skipped} · errors: ${progress.errors}`
    );
    router.refresh();
  };

  const pctDone = progress.weeksTotal > 0
    ? Math.round((progress.weeksDone / progress.weeksTotal) * 100)
    : 0;

  return (
    <>
      <button className="portal-btn" onClick={() => setOpen(true)}>
        ↓ Import from CRM
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 100, paddingTop: 40, paddingBottom: 40, overflowY: "auto",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !running) setOpen(false);
          }}
        >
          <div
            style={{
              background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14,
              padding: 24, width: "min(720px, 95vw)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                Import historical balance reports
              </h2>
              {!running && (
                <button onClick={() => setOpen(false)} className="portal-btn portal-btn-ghost"
                  style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
              )}
            </div>

            <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
              Iterates Monday-Sunday weeks in the range. For each week, scans the CRM for active techs and
              locations, then saves a Tech Report and Area Manager Report per active subject — same data
              shape as the CRM&apos;s balance-report screen.
            </p>

            <form onSubmit={run}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label className="portal-label">From</label>
                  <input type="date" className="portal-input" required disabled={running}
                    value={from} onChange={(e) => setFrom(e.target.value)} />
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                    Snapped to start of week (Monday)
                  </div>
                </div>
                <div>
                  <label className="portal-label">To</label>
                  <input type="date" className="portal-input" required disabled={running}
                    value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={includeTech} onChange={(e) => setIncludeTech(e.target.checked)} disabled={running} />
                  <span>Generate Tech Reports (per tech × week)</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={includeAM} onChange={(e) => setIncludeAM(e.target.checked)} disabled={running} />
                  <span>Generate Area Manager Reports (per location × week)</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} disabled={running} />
                  <span>Skip if already saved (idempotent re-import)</span>
                </label>
              </div>

              {(running || progress.weeksTotal > 0) && (
                <div
                  style={{
                    background: "rgba(99, 102, 241, 0.06)",
                    border: "1px solid rgba(99, 102, 241, 0.2)",
                    borderRadius: 10,
                    padding: 14,
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: "#cbd5e1", fontWeight: 600 }}>
                      Week {progress.weeksDone} / {progress.weeksTotal} ({pctDone}%)
                    </span>
                    <span className="mono" style={{ color: "#94a3b8" }}>{progress.currentWeek}</span>
                  </div>
                  <div className="portal-bar" style={{ height: 8 }}>
                    <div
                      className="portal-bar-fill"
                      style={{ width: `${pctDone}%`, transition: "width 200ms" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 12, flexWrap: "wrap" }}>
                    <span style={{ color: "#10b981" }}>
                      <strong>+{progress.techReportsCreated}</strong> tech reports
                    </span>
                    <span style={{ color: "#10b981" }}>
                      <strong>+{progress.amReportsCreated}</strong> AM reports
                    </span>
                    <span style={{ color: "#94a3b8" }}>
                      <strong>{progress.skipped}</strong> skipped
                    </span>
                    {progress.errors > 0 && (
                      <span style={{ color: "#f87171" }}>
                        <strong>{progress.errors}</strong> errors
                      </span>
                    )}
                  </div>

                  {progress.log.length > 0 && (
                    <details style={{ marginTop: 12 }}>
                      <summary style={{ fontSize: 11, color: "#64748b", cursor: "pointer" }}>
                        Activity log ({progress.log.length})
                      </summary>
                      <pre
                        style={{
                          marginTop: 8,
                          padding: 10,
                          background: "#0a0f1c",
                          borderRadius: 6,
                          fontSize: 10.5,
                          color: "#cbd5e1",
                          maxHeight: 220,
                          overflowY: "auto",
                          fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
                        }}
                      >
                        {progress.log.join("\n")}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                {running ? (
                  <button
                    type="button"
                    className="portal-btn portal-btn-danger"
                    onClick={() => setCancelRequested(true)}
                  >
                    Cancel
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="portal-btn portal-btn-ghost"
                      onClick={() => setOpen(false)}
                    >
                      Close
                    </button>
                    <button type="submit" className="portal-btn portal-btn-primary">
                      {progress.weeksTotal > 0 ? "Run again" : "Start import"}
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
