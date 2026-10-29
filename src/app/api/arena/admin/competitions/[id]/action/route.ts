// POST { action, reason?, rules? }: move a competition through its lifecycle.
// schedule and cancel-before-start are open to rule editors; activate, amend,
// suspend and cancel-after-start are owner-only inside the store.
import { arenaRoute, body, str, BadRequest } from "../../../_lib";
import {
  activateCompetition, amendActiveRules, cancelCompetition, scheduleCompetition, suspendCompetition,
} from "@/lib/arena/config-store";
import type { ArenaRules } from "@/lib/arena/types";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function POST(req: Request, p: P) {
  return arenaRoute("arena:rules:edit", async ({ session, ctx }) => {
    const { id } = await p.params;
    const b = await body(req);
    const by = session.userId;
    switch (b.action) {
      case "schedule": await scheduleCompetition(ctx.config, id, by); break;
      case "activate": await activateCompetition(ctx.config, id, by); break;
      case "suspend": await suspendCompetition(ctx.config, id, by, str(b.reason, "reason")); break;
      case "cancel": await cancelCompetition(ctx.config, id, by, str(b.reason, "reason")); break;
      case "amend":
        if (!b.rules || typeof b.rules !== "object") throw new BadRequest("rules are required");
        return amendActiveRules(ctx.config, id, b.rules as ArenaRules, by, str(b.reason, "reason"));
      default: throw new BadRequest("unknown action");
    }
    return { ok: true };
  });
}
