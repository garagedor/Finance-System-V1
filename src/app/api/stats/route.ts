import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import type { JobRow } from '../../../types/job';
import { ensureJobMirrorsFresh } from '@/lib/job-mirror';
import { SRC_STATUS_EXPR, SRC_DATE_EXPR } from '@/lib/report-source-match';

const DB_NAME = 'ag';
const COLLECTION_NAME = 'Job';

let cachedClient: MongoClient | null = null;

async function getClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const client = await getMongoClient();
  await client.connect();
  cachedClient = client;
  return client;
}

export interface StatsQuery {
  startDate?: string | null;
  endDate?: string | null;
  techs?: string[];
  locations?: string[];
  providers?: string[];
}

export interface StatRow { key: string; count: number; totalAmount: number; totalPaid: number }
export interface StatusRow { key: string; count: number }
export interface StatsResult {
  summary: {
    count: number;
    totalAmount: number;
    totalPaid: number;
    totalProfit: number;
    jobsProfit: number;
    avgTicket: number;
    avgTicketWithoutPenalty: number;
    avgClosedTicket: number;
    closedRatio: number;
  };
  byTech: StatRow[];
  byLocation: StatRow[];
  byStatus: StatusRow[];
  byProvider: StatRow[];
}

// Shared stats aggregation — the on-screen Statistics page (via GET) and the
// Statistics PDF both call this, so screen and print can never disagree.
export async function computeStats(q: StatsQuery): Promise<StatsResult> {
  await ensureJobMirrorsFresh().catch(() => {});
  const startDate = q.startDate;
  const endDate = q.endDate;
  const techs = (q.techs ?? []).map((t) => t.trim()).filter(Boolean);
  const locations = (q.locations ?? []).map((l) => l.trim()).filter(Boolean);
  const providers = (q.providers ?? []).map((p) => p.trim()).filter(Boolean);

  const client = await getClient();
  const collection = client.db(DB_NAME).collection<JobRow>(COLLECTION_NAME);

  const toNumberAgg = (field: string) => ({
    $convert: { input: field, to: 'double', onError: 0, onNull: 0 },
  });

  const paidSum = {
    $add: [
      toNumberAgg('$techPaidCash'),
      toNumberAgg('$totalPaidCard'),
      toNumberAgg('$totalPaidCompanyCheck'),
      toNumberAgg('$totalPaidFinance'),
      toNumberAgg('$totalPaidCompanyCash'),
      toNumberAgg('$lmCash'),
      toNumberAgg('$lmCheck'),
    ],
  };

  const pipeline: Record<string, unknown>[] = [
    {
      $addFields: {
        dateParsed: SRC_DATE_EXPR,
        _srcStatus: SRC_STATUS_EXPR,
      },
    },
  ];

  const matchStage: Record<string, unknown> = {};
  if (startDate || endDate) {
    const range: { $gte?: Date; $lte?: Date } = {};
    if (startDate) range.$gte = new Date(startDate);
    if (endDate) range.$lte = new Date(endDate);
    matchStage.dateParsed = { ...(range.$gte ? { $gte: range.$gte } : {}), ...(range.$lte ? { $lte: range.$lte } : {}) };
  }
  const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const and: Record<string, unknown>[] = [];

  if (techs.length > 0) {
    and.push({ tech: { $in: techs.map((t) => new RegExp(escapeRegex(t), 'i')) } });
  }
  if (locations.length > 0) {
    const regexes = locations.map((l) => new RegExp(`^${escapeRegex(l)}$`, 'i'));
    and.push({ $or: [{ location: { $in: locations } }, { location: { $in: regexes } }] });
  }
  if (providers.length > 0) {
    const regexes = providers.map((p) => new RegExp(`^${escapeRegex(p)}$`, 'i'));
    and.push({ provider: { $in: regexes } });
  }
  if (and.length) matchStage.$and = and;
  if (Object.keys(matchStage).length) pipeline.push({ $match: matchStage });

  pipeline.push({
    $addFields: {
      dateKey: {
        $cond: [
          { $eq: ['$dateParsed', null] },
          '$date',
          { $dateToString: { format: '%Y-%m-%d', date: '$dateParsed' } },
        ],
      },
      totalPaid: paidSum,
      valTotalAmount: {
        $cond: [{ $gt: [toNumberAgg('$totalAmount'), 0] }, toNumberAgg('$totalAmount'), paidSum],
      },
      valFeeNoCheck: {
        $add: [
          { $multiply: [toNumberAgg('$totalPaidCard'), 0.05] },
          { $multiply: [toNumberAgg('$totalPaidFinance'), 0.1] },
        ],
      },
      valFeeAllKinds: {
        $add: [
          { $multiply: [toNumberAgg('$totalPaidCard'), 0.05] },
          { $multiply: [toNumberAgg('$totalPaidFinance'), 0.1] },
          { $multiply: [toNumberAgg('$totalPaidCompanyCheck'), 0.1] },
        ],
      },
      valParts: {
        $add: [toNumberAgg('$techParts'), toNumberAgg('$companyParts'), toNumberAgg('$lmParts')],
      },
    },
  });

  pipeline.push({
    $facet: {
      summary: [
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalAmount: { $sum: '$valTotalAmount' },
            totalPaid: { $sum: toNumberAgg('$totalPaid') },
            closedCount: { $sum: { $cond: [{ $eq: ['$_srcStatus', 'Closed'] }, 1, 0] } },
            profitClosedOrXClose: {
              $sum: {
                $cond: [
                  { $or: [{ $eq: ['$_srcStatus', 'Closed'] }, { $eq: ['$_srcStatus', 'X close'] }] },
                  { $subtract: [{ $subtract: ['$totalPaid', '$valFeeNoCheck'] }, '$valParts'] },
                  0,
                ],
              },
            },
            profitClosedOnly: {
              $sum: {
                $cond: [
                  { $eq: ['$_srcStatus', 'Closed'] },
                  { $subtract: [{ $subtract: ['$totalPaid', '$valFeeNoCheck'] }, '$valParts'] },
                  0,
                ],
              },
            },
            jobsProfit: {
              $sum: {
                $cond: [
                  { $eq: ['$_srcStatus', 'Closed'] },
                  { $subtract: [{ $subtract: ['$valTotalAmount', '$valFeeAllKinds'] }, '$valParts'] },
                  0,
                ],
              },
            },
          },
        },
      ],
      byTech: [
        { $match: { tech: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$tech', count: { $sum: 1 }, totalAmount: { $sum: '$valTotalAmount' }, totalPaid: { $sum: toNumberAgg('$totalPaid') } } },
        { $sort: { count: -1, _id: 1 } },
      ],
      byLocation: [
        { $match: { location: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$location', count: { $sum: 1 }, totalAmount: { $sum: '$valTotalAmount' }, totalPaid: { $sum: toNumberAgg('$totalPaid') } } },
        { $sort: { count: -1, _id: 1 } },
      ],
      byStatus: [
        { $match: { _srcStatus: { $nin: [null, ''] } } },
        { $group: { _id: '$_srcStatus', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ],
      byProvider: [
        { $match: { provider: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$provider', count: { $sum: 1 }, totalAmount: { $sum: '$valTotalAmount' }, totalPaid: { $sum: toNumberAgg('$totalPaid') } } },
        { $sort: { count: -1, _id: 1 } },
      ],
    },
  });

  const [result] = await collection.aggregate(pipeline).toArray();
  const summaryDoc = result?.summary?.[0] || { count: 0, totalAmount: 0, totalPaid: 0, closedCount: 0 };

  const count = summaryDoc.count || 0;
  const totalAmount = summaryDoc.totalAmount || 0;
  const totalPaid = summaryDoc.totalPaid || 0;
  const closedCount = summaryDoc.closedCount || 0;
  const profitClosedOrXClose = summaryDoc.profitClosedOrXClose || 0;
  const profitClosedOnly = summaryDoc.profitClosedOnly || 0;
  const jobsProfit = summaryDoc.jobsProfit || 0;

  const mapRow = (r: { _id?: unknown; count?: number; totalAmount?: number; totalPaid?: number }): StatRow => ({
    key: (r._id as string) ?? '',
    count: r.count ?? 0,
    totalAmount: r.totalAmount ?? 0,
    totalPaid: r.totalPaid ?? 0,
  });

  return {
    summary: {
      count,
      totalAmount,
      totalPaid,
      totalProfit: profitClosedOrXClose,
      jobsProfit,
      avgTicket: count ? profitClosedOrXClose / count : 0,
      avgTicketWithoutPenalty: count ? profitClosedOnly / count : 0,
      avgClosedTicket: closedCount ? jobsProfit / closedCount : 0,
      closedRatio: count ? closedCount / count : 0,
    },
    byTech: (result?.byTech || []).map(mapRow),
    byLocation: (result?.byLocation || []).map(mapRow),
    byStatus: (result?.byStatus || []).map((r: { _id?: unknown; count?: number }) => ({ key: (r._id as string) ?? 'Unknown', count: r.count ?? 0 })),
    byProvider: (result?.byProvider || []).map(mapRow),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const data = await computeStats({
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      techs: searchParams.getAll('tech'),
      locations: searchParams.getAll('location'),
      providers: searchParams.getAll('provider'),
    });
    return NextResponse.json(data);
  } catch (err) {
    console.error('GET /api/stats error', err);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
