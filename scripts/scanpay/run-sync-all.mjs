// Full multi-team dispute sync (mirrors src/lib/scanpay/sync.ts + match.ts +
// the engine): fetch every team, match to a CRM job, compute the loss share,
// preserve human decisions (posted/ignored/verified/manual/charged), tag team.
import { readFileSync } from "node:fs";
import { MongoClient, ObjectId } from "mongodb";

const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const val = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const uri = val("MONGODB_URI");
const keys = ["SCANPAY_API_KEY", "SCANPAY_API_KEY_2", "SCANPAY_API_KEY_3", "SCANPAY_API_KEY_4", "SCANPAY_API_KEY_5"]
  .map(val).filter(Boolean).filter((k) => k !== "PASTE_TEAM_TOKEN_HERE");

// ── fetch + merge all teams ──
const byId = new Map();
for (const key of keys) {
  const r = await fetch("https://api.scanpay.tech/connect/v1/disputes", { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  const b = await r.json().catch(() => null);
  for (const d of (b?.data ?? [])) byId.set(d.disputeId, d);
}
const disputes = [...byId.values()];

// ── helpers ──
const ABBR = { street:"st",str:"st",avenue:"ave",av:"ave",boulevard:"blvd",drive:"dr",road:"rd",lane:"ln",court:"ct",place:"pl",terrace:"ter",circle:"cir",parkway:"pkwy",highway:"hwy",square:"sq",trail:"trl",way:"way",north:"n",south:"s",east:"e",west:"w" };
const normAddr = (s) => String(s||"").toLowerCase().replace(/[.,#]/g," ").split(/\s+/).filter(Boolean).map(w=>ABBR[w]??w).join(" ").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const amt = (s) => { const n=parseFloat(String(s||"").replace(/[^0-9.]/g,"")); return Number.isFinite(n)?Math.round(n*100)/100:0; };
const pDate = (s)=>{ const d=new Date(String(s||"").trim()); return isNaN(d)?null:d.toISOString(); };
const outcome = (st)=>{ const s=String(st||"").toLowerCase(); return s.includes("won")?"won":s.includes("lost")?"lost":"pending"; };
const round2 = (x)=>Math.round(x*100)/100;

const client = new MongoClient(uri); await client.connect();
const db = client.db("ag");
const Job=db.collection("Job"), Loc=db.collection("Location"), Prov=db.collection("Provider"), Tech=db.collection("Technician"), Rate=db.collection("finance_technician_rate"), SC=db.collection("finance_scanpay_dispute");

async function effectivePct(t){ if(!t)return 0; const ov=await Rate.findOne({_id:t}); if(ov&&Number.isFinite(Number(ov.dispute_pct)))return Number(ov.dispute_pct); const x=await Tech.findOne({_id:t}); return amt(x?.profitPercent); }

async function matchDispute(raw){
  const inv=String(raw.invoiceNumber||"").trim().toUpperCase().replace(/\s+/g,"");
  if(inv){ const h=await Job.findOne({invoiceNumber:{$regex:`^${esc(inv)}$`,$options:"i"}});
    if(h) return {candidates:[{jobId:String(h._id),score:100,method:"invoice",reason:"invoice exact",address:h.address??null,date:h.date??null,totalAmount:h.totalAmount??null,tech:h.tech??null}],best:0}; }
  const a=amt(raw.amount), street=String(raw.serviceAddress||"").split(",")[0].trim(), sN=normAddr(street);
  if(!sN) return {candidates:[],best:-1};
  const rows=await Job.find({address:{$regex:`^${esc(street.slice(0,24))}`,$options:"i"}}).limit(25).toArray();
  const techs=[...(raw.technicians||[]),raw.collectedBy].map(t=>String(t||"").toLowerCase().trim()).filter(Boolean);
  const dDay=pDate(raw.paymentDate)??pDate(raw.invoiceCreatedAt);
  const cand=rows.map(j=>{let s=0;const r=[];const jA=normAddr(j.address||"");
    if(jA===sN){s+=45;r.push("addr exact");}else if(jA.startsWith(sN)||sN.startsWith(jA)){s+=35;r.push("addr prefix");}
    if((Math.abs((j.totalAmount||0)-a)<1||Math.abs((j.totalPaidCard||0)-a)<1)&&a>0){s+=30;r.push("amount");}
    if(j.tech&&techs.includes(String(j.tech).toLowerCase().trim())){s+=15;r.push("tech");}
    if(dDay&&j.date){const jd=pDate(j.date);if(jd){const dd=Math.abs(new Date(jd)-new Date(dDay))/86400000;if(dd<=3){s+=10;r.push("date");}}}
    return {jobId:String(j._id),score:s,method:"fallback",reason:r.join("+")||"addr region",address:j.address??null,date:j.date??null,totalAmount:j.totalAmount??null,tech:j.tech??null};
  }).sort((x,y)=>y.score-x.score).slice(0,5);
  const best=cand.length===0?-1:cand.length===1&&cand[0].score>=35?0:cand[0].score>=60&&cand[0].score-cand[1].score>=15?0:-1;
  return {candidates:cand,best};
}

async function computeShare(jobId, disputeAmount){
  const or=[{_id:jobId}]; if(/^[0-9a-fA-F]{24}$/.test(jobId))or.push({_id:new ObjectId(jobId)});
  const job=await Job.findOne({$or:or}); if(!job)return {share:null,error:"Job not found"};
  const location=job.location??""; const loc=location?await Loc.findOne({_id:location}):null;
  if(!location)return {share:null,error:"Job has no location"};
  if(!loc)return {share:null,error:`No Location "${location}"`};
  if(!(loc.areaManagerName??"").trim())return {share:null,error:`No AM assigned to "${location}"`};
  if(amt(loc.managerProfitPercent)<=0)return {share:null,error:`"${location}" no managerProfitPercent`};
  const grossTip=amt(job.tipsCard)+amt(job.tipsFinance)+amt(job.tipsCompanyCash)+amt(job.tipsCheck);
  const partsCost=amt(job.techParts)+amt(job.companyParts)+amt(job.lmParts);
  const ta=amt(job.totalAmount);
  const jobAmount=ta>0?ta:amt(job.totalPaidCard)+amt(job.totalPaidCompanyCheck)+amt(job.totalPaidFinance)+amt(job.totalPaidCompanyCash)+amt(job.techPaidCash)+amt(job.lmCash)+amt(job.lmCheck);
  const providerPercent=amt((await Prov.findOne({_id:job.provider}))?.profitPercent);
  const technicianPercent=await effectivePct(job.tech??"");
  const amPool=amt(loc.managerProfitPercent), cardNet=0.95;
  const netTip=grossTip*cardNet, netJob=jobAmount*cardNet, op=Math.max(0,netJob-partsCost);
  const tipRec=Math.min(disputeAmount,netTip), rem=Math.max(0,disputeAmount-netTip);
  const opRec=Math.min(rem,op), partsLoss=Math.min(Math.max(0,rem-op),partsCost);
  const tr=technicianPercent/100, pr=providerPercent/100, ar=amPool/100, cr=Math.max(0,100-providerPercent-amPool)/100;
  const technicianPortion=tipRec+opRec*tr+partsLoss, areaManagerOwnPortion=opRec*(ar-tr);
  return {share:{providerCharge:round2(opRec*pr),technicianPortion:round2(technicianPortion),areaManagerOwnPortion:round2(areaManagerOwnPortion),companyCharge:round2(opRec*cr),amLedgerCharge:round2(technicianPortion+areaManagerOwnPortion),partsLoss:round2(partsLoss),jobCollected:round2(jobAmount+grossTip),jobAmount:round2(jobAmount),grossTip:round2(grossTip)},error:null};
}

const now=new Date().toISOString();
let created=0,updated=0,preserved=0,inv=0,fb=0,un=0;
for(const raw of disputes){
  const core={disputeId:raw.disputeId,transactionId:raw.transactionId,invoiceNumber:raw.invoiceNumber,amount:amt(raw.amount),currency:raw.currency,reason:raw.reason,statusRaw:raw.status,outcome:outcome(raw.status),customerName:raw.customerName,customerPhone:raw.customerPhone,serviceAddress:raw.serviceAddress,technicians:raw.technicians||[],scanpayJobId:raw.jobId,teamId:raw.teamId??null,teamName:raw.teamName??null,disputedAt:pDate(raw.disputedDate),resolvedAt:pDate(raw.resultDate),paymentDate:pDate(raw.paymentDate)??pDate(raw.invoiceCreatedAt),raw,updated_at:now};
  const ex=await SC.findOne({_id:raw.disputeId});
  if(ex&&(ex.matchStatus==="posted"||ex.matchStatus==="ignored"||ex.matchStatus==="verified"||ex.matchMethod==="manual")){ await SC.updateOne({_id:raw.disputeId},{$set:core}); preserved++; updated++; continue; }
  const {candidates,best}=await matchDispute(raw); const b=best>=0?candidates[best]:null;
  if(b?.method==="invoice")inv++; else if(b?.method==="fallback")fb++; else un++;
  let cs=null,ce=null; if(b){ const r=await computeShare(b.jobId,core.amount); cs=r.share; ce=r.error; }
  const mf={matchStatus:b?"matched":"new",matchedJobId:b?.jobId??null,matchMethod:b?.method??null,matchScore:b?.score??null,candidates,computedShare:cs,computeError:ce};
  if(!ex){ await SC.insertOne({_id:raw.disputeId,...core,...mf,postedRecordId:null,ledgerEntryId:null,chargedAt:null,chargedBy:null,synced_at:now}); created++; }
  else { await SC.updateOne({_id:raw.disputeId},{$set:{...core,...mf}}); updated++; }
}
console.log(`teams ${keys.length} · disputes ${disputes.length} · created ${created} · updated ${updated} · preserved ${preserved} · byInvoice ${inv} · byFallback ${fb} · unmatched ${un}`);
console.log("inbox total:", await SC.countDocuments({}));
console.log("per team:", JSON.stringify(await SC.aggregate([{$group:{_id:"$teamId",n:{$sum:1}}}]).toArray()));
await client.close();
