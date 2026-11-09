// GET ?target=&before=&limit=: the Arena audit log, newest first. Read-only.
import { arenaRoute } from "../_lib";
import { ARENA_COLLECTIONS } from "@/lib/arena/mongo-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return arenaRoute("arena:console:view", async ({ ctx }) => {
    const sp = new URL(req.url).searchParams;
    const f: Record<string, unknown> = {};
    const target = sp.get("target");
    if (target) f.target = target;
    const before = sp.get("before");
    if (before) f.at = { $lt: before };
    const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 50));
    const rows = await ctx.arenaDb.collection(ARENA_COLLECTIONS.audit).find(f).sort({ at: -1 }).limit(limit).toArray();
    return { rows };
  });
}
