"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";

interface Suggestion {
  kind: string;
  id: string;
  label: string;
  amount: number;
  date: string;
  party?: string;
  status?: string;
  score: number;
  breakdown: { amount: number; date: number; text: number; direction: number };
}

interface Props {
  unmatched: BankTransactionSyncedRecord[];
}

export default function ReconcileClient({ unmatched }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTxn = searchParams.get("txn");
  const [activeTxnId, setActiveTxnId] = useState<string | null>(initialTxn);
  const [activeTxn, setActiveTxn] = useState<BankTransactionSyncedRecord | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flipToPaid, setFlipToPaid] = useState(true);

  const loadSuggestions = useCallback(async (txnId: string) => {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    try {
      const res = await fetch(`/api/portal/reconcile/suggest?bank_txn_id=${encodeURIComponent(txnId)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setActiveTxn(j.txn);
      setSuggestions(j.suggestions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTxnId) loadSuggestions(activeTxnId);
  }, [activeTxnId, loadSuggestions]);

  const confirmMatch = async (s: Suggestion) => {
    if (!activeTxn) return;
    setBusyAction(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/reconcile/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_txn_id: activeTxn._id,
          matched_kind: s.kind === "refund" ? "expense" : s.kind,
          matched_id: s.id,
          matched_label: s.label,
          confidence: s.score,
          flip_to_paid: flipToPaid,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Match failed");
      setActiveTxnId(null);
      setActiveTxn(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyAction(false);
    }
  };

  const ignoreTxn = async (reason: string) => {
    if (!activeTxn) return;
    setBusyAction(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/reconcile/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_txn_id: activeTxn._id, reason }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? "Failed");
      }
      setActiveTxnId(null);
      setActiveTxn(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 16 }}>
      {/* Left: unmatched list */}
      <div className="portal-card" style={{ padding: 0, overflow: "hidden", height: "fit-content" }}>
        <div className="portal-card-head">
          <div className="portal-card-head-title">Unmatched ({unmatched.length})</div>
          <span className="portal-card-head-sub">Click to suggest matches</span>
        </div>
        {unmatched.length === 0 ? (
          <div className="portal-empty">
            All clear! No unmatched transactions in this window.
          </div>
        ) : (
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((t) => (
                  <tr
                    key={t._id}
                    onClick={() => setActiveTxnId(t._id)}
                    style={{
                      cursor: "pointer",
                      background: activeTxnId === t._id ? "rgba(99,102,241,0.1)" : undefined,
                    }}
                  >
                    <td className="small mono">{t.date}</td>
                    <td>
                      <div>{t.description}</div>
                      {t.merchant_name && t.merchant_name !== t.description && (
                        <div className="muted small">{t.merchant_name}</div>
                      )}
                    </td>
                    <td className={`right money ${t.amount >= 0 ? "money-pos" : "money-neg"}`} style={{ fontWeight: 600 }}>
                      {t.amount >= 0 ? "+" : "−"}${Math.abs(t.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Right: suggestions for the active txn */}
      <div className="portal-card" style={{ padding: 0, overflow: "hidden", position: "sticky", top: 12, height: "fit-content" }}>
        <div className="portal-card-head">
          <div className="portal-card-head-title">
            {activeTxn ? "Suggested matches" : "Select a transaction"}
          </div>
          {activeTxn && (
            <button
              className="portal-btn portal-btn-ghost"
              onClick={() => { setActiveTxnId(null); setActiveTxn(null); }}
              style={{ padding: "4px 10px", fontSize: 11 }}
            >
              ✕
            </button>
          )}
        </div>

        {!activeTxn ? (
          <div className="portal-empty">
            Pick a transaction from the left to see possible matches in
            expenses / payouts / settlements / income.
          </div>
        ) : (
          <div style={{ padding: "12px 16px" }}>
            <div
              style={{
                background: "rgba(99,102,241,0.06)",
                border: "1px solid rgba(99,102,241,0.2)",
                borderRadius: 10,
                padding: "12px 14px",
                marginBottom: 14,
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <strong>{activeTxn.description}</strong>
                <span className={`money ${activeTxn.amount >= 0 ? "money-pos" : "money-neg"}`} style={{ fontWeight: 700 }}>
                  {activeTxn.amount >= 0 ? "+" : "−"}${Math.abs(activeTxn.amount).toFixed(2)}
                </span>
              </div>
              <div className="muted small">
                {activeTxn.date} · {activeTxn.merchant_name ?? activeTxn.raw_name ?? "—"} ·
                {" "}{activeTxn.payment_channel ?? activeTxn.payment_method ?? "—"}
              </div>
            </div>

            {loading && <div className="portal-empty">Looking for matches…</div>}

            {!loading && suggestions.length === 0 && (
              <div className="portal-empty">
                No good matches found. You can still:
                <div style={{ marginTop: 10, display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    className="portal-btn"
                    onClick={() => ignoreTxn(prompt("Reason?") || "ignored")}
                    disabled={busyAction}
                  >
                    Mark ignored
                  </button>
                </div>
              </div>
            )}

            {!loading && suggestions.length > 0 && (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
                  <input type="checkbox" checked={flipToPaid} onChange={(e) => setFlipToPaid(e.target.checked)} />
                  <span>Also mark the matched expense/payout as paid</span>
                </label>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {suggestions.map((s) => (
                    <div
                      key={`${s.kind}-${s.id}`}
                      style={{
                        background: "#0d1526",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 10,
                        padding: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <div>
                          <span className="pill pill-closed" style={{ marginRight: 6 }}>{s.kind}</span>
                          <strong>{s.label}</strong>
                        </div>
                        <span className="money" style={{ fontWeight: 600 }}>${s.amount.toFixed(2)}</span>
                      </div>
                      <div className="muted small" style={{ marginBottom: 8 }}>
                        {s.date} {s.party ? `· ${s.party}` : ""} {s.status ? `· ${s.status}` : ""}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <div style={{ flex: 1 }}>
                          <div className="portal-bar" style={{ height: 5 }}>
                            <div
                              className={`portal-bar-fill ${s.score >= 0.8 ? "good" : s.score >= 0.6 ? "" : "warn"}`}
                              style={{ width: `${Math.round(s.score * 100)}%` }}
                            />
                          </div>
                          <div className="muted small" style={{ marginTop: 3, display: "flex", gap: 10 }}>
                            <span>${ Math.round(s.breakdown.amount * 100) }% amount</span>
                            <span>{Math.round(s.breakdown.date * 100)}% date</span>
                            <span>{Math.round(s.breakdown.text * 100)}% text</span>
                            <span>conf {Math.round(s.score * 100)}%</span>
                          </div>
                        </div>
                        <button
                          className="portal-btn portal-btn-primary"
                          onClick={() => confirmMatch(s)}
                          disabled={busyAction}
                          style={{ padding: "5px 12px", fontSize: 12 }}
                        >
                          Match
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button
                    className="portal-btn portal-btn-ghost"
                    onClick={() => ignoreTxn(prompt("Reason for ignoring?") || "ignored")}
                    disabled={busyAction}
                  >
                    Mark ignored
                  </button>
                </div>
              </>
            )}

            {error && <div className="portal-alert portal-alert-error" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
