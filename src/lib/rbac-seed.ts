// Seeds the seven system roles on first access. Idempotent — safe to call
// multiple times; only inserts roles whose `key` doesn't yet exist. After
// initial install you can edit a system role's permission list freely; the
// seeder won't overwrite your changes.
//
// Also migrates existing users: anyone with `type` but no `role_id` gets
// linked to the corresponding system role. Runs once per process.

import {
  ALL_PERMISSIONS,
  type Permission,
  type RoleRecord,
  SYSTEM_ROLE_KEYS,
  type SystemRoleKey,
} from "@/types/rbac";
import type { User } from "@/types/user";
import { coll, ensureFinanceIndexes, newId, FINANCE_COLLECTIONS } from "./finance-db";
import type { Db } from "mongodb";
import { getDb } from "./finance-db";

let _seeded = false;

interface SeedTemplate {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: Permission[];
}

/** Curated default permissions for each system role. Admin gets everything. */
function seedTemplates(): SeedTemplate[] {
  return [
    {
      key: SYSTEM_ROLE_KEYS.admin,
      name: "Admin",
      description: "Full access to every module, every action. Cannot be locked out.",
      permissions: [...ALL_PERMISSIONS],
    },
    {
      key: SYSTEM_ROLE_KEYS.office,
      name: "Office",
      description: "CRM operations + read-only finance.",
      permissions: [
        // CRM full
        "crm:home:view",
        "crm:jobs:view", "crm:jobs:create", "crm:jobs:edit", "crm:jobs:dispute",
        "crm:customers:view", "crm:customers:edit",
        "crm:locations:view",
        "crm:technicians:view",
        "crm:stats:view",
        "crm:balance_report:view", "crm:balance_report:export",
        "crm:payment_method_report:view",
        // Finance read-only
        "finance:dashboard:view",
        "finance:income:view",
        "finance:expenses:view",
        "finance:payouts:view",
        "finance:reports:view",
        "finance:providers:view",
        "finance:area_managers:view",
        "finance:technicians:view",
        "finance:employees:view",
        "finance:debts:view",
        "finance:disputes:view",
        "finance:equipment:view",
        "finance:documents:view",
        "finance:banking:view",
        "finance:settings:view",
      ],
    },
    {
      key: SYSTEM_ROLE_KEYS.bookkeeper,
      name: "Bookkeeper",
      description: "Full finance access. No CRM management, no system admin.",
      permissions: [
        "crm:balance_report:view", "crm:balance_report:export",
        "crm:payment_method_report:view",
        // Finance full
        "finance:dashboard:view",
        "finance:income:view", "finance:income:create", "finance:income:edit", "finance:income:delete",
        "finance:expenses:view", "finance:expenses:create", "finance:expenses:edit", "finance:expenses:delete",
        "finance:recurring_expenses:view", "finance:recurring_expenses:create", "finance:recurring_expenses:edit", "finance:recurring_expenses:delete", "finance:recurring_expenses:run",
        "finance:payouts:view", "finance:payouts:create", "finance:payouts:edit", "finance:payouts:delete",
        "finance:reports:view", "finance:reports:create", "finance:reports:edit", "finance:reports:delete",
        "finance:providers:view", "finance:providers:edit",
        "finance:area_managers:view", "finance:area_managers:edit",
        "finance:technicians:view", "finance:technicians:edit",
        "finance:employees:view", "finance:employees:edit",
        "finance:debts:view", "finance:debts:edit",
        "finance:disputes:view", "finance:disputes:edit",
        "finance:equipment:view", "finance:equipment:edit",
        "finance:documents:view", "finance:documents:create", "finance:documents:edit", "finance:documents:delete",
        "finance:banking:view", "finance:banking:connect", "finance:banking:disconnect", "finance:banking:sync", "finance:banking:reconcile",
        "finance:settings:view",
      ],
    },
    {
      key: SYSTEM_ROLE_KEYS.locationManager,
      name: "Location Manager",
      description: "Manages a location/area: CRM + finance view, limited edits.",
      permissions: [
        // CRM
        "crm:home:view",
        "crm:jobs:view", "crm:jobs:create", "crm:jobs:edit", "crm:jobs:approve", "crm:jobs:dispute",
        "crm:customers:view", "crm:customers:edit",
        "crm:locations:view", "crm:locations:edit",
        "crm:technicians:view",
        "crm:stats:view",
        "crm:balance_report:view", "crm:balance_report:export",
        "crm:payment_method_report:view",
        "crm:verify_reports:view",
        // Finance — view-heavy, edit reports & disputes only
        "finance:dashboard:view",
        "finance:income:view",
        "finance:expenses:view",
        "finance:payouts:view",
        "finance:reports:view", "finance:reports:create",
        "finance:area_managers:view",
        "finance:technicians:view",
        "finance:debts:view",
        "finance:disputes:view", "finance:disputes:edit",
        "finance:documents:view",
        "finance:banking:view",
      ],
    },
    {
      key: SYSTEM_ROLE_KEYS.simple,
      name: "Simple",
      description: "Basic user. Self-view and limited CRM access only.",
      permissions: [
        "crm:tech_self:view",
        "crm:jobs:view",
      ],
    },
  ];
}

/** Ensure the system role rows exist. Idempotent. */
export async function seedSystemRoles(db: Db): Promise<void> {
  const rolesColl = db.collection<RoleRecord>(FINANCE_COLLECTIONS.role);
  const now = new Date().toISOString();
  for (const tpl of seedTemplates()) {
    const existing = await rolesColl.findOne({ key: tpl.key });
    if (existing) continue; // do not overwrite user customisations
    await rolesColl.insertOne({
      _id: newId("role"),
      key: tpl.key,
      name: tpl.name,
      description: tpl.description,
      permissions: tpl.permissions,
      is_system: true,
      created_at: now,
      updated_at: now,
      created_by: "system-seed",
    });
  }
}

/** Backfill `role_id` on existing users by matching their legacy `type`. */
export async function migrateUsersToRoles(db: Db): Promise<{ migrated: number; missing: number }> {
  const rolesColl = db.collection<RoleRecord>(FINANCE_COLLECTIONS.role);
  const usersColl = db.collection<User>("users");
  const roles = await rolesColl.find({ is_system: true }).toArray();
  const byKey = new Map(roles.map((r) => [r.key, r._id]));

  const unmigrated = await usersColl.find({ role_id: { $exists: false } }).toArray();
  let migrated = 0;
  let missing = 0;
  for (const u of unmigrated) {
    const roleId = byKey.get(u.type);
    if (!roleId) {
      missing++;
      continue;
    }
    await usersColl.updateOne(
      { _id: u._id },
      {
        $set: {
          role_id: roleId,
          active: u.active ?? true,
          updated_at: new Date().toISOString(),
        },
      }
    );
    migrated++;
  }
  return { migrated, missing };
}

/** One-shot init: ensures indexes, seeds roles, migrates users. Safe to call
 *  many times — internal flag short-circuits subsequent calls in the same
 *  Node process. */
export async function ensureRbacReady(): Promise<void> {
  if (_seeded) return;
  await ensureFinanceIndexes();
  const db = await getDb();
  await seedSystemRoles(db);
  await migrateUsersToRoles(db);
  _seeded = true;
}

/** For unit tests / scripts that want to reset the per-process latch. */
export function _resetSeedLatchForTests(): void {
  _seeded = false;
}

// Make `coll` import non-orphan
void coll;
