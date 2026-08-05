// Act on a ScanPay inbox item.
//   { action: "confirm", jobId }  → post to the shared dispute engine (AM ledger
//        + canonical finance_dispute), carrying ScanPay's outcome/resolution so
//        it lands correctly on the dashboard dispute-impact view; mark posted.
//   { action: "ignore" }          → drop it from the queue.
//   { action: "reopen" }          → back to matched/new (does NOT unpost).
//
// All money math stays in postDisputeCharge — this endpoint only submits inputs.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { postDisputeCharge } from "@/lib/dispute-service";
import type { ScanpayDisputeRecord } from "@/types/scanpay";
import type { DisputeRecord } from "@/types/finance";
import type { UpdateFilter } from "mongodb";

const dayOf = (iso: string | null): string =>
  iso ? new Date(iso).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; jobId?: string };
  const action = body.action;

  await ensureFinanceIndexes();
  const sc = coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute);
  const rec = await sc.findOne({ _id: id });
  if (!rec) return NextResponse.json({ error: "ScanPay dispute not found" }, { status: 404 });

  if (action === "ignore") {
    await sc.updateOne({ _id: id }, { $set: { matchStatus: "ignored", updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true, matchStatus: "ignored" });
  }

  if (action === "reopen") {
    await sc.updateOne({ _id: id }, { $set: { matchStatus: rec.matchedJobId ? "matched" : "new", updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true, matchStatus: rec.matchedJobId ? "matched" : "new" });
  }

  if (action !== "confirm") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const jobId = String(body.jobId ?? rec.matchedJobId ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Select a job to confirm against" }, { status: 400 });
  if (rec.matchStatus === "posted") {
    return NextResponse.json({ error: "This dispute was already posted" }, { status: 409 });
  }

  // ScanPay outcome → dispute status. A won dispute records the recovery on its
  // resolution date; a lost one stays a loss; anything else is still open.
  const status = rec.outcome === "won" ? "won" : rec.outcome === "lost" ? "lost" : "open";

  const result = await postDisputeCharge({
    type: "dispute",
    jobId,
    amount: rec.amount,
    date: dayOf(rec.disputedAt),           // FILED date → books the loss month
    status,
    customer_name: rec.customerName || undefined,
    address: rec.serviceAddress || undefined,
    notes: `ScanPay ${rec.disputeId} · ${rec.reason || "dispute"}`,
    actor: session.name,
  });

  if (!result.ok) {
    // Surface the engine error (e.g. "No Area Manager assigned…") to the inbox.
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // If ScanPay already resolved it, record recovery so the dashboard credits the
  // resolved month (won) — postDisputeCharge only set status, not recovery.
  const dc = coll<DisputeRecord>(FINANCE_COLLECTIONS.dispute);
  if (rec.outcome === "won") {
    const patch = {
      amount_recovered: rec.amount,
      amount_open: 0,
      resolved_date: dayOf(rec.resolvedAt),
      updated_at: new Date().toISOString(),
    };
    await dc.updateOne({ _id: result.recordId }, { $set: patch } as unknown as UpdateFilter<DisputeRecord>);
  } else if (rec.outcome === "lost") {
    const patch = {
      amount_recovered: 0,
      amount_open: rec.amount,
      resolved_date: rec.resolvedAt ? dayOf(rec.resolvedAt) : null,
      updated_at: new Date().toISOString(),
    };
    await dc.updateOne({ _id: result.recordId }, { $set: patch } as unknown as UpdateFilter<DisputeRecord>);
  }

  await sc.updateOne({ _id: id }, {
    $set: {
      matchStatus: "posted",
      matchedJobId: jobId,
      matchMethod: body.jobId && body.jobId !== rec.matchedJobId ? "manual" : (rec.matchMethod ?? "manual"),
      postedRecordId: result.recordId,
      ledgerEntryId: result.ledgerEntryId,
      updated_at: new Date().toISOString(),
    },
  });

  return NextResponse.json({
    ok: true,
    matchStatus: "posted",
    recordId: result.recordId,
    ledgerId: result.ledgerId,
    ledgerEntryId: result.ledgerEntryId,
    areaManagerName: result.areaManagerName,
    snapshot: result.snapshot,
  });
}
