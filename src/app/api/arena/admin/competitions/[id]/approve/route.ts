// POST { snapshotId, note? }: approve a reviewed week's winners. OWNER ONLY —
// enforced inside approveResults() against the settings owner and approver
// list, not by the permission alone. Writes one immutable result record; it
// creates no payout or ledger entry.
import { arenaRoute, body, str } from "../../../_lib";
import { approveResults } from "@/lib/arena/lifecycle";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function POST(req: Request, p: P) {
  return arenaRoute("arena:rules:edit", async ({ session, ctx }) => {
    const { id } = await p.params;
    const b = await body(req);
    const note = typeof b.note === "string" ? b.note : null;
    const doc = await approveResults(ctx.lifecycle, id, session.userId, { snapshotId: str(b.snapshotId, "snapshotId"), note });
    return { ok: true, approvedAt: doc.approvedAt, contentHash: doc.contentHash };
  });
}
