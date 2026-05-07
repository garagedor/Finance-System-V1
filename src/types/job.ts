export type JobRow = {
    _id?: string;
    tech?: string
    status?: string;
    date?: string;
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
    technician: string;
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

export type Dispute = {
    _id?: string;
    jobId: string;
    totalDisputed: number;
    disputeDate: string;
    dueDate: string;
    status: string;
    isTechOffset: boolean;
    isPrOffset: boolean;
};

export type Refund = {
    _id?: string;
    jobId: string;
    refundTotal: number;
    dateRefunded: string;
    dueDate: string;
    reason: string;
    isTechOffset: boolean;
    isPrOffset: boolean;
};

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
