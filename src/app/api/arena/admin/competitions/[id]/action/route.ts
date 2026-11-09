// POST { action, reason?, rules? }: move a competition through its lifecycle.
// schedule and cancel-before-start are open to rule editors; activate, amend,
// suspend and cancel-after-start are owner-only inside the store.
// Lifecycle (lifecycle.ts): freeze (only after Sunday ends), open_review,
// reconcile. activate { beta: true } starts the week as a LIVE BETA test week
// (owner only; never approvable as official). freeze_now_dev is owner-only AND refused unless ARENA_DEV_STACK=1.
// late_decision { snapshotId, choice: keep_freeze|accept_correction, reason }:
// the owner's explicit choice when CRM edits after the freeze change prizes
// (owner-only inside the lifecycle). late_check: re-read the CRM for an
// approved week and log late corrections (never changes the approved result).
import { arenaRoute, body, str, BadRequest } from "../../../_lib";
import {
  activateCompetition, amendActiveRules, cancelCompetition, scheduleCompetition, suspendCompetition,
} from "@/lib/arena/config-store";
import type { ArenaRules } from "@/lib/arena/types";
import {
  checkLateCorrections, decideLateChanges, freezeCompetition, openReview, reconcileCompetition, type LateChoice,
} from "@/lib/arena/lifecycle";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function POST(req: Request, p: P) {
  return arenaRoute("arena:rules:edit", async ({ session, ctx }) => {
    const { id } = await p.params;
    const b = await body(req);
    const by = session.userId;
    switch (b.action) {
      case "schedule": await scheduleCompetition(ctx.config, id, by); break;
      case "activate":
        if (b.beta !== undefined && typeof b.beta !== "boolean") throw new BadRequest("beta must be true or false");
        await activateCompetition(ctx.config, id, by, { beta: b.beta === true });
        break;
      case "suspend": await suspendCompetition(ctx.config, id, by, str(b.reason, "reason")); break;
      case "cancel": await cancelCompetition(ctx.config, id, by, str(b.reason, "reason")); break;
      case "freeze": return { snapshot: (await freezeCompetition(ctx.lifecycle, id, by))._id };
      case "freeze_now_dev": return { snapshot: (await freezeCompetition(ctx.lifecycle, id, by, { devEarlyClose: true }))._id };
      case "open_review": return { snapshot: (await openReview(ctx.lifecycle, id, by))._id };
      case "reconcile": return { snapshot: (await reconcileCompetition(ctx.lifecycle, id, by))._id };
      case "late_decision":
        return {
          snapshot: (await decideLateChanges(ctx.lifecycle, id, by, {
            snapshotId: str(b.snapshotId, "snapshotId"), choice: str(b.choice, "choice") as LateChoice, reason: str(b.reason, "reason"),
          }))._id,
        };
      case "late_check": {
        const r = await checkLateCorrections(ctx.lifecycle, id, by);
        return { status: r.status, changes: r.report.changes.length, material: r.report.impact.material };
      }
      case "amend":
        if (!b.rules || typeof b.rules !== "object") throw new BadRequest("rules are required");
        return amendActiveRules(ctx.config, id, b.rules as ArenaRules, by, str(b.reason, "reason"));
      default: throw new BadRequest("unknown action");
    }
    return { ok: true };
  });
}
