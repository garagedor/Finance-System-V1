/**
 * Pilot allowlist: WHICH technicians may use the technician API while it is on.
 *
 * Default deny. With ARENA_TECH_ENABLED=1, only a competitor id with an
 * `allowed: true` record in arena_tech_access gets past the exchange and the
 * per-request pass check. Everyone else receives exactly the "Arena off" answer
 * (503 arena_disabled), so being left out reveals nothing (access.ts).
 *
 *   arena_tech_access   one document per competitor id (the Weekly Balance user
 *                       id, lowercase): the CURRENT state only
 *   arena_audit         every grant / revoke: who, when, why, before → after
 *
 * Changes are owner-only, enforced here against the owner id in the current
 * Arena settings (the same rule as activate / amend / suspend), with a written
 * reason. Nothing is cached: a revoke is refused on the technician's very next
 * request, even with an unexpired pass. A lookup failure counts as "not allowed"
 * (fail closed).
 *
 * This list controls ACCESS only. It does not change who is scored, ranked or
 * prize-eligible; that is the competition's participant rules (rules.participants).
 */
import type { StoreCollection, StoreContext } from "../config-store";
import { ArenaAuthorizationError, currentSettings } from "../config-store";
import { ArenaConfigError } from "../config";

export interface TechAccessDoc {
  _id: string; // competitor id = Weekly Balance user id (lowercase uuid)
  allowed: boolean;
  reason: string;
  by: string;
  at: string;
}

export type TechAccessCollection = StoreCollection<TechAccessDoc>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_REASON = 500;

/** Canonical form of a competitor id (the exchange lowercases the token subject the same way). */
export function canonicalCompetitorId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

/** Is this competitor on the allowlist right now? Strict: only `allowed === true` counts. */
export async function isAllowlisted(coll: Pick<TechAccessCollection, "findOne">, competitorId: string): Promise<boolean> {
  const id = canonicalCompetitorId(competitorId);
  if (!id) return false;
  const doc = await coll.findOne({ _id: id });
  return doc?.allowed === true;
}

export async function listTechAccess(coll: TechAccessCollection): Promise<TechAccessDoc[]> {
  return coll.find({}).sort({ at: -1 }).toArray();
}

function checkedReason(reason: string): string {
  const r = (reason ?? "").trim();
  if (!r) throw new ArenaConfigError(["a reason is required"]);
  if (r.length > MAX_REASON) throw new ArenaConfigError([`the reason must be at most ${MAX_REASON} characters`]);
  return r;
}

async function assertOwner(ctx: StoreContext, by: string) {
  const s = await currentSettings(ctx);
  if (by !== s.ownerUserId) throw new ArenaAuthorizationError("only the owner can change technician access");
}

async function audit(ctx: StoreContext, action: string, id: string, by: string, reason: string, before: boolean | null, after: boolean) {
  await ctx.store.audit.insertOne({
    _id: ctx.newId("aaud"),
    action,
    target: `tech_access:${id}`,
    by,
    at: ctx.now().toISOString(),
    reason,
    before: before === null ? null : { allowed: before },
    after: { allowed: after },
  });
}

/**
 * Owner only: grant (allowed=true) or revoke (allowed=false) one competitor's
 * access. Idempotent: setting the current state again changes and audits nothing.
 */
export async function setTechAccess(
  ctx: StoreContext,
  coll: TechAccessCollection,
  competitorIdRaw: string,
  allowed: boolean,
  by: string,
  reasonRaw: string,
): Promise<{ changed: boolean; doc: TechAccessDoc }> {
  await assertOwner(ctx, by);
  const id = canonicalCompetitorId(competitorIdRaw);
  if (!id) throw new ArenaConfigError(["competitorId must be a Weekly Balance user id (uuid)"]);
  const reason = checkedReason(reasonRaw);
  const cur = await coll.findOne({ _id: id });
  if (cur && cur.allowed === allowed) return { changed: false, doc: cur };
  const doc: TechAccessDoc = { _id: id, allowed, reason, by, at: ctx.now().toISOString() };
  if (cur) await coll.updateOne({ _id: id }, { $set: { allowed, reason, by, at: doc.at } });
  else await coll.insertOne(doc);
  await audit(ctx, allowed ? "tech_access.grant" : "tech_access.revoke", id, by, reason, cur ? cur.allowed : null, allowed);
  return { changed: true, doc };
}

/** Owner only, emergency: revoke everyone currently allowed. Returns the ids revoked. */
export async function revokeAllTechAccess(ctx: StoreContext, coll: TechAccessCollection, by: string, reasonRaw: string): Promise<string[]> {
  await assertOwner(ctx, by);
  const reason = checkedReason(reasonRaw);
  const on = await coll.find({ allowed: true }).sort({ _id: 1 }).toArray();
  for (const d of on) {
    const at = ctx.now().toISOString();
    await coll.updateOne({ _id: d._id }, { $set: { allowed: false, reason, by, at } });
    await audit(ctx, "tech_access.revoke_all", d._id, by, reason, true, false);
  }
  return on.map((d) => d._id);
}
