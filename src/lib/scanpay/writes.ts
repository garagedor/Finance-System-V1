import "server-only";
import { coll, getDb, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import { scanpayKeys, fetchScanpayPayment, parseAmount } from "./client";
import { isRefundableStatus, majorityTeam, memberName, parseUsAddress, pickMember, refundable, splitName, type MarkPaidMethod, type ScanpayMember } from "./write-helpers";

// ScanPay WRITE actions (owner-approved 2026-11-05). Every action:
//   • is started by a person in the CRM (owner account only — the route checks),
//   • is written to finance_scanpay_action BEFORE the call (status "pending")
//     and updated after, so nothing ScanPay does is ever unlogged,
//   • refuses to run twice at once for the same job / invoice / payment
//     (ScanPay has no idempotency key, so a double click would double-act).
// Nothing here runs automatically.

const BASE = process.env.SCANPAY_API_BASE || "https://api.scanpay.tech";

export type ScanpayActionKind = "create-invoice" | "link-invoice" | "mark-paid" | "refund";

export interface ScanpayActionRecord {
  _id: string;
  action: ScanpayActionKind;
  status: "pending" | "ok" | "error";
  lockKey: string;
  team: number | null;
  jobId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  paymentId: string | null;
  amount: number | null;
  memberId: string | null;
  memberName: string | null;
  actor: string;
  request: Record<string, unknown>;
  response: unknown;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export class ScanpayWriteError extends Error {}

function keyFor(team: number): string {
  const k = scanpayKeys()[team - 1];
  if (!k) throw new ScanpayWriteError(`ScanPay account ${team} is not configured`);
  return k;
}

async function call<T>(key: string, method: string, path: string, body?: unknown, memberId?: string): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (memberId) headers.memberId = memberId;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = (json as { message?: string; details?: string } | null);
    throw new ScanpayWriteError(`ScanPay ${method} ${path.split("?")[0]}: HTTP ${res.status}${msg?.message ? ` — ${msg.message}` : ""}${msg?.details ? ` (${msg.details})` : ""}`);
  }
  return json as T;
}

// ── Lookups ────────────────────────────────────────────────────────────────

const memberCache = new Map<number, { at: number; members: ScanpayMember[] }>();
export async function teamMembers(team: number): Promise<ScanpayMember[]> {
  const hit = memberCache.get(team);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.members;
  const body = await call<{ data?: { members?: ScanpayMember[] } }>(keyFor(team), "GET", "/connect/v1/teams/members?limit=200&page=0");
  const members = body.data?.members ?? [];
  memberCache.set(team, { at: Date.now(), members });
  return members;
}

/** The ScanPay account a CRM location uses (majority of its paid invoices). */
export async function teamForLocation(location: string | null | undefined): Promise<number | null> {
  if (!location) return null;
  const db = await getDb();
  const jobs = await db.collection("Job").find(
    { location, invoiceNumber: { $nin: [null, ""] } },
    { projection: { invoiceNumber: 1 } },
  ).sort({ date: -1 }).limit(300).toArray();
  const inv = jobs.map((j) => String(j.invoiceNumber));
  if (!inv.length) return null;
  const rows = await db.collection(FINANCE_COLLECTIONS.scanpayPayoutLine).aggregate([
    { $match: { invoiceNumber: { $in: inv } } },
    { $group: { _id: "$team", n: { $sum: 1 } } },
  ]).toArray();
  return majorityTeam(new Map(rows.map((r) => [Number(r._id), Number(r.n)])));
}

export interface ScanpayInvoiceLookup {
  team: number;
  id: string;
  invoiceNumber: string;
  status: string;
  isPaid: boolean;
  amount: number;
  memberId: string | null;
  createdAt: string | null;
  payments: Array<{ id: string; amount: number; createdAt: string | null; paymentMethod: string | null; status: string | null }>;
}

/** Find an invoice by its IN number across every account. */
export async function findInvoiceByNumber(invoiceNumber: string): Promise<ScanpayInvoiceLookup | null> {
  const keys = scanpayKeys();
  for (const [i, key] of keys.entries()) {
    const list = await call<{ data?: { invoices?: Array<{ id: string }> } }>(key, "GET", `/connect/v2/invoices?limit=5&page=0&invoiceNumber=${encodeURIComponent(invoiceNumber)}`).catch(() => null);
    const id = list?.data?.invoices?.[0]?.id;
    if (!id) continue;
    const full = await call<{ data?: Record<string, unknown> }>(key, "GET", `/connect/v2/invoices/${encodeURIComponent(id)}`);
    const d = (full.data ?? {}) as Record<string, any>;
    if (String(d.invoiceNumber ?? "") !== invoiceNumber) continue;
    return {
      team: i + 1,
      id: String(d.id),
      invoiceNumber: String(d.invoiceNumber),
      status: String(d.status ?? ""),
      isPaid: !!d.isPaid,
      amount: parseAmount(String(d.payableAmount ?? d.amount ?? "0")),
      memberId: d.memberId ? String(d.memberId) : null,
      createdAt: d.createdAt ? String(d.createdAt) : null,
      payments: ((d.paymentDetails?.payments ?? []) as any[]).map((p) => ({
        id: String(p.id), amount: parseAmount(String(p.amount ?? "0")), createdAt: p.createdAt ?? null,
        paymentMethod: p.paymentMethod ?? null, status: p.status ?? null,
      })),
    };
  }
  return null;
}

/** Already refunded on a payment: payout lines first, then the refund inbox. */
export async function alreadyRefunded(paymentId: string): Promise<number> {
  const db = await getDb();
  const lines = await db.collection(FINANCE_COLLECTIONS.scanpayPayoutLine).find({ relatedPaymentId: paymentId, type: { $regex: /^refunds?$/i } }).toArray();
  const fromPayouts = lines.reduce((s, l) => s + Math.abs(Number(l.amount) || 0), 0);
  const rec = await db.collection(FINANCE_COLLECTIONS.scanpayRefund).findOne({ $or: [{ _id: paymentId }, { paymentId }] } as never);
  const fromInbox = Number((rec as { refundAmount?: number } | null)?.refundAmount ?? 0);
  const fromActions = (await coll<ScanpayActionRecord>(FINANCE_COLLECTIONS.scanpayAction)
    .find({ action: "refund", paymentId, status: { $in: ["ok", "pending"] } } as never).toArray())
    .reduce((s, a) => s + (a.amount ?? 0), 0);
  return Math.round(Math.max(fromPayouts, fromInbox, fromActions) * 100) / 100;
}

// ── The action log + lock ──────────────────────────────────────────────────

async function begin(a: Omit<ScanpayActionRecord, "_id" | "status" | "response" | "error" | "created_at" | "finished_at">): Promise<string> {
  await ensureFinanceIndexes();
  const c = coll<ScanpayActionRecord>(FINANCE_COLLECTIONS.scanpayAction);
  const recent = new Date(Date.now() - 2 * 60_000).toISOString();
  const busy = await c.findOne({ lockKey: a.lockKey, status: "pending", created_at: { $gte: recent } } as never);
  if (busy) throw new ScanpayWriteError("This action is already running — wait a moment and refresh.");
  const _id = newId("spa");
  await c.insertOne({ _id, ...a, status: "pending", response: null, error: null, created_at: new Date().toISOString(), finished_at: null });
  return _id;
}
async function finish(id: string, ok: boolean, response: unknown, error: string | null) {
  await coll<ScanpayActionRecord>(FINANCE_COLLECTIONS.scanpayAction).updateOne(
    { _id: id } as never,
    { $set: { status: ok ? "ok" : "error", response, error, finished_at: new Date().toISOString() } } as never,
  );
}
async function run<T>(id: string, fn: () => Promise<T>): Promise<T> {
  try {
    const out = await fn();
    await finish(id, true, out, null);
    return out;
  } catch (e) {
    await finish(id, false, null, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// ── 1. Create & send an invoice from a CRM job ─────────────────────────────

export interface CreateInvoiceInput {
  jobId: string;
  amount: number;
  description: string;
  team?: number;            // override the location default
  memberId?: string;        // override the tech/owner default
  tipEnabled?: boolean;
  actor: string;
}
export interface CreateInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  checkoutUrl: string | null;
  paymentUrl: string | null;
  deepLink: string | null;
  team: number;
  memberName: string;
  linkedToJob: boolean;
}

export async function createInvoiceForJob(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  if (!ObjectId.isValid(input.jobId)) throw new ScanpayWriteError("Unknown job");
  const job = await db.collection("Job").findOne({ _id: new ObjectId(input.jobId) });
  if (!job) throw new ScanpayWriteError("Unknown job");
  if (!(input.amount > 0)) throw new ScanpayWriteError("Enter the amount to charge");

  const team = input.team ?? (await teamForLocation(job.location)) ?? 1;
  const key = keyFor(team);
  const members = await teamMembers(team);
  const picked = input.memberId
    ? { member: members.find((m) => m.memberId === input.memberId), why: "chosen" as const }
    : pickMember(members, job.tech);
  if (!picked?.member) throw new ScanpayWriteError("No ScanPay user to create the invoice as");
  const member = picked.member;

  const id = await begin({
    action: "create-invoice", lockKey: `job:${input.jobId}`, team, jobId: input.jobId, invoiceId: null, invoiceNumber: null,
    paymentId: null, amount: input.amount, memberId: member.memberId, memberName: memberName(member), actor: input.actor,
    request: { amount: input.amount, description: input.description, tipEnabled: input.tipEnabled ?? true, location: job.location ?? null },
  });

  return run(id, async () => {
    const name = splitName(job.clientName);
    const phone = String(job.clientPhoneNumber ?? "").replace(/[^\d+]/g, "") || undefined;
    const customer = await call<{ data?: { id?: string } }>(key, "POST", "/connect/v2/customers", {
      ...name, phoneNumber: phone, referenceId: `crm-${input.jobId}`, note: "Created from the CRM",
    });
    const customerId = customer.data?.id;
    if (!customerId) throw new ScanpayWriteError("ScanPay did not return a customer id");
    const addr = parseUsAddress(job.address);
    if (addr) {
      await call(key, "POST", `/connect/v2/customers/${encodeURIComponent(customerId)}/address/SERVICE`, {
        ...addr, country: "US", addressName: "Service", isBillingSameAsService: true,
      }).catch(() => null); // the invoice works without it
    }
    const inv = await call<{ data?: Record<string, any> }>(key, "POST", "/connect/v2/invoices", {
      referenceId: `crm-${input.jobId}-${Date.now()}`,
      customerId,
      lineItems: [{ catalogueLineItemId: 0, name: "Garage door service", qty: "1", unitPrice: input.amount.toFixed(2), description: input.description.slice(0, 500) }],
      tipEnabled: input.tipEnabled ?? true,
      isSignatureEnabled: false,
      isServiceFeeEnabled: false,
      comment: input.description.slice(0, 500),
    }, member.memberId);
    const d = inv.data ?? {};
    if (!d.invoiceNumber) throw new ScanpayWriteError("ScanPay did not return an invoice number");

    // Link it on the CRM job, unless the job already has another invoice.
    const existing = String(job.invoiceNumber ?? "").trim();
    let linkedToJob = false;
    if (!existing) {
      await db.collection("Job").updateOne({ _id: job._id }, { $set: { invoiceNumber: d.invoiceNumber, invoiceLinkedBy: "scanpay-create", invoiceLinkedAt: new Date().toISOString() } });
      linkedToJob = true;
    }
    await coll<ScanpayActionRecord>(FINANCE_COLLECTIONS.scanpayAction).updateOne({ _id: id } as never, { $set: { invoiceId: String(d.id), invoiceNumber: String(d.invoiceNumber) } } as never);
    return {
      invoiceId: String(d.id), invoiceNumber: String(d.invoiceNumber),
      checkoutUrl: d.checkoutUrl ?? null, paymentUrl: d.paymentUrl ?? null, deepLink: d.deepLinkOfScanpayApp ?? null,
      team, memberName: memberName(member), linkedToJob,
    };
  });
}

// ── 2. Link an existing ScanPay invoice to a CRM job (CRM side only) ───────
// ScanPay's own "link" endpoint overwrites the invoice's line items and only
// takes unpaid invoices, so the link is kept in the CRM: Job.invoiceNumber.

export async function linkInvoiceToJob(input: { jobId: string; invoiceNumber: string; replace?: boolean; actor: string }): Promise<{ invoiceNumber: string; team: number; previous: string | null }> {
  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  if (!ObjectId.isValid(input.jobId)) throw new ScanpayWriteError("Unknown job");
  const job = await db.collection("Job").findOne({ _id: new ObjectId(input.jobId) });
  if (!job) throw new ScanpayWriteError("Unknown job");
  const invoiceNumber = input.invoiceNumber.trim().toUpperCase();
  const previous = String(job.invoiceNumber ?? "").trim() || null;
  if (previous && previous !== invoiceNumber && !input.replace) throw new ScanpayWriteError(`This job is already linked to ${previous}`);
  const other = await db.collection("Job").findOne({ invoiceNumber, _id: { $ne: job._id } }, { projection: { clientName: 1, date: 1 } });
  if (other) throw new ScanpayWriteError(`${invoiceNumber} is already on another job (${other.clientName ?? "—"}, ${String(other.date ?? "").slice(0, 10)})`);

  const inv = await findInvoiceByNumber(invoiceNumber);
  if (!inv) throw new ScanpayWriteError(`${invoiceNumber} was not found in any ScanPay account`);

  const id = await begin({
    action: "link-invoice", lockKey: `job:${input.jobId}`, team: inv.team, jobId: input.jobId, invoiceId: inv.id, invoiceNumber,
    paymentId: null, amount: inv.amount, memberId: null, memberName: null, actor: input.actor, request: { previous, replace: !!input.replace },
  });
  return run(id, async () => {
    await db.collection("Job").updateOne({ _id: job._id }, { $set: {
      invoiceNumber, invoiceLinkedBy: `manual:${input.actor}`, invoiceLinkedAt: new Date().toISOString(),
      ...(previous && previous !== invoiceNumber ? { invoiceNumberPrevious: previous } : {}),
    } });
    return { invoiceNumber, team: inv.team, previous };
  });
}

// ── 3. Mark an invoice paid (cash / check / transfer / other) ──────────────
// ScanPay allows it only as the member who created the invoice.

export async function markInvoicePaid(input: { invoiceNumber: string; method: MarkPaidMethod; sendReceipt?: boolean; actor: string }): Promise<{ invoiceNumber: string }> {
  const inv = await findInvoiceByNumber(input.invoiceNumber.trim().toUpperCase());
  if (!inv) throw new ScanpayWriteError("Invoice not found in ScanPay");
  if (inv.isPaid) throw new ScanpayWriteError("This invoice is already paid");
  if (!inv.memberId) throw new ScanpayWriteError("ScanPay doesn't say who created this invoice");
  const id = await begin({
    action: "mark-paid", lockKey: `invoice:${inv.invoiceNumber}`, team: inv.team, jobId: null, invoiceId: inv.id,
    invoiceNumber: inv.invoiceNumber, paymentId: null, amount: inv.amount, memberId: inv.memberId, memberName: null,
    actor: input.actor, request: { method: input.method, sendReceipt: !!input.sendReceipt },
  });
  return run(id, async () => {
    await call(keyFor(inv.team), "POST", `/connect/v2/invoices/${encodeURIComponent(inv.id)}/mark-paid`,
      { paymentMethod: input.method, sendReceipt: !!input.sendReceipt }, inv.memberId!);
    return { invoiceNumber: inv.invoiceNumber };
  });
}

// ── 4. Refund (REAL MONEY) ─────────────────────────────────────────────────

export async function refundPayment(input: { paymentId: string; amount: number; reason: string; confirmAmount: number; actor: string }): Promise<{ refundId: string | null; status: string | null; amount: number }> {
  const paymentId = input.paymentId.trim();
  if (Math.abs(input.amount - input.confirmAmount) >= 0.005) throw new ScanpayWriteError("The two amounts don't match");
  if (!(input.amount > 0)) throw new ScanpayWriteError("Enter the refund amount");
  if (!input.reason.trim()) throw new ScanpayWriteError("Enter a reason");
  const pay = await fetchScanpayPayment(paymentId);
  if (!pay) throw new ScanpayWriteError("Payment not found in ScanPay");
  // Only a payment that actually went through can be refunded (an invoice can
  // also list FAILED / declined attempts for the same amount).
  if (!isRefundableStatus(pay.status)) throw new ScanpayWriteError(`This payment is ${pay.status || "not successful"} — nothing to refund`);
  const paid = parseAmount(pay.amount);
  const left = refundable(paid, await alreadyRefunded(paymentId));
  if (input.amount > left + 0.005) throw new ScanpayWriteError(`At most ${left.toFixed(2)} can still be refunded on this payment`);

  // Which account holds the payment.
  let team: number | null = null;
  for (const [i, key] of scanpayKeys().entries()) {
    const ok = await call(key, "GET", `/connect/v1/payments/${encodeURIComponent(paymentId)}`).then(() => true).catch(() => false);
    if (ok) { team = i + 1; break; }
  }
  if (!team) throw new ScanpayWriteError("Payment not found in ScanPay");

  const id = await begin({
    action: "refund", lockKey: `payment:${paymentId}`, team, jobId: null, invoiceId: pay.invoiceId ?? null,
    invoiceNumber: pay.invoiceNumber ?? null, paymentId, amount: input.amount, memberId: null, memberName: null,
    actor: input.actor, request: { amount: input.amount, reason: input.reason, paid, refundableBefore: left },
  });
  return run(id, async () => {
    const r = await call<{ data?: { id?: string; status?: string; amount?: string } }>(keyFor(team!), "POST", "/connect/v1/refunds/initiate", {
      originalPaymentId: paymentId, amount: input.amount.toFixed(2), reason: input.reason.slice(0, 300),
    });
    return { refundId: r.data?.id ?? null, status: r.data?.status ?? null, amount: input.amount };
  });
}
