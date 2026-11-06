import Link from "next/link";
import { readSession, hasPermission } from "@/lib/rbac";
import { coll, getDb, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { AUTO_LINK_ACTOR, type LinkSuggestionRecord } from "@/lib/scanpay/invoice-link-sync";
import { fmt$, fmtDate, fmtDateTime } from "../../format";
import { PageHeader, StatPill, CardShell, Empty } from "../../_components/page-helpers";
import BankingTabs from "../BankingTabs";
import { teamLabeler } from "@/lib/scanpay/team-names-server";
import { SuggestionActions, RunAutoLinkButton } from "./InvoiceLinkActions";

export const dynamic = "force-dynamic";

// Paid ScanPay invoices → CRM jobs. The daily auto-link writes the certain
// ones; this page shows what it did and what it needs a person for.

const REASON: Record<LinkSuggestionRecord["reason"], { title: string; help: string }> = {
  "amount-differs": { title: "Amount differs", help: "Same customer nearby, but the job's card amount doesn't match what ScanPay collected — fix the job's amount, then link." },
  ambiguous: { title: "Several jobs fit", help: "More than one job matches the date, amount and customer — pick the right one." },
  weak: { title: "Only date + amount match", help: "Nothing else confirms it (no customer name, phone or tech to compare)." },
  "shared-job": { title: "Two invoices, one job", help: "Two invoices point at the same job — often a split payment." },
  "tech-mismatch": { title: "Different technician", help: "The amount fits, but the job's technician isn't the ScanPay user who made the invoice." },
};

export default async function InvoiceLinksPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const s = await readSession();
  if (!s || !(s.type === "admin" || hasPermission(s, "finance:banking:view"))) {
    return <div className="portal-page"><div className="portal-alert portal-alert-error">Restricted.</div></div>;
  }
  const team = await teamLabeler();
  const canDecide = s.type === "admin" || hasPermission(s, "finance:banking:reconcile");
  const sp = await searchParams;
  await ensureFinanceIndexes();
  const db = await getDb();
  const S = coll<LinkSuggestionRecord>(FINANCE_COLLECTIONS.scanpayLinkSuggestion);
  const show = sp.show === "all" ? {} : { status: "open" };
  const rows = await S.find(show as never).sort({ "invoice.createdAt": -1 }).limit(300).toArray();
  const openCount = await S.countDocuments({ status: "open" } as never);
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const auto30 = await db.collection("Job").countDocuments({ invoiceLinkedBy: AUTO_LINK_ACTOR, invoiceLinkedAt: { $gte: since30 } });
  const confirmed30 = await db.collection("Job").countDocuments({ invoiceLinkedBy: { $regex: /^confirmed:/ }, invoiceLinkedAt: { $gte: since30 } });
  const lastRun = await db.collection("finance_audit").find({ action: "auto-link-invoices" }).sort({ changed_at: -1 }).limit(1).toArray();

  const groups = (Object.keys(REASON) as Array<LinkSuggestionRecord["reason"]>)
    .map((r) => ({ reason: r, rows: rows.filter((x) => x.reason === r) }))
    .filter((g) => g.rows.length);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="System · Banking"
        title="Invoice links"
        subtitle="Every day, paid ScanPay invoices are attached to their CRM job automatically — only when one job clearly fits. The rest wait here."
        actions={canDecide ? <RunAutoLinkButton /> : undefined}
      />
      <BankingTabs active="invoice-links" />

      <section className="portal-grid-4">
        <StatPill label="Linked automatically (30 days)" value={<span className="money-pos">{auto30.toLocaleString()}</span>} />
        <StatPill label="Confirmed by a person (30 days)" value={confirmed30.toLocaleString()} />
        <StatPill label="Waiting for a person" value={<span className={openCount ? "money-neg" : ""}>{openCount.toLocaleString()}</span>} />
        <StatPill label="Last run" value={lastRun[0]?.changed_at ? fmtDateTime(String(lastRun[0].changed_at)) : "—"} />
      </section>

      <div className="muted small" style={{ margin: "4px 0 10px" }}>
        {sp.show === "all"
          ? <Link href="/portal/banking/invoice-links">Show only open</Link>
          : <Link href="/portal/banking/invoice-links?show=all">Show decided ones too</Link>}
      </div>

      {groups.length === 0 ? (
        <CardShell title="Nothing waiting"><Empty message="Every paid invoice that has a matching job is linked." /></CardShell>
      ) : groups.map((g) => (
        <CardShell key={g.reason} title={`${REASON[g.reason].title} (${g.rows.length})`} subtitle={REASON[g.reason].help}>
          <table className="portal-table">
            <thead>
              <tr><th>Invoice</th><th>Paid</th><th>Customer</th><th>ScanPay user</th><th className="right">Amount</th><th>Possible job(s)</th></tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r._id}>
                  <td className="mono">{r._id}<div className="muted small">{team(r.team)}{r.status !== "open" ? ` · ${r.status}` : ""}</div></td>
                  <td>{fmtDate(r.invoice.createdAt)}</td>
                  <td>{r.invoice.customerName ?? "—"}{r.invoice.customerPhone ? <div className="muted small">{r.invoice.customerPhone}</div> : null}</td>
                  <td>{r.invoice.member ?? "—"}</td>
                  <td className="right">{fmt$(r.invoice.amount)}{r.invoice.tip ? <div className="muted small">tip {fmt$(r.invoice.tip)}</div> : null}</td>
                  <td>
                    <SuggestionActions
                      invoiceNumber={r._id}
                      open={r.status === "open" && canDecide}
                      candidates={r.candidates.map((c) => ({
                        jobId: c.jobId,
                        label: `${String(c.date ?? "").slice(0, 10)} · ${c.clientName ?? "—"} · ${c.tech ?? "—"} · card ${fmt$(c.card)}`,
                        sub: `${c.address ?? ""}${c.evidence.length ? ` · matches: ${c.evidence.join(", ")}` : ""}`,
                      }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardShell>
      ))}
    </div>
  );
}
