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
    "/portal/ai", "/admin/users",
  ];
  const missing = old.filter((h) => !all.has(h));
  assert.deepEqual(missing, [], `lost from navigation: ${missing.join(", ")}`);
});

test("the legacy /finance screen stays out of the navigation", () => {
  // Owner decision, 2026-10-07: the Finance portal at /portal/dashboard is the
  // user-facing surface. /finance remains reachable by direct URL, but it is
  // not promoted back into the nav without an explicit decision. This test is
  // the guard against it drifting back in.
  const all = new Set([...hrefs(CRM_NAV), ...hrefs(FIN_NAV)]);
  assert.equal(all.has("/finance"), false,
    "/finance (legacy) must not appear in the navigation");
  assert.ok(all.has("/portal/dashboard"),
    "the Finance portal it defers to must itself be reachable");
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

test("the disputes headline points at the inbox, not the superseded page", () => {
  // /portal/disputes/inbox replaced /portal/disputes on 2026-10-05. The shell
  // nav predated that and sent 'Disputes & refunds' to the old screen, so a
  // month of work was one route away and invisible.
  const items = FIN_NAV.flatMap((g) => g.items);
  const headline = items.find((i) => i.label === "Disputes & refunds");
  assert.ok(headline, "the headline entry must exist");
  assert.equal(headline.href, "/portal/disputes/inbox");
  assert.equal(items.some((i) => i.href === "/portal/disputes"), false,
    "the superseded page must not carry a nav entry");
});

test("no Finance nav entry points at a route the source of truth dropped", () => {
  // portal/nav.ts is the live Finance navigation. An entry here that it does
  // not list is, by definition, a screen it has moved on from.
  const truth = new Set(FINANCE_NAV.map((m) => m.href));
  const stale = FIN_NAV.flatMap((g) => g.items)
    .map((i) => i.href)
    .filter((h) => !truth.has(h));
  assert.deepEqual(stale, [], `nav points at superseded screens: ${stale.join(", ")}`);
});

// A href that is present but gated on the wrong permission is still a lost
// entry point: the module simply disappears for the roles that should see it.
// Covering the href is therefore not enough — the shell must reveal each
// module on at least every permission portal/nav.ts reveals it on.
test("the shell reveals each Finance module on every permission the source of truth does", () => {
  const shellItems = new Map(
    FIN_NAV.flatMap((g) => g.items).map((i) => [i.href, i.requires ?? []])
  );
  const gaps: string[] = [];
  for (const m of FINANCE_NAV) {
    const want = Array.isArray(m.requires) ? m.requires : [m.requires];
    const got = shellItems.get(m.href);
    if (got === undefined) continue;            // covered by the coverage test
    if (got.length === 0) continue;             // deliberately open to everyone
    for (const p of want) {
      if (!got.includes(p)) gaps.push(`${m.href} is hidden from holders of ${p}`);
    }
  }
  assert.deepEqual(gaps, [], gaps.join("; "));
});

test("the three Finance entries that were gated on the wrong permission are fixed", () => {
  const byHref = new Map(
    FIN_NAV.flatMap((g) => g.items).map((i) => [i.href, i.requires ?? []])
  );
  assert.ok(byHref.get("/portal/ledger")?.includes("finance:area_managers:view"),
    "the Ledger must stay visible to area-manager viewers");
  assert.equal(byHref.get("/portal/equipment")?.length, 4,
    "Equipment is revealed by any one of four permissions");
  assert.ok(byHref.get("/portal/import")?.includes("finance:expenses:create"),
    "CSV import belongs to whoever can create expenses, not to user admins");
  assert.equal(byHref.get("/portal/import")?.includes("system:users:view"), false,
    "user administration is not a licence to import finance data");
});
