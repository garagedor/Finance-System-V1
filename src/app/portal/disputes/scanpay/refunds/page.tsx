import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { ScanpayRefundRecord } from "@/types/scanpay";
import { fmt$, fmtDate } from "../../../format";
import { PageHeader, StatPill, CardShell, Empty } from "../../../_components/page-helpers";
import ScanpayRefundSyncButton from "./ScanpayRefundSyncButton";
import ScanpayRefundRowActions from "./ScanpayRefundRowActions";

export const dynamic = "force-dynamic";

type Tab = "queue" | "posted" | "ignored";

async function load(tab: Tab) {
  await ensureFinanceIndexes();
  const c = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
  const filter =
    tab === "posted" ? { matchStatus: "posted" as const }
    : tab === "ignored" ? { matchStatus: "ignored" as const }
    : { matchStatus: { $in: ["new", "matched"] as const } };
  const rows = await c.find(filter).sort({ paymentDate: -1 }).limit(500).toArray();

  const counts = await c.aggregate<{ _id: string; n: number }>([
    { $group: { _id: "$matchStatus", n: { $sum: 1 } } },
  ]).toArray();
  const cmap = Object.fromEntries(counts.map((x) => [x._id, x.n]));
  const queueCount = (cmap.new ?? 0) + (cmap.matched ?? 0);
  const postedAmt = rows.reduce((s, r) => s + (r.refundAmount ?? 0), 0);

  return { rows, cmap, queueCount, postedAmt };
}

export default async function ScanpayRefundInboxPage({ searchParams }: { searchParams: Promise<{ tab?: Tab }> }) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "posted" || sp.tab === "ignored" ? sp.tab : "queue";
  const d = await load(tab);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Integrations"
        title="ScanPay Refunds"
        subtitle="Refunded ScanPay payments. Confirm the job + enter the refunded amount and date (ScanPay's API doesn't provide them) to post to the Area Manager's ledger."
        actions={<ScanpayRefundSyncButton />}
      />

      <section className="portal-grid-4">
        <StatPill label="In queue" value={String(d.queueCount)} />
        <StatPill label="Posted" value={String(d.cmap.posted ?? 0)} />
        <StatPill label="Ignored" value={String(d.cmap.ignored ?? 0)} />
        <StatPill label={tab === "posted" ? "Refunded (this page)" : "—"} value={tab === "posted" ? fmt$(d.postedAmt) : "—"} />
      </section>

      <div className="portal-tabs" style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        {(["queue", "posted", "ignored"] as Tab[]).map((t) => (
          <Link key={t} href={`/portal/disputes/scanpay/refunds?tab=${t}`}
            className={`portal-btn ${tab === t ? "portal-btn-primary" : ""}`} style={{ textTransform: "capitalize" }}>
            {t}{t === "queue" ? ` (${d.queueCount})` : ""}
          </Link>
        ))}
        <Link href="/portal/disputes/scanpay" className="portal-btn" style={{ marginLeft: "auto" }}>ScanPay disputes →</Link>
      </div>

      <CardShell title={tab === "queue" ? "Needs review" : tab === "posted" ? "Posted to ledger" : "Ignored"} subtitle={`${d.rows.length} entries`}>
        {d.rows.length === 0 ? (
          <Empty message={tab === "queue" ? "Nothing to review. Hit Sync to pull refunded payments from ScanPay." : "Nothing here."} />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Payment date</th>
                <th>Invoice</th>
                <th className="right">Originally paid</th>
                <th>Suggested job</th>
                <th className="right">Refunded</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => {
                const best = r.candidates?.[0];
                return (
                  <tr key={r._id}>
                    <td className="small mono">{fmtDate(r.paymentDate ?? "")}</td>
                    <td>
                      <div className="mono small">{r.invoiceNumber || "—"}</div>
                      <div className="muted small">{r.paymentMethod} · {r.paymentId}</div>
                    </td>
                    <td className="right money">{fmt$(r.originalAmount)}</td>
                    <td>
                      {tab === "posted" ? (
                        <span className="muted small">posted · {r.matchMethod}</span>
                      ) : r.matchedJobId && best ? (
                        <div>
                          <div className="small">{best.address ?? r.matchedJobId}</div>
                          <div className="muted small">{best.method === "invoice" ? "invoice match" : "amount match — verify"} ({best.score})</div>
                        </div>
                      ) : (
                        <span className="muted small">no invoice match — pick a job</span>
                      )}
                    </td>
                    <td className="right money money-neg">{r.refundAmount != null ? `−${fmt$(r.refundAmount)}` : "—"}</td>
                    <td className="right">
                      <ScanpayRefundRowActions
                        id={r._id}
                        matchStatus={r.matchStatus}
                        suggestedJobId={r.matchedJobId}
                        suggestedLabel={best?.address ?? null}
                        originalAmount={r.originalAmount}
                        paymentDate={r.paymentDate}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardShell>
    </div>
  );
}
