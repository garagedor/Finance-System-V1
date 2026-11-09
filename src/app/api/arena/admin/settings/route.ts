// POST: one-time initialisation, only by the account named in ARENA_OWNER_USER_ID.
// PUT: owner-only changes to the budget ceiling and the approver list.
import { arenaRoute, body, str, BadRequest } from "../_lib";
import { initSettings, updateSettings, ArenaAuthorizationError } from "@/lib/arena/config-store";
import { SEED_SETTINGS_BUDGET_CEILING_CENTS } from "@/lib/arena/config";
import { arenaOwnerFromEnv } from "@/lib/arena/env";

export const dynamic = "force-dynamic";

const cents = (v: unknown) => {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new BadRequest("the budget ceiling must be whole cents");
  return v;
};

export async function POST() {
  return arenaRoute("arena:console:view", async ({ session, ctx }) => {
    const owner = arenaOwnerFromEnv();
    if (!owner || owner !== session.userId) throw new ArenaAuthorizationError("only the configured owner account can set up the Arena");
    return initSettings(
      ctx.config,
      { budgetCeilingCents: SEED_SETTINGS_BUDGET_CEILING_CENTS, ownerUserId: owner, approverUserIds: [owner] },
      session.userId,
    );
  });
}

export async function PUT(req: Request) {
  return arenaRoute("arena:console:view", async ({ session, ctx }) => {
    const b = await body(req);
    const approvers = b.approverUserIds === undefined ? undefined
      : Array.isArray(b.approverUserIds) && b.approverUserIds.every((x) => typeof x === "string")
        ? (b.approverUserIds as string[]) : (() => { throw new BadRequest("approverUserIds must be a list of account ids"); })();
    return updateSettings(ctx.config, { budgetCeilingCents: cents(b.budgetCeilingCents), approverUserIds: approvers }, session.userId, str(b.reason, "reason"));
  });
}
