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
// Only the AM ledger is charged (the company settles with the AM). The provider,
// company and per-technician figures are computed for the report/snapshot.

import { ObjectId, type Db } from "mongodb";
import {
  getDb, coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId,
} from "@/lib/finance-db";
import { getEffectivePct } from "@/lib/portal-tech-rates";
import { computeDisputeCharge, type DisputeKind } from "@/lib/dispute-charge";
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
      created: boolean;      // true if a new record was created
      reused: boolean;       // true if an existing ledger entry was updated (dedup)
      dryRun: boolean;
    };

async function loadJob(db: Db, jobId: string): Promise<JobRow | null> {
  const or: Record<string, unknown>[] = [{ _id: jobId }];
  if (/^[0-9a-fA-F]{24}$/.test(jobId)) or.push({ _id: new ObjectId(jobId) });
  return db.collection<JobRow>("Job").findOne({ $or: or } as never);
}

/** Find the Area Manager's ledger, creating it if missing. */
async function findOrCreateAmLedger(amName: string, location: string, actor: string, dryRun: boolean) {
  const lc = coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger);
  const existing = await lc.findOne({ role: "area_manager", holder_name: amName });
  if (existing) return existing;
  const ledger: LedgerRecord = {
    _id: newId("ldg"),
    holder_name: amName,
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
  if (!amName) {
    return {
      ok: false,
      error: `No Area Manager is assigned to location "${location}". Assign one on the Area Managers page before charging this dispute/refund.`,
    };
  }
  const areaManagerPercent = num(loc.managerProfitPercent);
  if (areaManagerPercent <= 0) {
    return { ok: false, error: `Location "${location}" has no managerProfitPercent set.` };
  }

  const technicianPercent = await getEffectivePct(job.tech ?? "");
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

  const ledger = await findOrCreateAmLedger(amName, location, input.actor, dryRun);

  // ── Dedup: one ledger entry per canonical record. Reuse it on re-run. ──
  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const existingEntry = await ec.findOne({ dispute_id: recordId });
  const ledgerEntryId = existingEntry?._id ?? newId("len");
  const now = new Date().toISOString();
  const date = input.date ?? today();

  const entryFields = {
    ledger_id: ledger._id,
    type: input.type,
    date,
    amount: snapshot.amLedgerCharge, // positive = AM owes the company
    description: `${input.type === "dispute" ? "Dispute" : "Refund"} — ${input.customer_name ?? job.address ?? input.jobId} (${amName})`,
    job_ref: input.jobId,
    technician_id: job.tech ?? null,
    dispute_id: recordId,
    gross_amount: snapshot.disputeOrRefundAmount,
    charge_snapshot: snapshot as unknown as Record<string, unknown>,
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

  return {
    ok: true,
    recordId,
    ledgerId: ledger._id,
    ledgerEntryId,
    areaManagerName: amName,
    areaManagerPercent,
    technicianEffectivePercent: technicianPercent,
    snapshot,
    created,
    reused: !!existingEntry,
    dryRun,
  };
}
