// GET /api/arena/monitor — keep-warm/monitor step for a scheduler (Vercel Cron):
// freezes a finished week if due and refreshes the current live snapshot when it
// is older than rules.display.refreshSeconds, even with nobody connected; answers
// the same report as /api/arena/health (503 when unhealthy).
// Auth: the cron secret ONLY (x-cron-secret or Authorization: Bearer), fail closed.
// Optional dead-man's switch: ARENA_MONITOR_PING_URL (server env) is pinged after
// each run — success when healthy, <url>/fail after 3 failed runs in a row
// (src/lib/arena/monitor-ping.ts; unset = no-op; never throws, 5 s timeout).
import { NextResponse } from "next/server";
import { arenaContexts } from "@/lib/arena/admin-service";
import { keepLiveWarm } from "@/lib/arena/lifecycle";
import { cronSecretOk } from "@/lib/arena/ops-auth";
import { monitorPing, type MonitorPingStore } from "@/lib/arena/monitor-ping";
import { arenaError } from "../admin/_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronSecretOk(req.headers)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let store: MonitorPingStore | null = null;
  try {
    const ctx = await arenaContexts();
    store = (ctx.lifecycle.lc.health ?? null) as MonitorPingStore | null;
    const report = await keepLiveWarm(ctx.lifecycle);
    await monitorPing({ healthy: report.healthy, store });
    return NextResponse.json(report, { status: report.healthy ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch (e) {
    await monitorPing({ healthy: false, store });
    return arenaError(e);
  }
}
