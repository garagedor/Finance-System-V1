// Run with:  node --test --import ./scripts/test-register.mjs src/lib/scanpay/invoice-refunds.test.ts
//
// Partial refunds only show on the ScanPay invoice (status "REFUNDED"); the
// payment stays SUCCESS and never reaches ?status=REFUNDED. Found missing on
// 2026-10-13 (Cameron, IN-1788300793-41).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRefundedInvoice, invoiceToRefundRaw, type ScanpayInvoiceRaw } from "./invoice-refunds.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const read = (...p: string[]) => strip(readFileSync(join(ROOT, ...p), "utf8"));

const cameron: ScanpayInvoiceRaw = {
  id: "Invoice-5AhQHbQvR", invoiceNumber: "IN-1788300793-41", amount: "1618.02", billAmount: "1470",
  payableAmount: "1618.02", serviceFee: "0", tipAmount: "50.02", createdAt: "2026-09-01T22:13:13.36675Z",
  customerName: "Cameron", paymentMethod: "Credit / Debit Card", status: "REFUNDED",
};

test("I1. REFUNDED invoices are picked; PAID / PENDING are not", () => {
  assert.equal(isRefundedInvoice(cameron), true);
  assert.equal(isRefundedInvoice({ status: "PARTIALLY_REFUNDED" }), true);
  assert.equal(isRefundedInvoice({ status: "PAID" }), false);
  assert.equal(isRefundedInvoice({ status: "PENDING" }), false);
});

test("I2. an invoice becomes a refund keyed by the invoice id, with the original amount", () => {
  const raw = invoiceToRefundRaw(cameron);
  assert.equal(raw.id, "Invoice-5AhQHbQvR");
  assert.equal(raw.invoiceNumber, "IN-1788300793-41");
  assert.equal(raw.amount, "1618.02");
  assert.equal(raw.createdAt, cameron.createdAt);
});

test("I3. the invoice scan is one request at a time, paced, time-boxed", () => {
  const CLIENT = read("lib", "scanpay", "client.ts");
  const fn = CLIENT.slice(CLIENT.indexOf("export async function fetchRefundedInvoices"), CLIENT.indexOf("export function parseAmount"));
  assert.equal(/Promise\.all/.test(fn), false, "parallel requests get the IP blocked by ScanPay");
  assert.match(fn, /setTimeout\(r, delay\)/);
  assert.match(fn, /opts\.deadline && Date\.now\(\) > opts\.deadline/);
});

test("I4. it runs in the daily cron only — never on inbox load", () => {
  const CRON = read("app", "api", "scanpay", "cron-sync", "route.ts");
  const MANUAL = read("app", "api", "portal", "scanpay", "refunds", "sync", "route.ts");
  const SYNC = read("lib", "scanpay", "refund-sync.ts");
  assert.match(CRON, /syncRefundedInvoices\(\{ sinceDays: 120, budgetMs: 200_000 \}\)/);
  assert.match(CRON, /maxDuration = 300/);
  assert.equal(/syncRefundedInvoices|fetchRefundedInvoices/.test(MANUAL), false);
  const full = SYNC.slice(SYNC.indexOf("export async function syncScanpayRefunds"), SYNC.indexOf("export async function upsertScanpayRefund"));
  assert.equal(/fetchRefundedInvoices/.test(full), false);
});

test("I5. the same invoice never lands twice", () => {
  const SYNC = read("lib", "scanpay", "refund-sync.ts");
  // invoice route: skip if anything exists for the invoice number;
  // payment route: skip only if the invoice route got there first.
  assert.match(SYNC, /source === "invoice" \? \{ invoiceNumber: raw\.invoiceNumber \} : \{ invoiceNumber: raw\.invoiceNumber, source: "invoice" \}/);
  assert.match(SYNC, /insertOne\(\{ _id: raw\.id, \.\.\.c0, source,/);
});
