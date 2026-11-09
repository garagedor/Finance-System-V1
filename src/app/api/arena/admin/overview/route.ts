// GET: everything the Control Center's first screen shows.
import { arenaRoute } from "../_lib";
import { readiness } from "@/lib/arena/review";
import { arenaOwnerFromEnv } from "@/lib/arena/env";
import { ARENA_COLLECTIONS } from "@/lib/arena/mongo-store";
import { SEED_BALANCED_PERFORMANCE, SEED_STANDARD_WEEK, ruleSeed } from "@/lib/arena/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return arenaRoute("arena:console:view", async ({ session, ctx }) => {
    const db = ctx.arenaDb;
    const [settings, competitions, templates, ready] = await Promise.all([
      db.collection(ARENA_COLLECTIONS.settings).findOne({ current: true }),
      db.collection(ARENA_COLLECTIONS.competitions).find({}).sort({ weekStart: -1 }).limit(60).toArray(),
      db.collection(ARENA_COLLECTIONS.templates).find({ current: true }).sort({ name: 1 }).toArray(),
      readiness(ctx.review),
    ]);
    const owner = (settings?.ownerUserId as string | undefined) ?? null;
    return {
      me: {
        userId: session.userId,
        name: session.name,
        isOwner: owner === session.userId,
        // Only the account named in ARENA_OWNER_USER_ID may initialise settings.
        mayInitialise: !settings && arenaOwnerFromEnv() === session.userId,
        canEditRules: session.permissions.includes("arena:rules:edit"),
        canReview: session.permissions.includes("arena:review:edit"),
      },
      settings,
      competitions,
      templates,
      readiness: ready,
      // The approved standard rules, for "new template" (config.ts is server-side).
      seedRules: SEED_STANDARD_WEEK,
      // Owner-approved Balanced Performance (V1) starting point: a NEW template.
      seedBalancedRules: SEED_BALANCED_PERFORMANCE,
      // Owner decision 2026-11-02: 3 cash places + Most Improved, $1,500. Same id as the shadow tooling's code seed.
      seedBalancedP2: (({ id, label, rules }) => ({ templateId: id, name: label, rules }))(ruleSeed("balanced-p2-2026-11")!),
      // Owner rule 2026-11-09: P2 prizes, job minimum counts EVERY assigned job. Same id as the shadow tooling's code seed.
      seedBalancedP3: (({ id, label, rules }) => ({ templateId: id, name: label, rules }))(ruleSeed("balanced-p3-2026-11")!),
      // Least privilege (2026-11-09): the Arena no longer reads the CRM's `users` collection
      // (collection-level `find` would expose whole CRM user records). Only the caller's own name is known.
      userNames: { [session.userId]: session.name ? `${session.name} (you)` : "you" },
    };
  });
}
