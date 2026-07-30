import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from "@/lib/mongo";
import type { JobRow } from '../../../../types/job';
import { getSupabaseServerClient, isSupabaseConfigured } from '../../../../lib/supabase-server';
import { matchTechWithMapping, matchAreaWithMapping } from '../../../../lib/verify/mapping';
import { listTechMappings, listAreaMappings } from '../../../../lib/verify/mapping-store';

const DB_NAME = 'ag';
const JOB_COLLECTION = 'Job';
const TECHNICIAN_COLLECTION = 'Technician';
const LOCATION_COLLECTION = 'Location';


const DEFAULT_STATUSES = ['Submitted'];

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured', detail: 'Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_ADMIN_EMAIL, and SUPABASE_ADMIN_PASSWORD in .env.local' },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const statusParams = searchParams.getAll('status').map((s) => s.trim()).filter(Boolean);
    const statuses = statusParams.length ? statusParams : DEFAULT_STATUSES;

    const supa = await getSupabaseServerClient();

    // A "resubmitted" report is one we Returned that the tech then edited again
    // (updated_at > returned_at). The technician app currently leaves the status
    // on 'Returned' instead of flipping it back to 'Submitted', so when the
    // pending queue is requested we also pull Returned reports and keep only the
    // ones edited after return — otherwise a tech's fix never comes back to us.
    const surfaceResubmitted = statuses.includes('Submitted') && !statuses.includes('Returned');
    const queryStatuses = surfaceResubmitted ? [...statuses, 'Returned'] : statuses;
    const isResubmitted = (r: any): boolean =>
      r.status === 'Returned' && !!r.returned_at && !!r.updated_at && r.updated_at > r.returned_at;

    // 1) Reports
    const { data: reportsRaw, error: reportsErr } = await supa
      .from('weekly_reports')
      .select('id, technician_id, area_id, week_start, week_end, status, submitted_at, returned_at, updated_at, total_sales')
      .in('status', queryStatuses)
      .order('week_start', { ascending: false })
      .limit(200);

    if (reportsErr) throw reportsErr;
    const reports = surfaceResubmitted
      ? (reportsRaw || []).filter((r: any) => r.status !== 'Returned' || isResubmitted(r))
      : (reportsRaw || []);
    if (!reports || reports.length === 0) {
      return NextResponse.json({ reports: [] });
    }

    // 2) Look up tech full_name and area name for the reports we got
    const techIds = Array.from(new Set(reports.map((r: any) => r.technician_id).filter(Boolean)));
    const areaIds = Array.from(new Set(reports.map((r: any) => r.area_id).filter(Boolean)));

    const [{ data: users, error: usersErr }, { data: areas, error: areasErr }] = await Promise.all([
      supa.from('users').select('id, full_name').in('id', techIds),
      supa.from('areas').select('id, name').in('id', areaIds),
    ]);
    if (usersErr) throw usersErr;
    if (areasErr) throw areasErr;

    const techNameById = new Map<string, string>();
    (users || []).forEach((u: any) => techNameById.set(u.id, u.full_name));
    const areaNameById = new Map<string, string>();
    (areas || []).forEach((a: any) => areaNameById.set(a.id, a.name));

    // 3) For each report, count its line items + check whether tech/area names
    //    exist in the CRM's data. We do a single DISTINCT call to gather all
    //    CRM tech names + locations for the broad date window.
    const earliestStart = reports.reduce((acc: string, r: any) => (!acc || r.week_start < acc ? r.week_start : acc), '');
    const latestEnd = reports.reduce((acc: string, r: any) => (!acc || r.week_end > acc ? r.week_end : acc), '');

    const mongo = await getMongoClient();
    const db = mongo.db(DB_NAME);
    const jobCol = db.collection<JobRow>(JOB_COLLECTION);
    const techCol = db.collection<{ _id: any }>(TECHNICIAN_COLLECTION);
    const locCol = db.collection<{ _id: any }>(LOCATION_COLLECTION);
    // Pool of CRM tech / location names used for the "integrated" badges when
    // a report's tech/area has no mapping. Union the lookup tables with the
    // distinct values that appear on Jobs in the visible window so freshly
    // created entities and historical job-only names both count.
    const [crmJobTechs, crmJobLocations, techRows, locRows] = await Promise.all([
      jobCol.distinct('tech', earliestStart && latestEnd ? { date: { $gte: earliestStart, $lte: latestEnd } } : {}),
      jobCol.distinct('location', earliestStart && latestEnd ? { date: { $gte: earliestStart, $lte: latestEnd } } : {}),
      techCol.find({}, { projection: { _id: 1 } }).toArray(),
      locCol.find({}, { projection: { _id: 1 } }).toArray(),
    ]);
    const crmTechs = [
      ...(crmJobTechs as any[]),
      ...techRows.map((t) => t._id),
    ];
    const crmLocations = [
      ...(crmJobLocations as any[]),
      ...locRows.map((l) => l._id),
    ];

    // 4) Job counts + financial roll-ups per report (one query). We pull the
    //    DB-computed mirrors (tech_30, balance, total_job) plus the per-job tip
    //    fields so the list can show per-tech overview stats without needing
    //    per-report detail fetches.
    const reportIds = reports.map((r: any) => r.id);
    const { data: jobRows, error: countsErr } = await supa
      .from('weekly_report_jobs')
      .select('weekly_report_id, total_job, balance, tech_30, tip_amount, tips_card, tips_finance, tips_company_cash, tips_check')
      .in('weekly_report_id', reportIds);
    if (countsErr) throw countsErr;
    type Roll = { count: number; totalJob: number; balance: number; commission: number; tips: number };
    const rollByReport = new Map<string, Roll>();
    const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    (jobRows || []).forEach((row: any) => {
      const r = rollByReport.get(row.weekly_report_id) || { count: 0, totalJob: 0, balance: 0, commission: 0, tips: 0 };
      r.count += 1;
      r.totalJob += num(row.total_job);
      r.balance += num(row.balance);
      r.commission += num(row.tech_30);
      // The `tip_amount` mirror is auto-computed net of fees by a Lovable DB
      // trigger ($156.27 reported → $148.46 stored). Always sum the per-method
      // raw columns so the page shows what the tech actually reported.
      r.tips += num(row.tips_card) + num(row.tips_finance) + num(row.tips_company_cash) + num(row.tips_check);
      rollByReport.set(row.weekly_report_id, r);
    });

    const [techMaps, areaMaps] = await Promise.all([listTechMappings(), listAreaMappings()]);
    const techMapByUserId = new Map(techMaps.map((m) => [m.supabaseUserId, m.crmTechNames]));
    const areaMapByAreaId = new Map(areaMaps.map((m) => [m.supabaseAreaId, m.crmLocationNames]));

    const out = reports.map((r: any) => {
      const techName = techNameById.get(r.technician_id) || '';
      const areaName = areaNameById.get(r.area_id) || '';
      const mappedTechNames = techMapByUserId.get(r.technician_id) || null;
      const mappedAreaNames = areaMapByAreaId.get(r.area_id) || null;
      // An explicit mapping is itself proof of integration — no need to also
      // find the mapped name in the CRM data pool. Without a mapping, fall
      // back to the name-equality check against the unioned CRM pool.
      const techMatched = (mappedTechNames && mappedTechNames.length > 0)
        ? true
        : (crmTechs as any[]).some((t) => typeof t === 'string' && matchTechWithMapping(t, techName, mappedTechNames));
      const areaMatched = (mappedAreaNames && mappedAreaNames.length > 0)
        ? true
        : (crmLocations as any[]).some((l) => typeof l === 'string' && matchAreaWithMapping(l, areaName, mappedAreaNames));
      const roll = rollByReport.get(r.id);
      return {
        id: r.id,
        techName,
        techMatched,
        areaName,
        areaMatched,
        weekStart: r.week_start,
        weekEnd: r.week_end,
        status: r.status,
        resubmitted: isResubmitted(r),
        submittedAt: r.submitted_at,
        supabaseJobCount: roll?.count || 0,
        supabaseTotalSales: Number(r.total_sales || 0),
        // Per-report financial roll-ups, used by the per-tech overview stats.
        supabaseBalance: roll?.balance || 0,
        supabaseCommission: roll?.commission || 0,
        supabaseTips: roll?.tips || 0,
        hasTechMapping: Array.isArray(mappedTechNames) && mappedTechNames.length > 0,
        hasAreaMapping: Array.isArray(mappedAreaNames) && mappedAreaNames.length > 0,
      };
    });

    return NextResponse.json({ reports: out });
  } catch (err: any) {
    console.error('GET /api/verify/weekly-reports error', err);
    return NextResponse.json({ error: 'Failed to load weekly reports', detail: err?.message || String(err) }, { status: 500 });
  }
}
