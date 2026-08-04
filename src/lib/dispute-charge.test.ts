// Run: node --test src/lib/dispute-charge.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobDisputeInputs, computeDisputeCharge } from "./dispute-charge.ts";

test("jobDisputeInputs: totalAmount is pre-tip → G = totalAmount + tips", () => {
  const job = {
    totalAmount: 950,
    tipsCard: 30, tipsCompanyCash: 20, tipsFinance: 0, tipsCheck: 0,
    techParts: 60, companyParts: 40, lmParts: 0,
  };
  const r = jobDisputeInputs(job);
  assert.equal(r.totalCharge, 1000);
  assert.equal(r.partsCost, 100);
  assert.equal(r.tipAmount, 50);
  assert.equal(r.sources.totalCharge, "totalAmount+tips");
});

test("jobDisputeInputs: falls back to payment buckets when totalAmount missing", () => {
  const job = { totalPaidCard: 950, tipsCard: 50, techParts: 100 };
  const r = jobDisputeInputs(job);
  assert.equal(r.totalCharge, 1000);
  assert.equal(r.partsCost, 100);
  assert.equal(r.tipAmount, 50);
  assert.equal(r.sources.totalCharge, "paymentBuckets+tips");
});

test("jobDisputeInputs: coerces string-typed job fields", () => {
  const job = { totalAmount: "950", tipsCard: "30", tipsCompanyCash: "20", techParts: "100" } as never;
  const r = jobDisputeInputs(job);
  assert.equal(r.totalCharge, 1000);
  assert.equal(r.tipAmount, 50);
  assert.equal(r.partsCost, 100);
});

test("computeDisputeCharge: AM $470, tech@30 $390 (info), own portion $80", () => {
  const job = { totalAmount: 950, tipsCard: 50, techParts: 100 };
  const snap = computeDisputeCharge({
    job, disputeAmount: 1000, type: "dispute",
    areaManagerPercent: 40, technicianEffectivePercent: 30,
    sourceJobId: "job1", sourceRecordId: "disp1",
  });
  assert.equal(snap.totalCharge, 1000);
  assert.equal(snap.partsCost, 100);
  assert.equal(snap.tipAmount, 50);
  assert.equal(snap.areaManagerCharge, 470);
  assert.equal(snap.technicianChargebackInfo, 390);
  assert.equal(snap.areaManagerOwnPortionInfo, 80);
  assert.equal(snap.calculationBranch, "full");
  assert.equal(snap.disputeClassification, "full");
  assert.equal(snap.cardFeePercent, 5);
  assert.equal(snap.sourceJobId, "job1");
  assert.equal(snap.sourceDisputeOrRefundId, "disp1");
});

test("computeDisputeCharge: refund uses the same engine, only type differs", () => {
  const job = { totalAmount: 950, tipsCard: 50, techParts: 100 };
  const common = { job, disputeAmount: 1000, areaManagerPercent: 40, technicianEffectivePercent: 30 };
  const d = computeDisputeCharge({ ...common, type: "dispute" });
  const r = computeDisputeCharge({ ...common, type: "refund" });
  assert.equal(d.areaManagerCharge, r.areaManagerCharge);
  assert.equal(r.type, "refund");
  assert.equal(d.type, "dispute");
});

test("computeDisputeCharge: partial dispute below (total-tip) uses partial branch", () => {
  const job = { totalAmount: 950, tipsCard: 50, techParts: 100 };
  // total incl tip = 1000, tip = 50, netTip = 47.5; H=500 (partial, above net tip):
  // 47.5 + (500-47.5)*0.40 = 47.5 + 181 = 228.5
  const snap = computeDisputeCharge({
    job, disputeAmount: 500, type: "dispute",
    areaManagerPercent: 40, technicianEffectivePercent: 30,
  });
  assert.equal(snap.areaManagerCharge, 228.5);
  assert.equal(snap.calculationBranch, "partial_above_tip");
});
