// Act on a ScanPay inbox item.
//   { action: "confirm", jobId, party }
//        → post ONE party's slice to a ledger via the shared dispute engine.
//          "Posted" means at least one slice has been charged — not that the
//          item is finished. A posted dispute can still have its provider
//          charged afterwards, so this action is target-aware and refuses
//          only the target that is already covered.
//   { action: "ignore" }          → drop it from the queue (refused once money
//                                   has actually been posted).
//   { action: "reopen" }          → back to matched/new (does NOT unpost).
//
// All money math stays in postDisputeCharge — this endpoint only submits
// inputs. Which targets remain comes from lib/dispute-coverage, which reads
// the ledger entries, so a charge made from a ledger page counts here too.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { postDisputeCharge } from "@/lib/dispute-service";
import { coverageForInboxItem, coverageForRecord } from "@/lib/dispute-coverage";
import { canPost, TARGET_LABEL, type PostingTarget } from "@/lib/dispute-targets.ts";
import { shareFromSnapshot } from "@/lib/scanpay/share";
import { upsertCrmDispute, removeCrmDispute } from "@/lib/scanpay/crm-dispute";
import type { ScanpayDisputeRecord } from "@/types/scanpay";
import type { DisputeRecord } from "@/types/finance";
import type { UpdateFilter } from "mongodb";

const dayOf = (iso: string | null): string =>
  iso ? new Date(iso).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; jobId?: string; date?: string; ledgerId?: string; party?: string; techId?: string };
  const action = body.action;

  await ensureFinanceIndexes();
  const sc = coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute);
  const rec = await sc.findOne({ _id: id });
  if (!rec) return NextResponse.json({ error: "ScanPay dispute not found" }, { status: 404 });

  if (action === "ignore") {
    // Ignoring is for items that were never money. Once a slice has actually
    // been charged, parking the item would leave live ledger entries behind a
    // record that claims nothing happened — the balance would still carry the
    // charge while the inbox said it was dropped. Reverse the entries on the
    // ledger first; that is the act that undoes a charge.
    if (rec.postedRecordId) {
      const cov = await coverageForRecord(rec.postedRecordId, "dispute");
      if (cov?.anyPosted) {
        const posted = cov.targets.filter((t) => t.posted).map((t) => t.label).join(", ");
        return NextResponse.json({
          error: `This dispute is already charged to ${posted}. Reverse the ledger entr${cov.targets.filter((t) => t.posted).length === 1 ? "y" : "ies"} first — ignoring it here would leave the money on the ledger.`,
        }, { status: 409 });
      }
    }
    await sc.updateOne({ _id: id }, { $set: { matchStatus: "ignored", updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true, matchStatus: "ignored" });
  }

  if (action === "reopen") {
    await sc.updateOne({ _id: id }, { $set: { matchStatus: rec.matchedJobId ? "matched" : "new", updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true, matchStatus: rec.matchedJobId ? "matched" : "new" });
  }

  // Charge tracking — mark/unmark that the parties' slices were charged for this
  // dispute (manual, independent of ledger posting).
  if (action === "charge") {
    const chargedAt = body.date ? String(body.date) : new Date().toISOString().slice(0, 10);
    await sc.updateOne({ _id: id }, { $set: { chargedAt, chargedBy: session.name, updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true, chargedAt });
  }
  if (action === "uncharge") {
    await sc.updateOne({ _id: id }, { $set: { chargedAt: null, chargedBy: null, updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true, chargedAt: null });
  }

  // Verify — confirm the job match (visible on the dispute report) WITHOUT posting
  // to the ledger. Recomputes the allocation for the (possibly re-picked) job.
  if (action === "verify") {
    const jobId = String(body.jobId ?? rec.matchedJobId ?? "").trim();
    if (!jobId) return NextResponse.json({ error: "Select a job to verify against" }, { status: 400 });
    const dry = await postDisputeCharge({ type: "dispute", jobId, amount: rec.amount, actor: session.name, dryRun: true });
    const computedShare = dry.ok ? shareFromSnapshot(dry.snapshot) : null;
    await sc.updateOne({ _id: id }, { $set: {
      matchStatus: "verified",
      matchedJobId: jobId,
      matchMethod: body.jobId && body.jobId !== rec.matchedJobId ? "manual" : (rec.matchMethod ?? "manual"),
      computedShare,
      computeError: dry.ok ? null : dry.error,
      updated_at: new Date().toISOString(),
    } });
    // Mirror onto the CRM Disputes report.
    await upsertCrmDispute({
      disputeId: rec.disputeId, jobId, amount: rec.amount,
      disputedAt: rec.disputedAt, statusRaw: rec.statusRaw, outcome: rec.outcome,
      resolvedAt: rec.resolvedAt, respondBy: rec.raw?.respondBy,
    });
    return NextResponse.json({ ok: true, matchStatus: "verified" });
  }
  if (action === "unverify") {
    await removeCrmDispute(rec.disputeId);
    await sc.updateOne({ _id: id }, { $set: { matchStatus: rec.matchedJobId ? "matched" : "new", updated_at: new Date().toISOString() } });
    return NextResponse.json({ ok: true });
  }

  if (action !== "confirm") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const jobId = String(body.jobId ?? rec.matchedJobId ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Select a job to confirm against" }, { status: 400 });

  // Which slice is being charged. Absent → the historical default, the full
  // AM figure, which the target model calls `combined`.
  const party = (["technician", "area_manager", "provider", "combined"] as const).find((p) => p === body.party);
  const target: PostingTarget = party ?? "combined";

  // Already posted is no longer a reason to refuse the ITEM — only a reason to
  // refuse THIS target. The provider can still be charged after the Area
  // Manager. Coverage comes from the ledger entries, so a slice charged from
  // a ledger page is seen here exactly as one charged from the inbox.
  {
    // Checked for every item, not only linked ones. An unlinked item marked
    // charged is precisely the ambiguous historical case: something was
    // charged, nothing says what, and offering to charge it again is how the
    // same party gets billed twice.
    const cov = await coverageForInboxItem({
      postedRecordId: rec.postedRecordId ?? null,
      kind: "dispute",
      computedShare: rec.computedShare,
      scanpayId: rec._id,
      jobId,
      amount: Number(rec.amount),
      chargedAt: rec.chargedAt ?? null,
      // Eligibility (does this job have a provider, is an AM assigned) is
      // the service's to decide — it has the job. This check exists for the
      // already-posted and under-review cases, so the parties are assumed
      // present here and the service refuses on the real ones.
      context: { hasProvider: true, hasAreaManager: true, hasTechnician: true },
    });
    {
      const verdict = canPost(cov, target);
      if (!verdict.ok) {
        return NextResponse.json({
          error: verdict.error,
          code: verdict.code,
          target,
          targetLabel: TARGET_LABEL[target],
          coverage: cov,
        }, { status: 409 });
      }
    }
  }

  // ScanPay outcome → dispute status. A won dispute records the recovery on its
  // resolution date; a lost one stays a loss; anything else is still open.
  const status = rec.outcome === "won" ? "won" : rec.outcome === "lost" ? "lost" : "open";

  // Post the chosen slice to the chosen ledger (same as adding the dispute
  // from inside a ledger). Omit both → the full AM charge to the job's
  // Area-Manager ledger, as before. `recordId` reuses the canonical record
  // when one already exists, so a second target attaches to the SAME dispute
  // instead of creating a parallel one.
  const result = await postDisputeCharge({
    recordId: rec.postedRecordId ?? undefined,
    type: "dispute",
    jobId,
    amount: rec.amount,
    date: dayOf(rec.disputedAt),           // FILED date → books the loss month
    status,
    customer_name: rec.customerName || undefined,
    address: rec.serviceAddress || undefined,
    notes: `ScanPay ${rec.disputeId} · ${rec.reason || "dispute"}`,
    ledgerId: body.ledgerId ? String(body.ledgerId) : undefined,
    party,
    techId: body.techId ? String(body.techId) : undefined,
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

  // One posting is enough to be Posted, and further postings never move it
  // back: the remaining targets are shown as work on the Posted row instead.
  await sc.updateOne({ _id: id }, {
    $set: {
      matchStatus: "posted",
      matchedJobId: jobId,
      matchMethod: body.jobId && body.jobId !== rec.matchedJobId ? "manual" : (rec.matchMethod ?? "manual"),
      postedRecordId: result.recordId,
      // Legacy single link, kept for the records that already carry it. The
      // Posted tab reads coverage from the ledger entries, not from this.
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
    target: result.target,
    targetLabel: TARGET_LABEL[result.target],
    postedAmount: result.postedAmount,
    coverage: result.coverage,
  });
}
