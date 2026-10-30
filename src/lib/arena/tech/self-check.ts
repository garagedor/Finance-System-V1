/**
 * Startup self-check for the technician endpoints. Run on every technician
 * request (through readTechConfig); any problem disables the technician API
 * (503 arena_disabled, logged) instead of serving it in a dangerous setup.
 *
 * "Deployed" = running on Vercel (VERCEL=1 or VERCEL_ENV set). The local dev
 * stack runs `next start` (NODE_ENV=production) but is never deployed.
 * See docs/arena/PRODUCTION-ENV.md.
 */
export const isDeployed = (env: NodeJS.ProcessEnv) => env.VERCEL === "1" || !!(env.VERCEL_ENV ?? "").trim();

const LOCAL_ORIGIN = /^(https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:\d+)?|\*|null)$/i;
export const PRODUCTION_MAX_PASS_TTL_SECONDS = 300;

/** Problems with this environment for the technician API (empty = safe). */
export function techEnvProblems(env: NodeJS.ProcessEnv): string[] {
  const p: string[] = [];
  const deployed = isDeployed(env);
  const verifier = (env.ARENA_VERIFIER ?? "wb").trim() || "wb";
  if (deployed) {
    if (env.ARENA_DEV_STACK) p.push("ARENA_DEV_STACK must never be set in a deployed environment");
    if (verifier === "fake-dev") p.push("ARENA_VERIFIER=fake-dev must never be used in a deployed environment");
    if (env.ARENA_FAKE_VERIFIER_FILE) p.push("ARENA_FAKE_VERIFIER_FILE must never be set in a deployed environment");
    if (env.NODE_ENV !== "production") p.push("a deployed environment must run with NODE_ENV=production");
    const ttl = Number((env.ARENA_PASS_TTL_SECONDS ?? "").trim() || 300);
    if (ttl > PRODUCTION_MAX_PASS_TTL_SECONDS) p.push(`ARENA_PASS_TTL_SECONDS above ${PRODUCTION_MAX_PASS_TTL_SECONDS} is not allowed when deployed`);
    const origins = (env.ARENA_TECH_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const local = origins.filter((o) => LOCAL_ORIGIN.test(o));
    if (local.length) p.push(`ARENA_TECH_ALLOWED_ORIGINS has local/wildcard origins in a deployed environment: ${local.join(", ")}`);
    if (origins.some((o) => /^http:\/\//i.test(o) && !LOCAL_ORIGIN.test(o))) p.push("ARENA_TECH_ALLOWED_ORIGINS must use https (or capacitor://localhost) when deployed");
  }
  if (env.ARENA_TECH_ENABLED === "1") {
    if (verifier === "wb" && (env.ARENA_WB_VERIFIER_SECRET ?? "").trim().length < 32)
      p.push("ARENA_TECH_ENABLED=1 needs ARENA_WB_VERIFIER_SECRET (≥ 32 characters)");
    if (!(env.ARENA_PASS_PRIVATE_KEY ?? "").trim()) p.push("ARENA_TECH_ENABLED=1 needs ARENA_PASS_PRIVATE_KEY");
    if (!(env.ARENA_TECH_ALLOWED_ORIGINS ?? "").trim()) p.push("ARENA_TECH_ENABLED=1 needs ARENA_TECH_ALLOWED_ORIGINS");
    if (!(env.ARENA_MONGODB_DB ?? "").trim()) p.push("ARENA_TECH_ENABLED=1 needs ARENA_MONGODB_DB");
  }
  if ((env.ARENA_WB_VERIFIER_KEY ?? "").trim())
    p.push("ARENA_WB_VERIFIER_KEY (the retired service-role RPC key) must be removed; use ARENA_WB_VERIFIER_SECRET");
  return p;
}
