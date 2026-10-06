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
 * This module writes the number and decides when. **Nothing enforces it yet** —
 * see docs/AUTH-INTEGRATION-GATE-PLAN.md step 4, which is the step that signs
 * people out and needs its own approval. Until then this is inert: the claim is
 * written and read, and no request is refused because of it.
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
