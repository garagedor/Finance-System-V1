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
