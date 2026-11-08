// POST: create a week's competition from a template, the previous week, or explicit rules.
// { beta: true } creates a LIVE BETA test week (owner only, enforced in the store):
// it can never be approved as official.
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
    if (b.beta !== undefined && typeof b.beta !== "boolean") throw new BadRequest("beta must be true or false");
    return createCompetition(ctx.config, weekStart, source, session.userId, { beta: b.beta === true });
  });
}
