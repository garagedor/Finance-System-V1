"use client";

// "Add CRM Balance Report" → posts to /api/portal/ledger/[id]/crm-report,
// which pulls the real Balance Report and saves it as one ledger entry.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function AddCrmReportModal({
  ledgerId,
  defaultSubject,
  defaultMode,
}: {
  ledgerId: string;
  defaultSubject: string;
  defaultMode: "tech" | "location";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"tech" | "location">(defaultMode);
  const [subject, setSubject] = useState(defaultSubject);
  const [start, setStart] = useState(firstOfMonth());
  const [end, setEnd] = useState(today());
  const [includeTips, setIncludeTips] = useState(false);
  const [techs, setTechs] = useState<Array<{ name: string; location: string | null }>>([]);

  // Pull the technician list (with locations) when the modal opens — used to
  // suggest technicians and to roll up "all techs in a location".
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/portal/ledger/tech-rates")
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setTechs(Array.isArray(j.rows) ? j.rows : []); })
      .catch(() => { if (!cancelled) setTechs([]); });
    return () => { cancelled = true; };
  }, [open]);

  const locations = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of techs) {
      const loc = (t.location ?? "").trim();
      if (loc) counts.set(loc, (counts.get(loc) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [techs]);

  const locMatch = useMemo(
    () => locations.find((l) => l.name.toLowerCase() === subject.trim().toLowerCase()),
    [locations, subject],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/portal/ledger/${ledgerId}/crm-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          subject_name: subject,
          period_start: start,
          period_end: end,
          include_tips: includeTips,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="portal-btn" onClick={() => setOpen(true)}>
        + Add CRM report
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 100, paddingTop: 60, overflowY: "auto",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{
              background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14,
              padding: 24, width: "min(560px, 95vw)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>Add CRM Balance Report</h2>
              <button onClick={() => setOpen(false)} className="portal-btn portal-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>
            <p className="muted small" style={{ marginTop: 0, marginBottom: 16 }}>
              Pulls the live Balance Report and posts its closed-jobs balance as one ledger entry.
            </p>

            <form onSubmit={onSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <label className="portal-label">Report type *</label>
                  <select className="portal-select" value={mode}
                    onChange={(e) => setMode(e.target.value as "tech" | "location")} required>
                    <option value="tech">Tech Report</option>
                    <option value="location">Location Report</option>
                  </select>
                </div>
                <div>
                  <label className="portal-label">
                    {mode === "tech" ? "Technician *" : "Location / Area *"}
                  </label>
                  <input className="portal-input" required value={subject}
                    list={mode === "tech" ? "crm-tech-list" : "crm-loc-list"}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={mode === "tech" ? "e.g. Yuval" : "e.g. Minnesota"} />
                  <datalist id="crm-tech-list">
                    {techs.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}{t.location ? ` · ${t.location}` : ""}
                      </option>
                    ))}
                  </datalist>
                  <datalist id="crm-loc-list">
                    {locations.map((l) => (
                      <option key={l.name} value={l.name}>{l.name} ({l.count} techs)</option>
                    ))}
                  </datalist>
                  {mode === "location" && (
                    <div className="muted small" style={{ marginTop: 4 }}>
                      Rolls up every technician in this area
                      {locMatch ? ` · ${locMatch.count} tech(s) found` : ""}.
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div>
                  <label className="portal-label">Period start *</label>
                  <input type="date" className="portal-input" required value={start}
                    onChange={(e) => setStart(e.target.value)} />
                </div>
                <div>
                  <label className="portal-label">Period end *</label>
                  <input type="date" className="portal-input" required value={end}
                    onChange={(e) => setEnd(e.target.value)} />
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13, color: "#94a3b8" }}>
                <input type="checkbox" checked={includeTips}
                  onChange={(e) => setIncludeTips(e.target.checked)}
                  style={{ width: 16, height: 16 }} />
                Post <strong>Balance + Tips</strong> instead of Balance (folds Net Tip into the entry)
              </label>

              {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="portal-btn portal-btn-primary" disabled={busy}>
                  {busy ? "Pulling report…" : "Pull & add entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
