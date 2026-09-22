import "server-only";

// Penalty charge → one ledger entry. A "penalty" is an X-close job. Its loss is
// totalLoss = provider% × job profit (job profit = paid − parts, matching the
// penalty report). That loss is split 50% Area Manager / 50% Company; only the
// Area Manager's 50% (amLoss) is posted to a ledger. Same formula as
// /api/report?type=penalty so the numbers can't drift.

import { ObjectId, type Db } from "mongodb";
import { getDb, coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import { calcPaidSum, calcParts, calcJobProfit, calcStandardShare, toNumber } from "@/app/api/utils/calculations";
import type { JobRow } from "@/types/job";
import type { LedgerEntryRecord, LedgerRecord } from "@/types/finance-ledger";

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

async function loadJob(db: Db, jobId: string): Promise<JobRow | null> {
  const or: Record<string, unknown>[] = [{ _id: jobId }];
  if (/^[0-9a-fA-F]{24}$/.test(jobId)) or.push({ _id: new ObjectId(jobId) });
  return db.collection<JobRow>("Job").findOne({ $or: or } as never);
}

export type PostPenaltyChargeInput = {
  jobId: string;
  ledgerId: string;
  date?: string;
  notes?: string;
  actor: string;
  dryRun?: boolean;
};

export type PostPenaltyChargeResult =
  | { ok: false; error: string }
  | {
      ok: true;
      ledgerId: string;
      ledgerEntryId: string;
      jobProfit: number;
      totalLoss: number;
      amLoss: number;       // 50% — the amount posted to the ledger
      companyLoss: number;  // 50% — company's own loss, not charged
      providerPercent: number;
      postedAmount: number;
      created: boolean;
      dryRun: boolean;
    };

// One CONSOLIDATED penalty entry for a batch of X-close jobs: computes each
// job's AM 50% and posts a SINGLE ledger line whose amount is the sum, carrying
// a per-job breakdown in charge_snapshot.penalties[] (the ledger UI expands it).
// Like CRM-report entries, no per-job dedup — the user selects & posts a set.
export type PenaltyBatchLine = {
  job_ref: string;
  address: string;
  tech: string;
  provider: string;
  date: string;
  job_profit: number;
  total_loss: number;
  am_loss: number;
  company_loss: number;
  provider_percent: number;
};

export type PostPenaltyBatchInput = {
  jobIds: string[];
  ledgerId: string;
  date?: string;
  notes?: string;
  actor: string;
  dryRun?: boolean;
};

export type PostPenaltyBatchResult =
  | { ok: false; error: string }
  | {
      ok: true;
      ledgerId: string;
      ledgerEntryId: string;
      count: number;
      postedAmount: number;       // Σ am_loss — the single line's amount
      totalLoss: number;
      companyLoss: number;
      lines: PenaltyBatchLine[];
      missing: string[];          // jobIds that couldn't be loaded
      dryRun: boolean;
    };

export async function postPenaltyBatch(input: PostPenaltyBatchInput): Promise<PostPenaltyBatchResult> {
  await ensureFinanceIndexes();
  const db = await getDb();
  const dryRun = !!input.dryRun;

  if (!input.ledgerId) return { ok: false, error: "A ledger is required for a penalty." };
  const ledger = await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).findOne({ _id: input.ledgerId });
  if (!ledger) return { ok: false, error: `Ledger not found: ${input.ledgerId}` };

  const jobIds = [...new Set(input.jobIds.map((x) => String(x).trim()).filter(Boolean))];
  if (jobIds.length === 0) return { ok: false, error: "Select at least one penalty." };

  const lines: PenaltyBatchLine[] = [];
  const missing: string[] = [];
  for (const jid of jobIds) {
    const job = await loadJob(db, jid);
    if (!job) { missing.push(jid); continue; }
    const providerDoc = job.provider ? await db.collection("Provider").findOne({ _id: job.provider } as never) : null;
    const providerPercent = toNumber((providerDoc as { profitPercent?: unknown } | null)?.profitPercent);
    const jobProfit = calcJobProfit(calcPaidSum(job), calcParts(job));
    const totalLoss = calcStandardShare(jobProfit, providerPercent);
    const amLoss = totalLoss * 0.5;
    lines.push({
      job_ref: jid,
      address: job.address ?? "",
      tech: job.tech ?? "",
      provider: job.provider ?? "",
      date: String(job.date ?? "").slice(0, 10),
      job_profit: round2(jobProfit),
      total_loss: round2(totalLoss),
      am_loss: round2(amLoss),
      company_loss: round2(totalLoss - amLoss),
      provider_percent: providerPercent,
    });
  }
  if (lines.length === 0) return { ok: false, error: "None of the selected penalties could be loaded." };

  const postedAmount = round2(lines.reduce((s, l) => s + l.am_loss, 0));
  const totalLossSum = round2(lines.reduce((s, l) => s + l.total_loss, 0));
  const companyLossSum = round2(lines.reduce((s, l) => s + l.company_loss, 0));

  const ledgerEntryId = newId("len");
  const now = new Date().toISOString();
  const date = input.date ?? today();

  const snapshot = {
    kind: "penalty_batch",
    count: lines.length,
    total_job_profit: round2(lines.reduce((s, l) => s + l.job_profit, 0)),
    total_loss: totalLossSum,
    am_loss: postedAmount,
    company_loss: companyLossSum,
    posted_amount: postedAmount,
    penalties: lines,
  };

  const entry: LedgerEntryRecord = {
    _id: ledgerEntryId,
    ledger_id: input.ledgerId,
    type: "penalty",
    date,
    amount: postedAmount, // positive = the AM owes the company their 50% penalty
    description: `Penalties (${lines.length} X-close job${lines.length > 1 ? "s" : ""}) · AM 50%` + (input.notes ? ` · ${input.notes}` : ""),
    gross_amount: totalLossSum,
    charge_snapshot: snapshot as unknown as Record<string, unknown>,
    source: "crm",
    reverses_id: null,
    created_at: now,
    created_by: input.actor,
  };

  if (!dryRun) await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry).insertOne(entry);

  return {
    ok: true,
    ledgerId: input.ledgerId,
    ledgerEntryId,
    count: lines.length,
    postedAmount,
    totalLoss: totalLossSum,
    companyLoss: companyLossSum,
    lines,
    missing,
    dryRun,
  };
}

export async function postPenaltyCharge(input: PostPenaltyChargeInput): Promise<PostPenaltyChargeResult> {
  await ensureFinanceIndexes();
  const db = await getDb();
  const dryRun = !!input.dryRun;

  if (!input.ledgerId) return { ok: false, error: "A ledger is required for a penalty." };
  const ledger = await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).findOne({ _id: input.ledgerId });
  if (!ledger) return { ok: false, error: `Ledger not found: ${input.ledgerId}` };

  const job = await loadJob(db, input.jobId);
  if (!job) return { ok: false, error: `Job not found: ${input.jobId}` };

  const providerDoc = job.provider ? await db.collection("Provider").findOne({ _id: job.provider } as never) : null;
  const providerPercent = toNumber((providerDoc as { profitPercent?: unknown } | null)?.profitPercent);

  // Same math as /api/report?type=penalty: jobProfit = paid − parts.
  const jobProfit = calcJobProfit(calcPaidSum(job), calcParts(job));
  const totalLoss = calcStandardShare(jobProfit, providerPercent);
  const amLoss = totalLoss * 0.5;
  const companyLoss = totalLoss - amLoss;
  const postedAmount = round2(amLoss);

  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  // Dedup: one penalty entry per (ledger, job).
  const existing = await ec.findOne({ ledger_id: input.ledgerId, type: "penalty", job_ref: input.jobId } as never);
  const ledgerEntryId = existing?._id ?? newId("len");
  const now = new Date().toISOString();
  const date = input.date ?? today();

  const snapshot = {
    kind: "penalty",
    job_profit: round2(jobProfit),
    total_loss: round2(totalLoss),
    am_loss: round2(amLoss),
    company_loss: round2(companyLoss),
    provider_percent: providerPercent,
    posted_amount: postedAmount,
  };

  const entry = {
    _id: ledgerEntryId,
    ledger_id: input.ledgerId,
    type: "penalty" as const,
    date,
    amount: postedAmount, // positive = the AM owes the company their 50% penalty
    description: `Penalty (X-close) — ${job.address ?? input.jobId} · AM 50%` + (input.notes ? ` · ${input.notes}` : ""),
    job_ref: input.jobId,
    technician_id: job.tech ?? null,
    gross_amount: round2(totalLoss),
    charge_snapshot: snapshot as unknown as Record<string, unknown>,
    source: "crm" as const,
    updated_at: now,
  };

  if (!dryRun) {
    if (existing) await ec.updateOne({ _id: ledgerEntryId } as never, { $set: entry });
    else await ec.insertOne({ ...entry, reverses_id: null, created_at: now, created_by: input.actor } as LedgerEntryRecord);
  }

  return {
    ok: true,
    ledgerId: input.ledgerId,
    ledgerEntryId,
    jobProfit: round2(jobProfit),
    totalLoss: round2(totalLoss),
    amLoss: round2(amLoss),
    companyLoss: round2(companyLoss),
    providerPercent,
    postedAmount,
    created: !existing,
    dryRun,
  };
}
