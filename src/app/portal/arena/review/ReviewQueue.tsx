"use client";

// Review queue: one card per case, decided explicitly with a reason. Some
// decisions wait for the owner. Nothing here edits CRM data; a real duplicate
// is corrected by the office in the CRM itself.

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DisplayNameCaseData, DuplicateCaseData, IdentityCaseData, NonCompetitorCategory, Readiness, Resolution,
  ReviewCaseDoc, ReviewEventDoc, ReviewKind,
} from "@/lib/arena/review";
import { api, dollars, lastCompletedMonday, STATUS_LABEL, statusPill, weekLabel, when } from "../arena-ui";

interface Person { id: string; name: string; crmNames: string[] }
interface Me { userId: string; isOwner: boolean; canReview: boolean }

const KIND_LABEL: Record<ReviewKind, string> = {
  duplicate_group: "Suspected duplicate jobs",
  identity_name: "CRM name without a verified person",
  display_name: "Missing English display name",
};
const ISSUE_LABEL: Record<string, string> = {
  unmapped_name: "No name-mapping record lists this name",
  name_in_multiple_mappings: "More than one person's mapping lists this name",
  normalized_collision: "Differs from a mapped name only by spacing or capitals, and another CRM name does too",
};
const CATEGORY_LABEL: Record<NonCompetitorCategory, string> = {
  location_pool: "Location pool", subcontractor: "Subcontractor", not_a_person: "Not a person (test, system)",
  former_technician: "Former technician", other: "Other",
};

function describe(r: Resolution | null, people: Map<string, Person>): string {
  if (!r) return "—";
  switch (r.kind) {
    case "duplicate_confirmed": return `Real duplicate: ${r.excludeJobIds.length} job(s) leave the qualifying count; the office fixes the CRM`;
    case "duplicate_dismissed": return "Not a duplicate";
    case "identity_attach": return `Same person as ${people.get(r.competitorId)?.name || r.competitorId}`;
    case "identity_not_competitor": return `Not a competitor: ${CATEGORY_LABEL[r.category]}`;
    case "display_name": return `Display name “${r.displayName}”`;
  }
}

export default function ReviewQueue() {
  const [cases, setCases] = useState<ReviewCaseDoc[]>([]);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<ReviewKind | "all">("all");
  const [status, setStatus] = useState<"open" | "pending_owner" | "resolved" | "all">("open");
  const [weeks, setWeeks] = useState(12); // 8 scored weeks + the 4-week Most Improved baseline
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (kind !== "all") q.set("kind", kind);
      if (status !== "all") q.set("status", status);
      const [d, o] = await Promise.all([
        api<{ cases: ReviewCaseDoc[]; readiness: Readiness; people: Person[] }>(`/api/arena/admin/review?${q}`),
        api<{ me: Me; userNames: Record<string, string> }>("/api/arena/admin/overview"),
      ]);
      setCases(d.cases); setReady(d.readiness); setPeople(d.people); setMe(o.me); setNames(o.userNames); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [kind, status]);
  useEffect(() => { void load(); }, [load]);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const who = (id: string | null) => (id ? names[id] || id : "—");

  async function scan() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const first = new Date(`${lastCompletedMonday()}T12:00:00Z`);
      first.setUTCDate(first.getUTCDate() - 7 * (weeks - 1));
      const r = await api<{ added: number; refreshed: number; weeks: string[] }>("/api/arena/admin/review", {
        method: "POST", body: { firstWeek: first.toISOString().slice(0, 10), weeks },
      });
      setMsg(`Scanned ${r.weeks.length} week(s), ${weekLabel(r.weeks[0])} to ${weekLabel(r.weeks[r.weeks.length - 1])}: ${r.added} new case(s), ${r.refreshed} already known.`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {ready && (
        <div className="portal-grid-3">
          {(Object.keys(KIND_LABEL) as ReviewKind[]).map((k) => {
            const c = ready.byKind[k];
            return (
              <div key={k} className="portal-kpi">
                <div className="portal-kpi-label">{KIND_LABEL[k]}</div>
                <div className="portal-kpi-value">{c.open + c.pendingOwner} open</div>
                <div className="portal-kpi-sub">
                  {c.pendingOwner} waiting for the owner · {c.resolved} resolved
                  {k === "duplicate_group" && c.likelyOpen ? ` · ${c.likelyOpen} likely duplicates open` : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {ready && (
        <div className={`portal-alert ${ready.launchReady ? "portal-alert-good" : "portal-alert-warn"}`}>
          {ready.launchReady ? "Nothing left to review. Launch gate G2 is clear." : `${ready.launchBlocking} case(s) block launch until they are resolved.`}
        </div>
      )}

      <div className="portal-toolbar" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="portal-label">Show</span>
          <select className="portal-select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">Every kind</option>
            {(Object.keys(KIND_LABEL) as ReviewKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="portal-label">Status</span>
          <select className="portal-select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="open">Open</option>
            <option value="pending_owner">Waiting for owner</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </label>
        {me?.canReview && (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="portal-label">Weeks to scan</span>
              <input className="portal-input" type="number" min={1} max={26} value={weeks} onChange={(e) => setWeeks(Math.max(1, Math.min(26, Number(e.target.value) || 1)))} style={{ width: 90 }} />
            </label>
            <button className="portal-btn portal-btn-primary" disabled={busy} onClick={scan}>{busy ? "Scanning…" : "Scan CRM weeks"}</button>
            <span className="muted small">Reads the CRM only. Known cases keep their decisions.</span>
          </>
        )}
      </div>
      {msg && <div className="portal-alert portal-alert-info" role="status">{msg}</div>}
      {err && <div className="portal-alert portal-alert-error" role="alert">{err}</div>}

      {cases.length === 0 && <div className="portal-empty">No cases match. {me?.canReview ? "Run a scan to look for new ones." : ""}</div>}
      {cases.map((c) => (
        <CaseCard key={c._id} c={c} me={me} people={people} peopleById={peopleById} who={who} onChanged={load} />
      ))}
    </div>
  );
}

function CaseCard({ c, me, people, peopleById, who, onChanged }: {
  c: ReviewCaseDoc; me: Me | null; people: Person[]; peopleById: Map<string, Person>;
  who: (id: string | null) => string; onChanged: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState<string>("");
  const [exclude, setExclude] = useState<string[]>(() =>
    c.kind === "duplicate_group" ? (c.data as DuplicateCaseData).jobs.slice(1).map((j) => j.id) : []);
  const [personId, setPersonId] = useState("");
  const [category, setCategory] = useState<NonCompetitorCategory>(
    (c.kind === "identity_name" && (c.data as IdentityCaseData).suggestedCategory) || "location_pool");
  const [displayName, setDisplayName] = useState("");
  const [history, setHistory] = useState<ReviewEventDoc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/arena/admin/review/${encodeURIComponent(c._id)}`;

  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try { await api(url, { method: "POST", body }); setReason(""); setHistory(null); await onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const resolution = (): Resolution | null => {
    if (c.kind === "duplicate_group") return choice === "confirm" ? { kind: "duplicate_confirmed", excludeJobIds: exclude } : choice === "dismiss" ? { kind: "duplicate_dismissed" } : null;
    if (c.kind === "identity_name") return choice === "attach" ? { kind: "identity_attach", competitorId: personId } : choice === "exclude" ? { kind: "identity_not_competitor", category } : null;
    return { kind: "display_name", displayName };
  };

  const canAct = !!me?.canReview;
  const d = c.data;
  return (
    <div className="portal-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <div className="portal-section-label" style={{ marginBottom: 2 }}>{KIND_LABEL[c.kind]}</div>
          <b>
            {c.kind === "duplicate_group" && `${(d as DuplicateCaseData).competitorName} · ${(d as DuplicateCaseData).date}`}
            {c.kind === "identity_name" && `“${(d as IdentityCaseData).crmName}”`}
            {c.kind === "display_name" && (d as DisplayNameCaseData).currentName}
          </b>
          {c.kind === "duplicate_group" && (d as DuplicateCaseData).likely && <span className="pill pill-unpaid" style={{ marginLeft: 8 }}>Likely duplicate</span>}
          {c.kind === "duplicate_group" && (d as DuplicateCaseData).mayAffectPrizes && <span className="pill pill-pending" style={{ marginLeft: 6 }}>Could change prizes</span>}
        </div>
        <span className={statusPill(c.status)}>{STATUS_LABEL[c.status]}</span>
      </div>

      {c.kind === "duplicate_group" && (
        <table className="portal-table">
          <thead><tr><th>Job</th><th>CRM name</th><th>Status</th><th style={{ textAlign: "right" }}>Net profit</th>{c.status === "open" && choice === "confirm" && <th>Stop counting</th>}</tr></thead>
          <tbody>
            {(d as DuplicateCaseData).jobs.map((j) => (
              <tr key={j.id}>
                <td className="small">{j.id}</td><td>{j.tech}</td><td>{j.status}</td><td style={{ textAlign: "right" }}>{dollars(Math.round(j.profit * 100))}</td>
                {c.status === "open" && choice === "confirm" && (
                  <td><input type="checkbox" aria-label={`Stop counting job ${j.id}`} checked={exclude.includes(j.id)}
                    onChange={(e) => setExclude((x) => (e.target.checked ? [...x, j.id] : x.filter((y) => y !== j.id)))} /></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.kind === "identity_name" && (
        <p style={{ margin: 0 }}>
          {ISSUE_LABEL[(d as IdentityCaseData).issue] ?? (d as IdentityCaseData).issue}. {(d as IdentityCaseData).jobs} job(s) in the scanned weeks
          {(d as IdentityCaseData).locations.length ? ` at ${(d as IdentityCaseData).locations.join(", ")}` : ""}.
          {(d as IdentityCaseData).candidates.length > 0 && ` Claimed by: ${(d as IdentityCaseData).candidates.map((id) => peopleById.get(id)?.name || id).join(", ")}.`}
          {(d as IdentityCaseData).suggestedCategory && <span className="muted"> Hint: same as a location name.</span>}
        </p>
      )}
      {c.kind === "display_name" && (
        <p style={{ margin: 0 }}>CRM names: {(d as DisplayNameCaseData).crmNames.join(", ")}. The national leaderboard needs a name in English letters.</p>
      )}
      <div className="muted small">Seen in weeks: {c.weeks.map(weekLabel).join(", ")}</div>

      {c.status === "open" && canAct && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--ds-line)", paddingTop: 10 }}>
          {c.kind === "duplicate_group" && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label><input type="radio" name={`ch-${c._id}`} checked={choice === "confirm"} onChange={() => setChoice("confirm")} /> Real duplicate</label>
              <label><input type="radio" name={`ch-${c._id}`} checked={choice === "dismiss"} onChange={() => setChoice("dismiss")} /> Not a duplicate</label>
            </div>
          )}
          {c.kind === "duplicate_group" && choice === "confirm" && (
            <p className="muted small" style={{ margin: 0 }}>The ticked jobs leave the qualifying-job count only. Closing rate and AVG ticket change only when the office corrects the job in the CRM.</p>
          )}
          {c.kind === "identity_name" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label><input type="radio" name={`ch-${c._id}`} checked={choice === "attach"} onChange={() => setChoice("attach")} /> This is a verified person</label>
              {choice === "attach" && (
                <select className="portal-select" value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label="Choose the person">
                  <option value="">Choose the person…</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name || p.id} ({p.crmNames.join(", ") || "no CRM names yet"})</option>)}
                </select>
              )}
              <label><input type="radio" name={`ch-${c._id}`} checked={choice === "exclude"} onChange={() => setChoice("exclude")} /> Not a competitor</label>
              {choice === "exclude" && (
                <select className="portal-select" value={category} onChange={(e) => setCategory(e.target.value as NonCompetitorCategory)} aria-label="What kind of name">
                  {(Object.keys(CATEGORY_LABEL) as NonCompetitorCategory[]).map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
                </select>
              )}
            </div>
          )}
          {c.kind === "display_name" && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 360 }}>
              <span className="portal-label">English display name</span>
              <input className="portal-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="As the technician wants to appear" />
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Reason</span>
            <input className="portal-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div>
            <button className="portal-btn portal-btn-primary" disabled={busy || !reason.trim() || !resolution()}
              onClick={() => send({ op: "resolve", resolution: resolution(), reason })}>Save decision</button>
            {!me?.isOwner && (c.kind === "display_name" || (c.kind === "identity_name" && choice === "attach")
              || (c.kind === "duplicate_group" && (d as DuplicateCaseData).mayAffectPrizes)) && (
              <span className="muted small" style={{ marginLeft: 8 }}>The owner confirms this before it takes effect.</span>
            )}
          </div>
        </div>
      )}

      {c.status !== "open" && (
        <div style={{ borderTop: "1px solid var(--ds-line)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <b>{c.status === "pending_owner" ? "Proposed" : "Decision"}:</b> {describe(c.resolution, peopleById)}
            <div className="muted small">
              {who(c.decidedBy)} · {when(c.decidedAt)}{c.reason ? ` · “${c.reason}”` : ""}
              {c.confirmedBy && c.confirmedBy !== c.decidedBy ? ` · confirmed by ${who(c.confirmedBy)} ${when(c.confirmedAt)}` : ""}
            </div>
          </div>
          {canAct && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 240px" }}>
                <span className="portal-label">Reason (to send back or reopen)</span>
                <input className="portal-input" value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              {c.status === "pending_owner" && me?.isOwner && (
                <>
                  <button className="portal-btn portal-btn-primary" disabled={busy} onClick={() => send({ op: "confirm" })}>Confirm</button>
                  <button className="portal-btn" disabled={busy || !reason.trim()} onClick={() => send({ op: "reject", reason })}>Send back</button>
                </>
              )}
              <button className="portal-btn portal-btn-ghost" disabled={busy || !reason.trim()} onClick={() => send({ op: "reopen", reason })}>Reopen</button>
            </div>
          )}
        </div>
      )}
      {err && <div className="portal-alert portal-alert-error" role="alert">{err}</div>}

      <div>
        <button className="portal-btn portal-btn-ghost" onClick={async () => {
          if (history) return setHistory(null);
          try { setHistory((await api<{ history: ReviewEventDoc[] }>(url)).history); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
        }}>{history ? "Hide history" : "Show history"}</button>
        {history && (
          <ol style={{ margin: "8px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }} className="small">
            {history.map((h) => (
              <li key={h._id}>
                {when(h.at)} · <b>{h.action}</b> by {who(h.by)}{h.reason ? ` · “${h.reason}”` : ""}
                {h.after.resolution && h.action !== "detected" ? ` · ${describe(h.after.resolution, peopleById)}` : ""}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
