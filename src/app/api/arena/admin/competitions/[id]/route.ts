// GET: one competition with its rules, versions, notices and audit trail.
// PUT: edit a draft or scheduled week's rules (always a new version).
import { arenaRoute, body, BadRequest } from "../../_lib";
import { rulesFor, updateDraftRules } from "@/lib/arena/config-store";
import { ARENA_COLLECTIONS } from "@/lib/arena/mongo-store";
import type { ArenaRules } from "@/lib/arena/types";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function GET(_req: Request, p: P) {
  return arenaRoute("arena:console:view", async ({ ctx }) => {
    const { id } = await p.params;
    const db = ctx.arenaDb;
    const competition = await db.collection(ARENA_COLLECTIONS.competitions).findOne({ _id: id as never });
    if (!competition) throw new BadRequest("no competition with that id");
    const [ruleVersion, versions, notices, audit] = await Promise.all([
      rulesFor(ctx.config, id),
      db.collection(ARENA_COLLECTIONS.ruleVersions).find({ competitionId: id }, { projection: { rules: 0 } }).sort({ n: -1 }).toArray(),
      db.collection(ARENA_COLLECTIONS.notices).find({ competitionId: id }).sort({ at: -1 }).toArray(),
      db.collection(ARENA_COLLECTIONS.audit).find({ target: id }).sort({ at: -1 }).limit(100).toArray(),
    ]);
    return { competition, ruleVersion, versions, notices, audit };
  });
}

export async function PUT(req: Request, p: P) {
  return arenaRoute("arena:rules:edit", async ({ session, ctx }) => {
    const { id } = await p.params;
    const b = await body(req);
    if (!b.rules || typeof b.rules !== "object") throw new BadRequest("rules are required");
    return updateDraftRules(ctx.config, id, b.rules as ArenaRules, session.userId);
  });
}
