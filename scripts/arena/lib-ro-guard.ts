/**
 * Read-only guard for shadow validation against the CRM database.
 *
 * Layer 1 (server side, proven BEFORE any read): connect with ARENA_CRM_RO_URI
 * and ask the server who we are (`connectionStatus` with privileges). Refuse
 * (exit 3) unless the authenticated user holds ONLY read actions — `find`, plus
 * `listCollections` / `listIndexes` — on every resource, and at least one `find`
 * on the CRM database. Refuse the shared app/ops users by name.
 * Layer 2 (in process): the client is wrapped in a proxy that throws on every
 * write method and on $out/$merge, so nothing in this process (including CRM
 * code it calls, e.g. heal-on-read) can even send a write.
 *
 * The URI is read from the environment only (`node --env-file=<file>`), and is
 * never printed: errors are reported by code name, never by message.
 */
import { MongoClient, type Db } from "mongodb";

export const CRM_DB_DEFAULT = "ag";
export const ALLOWED_ACTIONS: ReadonlySet<string> = new Set(["find", "listCollections", "listIndexes"]);
/** Shared users that can write; never acceptable for shadow reads, whatever their roles say. */
export const FORBIDDEN_USERS: readonly string[] = ["lbs_crm_app", "lbs_ops"];
export const GUARD_EXIT_CODE = 3;

export interface Privilege {
  resource: { db?: string; collection?: string; cluster?: boolean; anyResource?: boolean };
  actions: string[];
}
export interface ConnectionStatus {
  authInfo?: {
    authenticatedUsers?: { user: string; db: string }[];
    authenticatedUserRoles?: { role: string; db: string }[];
    authenticatedUserPrivileges?: Privilege[];
  };
}
export interface GuardVerdict {
  ok: boolean;
  users: string[];
  reasons: string[];
  /** CRM collections with `find` ("*" = the whole CRM database). */
  findOn: string[];
  canFind(collection: string): boolean;
}

export class GuardRefusal extends Error {
  readonly exitCode = GUARD_EXIT_CODE;
}

const describe = (r: Privilege["resource"]) =>
  r.anyResource ? "any resource" : r.cluster ? "cluster" : `${r.db || "<any db>"}.${r.collection || "<any collection>"}`;

/** Pure: judge a connectionStatus answer. */
export function evaluateGuard(status: ConnectionStatus, crmDb = CRM_DB_DEFAULT): GuardVerdict {
  const reasons: string[] = [];
  const info = status?.authInfo ?? {};
  const users = (info.authenticatedUsers ?? []).map((u) => `${u.user}@${u.db}`);
  const privileges = info.authenticatedUserPrivileges;
  if (!users.length) reasons.push("the connection is not authenticated, so read-only access cannot be proven");
  for (const u of info.authenticatedUsers ?? [])
    if (FORBIDDEN_USERS.includes(u.user.toLowerCase())) reasons.push(`user "${u.user}" is a shared read-write account and is never allowed here`);
  if (!Array.isArray(privileges)) reasons.push("the server did not report privileges (connectionStatus showPrivileges)");

  const findOn = new Set<string>();
  const badResources: string[] = [];
  for (const p of privileges ?? []) {
    const r = p.resource ?? {};
    const bad = (p.actions ?? []).filter((a) => !ALLOWED_ACTIONS.has(a)).sort();
    if (bad.length) badResources.push(`${bad.slice(0, 6).join(", ")}${bad.length > 6 ? ` (+${bad.length - 6} more)` : ""} on ${describe(r)}`);
    const onCrm = r.anyResource || (!r.cluster && (r.db === crmDb || r.db === ""));
    if (onCrm && (p.actions ?? []).includes("find")) findOn.add(r.anyResource || !r.collection ? "*" : r.collection);
  }
  if (badResources.length)
    reasons.push(`non-read action(s): ${badResources.slice(0, 3).join("; ")}${badResources.length > 3 ? `; and ${badResources.length - 3} more resource(s)` : ""}`);
  if (Array.isArray(privileges) && findOn.size === 0) reasons.push(`no find privilege on the CRM database "${crmDb}"`);
  const all = findOn.has("*");
  return {
    ok: reasons.length === 0,
    users,
    reasons,
    findOn: [...findOn].sort(),
    canFind: (c: string) => all || findOn.has(c),
  };
}

// ── layer 2: in-process write blocking ─────────────────────────────────────
const WRITE = /^(insert|update|replace|delete|bulkWrite|findOneAnd|createIndex|dropIndex|drop|rename|createCollection|command|runCommand)/;

export function readOnly<T extends object>(target: T, label: string, blocked: string[]): T {
  return new Proxy(target, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      if (typeof p === "string" && WRITE.test(p)) {
        return () => {
          blocked.push(`${label}.${p}`);
          throw new Error(`READ-ONLY: ${label}.${p} blocked`);
        };
      }
      if (p === "aggregate" && typeof v === "function") {
        return (pipeline: unknown[], ...rest: unknown[]) => {
          if (JSON.stringify(pipeline).match(/"\$(out|merge)"/)) {
            blocked.push(`${label}.aggregate($out/$merge)`);
            throw new Error("READ-ONLY: $out/$merge blocked");
          }
          return v.call(t, pipeline, ...rest);
        };
      }
      if (p === "collection" && typeof v === "function") return (n: string, ...a: unknown[]) => readOnly(v.call(t, n, ...a), n, blocked);
      if (p === "db" && typeof v === "function") return (n?: string, ...a: unknown[]) => readOnly(v.call(t, n, ...a), `db:${n}`, blocked);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

export interface GuardedCrm {
  /** The proxied client: writes throw in-process. */
  client: MongoClient;
  db: Db;
  /** The unproxied client — ONLY for the access self-test's server-side refusal probes. */
  raw: MongoClient;
  verdict: GuardVerdict;
  blocked: string[];
  close(): Promise<void>;
}

const codeOf = (e: unknown) => {
  const x = e as { codeName?: string; code?: unknown; name?: string };
  return x?.codeName ?? (x?.code !== undefined ? String(x.code) : x?.name ?? "error");
};

/** Connect, prove read-only (layer 1), and return the proxied client (layer 2). Throws GuardRefusal. */
export async function openGuardedCrm(opts: { uriEnv?: string; crmDb?: string } = {}): Promise<GuardedCrm> {
  const uriEnv = opts.uriEnv ?? "ARENA_CRM_RO_URI";
  const crmDb = opts.crmDb ?? process.env.ARENA_CRM_DB ?? CRM_DB_DEFAULT;
  const uri = process.env[uriEnv];
  if (!uri) throw new GuardRefusal(`${uriEnv} is not set (load it with node --env-file=<file>; it is never printed)`);
  const raw = new MongoClient(uri, { readPreference: "secondaryPreferred", serverSelectionTimeoutMS: 15_000, appName: "arena-shadow-ro" });
  try {
    await raw.connect();
  } catch (e) {
    throw new GuardRefusal(`could not connect with ${uriEnv} (${codeOf(e)})`);
  }
  let status: ConnectionStatus;
  try {
    status = (await raw.db("admin").command({ connectionStatus: 1, showPrivileges: true })) as ConnectionStatus;
  } catch (e) {
    await raw.close().catch(() => {});
    throw new GuardRefusal(`connectionStatus failed (${codeOf(e)})`);
  }
  const verdict = evaluateGuard(status, crmDb);
  if (!verdict.ok) {
    await raw.close().catch(() => {});
    throw new GuardRefusal(`REFUSED — not a read-only CRM user: ${verdict.reasons.join("; ")}`);
  }
  const blocked: string[] = [];
  const client = readOnly(raw, "client", blocked);
  return { client, db: client.db(crmDb), raw, verdict, blocked, close: () => raw.close() };
}

/** Run a CLI main; a guard refusal prints one clear line and exits 3. */
export async function runGuarded(main: () => Promise<number | void>): Promise<never> {
  try {
    const code = await main();
    process.exit(typeof code === "number" ? code : 0);
  } catch (e) {
    if (e instanceof GuardRefusal) {
      console.error(`[arena-shadow] ${e.message}`);
      process.exit(GUARD_EXIT_CODE);
    }
    console.error(`[arena-shadow] failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

/** Local Arena state only: every host must be 127.0.0.1 (no SRV, no remote). */
export function assertLocalMongoUri(uri: string): void {
  if (!/^mongodb:\/\//.test(uri)) throw new GuardRefusal("ARENA_SHADOW_LOCAL_URI must be a plain mongodb:// URI on 127.0.0.1");
  const afterScheme = uri.slice("mongodb://".length);
  const hostPart = afterScheme.split("/")[0].split("?")[0];
  const hosts = (hostPart.includes("@") ? hostPart.slice(hostPart.lastIndexOf("@") + 1) : hostPart).split(",");
  for (const h of hosts) {
    const host = h.replace(/:\d+$/, "");
    if (host !== "127.0.0.1") throw new GuardRefusal("ARENA_SHADOW_LOCAL_URI must point at 127.0.0.1 only (local Arena state)");
  }
}
