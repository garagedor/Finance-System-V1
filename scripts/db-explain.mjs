// Read-only: explain() representative Job queries to prove COLLSCAN vs IXSCAN
// and measure realistic report-shaped query costs. NO writes.
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find((l) => l.startsWith("MONGODB_URI=")).slice("MONGODB_URI=".length).trim().replace(/^["']|["']$/g, "");
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 });
await client.connect();
const db = client.db("ag");
const Job = db.collection("Job");

async function timed(label, fn) {
  const s = process.hrtime.bigint();
  const r = await fn();
  const d = Number(process.hrtime.bigint() - s) / 1e6;
  console.log(`  ⏱  ${label}: ${Math.round(d)}ms`);
  return r;
}
function planSummary(ex) {
  const st = ex.executionStats ?? {};
  const win = ex.queryPlanner?.winningPlan ?? {};
  // find the stage type (COLLSCAN vs IXSCAN)
  let stage = win.stage || win.inputStage?.stage || win.queryPlan?.stage || JSON.stringify(win).slice(0, 60);
  const s = JSON.stringify(win);
  const kind = s.includes("IXSCAN") ? "IXSCAN" : s.includes("COLLSCAN") ? "COLLSCAN" : stage;
  return `plan=${kind}  examined=${st.totalDocsExamined}  returned=${st.nReturned}  execMs=${st.executionTimeMillis}`;
}

// Representative real report queries (2026 date range, status/tech grouping)
const dateRange = { date: { $gte: "2026-01-01", $lte: "2026-12-31" } };

console.log("\n=== Q1: date-range find (report/stats shape) ===");
let ex = await Job.find(dateRange).explain("executionStats");
console.log("  " + planSummary(ex));
await timed("date-range find().toArray()", () => Job.find(dateRange).toArray());

console.log("\n=== Q2: status filter (e.g. dashboard 'unpaid/open') ===");
ex = await Job.find({ status: "Done" }).explain("executionStats");
console.log("  " + planSummary(ex));

console.log("\n=== Q3: single-tech lookup (per-tech report / N+1 shape) ===");
const someTech = (await Job.findOne())?.tech ?? "";
ex = await Job.find({ tech: someTech }).explain("executionStats");
console.log("  " + planSummary(ex) + `  (tech='${someTech}')`);

console.log("\n=== Q4: aggregation group-by-tech SUM (balance-report shape) ===");
const aggMs0 = process.hrtime.bigint();
const agg = await Job.aggregate([
  { $match: dateRange },
  { $group: { _id: "$tech", total: { $sum: "$totalAmount" }, jobs: { $sum: 1 } } },
  { $sort: { total: -1 } },
]).toArray();
console.log(`  ⏱  aggregate group-by-tech: ${Math.round(Number(process.hrtime.bigint() - aggMs0) / 1e6)}ms → ${agg.length} techs`);

console.log("\n=== Q5: distinct statuses / date span present ===");
const statuses = await Job.distinct("status");
console.log("  statuses:", statuses.slice(0, 12).join(", "));
const minD = await Job.find().sort({ date: 1 }).limit(1).next();
const maxD = await Job.find().sort({ date: -1 }).limit(1).next();
console.log(`  date span: ${minD?.date} → ${maxD?.date}`);
ex = await Job.find().sort({ date: -1 }).limit(50).explain("executionStats");
console.log("  sort-by-date(no index) top50: " + planSummary(ex));

await client.close();
console.log("\n=== DONE ===");
