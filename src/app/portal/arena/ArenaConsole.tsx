"use client";

// 317 Live Arena · Admin Control Center. Weeks, templates, owner settings and
// the audit log. Every action calls /api/arena/admin/*, which re-checks the
// permission and, for owner actions, the owner's account.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ArenaRules } from "@/lib/arena/types";
import type { CompetitionDoc, SettingsDoc, TemplateDoc, AuditDoc } from "@/lib/arena/config-store";
import type { Readiness } from "@/lib/arena/review";
import type { ParticipationRow } from "@/lib/arena/participation";
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
type Tab = "weeks" | "templates" | "technicians" | "names" | "settings" | "audit";
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
        {([["weeks", "Weeks"], ["templates", "Templates"], ["technicians", "Manage technicians"], ["names", "Display names"], ["settings", "Owner settings"], ["audit", "Audit log"]] as const).map(([k, label]) => (
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
      {tab === "technicians" && <ManageTechnicians who={who} />}
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

const ACCOUNT_LABEL: Record<string, string> = {
  eligible: "Active", pending: "Pending approval", inactive: "Inactive", unmapped: "No account", not_competing_role: "Role can't compete",
};

interface ParticipationAudit { _id: string; action: string; target: string; by: string; at: string; reason: string | null }
interface WeekEffect { competitionId: string; weekStart: string; status: string; effect: string }

/** Manage Technicians: the owner-controlled Arena participation list. */
function ManageTechnicians({ who }: { who: (id: string) => string }) {
  const [data, setData] = useState<{ isOwner: boolean; rows: ParticipationRow[]; excludedCount: number; audit: ParticipationAudit[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showUnmapped, setShowUnmapped] = useState(true);
  const [acting, setActing] = useState<{ row: ParticipationRow; to: "excluded" | "included" } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ name: string; to: string; effects: WeekEffect[] } | null>(null);
  const load = useCallback(async () => {
    try { setData(await api("/api/arena/admin/participation")); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!data) return err ? <div className="portal-alert portal-alert-error" role="alert">{err}</div> : <div className="muted">Loading…</div>;

  const nameOf = (r: ParticipationRow) => r.displayName ?? r.fullName ?? r.crmNames[0] ?? r.key;
  const needle = q.trim().toLowerCase();
  const rows = data.rows.filter((r) =>
    (showUnmapped || r.status !== "not_mapped") &&
    (!needle || [r.displayName, r.fullName, r.competitorId, ...r.crmNames, ...r.locations].some((x) => x && x.toLowerCase().includes(needle))));
  const unmapped = data.rows.filter((r) => r.status === "not_mapped").length;
  const review = data.rows.filter((r) => r.reviewNeeded).length;

  const submit = async () => {
    if (!acting) return;
    setBusy(true);
    try {
      const out = await api<{ changed: boolean; effects: WeekEffect[] }>("/api/arena/admin/participation", {
        method: "POST", body: { competitorId: acting.row.competitorId, status: acting.to, reason },
      });
      setResult({ name: nameOf(acting.row), to: acting.to, effects: out.effects });
      setActing(null); setReason("");
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="manage-technicians">
      <div className="portal-card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <p className="small" style={{ margin: 0 }}>
          <b>Who takes part in the Arena.</b> Everyone with a verified Weekly Balance identity takes part unless the owner excludes them here.
          An excluded technician is left out of the live leaderboard, rankings, prizes, projections and Most Improved. Their CRM jobs and
          financial records are never changed, and their jobs are not flagged as unmapped names.
        </p>
        <p className="small" style={{ margin: 0 }}>
          <b>Weeks:</b> a running week is recomputed at once. A frozen week keeps its snapshot; opening the review re-checks it with the current
          list. A week in review keeps its snapshot, and approval is refused until you <i>Re-check CRM data</i>. Approved weeks are never changed.
        </p>
        <p className="small" style={{ margin: 0 }}>
          <b>This is not app access.</b> An excluded technician who can still sign in sees &ldquo;You&apos;re not competing this week&rdquo;.
          To remove access, deactivate them in Weekly Balance or revoke them on the pilot allowlist.
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          CRM status: the CRM has no reliable active/inactive field for technicians (a Technician record holds only its name, profit %, past
          rates and location), so nothing is suggested automatically. The Area Manager is not shown: it lives in the CRM Location collection,
          which the Arena is not allowed to read. The Weekly Balance account column is the Arena&apos;s last check, for information.
        </p>
      </div>
      {result && (
        <div className="portal-alert portal-alert-info" role="status">
          <div>
            <div>{result.name} is now <b>{result.to === "excluded" ? "excluded from" : "included in"}</b> the Arena.</div>
            {result.effects.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{result.effects.map((e) => <li key={e.competitionId}>{weekLabel(e.weekStart)} ({STATUS_LABEL[e.status] ?? e.status}): {e.effect}</li>)}</ul>}
          </div>
        </div>
      )}
      {err && <div className="portal-alert portal-alert-error" role="alert">{err}</div>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input className="portal-input" style={{ maxWidth: 280 }} placeholder="Search name, id, CRM name, location" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search technicians" />
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={showUnmapped} onChange={(e) => setShowUnmapped(e.target.checked)} /> Show CRM technicians that are not mapped ({unmapped})
        </label>
        <span className="muted small">{data.excludedCount} excluded · {review} need review</span>
      </div>
      {!data.isOwner && <p className="muted small" style={{ margin: 0 }}>Only the owner can include or exclude technicians.</p>}
      <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="portal-table">
            <thead><tr>
              <th>Technician</th><th>Stable ids</th><th>Area / location</th>
              <th title="The CRM has no reliable active/inactive field for technicians">CRM status</th>
              <th title="Weekly Balance account, last check by the Arena; app access = pilot allowlist">Account · app access</th>
              <th>Arena participation</th><th />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid={`mt-row-${r.key}`}>
                  <td>
                    <b>{nameOf(r)}</b>
                    {r.fullName && r.fullName !== r.displayName && <div className="muted small">{r.fullName}</div>}
                    <div className="small">CRM: {r.crmNames.join(", ") || "—"}</div>
                    {r.flags.length > 0 && <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 16 }}>{r.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
                  </td>
                  <td className="small">
                    <div>Competitor: {r.competitorId ? <code>{r.competitorId}</code> : <span className="muted">none (not mapped)</span>}</div>
                    <div>CRM Technician: {r.crmTechnicianIds.length ? r.crmTechnicianIds.map((x) => <code key={x} style={{ marginRight: 6 }}>{x}</code>) : <span className="muted">no record</span>}</div>
                  </td>
                  <td className="small">{r.locations.join(", ") || "—"}<div className="muted small">Area Manager: not available</div></td>
                  <td className="small muted">No CRM field</td>
                  <td className="small">
                    {r.account ? `${ACCOUNT_LABEL[r.account.state] ?? r.account.state} · ${when(r.account.checkedAt)}` : <span className="muted">not checked</span>}
                    <div>{r.competitorId ? (r.appAccess === true ? "App access: allowed" : "App access: not on allowlist") : ""}</div>
                  </td>
                  <td>
                    {r.status === "excluded" && <span className="pill pill-unpaid">Excluded</span>}
                    {r.status === "included" && <span className="pill pill-paid">Included</span>}
                    {r.status === "not_mapped" && <span className="pill pill-draft">Not mapped</span>}
                    {r.reviewNeeded && <div style={{ marginTop: 4 }}><span className="pill pill-pending">Review needed</span></div>}
                    {r.decision && <div className="muted small" style={{ marginTop: 4 }}>{who(r.decision.by)} · {when(r.decision.at)}<br />&ldquo;{r.decision.reason}&rdquo;</div>}
                  </td>
                  <td>
                    {data.isOwner && r.canChange && r.competitorId && (
                      r.status === "excluded"
                        ? <button className="portal-btn" onClick={() => { setActing({ row: r, to: "included" }); setReason(""); }}>Re-include</button>
                        : <button className="portal-btn" onClick={() => { setActing({ row: r, to: "excluded" }); setReason(""); }}>Exclude</button>
                    )}
                    {r.status === "not_mapped" && <Link className="small" href="/portal/arena/review">Review queue</Link>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="muted">No technicians match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {acting && (
        <div className="portal-card" role="dialog" aria-label="Change participation" style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
          <b>{acting.to === "excluded" ? "Exclude" : "Re-include"} {nameOf(acting.row)}</b>
          <span className="small">
            {acting.to === "excluded"
              ? "They leave the live standings, rankings, prizes, projections and Most Improved. Their CRM jobs are not changed, and their app access is not changed."
              : "They take part again from the next computation of every running week."}
          </span>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Reason (required)</span>
            <input className="portal-input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="portal-btn portal-btn-primary" disabled={!reason.trim() || busy} onClick={submit}>
              {acting.to === "excluded" ? "Exclude from the Arena" : "Re-include in the Arena"}
            </button>
            <button className="portal-btn" onClick={() => setActing(null)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "10px 12px" }}><b>Participation changes</b></div>
        <div style={{ overflowX: "auto" }}>
          <table className="portal-table">
            <thead><tr><th>When</th><th>What</th><th>Competitor</th><th>Who</th><th>Reason</th></tr></thead>
            <tbody>
              {data.audit.map((a) => (
                <tr key={a._id}><td style={{ whiteSpace: "nowrap" }}>{when(a.at)}</td><td>{a.action === "participation.exclude" ? "Excluded" : "Re-included"}</td><td className="small">{a.target.replace("participation:", "")}</td><td>{who(a.by)}</td><td>{a.reason ?? "—"}</td></tr>
              ))}
              {data.audit.length === 0 && <tr><td colSpan={5} className="muted">No changes yet. Everyone takes part.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
