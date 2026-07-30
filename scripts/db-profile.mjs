// Read-only DB profiler. Discovers collections, sizes, indexes, and times
// representative queries + explain plans against live Atlas. NO writes.
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";

// Load MONGODB_URI from .env.local without extra deps
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find((l) => l.startsWith("MONGODB_URI="))?.slice("MONGODB_URI=".length).trim().replace(/^["']|["']$/g, "");
const dbName = "ag";

function ms(t) { return `${(Number(t) / 1e6).toFixed(0)}ms`; } // hrtime bigint ns → ms
async function time(label, fn) {
  const s = process.hrtime.bigint();
  let r, err;
  try { r = await fn(); } catch (e) { err = e.message; }
  const d = Number(process.hrtime.bigint() - s) / 1e6;
  return { label, ms: Math.round(d), err, r };
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 });
const connMs = await time("connect", () => client.connect());
console.log(`\n=== CONNECT: ${connMs.ms}ms ${connMs.err ? "ERR " + connMs.err : "OK"} ===`);
if (connMs.err) process.exit(1);
const db = client.db(dbName);

// 1) Collections: counts + storage + index sizes
const colls = (await db.listCollections().toArray()).map((c) => c.name).sort();
console.log(`\n=== COLLECTIONS (${colls.length}) — count / dataMB / idxMB / #idx ===`);
const big = [];
for (const name of colls) {
  try {
    const st = await db.command({ collStats: name });
    const count = st.count ?? 0;
    const dataMB = (st.size ?? 0) / 1048576;
    const idxMB = (st.totalIndexSize ?? 0) / 1048576;
    const nIdx = st.nindexes ?? 0;
    if (count > 500 || dataMB > 1) big.push({ name, count, dataMB });
    console.log(`${name.padEnd(38)} ${String(count).padStart(8)}  ${dataMB.toFixed(2).padStart(8)}MB ${idxMB.toFixed(2).padStart(7)}MB  ${nIdx}idx`);
  } catch (e) { console.log(`${name.padEnd(38)} (stats err: ${e.message})`); }
}

// 2) Indexes on the big collections
console.log(`\n=== INDEXES on big collections (>500 docs) ===`);
for (const { name, count } of big.sort((a, b) => b.count - a.count)) {
  const idx = await db.collection(name).indexes();
  console.log(`\n${name} (${count} docs):`);
  for (const i of idx) console.log(`  ${i.name}: ${JSON.stringify(i.key)}${i.unique ? " UNIQUE" : ""}${i.sparse ? " sparse" : ""}`);
}

// 3) Sample the biggest collection's doc shape (field names only)
const biggest = big.sort((a, b) => b.count - a.count)[0];
if (biggest) {
  const doc = await db.collection(biggest.name).findOne();
  console.log(`\n=== SAMPLE fields of biggest coll '${biggest.name}' ===`);
  console.log(doc ? Object.keys(doc).join(", ") : "(empty)");
}

// 4) Time representative queries on the biggest collections + explain
console.log(`\n=== QUERY TIMINGS (real, against live Atlas) ===`);
for (const { name, count } of big.sort((a, b) => b.count - a.count).slice(0, 6)) {
  const c = db.collection(name);
  const full = await time(`${name}: find({}).toArray() [FULL SCAN, ${count} docs]`, () => c.find({}).toArray());
  console.log(`${full.label.padEnd(60)} ${String(full.ms).padStart(6)}ms${full.err ? " ERR " + full.err : ""}`);
  const cnt = await time(`${name}: countDocuments({})`, () => c.countDocuments({}));
  console.log(`${cnt.label.padEnd(60)} ${String(cnt.ms).padStart(6)}ms`);
}

await client.close();
console.log("\n=== DONE ===");
