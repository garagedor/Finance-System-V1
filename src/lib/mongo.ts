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
// The connection URI comes from the environment and ONLY from the environment.
// There is deliberately no embedded fallback: a deployment without MONGODB_URI
// must fail loudly rather than quietly reach the database as some other user.
// Database name, queries and behaviour are unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import { MongoClient, type Db, type MongoClientOptions } from "mongodb";

// ─── Connection identity ─────────────────────────────────────────────────────
// Every client announces who it is, so a connection seen in Atlas can be traced
// back to the runtime that opened it without guesswork. Vercel sets VERCEL_ENV
// to "production" | "preview" | "development"; ops scripts set MONGO_APP_NAME
// explicitly. Visible in $currentOp and in the Atlas UI.
function resolveAppName(): string {
  const explicit = process.env.MONGO_APP_NAME?.trim();
  if (explicit) return explicit;
  switch (process.env.VERCEL_ENV) {
    case "production":
      return "lbs-crm-production";
    case "preview":
      return "lbs-crm-preview";
    default:
      return "lbs-local";
  }
}

const APP_NAME = resolveAppName();
const DB_NAME = process.env.MONGODB_DB ?? "ag";

// ─── Fail closed ─────────────────────────────────────────────────────────────
// Validated lazily rather than at module scope, because importing this file must
// not break `next build` — that evaluates modules while prerendering. The check
// runs on the first connection attempt instead, so a misconfigured deployment
// fails on its first database call with a message saying exactly what is wrong,
// and never by silently connecting as somebody else.
const URI_SHAPE = /^mongodb(\+srv)?:\/\/\S+$/;

function requireUri(): string {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. This deployment has no database credential. Set " +
        "MONGODB_URI in the environment (Vercel project settings, or .env.local " +
        "for local work). There is no embedded fallback, by design.",
    );
  }
  if (!URI_SHAPE.test(uri)) {
    throw new Error(
      "MONGODB_URI is set but is not a valid MongoDB connection string " +
        "(it must start with mongodb:// or mongodb+srv://).",
    );
  }
  return uri;
}

const OPTIONS: MongoClientOptions = {
  serverSelectionTimeoutMS: 8000,
  // Serverless-appropriate: many instances each hold a small pool, so keep it
  // modest to stay well under Atlas's connection ceiling. Override via env.
  maxPoolSize: Number(process.env.MONGODB_MAX_POOL ?? 10),
  retryWrites: true,
  appName: APP_NAME,
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

  // Configuration is checked first and its failure is never cached: returning a
  // rejected promise from inside the cached one would poison the cache, so a
  // corrected environment could not recover without a fresh process. Rejecting
  // (rather than throwing synchronously) keeps the signature honest for callers
  // that attach .catch() instead of awaiting.
  let uri: string;
  try {
    uri = requireUri();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    cache.lastError = { message: msg, at: Date.now() };
    return Promise.reject(e);
  }

  if (cache.promise) return cache.promise;
  cache.promise = (async () => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const client = new MongoClient(uri, OPTIONS);
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
  appName: string;
  uriConfigured: boolean;
  lastError: { message: string; code?: string; at: number } | null;
} {
  return {
    connected: !!cache.client,
    connectedAt: cache.connectedAt,
    poolMax: OPTIONS.maxPoolSize ?? 0,
    db: DB_NAME,
    appName: APP_NAME,
    // Presence only — the URI itself is never exposed, here or anywhere else.
    uriConfigured: !!process.env.MONGODB_URI?.trim(),
    lastError: cache.lastError,
  };
}

/** The appName this runtime announces to MongoDB. Exported for diagnostics. */
export const MONGO_APP_NAME = APP_NAME;
