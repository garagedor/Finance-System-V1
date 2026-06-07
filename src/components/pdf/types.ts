// Shape the PDF route hands to either template. Mirrors the row shape from
// /api/balance-report exactly, so the API layer can pass through what it
// already fetches without re-mapping.
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

export type PdfReportData = {
    mode: 'tech' | 'location';
    subject: string;              // technician id or location id
    startDate: string;
    endDate: string;
    appliedPct: number;
    rows: PdfRow[];               // closed jobs only
    totals: PdfTotals;
    generatedAt: string;          // ISO timestamp for display
};
