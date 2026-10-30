/**
 * Fixed-window rate limiting for the technician exchange.
 *
 *   MongoRateLimiter   PRODUCTION: shared across serverless instances. One
 *                      document per (key, window) in the Arena database
 *                      (arena_rate_limit), incremented with a single atomic
 *                      upsert ($inc), so concurrent requests on any instance
 *                      count exactly once each. A TTL index on `expiresAt`
 *                      removes finished windows.
 *   MemoryRateLimiter  unit tests only (per process).
 *
 * Keys are opaque strings built by the caller (`ip:<ip>`, `u:<user>|<ip>`).
 */
export interface RateLimiter {
  /** true = allowed (and counted). */
  take(key: string): boolean | Promise<boolean>;
}

export class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;
  constructor(limit: number, windowMs: number, clock: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.clock = clock;
  }
  take(key: string): boolean {
    const t = this.clock();
    const cur = this.hits.get(key);
    if (!cur || t - cur.start >= this.windowMs) {
      this.hits.set(key, { start: t, count: 1 });
      if (this.hits.size > 10_000) this.prune(t);
      return true;
    }
    cur.count += 1;
    return cur.count <= this.limit;
  }
  private prune(t: number) {
    for (const [k, v] of this.hits) if (t - v.start >= this.windowMs) this.hits.delete(k);
  }
}

export interface RateLimitDoc {
  _id: string; // `${key}|${windowStart}`
  count: number;
  expiresAt: Date;
}

/** The subset of a Mongo collection the limiter needs (real driver or a test double). */
export interface RateLimitCollection {
  findOneAndUpdate(
    filter: { _id: string },
    update: { $inc: { count: number }; $setOnInsert: { expiresAt: Date } },
    options: { upsert: true; returnDocument: "after" },
  ): Promise<RateLimitDoc | null | { value?: RateLimitDoc | null }>;
}

/** Keep finished windows this long after they end (TTL is approximate; correctness never depends on it). */
const TTL_GRACE_MS = 60_000;

export class MongoRateLimiter implements RateLimiter {
  private readonly coll: RateLimitCollection;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;
  constructor(coll: RateLimitCollection, limit: number, windowMs: number, clock: () => number = Date.now) {
    this.coll = coll;
    this.limit = limit;
    this.windowMs = windowMs;
    this.clock = clock;
  }
  async take(key: string): Promise<boolean> {
    const t = this.clock();
    const start = Math.floor(t / this.windowMs) * this.windowMs;
    const res = await this.coll.findOneAndUpdate(
      { _id: `${key}|${start}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(start + this.windowMs + TTL_GRACE_MS) } },
      { upsert: true, returnDocument: "after" },
    );
    const doc = res && "count" in res ? (res as RateLimitDoc) : ((res as { value?: RateLimitDoc | null } | null)?.value ?? null);
    if (!doc) throw new Error("rate limit counter unavailable"); // caller fails closed
    return doc.count <= this.limit;
  }
}

/** Index for arena_rate_limit: documents disappear once `expiresAt` passes. */
export const RATE_LIMIT_TTL_INDEX = { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: "ttl_expiresAt" } } as const;
