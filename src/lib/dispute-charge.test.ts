// Run: node --test src/lib/dispute-charge.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobDisputeInputs, computeDisputeCharge } from "./dispute-charge.ts";

test("jobDisputeInputs: jobAmount from totalAmount (excl tip), tip + parts consolidated", () => {
  const job = {
    totalAmount: 1000,
    tipsCard: 60, tipsCompanyCash: 40,
    techParts: 120, companyParts: 60, lmParts: 20,
  };
  const r = jobDisputeInputs(job);
  assert.equal(r.jobAmount, 1000);
  assert.equal(r.grossTip, 100);
  assert.equal(r.partsCost, 200);
  assert.equal(r.sources.jobAmount, "totalAmount");
});

test("jobDisputeInputs: falls back to payment buckets when totalAmount missing", () => {
  const job = { totalPaidCard: 1000, tipsCard: 100, techParts: 200 };
  const r = jobDisputeInputs(job);
  assert.equal(r.jobAmount, 1000);
  assert.equal(r.grossTip, 100);
  assert.equal(r.partsCost, 200);
  assert.equal(r.sources.jobAmount, "paymentBuckets");
});

test("computeDisputeCharge: §9 partial reaching parts → AM ledger $470", () => {
  const job = { totalAmount: 1000, tipsCard: 100, techParts: 200 };
  const snap = computeDisputeCharge({
    job, disputeAmount: 920, type: "dispute",
    technicianPercent: 30, providerPercent: 50, areaManagerPoolPercent: 40,
    sourceJobId: "job1", sourceRecordId: "disp1",
  });
  assert.equal(snap.amLedgerCharge, 470);
  assert.equal(snap.technicianPortion, 395);
  assert.equal(snap.areaManagerOwnPortion, 75);
  assert.equal(snap.providerCharge, 375);
  assert.equal(snap.companyCharge, 75);
  assert.equal(snap.partsLoss, 75);
  assert.equal(snap.disputeClassification, "partial");
  assert.equal(snap.operationalProfit, 750);
  assert.equal(snap.netTip, 95);
  assert.equal(snap.sourceJobId, "job1");
});

test("computeDisputeCharge: refund uses the same engine, only type differs", () => {
  const job = { totalAmount: 1000, tipsCard: 100, techParts: 200 };
  const common = { job, disputeAmount: 1100, technicianPercent: 30, providerPercent: 50, areaManagerPoolPercent: 40 } as const;
  const d = computeDisputeCharge({ ...common, type: "dispute" });
  const r = computeDisputeCharge({ ...common, type: "refund" });
  assert.equal(d.amLedgerCharge, r.amLedgerCharge);   // full → 595
  assert.equal(d.amLedgerCharge, 595);
  assert.equal(r.type, "refund");
  assert.equal(d.disputeClassification, "full");
});
