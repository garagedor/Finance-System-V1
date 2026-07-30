import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import type { JobRow } from '../../../types/job';
import { toNumber } from '../utils/calculations';
import { canonicalStatus } from '@/lib/status-canonical';

const DB_NAME = 'ag';
const JOB_COLLECTION = 'Job';

// The 7 payment methods this report tracks. Labels match the form labels in
// entityConfigs.tsx exactly so the UI is internally consistent.
const PAYMENT_METHODS = [
  { key: 'techPaidCash',          label: 'Tech Paid Cash' },
  { key: 'totalPaidCard',         label: 'Paid Card' },
  { key: 'totalPaidCompanyCheck', label: 'Paid Company Check' },
  { key: 'totalPaidFinance',      label: 'Paid Finance' },
  { key: 'totalPaidCompanyCash',  label: 'Paid Company Cash' },
  { key: 'lmCash',                label: 'Paid LM Cash' },
  { key: 'lmCheck',               label: 'Paid LM Check' },
] as const;

type MethodKey = typeof PAYMENT_METHODS[number]['key'];
const METHOD_KEYS: MethodKey[] = PAYMENT_METHODS.map((m) => m.key);

let cachedClient: MongoClient | null = null;
async function getClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const client = await getMongoClient();
  await client.connect();
  cachedClient = client;
  return client;
}

const zeroByMethod = (): Record<MethodKey, number> =>
  Object.fromEntries(METHOD_KEYS.map((k) => [k, 0])) as Record<MethodKey, number>;

type GroupRow = {
  key: string;
  jobs: number;
  totalCollected: number;
  byMethod: Record<MethodKey, number>;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const techs = searchParams.getAll('tech').map((t) => t.trim()).filter(Boolean);
    const locations = searchParams.getAll('location').map((l) => l.trim()).filter(Boolean);
    const providers = searchParams.getAll('provider').map((p) => p.trim()).filter(Boolean);
    const statuses = searchParams.getAll('status').map((s) => s.trim()).filter(Boolean);
    const methods = (searchParams.getAll('method').map((m) => m.trim()).filter(Boolean) as MethodKey[])
      .filter((m) => METHOD_KEYS.includes(m));

    const client = await getClient();
    const db = client.db(DB_NAME);
    const jobCol = db.collection<JobRow>(JOB_COLLECTION);

    const filter: Record<string, any> = {};
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }
    if (techs.length) filter.tech = { $in: techs };
    if (locations.length) filter.location = { $in: locations };
    if (providers.length) filter.provider = { $in: providers };
    if (statuses.length) filter.statusCanonical = { $in: statuses };
    // Method filter: OR semantics — at least one selected method has a non-zero amount.
    // Uses $expr + $convert so that string-stored numeric values (e.g. "100")
    // are coerced before comparison; bare {$gt: 0} would silently exclude them
    // because BSON comparison doesn't coerce strings to numbers.
    if (methods.length) {
      filter.$or = methods.map((m) => ({
        $expr: {
          $gt: [
            { $convert: { input: `$${m}`, to: 'double', onError: 0, onNull: 0 } },
            0,
          ],
        },
      }));
    }

    const jobs = await jobCol.find(filter).toArray();

    // Aggregations
    const methodTotals: Record<MethodKey, { total: number; jobs: number }> = Object.fromEntries(
      METHOD_KEYS.map((k) => [k, { total: 0, jobs: 0 }])
    ) as Record<MethodKey, { total: number; jobs: number }>;

    const techAgg = new Map<string, GroupRow>();
    const locationAgg = new Map<string, GroupRow>();
    const providerAgg = new Map<string, GroupRow>();
    const dateAgg = new Map<string, GroupRow>();
    const jobRows: any[] = [];
    let grandTotal = 0;

    const upsert = (map: Map<string, GroupRow>, key: string, jobTotal: number, perMethod: Record<MethodKey, number>) => {
      const existing = map.get(key) || { key, jobs: 0, totalCollected: 0, byMethod: zeroByMethod() };
      existing.jobs += 1;
      existing.totalCollected += jobTotal;
      for (const m of METHOD_KEYS) existing.byMethod[m] += perMethod[m];
      map.set(key, existing);
    };

    for (const job of jobs) {
      const perMethod = zeroByMethod();
      let jobTotal = 0;
      const methodsUsedLabels: string[] = [];
      for (const m of PAYMENT_METHODS) {
        const v = toNumber((job as any)[m.key]);
        perMethod[m.key] = v;
        jobTotal += v;
        if (v > 0) {
          methodTotals[m.key].total += v;
          methodTotals[m.key].jobs += 1;
          methodsUsedLabels.push(m.label);
        }
      }
      grandTotal += jobTotal;

      upsert(techAgg, job.tech || '(no tech)', jobTotal, perMethod);
      upsert(locationAgg, job.location || '(no location)', jobTotal, perMethod);
      upsert(providerAgg, job.provider || '(no provider)', jobTotal, perMethod);

      const dateKey = (job.date || '').slice(0, 10) || '(no date)';
      upsert(dateAgg, dateKey, jobTotal, perMethod);

      jobRows.push({
        id: (job as any)._id?.toString() || '',
        date: job.date || '',
        address: job.address || '',
        tech: job.tech || '',
        location: job.location || '',
        provider: job.provider || '',
        status: canonicalStatus(job.status),
        techPaidCash: perMethod.techPaidCash,
        totalPaidCard: perMethod.totalPaidCard,
        totalPaidCompanyCheck: perMethod.totalPaidCompanyCheck,
        totalPaidFinance: perMethod.totalPaidFinance,
        totalPaidCompanyCash: perMethod.totalPaidCompanyCash,
        lmCash: perMethod.lmCash,
        lmCheck: perMethod.lmCheck,
        totalCollected: jobTotal,
        methodsUsed: methodsUsedLabels,
      });
    }

    const methodsUsedCount = METHOD_KEYS.filter((k) => methodTotals[k].total > 0).length;

    const byMethod = PAYMENT_METHODS.map((m) => ({
      key: m.key,
      label: m.label,
      total: methodTotals[m.key].total,
      jobs: methodTotals[m.key].jobs,
      pct: grandTotal > 0 ? (methodTotals[m.key].total / grandTotal) * 100 : 0,
    }));

    const byTech = Array.from(techAgg.values()).sort((a, b) => b.totalCollected - a.totalCollected);
    const byLocation = Array.from(locationAgg.values()).sort((a, b) => b.totalCollected - a.totalCollected);
    const byProvider = Array.from(providerAgg.values()).sort((a, b) => b.totalCollected - a.totalCollected);
    const byDate = Array.from(dateAgg.values()).sort((a, b) => a.key.localeCompare(b.key));
    const jobsSorted = jobRows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return NextResponse.json({
      summary: {
        totalCollected: grandTotal,
        totalJobs: jobs.length,
        avgJobValue: jobs.length ? grandTotal / jobs.length : 0,
        methodsUsed: methodsUsedCount,
      },
      byMethod,
      byTech,
      byLocation,
      byProvider,
      byDate,
      jobs: jobsSorted,
      meta: {
        startDate,
        endDate,
        jobsScanned: jobs.length,
        filters: { techs, locations, providers, statuses, methods },
      },
    });
  } catch (err) {
    console.error('GET /api/payment-method-report error', err);
    return NextResponse.json({ error: 'Failed to load payment method report' }, { status: 500 });
  }
}
