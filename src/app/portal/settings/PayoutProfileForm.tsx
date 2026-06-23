"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PayoutComponentKind, PayoutComponentTemplate, PayoutProfile } from "@/types/finance";

const KINDS: Array<{ value: PayoutComponentKind; label: string }> = [
  { value: "base_salary", label: "Base salary" },
  { value: "fixed_bonus", label: "Fixed bonus" },
  { value: "commission_pct", label: "Commission %" },
  { value: "follow_up_commission", label: "Follow-up commission" },
  { value: "parts_margin_commission", label: "Parts margin commission" },
  { value: "area_manager_payout", label: "AM payout" },
  { value: "provider_payout", label: "Provider payout" },
  { value: "deduction", label: "Deduction (−)" },
  { value: "reimbursement", label: "Reimbursement" },
  { value: "advance", label: "Advance" },
  { value: "manual_adjustment", label: "Manual adjustment" },
  { value: "penalty", label: "Penalty (−)" },
  { value: "expense_deduction", label: "Expense deduction (−)" },
];

export default function PayoutProfileForm({ initial }: { initial?: PayoutProfile }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [appliesTo, setAppliesTo] = useState(initial?.applies_to_role ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [components, setComponents] = useState<PayoutComponentTemplate[]>(
    initial?.components ?? [{ id: localId(), kind: "base_salary", label: "Base salary" }]
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addComp = () => {
    setComponents([...components, { id: localId(), kind: "manual_adjustment", label: "" }]);
  };
  const updateComp = (id: string, patch: Partial<PayoutComponentTemplate>) => {
    setComponents((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const removeComp = (id: string) => setComponents((c) => c.filter((x) => x.id !== id));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = { name, description, applies_to_role: appliesTo || null, components, active };
      const url = "/api/portal/payout-profiles";
      const init: RequestInit = {
        method: initial?._id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initial?._id ? { ...body, _id: initial._id } : body),
      };
      const res = await fetch(url, init);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className={`portal-btn ${initial ? "" : "portal-btn-primary"}`}
        style={initial ? { padding: "4px 10px", fontSize: 12 } : {}}
        onClick={() => setOpen(true)}
      >
        {initial ? "Edit" : "+ New profile"}
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 100, paddingTop: 40, paddingBottom: 40, overflowY: "auto",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{
              background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14,
              padding: 24, width: "min(760px, 95vw)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                {initial ? "Edit payout profile" : "New payout profile"}
              </h2>
              <button onClick={() => setOpen(false)} className="portal-btn portal-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            <form onSubmit={onSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div>
                  <label className="portal-label">Profile name *</label>
                  <input className="portal-input" required value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Area Manager 40%, Installer Plan A" />
                </div>
                <div>
                  <label className="portal-label">Applies to role (optional)</label>
                  <input className="portal-input" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}
                    placeholder="e.g. area_manager, installer" />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label className="portal-label">Description</label>
                <textarea className="portal-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>

              <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 14, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div className="portal-section-label">Payout components</div>
                  <button type="button" className="portal-btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={addComp}>
                    + Add component
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {components.map((c) => (
                    <div key={c.id} style={{
                      display: "grid",
                      gridTemplateColumns: "180px 1fr 100px 100px auto",
                      gap: 8,
                      alignItems: "center",
                    }}>
                      <select className="portal-select" value={c.kind}
                        onChange={(e) => updateComp(c.id, { kind: e.target.value as PayoutComponentKind })}>
                        {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </select>
                      <input className="portal-input" placeholder="Label"
                        value={c.label}
                        onChange={(e) => updateComp(c.id, { label: e.target.value })} />
                      <input type="number" step="0.01" className="portal-input" placeholder="$ default"
                        value={c.default_amount ?? ""}
                        onChange={(e) => updateComp(c.id, { default_amount: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
                        style={{ textAlign: "right" }} />
                      <input type="number" step="0.001" className="portal-input" placeholder="rate"
                        value={c.default_rate ?? ""}
                        onChange={(e) => updateComp(c.id, { default_rate: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
                        style={{ textAlign: "right" }} />
                      <button type="button" onClick={() => removeComp(c.id)}
                        className="portal-btn portal-btn-ghost" style={{ padding: "4px 8px", fontSize: 12 }}>✕</button>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
                  Each component becomes a line item when a payout is created from this profile. Default amount/rate is just a starting value.
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                  <span>Active (selectable when creating payouts)</span>
                </label>
              </div>

              {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="portal-btn portal-btn-primary" disabled={busy}>
                  {busy ? "Saving…" : initial ? "Save changes" : "Create profile"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function localId(): string { return "C" + Math.random().toString(36).slice(2, 10); }
