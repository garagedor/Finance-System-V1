/**
 * Next.js glue for the technician API. Every technician route handler is
 * exactly one of:
 *   return techRoute(req, async ({ competitorId, ctx }) => …)   GET endpoints
 *   return exchangeRoute(req)                                   POST /auth/exchange
 *   return techPreflight(req)                                   OPTIONS (CORS)
 * (enforced by arena-tech-routes.test.ts).
 *
 * Credentials: ONLY `Authorization: Bearer <Arena pass>`. Cookies are never
 * read (a CRM session cookie grants nothing here), and CORS never allows
 * credentials. Responses are `Cache-Control: no-store`.
 */
import "server-only";
import { NextResponse } from "next/server";
import { arenaContexts } from "../admin-service";
import { ArenaEnvError } from "../env";
import type { ArenaErrorBody } from "../tech-api-contract";
import { readTechConfig, ArenaTechConfigError, type TechConfig } from "./config";
import { remoteJwks, verifyWbAccessToken } from "./wb-token";
import { verifierFromEnv } from "./verifier";
import { passKeysFromEnv } from "./pass";
import { MongoRateLimiter, type RateLimitCollection } from "./rate-limit";
import { ARENA_COLLECTIONS } from "../mongo-store";
import { authorizePass, exchange, type AccessDeps } from "./access";
import { isAllowlisted, type TechAccessCollection } from "./allowlist";
import { findCompetitor, TechBadRequest, TechNotFound, type TechCtx } from "./service";
import { rowIdSecretFromEnv } from "./row-id";

const MINUTE_MS = 60_000;
const IP_PER_MINUTE = 60;
const USER_IP_PER_MINUTE = 10;

function corsHeaders(req: Request, cfg: TechConfig | null): Headers {
  const h = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
  const origin = req.headers.get("origin");
  if (origin && cfg?.allowedOrigins.includes(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    h.set("Access-Control-Max-Age", "600");
  }
  return h;
}

const json = (body: unknown, status: number, headers: Headers) => NextResponse.json(body, { status, headers });
const errBody = (code: ArenaErrorBody["code"], error: string): ArenaErrorBody => ({ error, code });

function config(): TechConfig | null {
  try {
    return readTechConfig();
  } catch (e) {
    console.error("[arena-tech] configuration:", e instanceof ArenaTechConfigError ? e.message : e);
    return null;
  }
}

/** A browser Origin that is present but not allow-listed is refused outright. */
const originRefused = (req: Request, cfg: TechConfig | null) => {
  const o = req.headers.get("origin");
  return !!o && !cfg?.allowedOrigins.includes(o);
};

async function deps(cfg: TechConfig): Promise<{ deps: AccessDeps; ctx: TechCtx }> {
  const rowIdSecret = rowIdSecretFromEnv(); // missing/short → ArenaTechConfigError → 503 (fail closed)
  const a = await arenaContexts();
  const ctx: TechCtx = { lifecycle: a.lifecycle, review: a.review, crmDb: a.crmDb, rowIdSecret };
  const keys = remoteJwks(cfg.wb.jwksUrl);
  // Shared across instances: counters live in the Arena database (rate-limit.ts).
  const rl = a.arenaDb.collection(ARENA_COLLECTIONS.rateLimit) as never as RateLimitCollection;
  const limiters = { ip: new MongoRateLimiter(rl, IP_PER_MINUTE, MINUTE_MS), userIp: new MongoRateLimiter(rl, USER_IP_PER_MINUTE, MINUTE_MS) };
  const access = a.arenaDb.collection(ARENA_COLLECTIONS.techAccess) as never as TechAccessCollection;
  return {
    ctx,
    deps: {
      enabled: cfg.enabled,
      isAllowlisted: (id) => isAllowlisted(access, id),
      verifyWbToken: (t) => verifyWbAccessToken(t, { issuer: cfg.wb.issuer, keys }),
      verifier: verifierFromEnv(cfg.wb.url),
      findCompetitor: (id) => findCompetitor(ctx, id),
      passKeys: passKeysFromEnv(),
      passTtlSeconds: cfg.passTtlSeconds,
      limiters,
      log: (m) => console.warn(m),
    },
  };
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim() || "unknown";
}

function disabled(h: Headers) {
  return json(errBody("arena_disabled", "The Arena is not available right now"), 503, h);
}

export function techPreflight(req: Request): Response {
  const cfg = config();
  const h = corsHeaders(req, cfg);
  if (originRefused(req, cfg)) return new NextResponse(null, { status: 403, headers: h });
  return new NextResponse(null, { status: 204, headers: h });
}

export async function exchangeRoute(req: Request): Promise<Response> {
  const cfg = config();
  const h = corsHeaders(req, cfg);
  if (originRefused(req, cfg)) return json(errBody("forbidden", "Origin not allowed"), 403, h);
  if (!cfg || !cfg.enabled) return disabled(h);
  try {
    const { deps: d } = await deps(cfg);
    const out = await exchange(d, req.headers.get("authorization"), clientIp(req));
    return json(out.body, out.status, h);
  } catch (e) {
    console.error("[arena-tech] exchange failed:", e instanceof ArenaTechConfigError || e instanceof ArenaEnvError ? e.message : e);
    return disabled(h);
  }
}

export async function techRoute(
  req: Request,
  fn: (c: { competitorId: string; ctx: TechCtx; url: URL }) => Promise<unknown>,
): Promise<Response> {
  const cfg = config();
  const h = corsHeaders(req, cfg);
  if (originRefused(req, cfg)) return json(errBody("forbidden", "Origin not allowed"), 403, h);
  if (!cfg || !cfg.enabled) return disabled(h);
  let built;
  try {
    built = await deps(cfg);
  } catch (e) {
    console.error("[arena-tech] setup failed:", e instanceof ArenaTechConfigError || e instanceof ArenaEnvError ? e.message : e);
    return disabled(h);
  }
  const auth = await authorizePass(built.deps, req.headers.get("authorization"));
  if (!auth.ok) return json(auth.outcome.body, auth.outcome.status, h);
  try {
    const out = await fn({ competitorId: auth.competitorId, ctx: built.ctx, url: new URL(req.url) });
    return json(out, 200, h);
  } catch (e) {
    if (e instanceof TechBadRequest) return json(errBody("bad_request", e.message), 400, h);
    if (e instanceof TechNotFound) return json(errBody("not_found", e.message), 404, h);
    console.error("[arena-tech] request failed:", e);
    return json(errBody("arena_disabled", "Something went wrong"), 500, h);
  }
}
