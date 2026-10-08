// Act on a ScanPay refund inbox item.
//   { action: "confirm", jobId, amount, date } → post via the shared engine as a
//        REFUND (postDisputeCharge type "refund" → AM ledger + finance_refund),
//        using the HUMAN-entered amount + date (ScanPay's API omits them).
//   { action: "ignore" } / { action: "reopen" }
//
// All money math stays in postDisputeCharge — this only submits inputs.
//
// A refund, like a dispute, may be charged to more than one party: "Posted"
// means at least one slice has been charged, and the remaining targets stay
// available. See lib/dispute-targets for the model.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { postDisputeCharge } from "@/lib/dispute-service";
import { coverageForRecord } from "@/lib/dispute-coverage";
import { canPost, TARGET_LABEL, type PostingTarget } from "@/lib/dispute-targets.ts";
import { shareFromSnapshot } from "@/lib/scanpay/share";
import type { ScanpayRefundRecord } from "@/types/scanpay";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; jobId?: string; amount?: number; date?: string; ledgerId?: string; party?: string; techId?: string };
  const action = body.action;

  await ensureFinanceIndexes();
  const sc = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
  const rec = await sc.findOne({ _id: id });
  if (!rec) return NextResponse.json({ error: "ScanPay refund not found" }, { status: 404 });

  if (action === "ignore") {
    // Refused once a slice is actually charged — see the dispute route for
    // why: parking the item would leave live ledger entries behind a record
    // that says nothing happened.
    if (rec.postedRecordId) {
      const cov = await coverageForRecord(rec.postedRecordId, "refund");
      if (cov?.anyPosted) {
        const posted = cov.targets.filter((t) => t.posted);
        return NextResponse.json({
          error: `This refund is already charged to ${posted.map((t) => t.label).join(", ")}. Reverse the ledger entr${posted.length === 1 ? "y" : "ies"} first — ignoring it here would leave the money on the ledger.`,
        }, { status: 409 });
      }
    }
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
  // Verify — record the job + refunded amount + date and compute the allocation,
  // making it visible on the refund report WITHOUT posting to the ledger.
  if (action === "verify") {
    const jobId = String(body.jobId ?? rec.matchedJobId ?? "").trim();
    if (!jobId) return NextResponse.json({ error: "Select a job to verify against" }, { status: 400 });
    const amount = Number(body.amount ?? rec.refundAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Enter the refunded amount (greater than 0)" }, { status: 400 });
    }
    const date = body.date ? String(body.date) : (rec.refundDate ?? new Date().toISOString().slice(0, 10));
    const dry = await postDisputeCharge({ type: "refund", jobId, amount, actor: session.name, dryRun: true });
    const computedShare = dry.ok ? shareFromSnapshot(dry.snapshot) : null;
    await sc.updateOne({ _id: id }, { $set: {
      matchStatus: "verified", matchedJobId: jobId,
      matchMethod: body.jobId && body.jobId !== rec.matchedJobId ? "manual" : (rec.matchMethod ?? "manual"),
      refundAmount: amount, refundDate: date,
      computedShare, computeError: dry.ok ? null : dry.error,
      updated_at: new Date().toISOString(),
    } });
    return NextResponse.json({ ok: true, matchStatus: "verified" });
  }
  if (action === "unverify") {
    await sc.updateOne({ _id: id }, { $set: { matchStatus: rec.matchedJobId ? "matched" : "new", updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true });
  }

  if (action !== "confirm") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  // Post — uses the verified values (or explicit overrides).
  const jobId = String(body.jobId ?? rec.matchedJobId ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Select a job to post against" }, { status: 400 });
  const amount = Number(body.amount ?? rec.refundAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter the refunded amount (greater than 0)" }, { status: 400 });
  }
  const date = body.date ? String(body.date) : (rec.refundDate ?? new Date().toISOString().slice(0, 10));

  // Which slice is being charged. Absent → the full AM figure, which the
  // target model calls `combined`.
  const party = (["technician", "area_manager", "provider", "combined"] as const).find((p) => p === body.party);
  const target: PostingTarget = party ?? "combined";

  // Already posted refuses only THIS target, not the item. Coverage is read
  // from the ledger entries, so a slice charged from a ledger page counts.
  if (rec.postedRecordId) {
    const cov = await coverageForRecord(rec.postedRecordId, "refund");
    if (cov) {
      const verdict = canPost(cov, target);
      if (!verdict.ok) {
        return NextResponse.json({
          error: verdict.error, code: verdict.code,
          target, targetLabel: TARGET_LABEL[target], coverage: cov,
        }, { status: 409 });
      }
    }
  }

  const result = await postDisputeCharge({
    type: "refund",
    // Reuse the canonical record so a second target attaches to the SAME
    // refund rather than creating a parallel one.
    recordId: rec.postedRecordId ?? undefined,
    jobId,
    amount,
    date,
    status: "paid", // a refund we've issued
    notes: `ScanPay refund ${rec.paymentId} · invoice ${rec.invoiceNumber}`,
    ledgerId: body.ledgerId ? String(body.ledgerId) : undefined,
    party,
    techId: body.techId ? String(body.techId) : undefined,
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
      computedShare: shareFromSnapshot(result.snapshot),
      computeError: null,
      updated_at: new Date().toISOString(),
    },
  });

  return NextResponse.json({
    ok: true, matchStatus: "posted", recordId: result.recordId,
    ledgerEntryId: result.ledgerEntryId, areaManagerName: result.areaManagerName, snapshot: result.snapshot,
    target: result.target, targetLabel: TARGET_LABEL[result.target],
    postedAmount: result.postedAmount, coverage: result.coverage,
  });
}
