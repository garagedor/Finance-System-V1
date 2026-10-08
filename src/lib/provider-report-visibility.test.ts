// Run: npm test
//
// PROVIDER-facing Custom Reports must show the PROVIDER's own charge and never
// the internal cost-share split. The projection is checked against real
// engine output (computeDisputeCharge), so these tests also pin that the
// report reads the formula's results rather than recalculating them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeDisputeCharge } from "./dispute-charge.ts";
import {
  disputeDetail, providerDisputeDetail, providerDisputeLabel, isProviderLedgerRole,
} from "./dispute-detail.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const job = { totalAmount: 1000, tipsCard: 100, techParts: 200 };
const snapshotFor = (disputeAmount: number, type: "dispute" | "refund" = "dispute") => ({
  ...(computeDisputeCharge({
    job, disputeAmount, type,
    technicianPercent: 30, providerPercent: 50, areaManagerPoolPercent: 40,
    sourceJobId: "job1", sourceRecordId: "disp1",
  }) as unknown as Record<string, unknown>),
  posted_party: "provider",
  customer_name: "Linda",
  address: "12 Elm St",
});

const FORBIDDEN_TEXT = [/technician/i, /area manager/i, /\bAM\b/, /company/i, /cost-share/i, /operational/i, /%/, /parts/i, /tip/i, /collected/i];

function assertProviderSafe(detail: ReturnType<typeof providerDisputeDetail>, snap: Record<string, unknown>) {
  const json = JSON.stringify(detail);
  for (const re of FORBIDDEN_TEXT) assert.doesNotMatch(json, re, `leaked ${re}`);
  assert.equal(detail.tech, "");
  // No internal figure appears as a value unless it coincides with a PROVIDER one.
  const allowed = new Set([money(Number(snap.providerCharge)), money(Number(snap.disputeOrRefundAmount))]);
  const values = new Set(detail.lines.map((l) => l.value).filter(Boolean));
  for (const k of ["technicianPortion", "areaManagerOwnPortion", "companyCharge", "amLedgerCharge", "operationalProfit", "jobAmount", "totalCollected"]) {
    const v = money(Number(snap[k]));
    if (!allowed.has(v)) assert.ok(!values.has(v), `leaked ${k} (${v})`);
  }
}

test("PARTIAL dispute: PROVIDER sees amount, type, share and the ledger charge only", () => {
  const snap = snapshotFor(920);
  assert.equal(snap.disputeClassification, "partial");
  const d = providerDisputeDetail(snap, { ledgerAmount: 375 });
  assertProviderSafe(d, snap);
  const byLabel = Object.fromEntries(d.lines.filter((l) => !l.head).map((l) => [l.label, l.value]));
  assert.deepEqual(byLabel, {
    "Dispute type": "PARTIAL",
    "Dispute amount": money(920),
    "PROVIDER share": money(Number(snap.providerCharge)),
    "PROVIDER charge": money(375),
  });
  assert.equal(d.customer, "Linda");
});

test("FULL dispute: same shape, values straight from the engine", () => {
  const snap = snapshotFor(1100);
  assert.equal(snap.disputeClassification, "full");
  const d = providerDisputeDetail(snap, { ledgerAmount: Number(snap.providerCharge) });
  assertProviderSafe(d, snap);
  assert.ok(d.lines.some((l) => l.label === "Dispute type" && l.value === "FULL"));
});

test("refund lines say Refund, not Dispute", () => {
  const snap = snapshotFor(1100, "refund");
  const d = providerDisputeDetail(snap, { ledgerAmount: 10 });
  assertProviderSafe(d, snap);
  assert.ok(d.lines.some((l) => l.label === "Refund amount"));
  assert.ok(!d.lines.some((l) => /Dispute/.test(l.label)));
});

test("PROVIDER charge is the ledger entry amount, never a recomputed figure", () => {
  const snap = snapshotFor(920);
  // Deliberately different from snapshot.providerCharge: the entry is the truth.
  const d = providerDisputeDetail(snap, { ledgerAmount: 123.45 });
  assert.equal(d.lines.find((l) => l.label === "PROVIDER charge")?.value, money(123.45));
});

test("a snapshot field the projection does not name never reaches it", () => {
  const snap = { ...snapshotFor(920), someFutureInternalField: "SECRET-777" };
  assert.doesNotMatch(JSON.stringify(providerDisputeDetail(snap, { ledgerAmount: 1 })), /SECRET-777/);
});

test("line label drops the charged-party names from the stored description", () => {
  assert.equal(providerDisputeLabel("dispute", { customer_name: "Linda" }, "job1"), "Dispute — Linda");
  assert.equal(providerDisputeLabel("refund", null, "job9"), "Refund — job9");
  assert.equal(providerDisputeLabel("dispute", null, null), "Dispute");
});

test("PROVIDER ledger roles are recognised however they are spelled", () => {
  for (const r of ["provider", "Provider", " PROVIDER ", "advertiser", "Advertiser"]) assert.ok(isProviderLedgerRole(r), r);
  for (const r of ["area_manager", "Area Manager", "technician", "", null, undefined]) assert.ok(!isProviderLedgerRole(r), String(r));
});

test("internal reports keep the full cost-share breakdown", () => {
  const snap = snapshotFor(920);
  const d = disputeDetail(snap, { techName: "Bar" });
  const json = JSON.stringify(d);
  assert.match(json, /Cost-share split/);
  assert.match(json, /Technician Bar \(30%\)/);
  assert.match(json, /Total AM ledger charge/);
  assert.match(json, /Company/);
});

/* ── Wiring: every output path goes through the projection ─────────────── */

const LIB = strip(read("lib", "custom-report.ts"));
const PDF = strip(read("app", "api", "finance-report", "custom-pdf", "route.ts"));

test("item picker: a PROVIDER (or unknown) ledger gets the projection", () => {
  assert.match(LIB, /const providerSafe = !ledger \|\| isProviderLedgerRole\(ledger\.role\)/);
  assert.match(LIB, /ledgerLineItems\(rows\.slice\(0, cap\), providerSafe\)/);
  assert.match(LIB, /if \(providerSafe && isDisputeType\(e\)\)[\s\S]{0,400}providerDisputeDetail\(/);
});

test("PDF: ledger lines are rebuilt from the database; browser-sent detail is ignored", () => {
  assert.match(PDF, /ledgerLineItems\(entries, providerSafe\)/);
  assert.match(PDF, /!roleOf\.has\(id\) \|\| isProviderLedgerRole\(roleOf\.get\(id\)\)/);
  assert.doesNotMatch(PDF, /it\.detail/);
  assert.match(PDF, /detail: null,/);
});

test("PDF: a PROVIDER report refuses lines from another party's ledger", () => {
  assert.match(PDF, /if \(providerSafe && others\.length\)[\s\S]{0,400}status: 400/);
});

test("this change never writes: no inserts, updates or deletes in the report path", () => {
  for (const src of [LIB, PDF]) assert.doesNotMatch(src, /insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|bulkWrite/);
});
