import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find(l=>l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g,"");
const c=new MongoClient(uri); await c.connect(); const Job=c.db("ag").collection("Job");
function plan(ex){const s=JSON.stringify(ex.queryPlanner?.winningPlan);const st=ex.executionStats;return `${s.includes("IXSCAN")?"IXSCAN":"COLLSCAN"} examined=${st.totalDocsExamined} returned=${st.nReturned} ${st.executionTimeMillis}ms`;}
// NEW indexed query, 1-week range
const wk={ jobDateNormalized:{ $gte:new Date("2026-07-01"), $lte:new Date("2026-07-08") } };
console.log("NEW (indexed) 1-week:", plan(await Job.find(wk).explain("executionStats")));
// OLD-style $expr query, 1-week range (what it did before the switch)
const oldWk=[{ $match:{ $expr:{ $and:[
  {$gte:[{$dateFromString:{dateString:"$date",onError:new Date(0)}},new Date("2026-07-01")]},
  {$lte:[{$dateFromString:{dateString:"$date",onError:new Date(0)}},new Date("2026-07-08")]},
]}}}];
const oe=await Job.aggregate([...oldWk,{$count:"n"}],{explain:false}).toArray();
const oex=await Job.aggregate(oldWk).explain("executionStats");
const st=oex.stages?.[0]?.$cursor?.executionStats ?? oex.executionStats;
console.log("OLD ($expr) 1-week:   COLLSCAN examined="+(st?.totalDocsExamined??"?")+" matched="+(oe[0]?.n??0));
await c.close();
