// ScanPay webhook receiver (EXTERNAL — no portal auth). Each team is configured
// in ScanPay to POST events here. Auth is a shared secret in the URL/header
// (SCANPAY_WEBHOOK_SECRET) — set the webhook URL to:
//     https://<host>/api/scanpay/webhook?token=<SCANPAY_WEBHOOK_SECRET>
//
// Behaviour: authenticate → LOG the raw event (finance_scanpay_webhook_log, so
// we can see real payloads) → best-effort process disputes/refunds by reusing
// the sync upsert logic → always ack 200 (so ScanPay doesn't retry-storm).
//
// ScanPay's exact payload shape isn't documented; we probe common shapes
// (the object itself, or an { data } / { dispute } / { payment } envelope).
// Once real events are logged we can tighten the mapping.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import { upsertScanpayDispute } from "@/lib/scanpay/sync";
import { upsertScanpayRefund } from "@/lib/scanpay/refund-sync";
import type { ScanpayDisputeRaw, ScanpayRefundRaw } from "@/types/scanpay";

export const dynamic = "force-dynamic";

function authOk(req: NextRequest): boolean | "unconfigured" {
  const secret = process.env.SCANPAY_WEBHOOK_SECRET;
  if (!secret) return "unconfigured";
  const provided = req.nextUrl.searchParams.get("token") || req.headers.get("x-webhook-secret") || "";
  return provided === secret;
}

// Pluck a dispute-shaped object out of whatever envelope arrived.
function pickDispute(body: Record<string, unknown>): ScanpayDisputeRaw | null {
  const cands = [body, body.data, body.dispute, body.payload].filter(Boolean) as Record<string, unknown>[];
  for (const c of cands) if (c && typeof c === "object" && "disputeId" in c) return c as unknown as ScanpayDisputeRaw;
  return null;
}

// Pluck a refunded-payment object (has an id + a refund indication).
function pickRefund(body: Record<string, unknown>): ScanpayRefundRaw | null {
  const type = String(body.type ?? body.event ?? "").toLowerCase();
  const cands = [body, body.data, body.payment, body.payload].filter(Boolean) as Record<string, unknown>[];
  for (const c of cands) {
    if (c && typeof c === "object" && "id" in c && "invoiceNumber" in c) {
      const st = String((c as { status?: unknown }).status ?? "").toLowerCase();
      if (st.includes("refund") || type.includes("refund")) return c as unknown as ScanpayRefundRaw;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const auth = authOk(req);
  if (auth === "unconfigured") {
    return NextResponse.json({ error: "Webhook not configured (SCANPAY_WEBHOOK_SECRET unset)" }, { status: 503 });
  }
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  await ensureFinanceIndexes();
  const log = coll<{ _id: string; received_at: string; [k: string]: unknown }>(FINANCE_COLLECTIONS.scanpayWebhookLog);

  let kind: "dispute" | "refund" | "unrecognized" = "unrecognized";
  let result: unknown = null;
  let error: string | null = null;

  try {
    const disp = pickDispute(body);
    const refund = disp ? null : pickRefund(body);
    if (disp) {
      kind = "dispute";
      result = await upsertScanpayDispute(disp);
    } else if (refund) {
      kind = "refund";
      result = await upsertScanpayRefund(refund);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "processing failed";
  }

  await log.insertOne({
    _id: newId("wh"),
    received_at: new Date().toISOString(),
    kind,
    event: body.type ?? body.event ?? null,
    processed: kind !== "unrecognized" && !error,
    result,
    error,
    raw: body,
  }).catch(() => {});

  // Always ack so ScanPay doesn't retry — problems are captured in the log.
  return NextResponse.json({ ok: true, kind, processed: kind !== "unrecognized" && !error });
}

// Health check (some providers GET/HEAD the URL to verify it).
export async function GET() {
  return NextResponse.json({ ok: true, service: "scanpay-webhook", configured: !!process.env.SCANPAY_WEBHOOK_SECRET });
}
