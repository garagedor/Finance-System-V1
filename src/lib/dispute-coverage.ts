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
  type CoverageContext, type PostedEntryView, type PostingCoverage, type PostingTarget,
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
 * Parties charged under a DIFFERENT record for the same economic dispute.
 *
 * Before one dispute could carry several postings, charging a second party
 * meant creating a second finance_dispute from a ledger page. Production
 * carries 24 jobs shaped that way — typically the Area Manager on the record
 * the inbox knows about and the provider on a sibling. Per-record coverage
 * cannot see the sibling, so the Posted tab would offer a provider charge
 * that already exists.
 *
 * Matched on job AND amount, because a job can legitimately carry two real
 * disputes; the same amount on the same job is what makes it one dispute
 * written twice. The result only ever blocks a target, never claims it as
 * this record's own posting — merging the two records is a person's call.
 */
export async function chargedUnderSiblingRecords(
  record: { _id: string; job_id?: string; amount: number },
  kind: DisputeKind,
): Promise<{ target: PostingTarget; recordId: string }[]> {
  if (!record.job_id) return [];

  const amountField = kind === "dispute" ? "amount_disputed" : "amount";
  const siblings = kind === "dispute"
    ? await coll<DisputeRecord>(FINANCE_COLLECTIONS.dispute)
        .find({ job_id: record.job_id, _id: { $ne: record._id }, [amountField]: record.amount } as never)
        .project({ _id: 1 }).toArray()
    : await coll<RefundRecord>(FINANCE_COLLECTIONS.refund)
        .find({ job_id: record.job_id, _id: { $ne: record._id }, [amountField]: record.amount } as never)
        .project({ _id: 1 }).toArray();
  if (siblings.length === 0) return [];

  const ids = siblings.map((r) => String(r._id));
  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const entries = await ec.find({ dispute_id: { $in: ids } }).toArray();
  if (entries.length === 0) return [];

  // A reversed sibling charge is not a charge, so it must not block.
  const reversed = new Set(
    (await ec.find({ reverses_id: { $in: entries.map((e) => e._id) } }, { projection: { reverses_id: 1 } }).toArray())
      .map((r) => String(r.reverses_id)),
  );

  const out: { target: PostingTarget; recordId: string }[] = [];
  for (const e of entries) {
    if (reversed.has(e._id)) continue;
    const nested = (e.charge_snapshot as Record<string, unknown> | null | undefined)?.["posted_party"];
    out.push({
      target: targetOfEntry({
        _id: e._id, ledger_id: e.ledger_id, amount: num(e.amount),
        posted_party: (e.posted_party ?? (typeof nested === "string" ? nested : null)) as PostingTarget | null,
      }),
      recordId: String(e.dispute_id),
    });
  }
  return out;
}

/**
 * The same question for a whole page of records, in a fixed number of
 * queries.
 *
 * The single-record version above is two round trips; calling it per row on
 * a 300-row Posted tab would be ~900, against a cluster in another region.
 * This resolves the whole set with three.
 */
export async function chargedUnderSiblingRecordsBatch(
  records: { _id: string; job_id?: string; amount: number }[],
  kind: DisputeKind,
): Promise<Map<string, { target: PostingTarget; recordId: string }[]>> {
  const out = new Map<string, { target: PostingTarget; recordId: string }[]>();
  const jobs = [...new Set(records.map((r) => r.job_id).filter((j): j is string => !!j))];
  if (jobs.length === 0) return out;

  // Every record on any of these jobs, including the ones passed in.
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
  if (entries.length === 0) return out;

  const reversed = new Set(
    (await ec.find({ reverses_id: { $in: entries.map((e) => e._id) } }, { projection: { reverses_id: 1 } }).toArray())
      .map((r) => String(r.reverses_id)),
  );

  const targetByRecord = new Map<string, PostingTarget>();
  for (const e of entries) {
    if (reversed.has(e._id)) continue;
    const nested = (e.charge_snapshot as Record<string, unknown> | null | undefined)?.["posted_party"];
    targetByRecord.set(String(e.dispute_id), targetOfEntry({
      _id: e._id, ledger_id: e.ledger_id, amount: num(e.amount),
      posted_party: (e.posted_party ?? (typeof nested === "string" ? nested : null)) as PostingTarget | null,
    }));
  }

  // Same job AND same amount is what makes two records one dispute written
  // twice; a job can legitimately carry two genuinely different disputes.
  for (const r of records) {
    if (!r.job_id) continue;
    const sibs = family.filter((f) =>
      String(f._id) !== r._id &&
      f.job_id === r.job_id &&
      num((f as Record<string, unknown>)[amountField]) === r.amount);
    const charged = sibs
      .map((sib) => ({ target: targetByRecord.get(String(sib._id)), recordId: String(sib._id) }))
      .filter((x): x is { target: PostingTarget; recordId: string } => !!x.target);
    if (charged.length > 0) out.set(r._id, charged);
  }
  return out;
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

  const [{ entries, reversedIds }, chargedElsewhere] = await Promise.all([
    entriesFor(recordId),
    chargedUnderSiblingRecords({ _id: recordId, job_id: record.job_id, amount }, kind),
  ]);

  return {
    recordId,
    kind,
    ...resolveCoverage({
      snapshot: slicesFromSnapshot(record.charge_snapshot),
      entries,
      reversedEntryIds: reversedIds,
      context: { ...contextFromRecord(record), chargedElsewhere },
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
}): Promise<RecordCoverage> {
  if (args.postedRecordId) {
    const found = await coverageForRecord(args.postedRecordId, args.kind);
    if (found) return found;
    // The record id is stale — the record was deleted out from under it. Fall
    // through rather than failing the page; nothing is posted if nothing is
    // there to have posted it.
  }
  return {
    recordId: args.postedRecordId,
    kind: args.kind,
    ...resolveCoverage({
      snapshot: slicesFromComputedShare(args.computedShare),
      entries: [],
      context: args.context,
    }),
  };
}

/** Coverage for many inbox items at once, for a list page. */
export async function coverageForRecords(
  ids: readonly string[],
  kind: DisputeKind,
): Promise<Map<string, RecordCoverage>> {
  const out = new Map<string, RecordCoverage>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;

  const records = kind === "dispute"
    ? await coll<DisputeRecord>(FINANCE_COLLECTIONS.dispute).find({ _id: { $in: unique } }).toArray()
    : await coll<RefundRecord>(FINANCE_COLLECTIONS.refund).find({ _id: { $in: unique } }).toArray();
  if (records.length === 0) return out;

  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const recordIds = records.map((r) => r._id);
  const allEntries = await ec.find({ dispute_id: { $in: recordIds } }).toArray();

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

  const byRecord = new Map<string, PostedEntryView[]>();
  for (const e of allEntries) {
    const l = byLedger.get(e.ledger_id);
    const nested = (e.charge_snapshot as Record<string, unknown> | null | undefined)?.["posted_party"];
    const view: PostedEntryView = {
      _id: e._id,
      ledger_id: e.ledger_id,
      posted_party: (e.posted_party ?? (typeof nested === "string" ? nested : null)) as PostingTarget | null,
      amount: num(e.amount),
      date: e.date ?? null,
      created_at: e.created_at,
      ledger_name: l ? `${l.holder_name}${l.location ? ` · ${l.location}` : ""}` : null,
      ledger_role: l?.role ?? null,
    };
    const key = String(e.dispute_id);
    byRecord.set(key, [...(byRecord.get(key) ?? []), view]);
  }

  const amountOf = (r: DisputeRecord | RefundRecord) =>
    kind === "dispute" ? num((r as DisputeRecord).amount_disputed) : num((r as RefundRecord).amount);

  // Resolved for the whole page at once — a per-row lookup here is an N+1 on
  // the hottest screen in the module.
  const siblings = await chargedUnderSiblingRecordsBatch(
    records.map((r) => ({ _id: r._id, job_id: r.job_id, amount: amountOf(r) })),
    kind,
  );

  for (const r of records) {
    out.set(r._id, {
      recordId: r._id,
      kind,
      ...resolveCoverage({
        snapshot: slicesFromSnapshot(r.charge_snapshot),
        entries: byRecord.get(r._id) ?? [],
        reversedEntryIds: reversedIds,
        context: {
          ...contextFromRecord(r),
          chargedElsewhere: siblings.get(r._id) ?? [],
        },
      }),
    });
  }
  return out;
}
