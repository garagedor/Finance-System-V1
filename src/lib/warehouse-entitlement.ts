/**
 * One definition of "this identity may use Warehouse", shared by the server
 * that mints tokens and the client that decides whether to show the portal
 * card. Two definitions would eventually disagree, and the disagreement would
 * be a card that opens onto a 403.
 *
 * Entitlement is canonical permission membership and nothing else. Not an
 * account type, not a role name, not a `wh:` prefix. An admin with no warehouse
 * permission is not entitled; that is the point, not an oversight.
 *
 * Imports only the permission catalog, so this is safe in a client component.
 */
import { WAREHOUSE_PERMISSIONS, isWarehousePermission } from "@/types/rbac";

/** The canonical warehouse permissions in this list, in catalog order. */
export function canonicalWarehousePermissions(
  permissions: readonly string[] | null | undefined,
): string[] {
  if (!permissions) return [];
  const held = new Set(permissions);
  return WAREHOUSE_PERMISSIONS.filter((p) => held.has(p));
}

/**
 * True when at least one permission is a real member of the locked set.
 *
 * `active` is the caller's business: the server passes it, the gateway has
 * already been refused a session if the account is disabled.
 */
export function hasWarehouseEntitlement(
  permissions: readonly string[] | null | undefined,
): boolean {
  if (!permissions) return false;
  return permissions.some(isWarehousePermission);
}
