// Run with:  node --test src/lib/dispute-share.test.ts   (Node 24+, strips types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateDisputeShare, disputeShareDetailed } from "./dispute-share.ts";

// Baseline job: collected (incl tip) = 1000, parts = 100, tip = 50, share = 40.
const base = { totalCharge: 1000, partsCost: 100, tipAmount: 50, sharePercent: 40 };

// ── Owner's worked examples ────────────────────────────────────────────────
test("owner example A — partial within tip recovers NET: $70 → $66.50", () => {
  // 70 × 0.95 = 66.50 (only the net tip was paid out)
  const r = disputeShareDetailed({ totalCharge: 1000, disputeAmount: 70, partsCost: 0, tipAmount: 100, sharePercent: 40 });
  assert.equal(r.amount, 66.5);
  assert.equal(r.disputeType, "partial");
  assert.equal(r.branch, "partial_within_tip");
});

test("owner bug — tip-only dispute recovers NET tip: $532.95 → $506.30", () => {
  // collected 1000 (job 467.05 + tip 532.95); dispute = tip → within tip.
  // 532.95 × 0.95 = 506.3025 → 506.30
  const r = disputeShareDetailed({ totalCharge: 1000, disputeAmount: 532.95, partsCost: 0, tipAmount: 532.95, sharePercent: 40 });
  assert.equal(r.amount, 506.30);
  assert.equal(r.branch, "partial_within_tip");
});

test("owner example B — partial above tip: $500 (tip $100, 40%) → $255", () => {
  // (500-100)*0.40 + 100*0.95 = 160 + 95 = 255
  const r = disputeShareDetailed({ totalCharge: 1000, disputeAmount: 500, partsCost: 0, tipAmount: 100, sharePercent: 40 });
  assert.equal(r.amount, 255);
  assert.equal(r.disputeType, "partial");
  assert.equal(r.branch, "partial_above_tip");
});

// ── Classification: FULL only when dispute >= collected (incl tip) ──────────
test("dispute equal to (collected − tip) is now PARTIAL, not full", () => {
  // collected 1000, tip 50 → H=950 < 1000 → partial_above_tip:
  // (950-50)*0.40 + 50*0.95 = 360 + 47.5 = 407.5
  const r = disputeShareDetailed({ ...base, disputeAmount: 950 });
  assert.equal(r.amount, 407.5);
  assert.equal(r.disputeType, "partial");
  assert.equal(r.branch, "partial_above_tip");
});

test("dispute equal to the full collected amount is FULL", () => {
  // (1000*0.95 - 100 - 50)*0.40 + 100 + 50 = 800*0.4 + 150 = 470
  const r = disputeShareDetailed({ ...base, disputeAmount: 1000 });
  assert.equal(r.amount, 470);
  assert.equal(r.disputeType, "full");
  assert.equal(r.branch, "full");
});

test("dispute above the collected amount is still FULL (470)", () => {
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 1500 }), 470);
});

// ── Partial within tip (<= tip) ────────────────────────────────────────────
test("dispute smaller than the tip → net of card fee", () => {
  // 30 × 0.95 = 28.5
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 30 }), 28.5);
});

test("dispute exactly equal to the tip → net tip (seamless with above-tip)", () => {
  // 50 × 0.95 = 47.5 — same as the above-tip formula at the boundary
  const r = disputeShareDetailed({ ...base, disputeAmount: 50 });
  assert.equal(r.amount, 47.5);
  assert.equal(r.branch, "partial_within_tip");
});

// ── Partial above tip ──────────────────────────────────────────────────────
test("partial dispute above the tip", () => {
  // (500-50)*0.40 + 50*0.95 = 180 + 47.5 = 227.5
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 500 }), 227.5);
});

test("dispute just below the collected amount", () => {
  // H=999 → (999-50)*0.40 + 47.5 = 379.6 + 47.5 = 427.1
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 999 }), 427.1);
});

// ── Full-branch edges ──────────────────────────────────────────────────────
test("zero tip (full dispute)", () => {
  // (950 - 100 - 0)*0.40 + 100 + 0 = 440
  assert.equal(calculateDisputeShare({ totalCharge: 1000, partsCost: 100, tipAmount: 0, sharePercent: 40, disputeAmount: 1000 }), 440);
});

test("zero parts (full dispute)", () => {
  // (950 - 0 - 50)*0.40 + 0 + 50 = 410
  assert.equal(calculateDisputeShare({ totalCharge: 1000, partsCost: 0, tipAmount: 50, sharePercent: 40, disputeAmount: 1000 }), 410);
});

test("technician percentages 25 / 30 / 32.5 / 35 / 40 (full), computed independently", () => {
  const full = { ...base, disputeAmount: 1000 };
  assert.equal(calculateDisputeShare({ ...full, sharePercent: 25 }), 350);
  assert.equal(calculateDisputeShare({ ...full, sharePercent: 30 }), 390);
  assert.equal(calculateDisputeShare({ ...full, sharePercent: 32.5 }), 410);
  assert.equal(calculateDisputeShare({ ...full, sharePercent: 35 }), 430);
  assert.equal(calculateDisputeShare({ ...full, sharePercent: 40 }), 470);
});

// ── Rounding / fees ────────────────────────────────────────────────────────
test("decimals + rounding to two cents (full, 32.5%)", () => {
  // (333.33*0.95 - 10.10 - 5.05)*0.325 + 10.10 + 5.05 = 113.1418875 → 113.14
  assert.equal(calculateDisputeShare({ totalCharge: 333.33, disputeAmount: 333.33, partsCost: 10.10, tipAmount: 5.05, sharePercent: 32.5 }), 113.14);
});

test("rounding half-up (partial above tip)", () => {
  // (123.45-10)*0.30 + 10*0.95 = 34.035 + 9.5 = 43.535 → 43.54
  assert.equal(calculateDisputeShare({ totalCharge: 1000, disputeAmount: 123.45, partsCost: 0, tipAmount: 10, sharePercent: 30 }), 43.54);
});

test("cardFeePercent default (5) equals passing it explicitly", () => {
  const i = { ...base, disputeAmount: 1000 };
  assert.equal(calculateDisputeShare(i), calculateDisputeShare({ ...i, cardFeePercent: 5 }));
});

test("cardFeePercent override (0 → no fee), full dispute", () => {
  // (1000*1 - 100 - 50)*0.40 + 150 = 490
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 1000, cardFeePercent: 0 }), 490);
});
