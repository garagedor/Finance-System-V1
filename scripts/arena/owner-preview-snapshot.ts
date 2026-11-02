/**
 * OWNER PREVIEW (local presentation only): turn one shadow week's engine output
 * (<shadowDir>/<week>/data.json) into the EXACT technician-API responses, using
 * the server's own view builders (data minimization lives there: no job ids,
 * CRM names, customers, commissions). Nothing is read from or written to the CRM.
 *
 *   node --import ./scripts/arena/transpile-register.mjs scripts/arena/owner-preview-snapshot.ts \
 *     <data.json> <out.json> --template <seed id> [--pending <competitorId>=<reason> ...]
 *
 * --template names the prize structure to PRESENT (a code seed: balanced-p2-2026-11
 * or balanced-v1). When it differs from the rules the week was computed with, the
 * stored results are RE-ALLOCATED with the engine's own allocatePrizes (ranks,
 * scores, eligibility and Most Improved baselines are unchanged by prize amounts;
 * only the scoring/eligibility rules must match, which is checked). The input file
 * is never modified; the output says which rules it shows and that it was re-allocated.
 */
import fs from "node:fs";
import { ARENA_RULE_SEEDS, cloneRules, ruleSeed, rulesHash } from "../../src/lib/arena/config";
import { leaderboardRows, myStanding, prizePoolCents, rulesView } from "../../src/lib/arena/tech/views";
import type { ApprovedStanding } from "../../src/lib/arena/lifecycle";
import type { CompetitionResult } from "../../src/lib/arena/types";
import { reallocateStored } from "./lib-reallocate";

const [dataFile, outFile, ...rest] = process.argv.slice(2);
const USAGE = `usage: <data.json> <out.json> --template <${ARENA_RULE_SEEDS.map((x) => x.id).join("|")}> [--pending id=reason ...]`;
if (!dataFile || !outFile) throw new Error(USAGE);
const pending: Record<string, string> = {};
let templateId: string | null = null;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--pending") { const [id, ...r] = rest[++i].split("="); pending[id] = r.join("="); }
  else if (rest[i] === "--template") templateId = rest[++i] ?? null;
  else throw new Error(`unknown argument ${rest[i]}; ${USAGE}`);
}
const seed = templateId ? ruleSeed(templateId) : null;
if (!seed) throw new Error(`--template is required (${USAGE})`);

const d = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const rules = cloneRules(seed.rules);
// The rules the stored week was computed with: must be a known code seed (by fingerprint).
const storedHash = String(d.rules?.hash ?? d.v1?.rulesHash ?? "");
const computedWith = ARENA_RULE_SEEDS.find((x) => rulesHash(x.rules) === storedHash);
if (!computedWith) throw new Error(`unexpected stored rules hash ${storedHash}`);
if (d.v1?.rulesHash !== storedHash) throw new Error("data.json rules.hash and v1.rulesHash disagree");
const reallocated = rulesHash(rules) !== storedHash;
const result: CompetitionResult = reallocated ? reallocateStored(d.v1 as CompetitionResult, rules, computedWith.rules) : (d.v1 as CompetitionResult);
const phase = "frozen" as const; // week ended; not reviewed, not approved

const rows: ApprovedStanding[] = result.results.map((r) => ({
  competitorId: r.competitorId, displayName: r.displayName, location: r.location, rank: r.rank, score: r.score,
  eligible: r.eligible, prizeEligible: r.prizeEligible, gates: { jobs: r.gates.jobs.met, avgTicket: r.gates.avgTicket.met, closingRate: r.gates.closingRate.met },
  closingRate: r.closingRate, avgTicket: r.avgTicket, assignedJobs: r.assignedJobs, closedJobs: r.closedJobs, qualifyingJobs: r.qualifyingJobs,
  closingIndex: r.closingIndex, avgIndex: r.avgIndex, closingScore: r.closingScore, avgScore: r.avgScore, limitingMetric: r.limitingMetric,
  prizePosition: r.prizePosition, prizeCents: r.prizeCents, wonMostImproved: r.wonMostImproved, mostImproved: r.mostImproved,
}));
for (const id of Object.keys(pending)) if (!rows.some((r) => r.competitorId === id)) throw new Error(`pending id not a competitor: ${id}`);

const week: string = d.week;
const dataAsOf: string = d.generatedAt;
const sunday = new Date(`${week}T12:00:00Z`); sunday.setUTCDate(sunday.getUTCDate() + 6);
const weekEnd = sunday.toISOString().slice(0, 10);
const competition = {
  id: `preview_${week}`, weekStart: week, weekEnd, phase,
  endsAt: "2026-11-02T04:59:59.000Z",       // Sun 1 Nov 23:59:59 EST
  reviewOpensAt: "2026-11-03T17:00:00.000Z", // Tue 3 Nov 12:00 EST
  dataAsOf,
};
const board = (view: "national" | "eligible") => {
  const rs = leaderboardRows(rows, rules, phase, "", view);
  const ranked = view === "eligible" ? rs.map((r, i) => ({ ...r, rank: i + 1 })) : rs;
  return {
    apiVersion: 1, weekStart: week, phase, view, dataAsOf, rows: ranked,
    eligibleCount: rows.filter((r) => r.eligible).length, participantCount: rows.length, prizePoolCents: prizePoolCents(rules),
  };
};
const me: Record<string, unknown> = {};
for (const s of rows) {
  me[s.competitorId] = {
    apiVersion: 1, serverTime: dataAsOf, competitor: { id: s.competitorId, displayName: s.displayName, location: s.location },
    competition, rules: rulesView(rules), standing: myStanding(s, rows, rules, phase), award: null, notices: [],
  };
}
const out = {
  schema: "arena-owner-preview/1",
  label: "OWNER PREVIEW · PROJECTED / UNOFFICIAL",
  week, weekEnd, dataAsOf, rulesHash: rulesHash(rules),
  rules: { id: seed.id, label: seed.label, fingerprint: rulesHash(rules), computedWith: computedWith.id, storedFingerprint: storedHash, reallocated },
  pending, // competitorId -> reason shown as PENDING REVIEW
  leaderboard: { national: board("national"), eligible: board("eligible") },
  me,
  history: { apiVersion: 1, weeks: [] },
};
const json = JSON.stringify(out);
for (const forbidden of ["jobIds", "profitMicro", "crmName", "phone", "customer", "commission"]) {
  if (json.includes(`"${forbidden}"`)) throw new Error(`data minimization: ${forbidden} present`);
}
fs.writeFileSync(outFile, json, { mode: 0o600 });
console.log(`wrote ${outFile}: ${rows.length} competitors, ${Object.keys(pending).length} pending review · rules ${seed.label} ${rulesHash(rules).slice(0, 12)}…${reallocated ? ` (re-allocated from ${computedWith.id})` : ""} · paid ${result.awardedCents / 100} · MI ${rows.find((r) => r.wonMostImproved)?.displayName ?? "none"}`);
