/* ═══════════════════════════════════════════════════════════════════════════
   Dispute / refund posting reconciliation — READ ONLY.

   Run:  node --import ./scripts/test-register.mjs scripts/reconcile-disputes.ts
         node --import ./scripts/test-register.mjs scripts/reconcile-disputes.ts --json

   Safe to run at any time, against any environment, as often as you like. It
   issues find / aggregate / count and nothing else: no insert, no update, no
   index creation. It deliberately does NOT import lib/finance-db, because
   that module's ensureFinanceIndexes() creates indexes as a side effect of
   connecting, which a reporting tool has no business doing.

   It answers one question in six parts: where do the inbox, the canonical
   records and the ledger disagree about what has been charged?
   ═══════════════════════════════════════════════════════════════════════════ */

import { MongoClient } from "mongodb";
import { readFileSync, existsSync } from "node:fs";
import { targetOfEntry, type PostingTarget } from "../src/lib/dispute-targets.ts";

const JSON_OUT = process.argv.includes("--json");
const DB_NAME = process.env.MONGODB_DB ?? "ag";

function uri(): string {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  if (existsSync(".env.local")) {
    const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith("MONGODB_URI="));
    if (line) return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("No MONGODB_URI in the environment or .env.local");
}

const num = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const same = (a: number, b: number) => Math.abs(a - b) < 0.01;

interface Finding { code: string; severity: "blocker" | "review" | "note"; subject: string; detail: string }

const findings: Finding[] = [];
const add = (code: string, severity: Finding["severity"], subject: string, detail: string) =>
  findings.push({ code, severity, subject, detail });

const client = new MongoClient(uri(), { retryWrites: false });
await client.connect();
const db = client.db(DB_NAME);

const LE = db.collection("finance_ledger_entry");
const D = db.collection("finance_dispute");
const R = db.collection("finance_refund");
const SPD = db.collection("finance_scanpay_dispute");
const SPR = db.collection("finance_scanpay_refund");

/* ── Load once, analyse in memory. The collections are small and this keeps
      the whole report to a handful of round trips. ── */
const entries = await LE.find({ dispute_id: { $type: "string" } }).toArray();
const reversalRows = await LE.find({ reverses_id: { $type: "string" } }, { projection: { reverses_id: 1 } }).toArray();
const reversed = new Set(reversalRows.map((r) => String(r["reverses_id"])));
const disputes = await D.find({}).toArray();
const refunds = await R.find({}).toArray();
const spDisputes = await SPD.find({}).toArray();
const spRefunds = await SPR.find({}).toArray();

const partyOf = (e: Record<string, unknown>): PostingTarget => {
  const nested = (e["charge_snapshot"] as Record<string, unknown> | null)?.["posted_party"];
  return targetOfEntry({
    _id: String(e["_id"]), ledger_id: String(e["ledger_id"]), amount: num(e["amount"]),
    posted_party: (e["posted_party"] ?? (typeof nested === "string" ? nested : null)) as PostingTarget | null,
  });
};

const entriesByRecord = new Map<string, Record<string, unknown>[]>();
for (const e of entries) {
  const k = String(e["dispute_id"]);
  entriesByRecord.set(k, [...(entriesByRecord.get(k) ?? []), e]);
}
const liveEntriesOf = (recordId: string) =>
  (entriesByRecord.get(recordId) ?? []).filter((e) => !reversed.has(String(e["_id"])));

const recordIds = new Set([...disputes, ...refunds].map((r) => String(r._id)));
const pointedAt = new Set(
  [...spDisputes, ...spRefunds].map((s) => s["postedRecordId"]).filter((x): x is string => typeof x === "string"),
);

/* ── 1. Marked charged, nothing linked ──────────────────────────────── */
for (const [kind, rows, amtOf] of [
  ["dispute", spDisputes, (s: Record<string, unknown>) => num(s["amount"])],
  ["refund", spRefunds, (s: Record<string, unknown>) => num(s["refundAmount"] ?? s["originalAmount"])],
] as const) {
  for (const s of rows) {
    if (!s["chargedAt"] || s["postedRecordId"]) continue;
    add("CHARGED_NOT_LINKED", "review", String(s["_id"]),
      `${kind} marked charged on ${String(s["chargedAt"]).slice(0, 10)} by ${String(s["chargedBy"] ?? "?")}, ` +
      `no postedRecordId · job ${String(s["matchedJobId"] ?? "—")} · $${amtOf(s)} · status ${String(s["matchStatus"])}`);
  }
}

/* ── 2. Two canonical records for one economic dispute ──────────────── */
for (const [kind, rows, amtField] of [
  ["dispute", disputes, "amount_disputed"], ["refund", refunds, "amount"],
] as const) {
  const byJob = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const j = r["job_id"];
    if (typeof j !== "string") continue;
    byJob.set(j, [...(byJob.get(j) ?? []), r]);
  }
  for (const [job, group] of byJob) {
    if (group.length < 2) continue;
    const seen = new Set<string>();
    for (const a of group) {
      const twins = group.filter((b) => b !== a && same(num(b[amtField]), num(a[amtField])));
      if (twins.length === 0) continue;
      const key = [String(a._id), ...twins.map((t) => String(t._id))].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const parts = [a, ...twins].map((r) => {
        const live = liveEntriesOf(String(r._id));
        return `${String(r._id)}→${live.length ? live.map(partyOf).join("+") : "no-entry"}`;
      });
      add("DUPLICATE_RECORDS", "review", job,
        `${kind}: ${[a, ...twins].length} records at $${num(a[amtField])} · ${parts.join(" | ")}`);
    }
  }
}

/* ── 3. A ledger entry nothing in the inbox knows about ─────────────── */
for (const [recordId, es] of entriesByRecord) {
  if (pointedAt.has(recordId)) continue;
  const live = es.filter((e) => !reversed.has(String(e["_id"])));
  if (live.length === 0) continue;
  add("LEDGER_NOT_LINKED", "note", recordId,
    `${live.length} live ledger entr${live.length === 1 ? "y" : "ies"} (${live.map(partyOf).join(", ")}) ` +
    `on a record no inbox item points at`);
}

/* ── 4. postedRecordId pointing at nothing, or at the wrong thing ───── */
for (const [kind, rows, recs, amtOf, amtField] of [
  ["dispute", spDisputes, disputes, (s: Record<string, unknown>) => num(s["amount"]), "amount_disputed"],
  ["refund", spRefunds, refunds, (s: Record<string, unknown>) => num(s["refundAmount"] ?? s["originalAmount"]), "amount"],
] as const) {
  for (const s of rows) {
    const id = s["postedRecordId"];
    if (typeof id !== "string") continue;
    if (!recordIds.has(id)) {
      add("LINK_DANGLING", "blocker", String(s["_id"]), `${kind} points at ${id}, which does not exist`);
      continue;
    }
    const rec = recs.find((r) => String(r._id) === id);
    if (!rec) continue;
    if (s["matchedJobId"] && rec["job_id"] && s["matchedJobId"] !== rec["job_id"]) {
      add("LINK_WRONG_JOB", "blocker", String(s["_id"]),
        `${kind} is matched to job ${String(s["matchedJobId"])} but its record ${id} is on ${String(rec["job_id"])}`);
    }
    if (!same(amtOf(s), num(rec[amtField]))) {
      add("LINK_AMOUNT_DRIFT", "review", String(s["_id"]),
        `${kind} is $${amtOf(s)} but its record ${id} is $${num(rec[amtField])}`);
    }
  }
}

/* ── 5. The same party charged twice on one record ──────────────────── */
for (const [recordId] of entriesByRecord) {
  const live = liveEntriesOf(recordId);
  const byTarget = new Map<PostingTarget, string[]>();
  for (const e of live) {
    const t = partyOf(e);
    byTarget.set(t, [...(byTarget.get(t) ?? []), String(e["_id"])]);
  }
  for (const [t, ids] of byTarget) {
    if (ids.length > 1) {
      add("TARGET_CHARGED_TWICE", "blocker", recordId, `${t} has ${ids.length} live entries: ${ids.join(", ")}`);
    }
  }
  // combined overlapping its own parts is the other way to charge twice
  const live2 = new Set([...byTarget.keys()]);
  if (live2.has("combined") && (live2.has("area_manager") || live2.has("technician"))) {
    add("TARGET_CHARGED_TWICE", "blocker", recordId,
      `combined coexists with ${[...live2].filter((x) => x !== "combined").join("+")}, which it already contains`);
  }
}

/* ── 6. A reversal that reopened a target ───────────────────────────── */
for (const [recordId, es] of entriesByRecord) {
  const liveTargets = new Set(liveEntriesOf(recordId).map(partyOf));
  for (const e of es) {
    if (!reversed.has(String(e["_id"]))) continue;
    const t = partyOf(e);
    if (!liveTargets.has(t)) {
      add("REVERSAL_REOPENED", "note", recordId,
        `${t} was charged (${String(e["_id"])}) and reversed, with nothing live in its place — chargeable again`);
    }
  }
}

await client.close();

/* ── Report ─────────────────────────────────────────────────────────── */
const ORDER: Finding["severity"][] = ["blocker", "review", "note"];
const byCode = new Map<string, Finding[]>();
for (const f of findings) byCode.set(f.code, [...(byCode.get(f.code) ?? []), f]);

if (JSON_OUT) {
  console.log(JSON.stringify({
    at: new Date().toISOString(), db: DB_NAME,
    counts: Object.fromEntries([...byCode].map(([k, v]) => [k, v.length])),
    findings,
  }, null, 2));
} else {
  console.log(`\nDispute posting reconciliation · ${DB_NAME} · ${new Date().toISOString()}`);
  console.log(`ledger entries ${entries.length} · dispute records ${disputes.length} · refund records ${refunds.length} ` +
    `· inbox ${spDisputes.length + spRefunds.length}\n`);
  if (findings.length === 0) console.log("  Nothing to reconcile.\n");
  for (const sev of ORDER) {
    const group = findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    console.log(`── ${sev.toUpperCase()} (${group.length}) ──`);
    for (const f of group) console.log(`  [${f.code}] ${f.subject}\n      ${f.detail}`);
    console.log("");
  }
  console.log("summary: " + ([...byCode].map(([k, v]) => `${k}=${v.length}`).join("  ") || "clean"));
  console.log("\n(read-only — nothing was written)\n");
}
