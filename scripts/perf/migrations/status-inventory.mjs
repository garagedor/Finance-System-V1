import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find(l=>l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g,"");
const c=new MongoClient(uri); await c.connect();
const r=await c.db("ag").collection("Job").aggregate([
  {$group:{_id:"$status",n:{$sum:1}}},{$sort:{n:-1}}
]).toArray();
console.log("distinct status values:", r.length);
for(const x of r){ const raw=JSON.stringify(x._id); const trimmed=typeof x._id==="string"?x._id.trim():x._id; const ws=(typeof x._id==="string"&&x._id!==x._id.trim())?" <WHITESPACE>":""; console.log(String(x.n).padStart(6),raw+ws); }
await c.close();
