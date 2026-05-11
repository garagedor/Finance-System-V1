import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '../../../../../../../../lib/supabase-server';
import { upsertJobNote } from '../../../../../../../../lib/verify/notes-store';

// PUT an admin-only note for a specific job within a weekly report. Lives in
// our Mongo (not Lovable's Supabase) so the tech never sees it.
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
    const note = typeof body?.note === 'string' ? body.note : '';

    const supa = await getSupabaseServerClient();
    const { data: userInfo } = await supa.auth.getUser();
    const updatedBy = userInfo?.user?.email || userInfo?.user?.id || null;

    await upsertJobNote(reportId, jobId, note, updatedBy);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('PUT /api/verify/weekly-reports/[id]/jobs/[jobId]/note error', err);
    return NextResponse.json({ error: 'Failed to save note', detail: err?.message || String(err) }, { status: 500 });
  }
}
