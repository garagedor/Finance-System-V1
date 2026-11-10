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
import { CURRENT_DISPLAY_NAME_FORMAT, personLocation, resolvePublicNames, type DisplayNameFormat, type PublicName } from "./display-name";

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
  /**
   * How public names are built. Default: the current owner-approved format.
   * FULL_NAME_V0 reproduces results computed before 2026-10-31 (stored records
   * carry the format they were computed with; they are never rewritten).
   */
  nameFormat?: DisplayNameFormat;
  /**
   * Competitor ids the owner excluded from the Arena (arena_participation).
   * THE central participation filter: every computation (live, monitor,
   * freeze, review re-check, preview, scan, shadow) builds its map here. Their
   * names stay attributed (a decided exclusion, never an unmapped-name case);
   * they are left out of `competitors` and listed in `notParticipating`.
   * Matched by competitor id only, never by name.
   */
  notParticipating?: readonly string[];
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
  const nameFormat = input.nameFormat ?? CURRENT_DISPLAY_NAME_FORMAT;
  const publicNames = nameFormat === "FULL_NAME_V0" ? new Map<string, PublicName>() : rosterNames(input.mappings, input.technicians, input.displayNames);
  const namesOf = new Map<string, string[]>();
  for (const [name, id] of byCrmName) (namesOf.get(id) ?? namesOf.set(id, []).get(id)!).push(name);

  const excluded = new Set((input.notParticipating ?? []).filter((id) => people.has(id)));
  const competitors: Competitor[] = [...namesOf.entries()]
    .filter(([id]) => !excluded.has(id))
    .map(([id, names]) => {
      names.sort();
      const m = people.get(id);
      const location = names.map((n) => techLocation.get(n)).find((l) => l) ?? "";
      return {
        id,
        displayName:
          nameFormat === "FULL_NAME_V0"
            ? input.displayNames?.[id] || m?.supabaseFullName?.trim() || names[0]
            : publicNames.get(id)?.displayName || names[0],
        crmNames: names,
        location,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  issues.sort((a, b) => (a.crmName < b.crmName ? -1 : 1));
  const map: CompetitorMap = { competitors, byCrmName, issues, nameFormat, publicNames };
  if (excluded.size) map.notParticipating = [...excluded].sort();
  return map;
}

/**
 * Public names of EVERY verified person (all mapping records), so a name is
 * stable across weeks and collisions are judged against everyone.
 */
export function rosterNames(
  mappings: MappingRecord[],
  technicians: TechnicianRecord[],
  overrides: Record<string, string> = {},
): Map<string, PublicName> {
  const techLocation = new Map(technicians.map((t) => [t._id, t.location ?? ""]));
  return resolvePublicNames(
    mappings
      .filter((m) => m.supabaseUserId)
      .map((m) => {
        const crmNames = (m.crmTechNames ?? []).filter((n): n is string => typeof n === "string" && !!n.trim());
        return { id: m.supabaseUserId, fullName: m.supabaseFullName, crmNames, location: personLocation(crmNames, techLocation) };
      }),
    overrides,
  );
}
