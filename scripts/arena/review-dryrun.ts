/**
 * Review-queue dry run against the real CRM. READ-ONLY on the CRM; writes
 * nothing anywhere except a throwaway in-memory MongoDB that is deleted when
 * the script ends.
 *
 *   node --env-file=<path to .env.local> --import ./scripts/test-register.mjs \
 *     scripts/arena/review-dryrun.ts <firstMonday> <weeks> <out.md>
 *
 * Every write method on the CRM client throws (same proxy as validate-history).
 * The output names technicians — write it OUTSIDE the repository.
 */
import { writeFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { SEED_STANDARD_WEEK } from "../../src/lib/arena/config.ts";
import { buildArenaContexts, scanForReview } from "../../src/lib/arena/admin-service.ts";
import { ensureArenaIndexes } from "../../src/lib/arena/mongo-store.ts";
import { readiness } from "../../src/lib/arena/review.ts";
import type { DuplicateCaseData, IdentityCaseData, DisplayNameCaseData, ReviewCaseDoc } from "../../src/lib/arena/review.ts";

const [firstMonday = "2026-08-31", weeksArg = "8", outPath] = process.argv.slice(2);
if (!outPath) throw new Error("usage: review-dryrun.ts <firstMonday> <weeks> <out.md>");

const WRITE = /^(insert|update|replace|delete|bulkWrite|findOneAnd|createIndex|drop|rename|createCollection)/;
const blocked: string[] = [];
function readOnly<T extends object>(target: T, label: string): T {
  return new Proxy(target, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      if (typeof p === "string" && WRITE.test(p)) {
        return () => {
          blocked.push(`${label}.${p}`);
          throw new Error(`READ-ONLY: ${label}.${p} blocked`);
        };
      }
      if (p === "aggregate" && typeof v === "function") {
        return (pipeline: unknown[], ...rest: unknown[]) => {
          if (JSON.stringify(pipeline).match(/"\$(out|merge)"/)) {
            blocked.push(`${label}.aggregate($out/$merge)`);
            throw new Error("READ-ONLY: $out/$merge blocked");
          }
          return v.call(t, pipeline, ...rest);
        };
      }
      if (p === "collection" && typeof v === "function") return (n: string, ...a: unknown[]) => readOnly(v.call(t, n, ...a), n);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

const crmClient = new MongoClient(process.env.MONGODB_URI!, { readPreference: "secondaryPreferred" });
await crmClient.connect();
const crm = readOnly(crmClient.db(process.env.MONGODB_DB ?? "ag"), "crm");
const mem = await MongoMemoryServer.create();
const memClient = await MongoClient.connect(mem.getUri());
try {
  const arena = memClient.db("arena_dryrun");
  await ensureArenaIndexes(arena);
  const ctx = buildArenaContexts(arena, crm);
  const scan = await scanForReview(ctx, SEED_STANDARD_WEEK, firstMonday, Number(weeksArg), "dry-run");
  const cases = (await arena.collection("arena_review_case").find({}).toArray()) as unknown as ReviewCaseDoc[];
  const r = await readiness(ctx.review);
  const dups = cases.filter((c) => c.kind === "duplicate_group");
  const names = cases.filter((c) => c.kind === "identity_name");
  const disp = cases.filter((c) => c.kind === "display_name");
  const md = [
    `# Review queue dry run · ${scan.weeks[0]} + ${scan.weeks.length} weeks`,
    "",
    `CRM writes blocked: ${blocked.length}${blocked.length ? ` (${[...new Set(blocked)].join(", ")})` : ""}`,
    `Cases: ${cases.length} · launch blocking: ${r.launchBlocking}`,
    "",
    `## Suspected duplicate groups: ${dups.length} (likely: ${dups.filter((c) => (c.data as DuplicateCaseData).likely).length}, could change prizes: ${dups.filter((c) => (c.data as DuplicateCaseData).mayAffectPrizes).length})`,
    ...dups.map((c) => {
      const d = c.data as DuplicateCaseData;
      return `- ${d.date} ${d.competitorName}: ${d.jobs.map((j) => `${j.status} $${j.profit.toFixed(2)}`).join(" + ")}${d.likely ? " · LIKELY" : ""}${d.mayAffectPrizes ? " · prize-relevant" : ""}`;
    }),
    "",
    `## CRM names without a verified person: ${names.length}`,
    ...names.map((c) => {
      const d = c.data as IdentityCaseData;
      return `- ${d.crmName}: ${d.issue}, ${d.jobs} jobs, ${d.locations.join("/") || "no location"}${d.suggestedCategory ? ` (hint: ${d.suggestedCategory})` : ""}`;
    }),
    "",
    `## Missing English display names: ${disp.length}`,
    ...disp.map((c) => `- ${(c.data as DisplayNameCaseData).currentName} (CRM: ${(c.data as DisplayNameCaseData).crmNames.join(", ")})`),
    "",
  ].join("\n");
  writeFileSync(outPath, md);
  console.log(md.split("\n").filter((l) => !l.startsWith("- ")).join("\n"));
} finally {
  await memClient.close();
  await mem.stop();
  await crmClient.close();
}
