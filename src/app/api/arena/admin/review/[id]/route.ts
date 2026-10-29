// GET: one case and its full history.
// POST { op: resolve | confirm | reject | reopen, resolution?, reason? }.
// confirm and reject are owner-only; some resolutions wait for the owner.
import { arenaRoute, body, BadRequest } from "../../_lib";
import { caseHistory, confirmCase, rejectCase, reopenCase, resolveCase, type Resolution } from "@/lib/arena/review";
import { ARENA_COLLECTIONS } from "@/lib/arena/mongo-store";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function GET(_req: Request, p: P) {
  return arenaRoute("arena:console:view", async ({ ctx }) => {
    const id = decodeURIComponent((await p.params).id);
    const c = await ctx.arenaDb.collection(ARENA_COLLECTIONS.reviewCases).findOne({ _id: id as never });
    if (!c) throw new BadRequest("no review case with that id");
    return { case: c, history: await caseHistory(ctx.review, id) };
  });
}

export async function POST(req: Request, p: P) {
  return arenaRoute("arena:review:edit", async ({ session, ctx }) => {
    const id = decodeURIComponent((await p.params).id);
    const b = await body(req);
    const reason = typeof b.reason === "string" ? b.reason : "";
    switch (b.op) {
      case "resolve":
        if (!b.resolution || typeof b.resolution !== "object") throw new BadRequest("a decision is required");
        return resolveCase(ctx.review, id, b.resolution as Resolution, session.userId, reason);
      case "confirm": return confirmCase(ctx.review, id, session.userId);
      case "reject": return rejectCase(ctx.review, id, session.userId, reason);
      case "reopen": return reopenCase(ctx.review, id, session.userId, reason);
      default: throw new BadRequest("unknown operation");
    }
  });
}
