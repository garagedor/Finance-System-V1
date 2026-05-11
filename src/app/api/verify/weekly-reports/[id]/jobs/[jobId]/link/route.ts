import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '../../../../../../../../lib/supabase-server';
import { upsertLink, removeLink } from '../../../../../../../../lib/verify/links-store';

// PUT { crmJobId } — manually link a Lovable job to a specific CRM job.
// PUT { crmJobId: null } or DELETE — remove the manual link.
export async function PUT(
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
    const crmJobId = typeof body?.crmJobId === 'string' ? body.crmJobId.trim() : '';

    const supa = await getSupabaseServerClient();
    const { data: userInfo } = await supa.auth.getUser();
    const updatedBy = userInfo?.user?.email || userInfo?.user?.id || null;

    if (!crmJobId) {
      await removeLink(jobId);
    } else {
      await upsertLink(reportId, jobId, crmJobId, updatedBy);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('PUT /api/verify/weekly-reports/[id]/jobs/[jobId]/link error', err);
    return NextResponse.json({ error: 'Failed to save link', detail: err?.message || String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const { jobId } = await params;
    if (!jobId) return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
    await removeLink(jobId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('DELETE /api/verify/weekly-reports/[id]/jobs/[jobId]/link error', err);
    return NextResponse.json({ error: 'Failed to remove link', detail: err?.message || String(err) }, { status: 500 });
  }
}
