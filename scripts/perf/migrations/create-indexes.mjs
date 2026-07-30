// Additive index creation on Job, with before/after explain evidence. No drops.
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find(l=>l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g,"");
const c = new MongoClient(uri); await c.connect(); const Job = c.db("ag").collection("Job");
const range = { jobDateNormalized: { $gte: new Date("2026-01-01"), $lte: new Date("2026-12-31") } };
function plan(ex){const s=JSON.stringify(ex.queryPlanner?.winningPlan);const st=ex.executionStats;return `${s.includes("IXSCAN")?"IXSCAN":s.includes("COLLSCAN")?"COLLSCAN":"?"} examined=${st.totalDocsExamined} returned=${st.nReturned} ${st.executionTimeMillis}ms`;}
console.log("BEFORE index:", plan(await Job.find(range).explain("executionStats")));
console.log("creating indexes (background)…");
const before = await Job.indexes();
await Job.createIndex({ jobDateNormalized: -1 }, { name: "jobDateNormalized_-1" });
await Job.createIndex({ tech: 1, jobDateNormalized: -1 }, { name: "tech_1_jobDateNormalized_-1" });
await Job.createIndex({ status: 1, jobDateNormalized: -1 }, { name: "status_1_jobDateNormalized_-1" });
await Job.createIndex({ location: 1, jobDateNormalized: -1 }, { name: "location_1_jobDateNormalized_-1" });
console.log("AFTER index: ", plan(await Job.find(range).explain("executionStats")));
const after = await Job.indexes();
console.log(`indexes: ${before.length} → ${after.length}`);
for (const i of after) console.log(`  ${i.name}: ${JSON.stringify(i.key)}`);
const stats = await c.db("ag").command({ collStats: "Job" });
console.log(`total index size: ${(stats.totalIndexSize/1048576).toFixed(2)} MB`);
await c.close();
