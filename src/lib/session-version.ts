/**
 * Session invalidation.
 *
 * A signed token proves the authority issued it. It does not prove the session
 * behind it still exists, and today it cannot: permissions are baked into the
 * claim and the cookie lives for seven days, so disabling a user leaves them
 * working for up to a week.
 *
 * `session_version` closes that. The authority stores a number per user and
 * stamps it into every token it issues. Bumping it makes every token already
 * out there stale.
 *
 * This module writes the number, decides when, and — since step 4 — answers
 * whether a presented token is still live.
 *
 * Enforcement is strict by decision: a token must carry the exact current
 * version of a user who exists and is enabled. There is no branch where a
 * missing version is treated as acceptable. Such a branch is indistinguishable
 * from the real thing on every normal request; the only moment it matters is
 * an old token presented after a user has been disabled, which is precisely
 * the moment this exists for.
 */
import "server-only";
import { getDb } from "./finance-db";
import { userIdFilter } from "./user-id";
import type { User } from "@/types/user";
import type { RoleRecord } from "@/types/rbac";

/** Same collection the admin user routes write. */
const USERS = "users";

/** A user with no stored version is version 0. No migration writes a field. */
export const DEFAULT_SESSION_VERSION = 0;

export function sessionVersionOf(user: Pick<User, "session_version"> | null | undefined): number {
  const v = user?.session_version;
  return typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_SESSION_VERSION;
}

/**
 * Which user changes must end existing sessions.
 *
 * Decided from the fields actually being written, so a handler cannot forget
 * to ask: anything that changes what a session may *do*, or who it belongs to,
 * invalidates it. A display name does not.
 *
 * `active` is the one that matters most — it is the defect this closes.
 */
const INVALIDATING_FIELDS = new Set<keyof User>([
  "active",               // disabled — must stop working now, not in 7 days
  "password",             // changed — other sessions must end
  "role_id",              // different permissions
  "extra_permissions",    // different permissions
  "denied_permissions",   // different permissions
  "type",                 // legacy permission source
  "warehouse_agent",      // identity itself — changes what redaction applies
]);

export function shouldBumpSessionVersion(changed: Partial<User>): boolean {
  return Object.keys(changed).some((k) => INVALIDATING_FIELDS.has(k as keyof User));
}

/** Which of the changed fields triggered it. For the audit line. */
export function invalidatingFields(changed: Partial<User>): string[] {
  return Object.keys(changed).filter((k) => INVALIDATING_FIELDS.has(k as keyof User));
}

/**
 * Bump one user's session version.
 *
 * `$inc` with no read first, so two concurrent admin actions produce two
 * increments rather than one lost update. Returns the new value.
 */
export async function bumpSessionVersion(userId: string, reason: string): Promise<number> {
  const users = (await getDb()).collection<User>(USERS);
  const res = await users.findOneAndUpdate(
    userIdFilter<User>(userId),
    {
      $inc: { session_version: 1 },
      $set: { session_version_reason: reason, session_version_at: new Date().toISOString() },
    },
    { returnDocument: "after" },
  );
  return sessionVersionOf(res);
}

/**
 * Bump every user holding a role.
 *
 * Editing a role's permission list is the case most easily missed: without
 * this, removing a permission changes nothing for anyone already signed in,
 * because their token carries the old list. One `updateMany`.
 */
export async function bumpRoleHolders(roleId: string, reason: string): Promise<number> {
  const users = (await getDb()).collection<User>(USERS);
  const res = await users.updateMany(
    { role_id: roleId },
    {
      $inc: { session_version: 1 },
      $set: { session_version_reason: reason, session_version_at: new Date().toISOString() },
    },
  );
  return res.modifiedCount;
}

/** True when a role edit changes what its holders may do. */
export function roleEditInvalidates(before: RoleRecord, after: Partial<RoleRecord>): boolean {
  if (!after.permissions) return false;
  const a = [...before.permissions].sort().join("|");
  const b = [...after.permissions].sort().join("|");
  return a !== b;
}


/* ── Enforcement ───────────────────────────────────────────────────────── */

export type SessionVerdict =
  | { live: true; version: number }
  | { live: false; reason: "unknown_user" | "disabled" | "version_mismatch" };

/**
 * Is the session behind this token still live?
 *
 * Answers from the canonical user record, not from the token. That is the
 * whole point: a signature proves the token was issued, and nothing more. The
 * cost is an indexed read on the auth path, accepted deliberately — token
 * validity is supposed to depend on current user state.
 *
 * Fails closed on every path. An unreadable user is an invalid session, not a
 * valid one.
 */
export async function checkSessionLive(
  userId: string,
  presentedVersion: number,
): Promise<SessionVerdict> {
  const users = (await getDb()).collection<User>(USERS);
  const user = await users.findOne(userIdFilter<User>(userId), {
    // Only what the decision needs. Nothing else leaves the database.
    projection: { session_version: 1, active: 1 },
  });

  if (!user) return { live: false, reason: "unknown_user" };
  if (user.active === false) return { live: false, reason: "disabled" };

  const stored = sessionVersionOf(user);
  // Exact match. A higher presented version is as wrong as a lower one — it
  // cannot have been issued by this authority, so it is a forgery or a bug.
  if (presentedVersion !== stored) return { live: false, reason: "version_mismatch" };

  return { live: true, version: stored };
}
