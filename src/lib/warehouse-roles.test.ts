// Run with:  node --test --import ./scripts/test-register.mjs src/lib/warehouse-roles.test.ts
//
// The approved Phase 1 role matrix, pinned. A later edit that quietly widens a
// role fails here rather than reaching production.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIRST_ONBOARDING_ROLE,
  NON_WAREHOUSE_PREFIXES,
  WAREHOUSE_ROLE_TEMPLATES,
} from "./warehouse-roles.ts";
import { PERMISSION_BY_KEY, WAREHOUSE_PERMISSIONS, isWarehousePermission } from "../types/rbac.ts";
import { accountTypeOf, buildWarehouseClaims, modulesOf, nonWarehousePermissionsOf, type SessionLike } from "./warehouse-claims.ts";

const byName = (n: string) => {
  const r = WAREHOUSE_ROLE_TEMPLATES.find((t) => t.name === n);
  assert.ok(r, `missing role template: ${n}`);
  return r;
};
/** Every permission that permits a write, read out of the gate map. */
const WRITE = new Set<string>([
  "wh:catalog:edit", "wh:topology:edit", "wh:po:create", "wh:po:edit",
  "wh:po:submit", "wh:po:confirm", "wh:po:cancel", "wh:po:close",
  "wh:shipment:edit", "wh:receiving:count", "wh:receiving:post",
  "wh:inventory:adjust", "wh:putaway:move", "wh:admin",
]);

test("there are exactly the six approved roles", () => {
  assert.deepEqual(WAREHOUSE_ROLE_TEMPLATES.map((r) => r.name), [
    "Warehouse Admin", "Warehouse Procurement", "Warehouse Receiving",
    "Warehouse Inventory", "Warehouse Read Only", "Warehouse Agent",
  ]);
});

test("every permission is canonical and real — no invented keys", () => {
  for (const r of WAREHOUSE_ROLE_TEMPLATES) {
    for (const p of r.permissions) {
      assert.ok(isWarehousePermission(p), `${r.name}: ${p} is not a canonical warehouse permission`);
      assert.ok(PERMISSION_BY_KEY[p], `${r.name}: ${p} is not in the catalog`);
    }
    assert.equal(new Set(r.permissions).size, r.permissions.length, `${r.name} has duplicates`);
    assert.ok(r.permissions.length > 0, `${r.name} is empty — it would confer no entitlement`);
  }
});

test("the locked set is untouched at 20", () => {
  assert.equal(WAREHOUSE_PERMISSIONS.length, 20);
});

/* ── The rules the approval locked ───────────────────────────────────── */

test("wh:admin belongs to Warehouse Admin and to nobody else", () => {
  for (const r of WAREHOUSE_ROLE_TEMPLATES) {
    assert.equal(r.permissions.includes("wh:admin"), r.name === "Warehouse Admin",
      `${r.name} must ${r.name === "Warehouse Admin" ? "" : "not "}hold wh:admin`);
  }
});

test("Warehouse Admin stores only wh:admin — implied permissions are not copied", () => {
  assert.deepEqual(byName("Warehouse Admin").permissions, ["wh:admin"]);
});

test("Read Only holds not one write permission", () => {
  for (const p of byName("Warehouse Read Only").permissions) {
    assert.equal(WRITE.has(p), false, `Read Only must not hold ${p}`);
  }
});

test("Receiving cannot adjust inventory, and cannot manage shipment lifecycle", () => {
  const p = byName("Warehouse Receiving").permissions;
  assert.equal(p.includes("wh:inventory:adjust"), false);
  assert.equal(p.includes("wh:shipment:edit"), false, "shipment lifecycle stays with Procurement");
  assert.equal(p.includes("wh:putaway:move"), false);
});

test("Receiving advances the PO without any purchase-order write permission", () => {
  // RECEIVED maps to wh:receiving:post in the transition authority, which is
  // why this role needs nothing from procurement.
  const p = byName("Warehouse Receiving").permissions;
  assert.ok(p.includes("wh:receiving:post"));
  for (const w of ["wh:po:create", "wh:po:edit", "wh:po:submit", "wh:po:confirm", "wh:po:cancel", "wh:po:close"]) {
    assert.equal(p.includes(w as never), false, `Receiving must not hold ${w}`);
  }
});

test("Inventory cannot create, confirm or cancel purchase orders", () => {
  const p = byName("Warehouse Inventory").permissions;
  for (const w of ["wh:po:create", "wh:po:confirm", "wh:po:cancel", "wh:po:view"]) {
    assert.equal(p.includes(w as never), false, `Inventory must not hold ${w}`);
  }
});

test("Procurement cannot post receiving", () => {
  const p = byName("Warehouse Procurement").permissions;
  assert.equal(p.includes("wh:receiving:post"), false);
  assert.equal(p.includes("wh:receiving:count"), false);
});

test("Read Only is excluded from putaway, deliberately — debt G1", () => {
  assert.equal(byName("Warehouse Read Only").permissions.includes("wh:putaway:move"), false);
});

/* ── The agent security invariant ────────────────────────────────────── */

test("the Agent template holds nothing outside Warehouse", () => {
  for (const p of byName("Warehouse Agent").permissions) {
    for (const prefix of NON_WAREHOUSE_PREFIXES) {
      assert.equal(p.startsWith(prefix), false, `Agent must never hold ${p}`);
    }
  }
  assert.equal(byName("Warehouse Agent").permissions.includes("wh:receiving:post"), false,
    "the irreversible ledger write stays with an employee");
});

test("the Agent template, DECLARED, produces a warehouse_agent identity", () => {
  const s: SessionLike = {
    userId: "a1", name: "Agent", active: true, sessionVersion: 0,
    isWarehouseAgent: true,
    permissions: [...byName("Warehouse Agent").permissions],
  };
  assert.equal(accountTypeOf(s), "warehouse_agent");
  assert.deepEqual(modulesOf(s), ["warehouse"]);
  assert.deepEqual(buildWarehouseClaims(s).modules, ["warehouse"]);
});

test("the same permissions UNDECLARED are an employee — warehouse-only staff", () => {
  const s: SessionLike = {
    userId: "e1", name: "Receiving clerk", active: true, sessionVersion: 0,
    permissions: [...byName("Warehouse Receiving").permissions],
  };
  assert.equal(accountTypeOf(s), "employee");
});

test("ONE non-warehouse permission destroys the agent identity — crm, finance or system", () => {
  // This is why an agent account must hold warehouse permissions and nothing
  // else: redaction keys off account type, so this silently un-redacts unit
  // costs rather than failing loudly.
  // Historical: this is what the derived model did, and why it was replaced.
  // A declared agent is no longer reclassified — issuance refuses instead.
  for (const contaminant of ["crm:jobs:view", "finance:payouts:view", "system:users:edit"]) {
    const undeclared: SessionLike = {
      userId: "a1", name: "Agent", active: true, sessionVersion: 0,
      permissions: [...byName("Warehouse Agent").permissions, contaminant],
    };
    assert.equal(accountTypeOf(undeclared), "employee");

    const declared: SessionLike = { ...undeclared, isWarehouseAgent: true };
    assert.equal(accountTypeOf(declared), "warehouse_agent",
      `${contaminant} must NOT silently demote a declared agent`);
    assert.deepEqual(nonWarehousePermissionsOf(declared), [contaminant]);
  }
});

test("a system: permission flips the identity but widens NOTHING visible — debt G7", () => {
  // Found by this suite. accountTypeOf counts `system:` as non-warehouse, but
  // modulesOf emits only crm / finance / warehouse. So wh:* plus one system:
  // permission mints account_type "employee" with modules ["warehouse"] — a
  // combination Warehouse accepts without complaint, whose single effect is
  // that redaction stops. crm: and finance: at least widen the modules claim;
  // system: changes nothing a verifier can see.
  const base = [...byName("Warehouse Agent").permissions];
  const mk = (extra: string): SessionLike => ({
    userId: "a1", name: "Agent", active: true, sessionVersion: 0,
    permissions: [...base, extra],
  });
  assert.deepEqual(modulesOf(mk("crm:jobs:view")).sort(), ["crm", "warehouse"]);
  assert.deepEqual(modulesOf(mk("finance:payouts:view")).sort(), ["finance", "warehouse"]);

  const sys = mk("system:users:edit");
  assert.equal(accountTypeOf(sys), "employee", "the identity does flip");
  assert.deepEqual(modulesOf(sys), ["warehouse"], "but the modules claim is indistinguishable");
  // Which is why the role templates forbid it outright rather than relying on
  // a downstream check noticing.
});

test("the first onboarding role is the one that cannot write", () => {
  assert.equal(FIRST_ONBOARDING_ROLE, "Warehouse Read Only");
  for (const p of byName(FIRST_ONBOARDING_ROLE).permissions) {
    assert.equal(WRITE.has(p), false);
  }
});
