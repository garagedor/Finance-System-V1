// Daily-cron safety net: weeks freeze at Monday 00:00 in the competition
// timezone even if nobody opens them; idempotent; DST-correct.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freezeDueCompetitions, openReview } from "./lifecycle.ts";
import { fixture, jobs, ADMIN } from "./testing/lifecycle-fixture.ts";

async function running(week: string, now: string) {
  const f = await fixture({ now });
  f.data.jobs = [...jobs(10, "Ann", "Closed", 1000, week), ...jobs(10, "Bo", "Closed", 900, week)];
  const id = await f.startWeek(week);
  return { ...f, id };
}
const status = async (f: Awaited<ReturnType<typeof running>>) => (await f.config.store.competitions.findOne({ _id: f.id }))!.status;

test("week ending on the DST change (Sun Nov 1, 2026): frozen at 05:00Z (EST), not at 04:59:59Z", async () => {
  const f = await running("2026-10-26", "2026-10-28T15:00:00Z");
  f.setNow("2026-11-02T04:59:59Z");
  assert.deepEqual(await freezeDueCompetitions(f.ctx), { checked: 1, frozen: [], notDue: 1 });
  assert.equal(await status(f), "active");
  f.setNow("2026-11-02T05:00:00Z"); // the existing cron's 05:00 UTC run
  assert.deepEqual(await freezeDueCompetitions(f.ctx), { checked: 1, frozen: [f.id], notDue: 0 });
  assert.equal(await status(f), "provisional");
});

test("summer (EDT) week: frozen once Monday 04:00Z has passed; the 05:00Z cron catches it", async () => {
  const f = await running("2026-07-06", "2026-07-08T15:00:00Z");
  f.setNow("2026-07-13T03:59:59Z");
  assert.equal((await freezeDueCompetitions(f.ctx)).frozen.length, 0);
  f.setNow("2026-07-13T05:00:00Z");
  assert.deepEqual((await freezeDueCompetitions(f.ctx)).frozen, [f.id]);
});

test("idempotent: a second run (or an already frozen week) changes nothing", async () => {
  const f = await running("2026-10-26", "2026-10-28T15:00:00Z");
  f.setNow("2026-11-02T05:00:00Z");
  await freezeDueCompetitions(f.ctx);
  const snaps = f.lc.snapshots.docs.length;
  const audits = (await f.config.store.audit.find({}).sort({ at: 1 }).toArray()).length;
  assert.deepEqual(await freezeDueCompetitions(f.ctx), { checked: 0, frozen: [], notDue: 0 });
  assert.equal(f.lc.snapshots.docs.length, snaps);
  assert.equal((await f.config.store.audit.find({}).sort({ at: 1 }).toArray()).length, audits);
  // a week already in review is not touched either
  await openReview(f.ctx, f.id, ADMIN);
  await freezeDueCompetitions(f.ctx);
  assert.equal(await status(f), "in_review");
});

test("a missed run is caught by the next day's run", async () => {
  const f = await running("2026-10-26", "2026-10-28T15:00:00Z");
  f.setNow("2026-11-03T05:00:00Z");
  assert.deepEqual((await freezeDueCompetitions(f.ctx)).frozen, [f.id]);
});

test("wired into the EXISTING daily cron, behind its CRON_SECRET check, isolated", () => {
  // Release RC: main now carries more CRM crons (bank-sync, invoice-links) and the
  // release adds the Arena monitor cron. Pin what matters: the daily ScanPay cron
  // is still there, and the ONLY Arena cron is /api/arena/monitor (once).
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  const paths: string[] = vercel.crons.map((c: { path: string }) => c.path);
  assert.ok(paths.includes("/api/scanpay/cron-sync"), "daily ScanPay cron present");
  assert.deepEqual(paths.filter((p) => p.startsWith("/api/arena/")), ["/api/arena/monitor"]);
  const route = readFileSync("src/app/api/scanpay/cron-sync/route.ts", "utf8");
  assert.ok(route.indexOf("CRON_SECRET") < route.indexOf("arenaCronStep()"), "after the auth check");
  const step = readFileSync("src/lib/arena/cron.ts", "utf8");
  assert.match(step, /catch \(e\)/, "never throws into the cron");
  assert.doesNotMatch(step.replace(/\/\*\*[\s\S]*?\*\//, ""), /approve|reconcile|openReview/, "only freezes (code, not the comment)");
});
