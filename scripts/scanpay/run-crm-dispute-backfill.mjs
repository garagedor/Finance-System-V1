// Backfill: write a CRM Dispute row for every VERIFIED (or posted) ScanPay
// dispute, so they appear on the CRM Disputes report. _id = scanpay_<disputeId>
// (idempotent). Mirrors upsertCrmDispute in the verify route.
import { readFileSync } from "node:fs"; import { MongoClient } from "mongodb";
const uri=readFileSync("./.env.local","utf8").split("\n").find(l=>l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g,"");
const c=new MongoClient(uri);await c.connect();const db=c.db("ag");
const SC=db.collection("finance_scanpay_dispute"), D=db.collection("Dispute");
const recs=await SC.find({ matchStatus:{$in:["verified","posted"]}, matchedJobId:{$ne:null} }).toArray();
const now=new Date().toISOString();
let up=0, skip=0;
for(const r of recs){
  if(!r.matchedJobId){ skip++; continue; }
  await D.updateOne({ _id:`scanpay_${r.disputeId}` }, { $set:{
    jobId: r.matchedJobId,
    totalDisputed: r.amount,
    disputeDate: r.disputedAt ? r.disputedAt.slice(0,10) : "",
    dueDate: r.raw?.respondBy ? String(r.raw.respondBy).slice(0,10) : "",
    status: r.statusRaw || "",
    dateLost: (r.outcome==="lost" && r.resolvedAt) ? r.resolvedAt.slice(0,10) : "",
    isTechOffset:false, isPrOffset:false,
    scanpayDisputeId: r.disputeId, source:"scanpay", updated_at:now,
  } }, { upsert:true });
  up++;
}
console.log(`verified/posted with job: ${recs.length} · upserted CRM Dispute rows: ${up} · skipped ${skip}`);
console.log("CRM Dispute rows from scanpay:", await D.countDocuments({ source:"scanpay" }));
console.log("CRM Dispute total rows:", await D.countDocuments({}));
await c.close();
