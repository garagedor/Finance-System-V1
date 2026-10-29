import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCases } from "./detect.ts";
import { computeCompetition } from "./engine.ts";
import { buildCompetitorMap } from "./identity.ts";
import { SEED_STANDARD_WEEK, cloneRules, rulesHash } from "./config.ts";
import { arenaDbName, ArenaEnvError } from "./env.ts";
import type { ArenaJob } from "./types.ts";

const W1 = "2026-09-07", W2 = "2026-09-14";
let seq = 0;
const job = (tech: string, status: string, profit: number, date: string, dupKeys: string[] = [], location = "Chicago"): ArenaJob =>
  ({ id: `j${String(++seq).padStart(4, "0")}`, tech, date, status, location, profit, dupKeys });
const many = (n: number, tech: string, status: string, profit: number, date: string) =>
  Array.from({ length: n }, () => job(tech, status, profit, date));

const mappings = [
  { supabaseUserId: "u_dana", supabaseFullName: "דנה כהן", crmTechNames: ["Dana"] },
  { supabaseUserId: "u_yuval", supabaseFullName: "Yuval German", crmTechNames: ["Yuval"] },
];
const technicians = [{ _id: "Dana", location: "Chicago" }, { _id: "Yuval", location: "Chicago" }, { _id: "Chicago", location: "Chicago" }];

function weeks() {
  seq = 0;
  const w1 = [
    ...many(12, "Dana", "Closed", 500, "2026-09-08"),
    job("Dana", "Closed", 450, "2026-09-09", ["phone:aa"]),
    job("Dana", "Closed", 450, "2026-09-09", ["phone:aa"]), // same day, same customer, same $
    ...many(10, "Yuval", "Closed", 450, "2026-09-08"),
    ...many(3, "Yuvi", "Closed", 450, "2026-09-10"), // an alias nobody has mapped
    ...many(5, "Chicago", "Closed", 200, "2026-09-10"), // a location pool
  ];
  const w2 = [...many(11, "Dana", "Closed", 500, "2026-09-15"), ...many(2, "Yuvi", "Estimate", 0, "2026-09-16")];
  return [{ weekStart: W1, jobs: w1 }, { weekStart: W2, jobs: w2 }];
}
const base = { mappings, technicians, rules: SEED_STANDARD_WEEK, overrides: [], displayNames: {}, exclusions: [] };

test("detect: duplicates keyed like the engine, unmapped names aggregated across weeks, non-Latin names flagged", () => {
  const found = detectCases({ ...base, weeks: weeks() });
  const dups = found.filter((c) => c.kind === "duplicate_group");
  assert.equal(dups.length, 1);
  const d = dups[0].data as { likely: boolean; mayAffectPrizes: boolean; jobs: unknown[]; competitorId: string };
  assert.equal(d.likely, true);
  assert.equal(d.mayAffectPrizes, true);
  assert.equal(d.competitorId, "u_dana");
  assert.equal(dups[0].key.split(",").length, 2);

  const names = Object.fromEntries(found.filter((c) => c.kind === "identity_name").map((c) => [c.key, c]));
  assert.deepEqual(Object.keys(names).sort(), ["Chicago", "Yuvi"]);
  assert.equal((names.Yuvi.data as { jobs: number }).jobs, 5, "3 + 2 jobs across both weeks");
  assert.deepEqual(names.Yuvi.weeks.sort(), [W1, W2]);
  assert.equal((names.Chicago.data as { suggestedCategory: string }).suggestedCategory, "location_pool");
  assert.equal((names.Yuvi.data as { suggestedCategory: string | null }).suggestedCategory, null, "never guessed from similarity");

  const display = found.filter((c) => c.kind === "display_name");
  assert.deepEqual(display.map((c) => c.key), ["u_dana"], "Yuval German is already English");
});

test("detect: decisions in force are not flagged again", () => {
  const found = detectCases({
    ...base,
    weeks: weeks(),
    overrides: [
      { crmName: "Yuvi", competitorId: "u_yuval", reason: "same person", by: "o", at: "t" },
      { crmName: "Chicago", competitorId: null, reason: "location_pool: pool", by: "o", at: "t" },
    ],
    displayNames: { u_dana: "Dana Cohen" },
  });
  assert.deepEqual(found.filter((c) => c.kind !== "duplicate_group"), []);
});

test("decisions reach the engine exactly as intended, and never touch the official KPIs", () => {
  const [w1] = weeks();
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.mostImproved.enabled = false;
  const run = (opts: { overrides?: never[] | { crmName: string; competitorId: string | null; reason: string; by: string; at: string }[]; exclusions?: { jobId: string; kind: "duplicate"; reason: string; by: string; at: string }[]; dismissed?: string[] }) => {
    const names = [...new Set(w1.jobs.map((j) => j.tech))];
    const map = buildCompetitorMap({ mappings, technicians, crmNamesInUse: names, overrides: opts.overrides as never, displayNames: { u_dana: "Dana Cohen" } });
    return computeCompetition({ rules, rulesHash: rulesHash(rules), weekStart: W1, competitors: map, jobs: w1.jobs, exclusions: opts.exclusions, dismissedDuplicateGroups: opts.dismissed });
  };
  const before = run({});
  const dana0 = before.results.find((r) => r.competitorId === "u_dana")!;
  assert.equal(dana0.displayName, "Dana Cohen");

  // excluding the duplicate removes it from the qualifying count only
  const dupJobs = w1.jobs.filter((j) => j.dupKeys.length).map((j) => j.id);
  const ex = run({ exclusions: [{ jobId: dupJobs[1], kind: "duplicate", reason: "dup", by: "o", at: "t" }] });
  const dana1 = ex.results.find((r) => r.competitorId === "u_dana")!;
  assert.equal(dana1.qualifyingJobs, dana0.qualifyingJobs - 1);
  assert.equal(dana1.closingRate, dana0.closingRate, "official CR unchanged; the CRM fix changes it");
  assert.equal(dana1.avgTicket, dana0.avgTicket, "official AVG unchanged");
  assert.equal(dana1.assignedJobs, dana0.assignedJobs);

  // dismissing the group clears the prize-blocking flag
  assert.ok(before.duplicateGroups.some((g) => g.mayAffectPrizes));
  const dis = run({ dismissed: [[...dupJobs].sort().join(",")] });
  assert.ok(!dis.duplicateGroups.some((g) => g.mayAffectPrizes));

  // attaching the alias merges Yuvi's jobs into Yuval; a pool decision keeps it out
  const att = run({ overrides: [{ crmName: "Yuvi", competitorId: "u_yuval", reason: "same", by: "o", at: "t" }, { crmName: "Chicago", competitorId: null, reason: "pool", by: "o", at: "t" }] });
  const y0 = before.results.find((r) => r.competitorId === "u_yuval")!;
  const y1 = att.results.find((r) => r.competitorId === "u_yuval")!;
  assert.equal(y1.assignedJobs, y0.assignedJobs + 3);
  assert.equal(att.results.length, 2, "only mapped individuals compete");
});

test("the Arena database must be named and must not be the CRM's", () => {
  assert.throws(() => arenaDbName({}), ArenaEnvError);
  assert.throws(() => arenaDbName({ ARENA_MONGODB_DB: "ag" }), /must not be the CRM/);
  assert.throws(() => arenaDbName({ ARENA_MONGODB_DB: "AG" }), /must not be the CRM/);
  assert.throws(() => arenaDbName({ ARENA_MONGODB_DB: "crm_prod", MONGODB_DB: "crm_prod" }), /must not be the CRM/);
  assert.throws(() => arenaDbName({ ARENA_MONGODB_DB: "bad name!" }), /valid/);
  assert.equal(arenaDbName({ ARENA_MONGODB_DB: "arena_dev" }), "arena_dev");
});
