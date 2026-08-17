// Job picker for the dispute/refund entry modal. Searches CRM jobs by address /
// customer / tech, newest first. Read-only.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { JobRow } from "@/types/job";

const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export async function GET(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const db = await getDb();

  // Only surface REAL jobs (has an address or any collected money) — skip the
  // ~5.5k empty auto-created placeholder rows that otherwise flood the picker.
  const clauses: Record<string, unknown>[] = [
    { $or: [
      { address: { $type: "string", $ne: "" } },
      { totalAmount: { $gt: 0 } },
      { totalPaidCard: { $gt: 0 } }, { totalPaidCompanyCheck: { $gt: 0 } },
      { totalPaidFinance: { $gt: 0 } }, { totalPaidCompanyCash: { $gt: 0 } },
      { techPaidCash: { $gt: 0 } }, { lmCash: { $gt: 0 } }, { lmCheck: { $gt: 0 } },
    ] },
  ];
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    clauses.push({ $or: [{ address: rx }, { clientName: rx }, { tech: rx }] });
  }
  const filter: Record<string, unknown> = { $and: clauses };

  const rows = await db.collection<JobRow>("Job")
    .find(filter)
    .sort({ jobDateNormalized: -1, _id: -1 })
    .limit(30)
    .toArray();

  const jobs = rows.map((j) => {
    const grossTip = num(j.tipsCard) + num(j.tipsFinance) + num(j.tipsCompanyCash) + num(j.tipsCheck);
    const parts = num(j.techParts) + num(j.companyParts) + num(j.lmParts);
    // Job amount = totalAmount, else the payment buckets (matches enrichJobs so
    // the picker shows the real "collected" for bucket-paid jobs, not $0).
    const ta = num(j.totalAmount);
    const jobAmount = ta > 0 ? ta
      : num(j.totalPaidCard) + num(j.totalPaidCompanyCheck) + num(j.totalPaidFinance)
        + num(j.totalPaidCompanyCash) + num(j.techPaidCash) + num(j.lmCash) + num(j.lmCheck);
    return {
      _id: String((j as { _id?: unknown })._id ?? ""),
      date: j.date ?? null,
      address: j.address ?? null,
      clientName: j.clientName ?? null,
      tech: j.tech ?? null,
      location: j.location ?? null,
      provider: j.provider ?? null,
      jobAmount,
      grossTip,
      parts,
      collected: jobAmount + grossTip,
    };
  });
  return NextResponse.json({ jobs });
}
