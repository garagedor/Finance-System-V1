import "server-only";

// Customer + technician for a refund row. ScanPay's refunded-payment rows have
// no customer, so the inbox card showed only an invoice number and a person
// could not find the job (e.g. searching "Cameron" found nothing). Read from
// the invoice; the technician's name comes from finance_scanpay_member, which
// maps ScanPay member ids to names (seeded from the dashboard exports, since
// the API has no member endpoint). Best effort — never blocks a sync.

import { coll, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { fetchScanpayInvoice } from "./client";

export interface RefundCustomer { customerName: string | null; customerPhone: string | null; createdBy: string | null }

export async function refundCustomer(invoiceId: string | null | undefined): Promise<RefundCustomer | null> {
  if (!invoiceId) return null;
  try {
    const inv = await fetchScanpayInvoice(invoiceId);
    if (!inv) return null;
    const member = inv.memberId
      ? await coll<{ _id: string; name: string }>(FINANCE_COLLECTIONS.scanpayMember).findOne({ _id: inv.memberId })
      : null;
    return {
      customerName: inv.customer?.name?.trim() || null,
      customerPhone: inv.customer?.phoneNumber?.trim() || null,
      createdBy: member?.name ?? null,
    };
  } catch {
    return null;
  }
}
