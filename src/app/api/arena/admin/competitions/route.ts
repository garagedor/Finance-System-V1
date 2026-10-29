// POST: create a week's competition from a template, the previous week, or explicit rules.
import { arenaRoute, body, str, BadRequest } from "../_lib";
import { createCompetition } from "@/lib/arena/config-store";
import type { ArenaRules } from "@/lib/arena/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return arenaRoute("arena:rules:edit", async ({ session, ctx }) => {
    const b = await body(req);
    const weekStart = str(b.weekStart, "weekStart");
    const from = (b.from ?? {}) as Record<string, unknown>;
    const source =
      typeof from.template === "string" ? { template: from.template }
      : from.copyPreviousWeek === true ? { copyPreviousWeek: true as const }
      : from.rules && typeof from.rules === "object" ? { rules: from.rules as ArenaRules }
      : null;
    if (!source) throw new BadRequest("choose a template, the previous week, or rules to start from");
    return createCompetition(ctx.config, weekStart, source, session.userId);
  });
}
