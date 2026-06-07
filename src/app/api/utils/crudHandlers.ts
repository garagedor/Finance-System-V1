import { NextRequest, NextResponse } from 'next/server';
import { Collection, Db, MongoClient, ObjectId, type Document } from 'mongodb';
import { normalizeDate } from '@/app/utils/jobUtils';

const MONGODB_URI ='mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';

export type CrudOptions<T extends Document> = {
  collectionName: string;
  normalizeRow?: (row: any) => T;
  numberFields?: Array<keyof T>;
  booleanFields?: Array<keyof T>;
  dateFields?: Array<keyof T>;
  sortableFields?: Array<keyof T>;
  defaultSort?: { field: keyof T; dir?: 1 | -1 };
};

type FilterRule = {
  field?: string;
  value?: unknown;
  operator?: string;
};

let cachedClient: MongoClient | null = null;

async function connectToDatabase<T extends Document>(
  collectionName: string
): Promise<{ client: MongoClient; db: Db; collection: Collection<T> }> {
  if (cachedClient) {
    const db = cachedClient.db(DB_NAME);
    const collection = db.collection<T>(collectionName);
    return { client: cachedClient, db, collection };
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;

  const db = client.db(DB_NAME);
  const collection = db.collection<T>(collectionName);

  return { client, db, collection };
}

function convertFilterValue<T extends Document>(field: string, value: unknown, options: CrudOptions<T>) {
  // Skip empty values for all field types — without this guard, an empty
  // currency input would coerce via Number('') === 0 and silently apply a
  // `field = 0` filter; an empty boolean would fall through to `false` and
  // hide every "Yes" row. Empty inputs mean "no filter," not "= 0 / = false".
  if (value === undefined || value === null || value === '') return undefined;

  const { numberFields = [], booleanFields = [], dateFields = [] } = options;

  if (booleanFields.includes(field as keyof T)) {
    return value === true || value === 'true' || value === '1';
  }

  if (numberFields.includes(field as keyof T)) {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(num) ? undefined : num;
  }

  if (dateFields.includes(field as keyof T)) {
    return normalizeDate(value) || String(value).slice(0, 10);
  }

  return value;
}

// Detect a DateRangePicker-encoded value (JSON string with start/end keys).
// The filter UI stores date-range selections as JSON-stringified objects so
// they survive the searchParams round-trip; both the Jobs route and the
// generic crud handler need to parse them back into {$gte, $lte} ranges.
const parseDateRange = (raw: unknown): { start?: string; end?: string } | null => {
  if (typeof raw !== 'string' || !raw.includes('{')) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && ('start' in obj || 'end' in obj)) {
      return { start: obj.start || undefined, end: obj.end || undefined };
    }
  } catch {
    /* not a JSON range */
  }
  return null;
};

const dateVariants = (raw: unknown): string[] => {
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (!val) return [];
  const normalized = normalizeDate(val) || val.slice(0, 10);
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

export function createCrudHandlers<T extends Document>(options: CrudOptions<T>) {
  const {
    collectionName,
    normalizeRow = (row: any) => row as T,
    sortableFields = [],
    defaultSort,
    dateFields = [],
  } = options;

  const sortable = new Set(sortableFields.map((f) => String(f)));

  const GET = async (req: NextRequest) => {
    try {
      const { searchParams } = new URL(req.url);
      const page = parseInt(searchParams.get('page') ?? '1', 10);
      const pageSize = parseInt(searchParams.get('pageSize') ?? '50', 10);
      const sortBy = (searchParams.get('sortBy') ?? '').trim();
      const sortDirParam = (searchParams.get('sortDir') ?? 'asc').toLowerCase();
      const sortDir = sortDirParam === 'desc' ? -1 : 1;
      const filtersRaw = searchParams.get('filters');
      const search = (searchParams.get('search') ?? '').trim();
      const filterLogic = (searchParams.get('filterLogic') ?? 'AND').toUpperCase();
      const limitFirst50Param = searchParams.get('limitFirst50') === 'true';
      const parsedFilters: FilterRule[] = [];
      if (filtersRaw) {
        try {
          const maybe = JSON.parse(filtersRaw);
          if (Array.isArray(maybe)) {
            maybe.forEach((f) => parsedFilters.push(f as FilterRule));
          }
        } catch (err) {
          console.error(`Failed to parse filters for ${collectionName}`, err);
        }
      }
      const hasFilters = parsedFilters.some(
        (f) => (f?.field ?? '') !== '' && f?.value !== undefined && f?.value !== null && f?.value !== ''
      );
      const isSearching = search.length >= 2;
      const limitFirst50 = limitFirst50Param || hasFilters || isSearching;
      const applySort = sortBy && sortable.has(sortBy);

      const safePage = Number.isNaN(page) || page < 1 ? 1 : page;
      const safePageSize = Number.isNaN(pageSize) || pageSize < 1 ? 50 : pageSize;

      const { collection } = await connectToDatabase<T>(collectionName);

      const filterConditions: Record<string, any>[] = [];
      const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const { numberFields = [], booleanFields = [], dateFields = [] } = options;

      // Global Search Logic
      if (isSearching) {
        const searchRegex = { $regex: escapeRegex(search), $options: 'i' };
        const searchableFields = options.sortableFields?.filter(f =>
          !numberFields.includes(f as keyof T) &&
          !booleanFields.includes(f as keyof T) &&
          !dateFields.includes(f as keyof T)
        ) || [];

        // Always include _id for search if it's not explicitly in searchableFields
        const searchTargets = Array.from(new Set([...searchableFields.map(f => String(f)), '_id']));

        filterConditions.push({
          $or: searchTargets.map(field => ({ [field]: searchRegex }))
        });
      }

      parsedFilters.forEach((rule) => {
        const field = (rule.field ?? '').toString().trim();
        if (!field) return;

        // Date-range filter — emitted by the UI's DateRangePicker. Handle
        // before normal conversion since the raw value is a JSON string,
        // not a date.
        if (dateFields.includes(field as keyof T)) {
          const range = parseDateRange(rule.value);
          if (range && (range.start || range.end)) {
            const rangeCondition: Record<string, string> = {};
            if (range.start) rangeCondition.$gte = range.start;
            if (range.end) rangeCondition.$lte = range.end;
            filterConditions.push({ [field]: rangeCondition });
            return;
          }
        }

        const converted = convertFilterValue(field, rule.value, options);
        if (converted === undefined) return;

        const operator = rule.operator ?? 'contains';
        let condition: any = null;

        // Numeric fields: same coercion the stats / home-stats aggregations
        // use. Legacy data is mixed-type — some currency rows are stored as
        // Number, others as String — and Mongo's $gt/$lt won't cross-coerce.
        // Without this, "lmParts > 0" silently misses string-typed rows.
        if (numberFields.includes(field as keyof T)) {
          const mongoOp = ['gt', 'lt', 'gte', 'lte'].includes(operator) ? `$${operator}` : '$eq';
          filterConditions.push({
            $expr: {
              [mongoOp]: [
                { $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } },
                converted,
              ],
            },
          });
          return;
        }

        if (['contains', 'startsWith', 'endsWith'].includes(operator)) {
          if (numberFields.includes(field as keyof T) || booleanFields.includes(field as keyof T)) {
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
          if (dateFields.includes(field as keyof T)) {
            const variants = dateVariants(rule.value);
            condition = variants.length ? { $in: variants } : { $eq: converted };
          } else {
            condition = { $eq: converted };
          }
        } else if (['gt', 'lt', 'gte', 'lte'].includes(operator)) {
          condition = { [`$${operator}`]: converted };
        } else {
          condition = { $eq: converted };
        }

        if (condition) {
          filterConditions.push({ [field]: condition });
        }
      });

      const logicOp = filterLogic === 'OR' ? '$or' : '$and';
      const matchQuery: any =
        filterConditions.length > 0
          ? { [logicOp]: filterConditions }
          : {};

      const total = await collection.countDocuments(matchQuery);
      const pageSizeToUse = limitFirst50 ? 50 : safePageSize;
      const skip = limitFirst50 ? 0 : (safePage - 1) * pageSizeToUse;

      // Check if sorting by a date field
      const sortByDate = applySort && dateFields.includes(sortBy as keyof T);

      let rowsRaw: any[];
      if (sortByDate) {
        // Use aggregation pipeline to parse date and sort chronologically
        const pipeline: any[] = [
          { $match: matchQuery },
          {
            $addFields: {
              dateParsed: {
                $dateFromString: { dateString: `$${sortBy}`, onError: null, onNull: null },
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
        } else if (defaultSort?.field) {
          cursor = cursor.sort({ [defaultSort.field as string]: defaultSort.dir ?? -1 });
        } else {
          // Default: sort by _id descending (newest first)
          cursor = cursor.sort({ _id: -1 });
        }
        if (!limitFirst50) {
          cursor = cursor.skip(skip);
        }
        rowsRaw = await cursor.limit(pageSizeToUse).toArray();
      }

      const rows = rowsRaw.map((r: any) => ({
        ...normalizeRow(r),
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
      console.error(`Database error on GET ${collectionName}:`, error);
      return NextResponse.json({ error: `Failed to fetch ${collectionName}` }, { status: 500 });
    }
  };

  const PUT = async (req: NextRequest) => {
    try {
      const body = await req.json();
      const id = body._id || body.id;
      if (!id) {
        return NextResponse.json({ error: 'Missing _id in request body' }, { status: 400 });
      }

      const update: Partial<T> = { ...body };
      delete (update as any)._id;
      delete (update as any).id;

      const { numberFields = [], booleanFields = [] } = options;
      numberFields.forEach((f) => {
        if ((update as any)[f] !== undefined) {
          const val = (update as any)[f];
          const num = typeof val === 'number' ? val : Number(val);
          (update as any)[f] = Number.isNaN(num) ? 0 : num;
        }
      });
      booleanFields.forEach((f) => {
        if ((update as any)[f] !== undefined) {
          const val = (update as any)[f];
          (update as any)[f] = val === true || val === 'true' || val === '1';
        }
      });

      const { collection } = await connectToDatabase<T>(collectionName);

      const filter =
        typeof id === 'string' && ObjectId.isValid(id)
          ? { _id: new ObjectId(id) }
          : { _id: id };

      const result = await collection.findOneAndUpdate(filter, { $set: update }, { returnDocument: 'after' as any });

      if (!result) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const updated = { ...(normalizeRow(result as any) as any), _id: (result as any)._id?.toString() };
      return NextResponse.json({ updated });
    } catch (err) {
      console.error(`PUT /api/${collectionName} error`, err);
      return NextResponse.json({ error: `Failed to update ${collectionName}` }, { status: 500 });
    }
  };

  const POST = async (req: NextRequest) => {
    try {
      const body = await req.json();
      const doc = { ...(body as any) };
      const { numberFields = [], booleanFields = [] } = options;
      numberFields.forEach((f) => {
        if (doc[f] !== undefined) {
          const val = doc[f];
          const num = typeof val === 'number' ? val : Number(val);
          doc[f] = Number.isNaN(num) ? 0 : num;
        }
      });
      booleanFields.forEach((f) => {
        if (doc[f] !== undefined) {
          const val = doc[f];
          doc[f] = val === true || val === 'true' || val === '1';
        }
      });

      const { collection } = await connectToDatabase<T>(collectionName);

      const result = await collection.insertOne(doc as any);

      if (!result.insertedId) {
        return NextResponse.json({ error: 'Failed to insert document' }, { status: 500 });
      }

      const created = { ...(normalizeRow(doc as any) as any), _id: result.insertedId.toString() };
      return NextResponse.json({ created }, { status: 201 });
    } catch (err) {
      console.error(`POST /api/${collectionName} error`, err);
      return NextResponse.json({ error: `Failed to create ${collectionName}` }, { status: 500 });
    }
  };

  const DELETE = async (req: NextRequest) => {
    try {
      const { searchParams } = new URL(req.url);
      const id = searchParams.get('id');
      if (!id) {
        return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
      }

      const { collection } = await connectToDatabase<T>(collectionName);

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
      console.error(`DELETE /api/${collectionName} error`, err);
      return NextResponse.json({ error: `Failed to delete ${collectionName}` }, { status: 500 });
    }
  };

  return { GET, PUT, POST, DELETE };
}
