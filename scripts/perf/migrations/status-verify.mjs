import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find(l=>l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g,"");
// mirror src/lib/status-canonical.ts
const ALIASES={"Customer Cenceled":"Customer Canceled"};
const KNOWN=new Set(["Closed","Estimate","X close","Customer Canceled","Cancel by Office","OOA","No answer","Client Fixed It","Pending","Cancel Estimate","Reschedule","Cancel (Time Issue)","Deposit","Price Issue","Refund","Live"]);
const canon=(r)=>{ if(typeof r!=="string")return ""; const t=r.trim(); if(!t)return ""; return ALIASES[t]??t; };
// unit assertions
const cases=[["Client Fixed It ","Client Fixed It"],[" X close","X close"],["Customer Cenceled","Customer Canceled"],["Closed","Closed"],[null,""],["  ",""]];
let ok=0; for(const [i,e] of cases){ const g=canon(i); if(g===e)ok++; else console.log("FAIL",JSON.stringify(i),"->",JSON.stringify(g),"expected",JSON.stringify(e)); }
console.log(`unit map: ${ok}/${cases.length} pass ${ok===cases.length?"✓":"✗"}`);
const c=new MongoClient(uri); await c.connect();
const rows=await c.db("ag").collection("Job").aggregate([{$group:{_id:"$status",n:{$sum:1}}}]).toArray();
let reclassified=0, unknown=[];
console.log("\nnormalizations that would reclassify jobs (impact if reads switch):");
for(const r of rows){ const raw=r._id; const cn=canon(raw); if(typeof raw==="string" && raw!=="" && raw!==cn){ console.log(`  ${r.n.toString().padStart(5)}  ${JSON.stringify(raw)} -> ${JSON.stringify(cn)}`); reclassified+=r.n; } if(cn!=="" && !KNOWN.has(cn)) unknown.push([cn,r.n]); }
console.log(`total jobs reclassified if reads switch: ${reclassified}`);
console.log("unknown statuses (not in canonical vocab):", unknown.length?JSON.stringify(unknown):"none ✓");
await c.close();
