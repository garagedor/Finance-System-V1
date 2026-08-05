// Full multi-team refund sync (mirrors src/lib/scanpay/refund-sync.ts): fetch
// refunded payments from every team, match to a CRM job (invoice exact; amount
// fallback), compute the loss share for matched, preserve human decisions.
import { readFileSync } from "node:fs";
import { MongoClient, ObjectId } from "mongodb";

const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const val = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const uri = val("MONGODB_URI");
const keys = ["SCANPAY_API_KEY", "SCANPAY_API_KEY_2", "SCANPAY_API_KEY_3", "SCANPAY_API_KEY_4", "SCANPAY_API_KEY_5"]
  .map(val).filter(Boolean).filter((k) => k !== "PASTE_TEAM_TOKEN_HERE");

// ── fetch + merge refunded payments across teams ──
const byId = new Map();
for (const key of keys) {
  for (let page = 0; page < 200; page++) {
    const r = await fetch(`https://api.scanpay.tech/connect/v1/payments?status=REFUNDED&page=${page}`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
    const b = await r.json().catch(() => null);
    const rows = b?.data?.payments ?? [];
    if (!rows.length) break;
    for (const p of rows) byId.set(p.id, p);
    if (byId.size >= (b?.data?.totalCount ?? 0) && page > 0) { /* per-key total unknown across merge; keep paging until empty */ }
  }
}
const refunds = [...byId.values()];

const amt = (s) => { const n = parseFloat(String(s || "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const pDate = (s) => { const d = new Date(String(s || "").trim()); return isNaN(d) ? null : d.toISOString(); };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normInv = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");
const round2 = (x) => Math.round(x * 100) / 100;

const client = new MongoClient(uri); await client.connect();
const db = client.db("ag");
const Job = db.collection("Job"), Loc = db.collection("Location"), Prov = db.collection("Provider"), Tech = db.collection("Technician"), Rate = db.collection("finance_technician_rate"), SR = db.collection("finance_scanpay_refund");
await SR.createIndex({ paymentId: 1 }, { unique: true }).catch(() => {});

async function effectivePct(t){ if(!t)return 0; const ov=await Rate.findOne({_id:t}); if(ov&&Number.isFinite(Number(ov.dispute_pct)))return Number(ov.dispute_pct); const x=await Tech.findOne({_id:t}); return amt(x?.profitPercent); }
async function computeShare(jobId, refundAmount){
  const or=[{_id:jobId}]; if(/^[0-9a-fA-F]{24}$/.test(jobId))or.push({_id:new ObjectId(jobId)});
  const job=await Job.findOne({$or:or}); if(!job)return {share:null,error:"Job not found"};
  const loc=job.location?await Loc.findOne({_id:job.location}):null;
  if(!job.location)return {share:null,error:"no location"};
  if(!loc)return {share:null,error:"no Location record"};
  if(!(loc.areaManagerName??"").trim())return {share:null,error:"no AM assigned"};
  if(amt(loc.managerProfitPercent)<=0)return {share:null,error:"no managerProfitPercent"};
  const grossTip=amt(job.tipsCard)+amt(job.tipsFinance)+amt(job.tipsCompanyCash)+amt(job.tipsCheck);
  const partsCost=amt(job.techParts)+amt(job.companyParts)+amt(job.lmParts);
  const ta=amt(job.totalAmount);
  const jobAmount=ta>0?ta:amt(job.totalPaidCard)+amt(job.totalPaidCompanyCheck)+amt(job.totalPaidFinance)+amt(job.totalPaidCompanyCash)+amt(job.techPaidCash)+amt(job.lmCash)+amt(job.lmCheck);
  const providerPercent=amt((await Prov.findOne({_id:job.provider}))?.profitPercent);
  const technicianPercent=await effectivePct(job.tech??"");
  const amPool=amt(loc.managerProfitPercent), cardNet=0.95;
  const netTip=grossTip*cardNet, netJob=jobAmount*cardNet, op=Math.max(0,netJob-partsCost);
  const tipRec=Math.min(refundAmount,netTip), rem=Math.max(0,refundAmount-netTip);
  const opRec=Math.min(rem,op), partsLoss=Math.min(Math.max(0,rem-op),partsCost);
  const tr=technicianPercent/100,pr=providerPercent/100,ar=amPool/100,cr=Math.max(0,100-providerPercent-amPool)/100;
  const technicianPortion=tipRec+opRec*tr+partsLoss, amOwn=opRec*(ar-tr);
  return {share:{providerCharge:round2(opRec*pr),technicianPortion:round2(technicianPortion),areaManagerOwnPortion:round2(amOwn),companyCharge:round2(opRec*cr),amLedgerCharge:round2(technicianPortion+amOwn),partsLoss:round2(partsLoss)},error:null};
}

const now=new Date().toISOString();
let created=0,updated=0,preserved=0,inv=0,un=0;
for(const raw of refunds){
  const c0={paymentId:raw.id,invoiceId:raw.invoiceId,invoiceNumber:raw.invoiceNumber,originalAmount:amt(raw.amount),paymentDate:pDate(raw.createdAt),paymentMethod:raw.paymentMethod,raw,updated_at:now};
  const ex=await SR.findOne({_id:raw.id});
  if(ex&&(ex.matchStatus==="posted"||ex.matchStatus==="ignored"||ex.matchStatus==="verified"||ex.matchMethod==="manual")){ await SR.updateOne({_id:raw.id},{$set:c0}); preserved++; updated++; continue; }
  let candidates=[],best=null;
  const ninv=normInv(raw.invoiceNumber);
  if(ninv){ const h=await Job.findOne({invoiceNumber:{$regex:`^${esc(ninv)}$`,$options:"i"}});
    if(h){ best={jobId:String(h._id),score:100,method:"invoice",reason:"invoice exact",address:h.address??null,date:h.date??null,totalAmount:h.totalAmount??null,tech:h.tech??null}; candidates=[best]; } }
  if(!best){ const a=amt(raw.amount); if(a>0){ const rows=await Job.find({$or:[{totalAmount:a},{totalPaidCard:a}]}).limit(10).toArray();
    candidates=rows.slice(0,5).map(j=>({jobId:String(j._id),score:40,method:"fallback",reason:"amount match",address:j.address??null,date:j.date??null,totalAmount:j.totalAmount??null,tech:j.tech??null})); } }
  if(best?.method==="invoice")inv++; else un++;
  let cs=null,ce=null; if(best){ const r=await computeShare(best.jobId,c0.originalAmount); cs=r.share; ce=r.error; }
  const mf={matchStatus:best?"matched":"new",matchedJobId:best?.jobId??null,matchMethod:best?.method??null,matchScore:best?.score??null,candidates,computedShare:cs,computeError:ce};
  if(!ex){ await SR.insertOne({_id:raw.id,...c0,refundAmount:null,refundDate:null,...mf,postedRecordId:null,ledgerEntryId:null,chargedAt:null,chargedBy:null,synced_at:now}); created++; }
  else { await SR.updateOne({_id:raw.id},{$set:{...c0,...mf}}); updated++; }
}
console.log(`teams ${keys.length} · refunds ${refunds.length} · created ${created} · updated ${updated} · preserved ${preserved} · byInvoice ${inv} · unmatched ${un}`);
console.log("refund inbox total:", await SR.countDocuments({}));
await client.close();
