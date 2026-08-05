// Populate finance_scanpay_refund by mirroring src/lib/scanpay/refund-*.ts.
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const val = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const key = val("SCANPAY_API_KEY");
const get = async (p) => (await (await fetch("https://api.scanpay.tech" + p, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } })).json().catch(() => null));

// paginate refunded payments
const refunds = [];
for (let pg = 0; pg < 200; pg++) {
  const b = await get(`/connect/v1/payments?status=REFUNDED&page=${pg}`);
  const rows = b?.data?.payments ?? [];
  if (!rows.length) break;
  refunds.push(...rows);
  if (refunds.length >= (b?.data?.totalCount ?? 0)) break;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const amt = (s) => { const n = parseFloat(String(s || "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const pDate = (s) => { const d = new Date(String(s || "").trim()); return isNaN(d) ? null : d.toISOString(); };
const normInv = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");

const client = new MongoClient(val("MONGODB_URI")); await client.connect();
const db = client.db("ag");
const Job = db.collection("Job");
const SR = db.collection("finance_scanpay_refund");
await SR.createIndex({ paymentId: 1 }, { unique: true }).catch(() => {});

const now = new Date().toISOString();
let created = 0, updated = 0, inv = 0, un = 0, preserved = 0;
for (const raw of refunds) {
  const c0 = { paymentId: raw.id, invoiceId: raw.invoiceId, invoiceNumber: raw.invoiceNumber, originalAmount: amt(raw.amount), paymentDate: pDate(raw.createdAt), paymentMethod: raw.paymentMethod, raw, updated_at: now };
  const existing = await SR.findOne({ _id: raw.id });
  if (existing && (existing.matchStatus === "posted" || existing.matchStatus === "ignored" || existing.matchMethod === "manual")) { await SR.updateOne({ _id: raw.id }, { $set: c0 }); preserved++; updated++; continue; }

  // match by invoice, else amount fallback
  let candidates = [], best = null;
  const ninv = normInv(raw.invoiceNumber);
  if (ninv) { const hit = await Job.findOne({ invoiceNumber: { $regex: `^${esc(ninv)}$`, $options: "i" } });
    if (hit) { const c = { jobId: String(hit._id), score: 100, method: "invoice", reason: "invoice exact", address: hit.address ?? null, date: hit.date ?? null, totalAmount: hit.totalAmount ?? null, tech: hit.tech ?? null }; candidates = [c]; best = c; } }
  if (!best) {
    const a = amt(raw.amount);
    if (a > 0) { const rows = await Job.find({ $or: [{ totalAmount: a }, { totalPaidCard: a }] }).limit(10).toArray();
      candidates = rows.slice(0, 5).map(j => ({ jobId: String(j._id), score: 40, method: "fallback", reason: "amount match", address: j.address ?? null, date: j.date ?? null, totalAmount: j.totalAmount ?? null, tech: j.tech ?? null })); }
  }
  if (best?.method === "invoice") inv++; else un++;
  const mf = { matchStatus: best ? "matched" : "new", matchedJobId: best?.jobId ?? null, matchMethod: best?.method ?? null, matchScore: best?.score ?? null, candidates };
  if (!existing) { await SR.insertOne({ _id: raw.id, ...c0, refundAmount: null, refundDate: null, ...mf, postedRecordId: null, ledgerEntryId: null, synced_at: now }); created++; }
  else { await SR.updateOne({ _id: raw.id }, { $set: { ...c0, ...mf } }); updated++; }
}
console.log(`refund sync: fetched ${refunds.length} · created ${created} · updated ${updated} · byInvoice ${inv} · unmatched ${un} · preserved ${preserved}`);
console.log("refund inbox count:", await SR.countDocuments({}));
await client.close();
