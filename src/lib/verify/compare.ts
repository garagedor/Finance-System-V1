// Pure pairing + diff logic between Supabase weekly_report_jobs and CRM Jobs.
// No I/O — fully testable. Tolerance is $1 per the spec.

import { normString } from './mapping';

const TOLERANCE_USD = 1;

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type SupabaseReportJob = {
  id: string;
  job_date: string;
  customer_name: string | null;
  address: string | null;
  total_job: number;
  card_amount: number;
  cash_amount: number;
  tech_cash: number;
  company_cash: number;
  tip_amount: number;
  my_parts: number;
  company_parts: number;
  payment_type?: string | null;
  // Optional writable input fields — present when the API selects '*' (used by the edit form).
  notes?: string | null;
  tech_paid_cash?: number;
  paid_card?: number;
  paid_company_cash?: number;
  paid_company_check?: number;
  paid_finance?: number;
  tech_parts?: number;
  tips_card?: number;
  tips_finance?: number;
  tips_company_cash?: number;
  tips_check?: number;
  commission_rate?: number;
  // LM extension — mirror of the CRM's lmCash/lmCheck/lmParts (added on the
  // Lovable side 2026-05-18). Null on legacy rows; the API coerces to 0.
  lm_cash?: number;
  lm_check?: number;
  lm_parts?: number;
};

export type CrmJob = {
  _id: string;
  date?: string;
  clientName?: string;
  address?: string;
  totalAmount?: number;
  totalPaidCard?: number;
  techPaidCash?: number;
  totalPaidCompanyCash?: number;
  tipsCard?: number;
  tipsFinance?: number;
  tipsCompanyCash?: number;
  tipsCheck?: number;
  techParts?: number;
  companyParts?: number;
  // CRM-only fields surfaced as informational extras (no Supabase equivalent):
  totalPaidCompanyCheck?: number;
  totalPaidFinance?: number;
  lmCash?: number;
  lmCheck?: number;
  lmParts?: number;
  // Computed (set by the API before compare runs).
  paymentType?: string | null;
};

export type FieldDiff = {
  field: string;
  label: string;
  supabase: number;
  crm: number;
  diff: number;            // crm − supabase
  exceedsTolerance: boolean;
};

export type MethodDiff = {
  supabase: string | null;
  crm: string | null;
};

export type Pair = {
  status: 'match' | 'mismatch' | 'missing-in-crm' | 'missing-in-report';
  supabaseJob: SupabaseReportJob | null;
  crmJob: CrmJob | null;
  diffs: FieldDiff[];           // only fields where exceedsTolerance OR for completeness
  methodDiff?: MethodDiff | null; // set when supabase.payment_type !== derived CRM method
  manualLink?: boolean;         // true when the pair came from an admin override
};

export type ComparisonTotals = {
  supabase: {
    totalJob: number;
    cardAmount: number;
    techCash: number;
    companyCash: number;
    tips: number;
    myParts: number;
    companyParts: number;
    lmCash: number;
    lmCheck: number;
    lmParts: number;
  };
  crm: {
    totalAmount: number;
    totalPaidCard: number;
    techPaidCash: number;
    totalPaidCompanyCash: number;
    tipsTotal: number;
    techParts: number;
    companyParts: number;
    lmCash: number;
    lmCheck: number;
    lmParts: number;
    // CRM-only extras — no Supabase column to diff against.
    totalPaidCompanyCheck: number;
    totalPaidFinance: number;
  };
  diffs: {
    totalJob: number;
    card: number;
    techCash: number;
    companyCash: number;
    tips: number;
    myParts: number;
    companyParts: number;
    lmCash: number;
    lmCheck: number;
    lmParts: number;
  };
};

export type ComparisonResult = {
  pairs: Pair[];
  summary: {
    matched: number;
    mismatched: number;
    missingInCrm: number;
    missingInReport: number;
    supabaseJobCount: number;
    crmJobCount: number;
  };
  totals: ComparisonTotals;
};

// Compare gross-of-fee tips on both sides. Lovable's `tip_amount` mirror is
// auto-computed net of fees by a DB trigger ($156.27 reported → $148.46
// stored), so we sum the per-method tip columns instead — those hold the raw
// amount the tech entered. CRM stores per-method tips raw too.
const tipsTotalCrm = (j: CrmJob) =>
  toNum(j.tipsCard) + toNum(j.tipsFinance) + toNum(j.tipsCompanyCash) + toNum(j.tipsCheck);

const tipsTotalLovable = (s: SupabaseReportJob) =>
  toNum(s.tips_card) + toNum(s.tips_finance) + toNum(s.tips_company_cash) + toNum(s.tips_check);

// Derive the dominant payment method on a CRM job. Returns null if no payment
// fields are populated, the single method's name if only one is non-zero,
// "A + B" if exactly two are non-zero, or "Mixed" for three or more.
export function deriveCrmMethod(c: CrmJob | null | undefined): string | null {
  if (!c) return null;
  const buckets: Array<[string, number]> = [
    ['Card', toNum(c.totalPaidCard)],
    ['Cash', toNum(c.techPaidCash)],
    ['Company Cash', toNum(c.totalPaidCompanyCash)],
    ['Check', toNum(c.totalPaidCompanyCheck)],
    ['Finance', toNum(c.totalPaidFinance)],
    ['LM Cash', toNum(c.lmCash)],
    ['LM Check', toNum(c.lmCheck)],
  ];
  const nonZero = buckets.filter(([, v]) => v > 0);
  if (nonZero.length === 0) return null;
  if (nonZero.length === 1) return nonZero[0][0];
  nonZero.sort((a, b) => b[1] - a[1]);
  return nonZero.length === 2 ? `${nonZero[0][0]} + ${nonZero[1][0]}` : 'Mixed';
}

// Normalize a method label for case/punctuation-tolerant comparison.
// Folds:
//   - "Co." ↔ "Company"
//   - any multi-method label ("Split", "Mixed", "Card + Cash", "Cash + Card",
//     etc.) → "split", because Lovable uses "Split" whenever 2+ methods are
//     used while the CRM-derived label spells out the components.
const normMethod = (s: string | null | undefined): string => {
  if (!s) return '';
  const v = s
    .toLowerCase()
    .replace(/\bco\.?\s*/g, 'company ')
    .trim();
  if (v === 'split' || v === 'mixed' || v.includes('+')) return 'split';
  return v.replace(/[^a-z0-9]/g, '');
};

const dateOnly = (s: string | undefined | null) => (s ? s.slice(0, 10) : '');

// Address normalization + matching. The CRM and the Lovable app store
// addresses with wildly different formatting, e.g.:
//   "924 lake george dr hobart in 46342"   (Supabase, no comma, city+zip mashed in)
//   "924 Lake George DrHobart, IN 46342"   (CRM, comma between street and city)
//   "(1) 1383 Essex Dr , Porter, IL"        (CRM, "(N)" prefix)
//   "2S732 Crimson King Ln, Wheaton IL"     (CRM, city suffix)
//
// Strategy:
//   1) Normalize: split on first comma to drop city/state, strip "(N)" prefix,
//      lowercase, keep only [a-z0-9].
//   2) Match: equal OR one is a prefix of the other (so a street-only form
//      matches a "street + city + zip" form when one side has no comma).
const normAddress = (s: string | null | undefined): string => {
  if (!s) return '';
  let street = (s.split(',')[0] || '').toLowerCase();
  street = street.replace(/^\s*\(\d+\)\s*/, ''); // drop "(1) " sequence prefix
  return street.replace(/[^a-z0-9]/g, '');
};

const MIN_ADDR_LEN = 6;
const addrMatches = (a: string, b: string): boolean => {
  if (!a || !b || a.length < MIN_ADDR_LEN || b.length < MIN_ADDR_LEN) return false;
  if (a === b) return true;
  return a.startsWith(b) || b.startsWith(a);
};

function diffOne(label: string, field: string, sup: number, crm: number): FieldDiff {
  const diff = round2(crm - sup);
  return {
    field,
    label,
    supabase: round2(sup),
    crm: round2(crm),
    diff,
    exceedsTolerance: Math.abs(diff) > TOLERANCE_USD,
  };
}

function buildPairDiffs(s: SupabaseReportJob, c: CrmJob): FieldDiff[] {
  return [
    diffOne('Total Job', 'totalJob', toNum(s.total_job), toNum(c.totalAmount)),
    diffOne('Card', 'card', toNum(s.card_amount), toNum(c.totalPaidCard)),
    diffOne('Tech Cash', 'techCash', toNum(s.tech_cash), toNum(c.techPaidCash)),
    diffOne('Co. Cash', 'companyCash', toNum(s.company_cash), toNum(c.totalPaidCompanyCash)),
    diffOne('Tips', 'tips', tipsTotalLovable(s), tipsTotalCrm(c)),
    diffOne('My Parts', 'myParts', toNum(s.my_parts), toNum(c.techParts)),
    diffOne('Co. Parts', 'companyParts', toNum(s.company_parts), toNum(c.companyParts)),
    diffOne('LM Cash', 'lmCash', toNum(s.lm_cash), toNum(c.lmCash)),
    diffOne('LM Check', 'lmCheck', toNum(s.lm_check), toNum(c.lmCheck)),
    diffOne('LM Parts', 'lmParts', toNum(s.lm_parts), toNum(c.lmParts)),
  ];
}

/**
 * Pair Supabase report jobs with CRM jobs for the same tech + week.
 *
 * Pairing rules (each CRM job paired at most once):
 *   1. Same date + same address (street portion, normalized)
 *   2. Same date + same customer name
 *   3. Same address (any date in week) — date discrepancies are common; the
 *      week-range pre-filter on the CRM query keeps this safe
 *   4. Same customer name (any date in week)
 *   5. Else: orphan
 */
export function compare(
  supabaseJobs: SupabaseReportJob[],
  crmJobs: CrmJob[],
  manualLinks: Record<string, string> = {},   // lovableJobId → crmJobId override
): ComparisonResult {
  const usedCrmIds = new Set<string>();
  const pairs: Pair[] = [];
  const crmById = new Map(crmJobs.map((c) => [c._id, c]));

  // Helper: build a pair record from a (s, c) tuple, with optional manual flag.
  const buildPaired = (s: SupabaseReportJob, c: CrmJob, manual: boolean): Pair => {
    const diffs = buildPairDiffs(s, c);
    const supMethod = s.payment_type ?? null;
    const crmMethod = c.paymentType ?? deriveCrmMethod(c);
    const methodDiff: MethodDiff | null =
      normMethod(supMethod) !== normMethod(crmMethod)
        ? { supabase: supMethod, crm: crmMethod }
        : null;
    const status: Pair['status'] =
      diffs.some((d) => d.exceedsTolerance) || methodDiff ? 'mismatch' : 'match';
    return { status, supabaseJob: s, crmJob: c, diffs, methodDiff, manualLink: manual };
  };

  for (const s of supabaseJobs) {
    // Manual override wins over auto-matching.
    const linkedCrmId = manualLinks[s.id];
    if (linkedCrmId) {
      const linkedCrm = crmById.get(linkedCrmId);
      if (linkedCrm && !usedCrmIds.has(linkedCrm._id)) {
        usedCrmIds.add(linkedCrm._id);
        pairs.push(buildPaired(s, linkedCrm, true));
        continue;
      }
      // Linked CRM job is gone (deleted/out-of-range/already used) — fall
      // through to normal logic so the row still gets a sensible status.
    }

    const sDate = dateOnly(s.job_date);
    const sAddr = normAddress(s.address);
    const sCust = normString(s.customer_name);

    // Pass 1: date + address
    let match = sAddr ? crmJobs.find(
      (c) => !usedCrmIds.has(c._id) && dateOnly(c.date) === sDate && addrMatches(normAddress(c.address), sAddr)
    ) : undefined;
    // Pass 2: date + customer
    if (!match && sCust) {
      match = crmJobs.find(
        (c) => !usedCrmIds.has(c._id) && dateOnly(c.date) === sDate && normString(c.clientName) === sCust
      );
    }
    // Pass 3: address only (date drift)
    if (!match && sAddr) {
      match = crmJobs.find(
        (c) => !usedCrmIds.has(c._id) && addrMatches(normAddress(c.address), sAddr)
      );
    }
    // Pass 4: customer only (date drift)
    if (!match && sCust) {
      match = crmJobs.find(
        (c) => !usedCrmIds.has(c._id) && normString(c.clientName) === sCust
      );
    }

    if (match) {
      usedCrmIds.add(match._id);
      pairs.push(buildPaired(s, match, false));
    } else {
      pairs.push({ status: 'missing-in-crm', supabaseJob: s, crmJob: null, diffs: [] });
    }
  }

  // Remaining CRM jobs that weren't paired = missing-in-report
  for (const c of crmJobs) {
    if (usedCrmIds.has(c._id)) continue;
    pairs.push({ status: 'missing-in-report', supabaseJob: null, crmJob: c, diffs: [] });
  }

  // Totals
  const sup = supabaseJobs.reduce(
    (acc, s) => ({
      totalJob: acc.totalJob + toNum(s.total_job),
      cardAmount: acc.cardAmount + toNum(s.card_amount),
      techCash: acc.techCash + toNum(s.tech_cash),
      companyCash: acc.companyCash + toNum(s.company_cash),
      tips: acc.tips + tipsTotalLovable(s),
      myParts: acc.myParts + toNum(s.my_parts),
      companyParts: acc.companyParts + toNum(s.company_parts),
      lmCash: acc.lmCash + toNum(s.lm_cash),
      lmCheck: acc.lmCheck + toNum(s.lm_check),
      lmParts: acc.lmParts + toNum(s.lm_parts),
    }),
    {
      totalJob: 0, cardAmount: 0, techCash: 0, companyCash: 0, tips: 0,
      myParts: 0, companyParts: 0, lmCash: 0, lmCheck: 0, lmParts: 0,
    }
  );

  const crm = crmJobs.reduce(
    (acc, c) => ({
      totalAmount: acc.totalAmount + toNum(c.totalAmount),
      totalPaidCard: acc.totalPaidCard + toNum(c.totalPaidCard),
      techPaidCash: acc.techPaidCash + toNum(c.techPaidCash),
      totalPaidCompanyCash: acc.totalPaidCompanyCash + toNum(c.totalPaidCompanyCash),
      tipsTotal: acc.tipsTotal + tipsTotalCrm(c),
      techParts: acc.techParts + toNum(c.techParts),
      companyParts: acc.companyParts + toNum(c.companyParts),
      lmCash: acc.lmCash + toNum(c.lmCash),
      lmCheck: acc.lmCheck + toNum(c.lmCheck),
      lmParts: acc.lmParts + toNum(c.lmParts),
      totalPaidCompanyCheck: acc.totalPaidCompanyCheck + toNum(c.totalPaidCompanyCheck),
      totalPaidFinance: acc.totalPaidFinance + toNum(c.totalPaidFinance),
    }),
    {
      totalAmount: 0, totalPaidCard: 0, techPaidCash: 0, totalPaidCompanyCash: 0,
      tipsTotal: 0, techParts: 0, companyParts: 0,
      lmCash: 0, lmCheck: 0, lmParts: 0,
      totalPaidCompanyCheck: 0, totalPaidFinance: 0,
    }
  );

  // Round all
  Object.keys(sup).forEach((k) => { (sup as any)[k] = round2((sup as any)[k]); });
  Object.keys(crm).forEach((k) => { (crm as any)[k] = round2((crm as any)[k]); });

  const diffs = {
    totalJob: round2(crm.totalAmount - sup.totalJob),
    card: round2(crm.totalPaidCard - sup.cardAmount),
    techCash: round2(crm.techPaidCash - sup.techCash),
    companyCash: round2(crm.totalPaidCompanyCash - sup.companyCash),
    tips: round2(crm.tipsTotal - sup.tips),
    myParts: round2(crm.techParts - sup.myParts),
    companyParts: round2(crm.companyParts - sup.companyParts),
    lmCash: round2(crm.lmCash - sup.lmCash),
    lmCheck: round2(crm.lmCheck - sup.lmCheck),
    lmParts: round2(crm.lmParts - sup.lmParts),
  };

  let matched = 0, mismatched = 0, missingInCrm = 0, missingInReport = 0;
  for (const p of pairs) {
    if (p.status === 'match') matched++;
    else if (p.status === 'mismatch') mismatched++;
    else if (p.status === 'missing-in-crm') missingInCrm++;
    else if (p.status === 'missing-in-report') missingInReport++;
  }

  return {
    pairs,
    summary: {
      matched,
      mismatched,
      missingInCrm,
      missingInReport,
      supabaseJobCount: supabaseJobs.length,
      crmJobCount: crmJobs.length,
    },
    totals: { supabase: sup, crm, diffs },
  };
}

export const TOLERANCE = TOLERANCE_USD;
