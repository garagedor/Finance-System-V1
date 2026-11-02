// Pilot allowlist (technician access). See src/lib/arena/tech/allowlist.ts.
// GET: the list (current state), the technician switch state and the recent
//      access audit. Read-only.
// POST { competitorId, allowed: true|false, reason }: grant or revoke one
//      technician. POST { action: "revoke_all", reason }: emergency, revoke all.
//      Owner-only inside the allowlist store; a reason is always required.
//      A grant must name a verified person (a TechNameMapping record).
import { arenaRoute, body, str, BadRequest } from "../_lib";
import { ARENA_COLLECTIONS, loadMappingFor, loadMappings } from "@/lib/arena/mongo-store";
import {
  canonicalCompetitorId, listTechAccess, revokeAllTechAccess, setTechAccess, type TechAccessCollection,
} from "@/lib/arena/tech/allowlist";
import { techEnabled } from "@/lib/arena/tech/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return arenaRoute("arena:console:view", async ({ ctx }) => {
    const coll = ctx.arenaDb.collection(ARENA_COLLECTIONS.techAccess) as never as TechAccessCollection;
    const [rows, mappings, audit] = await Promise.all([
      listTechAccess(coll),
      loadMappings(ctx.crmDb),
      ctx.arenaDb
        .collection(ARENA_COLLECTIONS.audit)
        .find({ action: { $in: ["tech_access.grant", "tech_access.revoke", "tech_access.revoke_all"] } })
        .sort({ at: -1 })
        .limit(200)
        .toArray(),
    ]);
    const nameOf = new Map(mappings.map((m) => [String(m.supabaseUserId ?? "").toLowerCase(), m.supabaseFullName ?? ""]));
    return {
      techApiEnabled: techEnabled(),
      allowedCount: rows.filter((r) => r.allowed === true).length,
      rows: rows.map((r) => ({ ...r, fullName: nameOf.get(r._id) ?? null })),
      audit,
    };
  });
}

export async function POST(req: Request) {
  return arenaRoute("arena:rules:edit", async ({ session, ctx }) => {
    const b = await body(req);
    const coll = ctx.arenaDb.collection(ARENA_COLLECTIONS.techAccess) as never as TechAccessCollection;
    const reason = str(b.reason, "reason");
    if (b.action === "revoke_all") {
      const revoked = await revokeAllTechAccess(ctx.config, coll, session.userId, reason);
      return { revoked };
    }
    if (b.action !== undefined) throw new BadRequest("unknown action");
    if (typeof b.allowed !== "boolean") throw new BadRequest("allowed must be true or false");
    const id = canonicalCompetitorId(b.competitorId);
    if (!id) throw new BadRequest("competitorId must be a Weekly Balance user id");
    if (b.allowed) {
      // Same lookup the exchange makes (lowercase id), so a grant always matches a usable mapping.
      if (!(await loadMappingFor(ctx.crmDb, id))) throw new BadRequest("that id is not a verified technician (no TechNameMapping record)");
    }
    return setTechAccess(ctx.config, coll, id, b.allowed, session.userId, reason);
  });
}
