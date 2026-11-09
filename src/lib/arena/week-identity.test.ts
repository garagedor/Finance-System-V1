import { test } from "node:test";
import assert from "node:assert/strict";
import { inWeek, serviceDate, weekStartOf, weekWindow } from "./week.ts";
import { buildCompetitorMap } from "./identity.ts";

const REVIEW = { approvalOpensDaysAfterWeekEnd: 1, approvalOpensLocalTime: "12:00" };

test("week: Monday–Sunday inclusive, half-open, one week per day", () => {
  assert.equal(weekStartOf("2026-11-02"), "2026-11-02"); // Monday
  assert.equal(weekStartOf("2026-11-08"), "2026-11-02"); // Sunday belongs to the week that started Monday
  assert.equal(weekStartOf("2026-11-09"), "2026-11-09"); // next Monday starts a new week
  assert.ok(inWeek("2026-11-02", "2026-11-02") && inWeek("2026-11-08", "2026-11-02"));
  assert.ok(!inWeek("2026-11-09", "2026-11-02") && !inWeek("2026-11-01", "2026-11-02"));
});

test("week: New York boundaries are DST-aware (spring and fall)", () => {
  const spring = weekWindow("2026-03-02", "America/New_York", REVIEW); // DST starts Sun 2026-03-08
  assert.equal(spring.startsAt.toISOString(), "2026-03-02T05:00:00.000Z");
  assert.equal(spring.closesAt.toISOString(), "2026-03-09T04:00:00.000Z");
  const fall = weekWindow("2026-10-26", "America/New_York", REVIEW); // DST ends Sun 2026-11-01
  assert.equal(fall.startsAt.toISOString(), "2026-10-26T04:00:00.000Z");
  assert.equal(fall.closesAt.toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(fall.approvalOpensAt.toISOString(), "2026-11-03T17:00:00.000Z"); // Tue 12:00 EST
  assert.throws(() => weekWindow("2026-10-27", "America/New_York", REVIEW), /Monday/);
});

test("service date parses exactly like SRC_DATE_EXPR", () => {
  assert.equal(serviceDate("2026-09-07"), "2026-09-07");
  assert.equal(serviceDate(" 2026-09-07T13:00:00.000Z "), "2026-09-07");
  assert.equal(serviceDate("9/8/2026"), "2026-09-08");
  assert.equal(serviceDate("09/08/2026"), "2026-09-08");
  assert.equal(serviceDate(""), null);
  assert.equal(serviceDate(undefined), null);
  assert.equal(serviceDate("2026-02-30"), null);
  assert.equal(serviceDate("next week"), null);
});

const map = (mappings: { id: string; names: string[] }[], inUse: string[], overrides = []) =>
  buildCompetitorMap({
    mappings: mappings.map((m) => ({ supabaseUserId: m.id, supabaseFullName: m.id, crmTechNames: m.names })),
    technicians: inUse.map((n) => ({ _id: n, location: "Milwaukee" })),
    crmNamesInUse: inUse,
    overrides,
  });

test("identity: aliases merge only through a verified mapping record", () => {
  const m = map([{ id: "u1", names: ["Yuval", "Yuvi"] }], ["Yuval", "Yuvi"]);
  assert.equal(m.competitors.length, 1);
  assert.deepEqual(m.competitors[0].crmNames, ["Yuval", "Yuvi"]);
  assert.equal(m.issues.length, 0);
});

test("identity: similar names are never merged by similarity", () => {
  const m = map([{ id: "u1", names: ["Bar"] }], ["Bar", "Barak", "Bar K"]);
  assert.equal(m.byCrmName.get("Bar"), "u1");
  assert.equal(m.byCrmName.has("Barak"), false);
  assert.equal(m.byCrmName.has("Bar K"), false);
  assert.deepEqual(m.issues.map((i) => [i.crmName, i.kind, i.blocking]), [
    ["Bar K", "unmapped_name", true],
    ["Barak", "unmapped_name", true],
  ]);
});

test("identity: a name claimed by two people is blocked for manual review", () => {
  const m = map([{ id: "u1", names: ["Ron"] }, { id: "u2", names: ["Ron"] }], ["Ron"]);
  assert.equal(m.byCrmName.has("Ron"), false);
  assert.deepEqual(m.issues[0], { kind: "name_in_multiple_mappings", crmName: "Ron", candidates: ["u1", "u2"], blocking: true });
});

test("identity: trim/case-only differences attach only when unambiguous, and are reported", () => {
  const ok = map([{ id: "u1", names: ["Yanai "] }], ["Yanai"]);
  assert.equal(ok.byCrmName.get("Yanai"), "u1");
  assert.equal(ok.issues[0].kind, "normalized_match");
  assert.equal(ok.issues[0].blocking, false);
  const clash = map([{ id: "u1", names: ["RON"] }], ["Ron", "ron"]);
  assert.equal(clash.byCrmName.size, 0);
  assert.ok(clash.issues.every((i) => i.kind === "normalized_collision" && i.blocking));
});

test("identity: admin overrides attach or block a name explicitly", () => {
  const o = [
    { crmName: "TZVI", competitorId: "u9", reason: "same person", by: "owner", at: "t" },
    { crmName: "Yuvi", competitorId: null, reason: "different person", by: "owner", at: "t" },
  ];
  const m = map([{ id: "u1", names: ["Yuval", "Yuvi"] }, { id: "u9", names: ["Tzvi Cohen"] }], ["TZVI", "Yuvi", "Yuval"], o as never);
  assert.equal(m.byCrmName.get("TZVI"), "u9");
  assert.equal(m.byCrmName.has("Yuvi"), false);
  assert.equal(m.byCrmName.get("Yuval"), "u1");
});
