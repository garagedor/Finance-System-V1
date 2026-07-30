// CRM dispute CRUD with job enrichment.
//
// GET responses embed every job-derived field the dispute table needs:
// address, tech short + full name, provider, location, computed sums
// (totalInclTip, tipsTotal, partsTotal). PUT/POST strip these synthetic
// aliases before persisting so the Dispute row stays clean.

import type { Dispute } from '../../../types/job';
import { STRIPPED_SYNTHETIC_FIELDS } from '../../../types/job';
import { normalizeDate } from '../../utils/jobUtils';
import { createCrudHandlers } from '../utils/crudHandlers';
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId, Db } from "mongodb";
import { getMongoClient } from "@/lib/mongo";

const DB_NAME = process.env.MONGODB_DB ?? 'ag';

let _cachedDb: Db | null = null;
async function db(): Promise<Db> {
  if (_cachedDb) return _cachedDb;
  const c = await getMongoClient();
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
  totalAmount?: number;          // legacy cached total; often undefined on newer rows
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

/** Build a lookup `short crm name → full supabase name`. Cached per process. */
let _techNameCache: Map<string, string> | null = null;
let _techNameCacheAt = 0;
async function getTechNameMap(): Promise<Map<string, string>> {
  // 5-minute cache — mappings rarely change.
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

/** Coerce a possibly-string value to a finite number, default 0. The CRM
 *  Job rows mix string and number storage for the same field — guard against
 *  silent string concatenation. */
function n(v: unknown): number {
  if (v == null || v === '') return 0;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}
function sumTips(j: JobLite): number {
  return n(j.tipsCard) + n(j.tipsFinance) + n(j.tipsCompanyCash) + n(j.tipsCheck);
}
function sumParts(j: JobLite): number {
  return n(j.techParts) + n(j.companyParts);
}
/** Job revenue total. Prefers `totalAmount` when set (and numeric > 0);
 *  otherwise sums the per-method `totalPaid*` fields. */
function jobTotal(j: JobLite): number {
  const cached = n(j.totalAmount);
  if (cached > 0) return cached;
  return n(j.totalPaidCard) + n(j.totalPaidCompanyCheck) + n(j.totalPaidFinance) +
         n(j.totalPaidCompanyCash) + n(j.techPaidCash);
}

const normalizeDisputeRow = (row: Dispute): Dispute => ({
  ...row,
  disputeDate: normalizeDate((row as any).disputeDate) || ((row as any).disputeDate as any) || '',
  dueDate: normalizeDate((row as any).dueDate) || ((row as any).dueDate as any) || '',
  dateLost: normalizeDate((row as any).dateLost) || ((row as any).dateLost as any) || '',
});

const helpers = createCrudHandlers<Dispute>({
  collectionName: 'Dispute',
  normalizeRow: normalizeDisputeRow,
  numberFields: [
    'totalDisputed',
    // User-overridable Job-derived fields — parsed as numbers when saved.
    'jobTotalAmount', 'jobTipsTotal', 'jobPartsTotal', 'jobTotalInclTip',
  ],
  booleanFields: ['isTechOffset', 'isPrOffset', 'isDeposit'],
  dateFields: ['disputeDate', 'dueDate', 'dateLost'],
  sortableFields: [
    'jobId', 'totalDisputed', 'disputeDate', 'dueDate', 'dateLost',
    'status', 'isTechOffset', 'isPrOffset', 'isDeposit', 'messageFound',
    'jobAddress', 'jobCustomerName', 'jobPhoneNumber', 'jobTech',
    'jobTechFullName', 'jobProvider', 'jobLocationManager', 'jobStatus',
    'jobTotalAmount', 'jobTipsTotal', 'jobPartsTotal', 'jobTotalInclTip',
    'jobDate',
  ],
  defaultSort: { field: 'disputeDate', dir: -1 },
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const res = await helpers.GET(req);
  if (!res.ok) return res;
  try {
    const body = (await res.json()) as { rows: Dispute[]; [k: string]: unknown };
    const jobIds = body.rows.map((r) => String(r.jobId ?? '')).filter(Boolean);
    const [jobMap, techMap] = await Promise.all([loadJobsByIds(jobIds), getTechNameMap()]);

    const rows = body.rows.map((r) => {
      const job = r.jobId ? jobMap.get(String(r.jobId)) : undefined;
      // Helper — prefer the value the user has stored on the dispute over
      // the value derived from the linked Job. We treat undefined and ''
      // as "not set"; 0 / false are real values worth preserving.
      const pick = <V,>(stored: V | undefined | null, derived: V | undefined): V | undefined => {
        if (stored !== undefined && stored !== null && stored !== ('' as unknown as V)) return stored;
        return derived;
      };
      const tips = job ? sumTips(job) : undefined;
      const parts = job ? sumParts(job) : undefined;
      const totalDerived = job ? jobTotal(job) : undefined;
      const inclTipDerived = totalDerived != null ? totalDerived + (tips ?? 0) : undefined;
      const techShort = job?.tech;
      const techFull = techShort ? techMap.get(techShort.toLowerCase().trim()) : undefined;
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
        // Each flat alias is either the user's override (if set) or the Job
        // value. Stored on the dispute doc when the user edits it.
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
      } as Dispute;
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
    // Only strip the nested `job` object (recomputed every GET). The flat
    // jobAddress / jobTech / etc. fields ARE persisted so users can override
    // the Job-derived defaults.
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
