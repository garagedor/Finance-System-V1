// ScanPay accounts by their internal names (owner, 2026-11-06). ScanPay names
// all three "Garage Door Service", so the CRM uses its own names, keyed by
// ScanPay's team id (stable) — not by the order of the API keys.

export const SCANPAY_TEAM_NAMES: Record<number, string> = {
  36900: "Ohio / Indiana",          // Cincinnati, Cleveland, Columbus, Indianapolis, St. Louis
  37020: "Milwaukee / Minneapolis", // paid out to Fifth Third 2026-03-23 → 2026-09-28
  37019: "Chicago",                 // Chicago, Nashville, Springfield
};

/** ScanPay team id behind SCANPAY_API_KEY, _2, _3 (checked 2026-11-06; the payout sync re-checks it). */
export const DEFAULT_TEAM_IDS_BY_KEY = [36900, 37020, 37019];

/** The CRM's "team" number is the 1-based position of the API key. */
export function teamLabel(team: number | null | undefined, teamIdsByKey: number[] = DEFAULT_TEAM_IDS_BY_KEY): string {
  if (!team) return "—";
  const id = teamIdsByKey[team - 1];
  return (id && SCANPAY_TEAM_NAMES[id]) || `Account ${team}`;
}

export function teamLabelById(teamId: number | null | undefined): string {
  return (teamId && SCANPAY_TEAM_NAMES[teamId]) || (teamId ? `Team ${teamId}` : "—");
}
