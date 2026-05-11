import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '../../../../../../lib/supabase-server';
import { upsertNote } from '../../../../../../lib/verify/notes-store';

// PUT an admin-only note for the whole report. Stored in our Mongo (NOT
// Lovable's Supabase) so techs never see it on their app.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing report id' }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const note = typeof body?.note === 'string' ? body.note : '';

    // Capture which admin made the change (Supabase auth still gates the API).
    const supa = await getSupabaseServerClient();
    const { data: userInfo } = await supa.auth.getUser();
    const updatedBy = userInfo?.user?.email || userInfo?.user?.id || null;

    await upsertNote(id, note, updatedBy);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('PUT /api/verify/weekly-reports/[id]/note error', err);
    return NextResponse.json({ error: 'Failed to save note', detail: err?.message || String(err) }, { status: 500 });
  }
}
