// Run with:  node --test --import ./scripts/test-register.mjs src/lib/warehouse-routing.test.ts
//
// Same-origin /warehouse routing: the entitlement helper, the entry cookie,
// and the middleware that refreshes it and strips the CRM session credential.
//
// The stripping test is the important one. Same-origin means the browser sends
// the CRM `session` cookie on every /warehouse request, and the proxy would
// hand it to a different application. These assert on the headers Next will
// actually apply upstream, not on an intention.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";
import {
  canonicalWarehousePermissions,
  hasWarehouseEntitlement,
} from "./warehouse-entitlement.ts";
import { WAREHOUSE_PERMISSIONS, isWarehousePermission } from "../types/rbac.ts";
import { WAREHOUSE_TOKEN_COOKIE } from "./warehouse-mint.ts";

const LIB = import.meta.dirname;
const MW = readFileSync(join(LIB, "..", "middleware.ts"), "utf8");
const ENTER = readFileSync(
  join(LIB, "..", "app", "api", "auth", "warehouse-enter", "route.ts"), "utf8");
const SHELL = readFileSync(join(LIB, "..", "components", "AuthShell.tsx"), "utf8");
const LAYOUT = readFileSync(join(LIB, "..", "app", "layout.tsx"), "utf8");
// Line comments first: a `/*` inside a line comment would otherwise open a
// block that swallows real code — which it did, and the test "failed" on
// source that was never actually missing.
const strip = (s: string) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

/* ── The hardened validator ───────────────────────────────────────────── */

test("isWarehousePermission means canonical membership, not a prefix", () => {
  for (const p of WAREHOUSE_PERMISSIONS) assert.equal(isWarehousePermission(p), true);
  for (const bogus of ["wh:dashboard:view", "wh:", "wh:anything", "wh:admin:extra"]) {
    assert.equal(isWarehousePermission(bogus), false, `${bogus} must not qualify`);
  }
  assert.equal(isWarehousePermission("crm:jobs:view"), false);
});

test("the locked set is still exactly 20", () => {
  assert.equal(WAREHOUSE_PERMISSIONS.length, 20);
});

/* ── Entitlement (the gateway rule) ───────────────────────────────────── */

test("zero warehouse permissions is not entitlement", () => {
  assert.equal(hasWarehouseEntitlement([]), false);
  assert.equal(hasWarehouseEntitlement(["crm:jobs:view", "finance:tasks:view"]), false);
  assert.equal(hasWarehouseEntitlement(null), false);
  assert.equal(hasWarehouseEntitlement(undefined), false);
});

test("one canonical warehouse permission is entitlement", () => {
  assert.equal(hasWarehouseEntitlement(["wh:catalog:view"]), true);
});

test("a bogus wh: string is not entitlement", () => {
  assert.equal(hasWarehouseEntitlement(["wh:dashboard:view"]), false);
  assert.equal(hasWarehouseEntitlement(["wh:", "wh:made:up"]), false);
});

test("an admin's full CRM and Finance set is not entitlement", () => {
  // 103 real permissions, none of them warehouse. Being an admin is not it.
  const adminish = ["crm:jobs:view", "crm:jobs:edit", "finance:payouts:view", "system:users:edit"];
  assert.equal(hasWarehouseEntitlement(adminish), false);
});

test("canonicalWarehousePermissions keeps only real members", () => {
  assert.deepEqual(
    canonicalWarehousePermissions(["crm:jobs:view", "wh:dashboard:view", "wh:catalog:view"]),
    ["wh:catalog:view"],
  );
});

/* ── The gateway card ─────────────────────────────────────────────────── */

test("the Warehouse nav entry is declared and flagged, not permission-gated", () => {
  const entry = /\{[^{}]*href:\s*"\/warehouse"[^{}]*\}/.exec(LAYOUT);
  assert.ok(entry, "layout must declare the /warehouse nav entry");
  assert.ok(entry[0].includes("warehouse: true"), "it must use the entitlement flag");
  assert.equal(/permission:/.test(entry[0]), false,
    "it must NOT use `permission`, which the admin bypass would defeat");
});

test("the shell gates that flag on entitlement with no admin exception", () => {
  const code = strip(SHELL);
  const line = code.split("\n").find((l) => l.includes("link.warehouse"));
  assert.ok(line, "AuthShell must filter on link.warehouse");
  assert.ok(line.includes("hasWarehouseEntitlement"), "it must use the shared helper");
  assert.equal(/user\.type === 'admin'/.test(line), false,
    "the warehouse filter must carry no admin exception");
  assert.equal(/startsWith\(['"]wh:/.test(code), false,
    "the shell must not recognise warehouse permissions by prefix");
});

/* ── The entry route ──────────────────────────────────────────────────── */

test("the entry route reuses the shared minter — no second claim builder", () => {
  const code = strip(ENTER);
  assert.ok(code.includes("mintWarehouseToken"), "it must call the shared minter");
  for (const forbidden of ["SignJWT", "buildWarehouseClaims", "importPKCS8", "setAudience"]) {
    assert.equal(code.includes(forbidden), false,
      `the entry route must not build claims itself (${forbidden})`);
  }
});

test("the entry cookie carries every required attribute", () => {
  const code = strip(ENTER);
  const block = code.slice(code.indexOf("cookies.set"));
  assert.ok(/httpOnly:\s*true/.test(block), "HttpOnly");
  assert.ok(/secure:\s*true/.test(block), "Secure");
  assert.ok(/sameSite:\s*"lax"/.test(block), "SameSite=Lax");
  assert.ok(/path:\s*"\/warehouse"/.test(block), "Path=/warehouse");
  assert.ok(/maxAge:\s*minted\.expiresIn/.test(block), "Max-Age from the token lifetime");
  assert.ok(code.includes(`WAREHOUSE_TOKEN_COOKIE`), "it must use the shared cookie name");
});

test("a refusal never redirects onward — that is what forbids a loop", () => {
  const code = strip(ENTER);
  const refusal = code.slice(code.indexOf("if (!minted.ok)"), code.indexOf("const destination"));
  assert.equal(/redirect/.test(refusal), false,
    "a refused caller must be told, not bounced back to /warehouse");
});

test("the `next` parameter cannot leave the warehouse prefix", async () => {
  const { GET } = await import("../app/api/auth/warehouse-enter/route.ts");
  assert.ok(typeof GET === "function");
  const code = strip(ENTER);
  assert.ok(code.includes('startsWith("/warehouse")'), "destination must stay in-prefix");
  assert.ok(code.includes('raw.startsWith("//")'), "protocol-relative must be refused");
});

/* ── Middleware ───────────────────────────────────────────────────────── */

const SECRET = "x".repeat(40);
process.env.JWT_SECRET = SECRET;

async function whToken(secondsLeft: number): Promise<string> {
  // Signed with the WRONG kind of key on purpose: middleware must never verify.
  return new SignJWT({ sub: "u1" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + secondsLeft)
    .sign(new TextEncoder().encode(SECRET));
}

async function run(path: string, cookies: Record<string, string> = {}) {
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("../middleware.ts");
  const req = new NextRequest(new URL("https://app.test" + path), {});
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return middleware(req);
}

test("no wh_token redirects to the entry route, preserving the destination", async () => {
  const res = await run("/warehouse/catalog?page=2");
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location")!);
  assert.equal(loc.pathname, "/api/auth/warehouse-enter");
  assert.equal(loc.searchParams.get("next"), "/warehouse/catalog?page=2");
});

test("a near-expiry wh_token redirects to re-mint", async () => {
  const res = await run("/warehouse", { wh_token: await whToken(30) });
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location")!, /warehouse-enter/);
});

test("a healthy wh_token continues", async () => {
  const res = await run("/warehouse", { wh_token: await whToken(900) });
  assert.notEqual(res.status, 302);
  assert.equal(res.headers.get("location"), null);
});

test("a malformed wh_token grants nothing — it redirects to re-mint", async () => {
  for (const bad of ["not-a-token", "a.b", "", "..", "a.!!!.c"]) {
    const res = await run("/warehouse", { wh_token: bad });
    assert.equal(res.status, 302, `"${bad}" must not be treated as healthy`);
  }
});

test("build assets are never redirected, whatever the token looks like", async () => {
  // Found live: without this, a token lapsing mid-session turns the next
  // stylesheet request into a 302 to an API route and the page breaks.
  for (const cookies of [{}, { wh_token: await whToken(-10) }, { wh_token: "garbage" }]) {
    const res = await run("/warehouse/_next/static/chunks/main.css", cookies);
    assert.notEqual(res.status, 302, "a build asset must not be redirected");
  }
});

test("…but build assets still have the CRM session cookie stripped", async () => {
  const res = await run("/warehouse/_next/static/chunks/main.css", {
    session: "crm-session-jwt-value",
    wh_token: await whToken(900),
  });
  const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
  assert.equal(/(^|;\s*)session=/.test(forwarded), false);
  assert.equal(forwarded.includes("crm-session-jwt-value"), false);
});

test("a warehouse PAGE with a lapsed token is still redirected", async () => {
  const res = await run("/warehouse/catalog", { wh_token: await whToken(-10) });
  assert.equal(res.status, 302);
});

test("THE CRM SESSION COOKIE IS REMOVED FROM THE UPSTREAM REQUEST", async () => {
  const res = await run("/warehouse/catalog", {
    session: "crm-session-jwt-value",
    wh_token: await whToken(900),
  });
  // Next applies these to req.headers before proxying an external rewrite.
  const overridden = (res.headers.get("x-middleware-override-headers") ?? "").split(",");
  assert.ok(overridden.includes("cookie"), "cookie must be among the overridden headers");
  const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
  assert.equal(forwarded.includes("crm-session-jwt-value"), false,
    "the CRM session VALUE must not reach Warehouse");
  assert.equal(/(^|;\s*)session=/.test(forwarded), false,
    "no `session` cookie may reach Warehouse");
});

test("…while the Warehouse token and unrelated cookies still reach it", async () => {
  const tok = await whToken(900);
  const res = await run("/warehouse/catalog", {
    session: "crm-session-jwt-value",
    wh_token: tok,
    theme: "dark",
  });
  const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
  assert.ok(forwarded.includes(`${WAREHOUSE_TOKEN_COOKIE}=${tok}`), "wh_token must survive");
  assert.ok(forwarded.includes("theme=dark"), "unrelated cookies are not stripped blindly");
});

test("only the session cookie is named for removal", () => {
  const code = strip(MW);
  assert.ok(code.includes("const CRM_SESSION_COOKIE = 'session'"));
  const fn = code.slice(code.indexOf("function handleWarehouse"));
  const removals = [...fn.matchAll(/c\.name !== (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(removals, ["CRM_SESSION_COOKIE"], "exactly one cookie is removed");
});

test("middleware never verifies the warehouse token", () => {
  const fn = strip(MW).slice(strip(MW).indexOf("function unverifiedSecondsLeft"));
  const upTo = fn.slice(0, fn.indexOf("export async function middleware"));
  assert.equal(/jwtVerify|importSPKI|createPublicKey/.test(upTo), false,
    "the refresh path must decode, never verify");
});

test("the cookie name matches the shared constant", () => {
  assert.ok(MW.includes(`const WAREHOUSE_TOKEN_COOKIE = '${WAREHOUSE_TOKEN_COOKIE}'`),
    "middleware's literal must track lib/warehouse-mint.ts");
});

test("the refresh threshold is UX-only and does not touch the lifetime", () => {
  assert.ok(/REFRESH_WHEN_SECONDS_LEFT = 60/.test(MW));
  assert.equal(/ttlSeconds|900/.test(strip(MW)), false,
    "middleware must not restate the token lifetime");
});

/* ── CRM /api/* behaviour is unchanged ────────────────────────────────── */

test("an /api route with no session is still 401", async () => {
  const res = await run("/api/portal/admin/users");
  assert.equal(res.status, 401);
});

test("an exempt /api route still passes through", async () => {
  const res = await run("/api/login");
  assert.notEqual(res.status, 401);
  assert.equal(res.headers.get("location"), null);
});

test("a valid session still passes /api", async () => {
  const token = await new SignJWT({ name: "T", _id: "u1", active: true })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  const res = await run("/api/portal/admin/users", { session: token });
  assert.notEqual(res.status, 401);
});

test("the matcher covers warehouse without losing /api", () => {
  assert.ok(MW.includes("'/api/:path*'"));
  assert.ok(MW.includes("'/warehouse'"));
  assert.ok(MW.includes("'/warehouse/:path*'"));
});

test("/api requests are not cookie-stripped", async () => {
  const token = await new SignJWT({ name: "T", _id: "u1", active: true })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  const res = await run("/api/portal/admin/users", { session: token });
  assert.equal(res.headers.get("x-middleware-request-cookie"), null,
    "CRM routes must receive their session cookie untouched");
});
