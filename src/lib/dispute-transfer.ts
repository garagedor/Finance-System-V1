// Move a posted dispute/refund charge from one Area Manager's ledger to
// another's — the dispute was charged to the wrong AM, or the location changed
// hands. Pure: the route loads the documents and writes what this returns.
//
// The entry is MOVED, not reversed and re-posted: ledger entries are unique
// per (dispute_id, posted_party), so a second "combined" entry for the same
// dispute cannot exist even after the first is reversed. This is the same
// in-place move the dispute service makes when a target is re-posted.
//
// Nothing is recalculated. The charge comes from the job's location
// (managerProfitPercent) and technician, not from which AM holds the ledger,
// so the amount and the stored snapshot carry over unchanged.

import type { LedgerEntryRecord, LedgerRecord } from "@/types/finance-ledger";

const normRole = (r: unknown) => String(r ?? "").toLowerCase().replace(/[\s_-]+/g, "");
export const isAmLedgerRole = (r: unknown) => normRole(r) === "areamanager";

export interface TransferInput {
  entry: LedgerEntryRecord;
  from: LedgerRecord;
  to: LedgerRecord | null;
  /** The entry has a reversal posted against it. */
  isReversed: boolean;
  /** Another live entry for the same dispute already sits on the target ledger. */
  targetHasLiveEntry: boolean;
}

export type TransferPlan =
  | { ok: false; status: number; error: string }
  | { ok: true; set: Record<string, unknown>; areaManagerName: string };

/** Swap the AM name inside a stored description: "… (AM Old + tech T)". */
export function retitleForAm(description: string, amName: string): string {
  return description.replace(/\(AM [^()]*?( \+ tech [^()]*)?\)\s*$/, (_m, tech: string | undefined) => `(AM ${amName}${tech ?? ""})`);
}

export function planDisputeTransfer(input: TransferInput, actor: string, now: string): TransferPlan {
  const { entry, from, to } = input;
  if (entry.type !== "dispute" && entry.type !== "refund") {
    return { ok: false, status: 400, error: "Only dispute and refund charges can be transferred." };
  }
  if (!entry.dispute_id) return { ok: false, status: 400, error: "This entry isn't linked to a dispute/refund record." };
  if (entry.reverses_id) return { ok: false, status: 400, error: "A reversal can't be transferred." };
  if (input.isReversed) return { ok: false, status: 409, error: "This charge was reversed — there is nothing left to transfer." };
  if (!isAmLedgerRole(from.role)) return { ok: false, status: 400, error: "Only charges on an Area Manager's ledger can be transferred." };
  if (!to) return { ok: false, status: 404, error: "Target ledger not found." };
  if (to._id === from._id) return { ok: false, status: 400, error: "Pick a different Area Manager's ledger." };
  if (!isAmLedgerRole(to.role)) return { ok: false, status: 400, error: `"${to.holder_name}" is not an Area Manager ledger.` };
  if (to.status !== "active") return { ok: false, status: 400, error: `"${to.holder_name}"'s ledger is archived.` };
  if (input.targetHasLiveEntry) {
    return { ok: false, status: 409, error: `"${to.holder_name}" already has a charge for this dispute — it would be charged twice.` };
  }

  const amName = to.holder_name.trim();
  const transfer = { from_ledger_id: from._id, from_holder_name: from.holder_name, to_ledger_id: to._id, to_holder_name: to.holder_name, at: now, by: actor };
  return {
    ok: true,
    areaManagerName: amName,
    set: {
      ledger_id: to._id,
      description: retitleForAm(String(entry.description ?? ""), amName),
      transfers: [...(entry.transfers ?? []), transfer],
      updated_at: now,
    },
  };
}
