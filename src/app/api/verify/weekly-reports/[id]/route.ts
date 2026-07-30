import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import type { JobRow } from '../../../../../types/job';
import { getSupabaseServerClient, isSupabaseConfigured } from '../../../../../lib/supabase-server';
import { matchTechWithMapping, matchAreaWithMapping } from '../../../../../lib/verify/mapping';
import { getTechMappingByUserId, getAreaMappingByAreaId } from '../../../../../lib/verify/mapping-store';
import { getNote, getJobNotesForReport, upsertNote } from '../../../../../lib/verify/notes-store';
import { getLinksForReport } from '../../../../../lib/verify/links-store';
import { compare, deriveCrmMethod, type SupabaseReportJob, type CrmJob } from '../../../../../lib/verify/compare';

const DB_NAME = 'ag';
const JOB_COLLECTION = 'Job';


export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured', detail: 'Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_ADMIN_EMAIL, and SUPABASE_ADMIN_PASSWORD in .env.local' },
      { status: 503 }
    );
  }

  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing report id' }, { status: 400 });

    const supa = await getSupabaseServerClient();

    // 1) Load the report
    const { data: report, error: reportErr } = await supa
      .from('weekly_reports')
      .select('id, technician_id, area_id, week_start, week_end, status, submitted_at')
      .eq('id', id)
      .maybeSingle();
    if (reportErr) throw reportErr;
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

    // 2) Tech + area lookups
    const [{ data: tech }, { data: area }] = await Promise.all([
      supa.from('users').select('id, full_name').eq('id', report.technician_id).maybeSingle(),
      supa.from('areas').select('id, name').eq('id', report.area_id).maybeSingle(),
    ]);
    const techName = (tech as any)?.full_name || '';
    const areaName = (area as any)?.name || '';

    // 3) Report's line items — read everything so the edit dialog can pre-fill
    //    the writable input fields (the comparison only uses the legacy mirrors).
    const { data: rawJobs, error: jobsErr } = await supa
      .from('weekly_report_jobs')
      .select('*')
      .eq('weekly_report_id', id)
      .order('job_date', { ascending: true });
    if (jobsErr) throw jobsErr;
    const supabaseJobs: SupabaseReportJob[] = (rawJobs || []).map((r: any) => ({
      id: r.id,
      job_date: r.job_date,
      customer_name: r.customer_name,
      address: r.address,
      total_job: Number(r.total_job || 0),
      card_amount: Number(r.card_amount || 0),
      cash_amount: Number(r.cash_amount || 0),
      tech_cash: Number(r.tech_cash || 0),
      company_cash: Number(r.company_cash || 0),
      tip_amount: Number(r.tip_amount || 0),
      my_parts: Number(r.my_parts || 0),
      company_parts: Number(r.company_parts || 0),
      payment_type: r.payment_type ?? null,
      // Input fields for the edit form
      notes: r.notes ?? null,
      tech_paid_cash: Number(r.tech_paid_cash || 0),
      paid_card: Number(r.paid_card || 0),
      paid_company_cash: Number(r.paid_company_cash || 0),
      paid_company_check: Number(r.paid_company_check || 0),
      paid_finance: Number(r.paid_finance || 0),
      tech_parts: Number(r.tech_parts || 0),
      tips_card: Number(r.tips_card || 0),
      tips_finance: Number(r.tips_finance || 0),
      tips_company_cash: Number(r.tips_company_cash || 0),
      tips_check: Number(r.tips_check || 0),
      commission_rate: Number(r.commission_rate || 0),
      lm_cash: Number(r.lm_cash || 0),
      lm_check: Number(r.lm_check || 0),
      lm_parts: Number(r.lm_parts || 0),
    }));

    // 4) Matching CRM jobs: tech name(s) from mapping (or fallback to Supabase
    //    full_name), dates in [week_start, week_end].
    const mongo = await getMongoClient();
    const jobCol = mongo.db(DB_NAME).collection<JobRow>(JOB_COLLECTION);

    const [techMap, areaMap] = await Promise.all([
      getTechMappingByUserId(report.technician_id),
      getAreaMappingByAreaId(report.area_id),
    ]);
    const techNamesToQuery: string[] = (techMap?.crmTechNames && techMap.crmTechNames.length > 0)
      ? techMap.crmTechNames
      : (techName ? [techName] : []);

    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const techRegexes = techNamesToQuery.map((n) => new RegExp(`^${escapeRegex(n)}$`, 'i'));

    const crmRaw = techRegexes.length > 0
      ? await jobCol
          .find({
            tech: { $in: techRegexes as any },
            date: { $gte: report.week_start, $lte: report.week_end },
            status: 'Closed',
          })
          .toArray()
      : [];

    // CRM stores amounts as strings ("423.75") and the literal `totalAmount`
    // field is unused — the "total job" is implicit, equal to the sum of all
    // payment fields. Coerce + compute here so compare() sees real numbers.
    const num = (v: any): number => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const crmJobs: CrmJob[] = crmRaw.map((j: any) => {
      const computedTotal =
        num(j.techPaidCash) + num(j.totalPaidCard) + num(j.totalPaidCompanyCheck) +
        num(j.totalPaidFinance) + num(j.totalPaidCompanyCash) + num(j.lmCash) + num(j.lmCheck);
      const partial: CrmJob = {
        _id: String(j._id),
        date: j.date,
        clientName: j.clientName,
        address: j.address,
        totalAmount: computedTotal,
        totalPaidCard: num(j.totalPaidCard),
        techPaidCash: num(j.techPaidCash),
        totalPaidCompanyCash: num(j.totalPaidCompanyCash),
        tipsCard: num(j.tipsCard),
        tipsFinance: num(j.tipsFinance),
        tipsCompanyCash: num(j.tipsCompanyCash),
        tipsCheck: num(j.tipsCheck),
        techParts: num(j.techParts),
        companyParts: num(j.companyParts),
        totalPaidCompanyCheck: num(j.totalPaidCompanyCheck),
        totalPaidFinance: num(j.totalPaidFinance),
        lmCash: num(j.lmCash),
        lmCheck: num(j.lmCheck),
        lmParts: num(j.lmParts),
      };
      partial.paymentType = deriveCrmMethod(partial);
      return partial;
    });

    // 5) Identity check for the response banner. An explicit mapping is itself
    //    proof of integration — short-circuit so the badge respects the admin's
    //    curation even when the mapped tech/location has no Jobs yet.
    const mappedTechNames = techMap?.crmTechNames;
    const mappedAreaNames = areaMap?.crmLocationNames;
    let techMatched: boolean;
    let areaMatched: boolean;
    if (mappedTechNames && mappedTechNames.length > 0) {
      techMatched = true;
    } else {
      const allCrmTechs = await jobCol.distinct('tech');
      techMatched = (allCrmTechs as any[]).some((t) => typeof t === 'string' && matchTechWithMapping(t, techName, mappedTechNames));
    }
    if (mappedAreaNames && mappedAreaNames.length > 0) {
      areaMatched = true;
    } else {
      const allCrmLocations = await jobCol.distinct('location');
      areaMatched = (allCrmLocations as any[]).some((l) => typeof l === 'string' && matchAreaWithMapping(l, areaName, mappedAreaNames));
    }

    // 6) Compare — manual link overrides win over auto-matching.
    const manualLinks = await getLinksForReport(report.id);

    // The CRM pool above is filtered to (mapped tech) ∩ (week range) ∩ (Closed).
    // A manual link may point at a CRM job OUTSIDE that filter (different tech,
    // adjacent week, non-Closed status). Pull those by id and merge so the
    // override actually pairs.
    const linkedIdsInPool = new Set(crmJobs.map((c) => c._id));
    const missingLinkedIds = Array.from(new Set(Object.values(manualLinks)))
      .filter((id) => id && !linkedIdsInPool.has(id));

    if (missingLinkedIds.length > 0) {
      const objectIds = missingLinkedIds
        .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
        .map((id) => new ObjectId(id));
      if (objectIds.length > 0) {
        const extra = await jobCol.find({ _id: { $in: objectIds as any } }).toArray();
        const extraJobs: CrmJob[] = extra.map((j: any) => {
          const computedTotal =
            num(j.techPaidCash) + num(j.totalPaidCard) + num(j.totalPaidCompanyCheck) +
            num(j.totalPaidFinance) + num(j.totalPaidCompanyCash) + num(j.lmCash) + num(j.lmCheck);
          const partial: CrmJob = {
            _id: String(j._id),
            date: j.date,
            clientName: j.clientName,
            address: j.address,
            totalAmount: computedTotal,
            totalPaidCard: num(j.totalPaidCard),
            techPaidCash: num(j.techPaidCash),
            totalPaidCompanyCash: num(j.totalPaidCompanyCash),
            tipsCard: num(j.tipsCard),
            tipsFinance: num(j.tipsFinance),
            tipsCompanyCash: num(j.tipsCompanyCash),
            tipsCheck: num(j.tipsCheck),
            techParts: num(j.techParts),
            companyParts: num(j.companyParts),
            totalPaidCompanyCheck: num(j.totalPaidCompanyCheck),
            totalPaidFinance: num(j.totalPaidFinance),
            lmCash: num(j.lmCash),
            lmCheck: num(j.lmCheck),
            lmParts: num(j.lmParts),
          };
          partial.paymentType = deriveCrmMethod(partial);
          return partial;
        });
        crmJobs.push(...extraJobs);
      }
    }

    const result = compare(supabaseJobs, crmJobs, manualLinks);

    // Admin-only notes (live in our Mongo, never sent to Lovable). Both the
    // report-level note and per-job notes are loaded here so the detail view
    // can render and edit them inline.
    const [adminNote, jobNotesMap] = await Promise.all([
      getNote(report.id),
      getJobNotesForReport(report.id),
    ]);
    // Merge per-job notes into the resulting pairs so the page can show notes
    // for matched/mismatch pairs AND missing-only rows. Lovable IDs are UUIDs,
    // CRM IDs are 24-hex ObjectIds — different shapes, so a single keyed map
    // can hold both without collision.
    result.pairs.forEach((p: any) => {
      if (p.supabaseJob) p.supabaseJob.adminNote = jobNotesMap[p.supabaseJob.id] || '';
      if (p.crmJob) p.crmJob.adminNote = jobNotesMap[p.crmJob._id] || '';
    });

    return NextResponse.json({
      report: {
        id: report.id,
        techName,
        techMatched,
        areaName,
        areaMatched,
        weekStart: report.week_start,
        weekEnd: report.week_end,
        status: report.status,
        submittedAt: report.submitted_at,
        mappedTechNames: techMap?.crmTechNames || [],
        mappedAreaNames: areaMap?.crmLocationNames || [],
        adminNote: adminNote?.note || '',
        adminNoteUpdatedAt: adminNote?.updatedAt ? adminNote.updatedAt.toISOString() : null,
        adminNoteUpdatedBy: adminNote?.updatedBy || null,
      },
      summary: result.summary,
      totals: result.totals,
      pairs: result.pairs,
    });
  } catch (err: any) {
    console.error('GET /api/verify/weekly-reports/[id] error', err);
    return NextResponse.json({ error: 'Failed to load report', detail: err?.message || String(err) }, { status: 500 });
  }
}

// Update the status of a weekly report. Allowed transitions are validated
// only at the value level — the UI decides which buttons to show. Optional
// `note` is appended to the admin-side report note (kept in Mongo) so the
// reason for a Return/Under-Review is preserved without round-tripping it to
// Lovable's schema, which doesn't have a column for it.
const ALLOWED_STATUSES = new Set(['Submitted', 'Under Review', 'Returned', 'Approved']);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured', detail: 'Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_ADMIN_EMAIL, and SUPABASE_ADMIN_PASSWORD in .env.local' },
      { status: 503 }
    );
  }

  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing report id' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const { status, note, updatedBy } = body as { status?: string; note?: string; updatedBy?: string };

    if (!status || !ALLOWED_STATUSES.has(status)) {
      return NextResponse.json(
        { error: 'Invalid status', detail: `status must be one of: ${Array.from(ALLOWED_STATUSES).join(', ')}` },
        { status: 400 }
      );
    }

    const supa = await getSupabaseServerClient();

    // The Lovable DB enforces a status state-machine and rejects some DIRECT
    // transitions — notably "Returned -> Approved" (a Returned report can only
    // be re-Submitted, and the tech app doesn't always do that, so reports get
    // stuck). Try the direct change first; if the DB rejects it, walk an
    // allowed path (e.g. Returned -> Submitted -> Approved) server-side so a
    // single "Approve" click works regardless of where the report is stuck.
    const setStatus = (s: string) =>
      supa.from('weekly_reports').update({ status: s }).eq('id', id).select('id, status').maybeSingle();

    const { data: current } = await supa
      .from('weekly_reports').select('id, status').eq('id', id).maybeSingle();
    if (!current) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

    let { data: updated, error: updateErr } = await setStatus(status);

    if (updateErr && current.status !== status) {
      // Candidate intermediate paths that END at the requested status.
      const paths: string[][] = status === 'Approved'
        ? [['Submitted', 'Approved'], ['Submitted', 'Under Review', 'Approved']]
        : [['Submitted', status]];
      let lastErr: unknown = updateErr;
      let done = false;
      for (const path of paths) {
        let ok = true;
        for (const step of path) {
          const r = await setStatus(step);
          if (r.error) { lastErr = r.error; ok = false; break; }
          updated = r.data;
        }
        if (ok) { done = true; break; }
      }
      if (!done) throw lastErr;
    } else if (updateErr) {
      throw updateErr;
    }
    if (!updated) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

    // Optional admin note (kept in our Mongo, not pushed to Lovable).
    if (typeof note === 'string' && note.trim().length > 0) {
      await upsertNote(id, note.trim(), updatedBy ?? null);
    }

    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (err: any) {
    console.error('PATCH /api/verify/weekly-reports/[id] error', err);
    return NextResponse.json({ error: 'Failed to update report', detail: err?.message || String(err) }, { status: 500 });
  }
}
