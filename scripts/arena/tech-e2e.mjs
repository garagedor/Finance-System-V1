#!/usr/bin/env node
// 317 LIVE ARENA — technician API end-to-end check against the LOCAL dev server.
//
//   node scripts/arena/tech-e2e.mjs                 read-only checks
//   node scripts/arena/tech-e2e.mjs --acceptance    + the owner acceptance flow
//                                                   (amend rules → dev freeze → review →
//                                                   owner approval → celebration event).
//                                                   It changes the LIVE dev week; re-run
//                                                   ~/arena-dev/seed-tech.mjs afterwards.
//
// Real logins only: synthetic technicians sign in to the Weekly Balance STAGING
// project through its tech-login function (credentials: ~/arena-dev/tech-creds.json),
// and the real staging access token is exchanged for an Arena pass. There is no
// test-token mode. Refuses to run unless the target is 127.0.0.1 and the
// staging ref differs from production. Prints no tokens, PINs or keys.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.ARENA_E2E_BASE ?? "http://127.0.0.1:3999";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) throw new Error("refusing: e2e targets the local dev server only");
const ACCEPT = process.argv.includes("--acceptance");
const HOME = os.homedir();
const env = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split("\n").map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const stg = env(path.join(HOME, "convert-migration/.env.staging"));
const prod = env(path.join(HOME, "convert-migration/.env.migration"));
if (!stg.STAGING_REF || stg.STAGING_REF === prod.NEW_REF) throw new Error("refusing: staging ref missing or equals production");
const ANON = env(path.join(HOME, "convert-migration/staging/keys.env")).ANON_KEY;
const WB = `https://${stg.STAGING_REF}.supabase.co`;
const creds = JSON.parse(fs.readFileSync(path.join(HOME, "arena-dev/tech-creds.json"), "utf8"));
const DEV_PW = /bcrypt\.hash\("([^"]+)"/.exec(fs.readFileSync(path.join(HOME, "arena-dev/seed.cjs"), "utf8"))[1]; // fictional dev password

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const decode = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

async function techLogin(key) {
  const c = creds[key];
  const r = await fetch(`${WB}/functions/v1/tech-login`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: c.phone, pin: c.pin }),
  });
  const b = await r.json();
  if (!b.ok || !b.access_token) throw new Error(`staging tech-login failed for ${key}: ${b.code ?? r.status}`);
  return b.access_token;
}
async function call(method, p, { token, cookie, origin, body } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (cookie) h.Cookie = cookie;
  if (origin) h.Origin = origin;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, headers: r.headers, text };
}
async function crmLogin(name) {
  const r = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, password: DEV_PW }) });
  const m = /(?:^|,\s*)session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "");
  if (!m) throw new Error(`CRM login failed for ${name}: ${r.status}`);
  return `session=${m[1]}`;
}
const exchange = (wbToken, origin) => call("POST", "/api/arena/auth/exchange", { token: wbToken, origin });

const FORBIDDEN = /"(Marcus|Ava|Jordan|Sofia|Ethan|Maya|Diego|Liam|Noah|Chris|Isaac|Ryan|Leo|Ben|Dana L|CHICAGO|Sub Demo|Benny)"|profitMicro|jobIds|crmNames|dupKeys|clientPhone|address|invoice|supabase|"_id"/;
const minimal = (name, r) => check(`${name}: data minimization`, !FORBIDDEN.test(r.text) && !/[0-9a-f]{24}/.test(r.text), FORBIDDEN.exec(r.text)?.[0] ?? "");

// ── technician flow ────────────────────────────────────────────────────────
const alphaWb = await techLogin("alpha");
check("staging tech-login (alpha) returns a real ES256 access token", JSON.parse(Buffer.from(alphaWb.split(".")[0], "base64url")).alg === "ES256");

const ex = await exchange(alphaWb);
check("exchange → 200 + pass", ex.status === 200 && !!ex.json?.pass, `status ${ex.status} ${ex.json?.code ?? ""}`);
const P = ex.json.pass;
const claims = decode(P);
check("pass: RS256, aud arena, iss lbs-crm-arena, sub = competitor, 5 min",
  JSON.parse(Buffer.from(P.split(".")[0], "base64url")).alg === "RS256" && claims.aud === "arena" && claims.iss === "lbs-crm-arena" &&
  claims.sub === creds.alpha.id && claims.exp - claims.iat === 300);
check("exchange body shape", ex.json.competitorId === creds.alpha.id && ex.json.displayName === creds.alpha.name && !!Date.parse(ex.json.expiresAt));

const me = await call("GET", "/api/arena/tech/me", { token: P });
check("GET /me → 200", me.status === 200, `${me.status}`);
minimal("/me", me);
check("/me: live competition for the current week", me.json?.competition?.phase === "live" && me.json.competition.weekStart === "2026-10-26",
  `${me.json?.competition?.phase} ${me.json?.competition?.weekStart}`);
check("/me: standing with gates and next steps", !!me.json?.standing?.gates?.jobs && Array.isArray(me.json.standing.nextSteps), `rank ${me.json?.standing?.rank}`);
check("/me: no award before approval", me.json?.award === null);

const lb = await call("GET", "/api/arena/tech/leaderboard", { token: P });
check("GET /leaderboard (national) → 200", lb.status === 200 && lb.json.rows.length > 5, `${lb.json?.rows?.length} rows`);
minimal("/leaderboard", lb);
check("/leaderboard: exactly one row is me", lb.json.rows.filter((r) => r.isMe).length === 1 && lb.json.rows.find((r) => r.isMe).competitorId === creds.alpha.id);
check("/leaderboard: prizes only on eligible rows", lb.json.rows.every((r) => r.eligible || r.prizeCents === 0));
const lbE = await call("GET", "/api/arena/tech/leaderboard?view=eligible", { token: P });
check("GET /leaderboard?view=eligible", lbE.status === 200 && lbE.json.rows.every((r) => r.eligible));
const lbOld = await call("GET", "/api/arena/tech/leaderboard?week=2026-10-12", { token: P });
check("GET /leaderboard?week=2026-10-12 (approved)", lbOld.status === 200 && lbOld.json.phase === "approved", lbOld.json?.phase);
const lbFrozen = await call("GET", "/api/arena/tech/leaderboard?week=2026-10-19", { token: P });
check("GET /leaderboard?week=2026-10-19 (frozen)", lbFrozen.status === 200 && lbFrozen.json.phase === "frozen", lbFrozen.json?.phase);
check("GET /leaderboard?week=2026-11-02 (not started) → 404", (await call("GET", "/api/arena/tech/leaderboard?week=2026-11-02", { token: P })).status === 404);
check("GET /leaderboard?view=bogus → 400", (await call("GET", "/api/arena/tech/leaderboard?view=bogus", { token: P })).status === 400);

const hist = await call("GET", "/api/arena/tech/history", { token: P });
check("GET /history → 6 approved weeks", hist.status === 200 && hist.json.weeks.length === 6, `${hist.json?.weeks?.length}`);
minimal("/history", hist);

const ev0 = await call("GET", "/api/arena/tech/events", { token: P });
check("GET /events (no cursor) → position only", ev0.status === 200 && ev0.json.events.length === 0 && /^c1\./.test(ev0.json.cursor));
const ev1 = await call("GET", `/api/arena/tech/events?since=${encodeURIComponent(ev0.json.cursor)}`, { token: P });
check("GET /events?since=cursor", ev1.status === 200 && Array.isArray(ev1.json.events));
minimal("/events", ev1);
check("GET /events?since=garbage → 400", (await call("GET", "/api/arena/tech/events?since=garbage", { token: P })).status === 400);

// ── credentials that must NOT work ─────────────────────────────────────────
check("no credential → 401", (await call("GET", "/api/arena/tech/me")).status === 401);
check("a Weekly Balance token is not a pass → 401", (await call("GET", "/api/arena/tech/me", { token: alphaWb })).status === 401);
const ownerCookie = await crmLogin("Owner Demo");
check("a CRM session cookie is not a pass → 401", (await call("GET", "/api/arena/tech/me", { cookie: ownerCookie })).status === 401);
check("the pass does not open admin routes → 401", (await call("GET", "/api/arena/admin/overview", { token: P })).status === 401);
check("the pass does not open CRM routes → 401", (await call("GET", "/api/jobs", { token: P })).status === 401);
const tampered = P.slice(0, -4) + (P.endsWith("AAAA") ? "BBBB" : "AAAA");
check("tampered pass → 401", (await call("GET", "/api/arena/tech/me", { token: tampered })).status === 401);

const charlie = await exchange(await techLogin("charlie"));
check("pending staging account (charlie) → 403 account_inactive", charlie.status === 403 && charlie.json?.code === "account_inactive", `${charlie.status} ${charlie.json?.code}`);
const delta = await exchange(await techLogin("delta"));
check("unmapped staging account (delta) → 403 not_a_competitor", delta.status === 403 && delta.json?.code === "not_a_competitor", `${delta.status} ${delta.json?.code}`);
check("garbage token → 401 invalid_token", (await exchange("a.b.c")).json?.code === "invalid_token");

// ── CORS ───────────────────────────────────────────────────────────────────
const pre = await call("OPTIONS", "/api/arena/tech/me", { origin: "capacitor://localhost" });
check("CORS preflight from an allowed origin", pre.status === 204 && pre.headers.get("access-control-allow-origin") === "capacitor://localhost" &&
  !pre.headers.get("access-control-allow-credentials"));
check("CORS preflight from another origin → 403", (await call("OPTIONS", "/api/arena/tech/me", { origin: "https://evil.example" })).status === 403);
check("request from another origin → 403", (await call("GET", "/api/arena/tech/me", { token: P, origin: "https://evil.example" })).status === 403);

// ── re-verification on every request (REAL staging verifier) ───────────────
// Bravo is deactivated on staging through the real admin channel (a Weekly
// Balance manager's own session, PostgREST + RLS — what the admin screen
// sends), then re-activated. Helper: ~/arena-dev/wb-admin.mjs (staging only).
const wbAdmin = await import(path.join(HOME, "arena-dev/wb-admin.mjs"));
const bravoEx = await exchange(await techLogin("bravo"));
check("real verifier: bravo (approved) → 200 + pass", bravoEx.status === 200 && !!bravoEx.json?.pass, `${bravoEx.status} ${bravoEx.json?.code ?? ""}`);
const BP = bravoEx.json?.pass;
try {
  const sw = await wbAdmin.activeSwitch(creds.bravo.id, false);
  check("WB admin 'Active' switch alone leaves an APPROVED account active (known WB defect; trigger keeps status)", sw.status === "APPROVED" && sw.is_active === true);
  const d = await wbAdmin.deactivate(creds.bravo.id);
  check("staging admin deactivates bravo (status DEACTIVATED)", d.status === "DEACTIVATED" && d.is_active === false && d.can_login === false);
  const r = await call("GET", "/api/arena/tech/me", { token: BP });
  check("deactivated mid-session → next request refused (unexpired pass)", r.status === 403 && r.json?.code === "account_inactive", `${r.status} ${r.json?.code}`);
  const again = await call("POST", "/api/arena/auth/exchange", { token: await techLogin("alpha") });
  check("others unaffected (alpha exchange still 200)", again.status === 200);
} finally {
  const re = await wbAdmin.reactivate(creds.bravo.id);
  check("staging admin re-activates bravo (status APPROVED)", re.status === "APPROVED" && re.is_active === true);
}
check("re-activated → accepted again", (await call("GET", "/api/arena/tech/me", { token: BP })).status === 200);

// ── owner acceptance flow (changes the dev live week) ──────────────────────
if (ACCEPT) {
  const id = "arena_2026-10-26";
  const adminCookie = await crmLogin("Admin Demo");
  const comp = await call("GET", `/api/arena/admin/competitions/${id}`, { cookie: ownerCookie });
  const rules = comp.json.ruleVersion.rules;
  const meBefore = (await call("GET", "/api/arena/tech/me", { token: P })).json.standing;
  const cur0 = (await call("GET", "/api/arena/tech/events", { token: P })).json.cursor;
  const amended = { ...rules, eligibility: { ...rules.eligibility, minQualifyingJobs: 3, minAvgTicketCents: 10_000, minClosingRateBp: 1_000 } };
  const am = await call("POST", `/api/arena/admin/competitions/${id}/action`, { cookie: ownerCookie, body: { action: "amend", rules: amended, reason: "Acceptance demo: short week" } });
  check("owner amends the live rules in the Control Center API", am.status === 200, `${am.status} ${am.text.slice(0, 120)}`);
  const meAfter = await call("GET", "/api/arena/tech/me", { token: P });
  check("technician sees the new rules immediately", meAfter.json.rules.minQualifyingJobs === 3 && meAfter.json.notices[0]?.message === "Acceptance demo: short week");
  check("scoring responds: alpha is now eligible", !meBefore.eligible && meAfter.json.standing.eligible === true, `before ${meBefore.eligible} after ${meAfter.json.standing.eligible}`);
  const evA = await call("GET", `/api/arena/tech/events?since=${encodeURIComponent(cur0)}`, { token: P });
  check("events: qualification (+ rank) events after the change", evA.json.events.some((e) => e.kind === "qualified" && e.gate === "all"), evA.json.events.map((e) => e.kind).join(","));
  check("admin cannot use 'freeze now (dev)' (owner only)",
    (await call("POST", `/api/arena/admin/competitions/${id}/action`, { cookie: adminCookie, body: { action: "freeze_now_dev" } })).status === 403);
  check("regular freeze is refused before Sunday ends",
    (await call("POST", `/api/arena/admin/competitions/${id}/action`, { cookie: adminCookie, body: { action: "freeze" } })).status === 409);
  const fz = await call("POST", `/api/arena/admin/competitions/${id}/action`, { cookie: ownerCookie, body: { action: "freeze_now_dev" } });
  check("owner freezes now (dev)", fz.status === 200, `${fz.status} ${fz.text.slice(0, 120)}`);
  check("technician sees phase frozen", (await call("GET", "/api/arena/tech/me", { token: P })).json.competition.phase === "frozen");
  const rv = await call("POST", `/api/arena/admin/competitions/${id}/action`, { cookie: adminCookie, body: { action: "open_review" } });
  check("admin opens review", rv.status === 200, `${rv.status} ${rv.text.slice(0, 120)}`);
  let res = await call("GET", `/api/arena/admin/competitions/${id}/results`, { cookie: ownerCookie });
  check("results panel data: in review, approval open (dev early close), no blockers", res.json.phase === "in_review" && res.json.approvalOpen && res.json.blockers.length === 0, JSON.stringify(res.json.blockers));
  // ── account eligibility (real staging verifier) ──
  const rowOf = (r, key) => r.json.snapshot.rows.find((x) => x.competitorId === creds[key].id);
  const ch = rowOf(res, "charlie");
  const charliePaidBelow = res.json.snapshot.rows.some((x) => x.rank > ch.rank && x.prizeCents > 0);
  check("eligibility: Charlie (PENDING on staging) met the gates in a would-be prize spot but is skipped",
    ch.eligible && ch.account?.state === "pending" && ch.prizeCents === 0 && ch.prizePosition === null && charliePaidBelow,
    `rank ${ch.rank} gates ${ch.eligible} account ${ch.account?.state} prize ${ch.prizeCents}`);
  check("eligibility: admin sees the reason", /pending approval/i.test(ch.account?.reason ?? ""));
  const lbReview = await call("GET", "/api/arena/tech/leaderboard", { token: P });
  const chTech = lbReview.json.rows.find((x) => x.competitorId === creds.charlie.id);
  check("eligibility: technicians see Charlie only as not prize-eligible, no reason, no metrics",
    chTech && chTech.eligible === false && chTech.prizeCents === 0 && chTech.closingRateBp === null && !/pending|inactive|account|verif/i.test(lbReview.text),
    JSON.stringify(chTech));
  check("eligibility: Charlie absent from the prize-eligible view",
    !(await call("GET", "/api/arena/tech/leaderboard?view=eligible", { token: P })).json.rows.some((x) => x.competitorId === creds.charlie.id));
  const bravoBefore = rowOf(res, "bravo");
  await wbAdmin.deactivate(creds.bravo.id);
  try {
    const blocked = await call("POST", `/api/arena/admin/competitions/${id}/approve`, { cookie: ownerCookie, body: { snapshotId: res.json.snapshot._id } });
    check("eligibility: Bravo deactivated after review → approval blocked (status changed since review)",
      blocked.status === 409 && /account status changed since this review/i.test(blocked.json?.error ?? "") && /Bravo/.test(blocked.json?.error ?? ""), `${blocked.status} ${blocked.json?.error}`);
    const rc = await call("POST", `/api/arena/admin/competitions/${id}/action`, { cookie: ownerCookie, body: { action: "reconcile" } });
    check("eligibility: re-check creates a new snapshot to review", rc.status === 200, `${rc.status}`);
    res = await call("GET", `/api/arena/admin/competitions/${id}/results`, { cookie: ownerCookie });
    const br = rowOf(res, "bravo");
    check("eligibility: re-reviewed snapshot shows Bravo inactive, never holding a prize; ranks/KPIs unchanged",
      br.account?.state === "inactive" && br.prizeCents === 0 && br.rank === bravoBefore.rank && br.closingRate === bravoBefore.closingRate, JSON.stringify(br.account));
  } finally {
    await wbAdmin.reactivate(creds.bravo.id);
  }
  const reBlocked = await call("POST", `/api/arena/admin/competitions/${id}/approve`, { cookie: ownerCookie, body: { snapshotId: res.json.snapshot._id } });
  check("eligibility: Bravo re-activated after that review → blocked again until re-checked", reBlocked.status === 409 && /inactive → eligible/.test(reBlocked.json?.error ?? ""), reBlocked.json?.error);
  await call("POST", `/api/arena/admin/competitions/${id}/action`, { cookie: ownerCookie, body: { action: "reconcile" } });
  res = await call("GET", `/api/arena/admin/competitions/${id}/results`, { cookie: ownerCookie });
  check("eligibility: after the final re-check Bravo is eligible again and there are no blockers", rowOf(res, "bravo").account?.state === "eligible" && res.json.blockers.length === 0);
  const notOwner = await call("POST", `/api/arena/admin/competitions/${id}/approve`, { cookie: adminCookie, body: { snapshotId: res.json.snapshot._id } });
  check("admin cannot approve (owner only) → 403", notOwner.status === 403);
  const evBeforeApproval = (await call("GET", `/api/arena/tech/events?since=${encodeURIComponent(cur0)}`, { token: P })).json.events;
  check("no result_approved event before approval", !evBeforeApproval.some((e) => e.kind === "result_approved"));
  const ap = await call("POST", `/api/arena/admin/competitions/${id}/approve`, { cookie: ownerCookie, body: { snapshotId: res.json.snapshot._id, note: "acceptance" } });
  check("owner approves winners", ap.status === 200, `${ap.status} ${ap.text.slice(0, 160)}`);
  check("second approval refused", (await call("POST", `/api/arena/admin/competitions/${id}/approve`, { cookie: ownerCookie, body: { snapshotId: res.json.snapshot._id } })).status === 409);
  const meFinal = await call("GET", "/api/arena/tech/me", { token: P });
  check("technician sees approved phase + award", meFinal.json.competition.phase === "approved" && meFinal.json.award !== null, JSON.stringify(meFinal.json.award));
  const evF = await call("GET", `/api/arena/tech/events?since=${encodeURIComponent(cur0)}`, { token: P });
  const ra = evF.json.events.filter((e) => e.kind === "result_approved");
  check("exactly one result_approved event drives the celebration", ra.length === 1 && ra[0].weekStart === "2026-10-26", JSON.stringify(ra[0]));
  minimal("/events after approval", evF);
  const hist2 = await call("GET", "/api/arena/tech/history", { token: P });
  check("history now has 7 approved weeks", hist2.json.weeks.length === 7 && hist2.json.weeks[0].weekStart === "2026-10-26");
}

console.log(`\n${pass} passed, ${fail} failed${ACCEPT ? " (acceptance flow included; re-run seed-tech.mjs to restore the live week)" : ""}`);
process.exit(fail ? 1 : 0);
