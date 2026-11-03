import Link from "next/link";
import { readSession, hasPermission } from "@/lib/rbac";
import { coll, getDb, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import type { ScanpayPayoutLineRecord, ScanpayPayoutRecord } from "@/lib/scanpay/payouts";
import { fmt$, fmtDate } from "../../../format";
import { PageHeader, StatPill, CardShell, Empty } from "../../../_components/page-helpers";
import BankingTabs from "../../BankingTabs";

export const dynamic = "force-dynamic";

// One ScanPay payout, line by line. Each customer payment is checked against
// the CRM job with the same invoice number (card + card tip vs. collected).

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export default async function PayoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await readSession();
  if (!s || !(s.type === "admin" || hasPermission(s, "finance:banking:view"))) {
    return <div className="portal-page"><div className="portal-alert portal-alert-error">Restricted.</div></div>;
  }
  const { id } = await params;
  const payoutId = decodeURIComponent(id);
  await ensureFinanceIndexes();
  const payout = await coll<ScanpayPayoutRecord>(FINANCE_COLLECTIONS.scanpayPayout).findOne({ _id: payoutId } as never);
  const lines = await coll<ScanpayPayoutLineRecord>(FINANCE_COLLECTIONS.scanpayPayoutLine)
    .find({ payoutId } as never).sort({ _id: 1 }).toArray();

  const db = await getDb();
  const invoices = [...new Set(lines.map((l) => l.invoiceNumber).filter((x): x is string => !!x))];
  const jobs = invoices.length
    ? await db.collection("Job").find({ invoiceNumber: { $in: invoices } }, {
        projection: { invoiceNumber: 1, clientName: 1, address: 1, tech: 1, date: 1, status: 1, totalPaidCard: 1, tipsCard: 1 },
      }).toArray()
    : [];
  const jobsByInvoice = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const k = String(j.invoiceNumber);
    jobsByInvoice.set(k, [...(jobsByInvoice.get(k) ?? []), j]);
  }

  const collected = lines.filter((l) => /^collected$/i.test(l.type));
  const noJob = collected.filter((l) => !l.invoiceNumber || !jobsByInvoice.get(l.invoiceNumber)?.length).length;
  const amountOff = collected.filter((l) => {
    const js = l.invoiceNumber ? jobsByInvoice.get(l.invoiceNumber) : undefined;
    if (!js?.length) return false;
    const crm = js.reduce((s, j) => s + num(j.totalPaidCard) + num(j.tipsCard), 0);
    return Math.abs(crm - num(l.amount)) > 1;
  }).length;

  return (
    <div className="portal-page">
      <PageHeader kicker="System · Banking · ScanPay payouts" title={payoutId} subtitle={payout ? `Team ${payout.team} · expected ${fmtDate(payout.expectedBy)} · ${payout.status}` : "Not synced yet"} />
      <BankingTabs active="scanpay-payouts" />
      <div style={{ margin: "6px 0 12px" }}><Link href="/portal/banking/scanpay-payouts" className="portal-btn">← All payouts</Link></div>

      {!payout ? <Empty message="This payout hasn't been synced yet." /> : (
        <>
          <section className="portal-grid-4">
            <StatPill label="Payout" value={fmt$(payout.amount)} />
            <StatPill label={`Payments (${collected.length})`} value={payout.totals ? fmt$(payout.totals.collected) : "—"} />
            <StatPill label="Fees · refunds · disputes" value={payout.totals ? fmt$(-payout.totals.fees + payout.totals.refunds + payout.totals.adjustments + payout.totals.other) : "—"} />
            <StatPill label="Payments to check" value={<span className={noJob + amountOff ? "money-neg" : "money-pos"}>{noJob} no CRM job · {amountOff} amount differs</span>} />
          </section>
          {payout.balanced === false && (
            <div className="portal-alert portal-alert-error" style={{ margin: "8px 0" }}>The lines ScanPay lists don&apos;t add up to this payout&apos;s amount.</div>
          )}
          <CardShell title={`Lines (${lines.length})`}>
            {lines.length === 0 ? <Empty message="No lines." /> : (
              <table className="portal-table">
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Description</th><th>CRM job</th><th className="right">CRM card + tip</th><th className="right">Amount</th></tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const js = l.invoiceNumber ? jobsByInvoice.get(l.invoiceNumber) ?? [] : [];
                    const isPayment = /^collected$/i.test(l.type);
                    const crm = js.reduce((s, j) => s + num(j.totalPaidCard) + num(j.tipsCard), 0);
                    const off = isPayment && js.length > 0 && Math.abs(crm - num(l.amount)) > 1;
                    return (
                      <tr key={l._id}>
                        <td>{l.dateIso ? fmtDate(l.dateIso) : l.date}</td>
                        <td>{l.name || l.type}</td>
                        <td className="small">{l.description}</td>
                        <td className="small">
                          {!isPayment ? "" : js.length === 0
                            ? <span className="money-neg">no CRM job</span>
                            : js.map((j) => `${j.clientName ?? "—"} · ${j.tech ?? "—"} · ${String(j.date ?? "").slice(0, 10)}`).join(" | ")}
                        </td>
                        <td className="right">{isPayment && js.length ? <span className={off ? "money-neg" : ""}>{fmt$(crm)}</span> : ""}</td>
                        <td className="right">{fmt$(l.effect)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardShell>
        </>
      )}
    </div>
  );
}
