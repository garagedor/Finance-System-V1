/**
 * Technician-API configuration, read from the environment and validated once
 * per call. Every problem fails CLOSED: the exchange answers `arena_disabled`.
 *
 *   ARENA_TECH_ENABLED            "1" to turn the technician API on (default OFF)
 *   ARENA_WB_SUPABASE_URL         https://<ref>.supabase.co of the Weekly Balance project
 *   ARENA_WB_DENY_REFS            optional comma list of refs that must never be used here
 *   ARENA_PASS_PRIVATE_KEY        RS256 private key (PKCS#8 PEM, or base64 of the PEM)
 *   ARENA_PASS_TTL_SECONDS        pass lifetime, default 300 (5 min), max 900
 *   ARENA_TECH_ALLOWED_ORIGINS    comma list of browser origins allowed by CORS
 *   ARENA_VERIFIER                "wb" (default: the arena-verify Edge Function) | "fake-dev" (dev stack only)
 *   ARENA_WB_VERIFIER_SECRET      dedicated secret for the arena-verify Edge Function (≥ 32 chars)
 *   ARENA_FAKE_VERIFIER_FILE      JSON file for ARENA_VERIFIER=fake-dev
 *   ARENA_DEV_STACK               "1" only on the local dev stack
 *
 * Dev guard: outside a production build, or whenever ARENA_DEV_STACK=1, the
 * PRODUCTION Weekly Balance project is refused. It is pinned here by the
 * sha256 of its project ref (the ref itself is not committed), plus any refs in
 * ARENA_WB_DENY_REFS.
 */
import { createHash } from "node:crypto";
import { techEnvProblems } from "./self-check";

export class ArenaTechConfigError extends Error {}

/** sha256 of the production Weekly Balance project ref. */
export const PRODUCTION_WB_REF_SHA256 = "95a3bd849e2b92a19bee3ba1ae1d3654a20b461f25850a9ad4afa4bdc09755f1";

export const PASS_TTL_DEFAULT_SECONDS = 300;
const PASS_TTL_MAX_SECONDS = 900;
const PASS_TTL_MIN_SECONDS = 60;

export interface TechConfig {
  enabled: boolean;
  devMode: boolean;
  wb: { ref: string; url: string; issuer: string; jwksUrl: string };
  passTtlSeconds: number;
  allowedOrigins: string[];
}

export const isDevMode = (env: NodeJS.ProcessEnv) => env.ARENA_DEV_STACK === "1" || env.NODE_ENV !== "production";
export const techEnabled = (env: NodeJS.ProcessEnv = process.env) => env.ARENA_TECH_ENABLED === "1";

export function parseWbUrl(raw: string | undefined, env: NodeJS.ProcessEnv): TechConfig["wb"] {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(v);
  if (!m) throw new ArenaTechConfigError("ARENA_WB_SUPABASE_URL must be https://<project-ref>.supabase.co");
  const ref = m[1];
  if (isDevMode(env)) {
    const deny = (env.ARENA_WB_DENY_REFS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const hash = createHash("sha256").update(ref).digest("hex");
    if (hash === PRODUCTION_WB_REF_SHA256 || deny.includes(ref))
      throw new ArenaTechConfigError("refusing the PRODUCTION Weekly Balance project in a dev configuration");
  }
  return { ref, url: v, issuer: `${v}/auth/v1`, jwksUrl: `${v}/auth/v1/.well-known/jwks.json` };
}

export function readTechConfig(env: NodeJS.ProcessEnv = process.env): TechConfig {
  const problems = techEnvProblems(env);
  if (problems.length) throw new ArenaTechConfigError(`unsafe technician configuration: ${problems.join("; ")}`);
  const ttlRaw = (env.ARENA_PASS_TTL_SECONDS ?? "").trim();
  const ttl = ttlRaw ? Number(ttlRaw) : PASS_TTL_DEFAULT_SECONDS;
  if (!Number.isInteger(ttl) || ttl < PASS_TTL_MIN_SECONDS || ttl > PASS_TTL_MAX_SECONDS)
    throw new ArenaTechConfigError(`ARENA_PASS_TTL_SECONDS must be a whole number between ${PASS_TTL_MIN_SECONDS} and ${PASS_TTL_MAX_SECONDS}`);
  return {
    enabled: techEnabled(env),
    devMode: isDevMode(env),
    wb: parseWbUrl(env.ARENA_WB_SUPABASE_URL, env),
    passTtlSeconds: ttl,
    allowedOrigins: (env.ARENA_TECH_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
