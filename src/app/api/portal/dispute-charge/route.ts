// The single endpoint both dispute/refund entry points POST to. Delegates ALL
// calculation + ledger posting to the shared service (lib/dispute-service).
// The UI never calculates — it submits inputs and (for preview) reads the
// returned snapshot. dryRun=true resolves + computes without writing anything.
//
// When the charge names a collected ScanPay dispute, it attaches to THAT
// dispute's canonical record rather than creating a parallel one, and flips
// the inbox item to Posted. That is what makes the reverse workflow work:
// charging a provider from the Provider Ledger page shows up in the Disputes
// & Refunds Posted view as Provider = posted, because both ends are the same
// record and coverage is read from the ledger entries.

import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { postDisputeCharge } from "@/lib/dispute-service";
import { postPenaltyBatch } from "@/lib/penalty-service";
import { coll, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import type { ScanpayDisputeRecord } from "@/types/scanpay";
import type { PostDisputeChargeResult } from "@/lib/dispute-service";

/** The canonical record a collected ScanPay dispute is already posted under. */
async function recordIdForScanpay(scanpayDisputeId: string): Promise<string | undefined> {
  if (!scanpayDisputeId) return undefined;
  const rec = await coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute)
    .findOne({ _id: scanpayDisputeId } as never);
  return rec?.postedRecordId ?? undefined;
}

/**
 * Tie a ledger-side charge back to its inbox item.
 *
 * Without this the two ends drift: the ledger would hold a real provider
 * charge while the inbox still showed the dispute as unposted, and a later
 * inbox posting would create a SECOND canonical record for the same money.
 * Best-effort — the ledger entry is already written and must not be undone
 * because a cross-link failed.
 */
async function linkScanpayPosting(
  scanpayDisputeId: string,
  result: Extract<PostDisputeChargeResult, { ok: true }>,
  jobId: string,
): Promise<void> {
  if (!scanpayDisputeId) return;
  try {
    await coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute).updateOne(
      { _id: scanpayDisputeId } as never,
      {
        $set: {
          // Advisory badge in the picker (pre-existing behaviour).
          chargedAt: new Date().toISOString().slice(0, 10),
          // Real money has been posted, so the item belongs in Posted — the
          // remaining targets show there as work, not back in Disputes.
          matchStatus: "posted",
          matchedJobId: jobId,
          postedRecordId: result.recordId,
          ledgerEntryId: result.ledgerEntryId,
          updated_at: new Date().toISOString(),
        },
      },
    );
  } catch { /* the ledger entry stands; the cross-link is advisory */ }
}

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Penalty (X-close job): computed loss, the AM's 50% posted to the ledger.
  // Different formula from dispute/refund; supports BULK (jobIds[]) so a filtered
  // set of penalties can be charged at once. Handled before the amount check.
  if (body.type === "penalty") {
    const pLedgerId = body.ledgerId ? String(body.ledgerId) : "";
    if (!pLedgerId) return NextResponse.json({ error: "A ledger is required" }, { status: 400 });
    const jobIds = Array.isArray(body.jobIds)
      ? body.jobIds.map((x) => String(x).trim()).filter(Boolean)
      : (body.jobId ? [String(body.jobId).trim()] : []);
    if (jobIds.length === 0) return NextResponse.json({ error: "Select at least one penalty" }, { status: 400 });
    // ONE consolidated ledger line for the whole selection (sum of each job's AM
    // 50%); the per-job breakdown lives in charge_snapshot.penalties[].
    const res = await postPenaltyBatch({
      jobIds,
      ledgerId: pLedgerId,
      date: body.date ? String(body.date) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      actor: session.name,
      dryRun: !!body.dryRun,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true, count: res.count, posted: res.postedAmount, entryId: res.ledgerEntryId, missing: res.missing });
  }

  // BULK dispute/refund (ledger flow): a set of collected disputes ticked in the
  // picker, all charged to ONE ledger with ONE chosen party. Each dispute carries
  // its own amount + matched job; the technician slice uses each job's OWN tech %
  // (no single override across techs). Handled before the single-job path.
  if (Array.isArray(body.disputes)) {
    const bType = body.type === "refund" ? "refund" : "dispute";
    const bLedgerId = body.ledgerId ? String(body.ledgerId) : "";
    if (!bLedgerId) return NextResponse.json({ error: "A ledger is required" }, { status: 400 });
    const bPartyRaw = body.party ? String(body.party) : "";
    const bParty = (["technician", "area_manager", "provider", "combined"] as const).find((p) => p === bPartyRaw);
    if (!bParty) return NextResponse.json({ error: "Choose which party's slice to charge (technician / area manager / provider)" }, { status: 400 });
    const items = (body.disputes as Array<Record<string, unknown>>)
      .map((d) => ({ jobId: String(d.jobId ?? "").trim(), amount: Number(d.amount), scanpayDisputeId: d.scanpayDisputeId ? String(d.scanpayDisputeId) : "" }))
      .filter((d) => d.jobId && Number.isFinite(d.amount) && d.amount > 0);
    if (items.length === 0) return NextResponse.json({ error: "Select at least one dispute" }, { status: 400 });
    const bDate = body.date ? String(body.date) : undefined;
    const bNotes = body.notes ? String(body.notes) : undefined;
    const bDryRun = !!body.dryRun;
    const results = [];
    for (const it of items) {
      const r = await postDisputeCharge({
        type: bType, jobId: it.jobId, amount: it.amount, date: bDate, notes: bNotes,
        // Attach to the dispute's existing canonical record when it has one,
        // so this becomes a second TARGET on that dispute rather than a
        // second dispute for the same money.
        recordId: await recordIdForScanpay(it.scanpayDisputeId),
        ledgerId: bLedgerId, party: bParty, actor: session.name, dryRun: bDryRun,
      });
      results.push(r);
      if (r.ok && !bDryRun && it.scanpayDisputeId) {
        await linkScanpayPosting(it.scanpayDisputeId, r, it.jobId);
      }
    }
    const okAll = results.every((r) => r.ok);
    const posted = results.reduce((sum, r) => (r.ok && typeof r.postedAmount === "number" ? sum + r.postedAmount : sum), 0);
    return NextResponse.json({ ok: okAll, count: results.length, posted, results }, { status: okAll ? 200 : 207 });
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

  const scanpayDisputeId = body.scanpayDisputeId ? String(body.scanpayDisputeId) : "";

  const result = await postDisputeCharge({
    type,
    jobId,
    amount,
    date: body.date ? String(body.date) : undefined,
    status: body.status ? String(body.status) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    customer_name: body.customer_name ? String(body.customer_name) : undefined,
    address: body.address ? String(body.address) : undefined,
    // An explicit recordId wins (editing an existing record); otherwise, a
    // named ScanPay dispute attaches this charge to the record it is already
    // posted under, making this an additional target on the same dispute.
    recordId: body.recordId ? String(body.recordId) : await recordIdForScanpay(scanpayDisputeId),
    ledgerId,
    party,
    techId: body.techId ? String(body.techId) : undefined,
    actor: session.name,
    dryRun: !!body.dryRun,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  // Tie the charge back to its inbox item: badge it in the picker, and move
  // it to Posted with this target covered. Without the link the inbox would
  // keep showing the dispute as unposted while the money sat on a ledger.
  if (!result.dryRun) await linkScanpayPosting(scanpayDisputeId, result, jobId);

  return NextResponse.json(result);
}
