// Tiny in-memory TTL cache for GLOBAL, low-change reference data only
// (voice settings, detector config, etc.). Per-instance memory on serverless.
//
// DO NOT use for per-user, per-tenant, financial, or auth data — this cache has
// no key/scope, so every caller in the process shares one value. It is only safe
// for data that is identical for all users and cheap to refetch.
export function createTtlCache<T>(ttlMs: number) {
  let value: T | undefined;
  let expires = 0;
  return {
    /** Return the cached value if fresh, else load, store, and return it. */
    async get(loader: () => Promise<T>): Promise<T> {
      const now = Date.now();
      if (value !== undefined && expires > now) return value;
      const loaded = await loader();
      value = loaded;
      expires = now + ttlMs;
      return loaded;
    },
    /** Invalidate immediately (call after any write to the underlying data). */
    clear(): void {
      value = undefined;
      expires = 0;
    },
  };
}
