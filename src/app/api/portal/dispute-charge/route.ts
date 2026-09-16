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
  // Different formula from dispute/refund; supports BULK (jobIds[]) so a filtered
  // set of penalties can be charged at once. Handled before the amount check.
  if (body.type === "penalty") {
    const pLedgerId = body.ledgerId ? String(body.ledgerId) : "";
    if (!pLedgerId) return NextResponse.json({ error: "A ledger is required" }, { status: 400 });
    const jobIds = Array.isArray(body.jobIds)
      ? body.jobIds.map((x) => String(x).trim()).filter(Boolean)
      : (body.jobId ? [String(body.jobId).trim()] : []);
    if (jobIds.length === 0) return NextResponse.json({ error: "Select at least one penalty" }, { status: 400 });
    const date = body.date ? String(body.date) : undefined;
    const notes = body.notes ? String(body.notes) : undefined;
    const dryRun = !!body.dryRun;
    const results = [];
    for (const jid of jobIds) {
      results.push(await postPenaltyCharge({ jobId: jid, ledgerId: pLedgerId, date, notes, actor: session.name, dryRun }));
    }
    const okAll = results.every((r) => r.ok);
    const posted = results.reduce((sum, r) => (r.ok ? sum + r.postedAmount : sum), 0);
    return NextResponse.json({ ok: okAll, count: results.length, posted, results }, { status: okAll ? 200 : 207 });
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
        ledgerId: bLedgerId, party: bParty, actor: session.name, dryRun: bDryRun,
      });
      results.push(r);
      if (r.ok && !bDryRun && it.scanpayDisputeId) {
        try {
          await coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute).updateOne(
            { _id: it.scanpayDisputeId } as never,
            { $set: { chargedAt: new Date().toISOString().slice(0, 10), chargedBy: session.name, updated_at: new Date().toISOString() } },
          );
        } catch { /* advisory flag */ }
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
