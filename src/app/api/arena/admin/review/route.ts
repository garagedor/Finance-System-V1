// GET ?kind=&status=: review cases, launch readiness, and the verified people
//   an identity case may be attached to (chosen explicitly, never guessed).
// POST { firstWeek?, weeks? }: scan CRM weeks (read-only) for new cases.
import { arenaRoute, body, BadRequest } from "../_lib";
import { readiness, type ReviewKind, type ReviewStatus } from "@/lib/arena/review";
import { lastCompletedWeek, scanForReview } from "@/lib/arena/admin-service";
import { ARENA_COLLECTIONS, loadMappings } from "@/lib/arena/mongo-store";
import { SEED_STANDARD_WEEK } from "@/lib/arena/config";
import { addDays, isMonday } from "@/lib/arena/week";
import type { ArenaRules } from "@/lib/arena/types";

export const dynamic = "force-dynamic";
const KINDS: ReviewKind[] = ["duplicate_group", "identity_name", "display_name"];
const STATUSES: ReviewStatus[] = ["open", "pending_owner", "resolved"];

export async function GET(req: Request) {
  return arenaRoute("arena:console:view", async ({ ctx }) => {
    const sp = new URL(req.url).searchParams;
    const f: Record<string, unknown> = {};
    const kind = sp.get("kind");
    if (kind && KINDS.includes(kind as ReviewKind)) f.kind = kind;
    const status = sp.get("status");
    if (status && STATUSES.includes(status as ReviewStatus)) f.status = status;
    const [cases, ready, mappings] = await Promise.all([
      ctx.arenaDb.collection(ARENA_COLLECTIONS.reviewCases).find(f).sort({ kind: 1, status: 1, _id: 1 }).limit(500).toArray(),
      readiness(ctx.review),
      loadMappings(ctx.crmDb),
    ]);
    const people = mappings
      .filter((m) => m.supabaseUserId)
      .map((m) => ({ id: m.supabaseUserId, name: m.supabaseFullName ?? "", crmNames: m.crmTechNames ?? [] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { cases, readiness: ready, people };
  });
}

export async function POST(req: Request) {
  return arenaRoute("arena:review:edit", async ({ session, ctx }) => {
    const b = await body(req);
    // 12 = the 8 scored weeks plus the 4-week Most Improved baseline before them.
    const weeks = b.weeks === undefined ? 12 : Number(b.weeks);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 26) throw new BadRequest("scan 1 to 26 weeks");
    const first = typeof b.firstWeek === "string" ? b.firstWeek : addDays(lastCompletedWeek(), -7 * (weeks - 1));
    if (!isMonday(first)) throw new BadRequest("the scan must start on a Monday");
    // Detection uses the standard template's rules when one exists, else the seed.
    const t = await ctx.arenaDb.collection(ARENA_COLLECTIONS.templates).findOne({ templateId: "standard", current: true });
    const rules = (t?.rules as ArenaRules | undefined) ?? SEED_STANDARD_WEEK;
    return scanForReview(ctx, rules, first, weeks, session.userId);
  });
}
