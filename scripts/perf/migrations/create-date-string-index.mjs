import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find(l=>l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g,"");
const c=new MongoClient(uri); await c.connect(); const Job=c.db("ag").collection("Job");
function plan(ex){const s=JSON.stringify(ex.queryPlanner?.winningPlan);const st=ex.executionStats;return `${s.includes("IXSCAN")?"IXSCAN":"COLLSCAN"} examined=${st.totalDocsExamined} ${st.executionTimeMillis}ms`;}
const strRange={ date:{ $gte:"2026-07-01", $lte:"2026-07-08" } };
console.log("string-date 1-week BEFORE:", plan(await Job.find(strRange).explain("executionStats")));
await Job.createIndex({ date: 1 }, { name: "date_1" });
console.log("string-date 1-week AFTER: ", plan(await Job.find(strRange).explain("executionStats")));
console.log("indexes now:", (await Job.indexes()).map(i=>i.name).join(", "));
await c.close();
