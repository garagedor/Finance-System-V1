/**
 * Arena step of the EXISTING daily cron (/api/scanpay/cron-sync, 05:00 UTC —
 * i.e. right at Monday 00:00 America/New_York in winter, an hour after it in
 * summer). It only freezes weeks that are due; it never approves, never
 * re-checks and never writes outside the Arena database. Never throws: the
 * cron's other work is unaffected by anything here.
 */
import "server-only";
import { arenaContexts } from "./admin-service";
import { ArenaEnvError } from "./env";
import { freezeDueCompetitions } from "./lifecycle";

export async function arenaCronStep(): Promise<unknown> {
  try {
    const ctx = await arenaContexts();
    return await freezeDueCompetitions(ctx.lifecycle);
  } catch (e) {
    if (e instanceof ArenaEnvError) return "not configured";
    return { error: e instanceof Error ? e.message : "arena freeze check failed" };
  }
}
