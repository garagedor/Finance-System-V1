"use client";
// Results of one week: live standings, freeze, review (re-check against late
// CRM entries, provisional-vs-review diff) and the owner's approval. Every
// action is re-checked server-side; approval is owner-only there.
import { useCallback, useEffect, useState } from "react";
import { api, dollars, STATUS_LABEL, statusPill, weekLabel, when } from "./arena-ui";

interface Row {
  competitorId: string; displayName: string; location: string; rank: number; score: number; eligible: boolean;
  qualifyingJobs: number; assignedJobs: number; closedJobs: number; closingRate: number; avgTicket: number;
  prizePosition: number | null; prizeCents: number; wonMostImproved: boolean;
}
interface Results {
  competition: { _id: string; weekStart: string; status: string; devEarlyClose?: boolean };
  phase: string;
  window: { closesAt: string; approvalOpensAt: string };
  approvalOpen: boolean;
  devStack: boolean;
  isOwner: boolean;
  snapshot: { _id: string; kind: string; computedAt: string; eligibleCount: number; awardedCents: number; unallocatedCents: number; rows: Row[] } | null;
  blockers: string[];
  diff: { competitorId: string; displayName: string; before: { rank: number; score: number; eligible: boolean; prizeCents: number } | null; after: { rank: number; score: number; eligible: boolean; prizeCents: number } | null }[];
  approved: { approvedBy: string; approvedAt: string; note: string | null; awardedCents: number; contentHash: string; standings: Row[] } | null;
}

export default function ResultsPanel({ id, canEdit, who, onClose, onChanged }: {
  id: string; canEdit: boolean; who: (id: string) => string; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [d, setD] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setD(await api<Results>(`/api/arena/admin/competitions/${id}/results`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await load(); await onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const act = (action: string) => run(() => api(`/api/arena/admin/competitions/${id}/action`, { method: "POST", body: { action } }));
  const approve = () => run(async () => {
    if (!d?.snapshot) throw new Error("Nothing to approve");
    const note = window.prompt("Approve these winners? This is final and cannot be changed. Optional note:", "");
    if (note === null) return;
    await api(`/api/arena/admin/competitions/${id}/approve`, { method: "POST", body: { snapshotId: d.snapshot._id, note } });
  });

  if (!d) return <div className="portal-card">{error ? <span className="text-danger">{error}</span> : "Loading results…"}</div>;
  const st = d.competition.status;
  const ended = new Date() >= new Date(d.window.closesAt);
  const rows = d.approved?.standings ?? d.snapshot?.rows ?? [];
  return (
    <div className="portal-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <b>Results — {weekLabel(d.competition.weekStart)}</b>{" "}
          <span className={statusPill(st)}>{STATUS_LABEL[st] ?? st}</span>
          <div className="muted small">
            Week closes {when(d.window.closesAt)} · approval opens {when(d.window.approvalOpensAt)}
            {d.competition.devEarlyClose && " · frozen early (dev demo)"}
            {d.snapshot && <> · data as of {when(d.snapshot.computedAt)} ({d.snapshot.kind})</>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {canEdit && st === "active" && ended && <button className="portal-btn" disabled={busy} onClick={() => act("freeze")}>Freeze week</button>}
          {canEdit && d.devStack && d.isOwner && (st === "active" || st === "suspended") && !ended &&
            <button className="portal-btn" disabled={busy} onClick={() => act("freeze_now_dev")} title="Local dev stack only">Freeze now (dev)</button>}
          {canEdit && st === "provisional" && <button className="portal-btn portal-btn-primary" disabled={busy} onClick={() => act("open_review")}>Open review</button>}
          {canEdit && st === "in_review" && <button className="portal-btn" disabled={busy} onClick={() => act("reconcile")}>Re-check CRM data</button>}
          {canEdit && d.isOwner && st === "in_review" &&
            <button className="portal-btn portal-btn-primary" disabled={busy || !d.approvalOpen || d.blockers.length > 0} onClick={approve}
              title={!d.approvalOpen ? "Approval opens after the review window" : d.blockers.join("; ")}>Approve winners</button>}
          <button className="portal-btn" onClick={onClose}>Close</button>
        </div>
      </div>
      {error && <div className="portal-alert portal-alert-error" role="alert">{error}</div>}
      {st === "in_review" && !d.isOwner && <div className="muted small">Only the owner can approve winners.</div>}
      {d.blockers.length > 0 && <div className="portal-alert portal-alert-error">{d.blockers.join(" · ")}</div>}
      {d.approved && (
        <div className="portal-alert portal-alert-info">
          Approved by {who(d.approved.approvedBy)} on {when(d.approved.approvedAt)} · {dollars(d.approved.awardedCents)} awarded
          {d.approved.note ? ` · “${d.approved.note}”` : ""} · record {d.approved.contentHash.slice(0, 12)}… (immutable; no payouts are created)
        </div>
      )}
      {d.diff.length > 0 && (
        <details open>
          <summary><b>{d.diff.length} change(s) since the freeze</b></summary>
          <table className="portal-table">
            <thead><tr><th>Technician</th><th>At freeze</th><th>Now</th></tr></thead>
            <tbody>{d.diff.map((x) => (
              <tr key={x.competitorId}><td>{x.displayName}</td>
                <td>{x.before ? `#${x.before.rank} · ${x.before.score.toFixed(2)}${x.before.eligible ? " · eligible" : ""} · ${dollars(x.before.prizeCents)}` : "—"}</td>
                <td>{x.after ? `#${x.after.rank} · ${x.after.score.toFixed(2)}${x.after.eligible ? " · eligible" : ""} · ${dollars(x.after.prizeCents)}` : "—"}</td></tr>
            ))}</tbody>
          </table>
        </details>
      )}
      {d.snapshot && !d.approved && (
        <div className="muted small">{d.snapshot.eligibleCount} eligible · {dollars(d.snapshot.awardedCents)} would be awarded · {dollars(d.snapshot.unallocatedCents)} unallocated</div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="portal-table">
          <thead><tr><th>#</th><th>Technician</th><th>Location</th><th>Score</th><th>Qual. jobs</th><th>Closing</th><th>AVG ticket</th><th>Eligible</th><th>Prize</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.competitorId}>
                <td>{r.rank}</td><td>{r.displayName}</td><td>{r.location}</td><td>{r.score.toFixed(2)}</td>
                <td>{r.qualifyingJobs}</td>
                <td>{"closingRate" in r && typeof r.closingRate === "number" ? `${(r.closingRate * 100).toFixed(1)}%` : "—"}</td>
                <td>{"avgTicket" in r && typeof r.avgTicket === "number" ? dollars(Math.round(r.avgTicket * 100)) : "—"}</td>
                <td>{r.eligible ? "Yes" : "No"}</td>
                <td>{r.prizeCents ? `${dollars(r.prizeCents)}${r.prizePosition ? ` (#${r.prizePosition})` : " (most improved)"}` : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="muted">No results yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
