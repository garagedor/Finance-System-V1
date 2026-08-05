import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { ScanpayDisputeRecord } from "@/types/scanpay";
import { fmt$, fmtDate } from "../../format";
import { PageHeader, StatPill, CardShell, Empty, StatusPill } from "../../_components/page-helpers";
import ScanpaySyncButton from "./ScanpaySyncButton";
import ScanpayRowActions from "./ScanpayRowActions";

export const dynamic = "force-dynamic";

type Tab = "queue" | "posted" | "ignored";

async function load(tab: Tab) {
  await ensureFinanceIndexes();
  const c = coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute);
  const filter =
    tab === "posted" ? { matchStatus: "posted" as const }
    : tab === "ignored" ? { matchStatus: "ignored" as const }
    : { matchStatus: { $in: ["new", "matched"] as const } };
  const rows = await c.find(filter).sort({ disputedAt: -1 }).limit(500).toArray();

  const counts = await c.aggregate<{ _id: string; n: number }>([
    { $group: { _id: "$matchStatus", n: { $sum: 1 } } },
  ]).toArray();
  const cmap = Object.fromEntries(counts.map((x) => [x._id, x.n]));
  const queueCount = (cmap.new ?? 0) + (cmap.matched ?? 0);

  const openLoss = rows
    .filter((r) => r.outcome === "lost")
    .reduce((s, r) => s + r.amount, 0);

  return { rows, cmap, queueCount, openLoss };
}

const OUTCOME_PILL: Record<string, string> = { won: "won", lost: "lost", pending: "open" };

export default async function ScanpayInboxPage({ searchParams }: { searchParams: Promise<{ tab?: Tab }> }) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "posted" || sp.tab === "ignored" ? sp.tab : "queue";
  const d = await load(tab);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Integrations"
        title="ScanPay Disputes"
        subtitle="Chargebacks pulled from ScanPay. Confirm the matched job to post your slice to the Area Manager's ledger."
        actions={<ScanpaySyncButton />}
      />

      <section className="portal-grid-4">
        <StatPill label="In queue" value={String(d.queueCount)} />
        <StatPill label="Posted" value={String(d.cmap.posted ?? 0)} />
        <StatPill label="Ignored" value={String(d.cmap.ignored ?? 0)} />
        <StatPill label="Lost (this page)" value={fmt$(d.openLoss)} />
      </section>

      <div className="portal-tabs" style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        {(["queue", "posted", "ignored"] as Tab[]).map((t) => (
          <Link
            key={t}
            href={`/portal/disputes/scanpay?tab=${t}`}
            className={`portal-btn ${tab === t ? "portal-btn-primary" : ""}`}
            style={{ textTransform: "capitalize" }}
          >
            {t}{t === "queue" ? ` (${d.queueCount})` : ""}
          </Link>
        ))}
        <Link href="/portal/disputes" className="portal-btn" style={{ marginLeft: "auto" }}>
          ← Manual disputes
        </Link>
      </div>

      <CardShell title={tab === "queue" ? "Needs review" : tab === "posted" ? "Posted to ledger" : "Ignored"} subtitle={`${d.rows.length} entries`}>
        {d.rows.length === 0 ? (
          <Empty message={tab === "queue" ? "Nothing to review. Hit Sync to pull the latest from ScanPay." : "Nothing here."} />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Disputed</th>
                <th>Invoice / Customer</th>
                <th>Outcome</th>
                <th className="right">Amount</th>
                <th>Suggested job</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => {
                const best = r.candidates?.[0];
                return (
                  <tr key={r._id}>
                    <td className="small mono">{fmtDate(r.disputedAt ?? "")}</td>
                    <td>
                      <div className="mono small">{r.invoiceNumber || "—"}</div>
                      <div className="muted small">{r.customerName || "—"} · {r.serviceAddress?.slice(0, 32) || "no address"}</div>
                    </td>
                    <td>
                      <StatusPill status={OUTCOME_PILL[r.outcome] ?? "open"} />
                      <div className="muted small">{r.statusRaw}</div>
                    </td>
                    <td className="right money money-neg">−{fmt$(r.amount)}</td>
                    <td>
                      {tab === "posted" ? (
                        <span className="muted small">posted · {r.matchMethod}</span>
                      ) : r.matchedJobId && best ? (
                        <div>
                          <div className="small">{best.address ?? r.matchedJobId}</div>
                          <div className="muted small">
                            {best.tech ?? "—"} · {best.date ? fmtDate(best.date) : "—"} · {best.method} ({best.score})
                          </div>
                        </div>
                      ) : (
                        <span className="muted small">no confident match — pick a job</span>
                      )}
                    </td>
                    <td className="right">
                      <ScanpayRowActions
                        id={r._id}
                        matchStatus={r.matchStatus}
                        suggestedJobId={r.matchedJobId}
                        suggestedLabel={best?.address ?? null}
                        amount={r.amount}
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
