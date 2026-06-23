// Plaid integration types — read-only banking visibility.
//
// IMPORTANT: this platform never initiates transfers, payments, or ACH.
// Only `transactions` + `auth` (for balances) products are requested.

export type PlaidEnv = "sandbox" | "development" | "production";

export type ConnectionStatus =
  | "active"          // healthy, syncing
  | "needs_login"     // ITEM_LOGIN_REQUIRED — user must reauth via Link
  | "error"           // some other Plaid error
  | "disconnected";   // user manually removed

export interface ConnectedInstitutionRecord {
  _id: string;
  item_id: string;                // Plaid item_id (stable)
  institution_id?: string;        // Plaid institution_id (e.g. ins_109508)
  institution_name?: string;      // e.g. "Chase"
  institution_logo?: string;      // base64 PNG from Plaid
  institution_primary_color?: string;
  access_token_enc: string;       // encrypted via portal-crypto.encrypt
  cursor?: string;                // /transactions/sync cursor
  available_products?: string[];
  billed_products?: string[];
  webhook_url?: string;
  status: ConnectionStatus;
  status_message?: string;
  last_sync_at?: string;
  last_balance_refresh_at?: string;
  connected_at: string;
  connected_by?: string;          // user name
}

export type BankAccountSubtype =
  | "checking" | "savings" | "money_market" | "cd"
  | "credit_card" | "paypal" | "depository" | "investment" | "loan" | "other";

export interface BankAccountSyncedRecord {
  _id: string;
  item_id: string;                // back-ref to ConnectedInstitution.item_id
  account_id: string;             // Plaid account_id (stable)
  name: string;                   // bank's own name for the account
  official_name?: string;
  mask?: string;                  // last 4 digits
  type?: string;                  // depository / credit / loan / etc
  subtype?: BankAccountSubtype;
  current_balance?: number;
  available_balance?: number;
  limit?: number;                 // credit limit if applicable
  iso_currency_code?: string;     // USD
  institution_name?: string;
  status: ConnectionStatus;
  last_balance_at?: string;
  active: boolean;
  notes?: string;
  created_at: string;
}

export type TxnDirection = "in" | "out";
export type ReconStatus = "unmatched" | "matched" | "ignored" | "pending_review";

export interface BankTransactionSyncedRecord {
  _id: string;                            // local: btx_<hash>
  plaid_transaction_id: string;           // unique by Plaid
  account_id: string;                     // Plaid account_id
  item_id: string;
  institution_name?: string;
  date: string;                           // authorized_date or date (YYYY-MM-DD)
  posted_date?: string;
  amount: number;                         // signed: + = money in, − = money out (we flip Plaid's convention)
  direction: TxnDirection;
  iso_currency_code?: string;
  description: string;                    // best of: merchant_name → name
  merchant_name?: string;
  raw_name?: string;
  category?: string;                      // simple top-category text
  detailed_category?: string;
  category_path?: string[];               // Plaid personal_finance_category hierarchy
  payment_channel?: string;               // "online" | "in store" | "other"
  payment_method?: string;                // best guess: ach / wire / zelle / check / card / cash / other
  pending: boolean;
  source: "plaid";                        // distinguishes from manual entries
  raw_plaid?: unknown;                    // full Plaid payload for audit
  // Reconciliation
  recon_status: ReconStatus;
  matched_kind?: "expense" | "payout" | "settlement" | "income" | "job" | "manual";
  matched_id?: string;                    // local record id
  match_confidence?: number;              // 0..1, if auto-suggested
  matched_at?: string;
  matched_by?: string;
  ignore_reason?: string;
  ignored_at?: string;
  ignored_by?: string;
  notes?: string;
  created_at: string;
  updated_at?: string;
}

export interface BankSyncLogRecord {
  _id: string;
  item_id: string;
  kind: "transactions_sync" | "balance_refresh" | "initial_import" | "manual";
  started_at: string;
  finished_at?: string;
  ok: boolean;
  added: number;
  modified: number;
  removed: number;
  cursor_before?: string;
  cursor_after?: string;
  error_code?: string;
  error_message?: string;
  triggered_by?: string;
}

export interface ReconciliationMatchRecord {
  _id: string;
  bank_txn_id: string;            // local _id of BankTransactionSyncedRecord
  matched_kind: "expense" | "payout" | "settlement" | "income" | "job" | "manual";
  matched_id: string;
  matched_label?: string;         // snapshot of what was matched (helps audit)
  amount: number;
  confidence: number;             // 0..1
  matched_at: string;
  matched_by?: string;
  notes?: string;
}
