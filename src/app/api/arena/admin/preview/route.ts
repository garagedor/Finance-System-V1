// POST { rules, weekStart }: run the real engine with these rules on a past
// week's real CRM jobs. Read-only; nothing is saved.
import { arenaRoute, body, str, BadRequest } from "../_lib";
import { previewRules } from "@/lib/arena/admin-service";
import { assertValidRules } from "@/lib/arena/config";
import { currentSettings } from "@/lib/arena/config-store";
import type { ArenaRules } from "@/lib/arena/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return arenaRoute("arena:console:view", async ({ ctx }) => {
    const b = await body(req);
    if (!b.rules || typeof b.rules !== "object") throw new BadRequest("rules are required");
    const rules = b.rules as ArenaRules;
    const s = await currentSettings(ctx.config);
    assertValidRules(rules, { knownStatuses: ctx.config.knownStatuses, ceilingCents: s.budgetCeilingCents });
    return previewRules(ctx, rules, str(b.weekStart, "weekStart"));
  });
}
