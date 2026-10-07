/**
 * Turning a CRM session into the claim set Warehouse expects.
 *
 * Pure, so the decisions can be tested without a key, a request or a database.
 * The shape is Warehouse's, not ours: see lbs-warehouse/docs/AUTH.md.
 */
import { isWarehousePermission } from "@/types/rbac";
import { hasWarehouseEntitlement as entitledByPermissions } from "./warehouse-entitlement";

export type WarehouseAccountType = "employee" | "warehouse_agent";
export type WarehouseModule = "crm" | "finance" | "warehouse";

export interface WarehouseClaimSet {
  sub: string;
  session_version: number;
  account_type: WarehouseAccountType;
  modules: WarehouseModule[];
  warehouse_permissions: string[];
  name?: string;
}

export interface SessionLike {
  userId?: string;
  name: string;
  permissions: readonly string[];
  active: boolean;
  sessionVersion: number;
  /** Declared external Warehouse Agent. Absent reads as false — employee. */
  isWarehouseAgent?: boolean;
}

/** The warehouse permissions this session actually holds. */
export function warehousePermissionsOf(session: SessionLike): string[] {
  return session.permissions.filter(isWarehousePermission);
}

/**
 * Whether the session may use Warehouse at all.
 *
 * Delegates the permission half to the shared helper so token issuance and the
 * gateway card cannot drift apart. The `active` half is this layer's: a
 * disabled account is not entitled to anything.
 */
export function hasWarehouseEntitlement(session: SessionLike): boolean {
  return session.active && entitledByPermissions(session.permissions);
}

/**
 * Which products this identity reaches.
 *
 * Agent status is DECLARED on the user record, never inferred from what the
 * account happens to hold. Inference was wrong in both directions: an internal
 * clerk holding only warehouse permissions was classified as a supplier agent
 * and shown redacted purchase orders, while an agent that picked up a single
 * `system:` permission was silently demoted to employee — which is precisely
 * what switches redaction off. Neither failure is visible in the token.
 *
 * A declared agent that holds anything outside the canonical warehouse set is
 * not reclassified here. It is refused at issuance; see lib/warehouse-mint.ts.
 */
export function accountTypeOf(session: SessionLike): WarehouseAccountType {
  return session.isWarehouseAgent === true ? "warehouse_agent" : "employee";
}

/**
 * Effective permissions a declared agent may not hold.
 *
 * Canonical membership, so this catches `crm:`, `finance:`, `system:` and any
 * non-catalog string alike — including one that merely starts with `wh:`.
 */
export function nonWarehousePermissionsOf(session: SessionLike): string[] {
  return session.permissions.filter((p) => !isWarehousePermission(p));
}

export function modulesOf(session: SessionLike): WarehouseModule[] {
  if (accountTypeOf(session) === "warehouse_agent") return ["warehouse"];
  const out: WarehouseModule[] = [];
  if (session.permissions.some((p) => p.startsWith("crm:"))) out.push("crm");
  if (session.permissions.some((p) => p.startsWith("finance:"))) out.push("finance");
  out.push("warehouse");
  return out;
}

/**
 * Build the claim set.
 *
 * `warehouse_ids` is deliberately absent. Warehouse reads an absent list as
 * "every warehouse", and the CRM has no model for scoping a user to a
 * building — inventing one here would be writing policy into a token. When
 * that model exists, this is where it attaches.
 */
export function buildWarehouseClaims(session: SessionLike): WarehouseClaimSet {
  return {
    sub: session.userId ?? "",
    session_version: session.sessionVersion,
    account_type: accountTypeOf(session),
    modules: modulesOf(session),
    warehouse_permissions: warehousePermissionsOf(session),
    ...(session.name ? { name: session.name } : {}),
  };
}
