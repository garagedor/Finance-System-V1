import { NextRequest, NextResponse } from "next/server";
import { checkIngestAuth, ingestDashboardPayload } from "@/lib/ai-jobs/dashboard-ingest";

// MEDIA door for the closing-dashboard SHADOW outbox (app/jobsystem.py
// sync_media → POST {base}/jobs/{external_id}/media). Attaches media
// IDENTIFIERS (media_id / kind / content_type / bytes / sha256) to the existing
// mirror row — never job fields, never the bytes. Same auth + idempotency as
// the job doors (logical job + version + operation). ag.Job_ai only.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ externalId: string }> }) {
  const auth = checkIngestAuth(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { externalId } = await params;
  const payload: Record<string, unknown> = Array.isArray(body)
    ? { media: body }
    : body && typeof body === "object"
      ? { ...(body as Record<string, unknown>) }
      : {};
  payload.lbs_job_id = externalId; // the path names the job for this door
  if (payload.event == null) payload.event = "sync_media";

  const result = await ingestDashboardPayload(payload, { mediaOnly: true });
  return NextResponse.json(result.body, { status: result.status });
}
