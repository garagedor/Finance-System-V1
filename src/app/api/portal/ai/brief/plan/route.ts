import { NextResponse } from "next/server";
import { readSession, type RbacSession } from "@/lib/rbac";
import { getAlerts, getLatestBrief } from "@/lib/ai/brief";
import { buildBriefPlan } from "@/lib/ai/live/brief-plan";

export const dynamic = "force-dynamic";

// Returns the day's Morning Brief as a Presentation Plan for the orb to auto-offer
// on first portal load. Read-only, permission-gated like the live route. Loads the
// cron-precomputed brief — never recomputes here, so login is instant.
function canUseLive(s: RbacSession): boolean {
  return (
    s.type === "admin" ||
    s.permissions.includes("system:ai:live") ||
    s.permissions.includes("system:ai:view")
  );
}

export async function GET() {
  const s = await readSession();
  if (!s || !s.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseLive(s)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const brief = await getLatestBrief();
  if (!brief) return NextResponse.json({ hasBrief: false, offer: false });

  const alerts = await getAlerts({ status: "open", limit: 12 });
  const plan = buildBriefPlan(brief, alerts, { permissions: s.permissions, type: s.type });

  // Only auto-offer a FRESH brief (today's or yesterday's) that actually has
  // something to say — otherwise stay quiet (intelligent silence).
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const fresh = brief.date === today || brief.date === yesterday;
  const offer = fresh && (brief.alertCount > 0 || brief.overnight.length > 0);

  return NextResponse.json({
    hasBrief: true,
    offer,
    headline: brief.headline,
    alertCount: brief.alertCount,
    date: brief.date,
    plan,
  });
}
