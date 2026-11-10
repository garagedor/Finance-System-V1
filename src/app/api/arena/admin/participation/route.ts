// Manage Technicians: the owner-controlled Arena participation list.
// See src/lib/arena/participation.ts.
// GET: every verified person (TechNameMapping) and every CRM Technician record,
//      with stable ids, location, Arena participation, review flags, the last
//      known Weekly Balance account state and the app-access (allowlist) state,
//      plus the participation audit. Read-only.
// POST { competitorId, status: "excluded" | "included", reason }: exclude or
//      re-include one verified person. Owner-only inside the store (settings
//      owner) on top of arena:rules:edit; a reason is always required. Matched
//      by competitor id only. There is no technician route for this.
import { arenaRoute, body, str, BadRequest } from "../_lib";
import { ARENA_COLLECTIONS, loadMappingFor, loadMappings, loadTechnicians, participationCollection } from "@/lib/arena/mongo-store";
import { listParticipation, participationId, participationRoster, setParticipation } from "@/lib/arena/participation";
import { reviewDecisions } from "@/lib/arena/review";
import { rosterNames } from "@/lib/arena/identity";
import { keepLiveWarm } from "@/lib/arena/lifecycle";

export const dynamic = "force-dynamic";

export async function GET() {
  return arenaRoute("arena:console:view", async ({ session, ctx }) => {
    const [mappings, technicians, docs, decisions, accounts, access, audit, settings] = await Promise.all([
      loadMappings(ctx.crmDb),
      loadTechnicians(ctx.crmDb),
      listParticipation(participationCollection(ctx.arenaDb)),
      reviewDecisions(ctx.review),
      ctx.arenaDb.collection(ARENA_COLLECTIONS.accountStatus).find({}).toArray(),
      ctx.arenaDb.collection(ARENA_COLLECTIONS.techAccess).find({}).toArray(),
      ctx.arenaDb
        .collection(ARENA_COLLECTIONS.audit)
        .find({ action: { $in: ["participation.exclude", "participation.include"] } })
        .sort({ at: -1 })
        .limit(200)
        .toArray(),
      ctx.config.store.settings.findOne({ current: true }),
    ]);
    const rows = participationRoster({
      mappings,
      technicians,
      docs,
      overrides: decisions.overrides,
      publicNames: rosterNames(mappings, technicians, decisions.displayNames),
      accounts: accounts as never,
      access: access as never,
    });
    return {
      isOwner: !!settings && settings.ownerUserId === session.userId,
      rows,
      excludedCount: rows.filter((r) => r.status === "excluded").length,
      // The CRM has no reliable active/inactive field (Technician: _id, profitPercent,
      // pastRates, location; TechNameMapping: supabaseUserId, supabaseFullName,
      // crmTechNames, updatedAt), so there is no CRM status column and no suggestion.
      crmStatusField: null,
      audit,
    };
  });
}

export async function POST(req: Request) {
  return arenaRoute("arena:rules:edit", async ({ session, ctx }) => {
    const b = await body(req);
    const reason = str(b.reason, "reason");
    if (b.status !== "excluded" && b.status !== "included") throw new BadRequest("status must be excluded or included");
    const id = participationId(b.competitorId);
    if (!id) throw new BadRequest("competitorId must be the Weekly Balance user id of a verified technician");
    const m = await loadMappingFor(ctx.crmDb, id);
    const person = m && m.supabaseUserId === id ? { crmNames: (m.crmTechNames ?? []).filter((n) => typeof n === "string" && !!n) } : null;
    const out = await setParticipation(ctx.lifecycle, participationCollection(ctx.arenaDb), {
      competitorId: id, status: b.status, reason, by: session.userId, person,
    });
    // Recompute the running week now, so nobody keeps seeing the old list (best
    // effort: the snapshot is already invalidated, so the next read recomputes anyway).
    if (out.changed) {
      try {
        await keepLiveWarm(ctx.lifecycle);
      } catch (e) {
        console.warn("[arena] recompute after a participation change failed:", e instanceof Error ? e.message : e);
      }
    }
    return out;
  });
}
