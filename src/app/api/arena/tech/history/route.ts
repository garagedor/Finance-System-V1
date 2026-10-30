// GET /api/arena/tech/history?limit=12 — technician API (Arena pass only; see docs/arena/TECH-API.md).
import { techPreflight, techRoute } from "@/lib/arena/tech/http";
import { techHistory } from "@/lib/arena/tech/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return techRoute(req, async ({ competitorId, ctx, url }) => techHistory(ctx, competitorId, url.searchParams.get("limit")));
}

export async function OPTIONS(req: Request) {
  return techPreflight(req);
}
