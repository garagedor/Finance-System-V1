import "server-only";
import type { ScanpayDisputeRaw, ScanpayOutcome } from "@/types/scanpay";

// Thin client for the ScanPay Connect API. The token lives in SCANPAY_API_KEY
// (.env.local locally / Vercel env in prod) and is never logged.

const BASE = process.env.SCANPAY_API_BASE || "https://api.scanpay.tech";

export function scanpayConfigured(): boolean {
  return !!process.env.SCANPAY_API_KEY;
}

export async function fetchScanpayDisputes(): Promise<ScanpayDisputeRaw[]> {
  const key = process.env.SCANPAY_API_KEY;
  if (!key) throw new Error("SCANPAY_API_KEY is not set");
  const res = await fetch(`${BASE}/connect/v1/disputes`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`ScanPay disputes fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { data?: ScanpayDisputeRaw[] } | ScanpayDisputeRaw[];
  const list = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
  return list;
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
