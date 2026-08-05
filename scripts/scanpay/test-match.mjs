// Validate the ScanPay→Job matcher against real data (mirrors src/lib/scanpay/
// match.ts). Reports invoice/auto-suggest/ambiguous/unmatched counts.
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";

const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const val = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };

const res = await fetch("https://api.scanpay.tech/connect/v1/disputes", { headers: { Authorization: `Bearer ${val("SCANPAY_API_KEY")}`, Accept: "application/json" } });
const disputes = (await res.json()).data ?? [];

const ABBR = { street:"st",str:"st",avenue:"ave",av:"ave",boulevard:"blvd",drive:"dr",road:"rd",lane:"ln",court:"ct",place:"pl",terrace:"ter",circle:"cir",parkway:"pkwy",highway:"hwy",square:"sq",trail:"trl",way:"way",north:"n",south:"s",east:"e",west:"w" };
const normAddr = (s) => String(s||"").toLowerCase().replace(/[.,#]/g," ").split(/\s+/).filter(Boolean).map(w=>ABBR[w]??w).join(" ").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const amt = (s) => { const n = parseFloat(String(s||"").replace(/[^0-9.]/g,"")); return Number.isFinite(n)?n:0; };
const pDate = (s)=>{ const d=new Date(String(s||"").trim()); return isNaN(d)?null:d.toISOString(); };

const client = new MongoClient(val("MONGODB_URI")); await client.connect();
const Job = client.db("ag").collection("Job");

let invoice=0, auto=0, ambiguous=0, unmatched=0;
const examples = [];
for (const raw of disputes) {
  // invoice exact
  const inv = String(raw.invoiceNumber||"").trim().toUpperCase().replace(/\s+/g,"");
  if (inv) { const hit = await Job.findOne({ invoiceNumber: { $regex: `^${esc(inv)}$`, $options:"i" } }); if (hit) { invoice++; continue; } }

  const amount = amt(raw.amount);
  const street = String(raw.serviceAddress||"").split(",")[0].trim();
  const streetNorm = normAddr(street);
  if (!streetNorm) { unmatched++; continue; }
  const rows = await Job.find({ address: { $regex:`^${esc(street.slice(0,24))}`, $options:"i" } }).limit(25).toArray();
  const techNames = [...(raw.technicians||[]), raw.collectedBy].map(t=>String(t||"").toLowerCase().trim()).filter(Boolean);
  const dDay = pDate(raw.paymentDate) ?? pDate(raw.invoiceCreatedAt);

  const scored = rows.map(j=>{
    let s=0; const jA=normAddr(j.address||"");
    if (jA===streetNorm) s+=45; else if (jA.startsWith(streetNorm)||streetNorm.startsWith(jA)) s+=35;
    if ((Math.abs((j.totalAmount||0)-amount)<1 || Math.abs((j.totalPaidCard||0)-amount)<1) && amount>0) s+=30;
    if (j.tech && techNames.includes(String(j.tech).toLowerCase().trim())) s+=15;
    if (dDay && j.date){ const jd=pDate(j.date); if (jd){ const days=Math.abs(new Date(jd)-new Date(dDay))/86400000; if (days<=3) s+=10; } }
    return { id:String(j._id), s, addr:j.address };
  }).sort((a,b)=>b.s-a.s).slice(0,5);

  const best = scored.length===0 ? null : scored.length===1 && scored[0].s>=35 ? scored[0] : scored[0].s>=60 && scored[0].s-scored[1].s>=15 ? scored[0] : null;
  if (best) { auto++; if (examples.length<8) examples.push(`AUTO  ${raw.invoiceNumber}  $${raw.amount}  ${street}  → ${best.addr} (score ${best.s})`); }
  else if (scored.length) { ambiguous++; if (examples.length<8) examples.push(`AMBIG ${raw.invoiceNumber}  $${raw.amount}  ${street}  → ${scored.length} cand, top ${scored[0].s}`); }
  else { unmatched++; }
}

console.log(`Disputes: ${disputes.length}`);
console.log(`  exact invoice match : ${invoice}   (expected ~0 until jobs get invoice #s)`);
console.log(`  auto-suggested (fallback, confident): ${auto}`);
console.log(`  ambiguous (needs human pick): ${ambiguous}`);
console.log(`  unmatched (no address hit): ${unmatched}`);
console.log("\nexamples:");
for (const e of examples) console.log("  " + e);
await client.close();
