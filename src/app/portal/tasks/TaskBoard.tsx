"use client";

import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import type { TaskRecord, TaskStatus, TaskPriority } from "@/types/finance";

export type BoardUser = { _id: string; name: string };

const COLUMNS: Array<{ key: TaskStatus; label: string; accent: string }> = [
  { key: "todo", label: "To Do", accent: "#22d3ee" },
  { key: "in_progress", label: "In Progress", accent: "#fbbf24" },
  { key: "blocked", label: "Blocked", accent: "#f87171" },
  { key: "done", label: "Done", accent: "#34d399" },
];

const PRIORITY: Record<TaskPriority, { label: string; color: string; bg: string }> = {
  urgent: { label: "Urgent", color: "#fca5a5", bg: "rgba(239,68,68,0.15)" },
  high: { label: "High", color: "#fdba74", bg: "rgba(249,115,22,0.15)" },
  medium: { label: "Medium", color: "#93c5fd", bg: "rgba(59,130,246,0.15)" },
  low: { label: "Low", color: "#cbd5e1", bg: "rgba(148,163,184,0.15)" },
};

const PRIORITY_ORDER: TaskPriority[] = ["urgent", "high", "medium", "low"];

const ENDPOINT = "/api/portal/tasks";
const todayISO = () => new Date().toISOString().slice(0, 10);

type Draft = {
  _id?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string;
  due_date: string;
};

function emptyDraft(status: TaskStatus): Draft {
  return { title: "", description: "", status, priority: "medium", assignee_id: "", due_date: "" };
}

export default function TaskBoard({
  initialTasks,
  users,
  me,
  canCreate,
  canEdit,
  canDelete,
}: {
  initialTasks: TaskRecord[];
  users: BoardUser[];
  me: { id?: string; name: string };
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [tasks, setTasks] = useState<TaskRecord[]>(initialTasks);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [fAssignee, setFAssignee] = useState<string>(""); // "" = all, "__none__" = unassigned, else user._id
  const [fPriority, setFPriority] = useState<TaskPriority | "">("");
  const [onlyMine, setOnlyMine] = useState(false);

  const isMine = (t: TaskRecord) =>
    (!!me.id && t.assignee_id === me.id) || (!!me.name && t.assignee_name === me.name);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (onlyMine && !isMine(t)) return false;
      if (fPriority && t.priority !== fPriority) return false;
      if (fAssignee === "__none__" && t.assignee_id) return false;
      if (fAssignee && fAssignee !== "__none__" && t.assignee_id !== fAssignee) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, fAssignee, fPriority, onlyMine, me.id, me.name]);

  const filtering = !!fAssignee || !!fPriority || onlyMine;

  const mineCount = useMemo(() => tasks.filter(isMine).length, [tasks, me.id, me.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const byColumn = useMemo(() => {
    const map: Record<TaskStatus, TaskRecord[]> = { todo: [], in_progress: [], blocked: [], done: [] };
    for (const t of filtered) (map[t.status] ?? map.todo).push(t);
    for (const k of Object.keys(map) as TaskStatus[]) {
      map[k].sort(
        (a, b) =>
          a.order - b.order ||
          PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority),
      );
    }
    return map;
  }, [filtered]);

  const nextOrder = (status: TaskStatus) => {
    const inCol = tasks.filter((t) => t.status === status);
    return inCol.length ? Math.max(...inCol.map((t) => t.order)) + 1 : 0;
  };

  // ── Drag & drop ──────────────────────────────────────────────────────────
  async function moveTask(id: string, toStatus: TaskStatus) {
    const task = tasks.find((t) => t._id === id);
    if (!task || task.status === toStatus) return;
    const order = nextOrder(toStatus);
    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t._id === id ? { ...t, status: toStatus, order } : t)));
    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _id: id, status: toStatus, order }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    } catch (e) {
      setTasks(prev); // revert
      setError(e instanceof Error ? e.message : "Could not move task");
    }
  }

  function onDrop(e: DragEvent, col: TaskStatus) {
    e.preventDefault();
    setDragOver(null);
    const id = dragId || e.dataTransfer.getData("text/plain");
    setDragId(null);
    if (id) void moveTask(id, col);
  }

  // ── Create / edit ────────────────────────────────────────────────────────
  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) { setError("Title is required"); return; }
    setSaving(true);
    setError(null);

    const assignee = users.find((u) => u._id === draft.assignee_id);
    const payload: Record<string, unknown> = {
      title,
      description: draft.description.trim() || null,
      status: draft.status,
      priority: draft.priority,
      assignee_id: draft.assignee_id || null,
      assignee_name: assignee?.name ?? null,
      due_date: draft.due_date || null,
    };

    try {
      if (draft._id) {
        const res = await fetch(ENDPOINT, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ _id: draft._id, ...payload }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        setTasks((ts) => ts.map((t) => (t._id === draft._id ? { ...t, ...(payload as Partial<TaskRecord>) } : t)));
      } else {
        payload.order = nextOrder(draft.status);
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        if (j.row) setTasks((ts) => [...ts, j.row as TaskRecord]);
      }
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeTask(id: string) {
    if (!confirm("Delete this task? This cannot be undone.")) return;
    const prev = tasks;
    setTasks((ts) => ts.filter((t) => t._id !== id));
    try {
      const res = await fetch(`${ENDPOINT}?_id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setTasks(prev);
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <>
      {error && (
        <div className="portal-alert portal-alert-error" style={{ marginBottom: 12 }}>
          {error}
          <button className="portal-btn portal-btn-ghost" style={{ marginLeft: 12, padding: "2px 8px" }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
        <button
          className={`portal-btn ${onlyMine ? "portal-btn-primary" : ""}`}
          onClick={() => { const next = !onlyMine; setOnlyMine(next); if (next) setFAssignee(""); }}
          title="Show only tasks assigned to me"
        >
          {onlyMine ? "★ My tasks" : "☆ My tasks"}{mineCount > 0 ? ` (${mineCount})` : ""}
        </button>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="portal-label">Assignee</span>
          <select className="portal-select" value={fAssignee} disabled={onlyMine} onChange={(e) => setFAssignee(e.target.value)} style={{ minWidth: 170, opacity: onlyMine ? 0.5 : 1 }}>
            <option value="">All assignees</option>
            <option value="__none__">Unassigned</option>
            {users.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="portal-label">Priority</span>
          <select className="portal-select" value={fPriority} onChange={(e) => setFPriority(e.target.value as TaskPriority | "")} style={{ minWidth: 150 }}>
            <option value="">All priorities</option>
            {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
          </select>
        </label>
        {filtering && (
          <>
            <button className="portal-btn portal-btn-ghost" onClick={() => { setFAssignee(""); setFPriority(""); setOnlyMine(false); }}>
              Clear filters
            </button>
            <span className="muted small" style={{ paddingBottom: 8 }}>
              Showing {filtered.length} of {tasks.length}
            </span>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", overflowX: "auto", paddingBottom: 8 }}>
        {COLUMNS.map((col) => {
          const list = byColumn[col.key];
          const active = dragOver === col.key;
          return (
            <div
              key={col.key}
              onDragOver={(e) => { e.preventDefault(); if (dragOver !== col.key) setDragOver(col.key); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(null); }}
              onDrop={(e) => onDrop(e, col.key)}
              style={{
                flex: "1 0 260px",
                minWidth: 260,
                background: active ? "rgba(129,140,248,0.08)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${active ? "rgba(129,140,248,0.5)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: 12,
                padding: 10,
                transition: "background .12s, border-color .12s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 10px" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: col.accent }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: "#e2e8f0" }}>{col.label}</span>
                <span className="muted small" style={{ marginLeft: "auto" }}>{list.length}</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 24 }}>
                {list.map((t) => (
                  <Card
                    key={t._id}
                    task={t}
                    draggable={canEdit}
                    onDragStart={(e) => { setDragId(t._id); e.dataTransfer.setData("text/plain", t._id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragId(null); setDragOver(null); }}
                    onClick={() => {
                      if (!canEdit) return;
                      setError(null);
                      setDraft({
                        _id: t._id,
                        title: t.title,
                        description: t.description ?? "",
                        status: t.status,
                        priority: t.priority,
                        assignee_id: t.assignee_id ?? "",
                        due_date: t.due_date ?? "",
                      });
                    }}
                  />
                ))}
                {list.length === 0 && (
                  <div className="muted small" style={{ padding: "10px 6px", textAlign: "center", opacity: 0.6 }}>
                    {active ? "Drop here" : "No tasks"}
                  </div>
                )}
              </div>

              {canCreate && (
                <button
                  className="portal-btn portal-btn-ghost"
                  style={{ width: "100%", marginTop: 10, fontSize: 12 }}
                  onClick={() => { setError(null); setDraft(emptyDraft(col.key)); }}
                >
                  + Add task
                </button>
              )}
            </div>
          );
        })}
      </div>

      {draft && (
        <TaskModal
          draft={draft}
          users={users}
          saving={saving}
          error={error}
          canDelete={canDelete && !!draft._id}
          onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
          onSubmit={saveDraft}
          onClose={() => { setDraft(null); setError(null); }}
          onDelete={draft._id ? () => { const id = draft._id!; setDraft(null); void removeTask(id); } : undefined}
        />
      )}
    </>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
function Card({
  task,
  draggable,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  task: TaskRecord;
  draggable: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const pr = PRIORITY[task.priority] ?? PRIORITY.medium;
  const overdue = !!task.due_date && task.status !== "done" && task.due_date < todayISO();
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        background: "#111827",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: "10px 11px",
        cursor: draggable ? "grab" : "pointer",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", lineHeight: 1.35, flex: 1 }}>
          {task.title}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: pr.color, background: pr.bg, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>
          {pr.label}
        </span>
      </div>
      {task.description && (
        <div className="muted small" style={{ marginTop: 5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {task.description}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        {task.assignee_name ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 18, height: 18, borderRadius: 999, background: "rgba(129,140,248,0.25)", color: "#c7d2fe", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              {initials(task.assignee_name)}
            </span>
            <span className="muted small">{task.assignee_name}</span>
          </span>
        ) : (
          <span className="muted small" style={{ opacity: 0.6 }}>Unassigned</span>
        )}
        {task.due_date && (
          <span className="small" style={{ marginLeft: "auto", color: overdue ? "#f87171" : "#94a3b8", fontWeight: overdue ? 700 : 400 }}>
            {overdue ? "⚠ " : ""}{task.due_date}
          </span>
        )}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function TaskModal({
  draft,
  users,
  saving,
  error,
  canDelete,
  onChange,
  onSubmit,
  onClose,
  onDelete,
}: {
  draft: Draft;
  users: BoardUser[];
  saving: boolean;
  error: string | null;
  canDelete: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 60, paddingBottom: 40, overflowY: "auto" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24, width: "min(560px, 92vw)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>{draft._id ? "Edit task" : "New task"}</h2>
          <button onClick={onClose} className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
        </div>

        <form onSubmit={onSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "span 2" }}>
            <label className="portal-label">Title <span style={{ color: "#f87171" }}>*</span></label>
            <input className="portal-input" autoFocus value={draft.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="What needs to get done?" />
          </div>

          <div style={{ gridColumn: "span 2" }}>
            <label className="portal-label">Description</label>
            <textarea className="portal-textarea" value={draft.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Details, links, context…" />
          </div>

          <div>
            <label className="portal-label">Status</label>
            <select className="portal-select" value={draft.status} onChange={(e) => onChange({ status: e.target.value as TaskStatus })}>
              {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>

          <div>
            <label className="portal-label">Priority</label>
            <select className="portal-select" value={draft.priority} onChange={(e) => onChange({ priority: e.target.value as TaskPriority })}>
              {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
            </select>
          </div>

          <div>
            <label className="portal-label">Assignee</label>
            <select className="portal-select" value={draft.assignee_id} onChange={(e) => onChange({ assignee_id: e.target.value })}>
              <option value="">— Unassigned —</option>
              {users.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select>
          </div>

          <div>
            <label className="portal-label">Due date</label>
            <input type="date" className="portal-input" value={draft.due_date} onChange={(e) => onChange({ due_date: e.target.value })} />
          </div>

          {error && <div className="portal-alert portal-alert-error" style={{ gridColumn: "span 2" }}>{error}</div>}

          <div style={{ gridColumn: "span 2", display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            {onDelete && canDelete && (
              <button type="button" className="portal-btn portal-btn-danger" onClick={onDelete}>Delete</button>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button type="button" className="portal-btn portal-btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="portal-btn portal-btn-primary" disabled={saving}>
                {saving ? "Saving…" : draft._id ? "Save changes" : "Create task"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
