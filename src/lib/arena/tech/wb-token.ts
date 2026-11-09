/**
 * Verifies a Weekly Balance (Supabase) access token: ES256 only, issuer and
 * audience pinned, ≤60 s clock skew, keys from the project's JWKS (cached by
 * jose; refetched on an unknown kid with a cooldown). Anything else — HS256
 * (including "HS256 signed with the public key"), alg none, another project's
 * issuer, anon/service keys, anonymous sign-ins — is rejected.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const WB_AUDIENCE = "authenticated";
export const WB_ALGORITHMS = ["ES256"];
export const WB_CLOCK_SKEW_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WbTokenError extends Error {}

const jwksCache = new Map<string, JWTVerifyGetKey>();
export function remoteJwks(url: string): JWTVerifyGetKey {
  let k = jwksCache.get(url);
  if (!k) {
    k = createRemoteJWKSet(new URL(url), { cacheMaxAge: 10 * 60_000, cooldownDuration: 30_000, timeoutDuration: 5_000 });
    jwksCache.set(url, k);
  }
  return k;
}

export async function verifyWbAccessToken(
  token: string,
  opts: { issuer: string; keys: JWTVerifyGetKey; now?: Date },
): Promise<{ userId: string }> {
  try {
    const { payload } = await jwtVerify(token, opts.keys, {
      issuer: opts.issuer,
      audience: WB_AUDIENCE,
      algorithms: WB_ALGORITHMS,
      clockTolerance: WB_CLOCK_SKEW_SECONDS,
      requiredClaims: ["sub", "exp", "iat"],
      currentDate: opts.now,
    });
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub)) throw new WbTokenError("subject is not a user id");
    if (payload.role !== undefined && payload.role !== "authenticated") throw new WbTokenError("not a user session");
    if (payload.is_anonymous === true) throw new WbTokenError("anonymous session");
    return { userId: payload.sub.toLowerCase() };
  } catch (e) {
    if (e instanceof WbTokenError) throw e;
    throw new WbTokenError("invalid token");
  }
}
