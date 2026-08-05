// Fetch a REAL sample of the ScanPay disputes response so we can build the
// ingestion against the true schema. Reads SCANPAY_API_KEY from .env.local —
// the token is NEVER printed and never enters the chat. Prints only the HTTP
// status, useful headers, and the first couple of dispute objects (your data).
//
//   node scripts/scanpay/fetch-sample.mjs
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const line = env.split("\n").find((l) => l.startsWith("SCANPAY_API_KEY="));
const key = line ? line.slice("SCANPAY_API_KEY=".length).trim().replace(/^["']|["']$/g, "") : "";
if (!key) {
  console.error("SCANPAY_API_KEY not found in .env.local — add it in your own terminal first.");
  process.exit(1);
}

const URL_ = "https://api.scanpay.tech/connect/v1/disputes";
const res = await fetch(URL_, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
console.log("HTTP", res.status, res.statusText);
console.log("content-type:", res.headers.get("content-type"));
for (const h of ["x-total-count", "link", "x-scanpay-seq", "x-next", "ratelimit-remaining"]) {
  const v = res.headers.get(h);
  if (v) console.log(`${h}: ${v}`);
}

const text = await res.text();
let json;
try { json = JSON.parse(text); } catch { console.log("\nRAW (not JSON):\n", text.slice(0, 2000)); process.exit(0); }

// Describe the shape without dumping everything.
const topKeys = Array.isArray(json) ? `Array(${json.length})` : `Object{ ${Object.keys(json).join(", ")} }`;
console.log("\nTop-level:", topKeys);

// Find the array of disputes wherever it lives.
const list = Array.isArray(json) ? json
  : Array.isArray(json.disputes) ? json.disputes
  : Array.isArray(json.data) ? json.data
  : Array.isArray(json.items) ? json.items
  : null;

if (!list) { console.log("\nFull (small) response:\n", JSON.stringify(json, null, 2).slice(0, 3000)); process.exit(0); }

console.log(`\nDisputes found: ${list.length}`);
console.log("\n=== first 2 dispute objects (your data) ===");
console.log(JSON.stringify(list.slice(0, 2), null, 2));

// Key/type map from the first object, to design the mapping.
if (list[0]) {
  console.log("\n=== field → type (first dispute) ===");
  for (const [k, v] of Object.entries(list[0])) {
    const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    console.log(`  ${k}: ${t}`);
  }
}
