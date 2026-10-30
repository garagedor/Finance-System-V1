/**
 * Is a Weekly Balance account still allowed in? (Owner Decision 4, Option B:
 * a narrow, read-only, service-to-service check.) The answer comes ONLY from
 * the Weekly Balance side — never from anything the client sends — and every
 * failure (timeout, HTTP error, odd shape) is treated as "no".
 *
 * Implementations:
 *   SupabaseRpcVerifier  POST <wb>/rest/v1/rpc/arena_verify_account {_user_id}
 *                        with a server-only key; the function returns ONLY
 *                        {active, approved, role} (docs/arena/WB-VERIFY-FUNCTION.sql)
 *   MemoryVerifier       tests, and ARENA_VERIFIER=fake-dev on the local dev stack
 *                        (refused when NODE_ENV=production unless ARENA_DEV_STACK=1)
 *
 * No caching: the check runs on the exchange AND on every technician request,
 * so a deactivation takes effect on the very next call.
 */
import { readFileSync } from "node:fs";
import { ArenaTechConfigError } from "./config";

export interface AccountStatus {
  active: boolean;
  approved: boolean;
  role: string;
}

export interface TechnicianVerifier {
  /** null = unknown account. Throws when the answer cannot be obtained. */
  verify(userId: string): Promise<AccountStatus | null>;
}

export class VerifierUnavailableError extends Error {}

/** Roles that may compete (an active, approved technician or area manager). */
export const COMPETING_ROLES: readonly string[] = ["technician", "area_manager"];

export const isAllowed = (s: AccountStatus | null): boolean =>
  !!s && s.active === true && s.approved === true && COMPETING_ROLES.includes(s.role);

const VERIFY_TIMEOUT_MS = 4_000;

export class SupabaseRpcVerifier implements TechnicianVerifier {
  private readonly baseUrl: string;
  private readonly serverKey: string;
  private readonly fetchImpl: typeof fetch;
  constructor(baseUrl: string, serverKey: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    this.serverKey = serverKey;
    this.fetchImpl = fetchImpl;
  }
  async verify(userId: string): Promise<AccountStatus | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/rest/v1/rpc/arena_verify_account`, {
        method: "POST",
        headers: { apikey: this.serverKey, Authorization: `Bearer ${this.serverKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ _user_id: userId }),
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new VerifierUnavailableError("verification request failed");
    }
    if (!res.ok) throw new VerifierUnavailableError(`verification returned ${res.status}`);
    const body = (await res.json().catch(() => null)) as unknown;
    const row = Array.isArray(body) ? body[0] : body;
    if (row === null || row === undefined) return null;
    const r = row as Record<string, unknown>;
    if (typeof r.active !== "boolean" || typeof r.approved !== "boolean" || typeof r.role !== "string")
      throw new VerifierUnavailableError("verification answer has an unexpected shape");
    return { active: r.active, approved: r.approved, role: r.role };
  }
}

export class MemoryVerifier implements TechnicianVerifier {
  readonly accounts: Map<string, AccountStatus>;
  constructor(accounts: Map<string, AccountStatus> = new Map()) {
    this.accounts = accounts;
  }
  async verify(userId: string) {
    return this.accounts.get(userId) ?? null;
  }
}

/** fake-dev: re-reads its JSON file on every call, so editing it simulates a deactivation. */
class FileFakeVerifier implements TechnicianVerifier {
  private readonly file: string;
  constructor(file: string) {
    this.file = file;
  }
  async verify(userId: string): Promise<AccountStatus | null> {
    let data: { accounts?: Record<string, AccountStatus> };
    try {
      data = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      throw new VerifierUnavailableError("fake verifier file unreadable");
    }
    return data.accounts?.[userId] ?? null;
  }
}

export function verifierFromEnv(wbUrl: string, env: NodeJS.ProcessEnv = process.env): TechnicianVerifier {
  const kind = (env.ARENA_VERIFIER ?? "supabase-rpc").trim();
  if (kind === "fake-dev") {
    if (env.NODE_ENV === "production" && env.ARENA_DEV_STACK !== "1")
      throw new ArenaTechConfigError("ARENA_VERIFIER=fake-dev is refused in production (needs ARENA_DEV_STACK=1)");
    const file = (env.ARENA_FAKE_VERIFIER_FILE ?? "").trim();
    if (!file) throw new ArenaTechConfigError("ARENA_FAKE_VERIFIER_FILE is required for ARENA_VERIFIER=fake-dev");
    return new FileFakeVerifier(file);
  }
  if (kind !== "supabase-rpc") throw new ArenaTechConfigError(`unknown ARENA_VERIFIER "${kind}"`);
  const key = (env.ARENA_WB_VERIFIER_KEY ?? "").trim();
  if (!key) throw new ArenaTechConfigError("ARENA_WB_VERIFIER_KEY is not set");
  return new SupabaseRpcVerifier(wbUrl, key);
}
