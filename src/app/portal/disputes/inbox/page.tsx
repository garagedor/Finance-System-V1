// Unified ScanPay inbox — one place for disputes + refunds, reachable in one
// click. Card layout surfaces the info that was buried (for refunds: amount +
// refund date up front), live auto-sync via InboxLive, reuses the existing
// verify/post row-action components so the posting flow is unchanged.

import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { enrichJobs, type JobEnrichment } from "@/lib/scanpay/enrich";
import type { ScanpayDisputeRecord, ScanpayRefundRecord } from "@/types/scanpay";

import { fmt$, fmtDate } from "../../format";
import { PageHeader, StatPill, CardShell, Empty } from "../../_components/page-helpers";
import InboxFilters from "./InboxFilters";
import ScanpayRowActions from "../scanpay/ScanpayRowActions";
import PostingCoveragePanel from "../scanpay/PostingCoverage";
import ScanpayRefundRowActions from "../scanpay/refunds/ScanpayRefundRowActions";
import InboxLive from "./InboxLive";
import { coverageForInboxItems, type RecordCoverage } from "@/lib/dispute-coverage";
import {
  type InboxStage, STAGE_LABEL, STAGE_STATUSES,
  stageFilter, isMixedStage, parseStage,
} from "@/lib/inbox-stage";

export const dynamic = "force-dynamic";

type Kind = "both" | "disputes" | "refunds";
// The Status filter is gone: it let a user ask the Disputes tab for posted
// rows, which is the tab contradicting itself. Stage first, then filters.
type Filters = { q: string; tech: string[]; provider: string[]; am: string[]; matched: string[]; from: string; to: string; min: string; max: string };
const AM_UNASSIGNED = "⚠ unassigned";
const enAM = (e?: JobEnrichment) => (e?.areaManager ? e.areaManager : e?.areaManagerMissing ? AM_UNASSIGNED : "");

function matchHay(inv: string, en?: JobEnrichment, extra?: string | null): string {
  return [inv, en?.clientName, en?.address, en?.tech, en?.provider, extra].filter(Boolean).join(" ").toLowerCase();
}

async function load(view: InboxStage, kind: Kind, f: Filters) {
  await ensureFinanceIndexes();
  const rc = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
  const dc = coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute);

  // Stage decides membership; `kind` only narrows a stage that spans both
  // collections. stageFilter returns null when the stage does not apply to a
  // collection at all, so the Refunds tab never queries disputes.
  const mixed = isMixedStage(view);
  const refundFilter = (mixed && kind === "disputes") ? null : stageFilter(view, "refund");
  const disputeFilter = (mixed && kind === "refunds") ? null : stageFilter(view, "dispute");

  const [refunds, disputes] = await Promise.all([
    refundFilter ? rc.find(refundFilter as never).sort({ paymentDate: -1 }).limit(300).toArray() : Promise.resolve([] as ScanpayRefundRecord[]),
    disputeFilter ? dc.find(disputeFilter as never).sort({ disputedAt: -1 }).limit(300).toArray() : Promise.resolve([] as ScanpayDisputeRecord[]),
  ]);

  const enrich = await enrichJobs([...refunds.map((r) => r.matchedJobId), ...disputes.map((d) => d.matchedJobId)]);

  /* Posting coverage per item.
     Was: follow the item's single ledgerEntryId to one ledger. That assumed
     one posting per dispute, which is the assumption this whole change
     removes — an item charged to the AM and the provider has two entries and
     the old lookup would show only whichever one the scalar pointed at.
     Now coverage is derived from every ledger entry carrying the canonical
     record id, so a charge made from a ledger page counts the same as one
     made here. */
  const blankContext = { hasProvider: true, hasAreaManager: true, hasTechnician: true };
  const [disputeCoverage, refundCoverage] = await Promise.all([
    coverageForInboxItems(disputes.map((d) => ({
      scanpayId: d._id, postedRecordId: d.postedRecordId ?? null, jobId: d.matchedJobId,
      amount: d.amount, chargedAt: d.chargedAt ?? null, computedShare: d.computedShare,
      context: blankContext,
    })), "dispute"),
    coverageForInboxItems(refunds.map((r) => ({
      scanpayId: r._id, postedRecordId: r.postedRecordId ?? null, jobId: r.matchedJobId,
      amount: r.refundAmount ?? r.originalAmount, chargedAt: r.chargedAt ?? null,
      computedShare: r.computedShare, context: blankContext,
    })), "refund"),
  ]);
  const coverage: Record<string, RecordCoverage> = {};
  for (const [id, c] of [...disputeCoverage, ...refundCoverage]) {
    // An item with nothing posted and nothing to review has no panel to draw.
    if (c.anyPosted || c.reviewRequired) coverage[id] = c;
  }

  // Filter option lists from all enriched rows (pre-filter), like the old inbox.
  const allEn = [...refunds, ...disputes].map((x) => (x.matchedJobId ? enrich.get(x.matchedJobId) : undefined));
  const uniq = (a: string[]) => [...new Set(a.filter(Boolean))].sort();
  const options = {
    techs: uniq(allEn.map((e) => e?.tech ?? "")),
    providers: uniq(allEn.map((e) => e?.provider ?? "")),
    ams: uniq(allEn.map((e) => enAM(e))),
  };

  const ql = f.q.trim().toLowerCase();
  const minN = f.min ? parseFloat(f.min) : null;
  const maxN = f.max ? parseFloat(f.max) : null;
  const pass = (e: JobEnrichment | undefined, matched: boolean, day: string, amt: number, hay: string): boolean => {
    if (ql && !hay.includes(ql)) return false;
    if (f.tech.length && !f.tech.includes(e?.tech ?? "")) return false;
    if (f.provider.length && !f.provider.includes(e?.provider ?? "")) return false;
    if (f.am.length && !f.am.includes(enAM(e))) return false;
    if (f.matched.length && !f.matched.includes(matched ? "matched" : "unmatched")) return false;
    if (f.from && (!day || day < f.from)) return false;
    if (f.to && (!day || day > f.to)) return false;
    if (minN != null && amt < minN) return false;
    if (maxN != null && amt > maxN) return false;
    return true;
  };
  const rRows = refunds.filter((r) => pass(r.matchedJobId ? enrich.get(r.matchedJobId) : undefined, !!r.matchedJobId, (r.paymentDate ?? "").slice(0, 10), r.originalAmount, matchHay(r.invoiceNumber, r.matchedJobId ? enrich.get(r.matchedJobId) : undefined, r.candidates?.[0]?.address)));
  const dRows = disputes.filter((d) => pass(d.matchedJobId ? enrich.get(d.matchedJobId) : undefined, !!d.matchedJobId, (d.disputedAt ?? "").slice(0, 10), d.amount, matchHay(d.invoiceNumber, d.matchedJobId ? enrich.get(d.matchedJobId) : undefined, `${d.customerName} ${d.reason}`)));

  // Counts come from STAGE_STATUSES — the same table the row queries are built
  // from — so a tab's number and its contents cannot disagree.
  const countFor = (c: typeof rc | typeof dc, stage: InboxStage) =>
    c.countDocuments({ matchStatus: { $in: [...STAGE_STATUSES[stage]] } } as never);

  const [
    needsRefunds, needsDisputes, activeRefunds, activeDisputes,
    postedRef, postedDisp, ignoredRef, ignoredDisp, refundMissing,
  ] = await Promise.all([
    countFor(rc, "action"), countFor(dc, "action"),
    countFor(rc, "refunds"), countFor(dc, "disputes"),
    countFor(rc, "posted"), countFor(dc, "posted"),
    countFor(rc, "ignored"), countFor(dc, "ignored"),
    rc.countDocuments({ matchStatus: { $in: [...STAGE_STATUSES.action] }, refundAmount: null } as never),
  ]);

  return {
    refunds: rRows, disputes: dRows, enrich, coverage, options,
    counts: {
      action: needsRefunds + needsDisputes,
      refunds: activeRefunds,
      disputes: activeDisputes,
      posted: postedRef + postedDisp,
      ignored: ignoredRef + ignoredDisp,
      // Per-kind splits for the Both/Refunds/Disputes sub-filter.
      needsRefunds, needsDisputes,
      postedRefunds: postedRef, postedDisputes: postedDisp,
      ignoredRefunds: ignoredRef, ignoredDisputes: ignoredDisp,
      refundMissing,
    } satisfies Record<InboxStage, number> & Record<string, number>,
  };
}

const AM = (en?: JobEnrichment) => en?.areaManager ? en.areaManager : en?.areaManagerMissing ? "⚠ unassigned" : "—";
const statusTone: Record<string, string> = { posted: "#34d399", verified: "#34d399", ignored: "#64748b" };

function Pill({ children, tone }: { children: React.ReactNode; tone?: "ok" | "warn" | "accent" | "muted" }) {
  const bg = tone === "ok" ? "rgba(16,185,129,0.12)" : tone === "warn" ? "rgba(245,158,11,0.14)" : tone === "accent" ? "rgba(129,140,248,0.14)" : "rgba(255,255,255,0.05)";
  const fg = tone === "ok" ? "#34d399" : tone === "warn" ? "#f59e0b" : tone === "accent" ? "#a5b4fc" : "#94a3b8";
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, borderRadius: 999, padding: "2px 9px", background: bg, color: fg }}>{children}</span>;
}

/**
 * Which parties this item has actually been charged to, and what is left.
 *
 * Replaces the old single "Posted → <holder> ledger" pill, which could only
 * ever name one ledger. A dispute settled with both the Area Manager and the
 * provider has two entries, and showing one of them was how a half-finished
 * item looked finished.
 */
function Coverage({
  coverage, endpoint, en,
}: {
  coverage?: RecordCoverage;
  endpoint: string;
  en?: JobEnrichment;
}) {
  if (!coverage) return null;
  return (
    <PostingCoveragePanel
      coverage={coverage}
      endpoint={endpoint}
      names={{
        areaManager: en?.areaManager ?? null,
        technician: en?.tech ?? null,
        provider: en?.provider ?? null,
      }}
    />
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

function RefundCard({ r, en, coverage }: { r: ScanpayRefundRecord; en?: JobEnrichment; coverage?: RecordCoverage }) {
  const isFull = r.refundAmount != null && r.refundAmount >= r.originalAmount - 0.005;
  const pct = r.refundAmount != null && r.originalAmount > 0 ? Math.round((r.refundAmount / r.originalAmount) * 100) : null;
  const flagged = (r.matchStatus === "new" || r.matchStatus === "matched");
  return (
    <div style={{ ...cardStyle, borderLeft: flagged ? "3px solid #f59e0b" : cardStyle.border as string }}>
      <div style={rowStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {en?.clientName || r.invoiceNumber || "Refund"} <Pill tone="accent">Refund</Pill>
            {r.matchStatus === "posted" ? <> <Pill tone="ok">Posted</Pill></> : null}
            {r.matchStatus === "verified" && <> <Pill tone="ok">Verified</Pill></>}
            {r.matchStatus === "ignored" && <> <Pill tone="muted">Ignored</Pill></>}
          </div>
          <div className="muted small mono" style={{ marginTop: 2 }}>{r.invoiceNumber || "no invoice"} · {r.paymentMethod} · {en?.address ? en.address.slice(0, 40) : (r.matchedJobId ? "no address" : "no match")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
            <Pill>Tech · {en?.tech ?? "—"}</Pill>
            <Pill>Provider · {en?.provider ?? "—"}</Pill>
            <Pill>AM · {AM(en)}</Pill>
            {en?.jobStatus && <Pill tone={/closed|x close/i.test(en.jobStatus) ? "ok" : "warn"}>{en.jobStatus}</Pill>}
            {/partial/i.test(r.raw?.status ?? "") && <Pill tone="warn">partial refund</Pill>}
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
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              <Coverage coverage={coverage} en={en}
                endpoint={`/api/portal/scanpay/refunds/${encodeURIComponent(r._id)}`} />
              <ScanpayRefundRowActions id={r._id} matchStatus={r.matchStatus} suggestedJobId={r.matchedJobId} suggestedLabel={r.candidates?.[0]?.address ?? null} originalAmount={r.originalAmount} paymentDate={r.paymentDate} chargedAt={r.chargedAt ?? null} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DisputeCard({ d, en, coverage }: { d: ScanpayDisputeRecord; en?: JobEnrichment; coverage?: RecordCoverage }) {
  const flagged = (d.matchStatus === "new" || d.matchStatus === "matched");
  return (
    <div style={{ ...cardStyle, borderLeft: flagged ? "3px solid #f59e0b" : cardStyle.border as string }}>
      <div style={rowStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {d.customerName || en?.clientName || d.invoiceNumber || "Dispute"} <Pill tone="warn">Dispute</Pill>
            {d.outcome && <> <Pill tone={d.outcome === "won" ? "ok" : d.outcome === "lost" ? "warn" : "muted"}>{d.outcome}</Pill></>}
            {d.matchStatus === "posted" ? <> <Pill tone="ok">Posted</Pill></> : null}
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
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              <Coverage coverage={coverage} en={en}
                endpoint={`/api/portal/scanpay/${encodeURIComponent(d._id)}`} />
              <ScanpayRowActions id={d._id} matchStatus={d.matchStatus} suggestedJobId={d.matchedJobId} suggestedLabel={d.candidates?.[0]?.address ?? null} amount={d.amount} chargedAt={d.chargedAt ?? null} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  const arr = (v: string | string[] | undefined) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);
  const view = parseStage(sp.view);
  const kind: Kind = sp.kind === "disputes" || sp.kind === "refunds" ? sp.kind : "both";
  const f: Filters = { q: str(sp.q), tech: arr(sp.tech), provider: arr(sp.provider), am: arr(sp.am), matched: arr(sp.matched), from: str(sp.from), to: str(sp.to), min: str(sp.min), max: str(sp.max) };
  const d = await load(view, kind, f);
  // Stages that span both collections carry the Both/Refunds/Disputes filter.
  const mixedView = isMixedStage(view);
  const clearHref = mixedView ? `/portal/disputes/inbox?view=${view}&kind=${kind}` : `/portal/disputes/inbox?view=${view}`;
  // Per-view kind sub-tab counts.
  const subCounts = view === "posted" ? { r: d.counts.postedRefunds, dd: d.counts.postedDisputes }
    : view === "ignored" ? { r: d.counts.ignoredRefunds, dd: d.counts.ignoredDisputes }
    : { r: d.counts.needsRefunds, dd: d.counts.needsDisputes };
  // Tabs render straight from the pipeline order — the flow IS the tab strip.
  const stageCount: Record<InboxStage, number> = {
    action: d.counts.action, refunds: d.counts.refunds,
    disputes: d.counts.disputes, posted: d.counts.posted, ignored: d.counts.ignored,
  };

  const items: Array<{ kind: "r" | "d"; date: string; node: React.ReactNode }> = [
    ...d.refunds.map((r) => ({ kind: "r" as const, date: r.paymentDate ?? "", node: <RefundCard key={`r-${r._id}`} r={r} en={r.matchedJobId ? d.enrich.get(r.matchedJobId) : undefined} coverage={d.coverage[r._id]} /> })),
    ...d.disputes.map((x) => ({ kind: "d" as const, date: x.disputedAt ?? "", node: <DisputeCard key={`d-${x._id}`} d={x} en={x.matchedJobId ? d.enrich.get(x.matchedJobId) : undefined} coverage={d.coverage[x._id]} /> })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const tab = (v: InboxStage, label: string, count: number) => (
    <Link href={`/portal/disputes/inbox?view=${v}`} className={`portal-btn ${view === v ? "portal-btn-primary" : ""}`}>
      {label} <span className="muted">{count}</span>
    </Link>
  );
  const subTab = (k: Kind, label: string, count?: number) => (
    <Link href={`/portal/disputes/inbox?view=${view}&kind=${k}`} className={`portal-btn ${kind === k ? "portal-btn-primary" : "portal-btn-ghost"}`} style={{ padding: "4px 12px", fontSize: 12 }}>
      {label}{count != null ? <> <span className="muted">{count}</span></> : null}
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
        <StatPill label="Needs action" value={String(d.counts.action)} />
        <StatPill label="Refunds missing amount/date" value={<span className="money-neg">{d.counts.refundMissing}</span>} />
        <StatPill label="In progress" value={String(d.counts.refunds + d.counts.disputes)} />
        <StatPill label="Posted" value={String(d.counts.posted)} />
      </section>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "6px 0 10px" }}>
        {tab("action", STAGE_LABEL.action, stageCount.action)}
        <span className="muted small" aria-hidden="true">→</span>
        {tab("refunds", STAGE_LABEL.refunds, stageCount.refunds)}
        {tab("disputes", STAGE_LABEL.disputes, stageCount.disputes)}
        <span className="muted small" aria-hidden="true">→</span>
        {tab("posted", STAGE_LABEL.posted, stageCount.posted)}
        {tab("ignored", STAGE_LABEL.ignored, stageCount.ignored)}
      </div>

      {mixedView && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "0 0 10px" }}>
          <span className="muted small" style={{ marginRight: 2 }}>Show:</span>
          {subTab("both", "Both")}
          {subTab("refunds", "Refunds", subCounts.r)}
          {subTab("disputes", "Disputes", subCounts.dd)}
        </div>
      )}

      <InboxFilters view={view} kind={kind} initial={f} options={d.options} clearHref={clearHref} />
      <div style={{ height: 12 }} />

      <CardShell title={STAGE_LABEL[view]} subtitle={`${items.length} shown`}>
        <div style={{ padding: 12 }}>
          {items.length === 0 ? (
            <Empty message={view === "action" ? "Nothing needs action — you're all caught up." : view === "ignored" ? "Nothing ignored. Use the Ignore button on an item to park it here." : view === "posted" ? "Nothing posted to a ledger yet." : "Nothing waiting here. Items arrive once you pick a job in Needs action."} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((it) => it.node)}
            </div>
          )}
        </div>
      </CardShell>

      <p className="muted small" style={{ marginTop: 10 }}>
        Live — syncs ScanPay when you open this page and keeps refreshing.
      </p>
    </div>
  );
}
