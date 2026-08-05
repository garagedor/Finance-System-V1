"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "date"
  | "select"
  | "combo"     // text input + datalist: pick a suggestion OR type a new value
  | "boolean";

export interface FieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | number | boolean;
  width?: "full" | "half";
  help?: string;
}

interface Props {
  endpoint: string;       // POST target, e.g. /api/portal/expenses
  title: string;
  fields: FieldDef[];
  triggerLabel?: string;
  /** When provided, edit mode: PUT to endpoint with existing _id. */
  initial?: Record<string, unknown> & { _id?: string };
  /** If set, render the trigger as a primary button; otherwise ghost. */
  primary?: boolean;
}

export default function EntryFormModal({
  endpoint,
  title,
  fields,
  triggerLabel,
  initial,
  primary,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = !!initial?._id;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const body: Record<string, unknown> = {};
      for (const f of fields) {
        const raw = fd.get(f.name);
        if (raw === null) {
          if (f.kind === "boolean") body[f.name] = false;
          continue;
        }
        if (f.kind === "number" || f.kind === "money") {
          const n = parseFloat(String(raw));
          body[f.name] = Number.isFinite(n) ? n : null;
        } else if (f.kind === "boolean") {
          body[f.name] = raw === "on" || raw === "true";
        } else {
          const v = String(raw).trim();
          body[f.name] = v === "" ? null : v;
        }
      }
      if (editing && initial?._id) body._id = initial._id;
      const res = await fetch(endpoint, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        className={`portal-btn ${primary ? "portal-btn-primary" : ""}`}
        onClick={() => setOpen(true)}
      >
        {triggerLabel ?? (editing ? "Edit" : "+ New")}
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            zIndex: 100,
            paddingTop: 60,
            paddingBottom: 40,
            overflowY: "auto",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            style={{
              background: "#111827",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14,
              padding: 24,
              width: "min(620px, 92vw)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>
                {editing ? `Edit ${title}` : `New ${title}`}
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="portal-btn portal-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={onSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {fields.map((f) => (
                <div
                  key={f.name}
                  style={{ gridColumn: f.width === "half" ? "span 1" : "span 2" }}
                >
                  <label className="portal-label">
                    {f.label}
                    {f.required && <span style={{ color: "#f87171", marginLeft: 4 }}>*</span>}
                  </label>
                  {renderField(f, initial?.[f.name])}
                  {f.help && (
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{f.help}</div>
                  )}
                </div>
              ))}
              {error && (
                <div className="portal-alert portal-alert-error" style={{ gridColumn: "span 2" }}>
                  {error}
                </div>
              )}
              <div style={{ gridColumn: "span 2", display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  type="button"
                  className="portal-btn portal-btn-ghost"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="portal-btn portal-btn-primary"
                  disabled={submitting}
                >
                  {submitting ? "Saving…" : editing ? "Save changes" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function renderField(f: FieldDef, currentValue: unknown) {
  const dv = currentValue !== undefined && currentValue !== null
    ? String(currentValue)
    : f.defaultValue !== undefined
      ? String(f.defaultValue)
      : "";
  if (f.kind === "textarea") {
    return (
      <textarea
        name={f.name}
        className="portal-textarea"
        placeholder={f.placeholder}
        required={f.required}
        defaultValue={dv}
      />
    );
  }
  if (f.kind === "select") {
    return (
      <select name={f.name} className="portal-select" required={f.required} defaultValue={dv}>
        <option value="">— select —</option>
        {f.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (f.kind === "combo") {
    const listId = `dl-${f.name}`;
    return (
      <>
        <input
          name={f.name}
          className="portal-input"
          list={listId}
          placeholder={f.placeholder ?? "Pick one or type a new one"}
          required={f.required}
          defaultValue={dv}
          autoComplete="off"
        />
        <datalist id={listId}>
          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </datalist>
      </>
    );
  }
  if (f.kind === "boolean") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          name={f.name}
          defaultChecked={currentValue === true || f.defaultValue === true}
          style={{ width: 16, height: 16 }}
        />
        <span style={{ fontSize: 13, color: "#94a3b8" }}>{f.help ?? "Yes"}</span>
      </div>
    );
  }
  const type = f.kind === "money" || f.kind === "number" ? "number" : f.kind;
  return (
    <input
      type={type}
      name={f.name}
      className="portal-input"
      placeholder={f.placeholder}
      required={f.required}
      defaultValue={dv}
      step={f.kind === "money" ? "0.01" : f.kind === "number" ? "any" : undefined}
    />
  );
}
