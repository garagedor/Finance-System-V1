// Penalty picker for the ledger "+ Penalty" flow. Lists X-close jobs (the
// penalties) with their computed loss (totalLoss = provider% × job profit;
// AM 50% / company 50%), filterable by provider / location / area manager /
// technician (+ text). Read-only; same math as /api/report?type=penalty.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { calcPaidSum, calcParts, calcJobProfit, calcStandardShare, toNumber } from "@/app/api/utils/calculations";
import type { JobRow, Location } from "@/types/job";

const s = (v: unknown): string => (v == null ? "" : String(v));

export async function GET(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim().toLowerCase();
  const csv = (k: string) => (sp.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const providers = csv("provider");
  const locations = csv("location");
  const techs = csv("tech");
  const areaManagers = csv("areaManager");
  const startDate = sp.get("startDate")?.trim();
  const endDate = sp.get("endDate")?.trim();

  const db = await getDb();

  const clauses: Record<string, unknown>[] = [{ statusCanonical: "X close" }];
  if (providers.length) clauses.push({ provider: { $in: providers } });
  if (locations.length) clauses.push({ location: { $in: locations } });
  if (techs.length) clauses.push({ tech: { $in: techs } });
  if (startDate || endDate) {
    const range: Record<string, string> = {};
    if (startDate) range.$gte = startDate;
    if (endDate) range.$lte = endDate;
    clauses.push({ date: range });
  }
  if (areaManagers.length) {
    const locs = await db.collection<Location>("Location")
      .find({ areaManagerName: { $in: areaManagers } }, { projection: { _id: 1 } })
      .toArray();
    const names = locs.map((l) => s((l as { _id?: unknown })._id)).filter(Boolean);
    clauses.push({ location: { $in: names.length ? names : [" __none__"] } });
  }

  const [jobs, providerDocs] = await Promise.all([
    db.collection<JobRow>("Job").find({ $and: clauses } as never).sort({ jobDateNormalized: -1, _id: -1 }).limit(600).toArray(),
    db.collection("Provider").find({}).toArray(),
  ]);
  const provPct = new Map<string, number>();
  providerDocs.forEach((p) => provPct.set(s((p as { _id?: unknown })._id), toNumber((p as { profitPercent?: unknown }).profitPercent)));

  const rows = jobs.map((j) => {
    const providerPercent = provPct.get(s(j.provider)) ?? 0;
    const jobProfit = calcJobProfit(calcPaidSum(j), calcParts(j));
    const totalLoss = calcStandardShare(jobProfit, providerPercent);
    const amLoss = totalLoss * 0.5;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      id: s((j as { _id?: unknown })._id),
      date: s(j.date).slice(0, 10),
      address: s(j.address),
      tech: s(j.tech),
      location: s(j.location),
      provider: s(j.provider),
      jobProfit: r2(jobProfit),
      totalLoss: r2(totalLoss),
      amLoss: r2(amLoss),
      companyLoss: r2(totalLoss - amLoss),
    };
  }).filter((row) => {
    if (q) {
      const hay = `${row.address} ${row.tech} ${row.provider} ${row.location}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).slice(0, 500);

  return NextResponse.json({ penalties: rows });
}
