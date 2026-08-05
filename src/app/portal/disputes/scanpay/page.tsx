import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { enrichJobs, type JobEnrichment } from "@/lib/scanpay/enrich";
import type { ScanpayDisputeRecord } from "@/types/scanpay";
import { fmt$, fmtDate } from "../../format";
import { PageHeader, StatPill, CardShell, Empty, StatusPill, FilterBar, FilterField } from "../../_components/page-helpers";
import ScanpaySyncButton from "./ScanpaySyncButton";
import ScanpayRowActions from "./ScanpayRowActions";

export const dynamic = "force-dynamic";

type Tab = "queue" | "posted" | "ignored";

interface Filters {
  q: string; from: string; to: string; min: string; max: string;
  // multi-select
  outcome: string[]; reason: string[]; tech: string[];
  provider: string[]; am: string[]; matched: string[];
}

const arr = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);

const AM_UNASSIGNED = "⚠ unassigned";
const resolveTech = (r: ScanpayDisputeRecord, en?: JobEnrichment) =>
  en?.tech ?? r.technicians?.[0] ?? r.raw?.collectedBy ?? "";
const resolveProvider = (_r: ScanpayDisputeRecord, en?: JobEnrichment) => en?.provider ?? "";
const resolveAM = (_r: ScanpayDisputeRecord, en?: JobEnrichment) =>
  en?.areaManagerMissing ? AM_UNASSIGNED : (en?.areaManager ?? "");

async function load(tab: Tab, f: Filters) {
  await ensureFinanceIndexes();
  const c = coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute);
  const filter =
    tab === "posted" ? { matchStatus: "posted" as const }
    : tab === "ignored" ? { matchStatus: "ignored" as const }
    : { matchStatus: { $in: ["new", "matched"] as const } };
  const allRows = await c.find(filter).sort({ disputedAt: -1 }).limit(500).toArray();

  const counts = await c.aggregate<{ _id: string; n: number }>([
    { $group: { _id: "$matchStatus", n: { $sum: 1 } } },
  ]).toArray();
  const cmap = Object.fromEntries(counts.map((x) => [x._id, x.n]));
  const queueCount = (cmap.new ?? 0) + (cmap.matched ?? 0);

  const enrich = await enrichJobs(allRows.map((r) => r.matchedJobId));
  const en = (r: ScanpayDisputeRecord) => (r.matchedJobId ? enrich.get(r.matchedJobId) : undefined);

  // Dropdown options from the full tab set (before other filters apply).
  const uniq = (arr: string[]) => [...new Set(arr.filter(Boolean))].sort();
  const options = {
    reasons: uniq(allRows.map((r) => r.reason)),
    techs: uniq(allRows.map((r) => resolveTech(r, en(r)))),
    providers: uniq(allRows.map((r) => resolveProvider(r, en(r)))),
    ams: uniq(allRows.map((r) => resolveAM(r, en(r)))),
  };

  const ql = f.q.trim().toLowerCase();
  const minN = f.min ? parseFloat(f.min) : null;
  const maxN = f.max ? parseFloat(f.max) : null;
  const rows = allRows.filter((r) => {
    const e = en(r);
    if (ql) {
      const hay = [r.invoiceNumber, r.customerName, r.serviceAddress, resolveTech(r, e), r.candidates?.[0]?.address]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    if (f.outcome.length && !f.outcome.includes(r.outcome)) return false;
    if (f.reason.length && !f.reason.includes(r.reason)) return false;
    if (f.tech.length && !f.tech.includes(resolveTech(r, e))) return false;
    if (f.provider.length && !f.provider.includes(resolveProvider(r, e))) return false;
    if (f.am.length && !f.am.includes(resolveAM(r, e))) return false;
    if (f.matched.length && !f.matched.includes(r.matchedJobId ? "matched" : "unmatched")) return false;
    const day = r.disputedAt ? r.disputedAt.slice(0, 10) : "";
    if (f.from && (!day || day < f.from)) return false;
    if (f.to && (!day || day > f.to)) return false;
    if (minN != null && r.amount < minN) return false;
    if (maxN != null && r.amount > maxN) return false;
    return true;
  });

  const openLoss = rows.filter((r) => r.outcome === "lost").reduce((s, r) => s + r.amount, 0);
  return { rows, total: allRows.length, cmap, queueCount, openLoss, enrich, options };
}

const OUTCOME_PILL: Record<string, string> = { won: "won", lost: "lost", pending: "open" };

export default async function ScanpayInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "posted" || sp.tab === "ignored" ? sp.tab : "queue";
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  const f: Filters = {
    q: str(sp.q), from: str(sp.from), to: str(sp.to), min: str(sp.min), max: str(sp.max),
    outcome: arr(sp.outcome), reason: arr(sp.reason), tech: arr(sp.tech),
    provider: arr(sp.provider), am: arr(sp.am), matched: arr(sp.matched),
  };
  const d = await load(tab, f);

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
        <Link href="/portal/disputes/scanpay/refunds" className="portal-btn" style={{ marginLeft: "auto" }}>
          ScanPay refunds →
        </Link>
        <Link href="/portal/disputes" className="portal-btn">
          ← Manual
        </Link>
      </div>

      <FilterBar>
        <FilterField label="Search">
          <input className="portal-input" type="search" name="q" defaultValue={f.q} placeholder="invoice / customer / address / tech" />
        </FilterField>
        <FilterField label="Outcome">
          <select className="portal-select" name="outcome" defaultValue={f.outcome} multiple size={3}>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="pending">Pending</option>
          </select>
        </FilterField>
        <FilterField label="Reason">
          <select className="portal-select" name="reason" defaultValue={f.reason} multiple size={4}>
            {d.options.reasons.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </FilterField>
        <FilterField label="Technician">
          <select className="portal-select" name="tech" defaultValue={f.tech} multiple size={4}>
            {d.options.techs.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </FilterField>
        <FilterField label="Provider">
          <select className="portal-select" name="provider" defaultValue={f.provider} multiple size={4}>
            {d.options.providers.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </FilterField>
        <FilterField label="Area Manager">
          <select className="portal-select" name="am" defaultValue={f.am} multiple size={4}>
            {d.options.ams.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </FilterField>
        <FilterField label="Match">
          <select className="portal-select" name="matched" defaultValue={f.matched} multiple size={2}>
            <option value="matched">Matched</option>
            <option value="unmatched">Unmatched</option>
          </select>
        </FilterField>
        <FilterField label="From"><input className="portal-input" type="date" name="from" defaultValue={f.from} /></FilterField>
        <FilterField label="To"><input className="portal-input" type="date" name="to" defaultValue={f.to} /></FilterField>
        <FilterField label="Min $"><input className="portal-input" style={{ width: 90 }} type="number" step="0.01" name="min" defaultValue={f.min} /></FilterField>
        <FilterField label="Max $"><input className="portal-input" style={{ width: 90 }} type="number" step="0.01" name="max" defaultValue={f.max} /></FilterField>
        <input type="hidden" name="tab" value={tab} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, justifyContent: "flex-end" }}>
          <span className="muted small">Ctrl / ⌘-click for multiple</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
            <Link href={`/portal/disputes/scanpay?tab=${tab}`} className="portal-btn">Clear</Link>
          </div>
        </div>
      </FilterBar>

      <CardShell title={tab === "queue" ? "Needs review" : tab === "posted" ? "Posted to ledger" : "Ignored"} subtitle={`${d.rows.length} of ${d.total} entries`}>
        {d.rows.length === 0 ? (
          <Empty message={tab === "queue" ? "Nothing to review. Hit Sync to pull the latest from ScanPay." : "Nothing here."} />
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>Disputed</th>
                <th>Invoice / Customer</th>
                <th>Tech</th>
                <th>Provider</th>
                <th>Area Manager</th>
                <th>Reason</th>
                <th>Outcome</th>
                <th className="right">Disputed</th>
                <th className="right">Collected</th>
                <th>Matched job</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => {
                const best = r.candidates?.[0];
                const en = r.matchedJobId ? d.enrich.get(r.matchedJobId) : undefined;
                return (
                  <tr key={r._id}>
                    <td className="small mono">{fmtDate(r.disputedAt ?? "")}</td>
                    <td>
                      <div className="mono small">{r.invoiceNumber || "—"}</div>
                      <div className="muted small">{r.customerName || "—"} · {r.serviceAddress?.slice(0, 28) || "no address"}</div>
                    </td>
                    <td className="small">{en?.tech ?? r.technicians?.[0] ?? r.raw?.collectedBy ?? "—"}</td>
                    <td className="small">{en?.provider ?? "—"}</td>
                    <td className="small">
                      {en?.areaManager
                        ? en.areaManager
                        : en?.areaManagerMissing
                          ? <span style={{ color: "#f59e0b" }}>⚠ unassigned</span>
                          : "—"}
                    </td>
                    <td className="small muted">{r.reason || "—"}</td>
                    <td>
                      <StatusPill status={OUTCOME_PILL[r.outcome] ?? "open"} />
                      <div className="muted small">{r.statusRaw}</div>
                    </td>
                    <td className="right money money-neg">−{fmt$(r.amount)}</td>
                    <td className="right money">{en ? fmt$(en.collected) : "—"}</td>
                    <td>
                      {tab === "posted" ? (
                        <span className="muted small">posted · {r.matchMethod}</span>
                      ) : r.matchedJobId && best ? (
                        <div>
                          <div className="small">{best.address ?? r.matchedJobId}</div>
                          <div className="muted small">{best.date ? fmtDate(best.date) : "—"} · {best.method} ({best.score})</div>
                        </div>
                      ) : (
                        <span className="muted small">no match — pick a job</span>
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
          </div>
        )}
      </CardShell>
    </div>
  );
}
