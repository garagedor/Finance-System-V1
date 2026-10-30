/**
 * Technician access decisions, free of Next.js so they can be unit-tested:
 *
 *   exchange()      Weekly Balance access token → Arena pass
 *   authorizePass() every technician request: valid pass AND, re-checked now,
 *                   the master switch, the Weekly Balance account (active +
 *                   approved + competing role) and the competitor mapping /
 *                   Arena participation. A pass alone is never sufficient.
 */
import type { ExchangeError, ExchangeResponse, ArenaErrorBody } from "../tech-api-contract";
import { WbTokenError } from "./wb-token";
import { isAllowed, VerifierUnavailableError, type TechnicianVerifier } from "./verifier";
import { issuePass, verifyPass, PassError, type PassKeys } from "./pass";
import type { MemoryRateLimiter } from "./rate-limit";

export interface CompetitorLookup {
  competitorId: string;
  displayName: string;
}

export type Lookup =
  | { ok: true; competitor: CompetitorLookup }
  /** unmapped, mapping moved to someone else, or excluded from the Arena */
  | { ok: false };

export interface AccessDeps {
  enabled: boolean;
  verifyWbToken: (token: string) => Promise<{ userId: string }>;
  verifier: TechnicianVerifier;
  findCompetitor: (supabaseUserId: string) => Promise<Lookup>;
  passKeys: PassKeys;
  passTtlSeconds: number;
  limiters: { ip: MemoryRateLimiter; userIp: MemoryRateLimiter };
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface Outcome<T> {
  status: number;
  body: T | ArenaErrorBody;
}

const err = (status: number, code: ArenaErrorBody["code"], error: string): Outcome<never> => ({ status, body: { error, code } });
const MESSAGES: Record<ExchangeError, string> = {
  invalid_token: "Sign in to Weekly Balance again",
  account_inactive: "Your Weekly Balance account is not active",
  not_a_competitor: "You are not registered for the Arena",
  arena_disabled: "The Arena is not available right now",
  rate_limited: "Too many attempts; wait a minute and try again",
};
const fail = (status: number, code: ExchangeError) => err(status, code, MESSAGES[code]);

export function bearer(authorization: string | null | undefined): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/.exec((authorization ?? "").trim());
  return m ? m[1] : null;
}

/** Account check shared by exchange and every request. */
async function accountAndMapping(deps: AccessDeps, userId: string): Promise<Outcome<never> | CompetitorLookup> {
  let status;
  try {
    status = await deps.verifier.verify(userId);
  } catch (e) {
    deps.log?.(`[arena-tech] verifier unavailable: ${e instanceof VerifierUnavailableError ? e.message : "error"}`);
    return fail(503, "arena_disabled"); // fail closed
  }
  if (!isAllowed(status)) return fail(403, "account_inactive");
  const found = await deps.findCompetitor(userId);
  if (!found.ok) return fail(403, "not_a_competitor");
  return found.competitor;
}

export async function exchange(deps: AccessDeps, authorization: string | null, ip: string): Promise<Outcome<ExchangeResponse>> {
  if (!deps.enabled) return fail(503, "arena_disabled");
  if (!deps.limiters.ip.take(`ip:${ip}`)) return fail(429, "rate_limited");
  const token = bearer(authorization);
  if (!token) return fail(401, "invalid_token");
  let userId: string;
  try {
    ({ userId } = await deps.verifyWbToken(token));
  } catch (e) {
    if (!(e instanceof WbTokenError)) deps.log?.("[arena-tech] token verification error");
    return fail(401, "invalid_token");
  }
  if (!deps.limiters.userIp.take(`u:${userId}|${ip}`)) return fail(429, "rate_limited");
  const who = await accountAndMapping(deps, userId);
  if ("status" in who) return who;
  const { pass, expiresAt } = await issuePass(deps.passKeys, who.competitorId, deps.passTtlSeconds, deps.now?.());
  return { status: 200, body: { pass, expiresAt, competitorId: who.competitorId, displayName: who.displayName } };
}

export async function authorizePass(
  deps: AccessDeps,
  authorization: string | null,
): Promise<{ ok: true; competitorId: string } | { ok: false; outcome: Outcome<never> }> {
  if (!deps.enabled) return { ok: false, outcome: fail(503, "arena_disabled") };
  const token = bearer(authorization);
  if (!token) return { ok: false, outcome: err(401, "unauthorized", "An Arena pass is required") };
  let competitorId: string;
  try {
    ({ competitorId } = await verifyPass(deps.passKeys, token, deps.now?.()));
  } catch (e) {
    if (!(e instanceof PassError)) throw e;
    return { ok: false, outcome: err(401, "unauthorized", "The Arena pass is invalid or expired") };
  }
  // Competitor id = the Weekly Balance user id (one TechNameMapping record).
  const who = await accountAndMapping(deps, competitorId);
  if ("status" in who) return { ok: false, outcome: who };
  if (who.competitorId !== competitorId) return { ok: false, outcome: fail(403, "not_a_competitor") };
  return { ok: true, competitorId };
}
