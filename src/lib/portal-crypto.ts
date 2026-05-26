// AES-256-GCM encryption for Plaid access tokens (and any other server-side
// secrets that get persisted to the DB).
//
// Keys read from env: FINANCE_ENCRYPTION_KEY (32 bytes hex / base64).
// In dev a default insecure key is used and a warning is logged to console.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

let _key: Buffer | null = null;
let _warned = false;

function getKey(): Buffer {
  if (_key) return _key;
  const raw = process.env.FINANCE_ENCRYPTION_KEY;
  if (raw) {
    const buf = raw.startsWith("base64:")
      ? Buffer.from(raw.slice(7), "base64")
      : /^[0-9a-fA-F]+$/.test(raw) && raw.length === 64
        ? Buffer.from(raw, "hex")
        : Buffer.from(raw, "utf8");
    if (buf.length < KEY_BYTES) {
      throw new Error(
        `FINANCE_ENCRYPTION_KEY must be at least ${KEY_BYTES} bytes (got ${buf.length}). Generate with: openssl rand -base64 32`
      );
    }
    _key = buf.subarray(0, KEY_BYTES);
    return _key;
  }
  if (!_warned) {
    console.warn(
      "⚠ FINANCE_ENCRYPTION_KEY not set — using insecure dev-default. Set it in .env.local before production."
    );
    _warned = true;
  }
  _key = crypto.createHash("sha256").update("lbs-portal-dev-encryption-key-do-not-use-in-prod").digest();
  return _key;
}

/** Encrypt arbitrary plaintext. Returns a compact string: iv:tag:ciphertext (all base64). */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

/** Decrypt a string produced by `encrypt`. */
export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid ciphertext format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  if (tag.length !== TAG_BYTES) throw new Error("Invalid auth tag length");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

/** Helper: hash a value (for non-reversible lookup keys). */
export function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
