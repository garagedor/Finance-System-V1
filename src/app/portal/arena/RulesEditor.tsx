"use client";

// Edits every configurable Arena rule in plain units (dollars, percent) and
// stores them exactly as the engine reads them (integer cents, basis points).
// The week cycle, timezone and KPI formulas are fixed and shown, not edited.

import { useState } from "react";
import type { ArenaRules, TieBreakKey } from "@/lib/arena/types";
import { KNOWN_STATUSES } from "@/lib/status-canonical";
import { ApiError, api, dollars, lastCompletedMonday, weekLabel } from "./arena-ui";
import type { PreviewSummary } from "@/lib/arena/admin-service";

const TIE_LABEL: Record<TieBreakKey, string> = {
  closingRate: "Higher closing rate", avgTicket: "Higher AVG ticket", qualifyingJobs: "More qualifying jobs", closedJobs: "More closed jobs",
};
const ALL_TIES: TieBreakKey[] = ["closingRate", "avgTicket", "qualifyingJobs", "closedJobs"];

const toCents = (s: string) => Math.round(Number(s) * 100);
const toBp = (s: string) => Math.round(Number(s) * 100);
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function Num({ label, value, onChange, step = "1", suffix, prefix, hint }: {
  label: string; value: string | number; onChange: (v: string) => void; step?: string; suffix?: string; prefix?: string; hint?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span className="portal-label">{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {prefix && <span className="muted">{prefix}</span>}
        <input className="portal-input" type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }}
          aria-label={label} />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

export default function RulesEditor({
  initial, title, saveLabel, onSave, onCancel, needsReason, extra,
}: {
  initial: ArenaRules;
  title: string;
  saveLabel: string;
  onSave: (rules: ArenaRules, reason: string) => Promise<void>;
  onCancel: () => void;
  /** Mid-week amendments need a reason that participants will see. */
  needsReason?: boolean;
  extra?: React.ReactNode;
}) {
  const [r, setR] = useState<ArenaRules>(() => structuredClone(initial));
  const [reason, setReason] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewWeek, setPreviewWeek] = useState(lastCompletedMonday());
  const [preview, setPreview] = useState<PreviewSummary | null>(null);

  const set = (fn: (x: ArenaRules) => void) => setR((cur) => { const n = structuredClone(cur); fn(n); return n; });
  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setProblems(e instanceof ApiError ? e.problems : []);
  };

  const maxPayout = r.prizes.positionsCents.reduce((s, c) => s + c, 0) + (r.mostImproved.enabled ? r.mostImproved.amountCents : 0);

  async function save() {
    setBusy(true); setError(null); setProblems([]);
    try { await onSave(r, reason); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function runPreview() {
    setBusy(true); setError(null); setProblems([]); setPreview(null);
    try { setPreview(await api<PreviewSummary>("/api/arena/admin/preview", { method: "POST", body: { rules: r, weekStart: previewWeek } })); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }

  return (
    <div className="portal-card" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
        <span className="muted small">Week runs Monday 00:00 to Sunday 23:59:59, {r.timezone} (fixed). CR and AVG ticket are the official CRM numbers (fixed).</span>
      </div>
      {extra}

      <section>
        <div className="portal-section-label">Eligibility · all three required</div>
        <div className="portal-grid-3">
          <Num label="Minimum qualifying jobs" value={r.eligibility.minQualifyingJobs} onChange={(v) => set((x) => { x.eligibility.minQualifyingJobs = Math.round(Number(v)); })} />
          <Num label="Minimum AVG ticket" prefix="$" step="0.01" value={r.eligibility.minAvgTicketCents / 100} onChange={(v) => set((x) => { x.eligibility.minAvgTicketCents = toCents(v); })} />
          <Num label="Minimum closing rate" suffix="%" step="0.01" value={r.eligibility.minClosingRateBp / 100} onChange={(v) => set((x) => { x.eligibility.minClosingRateBp = toBp(v); })} />
        </div>
      </section>

      <section>
        <div className="portal-section-label">Score</div>
        <div className="portal-grid-3">
          <Num label="Closing rate weight" suffix="pts" value={r.scoring.closingRate.weight} onChange={(v) => set((x) => { x.scoring.closingRate.weight = Number(v); })} />
          <Num label="Closing rate target" suffix="%" step="0.01" value={r.scoring.closingRate.targetBp / 100} onChange={(v) => set((x) => { x.scoring.closingRate.targetBp = toBp(v); })} />
          <Num label="Closing rate cap" suffix="× target" step="0.05" value={r.scoring.closingRate.cap} onChange={(v) => set((x) => { x.scoring.closingRate.cap = Number(v); })} />
          <Num label="AVG ticket weight" suffix="pts" value={r.scoring.avgTicket.weight} onChange={(v) => set((x) => { x.scoring.avgTicket.weight = Number(v); })} />
          <Num label="AVG ticket target" prefix="$" step="0.01" value={r.scoring.avgTicket.targetCents / 100} onChange={(v) => set((x) => { x.scoring.avgTicket.targetCents = toCents(v); })} />
          <Num label="AVG ticket cap" suffix="× target" step="0.05" value={r.scoring.avgTicket.cap} onChange={(v) => set((x) => { x.scoring.avgTicket.cap = Number(v); })} />
        </div>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          Maximum score {(r.scoring.closingRate.weight * r.scoring.closingRate.cap + r.scoring.avgTicket.weight * r.scoring.avgTicket.cap).toFixed(1)} points.
        </p>
      </section>

      <section>
        <div className="portal-section-label">Prizes</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          {r.prizes.positionsCents.map((c, i) => (
            <div key={i} style={{ width: 120 }}>
              <Num label={`#${i + 1}`} prefix="$" step="0.01" value={c / 100} onChange={(v) => set((x) => { x.prizes.positionsCents[i] = toCents(v); })} />
            </div>
          ))}
          <button type="button" className="portal-btn" onClick={() => set((x) => { x.prizes.positionsCents.push(5_000); })}>Add position</button>
          {r.prizes.positionsCents.length > 1 && (
            <button type="button" className="portal-btn portal-btn-ghost" onClick={() => set((x) => { x.prizes.positionsCents.pop(); })}>Remove last</button>
          )}
        </div>
        <div className="portal-grid-3" style={{ marginTop: 10 }}>
          <Num label="Weekly budget" prefix="$" step="0.01" value={r.prizes.budgetCents / 100} onChange={(v) => set((x) => { x.prizes.budgetCents = toCents(v); })} hint="Can't exceed the owner's ceiling." />
        </div>
        <p className="small" style={{ margin: "6px 0 0", color: maxPayout > r.prizes.budgetCents ? "var(--ds-crit-text)" : undefined }}>
          Most this week can pay: {dollars(maxPayout)} of {dollars(r.prizes.budgetCents)} budget.
        </p>
      </section>

      <section>
        <div className="portal-section-label">Most Improved</div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input type="checkbox" checked={r.mostImproved.enabled} onChange={(e) => set((x) => { x.mostImproved.enabled = e.target.checked; })} />
          Award Most Improved this week
        </label>
        {r.mostImproved.enabled && (
          <div className="portal-grid-3">
            <Num label="Amount" prefix="$" step="0.01" value={r.mostImproved.amountCents / 100} onChange={(v) => set((x) => { x.mostImproved.amountCents = toCents(v); })} />
            <Num label="Baseline weeks" value={r.mostImproved.baselineWeeks} onChange={(v) => set((x) => { x.mostImproved.baselineWeeks = Math.round(Number(v)); })} />
            <Num label="Valid baseline weeks needed" value={r.mostImproved.minValidWeeks} onChange={(v) => set((x) => { x.mostImproved.minValidWeeks = Math.round(Number(v)); })} />
            <Num label="Qualifying jobs for a valid week" value={r.mostImproved.minQualifyingJobsPerWeek} onChange={(v) => set((x) => { x.mostImproved.minQualifyingJobsPerWeek = Math.round(Number(v)); })} />
            <Num label="Must improve by more than" suffix="pts" step="0.1" value={r.mostImproved.minImprovement} onChange={(v) => set((x) => { x.mostImproved.minImprovement = Number(v); })} />
          </div>
        )}
      </section>

      <section>
        <div className="portal-section-label">Statuses that count as qualifying jobs</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
          {KNOWN_STATUSES.map((s) => (
            <label key={s} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={r.qualifying.statuses.includes(s)}
                onChange={(e) => set((x) => {
                  x.qualifying.statuses = e.target.checked ? [...x.qualifying.statuses, s] : x.qualifying.statuses.filter((y) => y !== s);
                })}
              />
              {s}
            </label>
          ))}
        </div>
        <p className="muted small" style={{ margin: "6px 0 0" }}>This changes only the qualifying-job count. Closing rate and AVG ticket always use every assigned job.</p>
      </section>

      <section>
        <div className="portal-section-label">Participants</div>
        <div className="portal-grid-2">
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Leave out these locations (comma-separated)</span>
            <input className="portal-input" value={r.participants.excludeLocations.join(", ")} onChange={(e) => set((x) => { x.participants.excludeLocations = list(e.target.value); })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Leave out these technician accounts (ids, comma-separated)</span>
            <input className="portal-input" value={r.participants.excludeCompetitorIds.join(", ")} onChange={(e) => set((x) => { x.participants.excludeCompetitorIds = list(e.target.value); })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Only these technician accounts (empty = everyone verified)</span>
            <input className="portal-input" value={r.participants.onlyCompetitorIds.join(", ")} onChange={(e) => set((x) => { x.participants.onlyCompetitorIds = list(e.target.value); })} />
          </label>
        </div>
        <p className="muted small" style={{ margin: "6px 0 0" }}>Only people with a verified identity ever compete. English display names are set in the review queue.</p>
      </section>

      <section>
        <div className="portal-section-label">Ties, after score (in order)</div>
        <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          {r.tieBreak.map((k, i) => (
            <li key={k}>
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                {TIE_LABEL[k]}
                <button type="button" className="portal-btn portal-btn-ghost" disabled={i === 0} aria-label={`Move ${TIE_LABEL[k]} up`}
                  onClick={() => set((x) => { [x.tieBreak[i - 1], x.tieBreak[i]] = [x.tieBreak[i], x.tieBreak[i - 1]]; })}>↑</button>
                <button type="button" className="portal-btn portal-btn-ghost" aria-label={`Remove ${TIE_LABEL[k]}`}
                  onClick={() => set((x) => { x.tieBreak = x.tieBreak.filter((y) => y !== k); })}>Remove</button>
              </span>
            </li>
          ))}
        </ol>
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          {ALL_TIES.filter((k) => !r.tieBreak.includes(k)).map((k) => (
            <button key={k} type="button" className="portal-btn" onClick={() => set((x) => { x.tieBreak.push(k); })}>Add: {TIE_LABEL[k]}</button>
          ))}
        </div>
        <p className="muted small" style={{ margin: "6px 0 0" }}>A tie still unbroken after these is settled by account id, so the order is always stable.</p>
      </section>

      <section>
        <div className="portal-section-label">Results review</div>
        <div className="portal-grid-3">
          <Num label="Approval opens, days after the week ends" value={r.review.approvalOpensDaysAfterWeekEnd} onChange={(v) => set((x) => { x.review.approvalOpensDaysAfterWeekEnd = Math.round(Number(v)); })} hint="1 = Tuesday" />
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">At (ET, 24-hour)</span>
            <input className="portal-input" type="time" value={r.review.approvalOpensLocalTime} onChange={(e) => set((x) => { x.review.approvalOpensLocalTime = e.target.value; })} />
          </label>
        </div>
      </section>

      <section>
        <div className="portal-section-label">What technicians see</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
          {([["showPotentialPrize", "Potential prize"], ["showIneligibleMetrics", "Numbers of not-yet-qualified technicians"], ["showPodium", "Top-3 podium"]] as const).map(([k, label]) => (
            <label key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={r.display[k]} onChange={(e) => set((x) => { x.display[k] = e.target.checked; })} />
              {label}
            </label>
          ))}
        </div>
        <div className="portal-grid-3" style={{ marginTop: 8 }}>
          <Num label="Leaderboard refresh" suffix="seconds" value={r.display.refreshSeconds} onChange={(v) => set((x) => { x.display.refreshSeconds = Math.round(Number(v)); })} />
        </div>
      </section>

      <section style={{ borderTop: "1px solid var(--ds-line)", paddingTop: 14 }}>
        <div className="portal-section-label">Preview on a real past week (read-only)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Week starting (Monday)</span>
            <input className="portal-input" type="date" value={previewWeek} onChange={(e) => setPreviewWeek(e.target.value)} />
          </label>
          <button type="button" className="portal-btn" disabled={busy} onClick={runPreview}>Preview these rules</button>
        </div>
        {preview && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0 }}>
              Week of {weekLabel(preview.weekStart)}: <b>{preview.eligible}</b> of {preview.participants} technicians would qualify,
              paying <b>{dollars(preview.paidCents)}</b> of {dollars(preview.budgetCents)} ({dollars(preview.unallocatedCents)} unallocated).
            </p>
            <table className="portal-table">
              <thead><tr><th>Place</th><th>Technician</th><th>Location</th><th style={{ textAlign: "right" }}>Score</th><th style={{ textAlign: "right" }}>Prize</th></tr></thead>
              <tbody>
                {preview.prizes.map((p) => (
                  <tr key={p.position}><td>#{p.position}</td><td>{p.name}</td><td>{p.location}</td><td style={{ textAlign: "right" }}>{p.score.toFixed(2)}</td><td style={{ textAlign: "right" }}>{dollars(p.cents)}</td></tr>
                ))}
                {preview.mostImproved && (
                  <tr><td>Most Improved</td><td>{preview.mostImproved.name}</td><td /><td style={{ textAlign: "right" }}>+{preview.mostImproved.improvement.toFixed(2)}</td><td style={{ textAlign: "right" }}>{dollars(preview.mostImproved.cents)}</td></tr>
                )}
              </tbody>
            </table>
            {preview.keptOut.length > 0 && (
              <p className="muted small" style={{ margin: 0 }}>
                Scored higher but not qualified: {preview.keptOut.map((k) => `${k.name} (missing ${k.missing.join(", ")})`).join("; ")}.
              </p>
            )}
            {(preview.blockingDuplicates > 0 || preview.unmappedNamesWithJobs.length > 0) && (
              <div className="portal-alert portal-alert-warn">
                {preview.blockingDuplicates > 0 && <div>{preview.blockingDuplicates} suspected duplicate group(s) could change this result.</div>}
                {preview.unmappedNamesWithJobs.length > 0 && (
                  <div>Jobs under names with no verified identity: {preview.unmappedNamesWithJobs.map((u) => `${u.crmName} (${u.jobs})`).join(", ")}.</div>
                )}
                <div>Resolve these in the review queue.</div>
              </div>
            )}
          </div>
        )}
      </section>

      {needsReason && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="portal-label">Reason (technicians will see this notice)</span>
          <textarea className="portal-textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}

      {error && (
        <div className="portal-alert portal-alert-error" role="alert">
          {error}
          {problems.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="portal-btn portal-btn-primary" disabled={busy || (needsReason && !reason.trim())} onClick={save}>{saveLabel}</button>
        <button type="button" className="portal-btn portal-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
