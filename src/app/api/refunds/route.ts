// CRM refund CRUD with job enrichment — mirrors /api/disputes.

import type { Refund } from '../../../types/job';
import { STRIPPED_SYNTHETIC_FIELDS } from '../../../types/job';
import { normalizeRefundRow } from '../../utils/refundUtils';
import { createCrudHandlers } from '../utils/crudHandlers';
import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, ObjectId, Db } from 'mongodb';

const MONGODB_URI =
  process.env.MONGODB_URI ??
  'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = process.env.MONGODB_DB ?? 'ag';

let _cachedDb: Db | null = null;
async function db(): Promise<Db> {
  if (_cachedDb) return _cachedDb;
  const c = new MongoClient(MONGODB_URI);
  await c.connect();
  _cachedDb = c.db(DB_NAME);
  return _cachedDb;
}

interface JobLite {
  _id: unknown;
  address?: string;
  date?: string;
  location?: string;
  provider?: string;
  tech?: string;
  status?: string;
  totalAmount?: number;
  totalPaidCard?: number;
  totalPaidCompanyCheck?: number;
  totalPaidFinance?: number;
  totalPaidCompanyCash?: number;
  techPaidCash?: number;
  techParts?: number;
  companyParts?: number;
  tipsCard?: number;
  tipsFinance?: number;
  tipsCompanyCash?: number;
  tipsCheck?: number;
  clientName?: string;
  clientPhoneNumber?: string;
}

interface TechMapping {
  _id: unknown;
  crmTechNames?: string[];
  supabaseFullName?: string;
}

async function loadJobsByIds(ids: string[]): Promise<Map<string, JobLite>> {
  const cleaned = [...new Set(ids.filter(Boolean))];
  if (cleaned.length === 0) return new Map();
  const asObjectIds = cleaned
    .filter((id) => ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id))
    .map((id) => new ObjectId(id));
  const dbh = await db();
  const rows = (await dbh
    .collection<JobLite>('Job')
    .find({
      $or: [
        { _id: { $in: cleaned } as never },
        { _id: { $in: asObjectIds } as never },
      ],
    })
    .toArray()) as JobLite[];
  const out = new Map<string, JobLite>();
  for (const r of rows) out.set(String(r._id), r);
  return out;
}

let _techNameCache: Map<string, string> | null = null;
let _techNameCacheAt = 0;
async function getTechNameMap(): Promise<Map<string, string>> {
  if (_techNameCache && Date.now() - _techNameCacheAt < 5 * 60_000) return _techNameCache;
  const dbh = await db();
  const rows = (await dbh.collection<TechMapping>('TechNameMapping').find({}).toArray()) as TechMapping[];
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.supabaseFullName) continue;
    for (const short of r.crmTechNames ?? []) {
      out.set(short.toLowerCase().trim(), r.supabaseFullName);
    }
  }
  _techNameCache = out;
  _techNameCacheAt = Date.now();
  return out;
}

/** Coerce a possibly-string value to a finite number, default 0. Job rows
 *  mix string + number storage for the same field — guard against silent
 *  string concatenation. */
const n = (v: unknown): number => {
  if (v == null || v === '') return 0;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const sumTips = (j: JobLite) => n(j.tipsCard) + n(j.tipsFinance) + n(j.tipsCompanyCash) + n(j.tipsCheck);
const sumParts = (j: JobLite) => n(j.techParts) + n(j.companyParts);
const jobTotal = (j: JobLite) => {
  const cached = n(j.totalAmount);
  if (cached > 0) return cached;
  return n(j.totalPaidCard) + n(j.totalPaidCompanyCheck) + n(j.totalPaidFinance) +
         n(j.totalPaidCompanyCash) + n(j.techPaidCash);
};

const helpers = createCrudHandlers<Refund>({
  collectionName: 'Refund',
  normalizeRow: normalizeRefundRow,
  numberFields: ['refundTotal'],
  booleanFields: ['isTechOffset', 'isPrOffset'],
  dateFields: ['dateRefunded', 'dueDate'],
  sortableFields: ['jobId', 'refundTotal', 'dateRefunded', 'dueDate', 'reason', 'isTechOffset', 'isPrOffset'],
  defaultSort: { field: 'dateRefunded', dir: -1 },
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const res = await helpers.GET(req);
  if (!res.ok) return res;
  try {
    const body = (await res.json()) as { rows: Refund[]; [k: string]: unknown };
    const jobIds = body.rows.map((r) => String(r.jobId ?? '')).filter(Boolean);
    const [jobMap, techMap] = await Promise.all([loadJobsByIds(jobIds), getTechNameMap()]);
    const rows = body.rows.map((r) => {
      const job = r.jobId ? jobMap.get(String(r.jobId)) : undefined;
      const pick = <V,>(stored: V | undefined | null, derived: V | undefined): V | undefined => {
        if (stored !== undefined && stored !== null && stored !== ('' as unknown as V)) return stored;
        return derived;
      };
      const tips = job ? sumTips(job) : undefined;
      const parts = job ? sumParts(job) : undefined;
      const totalDerived = job ? jobTotal(job) : undefined;
      const inclTipDerived = totalDerived != null ? totalDerived + (tips ?? 0) : undefined;
      const techFull = job?.tech ? techMap.get(job.tech.toLowerCase().trim()) : undefined;
      return {
        ...r,
        job: job ? {
          address: job.address,
          date: job.date,
          location: job.location,
          provider: job.provider,
          tech: job.tech,
          status: job.status,
          totalAmount: job.totalAmount,
        } : undefined,
        jobAddress:         pick(r.jobAddress,         job?.address),
        jobDate:            pick(r.jobDate,            job?.date),
        jobLocation:        pick(r.jobLocation,        job?.location),
        jobLocationManager: pick(r.jobLocationManager, job?.location),
        jobProvider:        pick(r.jobProvider,        job?.provider),
        jobTech:            pick(r.jobTech,            job?.tech),
        jobTechFullName:    pick(r.jobTechFullName,    techFull ?? job?.tech),
        jobCustomerName:    pick(r.jobCustomerName,    job?.clientName),
        jobPhoneNumber:     pick(r.jobPhoneNumber,     job?.clientPhoneNumber),
        jobStatus:          pick(r.jobStatus,          job?.status),
        jobTotalAmount:     pick(r.jobTotalAmount,     totalDerived),
        jobTipsTotal:       pick(r.jobTipsTotal,       tips),
        jobPartsTotal:      pick(r.jobPartsTotal,      parts),
        jobTotalInclTip:    pick(r.jobTotalInclTip,    inclTipDerived),
      } as Refund;
    });
    return NextResponse.json({ ...body, rows });
  } catch {
    return res;
  }
}

async function stripSyntheticAndForward(
  req: NextRequest,
  inner: (r: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const body = await req.json();
    for (const k of STRIPPED_SYNTHETIC_FIELDS) delete (body as Record<string, unknown>)[k];
    const cleaned = new NextRequest(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(body),
    });
    return inner(cleaned);
  } catch {
    return inner(req);
  }
}

export function POST(req: NextRequest) {
  return stripSyntheticAndForward(req, helpers.POST);
}
export function PUT(req: NextRequest) {
  return stripSyntheticAndForward(req, helpers.PUT);
}
export const DELETE = helpers.DELETE;
