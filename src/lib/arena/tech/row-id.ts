/**
 * Anonymous leaderboard row ids (technician API privacy).
 *
 * Technician-facing responses never carry another person's Weekly Balance
 * account id. A leaderboard row is identified instead by
 *
 *   "r_" + base64url( HMAC-SHA256(ARENA_ROW_ID_SECRET, competitionId + ":" + competitorId)[0..16) )
 *
 * - stable for one person within one competition week (keys, animations, the
 *   app's FLIP ordering keep working across polls);
 * - different for the same person in another week (unlinkable across weeks);
 * - not reversible or guessable without the server-only secret (128 bits).
 *
 * The server keeps the canonical mapping implicitly (it recomputes the id from
 * the real id); "this is you" comes from the server-set `isMe`. Admin /
 * Control Center APIs are unchanged and keep real ids.
 *
 * ARENA_ROW_ID_SECRET is a dedicated secret (≥ 32 characters). The pass key is
 * NOT reused: it is an RSA signing key, and key separation keeps a pass-key
 * rotation from silently re-keying every row id (and vice versa).
 */
import { createHmac } from "node:crypto";
import { ArenaTechConfigError } from "./config";

export const ROW_ID_MIN_SECRET_LENGTH = 32;
const ROW_ID_BYTES = 16;

/** A row id has this shape (never a UUID). */
export const ROW_ID_PATTERN = /^r_[A-Za-z0-9_-]{22}$/;

export function rowIdSecretFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const s = (env.ARENA_ROW_ID_SECRET ?? "").trim();
  if (s.length < ROW_ID_MIN_SECRET_LENGTH) throw new ArenaTechConfigError(`ARENA_ROW_ID_SECRET is not set (or shorter than ${ROW_ID_MIN_SECRET_LENGTH} characters)`);
  return s;
}

export function anonymousRowId(secret: string, competitionId: string, competitorId: string): string {
  if (!secret) throw new ArenaTechConfigError("row id secret missing");
  const mac = createHmac("sha256", secret).update(`${competitionId}:${competitorId}`, "utf8").digest();
  return `r_${mac.subarray(0, ROW_ID_BYTES).toString("base64url")}`;
}

/** The id function for one competition (memoized: a board maps every row each poll). */
export function rowIdsFor(secret: string, competitionId: string): (competitorId: string) => string {
  const memo = new Map<string, string>();
  return (id) => {
    let v = memo.get(id);
    if (v === undefined) memo.set(id, (v = anonymousRowId(secret, competitionId, id)));
    return v;
  };
}
