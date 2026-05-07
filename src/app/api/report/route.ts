import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';
import type { Dispute, JobRow, Provider, Technician, Refund } from '../../../types/job';
import {
  calcJobProfit,
  calcOldBalance,
  calcParts,
  calcPaidSum,
  calcPaymentFeeNoCheck,
  calcTotalAfterFee,
  calcStandardShare,
  calcTipsTotal,
  calcTechShare,
  calcProviderShare,
  toNumber,
} from '../utils/calculations';

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';
const JOB_COLLECTION = 'Job';
const DISPUTE_COLLECTION = 'Dispute';
const REFUND_COLLECTION = 'Refund';
const PROVIDER_COLLECTION = 'Provider';
const TECH_COLLECTION = 'Technician';
const LOCATION_COLLECTION = 'Location';

type ReportType = 'penalty' | 'dispute' | 'refund' | 'provider';

let cachedClient: MongoClient | null = null;

async function getClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(MONGODB_URI);
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

const parseObjectId = (id: string) => {
  if (ObjectId.isValid(id)) {
    try {
      return new ObjectId(id);
    } catch {
      return null;
    }
  }
  return null;
};

const buildJobMap = async (jobCol: any, ids: string[]) => {
  const objectIds = ids
    .map((id) => parseObjectId(id))
    .filter((id): id is ObjectId => !!id);

  const clauses: Array<{ _id: any }> = [];
  if (objectIds.length) clauses.push({ _id: { $in: objectIds } });
  if (ids.length) clauses.push({ _id: { $in: ids } });
  const filter = clauses.length ? { $or: clauses } : { _id: { $in: [] as any[] } };

  const jobs = await jobCol.find(filter).toArray();
  const map = new Map<string, JobRow>();
  jobs.forEach((job: any) => {
    const key = (job as any)._id?.toString() || '';
    map.set(key, { ...(job as JobRow), _id: key });
  });
  return map;
};

// Basic financials for penalty and provider reports
const computeBasicFinancials = (job: JobRow) => {
  const totalPaid = calcPaidSum(job);
  const totalFees = calcPaymentFeeNoCheck(job);
  const totalAfterFee = calcTotalAfterFee(job);
  const parts = calcParts(job);
  const totalProfit = calcJobProfit(totalAfterFee, parts);

  return { totalPaid, totalFees, totalAfterFee, parts, totalProfit };
};

// Full financials for dispute and refund reports (includes tech-specific calculations)
const computeDisputeRefundFinancials = (job: JobRow, techMap: Map<string, Technician>, locationMap: Map<string, any>) => {
  const techDoc = job.tech ? techMap.get(job.tech) : undefined;
  const techProfitPercent = techDoc?.profitPercent ?? 0;

  const locationDoc = job.location ? locationMap.get(job.location) : undefined;
  const managerProfitPercent = locationDoc?.managerProfitPercent ?? 0;

  const totalPaid = calcPaidSum(job);
  const totalAfterFee = calcTotalAfterFee(job);
  const parts = calcParts(job);
  const netoTips = calcTipsTotal(job, { includeCheck: false, includeCompanyCashBonus: false });
  const oldBalance = calcOldBalance(totalAfterFee, parts, job.techPaidCash || 0, techProfitPercent);
  const totalProfit = calcJobProfit(totalAfterFee, parts);

  return {
    totalPaid,
    totalAfterFee,
    parts,
    netoTips,
    oldBalance,
    totalProfit,
    techProfitPercent,
    managerProfitPercent
  };
};

const buildDateRangeFilter = (dateField: string, startDate: Date | null, endDate: Date | null) => {
  if (!startDate && !endDate) return {};

  return {
    $expr: {
      $and: [
        ...(startDate ? [{
          $gte: [{ $dateFromString: { dateString: `$${dateField}`, onError: null, onNull: null } }, startDate]
        }] : []),
        ...(endDate ? [{
          $lte: [{ $dateFromString: { dateString: `$${dateField}`, onError: null, onNull: null } }, endDate]
        }] : [])
      ]
    }
  };
};

const filterJobByParams = (job: JobRow | undefined, techs: string[], location: string, provider: string) => {
  if (!job) return false;
  if (techs.length > 0 && !techs.includes(job.tech || '')) return false;
  if (location && job.location !== location) return false;
  if (provider && job.provider !== provider) return false;
  return true;
};

// Direct usage of centralized helpers to ensure type safety and logic consistency

const buildJobPipeline = (
  match: Record<string, any>,
  startDate: Date | null,
  endDate: Date | null,
  page: number,
  pageSize: number
) => {
  const pipeline: any[] = [
    {
      $addFields: {
        dateParsed: {
          $dateFromString: { dateString: '$date', onError: null, onNull: null },
        },
      },
    },
  ];

  if (startDate || endDate) {
    const range: any = {};
    if (startDate) range.$gte = startDate;
    if (endDate) range.$lte = endDate;
    match.dateParsed = { ...(range.$gte ? { $gte: range.$gte } : {}), ...(range.$lte ? { $lte: range.$lte } : {}) };
  }

  if (Object.keys(match).length) {
    pipeline.push({ $match: match });
  }

  return {
    dataPipeline: [
      ...pipeline,
      { $sort: { dateParsed: -1, _id: -1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
    ],
    countPipeline: [...pipeline, { $count: 'count' }],
  };
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = (searchParams.get('type') as ReportType) || 'penalty';
    const startDate = toDate(searchParams.get('startDate'));
    const endDate = inclusiveEnd(searchParams.get('endDate'));
    const techs = searchParams.getAll('tech').map(t => t.trim()).filter(Boolean);
    const location = searchParams.get('location')?.trim() || '';
    const provider = searchParams.get('provider')?.trim() || '';
    const page = Math.max(1, Number(searchParams.get('page') || '1'));
    const pageSize = Math.max(1, Math.min(200, Number(searchParams.get('pageSize') || '50')));

    if (!['penalty', 'dispute', 'refund', 'provider'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    const client = await getClient();
    const db = client.db(DB_NAME);
    const jobCol = db.collection<JobRow>(JOB_COLLECTION);
    const providerCol = db.collection<Provider>(PROVIDER_COLLECTION);
    const techCol = db.collection<Technician>(TECH_COLLECTION);
    const locationCol = db.collection(LOCATION_COLLECTION);

    const providerMap = new Map<string, Provider>();
    (await providerCol.find({}).toArray()).forEach((p: any) =>
      providerMap.set((p as any)._id?.toString() || '', { ...(p as Provider), _id: (p as any)._id?.toString() || '' })
    );
    const techMap = new Map<string, Technician>();
    (await techCol.find({}).toArray()).forEach((t: any) =>
      techMap.set((t as any)._id?.toString() || '', { ...(t as Technician), _id: (t as any)._id?.toString() || '' })
    );
    const locationMap = new Map<string, any>();
    (await locationCol.find({}).toArray()).forEach((l: any) =>
      locationMap.set((l as any)._id?.toString() || '', { ...l, _id: (l as any)._id?.toString() || '' })
    );

    if (type === 'penalty') {
      const match: Record<string, any> = {};
      if (techs.length > 0) match.tech = { $in: techs };
      if (location) match.location = location;
      if (provider) match.provider = provider;
      match.status = 'X close';

      const { dataPipeline, countPipeline } = buildJobPipeline(match, startDate, endDate, page, pageSize);

      const [jobs, totalCountAgg] = await Promise.all([
        jobCol.aggregate(dataPipeline).toArray(),
        jobCol.aggregate(countPipeline).toArray(),
      ]);
      const total = totalCountAgg[0]?.count || jobs.length;

      const mapPenaltyJob = (job: any) => {
        const providerDoc = job.provider ? providerMap.get(job.provider) : undefined;
        const profitPercent = providerDoc?.profitPercent ?? 0;
        const { totalPaid, parts } = computeBasicFinancials(job);
        const jobProfit = calcJobProfit(totalPaid, parts);
        const totalLoss = calcStandardShare(jobProfit, profitPercent);
        const amLoss = toNumber(totalLoss) * 0.5;

        return {
          id: (job as any)._id?.toString() || '',
          date: job.date || '',
          address: job.address || '',
          tech: job.tech || '',
          location: job.location || '',
          provider: job.provider || '',
          jobProfit,
          totalLoss,
          amLoss,
        };
      };

      const rows = jobs.map(mapPenaltyJob);
      let totals = null;
      if (searchParams.get('calculateTotals') === 'true') {
        const allJobs = await jobCol.aggregate(dataPipeline.slice(0, -2)).toArray();
        totals = allJobs.map(mapPenaltyJob).reduce((acc, row) => {
          acc.jobProfit += row.jobProfit;
          acc.totalLoss += row.totalLoss;
          acc.amLoss += row.amLoss;
          return acc;
        }, { jobProfit: 0, totalLoss: 0, amLoss: 0 });
      }

      return NextResponse.json({ type: 'penalty', rows, page, pageSize, total, totals });
    }

    if (type === 'provider') {
      const match: Record<string, any> = {};
      if (techs.length > 0) match.tech = { $in: techs };
      if (location) match.location = location;
      if (provider) match.provider = provider;
      match.status = { $in: ['Closed', 'X close'] };

      const { dataPipeline, countPipeline } = buildJobPipeline(match, startDate, endDate, page, pageSize);

      const [jobs, totalCountAgg] = await Promise.all([
        jobCol.aggregate(dataPipeline).toArray(),
        jobCol.aggregate(countPipeline).toArray(),
      ]);
      const total = totalCountAgg[0]?.count || jobs.length;

      const mapProviderJob = (job: any) => {
        const providerDoc = job.provider ? providerMap.get(job.provider) : undefined;
        const providerPercent = providerDoc?.profitPercent ?? 0;
        const { totalPaid, totalFees, parts: totalParts, totalProfit } = computeBasicFinancials(job);
        const providerShare = calcStandardShare(totalProfit, providerPercent);

        return {
          id: (job as any)._id?.toString() || '',
          date: job.date || '',
          address: job.address || '',
          provider: job.provider || '',
          totalPayment: totalPaid,
          totalFees,
          totalParts,
          totalProfit,
          providerShare,
        };
      };

      const rows = jobs.map(mapProviderJob);
      let totals = null;
      if (searchParams.get('calculateTotals') === 'true') {
        const allJobs = await jobCol.aggregate(dataPipeline.slice(0, -2)).toArray();
        totals = allJobs.map(mapProviderJob).reduce((acc, row) => {
          acc.totalPayment += row.totalPayment;
          acc.totalFees += row.totalFees;
          acc.totalParts += row.totalParts;
          acc.totalProfit += row.totalProfit;
          acc.providerShare += row.providerShare;
          return acc;
        }, { totalPayment: 0, totalFees: 0, totalParts: 0, totalProfit: 0, providerShare: 0 });
      }

      return NextResponse.json({ type: 'provider', rows, page, pageSize, total, totals });
    }

    if (type === 'dispute') {
      const disputeCol = db.collection<Dispute>(DISPUTE_COLLECTION);
      const disputeFilter = buildDateRangeFilter('disputeDate', startDate, endDate);
      const disputes = await disputeCol.find(disputeFilter).toArray();
      const jobIds = disputes.map((d: any) => (d as any).jobId as string).filter(Boolean);
      const jobMap = await buildJobMap(jobCol, jobIds);

      const filtered = disputes.flatMap((d: any) => {
        const dispute = d as Dispute & { _id?: any };
        const jobId = (dispute.jobId || '').toString();
        const job = jobMap.get(jobId) || jobMap.get(jobId.trim()) || jobMap.get(parseObjectId(jobId)?.toString() || '');

        if (!filterJobByParams(job, techs, location, provider)) return [];

        const {
          totalPaid,
          totalAfterFee,
          parts,
          netoTips,
          oldBalance,
          totalProfit,
          techProfitPercent,
          managerProfitPercent
        } = computeDisputeRefundFinancials(job!, techMap, locationMap);

        const providerDoc = job!.provider ? providerMap.get(job!.provider) : undefined;
        const providerPercent = providerDoc?.profitPercent ?? 0;

        const disputed = (dispute as any).totalDisputed ?? 0;
        const status = (dispute as any).status ?? '';
        const newBalance = 0;
        const disputedShare = toNumber(newBalance) - toNumber(oldBalance);
        const techShare = calcTechShare(netoTips, disputed, totalProfit, techProfitPercent);
        const locationManagerShare = calcTechShare(netoTips, disputed, totalProfit, managerProfitPercent);
        const providerShare = calcProviderShare(netoTips, disputed, totalProfit, providerPercent);

        return [
          {
            id: jobId,
            disputeId: (dispute as any)._id?.toString() || '',
            status,
            date: job?.date || '',
            address: job?.address || '',
            tech: job?.tech || '',
            location: job?.location || '',
            provider: job?.provider || '',
            totalPaid,
            totalAfterFee,
            parts,
            netoTips,
            oldBalance,
            disputed,
            newBalance,
            disputedShare,
            techShare,
            locationManagerShare,
            providerShare,
          },
        ];
      });

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const rows = filtered.slice(start, start + pageSize);

      let totals = null;
      if (searchParams.get('calculateTotals') === 'true') {
        totals = filtered.reduce((acc, row) => {
          acc.totalPaid += row.totalPaid;
          acc.totalAfterFee += row.totalAfterFee;
          acc.parts += row.parts;
          acc.netoTips += row.netoTips;
          acc.oldBalance += row.oldBalance;
          acc.disputed += row.disputed;
          acc.newBalance += row.newBalance;
          acc.disputedShare += row.disputedShare;
          acc.techShare += row.techShare;
          acc.locationManagerShare += row.locationManagerShare;
          acc.providerShare += row.providerShare;
          return acc;
        }, {
          totalPaid: 0, totalAfterFee: 0, parts: 0, netoTips: 0, oldBalance: 0,
          disputed: 0, newBalance: 0, disputedShare: 0, techShare: 0,
          locationManagerShare: 0, providerShare: 0
        });
      }

      return NextResponse.json({ type: 'dispute', rows, page, pageSize, total, totals });
    }

    // refund report
    const refundCol = db.collection<Refund>(REFUND_COLLECTION);
    const refundFilter = buildDateRangeFilter('dateRefunded', startDate, endDate);
    const refunds = await refundCol.find(refundFilter).toArray();
    const refundJobIds = refunds.map((r: any) => (r as any).jobId as string).filter(Boolean);
    const refundJobMap = await buildJobMap(jobCol, refundJobIds);

    const refundRowsAll = refunds.flatMap((r: any) => {
      const refund = r as Refund & { _id?: any };
      const jobId = (refund.jobId || '').toString();
      const job = refundJobMap.get(jobId) || refundJobMap.get(jobId.trim()) || refundJobMap.get(parseObjectId(jobId)?.toString() || '');

      if (!filterJobByParams(job, techs, location, provider)) return [];

      const {
        totalPaid,
        totalAfterFee,
        parts,
        netoTips,
        oldBalance,
        totalProfit,
        techProfitPercent,
        managerProfitPercent
      } = computeDisputeRefundFinancials(job!, techMap, locationMap);

      const providerDoc = job!.provider ? providerMap.get(job!.provider) : undefined;
      const providerPercent = providerDoc?.profitPercent ?? 0;

      const refunded = (refund as any).refundTotal ?? 0;
      const reason = (refund as any).reason ?? '';
      const newBalance = 0;
      const disputedShare = toNumber(newBalance) - toNumber(oldBalance);
      const techShare = calcTechShare(netoTips, refunded, totalProfit, techProfitPercent);
      const locationManagerShare = calcTechShare(netoTips, refunded, totalProfit, managerProfitPercent);
      const providerShare = calcProviderShare(netoTips, refunded, totalProfit, providerPercent);

      return [
        {
          id: jobId,
          refundId: (refund as any)._id?.toString() || '',
          date: job?.date || '',
          address: job?.address || '',
          tech: job?.tech || '',
          location: job?.location || '',
          provider: job?.provider || '',
          totalPaid,
          totalAfterFee,
          parts,
          netoTips,
          oldBalance,
          refunded,
          reason,
          newBalance,
          disputedShare,
          techShare,
          locationManagerShare,
          providerShare,
        },
      ];
    });

    const total = refundRowsAll.length;
    const start = (page - 1) * pageSize;
    const rows = refundRowsAll.slice(start, start + pageSize);

    let totals = null;
    if (searchParams.get('calculateTotals') === 'true') {
      totals = refundRowsAll.reduce((acc, row) => {
        acc.totalPaid += row.totalPaid;
        acc.totalAfterFee += row.totalAfterFee;
        acc.parts += row.parts;
        acc.netoTips += row.netoTips;
        acc.oldBalance += row.oldBalance;
        acc.refunded += row.refunded;
        acc.newBalance += row.newBalance;
        acc.disputedShare += row.disputedShare;
        acc.techShare += row.techShare;
        acc.locationManagerShare += row.locationManagerShare;
        acc.providerShare += row.providerShare;
        return acc;
      }, {
        totalPaid: 0, totalAfterFee: 0, parts: 0, netoTips: 0, oldBalance: 0,
        refunded: 0, newBalance: 0, disputedShare: 0, techShare: 0,
        locationManagerShare: 0, providerShare: 0
      });
    }

    return NextResponse.json({ type: 'refund', rows, page, pageSize, total, totals });
  } catch (err) {
    console.error('GET /api/report error', err);
    return NextResponse.json({ error: 'Failed to load report' }, { status: 500 });
  }
}
