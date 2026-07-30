// ─────────────────────────────────────────────────────────────────────────────
// Single shared MongoDB connection layer for the whole app.
//
// Why this exists: previously ~24 API routes each did `new MongoClient(...)`
// per request and never closed it — a fresh TLS + SCRAM handshake on every
// call and a slow connection leak toward Atlas's ceiling. This module owns ONE
// client, cached on `globalThis` so it survives Next.js dev hot-reloads and is
// reused across a serverless instance's module reloads. Callers get the already
// connected client/db; they must NOT call `.close()` on it.
//
// Behaviour is intentionally identical to the old code: same URI resolution
// (env → hardcoded fallback for compatibility), same database name ("ag").
// ─────────────────────────────────────────────────────────────────────────────
import { MongoClient, type Db, type MongoClientOptions } from "mongodb";

// Prefer the environment (Vercel / .env.local). The hardcoded fallback is kept
// ONLY so existing deployments that never set MONGODB_URI keep working exactly
// as before — this is the same fallback that was copy-pasted into 27 files.
// (Rotating this credential + making it env-only is a separate, approval-gated
// security cleanup, tracked in the remediation report.)
const MONGODB_URI =
  process.env.MONGODB_URI ??
  "mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net";
const DB_NAME = process.env.MONGODB_DB ?? "ag";

const OPTIONS: MongoClientOptions = {
  serverSelectionTimeoutMS: 8000,
  // Serverless-appropriate: many instances each hold a small pool, so keep it
  // modest to stay well under Atlas's connection ceiling. Override via env.
  maxPoolSize: Number(process.env.MONGODB_MAX_POOL ?? 10),
  retryWrites: true,
};

interface ConnCache {
  client: MongoClient | null;
  promise: Promise<MongoClient> | null;
  connectedAt: number | null;
  lastError: { message: string; code?: string; at: number } | null;
}

// One cache object per process, pinned to globalThis so hot-reload doesn't leak
// a new client on every file save in dev.
const globalRef = globalThis as unknown as { __lbsMongo?: ConnCache };
const cache: ConnCache =
  globalRef.__lbsMongo ??
  (globalRef.__lbsMongo = { client: null, promise: null, connectedAt: null, lastError: null });

// Transient DNS/TLS/topology errors worth a couple of quick retries (flaky
// resolvers, especially WSL; Atlas SRV lookups; momentary TLS drops).
function isTransient(msg: string): boolean {
  return /ENOTFOUND|querySrv|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAGAIN|SSL|TLS|timed out|topology|ServerSelection|pool/i.test(
    msg,
  );
}

/** The one shared, connected MongoClient. Never call `.close()` on it. */
export function getMongoClient(): Promise<MongoClient> {
  if (cache.client) return Promise.resolve(cache.client);
  if (cache.promise) return cache.promise;
  cache.promise = (async () => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const client = new MongoClient(MONGODB_URI, OPTIONS);
        await client.connect();
        cache.client = client;
        cache.connectedAt = Date.now();
        cache.lastError = null;
        return client;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        cache.lastError = { message: msg, code: (e as { code?: string })?.code, at: Date.now() };
        if (attempt < 4 && isTransient(msg)) {
          await new Promise((r) => setTimeout(r, 300 * attempt));
          continue;
        }
        break;
      }
    }
    cache.promise = null; // clear so the next call can retry a fresh connect
    throw lastErr;
  })();
  return cache.promise;
}

/** The shared `ag` database (or a named one). */
export async function getMongoDb(name: string = DB_NAME): Promise<Db> {
  return (await getMongoClient()).db(name);
}

/** The default database name ("ag"). */
export const MONGO_DB_NAME = DB_NAME;

/**
 * Diagnostics for a health endpoint. NEVER includes the URI or credentials —
 * only connection state, pool size, and the last error message.
 */
export function mongoHealth(): {
  connected: boolean;
  connectedAt: number | null;
  poolMax: number;
  db: string;
  lastError: { message: string; code?: string; at: number } | null;
} {
  return {
    connected: !!cache.client,
    connectedAt: cache.connectedAt,
    poolMax: OPTIONS.maxPoolSize ?? 0,
    db: DB_NAME,
    lastError: cache.lastError,
  };
}
