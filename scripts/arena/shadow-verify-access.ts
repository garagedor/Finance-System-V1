/**
 * Access self-test for the shadow-validation CRM user. Prints PASS/FAIL lines only.
 *
 *   node --env-file=<file with ARENA_CRM_RO_URI> --import ./scripts/test-register.mjs \
 *     scripts/arena/shadow-verify-access.ts
 *
 * 1. guard: the authenticated user holds only read actions (else exit 3)
 * 2. the SERVER refuses a write: updateOne on Job with a filter that matches
 *    nothing (_id "__arena_probe_nonexistent__", no upsert) → Unauthorized (13).
 *    Even if the server wrongly accepted it, nothing could change: no document
 *    has that _id and upsert is off.
 * 3. the SERVER refuses a read of a collection that is not granted (`users`) → 13
 * 4. the in-process proxy blocks writes before they are sent
 * Exit 0 only when every line is PASS. (The probes live in lib-ro-guard.ts and
 * are shared with shadow-preflight.ts.)
 */
import { GUARD_EXIT_CODE, accessProbes, openGuardedCrm, runGuarded } from "./lib-ro-guard.ts";

const line = (ok: boolean, name: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
};

await runGuarded(async () => {
  let crm;
  try {
    crm = await openGuardedCrm();
  } catch (e) {
    line(false, "guard: read-only CRM user", (e as Error).message);
    return GUARD_EXIT_CODE; // refused: no read is attempted
  }
  const results: boolean[] = [];
  results.push(line(true, "guard: read-only CRM user", `${crm.verdict.users.join(", ")}; find on ${crm.verdict.findOn.join(", ")}`));
  for (const p of await accessProbes(crm)) results.push(line(p.ok, p.name, p.detail));
  await crm.close();
  return results.every(Boolean) ? 0 : 1;
});
