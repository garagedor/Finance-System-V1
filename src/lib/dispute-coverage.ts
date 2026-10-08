import "server-only";

/* ═══════════════════════════════════════════════════════════════════════════
   Posting coverage, read from the financial records.

   The rules live in lib/dispute-targets, which is pure. This is the thin part
   that fetches: the canonical finance_dispute / finance_refund record, every
   ledger entry that points at it, and any reversal of those entries. It then
   hands all of it to the resolver.

   Why it reads entries rather than a flag: a dispute can be charged from the
   inbox, from an Area Manager's ledger page, from a provider's ledger page,
   or in a bulk charge. Only the entries see all four. A `providerPosted` flag
   would be written by whichever path remembered to, and would be wrong the
   first time somebody used one that did not.
   ═══════════════════════════════════════════════════════════════════════════ */

import { coll, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import type { DisputeRecord, RefundRecord } from "@/types/finance";
import type { LedgerEntryRecord, LedgerRecord } from "@/types/finance-ledger";
import type { ScanpayComputedShare } from "@/types/scanpay";
import type { DisputeKind } from "@/lib/dispute-charge";
import {
  resolveCoverage, targetOfEntry,
  type CoverageContext, type HistoricalEvidence, type PostedEntryView,
  type PostingCoverage, type PostingTarget,
} from "@/lib/dispute-targets.ts";

/** The four slices, however they were obtained. */
export type Slices = {
  technicianPortion: number;
  areaManagerOwnPortion: number;
  providerCharge: number;
  amLedgerCharge: number;
};

const num = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Pull the slices out of a stored charge_snapshot blob. */
export function slicesFromSnapshot(snapshot: Record<string, unknown> | null | undefined): Slices {
  const s = snapshot ?? {};
  return {
    technicianPortion: num(s["technicianPortion"]),
    areaManagerOwnPortion: num(s["areaManagerOwnPortion"]),
    providerCharge: num(s["providerCharge"]),
    amLedgerCharge: num(s["amLedgerCharge"]),
  };
}

/** The inbox stores the same four on the ScanPay record at verify time. */
export function slicesFromComputedShare(share: ScanpayComputedShare | null | undefined): Slices {
  return {
    technicianPortion: num(share?.technicianPortion),
    areaManagerOwnPortion: num(share?.areaManagerOwnPortion),
    providerCharge: num(share?.providerCharge),
    amLedgerCharge: num(share?.amLedgerCharge),
  };
}

/**
 * Everything a sibling record or a historical mark can tell us about whether
 * this item has already been charged.
 *
 * Two shapes exist in production, both from before one dispute could carry
 * several postings:
 *
 *   chargedElsewhere   a separate record for the same job and amount holds a
 *                      LIVE ledger entry. We know that party is charged, and
 *                      we know where. Blocks exactly that target.
 *
 *   historicalEvidence money may have moved and nothing says for whom:
 *                      · an inbox item marked charged with no posting linked
 *                        to it — the mark is written both by a real ledger
 *                        charge and by the manual "Mark charged" toggle, and
 *                        after the fact the two are identical;
 *                      · a separate record for the same job and amount with
 *                        no live entry — a charge was attempted and left a
 *                        record but no money.
 *                      Names no target, so it puts all of them under review.
 *
 * Matched on job AND amount: a job can legitimately carry two real disputes,
 * and the same amount on the same job is what makes it one dispute written
 * twice. Measured against production, these two rules put 12 of 426 matched
 * items under review and leave 414 freely postable.
 */
export interface SiblingAnalysis {
  chargedElsewhere: { target: PostingTarget; recordId: string }[];
  historicalEvidence: HistoricalEvidence[];
}

const EMPTY_ANALYSIS: SiblingAnalysis = { chargedElsewhere: [], historicalEvidence: [] };

export interface AnalysisSubject {
  /** The canonical record, when one exists. Excluded from its own siblings. */
  recordId: string | null;
  jobId: string | undefined;
  amount: number;
  /** The inbox item, when the caller has one — rule A needs it. */
  scanpayId?: string | null;
  chargedAt?: string | null;
  hasLink?: boolean;
}

/**
 * Batched for a whole page. A per-row version of this would be ~900 round
 * trips on a 300-row Posted tab against a cluster in another region; this is
 * four queries regardless of the page size.
 */
export async function siblingAnalysisBatch(
  subjects: AnalysisSubject[],
  kind: DisputeKind,
): Promise<Map<string, SiblingAnalysis>> {
  const out = new Map<string, SiblingAnalysis>();
  const key = (s: AnalysisSubject) => s.recordId ?? `sp:${s.scanpayId ?? ""}`;

  // Rule A needs nothing but the subject itself.
  for (const s of subjects) {
    const evidence: HistoricalEvidence[] = [];
    if (s.chargedAt && !s.hasLink) {
      evidence.push({
        kind: "charged_flag",
        detail: `inbox item ${s.scanpayId ?? "(this item)"} was marked charged on ${String(s.chargedAt).slice(0, 10)} with no posting linked to it`,
      });
    }
    if (evidence.length) out.set(key(s), { chargedElsewhere: [], historicalEvidence: evidence });
  }

  const jobs = [...new Set(subjects.map((s) => s.jobId).filter((j): j is string => !!j))];
  if (jobs.length === 0) return out;

  const amountField = kind === "dispute" ? "amount_disputed" : "amount";
  const family = kind === "dispute"
    ? await coll<DisputeRecord>(FINANCE_COLLECTIONS.dispute)
        .find({ job_id: { $in: jobs } } as never)
        .project({ _id: 1, job_id: 1, [amountField]: 1 }).toArray()
    : await coll<RefundRecord>(FINANCE_COLLECTIONS.refund)
        .find({ job_id: { $in: jobs } } as never)
        .project({ _id: 1, job_id: 1, [amountField]: 1 }).toArray();
  if (family.length === 0) return out;

  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const entries = await ec.find({ dispute_id: { $in: family.map((f) => String(f._id)) } }).toArray();
  const reversed = entries.length
    ? new Set(
        (await ec.find({ reverses_id: { $in: entries.map((e) => e._id) } }, { projection: { reverses_id: 1 } }).toArray())
          .map((r) => String(r.reverses_id)),
      )
    : new Set<string>();

  /* Rule A, job-wide: any inbox item for this job and amount that is marked
     charged and has no posting linked to it. The subject-level check above
     covers the inbox posting its own item; this covers a charge arriving
     from a ledger page or a direct API call, where the service has a job and
     an amount and no idea which inbox item they belong to. Deliberately NOT
     excluding the subject — an item that is itself marked charged and
     unlinked is exactly the case that must be refused. */
  const spColl = kind === "dispute" ? FINANCE_COLLECTIONS.scanpayDispute : FINANCE_COLLECTIONS.scanpayRefund;
  const spAmountField = kind === "dispute" ? "amount" : "refundAmount";
  const chargedUnlinked = await coll<Record<string, unknown>>(spColl)
    .find({ matchedJobId: { $in: jobs }, chargedAt: { $type: "string" }, postedRecordId: null } as never)
    .project({ _id: 1, matchedJobId: 1, chargedAt: 1, [spAmountField]: 1 })
    .toArray();

  const liveTargetByRecord = new Map<string, PostingTarget>();
  for (const e of entries) {
    if (reversed.has(e._id)) continue;
    const nested = (e.charge_snapshot as Record<string, unknown> | null | undefined)?.["posted_party"];
    liveTargetByRecord.set(String(e.dispute_id), targetOfEntry({
      _id: e._id, ledger_id: e.ledger_id, amount: num(e.amount),
      posted_party: (e.posted_party ?? (typeof nested === "string" ? nested : null)) as PostingTarget | null,
    }));
  }

  for (const s of subjects) {
    if (!s.jobId) continue;

    for (const sp of chargedUnlinked) {
      if (sp["matchedJobId"] !== s.jobId) continue;
      if (num(sp[spAmountField]) !== s.amount) continue;
      const k2 = key(s);
      const prior2 = out.get(k2) ?? { chargedElsewhere: [], historicalEvidence: [] };
      const detail = `inbox item ${String(sp["_id"])} was marked charged on ${String(sp["chargedAt"]).slice(0, 10)} with no posting linked to it`;
      if (!prior2.historicalEvidence.some((e) => e.detail === detail)) {
        prior2.historicalEvidence.push({ kind: "charged_flag", detail });
      }
      out.set(k2, prior2);
    }

    const sibs = family.filter((f) =>
      String(f._id) !== s.recordId &&
      f.job_id === s.jobId &&
      num((f as Record<string, unknown>)[amountField]) === s.amount);
    if (sibs.length === 0) continue;

    const k = key(s);
    const prior = out.get(k) ?? { chargedElsewhere: [], historicalEvidence: [] };
    for (const sib of sibs) {
      const target = liveTargetByRecord.get(String(sib._id));
      if (target) {
        prior.chargedElsewhere.push({ target, recordId: String(sib._id) });
      } else {
        // A record with no live entry is an attempted charge. It may have
        // failed, been a dry run, or been reversed without a trace — none of
        // which can be told apart from here.
        prior.historicalEvidence.push({
          kind: "attempted_charge",
          detail: `record ${String(sib._id)} exists for this job and amount with no live ledger entry`,
        });
      }
    }
    out.set(k, prior);
  }
  return out;
}

/** One subject. Prefer the batch form on anything that renders a list. */
export async function siblingAnalysis(
  subject: AnalysisSubject,
  kind: DisputeKind,
): Promise<SiblingAnalysis> {
  const m = await siblingAnalysisBatch([subject], kind);
  return m.get(subject.recordId ?? `sp:${subject.scanpayId ?? ""}`) ?? EMPTY_ANALYSIS;
}

export interface RecordCoverage extends PostingCoverage {
  /** Null when nothing has been posted yet and no canonical record exists. */
  recordId: string | null;
  kind: DisputeKind;
}

/** Entries for one canonical record, with their ledger's name attached. */
async function entriesFor(recordId: string): Promise<{ entries: PostedEntryView[]; reversedIds: string[] }> {
  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const raw = await ec.find({ dispute_id: recordId }).toArray();
  if (raw.length === 0) return { entries: [], reversedIds: [] };

  const ids = raw.map((e) => e._id);
  const [reversals, ledgers] = await Promise.all([
    // A reversal is a plain adjustment pointing back at the entry; it carries
    // no dispute_id of its own, so it has to be looked up separately.
    ec.find({ reverses_id: { $in: ids } }, { projection: { reverses_id: 1 } }).toArray(),
    coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger)
      .find({ _id: { $in: [...new Set(raw.map((e) => e.ledger_id))] } })
      .toArray(),
  ]);
  const byLedger = new Map(ledgers.map((l) => [l._id, l]));

  return {
    entries: raw.map((e) => {
      const l = byLedger.get(e.ledger_id);
      // posted_party moved to the top level so it can be indexed and queried.
      // Entries written before that still carry it inside the snapshot blob.
      const nested = (e.charge_snapshot as Record<string, unknown> | null | undefined)?.["posted_party"];
      return {
        _id: e._id,
        ledger_id: e.ledger_id,
        posted_party: (e.posted_party ?? (typeof nested === "string" ? nested : null)) as PostingTarget | null,
        amount: num(e.amount),
        date: e.date ?? null,
        created_at: e.created_at,
        ledger_name: l ? `${l.holder_name}${l.location ? ` · ${l.location}` : ""}` : null,
        ledger_role: l?.role ?? null,
      } satisfies PostedEntryView;
    }),
    reversedIds: reversals.map((r) => String(r.reverses_id)).filter(Boolean),
  };
}

/**
 * Coverage for a canonical record that exists.
 *
 * The snapshot stored on the record is the authority for the slices: it is
 * what the engine computed when the record was last written, and it is what
 * every posting is charged from.
 */
export async function coverageForRecord(
  recordId: string,
  kind: DisputeKind,
): Promise<RecordCoverage | null> {
  const record = kind === "dispute"
    ? await coll<DisputeRecord>(FINANCE_COLLECTIONS.dispute).findOne({ _id: recordId })
    : await coll<RefundRecord>(FINANCE_COLLECTIONS.refund).findOne({ _id: recordId });
  if (!record) return null;

  const amount = kind === "dispute"
    ? num((record as DisputeRecord).amount_disputed)
    : num((record as RefundRecord).amount);

  const [{ entries, reversedIds }, analysis] = await Promise.all([
    entriesFor(recordId),
    siblingAnalysis({ recordId, jobId: record.job_id, amount, hasLink: true }, kind),
  ]);

  return {
    recordId,
    kind,
    ...resolveCoverage({
      snapshot: slicesFromSnapshot(record.charge_snapshot),
      entries,
      reversedEntryIds: reversedIds,
      context: {
        ...contextFromRecord(record),
        chargedElsewhere: analysis.chargedElsewhere,
        historicalEvidence: analysis.historicalEvidence,
      },
    }),
  };
}

/** What the record itself says about who exists to be charged. */
export function contextFromRecord(record: Pick<DisputeRecord, "provider_id" | "provider_name" | "area_manager_name" | "tech_id" | "tech_name">): CoverageContext {
  return {
    hasProvider: !!(record.provider_id ?? record.provider_name),
    hasAreaManager: !!(record.area_manager_name ?? "").trim(),
    hasTechnician: !!(record.tech_id ?? record.tech_name),
  };
}

/**
 * Coverage for an inbox item.
 *
 * Before anything is posted there is no canonical record, so the slices come
 * from the dry run stored at verify time and nothing is posted by definition.
 * Afterwards it is the record's coverage. Both shapes are the same, so the
 * Posted tab and the Disputes tab render from one thing.
 */
export async function coverageForInboxItem(args: {
  postedRecordId: string | null;
  kind: DisputeKind;
  computedShare: ScanpayComputedShare | null | undefined;
  /** Fallback context for an item that has not been posted yet. */
  context: CoverageContext;
  /** Needed to look for historical charges on an item with no link yet. */
  scanpayId?: string | null;
  jobId?: string | null;
  amount?: number;
  chargedAt?: string | null;
}): Promise<RecordCoverage> {
  if (args.postedRecordId) {
    const found = await coverageForRecord(args.postedRecordId, args.kind);
    if (found) return found;
    // The record id is stale — the record was deleted out from under it. Fall
    // through rather than failing the page; nothing is posted if nothing is
    // there to have posted it.
  }

  // An unlinked item is exactly where the historical marks live: charged at
  // some point, nothing to show for it. Returning empty coverage here — as
  // this used to — is what would offer a Post button on one.
  const analysis = await siblingAnalysis({
    recordId: null,
    scanpayId: args.scanpayId ?? null,
    jobId: args.jobId ?? undefined,
    amount: args.amount ?? 0,
    chargedAt: args.chargedAt ?? null,
    hasLink: !!args.postedRecordId,
  }, args.kind);

  return {
    recordId: args.postedRecordId,
    kind: args.kind,
    ...resolveCoverage({
      snapshot: slicesFromComputedShare(args.computedShare),
      entries: [],
      context: {
        ...args.context,
        chargedElsewhere: analysis.chargedElsewhere,
        historicalEvidence: analysis.historicalEvidence,
      },
    }),
  };
}

/* ── One page of inbox items, linked or not ──────────────────────────── */

export interface InboxSubject {
  scanpayId: string;
  postedRecordId: string | null;
  jobId: string | null;
  amount: number;
  chargedAt: string | null;
  computedShare: ScanpayComputedShare | null | undefined;
  context: CoverageContext;
}

/**
 * Coverage for a whole inbox page, keyed by ScanPay id.
 *
 * Linked and unlinked items go through the same call on purpose. An unlinked
 * item that was marked charged is the ambiguous historical case, and
 * resolving only the linked ones — as the page did — is what left it with no
 * coverage, no banner, and a Post button.
 *
 * Four queries for the records, four for the analysis, however many rows.
 */
export async function coverageForInboxItems(
  subjects: InboxSubject[],
  kind: DisputeKind,
): Promise<Map<string, RecordCoverage>> {
  const out = new Map<string, RecordCoverage>();
  if (subjects.length === 0) return out;

  const linkedIds = subjects.map((s) => s.postedRecordId).filter((x): x is string => !!x);
  const records = linkedIds.length
    ? (kind === "dispute"
        ? await coll<DisputeRecord>(FINANCE_COLLECTIONS.dispute).find({ _id: { $in: linkedIds } }).toArray()
        : await coll<RefundRecord>(FINANCE_COLLECTIONS.refund).find({ _id: { $in: linkedIds } }).toArray())
    : [];
  const recordById = new Map(records.map((r) => [r._id, r]));

  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const allEntries = records.length
    ? await ec.find({ dispute_id: { $in: records.map((r) => r._id) } }).toArray()
    : [];
  const [reversals, ledgers] = await Promise.all([
    allEntries.length
      ? ec.find({ reverses_id: { $in: allEntries.map((e) => e._id) } }, { projection: { reverses_id: 1 } }).toArray()
      : Promise.resolve([]),
    allEntries.length
      ? coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger)
          .find({ _id: { $in: [...new Set(allEntries.map((e) => e.ledger_id))] } }).toArray()
      : Promise.resolve([]),
  ]);
  const byLedger = new Map(ledgers.map((l) => [l._id, l]));
  const reversedIds = reversals.map((r) => String(r.reverses_id)).filter(Boolean);

  const entriesByRecord = new Map<string, PostedEntryView[]>();
  for (const e of allEntries) {
    const l = byLedger.get(e.ledger_id);
    const nested = (e.charge_snapshot as Record<string, unknown> | null | undefined)?.["posted_party"];
    const key = String(e.dispute_id);
    entriesByRecord.set(key, [...(entriesByRecord.get(key) ?? []), {
      _id: e._id,
      ledger_id: e.ledger_id,
      posted_party: (e.posted_party ?? (typeof nested === "string" ? nested : null)) as PostingTarget | null,
      amount: num(e.amount),
      date: e.date ?? null,
      created_at: e.created_at,
      ledger_name: l ? `${l.holder_name}${l.location ? ` · ${l.location}` : ""}` : null,
      ledger_role: l?.role ?? null,
    }]);
  }

  const analysis = await siblingAnalysisBatch(
    subjects.map((s) => ({
      recordId: s.postedRecordId,
      scanpayId: s.scanpayId,
      jobId: s.jobId ?? undefined,
      amount: s.amount,
      chargedAt: s.chargedAt,
      hasLink: !!s.postedRecordId,
    })),
    kind,
  );

  for (const s of subjects) {
    const record = s.postedRecordId ? recordById.get(s.postedRecordId) : undefined;
    const a = analysis.get(s.postedRecordId ?? `sp:${s.scanpayId}`)
      ?? { chargedElsewhere: [], historicalEvidence: [] };
    out.set(s.scanpayId, {
      recordId: s.postedRecordId,
      kind,
      ...resolveCoverage({
        // A linked record's own snapshot is the authority; an unlinked item
        // only has the dry run stored at verify time.
        snapshot: record ? slicesFromSnapshot(record.charge_snapshot) : slicesFromComputedShare(s.computedShare),
        entries: s.postedRecordId ? (entriesByRecord.get(s.postedRecordId) ?? []) : [],
        reversedEntryIds: reversedIds,
        context: {
          ...(record ? contextFromRecord(record) : s.context),
          chargedElsewhere: a.chargedElsewhere,
          historicalEvidence: a.historicalEvidence,
        },
      }),
    });
  }
  return out;
}
