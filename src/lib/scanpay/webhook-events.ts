import "server-only";
import { coll, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { fetchScanpayDisputes, fetchScanpayPayment, parseAmount } from "./client";
import { upsertScanpayDispute } from "./sync";
import { upsertScanpayRefund } from "./refund-sync";
import type { ScanpayRefundRecord } from "@/types/scanpay";

// ScanPay's documented webhook events (api.scanpay.tech/connect/docs):
//   dispute.created  { eventData: { paymentId, disputeAmount, status, paymentDate, disputeDate, DueBy, memberId, teamId, processingFee } }
//   payment.refunded { eventData: { transactionId, status, amount } }
//   payment.complete (logged only for now)
// Neither carries the full record, so each one fetches it and goes through the
// same upsert the sync uses — same matching, same preserved human decisions.

export type ScanpayEvent = { eventName?: string; eventId?: string | number; timestamp?: number; eventData?: Record<string, unknown> };

export function isScanpayEvent(body: unknown): body is ScanpayEvent {
  return !!body && typeof body === "object" && typeof (body as ScanpayEvent).eventName === "string";
}

export async function handleScanpayEvent(ev: ScanpayEvent): Promise<{ kind: "dispute" | "refund" | "payment" | "unrecognized"; result: unknown }> {
  const data = ev.eventData ?? {};
  switch (ev.eventName) {
    case "dispute.created": {
      const paymentId = String(data.paymentId ?? "");
      if (!paymentId) return { kind: "dispute", result: "no paymentId" };
      // The event has no dispute id: find the newest dispute on that payment.
      const all = await fetchScanpayDisputes();
      const mine = all
        .filter((d) => d.transactionId === paymentId)
        .sort((a, b) => String(b.disputedDate).localeCompare(String(a.disputedDate)));
      if (!mine.length) return { kind: "dispute", result: "not listed yet — the daily sync will add it" };
      const out = [];
      for (const d of mine) out.push(await upsertScanpayDispute(d));
      return { kind: "dispute", result: { paymentId, disputes: mine.map((d) => d.disputeId), out } };
    }
    case "payment.refunded": {
      const paymentId = String(data.transactionId ?? "");
      if (!paymentId) return { kind: "refund", result: "no transactionId" };
      const raw = await fetchScanpayPayment(paymentId);
      if (!raw) return { kind: "refund", result: "payment not found" };
      const res = await upsertScanpayRefund(raw, "payment");
      // The event's amount is the refunded amount. Use it only where nothing
      // better is known; the payout replaces it later (lib/scanpay/payouts).
      const amount = parseAmount(String(data.amount ?? ""));
      if (amount > 0) {
        const R = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
        const now = new Date().toISOString();
        const filter = { $or: [{ _id: raw.id }, { invoiceNumber: raw.invoiceNumber, source: "invoice" }], refundAmount: null };
        await R.updateOne(filter as never, {
          $set: { refundAmount: amount, refundDate: now.slice(0, 10), refundAmountSource: "webhook", updated_at: now },
        } as never);
      }
      return { kind: "refund", result: { paymentId, amount, upsert: res } };
    }
    case "payment.complete":
      return { kind: "payment", result: "logged" };
    default:
      return { kind: "unrecognized", result: null };
  }
}
