// POST: Weekly Balance access token (Authorization: Bearer) → short Arena pass.
// Reachable without a CRM session (exact-path middleware exemption); every
// check happens in exchangeRoute and fails closed. See docs/arena/TECH-API.md.
import { exchangeRoute, techPreflight } from "@/lib/arena/tech/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return exchangeRoute(req);
}

export async function OPTIONS(req: Request) {
  return techPreflight(req);
}
