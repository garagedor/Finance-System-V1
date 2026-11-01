/**
 * Shadow-validation preflight: one command, one PASS/FAIL line per check.
 *
 *   node --env-file=<file with ARENA_CRM_RO_URI> --import ./scripts/arena/transpile-register.mjs \
 *     scripts/arena/shadow-preflight.ts [--out <dir>] [--shadow-dir <dir>] [--template <templateId>] \
 *     [--print-only] [--arena-ports 3000,3999,5173] [--min-free-gb 1] [--no-clock-check]
 *
 *   F1  read-only guard for ARENA_CRM_RO_URI (find only on the CRM db; not lbs_crm_app / lbs_ops; no built-in role, not even `read`)
 *   F2  the server refuses a write probe (13) and a non-granted collection (13); the in-process proxy blocks writes
 *   F3  Job, Technician, Location, Provider, TechNameMapping readable (User optional → note)
 *   F4  local Arena state: 127.0.0.1 only, reachable
 *   F5  rules that will be used (summary + SHA-256 fingerprint) = owner-confirmed <shadow-dir>/approved-rules.sha256
 *       (absent: FAIL "owner has not confirmed rules yet", or INFO with --print-only)
 *   F6  data-review decisions <shadow-dir>/decisions.json present and valid
 *   F7  technician access OFF: no ARENA_TECH_ENABLED / Weekly Balance / Supabase variables; nothing on a public interface on the Arena ports
 *   F8  output folder exists, mode 700, outside any git repository
 *   F9  free disk ≥ 1 GB; clock within 2 min of an HTTPS Date header (SKIP when offline)
 *
 * Reads only. Exit 0 when nothing FAILs, 1 otherwise. Never prints the URI.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { MongoClient } from "mongodb";
import { accessProbes, assertLocalMongoUri, openGuardedCrm, type GuardedCrm } from "./lib-ro-guard.ts";
import {
  DEFAULT_ARENA_PORTS, DEFAULT_SHADOW_DIR, MAX_CLOCK_SKEW_MS, clockSkew, decisionsSummary, outputDirProblems, parseListeners,
  publicArenaListeners, readDecisionsFile, readFingerprintFile, rulesFingerprint, rulesSummary, techAccessEnvVars,
} from "./lib-shadow.ts";
import { SEED_BALANCED_PERFORMANCE, cloneRules } from "../../src/lib/arena/config.ts";
import { ARENA_COLLECTIONS } from "../../src/lib/arena/mongo-store.ts";
import type { ArenaRules } from "../../src/lib/arena/types.ts";

const REQUIRED = ["Job", "Technician", "Location", "Provider", "TechNameMapping"];
const CLOCK_URLS = ["https://www.google.com", "https://www.cloudflare.com"];

function parseArgs(argv: string[]) {
  const o = {
    out: DEFAULT_SHADOW_DIR, shadowDir: DEFAULT_SHADOW_DIR, template: null as string | null, printOnly: false,
    ports: DEFAULT_ARENA_PORTS, minFreeGb: 1, clock: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === "--out") o.out = path.resolve(val());
    else if (a === "--shadow-dir") o.shadowDir = path.resolve(val());
    else if (a === "--template") o.template = val();
    else if (a === "--print-only") o.printOnly = true;
    else if (a === "--arena-ports") o.ports = val().split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
    else if (a === "--min-free-gb") o.minFreeGb = Number(val());
    else if (a === "--no-clock-check") o.clock = false;
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

type Verdict = "PASS" | "FAIL" | "INFO" | "SKIP" | "NOTE";
const lines: { v: Verdict; id: string; name: string; detail: string }[] = [];
const line = (v: Verdict, id: string, name: string, detail = "") => {
  lines.push({ v, id, name, detail });
  console.log(`${v.padEnd(4)}  ${id.padEnd(3)} ${name}${detail ? ` — ${detail}` : ""}`);
};
const pass = (ok: boolean): Verdict => (ok ? "PASS" : "FAIL");

async function httpDate(): Promise<string | null> {
  for (const u of CLOCK_URLS) {
    try {
      const r = await fetch(u, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      const d = r.headers.get("date");
      if (d) return d;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`317 LIVE ARENA · shadow preflight · ${new Date().toISOString()}`);

  // F1–F3: CRM read-only user
  let crm: GuardedCrm | null = null;
  try {
    crm = await openGuardedCrm();
    line("PASS", "F1", "read-only CRM user", `${crm.verdict.users.join(", ")}; roles ${crm.verdict.roles.join(", ") || "none"}; find on ${crm.db.databaseName}: ${crm.verdict.findOn.join(", ")}`);
  } catch (e) {
    line("FAIL", "F1", "read-only CRM user", (e as Error).message);
  }
  if (crm) {
    for (const p of await accessProbes(crm)) line(pass(p.ok), "F2", p.name, p.detail);
    for (const c of REQUIRED) {
      try {
        await crm.db.collection(c).findOne({}, { projection: { _id: 1 } });
        line("PASS", "F3", `readable: ${c}`);
      } catch (e) {
        line("FAIL", "F3", `readable: ${c}`, `code ${(e as { code?: number }).code ?? "?"} ${(e as { codeName?: string }).codeName ?? ""}`.trim());
      }
    }
    if (crm.verdict.canFind("User")) {
      try {
        await crm.db.collection("User").findOne({}, { projection: { _id: 1 } });
        line("NOTE", "F3", "User readable (optional): the Balance Report parity is included");
      } catch {
        line("NOTE", "F3", "User not readable (optional): the Balance Report parity will be skipped");
      }
    } else line("NOTE", "F3", "User not granted (optional): the Balance Report parity will be skipped");
    await crm.close().catch(() => {});
  } else {
    line("FAIL", "F2", "server refuses writes / non-granted collections", "not run: the guard refused the user");
    line("FAIL", "F3", "required collections readable", "not run: the guard refused the user");
  }

  // F4: local Arena state
  const localUri = process.env.ARENA_SHADOW_LOCAL_URI || "mongodb://127.0.0.1:27031";
  const localDb = process.env.ARENA_SHADOW_DB || "arena_shadow";
  let rules: ArenaRules = cloneRules(SEED_BALANCED_PERFORMANCE);
  let rulesLabel = "Balanced Performance (owner-approved seed, code: SEED_BALANCED_PERFORMANCE)";
  let rulesProblem: string | null = null;
  try {
    assertLocalMongoUri(localUri);
    if (!/^arena_/.test(localDb)) throw new Error("ARENA_SHADOW_DB must be an arena_* database");
    const local = new MongoClient(localUri, { serverSelectionTimeoutMS: 3000 });
    try {
      await local.connect();
      await local.db(localDb).command({ ping: 1 });
      line("PASS", "F4", "local Arena state on 127.0.0.1", `database ${localDb} reachable`);
      if (args.template) {
        const t = await local.db(localDb).collection(ARENA_COLLECTIONS.templates).findOne({ templateId: args.template, current: true });
        if (!t) rulesProblem = `template "${args.template}" not found in the local ${localDb} database`;
        else { rules = cloneRules(t.rules as ArenaRules); rulesLabel = `${t.name} v${t.version} (local ${localDb})`; }
      }
    } finally {
      await local.close().catch(() => {});
    }
  } catch (e) {
    line("FAIL", "F4", "local Arena state on 127.0.0.1", (e as { codeName?: string }).codeName ?? (e as Error).message.split("\n")[0]);
    if (args.template) rulesProblem = "the template could not be read (local database unavailable)";
  }

  // F5: rules
  const fp = rulesFingerprint(rules);
  console.log(`      rules: ${rulesLabel}`);
  for (const s of rulesSummary(rules)) console.log(`        ${s}`);
  console.log(`        fingerprint (SHA-256 of the canonical JSON): ${fp}`);
  const fpFile = path.join(args.shadowDir, "approved-rules.sha256");
  const confirmed = readFingerprintFile(fpFile);
  if (rulesProblem) line("FAIL", "F5", "rules", rulesProblem);
  else if (confirmed === null) line(args.printOnly ? "INFO" : "FAIL", "F5", "rules fingerprint", `owner has not confirmed rules yet (${fpFile} is absent)${args.printOnly ? "; printed for confirmation" : ""}`);
  else if (confirmed === "") line("FAIL", "F5", "rules fingerprint", `${fpFile} holds no SHA-256 value`);
  else line(pass(confirmed === fp), "F5", "rules fingerprint", confirmed === fp ? `matches the owner-confirmed ${fpFile}` : `DIFFERS from the owner-confirmed value ${confirmed.slice(0, 12)}… — the rules changed after confirmation`);

  // F6: decisions
  const decFile = path.join(args.shadowDir, "decisions.json");
  const dec = readDecisionsFile(decFile);
  if (dec.decisions) line("PASS", "F6", "data-review decisions", `${decFile}: ${decisionsSummary(dec.decisions)}`);
  else line("FAIL", "F6", "data-review decisions", `${decFile}: ${dec.problems.slice(0, 4).join("; ")}${dec.problems.length > 4 ? ` (+${dec.problems.length - 4} more)` : ""}`);

  // F7: technician access OFF
  const envHits = techAccessEnvVars(process.env);
  line(pass(!envHits.length), "F7", "no technician-access / Weekly Balance / Supabase variables", envHits.length ? `set: ${envHits.join(", ")}` : "none set");
  let ss: string | null = null;
  try {
    ss = execFileSync("ss", ["-ltnpH"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    try { ss = execFileSync("ss", ["-ltnH"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { ss = null; }
  }
  if (ss === null) line("FAIL", "F7", "nothing public on the Arena ports", "could not list listening sockets (ss)");
  else {
    const all = parseListeners(ss);
    const pub = publicArenaListeners(all, args.ports);
    const local = all.filter((l) => args.ports.includes(l.port) && !pub.includes(l));
    line(pass(!pub.length), "F7", `nothing public on the Arena ports ${args.ports.join(", ")}`,
      pub.length ? `listening publicly: ${pub.map((l) => `${l.address}:${l.port}${l.process ? ` (${l.process})` : ""}`).join(", ")}` : local.length ? `loopback only: ${[...new Set(local.map((l) => `${l.address}:${l.port}`))].join(", ")}` : "nothing listening");
  }

  // F8: output folder
  const outProblems = outputDirProblems(args.out);
  line(pass(!outProblems.length), "F8", "output folder private and outside any repository", outProblems.length ? `${args.out}: ${outProblems.join("; ")}` : `${args.out} (mode 700)`);

  // F9: disk and clock
  try {
    const st = fs.statfsSync(fs.existsSync(args.out) ? args.out : path.dirname(args.out));
    const free = st.bavail * st.bsize;
    line(pass(free >= args.minFreeGb * 1024 ** 3), "F9", `free disk ≥ ${args.minFreeGb} GB`, `${(free / 1024 ** 3).toFixed(1)} GB free`);
  } catch (e) {
    line("FAIL", "F9", `free disk ≥ ${args.minFreeGb} GB`, (e as Error).message);
  }
  if (!args.clock) line("SKIP", "F9", "clock", "--no-clock-check");
  else {
    const skew = clockSkew(Date.now(), await httpDate());
    if (skew === null) line("SKIP", "F9", "clock within 2 min of an HTTPS Date header", "offline: no Date header could be read; check the clock by hand");
    else line(pass(Math.abs(skew) <= MAX_CLOCK_SKEW_MS), "F9", "clock within 2 min of an HTTPS Date header", `skew ${(skew / 1000).toFixed(1)} s`);
  }

  const failed = lines.filter((l) => l.v === "FAIL").length;
  console.log(failed ? `\nPREFLIGHT FAILED: ${failed} check(s) failed.` : `\nPREFLIGHT PASSED: every check passed.`);
  return failed ? 1 : 0;
}

main().then((c) => process.exit(c), (e) => {
  console.error(`[arena-shadow] preflight failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
