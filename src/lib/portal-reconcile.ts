// Reconciliation engine — given a bank transaction, score candidate matches
// from the portal's expenses / payouts / settlements / income tables and
// return a ranked suggestion list. No auto-finalize: user must confirm.
//
// Scoring (all 0..1, then weighted):
//   amount   — exact ($) and sign agreement
//   date     — proximity (0d = 1.0, 7d = 0.5, 30d = 0)
//   text     — token-overlap between bank description and candidate label/vendor
//   direction— sign matches expected direction for that kind

import { coll, FINANCE_COLLECTIONS } from "./finance-db";
import type {
  ExpenseRecord,
  ManualIncomeRecord,
  PayoutRecord,
  SettlementRecord,
  RefundRecord,
} from "@/types/finance";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";

export type MatchKind = "expense" | "payout" | "settlement" | "income" | "refund";

export interface MatchSuggestion {
  kind: MatchKind;
  id: string;
  label: string;             // human description
  amount: number;            // candidate amount (positive)
  date: string;              // candidate date
  party?: string;            // vendor / recipient / from / to
  status?: string;
  score: number;             // 0..1 final
  breakdown: {
    amount: number;
    date: number;
    text: number;
    direction: number;
  };
}

const W = { amount: 0.45, date: 0.25, text: 0.2, direction: 0.1 };

function tokens(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3)
  );
}

function textSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size);
}

function dateProximity(a: string, b: string, daysWindow = 30): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 0;
  const diff = Math.abs(da - db) / (24 * 3600 * 1000);
  if (diff > daysWindow) return 0;
  return 1 - diff / daysWindow;
}

function amountMatch(txnAmount: number, candidate: number): number {
  if (candidate <= 0) return 0;
  const a = Math.abs(txnAmount);
  const diff = Math.abs(a - candidate);
  if (diff < 0.005) return 1; // exact penny-match
  const tol = Math.max(1, candidate * 0.02); // 2% / $1 tolerance
  if (diff <= tol) return 0.9 - 0.5 * (diff / tol);
  if (diff <= candidate * 0.1) return 0.3;   // within 10%
  return 0;
}

// ── Per-kind candidate fetching + scoring ──────────────────────────────────

async function scoreAgainstExpenses(
  txn: BankTransactionSyncedRecord
): Promise<MatchSuggestion[]> {
  if (txn.direction !== "out") return []; // expenses → money goes OUT
  // Look at unpaid expenses near the bank txn date (±30d)
  const expColl = coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense);
  const minDate = new Date(new Date(txn.date).getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const maxDate = new Date(new Date(txn.date).getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const candidates = await expColl
    .find({ date: { $gte: minDate, $lte: maxDate } })
    .limit(200)
    .toArray();
  const out: MatchSuggestion[] = [];
  for (const e of candidates) {
    const a = amountMatch(txn.amount, e.amount);
    if (a === 0) continue;
    const d = dateProximity(txn.date, e.date);
    const t = textSimilarity(
      `${txn.description} ${txn.merchant_name ?? ""}`,
      `${e.vendor_name ?? ""} ${e.description ?? ""} ${e.notes ?? ""}`
    );
    const dirOK = 1; // direction already filtered
    const score = a * W.amount + d * W.date + t * W.text + dirOK * W.direction;
    out.push({
      kind: "expense",
      id: e._id,
      label: e.description || e.vendor_name || e.category,
      amount: e.amount,
      date: e.date,
      party: e.vendor_name ?? undefined,
      status: e.status,
      score,
      breakdown: { amount: a, date: d, text: t, direction: dirOK },
    });
  }
  return out;
}

async function scoreAgainstPayouts(
  txn: BankTransactionSyncedRecord
): Promise<MatchSuggestion[]> {
  if (txn.direction !== "out") return [];
  const payColl = coll<PayoutRecord>(FINANCE_COLLECTIONS.payout);
  const candidates = await payColl
    .find({})
    .sort({ period_end: -1 })
    .limit(300)
    .toArray();
  const out: MatchSuggestion[] = [];
  for (const p of candidates) {
    const a = amountMatch(txn.amount, p.net);
    if (a === 0) continue;
    // Use period_end as the anchor date for payout
    const d = dateProximity(txn.date, p.period_end, 45);
    const t = textSimilarity(
      `${txn.description} ${txn.merchant_name ?? ""}`,
      `${p.recipient_name} ${p.recipient_role ?? ""}`
    );
    const dirOK = 1;
    const score = a * W.amount + d * W.date + t * W.text + dirOK * W.direction;
    out.push({
      kind: "payout",
      id: p._id,
      label: `Payout · ${p.recipient_name}`,
      amount: p.net,
      date: p.period_end,
      party: p.recipient_name,
      status: p.status,
      score,
      breakdown: { amount: a, date: d, text: t, direction: dirOK },
    });
  }
  return out;
}

async function scoreAgainstSettlements(
  txn: BankTransactionSyncedRecord
): Promise<MatchSuggestion[]> {
  const settColl = coll<SettlementRecord>(FINANCE_COLLECTIONS.settlement);
  const minDate = new Date(new Date(txn.date).getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const maxDate = new Date(new Date(txn.date).getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const candidates = await settColl
    .find({ date: { $gte: minDate, $lte: maxDate } })
    .limit(200)
    .toArray();
  const out: MatchSuggestion[] = [];
  for (const s of candidates) {
    const a = amountMatch(txn.amount, s.amount);
    if (a === 0) continue;
    const d = dateProximity(txn.date, s.date);
    const t = textSimilarity(
      `${txn.description} ${txn.merchant_name ?? ""}`,
      `${s.from_party_name} ${s.to_party_name} ${s.reference ?? ""}`
    );
    const dirOK = 1; // settlements can go either direction
    const score = a * W.amount + d * W.date + t * W.text + dirOK * W.direction;
    out.push({
      kind: "settlement",
      id: s._id,
      label: `Settlement · ${s.from_party_name} → ${s.to_party_name}`,
      amount: s.amount,
      date: s.date,
      party: txn.direction === "out" ? s.to_party_name : s.from_party_name,
      score,
      breakdown: { amount: a, date: d, text: t, direction: dirOK },
    });
  }
  return out;
}

async function scoreAgainstIncome(
  txn: BankTransactionSyncedRecord
): Promise<MatchSuggestion[]> {
  if (txn.direction !== "in") return [];
  const incColl = coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income);
  const minDate = new Date(new Date(txn.date).getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const maxDate = new Date(new Date(txn.date).getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const candidates = await incColl
    .find({ date: { $gte: minDate, $lte: maxDate } })
    .limit(200)
    .toArray();
  const out: MatchSuggestion[] = [];
  for (const i of candidates) {
    const a = amountMatch(txn.amount, i.amount);
    if (a === 0) continue;
    const d = dateProximity(txn.date, i.date);
    const t = textSimilarity(
      `${txn.description} ${txn.merchant_name ?? ""}`,
      `${i.description} ${i.category ?? ""} ${i.related_area ?? ""}`
    );
    const dirOK = 1;
    const score = a * W.amount + d * W.date + t * W.text + dirOK * W.direction;
    out.push({
      kind: "income",
      id: i._id,
      label: i.description,
      amount: i.amount,
      date: i.date,
      party: i.related_area ?? undefined,
      score,
      breakdown: { amount: a, date: d, text: t, direction: dirOK },
    });
  }
  return out;
}

async function scoreAgainstRefunds(
  txn: BankTransactionSyncedRecord
): Promise<MatchSuggestion[]> {
  if (txn.direction !== "out") return [];
  const refColl = coll<RefundRecord>(FINANCE_COLLECTIONS.refund);
  const minDate = new Date(new Date(txn.date).getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const maxDate = new Date(new Date(txn.date).getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const candidates = await refColl
    .find({ date: { $gte: minDate, $lte: maxDate } })
    .limit(100)
    .toArray();
  const out: MatchSuggestion[] = [];
  for (const r of candidates) {
    const a = amountMatch(txn.amount, r.amount);
    if (a === 0) continue;
    const d = dateProximity(txn.date, r.date);
    const t = textSimilarity(
      `${txn.description} ${txn.merchant_name ?? ""}`,
      `${r.customer_name ?? ""} ${r.reason ?? ""}`
    );
    const dirOK = 1;
    const score = a * W.amount + d * W.date + t * W.text + dirOK * W.direction;
    out.push({
      kind: "refund",
      id: r._id,
      label: `Refund · ${r.customer_name ?? "—"}`,
      amount: r.amount,
      date: r.date,
      party: r.customer_name ?? undefined,
      status: r.status,
      score,
      breakdown: { amount: a, date: d, text: t, direction: dirOK },
    });
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function suggestMatchesForTxn(
  txn: BankTransactionSyncedRecord,
  limit = 8,
  minScore = 0.35
): Promise<MatchSuggestion[]> {
  const [expenses, payouts, settlements, income, refunds] = await Promise.all([
    scoreAgainstExpenses(txn),
    scoreAgainstPayouts(txn),
    scoreAgainstSettlements(txn),
    scoreAgainstIncome(txn),
    scoreAgainstRefunds(txn),
  ]);
  return [...expenses, ...payouts, ...settlements, ...income, ...refunds]
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
