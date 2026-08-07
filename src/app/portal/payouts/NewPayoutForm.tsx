"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PayoutComponentKind, PayoutLineItem, PayoutProfile, PayoutRecord } from "@/types/finance";

export interface PayoutLedgerOption {
  _id: string;
  holder_name: string;
  role: string;
  location?: string;
}

const KIND_OPTIONS: Array<{ value: PayoutComponentKind; label: string }> = [
  { value: "base_salary", label: "Base salary" },
  { value: "fixed_bonus", label: "Fixed bonus" },
  { value: "commission_pct", label: "Commission %" },
  { value: "follow_up_commission", label: "Follow-up commission" },
  { value: "parts_margin_commission", label: "Parts margin commission" },
  { value: "area_manager_payout", label: "Area manager payout" },
  { value: "provider_payout", label: "Provider payout" },
  { value: "deduction", label: "Deduction (−)" },
  { value: "reimbursement", label: "Reimbursement" },
  { value: "advance", label: "Advance" },
  { value: "manual_adjustment", label: "Manual adjustment" },
  { value: "penalty", label: "Penalty (−)" },
  { value: "expense_deduction", label: "Expense deduction (−)" },
];

const NEGATIVE_KINDS = new Set(["deduction", "penalty", "expense_deduction"]);
const ROLE_LABEL: Record<string, string> = { area_manager: "Area Manager", technician: "Technician" };

export default function NewPayoutForm({
  profiles,
  ledgers = [],
  initial,
  triggerLabel,
  triggerPrimary,
}: {
  profiles: PayoutProfile[];
  ledgers?: PayoutLedgerOption[];
  initial?: PayoutRecord;
  triggerLabel?: string;
  triggerPrimary?: boolean;
}) {
  const router = useRouter();
  const editing = !!initial;
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [recipient, setRecipient] = useState({
    id: initial?.recipient_id ?? "",
    name: initial?.recipient_name ?? "",
    role: initial?.recipient_role ?? "",
  });
  const [profileId, setProfileId] = useState(initial?.profile_id ?? "");
  const [ledgerId, setLedgerId] = useState(initial?.ledger_id ?? "");
  const [period, setPeriod] = useState({
    start: initial?.period_start ?? firstOfMonth(),
    end: initial?.period_end ?? today(),
  });
  const [paymentMethod, setPaymentMethod] = useState<string>(initial?.payment_method ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [items, setItems] = useState<PayoutLineItem[]>(
    initial?.line_items?.length ? initial.line_items : [{ id: localId(), kind: "base_salary", label: "Base salary", amount: 0 }],
  );

  // Prefill line items from a profile — but ONLY on a user change, never on the
  // initial mount (which would clobber an edited payout's real line items).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!profileId) return;
    const profile = profiles.find((p) => p._id === profileId);
    if (!profile) return;
    setItems(profile.components.map((c) => ({
      id: localId(), kind: c.kind, label: c.label,
      amount: c.default_amount !== undefined ? (NEGATIVE_KINDS.has(c.kind) ? -Math.abs(c.default_amount) : c.default_amount) : 0,
      notes: c.notes,
    })));
  }, [profileId, profiles]);

  const gross = items.filter((i) => i.amount >= 0).reduce((s, i) => s + i.amount, 0);
  const deductions = Math.abs(items.filter((i) => i.amount < 0).reduce((s, i) => s + i.amount, 0));
  const net = gross - deductions;

  const addItem = () => setItems([...items, { id: localId(), kind: "manual_adjustment", label: "Manual adjustment", amount: 0 }]);
  const updateItem = (id: string, patch: Partial<PayoutLineItem>) =>
    setItems((cur) => cur.map((i) => {
      if (i.id !== id) return i;
      const updated = { ...i, ...patch };
      if (patch.kind && NEGATIVE_KINDS.has(patch.kind) && updated.amount > 0) updated.amount = -updated.amount;
      return updated;
    }));
  const removeItem = (id: string) => setItems((cur) => cur.filter((i) => i.id !== id));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      if (!recipient.name) { setErr("Recipient name is required"); return; }
      const body: Record<string, unknown> = {
        recipient_id: recipient.id || recipient.name.toLowerCase().replace(/\s+/g, "_"),
        recipient_name: recipient.name,
        recipient_role: recipient.role || null,
        profile_id: profileId || null,
        period_start: period.start,
        period_end: period.end,
        line_items: items,
        payment_method: paymentMethod || null,
        notes: notes || null,
        ledger_id: ledgerId || null,
      };
      if (!editing) body.status = "unpaid";
      const res = await fetch(
        editing ? `/api/portal/payouts/${initial!._id}` : "/api/portal/payouts",
        { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        className={`portal-btn ${triggerPrimary || !editing ? "portal-btn-primary" : ""}`}
        style={editing ? { padding: "4px 10px", fontSize: 11 } : undefined}
        onClick={() => setOpen(true)}
      >
        {triggerLabel ?? (editing ? "Edit" : "+ New payout")}
      </button>

      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 40, paddingBottom: 40, overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24, width: "min(820px, 95vw)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{editing ? `Edit payout · ${initial!.recipient_name}` : "New payout"}</h2>
              <button onClick={() => setOpen(false)} className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            <form onSubmit={onSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <label className="portal-label">Recipient name *</label>
                  <input className="portal-input" required value={recipient.name}
                    onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} placeholder="e.g. Eliya Buchnik" />
                </div>
                <div>
                  <label className="portal-label">Role</label>
                  <input className="portal-input" value={recipient.role}
                    onChange={(e) => setRecipient({ ...recipient, role: e.target.value })} placeholder="e.g. Area Manager" />
                </div>
                <div>
                  <label className="portal-label">Profile (optional)</label>
                  <select className="portal-select" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                    <option value="">— none —</option>
                    {profiles.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div>
                  <label className="portal-label">Period start *</label>
                  <input type="date" className="portal-input" required value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} />
                </div>
                <div>
                  <label className="portal-label">Period end *</label>
                  <input type="date" className="portal-input" required value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} />
                </div>
                <div>
                  <label className="portal-label">Payment method</label>
                  <select className="portal-select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="">—</option>
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="ach">ACH</option>
                    <option value="wire">Wire</option>
                    <option value="zelle">Zelle</option>
                    <option value="venmo">Venmo</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              {/* Ledger link */}
              <div style={{ marginBottom: 14 }}>
                <label className="portal-label">Ledger (posts a payment here when marked paid)</label>
                <select className="portal-select" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
                  <option value="">— none (don&apos;t post to a ledger) —</option>
                  {ledgers.map((l) => (
                    <option key={l._id} value={l._id}>
                      {l.holder_name}{l.role ? ` · ${ROLE_LABEL[l.role] ?? l.role}` : ""}{l.location ? ` · ${l.location}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 14, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div className="portal-section-label">Line items</div>
                  <button type="button" className="portal-btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={addItem}>+ Add line</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {items.map((item) => (
                    <div key={item.id} style={{ display: "grid", gridTemplateColumns: "180px 1fr 130px auto", gap: 8, alignItems: "center" }}>
                      <select className="portal-select" value={item.kind} onChange={(e) => updateItem(item.id, { kind: e.target.value as PayoutComponentKind })}>
                        {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </select>
                      <input className="portal-input" placeholder="Label / notes" value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} />
                      <input type="number" step="0.01" className="portal-input" placeholder="0.00" value={item.amount}
                        onChange={(e) => { const v = parseFloat(e.target.value); const signed = NEGATIVE_KINDS.has(item.kind) ? -Math.abs(v || 0) : (v || 0); updateItem(item.id, { amount: signed }); }}
                        style={{ textAlign: "right" }} />
                      <button type="button" onClick={() => removeItem(item.id)} className="portal-btn portal-btn-ghost" style={{ padding: "4px 8px", fontSize: 12 }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 10, padding: "12px 14px", marginBottom: 12, display: "flex", gap: 24, justifyContent: "space-between" }}>
                <span style={{ color: "#94a3b8", fontSize: 13 }}>Gross</span>
                <span className="money" style={{ fontWeight: 600 }}>${gross.toFixed(2)}</span>
                <span style={{ color: "#94a3b8", fontSize: 13 }}>Deductions</span>
                <span className="money money-neg" style={{ fontWeight: 600 }}>−${deductions.toFixed(2)}</span>
                <span style={{ color: "#cbd5e1", fontSize: 14, fontWeight: 600 }}>Net</span>
                <span className="money" style={{ fontSize: 16, fontWeight: 700, color: net >= 0 ? "#10b981" : "#ef4444" }}>${net.toFixed(2)}</span>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label className="portal-label">Notes</label>
                <textarea className="portal-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="portal-btn portal-btn-primary" disabled={submitting}>
                  {submitting ? "Saving…" : editing ? "Save changes" : "Create payout"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function firstOfMonth(): string { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
function localId(): string { return "L" + Math.random().toString(36).slice(2, 10); }
