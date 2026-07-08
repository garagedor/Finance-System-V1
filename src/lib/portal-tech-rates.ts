// Technician dispute/refund rates.
//
// Default rate = the CRM Technician.profitPercent (a tech who keeps X% of
// profit bears X% of a dispute/refund loss). A finance-side override
// (finance_technician_rate) can set a different rate for special agreements.
// Effective rate = override ?? profit. Per-entry overrides win over both.

import { coll, getDb, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "./finance-db";
import type { TechnicianRateRecord, TechRateView } from "@/types/finance-ledger";

function toNum(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** All technicians (from CRM) merged with finance overrides → effective %. */
export async function getTechRates(): Promise<TechRateView[]> {
  await ensureFinanceIndexes();
  const db = await getDb();
  const [techs, overrides] = await Promise.all([
    db.collection("Technician").find({}).toArray(),
    coll<TechnicianRateRecord>(FINANCE_COLLECTIONS.techRate).find({}).toArray(),
  ]);
  const ovByName = new Map(overrides.map((o) => [o._id, o]));
  return techs
    .map((t) => {
      const name = String((t as { _id?: unknown; name?: unknown })._id ?? (t as { name?: unknown }).name ?? "");
      const profit = toNum((t as { profitPercent?: unknown }).profitPercent);
      const ov = ovByName.get(name);
      const override = ov ? toNum(ov.dispute_pct) : null;
      return {
        name,
        location: (t as { location?: unknown }).location ? String((t as { location?: unknown }).location) : null,
        profit_pct: profit,
        override_pct: ov ? override : null,
        effective_pct: ov ? (override as number) : profit,
        note: ov?.note ?? null,
      };
    })
    .filter((r) => r.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Effective dispute/refund % (0–100) for one technician by name. */
export async function getEffectivePct(techName: string): Promise<number> {
  if (!techName) return 0;
  const ov = await coll<TechnicianRateRecord>(FINANCE_COLLECTIONS.techRate).findOne({ _id: techName });
  if (ov && Number.isFinite(Number(ov.dispute_pct))) return Number(ov.dispute_pct);
  const db = await getDb();
  const t = await db.collection("Technician").findOne({ _id: techName } as Record<string, unknown>);
  return toNum((t as { profitPercent?: unknown } | null)?.profitPercent);
}
