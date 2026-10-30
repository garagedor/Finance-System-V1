/* Structural guarantees, asserted on source (the repo's usual pattern):
   1. no business rule is hardcoded outside the seed template;
   2. the job reader is read-only and never touches AI shadow records;
   3. the Arena writes no CRM / finance collection. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname);
const src = (f: string) =>
  readFileSync(join(DIR, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/.*$/gm, "");
const runtimeFiles = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

test("no business constants outside the seed template (config.ts)", () => {
  // the approved starting values, in every unit they could be written in
  const seedValues = /(?<![\w.])(10|400|40000|40_000|4000|4_000|0\.4|40|60|50|0\.5|5000|5_000|500|50000|50_000|1\.5|1500|150000|150_000|450|300|200|150|100|250|25000|25_000)(?![\w.])/;
  const allowed: Record<string, RegExp[]> = {
    // unit conversions, not business rules
    "engine.ts": [/const SCORE_SCALE = 100;/, /const BP = 10_000/, /const MICRO_PER_CENT = 10_000/, /const MICRO = 1_000_000/, /\/ 100\b/],
    "week.ts": [/\* 60_000/, /h \* 60 \+ m/, /86_400_000/, /slice\(0, 10\)/], // ISO date formatting
    "job-source.ts": [/slice\(-10\)/], // US phone digits, for duplicate grouping
    "review.ts": [/2 to 40 characters/], // display-name length, not a competition rule
    "config.ts": [/.*/], // the seed lives here
  };
  for (const f of runtimeFiles) {
    if (f === "config.ts") continue;
    const lines = src(f).split("\n");
    for (const line of lines) {
      if (!seedValues.test(line)) continue;
      if ((allowed[f] ?? []).some((re) => re.test(line))) continue;
      assert.fail(`${f}: possible hardcoded business value → ${line.trim()}`);
    }
  }
});

test("the engine reads every rule from the rules object", () => {
  const e = src("engine.ts");
  for (const k of ["minQualifyingJobs", "minAvgTicketCents", "minClosingRateBp", "targetBp", "targetCents", "cap", "weight",
    "positionsCents", "budgetCents", "statuses", "tieBreak", "baselineWeeks", "minValidWeeks", "minQualifyingJobsPerWeek", "minImprovement"])
    assert.ok(e.includes(k), `engine does not use rules.${k}`);
});

test("job source is read-only and never reads AI shadow jobs", () => {
  const s = src("job-source.ts");
  assert.ok(!/Job_ai|AI_JOB_COLLECTION|ai-jobs/.test(s), "job-source must not reference the shadow collection");
  assert.ok(
    !/\.(insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|bulkWrite|findOneAnd\w+|createIndex\w*|drop\w*)\s*\(/.test(s),
    "job-source must not write",
  );
  assert.ok(!/\$out|\$merge/.test(s), "no aggregation write stages");
});

test("the Arena never writes CRM or finance collections", () => {
  for (const f of runtimeFiles) {
    const s = src(f);
    assert.ok(!/["'`](Job|Technician|Location|users|TechNameMapping|Job_ai|AiJobLink)["'`]\s*\)\s*\.\s*(insert|update|replace|delete|bulkWrite)/.test(s), f);
    assert.ok(!/finance_(ledger|ledger_entry|payout|dispute|refund|scanpay)/.test(s), `${f} references a financial collection`);
  }
});
