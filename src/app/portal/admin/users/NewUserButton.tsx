"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserType } from "@/types/user";

const TYPES: UserType[] = ["admin", "office", "location-manager", "simple", "bookkeeper"];

export default function NewUserButton({
  roles,
}: {
  roles: { _id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [type, setType] = useState<UserType>("simple");
  const [roleId, setRoleId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/portal/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          password,
          type,
          role_id: roleId || undefined,
          active: true,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setOpen(false);
      router.push(`/portal/admin/users/${encodeURIComponent(j.row._id)}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button className="portal-btn portal-btn-primary" onClick={() => setOpen(true)}>
        + New user
      </button>
    );
  }

  return (
    <div className="portal-modal-backdrop" onClick={() => !saving && setOpen(false)}>
      <form className="portal-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ maxWidth: 460 }}>
        <h3 style={{ margin: "0 0 6px 0" }}>Create user</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          The user will be able to log in immediately with this password.
        </p>

        <label className="portal-label">Username</label>
        <input required className="portal-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

        <label className="portal-label" style={{ marginTop: 10 }}>Password</label>
        <input
          required
          type="password"
          minLength={6}
          className="portal-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
        />

        <label className="portal-label" style={{ marginTop: 10 }}>Type</label>
        <select className="portal-select" value={type} onChange={(e) => setType(e.target.value as UserType)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <label className="portal-label" style={{ marginTop: 10 }}>Role</label>
        <select className="portal-select" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">Default for type</option>
          {roles.map((r) => (
            <option key={r._id} value={r._id}>{r.name}</option>
          ))}
        </select>

        {error && <div className="portal-alert portal-alert-error" style={{ marginTop: 12 }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" className="portal-btn" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="portal-btn portal-btn-primary" disabled={saving || !name.trim() || password.length < 6}>
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
