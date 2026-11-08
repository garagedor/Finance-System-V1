"use client";
// Results of one week: live standings, freeze, review (re-check against late
// CRM entries, provisional-vs-review diff) and the owner's approval. Every
// action is re-checked server-side; approval is owner-only there.
import { useCallback, useEffect, useState } from "react";
import { api, BETA_LABEL, dollars, STATUS_LABEL, statusPill, weekLabel, when } from "./arena-ui";

interface Row {
  competitorId: string; displayName: string; location: string; rank: number; score: number; eligible: boolean;
  qualifyingJobs: number; assignedJobs: number; closedJobs: number; closingRate: number; avgTicket: number;
  prizePosition: number | null; prizeCents: number; wonMostImproved: boolean;
  prizeEligible?: boolean;
  closingScore?: number; avgScore?: number; limitingMetric?: string | null;
  account?: { state: string; reason: string; checkedAt: string | null; lastKnown: boolean } | null;
}
type Side = { rank: number; score: number; eligible: boolean; account?: string | null; prizeEligible?: boolean; prizeCents: number };
const side = (x: Side | null) =>
  x ? `#${x.rank} · ${x.score.toFixed(2)}${x.eligible ? " · gates met" : ""}${x.account && x.account !== "eligible" ? ` · account ${x.account.replace(/_/g, " ")}` : ""} · ${dollars(x.prizeCents)}` : "—";

/** Account column: who may hold a prize, and why not (admin only). */
function AccountCell({ r, live }: { r: Row; live: boolean }) {
  const a = r.account;
  if (!a) return <span className="muted">not checked</span>;
  if (a.state === "eligible")
    return <span title={a.checkedAt ? `checked ${when(a.checkedAt)}` : undefined}>OK{a.lastKnown ? <span className="muted small"> (last known)</span> : null}</span>;
  const tone = a.state === "unverified" ? "pill pill-pending" : "pill pill-unpaid";
  return (
    <span className={tone} title={`${a.reason}${a.checkedAt ? ` · checked ${when(a.checkedAt)}` : ""}${a.lastKnown ? " · last known" : ""}`}>
      {a.state === "unverified" ? "Unverified" : "Not prize-eligible"}: {a.reason}{live || a.lastKnown ? " (provisional)" : ""}
    </span>
  );
}
interface JobChange { jobId: string; kind: string; week: string; techBefore: string | null; techAfter: string | null; before: string | null; after: string | null; detail: string; detectedAt: string; crmUpdatedAt: string | null }
interface ImpactSide { rank: number; score: number; prizePosition: number | null; prizeCents: number; wonMostImproved: boolean; assignedJobs: number; closedJobs: number; qualifyingJobs: number; eligible: boolean }
interface LateReport {
  against: { snapshotId: string; readAt: string }; read: { readAt: string }; detectedAt: string; changes: JobChange[];
  impact: { material: boolean; reasons: string[]; rows: { competitorId: string; displayName: string; before: ImpactSide | null; after: ImpactSide | null; material: boolean; why: string[] }[] };
  updateTimestampField: string | null;
}
interface LateDecision { choice: "keep_freeze" | "accept_correction"; reason: string; by: string; at: string; carriedFrom?: string }
const KIND: Record<string, string> = {
  removed: "Job removed", redated_out: "Re-dated out of the week", redated_in: "Re-dated into the week", reassigned: "Re-assigned",
  status: "Status edited", profit: "Profit edited", location: "Location edited", date: "Re-dated (same week)", added: "Job added",
};
const impactSide = (x: ImpactSide | null) =>
  x ? `#${x.rank} · ${x.score.toFixed(2)} · ${x.assignedJobs}/${x.closedJobs}/${x.qualifyingJobs} · ${x.prizePosition !== null ? `prize #${x.prizePosition} ${dollars(x.prizeCents)}` : x.wonMostImproved ? `Most Improved ${dollars(x.prizeCents)}` : "no prize"}` : "—";

/** Per-job change list and its effect on prizes (admin only). */
function LateChanges({ r, title, sides = ["Freeze job set", "Corrected CRM"] }: { r: LateReport; title: string; sides?: [string, string] }) {
  return (
    <details open data-testid="arena-late-changes">
      <summary><b>{title}: {r.changes.length} job change(s)</b>{r.impact.material ? <span className="pill pill-unpaid" style={{ marginLeft: 8 }}>Affects prizes</span> : <span className="muted small"> · no effect on prizes</span>}</summary>
      <div className="muted small" style={{ margin: "4px 0" }}>
        Compared with the snapshot read {when(r.against.readAt)} · re-read {when(r.read.readAt)} ·{" "}
        {r.updateTimestampField ? `CRM edit times from “${r.updateTimestampField}”` : "the CRM does not record when a job was edited: times shown are when the Arena detected the change"}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="portal-table">
          <thead><tr><th>Change</th><th>Job</th><th>Technician</th><th>Before</th><th>After</th><th>Detected</th></tr></thead>
          <tbody>{r.changes.map((c) => (
            <tr key={`${c.jobId}-${c.kind}`}>
              <td title={c.detail}>{KIND[c.kind] ?? c.kind}{c.week === "baseline" ? <span className="muted small"> (baseline week)</span> : null}</td>
              <td className="small"><code>{c.jobId.slice(-8)}</code></td>
              <td>{c.techBefore ?? "—"}{c.techAfter !== null && c.techAfter !== c.techBefore ? ` → ${c.techAfter || "(nobody)"}` : ""}</td>
              <td>{c.before ?? "—"}</td><td>{c.after ?? "—"}</td>
              <td className="small">{when(c.detectedAt)}{c.crmUpdatedAt ? <div className="muted">edited {when(c.crmUpdatedAt)}</div> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {r.impact.rows.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 6 }}>
          <table className="portal-table">
            <thead><tr><th>Technician</th><th>{sides[0]}</th><th>{sides[1]}</th><th>Effect</th></tr></thead>
            <tbody>{r.impact.rows.map((x) => (
              <tr key={x.competitorId}><td>{x.displayName}</td><td>{impactSide(x.before)}</td><td>{impactSide(x.after)}</td>
                <td className={x.material ? "text-danger" : "muted"}>{x.material ? x.why.join(", ") : "no prize effect"}</td></tr>
            ))}</tbody>
          </table>
          <div className="muted small">Rank · score · assigned/closed/qualifying · prize — same review decisions on both sides, only the CRM job edits differ.</div>
        </div>
      )}
    </details>
  );
}

interface Results {
  competition: { _id: string; weekStart: string; status: string; devEarlyClose?: boolean; beta?: boolean };
  methodology?: "WEIGHTED_V0" | "BALANCED_PERFORMANCE_V1";
  /** Absent on older servers = qualifying. */
  jobCountBasis?: "assigned" | "qualifying";
  /** LIVE BETA test week (absent = false). */
  beta?: boolean;
  phase: string;
  window: { closesAt: string; approvalOpensAt: string };
  approvalOpen: boolean;
  devStack: boolean;
  isOwner: boolean;
  snapshot: { _id: string; kind: string; computedAt: string; eligibleCount: number; awardedCents: number; unallocatedCents: number; rows: Row[] } | null;
  blockers: string[];
  diff: { competitorId: string; displayName: string; before: Side | null; after: Side | null }[];
  approved: { approvedBy: string; approvedAt: string; note: string | null; awardedCents: number; contentHash: string; standings: Row[] } | null;
  lateChanges?: LateReport | null;
  lateDecision?: LateDecision | null;
  basis?: "read" | "freeze_jobs" | null;
  source?: { readAt: string; jobs: number; jobsHash: string; inputHash: string; identity: { user: string | null; database: string; collection: string }; updateField: string | null } | null;
  lateCorrections?: { _id: string; detectedAt: string; approvedContentHash: string; report: LateReport }[];
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
  const decideLate = (choice: "keep_freeze" | "accept_correction") => run(async () => {
    if (!d?.snapshot) throw new Error("Nothing to decide");
    const label = choice === "keep_freeze" ? "KEEP THE FREEZE SNAPSHOT (ignore these CRM edits for this week)" : "ACCEPT THE CORRECTION (use the corrected CRM data)";
    const reason = window.prompt(`${label}\n\nReason (required, kept in the audit log):`, "");
    if (reason === null) return;
    await api(`/api/arena/admin/competitions/${id}/action`, { method: "POST", body: { action: "late_decision", snapshotId: d.snapshot._id, choice, reason } });
  });
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
  const excluded = rows.filter((r) => r.eligible && r.account && r.account.state !== "eligible");
  const live = !d.approved && d.snapshot?.kind === "live";
  const v1 = d.methodology === "BALANCED_PERFORMANCE_V1";
  const beta = d.beta === true || d.competition.beta === true;
  const assignedBasis = d.jobCountBasis === "assigned";
  return (
    <div className="portal-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <b>Results — {weekLabel(d.competition.weekStart)}</b>{" "}
          <span className={statusPill(st)}>{STATUS_LABEL[st] ?? st}</span>
          {beta && <span className="pill pill-pending" style={{ marginLeft: 6 }} data-testid="arena-results-beta-pill">BETA</span>}
          <div className="muted small">
            Week closes {when(d.window.closesAt)} · approval opens {when(d.window.approvalOpensAt)}
            {d.competition.devEarlyClose && " · frozen early (dev demo)"}
            {d.snapshot && <> · data as of {when(d.snapshot.computedAt)} ({d.snapshot.kind})</>}
            {" · "}<span data-testid="arena-results-methodology">{v1 ? "Balanced Performance (V1): final = min(C, A)" : "Weighted (V0)"}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {canEdit && st === "active" && ended && <button className="portal-btn" disabled={busy} onClick={() => act("freeze")}>Freeze week</button>}
          {canEdit && d.devStack && d.isOwner && (st === "active" || st === "suspended") && !ended &&
            <button className="portal-btn" disabled={busy} onClick={() => act("freeze_now_dev")} title="Local dev stack only">Freeze now (dev)</button>}
          {canEdit && st === "provisional" && <button className="portal-btn portal-btn-primary" disabled={busy} onClick={() => act("open_review")}>Open review</button>}
          {canEdit && st === "in_review" && <button className="portal-btn" disabled={busy} onClick={() => act("reconcile")}>Re-check CRM data</button>}
          {canEdit && st === "approved" && <button className="portal-btn" disabled={busy} onClick={() => act("late_check")} title="Re-read the CRM and log any change since approval. The approved result never changes.">Check CRM for late corrections</button>}
          {canEdit && d.isOwner && st === "in_review" && beta &&
            <button className="portal-btn" disabled title="A LIVE BETA test week can never be approved as official" data-testid="arena-approve-beta-disabled">Approve winners (not available in LIVE BETA)</button>}
          {canEdit && d.isOwner && st === "in_review" && !beta &&
            <button className="portal-btn portal-btn-primary" disabled={busy || !d.approvalOpen || d.blockers.length > 0} onClick={approve}
              title={!d.approvalOpen ? "Approval opens after the review window" : d.blockers.join("; ")}>Approve winners</button>}
          <button className="portal-btn" onClick={onClose}>Close</button>
        </div>
      </div>
      {beta && (
        <div className="portal-alert portal-alert-warn" role="status" data-testid="arena-results-beta">
          <div>
            <b>{BETA_LABEL}</b>
            <div className="small">Real CRM data, computed, frozen and reviewed like any week — but it can never be approved as official. Every prize shown is projected (beta, no payout). Technicians see the same banner and get no celebrations.</div>
          </div>
        </div>
      )}
      {error && <div className="portal-alert portal-alert-error" role="alert">{error}</div>}
      {st === "in_review" && !d.isOwner && !beta && <div className="muted small">Only the owner can approve winners.</div>}
      {(() => {
        // The late-change blocker has its own panel (with the owner's choice) below.
        const lateBlock = !!d.lateChanges?.impact.material && !d.lateDecision;
        const other = d.blockers.filter((b) => !(lateBlock && b.startsWith("CRM jobs changed after the freeze")));
        return other.length > 0 && <div className="portal-alert portal-alert-error">{other.join(" · ")}</div>;
      })()}
      {d.approved && (
        <div className="portal-alert portal-alert-info">
          Approved by {who(d.approved.approvedBy)} on {when(d.approved.approvedAt)} · {dollars(d.approved.awardedCents)} awarded
          {d.approved.note ? ` · “${d.approved.note}”` : ""} · record {d.approved.contentHash.slice(0, 12)}… (immutable; no payouts are created)
        </div>
      )}
      {d.source && (
        <div className="muted small" data-testid="arena-source">
          Source snapshot: {d.source.jobs} CRM jobs read {when(d.source.readAt)} as {d.source.identity.user ?? "the app connection"} ({d.source.identity.database}.{d.source.identity.collection}) · input {d.source.inputHash.slice(0, 12)}…
        </div>
      )}
      {d.lateChanges && !d.approved && (
        <>
          {d.lateChanges.impact.material && !d.lateDecision && (
            <div className="portal-alert portal-alert-error" data-testid="arena-late-block" role="alert">
              <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                <b>Approval blocked — CRM jobs changed after the freeze and this changes prizes.</b>
                <ul style={{ margin: "0 0 0 18px" }}>{d.lateChanges.impact.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
                <div className="small">Keep freeze snapshot = score the week on the jobs stored at the freeze. Accept correction = use the corrected CRM data. A reason is required; nothing is paid either way.</div>
                {d.isOwner && canEdit ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="portal-btn" disabled={busy} onClick={() => decideLate("keep_freeze")} data-testid="arena-late-keep">Keep freeze snapshot</button>
                    <button className="portal-btn" disabled={busy} onClick={() => decideLate("accept_correction")} data-testid="arena-late-accept">Accept correction</button>
                  </div>
                ) : <div className="small">Only the owner can choose: keep the freeze snapshot, or accept the correction (with a reason).</div>}
              </div>
            </div>
          )}
          {d.lateDecision && (
            <div className="portal-alert portal-alert-info" data-testid="arena-late-decision">
              <div>
                Owner decision on late CRM changes: <b>{d.lateDecision.choice === "keep_freeze" ? "Keep freeze snapshot" : "Accept correction"}</b> — “{d.lateDecision.reason}” ({who(d.lateDecision.by)}, {when(d.lateDecision.at)}).
                {" "}The results below use the {d.basis === "freeze_jobs" ? "job set stored at the freeze" : "corrected CRM data"}.
              </div>
            </div>
          )}
          {d.lateChanges.changes.length > 0 && <LateChanges r={d.lateChanges} title="CRM changes since the freeze" />}
        </>
      )}
      {d.approved && (d.lateCorrections ?? []).map((x) => (
        <div key={x._id} className="portal-alert portal-alert-warn" data-testid="arena-late-correction">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", minWidth: 0 }}>
            <div>
              <b>Late correction after approval</b> — detected {when(x.detectedAt)}{x.report.impact.material ? `: ${x.report.impact.reasons.join("; ")}` : " (no prize effect)"}.
              {" "}The approved result (record {x.approvedContentHash.slice(0, 12)}…) is unchanged; handle this manually. No payout or ledger entry exists or is created.
            </div>
            <LateChanges r={x.report} title="Changes since the approved snapshot" sides={["Approved snapshot", "CRM now"]} />
          </div>
        </div>
      ))}
      {d.diff.length > 0 && (
        <details open>
          <summary><b>{d.diff.length} change(s) since the freeze</b></summary>
          <table className="portal-table">
            <thead><tr><th>Technician</th><th>At freeze</th><th>Now</th></tr></thead>
            <tbody>{d.diff.map((x) => (
              <tr key={x.competitorId}><td>{x.displayName}</td>
                <td>{side(x.before)}</td>
                <td>{side(x.after)}</td></tr>
            ))}</tbody>
          </table>
        </details>
      )}
      {d.snapshot && !d.approved && (
        <div className="muted small">{d.snapshot.eligibleCount} met all gates · {dollars(d.snapshot.awardedCents)} {beta ? "projected (beta, no payout)" : "would be awarded"} · {dollars(d.snapshot.unallocatedCents)} unallocated
          {d.snapshot.kind === "live" && " · account checks are provisional while the week runs; the final check is at freeze, review and approval"}</div>
      )}
      {excluded.length > 0 && (
        <div className="portal-alert portal-alert-warn" data-testid="arena-account-excluded">
          <b>Account eligibility</b> — {excluded.length} competitor(s) who met the gates cannot hold a prize right now; prizes go to the next fully eligible competitors:
          <ul style={{ margin: "4px 0 0 18px" }}>
            {excluded.map((r) => <li key={r.competitorId}>#{r.rank} {r.displayName} — {r.account?.reason ?? "not checked"}{r.account?.state === "unverified" ? " (unresolved: not disqualified, blocks approval)" : ""}</li>)}
          </ul>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="portal-table">
          <thead><tr><th>#</th><th>Technician</th><th>Location</th>{v1 && <><th title="100 × closing rate ÷ target (capped)">C</th><th title="100 × AVG ticket ÷ target (capped)">A</th><th>Limiting</th></>}<th>{v1 ? "Final (min)" : "Score"}</th><th title={assignedBasis ? "Every assigned job in the week, any status, minus approved exclusions" : "Jobs with a qualifying status, minus approved exclusions"}>{assignedBasis ? "Assigned jobs (counted)" : "Qual. jobs"}</th><th>Closing</th><th>AVG ticket</th><th>Gates</th><th>Account</th><th>{beta ? "Projected prize (beta, no payout)" : "Prize"}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.competitorId}>
                <td>{r.rank}</td><td>{r.displayName}</td><td>{r.location}</td>
                {v1 && <><td className={r.limitingMetric === "closingRate" || r.limitingMetric === "both" ? "text-danger" : undefined}>{r.closingScore?.toFixed(2) ?? "—"}</td>
                  <td className={r.limitingMetric === "avgTicket" || r.limitingMetric === "both" ? "text-danger" : undefined}>{r.avgScore?.toFixed(2) ?? "—"}</td>
                  <td>{r.limitingMetric === "closingRate" ? "Closing rate" : r.limitingMetric === "avgTicket" ? "AVG ticket" : r.limitingMetric === "both" ? "Both" : "—"}</td></>}
                <td>{r.score.toFixed(2)}</td>
                <td>{r.qualifyingJobs}</td>
                <td>{"closingRate" in r && typeof r.closingRate === "number" ? `${(r.closingRate * 100).toFixed(1)}%` : "—"}</td>
                <td>{"avgTicket" in r && typeof r.avgTicket === "number" ? dollars(Math.round(r.avgTicket * 100)) : "—"}</td>
                <td>{r.eligible ? "All met" : "No"}</td>
                <td><AccountCell r={r} live={live} /></td>
                <td>{r.prizeCents ? `${dollars(r.prizeCents)}${r.prizePosition ? ` (#${r.prizePosition})` : " (most improved)"}` : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={v1 ? 13 : 10} className="muted">No results yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
