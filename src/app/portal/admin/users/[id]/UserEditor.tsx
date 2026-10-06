"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Permission, PermissionDef } from "@/types/rbac";
import type { UserType } from "@/types/user";

const TYPES: UserType[] = ["admin", "office", "location-manager", "simple", "bookkeeper"];

interface GroupedModule {
  module: string;
  moduleLabel: string;
  sections: { section: string; perms: PermissionDef[] }[];
}

interface UserShape {
  _id: string;
  name: string;
  type: UserType;
  role_id?: string;
  active: boolean;
  extra_permissions: Permission[];
  denied_permissions: Permission[];
}

export default function UserEditor({
  user,
  roles,
  rolePerms,
  grouped,
  canEdit,
  canDelete,
  canResetPassword,
  isSelf,
}: {
  user: UserShape;
  roles: { _id: string; name: string }[];
  rolePerms: Permission[];
  grouped: GroupedModule[];
  canEdit: boolean;
  canDelete: boolean;
  canResetPassword: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [type, setType] = useState<UserType>(user.type);
  const [roleId, setRoleId] = useState(user.role_id ?? "");
  const [active, setActive] = useState(user.active);
  const [extras, setExtras] = useState<Set<Permission>>(new Set(user.extra_permissions));
  const [denied, setDenied] = useState<Set<Permission>>(new Set(user.denied_permissions));
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fromRole = useMemo(() => new Set(rolePerms), [rolePerms]);

  // Permission state for a key — the matrix shows three colours:
  //   role-granted (default state) · extra (green) · denied (red) · neutral (off)
  function stateFor(key: Permission): "role" | "extra" | "denied" | "off" {
    if (denied.has(key)) return "denied";
    if (extras.has(key)) return "extra";
    if (fromRole.has(key)) return "role";
    return "off";
  }

  function cycle(key: Permission) {
    if (!canEdit) return;
    const s = stateFor(key);
    if (s === "off") {
      setExtras((g) => new Set(g).add(key));
    } else if (s === "extra") {
      setExtras((g) => {
        const next = new Set(g);
        next.delete(key);
        return next;
      });
    } else if (s === "role") {
      setDenied((g) => new Set(g).add(key));
    } else if (s === "denied") {
      setDenied((g) => {
        const next = new Set(g);
        next.delete(key);
        return next;
      });
    }
  }

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: Record<string, unknown> = {
        _id: user._id,
        name: name.trim(),
        type,
        role_id: roleId || null,
        active,
        extra_permissions: [...extras],
        denied_permissions: [...denied],
      };
      if (newPassword.length > 0) payload.new_password = newPassword;
      const res = await fetch("/api/portal/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Save failed");
      setNewPassword("");
      setSuccess("Saved. New permissions take effect on next login.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!canDelete) return;
    if (!confirm(`Delete user "${user.name}"? This cannot be undone.`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/admin/users?_id=${encodeURIComponent(user._id)}`, {
        method: "DELETE",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Delete failed");
      router.push("/portal/admin/users");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setSaving(false);
    }
  }

  const chipColours = {
    role:    { bg: "var(--ds-info-wash)", border: "var(--ds-info-line)", text: "var(--ds-info-text)" }, // from role
    extra:   { bg: "var(--ds-ok-wash)", border: "var(--ds-ok-line)", text: "var(--ds-ok-text)" }, // extra grant
    denied:  { bg: "var(--ds-crit-wash)", border: "var(--ds-crit-line)", text: "var(--ds-crit-text)" }, // denied
    off:     { bg: "transparent", border: "var(--ds-line)", text: "var(--ds-ink-2)" },
  } as const;

  return (
    <div style={{ padding: 0 }}>
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--ds-line)", display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="portal-label">Name</span>
          <input className="portal-input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="portal-label">Type (legacy)</span>
          <select className="portal-select" value={type} onChange={(e) => setType(e.target.value as UserType)} disabled={!canEdit}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="portal-label">Role</span>
          <select className="portal-select" value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={!canEdit}>
            <option value="">No role</option>
            {roles.map((r) => (
              <option key={r._id} value={r._id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="portal-label">Status</span>
          <select
            className="portal-select"
            value={active ? "active" : "inactive"}
            onChange={(e) => setActive(e.target.value === "active")}
            disabled={!canEdit || isSelf}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive (cannot log in)</option>
          </select>
          {isSelf && <span className="muted small">You cannot deactivate your own account.</span>}
        </label>
        {canResetPassword && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
            <span className="portal-label">Reset password (leave blank to keep current)</span>
            <input
              type="password"
              className="portal-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 6 chars)"
              disabled={!canEdit}
            />
          </label>
        )}
      </div>

      <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--ds-line)", fontSize: 12, color: "var(--ds-ink-2)" }}>
        <strong style={{ color: "var(--ds-ink)" }}>Custom permissions:</strong>{" "}
        Click a permission to cycle: off → <span style={{ color: "var(--ds-ok-text)" }}>extra grant</span> → <span style={{ color: "var(--ds-info-text)" }}>from role</span> → <span style={{ color: "var(--ds-crit-text)" }}>denied</span> → off. Role-granted permissions appear pre-coloured.
      </div>

      {grouped.map((mod) => (
        <div key={mod.module}>
          <div style={{ padding: "10px 18px", background: "var(--ds-surface-2)", borderBottom: "1px solid var(--ds-line)" }}>
            <strong>{mod.moduleLabel}</strong>
          </div>
          {mod.sections.map((sec) => (
            <div
              key={`${mod.module}:${sec.section}`}
              style={{
                padding: "10px 18px",
                display: "grid",
                gridTemplateColumns: "180px 1fr",
                gap: 16,
                borderBottom: "1px solid var(--ds-line)",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 13, color: "var(--ds-ink)", textTransform: "capitalize" }}>
                {sec.section.replace(/_/g, " ")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {sec.perms.map((p) => {
                  const s = stateFor(p.key);
                  const col = chipColours[s];
                  return (
                    <button
                      key={p.key}
                      onClick={() => cycle(p.key)}
                      disabled={!canEdit}
                      title={p.description ?? p.label}
                      style={{
                        padding: "4px 10px",
                        fontSize: 12,
                        border: `1px solid ${col.border}`,
                        background: col.bg,
                        color: col.text,
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
      ))}

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
          background: "var(--ds-surface-1)",
          borderTop: "1px solid var(--ds-line)",
          padding: "12px 18px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div>
          {canDelete && (
            <button className="portal-btn" onClick={remove} disabled={saving} style={{ color: "var(--ds-crit-text)" }}>
              Delete user
            </button>
          )}
        </div>
        <button
          className="portal-btn portal-btn-primary"
          onClick={save}
          disabled={!canEdit || saving || !name.trim()}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
