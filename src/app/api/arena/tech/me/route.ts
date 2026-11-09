// GET /api/arena/tech/me — technician API (Arena pass only; see docs/arena/TECH-API.md).
import { techPreflight, techRoute } from "@/lib/arena/tech/http";
import { techMe } from "@/lib/arena/tech/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return techRoute(req, async ({ competitorId, ctx }) => techMe(ctx, competitorId));
}

export async function OPTIONS(req: Request) {
  return techPreflight(req);
}
