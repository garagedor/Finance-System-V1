import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const line = env.split("\n").find((l) => l.startsWith("SCANPAY_API_KEY="));
const key = line ? line.slice("SCANPAY_API_KEY=".length).trim().replace(/^["']|["']$/g, "") : "";
const BASE = "https://api.scanpay.tech";
const get = async (p) => { const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } }); return { status: r.status, body: await r.json().catch(() => null) }; };

for (const p of ["/connect/v1/payments", "/connect/v1/invoices"]) {
  const { status, body } = await get(p);
  const list = body?.data ?? [];
  console.log(`\n===== ${p}  (HTTP ${status}) — ${list.length} rows, meta ${JSON.stringify(body?.meta ?? {})} =====`);
  if (!list.length) continue;

  console.log("field → type (first row):");
  for (const [k, v] of Object.entries(list[0])) console.log(`  ${k}: ${v === null ? "null" : Array.isArray(v) ? "array" : typeof v}  =  ${JSON.stringify(v)?.slice(0, 60)}`);

  // Look for anything refund-ish across all rows.
  const refundKeys = new Set();
  const statusVals = new Set();
  let refundedRows = 0;
  for (const r of list) {
    for (const [k, v] of Object.entries(r)) {
      if (/refund|return|credit|reversal/i.test(k)) refundKeys.add(k);
      if (/refund|return|reversal/i.test(String(v))) refundKeys.add(`${k}(value)`);
    }
    if (r.status) statusVals.add(r.status);
    if (Object.entries(r).some(([k, v]) => /refund/i.test(k) && v && v !== "0" && v !== 0)) refundedRows++;
  }
  console.log("refund-ish keys/values seen:", [...refundKeys].join(", ") || "(none)");
  console.log("distinct status values:", [...statusVals].join(" | "));
  console.log("rows with a non-zero refund field:", refundedRows);

  // Show one row that looks refunded, if any.
  const sample = list.find((r) => Object.entries(r).some(([k, v]) => /refund/i.test(k) && v && v !== "0" && v !== 0))
    || list.find((r) => /refund/i.test(String(r.status)));
  if (sample) console.log("sample refunded row:\n", JSON.stringify(sample, null, 2).slice(0, 1500));
}
