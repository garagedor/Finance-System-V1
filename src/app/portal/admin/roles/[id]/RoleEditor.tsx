"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Permission, PermissionDef, RoleRecord } from "@/types/rbac";

interface GroupedModule {
  module: string;
  moduleLabel: string;
  sections: { section: string; perms: PermissionDef[] }[];
}

export default function RoleEditor({
  role,
  grouped,
  canEdit,
  canDelete,
}: {
  role: RoleRecord;
  grouped: GroupedModule[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const initialPerms = useMemo(() => new Set<Permission>(role.permissions), [role.permissions]);
  const [granted, setGranted] = useState<Set<Permission>>(new Set(initialPerms));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dirty = useMemo(() => {
    if (name !== role.name) return true;
    if ((description || undefined) !== role.description) return true;
    if (granted.size !== initialPerms.size) return true;
    for (const p of granted) if (!initialPerms.has(p)) return true;
    return false;
  }, [name, description, granted, initialPerms, role.name, role.description]);

  function toggle(key: Permission) {
    if (!canEdit) return;
    setGranted((g) => {
      const next = new Set(g);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setMany(keys: Permission[], on: boolean) {
    if (!canEdit) return;
    setGranted((g) => {
      const next = new Set(g);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/portal/admin/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _id: role._id,
          name: name.trim(),
          description: description.trim() || undefined,
          permissions: [...granted],
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Save failed");
      setSuccess("Saved. Affected users get the new permissions on their next login.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!canDelete) return;
    if (!confirm(`Delete role "${role.name}"? Users assigned this role must be reassigned first.`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/admin/roles?_id=${encodeURIComponent(role._id)}`, {
        method: "DELETE",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Delete failed");
      router.push("/portal/admin/roles");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setSaving(false);
    }
  }

  const totalPerms = grouped.reduce(
    (sum, m) => sum + m.sections.reduce((s, sec) => s + sec.perms.length, 0),
    0
  );

  return (
    <div style={{ padding: 0 }}>
      <div style={{ padding: "16px 18px", borderBottom: "1px solid #1f2940", display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="portal-label">Name</span>
          <input
            className="portal-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="portal-label">Description</span>
          <input
            className="portal-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit}
            placeholder="What this role is for"
          />
        </label>
      </div>

      <div style={{ padding: "12px 18px", display: "flex", gap: 8, flexWrap: "wrap", borderBottom: "1px solid #1f2940" }}>
        <button
          className="portal-btn"
          onClick={() => setMany(grouped.flatMap((m) => m.sections.flatMap((s) => s.perms.map((p) => p.key))), true)}
          disabled={!canEdit}
        >
          Grant all
        </button>
        <button
          className="portal-btn"
          onClick={() => setMany(grouped.flatMap((m) => m.sections.flatMap((s) => s.perms.map((p) => p.key))), false)}
          disabled={!canEdit}
        >
          Revoke all
        </button>
        <button
          className="portal-btn"
          onClick={() =>
            setMany(
              grouped.flatMap((m) =>
                m.sections.flatMap((s) => s.perms.filter((p) => p.action === "view").map((p) => p.key))
              ),
              true
            )
          }
          disabled={!canEdit}
        >
          Grant all view-only
        </button>
        <div style={{ marginLeft: "auto", alignSelf: "center", fontSize: 12, color: "#94a3b8" }}>
          {granted.size} / {totalPerms} permissions
        </div>
      </div>

      {grouped.map((mod) => {
        const moduleKeys = mod.sections.flatMap((s) => s.perms.map((p) => p.key));
        const moduleGrantedCount = moduleKeys.filter((k) => granted.has(k)).length;
        const moduleAll = moduleGrantedCount === moduleKeys.length;
        const moduleNone = moduleGrantedCount === 0;
        return (
          <div key={mod.module}>
            <div
              style={{
                padding: "10px 18px",
                background: "#0c1426",
                borderBottom: "1px solid #1f2940",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <strong>{mod.moduleLabel}</strong>
              <span className="muted small">
                ({moduleGrantedCount} / {moduleKeys.length})
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button
                  className="portal-btn"
                  style={{ padding: "3px 8px", fontSize: 11 }}
                  onClick={() => setMany(moduleKeys, true)}
                  disabled={!canEdit || moduleAll}
                >
                  All
                </button>
                <button
                  className="portal-btn"
                  style={{ padding: "3px 8px", fontSize: 11 }}
                  onClick={() => setMany(moduleKeys, false)}
                  disabled={!canEdit || moduleNone}
                >
                  None
                </button>
              </div>
            </div>

            {mod.sections.map((sec) => (
              <div
                key={`${mod.module}:${sec.section}`}
                style={{
                  padding: "10px 18px",
                  display: "grid",
                  gridTemplateColumns: "180px 1fr",
                  gap: 16,
                  borderBottom: "1px solid #131a2b",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 13, color: "#cbd5e1", textTransform: "capitalize" }}>
                  {sec.section.replace(/_/g, " ")}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {sec.perms.map((p) => {
                    const on = granted.has(p.key);
                    return (
                      <button
                        key={p.key}
                        onClick={() => toggle(p.key)}
                        disabled={!canEdit}
                        title={p.description ?? p.label}
                        className={`portal-chip ${on ? "portal-chip-on" : ""}`}
                        style={{
                          padding: "4px 10px",
                          fontSize: 12,
                          border: "1px solid",
                          borderColor: on ? "#6366f1" : "#1f2940",
                          background: on ? "#1e1f4d" : "transparent",
                          color: on ? "#e0e7ff" : "#94a3b8",
                          borderRadius: 6,
                          cursor: canEdit ? "pointer" : "not-allowed",
                          fontFamily: "inherit",
                        }}
                      >
                        {p.action}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {(error || success) && (
        <div style={{ padding: "10px 18px" }}>
          {error && <div className="portal-alert portal-alert-error">{error}</div>}
          {success && <div className="portal-alert portal-alert-info">{success}</div>}
        </div>
      )}

      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "#0a0f1c",
          borderTop: "1px solid #1f2940",
          padding: "12px 18px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div>
          {canDelete && (
            <button className="portal-btn" onClick={remove} disabled={saving} style={{ color: "#f87171" }}>
              Delete role
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {dirty && (
            <span className="muted small" style={{ alignSelf: "center" }}>
              Unsaved changes
            </span>
          )}
          <button
            className="portal-btn portal-btn-primary"
            onClick={save}
            disabled={!canEdit || !dirty || saving || !name.trim()}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
