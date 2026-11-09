// POST: save a template (every save is a new version; old versions are kept).
import { arenaRoute, body, str, BadRequest } from "../_lib";
import { saveTemplate } from "@/lib/arena/config-store";
import type { ArenaRules } from "@/lib/arena/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return arenaRoute("arena:rules:edit", async ({ session, ctx }) => {
    const b = await body(req);
    const templateId = str(b.templateId, "templateId");
    if (!/^[a-z0-9-]{2,40}$/.test(templateId)) throw new BadRequest("template ids use lowercase letters, digits and hyphens");
    if (!b.rules || typeof b.rules !== "object") throw new BadRequest("rules are required");
    return saveTemplate(ctx.config, { templateId, name: str(b.name, "name"), rules: b.rules as ArenaRules }, session.userId);
  });
}
