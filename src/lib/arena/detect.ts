/**
 * Turns weeks of CRM jobs into review cases. Pure: the caller loads the data
 * (read-only) and stores the cases. Detection uses the same functions the
 * scoring engine uses, so the queue shows exactly what would block a result.
 */
import type { ArenaJob, ArenaRules, IdentityOverride, JobExclusion } from "./types";
import { buildCompetitorMap, type MappingRecord, type TechnicianRecord } from "./identity";
import { computeCompetition, findSuspectedDuplicates } from "./engine";
import { rulesHash } from "./config";
import type { DetectedCase, DisplayNameCaseData, DuplicateCaseData, IdentityCaseData, NonCompetitorCategory } from "./review";
import { isEnglishDisplayName } from "./review";

export interface DetectInput {
  /** Monday week starts with that week's jobs only. */
  weeks: { weekStart: string; jobs: ArenaJob[] }[];
  mappings: MappingRecord[];
  technicians: TechnicianRecord[];
  rules: ArenaRules;
  /** Decisions already in force, so a decided name is not flagged again. */
  overrides: IdentityOverride[];
  displayNames: Record<string, string>;
  exclusions: JobExclusion[];
}

const fold = (s: string) => s.trim().toLowerCase();

export function detectCases(input: DetectInput): DetectedCase[] {
  const out = new Map<string, DetectedCase>();
  const put = (d: DetectedCase) => {
    const k = `${d.kind}:${d.key}`;
    const prev = out.get(k);
    if (prev) prev.weeks = [...new Set([...prev.weeks, ...d.weeks])];
    else out.set(k, d);
  };

  const rules = structuredClone(input.rules);
  rules.mostImproved.enabled = false; // detection needs the week alone
  const hash = rulesHash(rules);
  const excluded = new Set(input.exclusions.map((x) => x.jobId));
  const locations = new Set<string>();
  for (const w of input.weeks) for (const j of w.jobs) if (j.location) locations.add(fold(j.location));

  const identity = new Map<string, IdentityCaseData & { weeks: Set<string> }>();
  const people = new Map<string, { name: string; crmNames: Set<string>; weeks: Set<string> }>();

  for (const w of input.weeks) {
    const names = [...new Set(w.jobs.map((j) => j.tech).filter(Boolean))];
    const map = buildCompetitorMap({
      mappings: input.mappings,
      technicians: input.technicians,
      crmNamesInUse: names,
      overrides: input.overrides,
      displayNames: input.displayNames,
    });

    // identity: every blocking issue, aggregated across weeks by CRM name
    for (const issue of map.issues) {
      if (!issue.blocking) continue;
      const jobs = w.jobs.filter((j) => j.tech === issue.crmName);
      const cur = identity.get(issue.crmName) ?? {
        issue: issue.kind,
        crmName: issue.crmName,
        candidates: issue.candidates,
        jobs: 0,
        locations: [],
        suggestedCategory: locations.has(fold(issue.crmName)) ? ("location_pool" as NonCompetitorCategory) : null,
        weeks: new Set<string>(),
      };
      cur.jobs += jobs.length;
      cur.locations = [...new Set([...cur.locations, ...jobs.map((j) => j.location).filter(Boolean)])].sort();
      cur.weeks.add(w.weekStart);
      identity.set(issue.crmName, cur);
    }

    // display names: verified people whose name is not yet in Latin letters
    for (const c of map.competitors) {
      const p = people.get(c.id) ?? { name: c.displayName, crmNames: new Set<string>(), weeks: new Set<string>() };
      c.crmNames.forEach((n) => p.crmNames.add(n));
      p.weeks.add(w.weekStart);
      people.set(c.id, p);
    }

    // duplicates: the engine's own detector, with that week's results for prize impact
    const result = computeCompetition({ rules, rulesHash: hash, weekStart: w.weekStart, competitors: map, jobs: w.jobs });
    const groups = findSuspectedDuplicates(w.jobs, map, result.results, excluded);
    const byId = new Map(w.jobs.map((j) => [j.id, j]));
    const nameOf = new Map(map.competitors.map((c) => [c.id, c.displayName]));
    for (const g of groups) {
      const jobs = g.jobIds.map((id) => byId.get(id)!).filter(Boolean);
      const data: DuplicateCaseData = {
        weekStart: w.weekStart,
        date: jobs[0]?.date ?? "",
        competitorId: g.competitorId,
        competitorName: g.competitorId ? nameOf.get(g.competitorId) ?? g.competitorId : jobs[0]?.tech ?? "",
        jobs: jobs.map((j) => ({ id: j.id, tech: j.tech, status: j.status, profit: j.profit })),
        likely: jobs.length > 1 && jobs.every((j) => j.status === "Closed" && j.profit === jobs[0].profit),
        mayAffectPrizes: g.mayAffectPrizes,
      };
      // Keyed by the sorted job ids, the same signature the engine uses to dismiss a group.
      put({ kind: "duplicate_group", key: g.jobIds.join(","), data, weeks: [w.weekStart] });
    }
  }

  for (const [crmName, d] of identity) {
    const { weeks, ...data } = d;
    put({ kind: "identity_name", key: crmName, data, weeks: [...weeks] });
  }
  for (const [id, p] of people) {
    if (input.displayNames[id] || isEnglishDisplayName(p.name)) continue;
    const data: DisplayNameCaseData = { competitorId: id, currentName: p.name, crmNames: [...p.crmNames].sort() };
    put({ kind: "display_name", key: id, data, weeks: [...p.weeks] });
  }
  return [...out.values()].sort((a, b) => (a.kind + a.key < b.kind + b.key ? -1 : 1));
}
