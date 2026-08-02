"use client";

// Record (or edit) an expense that is PUSHED TO a ledger. Picking a ledger and
// saving posts +expense here and a matching +amount "payment" on that holder's
// ledger (we paid them). Editing re-syncs the ledger entry; deleting (via
// RowActions on the linked endpoint) reverses it. See /api/portal/expenses/from-ledger.

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type LedgerOption = {
  _id: string;
  holder_name: string;
  location: string;
  role: "area_manager" | "technician";
};

const CATEGORY_OPTIONS = [
  { value: "installer_payment", label: "Installer Payments" },
  { value: "manager_salary", label: "Manager Salaries" },
  { value: "payroll", label: "Payroll" },
  { value: "equipment_purchase", label: "Equipment Purchases" },
  { value: "parts_purchase", label: "Parts Purchases" },
  { value: "refund", label: "Refunds" },
  { value: "misc", label: "Miscellaneous" },
];
const PAYMENT_METHODS = [
  { value: "", label: "—" },
  { value: "cash", label: "Cash" }, { value: "card", label: "Card" },
  { value: "check", label: "Check" }, { value: "ach", label: "ACH" },
  { value: "wire", label: "Wire" }, { value: "zelle", label: "Zelle" },
  { value: "venmo", label: "Venmo" }, { value: "other", label: "Other" },
];

const ENDPOINT = "/api/portal/expenses/from-ledger";
const today = () => new Date().toISOString().slice(0, 10);

type Initial = {
  _id: string;
  ledger_id?: string;
  ledger_holder?: string;
  amount: number;
  date: string;
  description?: string;
  category?: string;
  payment_method?: string;
  related_area?: string;
  status?: string;
  notes?: string;
};

export default function LedgerExpenseModal({
  ledgers,
  initial,
  triggerLabel,
  primary,
}: {
  ledgers: LedgerOption[];
  initial?: Initial;
  triggerLabel?: string;
  primary?: boolean;
}) {
  const router = useRouter();
  const editing = !!initial?._id;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [ledgerId, setLedgerId] = useState(initial?.ledger_id ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [date, setDate] = useState(initial?.date ?? today());
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "installer_payment");
  const [paymentMethod, setPaymentMethod] = useState(initial?.payment_method ?? "");
  const [status, setStatus] = useState(initial?.status ?? "paid");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [touchedDesc, setTouchedDesc] = useState(editing);

  const chosen = useMemo(() => ledgers.find((l) => l._id === ledgerId), [ledgers, ledgerId]);

  function pickLedger(id: string) {
    setLedgerId(id);
    const l = ledgers.find((x) => x._id === id);
    if (l && !touchedDesc) setDescription(`Paid ${l.holder_name}`);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const a = Math.abs(parseFloat(amount));
      if (!Number.isFinite(a) || a === 0) throw new Error("Enter an amount");
      if (!editing && !ledgerId) throw new Error("Pick a ledger");
      const payload: Record<string, unknown> = {
        amount: a, date, description: description.trim(), category,
        payment_method: paymentMethod || null, status, notes: notes.trim() || null,
      };
      if (editing) payload._id = initial!._id;
      else payload.ledger_id = ledgerId;

      const res = await fetch(ENDPOINT, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const holderLabel = chosen
    ? `${chosen.holder_name} · ${chosen.location} · ${chosen.role === "technician" ? "Tech" : "AM"}`
    : initial?.ledger_holder ?? "—";

  return (
    <>
      <button
        className={`portal-btn ${primary ? "portal-btn-primary" : ""}`}
        onClick={() => setOpen(true)}
        style={editing ? { padding: "4px 10px", fontSize: 11 } : undefined}
      >
        {triggerLabel ?? (editing ? "Edit" : "+ To a ledger")}
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 100, paddingTop: 56, paddingBottom: 40, overflowY: "auto",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24, width: "min(600px, 94vw)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>
                {editing ? "Edit ledger expense" : "Expense to a ledger"}
              </h2>
              <button onClick={() => setOpen(false)} className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>
            <p className="muted small" style={{ marginTop: 0, marginBottom: 16 }}>
              Records +expense here and a matching +{amount || "0"} on the holder&apos;s ledger (we paid them).
            </p>

            <form onSubmit={onSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "span 2" }}>
                <label className="portal-label">Ledger (who we paid) {!editing && <span style={{ color: "#f87171" }}>*</span>}</label>
                {editing ? (
                  <input className="portal-input" value={holderLabel} disabled style={{ opacity: 0.7 }} />
                ) : (
                  <select className="portal-select" value={ledgerId} onChange={(e) => pickLedger(e.target.value)} required>
                    <option value="">— select a ledger —</option>
                    {ledgers.map((l) => (
                      <option key={l._id} value={l._id}>
                        {l.holder_name} · {l.location} · {l.role === "technician" ? "Tech" : "AM"}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="portal-label">Amount (USD) <span style={{ color: "#f87171" }}>*</span></label>
                <input type="number" step="0.01" min="0" className="portal-input" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="portal-label">Date <span style={{ color: "#f87171" }}>*</span></label>
                <input type="date" className="portal-input" required value={date} onChange={(e) => setDate(e.target.value)} />
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <label className="portal-label">Description (how it appears in expenses)</label>
                <input className="portal-input" value={description}
                  onChange={(e) => { setDescription(e.target.value); setTouchedDesc(true); }}
                  placeholder="e.g. Paid Minneapolis AM" />
              </div>

              <div>
                <label className="portal-label">Category</label>
                <select className="portal-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="portal-label">Payment method</label>
                <select className="portal-select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div>
                <label className="portal-label">Status</label>
                <select className="portal-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="paid">Paid</option>
                  <option value="unpaid">Unpaid</option>
                </select>
              </div>
              <div>
                <label className="portal-label">Notes</label>
                <input className="portal-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>

              {err && <div className="portal-alert portal-alert-error" style={{ gridColumn: "span 2" }}>{err}</div>}

              <div style={{ gridColumn: "span 2", display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                <button type="button" className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="portal-btn portal-btn-primary" disabled={busy}>
                  {busy ? "Saving…" : editing ? "Save changes" : "Record expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
