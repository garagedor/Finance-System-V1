import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find(l=>l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g,"");
const c = new MongoClient(uri); await c.connect(); const db = c.db("ag");
// Replicate the exact correlated lookup, count jobs whose providerData matches >1 doc.
const r = await db.collection("Job").aggregate([
  { $match: { $expr: { $and: [
    { $gte: [ { $dateFromString: { dateString: '$date', onError: new Date(0) } }, new Date('2026-01-01') ] },
    { $lte: [ { $dateFromString: { dateString: '$date', onError: new Date(0) } }, new Date('2026-12-31') ] },
  ] } } },
  { $lookup: { from: 'Provider', let: { p: '$provider' }, pipeline: [
     { $match: { $expr: { $or: [ { $eq: ['$_id','$$p'] }, { $eq: ['$name','$$p'] } ] } } }
  ], as: 'pd' } },
  { $group: { _id: { $size: '$pd' }, jobs: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]).toArray();
console.log("providerData matches per job (matchCount → #jobs):");
for (const x of r) console.log(`  ${x._id} match(es) → ${x.jobs} jobs`);
await c.close();
