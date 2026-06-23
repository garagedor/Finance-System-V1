// MongoDB helper for the Finance Portal.
//
// New finance-specific collections live in the same `ag` database alongside
// the existing CRM collections. Collection names use a `finance_*` prefix
// to make the namespace obvious and avoid colliding with future CRM tables.
//
// `coll(name)` is SYNCHRONOUS — call `ensureFinanceIndexes()` at the top of
// any server function that hits the DB and the cached client is established.

import { MongoClient, type Db, type Collection, type Document } from "mongodb";

const MONGODB_URI =
  process.env.MONGODB_URI ??
  "mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net";
const DB_NAME = process.env.MONGODB_DB ?? "ag";

let _client: MongoClient | null = null;
let _db: Db | null = null;
let _connecting: Promise<void> | null = null;
let _lastConnectError: { message: string; code?: string; at: number } | null = null;

async function connect(): Promise<void> {
  if (_db) return;
  if (_connecting) return _connecting;
  _connecting = (async () => {
    try {
      const client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
        // Re-use the same socket pool the rest of the CRM uses.
        maxPoolSize: 20,
      });
      await client.connect();
      _client = client;
      _db = client.db(DB_NAME);
      _lastConnectError = null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string })?.code;
      _lastConnectError = { message: msg, code, at: Date.now() };
      _connecting = null; // allow retry on next call
      throw e;
    }
  })();
  return _connecting;
}

export async function getDb(): Promise<Db> {
  await connect();
  return _db!;
}

export function getDbConnectError(): { message: string; code?: string; at: number } | null {
  return _lastConnectError;
}

/**
 * Try to run a DB operation; if connection fails, return null instead of
 * throwing. Use this in server components that want to render a friendly
 * "DB unreachable" card instead of crashing the page.
 */
export async function tryDb<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    await connect();
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[finance-db] operation failed:", msg);
    return null;
  }
}

// ── Collection accessors ───────────────────────────────────────────────────

export const FINANCE_COLLECTIONS = {
  income:           "finance_income",
  expense:          "finance_expense",
  payout:           "finance_payout",
  payoutProfile:    "finance_payout_profile",
  debt:             "finance_debt",
  dispute:          "finance_dispute",
  refund:           "finance_refund",
  equipment:        "finance_equipment",
  bankAccount:      "finance_bank_account",       // manual bank accounts
  bankTxn:          "finance_bank_txn",            // manual bank transactions
  settlement:       "finance_settlement",
  followUpComm:     "finance_followup_commission",
  report:           "finance_saved_report",
  position:         "finance_position",
  recurringExpense: "finance_recurring_expense",
  // ─── Plaid integration (read-only) ───
  plaidInstitution: "finance_plaid_institution",  // connected institutions (encrypted access_token)
  bankAccountSynced:"finance_bank_account_synced",// accounts synced from Plaid
  bankTxnSynced:    "finance_bank_txn_synced",    // transactions synced from Plaid
  bankSyncLog:      "finance_bank_sync_log",      // sync activity audit
  reconMatch:       "finance_recon_match",        // confirmed reconciliation matches
  // ─── Area-manager / technician running-balance ledger ───
  ledger:           "finance_ledger",              // ledger holders (person+role+location)
  ledgerEntry:      "finance_ledger_entry",        // append-only balance movements
  techRate:         "finance_technician_rate",     // per-tech dispute/refund % override
  // ─── RBAC + audit ───
  role:             "finance_role",                // role definitions
  auditLog:         "finance_audit",               // unified audit log (replaces finance_role_audit)
  /** @deprecated old name — keep so legacy code compiles. Points at the same collection. */
  roleAudit:        "finance_audit",
} as const;

/** Synchronous collection accessor. Requires `ensureFinanceIndexes()` (or any
 *  prior `await getDb()` call) to have established the connection. */
export function coll<T extends Document = Document>(
  name: (typeof FINANCE_COLLECTIONS)[keyof typeof FINANCE_COLLECTIONS]
): Collection<T> {
  if (!_db) {
    throw new Error(
      `Finance DB not initialized — call ensureFinanceIndexes() before coll() at the top of your server function.`
    );
  }
  return _db.collection<T>(name);
}

// ── Indexes (run-once, idempotent) ─────────────────────────────────────────

let _indexesEnsured = false;

export async function ensureFinanceIndexes(): Promise<void> {
  await connect();
  if (_indexesEnsured) return;
  const db = _db!;
  await Promise.all([
    db.collection(FINANCE_COLLECTIONS.income).createIndex({ date: -1 }),
    db.collection(FINANCE_COLLECTIONS.income).createIndex({ source: 1, date: -1 }),
    db.collection(FINANCE_COLLECTIONS.expense).createIndex({ date: -1 }),
    db.collection(FINANCE_COLLECTIONS.expense).createIndex({ category: 1, date: -1 }),
    db.collection(FINANCE_COLLECTIONS.expense).createIndex({ status: 1 }),
    db.collection(FINANCE_COLLECTIONS.payout).createIndex({ recipient_id: 1, period_end: -1 }),
    db.collection(FINANCE_COLLECTIONS.payout).createIndex({ status: 1 }),
    db.collection(FINANCE_COLLECTIONS.debt).createIndex({ from_party_id: 1 }),
    db.collection(FINANCE_COLLECTIONS.debt).createIndex({ to_party_id: 1 }),
    db.collection(FINANCE_COLLECTIONS.debt).createIndex({ status: 1 }),
    db.collection(FINANCE_COLLECTIONS.dispute).createIndex({ date: -1 }),
    db.collection(FINANCE_COLLECTIONS.dispute).createIndex({ job_id: 1 }),
    db.collection(FINANCE_COLLECTIONS.refund).createIndex({ date: -1 }),
    db.collection(FINANCE_COLLECTIONS.equipment).createIndex({ date: -1 }),
    db.collection(FINANCE_COLLECTIONS.bankTxn).createIndex({ posted_date: -1 }),
    db.collection(FINANCE_COLLECTIONS.settlement).createIndex({ settled_at: -1 }),
    db.collection(FINANCE_COLLECTIONS.followUpComm).createIndex({ job_id: 1 }),
    db.collection(FINANCE_COLLECTIONS.followUpComm).createIndex({ recipient_id: 1 }),
    db.collection(FINANCE_COLLECTIONS.recurringExpense).createIndex({ active: 1, next_due_date: 1 }),
    db.collection(FINANCE_COLLECTIONS.expense).createIndex({ recurring_id: 1 }, { sparse: true }),
    // Plaid
    db.collection(FINANCE_COLLECTIONS.plaidInstitution).createIndex({ item_id: 1 }, { unique: true }),
    db.collection(FINANCE_COLLECTIONS.plaidInstitution).createIndex({ status: 1 }),
    db.collection(FINANCE_COLLECTIONS.bankAccountSynced).createIndex({ account_id: 1 }, { unique: true }),
    db.collection(FINANCE_COLLECTIONS.bankAccountSynced).createIndex({ item_id: 1 }),
    db.collection(FINANCE_COLLECTIONS.bankTxnSynced).createIndex({ plaid_transaction_id: 1 }, { unique: true }),
    db.collection(FINANCE_COLLECTIONS.bankTxnSynced).createIndex({ date: -1 }),
    db.collection(FINANCE_COLLECTIONS.bankTxnSynced).createIndex({ account_id: 1, date: -1 }),
    db.collection(FINANCE_COLLECTIONS.bankTxnSynced).createIndex({ recon_status: 1, date: -1 }),
    db.collection(FINANCE_COLLECTIONS.bankSyncLog).createIndex({ item_id: 1, started_at: -1 }),
    db.collection(FINANCE_COLLECTIONS.reconMatch).createIndex({ bank_txn_id: 1 }),
    db.collection(FINANCE_COLLECTIONS.reconMatch).createIndex({ matched_kind: 1, matched_id: 1 }),
    // Ledger
    db.collection(FINANCE_COLLECTIONS.ledger).createIndex({ role: 1, location: 1 }),
    db.collection(FINANCE_COLLECTIONS.ledger).createIndex({ holder_name: 1 }),
    db.collection(FINANCE_COLLECTIONS.ledgerEntry).createIndex({ ledger_id: 1, date: 1, _id: 1 }),
    db.collection(FINANCE_COLLECTIONS.ledgerEntry).createIndex({ ledger_id: 1, created_at: 1 }),
    // RBAC
    db.collection(FINANCE_COLLECTIONS.role).createIndex({ key: 1 }, { unique: true, sparse: true }),
    db.collection(FINANCE_COLLECTIONS.role).createIndex({ name: 1 }, { unique: true }),
    db.collection(FINANCE_COLLECTIONS.auditLog).createIndex({ target_kind: 1, target_id: 1, changed_at: -1 }),
    db.collection(FINANCE_COLLECTIONS.auditLog).createIndex({ changed_at: -1 }),
    db.collection(FINANCE_COLLECTIONS.auditLog).createIndex({ changed_by: 1, changed_at: -1 }),
  ]);
  _indexesEnsured = true;
}

/** Generate a short prefixed ID (e.g. inc_xxxx) — independent of Mongo's ObjectId. */
export function newId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${random}`;
}
