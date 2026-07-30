import { NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { getMongoDb, mongoHealth } from "@/lib/mongo";
import { getDbConnectError } from "@/lib/finance-db";
import { ServerTiming } from "@/lib/server-timing";

export const dynamic = "force-dynamic";

// Admin-only performance/health diagnostics. Exposes connection state, pool
// size, a live DB ping duration, and region hints — NEVER the connection URI,
// credentials, or any customer/financial data.
export async function GET() {
  const session = await readSession();
  if (!session || !session.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const timing = new ServerTiming();
  timing.start("ping");
  let pingOk = false;
  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    pingOk = true;
  } catch {
    pingOk = false;
  }
  timing.end("ping", "mongo ping");

  const res = NextResponse.json({
    ok: pingOk,
    mongo: mongoHealth(), // { connected, connectedAt, poolMax, db, lastError } — no secrets
    lastConnectError: getDbConnectError(),
    runtime: {
      node: process.version,
      vercelRegion: process.env.VERCEL_REGION ?? null, // where the function runs
      serverTime: new Date().toISOString(),
    },
  });
  return timing.apply(res);
}
