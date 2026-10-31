import { test } from "node:test";
import assert from "node:assert/strict";
import { editDistance, formatPublicName, resolvePublicNames, type RosterPerson } from "./display-name.ts";
import { buildCompetitorMap } from "./identity.ts";
import { computeCompetition } from "./engine.ts";
import { SEED_STANDARD_WEEK, cloneRules, rulesHash } from "./config.ts";
import { detectCases } from "./detect.ts";
import type { ArenaJob } from "./types.ts";

const names = (people: RosterPerson[], overrides: Record<string, string> = {}) =>
  Object.fromEntries([...resolvePublicNames(people, overrides).values()].map((r) => [r.id, r.displayName]));
const get = (people: RosterPerson[], id: string, overrides: Record<string, string> = {}) => resolvePublicNames(people, overrides).get(id)!;

// ── formatter ──────────────────────────────────────────────────────────────

test("format: first name + last initial", () => {
  assert.equal(formatPublicName("Yuval Mizrahi"), "Yuval M.");
  assert.equal(formatPublicName("Ann Able"), "Ann A.");
});

test("format: single-word names display as written", () => {
  assert.equal(formatPublicName("Leo"), "Leo");
  assert.equal(formatPublicName("leo"), "leo");
  assert.equal(formatPublicName("  Leo  "), "Leo");
});

test("format: extra spaces are trimmed and collapsed", () => {
  assert.equal(formatPublicName("  Yuval    Mizrahi  "), "Yuval M.");
  assert.equal(formatPublicName("Yuval\t Mizrahi"), "Yuval M.");
});

test("format: lowercase input → first letters capitalised", () => {
  assert.equal(formatPublicName("matan yong"), "Matan Y.");
  assert.equal(formatPublicName("éli bohbot"), "Éli B.");
});

test("format: multi-part / hyphenated last names use the LAST token", () => {
  assert.equal(formatPublicName("Ana de la Cruz"), "Ana C.");
  assert.equal(formatPublicName("Ana Maria Ben David"), "Ana D.");
  assert.equal(formatPublicName("Ana Ben-David"), "Ana B.");
  assert.equal(formatPublicName("Sean O'Brien"), "Sean O.");
});

test("format: Hebrew (non-Latin) cannot be formatted", () => {
  assert.equal(formatPublicName("דנה לוי"), null);
  assert.equal(formatPublicName("Dana לוי"), null);
  assert.equal(formatPublicName(""), null);
  assert.equal(formatPublicName(null), null);
});

test("Hebrew full name → CRM (English) name, flagged needs English", () => {
  const r = get([{ id: "u1", fullName: "דנה לוי", crmNames: ["Dana L"] }], "u1");
  assert.equal(r.displayName, "Dana L.");
  assert.equal(r.source, "crm_fallback");
  assert.equal(r.needsEnglish, true);
  const raw = get([{ id: "u1", fullName: "דנה לוי", crmNames: ["דנה"] }], "u1");
  assert.equal(raw.displayName, "דנה לוי", "no English name anywhere → the raw name");
  assert.equal(raw.source, "raw");
  assert.equal(raw.needsEnglish, true);
});

test("override wins verbatim (not reformatted) and clears needs-English", () => {
  const people = [{ id: "u1", fullName: "דנה לוי", crmNames: ["Dana L"] }, { id: "u2", fullName: "yuval mizrahi" }];
  const r = resolvePublicNames(people, { u1: "Dana Cohen", u2: "the yuval" });
  assert.equal(r.get("u1")!.displayName, "Dana Cohen");
  assert.equal(r.get("u1")!.needsEnglish, false);
  assert.equal(r.get("u2")!.displayName, "the yuval");
  assert.equal(r.get("u2")!.source, "override");
});

// ── collisions (real production pairs, fictional ids) ─────────────────────

test("collision: Eli Berman vs Eli Bohbot → Eli Be. / Eli Bo.", () => {
  const people = [{ id: "c_eli_1", fullName: "Eli Berman" }, { id: "c_eli_2", fullName: "Eli Bohbot" }, { id: "c_x", fullName: "Eli Cohen" }];
  const r = resolvePublicNames(people);
  assert.equal(r.get("c_eli_1")!.displayName, "Eli Be.");
  assert.equal(r.get("c_eli_2")!.displayName, "Eli Bo.");
  assert.equal(r.get("c_eli_1")!.collision, "prefix");
  assert.equal(r.get("c_x")!.displayName, "Eli C.", "only the colliding people are lengthened");
  assert.equal(r.get("c_x")!.collision, null);
  assert.deepEqual(r.get("c_eli_1")!.possibleDuplicateOf, [], "Berman/Bohbot are far apart: no duplicate hint");
});

test("collision: Matan yong vs Matan young → Matan Yon. / Matan You. + possible-duplicate hint", () => {
  const people = [{ id: "c_matan_a", fullName: "Matan yong" }, { id: "c_matan_b", fullName: "Matan young" }];
  const r = resolvePublicNames(people);
  assert.equal(r.get("c_matan_a")!.displayName, "Matan Yon.");
  assert.equal(r.get("c_matan_b")!.displayName, "Matan You.");
  assert.deepEqual(r.get("c_matan_a")!.possibleDuplicateOf, ["c_matan_b"]);
  assert.deepEqual(r.get("c_matan_b")!.possibleDuplicateOf, ["c_matan_a"]);
});

test("collision: three-way resolves each member at its own shortest unique prefix", () => {
  const r = names([{ id: "a", fullName: "Eli Berman" }, { id: "b", fullName: "Eli Bergman" }, { id: "c", fullName: "Eli Bohbot" }]);
  assert.deepEqual(r, { a: "Eli Berm.", b: "Eli Berg.", c: "Eli Bo." });
});

test("collision: case-insensitive", () => {
  const r = names([{ id: "a", fullName: "eli berman" }, { id: "b", fullName: "Eli Bohbot" }]);
  assert.deepEqual(r, { a: "Eli Be.", b: "Eli Bo." });
});

test("collision: identical first + last → location appended", () => {
  const r = resolvePublicNames([
    { id: "m1", fullName: "Matan Yosef", location: "Chicago" },
    { id: "m2", fullName: "matan yosef", location: "Columbus" },
  ]);
  assert.equal(r.get("m1")!.displayName, "Matan Y. · Chicago");
  assert.equal(r.get("m2")!.displayName, "Matan Y. · Columbus");
  assert.equal(r.get("m1")!.collision, "location");
});

test("collision: still identical after the location → blocking (override needed); an override resolves it", () => {
  const people = [
    { id: "m1", fullName: "Matan Yosef", location: "Chicago" },
    { id: "m2", fullName: "Matan Yosef", location: "Chicago" },
  ];
  const r = resolvePublicNames(people);
  assert.equal(r.get("m1")!.collision, "unresolved");
  assert.equal(r.get("m2")!.collision, "unresolved");
  const fixed = resolvePublicNames(people, { m2: "Matan Y. (North)" });
  assert.equal(fixed.get("m1")!.displayName, "Matan Y.");
  assert.equal(fixed.get("m1")!.collision, null);
  assert.equal(fixed.get("m2")!.displayName, "Matan Y. (North)");
});

test("collision: an override equal to someone's formatted name is flagged, never silently shared", () => {
  const r = resolvePublicNames([{ id: "a", fullName: "Ann Able" }, { id: "b", fullName: "Bea Bond" }], { b: "ann a." });
  assert.equal(r.get("a")!.collision, "unresolved");
  assert.equal(r.get("b")!.collision, "unresolved");
});

test("determinism: same names for any input order", () => {
  const people: RosterPerson[] = [
    { id: "c_eli_2", fullName: "Eli Bohbot" }, { id: "c_matan_b", fullName: "Matan young" }, { id: "c_eli_1", fullName: "Eli Berman" },
    { id: "c_matan_a", fullName: "Matan yong" }, { id: "m1", fullName: "Sam Lee", location: "Chicago" }, { id: "m2", fullName: "Sam Lee", location: "Ohio" },
  ];
  const want = names(people);
  for (let i = 0; i < 20; i++) {
    const shuffled = [...people].sort(() => Math.sin(i * 7919 + people.length) - 0.5 + Math.random() - 0.5);
    assert.deepEqual(names(shuffled), want);
  }
  assert.deepEqual(Object.keys(want), [...Object.keys(want)].sort(), "output is sorted by canonical id");
});

test("editDistance (capped)", () => {
  assert.equal(editDistance("matan yong", "matan young"), 1);
  assert.equal(editDistance("eli berman", "eli bohbot"), 3);
  assert.equal(editDistance("abc", "abc"), 0);
});

// ── identity + engine: names never move ranks or scores ──────────────────

const WEEK = "2026-11-02";
let seq = 0;
const job = (tech: string, status: string, profit: number): ArenaJob => ({
  id: `j${String(++seq).padStart(6, "0")}`, tech, date: WEEK, status, location: "Chicago", profit, dupKeys: [],
});
const MAPPINGS = [
  { supabaseUserId: "c_eli_1", supabaseFullName: "Eli Berman", crmTechNames: ["Eli B"] },
  { supabaseUserId: "c_eli_2", supabaseFullName: "Eli Bohbot", crmTechNames: ["Eli Bo"] },
  { supabaseUserId: "c_matan_a", supabaseFullName: "Matan yong", crmTechNames: ["Matan"] },
  { supabaseUserId: "c_matan_b", supabaseFullName: "Matan young", crmTechNames: ["Matan Y"] },
  { supabaseUserId: "c_dana", supabaseFullName: "דנה לוי", crmTechNames: ["Dana L"] },
];
const TECHS = MAPPINGS.flatMap((m) => m.crmTechNames.map((n) => ({ _id: n, location: "Chicago" })));
const JOBS = MAPPINGS.flatMap((m, i) => [
  ...Array.from({ length: 12 }, () => job(m.crmTechNames[0], "Closed", 900 + 37 * i)),
  ...Array.from({ length: 6 + i }, () => job(m.crmTechNames[0], "Estimate", 0)),
]);

test("identity: competitors get the public name; legacy FULL_NAME_V0 reproduces old names", () => {
  const map = buildCompetitorMap({ mappings: MAPPINGS, technicians: TECHS, crmNamesInUse: MAPPINGS.map((m) => m.crmTechNames[0]) });
  assert.equal(map.nameFormat, "FIRST_LAST_INITIAL_V1");
  assert.deepEqual(Object.fromEntries(map.competitors.map((c) => [c.id, c.displayName])), {
    c_dana: "Dana L.", c_eli_1: "Eli Be.", c_eli_2: "Eli Bo.", c_matan_a: "Matan Yon.", c_matan_b: "Matan You.",
  });
  const legacy = buildCompetitorMap({ mappings: MAPPINGS, technicians: TECHS, crmNamesInUse: MAPPINGS.map((m) => m.crmTechNames[0]), nameFormat: "FULL_NAME_V0" });
  assert.deepEqual(legacy.competitors.map((c) => c.displayName), ["דנה לוי", "Eli Berman", "Eli Bohbot", "Matan yong", "Matan young"]);
});

test("identity: a person's name is resolved against everyone, so it is the same in a week they compete alone", () => {
  const solo = buildCompetitorMap({ mappings: MAPPINGS, technicians: TECHS, crmNamesInUse: ["Eli B"] });
  assert.equal(solo.competitors[0].displayName, "Eli Be.");
});

test("engine: ranks, scores, prizes and every other field are identical under either name format", () => {
  const rules = cloneRules(SEED_STANDARD_WEEK);
  const crmNamesInUse = MAPPINGS.map((m) => m.crmTechNames[0]);
  const accounts = Object.fromEntries(MAPPINGS.map((m) => [m.supabaseUserId, { state: "eligible" as const, checkedAt: "2026-11-08T12:00:00.000Z" }]));
  const run = (nameFormat?: "FULL_NAME_V0") =>
    computeCompetition({
      rules, rulesHash: rulesHash(rules), weekStart: WEEK, jobs: JOBS, accounts,
      competitors: buildCompetitorMap({ mappings: MAPPINGS, technicians: TECHS, crmNamesInUse, nameFormat }),
    });
  const now = run(), old = run("FULL_NAME_V0");
  assert.equal(now.displayNameFormat, "FIRST_LAST_INITIAL_V1");
  assert.equal(old.displayNameFormat, "FULL_NAME_V0");
  const strip = (r: typeof now) => ({ ...r, displayNameFormat: undefined, results: r.results.map((x) => ({ ...x, displayName: undefined })) });
  assert.deepEqual(strip(now), strip(old));
  assert.ok(now.results.some((x) => x.prizeCents > 0), "the fixture actually awards prizes");
});

test("detect: needs-English and unresolved collisions become display-name cases; resolved collisions do not", () => {
  const twins = [...MAPPINGS, { supabaseUserId: "c_twin", supabaseFullName: "Eli Berman", crmTechNames: ["Eli Twin"] }];
  const techs = [...TECHS, { _id: "Eli Twin", location: "Chicago" }];
  const jobs = [...JOBS, job("Eli Twin", "Closed", 900)];
  const cases = detectCases({
    weeks: [{ weekStart: WEEK, jobs }], mappings: twins, technicians: techs, rules: SEED_STANDARD_WEEK, overrides: [], displayNames: {}, exclusions: [],
  }).filter((c) => c.kind === "display_name");
  assert.deepEqual(cases.map((c) => [c.key, (c.data as { reason: string }).reason]), [
    ["c_dana", "needs_english"], ["c_eli_1", "name_collision"], ["c_twin", "name_collision"],
  ]);
});
