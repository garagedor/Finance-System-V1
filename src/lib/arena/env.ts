/**
 * Where Arena state lives. The Arena never writes to the CRM database: its own
 * collections go to a separate database named by ARENA_MONGODB_DB, and that
 * name must differ from the CRM's. There is no default, so a missing variable
 * fails closed instead of quietly writing next to production CRM data.
 *
 * The owner account is likewise configuration, not data: ARENA_OWNER_USER_ID
 * names the one CRM user who may initialise Arena settings. Everything else the
 * owner controls is then held in the versioned settings document.
 */

export class ArenaEnvError extends Error {}

/** The CRM's database name, resolved the way lib/finance-db.ts resolves it. */
export const crmDbName = (env: NodeJS.ProcessEnv = process.env) => env.MONGODB_DB ?? "ag";

export function arenaDbName(env: NodeJS.ProcessEnv = process.env): string {
  const name = (env.ARENA_MONGODB_DB ?? "").trim();
  if (!name) throw new ArenaEnvError("ARENA_MONGODB_DB is not set; the Arena has no database of its own");
  if (!/^[A-Za-z0-9_-]{1,38}$/.test(name)) throw new ArenaEnvError("ARENA_MONGODB_DB is not a valid database name");
  // "ag" is listed explicitly because 26 CRM routes hard-code it whatever MONGODB_DB says.
  const forbidden = new Set([crmDbName(env), "ag"].map((n) => n.toLowerCase()));
  if (forbidden.has(name.toLowerCase())) throw new ArenaEnvError("ARENA_MONGODB_DB must not be the CRM database");
  return name;
}

export function arenaOwnerFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = (env.ARENA_OWNER_USER_ID ?? "").trim();
  return id || null;
}

// ── dedicated CRM connection (production credential safety) ────────────────

const LOOPBACK_URI = /^mongodb:\/\/(?:[^@/]*@)?(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|\?|$)/i;

/** The local dev stack: ARENA_DEV_STACK=1, not on Vercel, and the CRM database on this machine. */
function isLocalDevStack(env: NodeJS.ProcessEnv): boolean {
  if (env.ARENA_DEV_STACK !== "1") return false;
  if (env.VERCEL === "1" || (env.VERCEL_ENV ?? "").trim()) return false;
  return LOOPBACK_URI.test((env.MONGODB_URI ?? "").trim());
}

/**
 * Must this process reach the CRM through the dedicated Arena user? True on
 * Vercel (production AND preview — a preview uses the production database) and
 * whenever NODE_ENV=production, except on the local dev stack (`next start`
 * against a loopback MongoDB with ARENA_DEV_STACK=1).
 */
export function requiresDedicatedConnection(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL_ENV === "production" || env.VERCEL === "1" || (env.VERCEL_ENV ?? "").trim()) return true;
  if (env.NODE_ENV === "production") return !isLocalDevStack(env);
  return false;
}

const uriUser = (uri: string): string | null => {
  const m = /^mongodb(?:\+srv)?:\/\/([^:@/]+)(?::[^@]*)?@/.exec(uri);
  try {
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
};

/**
 * The connection string the Arena uses, or null to share the CRM app's
 * connection (development only). In production there is NO fallback to the
 * CRM's write-capable connection: without a dedicated ARENA_MONGODB_URI — or
 * with one that is the CRM's own user — every Arena request fails closed.
 */
export function arenaMongoUri(env: NodeJS.ProcessEnv = process.env): string | null {
  const uri = (env.ARENA_MONGODB_URI ?? "").trim();
  if (uri && !/^mongodb(\+srv)?:\/\/\S+$/.test(uri)) throw new ArenaEnvError("ARENA_MONGODB_URI is not a MongoDB connection string");
  if (!requiresDedicatedConnection(env)) return uri || null;
  if (!uri)
    throw new ArenaEnvError(
      "The Arena refuses to run in production without its dedicated CRM connection: set ARENA_MONGODB_URI (read-only on the CRM, see docs/arena/PRODUCTION-ENV.md)",
    );
  const crm = (env.MONGODB_URI ?? "").trim();
  const user = uriUser(uri);
  if (crm && (uri === crm || (user !== null && user === uriUser(crm))))
    throw new ArenaEnvError("ARENA_MONGODB_URI must be the dedicated Arena user, not the CRM app's (write-capable) connection");
  return uri;
}
