/**
 * Manage Technicians: the owner-controlled Arena participation list.
 *
 *   arena_participation  one document per competitor id (= the Weekly Balance
 *                        user id of a TechNameMapping record): the CURRENT
 *                        state only. No document = included (the default).
 *   arena_audit          every change: who, when, why, before → after.
 *
 * An excluded person is left out of every computation through ONE filter, the
 * competitor map (identity.ts buildCompetitorMap `notParticipating`): no
 * result, rank, prize, projection or Most Improved; their CRM names stay
 * attributed to them, so their jobs are a decided exclusion — never an
 * "unmapped name" review case or a daily STOP. CRM jobs and financial records
 * are never touched.
 *
 * Changes are owner-only (the owner id in the current Arena settings, the same
 * rule as the pilot allowlist), with a written reason, matched by competitor id
 * only (never by name). Weeks, by status:
 *   active / suspended   the live snapshot is invalidated at once; the next read
 *                        (or the immediate recompute the route triggers) uses
 *                        the new list
 *   provisional          the frozen snapshot is never changed; opening the
 *                        review re-checks under the current list (review diff)
 *   in_review            the snapshot under review is never changed; approval
 *                        is refused while it disagrees with the current list
 *                        (lifecycle participationBlockers) until the owner
 *                        re-checks CRM data
 *   approved             never rewritten
 *
 * This is NOT technician access: an excluded person who can still sign in sees
 * "not participating". Access is the pilot allowlist (tech/allowlist.ts) and the
 * Weekly Balance account.
 */
import type { StoreCollection } from "./config-store";
import { ArenaAuthorizationError, currentSettings } from "./config-store";
import { ArenaConfigError } from "./config";
import {
  invalidateLiveSnapshots, participationBlockers, reviewSnapshot, type LifecycleContext,
} from "./lifecycle";

export type ParticipationStatus = "excluded" | "included";

export interface ParticipationDoc {
  _id: string; // competitor id (TechNameMapping.supabaseUserId, exact)
  status: ParticipationStatus;
  reason: string;
  by: string;
  at: string;
  /** The person's CRM names when the decision was taken (information only; matching is by id). */
  crmNames: string[];
}

export type ParticipationCollection = StoreCollection<ParticipationDoc>;

const MAX_REASON = 500;
const MAX_ID = 200;

/** Ids currently excluded, sorted. Fails loudly: a computation must never silently include an excluded person. */
export async function excludedCompetitorIds(coll: Pick<ParticipationCollection, "find">): Promise<string[]> {
  const rows = await coll.find({ status: "excluded" }).sort({ _id: 1 }).toArray();
  return rows.map((r) => r._id);
}

export async function listParticipation(coll: ParticipationCollection): Promise<ParticipationDoc[]> {
  return coll.find({}).sort({ at: -1 }).toArray();
}

/** A competitor id as stored: the exact mapping id, trimmed. Never a name lookup. */
export function participationId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return id && id.length <= MAX_ID && !/\s/.test(id) ? id : null;
}

function checkedReason(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (!r) throw new ArenaConfigError(["a reason is required"]);
  if (r.length > MAX_REASON) throw new ArenaConfigError([`the reason must be at most ${MAX_REASON} characters`]);
  return r;
}

export interface WeekEffect {
  competitionId: string;
  weekStart: string;
  status: string;
  effect: string;
}

export interface SetParticipationInput {
  competitorId: string;
  status: ParticipationStatus;
  reason: string;
  by: string;
  /**
   * The verified person behind the id (TechNameMapping), or null. Excluding
   * needs one; re-including does not (the mapping may have been removed since).
   */
  person: { crmNames: string[] } | null;
}

/**
 * Owner only: exclude or re-include one competitor. Idempotent: setting the
 * current state again changes and audits nothing. Returns what it did to each
 * week that is not finished.
 */
export async function setParticipation(
  lc: LifecycleContext,
  coll: ParticipationCollection,
  input: SetParticipationInput,
): Promise<{ changed: boolean; doc: ParticipationDoc; effects: WeekEffect[] }> {
  const ctx = lc.config;
  const s = await currentSettings(ctx);
  if (input.by !== s.ownerUserId) throw new ArenaAuthorizationError("only the owner can change who takes part in the Arena");
  const id = participationId(input.competitorId);
  if (!id) throw new ArenaConfigError(["competitorId must be the Weekly Balance user id of a verified technician"]);
  if (input.status !== "excluded" && input.status !== "included") throw new ArenaConfigError(["status must be excluded or included"]);
  const reason = checkedReason(input.reason);
  const cur = await coll.findOne({ _id: id });
  const before: ParticipationStatus = cur?.status ?? "included";
  if (input.status === "excluded" && !input.person)
    throw new ArenaConfigError(["that id is not a verified technician (no TechNameMapping record); unmapped CRM names are decided in the review queue"]);
  if (before === input.status) return { changed: false, doc: cur ?? { _id: id, status: "included", reason: "", by: "", at: "", crmNames: input.person?.crmNames ?? [] }, effects: [] };

  const at = ctx.now().toISOString();
  const crmNames = [...(input.person?.crmNames ?? cur?.crmNames ?? [])].filter((n) => typeof n === "string" && n).sort();
  const doc: ParticipationDoc = { _id: id, status: input.status, reason, by: input.by, at, crmNames };
  if (cur) await coll.updateOne({ _id: id }, { $set: { status: doc.status, reason, by: input.by, at, crmNames } });
  else await coll.insertOne(doc);
  await ctx.store.audit.insertOne({
    _id: ctx.newId("aaud"),
    action: input.status === "excluded" ? "participation.exclude" : "participation.include",
    target: `participation:${id}`,
    by: input.by,
    at,
    reason,
    before: cur ? { status: cur.status, reason: cur.reason, by: cur.by, at: cur.at } : { status: "included", default: true },
    after: { status: doc.status, crmNames },
  });

  // Running weeks: the cached live snapshot must not keep showing the old list.
  const invalidated = new Set(await invalidateLiveSnapshots(lc));
  const excludedNow = await excludedCompetitorIds(coll);
  const open = await ctx.store.competitions.find({ status: { $in: ["active", "suspended", "provisional", "in_review"] } }).sort({ weekStart: 1 }).toArray();
  const effects: WeekEffect[] = [];
  for (const c of open) {
    let effect: string;
    if (c.status === "active" || c.status === "suspended")
      effect = invalidated.has(c._id) ? "Live standings recompute now with the new list." : "Live standings use the new list from their first computation.";
    else if (c.status === "provisional")
      effect = "Frozen: the frozen snapshot is not changed. Opening the review re-checks the week under the current list (shown in the review diff).";
    else {
      const snap = await reviewSnapshot(lc, c._id);
      effect = snap && participationBlockers(snap.result, excludedNow).length
        ? "In review: the snapshot under review is not changed. Approval is refused until the owner re-checks CRM data, which applies the current list."
        : "In review: no effect on this week's snapshot (no jobs that week, or already applied).";
    }
    effects.push({ competitionId: c._id, weekStart: c.weekStart, status: c.status, effect });
  }
  return { changed: true, doc, effects };
}

// ── the Manage Technicians list (pure) ─────────────────────────────────────

export interface ParticipationRow {
  /** Competitor id, or `crm:<Technician._id>` for a CRM technician with no verified person. */
  key: string;
  /** Stable id: the Weekly Balance user id (TechNameMapping.supabaseUserId); null = not mapped. */
  competitorId: string | null;
  fullName: string | null;
  /** Public Arena display name (First L.), when mapped. */
  displayName: string | null;
  /** CRM names of the person (TechNameMapping.crmTechNames), or the CRM technician itself. */
  crmNames: string[];
  /** CRM Technician._id values (a name string in this CRM) that exist for those names. */
  crmTechnicianIds: string[];
  /** Technician.location of those records. */
  locations: string[];
  status: ParticipationStatus | "not_mapped";
  decision: { reason: string; by: string; at: string } | null;
  /** Things to look at; `reviewNeeded` ones mean the identity is ambiguous or incomplete. */
  flags: string[];
  reviewNeeded: boolean;
  /** Weekly Balance account, last known by the Arena (arena_account_status), or null. */
  account: { state: string; checkedAt: string } | null;
  /** Pilot allowlist (technician app access): true / false, null = no record (= no access). */
  appAccess: boolean | null;
  /** May the owner exclude / re-include this row here? */
  canChange: boolean;
}

export interface RosterInput {
  mappings: { supabaseUserId: string; supabaseFullName?: string | null; crmTechNames?: string[] | null }[];
  technicians: { _id: string; location?: string | null }[];
  docs: ParticipationDoc[];
  /** Review-queue identity decisions on CRM names (attach to a person, or not a competitor). */
  overrides: { crmName: string; competitorId: string | null }[];
  publicNames: Map<string, { displayName: string }>;
  accounts: { _id: string; state: string; checkedAt: string }[];
  access: { _id: string; allowed: boolean }[];
}

const fold = (s: string) => s.trim().toLowerCase();

export function participationRoster(i: RosterInput): ParticipationRow[] {
  const techById = new Map(i.technicians.map((t) => [t._id, t.location ?? ""]));
  const docOf = new Map(i.docs.map((d) => [d._id, d]));
  const accountOf = new Map(i.accounts.map((a) => [a._id, a]));
  const accessOf = new Map(i.access.map((a) => [a._id, a.allowed]));
  const records = new Map<string, number>();
  for (const m of i.mappings) if (m.supabaseUserId) records.set(m.supabaseUserId, (records.get(m.supabaseUserId) ?? 0) + 1);
  const owners = new Map<string, Set<string>>(); // verbatim CRM name → people
  const foldedOwners = new Map<string, Set<string>>();
  for (const m of i.mappings) {
    if (!m.supabaseUserId) continue;
    for (const n of m.crmTechNames ?? []) {
      if (typeof n !== "string" || !n.trim()) continue;
      (owners.get(n) ?? owners.set(n, new Set()).get(n)!).add(m.supabaseUserId);
      (foldedOwners.get(fold(n)) ?? foldedOwners.set(fold(n), new Set()).get(fold(n))!).add(m.supabaseUserId);
    }
  }
  const nameOf = new Map(i.mappings.map((m) => [m.supabaseUserId, m.supabaseFullName?.trim() || m.supabaseUserId]));
  const override = new Map(i.overrides.map((o) => [o.crmName, o.competitorId])); // last decision wins
  const rows: ParticipationRow[] = [];
  const seen = new Set<string>();

  for (const m of i.mappings) {
    const id = m.supabaseUserId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const crmNames = [...new Set((m.crmTechNames ?? []).filter((n): n is string => typeof n === "string" && !!n.trim()))].sort();
    const attached = [...override.entries()].filter(([n, to]) => to === id && !crmNames.includes(n)).map(([n]) => n);
    const flags: string[] = [];
    let reviewNeeded = false;
    if ((records.get(id) ?? 0) > 1) {
      flags.push("Several TechNameMapping records share this id");
      reviewNeeded = true;
    }
    if (!crmNames.length) {
      flags.push("No CRM name is mapped to this person: no jobs can be attributed");
      reviewNeeded = true;
    }
    for (const n of crmNames) {
      const o = owners.get(n);
      if (o && o.size > 1) {
        flags.push(`CRM name "${n}" is also listed for ${[...o].filter((x) => x !== id).map((x) => nameOf.get(x)).join(", ")}: ambiguous, its jobs count for nobody until resolved`);
        reviewNeeded = true;
      }
      if (!techById.has(n)) flags.push(`No CRM Technician record named "${n}"`);
    }
    for (const n of attached) flags.push(`CRM name "${n}" is attached to this person by a review decision`);
    const all = [...crmNames, ...attached];
    const d = docOf.get(id);
    rows.push({
      key: id,
      competitorId: id,
      fullName: m.supabaseFullName?.trim() || null,
      displayName: i.publicNames.get(id)?.displayName ?? null,
      crmNames: all,
      crmTechnicianIds: all.filter((n) => techById.has(n)),
      locations: [...new Set(all.map((n) => techById.get(n) ?? "").filter(Boolean))].sort(),
      status: d?.status ?? "included",
      decision: d ? { reason: d.reason, by: d.by, at: d.at } : null,
      flags,
      reviewNeeded,
      account: accountOf.has(id) ? { state: accountOf.get(id)!.state, checkedAt: accountOf.get(id)!.checkedAt } : null,
      appAccess: accessOf.has(id.toLowerCase()) ? accessOf.get(id.toLowerCase())! : null,
      canChange: true,
    });
  }

  // A decision whose mapping record is gone: shown so it can be re-included.
  for (const d of i.docs) {
    if (seen.has(d._id)) continue;
    seen.add(d._id);
    rows.push({
      key: d._id, competitorId: d._id, fullName: null, displayName: null, crmNames: d.crmNames,
      crmTechnicianIds: d.crmNames.filter((n) => techById.has(n)),
      locations: [...new Set(d.crmNames.map((n) => techById.get(n) ?? "").filter(Boolean))].sort(),
      status: d.status, decision: { reason: d.reason, by: d.by, at: d.at },
      flags: ["The TechNameMapping record for this id no longer exists"], reviewNeeded: true,
      account: null, appAccess: null, canChange: d.status === "excluded",
    });
  }

  // CRM technicians that no verified person lists verbatim.
  for (const t of i.technicians) {
    if (owners.has(t._id)) continue;
    const o = override.get(t._id);
    if (o) continue; // attached by a review decision: shown on that person's row
    const flags: string[] = [];
    if (o === null) flags.push("Decided in the review queue: not a competitor");
    else {
      const loose = foldedOwners.get(fold(t._id));
      if (loose?.size) flags.push(`Spelling matches a CRM name of ${[...loose].map((x) => nameOf.get(x)).join(", ")}: confirm in the review queue`);
      flags.push("Not mapped: no verified Weekly Balance person. Map it, or decide it in the review queue");
    }
    rows.push({
      key: `crm:${t._id}`, competitorId: null, fullName: null, displayName: null, crmNames: [t._id], crmTechnicianIds: [t._id],
      locations: t.location ? [t.location] : [], status: "not_mapped", decision: null, flags,
      reviewNeeded: o !== null, account: null, appAccess: null, canChange: false,
    });
  }

  const rank = (r: ParticipationRow) => (r.status === "excluded" ? 0 : r.reviewNeeded ? 1 : r.status === "not_mapped" ? 3 : 2);
  const label = (r: ParticipationRow) => (r.displayName ?? r.fullName ?? r.crmNames[0] ?? r.key).toLowerCase();
  return rows.sort((a, b) => rank(a) - rank(b) || label(a).localeCompare(label(b)) || (a.key < b.key ? -1 : 1));
}
