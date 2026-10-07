// Run with:  node --test --import ./scripts/test-register.mjs src/lib/inbox-stage.test.ts
//
// The Disputes & Refunds tabs used to be five overlapping filters: the Refunds
// and Disputes tabs queried their collection with NO status condition, so an
// unmatched item sat in "Needs action" AND "Refunds", and a posted item sat in
// "Posted" AND "Refunds". The counts were worse — refundsTotal counted every
// refund that had ever existed.
//
// These tests pin the pipeline: one record, one bucket, and the number on a tab
// derived from the same table as the rows under it.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stageOf, stageFilter, STAGE_STATUSES, INBOX_STAGES, isMixedStage, parseStage,
  type InboxStage, type InboxKind,
} from "./inbox-stage.ts";
import type { ScanpayMatchStatus } from "../types/scanpay.ts";

const STATUSES: ScanpayMatchStatus[] = ["new", "matched", "verified", "posted", "ignored"];
const KINDS: InboxKind[] = ["refund", "dispute"];

/** Which stages would show this record — computed the way the page does it:
 *  by asking each stage's own filter whether the record qualifies. */
function stagesShowing(status: ScanpayMatchStatus, kind: InboxKind): InboxStage[] {
  return INBOX_STAGES.filter((stage) => {
    const f = stageFilter(stage, kind);
    return f !== null && f.matchStatus.$in.includes(status);
  });
}

/* ── 13. NO DUPLICATES ──────────────────────────────────────────────────── */

test("every record lands in exactly one workflow bucket", () => {
  for (const kind of KINDS) {
    for (const status of STATUSES) {
      const shown = stagesShowing(status, kind);
      assert.equal(shown.length, 1,
        `${kind}/${status} appears in ${shown.length} tabs: ${shown.join(" + ") || "none"}`);
      assert.equal(shown[0], stageOf(status, kind),
        `${kind}/${status}: the query says ${shown[0]} but the classifier says ${stageOf(status, kind)}`);
    }
  }
});

test("none of the forbidden pairs is reachable", () => {
  const forbidden: Array<[InboxStage, InboxStage]> = [
    ["action", "disputes"], ["action", "refunds"],
    ["disputes", "posted"], ["refunds", "posted"],
    ["disputes", "ignored"], ["refunds", "ignored"],
    ["posted", "ignored"],
  ];
  for (const kind of KINDS) {
    for (const status of STATUSES) {
      const shown = new Set(stagesShowing(status, kind));
      for (const [a, b] of forbidden) {
        assert.equal(shown.has(a) && shown.has(b), false,
          `${kind}/${status} is in both ${a} and ${b}`);
      }
    }
  }
});

/* ── 15. THE COMPLETE FLOW ──────────────────────────────────────────────── */

test("A · an unmatched dispute waits in Needs action", () => {
  assert.equal(stageOf("new", "dispute"), "action");
  // An invoice-number auto-match is a guess, not a decision: still Needs action.
  assert.equal(stageOf("matched", "dispute"), "action");
});

test("B · Pick job moves a dispute out of Needs action and into Disputes", () => {
  // Pick job → Verify → the API writes matchStatus:"verified" + matchedJobId.
  const before = stageOf("matched", "dispute");
  const after = stageOf("verified", "dispute");
  assert.equal(before, "action");
  assert.equal(after, "disputes");
  assert.notEqual(before, after, "the row must actually leave the queue it was in");
});

test("C · an unmatched refund waits in Needs action", () => {
  assert.equal(stageOf("new", "refund"), "action");
  assert.equal(stageOf("matched", "refund"), "action");
});

test("D · Pick job moves a refund out of Needs action and into Refunds", () => {
  assert.equal(stageOf("matched", "refund"), "action");
  assert.equal(stageOf("verified", "refund"), "refunds");
});

test("E · posting a dispute moves it out of Disputes and into Posted", () => {
  assert.equal(stageOf("verified", "dispute"), "disputes");
  assert.equal(stageOf("posted", "dispute"), "posted");
});

test("F · ignoring a refund moves it out of Refunds and into Ignored", () => {
  assert.equal(stageOf("verified", "refund"), "refunds");
  assert.equal(stageOf("ignored", "refund"), "ignored");
});

test("G · a posted item never appears in an active queue", () => {
  for (const kind of KINDS) {
    const shown = stagesShowing("posted", kind);
    assert.deepEqual(shown, ["posted"], `${kind}: posted leaked into ${shown.join(", ")}`);
  }
});

test("H · an ignored item never appears in an active queue", () => {
  for (const kind of KINDS) {
    const shown = stagesShowing("ignored", kind);
    assert.deepEqual(shown, ["ignored"], `${kind}: ignored leaked into ${shown.join(", ")}`);
  }
});

test("I · the counts use the same table as the rows", () => {
  // The page counts a stage with { matchStatus: { $in: STAGE_STATUSES[stage] } }
  // and queries its rows with stageFilter(stage, kind). Same source or drift.
  for (const stage of INBOX_STAGES) {
    for (const kind of KINDS) {
      const f = stageFilter(stage, kind);
      if (f === null) continue;
      assert.deepEqual(f.matchStatus.$in, [...STAGE_STATUSES[stage]],
        `${stage}/${kind}: the row query and the count query disagree`);
    }
  }
});

/* ── Pipeline shape ─────────────────────────────────────────────────────── */

test("the classifier is total — every status is claimed by some stage", () => {
  const claimed = new Set(INBOX_STAGES.flatMap((s) => [...STAGE_STATUSES[s]]));
  for (const s of STATUSES) {
    assert.ok(claimed.has(s), `no stage owns matchStatus "${s}" — it would vanish`);
  }
});

test("terminal states outrank the active queue", () => {
  // A verified refund that is later posted must read as posted, not refunds.
  assert.equal(stageOf("posted", "refund"), "posted");
  assert.equal(stageOf("ignored", "dispute"), "ignored");
});

test("the two active queues are one stage split by kind", () => {
  // Same status, different collection — which is why they never overlap.
  assert.deepEqual([...STAGE_STATUSES.refunds], [...STAGE_STATUSES.disputes]);
  assert.equal(stageFilter("refunds", "dispute"), null, "Refunds must not query disputes");
  assert.equal(stageFilter("disputes", "refund"), null, "Disputes must not query refunds");
  assert.equal(isMixedStage("refunds"), false);
  assert.equal(isMixedStage("disputes"), false);
  for (const s of ["action", "posted", "ignored"] as const) {
    assert.equal(isMixedStage(s), true, `${s} spans both collections`);
  }
});

test("an unknown ?view= falls back to the head of the queue", () => {
  assert.equal(parseStage(undefined), "action");
  assert.equal(parseStage("nonsense"), "action");
  assert.equal(parseStage("posted"), "posted");
});

/* ── The regression itself ──────────────────────────────────────────────── */

test("the Refunds tab no longer answers with the whole collection", () => {
  // The bug: the tab filter was {} — everything, every status.
  const f = stageFilter("refunds", "refund");
  assert.ok(f, "the Refunds tab must have a filter at all");
  assert.deepEqual(f.matchStatus.$in, ["verified"]);
  for (const s of ["new", "matched", "posted", "ignored"] as const) {
    assert.equal(f.matchStatus.$in.includes(s), false,
      `"${s}" must not show in the active Refunds queue`);
  }
});
