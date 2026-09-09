import type { JobRow } from "@/types/job";
import type { AiJobDoc } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Pairing AI jobs ↔ production jobs. PURE (no I/O), so it's unit-testable.
//
// RULE: match ONLY on stable identity/context fields (id / date / address /
// technician / customer / phone). NEVER on the fields Tables AI is meant to
// verify (payments, parts, tips, status). Pairing precedence:
//   1. manual link           (authoritative)
//   2. externalJobId exact   (reserved — null in Phase 1, ready for later)
//   3. fuzzy identity score
// Each production job is paired at most once. The AI side is graded on its
// FROZEN aiOriginal, so we key identity off aiOriginal (falling back to live).
// ─────────────────────────────────────────────────────────────────────────────

const first10 = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 10) : "");
const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const digits = (v: unknown) => (typeof v === "string" ? v.replace(/\D/g, "") : "");
/** Street-only address key: drop city/state after the first comma, strip a
 *  leading "(N)" marker, keep alphanumerics. Matches the verify-module style. */
function addrKey(v: unknown): string {
  if (typeof v !== "string") return "";
  let s = v.split(",")[0] ?? "";
  s = s.replace(/^\s*\([^)]*\)\s*/, "");
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function addrMatch(a: string, b: string): boolean {
  if (!a || !b || a.length < 6 || b.length < 6) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

interface Identity {
  date: string;
  addr: string;
  tech: string;
  customer: string;
  phone: string;
  externalJobId: string;
}
function identityOf(job: Partial<JobRow> & { externalJobId?: string | null }): Identity {
  return {
    date: first10(job.date),
    addr: addrKey(job.address),
    tech: norm(job.tech),
    customer: norm(job.clientName),
    phone: digits(job.clientPhoneNumber),
    externalJobId: norm((job as any).externalJobId),
  };
}

/** Returns {score, fields} for a candidate pair using identity fields only. */
function scoreIdentity(ai: Identity, prod: Identity): { score: number; fields: string[] } {
  const fields: string[] = [];
  const dateEq = !!ai.date && ai.date === prod.date;
  const addrEq = addrMatch(ai.addr, prod.addr);
  const techEq = !!ai.tech && ai.tech === prod.tech;
  const custEq = !!ai.customer && ai.customer === prod.customer;
  const phoneEq = !!ai.phone && ai.phone.length >= 7 && ai.phone === prod.phone;
  if (dateEq) fields.push("date");
  if (addrEq) fields.push("address");
  if (techEq) fields.push("tech");
  if (custEq) fields.push("customer");
  if (phoneEq) fields.push("phone");

  let score = 0;
  if (phoneEq && dateEq) score = Math.max(score, 0.97);
  if (dateEq && addrEq && (techEq || custEq)) score = Math.max(score, 0.95);
  if (dateEq && addrEq) score = Math.max(score, 0.85);
  if (dateEq && custEq) score = Math.max(score, 0.78);
  if (addrEq && custEq) score = Math.max(score, 0.7);
  if (phoneEq) score = Math.max(score, 0.7);
  return { score, fields };
}

export interface RawPair {
  aiJob: AiJobDoc;
  prodJob: JobRow | null;
  confidence: number;
  matchBy: string;
}

export interface MatchOutput {
  pairs: RawPair[]; // one per AI job (prodJob null => ai-only)
  productionOnly: JobRow[]; // production jobs never paired
}

const CONF_THRESHOLD = 0.6;

export function matchAiToProduction(
  aiJobs: AiJobDoc[],
  prodJobs: JobRow[],
  links: Record<string, string>,
): MatchOutput {
  const prodById = new Map<string, JobRow>();
  for (const p of prodJobs) prodById.set(String(p._id), p);
  const prodIdent = new Map<string, Identity>();
  for (const p of prodJobs) prodIdent.set(String(p._id), identityOf(p));
  const usedProd = new Set<string>();

  const pairs: RawPair[] = [];

  for (const ai of aiJobs) {
    const aiId = String(ai._id);
    const idSource = (ai.aiOriginal && Object.keys(ai.aiOriginal).length ? ai.aiOriginal : ai) as Partial<JobRow> & {
      externalJobId?: string | null;
    };
    const aiIdent = identityOf({ ...idSource, externalJobId: ai.externalJobId });

    // 1. manual link
    const linked = links[aiId];
    if (linked && prodById.has(linked) && !usedProd.has(linked)) {
      usedProd.add(linked);
      pairs.push({ aiJob: ai, prodJob: prodById.get(linked)!, confidence: 1, matchBy: "link" });
      continue;
    }

    // 2. externalJobId exact (reserved; null in Phase 1)
    let matched = false;
    if (aiIdent.externalJobId) {
      for (const p of prodJobs) {
        const pid = String(p._id);
        if (usedProd.has(pid)) continue;
        if (norm((p as any).externalJobId) && norm((p as any).externalJobId) === aiIdent.externalJobId) {
          usedProd.add(pid);
          pairs.push({ aiJob: ai, prodJob: p, confidence: 1, matchBy: "externalJobId" });
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    // 3. fuzzy identity
    let best: { pid: string; score: number; fields: string[] } | null = null;
    for (const p of prodJobs) {
      const pid = String(p._id);
      if (usedProd.has(pid)) continue;
      const { score, fields } = scoreIdentity(aiIdent, prodIdent.get(pid)!);
      if (score >= CONF_THRESHOLD && (!best || score > best.score)) best = { pid, score, fields };
    }
    if (best) {
      usedProd.add(best.pid);
      pairs.push({ aiJob: ai, prodJob: prodById.get(best.pid)!, confidence: Number(best.score.toFixed(2)), matchBy: best.fields.join("+") || "fuzzy" });
    } else {
      pairs.push({ aiJob: ai, prodJob: null, confidence: 0, matchBy: "none" });
    }
  }

  const productionOnly = prodJobs.filter((p) => !usedProd.has(String(p._id)));
  return { pairs, productionOnly };
}
