import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import { ServerTiming } from "@/lib/server-timing";
import { JobRow } from '../../../types/job';
import { ensureJobMirrorsFresh } from '@/lib/job-mirror';

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

export async function GET(req: NextRequest) {
    try {
        await ensureJobMirrorsFresh().catch(() => {});
        const { searchParams } = new URL(req.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        const client = await getClient();
        const collection = client.db(DB_NAME).collection<JobRow>(COLLECTION_NAME);

        const matchStage: any = {};
        if (startDate || endDate) {
            // Index-backed range on the normalized date. Identical result set to
            // the previous $dateFromString match (jobDateNormalized === that parse;
            // missing/blank dates are excluded from a bounded range either way),
            // but now uses the jobDateNormalized index instead of a full scan.
            matchStage.jobDateNormalized = {};
            if (startDate) matchStage.jobDateNormalized.$gte = new Date(startDate);
            if (endDate) matchStage.jobDateNormalized.$lte = new Date(endDate);
        }

        // Helper for safe number conversion in aggregation
        const toNumber = (field: string) => ({
            $convert: { input: field, to: 'double', onError: 0, onNull: 0 },
        });

        const pipeline: any[] = [
            { $match: matchStage },
            // Lookups
            {
                $lookup: {
                    from: 'Location',
                    localField: 'location',
                    foreignField: '_id',
                    as: 'locationData',
                },
            },
            {
                $unwind: {
                    path: '$locationData',
                    preserveNullAndEmptyArrays: true,
                },
            },
            // Provider profit %: resolve by _id first, else by name — two plain
            // (hash-join) lookups instead of a correlated per-document sub-pipeline.
            // DATA-QUALITY CORRECTION (owner-approved 2026-07-30): the old
            // correlated `$or [_id==p, name==p]` matched ALL 113 providers for the
            // 5 jobs whose `provider` is blank, so `$unwind` counted each of those
            // jobs 113× — inflating jobsByLocation/techStats/locationStats counts
            // and skewing avgTicket/closedPct. Resolving to a single provider doc
            // (or none) counts every job exactly once. Also removes the per-document
            // Provider scan that dominated latency.
            {
                $lookup: { from: 'Provider', localField: 'provider', foreignField: '_id', as: 'provById' },
            },
            {
                $lookup: { from: 'Provider', localField: 'provider', foreignField: 'name', as: 'provByName' },
            },
            {
                $addFields: {
                    providerData: {
                        $ifNull: [
                            { $arrayElemAt: ['$provById', 0] },
                            { $arrayElemAt: ['$provByName', 0] },
                        ],
                    },
                },
            },
            {
                $addFields: {
                    locationManagerProfit: toNumber('$locationData.managerProfitPercent'),
                    providerProfit: toNumber('$providerData.profitPercent'),

                    valPaidSum: {
                        $add: [
                            toNumber('$techPaidCash'),
                            toNumber('$totalPaidCard'),
                            toNumber('$totalPaidCompanyCheck'),
                            toNumber('$totalPaidFinance'),
                            toNumber('$totalPaidCompanyCash'),
                            toNumber('$lmCash'),
                            toNumber('$lmCheck'),
                        ],
                    },
                    // Payment fee — card 5% + finance 10% + companyCheck 10%.
                    // lmCheck = 0% (rule locked 2026-06-04: only company
                    // check carries the 10%; the LM holds the paper check).
                    valPaymentFee: {
                        $add: [
                            { $multiply: [toNumber('$totalPaidCard'), 0.05] },
                            { $multiply: [toNumber('$totalPaidFinance'), 0.1] },
                            { $multiply: [toNumber('$totalPaidCompanyCheck'), 0.1] }
                        ]
                    },
                    valParts: { $add: [toNumber('$techParts'), toNumber('$companyParts'), toNumber('$lmParts')] },
                    valTotalAmount: {
                        $cond: [
                            { $gt: [toNumber('$totalAmount'), 0] },
                            toNumber('$totalAmount'),
                            {
                                $add: [
                                    toNumber('$techPaidCash'),
                                    toNumber('$totalPaidCard'),
                                    toNumber('$totalPaidCompanyCheck'),
                                    toNumber('$totalPaidFinance'),
                                    toNumber('$totalPaidCompanyCash'),
                                    toNumber('$lmCash'),
                                    toNumber('$lmCheck'),
                                ]
                            }
                        ]
                    },
                    // Total parts cost on the job — tech parts + company parts
                    // + LM parts. The KPI label is "Parts" (all kinds).
                    valCompanyParts: { $add: [toNumber('$techParts'), toNumber('$companyParts'), toNumber('$lmParts')] }
                },
            },
            {
                $addFields: {
                    valTotalProfit: {
                        $subtract: [
                            { $subtract: ['$valPaidSum', '$valParts'] },
                            '$valPaymentFee'
                        ]
                    }
                }
            },
            {
                $facet: {
                    jobsByLocation: [
                        { $match: { location: { $nin: [null, ''] } } },
                        {
                            $group: {
                                _id: '$location',
                                count: { $sum: 1 },
                            },
                        },
                        { $sort: { count: -1 } },
                    ],
                    techStats: [
                        { $match: { tech: { $nin: [null, ''] } } },
                        {
                            $group: {
                                _id: '$tech',
                                count: { $sum: 1 },
                                // Match Balance Report's avgTicket: sum of
                                // totalProfit across non-X-close jobs, divided
                                // by ALL assigned jobs (X-close still in count).
                                sumProfitExclXClose: {
                                    $sum: {
                                        $cond: [{ $ne: ['$statusCanonical', 'X close'] }, '$valTotalProfit', 0]
                                    }
                                },
                                closedCount: {
                                    $sum: { $cond: [{ $eq: ['$statusCanonical', 'Closed'] }, 1, 0] }
                                }
                            },
                        },
                        {
                            $project: {
                                tech: '$_id',
                                avgTicket: { $cond: [{ $gt: ['$count', 0] }, { $divide: ['$sumProfitExclXClose', '$count'] }, 0] },
                                closedPct: { $cond: [{ $gt: ['$count', 0] }, { $multiply: [{ $divide: ['$closedCount', '$count'] }, 100] }, 0] },
                                count: 1
                            }
                        }
                    ],
                    locationStats: [
                        { $match: { location: { $nin: [null, ''] } } },
                        {
                            $group: {
                                _id: '$location',
                                count: { $sum: 1 },
                                // Match Balance Report's avgTicket: sum of
                                // totalProfit across non-X-close jobs, divided
                                // by ALL assigned jobs (X-close still in count).
                                sumProfitExclXClose: {
                                    $sum: {
                                        $cond: [{ $ne: ['$statusCanonical', 'X close'] }, '$valTotalProfit', 0]
                                    }
                                },
                                closedCount: {
                                    $sum: { $cond: [{ $eq: ['$statusCanonical', 'Closed'] }, 1, 0] }
                                }
                            },
                        },
                        {
                            $project: {
                                location: '$_id',
                                avgTicket: { $cond: [{ $gt: ['$count', 0] }, { $divide: ['$sumProfitExclXClose', '$count'] }, 0] },
                                closedPct: { $cond: [{ $gt: ['$count', 0] }, { $multiply: [{ $divide: ['$closedCount', '$count'] }, 100] }, 0] },
                                count: 1
                            }
                        }
                    ],
                    companyPenaltyLoss: [
                        { $match: { statusCanonical: 'X close', location: { $nin: [null, ''] } } },
                        {
                            $addFields: {
                                penaltyBase: '$valTotalProfit'
                            }
                        },
                        {
                            $group: {
                                _id: '$location',
                                totalPenaltyLoss: { $sum: { $divide: ['$penaltyBase', 4] } },
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { _id: 1 } }
                    ],
                    companyNetProfit: [
                        { $match: { statusCanonical: 'Closed', location: { $nin: [null, ''] } } },
                        {
                            $addFields: {
                                netProfitCalc: {
                                    $subtract: [
                                        {
                                            $subtract: [
                                                '$valTotalProfit',
                                                { $multiply: ['$valTotalProfit', { $divide: ['$locationManagerProfit', 100] }] }
                                            ]
                                        },
                                        { $multiply: ['$valTotalProfit', { $divide: ['$providerProfit', 100] }] }
                                    ]
                                }
                            }
                        },
                        {
                            $group: {
                                _id: '$location',
                                totalNetProfit: { $sum: '$netProfitCalc' },
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { _id: 1 } }
                    ],
                    totalCompanyParts: [
                        // Closed-only — parts on open / X-close jobs don't roll into this KPI.
                        { $match: { statusCanonical: 'Closed', location: { $nin: [null, ''] } } },
                        {
                            $group: {
                                _id: '$location',
                                totalParts: { $sum: '$valCompanyParts' },
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { _id: 1 } }
                    ],
                    // Card-fee margin: tech is charged 5%, processor takes 3%,
                    // so the company keeps 2% of every closed-job card payment.
                    cardFeeProfit: [
                        { $match: { statusCanonical: 'Closed' } },
                        {
                            $group: {
                                _id: null,
                                totalCardFeeProfit: { $sum: { $multiply: [toNumber('$totalPaidCard'), 0.02] } },
                                // Count of closed jobs that actually had card payment.
                                count: {
                                    $sum: {
                                        $cond: [{ $gt: [toNumber('$totalPaidCard'), 0] }, 1, 0]
                                    }
                                }
                            }
                        }
                    ],
                    // Finance fee margin: tech is charged 10%, processor takes
                    // 7.5%, so the company keeps 2.5% of every closed-job finance payment.
                    financeFeeProfit: [
                        { $match: { statusCanonical: 'Closed' } },
                        {
                            $group: {
                                _id: null,
                                totalFinanceFeeProfit: { $sum: { $multiply: [toNumber('$totalPaidFinance'), 0.025] } },
                                count: {
                                    $sum: {
                                        $cond: [{ $gt: [toNumber('$totalPaidFinance'), 0] }, 1, 0]
                                    }
                                }
                            }
                        }
                    ],
                    // Company check fee margin: tech is charged 10%, bank/handling
                    // takes 5%, so the company keeps 5% of every closed-job check payment.
                    checkFeeProfit: [
                        { $match: { statusCanonical: 'Closed' } },
                        {
                            $group: {
                                _id: null,
                                totalCheckFeeProfit: { $sum: { $multiply: [toNumber('$totalPaidCompanyCheck'), 0.05] } },
                                count: {
                                    $sum: {
                                        $cond: [{ $gt: [toNumber('$totalPaidCompanyCheck'), 0] }, 1, 0]
                                    }
                                }
                            }
                        }
                    ],
                    totalSales: [
                        { $match: { statusCanonical: 'Closed' } },
                        {
                            $group: {
                                _id: null,
                                totalSales: { $sum: '$valTotalAmount' },
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    // Operational profit per the spec (locked 2026-06-01):
                    //   totalSales − all payment fees − all parts
                    // Closed-only. Equivalent to sum(valTotalAmount − valPaymentFee − valParts).
                    totalProfit: [
                        { $match: { statusCanonical: 'Closed' } },
                        {
                            $group: {
                                _id: null,
                                totalProfit: { $sum: { $subtract: [
                                    { $subtract: ['$valTotalAmount', '$valPaymentFee'] },
                                    '$valParts'
                                ] } },
                                totalFees: { $sum: '$valPaymentFee' },
                                count: { $sum: 1 }
                            }
                        }
                    ]
                },
            },
        ];

        const timing = new ServerTiming();
        timing.start('db');
        const [result] = await collection.aggregate(pipeline).toArray();
        timing.end('db', 'home-stats aggregate');

        return timing.apply(NextResponse.json(result || {}));
    } catch (err) {
        console.error('GET /api/home-stats error', err);
        return NextResponse.json({ error: 'Failed to load home stats' }, { status: 500 });
    }
}
