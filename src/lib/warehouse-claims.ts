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
 * An identity holding *only* warehouse permissions is an agent: a
 * supplier-side account with no business inside CRM or Finance. That is read
 * from what they actually hold rather than declared separately, so the two can
 * never disagree — and it means an agent token cannot carry `crm` or `finance`
 * by construction, which is exactly what Warehouse's verifier refuses.
 */
export function accountTypeOf(session: SessionLike): WarehouseAccountType {
  const hasOther = session.permissions.some(
    (p) => p.startsWith("crm:") || p.startsWith("finance:") || p.startsWith("system:"),
  );
  return hasOther ? "employee" : "warehouse_agent";
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
