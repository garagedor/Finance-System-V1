import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import type { EquipmentProduct } from "@/types/equipment";

// Area Managers for the order builder come from the finance-ledger holders
// (role "area_manager") — the canonical accounts an order charges. Deduped
// case-insensitively, junk removed, sorted.
export async function fetchAreaManagerNames(): Promise<string[]> {
  await ensureFinanceIndexes();
  const holders = await coll<{ holder_name: string }>(FINANCE_COLLECTIONS.ledger)
    .find({ role: "area_manager" }, { projection: { holder_name: 1 } }).toArray();
  const seen = new Map<string, string>();
  for (const h of holders) {
    const name = String(h.holder_name ?? "").trim();
    if (!name || name.toLowerCase() === "null") continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export async function fetchActiveProducts(): Promise<EquipmentProduct[]> {
  await ensureFinanceIndexes();
  return coll<EquipmentProduct>(FINANCE_COLLECTIONS.equipmentProduct)
    .find({ active: true }).sort({ name: 1 }).limit(2000).toArray();
}
