// Area Manager profile + settlement payment records.
//
// One AreaManager owns one or more CRM Location ids. Settlement balance for
// each AM is computed live from Jobs (sum across owned locations of "company
// owes LM" minus "LM owes company") minus any recorded payments.

export type AreaManager = {
  _id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  locationIds: string[];
  // W9 metadata (file lives in Supabase Storage; `w9StoragePath` is the
  // object key inside the bucket).
  w9StoragePath?: string | null;
  w9FileName?: string | null;
  w9MimeType?: string | null;
  w9UploadedAt?: string | null;
  w9UploadedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type PaymentDirection = 'company_to_am' | 'am_to_company';

export type AreaManagerPayment = {
  _id?: string;
  areaManagerId: string;
  date: string;       // YYYY-MM-DD
  amount: number;     // always positive; direction encodes the sign
  direction: PaymentDirection;
  method: string;     // 'cash' | 'check' | 'transfer' | 'other'
  note?: string | null;
  recordedBy?: string | null; // user._id
  createdAt?: string;
};

export type AreaManagerBalance = {
  /** Sum across all owned locations of (manager-% × closed-job profit + lmParts). */
  companyOwesAm: number;
  /** Sum across all owned locations of (lmCash + lmCheck). */
  amOwesCompany: number;
  /** Net flow of recorded payments: company→AM totals minus AM→company. */
  netPaid: number;
  /** Final open balance: (companyOwesAm − amOwesCompany) − netPaid.
   *  Positive = company still owes the AM. Negative = AM still owes company. */
  openBalance: number;
};
