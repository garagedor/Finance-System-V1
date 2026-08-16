// Scheduled ScanPay sync — pulls new disputes/refunds automatically so the inbox
// stays current without anyone clicking "Sync". Invoked by Vercel Cron (see
// vercel.json). Exempt from the portal-JWT middleware; protected by CRON_SECRET
// (Vercel adds `Authorization: Bearer <CRON_SECRET>` to cron requests when the
// env var is set). Incremental: only brand-new items are fully processed.

import { NextRequest, NextResponse } from "next/server";
import { scanpayConfigured } from "@/lib/scanpay/client";
import { syncNewScanpayDisputes } from "@/lib/scanpay/sync";
import { syncNewScanpayRefunds } from "@/lib/scanpay/refund-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!scanpayConfigured()) {
    return NextResponse.json({ ok: false, error: "ScanPay is not configured (SCANPAY_API_KEY missing in this environment)" }, { status: 200 });
  }
  try {
    const [disputes, refunds] = await Promise.all([
      syncNewScanpayDisputes(),
      syncNewScanpayRefunds(),
    ]);
    return NextResponse.json({ ok: true, at: new Date().toISOString(), disputes, refunds });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "sync failed" }, { status: 200 });
  }
}
