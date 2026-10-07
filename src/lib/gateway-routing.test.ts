// Run with:  node --test --import ./scripts/test-register.mjs src/lib/gateway-routing.test.ts
//
// The 317 Eco System Gateway is the root experience; the CRM dashboard moved to
// /crm. These pin the routing so neither entry point can drift back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PORTALS, grantedPortals, postLoginRoute } from "../config/portals.ts";

const APP = join(import.meta.dirname, "..", "app");
const read = (...p: string[]) => readFileSync(join(APP, ...p), "utf8");
const portal = (k: string) => PORTALS.find((p) => p.key === k)!;

test("/ is the Gateway, not the CRM dashboard", () => {
  const root = read("page.tsx");
  assert.ok(root.includes("grantedPortals"), "the root must render the portal gateway");
  assert.ok(root.includes("gateway.css"));
  assert.equal(root.includes("jobsByLocation"), false, "the CRM dashboard must not be here");
});

test("/crm is the CRM dashboard — moved, not copied", () => {
  const crm = read("crm", "page.tsx");
  assert.ok(crm.includes("jobsByLocation"), "the dashboard implementation lives here");
  assert.ok(crm.includes("../utils/jobUtils"), "its relative imports were repaired for the new depth");
  assert.equal(existsSync(join(APP, "crm", "LocationBarChart.tsx")), false,
    "the chart must be referenced, not duplicated");
});

test("/home redirects to the one canonical Gateway", () => {
  const home = read("home", "page.tsx");
  assert.ok(home.includes("redirect('/')"), "/home must redirect, not re-implement");
  assert.equal(home.includes("grantedPortals"), false, "no second gateway to maintain");
});

test("the root is bare-matched EXACTLY, so it cannot swallow every route", () => {
  const shell = readFileSync(join(APP, "..", "components", "AuthShell.tsx"), "utf8");
  assert.ok(shell.includes("BARE_EXACT"), "the root needs exact matching");
  assert.equal(/BARE_PREFIXES\s*=\s*\[[^\]]*'\/'/.test(shell), false,
    "'/' as a prefix would make every route chrome-less");
});

test("portal cards point where they should", () => {
  assert.equal(portal("crm").href, "/crm");
  assert.equal(portal("fin").href, "/portal/dashboard");
  assert.equal(portal("whs").href, "/warehouse");
});

test("post-login: several portals → the Gateway, exactly one → that portal", () => {
  assert.equal(postLoginRoute(["crm:jobs:view", "finance:payouts:view"], "simple"), "/");
  assert.equal(postLoginRoute(["crm:jobs:view"], "simple"), "/crm");
  assert.equal(postLoginRoute(["finance:payouts:view"], "simple"), "/portal/dashboard");
  assert.equal(postLoginRoute(["wh:catalog:view"], "simple"), "/warehouse");
  assert.equal(postLoginRoute([], "simple"), "/", "no access still lands on the Gateway");
  assert.equal(postLoginRoute([], "admin"), "/", "an admin sees CRM + Finance, so the Gateway");
});

test("the Warehouse card never appears without canonical entitlement", () => {
  assert.equal(grantedPortals([], "admin").includes("whs"), false);
  assert.equal(grantedPortals(["wh:dashboard:view"], "admin").includes("whs"), false);
  assert.equal(grantedPortals(["wh:catalog:view"], "simple").includes("whs"), true);
});

test("the font face loads — it must be the first rule in globals.css", () => {
  const g = readFileSync(join(APP, "globals.css"), "utf8");
  const first = g.split("\n").find((l) => l.trim() && !l.trim().startsWith("/*"))!;
  assert.ok(first.includes("fonts.googleapis.com"),
    "an @import after any rule is dropped by the bundler, and Manrope silently never loads");
  const ds = readFileSync(join(APP, "..", "styles", "design-system.css"), "utf8");
  assert.equal(ds.trimStart().startsWith("@import url("), false, "no duplicate font import");
});
