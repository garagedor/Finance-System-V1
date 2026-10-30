/** Test fixture: an in-memory Arena with the real engine over editable synthetic jobs. */
import { computeCompetition } from "../engine";
import { buildCompetitorMap } from "../identity";
import { SEED_STANDARD_WEEK } from "../config";
import { KNOWN_STATUSES } from "../../status-canonical";
import {
  activateCompetition, createCompetition, initSettings, saveTemplate, scheduleCompetition, type StoreContext,
} from "../config-store";
import type { LifecycleContext } from "../lifecycle";
import type { ArenaJob } from "../types";
import { checkAccounts, type AccountCacheDoc } from "../accounts";
import { VerifierUnavailableError, type AccountStatus, type TechnicianVerifier } from "../tech/verifier";
import { memoryStore, MemoryCollection } from "./memory-collection";

export const OWNER = "owner-1";
export const ADMIN = "admin-2";
export const WEEK = "2026-10-26";

export const PEOPLE = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Ann Able", crm: "Ann", location: "Columbus" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Bo Baker", crm: "Bo", location: "Chicago" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Cy Cole", crm: "Cy", location: "Milwaukee" },
];

let seq = 0;
export function jobs(n: number, crm: string, status: string, profit: number, date = WEEK): ArenaJob[] {
  return Array.from({ length: n }, () => {
    seq += 1;
    return { id: `job${String(seq).padStart(6, "0")}`, tech: crm, date, status, location: "Somewhere", profit, dupKeys: [] };
  });
}

export async function fixture(opts: { now?: string; devStack?: boolean } = {}) {
  let t = new Date(opts.now ?? "2026-10-28T15:00:00Z");
  let n = 0;
  const config: StoreContext = { store: memoryStore(), knownStatuses: KNOWN_STATUSES, now: () => t, newId: (p) => `${p}_${++n}` };
  const lc = {
    snapshots: new MemoryCollection(), results: new MemoryCollection(), approvals: new MemoryCollection(),
    events: new MemoryCollection(), claims: new MemoryCollection(),
  };
  const data = {
    jobs: [] as ArenaJob[],
    computeCalls: 0,
    /** Weekly Balance accounts by id (default: every PEOPLE entry active + approved). */
    accounts: new Map<string, AccountStatus>(PEOPLE.map((p) => [p.id, { active: true, approved: true, role: "technician" }])),
    /** Ids whose verification fails (true = the whole verifier is down). */
    verifierDown: false as boolean | Set<string>,
    verifyCalls: 0,
  };
  const verifier: TechnicianVerifier = {
    async verify(id) {
      data.verifyCalls += 1;
      if (data.verifierDown === true || (data.verifierDown instanceof Set && data.verifierDown.has(id)))
        throw new VerifierUnavailableError("down (test)");
      return data.accounts.get(id) ?? null;
    },
  };
  const accountCache = new MemoryCollection<AccountCacheDoc>();
  const accountDeps = { verifier, cache: accountCache, now: () => t };
  const competitors = () =>
    buildCompetitorMap({
      mappings: PEOPLE.map((p) => ({ supabaseUserId: p.id, supabaseFullName: p.name, crmTechNames: [p.crm] })),
      technicians: PEOPLE.map((p) => ({ _id: p.crm, location: p.location })),
      crmNamesInUse: [...new Set(data.jobs.map((j) => j.tech))],
    });
  const ctx: LifecycleContext = {
    config,
    lc: lc as never,
    devStack: opts.devStack ?? false,
    compute: async (weekStart, rv, mode) => {
      data.computeCalls += 1;
      const map = competitors();
      const accounts = await checkAccounts(accountDeps, map.competitors.map((c) => c.id), mode);
      return computeCompetition({ rules: rv.rules, rulesHash: rv.rulesHash, weekStart, competitors: map, jobs: data.jobs, accounts });
    },
    checkAccounts: (ids, mode) => checkAccounts(accountDeps, ids, mode),
  };
  await initSettings(config, { budgetCeilingCents: 150_000, ownerUserId: OWNER, approverUserIds: [OWNER] }, OWNER);
  await saveTemplate(config, { templateId: "standard", name: "Standard Week", rules: SEED_STANDARD_WEEK }, OWNER);
  return {
    ctx,
    lc,
    data,
    config,
    accountCache,
    setNow: (iso: string) => (t = new Date(iso)),
    /** Create, schedule and start the WEEK competition (as the owner). */
    async startWeek(week = WEEK) {
      const c = await createCompetition(config, week, { template: "standard" }, ADMIN);
      await scheduleCompetition(config, c._id, ADMIN);
      await activateCompetition(config, c._id, OWNER);
      return c._id;
    },
  };
}
