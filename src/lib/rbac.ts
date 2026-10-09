// RBAC server helpers. Used by API routes and server components to gate
// access. JWT-resident permission list keeps the hot path zero-DB; if the
// JWT predates RBAC (no `permissions` claim), we transparently fall back to
// a DB lookup keyed on the legacy `type` string.

import "server-only";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { NextResponse } from "next/server";
import type { Permission, RoleRecord } from "@/types/rbac";
import { PERMISSION_BY_KEY } from "@/types/rbac";
import type { User, UserType } from "@/types/user";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, getDb } from "./finance-db";
import { ensureRbacReady } from "./rbac-seed";
import { userIdFilter } from "./user-id";
import { jwtSecret } from "./jwt-secret";
import { packPermissions, unpackPermissions, MAX_PACKED_PERMISSION_BYTES } from "./session-permissions";

// Resolved lazily and never defaulted — see lib/jwt-secret.ts. A missing
// secret throws on first use rather than silently substituting a known string.

export interface RbacSession {
  userId?: string;
  name: string;
  type: UserType;
  roleId?: string;
  permissions: Permission[];
  active: boolean;
  /**
   * The version this token was issued against. Absent on tokens predating the
   * claim, which read as 0.
   *
   * Carried and recorded but NOT yet enforced — enforcement is the step that
   * signs people out. See docs/AUTH-INTEGRATION-GATE-PLAN.md step 4.
   */
  sessionVersion: number;
  /**
   * Declared external Warehouse Agent. Absent on tokens predating the claim,
   * which read as false — an old session is an employee, which is what it was
   * already being treated as.
   */
  isWarehouseAgent: boolean;
}

interface JwtClaims {
  _id?: string;
  name?: string;
  type?: UserType;
  role_id?: string;
  permissions?: Permission[];
  /** Compact form of `permissions` (lib/session-permissions). Tokens signed
   *  since the cookie-size fix carry this instead of the array. */
  perms?: string;
  active?: boolean;
  session_version?: number;
  warehouse_agent?: boolean;
}

/** Read + verify the session cookie, hydrate effective permissions. */
export async function readSession(): Promise<RbacSession | null> {
  try {
    const c = await cookies();
    const token = c.get("session")?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, jwtSecret());
    const claims = payload as JwtClaims;
    if (!claims.name) return null;
    const type = (claims.type ?? "simple") as UserType;

    // Permissions in JWT → done: the compact form, or the array older tokens
    // carry. Neither → compute from DB (legacy tokens, and tokens whose
    // permissions were too large to fit in a cookie).
    let permissions = typeof claims.perms === "string"
      ? (unpackPermissions(claims.perms) as Permission[])
      : Array.isArray(claims.permissions) ? claims.permissions : undefined;
    if (!permissions) {
      permissions = await computeEffectivePermissions({
        type,
        role_id: claims.role_id,
        _id: claims._id,
      });
    }

    return {
      userId: claims._id,
      name: claims.name,
      type,
      roleId: claims.role_id,
      permissions,
      active: claims.active ?? true,
      // Read, carried, and deliberately NOT yet compared against the stored
      // value. Enforcement is the step that signs people out and is approved
      // separately — see docs/AUTH-INTEGRATION-GATE-PLAN.md step 4.
      sessionVersion: typeof claims.session_version === "number" ? claims.session_version : 0,
      isWarehouseAgent: claims.warehouse_agent === true,
    };
  } catch {
    return null;
  }
}

/** True if the session has the given permission. */
export function hasPermission(
  session: RbacSession | null,
  perm: Permission
): boolean {
  if (!session || !session.active) return false;
  return session.permissions.includes(perm);
}

/** True if the session has any of the given permissions. */
export function hasAnyPermission(
  session: RbacSession | null,
  perms: Permission[]
): boolean {
  if (!session || !session.active) return false;
  return perms.some((p) => session.permissions.includes(p));
}

/** True if the session has all the given permissions. */
export function hasAllPermissions(
  session: RbacSession | null,
  perms: Permission[]
): boolean {
  if (!session || !session.active) return false;
  return perms.every((p) => session.permissions.includes(p));
}

/** Use inside API routes: returns either the session or a 401/403 NextResponse.
 *  Caller pattern: `const s = await requirePermission("..."); if (s instanceof NextResponse) return s;` */
export async function requirePermission(
  perm: Permission
): Promise<RbacSession | NextResponse> {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.active) {
    return NextResponse.json({ error: "Account disabled" }, { status: 403 });
  }
  if (!hasPermission(session, perm)) {
    return NextResponse.json(
      { error: "Forbidden", required_permission: perm },
      { status: 403 }
    );
  }
  return session;
}

/** Use inside server components when you want to short-circuit a render. */
export async function getSessionOrNull(): Promise<RbacSession | null> {
  return readSession();
}

/** Reverse of requirePermission for cases where Forbidden returns null. */
export async function getSessionIfAllowed(perm: Permission): Promise<RbacSession | null> {
  const session = await readSession();
  if (!session || !hasPermission(session, perm)) return null;
  return session;
}

// ── Effective permissions resolver ──────────────────────────────────────────

/** Computes the effective permission set for a user. Roles + extra − denied. */
export async function computeEffectivePermissions(u: {
  type: UserType;
  role_id?: string;
  _id?: string;
}): Promise<Permission[]> {
  await ensureRbacReady();
  const roles = coll<RoleRecord>(FINANCE_COLLECTIONS.role);

  let role: RoleRecord | null = null;
  if (u.role_id) role = await roles.findOne({ _id: u.role_id });
  if (!role) role = await roles.findOne({ key: u.type });

  // No role found: empty set. (Custom permissions still apply below if id exists.)
  const base = new Set<Permission>(role?.permissions ?? []);

  // Layer on user-specific extras / denials
  if (u._id) {
    const db = await getDb();
    const usersColl = db.collection<User>("users");
    const fullUser = await usersColl.findOne(userIdFilter<User>(u._id));
    for (const p of fullUser?.extra_permissions ?? []) base.add(p);
    for (const p of fullUser?.denied_permissions ?? []) base.delete(p);
  }

  // Drop any permissions that aren't in the catalog (defensive: schema drift).
  return [...base].filter((p) => PERMISSION_BY_KEY[p] !== undefined);
}

/** Sign a fresh JWT carrying the user's effective permissions. Used by the
 *  login route and any "refresh permissions" admin action. */
export async function signSessionToken(args: {
  _id?: string;
  name: string;
  type: UserType;
  role_id?: string;
  permissions: Permission[];
  active: boolean;
  /** Stamped so a later bump can invalidate this token. Defaults to 0. */
  session_version?: number;
  /** Declared external Warehouse Agent. Defaults to false. */
  warehouse_agent?: boolean;
  expiresIn?: string;
}): Promise<string> {
  // Packed, because the plain array outgrew the browser's 4096-byte cookie
  // limit and the cookie was silently dropped (login loop). Past the cap the
  // permissions are left out and readSession resolves them from the DB.
  const perms = packPermissions(args.permissions);
  return new SignJWT({
    _id: args._id,
    name: args.name,
    type: args.type,
    role_id: args.role_id,
    ...(perms.length <= MAX_PACKED_PERMISSION_BYTES ? { perms } : {}),
    active: args.active,
    session_version: args.session_version ?? 0,
    warehouse_agent: args.warehouse_agent === true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(args.expiresIn ?? "7d")
    .sign(jwtSecret());
}

// Make ensureFinanceIndexes import non-orphan (used implicitly via coll())
void ensureFinanceIndexes;
