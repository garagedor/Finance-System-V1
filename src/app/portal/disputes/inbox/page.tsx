// Unified ScanPay inbox — one place for disputes + refunds, reachable in one
// click. Card layout surfaces the info that was buried (for refunds: amount +
// refund date up front), live auto-sync via InboxLive, reuses the existing
// verify/post row-action components so the posting flow is unchanged.

import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { enrichJobs, type JobEnrichment } from "@/lib/scanpay/enrich";
import type { ScanpayDisputeRecord, ScanpayRefundRecord } from "@/types/scanpay";
import type { LedgerEntryRecord, LedgerRecord } from "@/types/finance-ledger";

type PostedTo = { ledgerId: string; holder: string };
import { fmt$, fmtDate } from "../../format";
import { PageHeader, StatPill, CardShell, Empty } from "../../_components/page-helpers";
import ScanpayRowActions from "../scanpay/ScanpayRowActions";
import ScanpayRefundRowActions from "../scanpay/refunds/ScanpayRefundRowActions";
import InboxLive from "./InboxLive";

export const dynamic = "force-dynamic";

type View = "action" | "refunds" | "disputes";
const ACTIONABLE = ["new", "matched", "verified"] as const;

function matchHay(inv: string, en?: JobEnrichment, extra?: string | null): string {
  return [inv, en?.clientName, en?.address, en?.tech, en?.provider, extra].filter(Boolean).join(" ").toLowerCase();
}

async function load(view: View, q: string) {
  await ensureFinanceIndexes();
  const rc = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
  const dc = coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute);

  const refundFilter: Record<string, unknown> | null = view === "disputes" ? null
    : view === "action" ? { matchStatus: { $in: ACTIONABLE } } : {};
  const disputeFilter: Record<string, unknown> | null = view === "refunds" ? null
    : view === "action" ? { matchStatus: { $in: ACTIONABLE } } : {};

  const [refunds, disputes] = await Promise.all([
    refundFilter ? rc.find(refundFilter as never).sort({ paymentDate: -1 }).limit(300).toArray() : Promise.resolve([] as ScanpayRefundRecord[]),
    disputeFilter ? dc.find(disputeFilter as never).sort({ disputedAt: -1 }).limit(300).toArray() : Promise.resolve([] as ScanpayDisputeRecord[]),
  ]);

  const enrich = await enrichJobs([...refunds.map((r) => r.matchedJobId), ...disputes.map((d) => d.matchedJobId)]);

  // Resolve which ledger each posted item landed on (via its ledger entry → ledger).
  const postedTo: Record<string, PostedTo> = {};
  const entryIds = [...refunds, ...disputes].map((x) => x.ledgerEntryId).filter((x): x is string => !!x);
  if (entryIds.length) {
    const les = await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry).find({ _id: { $in: entryIds } }).toArray();
    const entryToLedger = new Map(les.map((e) => [e._id, e.ledger_id]));
    const lids = [...new Set(les.map((e) => e.ledger_id))];
    const ls = lids.length ? await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).find({ _id: { $in: lids } }).toArray() : [];
    const holderById = new Map(ls.map((l) => [l._id, l.holder_name]));
    for (const x of [...refunds, ...disputes]) {
      const lid = x.ledgerEntryId ? entryToLedger.get(x.ledgerEntryId) : undefined;
      if (lid) postedTo[x._id] = { ledgerId: lid, holder: holderById.get(lid) ?? "ledger" };
    }
  }

  const ql = q.trim().toLowerCase();
  const rRows = ql ? refunds.filter((r) => matchHay(r.invoiceNumber, r.matchedJobId ? enrich.get(r.matchedJobId) : undefined, r.candidates?.[0]?.address).includes(ql)) : refunds;
  const dRows = ql ? disputes.filter((d) => matchHay(d.invoiceNumber, d.matchedJobId ? enrich.get(d.matchedJobId) : undefined, `${d.customerName} ${d.reason}`).includes(ql)) : disputes;

  // Counts for the tiles + switch (independent of the current view/search).
  const [rActionable, dActionable, refundQueue, refundMissing, postedRef, postedDisp] = await Promise.all([
    rc.countDocuments({ matchStatus: { $in: ACTIONABLE } } as never),
    dc.countDocuments({ matchStatus: { $in: ACTIONABLE } } as never),
    rc.countDocuments({ matchStatus: { $in: ["new", "matched"] } } as never),
    rc.countDocuments({ matchStatus: { $in: ["new", "matched"] }, refundAmount: null } as never),
    rc.countDocuments({ matchStatus: "posted" } as never),
    dc.countDocuments({ matchStatus: "posted" } as never),
  ]);

  return {
    refunds: rRows, disputes: dRows, enrich, postedTo,
    counts: {
      needsAction: rActionable + dActionable,
      refundsActionable: rActionable, disputesActionable: dActionable,
      refundQueue, refundMissing, posted: postedRef + postedDisp,
    },
  };
}

const AM = (en?: JobEnrichment) => en?.areaManager ? en.areaManager : en?.areaManagerMissing ? "⚠ unassigned" : "—";
const statusTone: Record<string, string> = { posted: "#34d399", verified: "#34d399", ignored: "#64748b" };

function Pill({ children, tone }: { children: React.ReactNode; tone?: "ok" | "warn" | "accent" | "muted" }) {
  const bg = tone === "ok" ? "rgba(16,185,129,0.12)" : tone === "warn" ? "rgba(245,158,11,0.14)" : tone === "accent" ? "rgba(129,140,248,0.14)" : "rgba(255,255,255,0.05)";
  const fg = tone === "ok" ? "#34d399" : tone === "warn" ? "#f59e0b" : tone === "accent" ? "#a5b4fc" : "#94a3b8";
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, borderRadius: 999, padding: "2px 9px", background: bg, color: fg }}>{children}</span>;
}

function PostedPill({ posted }: { posted?: PostedTo }) {
  if (!posted) return null;
  return (
    <Link href={`/portal/ledger/${posted.ledgerId}`} style={{ textDecoration: "none" }} title={`Open ${posted.holder}'s ledger`}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, borderRadius: 999, padding: "2px 9px", background: "rgba(16,185,129,0.12)", color: "#34d399" }}>✓ Posted → {posted.holder} ledger ↗</span>
    </Link>
  );
}

function Shares({ cs }: { cs?: ScanpayRefundRecord["computedShare"] }) {
  if (!cs) return null;
  const tech = Number(cs.technicianPortion) || 0;
  const am = Number((cs as { areaManagerOwnPortion?: number }).areaManagerOwnPortion ?? 0) || 0;
  const prov = Number(cs.providerCharge) || 0;
  const total = Number(cs.amLedgerCharge) || 0;
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, color: "#a5b4fc", fontWeight: 600 }}>View breakdown — who to charge</summary>
      <div style={{ marginTop: 6, fontSize: 12.5, display: "grid", gap: 2, maxWidth: 360 }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#c7d2fe", fontWeight: 600 }}><span>Technician — charge the tech</span><span className="money">{fmt$(tech)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span className="muted">Area manager own</span><span className="money">{fmt$(am)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span className="muted">Provider</span><span className="money">{fmt$(prov)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}><span>Total AM ledger charge</span><span className="money">{fmt$(total)}</span></div>
      </div>
    </details>
  );
}

const cardStyle: React.CSSProperties = { background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "14px 16px" };
const rowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "start" };

function RefundCard({ r, en, posted }: { r: ScanpayRefundRecord; en?: JobEnrichment; posted?: PostedTo }) {
  const isFull = r.refundAmount != null && r.refundAmount >= r.originalAmount - 0.005;
  const pct = r.refundAmount != null && r.originalAmount > 0 ? Math.round((r.refundAmount / r.originalAmount) * 100) : null;
  const flagged = (r.matchStatus === "new" || r.matchStatus === "matched");
  return (
    <div style={{ ...cardStyle, borderLeft: flagged ? "3px solid #f59e0b" : cardStyle.border as string }}>
      <div style={rowStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {en?.clientName || r.invoiceNumber || "Refund"} <Pill tone="accent">Refund</Pill>
            {posted ? <> <PostedPill posted={posted} /></> : r.matchStatus === "posted" ? <> <Pill tone="ok">Posted</Pill></> : null}
            {r.matchStatus === "verified" && <> <Pill tone="ok">Verified</Pill></>}
            {r.matchStatus === "ignored" && <> <Pill tone="muted">Ignored</Pill></>}
          </div>
          <div className="muted small mono" style={{ marginTop: 2 }}>{r.invoiceNumber || "no invoice"} · {r.paymentMethod} · {en?.address ? en.address.slice(0, 40) : (r.matchedJobId ? "no address" : "no match")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
            <Pill>Tech · {en?.tech ?? "—"}</Pill>
            <Pill>Provider · {en?.provider ?? "—"}</Pill>
            <Pill>AM · {AM(en)}</Pill>
            {en?.jobStatus && <Pill tone={/closed|x close/i.test(en.jobStatus) ? "ok" : "warn"}>{en.jobStatus}</Pill>}
            {!r.matchedJobId && <Pill tone="warn">pick a job</Pill>}
          </div>
          <Shares cs={r.computedShare} />
        </div>
        <div style={{ textAlign: "right", minWidth: 160 }}>
          <div className="small" style={{ color: "#94a3b8", display: "flex", flexDirection: "column", gap: 1, marginBottom: 8 }}>
            <span>Refund date · <b style={{ color: r.refundDate ? "#f1f5f9" : "#f59e0b" }}>{r.refundDate ? fmtDate(r.refundDate) : "not set"}</b></span>
            <span>Paid · <b style={{ color: "#f1f5f9" }}>{r.paymentDate ? fmtDate(r.paymentDate) : "—"}</b></span>
          </div>
          {r.refundAmount != null ? (
            <>
              <div className="money money-neg" style={{ fontSize: 20, fontWeight: 700 }}>−{fmt$(r.refundAmount)}</div>
              <div className="small" style={{ fontWeight: 600, color: isFull ? "#34d399" : "#f59e0b" }}>{isFull ? "Full refund" : `Partial · ${pct}%`}</div>
            </>
          ) : (
            <div className="small" style={{ color: "#f59e0b", fontWeight: 600 }}>Needs amount<div style={{ color: "#8b93a5", fontWeight: 500 }}>paid {fmt$(r.originalAmount)}</div></div>
          )}
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <ScanpayRefundRowActions id={r._id} matchStatus={r.matchStatus} suggestedJobId={r.matchedJobId} suggestedLabel={r.candidates?.[0]?.address ?? null} originalAmount={r.originalAmount} paymentDate={r.paymentDate} chargedAt={r.chargedAt ?? null} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DisputeCard({ d, en, posted }: { d: ScanpayDisputeRecord; en?: JobEnrichment; posted?: PostedTo }) {
  const flagged = (d.matchStatus === "new" || d.matchStatus === "matched");
  return (
    <div style={{ ...cardStyle, borderLeft: flagged ? "3px solid #f59e0b" : cardStyle.border as string }}>
      <div style={rowStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {d.customerName || en?.clientName || d.invoiceNumber || "Dispute"} <Pill tone="warn">Dispute</Pill>
            {d.outcome && <> <Pill tone={d.outcome === "won" ? "ok" : d.outcome === "lost" ? "warn" : "muted"}>{d.outcome}</Pill></>}
            {posted ? <> <PostedPill posted={posted} /></> : d.matchStatus === "posted" ? <> <Pill tone="ok">Posted</Pill></> : null}
            {d.matchStatus === "verified" && <> <Pill tone="ok">Verified</Pill></>}
            {d.matchStatus === "ignored" && <> <Pill tone="muted">Ignored</Pill></>}
          </div>
          <div className="muted small mono" style={{ marginTop: 2 }}>{d.invoiceNumber || "no invoice"}{d.reason ? ` · ${d.reason}` : ""} · {en?.address ? en.address.slice(0, 40) : (d.matchedJobId ? "no address" : "no match")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
            <Pill>Tech · {en?.tech ?? "—"}</Pill>
            <Pill>Provider · {en?.provider ?? "—"}</Pill>
            <Pill>AM · {AM(en)}</Pill>
            {en?.jobStatus && <Pill tone={/closed|x close/i.test(en.jobStatus) ? "ok" : "warn"}>{en.jobStatus}</Pill>}
            {!d.matchedJobId && <Pill tone="warn">pick a job</Pill>}
          </div>
          <Shares cs={d.computedShare} />
        </div>
        <div style={{ textAlign: "right", minWidth: 160 }}>
          <div className="small" style={{ color: "#94a3b8", display: "flex", flexDirection: "column", gap: 1, marginBottom: 8 }}>
            <span>Filed · <b style={{ color: "#f1f5f9" }}>{d.disputedAt ? fmtDate(d.disputedAt) : "—"}</b></span>
            {d.resolvedAt && <span>Resolved · <b style={{ color: "#f1f5f9" }}>{fmtDate(d.resolvedAt)}</b></span>}
          </div>
          <div className="money money-neg" style={{ fontSize: 20, fontWeight: 700 }}>−{fmt$(d.amount)}</div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <ScanpayRowActions id={d._id} matchStatus={d.matchStatus} suggestedJobId={d.matchedJobId} suggestedLabel={d.candidates?.[0]?.address ?? null} amount={d.amount} chargedAt={d.chargedAt ?? null} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  const view: View = sp.view === "refunds" || sp.view === "disputes" ? sp.view : "action";
  const q = str(sp.q);
  const d = await load(view, q);

  const items: Array<{ kind: "r" | "d"; date: string; node: React.ReactNode }> = [
    ...d.refunds.map((r) => ({ kind: "r" as const, date: r.paymentDate ?? "", node: <RefundCard key={`r-${r._id}`} r={r} en={r.matchedJobId ? d.enrich.get(r.matchedJobId) : undefined} posted={d.postedTo[r._id]} /> })),
    ...d.disputes.map((x) => ({ kind: "d" as const, date: x.disputedAt ?? "", node: <DisputeCard key={`d-${x._id}`} d={x} en={x.matchedJobId ? d.enrich.get(x.matchedJobId) : undefined} posted={d.postedTo[x._id]} /> })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const tab = (v: View, label: string, count: number) => (
    <Link href={`/portal/disputes/inbox?view=${v}`} className={`portal-btn ${view === v ? "portal-btn-primary" : ""}`}>
      {label} <span className="muted">{count}</span>
    </Link>
  );

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Tracking"
        title="Disputes & Refunds"
        subtitle="One inbox for ScanPay disputes and refunds. Confirm the job + amount/date and post to the Area Manager's ledger."
        actions={<InboxLive />}
      />

      <section className="portal-grid-4">
        <StatPill label="Needs action" value={String(d.counts.needsAction)} />
        <StatPill label="Refunds missing amount/date" value={<span className="money-neg">{d.counts.refundMissing}</span>} />
        <StatPill label="Refund queue" value={String(d.counts.refundQueue)} />
        <StatPill label="Posted" value={String(d.counts.posted)} />
      </section>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "6px 0 12px" }}>
        {tab("action", "Needs action", d.counts.needsAction)}
        {tab("refunds", "Refunds", d.counts.refundsActionable)}
        {tab("disputes", "Disputes", d.counts.disputesActionable)}
        <form style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <input type="hidden" name="view" value={view} />
          <input className="portal-input" type="search" name="q" defaultValue={q} placeholder="Search invoice / customer / tech / address" style={{ minWidth: 220 }} />
          <button type="submit" className="portal-btn">Search</button>
          {q && <Link href={`/portal/disputes/inbox?view=${view}`} className="portal-btn portal-btn-ghost">Clear</Link>}
        </form>
      </div>

      <CardShell title={view === "action" ? "Needs action" : view === "refunds" ? "Refunds" : "Disputes"} subtitle={`${items.length} shown`}>
        <div style={{ padding: 12 }}>
          {items.length === 0 ? (
            <Empty message={view === "action" ? "Nothing needs action — you're all caught up." : "Nothing here. Hit Sync now to pull the latest from ScanPay."} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((it) => it.node)}
            </div>
          )}
        </div>
      </CardShell>

      <p className="muted small" style={{ marginTop: 10 }}>
        Live — syncs ScanPay when you open this page and keeps refreshing. The old table views are still at{" "}
        <Link href="/portal/disputes/scanpay" style={{ color: "#818cf8" }}>disputes</Link> ·{" "}
        <Link href="/portal/disputes/scanpay/refunds" style={{ color: "#818cf8" }}>refunds</Link>.
      </p>
    </div>
  );
}
