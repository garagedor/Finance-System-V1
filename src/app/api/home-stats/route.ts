import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { JobRow } from '../../../types/job';

const MONGODB_URI ='mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
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

        const client = await getClient();
        const collection = client.db(DB_NAME).collection<JobRow>(COLLECTION_NAME);

        const matchStage: any = {};
        if (startDate || endDate) {
            matchStage.$expr = {
                $and: [],
            };

            if (startDate) {
                matchStage.$expr.$and.push({
                    $gte: [
                        { $dateFromString: { dateString: '$date', onError: new Date(0) } },
                        new Date(startDate),
                    ],
                });
            }
            if (endDate) {
                matchStage.$expr.$and.push({
                    $lte: [
                        { $dateFromString: { dateString: '$date', onError: new Date(0) } },
                        new Date(endDate),
                    ],
                });
            }
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
            {
                $lookup: {
                    from: 'Provider',
                    let: { providerStr: '$provider' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $or: [
                                        { $eq: ['$_id', '$$providerStr'] },
                                        { $eq: ['$name', '$$providerStr'] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: 'providerData',
                },
            },
            {
                $unwind: {
                    path: '$providerData',
                    preserveNullAndEmptyArrays: true,
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
                    valPaymentFee: {
                        $add: [
                            { $multiply: [toNumber('$totalPaidCard'), 0.05] },
                            { $multiply: [toNumber('$totalPaidFinance'), 0.1] },
                            { $multiply: [toNumber('$totalPaidCompanyCheck'), 0.1] },
                            { $multiply: [toNumber('$lmCheck'), 0.1] }
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
                    valCompanyParts: toNumber('$companyParts')
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
                                        $cond: [{ $ne: ['$status', 'X close'] }, '$valTotalProfit', 0]
                                    }
                                },
                                closedCount: {
                                    $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] }
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
                                        $cond: [{ $ne: ['$status', 'X close'] }, '$valTotalProfit', 0]
                                    }
                                },
                                closedCount: {
                                    $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] }
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
                        { $match: { status: 'X close', location: { $nin: [null, ''] } } },
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
                        { $match: { status: 'Closed', location: { $nin: [null, ''] } } },
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
                        { $match: { location: { $nin: [null, ''] } } },
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
                        { $match: { status: 'Closed' } },
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
                    totalSales: [
                        { $match: { status: 'Closed' } },
                        {
                            $group: {
                                _id: null,
                                totalSales: { $sum: '$valTotalAmount' },
                                count: { $sum: 1 }
                            }
                        }
                    ]
                },
            },
        ];

        const [result] = await collection.aggregate(pipeline).toArray();

        return NextResponse.json(result || {});
    } catch (err) {
        console.error('GET /api/home-stats error', err);
        return NextResponse.json({ error: 'Failed to load home stats' }, { status: 500 });
    }
}
