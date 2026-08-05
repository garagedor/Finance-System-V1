// Trigger a ScanPay disputes sync: pull all disputes, upsert into the inbox,
// auto-match to CRM jobs. Read-only against ScanPay; writes only to the
// finance_scanpay_dispute inbox (never posts to a ledger — that's the human
// confirm step in the review inbox).

import { NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { scanpayConfigured } from "@/lib/scanpay/client";
import { syncScanpayDisputes } from "@/lib/scanpay/sync";

export async function POST() {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scanpayConfigured()) {
    return NextResponse.json({ error: "ScanPay is not configured (SCANPAY_API_KEY missing)" }, { status: 400 });
  }
  try {
    const summary = await syncScanpayDisputes();
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 502 }
    );
  }
}
