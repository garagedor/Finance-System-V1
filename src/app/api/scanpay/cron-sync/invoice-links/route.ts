// Daily auto-link: attach paid ScanPay invoices to their CRM jobs
// (lib/scanpay/invoice-link-sync). Invoked by Vercel Cron (vercel.json), half an
// hour after the main ScanPay sync. Protected by CRON_SECRET like cron-sync.

import { NextRequest, NextResponse } from "next/server";
import { scanpayConfigured } from "@/lib/scanpay/client";
import { syncInvoiceLinks } from "@/lib/scanpay/invoice-link-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!scanpayConfigured()) return NextResponse.json({ ok: true, scanpay: "not configured" });
  try {
    const links = await syncInvoiceLinks({ sinceDays: 35, budgetMs: 200_000 });
    return NextResponse.json({ ok: true, at: new Date().toISOString(), links });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "auto-link failed" }, { status: 200 });
  }
}
