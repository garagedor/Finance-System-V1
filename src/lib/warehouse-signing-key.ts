/**
 * The RS256 private key the CRM uses to mint Warehouse tokens.
 *
 * Asymmetric on purpose. Warehouse holds only the public half and therefore
 * cannot mint a token for itself; this is the only place in the ecosystem that
 * can. There is no symmetric path: JWT_SECRET signs CRM session cookies and is
 * never reused here, because a shared secret would hand Warehouse the ability
 * to forge CRM sessions.
 *
 * server-only. It must never reach middleware or a client bundle.
 */
import "server-only";

export class WarehouseSigningError extends Error {
  readonly code: "missing" | "not_private" | "malformed";
  constructor(code: WarehouseSigningError["code"], message: string) {
    super(message);
    this.name = "WarehouseSigningError";
    this.code = code;
  }
}

export interface WarehouseSigningConfig {
  privateKeyPem: string;
  issuer: string;
  audience: string;
  /** Seconds. Short, because the token is re-obtainable from a CRM session. */
  ttlSeconds: number;
}

/** Fixed by the Auth Integration Gate plan. Warehouse rejects a wrong `aud`. */
export const WAREHOUSE_AUDIENCE = "warehouse";

/** 15 minutes, per docs/AUTH-INTEGRATION-GATE-PLAN.md §4. */
export const WAREHOUSE_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Read and validate the signing configuration.
 *
 * Throws when it is absent or wrong. Nothing here falls back, generates a key,
 * or substitutes a development value — a signing key that invents itself is a
 * signing key nobody controls. The failure is total and recoverable; the
 * alternative is a production deployment minting tokens against a key that
 * exists only in its own memory.
 *
 * Never logs or returns key material in an error message.
 */
export function warehouseSigningConfig(): WarehouseSigningConfig {
  const raw = process.env.WAREHOUSE_JWT_PRIVATE_KEY;
  if (!raw || !raw.trim()) {
    throw new WarehouseSigningError(
      "missing",
      "WAREHOUSE_JWT_PRIVATE_KEY is not set. Warehouse tokens cannot be issued.",
    );
  }

  // PEM carried through an environment variable normally arrives with literal \n.
  const pem = raw.replace(/\\n/g, "\n");

  if (/BEGIN PUBLIC KEY/.test(pem)) {
    // The mirror image of Warehouse's own guard, and the mistake most likely to
    // be made while wiring the pair up: the two halves swapped.
    throw new WarehouseSigningError(
      "not_private",
      "WAREHOUSE_JWT_PRIVATE_KEY contains a PUBLIC key. The private half signs; " +
        "the public half goes to Warehouse.",
    );
  }
  if (!/BEGIN (RSA )?PRIVATE KEY/.test(pem)) {
    throw new WarehouseSigningError(
      "malformed",
      "WAREHOUSE_JWT_PRIVATE_KEY must be a PKCS#8 PEM private key.",
    );
  }

  const issuer = process.env.WAREHOUSE_JWT_ISSUER?.trim();
  if (!issuer) {
    throw new WarehouseSigningError(
      "missing",
      "WAREHOUSE_JWT_ISSUER is not set. Warehouse checks the issuer on every token.",
    );
  }

  return {
    privateKeyPem: pem,
    issuer,
    audience: WAREHOUSE_AUDIENCE,
    ttlSeconds: WAREHOUSE_TOKEN_TTL_SECONDS,
  };
}

/** Whether issuance is configured. For diagnostics — never a gate. */
export function canIssueWarehouseTokens(): boolean {
  try {
    warehouseSigningConfig();
    return true;
  } catch {
    return false;
  }
}
