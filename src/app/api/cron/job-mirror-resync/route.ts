// Scheduled self-heal for the Job report/stats mirror fields. An external writer
// (mobile/Lovable → Supabase → ag.Job) edits jobs without maintaining
// jobDateNormalized / statusCanonical, so they drift stale and jobs fall off the
// provider report / skew stats. This cron recomputes them from the real
// date/status. Auth: CRON_SECRET (Vercel adds `Authorization: Bearer <secret>`).

import { NextRequest, NextResponse } from "next/server";
import { resyncJobMirrors } from "@/lib/job-mirror";
import { detectReportDrift, alertReportDrift } from "@/lib/report-drift";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const token = req.nextUrl.searchParams.get("token");
    if (auth !== `Bearer ${secret}` && token !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  // ?drift=1 → just report drift (no alert). ?drift=alert → force an alert now.
  const driftMode = req.nextUrl.searchParams.get("drift");
  if (driftMode) {
    try {
      const result = driftMode === "alert" ? await alertReportDrift({ force: true }) : await detectReportDrift();
      return NextResponse.json({ ok: true, drift: result });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "drift check failed" }, { status: 500 });
    }
  }
  try {
    const result = await resyncJobMirrors();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "resync failed" }, { status: 500 });
  }
}
