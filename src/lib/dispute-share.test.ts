// Run with:  node --test src/lib/dispute-share.test.ts   (Node 24+, strips types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateDisputeShare, disputeShareDetailed } from "./dispute-share.ts";

// Baseline: collected (incl tip) = 1000, parts = 100, tip = 50 → netTip = 47.5.
const base = { totalCharge: 1000, partsCost: 100, tipAmount: 50, sharePercent: 40 };

// ── Owner's worked examples ────────────────────────────────────────────────
test("owner example A — dispute within the net tip: $70 (netTip 95) → $70", () => {
  // 70 <= netTip(100×0.95=95) → recover the whole $70
  const r = disputeShareDetailed({ totalCharge: 1000, disputeAmount: 70, partsCost: 0, tipAmount: 100, sharePercent: 40 });
  assert.equal(r.amount, 70);
  assert.equal(r.disputeType, "partial");
  assert.equal(r.branch, "partial_within_tip");
});

test("owner example — tip-only dispute above net tip: $532.95 (40%) → $516.96", () => {
  // netTip = 532.95×0.95 = 506.3025; excess 26.6475 × 0.40 = 10.659
  // 506.3025 + 10.659 = 516.9615 → 516.96
  const r = disputeShareDetailed({ totalCharge: 1000, disputeAmount: 532.95, partsCost: 0, tipAmount: 532.95, sharePercent: 40 });
  assert.equal(r.amount, 516.96);
  assert.equal(r.branch, "partial_above_tip");
});

// ── Classification: FULL only when dispute >= collected (incl tip) ──────────
test("dispute equal to (collected − tip) is PARTIAL", () => {
  // netTip 47.5; 47.5 + (950-47.5)*0.40 = 47.5 + 361 = 408.5
  const r = disputeShareDetailed({ ...base, disputeAmount: 950 });
  assert.equal(r.amount, 408.5);
  assert.equal(r.disputeType, "partial");
  assert.equal(r.branch, "partial_above_tip");
});

test("dispute equal to the full collected amount is FULL (470)", () => {
  const r = disputeShareDetailed({ ...base, disputeAmount: 1000 });
  assert.equal(r.amount, 470);
  assert.equal(r.disputeType, "full");
  assert.equal(r.branch, "full");
});

test("dispute above the collected amount is still FULL (470)", () => {
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 1500 }), 470);
});

// ── Partial: within the net tip (recover the full dispute) ─────────────────
test("dispute below the net tip → recover the whole dispute", () => {
  // 30 <= netTip 47.5 → 30
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 30 }), 30);
});

test("dispute equal to the GROSS tip but above the net tip → above branch", () => {
  // dispute 50 > netTip 47.5 → 47.5 + (50-47.5)*0.40 = 47.5 + 1 = 48.5
  const r = disputeShareDetailed({ ...base, disputeAmount: 50 });
  assert.equal(r.amount, 48.5);
  assert.equal(r.branch, "partial_above_tip");
});

// ── Partial: above the net tip ─────────────────────────────────────────────
test("partial dispute well above the tip", () => {
  // 47.5 + (500-47.5)*0.40 = 47.5 + 181 = 228.5
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 500 }), 228.5);
});

test("dispute just below the collected amount", () => {
  // 47.5 + (999-47.5)*0.40 = 47.5 + 380.6 = 428.1
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 999 }), 428.1);
});

// ── Full-branch edges (unchanged) ──────────────────────────────────────────
test("zero tip (full dispute)", () => {
  assert.equal(calculateDisputeShare({ totalCharge: 1000, partsCost: 100, tipAmount: 0, sharePercent: 40, disputeAmount: 1000 }), 440);
});

test("zero parts (full dispute)", () => {
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
  assert.equal(calculateDisputeShare({ totalCharge: 333.33, disputeAmount: 333.33, partsCost: 10.10, tipAmount: 5.05, sharePercent: 32.5 }), 113.14);
});

test("rounding half-up (partial above net tip)", () => {
  // netTip 9.5; 9.5 + (123.45-9.5)*0.30 = 9.5 + 34.185 = 43.685 → 43.69
  assert.equal(calculateDisputeShare({ totalCharge: 1000, disputeAmount: 123.45, partsCost: 0, tipAmount: 10, sharePercent: 30 }), 43.69);
});

test("cardFeePercent default (5) equals passing it explicitly", () => {
  const i = { ...base, disputeAmount: 1000 };
  assert.equal(calculateDisputeShare(i), calculateDisputeShare({ ...i, cardFeePercent: 5 }));
});

test("cardFeePercent override (0 → no fee), full dispute", () => {
  assert.equal(calculateDisputeShare({ ...base, disputeAmount: 1000, cardFeePercent: 0 }), 490);
});
