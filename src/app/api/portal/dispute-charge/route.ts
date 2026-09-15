// The single endpoint both dispute/refund entry points POST to. Delegates ALL
// calculation + ledger posting to the shared service (lib/dispute-service).
// The UI never calculates — it submits inputs and (for preview) reads the
// returned snapshot. dryRun=true resolves + computes without writing anything.

import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { postDisputeCharge } from "@/lib/dispute-service";
import { postPenaltyCharge } from "@/lib/penalty-service";
import { coll, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import type { ScanpayDisputeRecord } from "@/types/scanpay";

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Penalty (X-close job): computed loss, the AM's 50% posted to the ledger.
  // Different formula from dispute/refund, so handle it before the amount check.
  if (body.type === "penalty") {
    const pJobId = String(body.jobId ?? "").trim();
    const pLedgerId = body.ledgerId ? String(body.ledgerId) : "";
    if (!pJobId) return NextResponse.json({ error: "Select a penalty job first" }, { status: 400 });
    if (!pLedgerId) return NextResponse.json({ error: "A ledger is required" }, { status: 400 });
    const pRes = await postPenaltyCharge({
      jobId: pJobId,
      ledgerId: pLedgerId,
      date: body.date ? String(body.date) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      actor: session.name,
      dryRun: !!body.dryRun,
    });
    if (!pRes.ok) return NextResponse.json({ error: pRes.error }, { status: 400 });
    return NextResponse.json(pRes);
  }

  const type = body.type === "refund" ? "refund" : "dispute";
  const jobId = String(body.jobId ?? "").trim();
  const amount = Number(body.amount);
  if (!jobId) return NextResponse.json({ error: "Select a job first" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter a dispute/refund amount greater than 0" }, { status: 400 });
  }

  const ledgerId = body.ledgerId ? String(body.ledgerId) : undefined;
  const partyRaw = body.party ? String(body.party) : "";
  const party = (["technician", "area_manager", "provider", "combined"] as const).find((p) => p === partyRaw);
  // Posting to a specific ledger requires choosing whose slice to charge.
  if (ledgerId && !party) {
    return NextResponse.json({ error: "Choose which party's slice to charge (technician / area manager / provider)" }, { status: 400 });
  }

  const result = await postDisputeCharge({
    type,
    jobId,
    amount,
    date: body.date ? String(body.date) : undefined,
    status: body.status ? String(body.status) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    customer_name: body.customer_name ? String(body.customer_name) : undefined,
    address: body.address ? String(body.address) : undefined,
    recordId: body.recordId ? String(body.recordId) : undefined,
    ledgerId,
    party,
    techId: body.techId ? String(body.techId) : undefined,
    actor: session.name,
    dryRun: !!body.dryRun,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  // If this charge came from a collected ScanPay dispute, flag it as charged so
  // the picker can badge it (re-charge is still allowed). Best-effort — the
  // ledger entry is already posted; a flag failure must not fail the request.
  const scanpayDisputeId = body.scanpayDisputeId ? String(body.scanpayDisputeId) : "";
  if (!result.dryRun && scanpayDisputeId) {
    try {
      await coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute).updateOne(
        { _id: scanpayDisputeId } as never,
        { $set: { chargedAt: new Date().toISOString().slice(0, 10), chargedBy: session.name, updated_at: new Date().toISOString() } },
      );
    } catch { /* flag is advisory; ledger entry stands */ }
  }

  return NextResponse.json(result);
}
