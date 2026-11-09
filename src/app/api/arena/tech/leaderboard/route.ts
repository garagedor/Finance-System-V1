// GET /api/arena/tech/leaderboard?view=national|eligible&week=YYYY-MM-DD — technician API (Arena pass only; see docs/arena/TECH-API.md).
import { techPreflight, techRoute } from "@/lib/arena/tech/http";
import { techLeaderboard } from "@/lib/arena/tech/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return techRoute(req, async ({ competitorId, ctx, url }) => techLeaderboard(ctx, competitorId, url.searchParams.get("view"), url.searchParams.get("week")));
}

export async function OPTIONS(req: Request) {
  return techPreflight(req);
}
