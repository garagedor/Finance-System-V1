/**
 * Competitor identity.
 *
 * A competitor is a verified person: one `TechNameMapping` record
 * (supabaseUserId = the balance-app account), which lists every CRM short name
 * that person works under. Names are merged ONLY through that record or an
 * explicit admin override — never by name similarity.
 *
 * Attribution rules for a CRM name (`Job.tech` / `Technician._id`):
 *  1. admin override → as decided (attach to a competitor, or block)
 *  2. listed verbatim in exactly one mapping → that competitor
 *  3. listed verbatim in several mappings → blocked, flagged for review
 *  4. matches a mapping entry only after trimming / case-folding, and no other
 *     CRM name folds to the same key → that competitor, flagged as info
 *  5. same as 4 but the folded key is shared → blocked, flagged
 *  6. otherwise → unmapped (location pools, subcontractors, new hires)
 */
import type { Competitor, CompetitorMap, IdentityIssue, IdentityOverride } from "./types";

export interface MappingRecord {
  supabaseUserId: string;
  supabaseFullName?: string | null;
  crmTechNames?: string[] | null;
}

export interface TechnicianRecord {
  _id: string;
  location?: string | null;
}

const fold = (s: string) => s.trim().toLowerCase();

export function buildCompetitorMap(input: {
  mappings: MappingRecord[];
  technicians: TechnicianRecord[];
  /** Every CRM name that has jobs in the window being scored. */
  crmNamesInUse: string[];
  overrides?: IdentityOverride[];
  displayNames?: Record<string, string>;
}): CompetitorMap {
  const issues: IdentityIssue[] = [];
  const byCrmName = new Map<string, string>();
  const people = new Map<string, MappingRecord>();
  for (const m of input.mappings) if (m.supabaseUserId) people.set(m.supabaseUserId, m);

  // verbatim mapping entries → owners
  const verbatim = new Map<string, Set<string>>();
  const folded = new Map<string, Set<string>>();
  for (const m of people.values()) {
    for (const raw of m.crmTechNames ?? []) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      (verbatim.get(raw) ?? verbatim.set(raw, new Set()).get(raw)!).add(m.supabaseUserId);
      const k = fold(raw);
      (folded.get(k) ?? folded.set(k, new Set()).get(k)!).add(m.supabaseUserId);
    }
  }

  const allNames = [...new Set([...input.crmNamesInUse, ...input.technicians.map((t) => t._id)])].filter(
    (n) => typeof n === "string" && n !== "",
  );
  const foldCount = new Map<string, number>();
  for (const n of allNames) foldCount.set(fold(n), (foldCount.get(fold(n)) ?? 0) + 1);

  const overrides = new Map<string, IdentityOverride>();
  for (const o of input.overrides ?? []) overrides.set(o.crmName, o); // last decision wins

  for (const name of input.crmNamesInUse) {
    if (!name) continue;
    const o = overrides.get(name);
    if (o) {
      if (o.competitorId && people.has(o.competitorId)) byCrmName.set(name, o.competitorId);
      continue;
    }
    const exact = verbatim.get(name);
    if (exact && exact.size === 1) {
      byCrmName.set(name, [...exact][0]);
      continue;
    }
    if (exact && exact.size > 1) {
      issues.push({ kind: "name_in_multiple_mappings", crmName: name, candidates: [...exact].sort(), blocking: true });
      continue;
    }
    const loose = folded.get(fold(name));
    if (loose && loose.size === 1) {
      if ((foldCount.get(fold(name)) ?? 0) > 1) {
        issues.push({ kind: "normalized_collision", crmName: name, candidates: [...loose], blocking: true });
      } else {
        byCrmName.set(name, [...loose][0]);
        issues.push({ kind: "normalized_match", crmName: name, candidates: [...loose], blocking: false });
      }
      continue;
    }
    if (loose && loose.size > 1) {
      issues.push({ kind: "name_in_multiple_mappings", crmName: name, candidates: [...loose].sort(), blocking: true });
      continue;
    }
    issues.push({ kind: "unmapped_name", crmName: name, candidates: [], blocking: true });
  }

  const techLocation = new Map(input.technicians.map((t) => [t._id, t.location ?? ""]));
  const namesOf = new Map<string, string[]>();
  for (const [name, id] of byCrmName) (namesOf.get(id) ?? namesOf.set(id, []).get(id)!).push(name);

  const competitors: Competitor[] = [...namesOf.entries()]
    .map(([id, names]) => {
      names.sort();
      const m = people.get(id);
      const location = names.map((n) => techLocation.get(n)).find((l) => l) ?? "";
      return {
        id,
        displayName: input.displayNames?.[id] || m?.supabaseFullName?.trim() || names[0],
        crmNames: names,
        location,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  issues.sort((a, b) => (a.crmName < b.crmName ? -1 : 1));
  return { competitors, byCrmName, issues };
}
