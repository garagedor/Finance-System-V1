import "server-only";
import { getDb, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { scanpayKeys } from "./client";
import { DEFAULT_TEAM_IDS_BY_KEY, teamLabel } from "./team-names";

// Which ScanPay team each API key belongs to, stored in finance_scanpay_team and
// refreshed by the payout sync — so a reordered key can't mislabel an account.

export async function refreshTeamIds(): Promise<number[]> {
  const db = await getDb();
  const ids: number[] = [];
  for (const [i, key] of scanpayKeys().entries()) {
    const res = await fetch(`${process.env.SCANPAY_API_BASE || "https://api.scanpay.tech"}/connect/v1/disputes`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store",
    }).catch(() => null);
    const body = res?.ok ? ((await res.json()) as { meta?: { teamId?: number } }) : null;
    const teamId = Number(body?.meta?.teamId) || DEFAULT_TEAM_IDS_BY_KEY[i] || 0;
    ids.push(teamId);
    await db.collection(FINANCE_COLLECTIONS.scanpayTeam).updateOne(
      { _id: (i + 1) as never }, { $set: { teamId, updated_at: new Date().toISOString() } }, { upsert: true },
    );
    await new Promise((r) => setTimeout(r, 700));
  }
  return ids;
}

export async function teamIdsByKey(): Promise<number[]> {
  const db = await getDb();
  const rows = await db.collection(FINANCE_COLLECTIONS.scanpayTeam).find({}).toArray();
  if (!rows.length) return DEFAULT_TEAM_IDS_BY_KEY;
  const out = [...DEFAULT_TEAM_IDS_BY_KEY];
  for (const r of rows) out[Number(r._id) - 1] = Number(r.teamId) || out[Number(r._id) - 1];
  return out;
}

/** team number → internal name, for server pages. */
export async function teamLabeler(): Promise<(team: number | null | undefined) => string> {
  const ids = await teamIdsByKey();
  return (team) => teamLabel(team, ids);
}
