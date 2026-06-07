import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import type { JobRow } from '../../../types/job';

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';
const COLLECTION_NAME = 'Job';

let cachedClient: MongoClient | null = null;

type FilterRule = {
    field?: keyof JobRow | string;
    value?: unknown;
};

const numberFields = new Set<keyof JobRow>([
    'totalAmount',
    'techPaidCash',
    'totalPaidCard',
    'totalPaidCompanyCheck',
    'totalPaidFinance',
    'totalPaidCompanyCash',
    'techParts',
    'companyParts',
    'lmParts',
    'lmCash',
    'lmCheck',
    'tipsCard',
    'tipsFinance',
    'tipsCompanyCash',
    'tipsCheck',
]);

const booleanFields = new Set<keyof JobRow>(['needTracking']);
const dateFields = new Set<keyof JobRow>(['date']);

async function connectToDatabase(): Promise<{ client: MongoClient; db: Db; collection: Collection<JobRow> }> {
    if (cachedClient) {
        const db = cachedClient.db(DB_NAME);
        const collection = db.collection<JobRow>(COLLECTION_NAME);
        return { client: cachedClient, db, collection };
    }

    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    cachedClient = client;

    const db = client.db(DB_NAME);
    const collection = db.collection<JobRow>(COLLECTION_NAME);

    return { client, db, collection };
}

function convertFilterValue(field: string, value: unknown) {
    // Skip empty values across every type — without this guard, an empty
    // currency input would coerce via Number('') === 0 and silently apply a
    // `field = 0` filter; an empty boolean falls through to `false` and
    // hides every "Yes" row. Empty = "no filter," not "= 0 / = false".
    // Date-range JSON ('{"start":"...","end":"..."}') is intentionally NOT
    // pre-checked here — the GET handler parses it before calling this.
    if (value === undefined || value === null || value === '') return undefined;

    if (booleanFields.has(field as keyof JobRow)) {
        return value === true || value === 'true' || value === '1';
    }

    if (numberFields.has(field as keyof JobRow)) {
        const num = typeof value === 'number' ? value : Number(value);
        return Number.isNaN(num) ? undefined : num;
    }

    if (dateFields.has(field as keyof JobRow)) {
        return String(value).slice(0, 10);
    }

    return value;
}

const dateVariants = (raw: unknown): string[] => {
    const val = typeof raw === 'string' ? raw.trim() : '';
    if (!val) return [];
    const normalized = val.slice(0, 10);
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        return [normalized];
    }
    const yyyy = parsed.getFullYear();
    const m = parsed.getMonth() + 1;
    const d = parsed.getDate();
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const iso = `${yyyy}-${mm}-${dd}`;
    const mdyyyy = `${m}/${d}/${yyyy}`;
    const mmdyyyy = `${mm}/${dd}/${yyyy}`;
    return Array.from(new Set([normalized, iso, mdyyyy, mmdyyyy].filter(Boolean)));
};

function normalizeApprovals(input: unknown): string[] {
    if (Array.isArray(input)) {
        return Array.from(
            new Set(
                input
                    .map((v) => (typeof v === 'string' ? v : String(v)))
                    .map((v) => v.trim())
                    .filter(Boolean)
            )
        );
    }

    if (typeof input === 'string') {
        return Array.from(
            new Set(
                input
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean)
            )
        );
    }

    return [];
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const page = parseInt(searchParams.get('page') ?? '1', 10);
        const pageSize = parseInt(searchParams.get('pageSize') ?? '50', 10);
        const sortBy = (searchParams.get('sortBy') ?? '').trim();
        const sortDirParam = (searchParams.get('sortDir') ?? 'asc').toLowerCase();
        const sortDir = sortDirParam === 'desc' ? -1 : 1;
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const tech = searchParams.get('tech');
        const filtersRaw = searchParams.get('filters');
        const search = (searchParams.get('search') ?? '').trim();
        const limitFirst50Param = searchParams.get('limitFirst50') === 'true';
        const parsedFilters: FilterRule[] = [];
        if (filtersRaw) {
            try {
                const maybe = JSON.parse(filtersRaw);
                if (Array.isArray(maybe)) {
                    maybe.forEach((f) => parsedFilters.push(f as FilterRule));
                }
            } catch (err) {
                console.error('Failed to parse filters query param', err);
            }
        }
        const hasFilters = parsedFilters.some(
            (f) => (f?.field ?? '') !== '' && f?.value !== undefined && f?.value !== null && f?.value !== ''
        );
        const isSearching = search.length >= 2;
        const limitFirst50 = limitFirst50Param || hasFilters || isSearching;
        const fetchAll = searchParams.get('fetchAll') === 'true';
        const sortableFields = new Set([
            'tech',
            'status',
            'date',
            'address',
            'location',
            'totalAmount',
            'techPaidCash',
            'totalPaidCard',
            'totalPaidCompanyCheck',
            'totalPaidFinance',
            'totalPaidCompanyCash',
            'techParts',
            'companyParts',
            'lmParts',
            'lmCash',
            'lmCheck',
            'provider',
            'tipsCard',
            'tipsFinance',
            'tipsCompanyCash',
            'tipsCheck',
            'clientName',
            'clientPhoneNumber',
            'notes',
            'needTracking',
        ]);
        const applySort = sortBy && sortableFields.has(sortBy);

        const safePage = Number.isNaN(page) || page < 1 ? 1 : page;
        const safePageSize = Number.isNaN(pageSize) || pageSize < 1 ? 50 : pageSize;

        const { collection } = await connectToDatabase();

        const filterQuery: Record<string, any> = {};
        const filterConditions: Record<string, any>[] = [];
        const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (startDate || endDate) {
            const range: any = {};
            if (startDate) range.$gte = startDate;
            if (endDate) range.$lte = endDate;
            if (Object.keys(range).length) {
                filterQuery.date = range;
            }
        }

        if (tech) {
            filterQuery.tech = tech;
        }

        const logicOp = (searchParams.get('filterLogic') ?? 'AND') === 'OR' ? '$or' : '$and';

        // Global Search Logic
        if (isSearching) {
            const searchRegex = { $regex: escapeRegex(search), $options: 'i' };
            const searchableFields = [
                'tech', 'status', 'address', 'location', 'provider', 'clientName', 'clientPhoneNumber', 'notes', '_id'
            ];
            filterConditions.push({
                $or: searchableFields.map(field => ({ [field]: searchRegex }))
            });
        }

        parsedFilters.forEach((rule) => {
            const field = (rule.field ?? '').toString().trim();
            if (!field) return;
            const converted = convertFilterValue(field, rule.value);
            if (converted === undefined) return;

            let condition: any = null;
            const operator = (rule as any).operator ?? 'contains';

            if (dateFields.has(field as keyof JobRow)) {
                // Check if value is a date range (JSON string with start/end)
                let dateRangeObj: any = null;
                if (typeof rule.value === 'string' && rule.value.includes('{')) {
                    try {
                        dateRangeObj = JSON.parse(rule.value);
                    } catch {
                        // Not JSON, treat as single date
                    }
                }

                if (dateRangeObj && (dateRangeObj.start || dateRangeObj.end)) {
                    // Handle date range
                    const rangeCondition: any = {};
                    if (dateRangeObj.start) {
                        rangeCondition.$gte = dateRangeObj.start;
                    }
                    if (dateRangeObj.end) {
                        rangeCondition.$lte = dateRangeObj.end;
                    }
                    condition = rangeCondition;
                } else if (converted === '') {
                    condition = { $in: ['', null] };
                } else {
                    // Single date - use variants for matching
                    const variants = dateVariants(rule.value);
                    if (variants.length) {
                        condition = { $in: variants };
                    }
                }
            } else if (converted === '') {
                condition = { $in: ['', null] };
            } else if (field === '_id') {
                const valStr = String(converted);
                // For equals operator, try ObjectId first, then fallback to string
                if (operator === 'equals') {
                    if (ObjectId.isValid(valStr)) {
                        condition = new ObjectId(valStr);
                    } else {
                        condition = valStr;
                    }
                } else {
                    // For contains/startsWith/endsWith, treat as string
                    const esc = escapeRegex(valStr);
                    let pat = esc;
                    if (operator === 'startsWith') pat = `^${esc}`;
                    if (operator === 'endsWith') pat = `${esc}$`;
                    condition = { $regex: pat, $options: 'i' };
                }
            } else if (operator === 'contains' || operator === 'startsWith' || operator === 'endsWith') {
                if (numberFields.has(field as keyof JobRow) || booleanFields.has(field as keyof JobRow)) {
                    condition = { $eq: converted };
                } else {
                    const s = String(converted);
                    const esc = escapeRegex(s);
                    let pat = esc;
                    if (operator === 'startsWith') pat = `^${esc}`;
                    if (operator === 'endsWith') pat = `${esc}$`;
                    condition = { $regex: pat, $options: 'i' };
                }
            } else if (operator === 'equals') {
                condition = { $eq: converted };
            } else if (['gt', 'lt', 'gte', 'lte'].includes(operator)) {
                condition = { [`$${operator}`]: converted };
            } else {
                // Default fallback
                if (!numberFields.has(field as keyof JobRow) && !booleanFields.has(field as keyof JobRow)) {
                    const escapedValue = escapeRegex(String(converted));
                    condition = { $regex: escapedValue, $options: 'i' };
                } else {
                    condition = { $eq: converted };
                }
            }

            if (condition) {
                filterConditions.push({ [field]: condition });
            }
        });


        if (fetchAll) {
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

            if (tech) {
                const regex = new RegExp(`^${escapeRegex(tech)}$`, 'i');
                matchStage.$and = [
                    ...(matchStage.$and || []),
                    { $or: [{ tech }, { tech: { $regex: regex } }] },
                ];
            }

            const nonDateFilters: Record<string, any> = { ...filterQuery };
            delete nonDateFilters.date;
            Object.assign(matchStage, nonDateFilters);
            if (typeof filterQuery.date === 'string') {
                matchStage.date = filterQuery.date;
            }

            if (filterConditions.length) {
                matchStage.$and = [...(matchStage.$and || []), ...filterConditions];
            }

            if (Object.keys(matchStage).length) {
                pipeline.push({ $match: matchStage });
            }

            pipeline.push({ $sort: { dateParsed: -1, _id: -1 } });

            const rowsRaw = await collection.aggregate(pipeline).toArray();
            const rows = rowsRaw.map((r) => ({
                ...r,
                approvals: normalizeApprovals((r as any).approvals),
                _id: (r as any)._id?.toString(),
            }));

            return NextResponse.json({
                rows,
                total: rows.length,
                page: 1,
                pageSize: rows.length,
            });
        }

        const matchQuery: any = { ...filterQuery };
        if (filterConditions.length > 0) {
            matchQuery[logicOp] = filterConditions;
        }

        const pageSizeToUse = limitFirst50 ? 50 : safePageSize;
        const total = await collection.countDocuments(matchQuery);
        const skip = limitFirst50 ? 0 : (safePage - 1) * pageSizeToUse;

        // Use aggregation for proper date sorting
        const sortByDate = applySort && sortBy === 'date';

        let rowsRaw: any[];
        if (sortByDate) {
            // Use aggregation pipeline to parse date and sort chronologically
            const pipeline: any[] = [
                { $match: matchQuery },
                {
                    $addFields: {
                        dateParsed: {
                            $dateFromString: { dateString: '$date', onError: null, onNull: null },
                        },
                    },
                },
                { $sort: { dateParsed: sortDir, _id: sortDir } },
            ];
            if (!limitFirst50) {
                pipeline.push({ $skip: skip });
            }
            pipeline.push({ $limit: pageSizeToUse });
            rowsRaw = await collection.aggregate(pipeline).toArray();
        } else {
            let cursor = collection.find(matchQuery);
            if (applySort) {
                cursor = cursor.sort({ [sortBy]: sortDir });
            } else {
                // Default: sort by _id descending (newest first)
                cursor = cursor.sort({ _id: -1 });
            }
            if (!limitFirst50) {
                cursor = cursor.skip(skip);
            }
            rowsRaw = await cursor.limit(pageSizeToUse).toArray();
        }


        // convert ObjectId to string for client
        const rows = rowsRaw.map((r) => ({
            ...r,
            approvals: normalizeApprovals((r as any).approvals),
            _id: (r as any)._id?.toString(),
        }));

        return NextResponse.json({
            rows,
            total,
            page: limitFirst50 ? 1 : safePage,
            pageSize: pageSizeToUse,
            limited: limitFirst50 && total > pageSizeToUse,
        });
    } catch (error) {
        console.error('Database error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch jobs' },
            { status: 500 }
        );
    }
}

export async function PUT(req: NextRequest) {
    try {
        const body = await req.json();
        const id = body._id || body.id;
        if (!id) {
            return NextResponse.json({ error: 'Missing _id in request body' }, { status: 400 });
        }

        const update: Partial<JobRow> = { ...body };
        delete (update as any)._id;
        delete (update as any).id;
        if ((body as any).approvals !== undefined) {
            (update as any).approvals = normalizeApprovals((body as any).approvals);
        }

        const { collection } = await connectToDatabase();

        const filter =
            typeof id === 'string' && ObjectId.isValid(id)
                ? { _id: new ObjectId(id) }
                : { _id: id };

        const result = await collection.findOneAndUpdate(filter, { $set: update }, { returnDocument: 'after' as any });

        if (!result) {
            return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        }

        const updated = { ...result, _id: (result as any)._id?.toString() };
        return NextResponse.json({ updated });
    } catch (err) {
        console.error('PUT /api/jobs error', err);
        return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const doc: JobRow = {
            ...(body as JobRow),
            approvals: normalizeApprovals((body as any).approvals),
        };

        const { collection } = await connectToDatabase();

        const result = await collection.insertOne(doc);

        if (!result.insertedId) {
            return NextResponse.json({ error: 'Failed to insert document' }, { status: 500 });
        }

        const created = { ...doc, _id: result.insertedId.toString() };
        return NextResponse.json({ created }, { status: 201 });
    } catch (err) {
        console.error('POST /api/jobs error', err);
        return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');
        if (!id) {
            return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
        }

        const { collection } = await connectToDatabase();

        const filter: any =
            typeof id === 'string' && ObjectId.isValid(id)
                ? { _id: new ObjectId(id) }
                : { _id: id };
        const result = await collection.deleteOne(filter as any);

        if (result.deletedCount === 0) {
            return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        }

        return NextResponse.json({ deleted: true });
    } catch (err) {
        console.error('DELETE /api/jobs error', err);
        return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
    }
}
