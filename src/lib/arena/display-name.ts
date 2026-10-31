/**
 * Public display names (owner decision 2026-10-31): leaderboards, history and
 * winners show "First L." — first name + last-name initial — never the full
 * name. The canonical competitor id stays the ONLY internal key (rankings,
 * tie-breaks, mapping, audit); a display name never identifies anyone.
 *
 * Pure and deterministic: the roster is resolved over every verified person
 * (all mapping records, not only this week's competitors), sorted by
 * canonical id, so a person's public name does not depend on input order or
 * on who happened to work this week.
 *
 *   1. owner/admin override → shown verbatim (never reformatted)
 *   2. Latin full name      → "First L." (single word: as written)
 *   3. non-Latin full name  → the CRM (English) name formatted the same way,
 *                             else the raw name; flagged "needs English display name"
 * Collisions (case-insensitive) among formatted names:
 *   a. lengthen the last-name prefix for the colliding people only ("Eli Be." / "Eli Bo.")
 *   b. identical first + last → append the location ("Matan Y. · Chicago")
 *   c. still identical → flagged BLOCKING: an admin must set an override
 * Separately, two full names within 2 edits of each other get a non-blocking
 * hint "possible duplicate account — confirm".
 */

export type DisplayNameFormat = "FIRST_LAST_INITIAL_V1" | "FULL_NAME_V0";
export const CURRENT_DISPLAY_NAME_FORMAT: DisplayNameFormat = "FIRST_LAST_INITIAL_V1";

export type NameSource = "override" | "formatted" | "crm_fallback" | "raw";
export type CollisionTier = "prefix" | "location" | "unresolved";

export interface PublicName {
  id: string;
  /** The name as stored (balance-app full name, else the CRM name). */
  fullName: string;
  displayName: string;
  source: NameSource;
  /** The full name is not in Latin letters: an English display name is needed. */
  needsEnglish: boolean;
  /** How a collision was resolved; "unresolved" blocks review until an override is set. */
  collision: CollisionTier | null;
  /** Other ids whose full name is within 2 edits of this one (hint only). */
  possibleDuplicateOf: string[];
}

export interface RosterPerson {
  id: string;
  fullName?: string | null;
  /** CRM names, used as the English fallback for a non-Latin full name. */
  crmNames?: string[];
  location?: string | null;
}

const collapse = (s: string) => s.trim().replace(/\s+/g, " ");
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/;
/** Every letter is Latin (accents allowed) and there is at least one. */
export const isLatinName = (s: string) => LATIN_LETTER.test(s) && !/[^\sA-Za-zÀ-ɏ.'’-]/.test(s);
const upperFirst = (s: string) => (s ? s[0].toLocaleUpperCase("en-US") + s.slice(1) : s);

interface Parsed { first: string; last: string | null }
function parse(name: string): Parsed {
  const parts = collapse(name).split(" ");
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: upperFirst(parts[0]), last: parts[parts.length - 1] };
}
function lastPart(last: string, n: number): string {
  const bare = last.replace(/\.+$/, "") || last;
  const p = upperFirst(bare.slice(0, n));
  // A lengthened prefix that is the whole last name is shown without a dot.
  return n > 1 && n >= bare.length ? p : `${p}.`;
}
const render = (p: Parsed, n = 1) => (p.last === null ? p.first : `${p.first} ${lastPart(p.last, n)}`);

/**
 * The public form of one Latin name: "First L." (first letter of the first
 * name capitalised; middle names dropped; the LAST token is the last name, so
 * "Ana Ben-David" → "Ana B." and "Ana de la Cruz" → "Ana C."). Single word → as
 * written. Returns null when the name cannot be formatted (empty or non-Latin).
 */
export function formatPublicName(fullName: string | null | undefined): string | null {
  const s = collapse(fullName ?? "");
  if (!s || !isLatinName(s)) return null;
  return render(parse(s));
}

/** Levenshtein distance, capped (returns cap+1 as soon as it is exceeded). */
export function editDistance(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

const key = (s: string) => s.toLocaleLowerCase("en-US");

/**
 * Resolve the public name of every person. `overrides` (id → name) win
 * verbatim. Output sorted by id; identical for any input order.
 */
export function resolvePublicNames(people: RosterPerson[], overrides: Record<string, string> = {}): Map<string, PublicName> {
  const sorted = [...new Map(people.filter((p) => p.id).map((p) => [p.id, p])).values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const out = new Map<string, PublicName>();
  const parsed = new Map<string, Parsed>();
  for (const p of sorted) {
    const crm = [...(p.crmNames ?? [])].filter((n) => typeof n === "string" && n.trim()).sort();
    const full = collapse(p.fullName ?? "") || collapse(crm[0] ?? "");
    const override = overrides[p.id]?.trim();
    const latin = !!full && isLatinName(full);
    const row: PublicName = { id: p.id, fullName: full, displayName: full, source: "raw", needsEnglish: !!full && !latin, collision: null, possibleDuplicateOf: [] };
    if (override) {
      row.displayName = override;
      row.source = "override";
      row.needsEnglish = false;
    } else if (latin) {
      parsed.set(p.id, parse(full));
      row.source = "formatted";
    } else {
      const english = crm.find((n) => isLatinName(collapse(n)));
      if (english) {
        parsed.set(p.id, parse(english));
        row.source = "crm_fallback";
      }
    }
    out.set(p.id, row);
  }

  // Collisions among formatted names only (overrides are never reformatted).
  const groups = new Map<string, string[]>();
  for (const [id, p] of parsed) {
    const k = key(render(p));
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(id);
  }
  for (const [id, p] of parsed) out.get(id)!.displayName = render(p);
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    // a. lengthen the prefix: at each length, members whose prefix is unique in the group are done
    let open = ids.filter((id) => parsed.get(id)!.last !== null);
    const longest = Math.max(0, ...open.map((id) => parsed.get(id)!.last!.length));
    for (let n = 2; n <= longest && open.length > 1; n++) {
      const count = new Map<string, number>();
      for (const id of open) {
        const k = key(lastPart(parsed.get(id)!.last!, n));
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      const done = open.filter((id) => count.get(key(lastPart(parsed.get(id)!.last!, n))) === 1);
      for (const id of done) {
        out.get(id)!.displayName = render(parsed.get(id)!, n);
        out.get(id)!.collision = "prefix";
      }
      open = open.filter((id) => !done.includes(id));
    }
    // b. identical first + last (or single words): append the location
    const rest = ids.filter((id) => out.get(id)!.collision === null);
    for (const id of rest) {
      const loc = collapse(people.find((p) => p.id === id)?.location ?? "");
      out.get(id)!.displayName = loc ? `${render(parsed.get(id)!)} · ${loc}` : render(parsed.get(id)!);
      out.get(id)!.collision = "location";
    }
  }

  // c. anything still equal (including overrides and raw names) → blocking
  const finalGroups = new Map<string, string[]>();
  for (const r of out.values()) {
    const k = key(r.displayName);
    (finalGroups.get(k) ?? finalGroups.set(k, []).get(k)!).push(r.id);
  }
  for (const ids of finalGroups.values()) if (ids.length > 1) for (const id of ids) out.get(id)!.collision = "unresolved";

  // possible duplicate accounts: full names within 2 edits (hint, never a merge)
  const rows = [...out.values()];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = key(rows[i].fullName), b = key(rows[j].fullName);
      if (!a || !b || editDistance(a, b) > 2) continue;
      rows[i].possibleDuplicateOf.push(rows[j].id);
      rows[j].possibleDuplicateOf.push(rows[i].id);
    }
  }
  return out;
}

/** The location a person is known by: first non-empty location of their CRM names (sorted). */
export function personLocation(crmNames: string[], techLocation: Map<string, string>): string {
  return [...crmNames].sort().map((n) => techLocation.get(n) ?? "").find((l) => l) ?? "";
}
