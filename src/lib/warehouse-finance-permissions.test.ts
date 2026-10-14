// Run with:  node --test --import ./scripts/test-register.mjs src/lib/warehouse-finance-permissions.test.ts
//
// Warehouse Finance, as a permission.
//
// ── What this commit actually changed ──────────────────────────────────
//
// Two strings entered PERMISSION_CATALOG. That is the whole diff. Everything
// else — WAREHOUSE_PERMISSIONS, ALL_PERMISSIONS, PERMISSION_BY_KEY,
// isWarehousePermission, the entitlement helper, the claim builder, the role
// matrix — is derived from the catalog, which is why there was no second list
// to edit and why there must be no second list to forget.
//
// Before it, `wh:finance:view` was a string the Warehouse enforced and the
// CRM had never heard of. The CRM mints tokens by canonical membership, so a
// permission outside the catalog could not be granted, could not be carried,
// and could not be verified: Warehouse Finance was unreachable in production
// no matter what anybody ticked.
//
// ── What it deliberately did not change ────────────────────────────────
//
// Nobody gains anything. Catalogued is grantable, not granted. The tests
// below pin that: no seeded role, no warehouse role template and no backfill
// names either permission, and the supplier boundary holds in both
// directions — the CRM will not put these in an agent's role, and Warehouse
// refuses them to a non-employee even when a token carries them anyway.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_PERMISSIONS,
  PERMISSION_BY_KEY,
  PERMISSION_CATALOG,
  WAREHOUSE_PERMISSIONS,
  isWarehousePermission,
} from "../types/rbac.ts";
import {
  accountTypeOf,
  buildWarehouseClaims,
  hasWarehouseEntitlement,
  nonWarehousePermissionsOf,
  warehousePermissionsOf,
  type SessionLike,
} from "./warehouse-claims.ts";
import { WAREHOUSE_ROLE_TEMPLATES } from "./warehouse-roles.ts";

const VIEW = "wh:finance:view";
const EDIT = "wh:finance:edit";

function session(over: Partial<SessionLike> = {}): SessionLike {
  return {
    userId: "u1",
    name: "Tester",
    permissions: ["wh:po:view"],
    active: true,
    sessionVersion: 7,
    ...over,
  };
}

const WH_DIR = join(import.meta.dirname, "..", "..", "..", "lbs-warehouse", "src");
const readWarehouse = (rel: string) => readFileSync(join(WH_DIR, rel), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ── A. an employee granted view ──────────────────────────────────────── */

test("A. an employee granted wh:finance:view carries it into the token", () => {
  const s = session({ permissions: ["wh:po:view", VIEW] });

  assert.equal(isWarehousePermission(VIEW), true, "it must be canonical to be minted at all");
  assert.equal(hasWarehouseEntitlement(s), true);
  assert.deepEqual(warehousePermissionsOf(s), ["wh:po:view", VIEW]);

  const claims = buildWarehouseClaims(s);
  assert.equal(claims.account_type, "employee");
  assert.ok(claims.warehouse_permissions.includes(VIEW));
  assert.deepEqual(claims.modules, ["warehouse"]);
});

test("A2. the view permission alone is entitlement to the warehouse module", () => {
  // The gateway card and token issuance share one definition of entitlement;
  // a finance-only identity must reach Warehouse at all, or the permission
  // would be unreachable for a different reason than before.
  assert.equal(hasWarehouseEntitlement(session({ permissions: [VIEW] })), true);
});

/* ── B. an employee granted edit ──────────────────────────────────────── */

test("B. an employee granted wh:finance:edit carries exactly that", () => {
  const claims = buildWarehouseClaims(session({ permissions: [EDIT] }));
  assert.deepEqual(claims.warehouse_permissions, [EDIT]);
  assert.equal(claims.account_type, "employee");
});

test("B2. edit does not imply view — this system has no implication but wh:admin", () => {
  // Asserted because the matrix is a grid of independent checkboxes: an
  // administrator who ticks Edit and not View has granted Edit and not View,
  // and Warehouse's own requireFinance asks for whichever one the operation
  // needs. Inventing an implication here would make the CRM and the verifier
  // disagree about what a stored role means.
  const claims = buildWarehouseClaims(session({ permissions: [EDIT] }));
  assert.equal(claims.warehouse_permissions.includes(VIEW), false);

  const rbac = strip(readFileSync(new URL("./rbac.ts", import.meta.url).pathname, "utf8"));
  assert.equal(/implies|implication|cascade/i.test(rbac), false,
    "effective-permission computation must stay a plain set operation");
});

/* ── C. an employee without either ────────────────────────────────────── */

test("C. an employee without the finance permissions carries neither", () => {
  const claims = buildWarehouseClaims(session({ permissions: ["wh:po:view", "wh:receiving:count"] }));
  assert.equal(claims.warehouse_permissions.includes(VIEW), false);
  assert.equal(claims.warehouse_permissions.includes(EDIT), false);
});

test("C2. Warehouse refuses finance to an employee who does not hold it", () => {
  const repo = strip(readWarehouse("lib/domain/finance/repo.ts"));
  assert.ok(repo.includes('const needed = write ? "wh:finance:edit" : "wh:finance:view"'),
    "requireFinance must still choose the permission by operation");
  assert.ok(repo.includes("hasPermission(session, needed)"),
    "…and must still check it");
});

/* ── D. literal wh:admin ──────────────────────────────────────────────── */

test("D. wh:admin is stored alone and implies finance inside Warehouse only", () => {
  // The CRM stores the one string. Expanding it into a list here would be a
  // second admin semantic, and a stored copy would drift from the catalog the
  // moment the catalog grew — which is exactly what just happened to it.
  const admin = WAREHOUSE_ROLE_TEMPLATES.find((r) => r.name === "Warehouse Admin")!;
  assert.deepEqual(admin.permissions, ["wh:admin"]);

  const claims = buildWarehouseClaims(session({ permissions: ["wh:admin"] }));
  assert.deepEqual(claims.warehouse_permissions, ["wh:admin"]);
  assert.equal(claims.warehouse_permissions.includes(VIEW), false,
    "the token carries the grant, not its expansion");

  // The expansion is Warehouse's, in one place, for every permission alike —
  // so the two new ones participate without a special case being written.
  const claimsSrc = strip(readWarehouse("lib/auth/claims.ts"));
  assert.ok(
    claimsSrc.includes('return s.permissions.includes(p) || s.permissions.includes("wh:admin")'),
    "wh:admin must still imply every warehouse permission through the single check");
  assert.ok(claimsSrc.includes(`"${VIEW}"`) && claimsSrc.includes(`"${EDIT}"`),
    "…and both finance permissions must be in the set it implies over");
});

test("D2. wh:admin belongs to the admin template and to nothing else", () => {
  for (const r of WAREHOUSE_ROLE_TEMPLATES) {
    assert.equal(r.permissions.includes("wh:admin"), r.name === "Warehouse Admin");
  }
});

/* ── E. the supplier / agent boundary ─────────────────────────────────── */

test("E. no agent-facing role template names a finance permission", () => {
  const agent = WAREHOUSE_ROLE_TEMPLATES.find((r) => r.name === "Warehouse Agent")!;
  assert.equal(agent.permissions.includes(VIEW), false);
  assert.equal(agent.permissions.includes(EDIT), false);
  assert.deepEqual(agent.permissions, [
    "wh:po:view", "wh:shipment:view", "wh:receiving:view", "wh:receiving:count",
  ], "the agent template is unchanged by this commit");
});

test("E2. Warehouse refuses finance to an agent before it looks at the permission", () => {
  // The defence that matters, because the CRM cannot be the only one holding
  // this line: a misconfigured role could put a canonical wh: permission on a
  // declared agent and the mint would not reject it — canonical is exactly
  // what the agent check tests for. So Warehouse refuses on account type
  // first, independently of what the token carries.
  const repo = strip(readWarehouse("lib/domain/finance/repo.ts"));
  const fn = repo.slice(repo.indexOf("export function requireFinance"));
  const accountCheck = fn.indexOf('session.accountType !== "employee"');
  const permCheck = fn.indexOf("hasPermission(session, needed)");
  assert.ok(accountCheck > -1, "requireFinance must refuse a non-employee");
  assert.ok(permCheck > -1, "requireFinance must also check the permission");
  assert.ok(accountCheck < permCheck,
    "the account-type refusal must come first, so a mis-issued permission is never reached");
});

test("E3. no finance navigation is serialised for an agent", () => {
  const nav = readWarehouse("components/shell/nav.ts");
  const finance = nav.slice(nav.indexOf('labelKey: "nav.finance"'), nav.indexOf('labelKey: "nav.history"'));
  assert.ok(finance.includes(VIEW), "the finance group must still be permission-gated");
  assert.equal(/agent:\s*true/.test(finance), false,
    "no finance item may carry the agent flag");
  assert.ok(strip(nav).includes("if (agent && !i.agent) return false;"),
    "the agent filter that makes that flag meaningful must still be there");
});

test("E4. a declared agent holding a non-warehouse permission is still refused a token", () => {
  // Unchanged behaviour, pinned here because the catalog grew underneath it:
  // the check is canonical membership, so it is the catalog that decides what
  // contaminates an agent.
  const dirty = session({ isWarehouseAgent: true, permissions: ["wh:po:view", "finance:payouts:view"] });
  assert.deepEqual(nonWarehousePermissionsOf(dirty), ["finance:payouts:view"]);
  assert.equal(accountTypeOf(dirty), "warehouse_agent");
});

/* ── F. the rest of the catalogue ─────────────────────────────────────── */

test("F. CRM, Finance Portal and System permissions are untouched", () => {
  const byModule = (m: string) => PERMISSION_CATALOG.filter((d) => d.module === m).length;
  // Pinned exactly. A change to any of these three numbers means this branch
  // did something it was told not to do.
  // Measured against origin/main before the change: system 14, crm 20,
  // finance 72, wh 20, total 126. Only the warehouse module moved, and only
  // by the two approved strings.
  assert.equal(byModule("system"), 14);
  assert.equal(byModule("crm"), 20);
  assert.equal(byModule("finance"), 72);
  assert.equal(byModule("wh"), 22);
  assert.equal(PERMISSION_CATALOG.length, 128);
});

test("F2. nothing is granted to anybody by cataloguing them", () => {
  const seed = strip(readFileSync(new URL("./rbac-seed.ts", import.meta.url).pathname, "utf8"));
  assert.equal(/["']wh:[^"']+["']/.test(seed), false,
    "no seed template or backfill may name a warehouse permission");
  assert.match(seed, /if \(existing\) continue;/,
    "role seeding must stay insert-only, so no existing install gains anything");

  for (const r of WAREHOUSE_ROLE_TEMPLATES) {
    if (r.name === "Warehouse Admin") continue;
    assert.equal(r.permissions.includes(VIEW), false, `${r.name} gained ${VIEW}`);
    assert.equal(r.permissions.includes(EDIT), false, `${r.name} gained ${EDIT}`);
  }
});

/* ── G. everything that already worked still works ────────────────────── */

test("G. the twenty original permissions mint exactly as before", () => {
  const ORIGINAL = [
    "wh:catalog:view", "wh:catalog:edit", "wh:topology:view", "wh:topology:edit",
    "wh:po:view", "wh:po:create", "wh:po:edit", "wh:po:submit", "wh:po:confirm",
    "wh:po:cancel", "wh:po:close", "wh:shipment:view", "wh:shipment:edit",
    "wh:receiving:view", "wh:receiving:count", "wh:receiving:post",
    "wh:inventory:view", "wh:inventory:adjust", "wh:putaway:move", "wh:admin",
  ];
  for (const p of ORIGINAL) {
    assert.equal(isWarehousePermission(p), true, `${p} stopped being canonical`);
    assert.ok(PERMISSION_BY_KEY[p], `${p} fell out of the lookup`);
    assert.ok(ALL_PERMISSIONS.includes(p));
  }
  const claims = buildWarehouseClaims(session({ permissions: ORIGINAL }));
  assert.deepEqual(claims.warehouse_permissions, ORIGINAL,
    "order and content must be exactly what they were");
  assert.deepEqual([...WAREHOUSE_PERMISSIONS].filter((p) => !ORIGINAL.includes(p)), [VIEW, EDIT],
    "and the only additions are the two approved ones");
});

/* ── the matrix shows them properly ───────────────────────────────────── */

test("the two rows render under Warehouse with their own names", () => {
  for (const key of [VIEW, EDIT]) {
    const def = PERMISSION_BY_KEY[key];
    assert.ok(def, `${key} must be in the catalog`);
    assert.equal(def!.module, "wh", "they belong to Warehouse, not to the Finance Portal");
    assert.equal(def!.section, "finance");
    assert.ok(def!.description && def!.description.length > 0, `${key} needs its tooltip`);
  }
  assert.equal(PERMISSION_BY_KEY[VIEW]!.label, "Warehouse Finance — View");
  assert.equal(PERMISSION_BY_KEY[EDIT]!.label, "Warehouse Finance — Edit");
});
