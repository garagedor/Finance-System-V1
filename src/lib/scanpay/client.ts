import "server-only";
import type { ScanpayDisputeRaw, ScanpayOutcome, ScanpayRefundRaw } from "@/types/scanpay";

// Thin client for the ScanPay Connect API. Each team has its own bearer token —
// tokens live in SCANPAY_API_KEY, SCANPAY_API_KEY_2, SCANPAY_API_KEY_3, … (or a
// comma-separated SCANPAY_API_KEYS) and are never logged. We fetch every team
// and merge, deduping by dispute/payment id.

const BASE = process.env.SCANPAY_API_BASE || "https://api.scanpay.tech";

/** All configured team tokens (de-duped, in a stable order). */
export function scanpayKeys(): string[] {
  const keys: string[] = [];
  const list = process.env.SCANPAY_API_KEYS;
  if (list) keys.push(...list.split(",").map((k) => k.trim()));
  for (const name of ["SCANPAY_API_KEY", "SCANPAY_API_KEY_2", "SCANPAY_API_KEY_3", "SCANPAY_API_KEY_4", "SCANPAY_API_KEY_5"]) {
    const v = process.env[name];
    if (v) keys.push(v.trim());
  }
  return [...new Set(keys.filter(Boolean))];
}

export function scanpayConfigured(): boolean {
  return scanpayKeys().length > 0;
}

async function disputesForKey(key: string): Promise<ScanpayDisputeRaw[]> {
  const res = await fetch(`${BASE}/connect/v1/disputes`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ScanPay disputes fetch failed: HTTP ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data?: ScanpayDisputeRaw[] } | ScanpayDisputeRaw[];
  return Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
}

export async function fetchScanpayDisputes(): Promise<ScanpayDisputeRaw[]> {
  const keys = scanpayKeys();
  if (!keys.length) throw new Error("No SCANPAY_API_KEY configured");
  const byId = new Map<string, ScanpayDisputeRaw>();
  for (const key of keys) {
    for (const d of await disputesForKey(key)) byId.set(d.disputeId, d);
  }
  return [...byId.values()];
}

// Refunds live inside the payments endpoint, filtered by status and paginated:
// GET /connect/v1/payments?status=REFUNDED&page=N → { data: { totalCount,
// currentPage, payments: [...] } }. NOTE: ScanPay does not expose the refunded
// amount or refund date here — captured from the human at confirm.
async function refundsForKey(key: string): Promise<ScanpayRefundRaw[]> {
  const headers = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  const out: ScanpayRefundRaw[] = [];
  const MAX_PAGES = 200;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`${BASE}/connect/v1/payments?status=REFUNDED&page=${page}`, { headers, cache: "no-store" });
    if (!res.ok) throw new Error(`ScanPay refunds fetch failed: HTTP ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { data?: { totalCount?: number; payments?: ScanpayRefundRaw[] } };
    const rows = body?.data?.payments ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
    if (out.length >= (body?.data?.totalCount ?? 0)) break;
  }
  return out;
}

export async function fetchScanpayRefunds(): Promise<ScanpayRefundRaw[]> {
  const keys = scanpayKeys();
  if (!keys.length) throw new Error("No SCANPAY_API_KEY configured");
  const byId = new Map<string, ScanpayRefundRaw>();
  for (const key of keys) {
    for (const r of await refundsForKey(key)) byId.set(r.id, r);
  }
  return [...byId.values()];
}

// ── Pure parsing helpers (safe to import anywhere) ──────────────────────────

export function parseAmount(raw: string): number {
  const n = parseFloat(String(raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** ScanPay dates are mixed: ISO w/ tz, "2026-07-03", or "03 July 2026". Return
 *  an ISO instant, or null if unparseable / empty. */
export function parseScanpayDate(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ScanPay's status → our normalized outcome. Conservative: only clear wins/
 *  losses map through; anything in-flight stays `pending` for human review. */
export function normalizeOutcome(status: string): ScanpayOutcome {
  const s = String(status ?? "").toLowerCase();
  if (s.includes("won")) return "won";
  if (s.includes("lost")) return "lost";
  return "pending";
}
