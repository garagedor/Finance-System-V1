import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import type { JobRow, Location, Technician } from '../../../types/job';
import type { User } from '../../../types/user';
import {
  calcJobBalances,
  calcLmOwesCompany,
  calcStandardShare,
  toNumber,
} from '../utils/calculations';

const DB_NAME = 'ag';
const JOB_COLLECTION = 'Job';
const TECH_COLLECTION = 'Technician';
const LOCATION_COLLECTION = 'Location';
const USER_COLLECTION = 'User';

type Mode = 'tech' | 'location';

let cachedClient: MongoClient | null = null;

async function getClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const client = await getMongoClient();
  await client.connect();
  cachedClient = client;
  return client;
}

const toDate = (value: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const inclusiveEnd = (value: string | null) => {
  const d = toDate(value);
  if (!d) return null;
  d.setHours(23, 59, 59, 999);
  return d;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');
    const techFilter = searchParams.get('tech') || '';
    const mode = (searchParams.get('mode') as Mode) || 'tech';
    const client = await getClient();
    const db = client.db(DB_NAME);
    const jobCol = db.collection<JobRow>(JOB_COLLECTION);
    const techCol = db.collection<Technician>(TECH_COLLECTION);
    const locationCol = db.collection<Location>(LOCATION_COLLECTION);
    const userCol = db.collection<User>(USER_COLLECTION);

    // Filter for technicians: use the most efficient 'distinct' call on indexed fields
    const techQueryFilter: Record<string, any> = {};
    if (startDateStr || endDateStr) {
      techQueryFilter.date = {};
      if (startDateStr) techQueryFilter.date.$gte = startDateStr;
      if (endDateStr) techQueryFilter.date.$lte = endDateStr;
    }
    const activeTechs = await jobCol.distinct('tech', techQueryFilter);

    const techDocs = await techCol.find({}).toArray();
    const techMap = new Map<string, Technician>();
    techDocs.forEach((t: any) => {
      const key = (t as any)._id?.toString() || '';
      techMap.set(key, { ...(t as Technician), _id: key });
    });

    const userDocs = await userCol.find({}).toArray();
    const userRoleMap = new Map<string, string>();
    userDocs.forEach((u: any) => {
      if (u.name) userRoleMap.set(u.name, u.type || 'simple');
    });

    const techForLocation = techFilter ? techMap.get(techFilter) : undefined;
    const locationId = techForLocation?.location || '';
    const locationDoc = locationId ? await locationCol.findOne({ _id: locationId as any }) : null;
    const locationPct = (locationDoc as any)?.managerProfitPercent ?? 0;

    const pipeline: any[] = [];
    const match: Record<string, any> = {};
    if (startDateStr || endDateStr) {
      match.date = {};
      if (startDateStr) match.date.$gte = startDateStr;
      if (endDateStr) match.date.$lte = endDateStr;
    }

    // Every report (Tech or Location) must have a specific tech selected.
    // If none is provided, we match nothing to avoid returning "all jobs".
    match.tech = techFilter || '__NONE__';

    if (Object.keys(match).length) {
      pipeline.push({ $match: match });
    }

    // Sort by date string and ID (very efficient with index)
    pipeline.push({ $sort: { date: -1, _id: -1 } });
    const rowsRaw = await jobCol.aggregate(pipeline).toArray();

    const rows = rowsRaw.map((job: any) => {
      const jobId = (job as any)._id?.toString() || '';
      const techId = job.tech || '';
      const techDoc = techId ? techMap.get(techId) : undefined;
      const techPct = techDoc?.profitPercent ?? 0;

      // Single source of truth: every per-job number goes through
      // calcJobBalances so Tech Report and Location Report can't drift.
      // The mode picks which of techShare / locationShare and techBalance /
      // locationBalance gets surfaced — both are computed unconditionally.
      const calc = calcJobBalances(job, techPct, locationPct);
      const paidSum = calc.jobTotal;
      const parts = calc.parts;
      const fee = calc.paymentFee;
      const totalProfit = calc.totalProfit;
      const tips = calc.tipsTotal;
      const shareAmount = mode === 'location' ? calc.locationShare : calc.techShare;
      // Mode-aware base balance — net settlement, excluding tips.
      const balance = mode === 'location' ? calc.locationBalance : calc.techBalance;
      // Balance with tips folded in — meaningful in tech mode only; equals
      // `balance` for location mode (tips never flow to LM).
      const balanceWithTips = mode === 'location' ? calc.locationBalanceWithTips : calc.techBalanceWithTips;

      // What the LM-side owes the company. In location mode we include
      // tech_cash too: the technician sits inside the location structure for
      // cash-collection accounting, so cash the tech kept is "held by the
      // location side" and is owed back to the company. In tech mode we keep
      // the literal calcLmOwesCompany (lm_cash + lm_check only) — there
      // tech_cash sits in the tech ↔ company column instead.
      const lmOwesCompany = mode === 'location'
        ? calcLmOwesCompany(job) + toNumber(job.techPaidCash)
        : calcLmOwesCompany(job);
      // Location-mode only: what the company owes the LM = their location-%
      // payout plus parts the LM fronted on the job.
      const companyOwesLm = mode === 'location' ? calc.locationShare + toNumber(job.lmParts) : 0;

      const approvalsRaw = Array.isArray(job.approvals) ? job.approvals : (typeof job.approvals === 'string' ? job.approvals.split(',') : []);
      const approvals = [...new Set(approvalsRaw.map((a: any) => String(a).trim()).filter(Boolean))].map((name: any) => ({
        name: String(name),
        role: userRoleMap.get(String(name)) || 'simple'
      }));

      const paymentFields = [
        { key: 'techPaidCash', label: 'Cash', value: toNumber(job.techPaidCash || 0) },
        { key: 'totalPaidCard', label: 'Card', value: toNumber(job.totalPaidCard || 0) },
        { key: 'totalPaidCompanyCheck', label: 'Company Check', value: toNumber(job.totalPaidCompanyCheck || 0) },
        { key: 'totalPaidFinance', label: 'Finance', value: toNumber(job.totalPaidFinance || 0) },
        { key: 'totalPaidCompanyCash', label: 'Company Cash', value: toNumber(job.totalPaidCompanyCash || 0) },
        { key: 'lmCash', label: 'LM Cash', value: toNumber(job.lmCash || 0) },
        { key: 'lmCheck', label: 'LM Check', value: toNumber(job.lmCheck || 0) },
      ];
      const usedPayments = paymentFields.filter((p) => p.value > 0);
      let paymentMethod = '-';
      if (usedPayments.length > 1) paymentMethod = 'Split Payment';
      else if (usedPayments.length === 1) paymentMethod = usedPayments[0].label;

      // Row-level calculation breakdown — every input and intermediate value
      // used by calcJobBalances, surfaced so the formula can be verified per
      // job. The displayed `balance` / `shareAmount` are derived directly from
      // this `breakdown` object (mode-aware).
      const breakdown = {
        // Inputs (raw)
        techPercentage: toNumber(techPct),
        locationPercentage: toNumber(locationPct),
        techPaidCash: toNumber(job.techPaidCash || 0),
        techParts: toNumber(job.techParts || 0),
        companyParts: toNumber(job.companyParts || 0),
        lmParts: toNumber(job.lmParts || 0),
        lmCash: toNumber(job.lmCash || 0),
        lmCheck: toNumber(job.lmCheck || 0),
        // Pipeline outputs
        jobTotal: toNumber(calc.jobTotal),
        paymentFee: toNumber(calc.paymentFee),
        parts: toNumber(calc.parts),
        totalProfit: toNumber(calc.totalProfit),
        tipsGross: toNumber(calc.tipsGross),
        tipsFee: toNumber(calc.tipsFee),
        tipsTotal: toNumber(calc.tipsTotal),
        techShare: toNumber(calc.techShare),
        locationShare: toNumber(calc.locationShare),
        techBalance: toNumber(calc.techBalance),
        techBalanceWithTips: toNumber(calc.techBalanceWithTips),
        locationBalance: toNumber(calc.locationBalance),
        locationBalanceWithTips: toNumber(calc.locationBalanceWithTips),
      };

      return {
        id: jobId,
        date: job.date || '',
        address: job.address || '',
        tech: job.tech || '',
        location: job.location || '',
        status: job.status || '',
        totalAmount: toNumber(job.totalAmount || 0),
        techPaidCash: toNumber(job.techPaidCash || 0),
        totalPaidCard: toNumber(job.totalPaidCard || 0),
        totalPaidCompanyCheck: toNumber(job.totalPaidCompanyCheck || 0),
        totalPaidFinance: toNumber(job.totalPaidFinance || 0),
        totalPaidCompanyCash: toNumber(job.totalPaidCompanyCash || 0),
        techParts: toNumber(job.techParts || 0),
        companyParts: toNumber(job.companyParts || 0),
        lmParts: toNumber(job.lmParts || 0),
        lmCash: toNumber(job.lmCash || 0),
        lmCheck: toNumber(job.lmCheck || 0),
        tipsCard: toNumber(job.tipsCard || 0),
        tipsFinance: toNumber(job.tipsFinance || 0),
        tipsCompanyCash: toNumber(job.tipsCompanyCash || 0),
        tipsCheck: toNumber(job.tipsCheck || 0),
        paidSum: toNumber(paidSum),
        paymentFee: toNumber(fee),
        totalProfit: toNumber(totalProfit),
        shareAmount: toNumber(shareAmount),
        tipsGross: toNumber(calc.tipsGross),
        tipsFee: toNumber(calc.tipsFee),
        tipsTotal: toNumber(tips),
        approvals,
        paymentMethod,
        balance: toNumber(balance),
        balanceWithTips: toNumber(balanceWithTips),
        lmOwesCompany: toNumber(lmOwesCompany),
        companyOwesLm: toNumber(companyOwesLm),
        breakdown,
      };
    });

    const assigned = rows.length;
    const profit = rows
      .filter((r) => r.status !== 'X close')
      .reduce((sum, r) => sum + toNumber(r.totalProfit || 0), 0);
    const avgTicket = assigned ? toNumber(profit) / assigned : 0;
    const closedRows = rows.filter((r) => (r.status || '') === 'Closed');
    const avgClosedJob = closedRows.length
      ? closedRows.reduce((sum, r) => sum + toNumber(r.totalProfit || 0), 0) / closedRows.length
      : 0;

    const statusStatsMap = rows
      .filter((r) => r.status && r.status.trim() !== '')
      .reduce<Record<string, number>>((acc, r) => {
        const key = r.status;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
    const statusStats = Object.entries(statusStatsMap).map(([key, count]) => ({ key, count }));

    let locationShare = 0;
    let techShare = 0;
    if (mode === 'location') {
      rows.forEach((r) => {
        const base = toNumber(r.totalProfit || 0);
        const techPct = r.tech && techMap.get(r.tech)?.profitPercent ? toNumber(techMap.get(r.tech)!.profitPercent) : 0;
        locationShare += calcStandardShare(base, locationPct);
        techShare += calcStandardShare(base, techPct);
      });
    }

    const amountsByDate: Record<string, number> = rows.reduce((acc, r) => {
      const key = r.date ? r.date.slice(0, 10) : 'Unknown';
      acc[key] = (acc[key] || 0) + (r.totalAmount || 0);
      return acc;
    }, {} as Record<string, number>);
    const byDate = Object.entries(amountsByDate)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([date, amount]) => ({ date, amount }));

    return NextResponse.json({
      rows,
      totals: {
        assigned: toNumber(assigned),
        profit: toNumber(profit),
        avgTicket: toNumber(avgTicket),
        avgClosedJob: toNumber(avgClosedJob)
      },
      statusStats,
      locationVsTech: {
        locationShare: toNumber(locationShare),
        techShare: toNumber(techShare),
        diff: toNumber(toNumber(locationShare) - toNumber(techShare))
      },
      byDate,
      appliedPct: mode === 'location' ? locationPct : (techForLocation?.profitPercent ?? 0),
      activeTechs,
    });
  } catch (err) {
    console.error('GET /api/balance-report error', err);
    return NextResponse.json({ error: 'Failed to load balance report' }, { status: 500 });
  }
}
