import { MongoClient, Collection } from 'mongodb';

// MongoDB-backed storage for identity mappings between the Lovable balance app
// (Supabase) and the CRM (this app's Mongo). One Supabase user/area can map to
// many CRM names because the CRM is inconsistent ("Bar" vs "Bar K" vs
// "Bar Kadosh"). Empty `crmTechNames` / `crmLocationNames` means "no mapping" —
// the matcher falls back to exact-match in that case.

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';
const TECH_COLLECTION = 'TechNameMapping';
const AREA_COLLECTION = 'AreaNameMapping';

export type TechMapping = {
  supabaseUserId: string;
  supabaseFullName: string;
  crmTechNames: string[];
  updatedAt?: Date;
};

export type AreaMapping = {
  supabaseAreaId: string;
  supabaseAreaName: string;
  crmLocationNames: string[];
  updatedAt?: Date;
};

let cached: MongoClient | null = null;
async function client(): Promise<MongoClient> {
  if (cached) return cached;
  const c = new MongoClient(MONGODB_URI);
  await c.connect();
  cached = c;
  return c;
}

async function techCol(): Promise<Collection<TechMapping>> {
  const c = await client();
  return c.db(DB_NAME).collection<TechMapping>(TECH_COLLECTION);
}

async function areaCol(): Promise<Collection<AreaMapping>> {
  const c = await client();
  return c.db(DB_NAME).collection<AreaMapping>(AREA_COLLECTION);
}

export async function listTechMappings(): Promise<TechMapping[]> {
  const col = await techCol();
  const rows = await col.find({}).toArray();
  return rows.map((r) => ({
    supabaseUserId: r.supabaseUserId,
    supabaseFullName: r.supabaseFullName,
    crmTechNames: r.crmTechNames || [],
    updatedAt: r.updatedAt,
  }));
}

export async function listAreaMappings(): Promise<AreaMapping[]> {
  const col = await areaCol();
  const rows = await col.find({}).toArray();
  return rows.map((r) => ({
    supabaseAreaId: r.supabaseAreaId,
    supabaseAreaName: r.supabaseAreaName,
    crmLocationNames: r.crmLocationNames || [],
    updatedAt: r.updatedAt,
  }));
}

export async function upsertTechMapping(m: TechMapping): Promise<void> {
  const col = await techCol();
  await col.updateOne(
    { supabaseUserId: m.supabaseUserId },
    {
      $set: {
        supabaseFullName: m.supabaseFullName,
        crmTechNames: m.crmTechNames,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function upsertAreaMapping(m: AreaMapping): Promise<void> {
  const col = await areaCol();
  await col.updateOne(
    { supabaseAreaId: m.supabaseAreaId },
    {
      $set: {
        supabaseAreaName: m.supabaseAreaName,
        crmLocationNames: m.crmLocationNames,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function getTechMappingByUserId(supabaseUserId: string): Promise<TechMapping | null> {
  const col = await techCol();
  const r = await col.findOne({ supabaseUserId });
  return r ? { supabaseUserId: r.supabaseUserId, supabaseFullName: r.supabaseFullName, crmTechNames: r.crmTechNames || [] } : null;
}

export async function getAreaMappingByAreaId(supabaseAreaId: string): Promise<AreaMapping | null> {
  const col = await areaCol();
  const r = await col.findOne({ supabaseAreaId });
  return r ? { supabaseAreaId: r.supabaseAreaId, supabaseAreaName: r.supabaseAreaName, crmLocationNames: r.crmLocationNames || [] } : null;
}
