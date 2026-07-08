// TOTP helpers built on otpauth. Issuer = "LBS Finance" so the user sees
// "LBS Finance (yehonatan)" in their authenticator app.

import "server-only";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

const ISSUER = "LBS Finance";

/** Generate a fresh shared secret (base32). */
export function newSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/** Build a TOTP instance for the given user/secret. */
export function totp(secret: string, account: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: account,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

/** Generate `otpauth://...` provisioning URL + scannable QR data-URL. */
export async function provisioningUrl(args: {
  secret: string;
  account: string;
}): Promise<{ url: string; qr: string }> {
  const t = totp(args.secret, args.account);
  const url = t.toString();
  const qr = await QRCode.toDataURL(url, { margin: 1, scale: 5 });
  return { url, qr };
}

/** Verify a 6-digit code against the secret. Returns the matched timestep
 *  (so callers can store it and reject replays), or null on failure. */
export function verifyCode(args: {
  secret: string;
  code: string;
  window?: number; // ± steps tolerated; default 1
}): number | null {
  const t = totp(args.secret, "verify");
  const delta = t.validate({ token: args.code.replace(/\s+/g, ""), window: args.window ?? 1 });
  if (delta === null) return null;
  // Current step + delta = the step the code came from.
  const step = Math.floor(Date.now() / 1000 / 30) + delta;
  return step;
}

/** Generate N random alphanumeric backup codes (uppercase, dash-separated). */
export function generateBackupCodes(n = 10): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const part1 = randomChunk(4);
    const part2 = randomChunk(4);
    out.push(`${part1}-${part2}`);
  }
  return out;
}

function randomChunk(len: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1 for clarity
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}
