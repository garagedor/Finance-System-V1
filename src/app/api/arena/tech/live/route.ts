// GET /api/arena/tech/live?view=national|eligible&since=<cursor> — technician API (Arena pass only; see docs/arena/TECH-API.md).
// One request per refresh cycle: me + events (+ leaderboard when `view` is given), ONE account check.
import { techPreflight, techRoute } from "@/lib/arena/tech/http";
import { techLive } from "@/lib/arena/tech/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return techRoute(req, async ({ competitorId, ctx, url }) => techLive(ctx, competitorId, url.searchParams.get("view"), url.searchParams.get("since")));
}

export async function OPTIONS(req: Request) {
  return techPreflight(req);
}
