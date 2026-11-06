// Daily bank sync (owner, 2026-11-06): pulls new transactions from every
// connected bank (Plaid) — the same as the "Sync" button on Banking →
// Connections — so the ScanPay payout check always has fresh bank data.
// Invoked by Vercel Cron at 04:30 UTC, before the ScanPay sync (05:00).
// Lives under the cron-sync prefix the middleware already exempts; protected
// by CRON_SECRET like the other scheduled jobs.

import { NextRequest, NextResponse } from "next/server";
import { isPlaidConfigured } from "@/lib/plaid";
import { syncInstitutions } from "@/lib/plaid-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlaidConfigured()) return NextResponse.json({ ok: true, plaid: "not configured" });
  try {
    const results = await syncInstitutions("daily-bank-sync");
    return NextResponse.json({ ok: true, at: new Date().toISOString(), results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "bank sync failed" }, { status: 200 });
  }
}
