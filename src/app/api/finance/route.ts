import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import type { JobRow, Technician } from '../../../types/job';
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

// View 2: Tech ↔ LM (any job with lmParts)
type TechLmRow = { tech: string; jobsWithLmParts: number; techOwesLm: number };

// View 3: LM ↔ Company (any job with lmCash or lmCheck)
type LmCompanyRow = {
  location: string;
  jobsWithLmRevenue: number;
  lmCashTotal: number;
  lmCheckTotal: number;
  lmOwesCompany: number;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const locationFilter = searchParams.get('location') || '';

    const client = await getClient();
    const db = client.db(DB_NAME);
    const jobCol = db.collection<JobRow>(JOB_COLLECTION);
    const techCol = db.collection<Technician>(TECH_COLLECTION);

    const techDocs = await techCol.find({}).toArray();
    const techMap = new Map<string, Technician>();
    techDocs.forEach((t: any) => {
      const id = (t as any)._id?.toString() || '';
      techMap.set(id, { ...(t as Technician), _id: id });
    });

    const filter: Record<string, any> = {};
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }
    if (locationFilter) filter.location = locationFilter;

    const jobs = await jobCol.find(filter).toArray();

    // View 1 — closed jobs only, ORIGINAL formulas
    const techBalanceAgg = new Map<string, TechBalanceRow>();
    // View 2 — any job with lmParts
    const techLmAgg = new Map<string, TechLmRow>();
    // View 3 — any job with lmCash or lmCheck, grouped by location
    const lmCompanyAgg = new Map<string, LmCompanyRow>();

    for (const job of jobs) {
      const techId = job.tech || '';
      const status = (job.status || '').toLowerCase();
      const location = job.location || '(no location)';
      const lmParts = toNumber(job.lmParts);
      const lmCash = toNumber(job.lmCash);
      const lmCheck = toNumber(job.lmCheck);

      // View 1 — closed jobs, original Company↔Tech balance
      if (status === 'closed' && techId) {
        const techDoc = techMap.get(techId);
        const techPct = techDoc?.profitPercent ?? 0;
        const paidSum = calcPaidSum(job);
        const fee = calcPaymentFee(job);
        const parts = calcParts(job);
        const totalProfit = calcJobProfit(toNumber(paidSum) - toNumber(fee), parts);
        const shareAmount = calcStandardShare(totalProfit, techPct);
        const balance = calcFinalBalance(shareAmount, job.techParts, job.techPaidCash);

        const t = techBalanceAgg.get(techId) || { tech: techId, jobs: 0, balance: 0 };
        t.jobs += 1;
        // Display sign convention identical to balance-report: positive = tech owes company.
        t.balance += toNumber(balance) * -1;
        techBalanceAgg.set(techId, t);
      }

      // View 2 — Tech ↔ LM, any job with lmParts
      if (lmParts > 0 && techId) {
        const t = techLmAgg.get(techId) || { tech: techId, jobsWithLmParts: 0, techOwesLm: 0 };
        t.jobsWithLmParts += 1;
        t.techOwesLm += lmParts;
        techLmAgg.set(techId, t);
      }

      // View 3 — LM ↔ Company, any job with lmCash or lmCheck
      if (lmCash > 0 || lmCheck > 0) {
        const l = lmCompanyAgg.get(location) || {
          location,
          jobsWithLmRevenue: 0,
          lmCashTotal: 0,
          lmCheckTotal: 0,
          lmOwesCompany: 0,
        };
        l.jobsWithLmRevenue += 1;
        l.lmCashTotal += lmCash;
        l.lmCheckTotal += lmCheck;
        l.lmOwesCompany += lmCash + lmCheck;
        lmCompanyAgg.set(location, l);
      }
    }

    const techBalances = Array.from(techBalanceAgg.values()).sort(
      (a, b) => Math.abs(b.balance) - Math.abs(a.balance)
    );
    const techLmSettlement = Array.from(techLmAgg.values()).sort(
      (a, b) => b.techOwesLm - a.techOwesLm
    );
    const lmCompanySettlement = Array.from(lmCompanyAgg.values()).sort(
      (a, b) => b.lmOwesCompany - a.lmOwesCompany
    );

    const totals = {
      // View 1 totals
      grandCompanyTechBalance: techBalances.reduce((s, r) => s + r.balance, 0),
      // View 2 totals
      grandTechOwesLm: techLmSettlement.reduce((s, r) => s + r.techOwesLm, 0),
      // View 3 totals
      grandLmOwesCompany: lmCompanySettlement.reduce((s, r) => s + r.lmOwesCompany, 0),
    };

    return NextResponse.json({
      techBalances,
      techLmSettlement,
      lmCompanySettlement,
      totals,
      meta: {
        startDate,
        endDate,
        location: locationFilter,
        jobsScanned: jobs.length,
      },
    });
  } catch (err) {
    console.error('GET /api/finance error', err);
    return NextResponse.json({ error: 'Failed to load finance dashboard' }, { status: 500 });
  }
}
