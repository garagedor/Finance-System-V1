/**
 * Fixed-window rate limiter, in process memory. Good enough for the dev stack
 * and a single server; PRODUCTION NEEDS SHARED STORAGE (serverless instances do
 * not share memory), e.g. a Mongo/Redis counter keyed the same way.
 */
export class MemoryRateLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;
  constructor(limit: number, windowMs: number, clock: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.clock = clock;
  }
  /** true = allowed (and counted). */
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
