/**
 * The one place the session signing secret is resolved.
 *
 * Deliberately has no imports. It is used by `middleware.ts`, which runs on the
 * Edge runtime, so it must not pull in `server-only`, Node built-ins, Mongo, or
 * anything that reaches them transitively. Keep it that way: an import added
 * here can break authentication for every request on the site.
 *
 * It fails closed. There is no fallback value, development or otherwise — a
 * default secret is a published secret, and one that silently substitutes
 * itself turns a configuration mistake into an open door rather than an
 * outage. An outage is recoverable.
 */

export class MissingJwtSecretError extends Error {
  constructor() {
    super(
      "JWT_SECRET is not set. Sessions cannot be signed or verified without it. " +
        "Set it in the environment (Vercel) or in .env.local for local development.",
    );
    this.name = "MissingJwtSecretError";
  }
}

let cached: Uint8Array | null = null;

/**
 * The secret, as the key material `jose` expects.
 *
 * Throws `MissingJwtSecretError` when the variable is absent or blank. Callers
 * must let that surface — catching it into a default is the defect this
 * function exists to remove.
 */
export function jwtSecret(): Uint8Array {
  if (cached) return cached;
  const raw = process.env.JWT_SECRET;
  if (!raw || !raw.trim()) throw new MissingJwtSecretError();
  cached = new TextEncoder().encode(raw);
  return cached;
}

/** Whether the secret is configured. For diagnostics only — never a gate. */
export function hasJwtSecret(): boolean {
  const raw = process.env.JWT_SECRET;
  return Boolean(raw && raw.trim());
}

/** Test seam. */
export function __resetJwtSecretCache(): void {
  cached = null;
}
