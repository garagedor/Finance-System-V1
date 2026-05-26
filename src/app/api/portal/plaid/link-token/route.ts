// Creates a Plaid Link token. The frontend uses this to launch Plaid Link.
// Read-only: requests only `transactions` (which provides balances).

import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import {
  isPlaidConfigured,
  plaid,
  plaidCountryCodes,
  plaidProducts,
  plaidRedirectUri,
  plaidWebhookUrl,
} from "@/lib/plaid";

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.type !== "admin" && session.type !== "bookkeeper") {
    return NextResponse.json(
      { error: "Connecting banks is restricted to admin and bookkeeper roles." },
      { status: 403 }
    );
  }
  if (!isPlaidConfigured()) {
    return NextResponse.json(
      { error: "Plaid is not configured. Set PLAID_CLIENT_ID + PLAID_SECRET in .env.local." },
      { status: 503 }
    );
  }

  try {
    // Allow reconnecting an existing item (Link update mode) by passing access_token
    const body = (await req.json().catch(() => ({}))) as { access_token?: string };
    const updateMode = !!body.access_token;

    const r = await plaid().linkTokenCreate({
      user: {
        // Plaid requires a stable per-user id; using the user's name is fine for sandbox.
        client_user_id: session.name,
      },
      client_name: "LBS Garage Door — Finance Portal",
      language: "en",
      country_codes: plaidCountryCodes(),
      products: updateMode ? [] : plaidProducts(),
      access_token: updateMode ? body.access_token : undefined,
      redirect_uri: plaidRedirectUri(),
      webhook: plaidWebhookUrl(),
    });
    return NextResponse.json({
      link_token: r.data.link_token,
      expiration: r.data.expiration,
      request_id: r.data.request_id,
    });
  } catch (e: unknown) {
    const err = extractPlaidError(e);
    return NextResponse.json({ error: err.message, plaid_error: err.code }, { status: 500 });
  }
}

function extractPlaidError(e: unknown): { code?: string; message: string } {
  const ax = e as { response?: { data?: { error_code?: string; error_message?: string } }; message?: string };
  if (ax?.response?.data?.error_message) {
    return { code: ax.response.data.error_code, message: ax.response.data.error_message };
  }
  return { message: ax?.message ?? "Plaid error" };
}
