// Run with:  node --test src/lib/dispute-share.test.ts   (Node 24+, strips types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDisputeAllocation } from "./dispute-share.ts";

// Canonical job from the spec examples: Job 1000, Tip 100, Parts 200,
// Tech 30%, Provider 50%, AM pool 40% (→ Company residual 10%).
const spec = {
  jobAmount: 1000, grossTip: 100, partsCost: 200,
  technicianPercent: 30, providerPercent: 50, areaManagerPoolPercent: 40,
};

test("derived amounts: netTip 95, netJob 950, opProfit 750, collected 1100", () => {
  const a = computeDisputeAllocation({ ...spec, disputeAmount: 650 });
  assert.equal(a.netTip, 95);
  assert.equal(a.netJob, 950);
  assert.equal(a.operationalProfit, 750);
  assert.equal(a.totalCollected, 1100);
});

test("§8 partial (does NOT reach parts) — Dispute $650", () => {
  const a = computeDisputeAllocation({ ...spec, disputeAmount: 650 });
  assert.equal(a.disputeType, "partial");
  assert.equal(a.reachesParts, false);
  assert.equal(a.providerCharge, 277.5);
  assert.equal(a.technicianPortion, 261.5);   // 95 tip + 166.5 profit
  assert.equal(a.areaManagerOwnPortion, 55.5);
  assert.equal(a.companyCharge, 55.5);
  assert.equal(a.amLedgerCharge, 317);
  assert.equal(a.partsLoss, 0);
});

test("§9 partial (reaches parts) — Dispute $920", () => {
  const a = computeDisputeAllocation({ ...spec, disputeAmount: 920 });
  assert.equal(a.disputeType, "partial");
  assert.equal(a.reachesParts, true);
  assert.equal(a.partsLoss, 75);              // 100% technician
  assert.equal(a.providerCharge, 375);
  assert.equal(a.technicianPortion, 395);     // 95 tip + 225 profit + 75 parts
  assert.equal(a.areaManagerOwnPortion, 75);
  assert.equal(a.companyCharge, 75);
  assert.equal(a.amLedgerCharge, 470);
});

test("§11 full dispute — Dispute $1100 (all parts to tech)", () => {
  const a = computeDisputeAllocation({ ...spec, disputeAmount: 1100 });
  assert.equal(a.disputeType, "full");
  assert.equal(a.partsLoss, 200);             // entire parts cost, 100% tech
  assert.equal(a.providerCharge, 375);
  assert.equal(a.technicianPortion, 520);     // 95 + 225 + 200
  assert.equal(a.areaManagerOwnPortion, 75);
  assert.equal(a.companyCharge, 75);
  assert.equal(a.amLedgerCharge, 595);
});

test("tip-only dispute recovers net tip + excess by % — $532.95 → AM $516.96", () => {
  // collected 1000 (job 467.05 + tip 532.95). netTip 506.3025; excess 26.6475.
  const a = computeDisputeAllocation({
    jobAmount: 467.05, grossTip: 532.95, partsCost: 0, disputeAmount: 532.95,
    technicianPercent: 30, providerPercent: 50, areaManagerPoolPercent: 40,
  });
  assert.equal(a.disputeType, "partial");
  assert.equal(a.amLedgerCharge, 516.96);      // 506.3025 + 26.6475×0.40
  assert.equal(a.reachesParts, false);
});

test("parts loss is 100% technician — never provider/AM/company", () => {
  // Dispute that reaches parts: only tech's parts portion grows.
  const a = computeDisputeAllocation({ ...spec, disputeAmount: 920 });
  // provider/AM-own/company are all computed off operationalRecovered only.
  assert.equal(a.providerCharge, a.operationalRecovered * 0.5);
  assert.equal(a.areaManagerOwnPortion, a.operationalRecovered * 0.1);
  assert.equal(a.companyCharge, a.operationalRecovered * 0.1);
  // tech carries the parts loss on top.
  assert.equal(a.technicianPortion, a.tipRecovered + a.operationalRecovered * 0.3 + a.partsLoss);
});

test("technician % variations — AM own = opRec × (40% − tech%)", () => {
  for (const [tech, amOwn] of [[25, 112.5], [30, 75], [32.5, 56.25], [35, 37.5], [40, 0]] as const) {
    const a = computeDisputeAllocation({ ...spec, disputeAmount: 920, technicianPercent: tech });
    assert.equal(a.areaManagerOwnPortion, amOwn);   // 750 × (0.40 − tech/100)
    // AM ledger is unaffected by the tech/AM split (95 + 750×0.4 + 75 = 470).
    assert.equal(a.amLedgerCharge, 470);
  }
});

test("company % is the residual (100 − provider − AM pool)", () => {
  const a = computeDisputeAllocation({ ...spec, disputeAmount: 920, providerPercent: 45 });
  assert.equal(a.companyPercent, 15);          // 100 − 45 − 40
  assert.equal(a.companyCharge, 750 * 0.15);   // 112.5
  assert.equal(a.providerCharge, 750 * 0.45);  // 337.5
});
