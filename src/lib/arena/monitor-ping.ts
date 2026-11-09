/**
 * Optional dead-man's-switch ping for the per-minute monitor cron
 * (/api/arena/monitor), e.g. a Healthchecks.io check.
 *
 *   ARENA_MONITOR_PING_URL   server-only env var (never in browser code). Unset → no-op.
 *
 * After each monitor run:
 *   - healthy (the live snapshot is fresh and the last recompute succeeded — or
 *     there is no live week to keep fresh)  → GET <url>          ("success")
 *   - unhealthy / the run itself failed     → count the run of consecutive failures;
 *     once it reaches MONITOR_FAIL_AFTER (3) → GET <url>/fail on every failing run
 *     (idempotent at the monitor service; a lost ping is re-sent next minute)
 *   - the first healthy run after that      → GET <url> again (recovery) and reset.
 * If the deployment or the cron stops entirely, the pings stop and the external
 * service alerts by itself (that is the point of a dead-man's switch).
 *
 * Never throws, never delays the monitor more than MONITOR_PING_TIMEOUT_MS, and
 * never logs the URL (it is a capability: anyone holding it can ping the check).
 * The failure run is kept in arena_live_health (_id "monitor:ping") so it
 * survives serverless instances; when that store is unreachable (the database
 * being down is itself a failure) an in-process counter is used instead.
 */

export const MONITOR_PING_TIMEOUT_MS = 5 * 1000; // 5 s (operations timeout, not a competition rule)
export const MONITOR_FAIL_AFTER = 3;
export const MONITOR_PING_DOC_ID = "monitor:ping";

export interface MonitorPingDoc {
  _id: string;
  failures: number;
  at: string;
}

/** The slice of a collection this needs (MongoDB collection or MemoryCollection). */
export interface MonitorPingStore {
  findOne(filter: { _id: string }): Promise<unknown>;
  updateOne(filter: { _id: string }, update: { $set: Partial<MonitorPingDoc> }): Promise<{ matchedCount: number }>;
  insertOne(doc: MonitorPingDoc): Promise<unknown>;
}

export type PingOutcome = { sent: "success" | "fail" | null; failures: number; ok: boolean | null; reason?: string };

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The configured ping URL, or null (unset/invalid → pinging off). https only (http just for loopback tests). */
export function monitorPingUrl(env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = console.warn): URL | null {
  const raw = (env.ARENA_MONITOR_PING_URL ?? "").trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    log("[arena-monitor] ARENA_MONITOR_PING_URL is not a valid URL; pinging is off");
    return null;
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOOPBACK.has(u.hostname))) {
    log("[arena-monitor] ARENA_MONITOR_PING_URL must be https; pinging is off");
    return null;
  }
  if (u.username || u.password || u.hash) {
    log("[arena-monitor] ARENA_MONITOR_PING_URL must not carry credentials or a fragment; pinging is off");
    return null;
  }
  return u;
}

/** <url>/fail, keeping any query string (Healthchecks: /ping/<uuid>/fail, /ping/<key>/<slug>/fail). */
export function failUrl(u: URL): URL {
  const f = new URL(u.href);
  f.pathname = `${f.pathname.replace(/\/+$/, "")}/fail`;
  return f;
}

let memoryFailures = 0;
/** Tests only. */
export function _resetMonitorPingMemory() {
  memoryFailures = 0;
}

async function loadFailures(store: MonitorPingStore | null): Promise<number> {
  if (!store) return memoryFailures;
  try {
    const d = (await store.findOne({ _id: MONITOR_PING_DOC_ID })) as MonitorPingDoc | null;
    return d && Number.isInteger(d.failures) && d.failures >= 0 ? d.failures : 0;
  } catch {
    return memoryFailures;
  }
}

async function saveFailures(store: MonitorPingStore | null, failures: number, at: string) {
  memoryFailures = failures;
  if (!store) return;
  try {
    if ((await store.updateOne({ _id: MONITOR_PING_DOC_ID }, { $set: { failures, at } })).matchedCount === 1) return;
    try {
      await store.insertOne({ _id: MONITOR_PING_DOC_ID, failures, at });
    } catch {
      await store.updateOne({ _id: MONITOR_PING_DOC_ID }, { $set: { failures, at } }); // inserted concurrently
    }
  } catch {
    /* the in-process counter above still holds it */
  }
}

async function send(url: URL, fetchImpl: typeof fetch, timeoutMs: number): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetchImpl(url.href, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      redirect: "error",
      headers: { "user-agent": "lbs-arena-monitor" },
    });
    await res.body?.cancel().catch(() => {});
    return res.ok ? { ok: true } : { ok: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    // Fixed words only: an error message could echo the URL.
    return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network error" };
  }
}

/**
 * Report one monitor run. `healthy` = the run succeeded with a fresh live
 * snapshot (or nothing needed refreshing). Never throws.
 */
export async function monitorPing(opts: {
  healthy: boolean;
  store?: MonitorPingStore | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  log?: (m: string) => void;
}): Promise<PingOutcome> {
  const log = opts.log ?? ((m: string) => console.warn(m));
  try {
    const url = monitorPingUrl(opts.env ?? process.env, log);
    if (!url) return { sent: null, failures: 0, ok: null };
    const store = opts.store ?? null;
    const at = (opts.now ?? (() => new Date()))().toISOString();
    const before = await loadFailures(store);
    const failures = opts.healthy ? 0 : before + 1;
    await saveFailures(store, failures, at);
    const kind: PingOutcome["sent"] = opts.healthy ? "success" : failures >= MONITOR_FAIL_AFTER ? "fail" : null;
    if (!kind) return { sent: null, failures, ok: null };
    const r = await send(kind === "fail" ? failUrl(url) : url, opts.fetchImpl ?? fetch, opts.timeoutMs ?? MONITOR_PING_TIMEOUT_MS);
    if (!r.ok) log(`[arena-monitor] ${kind} ping not delivered (${r.reason})`);
    else if (kind === "fail") log(`[arena-monitor] fail ping sent (${failures} failed runs in a row)`);
    else if (before >= MONITOR_FAIL_AFTER) log("[arena-monitor] recovery ping sent");
    return { sent: kind, failures, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) };
  } catch {
    log("[arena-monitor] ping skipped (unexpected error)");
    return { sent: null, failures: 0, ok: false, reason: "error" };
  }
}
