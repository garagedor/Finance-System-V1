/**
 * Authorization for the weekly verify-reports API.
 *
 * Every route under `/api/verify/*` reaches Supabase and most of them mutate
 * it. Middleware authenticates `/api/*` — it proves the caller holds a valid
 * session — but it says nothing about what that session may *do*. These two
 * helpers are the missing half.
 *
 * One helper per direction rather than nine bespoke checks, so a new route
 * cannot quietly invent a different rule, and so the permission a route
 * demands is visible in one line at the top of its handler.
 *
 * Admin access arrives through the seeded Admin role, which holds
 * ALL_PERMISSIONS. There is deliberately no `type === "admin"` branch here:
 * once RBAC can express the action, a hardcoded job title is a second,
 * divergent authority.
 */
import { NextResponse } from "next/server";
import { hasPermission, readSession } from "./rbac";

/** Seeing weekly reports, mappings and week state. */
export const VERIFY_READ = "crm:verify_reports:view" as const;

/** Changing any of them — status, notes, job edits, links, mappings, schedule. */
export const VERIFY_WRITE = "crm:verify_reports:edit" as const;

async function require(
  permission: typeof VERIFY_READ | typeof VERIFY_WRITE,
): Promise<NextResponse | null> {
  const session = await readSession();
  // 401 and 403 are different answers: one says "we do not know who you are",
  // the other says "we do, and no". Collapsing them would tell a signed-in
  // user to sign in again, which is not the problem.
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, permission)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Gate a read. Returns a response to send, or null to continue.
 *
 * Call it as the first statement in the handler, before any parameter is read
 * and before any client is constructed.
 */
export function requireVerifyRead(): Promise<NextResponse | null> {
  return require(VERIFY_READ);
}

/** Gate a write. Same contract. */
export function requireVerifyWrite(): Promise<NextResponse | null> {
  return require(VERIFY_WRITE);
}
