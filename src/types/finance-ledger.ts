// Running-balance ledger for area managers / technicians.
//
// Design: APPEND-ONLY. Each balance movement (report, dispute, refund,
// equipment, misc, settlement, payment, adjustment, …) is its own entry, and
// a ledger's current balance is simply SUM(entry.amount). Corrections are made
// by posting a reversing/adjustment entry — existing entries are never edited.
//
// Sign convention (matches the Balance Reports):
//   negative / red  = the company OWES the person/location
//   positive / green = the person/location OWES the company

// "area_manager" and "technician" are canonical (code depends on them); any
// other string is a predefined or user-created role.
export type LedgerRole = "area_manager" | "technician" | (string & {});

export interface LedgerRecord {
  _id: string;
  holder_name: string;          // person the ledger is for
  role: LedgerRole;             // same person may have one ledger per role
  location: string;            // scope: location / area (e.g. "Minnesota")
  label?: string | null;        // optional display label
  status: "active" | "archived";
  notes?: string | null;
  created_at: string;
  created_by?: string;
}

// `report` is reserved for CRM-auto entries (Phase 2). The rest are manual.
// The trailing `(string & {})` keeps autocomplete for the known types while
// allowing a manually-typed custom type/category on a hand-written entry.
export type LedgerEntryType =
  | "opening_balance"
  | "report"
  | "dispute"
  | "refund"
  | "equipment"
  | "misc"
  | "settlement"
  | "office_charge"
  | "payment"
  | "deduction"
  | "adjustment"
  | "debt"
  | "loan"
  | "advance"
  | "bonus"
  | "commission"
  | "fee"
  | "reimbursement"
  | "credit"
  | (string & {});

// Snapshot of a CRM Balance Report captured as a ledger entry (type "report").
// Mirrors the report's headline numbers (CLOSED jobs only) so the ledger entry
// equals what the Balance Report shows.
export interface LedgerReportMeta {
  mode: "tech" | "location";
  subject_name: string;         // tech name / location passed to the report
  period_start: string;
  period_end: string;
  balance: number;              // Σ balance over closed jobs (excl tips)
  balance_with_tips: number;    // Σ balanceWithTips over closed jobs
  include_tips: boolean;        // which of the two was posted as `amount`
  job_count: number;            // # closed jobs in the report
  profit?: number | null;       // report summary: total profit
  // Location roll-up only: per-technician subtotals that were summed.
  tech_count?: number | null;
  techs?: Array<{
    name: string;
    balance: number;
    balance_with_tips: number;
    job_count: number;
  }>;
  jobs?: Array<{
    id: string;
    date: string;
    address: string;
    tech: string;
    balance: number;
    balance_with_tips: number;
  }>;
}

export interface LedgerEntryRecord {
  _id: string;
  ledger_id: string;
  type: LedgerEntryType;
  date: string;                 // YYYY-MM-DD
  amount: number;               // SIGNED movement posted to the balance
  description?: string | null;

  // CRM Balance Report snapshot (type "report", source "crm"):
  report_meta?: LedgerReportMeta | null;

  // dispute / refund detail (the technician's % is applied — Phase 3):
  job_ref?: string | null;
  technician_id?: string | null;
  gross_amount?: number | null; // full loss before the technician's %
  pct_applied?: number | null;  // snapshot of the tech's % at post time (0–1)

  // corrections (Phase 4): set when this entry reverses another.
  reverses_id?: string | null;

  // payment matched to a real Plaid bank transaction (finance_bank_txn_synced).
  bank_txn_id?: string | null;
  // payment matched to a portal payout (finance_payout).
  payout_id?: string | null;
  // linked to a finance_income entry (the holder paid us; booked as income) OR
  // a finance_expense entry (we paid them; booked as expense). See lib/ledger-link.
  income_id?: string | null;
  expense_id?: string | null;
  // Dispute/refund → AM ledger link + full calculation snapshot. Set by the
  // shared dispute service (lib/dispute-service). dispute_id is the canonical
  // finance_dispute / finance_refund record id — also the dedup key.
  dispute_id?: string | null;
  charge_snapshot?: Record<string, unknown> | null;

  // Equipment order → AM ledger link. equipment_order_id is the canonical
  // EquipmentOrder._id and the dedup key (one ledger entry per order, enforced
  // by a partial-unique index). equipment_return_id links a credit reversal to
  // its EquipmentReturn (Phase B). See lib/equipment/ledger.
  equipment_order_id?: string | null;
  equipment_return_id?: string | null;

  source: "manual" | "crm" | "imported";
  created_at: string;
  created_by?: string;
  // Set when a MANUAL entry is edited in place (system entries stay append-only).
  updated_at?: string;
  updated_by?: string;
}

// Per-technician dispute/refund rate. The default rate is the CRM
// Technician.profitPercent; this override exists for special agreements that
// differ from the profit share. _id = technician name (matches CRM Technician._id).
export interface TechnicianRateRecord {
  _id: string;
  dispute_pct: number;          // percentage 0–100
  note?: string | null;
  updated_at: string;
  updated_by?: string;
}

// Merged view used by the rates UI and the dispute/refund picker.
export interface TechRateView {
  name: string;
  location: string | null;
  profit_pct: number;           // CRM Technician.profitPercent
  override_pct: number | null;  // finance override, if any
  effective_pct: number;        // override ?? profit
  note: string | null;
}

export const MANUAL_LEDGER_ENTRY_TYPES: LedgerEntryType[] = [
  "opening_balance",
  "dispute",
  "refund",
  "equipment",
  "debt",
  "loan",
  "advance",
  "bonus",
  "commission",
  "fee",
  "reimbursement",
  "credit",
  "misc",
  "settlement",
  "office_charge",
  "payment",
  "deduction",
  "adjustment",
];
