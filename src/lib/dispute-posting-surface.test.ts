// Run with:  node --test --import ./scripts/test-register.mjs src/lib/dispute-posting-surface.test.ts
//
// A dispute is settled with more than one party, so a record carries more
// than one ledger entry. The bug this guards against is specific and was
// real: the service deduped on `dispute_id` alone, found the Area Manager's
// entry when the provider was posted, and UPDATED it — moving the AM's
// charge onto the provider's ledger and losing it. Nothing failed, nothing
// logged, and the balances were simply wrong afterwards.
//
// None of what follows is visible to the typechecker: the dedup key, the
// index that backs it, the route guards, and the cross-link that makes a
// charge posted from a ledger page land on the same record. They are
// asserted against the sources, with comments stripped first so a sentence
// about a rule cannot be mistaken for the rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POSTING_TARGETS } from "./dispute-targets.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const SERVICE = strip(read("lib", "dispute-service.ts"));
const DB = strip(read("lib", "finance-db.ts"));
const DISPUTE_ROUTE = strip(read("app", "api", "portal", "scanpay", "[id]", "route.ts"));
const REFUND_ROUTE = strip(read("app", "api", "portal", "scanpay", "refunds", "[id]", "route.ts"));
const CHARGE_ROUTE = strip(read("app", "api", "portal", "dispute-charge", "route.ts"));
const COVERAGE = strip(read("lib", "dispute-coverage.ts"));
const TARGETS = strip(read("lib", "dispute-targets.ts"));

/* ── 1. The dedup key ─────────────────────────────────────────────────── */

test("1. the service no longer treats dispute_id as the whole dedup key", () => {
  // The exact line that caused the overwrite.
  assert.equal(
    SERVICE.includes("findOne({ dispute_id: recordId })"),
    false,
    "a lookup by dispute_id alone finds another target's entry and overwrites it",
  );
});

test("2. the entry it reuses is the one for THIS target", () => {
  assert.match(SERVICE, /targetOfEntry\(asView\(e\)\) === target/);
  // And a reversed entry is not resurrected — re-posting writes a new one.
  assert.match(SERVICE, /!reversedIds\.includes\(e\._id\)/);
});

test("3. the charged party is written at the top level, not only in the blob", () => {
  // Nested inside charge_snapshot it cannot be indexed or queried, which is
  // why the uniqueness rule could not be enforced by the database before.
  assert.match(SERVICE, /^\s*posted_party: target,$/m);
});

test("4. the database enforces one entry per (dispute, party)", () => {
  assert.match(DB, /\{ dispute_id: 1, posted_party: 1 \}/);
  const idx = DB.slice(DB.indexOf("{ dispute_id: 1, posted_party: 1 }"));
  assert.match(idx.slice(0, 400), /unique: true/);
  assert.match(idx.slice(0, 400), /partialFilterExpression/);
});

/* ── 2. The route guards ──────────────────────────────────────────────── */

test("5. neither inbox route refuses a whole item for being posted", () => {
  for (const [name, src] of [["dispute", DISPUTE_ROUTE], ["refund", REFUND_ROUTE]] as const) {
    assert.equal(
      /matchStatus === "posted"[\s\S]{0,160}status: 409/.test(src),
      false,
      `the ${name} route still blocks the item instead of the target`,
    );
    assert.equal(
      src.includes("was already posted"),
      false,
      `the ${name} route still carries the item-level refusal message`,
    );
  }
});

test("6. both routes refuse only the target that is already covered", () => {
  for (const [name, src] of [["dispute", DISPUTE_ROUTE], ["refund", REFUND_ROUTE]] as const) {
    assert.match(src, /canPost\(cov, target\)/, `${name} route does not ask whether this target may post`);
    assert.match(src, /coverageForRecord\(rec\.postedRecordId/, `${name} route does not read coverage`);
  }
});

test("7. a second target attaches to the same canonical record", () => {
  // Without this each posting would create a parallel finance_dispute and the
  // two charges would belong to different records for the same money.
  for (const [name, src] of [["dispute", DISPUTE_ROUTE], ["refund", REFUND_ROUTE]] as const) {
    assert.match(src, /recordId: rec\.postedRecordId \?\? undefined/, `${name} route creates a parallel record`);
  }
});

test("8. posting never moves an item back out of Posted", () => {
  for (const src of [DISPUTE_ROUTE, REFUND_ROUTE]) {
    assert.match(src, /matchStatus: "posted"/);
  }
});

/* ── 3. Ignore cannot bury real money ─────────────────────────────────── */

test("9. ignore is refused once a slice has actually been charged", () => {
  for (const [name, src] of [["dispute", DISPUTE_ROUTE], ["refund", REFUND_ROUTE]] as const) {
    const block = src.slice(src.indexOf('action === "ignore"'), src.indexOf('action === "reopen"'));
    assert.match(block, /coverageForRecord/, `${name} route ignores without checking for postings`);
    assert.match(block, /anyPosted/, `${name} route does not test whether anything is posted`);
    assert.match(block, /status: 409/, `${name} route does not refuse`);
  }
});

/* ── 4. The reverse workflow ──────────────────────────────────────────── */

test("10. a charge from a ledger page attaches to the dispute's record", () => {
  assert.match(CHARGE_ROUTE, /recordIdForScanpay/);
  // Both the single and the bulk path.
  assert.equal(
    (CHARGE_ROUTE.match(/recordIdForScanpay\(/g) ?? []).length >= 3,
    true,
    "the helper must be used by the single path and the bulk path, not one of them",
  );
});

test("11. a charge from a ledger page moves the inbox item to Posted", () => {
  assert.match(CHARGE_ROUTE, /linkScanpayPosting/);
  const fn = CHARGE_ROUTE.slice(CHARGE_ROUTE.indexOf("async function linkScanpayPosting"));
  assert.match(fn.slice(0, 1200), /matchStatus: "posted"/);
  assert.match(fn.slice(0, 1200), /postedRecordId: result\.recordId/);
});

/* ── 5. Coverage is derived, never flagged ────────────────────────────── */

test("12. no boolean posting flag is stored anywhere", () => {
  // The spec's explicit prohibition. A flag is written by whichever path
  // remembers to, and is wrong the first time someone uses one that does not.
  const forbidden = /providerPosted|amPosted|areaManagerPosted|technicianPosted|postedToProvider/;
  for (const [name, src] of [
    ["service", SERVICE], ["coverage", COVERAGE], ["targets", TARGETS],
    ["dispute route", DISPUTE_ROUTE], ["refund route", REFUND_ROUTE], ["charge route", CHARGE_ROUTE],
  ] as const) {
    assert.equal(forbidden.test(src), false, `${name} stores a UI-only posting flag`);
  }
});

test("13. coverage reads ledger entries and the reversals of them", () => {
  assert.match(COVERAGE, /find\(\{ dispute_id: recordId \}\)/);
  assert.match(COVERAGE, /reverses_id: \{ \$in: ids \}/);
});

test("14. entries written before posted_party existed are still classified", () => {
  // Every one of them came from the no-party path, which charged the combined
  // AM figure. Reading them as anything else would misreport history, and
  // reading them as nothing would let the technician be charged twice.
  assert.match(COVERAGE, /charge_snapshot as Record<string, unknown>[\s\S]{0,40}posted_party/);
  assert.match(TARGETS, /return p && \(POSTING_TARGETS as readonly string\[\]\)\.includes\(p\) \? p : "combined"/);
});

/* ── 6. The formulas are not touched ──────────────────────────────────── */

test("15. the service no longer picks the amount with its own switch", () => {
  // It used an inline chain that duplicated what the UI would have to show.
  // One definition, in the target model, so the figure on the button is the
  // figure that gets written.
  assert.match(SERVICE, /amountForTarget\(snapshot, target\)/);
  assert.equal(
    SERVICE.includes('input.party === "technician" ? snapshot.technicianPortion'),
    false,
    "the inline amount chain is back, so there are two definitions again",
  );
});

test("16. nothing in this change writes to the allocation engine", () => {
  const share = read("lib", "dispute-share.ts");
  const charge = read("lib", "dispute-charge.ts");
  // The engine is reached only to be called.
  assert.match(SERVICE, /computeDisputeCharge\(\{/);
  assert.equal(TARGETS.includes("computeDisputeAllocation"), false,
    "the target model must not calculate — it selects an already-computed slice");
  // And the locked split still holds, which is what the overlap rules assume.
  assert.match(share, /amLedgerCharge = technicianPortion \+ areaManagerOwnPortion/);
  assert.match(charge, /amLedgerCharge: a\.amLedgerCharge/);
});

test("17. every target the service accepts is in the canonical list", () => {
  // The `party` union in the service and the target vocabulary must not drift.
  for (const t of POSTING_TARGETS) {
    assert.ok(SERVICE.includes(`"${t}"`), `the service does not mention the ${t} target`);
  }
  assert.equal(POSTING_TARGETS.length, 4);
});

/* ── 7. The sibling-record guard ──────────────────────────────────────── */

test("18. coverage matches siblings on job AND amount, not job alone", () => {
  // A job can legitimately carry two real disputes. Matching on the job
  // alone would block a genuine second charge; the amount is what makes it
  // one dispute written twice.
  assert.match(COVERAGE, /chargedUnderSiblingRecords/);
  const fn = COVERAGE.slice(COVERAGE.indexOf("export async function chargedUnderSiblingRecords"));
  assert.match(fn.slice(0, 1800), /job_id: record\.job_id/);
  assert.match(fn.slice(0, 1800), /_id: \{ \$ne: record\._id \}/);
  assert.match(fn.slice(0, 1800), /\[amountField\]: record\.amount/);
});

test("19. a reversed sibling charge does not block", () => {
  const fn = COVERAGE.slice(COVERAGE.indexOf("export async function chargedUnderSiblingRecords"));
  assert.match(fn.slice(0, 2400), /reverses_id: \{ \$in:/);
  assert.match(fn.slice(0, 2400), /if \(reversed\.has\(e\._id\)\) continue;/);
});

test("20. the guard is on the write path, not only where buttons are drawn", () => {
  // The UI deciding not to offer a button is not a control; a direct POST
  // has to be refused by the service.
  assert.match(SERVICE, /chargedUnderSiblingRecords/);
  assert.match(SERVICE, /chargedElsewhere,/);
});

test("21. both coverage entry points apply it", () => {
  // The detail read and the list read must agree, or the Posted tab offers a
  // button the row behind it would refuse.
  const occurrences = (COVERAGE.match(/chargedElsewhere/g) ?? []).length;
  assert.ok(occurrences >= 3, `the guard is wired in ${occurrences} place(s); both readers need it`);
});

test("22. a sibling charge is never reported as this record's own posting", () => {
  // Overstating it would show a charge the record does not carry, and
  // reversing from here would miss.
  assert.match(TARGETS, /chargedElsewhere: sibling\?\.recordId \?\? null/);
  assert.equal(
    /posted: !!own \|\| !!sibling/.test(TARGETS),
    false,
    "a sibling must not count as posted — only as blocking",
  );
});

test("23. the list page resolves siblings in one pass, not per row", () => {
  // The Posted tab renders up to 300 rows and the cluster is in another
  // region. A per-row sibling lookup is ~900 round trips on the hottest
  // screen in the module.
  assert.match(COVERAGE, /chargedUnderSiblingRecordsBatch/);
  const list = COVERAGE.slice(COVERAGE.indexOf("export async function coverageForRecords"));
  assert.equal(
    /for \(const r of records\)[\s\S]{0,600}await chargedUnderSiblingRecords\(/.test(list),
    false,
    "the per-record lookup is back inside the loop",
  );
  assert.match(list, /chargedUnderSiblingRecordsBatch\(/);
});
