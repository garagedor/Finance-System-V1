"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewRoleButton({
  roles,
}: {
  roles: { _id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cloneFromId, setCloneFromId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/portal/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
          clone_from_id: cloneFromId || undefined,
          permissions: [],
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setOpen(false);
      router.push(`/portal/admin/roles/${j.row._id}`);
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
        + New role
      </button>
    );
  }

  return (
    <div className="portal-modal-backdrop" onClick={() => !saving && setOpen(false)}>
      <form
        className="portal-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ maxWidth: 460 }}
      >
        <h3 style={{ margin: "0 0 6px 0" }}>Create role</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Optionally clone from an existing role to inherit its permissions, then edit.
        </p>

        <label className="portal-label">Name</label>
        <input
          required
          className="portal-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Senior Bookkeeper"
        />

        <label className="portal-label" style={{ marginTop: 10 }}>Description (optional)</label>
        <input
          className="portal-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this role is for"
        />

        <label className="portal-label" style={{ marginTop: 10 }}>Start from</label>
        <select
          className="portal-select"
          value={cloneFromId}
          onChange={(e) => setCloneFromId(e.target.value)}
        >
          <option value="">Empty (no permissions)</option>
          {roles.map((r) => (
            <option key={r._id} value={r._id}>Clone from: {r.name}</option>
          ))}
        </select>

        {error && (
          <div className="portal-alert portal-alert-error" style={{ marginTop: 12 }}>{error}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" className="portal-btn" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="portal-btn portal-btn-primary" disabled={saving || !name.trim()}>
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
