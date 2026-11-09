// GET /api/arena/health — live-snapshot monitoring (read-only; never recomputes).
// Auth (in-route, fail closed; exempt from the session middleware by exact path):
// the cron secret (x-cron-secret or Authorization: Bearer) OR an admin CRM
// session with arena:console:view. ?strict=1 answers 503 when unhealthy.
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import type { Permission } from "@/types/rbac";
import { arenaContexts } from "@/lib/arena/admin-service";
import { liveHealth } from "@/lib/arena/lifecycle";
import { cronSecretOk } from "@/lib/arena/ops-auth";
import { arenaError } from "../admin/_lib";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronSecretOk(req.headers)) {
    const s = await requirePermission("arena:console:view" as Permission);
    if (s instanceof NextResponse) return s;
  }
  try {
    const ctx = await arenaContexts();
    const report = await liveHealth(ctx.lifecycle);
    const strict = new URL(req.url).searchParams.get("strict") === "1";
    return NextResponse.json(report, { status: strict && !report.healthy ? 503 : 200, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return arenaError(e);
  }
}
