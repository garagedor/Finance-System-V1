// Run with:  node --test src/lib/dispute-share.test.ts   (Node 24+, strips types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateDisputeShare, disputeShareDetailed } from "./dispute-share.ts";

// Baseline job used across many cases: total incl tip = 1000, parts = 100, tip = 50.
const base = { totalCharge: 1000, partsCost: 100, tipAmount: 50, sharePercent: 40 };

test("1. dispute smaller than the tip → whole dispute assigned", () => {
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 30 }), 30);
});

test("2. dispute equal to the tip → partial-above-tip branch", () => {
  // (50-50)*0.40 + 50*0.95 = 47.5
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 50 }), 47.5);
});

test("3. partial dispute larger than the tip", () => {
  // (500-50)*0.40 + 50*0.95 = 180 + 47.5 = 227.5
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 500 }), 227.5);
});

test("4. dispute just below (total - tip)", () => {
  // total-tip = 950; H=949 → (949-50)*0.40 + 47.5 = 359.6 + 47.5 = 407.1
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 949 }), 407.1);
});

test("5. dispute equal to (total - tip) → full/large branch", () => {
  // (1000*0.95 - 100 - 50)*0.40 + 100 + 50 = 800*0.4 + 150 = 470
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 950 }), 470);
});

test("6. full dispute equal to total charge", () => {
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 1000 }), 470);
});

test("7. zero tip (full dispute)", () => {
  // (950 - 100 - 0)*0.40 + 100 + 0 = 340 + 100 = 440
  assert.equal(calculateDisputeShare({ totalCharge: 1000, partsCost: 100, tipAmount: 0, sharePercent: 40, disputeAmount: 1000 }), 440);
});

test("8. zero parts (full dispute)", () => {
  // (950 - 0 - 50)*0.40 + 0 + 50 = 360 + 50 = 410
  assert.equal(calculateDisputeShare({ totalCharge: 1000, partsCost: 0, tipAmount: 50, sharePercent: 40, disputeAmount: 1000 }), 410);
});

test("9. technician percentages 25 / 30 / 32.5 / 35 / 40 (full dispute), each computed independently", () => {
  const full = { ...base, disputeAmount: 1000 };
  // (950 - 150)*rate + 150 = 800*rate + 150
  assert.equal(calculateDisputeShare({ ...full, sharePercent: 25 }), 350);
  assert.equal(calculateDisputeShare({ ...full, sharePercent: 30 }), 390);
  assert.equal(calculateDisputeShare({ ...full, sharePercent: 32.5 }), 410);
  assert.equal(calculateDisputeShare({ ...full, sharePercent: 35 }), 430);
  assert.equal(calculateDisputeShare({ ...full, sharePercent: 40 }), 470);
  // Independence check: 30% is NOT the 40% result scaled by 30/40.
  const at40 = calculateDisputeShare({ ...full, sharePercent: 40 });
  assert.notEqual(calculateDisputeShare({ ...full, sharePercent: 30 }), Math.round((at40 * 30 / 40) * 100) / 100);
});

test("10a. decimals + rounding to two cents (full/large branch, 32.5%)", () => {
  // (333.33*0.95 - 10.10 - 5.05)*0.325 + 10.10 + 5.05 = 113.1418875 → 113.14
  assert.equal(calculateDisputeShare({ totalCharge: 333.33, disputeAmount: 333.33, partsCost: 10.10, tipAmount: 5.05, sharePercent: 32.5 }), 113.14);
});

test("10b. rounding half-up (partial-above-tip branch)", () => {
  // (123.45-10)*0.30 + 10*0.95 = 34.035 + 9.5 = 43.535 → 43.54
  assert.equal(calculateDisputeShare({ totalCharge: 1000, disputeAmount: 123.45, partsCost: 0, tipAmount: 10, sharePercent: 30 }), 43.54);
});

test("cardFeePercent default (5) equals passing it explicitly", () => {
  const i = { ...base, disputeAmount: 1000 };
  assert.equal(calculateDisputeShare(i), calculateDisputeShare({ ...i, cardFeePercent: 5 }));
});

test("cardFeePercent override (0 → no fee)", () => {
  // (1000*1 - 100 - 50)*0.40 + 150 = 850*0.4 + 150 = 490
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 1000, cardFeePercent: 0 }), 490);
});

test("branch labels are reported correctly", () => {
  assert.equal(disputeShareDetailed({ ...base, disputeAmount: 30 }).branch, "below_tip");
  assert.equal(disputeShareDetailed({ ...base, disputeAmount: 500 }).branch, "partial_above_tip");
  assert.equal(disputeShareDetailed({ ...base, disputeAmount: 1000 }).branch, "full_or_large");
});
