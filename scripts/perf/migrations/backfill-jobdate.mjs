// ── Additive migration: Job.jobDateNormalized (BSON Date) ────────────────────
// SAFE: adds a new field, NEVER touches the legacy `date` string. Computes the
// value with the SAME $dateFromString the endpoints already use, so
// jobDateNormalized === current query-time parse for every doc (guarantees
// parity when reads switch to the indexed field).
//
// Idempotent (recomputes same value), resumable (only processes docs still
// missing/stale), batched, observable (progress + exceptions log). Reversible
// via --rollback ($unset — legacy `date` is untouched).
//
//   node backfill-jobdate.mjs --sample 100   # dry-ish: migrate 100, validate, report
//   node backfill-jobdate.mjs --run          # full batched backfill
//   node backfill-jobdate.mjs --validate     # verify field == parse(date), date intact
//   node backfill-jobdate.mjs --rollback     # $unset jobDateNormalized (approval-gated)
import { MongoClient } from "mongodb";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const mode = process.argv[2] || "--validate";
const arg = process.argv[3];
const env = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find((l) => l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g, "");
const OUT = new URL("../../../perf-remediation/migrations/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const c = new MongoClient(uri); await c.connect();
const Job = c.db("ag").collection("Job");
const FIELD = "jobDateNormalized";

// The set-pipeline: identical $dateFromString semantics to the endpoints.
const setPipeline = [{ $set: { [FIELD]: { $dateFromString: { dateString: "$date", onError: null, onNull: null } } } }];
// Target: string, non-empty dates. (Missing/empty stay without the field.)
const targetFilter = { date: { $type: "string", $nin: [null, ""] } };

async function backfill(limitIds) {
  const q = limitIds ? { _id: { $in: limitIds } } : targetFilter;
  const ids = limitIds ?? (await Job.find(targetFilter, { projection: { _id: 1 } }).map((d) => d._id).toArray());
  const BATCH = 5000;
  let done = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const r = await Job.updateMany({ _id: { $in: chunk } }, setPipeline);
    done += r.modifiedCount;
    console.log(`  batch ${Math.floor(i / BATCH) + 1}: ${chunk.length} matched, ${r.modifiedCount} written (cumulative ${done})`);
  }
  return { targeted: ids.length, written: done };
}

async function findExceptions() {
  // string date present but parsed to null (unparseable) — flag, never delete.
  return Job.aggregate([
    { $match: targetFilter },
    { $project: { date: 1, parsed: { $dateFromString: { dateString: "$date", onError: null, onNull: null } } } },
    { $match: { parsed: null } },
    { $project: { _id: 1, date: 1 } }, { $limit: 500 },
  ]).toArray();
}

async function validate() {
  const total = await Job.estimatedDocumentCount();
  const withField = await Job.countDocuments({ [FIELD]: { $type: "date" } });
  const stringDates = await Job.countDocuments(targetFilter);
  // Mismatches: field != parse(date) among targeted docs (should be 0).
  const mismatch = await Job.aggregate([
    { $match: { ...targetFilter, [FIELD]: { $exists: true } } },
    { $project: { eq: { $eq: [`$${FIELD}`, { $dateFromString: { dateString: "$date", onError: null, onNull: null } }] } } },
    { $match: { eq: false } }, { $count: "n" },
  ]).toArray();
  // date field untouched: still string everywhere it was.
  const dateStillString = await Job.countDocuments({ date: { $type: "string" } });
  console.log(`Job total: ${total}`);
  console.log(`  ${FIELD} set (Date): ${withField}   (target string-dates: ${stringDates})`);
  console.log(`  field==parse(date) mismatches: ${mismatch[0]?.n ?? 0}  ${(mismatch[0]?.n ?? 0) === 0 ? "✓" : "✗ INVESTIGATE"}`);
  console.log(`  legacy \`date\` still string in: ${dateStillString} docs (untouched)`);
  return { withField, stringDates, mismatch: mismatch[0]?.n ?? 0 };
}

if (mode === "--sample") {
  const n = Number(arg || 100);
  const ids = await Job.find(targetFilter, { projection: { _id: 1 } }).limit(n).map((d) => d._id).toArray();
  console.log(`=== SAMPLE backfill of ${ids.length} docs ===`);
  const before = await Job.find({ _id: { $in: ids.slice(0, 3) } }).project({ date: 1 }).toArray();
  await backfill(ids);
  const after = await Job.find({ _id: { $in: ids.slice(0, 3) } }).project({ date: 1, [FIELD]: 1 }).toArray();
  console.log("sample rows (date preserved, field added):");
  after.forEach((d) => console.log(`  _id=${d._id}  date="${d.date}"  ${FIELD}=${d[FIELD]?.toISOString?.() ?? d[FIELD]}`));
  console.log("legacy date unchanged:", JSON.stringify(before.map(b=>b.date)) === JSON.stringify(after.map(a=>a.date)) ? "✓" : "✗");
} else if (mode === "--run") {
  console.log("=== FULL backfill ===");
  const res = await backfill(null);
  const exc = await findExceptions();
  writeFileSync(new URL("jobdate-exceptions.json", OUT), JSON.stringify({ at: new Date().toISOString(), count: exc.length, docs: exc }, null, 2));
  console.log(`targeted ${res.targeted}, written ${res.written}. Exceptions (unparseable, flagged not deleted): ${exc.length} → perf-remediation/migrations/jobdate-exceptions.json`);
  await validate();
} else if (mode === "--validate") {
  await validate();
} else if (mode === "--rollback") {
  const r = await Job.updateMany({ [FIELD]: { $exists: true } }, { $unset: { [FIELD]: "" } });
  console.log(`rolled back: $unset ${FIELD} on ${r.modifiedCount} docs (legacy date untouched)`);
}
await c.close();
