// Collected-dispute picker for the ledger Add-Dispute flow. Lists ScanPay
// disputes (finance_scanpay_dispute) that are matched to a CRM job — so their
// amount + the job's provider/location/tech/AM are known and a party slice can
// be computed without anyone re-typing the amount. Filterable by provider /
// location / area manager / technician (+ text). Read-only.

import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb, coll, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { ScanpayDisputeRecord } from "@/types/scanpay";
import type { JobRow, Location } from "@/types/job";

const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const s = (v: unknown): string => (v == null ? "" : String(v));

export async function GET(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim().toLowerCase();
  const provider = sp.get("provider")?.trim();
  const location = sp.get("location")?.trim();
  const tech = sp.get("tech")?.trim();
  const areaManager = sp.get("areaManager")?.trim();

  const db = await getDb();
  const dc = coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute);

  // Chargeable = matched/verified to a CRM job (needed to compute the slice).
  const raw = await dc
    .find({ matchStatus: { $in: ["matched", "verified"] }, matchedJobId: { $type: "string", $ne: "" } } as never)
    .sort({ disputedAt: -1 })
    .limit(400)
    .toArray();

  // Join the matched jobs → provider / location / tech (the fields we filter on).
  // Job._id is a Mongo ObjectId; matchedJobId is stored as its 24-hex STRING, so
  // query both forms (mirrors dispute-service.loadJob) and key the map by the
  // hex string (String(ObjectId) === the 24-hex id === matchedJobId).
  const jobIds = [...new Set(raw.map((r) => s((r as { matchedJobId?: unknown }).matchedJobId)).filter(Boolean))];
  const idFilter: unknown[] = [...jobIds];
  for (const id of jobIds) if (/^[0-9a-fA-F]{24}$/.test(id)) idFilter.push(new ObjectId(id));
  const jobs = jobIds.length
    ? await db.collection<JobRow>("Job").find({ _id: { $in: idFilter } } as never).toArray()
    : [];
  const jobById = new Map(jobs.map((j) => [s((j as { _id?: unknown })._id), j]));

  // Area-manager filter → the set of that AM's locations.
  let amLocations: Set<string> | null = null;
  if (areaManager) {
    const locs = await db.collection<Location>("Location")
      .find({ areaManagerName: areaManager }, { projection: { _id: 1 } })
      .toArray();
    amLocations = new Set(locs.map((l) => s((l as { _id?: unknown })._id)).filter(Boolean));
  }

  const rows = raw.map((r) => {
    const rec = r as unknown as Record<string, unknown>;
    const job = jobById.get(s(rec.matchedJobId));
    const jProvider = s(job?.provider);
    const jLocation = s(job?.location);
    const jTech = s(job?.tech);
    return {
      id: s(rec._id ?? rec.disputeId),
      disputeId: s(rec.disputeId),
      amount: num(rec.amount),
      invoiceNumber: s(rec.invoiceNumber),
      customerName: s(rec.customerName),
      serviceAddress: s(rec.serviceAddress),
      reason: s(rec.reason),
      disputedAt: s(rec.disputedAt),
      matchedJobId: s(rec.matchedJobId),
      matchStatus: s(rec.matchStatus),
      provider: jProvider,
      location: jLocation,
      tech: jTech,
      // Already charged (any party) → flag it; re-charge is still allowed.
      charged: !!(rec.chargedAt || rec.ledgerEntryId || rec.postedRecordId),
      chargedAt: s(rec.chargedAt) || null,
    };
  }).filter((row) => {
    if (provider && row.provider !== provider) return false;
    if (location && row.location !== location) return false;
    if (tech && row.tech !== tech) return false;
    if (amLocations && !amLocations.has(row.location)) return false;
    if (q) {
      const hay = `${row.invoiceNumber} ${row.customerName} ${row.serviceAddress} ${row.tech} ${row.reason}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).slice(0, 100);

  return NextResponse.json({ disputes: rows });
}
