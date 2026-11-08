"use client";

// 317 Live Arena · Admin Control Center. Weeks, templates, owner settings and
// the audit log. Every action calls /api/arena/admin/*, which re-checks the
// permission and, for owner actions, the owner's account.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ArenaRules } from "@/lib/arena/types";
import type { CompetitionDoc, SettingsDoc, TemplateDoc, AuditDoc } from "@/lib/arena/config-store";
import type { Readiness } from "@/lib/arena/review";
import RulesEditor from "./RulesEditor";
import ResultsPanel from "./ResultsPanel";
import { api, BETA_LABEL, dollars, nextMonday, STATUS_LABEL, statusPill, weekLabel, when } from "./arena-ui";

interface Overview {
  me: { userId: string; name: string; isOwner: boolean; mayInitialise: boolean; canEditRules: boolean; canReview: boolean };
  settings: SettingsDoc | null;
  competitions: CompetitionDoc[];
  templates: TemplateDoc[];
  readiness: Readiness;
  userNames: Record<string, string>;
  seedRules: ArenaRules;
  seedBalancedRules: ArenaRules;
  /** "Balanced Performance · Prizes 2026-11" (3 places + Most Improved); absent on older servers. */
  seedBalancedP2?: { templateId: string; name: string; rules: ArenaRules };
  /** "Balanced Performance · Assigned jobs · Prizes 2026-11" (P2 + job minimum on every assigned job); absent on older servers. */
  seedBalancedP3?: { templateId: string; name: string; rules: ArenaRules };
}
type Tab = "weeks" | "templates" | "names" | "settings" | "audit";
type Editing =
  | { kind: "week"; id: string; rules: ArenaRules; amend: boolean }
  | { kind: "template"; templateId: string; name: string; rules: ArenaRules; isNew: boolean };

export default function ArenaConsole() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("weeks");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api<Overview>("/api/arena/admin/overview")); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const who = (id: string | null | undefined) => (id ? data?.userNames[id] || id : "—");
  const done = async (msg: string) => { setEditing(null); setNotice(msg); await load(); };

  if (error && !data) return <div className="portal-alert portal-alert-error" role="alert">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  if (!data.settings) {
    return (
      <div className="portal-card" style={{ maxWidth: 620 }}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>The Arena isn&apos;t set up yet</h2>
        {data.me.mayInitialise ? (
          <>
            <p>Set up creates the owner settings: a $1,500 weekly budget ceiling, and you as the only approver. You can change both later.</p>
            <button className="portal-btn portal-btn-primary" onClick={async () => {
              try { await api("/api/arena/admin/settings", { method: "POST" }); await done("Arena settings created."); }
              catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            }}>Set up the Arena</button>
          </>
        ) : (
          <p className="muted">Only the owner account can set it up.</p>
        )}
        {error && <div className="portal-alert portal-alert-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
      </div>
    );
  }

  if (editing) {
    if (editing.kind === "week") {
      return (
        <RulesEditor
          initial={editing.rules}
          title={`${editing.amend ? "Change the active week" : "Rules"} · week of ${weekLabel(editing.id.replace("arena_", ""))}`}
          saveLabel={editing.amend ? "Change rules and notify technicians" : "Save as a new version"}
          needsReason={editing.amend}
          extra={editing.amend ? <div className="portal-alert portal-alert-warn">This week is running. A change creates a new rule version, is logged with your reason, and shows technicians a notice.</div> : undefined}
          onCancel={() => setEditing(null)}
          onSave={async (rules, reason) => {
            if (editing.amend) await api(`/api/arena/admin/competitions/${editing.id}/action`, { method: "POST", body: { action: "amend", rules, reason } });
            else await api(`/api/arena/admin/competitions/${editing.id}`, { method: "PUT", body: { rules } });
            await done("Rules saved as a new version.");
          }}
        />
      );
    }
    return (
      <RulesEditor
        initial={editing.rules}
        title={editing.isNew ? "New template" : `Template · ${editing.name}`}
        saveLabel="Save template"
        extra={editing.isNew ? (
          <div className="portal-grid-2">
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="portal-label">Template name</span>
              <input className="portal-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="portal-label">Short id (lowercase, hyphens)</span>
              <input className="portal-input" value={editing.templateId} onChange={(e) => setEditing({ ...editing, templateId: e.target.value })} />
            </label>
          </div>
        ) : undefined}
        onCancel={() => setEditing(null)}
        onSave={async (rules) => {
          await api("/api/arena/admin/templates", { method: "POST", body: { templateId: editing.templateId, name: editing.name, rules } });
          await done("Template saved.");
        }}
      />
    );
  }

  const r = data.readiness;
  const scanned = Object.values(r.byKind).reduce((n, k) => n + k.open + k.pendingOwner + k.resolved, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className={`portal-alert ${r.launchReady && scanned > 0 ? "portal-alert-good" : "portal-alert-warn"}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span>
          {scanned === 0
            ? "Data review: no scan has run yet. Launch gate G2 can't be judged until the CRM weeks are scanned."
            : r.launchReady
              ? "Data review: every case is resolved. Launch gate G2 is clear."
              : `Data review: ${r.launchBlocking} case(s) still open or waiting for the owner. Launch stays blocked until they are resolved.`}
        </span>
        <Link className="portal-btn" href="/portal/arena/review">Open the review queue</Link>
      </div>
      {notice && <div className="portal-alert portal-alert-info" role="status">{notice}</div>}
      {error && <div className="portal-alert portal-alert-error" role="alert">{error}</div>}

      <div className="portal-range-pills" role="tablist" aria-label="Arena sections">
        {([["weeks", "Weeks"], ["templates", "Templates"], ["names", "Display names"], ["settings", "Owner settings"], ["audit", "Audit log"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`portal-range-pill${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === "weeks" && <Weeks data={data} who={who} setError={setError} onEdit={setEditing} done={done} />}
      {tab === "templates" && (
        <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="portal-table">
            <thead><tr><th>Template</th><th>Version</th><th>Prizes</th><th>Gates</th><th>Saved</th><th /></tr></thead>
            <tbody>
              {data.templates.map((t) => (
                <tr key={t._id}>
                  <td><b>{t.name}</b><div className="muted small">{t.templateId}</div></td>
                  <td>v{t.version}</td>
                  <td>{t.rules.prizes.positionsCents.map(dollars).join(" / ")}{t.rules.mostImproved.enabled ? ` + MI ${dollars(t.rules.mostImproved.amountCents)}` : ""}</td>
                  <td>{t.rules.eligibility.minQualifyingJobs} {t.rules.eligibility.jobCountBasis === "assigned" ? "assigned" : "qualifying"} jobs · {dollars(t.rules.eligibility.minAvgTicketCents)} · {(t.rules.eligibility.minClosingRateBp / 100).toFixed(0)}%</td>
                  <td>{who(t.by)}<div className="muted small">{when(t.at)}</div></td>
                  <td>{data.me.canEditRules && <button className="portal-btn" onClick={() => setEditing({ kind: "template", templateId: t.templateId, name: t.name, rules: t.rules, isNew: false })}>Edit</button>}</td>
                </tr>
              ))}
              {data.templates.length === 0 && <tr><td colSpan={6} className="muted">No templates yet.</td></tr>}
            </tbody>
          </table>
          {data.me.canEditRules && (
            <div style={{ padding: 12 }}>
              <button className="portal-btn" onClick={() => setEditing({ kind: "template", templateId: data.templates.length ? "" : "standard", name: data.templates.length ? "" : "Standard Week", rules: structuredClone(data.seedRules), isNew: true })}>
                New template from the approved standard rules
              </button>
              {!data.templates.some((t) => t.templateId === "balanced") && (
                <button className="portal-btn" style={{ marginLeft: 8 }} onClick={() => setEditing({ kind: "template", templateId: "balanced", name: "Balanced Performance", rules: structuredClone(data.seedBalancedRules), isNew: true })}>
                  New template: Balanced Performance (V1)
                </button>
              )}
              {data.seedBalancedP2 && !data.templates.some((t) => t.templateId === data.seedBalancedP2!.templateId) && (
                <button className="portal-btn" style={{ marginLeft: 8 }} onClick={() => setEditing({ kind: "template", templateId: data.seedBalancedP2!.templateId, name: data.seedBalancedP2!.name, rules: structuredClone(data.seedBalancedP2!.rules), isNew: true })}>
                  New template: {data.seedBalancedP2.name}
                </button>
              )}
              {data.seedBalancedP3 && !data.templates.some((t) => t.templateId === data.seedBalancedP3!.templateId) && (
                <button className="portal-btn" style={{ marginLeft: 8 }} data-testid="arena-new-template-p3" onClick={() => setEditing({ kind: "template", templateId: data.seedBalancedP3!.templateId, name: data.seedBalancedP3!.name, rules: structuredClone(data.seedBalancedP3!.rules), isNew: true })}>
                  New template: {data.seedBalancedP3.name}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {tab === "settings" && <Settings data={data} who={who} done={done} />}
      {tab === "names" && <Names />}
      {tab === "audit" && <Audit who={who} />}
    </div>
  );
}

function Weeks({ data, who, setError, onEdit, done }: {
  data: Overview; who: (id: string) => string; setError: (e: string | null) => void;
  onEdit: (e: Editing) => void; done: (msg: string) => Promise<void>;
}) {
  const [weekStart, setWeekStart] = useState(nextMonday());
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  const [source, setSource] = useState<string>(data.templates[0]?.templateId ?? "");
  const [asBeta, setAsBeta] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); await done(msg); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const act = (id: string, action: string, needsReason: boolean, beta = false) => run(async () => {
    let reason: string | undefined;
    if (needsReason) {
      reason = window.prompt(`Reason for ${action === "cancel" ? "cancelling" : "suspending"} this week`) ?? "";
      if (!reason.trim()) throw new Error("A reason is required");
    }
    if (beta && !window.confirm(`Start this week as ${BETA_LABEL}?\n\nIt runs on real CRM data but can never be approved as official. This cannot be undone.`)) throw new Error("Not started");
    await api(`/api/arena/admin/competitions/${id}/action`, { method: "POST", body: { action, reason, ...(beta ? { beta: true } : {}) } });
  }, `Week ${action === "activate" ? (beta ? "started as LIVE BETA" : "started") : action === "schedule" ? "scheduled" : action === "suspend" ? "suspended" : "cancelled"}.`);
  const openRules = async (c: CompetitionDoc, amend: boolean) => {
    try {
      const d = await api<{ ruleVersion: { rules: ArenaRules } }>(`/api/arena/admin/competitions/${c._id}`);
      onEdit({ kind: "week", id: c._id, rules: d.ruleVersion.rules, amend });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {data.me.canEditRules && (
        <div className="portal-card" style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Week starting (Monday)</span>
            <input className="portal-input" type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Start from</span>
            <select className="portal-select" value={source} onChange={(e) => setSource(e.target.value)}>
              {data.templates.map((t) => <option key={t.templateId} value={t.templateId}>Template: {t.name}</option>)}
              <option value="__previous">A copy of the week before</option>
            </select>
          </label>
          {data.me.isOwner && (
            <label style={{ display: "flex", gap: 6, alignItems: "center" }} title="Owner only. Real data, never approvable as official, prizes projected only.">
              <input type="checkbox" checked={asBeta} onChange={(e) => setAsBeta(e.target.checked)} data-testid="arena-create-beta" />
              LIVE BETA test week
            </label>
          )}
          <button className="portal-btn portal-btn-primary" disabled={!source} onClick={() => run(
            () => api("/api/arena/admin/competitions", { method: "POST", body: { weekStart, from: source === "__previous" ? { copyPreviousWeek: true } : { template: source }, ...(asBeta ? { beta: true } : {}) } }),
            `${asBeta ? "LIVE BETA draft" : "Draft"} created for the week of ${weekLabel(weekStart)}.`,
          )}>Create week</button>
          {data.templates.length === 0 && <span className="muted small">Save a template first.</span>}
        </div>
      )}
      {resultsFor && (
        <ResultsPanel id={resultsFor} canEdit={data.me.canEditRules} who={who} onClose={() => setResultsFor(null)} onChanged={() => done("Results updated.")} />
      )}
      <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="portal-table">
          <thead><tr><th>Week</th><th>Status</th><th>Rules</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            {data.competitions.map((c) => {
              const owner = data.me.isOwner, edit = data.me.canEditRules;
              return (
                <tr key={c._id}>
                  <td><b>{weekLabel(c.weekStart)}</b><div className="muted small">{c.weekStart}</div></td>
                  <td>
                    <span className={statusPill(c.status)}>{STATUS_LABEL[c.status] ?? c.status}</span>
                    {c.beta && <span className="pill pill-pending" style={{ marginLeft: 6 }} title={BETA_LABEL} data-testid="arena-week-beta">BETA</span>}
                    {c.beta && <div className="muted small">Test week · no official winners or cash payouts</div>}
                  </td>
                  <td>v{c.ruleVersionN}{c.lockedAt && <div className="muted small">locked {when(c.lockedAt)}</div>}</td>
                  <td>{who(c.createdBy)}<div className="muted small">{when(c.createdAt)}</div></td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {["active", "suspended", "provisional", "in_review", "approved"].includes(c.status) &&
                        <button className="portal-btn" onClick={() => setResultsFor(c._id)}>{c.status === "in_review" ? "Review" : "Results"}</button>}
                      {edit && (c.status === "draft" || c.status === "scheduled") && <button className="portal-btn" onClick={() => openRules(c, false)}>Edit rules</button>}
                      {edit && c.status === "draft" && <button className="portal-btn" onClick={() => act(c._id, "schedule", false)}>Schedule</button>}
                      {edit && owner && c.status === "scheduled" && <button className="portal-btn portal-btn-primary" onClick={() => act(c._id, "activate", false)}>{c.beta ? "Start LIVE BETA week" : "Start week"}</button>}
                      {edit && owner && c.status === "scheduled" && !c.beta && <button className="portal-btn" onClick={() => act(c._id, "activate", false, true)}>Start as LIVE BETA</button>}
                      {edit && owner && (c.status === "active" || c.status === "suspended") && <button className="portal-btn" onClick={() => openRules(c, true)}>Change rules</button>}
                      {edit && owner && c.status === "active" && <button className="portal-btn" onClick={() => act(c._id, "suspend", true)}>Suspend</button>}
                      {edit && (c.status === "draft" || c.status === "scheduled" || (owner && c.status !== "approved" && c.status !== "cancelled")) &&
                        <button className="portal-btn portal-btn-danger" onClick={() => act(c._id, "cancel", true)}>Cancel</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {data.competitions.length === 0 && <tr><td colSpan={5} className="muted">No weeks yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Admins prepare and schedule weeks. Only the owner starts, changes, suspends or cancels a running week, and only the owner approves results. A BETA week ({BETA_LABEL}) can never be approved.</p>
    </div>
  );
}

function Settings({ data, who, done }: { data: Overview; who: (id: string) => string; done: (msg: string) => Promise<void> }) {
  const s = data.settings!;
  const [ceiling, setCeiling] = useState(String(s.budgetCeilingCents / 100));
  const [approvers, setApprovers] = useState(s.approverUserIds.join(", "));
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="portal-card" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <table className="portal-table">
        <tbody>
          <tr><th>Owner</th><td>{who(s.ownerUserId)}</td></tr>
          <tr><th>Weekly budget ceiling</th><td>{dollars(s.budgetCeilingCents)}</td></tr>
          <tr><th>Can approve results</th><td>{s.approverUserIds.map(who).join(", ")}</td></tr>
          <tr><th>Version</th><td>v{s.version} · {who(s.by)} · {when(s.at)}{s.reason !== "initial" && ` · “${s.reason}”`}</td></tr>
        </tbody>
      </table>
      {data.me.isOwner ? (
        <>
          <div className="portal-grid-2">
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="portal-label">Weekly budget ceiling ($)</span>
              <input className="portal-input" type="number" step="0.01" value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="portal-label">Approver account ids (comma-separated)</span>
              <input className="portal-input" value={approvers} onChange={(e) => setApprovers(e.target.value)} />
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Reason</span>
            <input className="portal-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {err && <div className="portal-alert portal-alert-error" role="alert">{err}</div>}
          <div>
            <button className="portal-btn portal-btn-primary" disabled={!reason.trim()} onClick={async () => {
              try {
                await api("/api/arena/admin/settings", { method: "PUT", body: {
                  budgetCeilingCents: Math.round(Number(ceiling) * 100),
                  approverUserIds: approvers.split(",").map((x) => x.trim()).filter(Boolean),
                  reason,
                } });
                await done("Owner settings saved as a new version.");
              } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
            }}>Save owner settings</button>
          </div>
        </>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>Only the owner can change the budget ceiling or who approves results.</p>
      )}
    </div>
  );
}

function Audit({ who }: { who: (id: string) => string }) {
  const [rows, setRows] = useState<AuditDoc[]>([]);
  const [more, setMore] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const page = useCallback(async (before?: string) => {
    try {
      const q = new URLSearchParams({ limit: "50", ...(before ? { before } : {}) });
      const d = await api<{ rows: AuditDoc[] }>(`/api/arena/admin/audit?${q}`);
      setRows((cur) => (before ? [...cur, ...d.rows] : d.rows));
      setMore(d.rows.length === 50);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void page(); }, [page]);
  return (
    <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
      {err && <div className="portal-alert portal-alert-error" role="alert">{err}</div>}
      <div style={{ overflowX: "auto" }}>
        <table className="portal-table">
          <thead><tr><th>When</th><th>What</th><th>Item</th><th>Who</th><th>Reason</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a._id}><td style={{ whiteSpace: "nowrap" }}>{when(a.at)}</td><td>{a.action}</td><td className="small">{a.target}</td><td>{who(a.by)}</td><td>{a.reason ?? "—"}</td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">Nothing recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {more && rows.length > 0 && <div style={{ padding: 12 }}><button className="portal-btn" onClick={() => page(rows[rows.length - 1].at)}>Show older</button></div>}
    </div>
  );
}

interface NameRow {
  id: string; fullName: string; displayName: string; source: "override" | "formatted" | "crm_fallback" | "raw";
  needsEnglish: boolean; collision: "prefix" | "location" | "unresolved" | null; blocking: boolean;
  possibleDuplicateOf: { id: string; fullName: string }[]; crmNames: string[]; location: string;
}
const SOURCE_LABEL: Record<NameRow["source"], string> = {
  override: "Override (shown as set)", formatted: "First name + last initial", crm_fallback: "From the CRM name", raw: "As stored",
};

function Names() {
  const [rows, setRows] = useState<NameRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ rows: NameRow[] }>("/api/arena/admin/names").then((d) => setRows(d.rows)).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  if (err) return <div className="portal-alert portal-alert-error" role="alert">{err}</div>;
  if (!rows) return <div className="muted">Loading…</div>;
  const blocking = rows.filter((r) => r.blocking).length;
  const english = rows.filter((r) => r.needsEnglish).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="muted small" style={{ margin: 0 }}>
        Leaderboards, history and winners show the <b>public display name</b> (first name + last initial). Rankings, ties and the audit use the
        competitor id only. Approved weeks keep the names they were approved with. To set or change an override, use a display-name case in the{" "}
        <Link href="/portal/arena/review">review queue</Link>.
      </p>
      {(blocking > 0 || english > 0) && (
        <div className={`portal-alert ${blocking ? "portal-alert-error" : "portal-alert-warn"}`} role="status">
          {blocking > 0 && `${blocking} name(s) still identical after adding the location — set an override (blocks review). `}
          {english > 0 && `${english} name(s) need an English display name.`}
        </div>
      )}
      <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="portal-table">
            <thead><tr><th>Full name</th><th>Public display name</th><th>Flags</th><th>CRM names · location</th><th>Competitor id</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.fullName || "—"}</td>
                  <td><b>{r.displayName}</b><div className="muted small">{SOURCE_LABEL[r.source]}</div></td>
                  <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {r.collision === "unresolved" && <span className="pill pill-unpaid">Collision · needs override</span>}
                    {r.collision === "prefix" && <span className="pill pill-pending">Collision · longer last name</span>}
                    {r.collision === "location" && <span className="pill pill-pending">Collision · location added</span>}
                    {r.needsEnglish && <span className="pill pill-pending">Needs English display name</span>}
                    {r.possibleDuplicateOf.length > 0 && (
                      <span className="pill pill-pending" title={r.possibleDuplicateOf.map((p) => p.fullName).join(", ")}>
                        Possible duplicate account — confirm ({r.possibleDuplicateOf.map((p) => p.fullName).join(", ")})
                      </span>
                    )}
                    {!r.collision && !r.needsEnglish && r.possibleDuplicateOf.length === 0 && <span className="muted small">—</span>}
                  </div></td>
                  <td className="small">{r.crmNames.join(", ") || "—"}{r.location ? ` · ${r.location}` : ""}</td>
                  <td className="small muted">{r.id}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="muted">No verified people yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
