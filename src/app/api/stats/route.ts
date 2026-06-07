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
    const locations = searchParams.getAll('location').map((l) => l.trim()).filter(Boolean);
    const providers = searchParams.getAll('provider').map((p) => p.trim()).filter(Boolean);

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
        toNumberAgg('$lmCash'),
        toNumberAgg('$lmCheck'),
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
      // Use contains-style case-insensitive regex (mirrors /api/jobs filter
      // rule for tech). Anchored `^name$` was missing matches because some
      // Job.tech values differ from the Technician._id by trailing whitespace
      // or extra characters that the user-facing filter on /jobs ignores.
      matchStage.$and = [
        ...(matchStage.$and || []),
        { tech: { $in: techs.map((t) => new RegExp(escapeRegex(t), 'i')) } },
      ];
    }
    if (locations.length > 0) {
      // Match exact value OR case-insensitive equality across the selected list.
      const regexes = locations.map((l) => new RegExp(`^${escapeRegex(l)}$`, 'i'));
      matchStage.$and = [
        ...(matchStage.$and || []),
        { $or: [{ location: { $in: locations } }, { location: { $in: regexes } }] },
      ];
    }
    if (providers.length > 0) {
      const regexes = providers.map((p) => new RegExp(`^${escapeRegex(p)}$`, 'i'));
      matchStage.$and = [
        ...(matchStage.$and || []),
        { provider: { $in: regexes } },
      ];
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
        },
        // Used by avg-ticket calculation below — mirrors the report page's
        // provider-tab columns: Total Payment − Total Fees − Total Parts.
        // Excludes companyCheck fee (legacy provider-tab convention).
        // lmCheck has 0% fee per rule locked 2026-06-04. calcParts includes lmParts.
        valFeeNoCheck: {
          $add: [
            { $multiply: [toNumberAgg('$totalPaidCard'), 0.05] },
            { $multiply: [toNumberAgg('$totalPaidFinance'), 0.1] },
          ],
        },
        // All-kinds fee burden — card 5% + finance 10% + company check 10%.
        // lmCheck has 0% fee (the LM holds the paper check, no processor).
        // Used for the "Jobs Profit" KPI.
        valFeeAllKinds: {
          $add: [
            { $multiply: [toNumberAgg('$totalPaidCard'), 0.05] },
            { $multiply: [toNumberAgg('$totalPaidFinance'), 0.1] },
            { $multiply: [toNumberAgg('$totalPaidCompanyCheck'), 0.1] },
          ],
        },
        valParts: {
          $add: [
            toNumberAgg('$techParts'),
            toNumberAgg('$companyParts'),
            toNumberAgg('$lmParts'),
          ],
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
              closedCount: {
                $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] },
              },
              // Profit per job = totalPaid − feeNoCheck − parts
              // (matches the report page provider-tab column subtraction)
              profitClosedOrXClose: {
                $sum: {
                  $cond: [
                    { $or: [{ $eq: ['$status', 'Closed'] }, { $eq: ['$status', 'X close'] }] },
                    { $subtract: [{ $subtract: ['$totalPaid', '$valFeeNoCheck'] }, '$valParts'] },
                    0,
                  ],
                },
              },
              profitClosedOnly: {
                $sum: {
                  $cond: [
                    { $eq: ['$status', 'Closed'] },
                    { $subtract: [{ $subtract: ['$totalPaid', '$valFeeNoCheck'] }, '$valParts'] },
                    0,
                  ],
                },
              },
              // Jobs Profit = totalSales − all payment fees − all parts (Closed only).
              jobsProfit: {
                $sum: {
                  $cond: [
                    { $eq: ['$status', 'Closed'] },
                    { $subtract: [{ $subtract: ['$valTotalAmount', '$valFeeAllKinds'] }, '$valParts'] },
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
    const profitClosedOrXClose = summaryDoc.profitClosedOrXClose || 0;
    const profitClosedOnly = summaryDoc.profitClosedOnly || 0;
    const jobsProfit = summaryDoc.jobsProfit || 0;

    return NextResponse.json({
      summary: {
        count,
        totalAmount,
        totalPaid,
        // Total profit = Σ (Total Payment − Total Fees − Total Parts) across
        // Closed + X close jobs. Same scope and definition as the avg ticket
        // numerator, just not divided.
        totalProfit: profitClosedOrXClose,
        // Jobs Profit (Closed only) = totalSales − all payment fees − all parts.
        // Fees include card 5% + finance 10% + companyCheck 10%. lmCheck = 0%.
        jobsProfit,
        // Avg ticket = (Total Payment − Total Fees − Total Parts) / jobs
        // sourced from the same payment/fees/parts breakdown shown on the
        // report page provider tab.
        avgTicket: count ? profitClosedOrXClose / count : 0,
        avgTicketWithoutPenalty: count ? profitClosedOnly / count : 0,
        // Avg Closed Ticket = total profit on Closed jobs / count of Closed
        // jobs. Uses `jobsProfit` which is the closed-only profit pool
        // already aggregated above (valTotalAmount − all fees − all parts,
        // summed across status = 'Closed'). The previous formula divided
        // valTotalAmount across *every* job by the closed count, producing
        // a misleadingly inflated number.
        avgClosedTicket: closedCount ? jobsProfit / closedCount : 0,
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
