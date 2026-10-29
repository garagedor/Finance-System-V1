import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ArenaAuthorizationError,
  ArenaStateError,
  activateCompetition,
  amendActiveRules,
  assertMayApprove,
  cancelCompetition,
  createCompetition,
  initSettings,
  rulesFor,
  saveTemplate,
  scheduleCompetition,
  suspendCompetition,
  updateDraftRules,
  updateSettings,
  type StoreContext,
} from "./config-store.ts";
import { ArenaConfigError, SEED_STANDARD_WEEK, cloneRules, validateRules } from "./config.ts";
import { KNOWN_STATUSES } from "../status-canonical.ts";
import { memoryStore } from "./testing/memory-collection.ts";

const OWNER = "owner-1";
const ADMIN = "admin-2";

async function setup(now = "2026-10-29T15:00:00Z") {
  let t = new Date(now);
  let n = 0;
  const ctx: StoreContext = {
    store: memoryStore(),
    knownStatuses: KNOWN_STATUSES,
    now: () => t,
    newId: (p) => `${p}_${++n}`,
  };
  await initSettings(ctx, { budgetCeilingCents: 150_000, ownerUserId: OWNER, approverUserIds: [OWNER] }, OWNER);
  await saveTemplate(ctx, { templateId: "standard", name: "Standard Week", rules: SEED_STANDARD_WEEK }, OWNER);
  return { ctx, setNow: (iso: string) => (t = new Date(iso)), store: ctx.store as ReturnType<typeof memoryStore> };
}

test("seed template validates against the live CRM status list and the $1,500 ceiling", () => {
  assert.deepEqual(validateRules(SEED_STANDARD_WEEK, { knownStatuses: KNOWN_STATUSES, ceilingCents: 150_000 }), []);
});

test("budget: prizes over the weekly budget are rejected at save", async () => {
  const { ctx } = await setup();
  const r = cloneRules(SEED_STANDARD_WEEK);
  r.prizes.positionsCents[0] += 1; // $1,500.01 total
  await assert.rejects(saveTemplate(ctx, { templateId: "x", name: "x", rules: r }, ADMIN), ArenaConfigError);
  await assert.rejects(createCompetition(ctx, "2026-11-02", { rules: r }, ADMIN), ArenaConfigError);
});

test("budget: a weekly budget above the owner ceiling is rejected; only the owner can raise the ceiling", async () => {
  const { ctx } = await setup();
  const r = cloneRules(SEED_STANDARD_WEEK);
  r.prizes.budgetCents = 200_000;
  r.prizes.positionsCents = [100_000, 50_000, 25_000];
  await assert.rejects(createCompetition(ctx, "2026-11-02", { rules: r }, ADMIN), /exceeds the owner's ceiling/);
  await assert.rejects(updateSettings(ctx, { budgetCeilingCents: 200_000 }, ADMIN, "bigger week"), ArenaAuthorizationError);
  await assert.rejects(updateSettings(ctx, { budgetCeilingCents: 200_000 }, OWNER, "  "), ArenaConfigError);
  await updateSettings(ctx, { budgetCeilingCents: 200_000 }, OWNER, "holiday bonus week");
  await createCompetition(ctx, "2026-11-02", { rules: r }, ADMIN);
});

test("budget: lowering the ceiling blocks scheduling/activating a competition that no longer fits", async () => {
  const { ctx, setNow } = await setup();
  await createCompetition(ctx, "2026-11-02", { template: "standard" }, ADMIN);
  await updateSettings(ctx, { budgetCeilingCents: 100_000 }, OWNER, "tighter budget");
  await assert.rejects(scheduleCompetition(ctx, "arena_2026-11-02", ADMIN), /exceeds the owner's ceiling/);
  setNow("2026-11-02T05:00:00Z");
  await assert.rejects(activateCompetition(ctx, "arena_2026-11-02", OWNER), ArenaStateError);
});

test("versions: editing a draft creates a new version and keeps the old one", async () => {
  const { ctx, store } = await setup();
  await createCompetition(ctx, "2026-11-02", { template: "standard" }, ADMIN);
  const r = cloneRules(SEED_STANDARD_WEEK);
  r.eligibility.minQualifyingJobs = 12;
  const v2 = await updateDraftRules(ctx, "arena_2026-11-02", r, ADMIN);
  assert.equal(v2.n, 2);
  assert.equal(store.ruleVersions.docs.length, 2);
  assert.equal((store.ruleVersions.docs[0] as { rules: typeof r }).rules.eligibility.minQualifyingJobs, 10);
  assert.equal((await rulesFor(ctx, "arena_2026-11-02")).rules.eligibility.minQualifyingJobs, 12);
});

test("templates are versioned; copy-previous-week and future weeks with different configs", async () => {
  const { ctx, store } = await setup();
  const r = cloneRules(SEED_STANDARD_WEEK);
  r.prizes.positionsCents = [60_000, 40_000, 25_000];
  await saveTemplate(ctx, { templateId: "standard", name: "Standard Week", rules: r }, OWNER);
  assert.equal(store.templates.docs.length, 2);
  assert.equal(store.templates.docs.filter((d: { current: boolean }) => d.current).length, 1);

  await createCompetition(ctx, "2026-11-02", { template: "standard" }, ADMIN);
  await createCompetition(ctx, "2026-11-09", { copyPreviousWeek: true }, ADMIN);
  const other = cloneRules(SEED_STANDARD_WEEK);
  other.eligibility.minQualifyingJobs = 8;
  await createCompetition(ctx, "2026-11-16", { rules: other }, ADMIN);
  assert.deepEqual((await rulesFor(ctx, "arena_2026-11-09")).rules.prizes.positionsCents, [60_000, 40_000, 25_000]);
  assert.equal((await rulesFor(ctx, "arena_2026-11-16")).rules.eligibility.minQualifyingJobs, 8);
  await assert.rejects(createCompetition(ctx, "2026-11-02", { template: "standard" }, ADMIN), ArenaStateError);
  await assert.rejects(createCompetition(ctx, "2026-11-03", { template: "standard" }, ADMIN), /Monday/);
});

test("active competition: normal edits refused; locked rule version unchanged", async () => {
  const { ctx, setNow, store } = await setup();
  await createCompetition(ctx, "2026-11-02", { template: "standard" }, ADMIN);
  await scheduleCompetition(ctx, "arena_2026-11-02", ADMIN);
  setNow("2026-11-02T04:59:59Z"); // Sunday 23:59:59 EST — too early
  await assert.rejects(activateCompetition(ctx, "arena_2026-11-02", OWNER), /before Monday/);
  setNow("2026-11-02T05:00:00Z"); // Monday 00:00 EST
  await assert.rejects(activateCompetition(ctx, "arena_2026-11-02", ADMIN), ArenaAuthorizationError); // admins prepare, the owner starts
  await activateCompetition(ctx, "arena_2026-11-02", OWNER);
  const before = JSON.stringify(store.ruleVersions.docs);
  const r = cloneRules(SEED_STANDARD_WEEK);
  r.eligibility.minQualifyingJobs = 5;
  await assert.rejects(updateDraftRules(ctx, "arena_2026-11-02", r, ADMIN), /locked/);
  assert.equal(JSON.stringify(store.ruleVersions.docs), before);
});

test("amendment: owner + reason only, new version, participant notice, audit row", async () => {
  const { ctx, setNow, store } = await setup();
  await createCompetition(ctx, "2026-11-02", { template: "standard" }, ADMIN);
  await scheduleCompetition(ctx, "arena_2026-11-02", ADMIN);
  setNow("2026-11-02T05:00:00Z");
  await activateCompetition(ctx, "arena_2026-11-02", OWNER);
  const r = cloneRules(SEED_STANDARD_WEEK);
  r.eligibility.minQualifyingJobs = 8;
  await assert.rejects(amendActiveRules(ctx, "arena_2026-11-02", r, ADMIN, "storm week"), ArenaAuthorizationError);
  await assert.rejects(amendActiveRules(ctx, "arena_2026-11-02", r, OWNER, ""), ArenaConfigError);
  const tz = cloneRules(r);
  tz.timezone = "America/Chicago";
  await assert.rejects(amendActiveRules(ctx, "arena_2026-11-02", tz, OWNER, "x"), /timezone/);
  const { ruleVersion, notice } = await amendActiveRules(ctx, "arena_2026-11-02", r, OWNER, "Storm closed 3 locations Tuesday");
  assert.equal(ruleVersion.source.kind, "amendment");
  assert.equal(notice.message, "Storm closed 3 locations Tuesday");
  assert.equal(store.notices.docs.length, 1);
  assert.ok(store.audit.docs.some((a: { action: string; reason: string }) => a.action === "competition.rules.amend" && a.reason.startsWith("Storm")));
});

test("suspend/cancel: owner-only once started; approved competitions can never change", async () => {
  const { ctx, setNow, store } = await setup();
  await createCompetition(ctx, "2026-11-02", { template: "standard" }, ADMIN);
  await scheduleCompetition(ctx, "arena_2026-11-02", ADMIN);
  setNow("2026-11-02T05:00:00Z");
  await activateCompetition(ctx, "arena_2026-11-02", OWNER);
  await assert.rejects(suspendCompetition(ctx, "arena_2026-11-02", ADMIN, "x"), ArenaAuthorizationError);
  await suspendCompetition(ctx, "arena_2026-11-02", OWNER, "data outage");
  assert.equal(store.notices.docs.length, 1);

  // An approved competition (approval itself is Phase 3) is immutable here.
  await store.competitions.updateOne({ _id: "arena_2026-11-02" }, { $set: { status: "approved" } });
  const r = cloneRules(SEED_STANDARD_WEEK);
  await assert.rejects(updateDraftRules(ctx, "arena_2026-11-02", r, OWNER), ArenaStateError);
  await assert.rejects(amendActiveRules(ctx, "arena_2026-11-02", r, OWNER, "fix"), ArenaStateError);
  await assert.rejects(cancelCompetition(ctx, "arena_2026-11-02", OWNER, "fix"), /never be cancelled/);
});

test("approvers: owner only at launch; Admin role alone is not enough; only the owner edits the list", async () => {
  const { ctx } = await setup();
  await assertMayApprove(ctx, OWNER);
  await assert.rejects(assertMayApprove(ctx, ADMIN), ArenaAuthorizationError);
  await assert.rejects(updateSettings(ctx, { approverUserIds: [OWNER, ADMIN] }, ADMIN, "add me"), ArenaAuthorizationError);
  await updateSettings(ctx, { approverUserIds: [OWNER, ADMIN] }, OWNER, "delegate approvals");
  await assertMayApprove(ctx, ADMIN);
});

test("every configuration action is audited with who/when/before/after", async () => {
  const { ctx, store } = await setup();
  await createCompetition(ctx, "2026-11-02", { template: "standard" }, ADMIN);
  const r = cloneRules(SEED_STANDARD_WEEK);
  r.eligibility.minAvgTicketCents = 45_000;
  await updateDraftRules(ctx, "arena_2026-11-02", r, ADMIN);
  const actions = store.audit.docs.map((a: { action: string }) => a.action);
  assert.deepEqual(actions, ["settings.init", "template.save", "competition.create", "competition.rules.edit"]);
  const edit = store.audit.docs[3] as { by: string; at: string; before: typeof r; after: typeof r };
  assert.equal(edit.by, ADMIN);
  assert.ok(edit.at);
  assert.equal(edit.before.eligibility.minAvgTicketCents, 40_000);
  assert.equal(edit.after.eligibility.minAvgTicketCents, 45_000);
});

test("validation: unknown statuses, bad tie-breaks, bad ranges are rejected", () => {
  const ctx = { knownStatuses: KNOWN_STATUSES, ceilingCents: 150_000 };
  const r = cloneRules(SEED_STANDARD_WEEK);
  r.qualifying.statuses = ["Closed", "Done-ish"];
  r.tieBreak = ["closingRate", "closingRate"];
  r.eligibility.minClosingRateBp = 12_000;
  r.scoring.avgTicket.cap = 0.5;
  r.timezone = "Mars/Olympus";
  const p = validateRules(r, ctx);
  for (const needle of ["Done-ish", "tie-break", "Closing Rate", "cap", "timezone"])
    assert.ok(p.some((x) => x.includes(needle)), `expected a problem mentioning ${needle}: ${p.join(" | ")}`);
});
