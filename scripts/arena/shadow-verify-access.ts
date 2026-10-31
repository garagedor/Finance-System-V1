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
 * Exit 0 only when every line is PASS.
 */
import { GUARD_EXIT_CODE, openGuardedCrm, runGuarded } from "./lib-ro-guard.ts";

const PROBE_ID = "__arena_probe_nonexistent__";
const line = (ok: boolean, name: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
};
const code = (e: unknown) => (e as { code?: number })?.code;
const codeName = (e: unknown) => (e as { codeName?: string })?.codeName ?? (e instanceof Error ? e.name : "error");

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
  const ag = crm.raw.db(crm.db.databaseName);

  try {
    const r = await ag.collection("Job").updateOne({ _id: PROBE_ID as never }, { $set: { __arenaProbe: 1 } }, { upsert: false });
    results.push(line(false, "server refuses a write on Job", `the server ACCEPTED the command (matched ${r.matchedCount}, modified ${r.modifiedCount}) — the user can write, or the server runs without access control`));
  } catch (e) {
    results.push(line(code(e) === 13, "server refuses a write on Job", `code ${code(e)} ${codeName(e)}`));
  }

  try {
    await ag.collection("users").findOne({}, { projection: { _id: 1 } });
    results.push(line(false, "server refuses find on a non-granted collection (users)", "the read was ALLOWED"));
  } catch (e) {
    results.push(line(code(e) === 13, "server refuses find on a non-granted collection (users)", `code ${code(e)} ${codeName(e)}`));
  }

  try {
    await crm.db.collection("Job").updateOne({ _id: PROBE_ID as never }, { $set: { __arenaProbe: 1 } });
    results.push(line(false, "in-process proxy blocks writes", "the proxy let a write through"));
  } catch (e) {
    results.push(line(/READ-ONLY/.test((e as Error).message), "in-process proxy blocks writes", (e as Error).message));
  }

  await crm.close();
  return results.every(Boolean) ? 0 : 1;
});
