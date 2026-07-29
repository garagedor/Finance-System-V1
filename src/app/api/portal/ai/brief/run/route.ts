import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { hasAnthropicKey } from "@/lib/ai/model";
import { generateBrief } from "@/lib/ai/brief";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // detectors + one synthesis call

// Authorized either by an admin/AI session (the "Run now" button) or by a
// Vercel cron request carrying Authorization: Bearer <CRON_SECRET>.
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) {
    const s = await readSession();
    if (!s || !s.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (s.type !== "admin" && !s.permissions.includes("system:ai:view")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (!hasAnthropicKey()) {
    return NextResponse.json({ error: "AI engine not configured (no ANTHROPIC_API_KEY)." }, { status: 503 });
  }
  try {
    const { brief, alerts } = await generateBrief();
    return NextResponse.json({ ok: true, briefId: brief._id, headline: brief.headline, alertCount: alerts.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Brief generation failed" }, { status: 500 });
  }
}

export const POST = handle; // "Run now" button
export const GET = handle; // Vercel cron issues GET
