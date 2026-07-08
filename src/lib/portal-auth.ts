// Helper for finance portal API routes — reads the session cookie, verifies
// the JWT, and returns the user's name + type. Backed by the RBAC layer:
// instead of a hardcoded allow-list, access is gated by the user's effective
// permissions. A session is considered "portal-eligible" if it grants at
// least one `finance:*` permission. Per-route gating should use
// `requirePermission(...)` from `@/lib/rbac` directly for fine-grained checks.

import type { Permission } from "@/types/rbac";
import { hasPermission, readSession, type RbacSession } from "./rbac";

export type PortalSession = RbacSession;

/** Returns the verified session if the user has any finance access, else null. */
export async function readPortalSession(): Promise<PortalSession | null> {
  const session = await readSession();
  if (!session) return null;
  if (!session.active) return null;
  // Portal-eligible == has at least one finance permission OR has any system
  // role (so admins can manage even before granting themselves finance perms).
  const portalEligible =
    session.permissions.some((p) => p.startsWith("finance:")) ||
    session.permissions.some((p) => p.startsWith("system:"));
  if (!portalEligible) return null;
  return session;
}

/** Convenience re-export for legacy imports. */
export function sessionHas(session: PortalSession | null, perm: Permission): boolean {
  return hasPermission(session, perm);
}
