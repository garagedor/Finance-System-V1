// Run with:  node --test --import ./scripts/test-register.mjs src/lib/dispute-targets.test.ts
//
// "Posted" used to mean terminal. One dispute, one ledger entry, and the
// second target was not merely refused — the service found the existing entry
// by dispute_id and UPDATED it, so posting the provider share silently moved
// the Area Manager's charge onto the provider's ledger and the AM charge
// disappeared. That is the failure these tests exist to make impossible.
//
// Everything here is pure. Coverage is derived from ledger entries, so a
// posting made from the Provider Ledger screen is indistinguishable from one
// made in the inbox — which is the point, and why G and H below are real
// tests rather than wiring diagrams.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POSTING_TARGETS, TARGET_LABEL, amountForTarget, canPost, covers,
  resolveCoverage, targetOfEntry,
  type CoverageContext, type PostedEntryView, type PostingTarget,
} from "./dispute-targets.ts";
import { computeDisputeAllocation } from "./dispute-share.ts";

/* ── Fixtures ────────────────────────────────────────────────────────── */

/** Slices from the real engine, so the amounts under test are the real ones. */
const SNAP = (() => {
  const a = computeDisputeAllocation({
    jobAmount: 1000, grossTip: 100, partsCost: 150, disputeAmount: 1100,
    technicianPercent: 30, providerPercent: 20, areaManagerPoolPercent: 40,
  });
  return {
    technicianPortion: a.technicianPortion,
    areaManagerOwnPortion: a.areaManagerOwnPortion,
    providerCharge: a.providerCharge,
    amLedgerCharge: a.amLedgerCharge,
  };
})();

const FULL_CTX: CoverageContext = { hasProvider: true, hasAreaManager: true, hasTechnician: true };

/** A ledger entry exactly as either flow writes it. */
function entry(target: PostingTarget | null, over: Partial<PostedEntryView> = {}): PostedEntryView {
  return {
    _id: `len_${target ?? "legacy"}`,
    ledger_id: `ldg_${target ?? "am"}`,
    posted_party: target,
    amount: target ? amountForTarget(SNAP, target) : SNAP.amLedgerCharge,
    date: "2026-10-01",
    created_at: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

const cover = (entries: PostedEntryView[], reversedIds: string[] = [], ctx = FULL_CTX) =>
  resolveCoverage({ snapshot: SNAP, entries, reversedEntryIds: reversedIds, context: ctx });

const row = (c: ReturnType<typeof cover>, t: PostingTarget) => c.targets.find((x) => x.target === t)!;

/* ── The model itself ────────────────────────────────────────────────── */

test("every target has a label and an amount from the locked formula", () => {
  for (const t of POSTING_TARGETS) {
    assert.ok(TARGET_LABEL[t], `${t} has no label`);
    assert.equal(typeof amountForTarget(SNAP, t), "number");
  }
});

test("combined is exactly the two slices it contains", () => {
  // Not a rule this module adds — a property of the engine. If it ever stops
  // holding, the overlap rules below are wrong and this fails first.
  assert.equal(
    Math.round((SNAP.technicianPortion + SNAP.areaManagerOwnPortion) * 100) / 100,
    SNAP.amLedgerCharge,
  );
  assert.equal(amountForTarget(SNAP, "combined"), SNAP.amLedgerCharge);
});

test("only combined covers anything but itself", () => {
  for (const a of POSTING_TARGETS) {
    for (const b of POSTING_TARGETS) {
      const expected = a === b || (a === "combined" && (b === "area_manager" || b === "technician"));
      assert.equal(covers(a, b), expected, `covers(${a}, ${b}) should be ${expected}`);
    }
  }
});

test("an entry with no party is the legacy combined post", () => {
  // Every pre-change posting went through the no-party branch, which charged
  // amLedgerCharge. Reading null as anything else would misreport history.
  assert.equal(targetOfEntry(entry(null)), "combined");
  assert.equal(targetOfEntry(entry("provider")), "provider");
});

/* ── A · post the Area Manager first ─────────────────────────────────── */

test("A · posting the Area Manager puts it in Posted and leaves Provider open", () => {
  const c = cover([entry("area_manager")]);
  assert.equal(c.anyPosted, true, "one posting is enough to be Posted");
  assert.equal(row(c, "area_manager").posted, true);
  assert.equal(row(c, "provider").posted, false);
  assert.equal(row(c, "provider").available, true, "Provider must still be offered");
  assert.ok(c.remaining.includes("provider"));
  assert.equal(canPost(c, "provider").ok, true);
});

/* ── B · provider after AM ───────────────────────────────────────────── */

test("B · posting Provider after the Area Manager leaves both posted, once each", () => {
  const c = cover([entry("area_manager"), entry("provider")]);
  assert.equal(row(c, "area_manager").posted, true);
  assert.equal(row(c, "provider").posted, true);
  assert.equal(row(c, "area_manager").ledgerEntryId, "len_area_manager");
  assert.equal(row(c, "provider").ledgerEntryId, "len_provider");
  assert.notEqual(row(c, "area_manager").ledgerId, row(c, "provider").ledgerId,
    "two targets, two ledgers — the second must not land on the first's");
  assert.equal(c.postedTotal, SNAP.areaManagerOwnPortion + SNAP.providerCharge);
});

/* ── C · provider first ──────────────────────────────────────────────── */

test("C · posting Provider first puts it in Posted and leaves the AM open", () => {
  const c = cover([entry("provider")]);
  assert.equal(c.anyPosted, true);
  assert.equal(row(c, "provider").posted, true);
  assert.equal(row(c, "area_manager").available, true);
  assert.equal(canPost(c, "area_manager").ok, true);
});

/* ── D · AM after provider ───────────────────────────────────────────── */

test("D · posting the Area Manager after Provider leaves both posted", () => {
  const c = cover([entry("provider"), entry("area_manager")]);
  assert.deepEqual(
    c.targets.filter((t) => t.posted).map((t) => t.target).sort(),
    ["area_manager", "provider"],
  );
  assert.equal(c.remaining.includes("provider"), false);
  assert.equal(c.remaining.includes("area_manager"), false);
});

/* ── E · the Area Manager twice ──────────────────────────────────────── */

test("E · a second Area Manager posting is refused, and says why", () => {
  const c = cover([entry("area_manager")]);
  const verdict = canPost(c, "area_manager");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.code, "already_posted");
  assert.match(verdict.ok === false ? verdict.error : "", /already posted/i);
  assert.match(verdict.ok === false ? verdict.error : "", /twice/i);
});

/* ── F · the provider twice ──────────────────────────────────────────── */

test("F · a second Provider posting is refused", () => {
  const c = cover([entry("provider")]);
  const verdict = canPost(c, "provider");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.code, "already_posted");
  assert.equal(row(c, "provider").available, false);
});

test("F2 · duplicate detection keys on the target, not the ledger", () => {
  // The same slice posted to a different ledger is still the same charge to
  // the same party. Keying on ledger_id would let it through twice.
  const c = cover([entry("provider", { ledger_id: "ldg_other", _id: "len_elsewhere" })]);
  assert.equal(canPost(c, "provider").ok, false);
  assert.equal(row(c, "provider").ledgerId, "ldg_other");
});

/* ── G · posted from the Provider Ledger screen ──────────────────────── */

test("G · a Provider entry written by the ledger screen is detected as posted", () => {
  // Coverage reads ledger entries, so an entry created anywhere — the ledger
  // page, a bulk charge, a future integration — counts identically. There is
  // no inbox-only flag that could disagree with it.
  const fromLedgerPage = entry("provider", {
    _id: "len_from_ledger_ui",
    ledger_id: "ldg_provider_acme",
    ledger_name: "Acme Ads",
    ledger_role: "Provider",
    created_at: "2026-10-05T09:00:00.000Z",
  });
  const c = cover([fromLedgerPage]);
  assert.equal(c.anyPosted, true, "the inbox must show Posted without having done the posting");
  assert.equal(row(c, "provider").posted, true);
  assert.equal(row(c, "provider").ledgerName, "Acme Ads");
  assert.equal(canPost(c, "provider").ok, false, "and must not offer it again");
});

/* ── H · posted from the AM Ledger screen ────────────────────────────── */

test("H · an Area Manager entry written by the ledger screen is detected as posted", () => {
  const c = cover([entry("area_manager", { _id: "len_am_ui", ledger_name: "Or" })]);
  assert.equal(row(c, "area_manager").posted, true);
  assert.equal(row(c, "area_manager").ledgerName, "Or");
  assert.equal(canPost(c, "area_manager").ok, false);
  assert.equal(row(c, "provider").available, true, "the other target is untouched");
});

/* ── I · derived from records, never from inbox history ──────────────── */

test("I · coverage is a function of the entries alone", () => {
  // Same entries, no other input: the answer cannot depend on who acted or in
  // what order the UI believes things happened.
  const entries = [entry("provider"), entry("area_manager")];
  const a = cover(entries);
  const b = cover([...entries].reverse());
  assert.deepEqual(
    a.targets.map((t) => [t.target, t.posted, t.available]),
    b.targets.map((t) => [t.target, t.posted, t.available]),
  );
});

test("I2 · no entries means nothing is posted, whatever anything else says", () => {
  const c = cover([]);
  assert.equal(c.anyPosted, false);
  assert.deepEqual(c.targets.filter((t) => t.posted), []);
  assert.deepEqual(c.remaining.sort(), ["area_manager", "combined", "provider", "technician"]);
});

/* ── J · the formulas are untouched ──────────────────────────────────── */

test("J · each target is charged exactly the engine's slice", () => {
  const a = computeDisputeAllocation({
    jobAmount: 1000, grossTip: 100, partsCost: 150, disputeAmount: 1100,
    technicianPercent: 30, providerPercent: 20, areaManagerPoolPercent: 40,
  });
  assert.equal(amountForTarget(SNAP, "technician"), a.technicianPortion);
  assert.equal(amountForTarget(SNAP, "area_manager"), a.areaManagerOwnPortion);
  assert.equal(amountForTarget(SNAP, "provider"), a.providerCharge);
  assert.equal(amountForTarget(SNAP, "combined"), a.amLedgerCharge);
});

test("J2 · nothing here rounds, re-splits or re-derives a share", () => {
  // The module must be a pass-through. Feeding it arbitrary slices returns
  // them unchanged, so it cannot quietly become a second calculation.
  const odd = { technicianPortion: 3.33, areaManagerOwnPortion: 1.11, providerCharge: 0.07, amLedgerCharge: 4.44 };
  assert.equal(amountForTarget(odd, "technician"), 3.33);
  assert.equal(amountForTarget(odd, "area_manager"), 1.11);
  assert.equal(amountForTarget(odd, "provider"), 0.07);
  assert.equal(amountForTarget(odd, "combined"), 4.44);
});

/* ── The overlap that could double-charge ────────────────────────────── */

test("combined blocks the two slices it already charged", () => {
  const c = cover([entry("combined")]);
  assert.equal(c.anyPosted, true);
  for (const t of ["area_manager", "technician"] as const) {
    assert.equal(row(c, t).available, false, `${t} was already charged inside combined`);
    const v = canPost(c, t);
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.code, "covered");
    assert.match(v.ok === false ? v.error : "", /already charged as part of/i);
  }
  assert.equal(row(c, "provider").available, true, "provider is not part of combined");
});

test("a posted slice blocks combined, which would charge it again", () => {
  const c = cover([entry("technician")]);
  const v = canPost(c, "combined");
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, "conflicts");
  assert.match(v.ok === false ? v.error : "", /twice/i);
  assert.equal(row(c, "area_manager").available, true, "the other half is still chargeable");
});

test("a legacy no-party posting blocks the slices it contained", () => {
  // The real migration case: every dispute posted before this change.
  const c = cover([entry(null)]);
  assert.equal(row(c, "combined").posted, true);
  assert.equal(canPost(c, "technician").ok, false);
  assert.equal(canPost(c, "area_manager").ok, false);
  assert.equal(canPost(c, "provider").ok, true, "but the provider was never charged by it");
});

/* ── Eligibility ─────────────────────────────────────────────────────── */

test("a job with no provider does not offer a provider posting", () => {
  const c = cover([], [], { ...FULL_CTX, hasProvider: false });
  assert.equal(row(c, "provider").eligible, false);
  assert.match(row(c, "provider").reason ?? "", /no provider/i);
  assert.equal(canPost(c, "provider").ok, false);
  assert.equal(canPost(c, "provider").ok === false && canPost(c, "provider").code, "not_eligible");
});

test("a zero slice is not offered — a $0.00 ledger line is noise", () => {
  const zero = { technicianPortion: 0, areaManagerOwnPortion: 0, providerCharge: 0, amLedgerCharge: 0 };
  const c = resolveCoverage({ snapshot: zero, entries: [], context: FULL_CTX });
  for (const t of POSTING_TARGETS) {
    assert.equal(row(c, t).eligible, false, `${t} should not be offered at zero`);
    assert.match(row(c, t).reason ?? "", /zero/i);
  }
  assert.deepEqual(c.remaining, []);
});

test("an unassigned Area Manager blocks the AM slice but not the provider", () => {
  const c = cover([], [], { ...FULL_CTX, hasAreaManager: false });
  assert.equal(row(c, "area_manager").eligible, false);
  assert.match(row(c, "area_manager").reason ?? "", /no area manager/i);
  assert.equal(row(c, "provider").available, true);
});

/* ── Reversal: financial truth, not posting history ──────────────────── */

test("a reversed posting is not a posting, and the target reopens", () => {
  // The ledger nets the pair to zero, so the party is not charged. Leaving
  // the target shut would make the system reflect what was done rather than
  // what is owed.
  const e = entry("provider");
  const c = cover([e], [e._id]);
  assert.equal(row(c, "provider").posted, false);
  assert.equal(row(c, "provider").reversed, true);
  assert.equal(row(c, "provider").available, true);
  assert.equal(canPost(c, "provider").ok, true);
  assert.equal(c.anyPosted, false, "a fully reversed item is no longer posted to anything");
});

test("reversing one target leaves the other posted", () => {
  const am = entry("area_manager");
  const pv = entry("provider");
  const c = cover([am, pv], [pv._id]);
  assert.equal(row(c, "area_manager").posted, true);
  assert.equal(row(c, "provider").posted, false);
  assert.equal(c.anyPosted, true, "the item stays in Posted");
  assert.equal(c.postedTotal, SNAP.areaManagerOwnPortion);
});

test("re-posting after a reversal shows the newest live entry", () => {
  const first = entry("provider", { _id: "len_v1", created_at: "2026-10-01T10:00:00.000Z" });
  const second = entry("provider", { _id: "len_v2", ledger_id: "ldg_new", created_at: "2026-10-09T10:00:00.000Z" });
  const c = cover([first, second], [first._id]);
  assert.equal(row(c, "provider").ledgerEntryId, "len_v2");
  assert.equal(row(c, "provider").ledgerId, "ldg_new");
});

/* ── Charged under a sibling record ──────────────────────────────────────
   Before one dispute could hold several postings, charging a second party
   meant creating a second finance_dispute from a ledger page. Production
   carries 24 jobs shaped that way — typically the Area Manager on the record
   the inbox knows about and the provider on a sibling, same job, same
   amount. Per-record coverage cannot see the sibling, so without this guard
   the Posted tab would offer a provider charge that already exists. Measured
   at 17 live items before the guard was added.                            */

const sibling = (target: PostingTarget, recordId = "disp_sibling") => ({ target, recordId });

test("a party charged on a sibling record is not offered again", () => {
  const c = resolveCoverage({
    snapshot: SNAP,
    entries: [entry("area_manager")],
    context: { ...FULL_CTX, chargedElsewhere: [sibling("provider")] },
  });
  assert.equal(row(c, "provider").available, false, "the provider is already charged, on another record");
  assert.equal(row(c, "provider").chargedElsewhere, "disp_sibling");
  assert.match(row(c, "provider").reason ?? "", /separate record/i);
});

test("the sibling is never claimed as this record's own posting", () => {
  // Overstating it would be the opposite error: the Posted tab would show a
  // charge this record does not carry, and reversing it from here would miss.
  const c = resolveCoverage({
    snapshot: SNAP, entries: [],
    context: { ...FULL_CTX, chargedElsewhere: [sibling("provider")] },
  });
  assert.equal(row(c, "provider").posted, false);
  assert.equal(row(c, "provider").ledgerEntryId, null);
  assert.equal(c.anyPosted, false, "nothing is posted on THIS record");
});

test("the write path refuses it with a code of its own", () => {
  const c = resolveCoverage({
    snapshot: SNAP, entries: [],
    context: { ...FULL_CTX, chargedElsewhere: [sibling("provider", "disp_mukeobq2ky6sbstz")] },
  });
  const v = canPost(c, "provider");
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, "charged_elsewhere");
  assert.match(v.ok === false ? v.error : "", /disp_mukeobq2ky6sbstz/,
    "the refusal must name the record to go and look at");
});

test("a sibling blocks the overlapping targets too, in both directions", () => {
  // A sibling that charged `combined` already covered the technician and the
  // Area Manager; a sibling that charged the technician makes `combined`
  // unsafe, because combined contains it.
  const viaCombined = resolveCoverage({
    snapshot: SNAP, entries: [],
    context: { ...FULL_CTX, chargedElsewhere: [sibling("combined")] },
  });
  for (const t of ["area_manager", "technician", "combined"] as const) {
    assert.equal(row(viaCombined, t).available, false, `${t} is inside the sibling's combined charge`);
  }
  assert.equal(row(viaCombined, "provider").available, true);

  const viaTech = resolveCoverage({
    snapshot: SNAP, entries: [],
    context: { ...FULL_CTX, chargedElsewhere: [sibling("technician")] },
  });
  assert.equal(row(viaTech, "combined").available, false, "combined would charge the technician twice");
  assert.equal(row(viaTech, "area_manager").available, true, "the other half is untouched");
});

test("no sibling means nothing is blocked", () => {
  const c = resolveCoverage({ snapshot: SNAP, entries: [], context: { ...FULL_CTX, chargedElsewhere: [] } });
  assert.deepEqual(c.remaining.sort(), ["area_manager", "combined", "provider", "technician"]);
  for (const t of POSTING_TARGETS) assert.equal(row(c, t).chargedElsewhere, null);
});

test("the production shape: AM here, provider on a sibling", () => {
  // Exactly the 17 items the audit found, as the resolver sees them.
  const c = resolveCoverage({
    snapshot: SNAP,
    entries: [entry(null, { _id: "len_legacy_am" })].map((e) => ({ ...e, posted_party: "area_manager" as const })),
    context: { ...FULL_CTX, chargedElsewhere: [sibling("provider", "disp_mukeobq2ky6sbstz")] },
  });
  assert.equal(row(c, "area_manager").posted, true, "this record carries the AM charge");
  assert.equal(row(c, "provider").available, false, "and the provider is already charged elsewhere");
  assert.deepEqual(c.remaining, ["technician"], "only the genuinely uncharged slice is offered");
});

/* ── Historical evidence: POSTED / UNPOSTED / REVIEW_REQUIRED ────────────
   Production carries items marked charged with no posting linked to them.
   The mark is written both by a real ledger charge and by the manual "Mark
   charged" toggle, and after the fact the two are identical — so the only
   honest answer is "we do not know", and the only safe one is to refuse.  */

const chargedFlag = (detail = "inbox item DS-1 was marked charged on 2026-09-27 with no posting linked to it") =>
  ({ kind: "charged_flag" as const, detail });
const attempted = (detail = "record disp_x exists for this job and amount with no live ledger entry") =>
  ({ kind: "attempted_charge" as const, detail });

test("chargedAt with no linked posting blocks every target", () => {
  const c = resolveCoverage({
    snapshot: SNAP, entries: [],
    context: { ...FULL_CTX, historicalEvidence: [chargedFlag()] },
  });
  assert.equal(c.reviewRequired, true);
  assert.deepEqual(c.remaining, [], "nothing may be posted while this is unresolved");
  for (const t of POSTING_TARGETS) {
    assert.equal(row(c, t).state, "REVIEW_REQUIRED", `${t} should be under review`);
    const v = canPost(c, t);
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.code, "review_required");
  }
});

test("an attempted charge with no live entry blocks every target too", () => {
  const c = resolveCoverage({
    snapshot: SNAP, entries: [],
    context: { ...FULL_CTX, historicalEvidence: [attempted()] },
  });
  assert.equal(c.reviewRequired, true);
  assert.deepEqual(c.remaining, []);
});

test("the review reason names what to go and look at", () => {
  const c = resolveCoverage({
    snapshot: SNAP, entries: [],
    context: { ...FULL_CTX, historicalEvidence: [chargedFlag("inbox item DS-1785301316-182 was marked charged on 2026-09-27 with no posting linked to it")] },
  });
  assert.match(row(c, "provider").reviewReason ?? "", /DS-1785301316-182/);
  assert.deepEqual(c.evidence.map((e) => e.kind), ["charged_flag"]);
});

test("an exact linked posting reads POSTED, not under review", () => {
  // Knowledge beats suspicion: we know this target is charged and where.
  const c = resolveCoverage({
    snapshot: SNAP, entries: [entry("area_manager")],
    context: { ...FULL_CTX, historicalEvidence: [chargedFlag()] },
  });
  assert.equal(row(c, "area_manager").state, "POSTED");
  assert.equal(row(c, "area_manager").ledgerEntryId, "len_area_manager");
  assert.equal(canPost(c, "area_manager").ok === false && canPost(c, "area_manager").code, "already_posted");
  // …while everything it does not account for stays under review.
  assert.equal(row(c, "provider").state, "REVIEW_REQUIRED");
});

test("nothing posted and no evidence reads UNPOSTED", () => {
  const c = cover([]);
  for (const t of POSTING_TARGETS) assert.equal(row(c, t).state, "UNPOSTED");
  assert.equal(c.reviewRequired, false);
  assert.deepEqual(c.evidence, []);
});

test("an ineligible target is UNPOSTED, not under review", () => {
  // It is not posted and nothing suggests it was; it simply cannot be
  // charged. Calling that "review required" would send people looking for a
  // posting that never existed.
  const c = cover([], [], { ...FULL_CTX, hasProvider: false });
  assert.equal(row(c, "provider").state, "UNPOSTED");
  assert.equal(row(c, "provider").available, false);
  assert.equal(c.reviewRequired, false);
});

test("a sibling charge is REVIEW_REQUIRED, never POSTED", () => {
  // The false-merge guard. Two records on one job with the same amount may
  // be one dispute written twice — or two real disputes from different
  // sources. Blocking is right either way; claiming this record carries the
  // sibling's charge is wrong in the second case and would make the Posted
  // tab lie about which entry to reverse.
  const c = resolveCoverage({
    snapshot: SNAP, entries: [],
    context: { ...FULL_CTX, chargedElsewhere: [sibling("provider", "disp_other_source")] },
  });
  assert.equal(row(c, "provider").state, "REVIEW_REQUIRED");
  assert.equal(row(c, "provider").posted, false, "it is not posted HERE");
  assert.equal(row(c, "provider").ledgerEntryId, null, "and this record has no entry to show");
  assert.equal(c.anyPosted, false);
  assert.equal(c.postedTotal, 0, "a sibling's money is not counted as this record's");
});

test("a reversal reopens only the target it reversed", () => {
  const am = entry("area_manager");
  const pv = entry("provider");
  const c = cover([am, pv], [pv._id]);
  assert.equal(row(c, "provider").state, "UNPOSTED", "reversed, so chargeable again");
  assert.equal(row(c, "provider").available, true);
  assert.equal(row(c, "area_manager").state, "POSTED", "untouched by the other's reversal");
  assert.equal(canPost(c, "area_manager").ok, false);
});

test("evidence does not resurrect a reversed posting", () => {
  // A reversed charge plus an unresolved mark is still "someone must look".
  const pv = entry("provider");
  const c = resolveCoverage({
    snapshot: SNAP, entries: [pv], reversedEntryIds: [pv._id],
    context: { ...FULL_CTX, historicalEvidence: [chargedFlag()] },
  });
  assert.equal(row(c, "provider").posted, false);
  assert.equal(row(c, "provider").reversed, true);
  assert.equal(row(c, "provider").state, "REVIEW_REQUIRED");
  assert.equal(row(c, "provider").available, false);
});

test("available is the only gate, and it agrees with canPost everywhere", () => {
  // The UI renders a control from `available`; the server refuses from
  // `canPost`. If they ever disagree, a button appears that cannot work.
  const worlds = [
    { entries: [] as PostedEntryView[], ctx: FULL_CTX },
    { entries: [entry("area_manager")], ctx: FULL_CTX },
    { entries: [entry("combined")], ctx: FULL_CTX },
    { entries: [], ctx: { ...FULL_CTX, historicalEvidence: [chargedFlag()] } },
    { entries: [], ctx: { ...FULL_CTX, chargedElsewhere: [sibling("provider")] } },
    { entries: [], ctx: { ...FULL_CTX, hasProvider: false } },
    { entries: [entry("provider")], ctx: { ...FULL_CTX, historicalEvidence: [attempted()] } },
  ];
  for (const w of worlds) {
    const c = resolveCoverage({ snapshot: SNAP, entries: w.entries, context: w.ctx });
    for (const t of POSTING_TARGETS) {
      assert.equal(canPost(c, t).ok, row(c, t).available,
        `${t} disagrees: available=${row(c, t).available} canPost=${canPost(c, t).ok}`);
    }
  }
});
