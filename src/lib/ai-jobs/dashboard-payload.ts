import type { IngestEnvelope, AiEventType } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Translator: the closing-dashboard's `payload_for()` shape → our IngestEnvelope.
//
// The bot's closing dashboard (lbs-ai-closing-dashboard, app/jobsystem.py) already
// ships a durable, idempotent outbox that POSTs a finalized job to an external
// "job system" in SHADOW mode. We are that shadow destination — the isolated
// ag.Job_ai mirror, NEVER production ag.Job. This maps its business-named,
// nested payload onto the flat CRM Job field names that normalizeJobPayload wants.
//
// Identity (owner rule, confirmed against jobsystem.py:627/84): `lbs_job_id` is
// the dashboard's job PK and is STABLE across corrections (a correction re-queues
// an UPDATE_JOB with the SAME lbs_job_id and a new `version`). So lbs_job_id is
// BOTH our idempotency key (ingestId → corrections upsert the same mirror row)
// AND the shared job identity (externalJobId). `version` rides in meta.refs so
// the ingest can reject a stale (out-of-order) update. Pure — no I/O.
// ─────────────────────────────────────────────────────────────────────────────

// dashboard payment field → CRM Job field
const PAYMENT_MAP: Record<string, string> = {
  tech_paid_cash: "techPaidCash",
  paid_card: "totalPaidCard",
  paid_company_check: "totalPaidCompanyCheck",
  paid_finance: "totalPaidFinance",
  paid_company_cash: "totalPaidCompanyCash",
  paid_lm_cash: "lmCash",
  paid_lm_check: "lmCheck",
};
const PARTS_MAP: Record<string, string> = {
  tech_parts: "techParts",
  company_parts: "companyParts",
  lm_parts: "lmParts",
};
// Tips: the dashboard emits card / company_check / finance / lm_check (fields.py
// TIP_FIELDS). The CRM has no LM-check tip column, so both check-tips fold into
// tipsCheck. Legacy dashboard tips (tips_company_cash / tips_check) are handled
// too in case an old row ever flows through. Tips are info-only on the CRM side.
const EVENT_MAP: Record<string, AiEventType> = {
  create_job: "closing",
  update_job: "update",
  create_estimate: "estimate",
  sync_media: "other",
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const strOrUndef = (v: unknown): string | undefined =>
  v === undefined || v === null || v === "" ? undefined : String(v);

type MoneyBag = Record<string, unknown> | null | undefined;
const bag = (m: MoneyBag): Record<string, unknown> => (m && typeof m === "object" ? m : {});

/** Translate one dashboard `payload_for()` object into a CRM IngestEnvelope. */
export function dashboardToEnvelope(payload: Record<string, unknown>): IngestEnvelope {
  const p = payload || {};
  const customer = bag(p.customer as MoneyBag);
  const address = bag(p.address as MoneyBag);
  const jobInfo = bag(p.job as MoneyBag);
  const money = bag(p.money as MoneyBag);
  const payments = bag(money.payments as MoneyBag);
  const parts = bag(money.parts as MoneyBag);
  const tips = bag(money.tips as MoneyBag);

  const job: Record<string, unknown> = {
    // identity / text
    date: strOrUndef(jobInfo.date),
    address: strOrUndef(address.formatted) ?? strOrUndef(jobInfo.address),
    tech: strOrUndef(jobInfo.technician),
    provider: strOrUndef(jobInfo.provider),
    location: strOrUndef(jobInfo.market),
    status: strOrUndef(jobInfo.status),
    invoiceNumber: strOrUndef(jobInfo.invoice_number),
    notes: strOrUndef(jobInfo.notes),
    clientName: strOrUndef(customer.name),
    // prefer the canonical E.164 phone for matching; fall back to display form
    clientPhoneNumber: strOrUndef(customer.phone_e164) ?? strOrUndef(customer.phone_display),
    // total
    totalAmount: num(money.total),
  };

  // payments + parts: straight name remap (absent keys default to 0 downstream)
  for (const [src, dst] of Object.entries(PAYMENT_MAP)) {
    if (payments[src] !== undefined) job[dst] = num(payments[src]);
  }
  for (const [src, dst] of Object.entries(PARTS_MAP)) {
    if (parts[src] !== undefined) job[dst] = num(parts[src]);
  }
  // tips: fold check-tips together (CRM has no LM-check tip column)
  const tipsCheck = num(tips.tips_company_check) + num(tips.tips_lm_check) + num(tips.tips_check);
  if (tips.tips_card !== undefined) job.tipsCard = num(tips.tips_card);
  if (tips.tips_finance !== undefined) job.tipsFinance = num(tips.tips_finance);
  if (tipsCheck) job.tipsCheck = tipsCheck;
  if (tips.tips_company_cash !== undefined) job.tipsCompanyCash = num(tips.tips_company_cash);

  const lbsJobId = strOrUndef(p.lbs_job_id);
  const event = String(p.event ?? "create_job");
  const version = num(p.version) || 1;

  const envelope: IngestEnvelope = {
    job,
    meta: {
      source: "bot",
      eventType: EVENT_MAP[event] ?? "closing",
      // lbs_job_id is stable per job → dedup key AND shared identity.
      ingestId: lbsJobId,
      externalJobId: lbsJobId,
      refs: {
        version,
        operation: event,
        lbs_job_id: p.lbs_job_id ?? null,
        payload_source: p.source ?? null,
        verdict: p.verdict ?? null,
        payment_difference: num(money.difference),
        dashboard_idempotency_key: p.idempotency_key ?? null,
      },
    },
  };
  return envelope;
}

/** The stable id we echo back so the dashboard adapter can address updates
 *  (PUT /jobs/{id}); it is lbs_job_id when present. */
export function externalIdFor(payload: Record<string, unknown>): string | null {
  return strOrUndef((payload || {}).lbs_job_id) ?? null;
}
