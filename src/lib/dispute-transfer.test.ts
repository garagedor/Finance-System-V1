// Run with:  node --test --import ./scripts/test-register.mjs src/lib/dispute-transfer.test.ts
//
// Transferring a posted dispute/refund charge to another Area Manager, and the
// Area Manager view of Disputes & Refunds in the Custom Report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planDisputeTransfer, retitleForAm, isAmLedgerRole } from "./dispute-transfer.ts";
import type { LedgerEntryRecord, LedgerRecord } from "../types/finance-ledger.ts";

const ROOT = join(import.meta.dirname, "..");
const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const read = (...p: string[]) => strip(readFileSync(join(ROOT, ...p), "utf8"));

const ledger = (over: Partial<LedgerRecord>): LedgerRecord => ({
  _id: "ldg_a", holder_name: "Yuval", role: "area_manager", location: "MN", status: "active", created_at: "", ...over,
});
const entry = (over: Partial<LedgerEntryRecord> = {}): LedgerEntryRecord => ({
  _id: "len_1", ledger_id: "ldg_a", type: "dispute", date: "2026-08-14", amount: 162.5,
  description: "Dispute — Jane Jane (AM Yuval + tech Neorhi)", dispute_id: "disp_1", posted_party: "combined",
  charge_snapshot: { amLedgerCharge: 162.5 }, reverses_id: null, source: "crm", created_at: "",
  ...over,
} as LedgerEntryRecord);
const base = () => ({ entry: entry(), from: ledger({}), to: ledger({ _id: "ldg_b", holder_name: "Rom", role: "Area Manager" }), isReversed: false, targetHasLiveEntry: false });

test("T1. a transfer moves the entry to the new AM — amount and snapshot untouched", () => {
  const plan = planDisputeTransfer(base(), "admin", "2026-10-12T00:00:00Z");
  assert.ok(plan.ok);
  assert.equal(plan.set.ledger_id, "ldg_b");
  assert.equal(plan.areaManagerName, "Rom");
  assert.equal(plan.set.description, "Dispute — Jane Jane (AM Rom + tech Neorhi)");
  assert.equal("amount" in plan.set, false, "the charge is not recalculated");
  assert.equal("charge_snapshot" in plan.set, false);
  assert.deepEqual(plan.set.transfers, [{ from_ledger_id: "ldg_a", from_holder_name: "Yuval", to_ledger_id: "ldg_b", to_holder_name: "Rom", at: "2026-10-12T00:00:00Z", by: "admin" }]);
});

test("T2. history is appended, never replaced", () => {
  const prior = { from_ledger_id: "ldg_x", from_holder_name: "X", to_ledger_id: "ldg_a", to_holder_name: "Yuval", at: "t0", by: "a" };
  const plan = planDisputeTransfer({ ...base(), entry: entry({ transfers: [prior] }) }, "admin", "t1");
  assert.ok(plan.ok);
  assert.equal((plan.set.transfers as unknown[]).length, 2);
  assert.deepEqual((plan.set.transfers as unknown[])[0], prior);
});

test("T3. refused: would double-charge, reversed, reversal, non-dispute", () => {
  const no = (over: object, status: number) => {
    const plan = planDisputeTransfer({ ...base(), ...over }, "a", "t");
    assert.equal(plan.ok, false);
    if (!plan.ok) assert.equal(plan.status, status);
  };
  no({ targetHasLiveEntry: true }, 409);
  no({ isReversed: true }, 409);
  no({ entry: entry({ reverses_id: "len_0" }) }, 400);
  no({ entry: entry({ type: "payment" }) }, 400);
  no({ entry: entry({ dispute_id: null }) }, 400);
});

test("T4. refused: target must be a different, active Area Manager ledger", () => {
  const no = (to: LedgerRecord | null) => assert.equal(planDisputeTransfer({ ...base(), to }, "a", "t").ok, false);
  no(null);
  no(ledger({}));                                        // same ledger
  no(ledger({ _id: "ldg_p", role: "provider" }));
  no(ledger({ _id: "ldg_t", role: "technician" }));
  no(ledger({ _id: "ldg_c", status: "archived" }));
  assert.equal(planDisputeTransfer({ ...base(), from: ledger({ role: "provider" }) }, "a", "t").ok, false, "source must be an AM ledger");
});

test("T5. description retitle handles both shapes and leaves others alone", () => {
  assert.equal(retitleForAm("Dispute — A (AM Or + tech Henry)", "Or Hemo"), "Dispute — A (AM Or Hemo + tech Henry)");
  assert.equal(retitleForAm("Refund — B (AM Elya)", "Rom"), "Refund — B (AM Rom)");
  assert.equal(retitleForAm("Hand-written note", "Rom"), "Hand-written note");
  assert.ok(isAmLedgerRole("Area Manager") && isAmLedgerRole("area_manager") && !isAmLedgerRole("provider"));
});

test("T6. the route moves in place, guarded on the source ledger, and audits", () => {
  const ROUTE = read("app", "api", "portal", "ledger", "[id]", "entries", "[entryId]", "transfer", "route.ts");
  assert.match(ROUTE, /updateOne\(\{ _id: entryId, ledger_id: id \}, \{ \$set: plan\.set \}\)/);
  assert.match(ROUTE, /area_manager_name: plan\.areaManagerName/);
  assert.match(ROUTE, /action: "transfer"/);
  assert.equal(/insertOne/.test(ROUTE), false, "no second entry — (dispute_id, posted_party) is unique");
});

test("T7. Custom Report: AM dispute lines are rebuilt from the DB with the breakdown", () => {
  const LIB = read("lib", "custom-report.ts");
  const PDF = read("app", "api", "finance-report", "custom-pdf", "route.ts");
  // Picker: one AM ledger, internal breakdown, only AM ledgers accepted.
  assert.match(LIB, /p\.type === "disputeRefund" && p\.ledgerId/);
  assert.match(LIB, /isAmLedgerRole\(ledger\.role\)/);
  assert.match(LIB, /amDisputeEntries\(\[p\.ledgerId\]/);
  // PDF: browser-sent rows for `entry:` ids are ignored; rebuilt via the
  // AM-only loader, and refused alongside PROVIDER ledger lines.
  assert.match(PDF, /amDisputeEntries\(null, \{ ids: amIds \}\)/);
  assert.match(PDF, /if \(id\.startsWith\(ENTRY\)\) return rebuilt\.get\(id\)/);
  assert.match(PDF, /amEntries\.length && reportProviderSafe/);
  // The loader drops non-AM ledgers and reversed charges.
  assert.match(LIB, /am\.has\(e\.ledger_id\) && !reversed\.has\(e\._id\)/);
});
