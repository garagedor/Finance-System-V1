import "server-only";

// The ONE shared server-side service for dispute/refund cost-share.
//
// Both entry points — the Disputes module and the ledger Add-Dispute modal —
// submit raw inputs to this service; neither calculates or posts on its own.
// It: resolves the CRM job → derives job/tip/parts → resolves the job's Area
// Manager + technician % + provider % → runs the authoritative allocation
// engine (lib/dispute-charge) → creates/updates the canonical dispute/refund
// record → posts the AM ledger charge (= technician portion + AM own portion)
// to the AM's ledger (find-or-create) → stores the full snapshot → links the
// record to the ledger entry → prevents duplicate charging (dedup by record id).
//
// A dispute is NOT settled with one party. Each slice may be charged to a
// different ledger — the AM's own portion to theirs, the provider's to theirs
// — so a record may carry SEVERAL ledger entries, one per target. Uniqueness
// is therefore (dispute_id, posted_party), never dispute_id alone: keying on
// the record meant the second target found the first entry and OVERWROTE it,
// silently moving the AM's charge onto the provider's ledger. The target
// vocabulary, the eligibility rules and the overlap rules all live in
// lib/dispute-targets; this file only writes what that module decides.
//
// The company figure is computed for the report and never posted: the company
// holds no ledger it charges itself through.

import { ObjectId, type Db } from "mongodb";
import {
  getDb, coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId,
} from "@/lib/finance-db";
import { getEffectivePct } from "@/lib/portal-tech-rates";
import { computeDisputeCharge, type DisputeKind } from "@/lib/dispute-charge";
import {
  amountForTarget, canPost, resolveCoverage, targetOfEntry,
  type PostedEntryView, type PostingCoverage, type PostingTarget,
} from "@/lib/dispute-targets.ts";
import type { JobRow, Location } from "@/types/job";
import type { DisputeRecord, RefundRecord } from "@/types/finance";
import type { LedgerEntryRecord, LedgerRecord } from "@/types/finance-ledger";

const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const today = () => new Date().toISOString().slice(0, 10);

export type PostDisputeChargeInput = {
  type: DisputeKind;
  /** CRM Job _id the dispute/refund is attributed to (source of total/parts/tip). */
  jobId: string;
  /** Disputed / refunded amount (H). */
  amount: number;
  date?: string;
  status?: string;
  notes?: string;
  customer_name?: string;
  address?: string;
  /** Existing canonical record _id — provide to UPDATE instead of create. */
  recordId?: string;
  /** When set (dispute added from a specific ledger page), post the charge to
   *  THIS exact ledger instead of deriving/creating the job's AM ledger. Fixes
   *  the duplicate-ledger bug (owner rule 2026-09-11). The Disputes module omits
   *  it and keeps the find-or-create-by-AM behavior. */
  ledgerId?: string;
  /** Which party's slice of the dispute to post to the ledger (owner rule
   *  2026-09-11). Required with ledgerId. Amounts follow the dispute-shares
   *  formula: technician → technicianPortion, area_manager → areaManagerOwnPortion,
   *  provider → providerCharge, combined → technicianPortion + areaManagerOwnPortion
   *  (the full AM ledger charge; the tech/AM split is surfaced so the AM can
   *  recover the tech's part on their own). Without a party (Disputes module) the
   *  combined amount is posted, as before. */
  party?: "technician" | "area_manager" | "provider" | "combined";
  /** The specific technician whose effective % drives the technician slice
   *  (techs can have different %). Used only when party === "technician";
   *  defaults to the job's tech. */
  techId?: string;
  actor: string;
  /** When true, resolve + compute but write nothing (validation). */
  dryRun?: boolean;
};

export type PostDisputeChargeResult =
  | { ok: false; error: string }
  | {
      ok: true;
      recordId: string;
      ledgerId: string;
      ledgerEntryId: string;
      areaManagerName: string;
      areaManagerPercent: number;
      technicianEffectivePercent: number;
      snapshot: ReturnType<typeof computeDisputeCharge>;
      /** The amount actually posted to the ledger — the selected party's slice
       *  when a party is given, else the full AM ledger charge. */
      postedAmount: number;
      party?: "technician" | "area_manager" | "provider" | "combined";
      /** For combined: how the posted amount splits (so the AM sees each part). */
      technicianPortion?: number;
      areaManagerOwnPortion?: number;
      /** Technician whose % was used for the technician slice (party=technician). */
      chargedTechName?: string;
      /** The target this call charged. `combined` when no party was named. */
      target: PostingTarget;
      /** Every target's state after this write — derived from the entries. */
      coverage: PostingCoverage;
      created: boolean;      // true if a new record was created
      reused: boolean;       // true if this target's existing entry was updated
      dryRun: boolean;
    };

async function loadJob(db: Db, jobId: string): Promise<JobRow | null> {
  const or: Record<string, unknown>[] = [{ _id: jobId }];
  if (/^[0-9a-fA-F]{24}$/.test(jobId)) or.push({ _id: new ObjectId(jobId) });
  return db.collection<JobRow>("Job").findOne({ $or: or } as never);
}

/** Find the Area Manager's ledger, creating it if missing. Exported so other
 *  finance services (e.g. equipment ordering) post to the SAME AM ledger. */
export async function findOrCreateAmLedger(amName: string, location: string, actor: string, dryRun: boolean) {
  const lc = coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger);
  const name = (amName ?? "").trim();
  // Reuse an existing AM ledger case-insensitively + whitespace-trimmed, so
  // "Or" / "OR" / "or " collapse to one ledger instead of spawning duplicates.
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = await lc.findOne({ role: "area_manager", holder_name: { $regex: `^${esc}$`, $options: "i" } });
  if (existing) return existing;
  const ledger: LedgerRecord = {
    _id: newId("ldg"),
    holder_name: name,
    role: "area_manager",
    location: location || "",
    status: "active",
    created_at: new Date().toISOString(),
    created_by: `dispute-service:${actor}`,
  };
  if (!dryRun) await lc.insertOne(ledger);
  return ledger;
}

export async function postDisputeCharge(input: PostDisputeChargeInput): Promise<PostDisputeChargeResult> {
  await ensureFinanceIndexes();
  const db = await getDb();
  const dryRun = !!input.dryRun;

  const job = await loadJob(db, input.jobId);
  if (!job) return { ok: false, error: `Job not found: ${input.jobId}` };
  const location = job.location ?? "";
  if (!location) return { ok: false, error: `Job ${input.jobId} has no location — cannot resolve an Area Manager.` };

  // Resolve the Area Manager via the EXPLICIT assignment on the Location
  // (never Location.technician). Refuse to post if unassigned.
  const loc = await db.collection<Location>("Location").findOne({ _id: location } as never);
  if (!loc) return { ok: false, error: `No Location record exists for "${location}".` };
  const amName = (loc.areaManagerName ?? "").trim();
  // The AM name is only required for the Disputes-module flow, which find-or-
  // creates the job's AM ledger from it. When posting a chosen party's slice to
  // a specific ledger, the name is display-only, so a missing assignment must
  // not block charging a technician/provider slice.
  if (!amName && !input.ledgerId) {
    return {
      ok: false,
      error: `No Area Manager is assigned to location "${location}". Assign one on the Area Managers page before charging this dispute/refund.`,
    };
  }
  const areaManagerPercent = num(loc.managerProfitPercent);
  if (areaManagerPercent <= 0) {
    return { ok: false, error: `Location "${location}" has no managerProfitPercent set.` };
  }

  // Technician % for the split. When charging the TECHNICIAN slice to a ledger,
  // the CHOSEN technician's effective % drives it (techs can differ); otherwise
  // the job's own technician %.
  const chargedTech = (input.party === "technician" && input.techId?.trim())
    ? input.techId.trim()
    : (job.tech ?? "");
  const technicianPercent = await getEffectivePct(chargedTech);
  const providerDoc = job.provider
    ? await db.collection("Provider").findOne({ _id: job.provider } as never)
    : null;
  const providerPercent = num((providerDoc as { profitPercent?: unknown } | null)?.profitPercent);
  const recordId = input.recordId ?? newId(input.type === "dispute" ? "disp" : "ref");

  const snapshot = computeDisputeCharge({
    job,
    disputeAmount: num(input.amount),
    type: input.type,
    technicianPercent,
    providerPercent,
    areaManagerPoolPercent: areaManagerPercent,
    sourceJobId: input.jobId,
    sourceRecordId: recordId,
  });

  // Target ledger. When the dispute is added from a specific ledger page we post
  // to THAT ledger (never derive/create another — owner rule 2026-09-11). Only
  // the Disputes module (no ledgerId) falls back to the job's AM ledger. Charge
  // amounts are still computed from the job's AM/tech/provider %, which is
  // correct regardless of which ledger the entry attaches to.
  let ledger: LedgerRecord;
  if (input.ledgerId) {
    const found = await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).findOne({ _id: input.ledgerId });
    if (!found) return { ok: false, error: `Ledger not found: ${input.ledgerId}` };
    ledger = found;
  } else {
    ledger = await findOrCreateAmLedger(amName, location, input.actor, dryRun);
  }

  // Which slice posts to the ledger. The no-party path (Disputes module) has
  // always charged the full AM figure, which IS the `combined` target — so it
  // is named as such rather than left null, and the overlap rules apply to it
  // like any other posting.
  const target: PostingTarget = input.party ?? "combined";
  // One definition of what each target is charged, shared with the UI that
  // offers it, so the figure on the button is the figure that gets written.
  const postedAmount = amountForTarget(snapshot, target);
  const partyLabel =
    input.party === "technician" ? `tech ${chargedTech || job.tech || ""}`.trim()
    : input.party === "area_manager" ? `AM ${amName}`.trim()
    : input.party === "provider" ? `provider ${job.provider ?? ""}`.trim()
    : input.party === "combined" ? `AM ${amName} + tech ${job.tech ?? ""}`.trim()
    : `AM ${amName}`.trim();

  /* ── Dedup: one ledger entry per (record, target) ──────────────────────
     Was one per record, which is why a second target could not be posted:
     the lookup found the first entry and the write updated it in place, so
     charging the provider MOVED the Area Manager's charge rather than adding
     to it. Keying on the target as well makes the two independent.

     Within one target the write stays idempotent — re-posting the same slice
     (editing the amount, re-running after a timeout) updates that entry and
     never creates a second. Across targets that overlap it is refused, since
     no in-place update can fix charging the technician twice.             */
  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const priorEntries = await ec.find({ dispute_id: recordId }).toArray();
  const reversals = priorEntries.length
    ? await ec.find(
        { reverses_id: { $in: priorEntries.map((e) => e._id) } },
        { projection: { reverses_id: 1 } },
      ).toArray()
    : [];
  const reversedIds = reversals.map((r) => String(r.reverses_id)).filter(Boolean);

  const asView = (e: LedgerEntryRecord): PostedEntryView => {
    const nested = (e.charge_snapshot as Record<string, unknown> | null | undefined)?.["posted_party"];
    return {
      _id: e._id,
      ledger_id: e.ledger_id,
      posted_party: (e.posted_party ?? (typeof nested === "string" ? nested : null)) as PostingTarget | null,
      amount: num(e.amount),
      date: e.date ?? null,
      created_at: e.created_at,
    };
  };

  const coverageContext = {
    hasProvider: !!job.provider,
    hasAreaManager: !!amName || !!input.ledgerId,
    hasTechnician: !!(chargedTech || job.tech),
  };
  const before = resolveCoverage({
    snapshot,
    entries: priorEntries.map(asView),
    reversedEntryIds: reversedIds,
    context: coverageContext,
  });

  // Refuse only what cannot be made safe by updating in place: a target that
  // overlaps one already charged. `already_posted` for the SAME target is not
  // a refusal here — that is the idempotent re-post path below.
  const verdict = canPost(before, target);
  if (!verdict.ok && verdict.code !== "already_posted") {
    return { ok: false, error: verdict.error };
  }

  // This target's own live entry, if it has one. Reversed entries are left
  // alone — a reversal is a correction on the record, and re-posting writes
  // a new entry rather than resurrecting the one that was undone.
  const existingEntry =
    priorEntries.find((e) => targetOfEntry(asView(e)) === target && !reversedIds.includes(e._id)) ?? null;
  const ledgerEntryId = existingEntry?._id ?? newId("len");
  const now = new Date().toISOString();
  const date = input.date ?? today();

  const entryFields = {
    ledger_id: ledger._id,
    type: input.type,
    date,
    amount: postedAmount, // positive = the charged party owes the company
    description: `${input.type === "dispute" ? "Dispute" : "Refund"} — ${input.customer_name ?? job.address ?? input.jobId} (${partyLabel})`,
    job_ref: input.jobId,
    technician_id: input.party === "technician" ? (chargedTech || job.tech || null) : (job.tech ?? null),
    dispute_id: recordId,
    // Top level so it can be indexed and queried: this is the other half of
    // the dedup key, and lib/dispute-coverage reads it to decide which
    // targets are already charged. It is still mirrored into the snapshot
    // below for the entries written before the field existed.
    posted_party: target,
    gross_amount: snapshot.disputeOrRefundAmount,
    // Record which party was charged + the posted amount alongside the full
    // snapshot, so the ledger can show the tech/AM split for ANY charge. Also
    // carry the address + customer so the ledger "view more" can show them.
    charge_snapshot: {
      ...(snapshot as unknown as Record<string, unknown>),
      posted_party: target,
      posted_amount: postedAmount,
      address: input.address ?? job.address ?? null,
      customer_name: input.customer_name ?? job.clientName ?? null,
    },
    source: "crm" as const,
    updated_at: now,
  };

  // ── Canonical record fields (shared by dispute + refund). ──
  const sharedRecord = {
    job_id: input.jobId,
    tech_id: job.tech ?? undefined,
    tech_name: job.tech ?? undefined,
    area: location,
    provider_id: job.provider ?? undefined,
    provider_name: job.provider ?? undefined,
    customer_name: input.customer_name ?? job.clientName ?? undefined,
    address: input.address ?? job.address ?? undefined,
    date,
    notes: input.notes ?? undefined,
    area_manager_name: amName,
    area_manager_charge: snapshot.amLedgerCharge,
    technician_chargeback_info: snapshot.technicianPortion,
    area_manager_own_portion: snapshot.areaManagerOwnPortion,
    // Legacy single link — the entry for the target just posted. A record can
    // now have several, so this is no longer the whole story; the authority
    // is lib/dispute-coverage, which reads the entries. Kept because it is
    // written history, and nothing reads it to make a decision.
    ledger_entry_id: ledgerEntryId,
    charge_snapshot: snapshot as unknown as Record<string, unknown>,
  };

  const created = !input.recordId;

  if (!dryRun) {
    // 1) Canonical record (create or update).
    if (input.type === "dispute") {
      const dc = coll<DisputeRecord>(FINANCE_COLLECTIONS.dispute);
      const doc: Partial<DisputeRecord> = {
        ...sharedRecord,
        amount_disputed: num(input.amount),
        status: (input.status as DisputeRecord["status"]) || "open",
      };
      if (created) await dc.insertOne({ _id: recordId, ...doc, created_at: now, created_by: input.actor } as DisputeRecord);
      else await dc.updateOne({ _id: recordId }, { $set: doc });
    } else {
      const rc = coll<RefundRecord>(FINANCE_COLLECTIONS.refund);
      const doc: Partial<RefundRecord> = {
        ...sharedRecord,
        amount: num(input.amount),
        status: (input.status as RefundRecord["status"]) === "paid" ? "paid" : "unpaid",
      };
      if (created) await rc.insertOne({ _id: recordId, ...doc, created_at: now, created_by: input.actor } as RefundRecord);
      else await rc.updateOne({ _id: recordId }, { $set: doc });
    }

    // 2) Ledger entry (insert or update the dedup'd one).
    if (existingEntry) {
      await ec.updateOne({ _id: ledgerEntryId }, { $set: entryFields });
    } else {
      await ec.insertOne({
        _id: ledgerEntryId,
        ...entryFields,
        reverses_id: null,
        created_at: now,
        created_by: input.actor,
      } as LedgerEntryRecord);
    }
  }

  // Coverage as it stands once this write lands, derived the same way the
  // read path derives it — projected rather than re-queried so a dry run can
  // answer "what would the Posted tab show" without writing.
  const after = resolveCoverage({
    snapshot,
    entries: [
      ...priorEntries.filter((e) => e._id !== ledgerEntryId).map(asView),
      {
        _id: ledgerEntryId,
        ledger_id: ledger._id,
        posted_party: target,
        amount: postedAmount,
        date,
        created_at: existingEntry?.created_at ?? now,
      },
    ],
    reversedEntryIds: reversedIds.filter((id) => id !== ledgerEntryId),
    context: coverageContext,
  });

  return {
    ok: true,
    recordId,
    ledgerId: ledger._id,
    ledgerEntryId,
    areaManagerName: amName,
    areaManagerPercent,
    technicianEffectivePercent: technicianPercent,
    snapshot,
    postedAmount,
    party: input.party,
    technicianPortion: snapshot.technicianPortion,
    areaManagerOwnPortion: snapshot.areaManagerOwnPortion,
    chargedTechName: input.party === "technician" ? (chargedTech || job.tech || undefined) : undefined,
    target,
    coverage: after,
    created,
    reused: !!existingEntry,
    dryRun,
  };
}
