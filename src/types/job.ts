export type JobRow = {
    _id?: string;
    tech?: string
    status?: string;
    date?: string;
    /** Normalized real Date derived from `date` (additive; legacy `date` preserved).
     *  Maintained on write; indexed for fast date-range queries. */
    jobDateNormalized?: Date | null;
    /** Canonical form of `status` (trimmed + de-typo'd; additive, legacy `status`
     *  preserved). Maintained on write; reports still read `status` for now. */
    statusCanonical?: string;
    address?: string;
    location?: string;
    totalAmount?: number;
    techPaidCash?: number;
    totalPaidCard?: number;
    totalPaidCompanyCheck?: number;
    totalPaidFinance?: number;
    totalPaidCompanyCash?: number;
    techParts?: number;
    companyParts?: number;
    lmParts?: number;
    lmCash?: number;
    lmCheck?: number;
    provider?: string;
    tipsCard?: number;
    tipsFinance?: number;
    tipsCompanyCash?: number;
    tipsCheck?: number;
    clientName?: string;
    clientPhoneNumber?: string;
    approvals?: string[];
    notes?: string;
    needTracking?: boolean;
};

export type Location = {
    _id: string;
    managerProfitPercent: number;
    /** @deprecated legacy "default tech" field — NOT the area manager. Do not
     *  use for AM resolution; use areaManagerName (explicit assignment). */
    technician: string;
    /** Explicit Area Manager assignment: the person whose ledger a dispute/
     *  refund charge for this location posts to. Set on the Area Managers page. */
    areaManagerName?: string;
    areaManagerId?: string;
};

export type Technician = {
    _id: string;
    profitPercent: number;
    location: string;
};

export type Provider = {
    _id: string;
    initials: string;
    profitPercent: number;
};

export type JobStatus = {
    _id: string;
};

/** Subset of the CRM Job fields surfaced inline on dispute / refund rows. */
export type LinkedJob = {
    address?: string;
    date?: string;
    location?: string;
    provider?: string;
    tech?: string;
    status?: string;
    totalAmount?: number;
};

/** Server-injected synthetic fields used by the CRM dispute/refund tables.
 *  These are NOT persisted to MongoDB — they're stripped on PUT. */
export type LinkedJobFlat = {
    jobAddress?: string;
    jobDate?: string;
    jobLocation?: string;
    jobLocationManager?: string;     // derived from location; "—" today (no mapping)
    jobProvider?: string;
    jobTech?: string;                // CRM short name (e.g. "Adar")
    jobTechFullName?: string;        // resolved via TechNameMapping
    jobCustomerName?: string;        // not tracked in DB → "—"
    jobPhoneNumber?: string;         // not tracked in DB → "—"
    jobStatus?: string;
    jobTotalAmount?: number;
    jobTipsTotal?: number;
    jobPartsTotal?: number;
    jobTotalInclTip?: number;        // totalAmount + tips
};

/** Field names of LinkedJobFlat. The nested `job` object is purely
 *  synthetic — it's recomputed every GET and stripped on every PUT. The
 *  flat fields ARE persisted on the Dispute / Refund row so users can
 *  override the Job-derived defaults per record. */
export const STRIPPED_SYNTHETIC_FIELDS = ['job'] as const;
export const FLAT_JOB_FIELDS = [
    'jobAddress',
    'jobDate',
    'jobLocation',
    'jobLocationManager',
    'jobProvider',
    'jobTech',
    'jobTechFullName',
    'jobCustomerName',
    'jobPhoneNumber',
    'jobStatus',
    'jobTotalAmount',
    'jobTipsTotal',
    'jobPartsTotal',
    'jobTotalInclTip',
] as const;
/** @deprecated use STRIPPED_SYNTHETIC_FIELDS or FLAT_JOB_FIELDS. */
export const LINKED_JOB_FIELDS = STRIPPED_SYNTHETIC_FIELDS;

export type Dispute = {
    _id?: string;
    jobId: string;
    totalDisputed: number;
    disputeDate: string;
    dueDate: string;
    status: string;
    isTechOffset: boolean;
    isPrOffset: boolean;
    /** New dispute-specific fields aligned with the operations spreadsheet. */
    dateLost?: string;        // ISO date the dispute was ruled lost (or settled)
    messageFound?: string;    // free-text — the message / proof / context found
    isDeposit?: boolean;      // does the dispute relate to a deposit?
    /** Server-injected on GET — read-only mirror of CRM Job fields. */
    job?: LinkedJob;
} & LinkedJobFlat;

export type Refund = {
    _id?: string;
    jobId: string;
    refundTotal: number;
    dateRefunded: string;
    dueDate: string;
    reason: string;
    isTechOffset: boolean;
    isPrOffset: boolean;
    /** Server-injected on GET — read-only mirror of CRM Job fields. */
    job?: LinkedJob;
} & LinkedJobFlat;

// export type Adjustment = {
//     _id?: string;
//     dueDate: string;
//     date: string;
//     reasonId: string;
//     total: number;
//     isCompanyMoney: boolean;
// };

// export type AdjustmentReason = {
//     _id?: string;
//     reason: string;
// };
