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
  const filter: Record<string, unknown> = {};
  if (q) {
    filter.$or = [
      { address: { $regex: q, $options: "i" } },
      { clientName: { $regex: q, $options: "i" } },
      { tech: { $regex: q, $options: "i" } },
    ];
  }
  const rows = await db.collection<JobRow>("Job")
    .find(filter)
    .sort({ jobDateNormalized: -1, _id: -1 })
    .limit(30)
    .toArray();

  const jobs = rows.map((j) => {
    const grossTip = num(j.tipsCard) + num(j.tipsFinance) + num(j.tipsCompanyCash) + num(j.tipsCheck);
    const parts = num(j.techParts) + num(j.companyParts) + num(j.lmParts);
    const jobAmount = num(j.totalAmount);
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
