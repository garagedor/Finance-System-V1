import "server-only";
import type { ScanpayDisputeRaw, ScanpayOutcome, ScanpayRefundRaw } from "@/types/scanpay";
import { isRefundedInvoice, type ScanpayInvoiceRaw } from "./invoice-refunds";

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
// GET /connect/v1/payments?status=<STATUS>&page=N → { data: { totalCount,
// currentPage, payments: [...] } }. NOTE: ScanPay does not expose the refunded
// amount or refund date here — captured from the human at confirm.
//
// We pull BOTH fully-refunded AND partially-refunded payments. `REFUNDED` is the
// known status (required); the partial-status spellings are tried tolerantly —
// an unsupported one just returns nothing and is skipped, so the sync never
// breaks on a guess. Each payment is deduped by id across statuses.
const REFUND_STATUSES: { status: string; required: boolean }[] = [
  { status: "REFUNDED", required: true },
  { status: "PARTIALLY_REFUNDED", required: false },
  { status: "PARTIALLY-REFUNDED", required: false },
  { status: "PARTIAL_REFUND", required: false },
];

async function paymentsForStatus(key: string, status: string, required: boolean): Promise<ScanpayRefundRaw[]> {
  const headers = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  const out: ScanpayRefundRaw[] = [];
  const MAX_PAGES = 200;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`${BASE}/connect/v1/payments?status=${encodeURIComponent(status)}&page=${page}`, { headers, cache: "no-store" });
    if (!res.ok) {
      if (required && page === 0) throw new Error(`ScanPay refunds fetch failed: HTTP ${res.status} ${res.statusText}`);
      break; // optional status not supported / transient — skip it
    }
    const body = (await res.json()) as { data?: { totalCount?: number; payments?: ScanpayRefundRaw[] } };
    const rows = body?.data?.payments ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
    if (out.length >= (body?.data?.totalCount ?? 0)) break;
  }
  return out;
}

async function refundsForKey(key: string): Promise<ScanpayRefundRaw[]> {
  const byId = new Map<string, ScanpayRefundRaw>();
  for (const { status, required } of REFUND_STATUSES) {
    for (const r of await paymentsForStatus(key, status, required)) byId.set(r.id, r);
  }
  return [...byId.values()];
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

// Refunded INVOICES (partial refunds — see ./invoice-refunds). The invoice list
// can't be filtered by refund status, so it is paged newest-first until
// `since`. Strictly one request at a time with a pause between them: ScanPay's
// firewall answers a burst of parallel requests with 403 for the whole IP,
// which would take the regular sync down with it.
export interface RefundedInvoiceScan {
  invoices: Array<ScanpayInvoiceRaw & { team: number }>;
  pages: number;
  /** false when the time budget ran out before `since` was reached on every team. */
  complete: boolean;
}

export async function fetchRefundedInvoices(opts: {
  since: string;            // ISO; stop paging once invoices are older than this
  deadline?: number;        // epoch ms; stop (complete=false) when passed
  delayMs?: number;         // pause between requests
  onPage?: (team: number, page: number, oldest: string) => void;
}): Promise<RefundedInvoiceScan> {
  const keys = scanpayKeys();
  if (!keys.length) throw new Error("No SCANPAY_API_KEY configured");
  const delay = opts.delayMs ?? 250;
  const out: RefundedInvoiceScan = { invoices: [], pages: 0, complete: true };
  for (const [i, key] of keys.entries()) {
    for (let page = 0; ; page++) {
      if (opts.deadline && Date.now() > opts.deadline) { out.complete = false; return out; }
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 5000 * attempt)); // back off, never hammer
        res = await fetch(`${BASE}/connect/v1/invoices?page=${page}`, {
          headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
          cache: "no-store",
        });
        if (res.ok) break;
      }
      if (!res?.ok) throw new Error(`ScanPay invoices fetch failed: HTTP ${res?.status} ${res?.statusText}`);
      const body = (await res.json()) as { data?: { invoices?: ScanpayInvoiceRaw[] } };
      const rows = body?.data?.invoices ?? [];
      out.pages++;
      if (rows.length === 0) break;
      for (const inv of rows) if (isRefundedInvoice(inv)) out.invoices.push({ ...inv, team: i + 1 });
      const oldest = rows[rows.length - 1].createdAt ?? "";
      opts.onPage?.(i + 1, page, oldest);
      // Dates come with mixed offsets, so compare instants, not strings.
      if (oldest && Date.parse(oldest) < Date.parse(opts.since)) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return out;
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
