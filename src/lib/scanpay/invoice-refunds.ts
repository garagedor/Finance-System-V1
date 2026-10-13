// Refunds that only show on the INVOICE.
//
// The refund sync reads GET /connect/v1/payments?status=REFUNDED. A PARTIAL
// refund never reaches that list: ScanPay leaves the payment at SUCCESS and
// flips only the invoice's status to "REFUNDED" (e.g. Cameron, invoice
// IN-1788300793-41 — $250 back from $1,618.02, absent from the inbox). The
// invoices endpoint cannot be filtered by that status (its enum is PAID /
// PENDING), so the invoices are paged newest-first and picked out here.
//
// Pure — no server imports — so it is unit-testable on its own.

import type { ScanpayRefundRaw } from "@/types/scanpay";

/** GET /connect/v1/invoices row (the fields we read). */
export interface ScanpayInvoiceRaw {
  id: string;               // "Invoice-…"
  invoiceNumber: string;
  amount: string;
  billAmount: string;
  payableAmount: string;
  serviceFee: string;
  tipAmount: string;
  createdAt: string;
  customerName?: string;
  paymentMethod: string;
  status: string;
}

/** Any refund state ScanPay puts on an invoice ("REFUNDED", and a partial spelling if one ever appears). */
export function isRefundedInvoice(inv: Pick<ScanpayInvoiceRaw, "status">): boolean {
  return /REFUND/i.test(String(inv.status ?? ""));
}

/**
 * An invoice → the refund inbox's raw shape. The record id is the INVOICE id:
 * ScanPay does not say which payment on the invoice was refunded, and an
 * invoice can carry several payments. Amount/date are the original payment's,
 * as on every refund — the refunded amount and date are entered at confirm.
 */
export function invoiceToRefundRaw(inv: ScanpayInvoiceRaw): ScanpayRefundRaw {
  return {
    id: inv.id,
    invoiceId: inv.id,
    invoiceNumber: inv.invoiceNumber,
    amount: inv.amount,
    billAmount: inv.billAmount,
    payableAmount: inv.payableAmount,
    serviceFee: inv.serviceFee,
    tipAmount: inv.tipAmount,
    createdAt: inv.createdAt,
    paymentMethod: inv.paymentMethod,
    status: inv.status,
  };
}
