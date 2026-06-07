// Shape the PDF route hands to either template. Mirrors the row shape from
// /api/balance-report and adds report-level stats (KPIs + status pie) so the
// PDF can present the full report experience, not just the job table.

export type PdfRow = {
    id: string;
    date: string;
    address: string;
    tech: string;
    location: string;
    status: string;
    paymentMethod: string;
    paidSum: number;
    techParts: number;
    companyParts: number;
    lmParts: number;
    lmCash: number;
    lmCheck: number;
    paymentFee: number;
    totalProfit: number;
    shareAmount: number;
    techPaidCash: number;
    tipsTotal: number;
    balance: number;
    balanceWithTips: number;
    approvals: Array<{ name: string; role: string }>;
};

// Per-Closed-job aggregates that feed the table totals row and the
// "Closed Jobs" summary cards.
export type PdfTotals = {
    rowCount: number;
    paidSum: number;
    techParts: number;
    companyParts: number;
    lmParts: number;
    lmCash: number;
    lmCheck: number;
    paymentFee: number;
    totalProfit: number;
    shareAmount: number;
    techPaidCash: number;
    tipsTotal: number;
    balance: number;
    balanceWithTips: number;
};

// Report-wide stats computed across EVERY job in range (not just Closed)
// — mirror the dashboard's `totals` block + status pie.
export type PdfReportStats = {
    assignedJobs: number;       // all jobs in range
    jobProfit: number;          // Σ totalProfit across non-X-close jobs
    avgTicket: number;          // jobProfit / assignedJobs
    avgClosedJob: number;       // mean totalProfit for status='Closed' jobs
    statusStats: Array<{ key: string; count: number }>;
};

export type PdfReportData = {
    mode: 'tech' | 'location';
    subject: string;
    startDate: string;
    endDate: string;
    appliedPct: number;
    rows: PdfRow[];             // Closed jobs only — feed the table
    totals: PdfTotals;          // Closed-job aggregates
    stats: PdfReportStats;      // Range-wide stats
    generatedAt: string;
    /** Data-URL of the company logo (public/lbs-logo.png) if present. */
    logoSrc?: string | null;
};
