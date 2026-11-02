/**
 * OWNER PREVIEW (local presentation only): turn one shadow week's engine output
 * (<shadowDir>/<week>/data.json) into the EXACT technician-API responses, using
 * the server's own view builders (data minimization lives there: no job ids,
 * CRM names, customers, commissions). Nothing is read from or written to the CRM.
 *
 *   node --import ./scripts/arena/transpile-register.mjs scripts/arena/owner-preview-snapshot.ts \
 *     <data.json> <out.json> [--pending <competitorId>=<reason> ...]
 */
import fs from "node:fs";
import { SEED_BALANCED_PERFORMANCE } from "../../src/lib/arena/config";
import { leaderboardRows, myStanding, prizePoolCents, rulesView } from "../../src/lib/arena/tech/views";
import type { ApprovedStanding } from "../../src/lib/arena/lifecycle";

const [dataFile, outFile, ...rest] = process.argv.slice(2);
if (!dataFile || !outFile) throw new Error("usage: <data.json> <out.json> [--pending id=reason ...]");
const pending: Record<string, string> = {};
for (let i = 0; i < rest.length; i++) if (rest[i] === "--pending") { const [id, ...r] = rest[++i].split("="); pending[id] = r.join("="); }

const d = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const rules = SEED_BALANCED_PERFORMANCE;
if (d.rules?.hash && !String(d.rules.hash).startsWith("c122c43b")) throw new Error(`unexpected rules hash ${d.rules.hash}`);
const phase = "frozen" as const; // week ended; not reviewed, not approved

const rows: ApprovedStanding[] = d.v1.results.map((r: any) => ({
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
  week, weekEnd, dataAsOf, rulesHash: d.rules?.hash ?? null,
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
console.log(`wrote ${outFile}: ${rows.length} competitors, ${Object.keys(pending).length} pending review`);
