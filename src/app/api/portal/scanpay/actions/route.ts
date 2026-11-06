// ScanPay WRITE actions + the lookups that feed them. Owner account only
// (lib/stats-owner) — checked here on every request, not just hidden in the UI.
//
//   GET  ?q=<address | client | IN-number>   → CRM jobs, with their ScanPay invoice state
//   GET  ?jobId=<id>                         → one job + defaults (account, ScanPay user) + invoice + payments
//   GET  ?log=1                              → the latest actions
//   POST { action: "create-invoice" | "link-invoice" | "mark-paid" | "refund", … }

import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { isStatsXlsxOwner } from "@/lib/stats-owner";
import { coll, getDb, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import {
  alreadyRefunded, createInvoiceForJob, findInvoiceByNumber, linkInvoiceToJob, markInvoicePaid, refundPayment,
  teamForLocation, teamMembers, ScanpayWriteError, type ScanpayActionRecord,
} from "@/lib/scanpay/writes";
import { MARK_PAID_METHODS, isRefundableStatus, memberName, pickMember, refundable, type MarkPaidMethod } from "@/lib/scanpay/write-helpers";
import { scanpayKeys } from "@/lib/scanpay/client";
import { teamLabeler } from "@/lib/scanpay/team-names-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function owner() {
  const s = await readSession();
  return isStatsXlsxOwner(s) ? s : null;
}

export async function GET(req: NextRequest) {
  const s = await owner();
  if (!s) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const db = await getDb();

  if (sp.get("log")) {
    const rows = await coll<ScanpayActionRecord>(FINANCE_COLLECTIONS.scanpayAction).find({}).sort({ created_at: -1 }).limit(50).toArray();
    return NextResponse.json({ rows });
  }

  const q = (sp.get("q") ?? "").trim();
  if (q) {
    const rx = { $regex: esc(q), $options: "i" };
    const jobs = await db.collection("Job").find(
      { $or: [{ address: rx }, { clientName: rx }, { invoiceNumber: rx }, { clientPhoneNumber: rx }] },
      { projection: { date: 1, address: 1, clientName: 1, tech: 1, location: 1, status: 1, invoiceNumber: 1, totalAmount: 1, totalPaidCard: 1 } },
    ).sort({ date: -1 }).limit(25).toArray();
    return NextResponse.json({ jobs: jobs.map((j) => ({ ...j, _id: String(j._id) })) });
  }

  const jobId = sp.get("jobId");
  if (jobId) {
    const { ObjectId } = await import("mongodb");
    if (!ObjectId.isValid(jobId)) return NextResponse.json({ error: "Unknown job" }, { status: 404 });
    const job = await db.collection("Job").findOne({ _id: new ObjectId(jobId) });
    if (!job) return NextResponse.json({ error: "Unknown job" }, { status: 404 });
    try {
      const team = (await teamForLocation(job.location)) ?? 1;
      const label = await teamLabeler();
      const members = await teamMembers(team);
      const pick = pickMember(members, job.tech);
      const invoiceNumber = String(job.invoiceNumber ?? "").trim();
      const invoice = invoiceNumber ? await findInvoiceByNumber(invoiceNumber) : null;
      const payments = invoice
        ? await Promise.all(invoice.payments.map(async (p) => {
            const refunded = await alreadyRefunded(p.id);
            return { ...p, refunded, refundable: isRefundableStatus(p.status) ? refundable(p.amount, refunded) : 0 };
          }))
        : [];
      const actions = await coll<ScanpayActionRecord>(FINANCE_COLLECTIONS.scanpayAction).find({ jobId } as never).sort({ created_at: -1 }).limit(20).toArray();
      return NextResponse.json({
        job: { ...job, _id: String(job._id) },
        defaults: {
          team, accounts: scanpayKeys().map((_, i) => i + 1), accountNames: Object.fromEntries(scanpayKeys().map((_, i) => [i + 1, label(i + 1)])),
          member: pick ? { memberId: pick.member.memberId, name: memberName(pick.member), why: pick.why } : null,
          members: members.filter((m) => !m.status || m.status === "ACTIVE").map((m) => ({ memberId: m.memberId, name: memberName(m), role: m.role })),
        },
        invoice, payments, actions,
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Lookup failed" }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "Nothing to look up" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const s = await owner();
  if (!s) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = s.name;
  const num = (v: unknown) => Number(v);
  try {
    switch (b.action) {
      case "create-invoice":
        return NextResponse.json({ ok: true, result: await createInvoiceForJob({
          jobId: String(b.jobId ?? ""), amount: num(b.amount), description: String(b.description ?? ""),
          team: b.team ? num(b.team) : undefined, memberId: b.memberId ? String(b.memberId) : undefined,
          tipEnabled: b.tipEnabled !== false, actor,
        }) });
      case "link-invoice":
        return NextResponse.json({ ok: true, result: await linkInvoiceToJob({
          jobId: String(b.jobId ?? ""), invoiceNumber: String(b.invoiceNumber ?? ""), replace: b.replace === true, actor,
        }) });
      case "mark-paid": {
        const method = String(b.method ?? "") as MarkPaidMethod;
        if (!MARK_PAID_METHODS.includes(method)) return NextResponse.json({ error: "Pick how it was paid" }, { status: 400 });
        return NextResponse.json({ ok: true, result: await markInvoicePaid({ invoiceNumber: String(b.invoiceNumber ?? ""), method, sendReceipt: b.sendReceipt === true, actor }) });
      }
      case "refund":
        return NextResponse.json({ ok: true, result: await refundPayment({
          paymentId: String(b.paymentId ?? ""), amount: num(b.amount), confirmAmount: num(b.confirmAmount), reason: String(b.reason ?? ""), actor,
        }) });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    const known = e instanceof ScanpayWriteError;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: known ? 400 : 500 });
  }
}
