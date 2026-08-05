"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Job = { _id: string; date: string | null; address: string | null; clientName: string | null; tech: string | null; location: string | null; collected: number };

const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ScanpayRowActions({
  id, matchStatus, suggestedJobId, suggestedLabel, amount,
}: {
  id: string;
  matchStatus: string;
  suggestedJobId: string | null;
  suggestedLabel: string | null;
  amount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);

  const act = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/portal/scanpay/${encodeURIComponent(id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setPicking(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [id, router]);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/dispute-charge/jobs?q=${encodeURIComponent(q.trim())}`);
      const j = await r.json();
      setJobs(Array.isArray(j.jobs) ? j.jobs : []);
    } catch { setJobs([]); } finally { setLoading(false); }
  }, [q]);

  useEffect(() => {
    if (!picking) return;
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [picking, q, search]);

  if (matchStatus === "posted") {
    return <span className="muted small">✓ posted</span>;
  }
  if (matchStatus === "ignored") {
    return (
      <button className="portal-btn" style={{ padding: "4px 10px", fontSize: 11 }} disabled={busy}
        onClick={() => act({ action: "reopen" })}>Restore</button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
      {err && <span className="small" style={{ color: "#f87171", flexBasis: "100%", textAlign: "right" }}>{err}</span>}
      {suggestedJobId && (
        <button className="portal-btn portal-btn-primary" style={{ padding: "4px 10px", fontSize: 11 }} disabled={busy}
          title={suggestedLabel ?? undefined} onClick={() => act({ action: "confirm", jobId: suggestedJobId })}>
          Confirm & post
        </button>
      )}
      <button className="portal-btn" style={{ padding: "4px 10px", fontSize: 11 }} disabled={busy}
        onClick={() => setPicking(true)}>Pick job</button>
      <button className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} disabled={busy}
        onClick={() => act({ action: "ignore" })}>Ignore</button>

      {picking && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 50, overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) setPicking(false); }}
        >
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 20, width: "min(720px, 96vw)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: "#f1f5f9" }}>Match to job · post {money(amount)}</h3>
              <button className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setPicking(false)}>✕</button>
            </div>
            <input className="portal-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search job by address / customer / tech" onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
            <div style={{ maxHeight: 340, overflowY: "auto", marginTop: 10, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
              {jobs.length === 0 ? (
                <div className="muted small" style={{ padding: 14, textAlign: "center" }}>{loading ? "Searching…" : "Type to search."}</div>
              ) : (
                <table className="portal-table" style={{ margin: 0 }}>
                  <thead><tr><th>Date</th><th>Address</th><th>Tech</th><th className="right">Collected</th><th></th></tr></thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j._id}>
                        <td className="small mono">{j.date ?? "—"}</td>
                        <td>{j.address ?? "—"}<div className="muted small">{j.clientName ?? ""}</div></td>
                        <td className="small">{j.tech ?? "—"}</td>
                        <td className="right money">{money(j.collected)}</td>
                        <td className="right">
                          <button className="portal-btn portal-btn-primary" style={{ padding: "3px 8px", fontSize: 11 }} disabled={busy}
                            onClick={() => act({ action: "confirm", jobId: j._id })}>Post</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
