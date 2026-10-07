/**
 * The canonical Warehouse role templates, as approved for Phase 1.
 *
 * These are data, not behaviour: they describe the permission arrays that
 * `finance_role` records should carry. They live in code rather than in a
 * script so the matrix is reviewable and machine-checked — a test asserts
 * every rule the approval locked, so a later edit that quietly widens a role
 * fails the build instead of reaching production.
 *
 * Creating these roles grants nobody anything. A role is inert until a user's
 * `role_id` points at it.
 */
import type { Permission } from "@/types/rbac";

export interface WarehouseRoleTemplate {
  /** Display name, and the uniqueness key the create API enforces. */
  name: string;
  description: string;
  permissions: Permission[];
}

export const WAREHOUSE_ROLE_TEMPLATES: readonly WarehouseRoleTemplate[] = [
  {
    name: "Warehouse Admin",
    description:
      "Full Warehouse authority. wh:admin implies every other Warehouse permission, " +
      "so none are listed — a stored copy would drift from the catalog. Grants nothing " +
      "in CRM or Finance. The only role that carries it; keep the holder count small.",
    permissions: ["wh:admin"],
  },
  {
    name: "Warehouse Procurement",
    description:
      "Runs a purchase order from draft to closed and manages the shipment that carries " +
      "it. Cannot post receiving, so cannot mark an order received.",
    permissions: [
      "wh:catalog:view",
      "wh:topology:view",
      "wh:po:view",
      "wh:po:create",
      "wh:po:edit",
      "wh:po:submit",
      "wh:po:confirm",
      "wh:po:cancel",
      "wh:po:close",
      "wh:shipment:view",
      "wh:shipment:edit",
    ],
  },
  {
    name: "Warehouse Receiving",
    description:
      "Counts and posts what arrives. Posting advances the order to RECEIVED through the " +
      "transition authority, which is why this role needs no purchase-order write " +
      "permission. Shipment lifecycle stays with Procurement.",
    permissions: [
      "wh:po:view",
      "wh:shipment:view",
      "wh:receiving:view",
      "wh:receiving:count",
      "wh:receiving:post",
    ],
  },
  {
    name: "Warehouse Inventory",
    description:
      "Puts received stock away and owns corrections — quantity adjustments and condition " +
      "changes. No purchase-order or shipment authority.",
    permissions: [
      "wh:catalog:view",
      "wh:inventory:view",
      "wh:inventory:adjust",
      "wh:putaway:move",
    ],
  },
  {
    name: "Warehouse Read Only",
    description:
      "Reads every operational screen and writes nothing. Cannot see the putaway queue: " +
      "that page is gated on a write permission and there is no read-only equivalent " +
      "(debt G1). Exposing it would mean granting the ability to move stock.",
    permissions: [
      "wh:catalog:view",
      "wh:topology:view",
      "wh:po:view",
      "wh:shipment:view",
      "wh:receiving:view",
      "wh:inventory:view",
    ],
  },
  {
    name: "Warehouse Agent",
    description:
      "Supplier-side. Inspects and counts inbound work; the irreversible ledger posting " +
      "stays with an employee. MUST hold no crm:, finance: or system: permission — " +
      "account type is derived from what the identity holds, and financial redaction " +
      "depends on it staying warehouse_agent.",
    permissions: [
      "wh:po:view",
      "wh:shipment:view",
      "wh:receiving:view",
      "wh:receiving:count",
    ],
  },
] as const;

/** The role that is safe to give the first real user: reads everything, writes nothing. */
export const FIRST_ONBOARDING_ROLE = "Warehouse Read Only";

/** Permissions that would destroy an agent's identity, and its redaction with it. */
export const NON_WAREHOUSE_PREFIXES = ["crm:", "finance:", "system:"] as const;
