// GET: results of one week for the Control Center — the live/frozen/review
// standings, the provisional-vs-review diff, approval blockers and window,
// and the approved record once it exists. Read-only (apart from the same
// read-triggered live refresh / freeze-if-due technicians cause).
import { arenaRoute, BadRequest } from "../../../_lib";
import {
  approvalBlockers, freezeIfDue, liveSnapshot, phaseOf, reviewDiff, reviewSnapshot, ruleVersionOf, windowOf,
} from "@/lib/arena/lifecycle";
import { currentSettings } from "@/lib/arena/config-store";
import { ACCOUNT_REASON } from "@/lib/arena/accounts";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function GET(_req: Request, p: P) {
  return arenaRoute("arena:console:view", async ({ session, ctx }) => {
    const { id } = await p.params;
    const lc = ctx.lifecycle;
    const c0 = await lc.config.store.competitions.findOne({ _id: id });
    if (!c0) throw new BadRequest("no competition with that id");
    const c = await freezeIfDue(lc, c0);
    const rv = await ruleVersionOf(lc, c);
    const w = windowOf(c, rv);
    const now = lc.config.now();
    const live = c.status === "active" || c.status === "suspended" ? await liveSnapshot(lc, c, rv) : null;
    const provisional = await lc.lc.snapshots.findOne({ _id: `${id}:provisional` });
    const review = c.status === "in_review" || c.status === "approved" ? await reviewSnapshot(lc, id) : null;
    const shown = c.status === "approved" ? null : review ?? provisional ?? live;
    const result = await lc.lc.results.findOne({ _id: id });
    const settings = await currentSettings(lc.config);
    const strip = (s: typeof shown) => s && {
      _id: s._id, kind: s.kind, n: s.n, computedAt: s.computedAt, ruleVersionId: s.ruleVersionId,
      eligibleCount: s.result.eligibleCount, awardedCents: s.result.awardedCents, unallocatedCents: s.result.unallocatedCents,
      rows: s.result.results.map((r) => ({
        competitorId: r.competitorId, displayName: r.displayName, location: r.location, rank: r.rank, score: r.score,
        eligible: r.eligible, qualifyingJobs: r.qualifyingJobs, assignedJobs: r.assignedJobs, closedJobs: r.closedJobs,
        closingRate: r.closingRate, avgTicket: r.avgTicket, prizePosition: r.prizePosition, prizeCents: r.prizeCents,
        wonMostImproved: r.wonMostImproved,
        // Admin-only: the Weekly Balance account standing and why (never sent to technicians).
        prizeEligible: r.prizeEligible ?? r.eligible,
        account: r.account
          ? { state: r.account.state, reason: ACCOUNT_REASON[r.account.state], checkedAt: r.account.checkedAt, lastKnown: !!r.account.lastKnown }
          : null,
      })),
    };
    return {
      competition: c,
      phase: phaseOf(c, w, now),
      window: { closesAt: w.closesAt, approvalOpensAt: w.approvalOpensAt },
      approvalOpen: now >= w.approvalOpensAt || (c.devEarlyClose === true && lc.devStack),
      devStack: lc.devStack,
      isOwner: settings.ownerUserId === session.userId,
      snapshot: strip(shown),
      blockers: shown ? approvalBlockers(shown.result) : [],
      diff: review ? reviewDiff(provisional?.result ?? null, review.result) : [],
      approved: result && {
        approvedBy: result.approvedBy, approvedAt: result.approvedAt, note: result.note, awardedCents: result.awardedCents,
        contentHash: result.contentHash, snapshotId: result.snapshotId,
        standings: result.standings.map((s) => ({ competitorId: s.competitorId, displayName: s.displayName, location: s.location, rank: s.rank, score: s.score, eligible: s.eligible, qualifyingJobs: s.qualifyingJobs, closingRate: s.closingRate, avgTicket: s.avgTicket, prizePosition: s.prizePosition, prizeCents: s.prizeCents, wonMostImproved: s.wonMostImproved, prizeEligible: s.prizeEligible ?? s.eligible, account: s.account ? { state: s.account, reason: ACCOUNT_REASON[s.account], checkedAt: null, lastKnown: false } : null })),
      },
    };
  });
}
