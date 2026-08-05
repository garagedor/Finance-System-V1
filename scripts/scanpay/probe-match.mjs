// Probe how ScanPay disputes join to CRM jobs. Reads SCANPAY_API_KEY + MONGODB_URI
// from .env.local (neither printed). For the first N disputes, tries several join
// keys against the Job collection and reports which one actually hits.
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";

const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const val = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const key = val("SCANPAY_API_KEY");
const uri = val("MONGODB_URI");

const res = await fetch("https://api.scanpay.tech/connect/v1/disputes", { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
const body = await res.json();
console.log("meta:", JSON.stringify(body.meta));
const disputes = body.data ?? [];
console.log("total disputes:", disputes.length);

const digits = (s) => (s || "").replace(/\D/g, "").slice(-10);
const streetOf = (addr) => (addr || "").split(",")[0].trim().toLowerCase();

const client = new MongoClient(uri); await client.connect();
const Job = client.db("ag").collection("Job");

// What identifier fields even exist on Job docs? Sample keys.
const sampleJob = await Job.findOne({ address: { $exists: true } });
console.log("\nJob doc keys:", sampleJob ? Object.keys(sampleJob).join(", ") : "none");

// Do any Job docs store a ScanPay-style id anywhere? Try the first dispute's ids.
const d0 = disputes[0];
for (const [label, v] of [["transactionId", d0.transactionId], ["invoiceNumber", d0.invoiceNumber], ["jobId", d0.jobId]]) {
  const hit = await Job.findOne({ $or: [
    { transactionId: v }, { invoiceNumber: v }, { scanpayId: v }, { scanpay_id: v },
    { externalId: v }, { external_id: v }, { invoice: v }, { jobId: v },
  ] });
  console.log(`  any Job field === dispute.${label} (${v})?`, hit ? `YES (_id ${hit._id})` : "no");
}

console.log("\n=== per-dispute join attempts (first 12) ===");
let byPhone = 0, byAddrAmt = 0, byAddr = 0, none = 0;
for (const d of disputes.slice(0, 12)) {
  const amt = parseFloat(d.amount);
  const ph = digits(d.customerPhone);
  const street = streetOf(d.serviceAddress);

  const phoneHits = ph ? await Job.find({ clientPhoneNumber: { $regex: ph + "$" } }).limit(5).toArray() : [];
  const addrHits = street ? await Job.find({ address: { $regex: "^" + street.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }).limit(10).toArray() : [];
  const addrAmt = addrHits.filter((j) => Math.abs((j.totalAmount ?? 0) - amt) < 0.5 || Math.abs((j.totalPaidCard ?? 0) - amt) < 0.5);

  let verdict;
  if (addrAmt.length === 1) { verdict = `addr+amount → 1 job (${addrAmt[0]._id})`; byAddrAmt++; }
  else if (phoneHits.length >= 1) { verdict = `phone → ${phoneHits.length} job(s)`; byPhone++; }
  else if (addrHits.length >= 1) { verdict = `addr only → ${addrHits.length} job(s), amount no-match`; byAddr++; }
  else { verdict = "NO MATCH"; none++; }
  console.log(`  ${d.disputeId}  $${d.amount}  "${d.customerName}"  ${d.serviceAddress?.slice(0, 28)}  →  ${verdict}`);
}
console.log(`\nsummary (of 12): addr+amount=${byAddrAmt}  phone=${byPhone}  addrOnly=${byAddr}  none=${none}`);
await client.close();
