// The single endpoint both dispute/refund entry points POST to. Delegates ALL
// calculation + ledger posting to the shared service (lib/dispute-service).
// The UI never calculates — it submits inputs and (for preview) reads the
// returned snapshot. dryRun=true resolves + computes without writing anything.

import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { postDisputeCharge } from "@/lib/dispute-service";

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = body.type === "refund" ? "refund" : "dispute";
  const jobId = String(body.jobId ?? "").trim();
  const amount = Number(body.amount);
  if (!jobId) return NextResponse.json({ error: "Select a job first" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter a dispute/refund amount greater than 0" }, { status: 400 });
  }

  const result = await postDisputeCharge({
    type,
    jobId,
    amount,
    date: body.date ? String(body.date) : undefined,
    status: body.status ? String(body.status) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    customer_name: body.customer_name ? String(body.customer_name) : undefined,
    address: body.address ? String(body.address) : undefined,
    recordId: body.recordId ? String(body.recordId) : undefined,
    actor: session.name,
    dryRun: !!body.dryRun,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
