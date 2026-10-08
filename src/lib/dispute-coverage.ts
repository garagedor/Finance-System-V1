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
  resolveCoverage,
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

  const { entries, reversedIds } = await entriesFor(recordId);

  return {
    recordId,
    kind,
    ...resolveCoverage({
      snapshot: slicesFromSnapshot(record.charge_snapshot),
      entries,
      reversedEntryIds: reversedIds,
      context: contextFromRecord(record),
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

  for (const r of records) {
    out.set(r._id, {
      recordId: r._id,
      kind,
      ...resolveCoverage({
        snapshot: slicesFromSnapshot(r.charge_snapshot),
        entries: byRecord.get(r._id) ?? [],
        reversedEntryIds: reversedIds,
        context: contextFromRecord(r),
      }),
    });
  }
  return out;
}
