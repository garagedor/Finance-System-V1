/**
 * Is a Weekly Balance account still allowed in? (Owner Decision 4, Option B:
 * a narrow, read-only, service-to-service check.) The answer comes ONLY from
 * the Weekly Balance side — never from anything the client sends — and every
 * failure (timeout, HTTP error, odd shape) is treated as "no".
 *
 * Implementations:
 *   WbEdgeVerifier       POST <wb>/functions/v1/arena-verify {user_id} with the
 *                        dedicated x-arena-verify-key secret; answers ONLY
 *                        {active, approved, role} (ARENA_VERIFIER=wb, default)
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
const MIN_SECRET_LENGTH = 32;

/**
 * The real verifier: the Weekly Balance `arena-verify` Edge Function
 * (the-convert, supabase/functions/arena-verify), authenticated with a
 * DEDICATED shared secret (ARENA_WB_VERIFIER_SECRET). That secret can do one
 * thing only — ask {active, approved, role} for one account id. The Arena
 * server never holds the service-role key or a database login.
 */
export class WbEdgeVerifier implements TechnicianVerifier {
  private readonly url: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  constructor(baseUrl: string, secret: string, fetchImpl: typeof fetch = fetch, timeoutMs = VERIFY_TIMEOUT_MS) {
    this.url = `${baseUrl}/functions/v1/arena-verify`;
    this.secret = secret;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }
  async verify(userId: string): Promise<AccountStatus | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "x-arena-verify-key": this.secret, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new VerifierUnavailableError("verification request failed");
    }
    if (!res.ok) throw new VerifierUnavailableError(`verification returned ${res.status}`);
    const body = (await res.json().catch(() => undefined)) as { account?: unknown } | undefined;
    if (!body || typeof body !== "object" || !("account" in body))
      throw new VerifierUnavailableError("verification answer has an unexpected shape");
    if (body.account === null) return null;
    const r = body.account as Record<string, unknown>;
    if (typeof r?.active !== "boolean" || typeof r.approved !== "boolean" || typeof r.role !== "string")
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
  const kind = (env.ARENA_VERIFIER ?? "wb").trim() || "wb";
  if (kind === "fake-dev") {
    if (env.NODE_ENV === "production" && env.ARENA_DEV_STACK !== "1")
      throw new ArenaTechConfigError("ARENA_VERIFIER=fake-dev is refused in production (needs ARENA_DEV_STACK=1)");
    const file = (env.ARENA_FAKE_VERIFIER_FILE ?? "").trim();
    if (!file) throw new ArenaTechConfigError("ARENA_FAKE_VERIFIER_FILE is required for ARENA_VERIFIER=fake-dev");
    return new FileFakeVerifier(file);
  }
  if (kind !== "wb") throw new ArenaTechConfigError(`unknown ARENA_VERIFIER "${kind}"`);
  const secret = (env.ARENA_WB_VERIFIER_SECRET ?? "").trim();
  if (secret.length < MIN_SECRET_LENGTH) throw new ArenaTechConfigError("ARENA_WB_VERIFIER_SECRET is not set (or too short)");
  return new WbEdgeVerifier(wbUrl, secret);
}
