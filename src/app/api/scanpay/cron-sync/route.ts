// Scheduled ScanPay sync — pulls new disputes/refunds automatically so the inbox
// stays current without anyone clicking "Sync". Invoked by Vercel Cron (see
// vercel.json). Exempt from the portal-JWT middleware; protected by CRON_SECRET
// (Vercel adds `Authorization: Bearer <CRON_SECRET>` to cron requests when the
// env var is set). Incremental: only brand-new items are fully processed.

import { NextRequest, NextResponse } from "next/server";
import { scanpayConfigured } from "@/lib/scanpay/client";
import { syncNewScanpayDisputes } from "@/lib/scanpay/sync";
import { syncNewScanpayRefunds, syncRefundedInvoices } from "@/lib/scanpay/refund-sync";
import { syncScanpayPayouts, applyPayoutRefunds } from "@/lib/scanpay/payouts";
import { resyncJobMirrors } from "@/lib/job-mirror";
import { alertReportDrift } from "@/lib/report-drift";
import { arenaCronStep } from "@/lib/arena/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Heal the Job report/stats mirror fields daily (independent of ScanPay).
  let mirrors: unknown = null;
  try {
    mirrors = await resyncJobMirrors();
  } catch (e) {
    mirrors = { error: e instanceof Error ? e.message : "mirror resync failed" };
  }

  // Report-drift monitor: alert the owner if any closed job would silently drop
  // off the provider report / stats (new status spelling or date format).
  let drift: unknown = null;
  try {
    drift = await alertReportDrift();
  } catch (e) {
    drift = { error: e instanceof Error ? e.message : "drift check failed" };
  }

  // 317 Live Arena safety net: freeze any week whose Sunday has ended even if
  // nobody opened it (idempotent; isolated — never affects the steps above/below).
  const arena = await arenaCronStep();

  if (!scanpayConfigured()) {
    return NextResponse.json({ ok: true, mirrors, drift, arena, scanpay: "not configured" }, { status: 200 });
  }
  try {
    const [disputes, refunds] = await Promise.all([
      syncNewScanpayDisputes(),
      syncNewScanpayRefunds(),
    ]);
    // Partial refunds only show on the invoice. Daily, after the rest, paced and
    // time-boxed (lib/scanpay/client fetchRefundedInvoices). Never on inbox
    // load — that sync runs every time the page opens.
    // Payouts (what reaches the bank) and the refund amounts inside them.
    // Paced and time-boxed; a finished payout is read once, ever.
    let payouts: unknown = null;
    try {
      const sync = await syncScanpayPayouts({ sinceDays: 10, budgetMs: 30_000 });
      const refundAmounts = await applyPayoutRefunds({ addMissing: true, budgetMs: 10_000 });
      payouts = { ...sync, refundAmounts };
    } catch (e) {
      payouts = { error: e instanceof Error ? e.message : "payout sync failed" };
    }
    let invoiceRefunds: unknown = null;
    try {
      invoiceRefunds = await syncRefundedInvoices({ sinceDays: 120, budgetMs: 200_000 });
    } catch (e) {
      invoiceRefunds = { error: e instanceof Error ? e.message : "invoice refund scan failed" };
    }
    return NextResponse.json({ ok: true, at: new Date().toISOString(), mirrors, drift, arena, disputes, refunds, payouts, invoiceRefunds });
  } catch (e) {
    return NextResponse.json({ ok: false, mirrors, drift, arena, error: e instanceof Error ? e.message : "sync failed" }, { status: 200 });
  }
}
