"use client";

// Record a payment/payout and let the balance adjust automatically.
// "We paid them" reduces what the company owes (positive movement); "They paid
// us" reduces what they owe (negative). Optionally MATCH the payment to a real
// Plaid bank outflow OR a portal payout (finance_payout), so it's tied to a
// concrete record.

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fmt$ } from "../../format";

interface BankPayment {
  _id: string; date: string; description: string;
  merchant_name: string | null; amount: number; account_label: string; linked: boolean;
}
interface PayoutMatch {
  _id: string; recipient_name: string; recipient_role: string | null;
  period_start: string; period_end: string; net: number; status: string; linked: boolean;
}
type Linked =
  | { kind: "bank"; id: string; label: string }
  | { kind: "payout"; id: string; label: string }
  | null;

export default function RecordPaymentModal({
  ledgerId,
  holderName,
  currentBalance,
}: {
  ledgerId: string;
  holderName: string;
  currentBalance: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [direction, setDirection] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");

  // Matching
  const [panel, setPanel] = useState<"none" | "bank" | "payout">("none");
  const [query, setQuery] = useState(holderName);
  const [bankRows, setBankRows] = useState<BankPayment[]>([]);
  const [payoutRows, setPayoutRows] = useState<PayoutMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [linked, setLinked] = useState<Linked>(null);

  const signed = useMemo(() => {
    const a = Math.abs(parseFloat(amount));
    if (!Number.isFinite(a)) return null;
    return direction === "out" ? a : -a;
  }, [amount, direction]);
  const newBalance = signed != null ? currentBalance + signed : null;

  async function loadBank() {
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/ledger/bank-payments?q=${encodeURIComponent(query)}&limit=40`);
      const j = await r.json();
      setBankRows(Array.isArray(j.rows) ? j.rows : []);
    } catch { setBankRows([]); } finally { setLoading(false); }
  }
  async function loadPayouts() {
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/ledger/payouts?q=${encodeURIComponent(query)}&limit=40`);
      const j = await r.json();
      setPayoutRows(Array.isArray(j.rows) ? j.rows : []);
    } catch { setPayoutRows([]); } finally { setLoading(false); }
  }

  function openPanel(kind: "bank" | "payout") {
    setPanel(kind);
    if (kind === "bank" && bankRows.length === 0) loadBank();
    if (kind === "payout" && payoutRows.length === 0) loadPayouts();
  }

  function pickBank(t: BankPayment) {
    setLinked({ kind: "bank", id: t._id, label: `${t.date} · ${t.description} · ${fmt$(t.amount)} · ${t.account_label}` });
    setAmount(String(t.amount));
    setDate(t.date);
    setDirection("out");
    if (!note) setNote(t.description);
    setPanel("none");
  }
  function pickPayout(p: PayoutMatch) {
    const amt = Math.abs(p.net);
    setLinked({ kind: "payout", id: p._id, label: `${p.recipient_name} · ${p.period_start}→${p.period_end} · ${fmt$(amt)} (${p.status})` });
    setAmount(String(amt));
    setDate(p.period_end);
    setDirection("out");
    if (!note) setNote(`Payout · ${p.recipient_name} · ${p.period_start} → ${p.period_end}`);
    setPanel("none");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const a = Math.abs(parseFloat(amount));
      if (!Number.isFinite(a) || a === 0) throw new Error("Enter an amount");
      const signedAmount = direction === "out" ? a : -a;
      const desc = note.trim() ||
        (direction === "out" ? `Payment to ${holderName}` : `Payment from ${holderName}`);
      const res = await fetch(`/api/portal/ledger/${ledgerId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "payment",
          date,
          amount: signedAmount,
          description: desc,
          bank_txn_id: linked?.kind === "bank" ? linked.id : null,
          payout_id: linked?.kind === "payout" ? linked.id : null,
        }),
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

  return (
    <>
      <button className="portal-btn" onClick={() => setOpen(true)}>+ Record payment</button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 100, paddingTop: 50, paddingBottom: 40, overflowY: "auto",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{
              background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14,
              padding: 24, width: "min(580px, 95vw)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>Record payment</h2>
              <button onClick={() => setOpen(false)} className="portal-btn portal-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            <form onSubmit={onSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <label className="portal-label">Direction *</label>
                  <select className="portal-select" value={direction}
                    onChange={(e) => setDirection(e.target.value as "out" | "in")} required>
                    <option value="out">We paid them</option>
                    <option value="in">They paid us</option>
                  </select>
                </div>
                <div>
                  <label className="portal-label">Date *</label>
                  <input type="date" className="portal-input" required value={date}
                    onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <label className="portal-label">Amount (USD) *</label>
                  <input type="number" step="0.01" min="0" className="portal-input" required value={amount}
                    onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="portal-label">Note (optional)</label>
                  <input className="portal-input" value={note}
                    onChange={(e) => setNote(e.target.value)} placeholder="e.g. weekly settlement" />
                </div>
              </div>

              {newBalance != null && (
                <div className="portal-alert" style={{ marginBottom: 12, background: "rgba(99,102,241,0.10)", border: "1px solid rgba(99,102,241,0.25)" }}>
                  <span>→</span>
                  <div>
                    Balance {fmt$(currentBalance, { showSign: true })} →{" "}
                    <strong className={newBalance < -0.005 ? "money-neg" : newBalance > 0.005 ? "money-pos" : ""}>
                      {fmt$(newBalance, { showSign: true })}
                    </strong>
                  </div>
                </div>
              )}

              {/* Matching */}
              <div style={{ marginBottom: 14, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: 12 }}>
                {linked ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div className="small">
                      <span className="pill pill-paid" style={{ marginRight: 6 }}>
                        {linked.kind === "bank" ? "bank" : "payout"} matched
                      </span>
                      {linked.label}
                    </div>
                    <button type="button" className="portal-btn portal-btn-ghost"
                      style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => setLinked(null)}>Unlink</button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className={`portal-btn ${panel === "bank" ? "portal-btn-primary" : ""}`}
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => openPanel("bank")}>🔗 Match bank payment</button>
                      <button type="button" className={`portal-btn ${panel === "payout" ? "portal-btn-primary" : ""}`}
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => openPanel("payout")}>🔗 Match portal payout</button>
                      {panel !== "none" && (
                        <button type="button" className="portal-btn portal-btn-ghost"
                          style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setPanel("none")}>Hide</button>
                      )}
                    </div>

                    {panel !== "none" && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                          <input className="portal-input" value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={panel === "bank" ? "Search payee / description" : "Search recipient name"}
                            style={{ flex: 1 }} />
                          <button type="button" className="portal-btn" style={{ padding: "4px 10px", fontSize: 12 }}
                            onClick={panel === "bank" ? loadBank : loadPayouts} disabled={loading}>
                            {loading ? "…" : "Search"}
                          </button>
                        </div>
                        <div style={{ maxHeight: 200, overflowY: "auto" }}>
                          {panel === "bank" && (bankRows.length === 0 ? (
                            <div className="muted small" style={{ padding: 8 }}>{loading ? "Loading…" : "No matching bank outflows."}</div>
                          ) : bankRows.map((t) => (
                            <button type="button" key={t._id} onClick={() => pickBank(t)} style={rowStyle}>
                              <span style={ellipsis}>
                                <span className="mono">{t.date}</span> · {t.description}
                                {t.linked && <span className="pill pill-draft" style={{ marginLeft: 6 }}>already linked</span>}
                                <div className="muted" style={{ fontSize: 11 }}>{t.account_label}</div>
                              </span>
                              <span className="money money-neg" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{fmt$(t.amount)}</span>
                            </button>
                          )))}
                          {panel === "payout" && (payoutRows.length === 0 ? (
                            <div className="muted small" style={{ padding: 8 }}>{loading ? "Loading…" : "No matching payouts."}</div>
                          ) : payoutRows.map((p) => (
                            <button type="button" key={p._id} onClick={() => pickPayout(p)} style={rowStyle}>
                              <span style={ellipsis}>
                                <strong>{p.recipient_name}</strong>{p.recipient_role ? ` · ${p.recipient_role}` : ""}
                                {p.linked && <span className="pill pill-draft" style={{ marginLeft: 6 }}>already linked</span>}
                                <div className="muted" style={{ fontSize: 11 }}>
                                  <span className="mono">{p.period_start} → {p.period_end}</span> · {p.status}
                                </div>
                              </span>
                              <span className="money" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{fmt$(Math.abs(p.net))}</span>
                            </button>
                          )))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="portal-btn portal-btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Record payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", width: "100%", gap: 8, textAlign: "left",
  padding: "7px 8px", marginBottom: 4, cursor: "pointer", background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, color: "#cbd5e1", fontSize: 12.5,
};
const ellipsis: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function today(): string { return new Date().toISOString().slice(0, 10); }
