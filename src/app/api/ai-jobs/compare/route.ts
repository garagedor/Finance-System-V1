import { NextRequest, NextResponse } from "next/server";
import { runCompare } from "@/lib/ai-jobs/compare-loader";

// Read-only QA comparison: Tables AI (bot, aiOriginal) vs production Tables
// (employees). Reads ag.Job read-only; writes nothing anywhere.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  try {
    const result = await runCompare({
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "compare failed" }, { status: 500 });
  }
}
