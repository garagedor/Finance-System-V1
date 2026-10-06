/**
 * Mint a Warehouse token for the signed-in CRM user.
 *
 * A valid CRM session is necessary and not sufficient. Warehouse is a separate
 * application with its own entitlement; holding a session here says who you
 * are, not that you belong there.
 *
 * The token is separately signed with RS256. It is not the CRM session cookie
 * with extra claims, and the CRM's own HS256 secret is never involved —
 * Warehouse holds only the public half and so cannot mint anything.
 */
import { NextResponse } from "next/server";
import { SignJWT, importPKCS8 } from "jose";
import { readSession } from "@/lib/rbac";
import {
  WarehouseSigningError,
  warehouseSigningConfig,
} from "@/lib/warehouse-signing-key";
import {
  buildWarehouseClaims,
  hasWarehouseEntitlement,
  type SessionLike,
} from "@/lib/warehouse-claims";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.active) {
    // A disabled account is refused here even before session_version
    // enforcement lands, because the claim is already on the session.
    return NextResponse.json({ error: "Forbidden", detail: "Account is disabled." }, { status: 403 });
  }

  const s: SessionLike = {
    ...(session.userId ? { userId: session.userId } : {}),
    name: session.name,
    permissions: session.permissions,
    active: session.active,
    sessionVersion: session.sessionVersion,
  };

  if (!s.userId) {
    // Warehouse keys its liveness check on the subject, so a session with no
    // user id cannot be given one.
    return NextResponse.json(
      { error: "Forbidden", detail: "This session has no user identity." },
      { status: 403 },
    );
  }
  if (!hasWarehouseEntitlement(s)) {
    return NextResponse.json(
      { error: "Forbidden", detail: "This account holds no warehouse permissions." },
      { status: 403 },
    );
  }

  let config;
  try {
    config = warehouseSigningConfig();
  } catch (e) {
    // Fail closed, and say which half is missing without saying anything about
    // its contents. 503 rather than 500: the request was fine, the deployment
    // is not configured to answer it yet.
    const detail =
      e instanceof WarehouseSigningError ? e.message : "Warehouse token issuance is not configured.";
    console.error("warehouse-token: signing configuration unavailable");
    return NextResponse.json({ error: "not_configured", detail }, { status: 503 });
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

  return NextResponse.json(
    { token, expiresIn: config.ttlSeconds },
    { headers: { "cache-control": "no-store" } },
  );
}
