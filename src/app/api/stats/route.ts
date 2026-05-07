import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import type { JobRow } from '../../../types/job';

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';
const COLLECTION_NAME = 'Job';

let cachedClient: MongoClient | null = null;

async function getClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const techs = searchParams.getAll('tech').map(t => t.trim()).filter(Boolean);
    const location = searchParams.get('location');
    const provider = searchParams.get('provider');

    const client = await getClient();
    const collection = client.db(DB_NAME).collection<JobRow>(COLLECTION_NAME);

    // Helper for safe number conversion in aggregation
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
      ],
    };

    const pipeline: any[] = [
      {
        $addFields: {
          dateParsed: {
            $dateFromString: { dateString: '$date', onError: null, onNull: null },
          },
        },
      },
    ];

    const matchStage: any = {};
    if (startDate || endDate) {
      const range: any = {};
      if (startDate) range.$gte = new Date(startDate);
      if (endDate) range.$lte = new Date(endDate);
      matchStage.dateParsed = { ...(range.$gte ? { $gte: range.$gte } : {}), ...(range.$lte ? { $lte: range.$lte } : {}) };
    }
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (techs.length > 0) {
      matchStage.$and = [
        ...(matchStage.$and || []),
        { tech: { $in: techs } },
      ];
    }
    if (location) {
      const regex = new RegExp(`^${escapeRegex(location)}$`, 'i');
      matchStage.$and = [
        ...(matchStage.$and || []),
        { $or: [{ location }, { location: { $regex: regex } }] },
      ];
    }
    if (provider) {
      const regex = new RegExp(`^${escapeRegex(provider)}$`, 'i');
      matchStage.provider = { $regex: regex };
    }
    if (Object.keys(matchStage).length) {
      pipeline.push({ $match: matchStage });
    }

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
          $cond: [
            { $gt: [toNumberAgg('$totalAmount'), 0] },
            toNumberAgg('$totalAmount'),
            paidSum
          ]
        }
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
              closedCount: {
                $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] },
              },
              totalAmountClosedOrXClose: {
                $sum: {
                  $cond: [
                    { $or: [{ $eq: ['$status', 'Closed'] }, { $eq: ['$status', 'X close'] }] },
                    '$valTotalAmount',
                    0,
                  ],
                },
              },
              totalAmountClosedOnly: {
                $sum: {
                  $cond: [
                    { $eq: ['$status', 'Closed'] },
                    '$valTotalAmount',
                    0,
                  ],
                },
              },
            },
          },
        ],
        byDate: [
          {
            $group: {
              _id: '$dateKey',
              count: { $sum: 1 },
              totalAmount: { $sum: '$valTotalAmount' },
              totalPaid: { $sum: toNumberAgg('$totalPaid') },
            },
          },
          { $sort: { _id: 1 } },
        ],
        byTech: [
          { $match: { tech: { $exists: true, $nin: [null, ''] } } },
          {
            $group: {
              _id: '$tech',
              count: { $sum: 1 },
              totalAmount: { $sum: '$valTotalAmount' },
              totalPaid: { $sum: toNumberAgg('$totalPaid') },
            },
          },
          { $sort: { count: -1, _id: 1 } },
        ],
        byLocation: [
          { $match: { location: { $exists: true, $nin: [null, ''] } } },
          {
            $group: {
              _id: '$location',
              count: { $sum: 1 },
              totalAmount: { $sum: '$valTotalAmount' },
              totalPaid: { $sum: toNumberAgg('$totalPaid') },
            },
          },
          { $sort: { count: -1, _id: 1 } },
        ],
        byStatus: [
          { $match: { status: { $exists: true, $nin: [null, ''] } } },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1, _id: 1 } },
        ],
        byProvider: [
          { $match: { provider: { $exists: true, $nin: [null, ''] } } },
          {
            $group: {
              _id: '$provider',
              count: { $sum: 1 },
              totalAmount: { $sum: '$valTotalAmount' },
              totalPaid: { $sum: toNumberAgg('$totalPaid') },
            },
          },
          { $sort: { count: -1, _id: 1 } },
        ],
      },
    });

    const [result] = await collection.aggregate(pipeline).toArray();

    const summaryDoc = result?.summary?.[0] || {
      count: 0,
      totalAmount: 0,
      totalPaid: 0,
      closedCount: 0,
    };

    const count = summaryDoc.count || 0;
    const totalAmount = summaryDoc.totalAmount || 0;
    const totalPaid = summaryDoc.totalPaid || 0;
    const closedCount = summaryDoc.closedCount || 0;
    const totalAmountClosedOrXClose = summaryDoc.totalAmountClosedOrXClose || 0;
    const totalAmountClosedOnly = summaryDoc.totalAmountClosedOnly || 0;

    return NextResponse.json({
      summary: {
        count,
        totalAmount,
        totalPaid,
        avgTicket: count ? totalAmountClosedOrXClose / count : 0,
        avgTicketWithoutPenalty: count ? totalAmountClosedOnly / count : 0,
        avgClosedTicket: closedCount ? totalAmount / closedCount : 0,
        closedRatio: count ? closedCount / count : 0,
      },
      byTech: (result?.byTech || []).map((r: any) => ({
        key: r._id ?? '',
        count: r.count ?? 0,
        totalAmount: r.totalAmount ?? 0,
        totalPaid: r.totalPaid ?? 0,
      })),
      byLocation: (result?.byLocation || []).map((r: any) => ({
        key: r._id ?? '',
        count: r.count ?? 0,
        totalAmount: r.totalAmount ?? 0,
        totalPaid: r.totalPaid ?? 0,
      })),
      byStatus: (result?.byStatus || []).map((r: any) => ({
        key: r._id ?? 'Unknown',
        count: r.count ?? 0,
      })),
      byProvider: (result?.byProvider || []).map((r: any) => ({
        key: r._id ?? '',
        count: r.count ?? 0,
        totalAmount: r.totalAmount ?? 0,
        totalPaid: r.totalPaid ?? 0,
      })),
    });
  } catch (err) {
    console.error('GET /api/stats error', err);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
