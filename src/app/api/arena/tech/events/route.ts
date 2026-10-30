// GET /api/arena/tech/events?since=<cursor> — technician API (Arena pass only; see docs/arena/TECH-API.md).
import { techPreflight, techRoute } from "@/lib/arena/tech/http";
import { techEvents } from "@/lib/arena/tech/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return techRoute(req, async ({ competitorId, ctx, url }) => techEvents(ctx, competitorId, url.searchParams.get("since")));
}

export async function OPTIONS(req: Request) {
  return techPreflight(req);
}
