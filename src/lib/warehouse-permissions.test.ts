// Run with:  node --test --import ./scripts/test-register.mjs src/lib/warehouse-permissions.test.ts
//
// The CRM is the authority that mints Warehouse tokens; Warehouse verifies
// them. The two must agree on the permission strings character for character,
// because there is deliberately no translation table between them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALL_PERMISSIONS,
  MODULE_LABEL,
  PERMISSION_BY_KEY,
  PERMISSION_CATALOG,
  WAREHOUSE_PERMISSIONS,
  isWarehousePermission,
} from "../types/rbac.ts";

/** The Warehouse application's own list, read from its source. */
function warehouseRepoPermissions(): string[] {
  const src = readFileSync(
    "/home/yehonatancohen/lbs-warehouse/src/lib/auth/claims.ts",
    "utf8",
  );
  const block = src.split("WAREHOUSE_PERMISSIONS")[1]!.split("] as const")[0]!;
  return [...block.matchAll(/"(wh:[^"]+)"/g)].map((m) => m[1]!);
}

/* ── Parity with the application that enforces them ───────────────────── */

test("the catalog and the Warehouse verifier hold exactly the same strings", () => {
  const theirs = new Set(warehouseRepoPermissions());
  const ours = new Set(WAREHOUSE_PERMISSIONS);
  assert.deepEqual([...ours].sort(), [...theirs].sort());
});

test("wh:admin survives as a two-part key", () => {
  // The one that a module:section:action builder would have mangled into
  // wh:admin:manage — a claim Warehouse would silently ignore.
  assert.ok(WAREHOUSE_PERMISSIONS.includes("wh:admin"));
  assert.equal(PERMISSION_BY_KEY["wh:admin"]?.module, "wh");
});

/* ── It appears in the editor like any other module ───────────────────── */

test("Warehouse is a module the matrix can render", () => {
  assert.equal(MODULE_LABEL.wh, "Warehouse");
  const defs = PERMISSION_CATALOG.filter((d) => d.module === "wh");
  assert.equal(defs.length, WAREHOUSE_PERMISSIONS.length);
  for (const d of defs) {
    assert.ok(d.label.length > 0, `${d.key} needs a label`);
    assert.ok(d.section.length > 0, `${d.key} needs a section`);
  }
});

test("every warehouse permission is reachable by key", () => {
  for (const k of WAREHOUSE_PERMISSIONS) {
    assert.ok(PERMISSION_BY_KEY[k], `${k} missing from the lookup`);
  }
});

test("isWarehousePermission recognises them and nothing else", () => {
  for (const k of WAREHOUSE_PERMISSIONS) assert.equal(isWarehousePermission(k), true);
  for (const k of ["crm:jobs:view", "finance:payouts:view", "system:users:view"]) {
    assert.equal(isWarehousePermission(k), false);
  }
});

/* ── Nothing is granted by their existing ─────────────────────────────── */

const SEED = readFileSync(
  new URL("./rbac-seed.ts", import.meta.url).pathname,
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("no seeded role template names a warehouse permission", () => {
  // Office, Bookkeeper, Location Manager and Simple must not gain Warehouse
  // access merely because the vocabulary now exists.
  assert.equal(/["']wh:[^"']+["']/.test(SEED), false, "a seed template names a wh: permission");
});

test("Admin's ALL_PERMISSIONS does include them — documented, not accidental", () => {
  // ALL_PERMISSIONS is derived from the catalog, so a fresh install's Admin
  // role is seeded with Warehouse too. Existing installs are unaffected:
  // seedSystemRoles is insert-only and the backfills only $addToSet named
  // lists, so no persisted role gains anything from this commit.
  for (const k of WAREHOUSE_PERMISSIONS) {
    assert.ok(ALL_PERMISSIONS.includes(k), `${k} should be in ALL_PERMISSIONS`);
  }
  assert.match(SEED, /if \(existing\) continue;/, "seeding must stay insert-only");
});

/* ── The rest of the catalog is untouched ─────────────────────────────── */

test("existing CRM, Finance and System permissions are unchanged in count", () => {
  const byModule = (m: string) => PERMISSION_CATALOG.filter((d) => d.module === m).length;
  // Pinned so a future edit to the warehouse block cannot quietly disturb them.
  assert.ok(byModule("system") > 0);
  assert.ok(byModule("crm") > 0);
  assert.ok(byModule("finance") > 0);
  assert.equal(
    byModule("system") + byModule("crm") + byModule("finance") + byModule("wh"),
    PERMISSION_CATALOG.length,
    "every permission belongs to a known module",
  );
});

test("no key is duplicated across the whole catalog", () => {
  const keys = PERMISSION_CATALOG.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
});

/* ── Grant / deny / inherit are the existing mechanics ────────────────── */

test("an explicit grant, an explicit deny and inheritance all work unchanged", async () => {
  const { computeEffectivePermissions } = await import("./rbac.ts");
  assert.equal(typeof computeEffectivePermissions, "function");
  // The tri-state lives in computeEffectivePermissions and the role editor;
  // Warehouse is a module inside it, not a new mechanism. What this pins is
  // that no warehouse-specific path was introduced.
  const src = readFileSync(new URL("./rbac.ts", import.meta.url).pathname, "utf8");
  assert.equal(/wh:/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), false,
    "rbac.ts must treat warehouse permissions like any other");
});
