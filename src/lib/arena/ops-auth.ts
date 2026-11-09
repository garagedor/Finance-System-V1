/**
 * Authentication for the Arena operations endpoints (/api/arena/health,
 * /api/arena/monitor). They are exempt from the portal-session middleware (exact
 * paths) because a scheduler calls them without a session, so they
 * authenticate in-route and FAIL CLOSED:
 *   - the cron secret: header `x-cron-secret: <CRON_SECRET>`, or
 *     `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends);
 *     an unset or short CRON_SECRET never matches anything;
 *   - /api/arena/health also accepts an admin CRM session (arena:console:view),
 *     checked by the route itself.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_CRON_SECRET_LENGTH = 16;

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

export function cronSecretOk(headers: Headers, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = (env.CRON_SECRET ?? "").trim();
  if (secret.length < MIN_CRON_SECRET_LENGTH) return false;
  const bearer = /^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1] ?? null;
  const given = [headers.get("x-cron-secret"), bearer].filter((v): v is string => typeof v === "string" && v.length > 0);
  const want = digest(secret);
  return given.some((g) => timingSafeEqual(digest(g), want));
}
