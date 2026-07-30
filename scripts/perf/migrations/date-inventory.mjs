// READ-ONLY inventory of Job.date formats before any migration.
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find(l=>l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g,"");
const c = new MongoClient(uri); await c.connect(); const db = c.db("ag");
const Job = db.collection("Job");
const total = await Job.estimatedDocumentCount();

// Field presence + type
const missing = await Job.countDocuments({ date: { $in: [null, ""] } });
const noField = await Job.countDocuments({ date: { $exists: false } });
const asDate = await Job.countDocuments({ date: { $type: "date" } });
const asString = await Job.countDocuments({ date: { $type: "string" } });
const hasLegacy = await Job.countDocuments({ date_legacy: { $exists: true } });

// Classify string formats via $regexMatch
const cls = await Job.aggregate([
  { $match: { date: { $type: "string", $nin: [null, ""] } } },
  { $project: { kind: { $switch: { branches: [
    { case: { $regexMatch: { input: "$date", regex: /^\d{4}-\d{2}-\d{2}$/ } }, then: "ISO yyyy-mm-dd" },
    { case: { $regexMatch: { input: "$date", regex: /^\d{4}-\d{2}-\d{2}T/ } }, then: "ISO datetime" },
    { case: { $regexMatch: { input: "$date", regex: /^\d{1,2}\/\d{1,2}\/\d{4}$/ } }, then: "M/D/YYYY" },
    { case: { $regexMatch: { input: "$date", regex: /^\d{1,2}\/\d{1,2}\/\d{2}$/ } }, then: "M/D/YY" },
  ], default: "OTHER" } } } },
  { $group: { _id: "$kind", n: { $sum: 1 } } }, { $sort: { n: -1 } },
]).toArray();

// How many parse to a valid Date via $dateFromString (the app's current method)?
const parseable = await Job.aggregate([
  { $project: { ok: { $ne: [ { $dateFromString: { dateString: "$date", onError: null, onNull: null } }, null ] } } },
  { $group: { _id: "$ok", n: { $sum: 1 } } },
]).toArray();

// Sample a few OTHER values for eyeballing
const others = await Job.aggregate([
  { $match: { date: { $type: "string", $nin: [null, ""] } } },
  { $match: { $expr: { $not: { $regexMatch: { input: "$date", regex: /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/ } } } } },
  { $limit: 8 }, { $project: { _id: 0, date: 1 } },
]).toArray();

console.log("Job total:", total);
console.log("  date is BSON Date:", asDate, "| string:", asString, "| missing/empty:", missing, "| no field:", noField);
console.log("  docs with date_legacy field:", hasLegacy);
console.log("\nString format classes:");
for (const k of cls) console.log(`  ${String(k.n).padStart(6)}  ${k._id}`);
console.log("\n$dateFromString parse result:");
for (const p of parseable) console.log(`  ${p._id===true?"parses OK ":p._id===false?"parses NULL":"(null date)"}: ${p.n}`);
console.log("\nSample non-standard date values:", others.map(o=>JSON.stringify(o.date)).join(", ") || "(none)");
await c.close();
