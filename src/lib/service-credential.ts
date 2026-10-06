/**
 * The credential Warehouse presents when it asks the CRM about a session.
 *
 * Dedicated on purpose. It is not JWT_SECRET, not the Warehouse RS256 signing
 * key, not a user's session cookie, and not a shared general-purpose API key:
 * each of those would make this endpoint reachable by anything already holding
 * that secret for another reason, and would mean rotating one thing rotates
 * the other.
 *
 * It authenticates *Warehouse to the CRM*. It carries no user identity and
 * grants nothing on anyone's behalf.
 *
 * server-only.
 */
import "server-only";
import { timingSafeEqual } from "node:crypto";

export const SERVICE_TOKEN_ENV = "WAREHOUSE_SERVICE_TOKEN";

/** Minimum length, so a short or placeholder value cannot be configured. */
const MIN_LENGTH = 32;

export type ServiceAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; reason: "not_configured" | "missing" | "invalid" };

/**
 * Compare without leaking length or content through timing.
 *
 * Both sides are hashed to a fixed width first, because timingSafeEqual throws
 * on a length mismatch and that throw is itself an oracle.
 */
function sameSecret(presented: string, expected: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(presented);
  const b = enc.encode(expected);
  if (a.length !== b.length) {
    // Still do a comparison of equal length so the failure path costs the same.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Authenticate a service call.
 *
 * Fails closed in every direction: an unconfigured deployment refuses rather
 * than accepting anything, and a request carrying a session cookie instead of
 * the credential is refused too — a user, however privileged, is not Warehouse.
 */
export function authenticateService(req: Request): ServiceAuthResult {
  const expected = process.env[SERVICE_TOKEN_ENV];
  if (!expected || expected.trim().length < MIN_LENGTH) {
    // Unconfigured, or configured with something too short to be a secret.
    return { ok: false, status: 503, reason: "not_configured" };
  }

  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, reason: "missing" };
  }

  const presented = header.slice(7).trim();
  if (!presented) return { ok: false, status: 401, reason: "missing" };
  if (!sameSecret(presented, expected.trim())) {
    return { ok: false, status: 401, reason: "invalid" };
  }
  return { ok: true };
}

/** Whether the credential is configured. Diagnostics only — never a gate. */
export function hasServiceCredential(): boolean {
  const v = process.env[SERVICE_TOKEN_ENV];
  return Boolean(v && v.trim().length >= MIN_LENGTH);
}
