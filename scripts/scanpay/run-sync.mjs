// Populate finance_scanpay_dispute by mirroring src/lib/scanpay/{client,match,
// sync}.ts against real data. Preserves posted/ignored/manual records. Lets us
// verify the inbox UI end-to-end without an authenticated endpoint call.
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";

const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const val = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };

const res = await fetch("https://api.scanpay.tech/connect/v1/disputes", { headers: { Authorization: `Bearer ${val("SCANPAY_API_KEY")}`, Accept: "application/json" } });
const disputes = (await res.json()).data ?? [];

const ABBR = { street:"st",str:"st",avenue:"ave",av:"ave",boulevard:"blvd",drive:"dr",road:"rd",lane:"ln",court:"ct",place:"pl",terrace:"ter",circle:"cir",parkway:"pkwy",highway:"hwy",square:"sq",trail:"trl",way:"way",north:"n",south:"s",east:"e",west:"w" };
const normAddr = (s) => String(s||"").toLowerCase().replace(/[.,#]/g," ").split(/\s+/).filter(Boolean).map(w=>ABBR[w]??w).join(" ").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const amt = (s) => { const n = parseFloat(String(s||"").replace(/[^0-9.]/g,"")); return Number.isFinite(n)?Math.round(n*100)/100:0; };
const pDate = (s)=>{ const d=new Date(String(s||"").trim()); return isNaN(d)?null:d.toISOString(); };
const outcome = (st)=>{ const s=String(st||"").toLowerCase(); return s.includes("won")?"won":s.includes("lost")?"lost":"pending"; };

const client = new MongoClient(val("MONGODB_URI")); await client.connect();
const db = client.db("ag");
const Job = db.collection("Job");
const SC = db.collection("finance_scanpay_dispute");
await SC.createIndex({ disputeId: 1 }, { unique: true }).catch(()=>{});

async function match(raw) {
  const inv = String(raw.invoiceNumber||"").trim().toUpperCase().replace(/\s+/g,"");
  if (inv) { const hit = await Job.findOne({ invoiceNumber: { $regex:`^${esc(inv)}$`, $options:"i" } });
    if (hit) return { candidates:[{ jobId:String(hit._id), score:100, method:"invoice", reason:"invoice exact", address:hit.address??null, date:hit.date??null, totalAmount:hit.totalAmount??null, tech:hit.tech??null }], best:0 }; }
  const amount = amt(raw.amount);
  const street = String(raw.serviceAddress||"").split(",")[0].trim();
  const sN = normAddr(street);
  if (!sN) return { candidates:[], best:-1 };
  const rows = await Job.find({ address:{ $regex:`^${esc(street.slice(0,24))}`, $options:"i" } }).limit(25).toArray();
  const techs = [...(raw.technicians||[]), raw.collectedBy].map(t=>String(t||"").toLowerCase().trim()).filter(Boolean);
  const dDay = pDate(raw.paymentDate) ?? pDate(raw.invoiceCreatedAt);
  const cand = rows.map(j=>{ let s=0; const r=[]; const jA=normAddr(j.address||"");
    if (jA===sN){s+=45;r.push("addr exact");} else if (jA.startsWith(sN)||sN.startsWith(jA)){s+=35;r.push("addr prefix");}
    if ((Math.abs((j.totalAmount||0)-amount)<1||Math.abs((j.totalPaidCard||0)-amount)<1)&&amount>0){s+=30;r.push("amount");}
    if (j.tech && techs.includes(String(j.tech).toLowerCase().trim())){s+=15;r.push("tech");}
    if (dDay && j.date){ const jd=pDate(j.date); if(jd){ const d=Math.abs(new Date(jd)-new Date(dDay))/86400000; if(d<=3){s+=10;r.push("date");}}}
    return { jobId:String(j._id), score:s, method:"fallback", reason:r.join("+")||"addr region", address:j.address??null, date:j.date??null, totalAmount:j.totalAmount??null, tech:j.tech??null };
  }).sort((a,b)=>b.score-a.score).slice(0,5);
  const best = cand.length===0?-1 : cand.length===1&&cand[0].score>=35?0 : cand[0].score>=60&&cand[0].score-cand[1].score>=15?0 : -1;
  return { candidates:cand, best };
}

const now = new Date().toISOString();
let created=0, updated=0, inv=0, fb=0, un=0, preserved=0;
for (const raw of disputes) {
  const core = { disputeId:raw.disputeId, transactionId:raw.transactionId, invoiceNumber:raw.invoiceNumber, amount:amt(raw.amount), currency:raw.currency, reason:raw.reason, statusRaw:raw.status, outcome:outcome(raw.status), customerName:raw.customerName, customerPhone:raw.customerPhone, serviceAddress:raw.serviceAddress, technicians:raw.technicians||[], scanpayJobId:raw.jobId, disputedAt:pDate(raw.disputedDate), resolvedAt:pDate(raw.resultDate), paymentDate:pDate(raw.paymentDate)??pDate(raw.invoiceCreatedAt), raw, updated_at:now };
  const existing = await SC.findOne({ _id: raw.disputeId });
  if (existing && (existing.matchStatus==="posted"||existing.matchStatus==="ignored"||existing.matchMethod==="manual")) { await SC.updateOne({_id:raw.disputeId},{$set:core}); preserved++; updated++; continue; }
  const { candidates, best } = await match(raw);
  const b = best>=0 ? candidates[best] : null;
  if (b?.method==="invoice") inv++; else if (b?.method==="fallback") fb++; else un++;
  const mf = { matchStatus: b?"matched":"new", matchedJobId:b?.jobId??null, matchMethod:b?.method??null, matchScore:b?.score??null, candidates };
  if (!existing) { await SC.insertOne({ _id:raw.disputeId, ...core, ...mf, postedRecordId:null, ledgerEntryId:null, synced_at:now }); created++; }
  else { await SC.updateOne({_id:raw.disputeId},{$set:{...core,...mf}}); updated++; }
}
console.log(`sync: fetched ${disputes.length} · created ${created} · updated ${updated} · byInvoice ${inv} · byFallback ${fb} · unmatched ${un} · preserved ${preserved}`);
console.log("inbox collection count:", await SC.countDocuments({}));
await client.close();
