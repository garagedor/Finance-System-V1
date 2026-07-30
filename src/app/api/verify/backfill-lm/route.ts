// One-time backfill: copy lmCash / lmCheck / lmParts from CRM into Lovable's
// weekly_report_jobs.lm_cash / lm_check / lm_parts for paired jobs whose
// Supabase value is currently 0. Conservative — never overwrites a non-zero
// Lovable value (so anything the tech actually entered post-2026-05-18 is
// preserved).
//
// Admin-only. Dry-run by default; pass ?dryRun=false to actually write.

import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from "@/lib/mongo";
import { jwtVerify } from 'jose';
import type { JobRow } from '../../../../types/job';
import { getSupabaseServerClient, isSupabaseConfigured } from '../../../../lib/supabase-server';
import { getTechMappingByUserId } from '../../../../lib/verify/mapping-store';
import { getLinksForReport } from '../../../../lib/verify/links-store';
import { compare, deriveCrmMethod, type SupabaseReportJob, type CrmJob } from '../../../../lib/verify/compare';

const DB_NAME = 'ag';
const JOB_COLLECTION = 'Job';
const JWT_SECRET = new TextEncoder().encode('super-secret-key-for-development');


async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  const session = request.cookies.get('session')?.value;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { payload } = await jwtVerify(session, JWT_SECRET);
    if ((payload as { type?: string }).type !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return null;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

const num = (v: any): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

type Proposal = {
  reportId: string;
  supabaseJobId: string;
  jobDate: string | null;
  customerName: string | null;
  lm_cash?: number;
  lm_check?: number;
  lm_parts?: number;
};

export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured', detail: 'Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_ADMIN_EMAIL, SUPABASE_ADMIN_PASSWORD' },
      { status: 503 }
    );
  }

  const dryRun = (new URL(request.url).searchParams.get('dryRun') ?? 'true').toLowerCase() !== 'false';

  try {
    const supa = await getSupabaseServerClient();
    const mongo = await getMongoClient();
    const jobCol = mongo.db(DB_NAME).collection<JobRow>(JOB_COLLECTION);

    // 1) Every weekly report (all statuses).
    const { data: reports, error: reportsErr } = await supa
      .from('weekly_reports')
      .select('id, technician_id, week_start, week_end')
      .order('week_start', { ascending: false });
    if (reportsErr) throw reportsErr;

    const proposals: Proposal[] = [];
    const errors: Array<{ reportId: string; error: string }> = [];
    let scannedReports = 0;
    let scannedPairs = 0;

    for (const report of reports || []) {
      scannedReports++;
      try {
        // Tech name(s) to query on the CRM side — same precedence as the
        // detail endpoint: mapping override, else Supabase full_name.
        const [techRowRes, techMap] = await Promise.all([
          supa.from('users').select('full_name').eq('id', report.technician_id).maybeSingle(),
          getTechMappingByUserId(report.technician_id),
        ]);
        const techName = (techRowRes.data as any)?.full_name || '';
        const techNamesToQuery: string[] = (techMap?.crmTechNames && techMap.crmTechNames.length > 0)
          ? techMap.crmTechNames
          : (techName ? [techName] : []);
        if (techNamesToQuery.length === 0) continue;

        // Supabase line items.
        const { data: rawJobs, error: jobsErr } = await supa
          .from('weekly_report_jobs')
          .select('id, job_date, customer_name, address, total_job, card_amount, cash_amount, tech_cash, company_cash, tip_amount, my_parts, company_parts, payment_type, lm_cash, lm_check, lm_parts')
          .eq('weekly_report_id', report.id);
        if (jobsErr) throw jobsErr;
        const supabaseJobs: SupabaseReportJob[] = (rawJobs || []).map((r: any) => ({
          id: r.id,
          job_date: r.job_date,
          customer_name: r.customer_name,
          address: r.address,
          total_job: num(r.total_job),
          card_amount: num(r.card_amount),
          cash_amount: num(r.cash_amount),
          tech_cash: num(r.tech_cash),
          company_cash: num(r.company_cash),
          tip_amount: num(r.tip_amount),
          my_parts: num(r.my_parts),
          company_parts: num(r.company_parts),
          payment_type: r.payment_type ?? null,
          lm_cash: num(r.lm_cash),
          lm_check: num(r.lm_check),
          lm_parts: num(r.lm_parts),
        }));
        if (supabaseJobs.length === 0) continue;

        // CRM pool — same filter as the detail endpoint.
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const techRegexes = techNamesToQuery.map((n) => new RegExp(`^${escapeRegex(n)}$`, 'i'));
        const crmRaw = await jobCol.find({
          tech: { $in: techRegexes as any },
          date: { $gte: report.week_start, $lte: report.week_end },
          status: 'Closed',
        }).toArray();
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

        const manualLinks = await getLinksForReport(report.id);
        const result = compare(supabaseJobs, crmJobs, manualLinks);

        for (const pair of result.pairs) {
          if (!pair.supabaseJob || !pair.crmJob) continue;
          scannedPairs++;
          const s = pair.supabaseJob;
          const c = pair.crmJob;
          const update: Partial<Proposal> = {};
          if (num(s.lm_cash) === 0 && num(c.lmCash) > 0) update.lm_cash = num(c.lmCash);
          if (num(s.lm_check) === 0 && num(c.lmCheck) > 0) update.lm_check = num(c.lmCheck);
          if (num(s.lm_parts) === 0 && num(c.lmParts) > 0) update.lm_parts = num(c.lmParts);
          if (Object.keys(update).length > 0) {
            proposals.push({
              reportId: report.id,
              supabaseJobId: s.id,
              jobDate: s.job_date ?? null,
              customerName: s.customer_name ?? null,
              ...update,
            });
          }
        }
      } catch (err: any) {
        errors.push({ reportId: report.id, error: err?.message || String(err) });
      }
    }

    // Aggregate stats for the response.
    const totals = proposals.reduce(
      (acc, p) => ({
        lm_cash: acc.lm_cash + (p.lm_cash ?? 0),
        lm_check: acc.lm_check + (p.lm_check ?? 0),
        lm_parts: acc.lm_parts + (p.lm_parts ?? 0),
      }),
      { lm_cash: 0, lm_check: 0, lm_parts: 0 }
    );

    const summary = {
      dryRun,
      scannedReports,
      scannedPairs,
      proposedUpdates: proposals.length,
      totalsToFill: totals,
      sample: proposals.slice(0, 10),
      errors,
    };

    if (dryRun) {
      return NextResponse.json({ ...summary, applied: 0 });
    }

    // Apply: one update per row (different SET per row).
    let applied = 0;
    const writeErrors: Array<{ supabaseJobId: string; error: string }> = [];
    for (const p of proposals) {
      const patch: Record<string, number> = {};
      if (p.lm_cash !== undefined) patch.lm_cash = p.lm_cash;
      if (p.lm_check !== undefined) patch.lm_check = p.lm_check;
      if (p.lm_parts !== undefined) patch.lm_parts = p.lm_parts;
      const { error } = await supa.from('weekly_report_jobs').update(patch).eq('id', p.supabaseJobId);
      if (error) {
        writeErrors.push({ supabaseJobId: p.supabaseJobId, error: error.message });
      } else {
        applied++;
      }
    }

    return NextResponse.json({ ...summary, applied, writeErrors });
  } catch (err: any) {
    console.error('POST /api/verify/backfill-lm error', err);
    return NextResponse.json({ error: 'Backfill failed', detail: err?.message || String(err) }, { status: 500 });
  }
}
