// "Sync payouts now" on Banking → ScanPay payouts. Same work as the daily cron
// step: recent payouts + their lines, then refund amounts from them.
import { NextResponse } from "next/server";
import { readSession, hasPermission } from "@/lib/rbac";
import { scanpayConfigured } from "@/lib/scanpay/client";
import { syncScanpayPayouts, applyPayoutRefunds } from "@/lib/scanpay/payouts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const s = await readSession();
  if (!s || !(s.type === "admin" || hasPermission(s, "finance:banking:sync"))) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  if (!scanpayConfigured()) return NextResponse.json({ error: "ScanPay is not configured" }, { status: 503 });
  try {
    const sync = await syncScanpayPayouts({ sinceDays: 14, budgetMs: 80_000 });
    const refunds = await applyPayoutRefunds({ addMissing: true, budgetMs: 25_000 });
    return NextResponse.json({ ok: true, sync, refunds });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}
