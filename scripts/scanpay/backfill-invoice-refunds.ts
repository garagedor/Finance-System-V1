/* One-time catch-up for refunds that only show on the ScanPay INVOICE
   (partial refunds — src/lib/scanpay/invoice-refunds.ts).

   node --import ./scripts/test-register.mjs scripts/scanpay/backfill-invoice-refunds.ts --env <.env.local>
       PREVIEW: pages every invoice on every team (slowly — ScanPay blocks
       bursts), lists the REFUNDED invoices missing from the refund inbox, and
       saves them to invoice-refund-scan-<time>.json. Reads only.

   … --env <.env.local> --apply <invoice-refund-scan-….json>
       Adds those to the inbox through the app's own upsert (same matching and
       share preview as the daily sync). Writes a backup listing what it added.

   … --env <.env.local> --undo <invoice-refund-backfill-….json>
       Removes the rows it added — only those nobody has touched since. */

import { readFileSync, writeFileSync } from "node:fs";
import { MongoClient } from "mongodb";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const envFile = arg("--env") ?? ".env.local";
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const DB_NAME = process.env.MONGODB_DB ?? "ag";

const applyFile = arg("--apply");
const undoFile = arg("--undo");

if (undoFile) {
  const { ids } = JSON.parse(readFileSync(undoFile, "utf8")) as { ids: string[] };
  const client = new MongoClient(process.env.MONGODB_URI!); await client.connect();
  const c = client.db(DB_NAME).collection<{ _id: string }>("finance_scanpay_refund");
  const r = await c.deleteMany({ _id: { $in: ids }, source: "invoice", matchStatus: { $in: ["new", "matched"] }, refundAmount: null });
  console.log(`UNDONE: removed ${r.deletedCount} of ${ids.length} (rows someone already worked on were kept).`);
  await client.close();
} else if (applyFile) {
  const { missing } = JSON.parse(readFileSync(applyFile, "utf8")) as { missing: Array<Record<string, string>> };
  const { upsertScanpayRefund } = await import("../../src/lib/scanpay/refund-sync.ts");
  const { invoiceToRefundRaw } = await import("../../src/lib/scanpay/invoice-refunds.ts");
  const created: string[] = [];
  let skipped = 0;
  for (const inv of missing) {
    const res = await upsertScanpayRefund(invoiceToRefundRaw(inv as never), "invoice");
    if (res.action === "created") created.push(inv.id); else skipped++;
    process.stdout.write(".");
  }
  const out = `invoice-refund-backfill-${stamp}.json`;
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), ids: created }, null, 1));
  console.log(`\nADDED ${created.length} refunds to the inbox (${skipped} already there). Backup: ${out}`);
  console.log(`To reverse: … --undo ${out}`);
  process.exit(0);
} else {
  const { fetchRefundedInvoices } = await import("../../src/lib/scanpay/client.ts");
  const scan = await fetchRefundedInvoices({
    since: "2000-01-01T00:00:00Z",
    delayMs: 400,
    onPage: (team, page, oldest) => { if (page % 25 === 0) console.log(`team ${team} page ${page} · back to ${oldest.slice(0, 10)}`); },
  });
  const client = new MongoClient(process.env.MONGODB_URI!); await client.connect();
  const rows = await client.db(DB_NAME).collection("finance_scanpay_refund").find({}, { projection: { invoiceNumber: 1 } }).toArray();
  await client.close();
  const have = new Set(rows.map((r) => String(r.invoiceNumber ?? "")));
  const haveIds = new Set(rows.map((r) => String(r._id)));
  const missing = scan.invoices.filter((x) => !have.has(x.invoiceNumber) && !haveIds.has(x.id));
  const out = `invoice-refund-scan-${stamp}.json`;
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), pages: scan.pages, found: scan.invoices.length, missing }, null, 1));

  console.log(`\nScanned ${scan.pages} pages. REFUNDED invoices: ${scan.invoices.length}. Already in the inbox: ${scan.invoices.length - missing.length}. MISSING: ${missing.length}`);
  const total = missing.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
  console.log(`Missing — original payments total $${total.toFixed(2)} (refunded amounts aren't in ScanPay's API)\n`);
  for (const x of missing.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    console.log(`  ${x.createdAt.slice(0, 10)}  ${x.invoiceNumber.padEnd(20)} ${(x.customerName ?? "").slice(0, 24).padEnd(24)} $${x.amount.padStart(9)}  team ${x.team}`);
  }
  console.log(`\nPREVIEW ONLY — nothing written. Saved: ${out}\nTo add them: … --apply ${out}`);
}
