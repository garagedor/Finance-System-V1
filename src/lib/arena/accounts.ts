/**
 * Account eligibility: who may hold a prize, from the Weekly Balance side.
 *
 * Prize positions and Most Improved go only to a competitor with a verified
 * identity (a TechNameMapping record — every engine competitor has one), an
 * APPROVED and ACTIVE Weekly Balance account with a competing role, taking
 * part under the competition's participant rules, and all three performance
 * gates met. The engine receives the account standing as input (`accounts`);
 * this module produces it:
 *
 *   fresh   freeze, review open, re-check and approval. Asks the verifier now;
 *           a failed answer is `unverified` (UNRESOLVED — never a
 *           disqualification, and approval is blocked while anyone in
 *           contention is unresolved).
 *   live    the running week (provisional). Asks the verifier now; when that
 *           fails it falls back to the last known answer (marked lastKnown),
 *           else `unverified`.
 *
 * Every successful answer is remembered in arena_account_status (state and
 * time only) for the live fallback. Approved results never consult this again.
 */
import type { StoreCollection } from "./config-store";
import type { AccountInput, AccountState, CompetitionResult } from "./types";
import { accountExcludes } from "./engine";
import { COMPETING_ROLES, type AccountStatus, type TechnicianVerifier } from "./tech/verifier";

export type AccountMode = "live" | "fresh";

export interface AccountCacheDoc {
  _id: string; // competitor id
  state: Exclude<AccountState, "unverified">;
  checkedAt: string;
}

export interface AccountCheckDeps {
  /** null when no verifier is configured here: every answer is `unverified`. */
  verifier: TechnicianVerifier | null;
  cache: StoreCollection<AccountCacheDoc> | null;
  now: () => Date;
  log?: (msg: string) => void;
  /**
   * LIVE mode only: reuse an account answer checked less than this long ago
   * instead of calling the verifier again (a live refresh every few seconds
   * would otherwise call it once per competitor per refresh). Freeze, review
   * and approval ("fresh") always ask the verifier. Unset = always ask.
   */
  liveReuseMs?: number;
}

/** How the Weekly Balance answer maps to an account state. */
export function classifyAccount(s: AccountStatus | null): Exclude<AccountState, "unverified"> {
  if (!s) return "unmapped";
  if (!s.active) return "inactive";
  if (!s.approved) return "pending";
  if (!COMPETING_ROLES.includes(s.role)) return "not_competing_role";
  return "eligible";
}

/** Plain-language reason for the admin review (never shown to technicians). */
export const ACCOUNT_REASON: Record<AccountState, string> = {
  eligible: "Account active and approved",
  pending: "Weekly Balance account pending approval",
  inactive: "Weekly Balance account inactive (deactivated or archived)",
  unmapped: "No Weekly Balance account for this identity",
  not_competing_role: "Weekly Balance role cannot compete",
  unverified: "Account could not be verified (verifier unavailable)",
};

const PARALLEL = 6;

/** Check many accounts. Never throws: a failure is `unverified` (or last known, live). */
export async function checkAccounts(deps: AccountCheckDeps, ids: readonly string[], mode: AccountMode): Promise<Record<string, AccountInput>> {
  const out: Record<string, AccountInput> = {};
  const unique = [...new Set(ids)];
  let failed = 0;
  for (let i = 0; i < unique.length; i += PARALLEL) {
    await Promise.all(
      unique.slice(i, i + PARALLEL).map(async (id) => {
        if (!deps.verifier) {
          out[id] = await fallback(deps, id, mode);
          failed++;
          return;
        }
        if (mode === "live" && deps.liveReuseMs && deps.cache) {
          const last = await deps.cache.findOne({ _id: id }).catch(() => null);
          if (last && deps.now().getTime() - Date.parse(last.checkedAt) < deps.liveReuseMs) {
            out[id] = { state: last.state, checkedAt: last.checkedAt };
            return;
          }
        }
        try {
          const state = classifyAccount(await deps.verifier.verify(id));
          const checkedAt = deps.now().toISOString();
          out[id] = { state, checkedAt };
          await remember(deps, { _id: id, state, checkedAt });
        } catch {
          failed++;
          out[id] = await fallback(deps, id, mode);
        }
      }),
    );
  }
  if (failed) deps.log?.(`[arena] account check unavailable for ${failed} of ${unique.length} competitor(s) (${mode})`);
  return out;
}

async function fallback(deps: AccountCheckDeps, id: string, mode: AccountMode): Promise<AccountInput> {
  if (mode === "live" && deps.cache) {
    const last = await deps.cache.findOne({ _id: id }).catch(() => null);
    if (last) return { state: last.state, checkedAt: last.checkedAt, lastKnown: true };
  }
  return { state: "unverified", checkedAt: null };
}

async function remember(deps: AccountCheckDeps, doc: AccountCacheDoc) {
  if (!deps.cache) return;
  try {
    const cur = await deps.cache.findOne({ _id: doc._id });
    if (cur) await deps.cache.updateOne({ _id: doc._id }, { $set: { state: doc.state, checkedAt: doc.checkedAt } });
    else await deps.cache.insertOne(doc);
  } catch {
    /* the cache is only a live-phase convenience */
  }
}

/** Approval blockers that come from the account rule on the snapshot itself. */
export function accountBlockers(result: CompetitionResult): string[] {
  const ids = result.accountUnresolved ?? [];
  if (!ids.length) return [];
  const names = ids.map((id) => result.results.find((r) => r.competitorId === id)?.displayName ?? id);
  return [
    `Weekly Balance account could not be verified for ${names.join(", ")} (verifier unavailable). Nobody was disqualified or moved; re-check when the verifier is back, then approve`,
  ];
}

/**
 * The owner approves exactly what was reviewed: account standings are checked
 * again right before approval and compared with the snapshot. Any change, or a
 * contender that cannot be verified now, blocks the approval.
 */
export function accountApprovalProblems(result: CompetitionResult, fresh: Readonly<Record<string, AccountInput>>): string[] {
  const changed: string[] = [];
  const unavailable: string[] = [];
  for (const r of result.results) {
    const was = r.account?.state; // undefined: a snapshot from before the account rule
    const now = fresh[r.competitorId]?.state ?? "unverified";
    if (now === "unverified") {
      if (r.eligible) unavailable.push(r.displayName);
      continue;
    }
    if (was !== now) changed.push(`${r.displayName} (${was ?? "not checked"} → ${now})`);
  }
  const out: string[] = [];
  if (unavailable.length)
    out.push(`the Weekly Balance account check is unavailable right now for ${unavailable.join(", ")}; approval is blocked until it answers (nobody is disqualified or moved)`);
  if (changed.length)
    out.push(`Weekly Balance account status changed since this review: ${changed.join(", ")}. Re-check the CRM data and review the updated results before approving`);
  return out;
}

export { accountExcludes };
