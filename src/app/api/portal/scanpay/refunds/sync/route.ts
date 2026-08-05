// Trigger a ScanPay refunds sync: pull refunded payments, upsert into the refund
// inbox, auto-match by invoice number. Never posts — that's the human confirm
// step (which also supplies the refund amount + date the API doesn't provide).

import { NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { scanpayConfigured } from "@/lib/scanpay/client";
import { syncScanpayRefunds } from "@/lib/scanpay/refund-sync";

export async function POST() {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scanpayConfigured()) {
    return NextResponse.json({ error: "ScanPay is not configured (SCANPAY_API_KEY missing)" }, { status: 400 });
  }
  try {
    const summary = await syncScanpayRefunds();
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 502 });
  }
}
