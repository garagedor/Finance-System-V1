// Incrementally syncs transactions for one (or all) connected institutions.
// Uses Plaid's /transactions/sync cursor pattern. Idempotent.
//
// POST /api/portal/plaid/sync           — sync all active institutions
// POST /api/portal/plaid/sync?item_id=X — sync just one

import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { isPlaidConfigured, plaid } from "@/lib/plaid";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes, newId } from "@/lib/finance-db";
import { decrypt } from "@/lib/portal-crypto";
import type {
  BankAccountSyncedRecord,
  BankSyncLogRecord,
  BankTransactionSyncedRecord,
  ConnectedInstitutionRecord,
  TxnDirection,
} from "@/types/finance-plaid";
import type { Transaction, RemovedTransaction } from "plaid";

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPlaidConfigured()) return NextResponse.json({ error: "Plaid not configured" }, { status: 503 });

  await ensureFinanceIndexes();
  const targetItemId = req.nextUrl.searchParams.get("item_id");

  const institutionsColl = coll<ConnectedInstitutionRecord>(FINANCE_COLLECTIONS.plaidInstitution);
  const items = await institutionsColl
    .find(targetItemId ? { item_id: targetItemId } : { status: { $ne: "disconnected" } })
    .toArray();

  if (items.length === 0) {
    return NextResponse.json({ error: "No connected institutions to sync" }, { status: 404 });
  }

  const results: Array<{
    item_id: string;
    institution_name?: string;
    ok: boolean;
    added: number;
    modified: number;
    removed: number;
    error?: string;
  }> = [];

  for (const item of items) {
    const result = await syncOne(item, session.name);
    results.push(result);
  }
  return NextResponse.json({ ok: true, results });
}

async function syncOne(
  institution: ConnectedInstitutionRecord,
  actor: string
): Promise<{
  item_id: string;
  institution_name?: string;
  ok: boolean;
  added: number;
  modified: number;
  removed: number;
  error?: string;
}> {
  const logColl = coll<BankSyncLogRecord>(FINANCE_COLLECTIONS.bankSyncLog);
  const txnColl = coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced);
  const institutionsColl = coll<ConnectedInstitutionRecord>(FINANCE_COLLECTIONS.plaidInstitution);
  const accountsColl = coll<BankAccountSyncedRecord>(FINANCE_COLLECTIONS.bankAccountSynced);

  const startedAt = new Date().toISOString();
  const logId = newId("synclog");
  let cursor: string | undefined = institution.cursor;
  const cursorBefore = cursor;

  let added = 0;
  let modified = 0;
  let removed = 0;
  let errorMessage: string | undefined;
  let errorCode: string | undefined;
  let nextCursor: string | undefined = cursor;

  try {
    const accessToken = decrypt(institution.access_token_enc);

    // Page through /transactions/sync until has_more is false
    let hasMore = true;
    let safety = 0;
    while (hasMore && safety < 20) {
      safety++;
      const resp = await plaid().transactionsSync({
        access_token: accessToken,
        cursor,
        count: 500,
      });
      const data = resp.data;

      // Upsert added + modified
      for (const t of data.added as Transaction[]) {
        added++;
        await txnColl.updateOne(
          { plaid_transaction_id: t.transaction_id },
          {
            $set: mapTxn(t, institution),
            $setOnInsert: {
              _id: newId("btx"),
              created_at: new Date().toISOString(),
            },
          },
          { upsert: true }
        );
      }
      for (const t of data.modified as Transaction[]) {
        modified++;
        await txnColl.updateOne(
          { plaid_transaction_id: t.transaction_id },
          { $set: { ...mapTxn(t, institution), updated_at: new Date().toISOString() } },
          { upsert: true }
        );
      }
      // Remove deleted
      for (const r of data.removed as RemovedTransaction[]) {
        if (!r.transaction_id) continue;
        removed++;
        await txnColl.deleteOne({ plaid_transaction_id: r.transaction_id });
      }

      cursor = data.next_cursor;
      nextCursor = data.next_cursor;
      hasMore = data.has_more;
    }

    // Refresh balances (cheap; one call). Self-healing: UPSERT account rows
    // so if the initial exchange missed any (e.g. partial failure), sync
    // backfills them.
    try {
      const balRes = await plaid().accountsBalanceGet({ access_token: accessToken });
      const now = new Date().toISOString();
      for (const a of balRes.data.accounts) {
        await accountsColl.updateOne(
          { account_id: a.account_id },
          {
            $set: {
              item_id: institution.item_id,
              account_id: a.account_id,
              name: a.name,
              official_name: a.official_name ?? undefined,
              mask: a.mask ?? undefined,
              type: a.type,
              subtype: (a.subtype ?? undefined) as never,
              current_balance: a.balances.current ?? undefined,
              available_balance: a.balances.available ?? undefined,
              limit: a.balances.limit ?? undefined,
              iso_currency_code: a.balances.iso_currency_code ?? "USD",
              institution_name: institution.institution_name,
              status: "active",
              last_balance_at: now,
              active: true,
            },
            $setOnInsert: {
              _id: newId("ba"),
              created_at: now,
            },
          },
          { upsert: true }
        );
      }
      await institutionsColl.updateOne(
        { item_id: institution.item_id },
        { $set: { last_balance_refresh_at: now } }
      );
    } catch {
      // non-fatal
    }

    await institutionsColl.updateOne(
      { item_id: institution.item_id },
      {
        $set: {
          cursor: nextCursor,
          last_sync_at: new Date().toISOString(),
          status: "active",
          status_message: undefined,
        },
      }
    );
  } catch (e: unknown) {
    const err = extractPlaidError(e);
    errorCode = err.code;
    errorMessage = err.message;

    // Detect "needs login" → set status accordingly
    if (errorCode === "ITEM_LOGIN_REQUIRED") {
      await institutionsColl.updateOne(
        { item_id: institution.item_id },
        { $set: { status: "needs_login", status_message: err.message } }
      );
    } else {
      await institutionsColl.updateOne(
        { item_id: institution.item_id },
        { $set: { status: "error", status_message: err.message } }
      );
    }
  }

  const finishedAt = new Date().toISOString();
  await logColl.insertOne({
    _id: logId,
    item_id: institution.item_id,
    kind: "transactions_sync",
    started_at: startedAt,
    finished_at: finishedAt,
    ok: !errorMessage,
    added,
    modified,
    removed,
    cursor_before: cursorBefore,
    cursor_after: nextCursor,
    error_code: errorCode,
    error_message: errorMessage,
    triggered_by: actor,
  });

  return {
    item_id: institution.item_id,
    institution_name: institution.institution_name,
    ok: !errorMessage,
    added,
    modified,
    removed,
    error: errorMessage,
  };
}

function mapTxn(
  t: Transaction,
  inst: ConnectedInstitutionRecord
): Omit<BankTransactionSyncedRecord, "_id" | "created_at"> {
  // Plaid sign convention: amount > 0 = money OUT (withdrawal). We invert
  // so that + = money in, − = money out, matching how the rest of the
  // portal stores signed amounts.
  const direction: TxnDirection = t.amount > 0 ? "out" : "in";
  const signed = -t.amount; // flip

  const cat = t.personal_finance_category;
  const description =
    t.merchant_name?.trim() ||
    t.name?.trim() ||
    "(unnamed transaction)";

  return {
    plaid_transaction_id: t.transaction_id,
    account_id: t.account_id,
    item_id: inst.item_id,
    institution_name: inst.institution_name,
    date: t.date,
    posted_date: t.authorized_date ?? t.date,
    amount: signed,
    direction,
    iso_currency_code: t.iso_currency_code ?? "USD",
    description,
    merchant_name: t.merchant_name ?? undefined,
    raw_name: t.name,
    category: cat?.primary ?? (t.category?.[0] ?? undefined),
    detailed_category: cat?.detailed ?? undefined,
    category_path: t.category ?? undefined,
    payment_channel: t.payment_channel ?? undefined,
    payment_method: guessPaymentMethod(t),
    pending: !!t.pending,
    source: "plaid",
    raw_plaid: t,
    recon_status: "unmatched",
  };
}

function guessPaymentMethod(t: Transaction): string | undefined {
  const name = (t.merchant_name ?? t.name ?? "").toLowerCase();
  if (/(stripe|square|paypal)/.test(name)) return "card_processor";
  if (/(zelle)/.test(name)) return "zelle";
  if (/(venmo)/.test(name)) return "venmo";
  if (/(wire|fedwire)/.test(name)) return "wire";
  if (/(ach|direct dep|deposit)/.test(name) && t.payment_channel === "other") return "ach";
  if (t.payment_channel === "in store") return "card";
  if (t.payment_channel === "online") return "card";
  return undefined;
}

function extractPlaidError(e: unknown): { code?: string; message: string } {
  const ax = e as { response?: { data?: { error_code?: string; error_message?: string } }; message?: string };
  if (ax?.response?.data?.error_message) {
    return { code: ax.response.data.error_code, message: ax.response.data.error_message };
  }
  return { message: ax?.message ?? "Plaid error" };
}
