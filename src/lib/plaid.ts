// Plaid client wrapper — server-side only.
//
// IMPORTANT: this integration is READ-ONLY. We never request `transfer`,
// `payment_initiation`, or `assets` products. The only products we ask for
// are `transactions` (which includes auth/balance under the hood).
//
// Sandbox-first. Set PLAID_ENV=production only after sandbox verified.

import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "plaid";

let _client: PlaidApi | null = null;

export function getPlaidEnv(): "sandbox" | "development" | "production" {
  const v = process.env.PLAID_ENV?.toLowerCase();
  if (v === "production") return "production";
  if (v === "development") return "development";
  return "sandbox";
}

export function isPlaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export function plaid(): PlaidApi {
  if (_client) return _client;
  if (!isPlaidConfigured()) {
    throw new Error(
      "Plaid not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in .env.local. Use sandbox creds first."
    );
  }
  const env = getPlaidEnv();
  const config = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
        "PLAID-SECRET": process.env.PLAID_SECRET!,
        "Plaid-Version": "2020-09-14",
      },
    },
  });
  _client = new PlaidApi(config);
  return _client;
}

// ── Sane defaults — READ-ONLY products only ────────────────────────────────

/** Products requested when creating a Link token. NEVER include transfer/payment_initiation. */
export function plaidProducts(): Products[] {
  // Allow env override but sanitize against money-movement products.
  const raw = (process.env.PLAID_PRODUCTS ?? "transactions").split(",").map((s) => s.trim().toLowerCase());
  const allowed: Record<string, Products> = {
    transactions: Products.Transactions,
    auth:         Products.Auth,
    identity:     Products.Identity,
  };
  // Anything not in the allow-list (e.g. "transfer", "payment_initiation") is silently dropped.
  const out = raw
    .map((k) => allowed[k])
    .filter((p): p is Products => p !== undefined);
  return out.length > 0 ? out : [Products.Transactions];
}

export function plaidCountryCodes(): CountryCode[] {
  const raw = (process.env.PLAID_COUNTRY_CODES ?? "US").split(",").map((s) => s.trim().toUpperCase());
  const out: CountryCode[] = [];
  for (const code of raw) {
    if (code === "US") out.push(CountryCode.Us);
    else if (code === "CA") out.push(CountryCode.Ca);
    else if (code === "GB") out.push(CountryCode.Gb);
  }
  return out.length > 0 ? out : [CountryCode.Us];
}

export function plaidRedirectUri(): string | undefined {
  return process.env.PLAID_REDIRECT_URI || undefined;
}

/** Webhook URL Plaid posts updates to (optional; useful in production). */
export function plaidWebhookUrl(): string | undefined {
  return process.env.PLAID_WEBHOOK_URL || undefined;
}
