"use client";

// Client table for bank transactions with row selection + a calculator.
// "Calculate selected" sums the rows the user checks; "Calculate all" shows
// the full filtered-window totals (computed server-side across every page).

import { useMemo, useState } from "react";
import Link from "next/link";
import { fmt$, fmtDate } from "../../format";

export interface SlimTxn {
  _id: string;
  date: string;
  description: string;
  merchant_name: string | null;
  account_id: string;
  category: string | null;
  payment_channel: string | null;
  payment_method: string | null;
  pending: boolean;
  recon_status: string;
  amount: number;
}

export interface SlimAccount {
  account_id: string;
  name: string;
  mask: string | null;
}

interface WindowTotals {
  inflow: number;
  outflow: number;
  total: number;
}

type CalcResult = {
  scope: "selected" | "all";
  count: number;
  inflow: number;
  outflow: number;
  net: number;
};

function sumOf(rows: SlimTxn[]): { inflow: number; outflow: number; net: number } {
  let inflow = 0;
  let outflow = 0;
  for (const r of rows) {
    if (r.amount >= 0) inflow += r.amount;
    else outflow += r.amount;
  }
  return { inflow, outflow, net: inflow + outflow };
}

export default function SyncedTxnsTable({
  rows,
  accounts,
  windowTotals,
}: {
  rows: SlimTxn[];
  accounts: SlimAccount[];
  windowTotals: WindowTotals;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<CalcResult | null>(null);

  const acctById = useMemo(() => {
    const m = new Map<string, SlimAccount>();
    for (const a of accounts) m.set(a.account_id, a);
    return m;
  }, [accounts]);

  const allOnPageSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r._id)),
    );
  }

  function calcSelected() {
    const picked = rows.filter((r) => selected.has(r._id));
    const s = sumOf(picked);
    setResult({ scope: "selected", count: picked.length, ...s });
  }

  function calcAll() {
    setResult({
      scope: "all",
      count: windowTotals.total,
      inflow: windowTotals.inflow,
      outflow: windowTotals.outflow,
      net: windowTotals.inflow + windowTotals.outflow,
    });
  }

  return (
    <>
      {/* Calculator toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: "10px 12px",
          marginBottom: 10,
          background: "#0d1526",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 8,
        }}
      >
        <button
          type="button"
          className="portal-btn portal-btn-primary"
          onClick={calcSelected}
          disabled={selected.size === 0}
          style={selected.size === 0 ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
        >
          Calculate selected{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
        <button type="button" className="portal-btn" onClick={calcAll}>
          Calculate all ({windowTotals.total.toLocaleString()})
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            className="portal-btn portal-btn-ghost"
            onClick={() => {
              setSelected(new Set());
              setResult(null);
            }}
          >
            Clear selection
          </button>
        )}

        {result && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginLeft: "auto",
              fontSize: 13,
            }}
          >
            <span className="muted small">
              {result.scope === "selected" ? "Selected" : "All (window)"} ·{" "}
              {result.count.toLocaleString()} txn
            </span>
            <span>In <span className="money-pos">+{fmt$(result.inflow)}</span></span>
            <span>Out <span className="money-neg">{fmt$(result.outflow)}</span></span>
            <span>
              Net{" "}
              <strong className={result.net >= 0 ? "money-pos" : "money-neg"}>
                {result.net >= 0 ? "+" : "−"}{fmt$(Math.abs(result.net))}
              </strong>
            </span>
          </div>
        )}
      </div>

      <table className="portal-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onChange={toggleAllOnPage}
                aria-label="Select all on page"
              />
            </th>
            <th>Date</th>
            <th>Description</th>
            <th>Account</th>
            <th>Category</th>
            <th>Channel</th>
            <th>Status</th>
            <th>Recon</th>
            <th className="right">Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const acct = acctById.get(r.account_id);
            const isSel = selected.has(r._id);
            return (
              <tr
                key={r._id}
                style={isSel ? { background: "rgba(99,102,241,0.10)" } : undefined}
              >
                <td>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(r._id)}
                    aria-label={`Select ${r.description}`}
                  />
                </td>
                <td className="small mono">{fmtDate(r.date)}</td>
                <td>
                  <strong>{r.description}</strong>
                  {r.merchant_name && r.merchant_name !== r.description && (
                    <div className="muted small">{r.merchant_name}</div>
                  )}
                </td>
                <td className="muted small">
                  {acct?.name ?? "—"} {acct?.mask ? `··${acct.mask}` : ""}
                </td>
                <td className="muted small">{r.category ?? "—"}</td>
                <td className="muted small">{r.payment_channel ?? r.payment_method ?? "—"}</td>
                <td>
                  {r.pending ? (
                    <span className="pill pill-pending">pending</span>
                  ) : (
                    <span className="pill pill-closed">posted</span>
                  )}
                </td>
                <td>
                  <span
                    className={`pill ${
                      r.recon_status === "matched"
                        ? "pill-paid"
                        : r.recon_status === "ignored"
                          ? "pill-draft"
                          : "pill-open"
                    }`}
                  >
                    {r.recon_status}
                  </span>
                </td>
                <td
                  className={`right money ${r.amount >= 0 ? "money-pos" : "money-neg"}`}
                  style={{ fontWeight: 600 }}
                >
                  {r.amount >= 0 ? "+" : "−"}{fmt$(Math.abs(r.amount))}
                </td>
                <td className="right">
                  {r.recon_status === "unmatched" && (
                    <Link
                      href={`/portal/banking/reconcile?txn=${r._id}`}
                      className="portal-btn"
                      style={{ padding: "4px 10px", fontSize: 11 }}
                    >
                      Match…
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
