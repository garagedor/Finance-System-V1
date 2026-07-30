// Deep-compare two capture dirs (default baseline vs after). Reports any
// difference in any endpoint's JSON response. Exit 1 on mismatch.
//   node scripts/perf/parity.mjs after            # compares baseline vs after
//   node scripts/perf/parity.mjs after baseline   # explicit
import { readFileSync, readdirSync } from "node:fs";

const afterDir = process.argv[2] || "after";
const baseDir = process.argv[3] || "baseline";
const A = new URL(`../../perf-remediation/${baseDir}/`, import.meta.url);
const B = new URL(`../../perf-remediation/${afterDir}/`, import.meta.url);

const EPS = 1e-6; // tolerate float noise only; business totals must otherwise match
function diff(a, b, path, out) {
  if (a === b) return;
  const ta = a === null ? "null" : typeof a, tb = b === null ? "null" : typeof b;
  if (ta === "number" && tb === "number") {
    if (Math.abs(a - b) > EPS) out.push({ path, base: a, after: b });
    return;
  }
  if (ta !== tb) { out.push({ path, base: a, after: b, note: "type" }); return; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push({ path: `${path}.length`, base: a.length, after: b.length });
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (ta === "object") {
    const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const k of keys) diff(a?.[k], b?.[k], path ? `${path}.${k}` : k, out);
    return;
  }
  out.push({ path, base: a, after: b });
}

const files = readdirSync(A).filter((f) => f.endsWith(".json") && f !== "_manifest.json");
let mismatches = 0;
console.log(`\n=== PARITY  ${baseDir} → ${afterDir}  (${files.length} endpoints) ===`);
for (const f of files) {
  let a, b;
  try { a = JSON.parse(readFileSync(new URL(f, A))); } catch { console.log(`? ${f}: no baseline`); continue; }
  try { b = JSON.parse(readFileSync(new URL(f, B))); } catch { console.log(`✗ ${f}: MISSING in ${afterDir}`); mismatches++; continue; }
  const out = [];
  diff(a, b, "", out);
  if (out.length === 0) { console.log(`✓ ${f.replace(".json", "").padEnd(26)} identical`); }
  else {
    mismatches += out.length;
    console.log(`✗ ${f.replace(".json", "").padEnd(26)} ${out.length} diff(s):`);
    for (const d of out.slice(0, 8)) console.log(`    ${d.path}: ${JSON.stringify(d.base)} → ${JSON.stringify(d.after)}${d.note ? " [" + d.note + "]" : ""}`);
    if (out.length > 8) console.log(`    …and ${out.length - 8} more`);
  }
}
console.log(`\n${mismatches === 0 ? "✅ PARITY HOLDS — all financial outputs identical" : `❌ ${mismatches} MISMATCH(ES) — investigate before continuing`}`);
process.exit(mismatches === 0 ? 0 : 1);
