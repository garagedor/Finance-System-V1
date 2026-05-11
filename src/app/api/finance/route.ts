import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import type { JobRow, Location, Technician } from '../../../types/job';
import {
  calcParts,
  calcJobProfit,
  calcStandardShare,
  calcFinalBalance,
  calcPaidSum,
  calcPaymentFee,
  toNumber,
} from '../utils/calculations';

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';
const JOB_COLLECTION = 'Job';
const TECH_COLLECTION = 'Technician';
const LOCATION_COLLECTION = 'Location';

let cachedClient: MongoClient | null = null;
async function getClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

// View 1: Company ↔ Tech (Closed jobs, ORIGINAL formulas only — LM untouched)
type TechBalanceRow = { tech: string; jobs: number; balance: number };

// View 2: LM ↔ Company — net settlement.
// LM owes company: cash + check the LM physically collected on company's behalf.
// Company owes LM:  the LM's 40% (locationPct) profit share on closed jobs +
//                   lmParts (parts the LM fronted on any job).
type LmCompanyRow = {
  location: string;
  jobsTouched: number;       // distinct jobs that contributed to either side
  // LM → Company side
  lmCashTotal: number;
  lmCheckTotal: number;
  lmOwesCompany: number;     // = lmCashTotal + lmCheckTotal
  // Company → LM side
  fortyPctPayout: number;    // Σ closed-job totalProfit × locationPct/100
  lmPartsTotal: number;
  companyOwesLm: number;     // = fortyPctPayout + lmPartsTotal
  // Net (positive = LM still owes; negative = company owes LM)
  netLmOwesCompany: number;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const techs = searchParams.getAll('tech').map((t) => t.trim()).filter(Boolean);
    const locations = searchParams.getAll('location').map((l) => l.trim()).filter(Boolean);

    const client = await getClient();
    const db = client.db(DB_NAME);
    const jobCol = db.collection<JobRow>(JOB_COLLECTION);
    const techCol = db.collection<Technician>(TECH_COLLECTION);
    const locationCol = db.collection<Location>(LOCATION_COLLECTION);

    const techDocs = await techCol.find({}).toArray();
    const techMap = new Map<string, Technician>();
    techDocs.forEach((t: any) => {
      const id = (t as any)._id?.toString() || '';
      techMap.set(id, { ...(t as Technician), _id: id });
    });

    // Location → managerProfitPercent (the "40%" — varies per location)
    const locationDocs = await locationCol.find({}).toArray();
    const locationPctMap = new Map<string, number>();
    locationDocs.forEach((l: any) => {
      const id = (l as any)._id?.toString() || '';
      locationPctMap.set(id, toNumber(l.managerProfitPercent));
    });

    const filter: Record<string, any> = {};
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }
    if (techs.length > 0) filter.tech = { $in: techs };
    if (locations.length > 0) filter.location = { $in: locations };

    const jobs = await jobCol.find(filter).toArray();

    // View 1 — closed jobs only, ORIGINAL formulas
    const techBalanceAgg = new Map<string, TechBalanceRow>();
    // View 2 — any job with lmCash or lmCheck, grouped by location
    const lmCompanyAgg = new Map<string, LmCompanyRow>();
    // Σ tech share (commission paid to techs) across closed jobs in range —
    // used by the LM Commission KPI per user formula.
    let totalTechCommission = 0;

    const blankLmRow = (location: string): LmCompanyRow => ({
      location,
      jobsTouched: 0,
      lmCashTotal: 0,
      lmCheckTotal: 0,
      lmOwesCompany: 0,
      fortyPctPayout: 0,
      lmPartsTotal: 0,
      companyOwesLm: 0,
      netLmOwesCompany: 0,
    });

    for (const job of jobs) {
      const techId = job.tech || '';
      const status = (job.status || '').toLowerCase();
      const location = job.location || '(no location)';
      const lmCash = toNumber(job.lmCash);
      const lmCheck = toNumber(job.lmCheck);
      const lmParts = toNumber(job.lmParts);
      const locationPct = locationPctMap.get(location) ?? 0;

      // Per-job profit (used by both the Co↔Tech and Co→LM sides)
      const paidSum = calcPaidSum(job);
      const fee = calcPaymentFee(job);
      const parts = calcParts(job);
      const totalProfit = calcJobProfit(toNumber(paidSum) - toNumber(fee), parts);

      // View 1 — closed jobs, original Company↔Tech balance
      if (status === 'closed' && techId) {
        const techDoc = techMap.get(techId);
        const techPct = techDoc?.profitPercent ?? 0;
        const shareAmount = calcStandardShare(totalProfit, techPct);
        const balance = calcFinalBalance(shareAmount, toNumber(job.techParts), toNumber(job.techPaidCash));

        const t = techBalanceAgg.get(techId) || { tech: techId, jobs: 0, balance: 0 };
        t.jobs += 1;
        // Display sign convention identical to balance-report: positive = tech owes company.
        t.balance += toNumber(balance) * -1;
        techBalanceAgg.set(techId, t);

        // Tech commission = tech share of profit on this closed job.
        totalTechCommission += toNumber(shareAmount);
      }

      // View 2 — LM ↔ Company net settlement.
      //   LM → Company side: lmCash + lmCheck on any job.
      //   Company → LM side: 40% (locationPct) of totalProfit on CLOSED jobs
      //                      (matches Balance Report's location mode), plus
      //                      lmParts on any job.
      const fortyPct = status === 'closed' ? calcStandardShare(totalProfit, locationPct) : 0;
      const touchesLm = lmCash > 0 || lmCheck > 0 || lmParts > 0 || fortyPct !== 0;
      if (touchesLm) {
        const l = lmCompanyAgg.get(location) || blankLmRow(location);
        l.jobsTouched += 1;
        l.lmCashTotal += lmCash;
        l.lmCheckTotal += lmCheck;
        l.lmOwesCompany += lmCash + lmCheck;
        l.fortyPctPayout += fortyPct;
        l.lmPartsTotal += lmParts;
        l.companyOwesLm = l.fortyPctPayout + l.lmPartsTotal;
        l.netLmOwesCompany = l.lmOwesCompany - l.companyOwesLm;
        lmCompanyAgg.set(location, l);
      }
    }

    const techBalances = Array.from(techBalanceAgg.values()).sort(
      (a, b) => Math.abs(b.balance) - Math.abs(a.balance)
    );
    const lmCompanySettlement = Array.from(lmCompanyAgg.values()).sort(
      (a, b) => b.netLmOwesCompany - a.netLmOwesCompany
    );

    const totals = {
      // View 1 totals
      grandCompanyTechBalance: techBalances.reduce((s, r) => s + r.balance, 0),
      grandTechCommission: totalTechCommission,
      // View 2 totals (broken into the two sides + the net)
      grandLmOwesCompany: lmCompanySettlement.reduce((s, r) => s + r.lmOwesCompany, 0),
      grandCompanyOwesLm: lmCompanySettlement.reduce((s, r) => s + r.companyOwesLm, 0),
      grandNetLmOwesCompany: lmCompanySettlement.reduce((s, r) => s + r.netLmOwesCompany, 0),
      // Σ closed-job profit × locationPct/100 — the "Location Report" payout total.
      grandFortyPctPayout: lmCompanySettlement.reduce((s, r) => s + r.fortyPctPayout, 0),
    };

    return NextResponse.json({
      techBalances,
      lmCompanySettlement,
      totals,
      meta: {
        startDate,
        endDate,
        techs,
        locations,
        jobsScanned: jobs.length,
      },
    });
  } catch (err) {
    console.error('GET /api/finance error', err);
    return NextResponse.json({ error: 'Failed to load finance dashboard' }, { status: 500 });
  }
}
