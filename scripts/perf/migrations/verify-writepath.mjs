import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find(l=>l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g,"");
// same helper as jobs/route.ts
function normalizeJobDate(raw){ if(typeof raw!=="string")return null; const s=raw.trim(); if(!s)return null; const d=new Date(s.slice(0,10)); return Number.isNaN(d.getTime())?null:d; }
const c=new MongoClient(uri); await c.connect(); const Job=c.db("ag").collection("Job");
const docs=await Job.find({ jobDateNormalized:{$type:"date"} }).limit(500).project({date:1,jobDateNormalized:1}).toArray();
let mism=0;
for(const d of docs){ const j=normalizeJobDate(d.date); if(!j || j.getTime()!==d.jobDateNormalized.getTime()){ mism++; if(mism<=5)console.log("MISMATCH",d.date,j?.toISOString(),"vs stored",d.jobDateNormalized.toISOString()); } }
console.log(`write-path helper vs stored backfill: ${docs.length-mism}/${docs.length} match ${mism===0?"✓":"✗"}`);
await c.close();
