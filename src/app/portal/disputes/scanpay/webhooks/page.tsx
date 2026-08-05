import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { fmtDateTime } from "../../../format";
import { PageHeader, StatPill, CardShell, Empty } from "../../../_components/page-helpers";

export const dynamic = "force-dynamic";

interface WebhookLog {
  _id: string;
  received_at: string;
  kind: "dispute" | "refund" | "unrecognized";
  event?: unknown;
  processed?: boolean;
  result?: unknown;
  error?: string | null;
  raw?: unknown;
}

async function load() {
  await ensureFinanceIndexes();
  const c = coll<WebhookLog>(FINANCE_COLLECTIONS.scanpayWebhookLog);
  const rows = await c.find({}).sort({ received_at: -1 }).limit(200).toArray();
  const counts = await c.aggregate<{ _id: string; n: number }>([
    { $group: { _id: "$kind", n: { $sum: 1 } } },
  ]).toArray();
  const cmap = Object.fromEntries(counts.map((x) => [x._id, x.n]));
  const total = rows.length;
  const errors = rows.filter((r) => r.error).length;
  return { rows, cmap, total, errors };
}

const KIND_COLOR: Record<string, string> = { dispute: "#818cf8", refund: "#34d399", unrecognized: "#f59e0b" };

export default async function ScanpayWebhookLogPage() {
  const d = await load();

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Integrations"
        title="ScanPay Webhook Log"
        subtitle="Raw events ScanPay pushes to /api/scanpay/webhook — newest first. Used to confirm delivery and discover the payload shape."
        actions={<Link href="/portal/disputes/scanpay" className="portal-btn">← ScanPay disputes</Link>}
      />

      <section className="portal-grid-4">
        <StatPill label="Events (recent)" value={String(d.total)} />
        <StatPill label="Disputes" value={String(d.cmap.dispute ?? 0)} />
        <StatPill label="Refunds" value={String(d.cmap.refund ?? 0)} />
        <StatPill label="Unrecognized / errors" value={`${d.cmap.unrecognized ?? 0} / ${d.errors}`} />
      </section>

      <CardShell title="Events" subtitle={`${d.total} shown (latest 200)`}>
        {d.rows.length === 0 ? (
          <Empty message="No webhook events yet. Once you set SCANPAY_WEBHOOK_SECRET and point each ScanPay team's webhook at /api/scanpay/webhook?token=…, events will appear here." />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Kind</th>
                <th>Event</th>
                <th>Processed</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r._id}>
                  <td className="small mono">{fmtDateTime(r.received_at)}</td>
                  <td className="small" style={{ color: KIND_COLOR[r.kind] ?? undefined, fontWeight: 600 }}>{r.kind}</td>
                  <td className="small muted">{r.event ? String(r.event) : "—"}</td>
                  <td className="small">
                    {r.error ? <span style={{ color: "#f87171" }}>⚠ {r.error}</span>
                      : r.processed ? <span style={{ color: "#34d399" }}>✓</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td>
                    <details>
                      <summary style={{ cursor: "pointer", fontSize: 12, color: "#818cf8" }}>view</summary>
                      <pre style={{ maxWidth: 520, maxHeight: 260, overflow: "auto", fontSize: 11, background: "rgba(255,255,255,0.03)", padding: 8, borderRadius: 6, marginTop: 6 }}>
                        {JSON.stringify(r.raw ?? {}, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>
    </div>
  );
}
