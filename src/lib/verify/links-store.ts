import { MongoClient, Collection } from 'mongodb';

// Manual pairing overrides between a Lovable weekly_report_job and a CRM Job.
// When set, the verify-reports compare uses the override instead of running
// the auto-matcher (date/address/customer). Stored in OUR Mongo so the tech
// app never sees these admin decisions.

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';
const LINK_COLLECTION = 'WeeklyReportJobLink';

export type WeeklyReportJobLink = {
  weeklyReportId: string;
  weeklyReportJobId: string;   // Lovable job UUID
  crmJobId: string;            // CRM Mongo ObjectId, as string
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

async function linkCol(): Promise<Collection<WeeklyReportJobLink>> {
  const c = await client();
  return c.db(DB_NAME).collection<WeeklyReportJobLink>(LINK_COLLECTION);
}

// Map of lovableJobId → crmJobId for a given report.
export async function getLinksForReport(weeklyReportId: string): Promise<Record<string, string>> {
  const col = await linkCol();
  const rows = await col.find({ weeklyReportId }).toArray();
  const out: Record<string, string> = {};
  rows.forEach((r) => { out[r.weeklyReportJobId] = r.crmJobId; });
  return out;
}

export async function upsertLink(
  weeklyReportId: string,
  weeklyReportJobId: string,
  crmJobId: string,
  updatedBy: string | null,
): Promise<void> {
  const col = await linkCol();
  await col.updateOne(
    { weeklyReportJobId },
    { $set: { weeklyReportId, weeklyReportJobId, crmJobId, updatedAt: new Date(), updatedBy } },
    { upsert: true },
  );
}

export async function removeLink(weeklyReportJobId: string): Promise<void> {
  const col = await linkCol();
  await col.deleteOne({ weeklyReportJobId });
}
