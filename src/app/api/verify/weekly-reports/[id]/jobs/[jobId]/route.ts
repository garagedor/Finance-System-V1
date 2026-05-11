import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '../../../../../../../lib/supabase-server';

// PATCH a single weekly_report_job. We only write the input fields the schema
// accepts — derived ones (job_total, tech_30, company_70, payment_fee, balance,
// legacy mirrors like cash_amount/card_amount/my_parts) are recomputed by DB
// triggers. Mirrors the payload Lovable's JobSheet sends.
const INPUT_FIELDS = [
  'job_date',
  'customer_name',
  'address',
  'notes',
  'tech_paid_cash',
  'paid_card',
  'paid_company_cash',
  'paid_company_check',
  'paid_finance',
  'tech_parts',
  'company_parts',
  'tips_card',
  'tips_finance',
  'tips_company_cash',
  'tips_check',
  'commission_rate',
] as const;

const NUMERIC_FIELDS = new Set([
  'tech_paid_cash', 'paid_card', 'paid_company_cash', 'paid_company_check',
  'paid_finance', 'tech_parts', 'company_parts',
  'tips_card', 'tips_finance', 'tips_company_cash', 'tips_check',
  'commission_rate',
]);

const NULLABLE_TEXT_FIELDS = new Set(['customer_name', 'address', 'notes']);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const { id: reportId, jobId } = await params;
    if (!reportId || !jobId) {
      return NextResponse.json({ error: 'Missing report id or job id' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const update: Record<string, any> = {};
    for (const k of INPUT_FIELDS) {
      if (!(k in body)) continue;
      const v = body[k];
      if (NUMERIC_FIELDS.has(k)) {
        const n = typeof v === 'number' ? v : Number(v);
        update[k] = Number.isFinite(n) ? n : 0;
      } else if (NULLABLE_TEXT_FIELDS.has(k)) {
        update[k] = v && String(v).trim() ? String(v) : null;
      } else if (k === 'job_date') {
        if (!v || typeof v !== 'string') {
          return NextResponse.json({ error: 'job_date is required' }, { status: 400 });
        }
        update[k] = v;
      } else {
        update[k] = v;
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No editable fields in body' }, { status: 400 });
    }

    const supa = await getSupabaseServerClient();

    const { data, error } = await supa
      .from('weekly_report_jobs')
      .update(update)
      .eq('id', jobId)
      .eq('weekly_report_id', reportId) // safety: refuse cross-report writes
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Job not found in this report' }, { status: 404 });

    // Audit trail — same shape Lovable uses.
    const { data: userInfo } = await supa.auth.getUser();
    const note = `Admin edited job ${jobId} (${Object.keys(update).join(', ')})`;
    const { error: logErr } = await supa.from('report_activity_log').insert({
      weekly_report_id: reportId,
      action_type: 'admin_edit:update_job',
      action_by_user_id: userInfo?.user?.id || null,
      note,
    });
    if (logErr) console.warn('activity log insert failed (non-fatal):', logErr.message);

    return NextResponse.json({ ok: true, job: data });
  } catch (err: any) {
    console.error('PATCH /api/verify/weekly-reports/[id]/jobs/[jobId] error', err);
    return NextResponse.json({ error: 'Failed to update job', detail: err?.message || String(err) }, { status: 500 });
  }
}
