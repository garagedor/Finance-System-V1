import { MongoClient, Collection } from 'mongodb';

// Admin-only notes attached to a Lovable weekly report. Stored in OUR Mongo
// (not Lovable's Supabase) so the tech never sees them on their app.

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';
const REPORT_NOTE_COLLECTION = 'WeeklyReportAdminNote';
const JOB_NOTE_COLLECTION = 'WeeklyReportJobAdminNote';

export type WeeklyReportNote = {
  weeklyReportId: string;
  note: string;
  updatedAt?: Date;
  updatedBy?: string | null;
};

export type WeeklyReportJobNote = {
  weeklyReportId: string;
  weeklyReportJobId: string;
  note: string;
  updatedAt?: Date;
  updatedBy?: string | null;
};

let cached: MongoClient | null = null;
async function client(): Promise<MongoClient> {
  if (cached) return cached;
  const c = new MongoClient(MONGODB_URI);
  await c.connect();
  cached = c;
  return c;
}

async function reportNoteCol(): Promise<Collection<WeeklyReportNote>> {
  const c = await client();
  return c.db(DB_NAME).collection<WeeklyReportNote>(REPORT_NOTE_COLLECTION);
}

async function jobNoteCol(): Promise<Collection<WeeklyReportJobNote>> {
  const c = await client();
  return c.db(DB_NAME).collection<WeeklyReportJobNote>(JOB_NOTE_COLLECTION);
}

export async function getNote(weeklyReportId: string): Promise<WeeklyReportNote | null> {
  const col = await reportNoteCol();
  const r = await col.findOne({ weeklyReportId });
  return r ? { weeklyReportId: r.weeklyReportId, note: r.note || '', updatedAt: r.updatedAt, updatedBy: r.updatedBy ?? null } : null;
}

export async function upsertNote(weeklyReportId: string, note: string, updatedBy: string | null): Promise<void> {
  const col = await reportNoteCol();
  await col.updateOne(
    { weeklyReportId },
    { $set: { note: note || '', updatedAt: new Date(), updatedBy } },
    { upsert: true },
  );
}

// Returns all per-job notes for the given report as a { jobId: note } map.
export async function getJobNotesForReport(weeklyReportId: string): Promise<Record<string, string>> {
  const col = await jobNoteCol();
  const rows = await col.find({ weeklyReportId }).toArray();
  const out: Record<string, string> = {};
  rows.forEach((r) => { out[r.weeklyReportJobId] = r.note || ''; });
  return out;
}

export async function upsertJobNote(weeklyReportId: string, weeklyReportJobId: string, note: string, updatedBy: string | null): Promise<void> {
  const col = await jobNoteCol();
  await col.updateOne(
    { weeklyReportJobId },
    { $set: { weeklyReportId, weeklyReportJobId, note: note || '', updatedAt: new Date(), updatedBy } },
    { upsert: true },
  );
}
