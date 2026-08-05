// Act on a ScanPay refund inbox item.
//   { action: "confirm", jobId, amount, date } → post via the shared engine as a
//        REFUND (postDisputeCharge type "refund" → AM ledger + finance_refund),
//        using the HUMAN-entered amount + date (ScanPay's API omits them).
//   { action: "ignore" } / { action: "reopen" }
//
// All money math stays in postDisputeCharge — this only submits inputs.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { postDisputeCharge } from "@/lib/dispute-service";
import type { ScanpayRefundRecord } from "@/types/scanpay";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; jobId?: string; amount?: number; date?: string };
  const action = body.action;

  await ensureFinanceIndexes();
  const sc = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
  const rec = await sc.findOne({ _id: id });
  if (!rec) return NextResponse.json({ error: "ScanPay refund not found" }, { status: 404 });

  if (action === "ignore") {
    await sc.updateOne({ _id: id }, { $set: { matchStatus: "ignored", updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true, matchStatus: "ignored" });
  }
  if (action === "reopen") {
    const next = rec.matchedJobId ? "matched" : "new";
    await sc.updateOne({ _id: id }, { $set: { matchStatus: next, updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true, matchStatus: next });
  }
  if (action === "charge") {
    const chargedAt = body.date ? String(body.date) : new Date().toISOString().slice(0, 10);
    await sc.updateOne({ _id: id }, { $set: { chargedAt, chargedBy: session.name, updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true, chargedAt });
  }
  if (action === "uncharge") {
    await sc.updateOne({ _id: id }, { $set: { chargedAt: null, chargedBy: null, updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true, chargedAt: null });
  }
  if (action !== "confirm") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const jobId = String(body.jobId ?? rec.matchedJobId ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Select a job to confirm against" }, { status: 400 });
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter the refunded amount (greater than 0)" }, { status: 400 });
  }
  const date = body.date ? String(body.date) : new Date().toISOString().slice(0, 10);
  if (rec.matchStatus === "posted") {
    return NextResponse.json({ error: "This refund was already posted" }, { status: 409 });
  }

  const result = await postDisputeCharge({
    type: "refund",
    jobId,
    amount,
    date,
    status: "paid", // a refund we've issued
    notes: `ScanPay refund ${rec.paymentId} · invoice ${rec.invoiceNumber}`,
    actor: session.name,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await sc.updateOne({ _id: id }, {
    $set: {
      matchStatus: "posted",
      matchedJobId: jobId,
      matchMethod: body.jobId && body.jobId !== rec.matchedJobId ? "manual" : (rec.matchMethod ?? "manual"),
      refundAmount: amount,
      refundDate: date,
      postedRecordId: result.recordId,
      ledgerEntryId: result.ledgerEntryId,
      // Refine the allocation to the actual refunded amount.
      computedShare: {
        providerCharge: result.snapshot.providerCharge,
        technicianPortion: result.snapshot.technicianPortion,
        areaManagerOwnPortion: result.snapshot.areaManagerOwnPortion,
        companyCharge: result.snapshot.companyCharge,
        amLedgerCharge: result.snapshot.amLedgerCharge,
        partsLoss: result.snapshot.partsLoss,
      },
      computeError: null,
      updated_at: new Date().toISOString(),
    },
  });

  return NextResponse.json({
    ok: true, matchStatus: "posted", recordId: result.recordId,
    ledgerEntryId: result.ledgerEntryId, areaManagerName: result.areaManagerName, snapshot: result.snapshot,
  });
}
