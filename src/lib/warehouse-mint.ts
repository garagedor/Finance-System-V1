/**
 * Minting a Warehouse token.
 *
 * One builder for both doors — the JSON API (`/api/auth/warehouse-token`) and
 * the browser entry (`/api/auth/warehouse-enter`). They must not drift: a
 * browser-minted token that differed from an API-minted one would be a second,
 * undocumented contract, and Warehouse would be verifying two things while
 * believing it verified one.
 */
import "server-only";
import { SignJWT, importPKCS8 } from "jose";
import type { RbacSession } from "./rbac";
import {
  WarehouseSigningError,
  warehouseSigningConfig,
} from "./warehouse-signing-key";
import {
  buildWarehouseClaims,
  hasWarehouseEntitlement,
  type SessionLike,
} from "./warehouse-claims";

/** The cookie Warehouse reads behind the same-origin proxy. */
export const WAREHOUSE_TOKEN_COOKIE = "wh_token";

export type MintRefusal =
  | { ok: false; reason: "no_session"; status: 401 }
  | { ok: false; reason: "disabled" | "no_identity" | "not_entitled"; status: 403; detail: string }
  | { ok: false; reason: "not_configured"; status: 503; detail: string };

export type MintResult =
  | { ok: true; token: string; expiresIn: number }
  | MintRefusal;

/** Narrow an RbacSession to the shape the claim builder accepts. */
export function sessionLike(session: RbacSession): SessionLike {
  return {
    ...(session.userId ? { userId: session.userId } : {}),
    name: session.name,
    permissions: session.permissions,
    active: session.active,
    sessionVersion: session.sessionVersion,
  };
}

/**
 * Mint, or say precisely why not.
 *
 * Returns a refusal rather than throwing or returning a Response, so each door
 * can answer in its own idiom — JSON for the API, a redirect for the browser —
 * without either one re-deciding who is allowed.
 */
export async function mintWarehouseToken(
  session: RbacSession | null,
): Promise<MintResult> {
  if (!session) return { ok: false, reason: "no_session", status: 401 };
  if (!session.active) {
    return { ok: false, reason: "disabled", status: 403, detail: "Account is disabled." };
  }

  const s = sessionLike(session);
  if (!s.userId) {
    // Warehouse keys its liveness check on the subject, so a session with no
    // user id cannot be given one.
    return {
      ok: false, reason: "no_identity", status: 403,
      detail: "This session has no user identity.",
    };
  }
  if (!hasWarehouseEntitlement(s)) {
    return {
      ok: false, reason: "not_entitled", status: 403,
      detail: "This account holds no warehouse permissions.",
    };
  }

  let config;
  try {
    config = warehouseSigningConfig();
  } catch (e) {
    const detail =
      e instanceof WarehouseSigningError ? e.message : "Warehouse token issuance is not configured.";
    console.error("warehouse-mint: signing configuration unavailable");
    return { ok: false, reason: "not_configured", status: 503, detail };
  }

  const claims = buildWarehouseClaims(s);
  const key = await importPKCS8(config.privateKeyPem, "RS256");

  const token = await new SignJWT({
    session_version: claims.session_version,
    account_type: claims.account_type,
    modules: claims.modules,
    warehouse_permissions: claims.warehouse_permissions,
    ...(claims.name ? { name: claims.name } : {}),
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${config.ttlSeconds}s`)
    .sign(key);

  return { ok: true, token, expiresIn: config.ttlSeconds };
}
