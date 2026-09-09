import { toNumber } from "@/app/api/utils/calculations";
import type { JobRow } from "@/types/job";
import type { AiJobDoc, CompareResult, ComparePair, FieldDiff, CompareCategory } from "./types";
import { matchAiToProduction } from "./match";

// ─────────────────────────────────────────────────────────────────────────────
// Field-by-field comparison of the bot's FROZEN aiOriginal vs the matched
// production job. Generic + config-driven so later phases (estimates, updates)
// just extend COMPARE_FIELDS. PURE (no I/O).
// ─────────────────────────────────────────────────────────────────────────────

const MONEY_TOLERANCE = 1; // $1, mirrors the verify module.

type FieldKind = "money" | "text" | "date" | "other";
interface CompareField {
  field: keyof JobRow;
  label: string;
  kind: FieldKind;
}

// Phase 1 surfaces the closing fields first; add rows here for later phases.
export const COMPARE_FIELDS: CompareField[] = [
  { field: "status", label: "Status", kind: "text" },
  { field: "date", label: "Date", kind: "date" },
  { field: "totalPaidCard", label: "Paid Card", kind: "money" },
  { field: "totalPaidCompanyCheck", label: "Paid Company Check", kind: "money" },
  { field: "totalPaidFinance", label: "Paid Finance", kind: "money" },
  { field: "totalPaidCompanyCash", label: "Paid Company Cash", kind: "money" },
  { field: "techPaidCash", label: "Tech Paid Cash", kind: "money" },
  { field: "lmCash", label: "LM Cash", kind: "money" },
  { field: "lmCheck", label: "LM Check", kind: "money" },
  { field: "techParts", label: "Tech Parts", kind: "money" },
  { field: "companyParts", label: "Company Parts", kind: "money" },
  { field: "lmParts", label: "LM Parts", kind: "money" },
  { field: "tipsCard", label: "Tips Card", kind: "money" },
  { field: "tipsFinance", label: "Tips Finance", kind: "money" },
  { field: "tipsCompanyCash", label: "Tips Company Cash", kind: "money" },
  { field: "tipsCheck", label: "Tips Check", kind: "money" },
  { field: "provider", label: "Provider", kind: "text" },
  { field: "tech", label: "Tech", kind: "text" },
  { field: "location", label: "Location", kind: "text" },
  { field: "address", label: "Address", kind: "text" },
  { field: "clientName", label: "Client Name", kind: "text" },
];

const normText = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim().toLowerCase());

function fieldMatches(kind: FieldKind, a: unknown, b: unknown): boolean {
  if (kind === "money") return Math.abs(toNumber(a) - toNumber(b)) <= MONEY_TOLERANCE;
  if (kind === "date") return normText(a).slice(0, 10) === normText(b).slice(0, 10);
  return normText(a) === normText(b);
}

/** Diff one paired AI job (aiOriginal) against its production twin. */
export function diffPair(ai: Partial<JobRow>, prod: Partial<JobRow>): FieldDiff[] {
  return COMPARE_FIELDS.map((cf) => {
    const aiVal = (ai as any)[cf.field];
    const prodVal = (prod as any)[cf.field];
    return {
      field: String(cf.field),
      label: cf.label,
      production: prodVal ?? null,
      ai: aiVal ?? null,
      match: fieldMatches(cf.kind, prodVal, aiVal),
      kind: cf.kind,
    };
  });
}

/** Full compare over a set of AI jobs vs production jobs (already loaded). */
export function buildCompare(
  aiJobs: AiJobDoc[],
  prodJobs: JobRow[],
  links: Record<string, string>,
): CompareResult {
  const { pairs, productionOnly } = matchAiToProduction(aiJobs, prodJobs, links);
  const out: ComparePair[] = [];
  const counts: CompareResult["counts"] = {
    "matched-clean": 0,
    "matched-mismatch": 0,
    "ai-only": 0,
    "production-only": 0,
    total: 0,
  };

  for (const p of pairs) {
    const aiOriginal = (p.aiJob.aiOriginal && Object.keys(p.aiJob.aiOriginal).length ? p.aiJob.aiOriginal : p.aiJob) as Partial<JobRow>;
    if (!p.prodJob) {
      counts["ai-only"] += 1;
      out.push({
        aiJobId: String(p.aiJob._id),
        prodJobId: null,
        confidence: 0,
        matchBy: "none",
        category: "ai-only",
        diffs: [],
        mismatchCount: 0,
        ai: { ...aiOriginal, _id: String(p.aiJob._id) },
      });
      continue;
    }
    const diffs = diffPair(aiOriginal, p.prodJob);
    const mismatchCount = diffs.filter((d) => !d.match).length;
    const category: CompareCategory = mismatchCount === 0 ? "matched-clean" : "matched-mismatch";
    counts[category] += 1;
    out.push({
      aiJobId: String(p.aiJob._id),
      prodJobId: String(p.prodJob._id),
      confidence: p.confidence,
      matchBy: p.matchBy,
      category,
      diffs,
      mismatchCount,
      ai: { ...aiOriginal, _id: String(p.aiJob._id) },
      production: { ...p.prodJob, _id: String(p.prodJob._id) },
    });
  }

  for (const prod of productionOnly) {
    counts["production-only"] += 1;
    out.push({
      aiJobId: null,
      prodJobId: String(prod._id),
      confidence: 0,
      matchBy: "none",
      category: "production-only",
      diffs: [],
      mismatchCount: 0,
      production: { ...prod, _id: String(prod._id) },
    });
  }

  counts.total = out.length;
  return { counts, pairs: out };
}
