/**
 * The Arena pass: a short RS256 JWT the CRM issues after a successful
 * exchange. aud "arena", iss "lbs-crm-arena", sub = competitor id, default 5
 * minutes. It is the ONLY credential the technician endpoints accept, and it
 * is never sufficient on its own: every request re-checks the account and the
 * competitor mapping (see http.ts).
 */
import { createPrivateKey, createPublicKey, randomUUID, type KeyObject } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { ArenaTechConfigError } from "./config";

export const PASS_ISSUER = "lbs-crm-arena";
export const PASS_AUDIENCE = "arena";
export const PASS_ALG = "RS256";
const PASS_CLOCK_SKEW_SECONDS = 30;

export interface PassKeys {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

let cached: { raw: string; keys: PassKeys } | null = null;

/** Accepts a PKCS#8 PEM, or the base64 of one (single-line env files). */
export function passKeysFromEnv(env: NodeJS.ProcessEnv = process.env): PassKeys {
  const raw = (env.ARENA_PASS_PRIVATE_KEY ?? "").trim();
  if (!raw) throw new ArenaTechConfigError("ARENA_PASS_PRIVATE_KEY is not set");
  if (cached?.raw === raw) return cached.keys;
  const pem = raw.startsWith("-----BEGIN") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
    throw new ArenaTechConfigError("ARENA_PASS_PRIVATE_KEY is not a readable private key");
  }
  if (privateKey.asymmetricKeyType !== "rsa") throw new ArenaTechConfigError("ARENA_PASS_PRIVATE_KEY must be an RSA key");
  const keys = { privateKey, publicKey: createPublicKey(privateKey) };
  cached = { raw, keys };
  return keys;
}

export async function issuePass(keys: PassKeys, competitorId: string, ttlSeconds: number, now = new Date()) {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttlSeconds;
  const pass = await new SignJWT({})
    .setProtectedHeader({ alg: PASS_ALG, typ: "JWT" })
    .setIssuer(PASS_ISSUER)
    .setAudience(PASS_AUDIENCE)
    .setSubject(competitorId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(randomUUID())
    .sign(keys.privateKey);
  return { pass, expiresAt: new Date(exp * 1000).toISOString() };
}

export class PassError extends Error {}

export async function verifyPass(keys: Pick<PassKeys, "publicKey">, token: string, now?: Date): Promise<{ competitorId: string }> {
  try {
    const { payload } = await jwtVerify(token, keys.publicKey, {
      issuer: PASS_ISSUER,
      audience: PASS_AUDIENCE,
      algorithms: [PASS_ALG],
      clockTolerance: PASS_CLOCK_SKEW_SECONDS,
      requiredClaims: ["sub", "exp", "iat"],
      currentDate: now,
    });
    if (typeof payload.sub !== "string" || !payload.sub) throw new Error("no subject");
    return { competitorId: payload.sub };
  } catch {
    throw new PassError("invalid pass");
  }
}
