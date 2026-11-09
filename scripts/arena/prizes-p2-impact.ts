/**
 * LOCAL ANALYSIS ONLY — impact of "Balanced Performance · Prizes 2026-11" on
 * two real weeks that were already extracted to files. No database, no network.
 *
 *   node --no-warnings --import ./scripts/arena/transpile-register.mjs scripts/arena/prizes-p2-impact.ts \
 *     <week A data.json> <week B data.json> <week B jobs.json> <out.md>
 *
 * Every allocation is the engine's own (allocatePrizes / computeCompetition via
 * lib-reallocate.ts). Cross-checks, all asserted before anything is written:
 *   C1  re-allocating each stored result under the OLD prizes reproduces data.json exactly;
 *   C2  week B scored from jobs.json by the engine reproduces every stored rank, score,
 *       eligibility, KPI and prize (old prizes), and the same Most Improved winner;
 *   C3  week B under the NEW prizes: re-allocation of the stored result = engine on jobs.json.
 * Writes <out.md> and <out>.json, mode 600. Reads the input files only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { SEED_BALANCED_PERFORMANCE, SEED_BALANCED_PERFORMANCE_P2, cloneRules, rulesHash } from "../../src/lib/arena/config.ts";
import type { CompetitionResult, CompetitorMap, JobExclusion } from "../../src/lib/arena/types.ts";
import { competitorsFromStored, payouts, reallocateStored, sameCash, scoreWeek, toArenaJobs, type ExtractedJob } from "./lib-reallocate.ts";

const [fileA, fileB, jobsFile, outMd] = process.argv.slice(2);
if (!outMd) throw new Error("usage: prizes-p2-impact.ts <weekA data.json> <weekB data.json> <weekB jobs.json> <out.md>");
const OLD = cloneRules(SEED_BALANCED_PERFORMANCE), NEW = cloneRules(SEED_BALANCED_PERFORMANCE_P2);
const OLD_FP = "c122c43bae974c7aa73fc960b19ca921adf646c82b89d67f9eee3fdb21c7d2b4";
assert.equal(rulesHash(OLD), OLD_FP);
const usd = (c: number) => (c ? `$${(c / 100).toLocaleString("en-US")}` : "—");
const out: string[] = [];
const json: Record<string, unknown> = { generatedAt: new Date().toISOString(), oldRules: OLD_FP, newRules: rulesHash(NEW), weeks: {} };
const checks: string[] = [];

const readWeek = (f: string) => { const d = JSON.parse(fs.readFileSync(f, "utf8")); return { week: d.week as string, stored: d.v1 as CompetitionResult, hash: d.rules.hash as string }; };
const cashLine = (r: CompetitionResult) => [...payouts(r)].map(([id, p]) => `${p.label} ${r.results.find((x) => x.competitorId === id)!.displayName} ${usd(p.cents)}`).join(" · ");

function weekTable(week: string, stored: CompetitionResult, next: CompetitionResult) {
  out.push(`### Week of ${week}`, "");
  out.push(`| Rank | Technician | Location | Score | Eligible | Old prize | New prize | Change |`, `|---:|---|---|---:|:---:|---:|---:|---:|`);
  const rows: unknown[] = [];
  for (const o of stored.results) {
    const n = next.results.find((x) => x.competitorId === o.competitorId)!;
    const shown = o.rank <= 8 || o.prizeCents || n.prizeCents;
    const lab = (x: typeof o) => (x.prizeCents ? `${usd(x.prizeCents)}${x.wonMostImproved ? " (MI)" : ` (#${x.prizePosition})`}` : "—");
    if (shown) out.push(`| ${o.rank} | ${o.displayName} | ${o.location} | ${o.score.toFixed(2)} | ${o.eligible ? "yes" : "no"} | ${lab(o)} | ${lab(n)} | ${n.prizeCents - o.prizeCents ? `${n.prizeCents > o.prizeCents ? "+" : "−"}${usd(Math.abs(n.prizeCents - o.prizeCents))}` : "0"} |`);
    rows.push({ rank: o.rank, competitorId: o.competitorId, name: o.displayName, location: o.location, score: o.score, eligible: o.eligible, oldCents: o.prizeCents, oldLabel: lab(o), newCents: n.prizeCents, newLabel: lab(n) });
  }
  const mi = (r: CompetitionResult) => r.results.find((x) => x.wonMostImproved);
  const miN = mi(next)!, miO = mi(stored)!;
  out.push("", `Rows after #8 with no prize under either structure are omitted (all $0 → $0).`, "");
  out.push(`- **Total paid:** old ${usd(stored.awardedCents)} → new ${usd(next.awardedCents)} (budget ${usd(NEW.prizes.budgetCents)}; unallocated ${usd(next.unallocatedCents)}).`);
  out.push(`- **Most Improved:** old ${miO.displayName} (#${miO.rank}, +${miO.mostImproved!.improvement.toFixed(2)}) → new **${miN.displayName}** (#${miN.rank}, +${miN.mostImproved!.improvement.toFixed(2)})${miN.competitorId === miO.competitorId ? " — same winner" : " — CHANGED"}.`);
  const cand = next.results.filter((x) => x.prizeEligible && x.prizePosition === null && x.mostImproved && x.mostImproved.improvement > NEW.mostImproved.minImprovement)
    .sort((a, b) => b.mostImproved!.improvement - a.mostImproved!.improvement).slice(0, 4);
  out.push(`- Most Improved candidates under the new structure (prize-eligible, no position prize), best first: ${cand.map((x) => `${x.displayName} #${x.rank} +${x.mostImproved!.improvement.toFixed(2)}`).join(", ")}.`);
  const newlyMi = next.results.filter((x) => x.prizePosition === null && stored.results.find((o) => o.competitorId === x.competitorId)!.prizePosition !== null);
  out.push(`- Held old positions #4–#6, now no position (so MI-eligible if improved): ${newlyMi.map((x) => `${x.displayName} (rank #${x.rank}, ${x.mostImproved ? `+${x.mostImproved.improvement.toFixed(2)}` : "no MI baseline"})`).join(", ") || "none"} — none of them beats the MI winner.`, "");
  return { rows, totals: { oldCents: stored.awardedCents, newCents: next.awardedCents }, mostImproved: { old: miO.displayName, new: miN.displayName } };
}

// ── weeks A and B: old vs new ───────────────────────────────────────────────
const A = readWeek(fileA), B = readWeek(fileB);
const weeks: { w: ReturnType<typeof readWeek>; next: CompetitionResult }[] = [];
for (const w of [A, B]) {
  assert.equal(w.hash, OLD_FP, `${w.week}: stored under the approved 6-place rules`);
  assert.equal(w.stored.rulesHash, OLD_FP);
  const again = reallocateStored(w.stored, OLD, OLD);
  assert.equal(JSON.stringify(again.results), JSON.stringify(w.stored.results), `${w.week}: C1 results`);
  assert.deepEqual([again.awardedCents, again.unallocatedCents, again.mostImprovedWinner], [w.stored.awardedCents, w.stored.unallocatedCents, w.stored.mostImprovedWinner], `${w.week}: C1 totals`);
  checks.push(`C1 ${w.week}: re-allocation under the old prizes reproduces data.json byte-for-byte (${w.stored.results.length} competitors, ${usd(w.stored.awardedCents)}, same MI winner)`);
  weeks.push({ w, next: reallocateStored(w.stored, NEW, OLD) });
}

// ── week B from jobs.json: C2/C3 ───────────────────────────────────────────
const jobsB: ExtractedJob[] = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
const baseMap = competitorsFromStored(B.stored, jobsB);
const arenaJobs = toArenaJobs(jobsB);
const score = (rules: typeof OLD, competitors: CompetitorMap, exclusions: JobExclusion[] = []) => scoreWeek({ rules, weekStart: B.week, stored: B.stored, competitors, jobs: arenaJobs, exclusions });
const oldB = score(OLD, baseMap);
for (const s of B.stored.results) {
  const e = oldB.results.find((x) => x.competitorId === s.competitorId);
  assert.ok(e, `C2: ${s.displayName} missing`);
  for (const k of ["rank", "score", "closingScore", "avgScore", "eligible", "prizeEligible", "assignedJobs", "closedJobs", "qualifyingJobs", "profitMicro", "prizePosition", "prizeCents", "wonMostImproved"] as const)
    assert.equal(e[k], s[k], `C2 ${s.displayName}.${k}`);
}
assert.equal(oldB.results.length, B.stored.results.length);
assert.equal(oldB.mostImprovedWinner, B.stored.mostImprovedWinner);
assert.deepEqual(oldB.unattributed.slice(0, 2), [{ crmName: "John", jobs: 29 }, { crmName: "TZVI", jobs: 24 }]);
checks.push(`C2 ${B.week}: the engine on jobs.json (${jobsB.length} jobs) reproduces every stored rank, score, C/A, KPI, eligibility and prize under the old prizes, and the MI winner`);
const newB = score(NEW, baseMap);
const reB = weeks[1].next;
assert.equal(JSON.stringify(newB.results.map((x) => [x.competitorId, x.rank, x.prizePosition, x.prizeCents, x.wonMostImproved])), JSON.stringify(reB.results.map((x) => [x.competitorId, x.rank, x.prizePosition, x.prizeCents, x.wonMostImproved])), "C3");
checks.push(`C3 ${B.week}: new prizes — re-allocating the stored result = scoring jobs.json with the engine (same positions, amounts and MI winner)`);

out.unshift(
  "# Prizes 2026-11 — impact on the two real weeks", "",
  `Generated ${json.generatedAt as string} by \`scripts/arena/prizes-p2-impact.ts\` (local files only; no database, no network).`, "",
  `- Old: **Balanced Performance** (\`SEED_BALANCED_PERFORMANCE\`, fingerprint \`${OLD_FP}\`): #1–#6 $450/$300/$200/$150/$100/$50 + Most Improved $250.`,
  `- New: **Balanced Performance · Prizes 2026-11** (\`SEED_BALANCED_PERFORMANCE_P2\`, id \`balanced-p2-2026-11\`, fingerprint \`${rulesHash(NEW)}\`): #1 $550 · #2 $400 · #3 $300 + Most Improved $250 = $1,500. #4–#6 ranked, no cash.`,
  "- Scores, ranks, eligibility and Most Improved baselines are unchanged by prize amounts; only the allocation is redone, by the engine's own `allocatePrizes`. **Approved/stored results are not altered** — this is a what-if on copies.", "",
  "## Cross-checks (asserted)", "", ...[] as string[],
);
const checksAt = out.length;
out.push("## 1. Old vs new prizes per person", "");
json.weeks = Object.fromEntries(weeks.map(({ w, next }) => [w.week, weekTable(w.week, w.stored, next)]));

// ── John / TZVI identity what-ifs (week B) ─────────────────────────────────
const chicago = B.stored.results.filter((x) => x.location === "Chicago");
type Opt = { key: string; label: string };
const opts: Opt[] = [{ key: "none", label: "unidentified (today)" }, { key: "separate", label: "a separate new person" }, ...chicago.map((c) => ({ key: c.competitorId, label: c.displayName }))];
function mapWith(john: string, tzvi: string): CompetitorMap {
  const m: CompetitorMap = { competitors: baseMap.competitors.map((c) => ({ ...c, crmNames: [...c.crmNames] })), byCrmName: new Map(baseMap.byCrmName), issues: [] };
  for (const [name, o] of [["John", john], ["TZVI", tzvi]] as const) {
    if (o === "none") continue;
    const id = o === "separate" ? `whatif-${name.toLowerCase()}` : o;
    if (o === "separate") m.competitors.push({ id, displayName: `${name} (separate)`, crmNames: [name], location: "Chicago" });
    else m.competitors.find((c) => c.id === id)!.crmNames.push(name);
    m.byCrmName.set(name, id);
  }
  return m;
}
const tzviDup = (B.stored.duplicateGroups ?? []).find((g) => g.key.startsWith("crm:TZVI|"));
const jobById = new Map(jobsB.map((j) => [j.id, j]));
const QUAL = new Set(NEW.qualifying.statuses);
/** Count the TZVI pair once (exclude its qualifying job) — worst case for whoever holds TZVI's jobs. */
const tzviExcl: JobExclusion[] = tzviDup ? [{ jobId: tzviDup.jobIds.find((id) => QUAL.has(jobById.get(id)!.status)) ?? tzviDup.jobIds[1], kind: "duplicate", reason: "what-if", by: "analysis", at: "2026-11-02T00:00:00.000Z" }] : [];
const nameOf = (r: CompetitionResult, id: string) => r.results.find((x) => x.competitorId === id)?.displayName ?? id;
const combos: { john: Opt; tzvi: Opt; newChanged: boolean; oldChanged: boolean; dupMatters: boolean; newCash: string; oldCash: string; affected: string[]; affectedOld: string[]; miNew: string; target: Record<string, { rank: number; score: number; eligible: boolean }> }[] = [];
for (const j of opts) for (const t of opts) {
  const m = mapWith(j.key, t.key);
  const rn = score(NEW, m), ro = score(OLD, m);
  const rnDup = t.key !== "none" && tzviExcl.length ? score(NEW, m, tzviExcl) : rn;
  const affected = new Set<string>();
  const pa = payouts(newB), pb = payouts(rn);
  for (const id of new Set([...pa.keys(), ...pb.keys()])) if (pa.get(id)?.cents !== pb.get(id)?.cents || pa.get(id)?.label !== pb.get(id)?.label) affected.add(nameOf(rn, id) ?? nameOf(newB, id));
  const affectedOld = new Set<string>();
  const qa = payouts(oldB), qb = payouts(ro);
  for (const id of new Set([...qa.keys(), ...qb.keys()])) if (qa.get(id)?.cents !== qb.get(id)?.cents || qa.get(id)?.label !== qb.get(id)?.label) affectedOld.add(nameOf(ro, id));
  const target: Record<string, { rank: number; score: number; eligible: boolean }> = {};
  for (const o of [j, t]) if (o.key !== "none") { const id = o.key === "separate" ? `whatif-${o === j ? "john" : "tzvi"}` : o.key; const x = rn.results.find((y) => y.competitorId === id); if (x) target[x.displayName] = { rank: x.rank, score: x.score, eligible: x.eligible }; }
  combos.push({ john: j, tzvi: t, newChanged: !sameCash(newB, rn), oldChanged: !sameCash(oldB, ro), dupMatters: !sameCash(rn, rnDup), newCash: cashLine(rn), oldCash: cashLine(ro), affected: [...affected], affectedOld: [...affectedOld], miNew: nameOf(rn, rn.mostImprovedWinner ?? ""), target });
}
out.push("## 2. John / TZVI what-ifs (week of 2026-10-26)", "");
out.push(`John: 29 jobs, TZVI: 24 jobs, all Chicago, both unidentified today (their jobs count for nobody). Each can be: unidentified, a separate new person, or a second CRM name of one of the ${chicago.length} Chicago competitors (${chicago.map((c) => c.displayName).join(", ")}). All ${opts.length}×${opts.length} = ${combos.length} combinations were scored with the engine under both prize structures. Most Improved baselines are the stored ones (the extract has no baseline-week jobs, so John/TZVI baseline-week jobs, if any, are NOT included), and a "separate" person has no baseline (cannot win MI).`, "");
const single = (o: "john" | "tzvi") => combos.filter((c) => (o === "john" ? c.tzvi.key === "none" : c.john.key === "none") && (o === "john" ? c.john.key !== "none" : c.tzvi.key !== "none"));
for (const who of ["john", "tzvi"] as const) {
  out.push(`### ${who === "john" ? "John" : "TZVI"} alone (the other stays unidentified)`, "");
  out.push(`| ${who === "john" ? "John" : "TZVI"} is… | Merged result (rank · score · eligible) | New prizes: cash change? | Old prizes: cash change? | New MI winner |`, `|---|---|:---:|:---:|---|`);
  for (const c of single(who)) {
    const o = who === "john" ? c.john : c.tzvi;
    const tg = Object.entries(c.target).map(([n, v]) => `${n}: #${v.rank} · ${v.score.toFixed(2)} · ${v.eligible ? "eligible" : "not eligible"}`).join("; ");
    out.push(`| ${o.label} | ${tg || "—"} | ${c.newChanged ? `**YES** — ${c.affected.join(", ")}` : "no"} | ${c.oldChanged ? "YES" : "no"} | ${c.miNew} |`);
  }
  out.push("");
}
const changing = combos.filter((c) => c.newChanged);
out.push("### Every combination that changes a cash prize or the MI winner under the NEW prizes", "");
if (!changing.length) out.push("None.", "");
else {
  out.push(`| John is… | TZVI is… | New-prize payouts | Who is affected |`, `|---|---|---|---|`);
  for (const c of changing) out.push(`| ${c.john.label} | ${c.tzvi.label} | ${c.newCash} | ${c.affected.join(", ")} |`);
  out.push("");
}
const affectedAll = [...new Set(changing.flatMap((c) => c.affected))].sort();
const oldChangingN = combos.filter((c) => c.oldChanged).length;
const decisive = [...new Set(combos.filter((c) => c.newChanged && (c.john.key === "none" || c.tzvi.key === "none")).map((c) => (c.john.key === "none" ? c.tzvi : c.john)).filter((o) => o.key !== "separate").map((o) => o.label))];
const everyHasDecisive = changing.every((c) => decisive.includes(c.john.label) || decisive.includes(c.tzvi.label));
const affectedOldAll = [...new Set(combos.flatMap((c) => c.affectedOld))].sort();
const miChanges = combos.filter((c) => c.miNew !== nameOf(newB, newB.mostImprovedWinner ?? "")).length;
out.push(`**Summary:** ${changing.length} of ${combos.length} combinations change the new-prize cash or MI winner (old prizes: ${oldChangingN}). People whose cash/MI could change under the new prizes: **${affectedAll.join(", ") || "nobody"}** (under the old 6-place prizes: ${affectedOldAll.join(", ")}). The Most Improved winner changes in ${miChanges} combination(s). Merge targets that move cash on their own (the other name unidentified): ${decisive.join(", ") || "none"}; every changing combination has one of them as a target: ${everyHasDecisive ? "yes" : "NO"}. Counting TZVI's 30 Oct pair once changes the outcome in ${combos.filter((c) => c.dupMatters).length} combination(s)${combos.some((c) => c.dupMatters) ? `: ${combos.filter((c) => c.dupMatters).map((c) => `John=${c.john.label}/TZVI=${c.tzvi.label}`).join("; ")}` : ""}.`, "");
out.push(`Baseline (both unidentified), new prizes: ${cashLine(newB)}.`, "");

// ── duplicate what-ifs (week B) ────────────────────────────────────────────
out.push("## 3. Suspected-duplicate what-ifs (week of 2026-10-26)", "");
out.push("A confirmed duplicate removes one job from the QUALIFYING count only (never from Closing Rate or AVG TICKET), so it can only change who meets the 10-qualifying-job minimum. Each pair was scored with its qualifying job excluded (the worst case), then all pairs together. TZVI's pair is covered in §2.", "");
out.push(`| Technician | Date | Qualifying jobs (now → if counted once) | New prizes: cash change? | Old prizes: cash change? |`, `|---|---|---|:---:|:---:|`);
const dupRows: unknown[] = [];
const allEx: JobExclusion[] = [];
for (const g of (B.stored.duplicateGroups ?? []).filter((x) => x.competitorId)) {
  const qid = g.jobIds.find((id) => QUAL.has(jobById.get(id)!.status));
  const ex: JobExclusion[] = qid ? [{ jobId: qid, kind: "duplicate", reason: "what-if", by: "analysis", at: "2026-11-02T00:00:00.000Z" }] : [];
  allEx.push(...ex);
  const rn = score(NEW, baseMap, ex), ro = score(OLD, baseMap, ex);
  const before = newB.results.find((x) => x.competitorId === g.competitorId)!, after = rn.results.find((x) => x.competitorId === g.competitorId)!;
  const ch = !sameCash(newB, rn), cho = !sameCash(oldB, ro);
  out.push(`| ${before.displayName} (#${before.rank}) | ${g.key.split("|")[1]} | ${before.qualifyingJobs} → ${after.qualifyingJobs}${after.eligible !== before.eligible ? " (eligibility changes)" : ""} | ${ch ? `**YES** — ${cashLine(rn)}` : "no"} | ${cho ? "YES" : "no"} |`);
  dupRows.push({ name: before.displayName, rank: before.rank, date: g.key.split("|")[1], qualifyingBefore: before.qualifyingJobs, qualifyingAfter: after.qualifyingJobs, newChanged: ch, oldChanged: cho, storedMayAffectPrizes: g.mayAffectPrizes });
}
const allN = score(NEW, baseMap, allEx), allO = score(OLD, baseMap, allEx);
out.push(`| **all ${allEx.length} pairs at once** | | | ${!sameCash(newB, allN) ? `**YES** — ${cashLine(allN)}` : "no"} | ${!sameCash(oldB, allO) ? "YES" : "no"} |`, "");
out.push("(`mayAffectPrizes` in the stored review queue is a conservative flag — it marks any pair of a competitor who is near a gate or in contention; the table above is the actual engine outcome.)", "");

out.splice(checksAt, 0, ...checks.map((c) => `- ${c}`), "");
out.push("## 4. Not verified / limits", "",
  "- Week of 2026-10-19: no per-job extract exists in the trial folder, so only the re-allocation (C1) was run there; no identity or duplicate what-ifs for that week.",
  "- What-ifs keep the stored Most Improved baselines. If John or TZVI had jobs in the four baseline weeks and is merged into someone, that person's baseline (and so their improvement) would also change; the extract cannot show this.",
  "- Account standing: every competitor is `unverified` in both stored weeks (kept their place, nothing redistributed). A later account exclusion would move prizes down the ranking; not modelled here.",
  "- \"Separate person\" assumes he is a verified competitor in Chicago with no MI baseline.", "");
fs.writeFileSync(outMd, out.join("\n"), { mode: 0o600 });
fs.chmodSync(outMd, 0o600);
const outJson = outMd.replace(/\.md$/, "") + ".json";
fs.writeFileSync(outJson, JSON.stringify({ ...json, checks, identity: { decisiveMergeTargets: decisive, everyChangingComboHasDecisiveTarget: everyHasDecisive, affectedUnderNewPrizes: affectedAll, affectedUnderOldPrizes: affectedOldAll, combos: combos.map((c) => ({ john: c.john.label, tzvi: c.tzvi.label, newChanged: c.newChanged, oldChanged: c.oldChanged, dupMatters: c.dupMatters, affected: c.affected, affectedOld: c.affectedOld, newCash: c.newCash, miNew: c.miNew, target: c.target })) }, duplicates: dupRows }, null, 1), { mode: 0o600 });
fs.chmodSync(outJson, 0o600);
console.log(checks.join("\n"));
console.log(`affected under the new prizes by John/TZVI: ${affectedAll.join(", ") || "nobody"} (${changing.length}/${combos.length} combos)`);
console.log(`wrote ${outMd} and ${outJson}`);
