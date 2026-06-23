// Server-side helpers for the People modules — pull from CRM collections
// + augment with finance data (open debts, recent payouts).

import { getDb, coll, FINANCE_COLLECTIONS } from "./finance-db";
import type { DebtRecord, PayoutRecord } from "@/types/finance";

interface CrmTech {
  _id: string;
  profitPercent?: number | string;
  location?: string;
}
interface CrmProvider {
  _id: string;
  initials?: string;
  profitPercent?: number | string;
}
interface CrmLocation {
  _id: string;
  managerProfitPercent?: number | string;
  technician?: string;
}

export interface AugmentedTech extends CrmTech {
  openDebts: number;
  totalDebt: number;
  lastPayout?: string;
  payoutsCount: number;
}

export interface AugmentedProvider extends CrmProvider {
  openDebts: number;
  totalDebt: number;
}

export interface AugmentedLocation extends CrmLocation {
  openDebts: number;
  totalDebt: number;
  lastPayout?: string;
  payoutsCount: number;
}

async function debtsByParty(): Promise<Map<string, { count: number; total: number }>> {
  const c = await coll<DebtRecord>(FINANCE_COLLECTIONS.debt);
  const open = await c.find({ status: "open" }).toArray();
  const map = new Map<string, { count: number; total: number }>();
  for (const d of open) {
    for (const p of [d.from_party_id, d.from_party_name, d.to_party_id, d.to_party_name]) {
      if (!p) continue;
      const cur = map.get(p) ?? { count: 0, total: 0 };
      cur.count++;
      cur.total += d.amount;
      map.set(p, cur);
    }
  }
  return map;
}

async function payoutsByRecipient(): Promise<Map<string, { count: number; latest: string }>> {
  const c = await coll<PayoutRecord>(FINANCE_COLLECTIONS.payout);
  const rows = await c.find({}).toArray();
  const map = new Map<string, { count: number; latest: string }>();
  for (const p of rows) {
    for (const key of [p.recipient_id, p.recipient_name]) {
      if (!key) continue;
      const cur = map.get(key) ?? { count: 0, latest: "" };
      cur.count++;
      if (p.period_end > cur.latest) cur.latest = p.period_end;
      map.set(key, cur);
    }
  }
  return map;
}

export async function fetchTechnicians(): Promise<AugmentedTech[]> {
  const db = await getDb();
  const techs = await db.collection<CrmTech>("Technician").find({}).toArray();
  const [debts, payouts] = await Promise.all([debtsByParty(), payoutsByRecipient()]);
  return techs.map((t) => {
    const debt = debts.get(t._id) ?? { count: 0, total: 0 };
    const payout = payouts.get(t._id) ?? { count: 0, latest: "" };
    return {
      ...t,
      openDebts: debt.count,
      totalDebt: debt.total,
      lastPayout: payout.latest || undefined,
      payoutsCount: payout.count,
    };
  });
}

export async function fetchProviders(): Promise<AugmentedProvider[]> {
  const db = await getDb();
  const providers = await db.collection<CrmProvider>("Provider").find({}).toArray();
  const debts = await debtsByParty();
  return providers.map((p) => {
    const debt = debts.get(p._id) ?? { count: 0, total: 0 };
    return { ...p, openDebts: debt.count, totalDebt: debt.total };
  });
}

export async function fetchLocations(): Promise<AugmentedLocation[]> {
  const db = await getDb();
  const locations = await db.collection<CrmLocation>("Location").find({}).toArray();
  const [debts, payouts] = await Promise.all([debtsByParty(), payoutsByRecipient()]);
  return locations.map((l) => {
    const debt = debts.get(l._id) ?? { count: 0, total: 0 };
    const payout = payouts.get(l._id) ?? { count: 0, latest: "" };
    return {
      ...l,
      openDebts: debt.count,
      totalDebt: debt.total,
      lastPayout: payout.latest || undefined,
      payoutsCount: payout.count,
    };
  });
}
