// Exchanges Plaid public_token (returned by Link on success) for an
// access_token, then immediately pulls institution + account metadata and
// stores them. Access token is encrypted before persisting.
//
// Read-only: we do not call /transfer or /payment_initiation endpoints.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { isPlaidConfigured, plaid, plaidCountryCodes } from "@/lib/plaid";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes, newId } from "@/lib/finance-db";
import { encrypt } from "@/lib/portal-crypto";
import type {
  ConnectedInstitutionRecord,
  BankAccountSyncedRecord,
} from "@/types/finance-plaid";

export async function POST(req: NextRequest) {
  const session = await requirePermission("finance:banking:connect");
  if (session instanceof NextResponse) return session;
  if (!isPlaidConfigured()) {
    return NextResponse.json({ error: "Plaid not configured" }, { status: 503 });
  }

  try {
    const { public_token } = (await req.json()) as { public_token?: string };
    if (!public_token) return NextResponse.json({ error: "public_token required" }, { status: 400 });

    await ensureFinanceIndexes();

    // 1. Exchange public_token for access_token
    const exchange = await plaid().itemPublicTokenExchange({ public_token });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    // 2. Pull item + institution metadata
    const itemRes = await plaid().itemGet({ access_token: accessToken });
    const item = itemRes.data.item;

    let institutionName: string | undefined;
    let institutionLogo: string | undefined;
    let institutionColor: string | undefined;
    if (item.institution_id) {
      try {
        const instRes = await plaid().institutionsGetById({
          institution_id: item.institution_id,
          country_codes: plaidCountryCodes(),
          options: { include_optional_metadata: true },
        });
        institutionName = instRes.data.institution.name;
        institutionLogo = instRes.data.institution.logo ?? undefined;
        institutionColor = instRes.data.institution.primary_color ?? undefined;
      } catch {
        // non-fatal
      }
    }

    // 3. Pull accounts
    const acctRes = await plaid().accountsGet({ access_token: accessToken });

    const now = new Date().toISOString();
    const institutionDoc: ConnectedInstitutionRecord = {
      _id: newId("inst"),
      item_id: itemId,
      institution_id: item.institution_id ?? undefined,
      institution_name: institutionName,
      institution_logo: institutionLogo,
      institution_primary_color: institutionColor,
      access_token_enc: encrypt(accessToken),
      available_products: item.available_products as string[] | undefined,
      billed_products: item.billed_products as string[] | undefined,
      webhook_url: item.webhook ?? undefined,
      status: "active",
      connected_at: now,
      connected_by: session.name,
    };

    const institutionsColl = coll<ConnectedInstitutionRecord>(FINANCE_COLLECTIONS.plaidInstitution);
    // Split _id + connected_at into $setOnInsert; $set the rest. MongoDB
    // rejects writing the same field via both operators or modifying _id.
    const { _id: instId, connected_at: instConnAt, ...instSet } = institutionDoc;
    await institutionsColl.updateOne(
      { item_id: itemId },
      { $set: instSet, $setOnInsert: { _id: instId, connected_at: instConnAt } },
      { upsert: true }
    );

    // 4. Save accounts
    const accountsColl = coll<BankAccountSyncedRecord>(FINANCE_COLLECTIONS.bankAccountSynced);
    const accountRows: BankAccountSyncedRecord[] = acctRes.data.accounts.map((a) => ({
      _id: newId("ba"),
      item_id: itemId,
      account_id: a.account_id,
      name: a.name,
      official_name: a.official_name ?? undefined,
      mask: a.mask ?? undefined,
      type: a.type,
      subtype: (a.subtype ?? undefined) as BankAccountSyncedRecord["subtype"],
      current_balance: a.balances.current ?? undefined,
      available_balance: a.balances.available ?? undefined,
      limit: a.balances.limit ?? undefined,
      iso_currency_code: a.balances.iso_currency_code ?? "USD",
      institution_name: institutionName,
      status: "active",
      last_balance_at: now,
      active: true,
      created_at: now,
    }));
    for (const acct of accountRows) {
      const { _id: acctId, created_at: acctCreatedAt, ...acctSet } = acct;
      await accountsColl.updateOne(
        { account_id: acct.account_id },
        { $set: acctSet, $setOnInsert: { _id: acctId, created_at: acctCreatedAt } },
        { upsert: true }
      );
    }

    return NextResponse.json({
      ok: true,
      item_id: itemId,
      institution_name: institutionName,
      accounts: acctRes.data.accounts.map((a) => ({
        account_id: a.account_id,
        name: a.name,
        mask: a.mask,
        subtype: a.subtype,
        current_balance: a.balances.current,
      })),
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
