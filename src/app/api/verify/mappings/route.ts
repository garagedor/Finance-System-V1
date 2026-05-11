import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import type { JobRow } from '../../../../types/job';
import { getSupabaseServerClient, isSupabaseConfigured } from '../../../../lib/supabase-server';
import {
  listTechMappings,
  listAreaMappings,
  upsertTechMapping,
  upsertAreaMapping,
} from '../../../../lib/verify/mapping-store';

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';
const JOB_COLLECTION = 'Job';

let cachedMongo: MongoClient | null = null;
async function getMongoClient(): Promise<MongoClient> {
  if (cachedMongo) return cachedMongo;
  const c = new MongoClient(MONGODB_URI);
  await c.connect();
  cachedMongo = c;
  return c;
}

// GET — list every Supabase user/area, every CRM tech/location, and current mappings.
export async function GET(_req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured', detail: 'Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_ADMIN_EMAIL, and SUPABASE_ADMIN_PASSWORD in .env.local' },
      { status: 503 }
    );
  }

  try {
    const supa = await getSupabaseServerClient();

    // Pull all users and areas from Supabase (admin RLS — should see everything).
    const [{ data: users, error: usersErr }, { data: areas, error: areasErr }] = await Promise.all([
      supa.from('users').select('id, full_name, role').order('full_name', { ascending: true }),
      supa.from('areas').select('id, name').order('name', { ascending: true }),
    ]);
    if (usersErr) throw usersErr;
    if (areasErr) throw areasErr;

    // Distinct CRM tech names + location names.
    const mongo = await getMongoClient();
    const jobCol = mongo.db(DB_NAME).collection<JobRow>(JOB_COLLECTION);
    const [crmTechs, crmLocations] = await Promise.all([
      jobCol.distinct('tech', {}),
      jobCol.distinct('location', {}),
    ]);
    const crmTechList = (crmTechs as any[]).filter((t) => typeof t === 'string' && t.trim()).sort((a, b) => a.localeCompare(b));
    const crmLocationList = (crmLocations as any[]).filter((l) => typeof l === 'string' && l.trim()).sort((a, b) => a.localeCompare(b));

    const [techMappings, areaMappings] = await Promise.all([
      listTechMappings(),
      listAreaMappings(),
    ]);

    return NextResponse.json({
      supabaseUsers: (users || []).map((u: any) => ({ id: u.id, fullName: u.full_name, role: u.role || null })),
      supabaseAreas: (areas || []).map((a: any) => ({ id: a.id, name: a.name })),
      crmTechs: crmTechList,
      crmLocations: crmLocationList,
      techMappings,
      areaMappings,
    });
  } catch (err: any) {
    console.error('GET /api/verify/mappings error', err);
    return NextResponse.json({ error: 'Failed to load mappings', detail: err?.message || String(err) }, { status: 500 });
  }
}

// PUT — upsert one tech or area mapping. Body shape:
//   { kind: 'tech', supabaseUserId, supabaseFullName, crmTechNames }
//   { kind: 'area', supabaseAreaId, supabaseAreaName, crmLocationNames }
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const kind = body?.kind;

    if (kind === 'tech') {
      const { supabaseUserId, supabaseFullName, crmTechNames } = body;
      if (!supabaseUserId || typeof supabaseUserId !== 'string') {
        return NextResponse.json({ error: 'Missing supabaseUserId' }, { status: 400 });
      }
      if (!Array.isArray(crmTechNames)) {
        return NextResponse.json({ error: 'crmTechNames must be an array' }, { status: 400 });
      }
      await upsertTechMapping({
        supabaseUserId,
        supabaseFullName: supabaseFullName || '',
        crmTechNames: crmTechNames.filter((n: any) => typeof n === 'string' && n.trim()),
      });
      return NextResponse.json({ ok: true });
    }

    if (kind === 'area') {
      const { supabaseAreaId, supabaseAreaName, crmLocationNames } = body;
      if (!supabaseAreaId || typeof supabaseAreaId !== 'string') {
        return NextResponse.json({ error: 'Missing supabaseAreaId' }, { status: 400 });
      }
      if (!Array.isArray(crmLocationNames)) {
        return NextResponse.json({ error: 'crmLocationNames must be an array' }, { status: 400 });
      }
      await upsertAreaMapping({
        supabaseAreaId,
        supabaseAreaName: supabaseAreaName || '',
        crmLocationNames: crmLocationNames.filter((n: any) => typeof n === 'string' && n.trim()),
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown kind (expected "tech" or "area")' }, { status: 400 });
  } catch (err: any) {
    console.error('PUT /api/verify/mappings error', err);
    return NextResponse.json({ error: 'Failed to save mapping', detail: err?.message || String(err) }, { status: 500 });
  }
}
