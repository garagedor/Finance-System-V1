// Financial parity capture harness (READ-ONLY against the app).
// Mints a local admin session (dev JWT secret), fires a fixed set of requests
// at the running dev server, and snapshots each full JSON response + timing.
//
//   node scripts/perf/capture.mjs baseline
//   node scripts/perf/capture.mjs after
//
// Then compare with scripts/perf/parity.mjs. NO writes to the database.
import { MongoClient } from "mongodb";
import { SignJWT } from "jose";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const dir = process.argv[2] || "baseline";
const BASE = "http://localhost:3000";
const OUT = new URL(`../../perf-remediation/${dir}/`, import.meta.url);
mkdirSync(OUT, { recursive: true });

const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find((l) => l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g, "");
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "super-secret-key-for-development");

// Stable stringify (sorted keys) so file diffs are meaningful.
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = stable(v[k]); return o; }, {});
  }
  return v;
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 });
await client.connect();
const db = client.db("ag");

// Maximal permission set = union of every role's permissions (superset admin).
const roles = await db.collection("finance_role").find({}).toArray();
const perms = [...new Set(roles.flatMap((r) => r.permissions ?? []))];
// Pick the two busiest techs so tech-scoped reports return real data.
const techAgg = await db.collection("Job").aggregate([
  { $match: { tech: { $nin: [null, ""] } } },
  { $group: { _id: "$tech", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 2 },
]).toArray();
const topTechs = techAgg.map((t) => t._id);
await client.close();

const token = await new SignJWT({ _id: "perf-admin", name: "Perf Admin", type: "admin", permissions: perms, active: true })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(JWT_SECRET);

const R = "startDate=2026-01-01&endDate=2026-12-31";
const t0 = encodeURIComponent(topTechs[0] ?? "");
const requests = [
  ["home-stats",              `/api/home-stats?${R}`],
  ["stats",                   `/api/stats?${R}`],
  ["finance",                 `/api/finance?${R}`],
  ["payment-method-report",   `/api/payment-method-report?${R}`],
  ["report-penalty",          `/api/report?type=penalty&${R}&calculateTotals=true`],
  ["report-dispute",          `/api/report?type=dispute&${R}&calculateTotals=true`],
  ["report-refund",           `/api/report?type=refund&${R}&calculateTotals=true`],
  ["report-provider",         `/api/report?type=provider&${R}&calculateTotals=true`],
  ["balance-report-tech",     `/api/balance-report?mode=tech&tech=${t0}&${R}`],
  ["balance-report-location", `/api/balance-report?mode=location&${R}`],
  ["disputes",                `/api/disputes`],
  ["refunds",                 `/api/refunds`],
  ["jobs-page1",              `/api/jobs?page=1&pageSize=50&${R}`],
];

const manifest = { dir, capturedFor: R, topTechs, perms: perms.length, results: [] };
console.log(`\n=== CAPTURE → perf-remediation/${dir}/  (${requests.length} requests) ===`);
for (const [slug, path] of requests) {
  const s = process.hrtime.bigint();
  let status = 0, body = null, err = null;
  try {
    const res = await fetch(BASE + path, { headers: { cookie: `session=${token}` } });
    status = res.status;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { __nonjson: text.slice(0, 200) }; }
  } catch (e) { err = e.message; }
  const ms = Math.round(Number(process.hrtime.bigint() - s) / 1e6);
  writeFileSync(new URL(`${slug}.json`, OUT), JSON.stringify(stable(body), null, 2));
  manifest.results.push({ slug, path, status, ms, err });
  console.log(`${status === 200 ? "✓" : "✗"} ${slug.padEnd(26)} ${String(status).padStart(3)}  ${String(ms).padStart(6)}ms${err ? "  ERR " + err : ""}`);
}
writeFileSync(new URL(`_manifest.json`, OUT), JSON.stringify(manifest, null, 2));
console.log(`\nSaved ${requests.length} snapshots + _manifest.json`);
