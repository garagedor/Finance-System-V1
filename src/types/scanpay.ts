// ScanPay disputes integration types.
//
// Raw shape observed from GET https://api.scanpay.tech/connect/v1/disputes
// (response is { data: ScanpayDisputeRaw[], meta: {...} }). Amounts arrive as
// strings ("1344.00"); dates as mixed ISO / "03 July 2026" strings.

export interface ScanpayDisputeRaw {
  disputeId: string;
  transactionId: string;
  invoiceNumber: string;
  status: string;            // "Lost", "Won", "Needs Response", "Under Review", "Accepted", ...
  statusDetail: string;
  reason: string;            // "General", "Duplicate", "Fraudulent", ...
  amount: string;            // "1344.00"
  currency: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  paymentMethod: string;
  paymentMethodDetail: string;
  collectedBy: string;
  createdBy: string;
  technicians: string[];
  jobId: string;             // ScanPay's own job id ("JOB-17461") — NOT the CRM _id
  jobTitle: string;
  serviceAddress: string;
  invoiceCreatedAt: string;  // "2026-07-03"
  paymentDate: string;       // "03 July 2026"
  disputedDate: string;      // ISO w/ tz
  respondBy: string;
  resultDate: string;        // ISO when resolved, else ""
  updatedAt: string;
  teamId: number;
  teamName: string;
  dueIn: string;
  merchantResponse: string;
  challengedOn: string;
}

export type ScanpayOutcome = "won" | "lost" | "pending";
export type ScanpayMatchStatus = "new" | "matched" | "verified" | "posted" | "ignored";
export type ScanpayMatchMethod = "invoice" | "fallback" | "manual";

export interface ScanpayJobCandidate {
  jobId: string;             // CRM Job _id
  score: number;             // 0..100 confidence
  method: ScanpayMatchMethod;
  reason: string;            // human-readable why (e.g. "invoice exact", "addr+amount+tech")
  address?: string | null;
  date?: string | null;
  totalAmount?: number | null;
  tech?: string | null;
}

// The stored inbox document (finance_scanpay_dispute). _id === disputeId.
export interface ScanpayDisputeRecord {
  _id: string;               // == disputeId (dedup key)
  disputeId: string;
  transactionId: string;
  invoiceNumber: string;
  amount: number;            // parsed from raw.amount
  currency: string;
  reason: string;
  statusRaw: string;         // ScanPay's status verbatim
  outcome: ScanpayOutcome;   // normalized: won / lost / pending
  customerName: string;
  customerPhone: string;
  serviceAddress: string;
  technicians: string[];
  scanpayJobId: string;
  teamId?: number | null;
  teamName?: string | null;
  disputedAt: string | null;   // ISO — the FILED date (drives dashboard loss month)
  resolvedAt: string | null;   // ISO — the resolution date (drives recovery month)
  paymentDate: string | null;  // original job payment date

  // Matching
  matchStatus: ScanpayMatchStatus;
  matchedJobId: string | null;
  matchMethod: ScanpayMatchMethod | null;
  matchScore: number | null;
  candidates: ScanpayJobCandidate[];

  // Posting (once confirmed → the shared engine)
  postedRecordId: string | null;   // finance_dispute _id
  ledgerEntryId: string | null;

  // Engine-computed loss allocation (dry-run at sync time, for the matched job).
  // null when unmatched or the engine can't resolve it (see computeError).
  computedShare?: ScanpayComputedShare | null;
  computeError?: string | null;

  // Charge tracking: when set, we've charged the parties their slices for this
  // dispute (manual mark, independent of ledger posting). null = still to charge.
  chargedAt?: string | null;
  chargedBy?: string | null;

  raw: ScanpayDisputeRaw;
  synced_at: string;
  updated_at: string;
}

export interface ScanpayComputedShare {
  providerCharge: number;
  technicianPortion: number;
  areaManagerOwnPortion: number;
  companyCharge: number;
  amLedgerCharge: number;
  partsLoss: number;
  // Captured from the actual CRM job at verify/sync time.
  jobCollected?: number;   // job total collected (job amount + gross tip)
  jobAmount?: number;      // job amount, excl. tip
  grossTip?: number;       // gross tip
}

// ── Refunds ─────────────────────────────────────────────────────────────────
// Source: GET /connect/v1/payments?status=REFUNDED. ScanPay's API does NOT
// expose the refunded amount or refund date — only that the payment was
// refunded — so those are entered by a human at confirm time.

export interface ScanpayRefundRaw {
  id: string;              // payment id "SP..."
  invoiceId: string;
  invoiceNumber: string;   // join key → CRM Job.invoiceNumber
  amount: string;          // ORIGINAL payment amount (not the refunded amount)
  billAmount: string;
  payableAmount: string;
  serviceFee: string;
  tipAmount: string;
  createdAt: string;       // payment date (NOT the refund date)
  paymentMethod: string;
  status: string;
}

export interface ScanpayRefundRecord {
  _id: string;             // == payment id (dedup key)
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  originalAmount: number;      // what the customer originally paid
  paymentDate: string | null;  // createdAt
  paymentMethod: string;

  // Human-entered at confirm (API can't give these):
  refundAmount: number | null;
  refundDate: string | null;

  // Matching
  matchStatus: ScanpayMatchStatus;
  matchedJobId: string | null;
  matchMethod: ScanpayMatchMethod | null;
  matchScore: number | null;
  candidates: ScanpayJobCandidate[];

  // Posting (shared engine, type "refund")
  postedRecordId: string | null;   // finance_refund _id
  ledgerEntryId: string | null;

  // Engine-computed loss allocation (dry-run; based on the original payment
  // amount at sync, refined to the actual refunded amount on confirm).
  computedShare?: ScanpayComputedShare | null;
  computeError?: string | null;

  // Charge tracking — parties charged their slices for this refund (manual).
  chargedAt?: string | null;
  chargedBy?: string | null;

  raw: ScanpayRefundRaw;
  synced_at: string;
  updated_at: string;
}
