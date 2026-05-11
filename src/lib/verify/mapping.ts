// Identity matching between Supabase (Lovable Balance app) and CRM (this app).
//
// Two paths:
// 1. Mapping-aware: caller supplies the user's mapped CRM names (from Mongo).
//    A CRM name matches if it appears in that list.
// 2. Fallback: case-insensitive trimmed exact match against the Supabase name.
//
// The mapping path lets admins reconcile "Bar Kadosh" (Supabase) with "Bar"
// (CRM) without renaming users on either side.

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/** True if the Supabase user.full_name corresponds to the CRM Job.tech value. */
export function matchTechName(crmTechName: string, supabaseFullName: string): boolean {
  const a = norm(crmTechName);
  const b = norm(supabaseFullName);
  if (!a || !b) return false;
  return a === b;
}

/** Mapping-aware tech match: prefers the mapping list, falls back to exact match. */
export function matchTechWithMapping(
  crmTechName: string,
  supabaseFullName: string,
  mappedCrmNames: string[] | null | undefined,
): boolean {
  if (mappedCrmNames && mappedCrmNames.length > 0) {
    const target = norm(crmTechName);
    return mappedCrmNames.some((n) => norm(n) === target);
  }
  return matchTechName(crmTechName, supabaseFullName);
}

/** True if the Supabase area.name corresponds to the CRM Job.location value. */
export function matchAreaName(crmLocation: string, supabaseAreaName: string): boolean {
  const a = norm(crmLocation);
  const b = norm(supabaseAreaName);
  if (!a || !b) return false;
  return a === b;
}

/** Mapping-aware area match: prefers the mapping list, falls back to exact match. */
export function matchAreaWithMapping(
  crmLocation: string,
  supabaseAreaName: string,
  mappedCrmLocations: string[] | null | undefined,
): boolean {
  if (mappedCrmLocations && mappedCrmLocations.length > 0) {
    const target = norm(crmLocation);
    return mappedCrmLocations.some((n) => norm(n) === target);
  }
  return matchAreaName(crmLocation, supabaseAreaName);
}

/** Normalizes any string for tolerant matching (date+address pairing). */
export function normString(s: string | null | undefined): string {
  return norm(s);
}
