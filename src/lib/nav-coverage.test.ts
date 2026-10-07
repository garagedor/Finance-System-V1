// Run with:  node --test --import ./scripts/test-register.mjs src/lib/nav-coverage.test.ts
//
// The ecosystem shell re-groups navigation into business categories. That is a
// curated copy, and a copy drifts: FIN_NAV was written a month before the
// Financial Report, the Custom Report and the Disputes inbox shipped, so when
// it replaced the old sidebar those three features became unreachable from the
// navigation while still existing as routes.
//
// src/app/portal/nav.ts stays the source of truth for Finance. This asserts
// the shell covers all of it, so a new module cannot ship nav-less again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CRM_NAV, FIN_NAV } from "../components/shell/nav-config.ts";
import { FINANCE_NAV } from "../app/portal/nav.ts";

const hrefs = (groups: { items: { href: string }[] }[]) =>
  new Set(groups.flatMap((g) => g.items.map((i) => i.href)));

test("every Finance module in the source of truth is reachable from the shell", () => {
  const shell = hrefs(FIN_NAV);
  const missing = FINANCE_NAV.map((m) => m.href).filter((h) => !shell.has(h));
  assert.deepEqual(missing, [],
    `these Finance routes exist but have no nav entry: ${missing.join(", ")}`);
});

test("the three features lost in the Design 360 integration are back", () => {
  const shell = hrefs(FIN_NAV);
  for (const h of ["/portal/finance-report", "/portal/finance-report/custom",
                   "/portal/disputes/inbox"]) {
    assert.ok(shell.has(h), `${h} must have a nav entry`);
  }
});

test("the CRM entries the old flat nav carried are all still present", () => {
  // The pre-redesign list lived in layout.tsx. Everything it offered must
  // still be offered somewhere, or a screen silently disappears.
  const all = new Set([...hrefs(CRM_NAV), ...hrefs(FIN_NAV)]);
  const old = [
    "/tables", "/tables-ai", "/stats", "/balance-report", "/report",
    "/payment-method-report", "/verify-reports", "/portal/dashboard",
    "/portal/ai", "/admin/users", "/finance",
  ];
  const missing = old.filter((h) => !all.has(h));
  assert.deepEqual(missing, [], `lost from navigation: ${missing.join(", ")}`);
});

test("the CRM dashboard entry points at its new home", () => {
  const crm = hrefs(CRM_NAV);
  assert.ok(crm.has("/crm"), "the dashboard moved to /crm");
  assert.equal(crm.has("/"), false, "/ is the Gateway, not a CRM nav item");
});

test("every nav href is a route that exists", () => {
  const app = join(import.meta.dirname, "..", "app");
  const all = [...hrefs(CRM_NAV), ...hrefs(FIN_NAV)];
  const broken = all.filter((h) => {
    if (h === "/warehouse") return false;           // a rewrite, not a local page
    return !existsSync(join(app, h.replace(/^\//, ""), "page.tsx"));
  });
  assert.deepEqual(broken, [], `nav points at non-existent routes: ${broken.join(", ")}`);
});

test("nav entries carry permissions, so nothing is revealed by accident", () => {
  const ungated = [...CRM_NAV, ...FIN_NAV]
    .flatMap((g) => g.items)
    .filter((i) => !i.requires || i.requires.length === 0)
    .map((i) => i.href);
  // '/portal/me/security' is deliberately everyone's own page.
  assert.deepEqual(ungated.filter((h) => h !== "/portal/me/security"), []);
});

test("the Warehouse nav entry is restored, and keeps the locked rule", async () => {
  const { visibleGroups } = await import("../components/shell/nav-config.ts");
  const has = (perms: string[], isAdmin: boolean) =>
    visibleGroups(CRM_NAV, perms, isAdmin).some((g) => g.items.some((i) => i.href === "/warehouse"));
  assert.equal(has([], true), false, "an admin holding no wh: permission must NOT see it");
  assert.equal(has(["wh:dashboard:view"], true), false, "a bogus wh: string must not reveal it");
  assert.equal(has(["wh:catalog:view"], false), true, "one canonical permission reveals it");
  assert.equal(has(["wh:admin"], false), true);
  // and the admin shortcut still works for everything else
  assert.equal(visibleGroups(CRM_NAV, [], true).some((g) => g.items.some((i) => i.href === "/tables")), true);
});
