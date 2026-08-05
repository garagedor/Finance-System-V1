import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { enrichJobs, type JobEnrichment } from "@/lib/scanpay/enrich";
import type { ScanpayRefundRecord } from "@/types/scanpay";
import { fmt$, fmtDate } from "../../../format";
import { PageHeader, StatPill, CardShell, Empty, FilterBar, FilterField } from "../../../_components/page-helpers";
import MultiSelect from "../../../_components/MultiSelect";
import ScanpayRefundSyncButton from "./ScanpayRefundSyncButton";
import ScanpayRefundRowActions from "./ScanpayRefundRowActions";

export const dynamic = "force-dynamic";

type Tab = "queue" | "verified" | "posted" | "ignored";

interface Filters {
  q: string; from: string; to: string; min: string; max: string;
  tech: string[]; provider: string[]; am: string[]; matched: string[];
}

const arr = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);
const AM_UNASSIGNED = "⚠ unassigned";
const rTech = (en?: JobEnrichment) => en?.tech ?? "";
const rProvider = (en?: JobEnrichment) => en?.provider ?? "";
const rAM = (en?: JobEnrichment) => (en?.areaManagerMissing ? AM_UNASSIGNED : (en?.areaManager ?? ""));

async function load(tab: Tab, f: Filters) {
  await ensureFinanceIndexes();
  const c = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
  const filter =
    tab === "posted" ? { matchStatus: "posted" as const }
    : tab === "ignored" ? { matchStatus: "ignored" as const }
    : tab === "verified" ? { matchStatus: "verified" as const }
    : { matchStatus: { $in: ["new", "matched"] as const } };
  const allRows = await c.find(filter).sort({ paymentDate: -1 }).limit(500).toArray();

  const counts = await c.aggregate<{ _id: string; n: number }>([
    { $group: { _id: "$matchStatus", n: { $sum: 1 } } },
  ]).toArray();
  const cmap = Object.fromEntries(counts.map((x) => [x._id, x.n]));
  const queueCount = (cmap.new ?? 0) + (cmap.matched ?? 0);

  const enrich = await enrichJobs(allRows.map((r) => r.matchedJobId));
  const en = (r: ScanpayRefundRecord) => (r.matchedJobId ? enrich.get(r.matchedJobId) : undefined);

  const uniq = (a: string[]) => [...new Set(a.filter(Boolean))].sort();
  const options = {
    techs: uniq(allRows.map((r) => rTech(en(r)))),
    providers: uniq(allRows.map((r) => rProvider(en(r)))),
    ams: uniq(allRows.map((r) => rAM(en(r)))),
  };

  const ql = f.q.trim().toLowerCase();
  const minN = f.min ? parseFloat(f.min) : null;
  const maxN = f.max ? parseFloat(f.max) : null;
  const rows = allRows.filter((r) => {
    const e = en(r);
    if (ql) {
      const hay = [r.invoiceNumber, r.paymentId, r.paymentMethod, rTech(e), r.candidates?.[0]?.address]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    if (f.tech.length && !f.tech.includes(rTech(e))) return false;
    if (f.provider.length && !f.provider.includes(rProvider(e))) return false;
    if (f.am.length && !f.am.includes(rAM(e))) return false;
    if (f.matched.length && !f.matched.includes(r.matchedJobId ? "matched" : "unmatched")) return false;
    const day = r.paymentDate ? r.paymentDate.slice(0, 10) : "";
    if (f.from && (!day || day < f.from)) return false;
    if (f.to && (!day || day > f.to)) return false;
    if (minN != null && r.originalAmount < minN) return false;
    if (maxN != null && r.originalAmount > maxN) return false;
    return true;
  });

  const postedAmt = rows.reduce((s, r) => s + (r.refundAmount ?? 0), 0);
  return { rows, total: allRows.length, cmap, queueCount, postedAmt, enrich, options };
}

export default async function ScanpayRefundInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "posted" || sp.tab === "ignored" || sp.tab === "verified" ? sp.tab : "queue";
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  const f: Filters = {
    q: str(sp.q), from: str(sp.from), to: str(sp.to), min: str(sp.min), max: str(sp.max),
    tech: arr(sp.tech), provider: arr(sp.provider), am: arr(sp.am), matched: arr(sp.matched),
  };
  const d = await load(tab, f);

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
        {(["queue", "verified", "posted", "ignored"] as Tab[]).map((t) => (
          <Link key={t} href={`/portal/disputes/scanpay/refunds?tab=${t}`}
            className={`portal-btn ${tab === t ? "portal-btn-primary" : ""}`} style={{ textTransform: "capitalize" }}>
            {t}{t === "queue" ? ` (${d.queueCount})` : t === "verified" ? ` (${d.cmap.verified ?? 0})` : ""}
          </Link>
        ))}
        <Link href="/portal/disputes/scanpay" className="portal-btn" style={{ marginLeft: "auto" }}>ScanPay disputes →</Link>
      </div>

      <FilterBar>
        <FilterField label="Search">
          <input className="portal-input" type="search" name="q" defaultValue={f.q} placeholder="invoice / payment id / address / tech" />
        </FilterField>
        <FilterField label="Technician">
          <MultiSelect name="tech" selected={f.tech} options={d.options.techs} />
        </FilterField>
        <FilterField label="Provider">
          <MultiSelect name="provider" selected={f.provider} options={d.options.providers} />
        </FilterField>
        <FilterField label="Area Manager">
          <MultiSelect name="am" selected={f.am} options={d.options.ams} />
        </FilterField>
        <FilterField label="Match">
          <MultiSelect name="matched" selected={f.matched} options={["matched", "unmatched"]} labels={{ matched: "Matched", unmatched: "Unmatched" }} />
        </FilterField>
        <FilterField label="From"><input className="portal-input" type="date" name="from" defaultValue={f.from} /></FilterField>
        <FilterField label="To"><input className="portal-input" type="date" name="to" defaultValue={f.to} /></FilterField>
        <FilterField label="Min $"><input className="portal-input" style={{ width: 90 }} type="number" step="0.01" name="min" defaultValue={f.min} /></FilterField>
        <FilterField label="Max $"><input className="portal-input" style={{ width: 90 }} type="number" step="0.01" name="max" defaultValue={f.max} /></FilterField>
        <input type="hidden" name="tab" value={tab} />
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
          <Link href={`/portal/disputes/scanpay/refunds?tab=${tab}`} className="portal-btn">Clear</Link>
        </div>
      </FilterBar>

      <CardShell title={tab === "queue" ? "Needs review" : tab === "verified" ? "Verified — ready to post" : tab === "posted" ? "Posted to ledger" : "Ignored"} subtitle={`${d.rows.length} of ${d.total} entries`}>
        {d.rows.length === 0 ? (
          <Empty message={tab === "queue" ? "Nothing to review. Hit Sync to pull refunded payments from ScanPay." : "Nothing here."} />
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>Payment date</th>
                <th>Invoice</th>
                <th>Tech</th>
                <th>Provider</th>
                <th>Area Manager</th>
                <th className="right">Originally paid</th>
                <th className="right">Collected</th>
                <th>Matched job</th>
                <th className="right">Refunded</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => {
                const best = r.candidates?.[0];
                const en = r.matchedJobId ? d.enrich.get(r.matchedJobId) : undefined;
                return (
                  <tr key={r._id}>
                    <td className="small mono">{fmtDate(r.paymentDate ?? "")}</td>
                    <td>
                      <div className="mono small">{r.invoiceNumber || "—"}</div>
                      <div className="muted small">{r.paymentMethod} · {r.paymentId}</div>
                    </td>
                    <td className="small">{en?.tech ?? "—"}</td>
                    <td className="small">{en?.provider ?? "—"}</td>
                    <td className="small">
                      {en?.areaManager ? en.areaManager : en?.areaManagerMissing ? <span style={{ color: "#f59e0b" }}>⚠ unassigned</span> : "—"}
                    </td>
                    <td className="right money">{fmt$(r.originalAmount)}</td>
                    <td className="right money">{r.computedShare?.jobCollected != null ? fmt$(r.computedShare.jobCollected) : en ? fmt$(en.collected) : "—"}</td>
                    <td>
                      {tab === "posted" ? (
                        <span className="muted small">posted · {r.matchMethod}</span>
                      ) : r.matchedJobId && best ? (
                        <div>
                          <div className="small">{best.address ?? r.matchedJobId}</div>
                          <div className="muted small">
                            {en?.jobStatus && (
                              <span style={{ color: /closed|x close/i.test(en.jobStatus) ? "#34d399" : "#f59e0b", fontWeight: 600 }}>
                                {en.jobStatus}
                              </span>
                            )}
                            {en?.jobStatus ? " · " : ""}{best.method === "invoice" ? "invoice match" : "amount match — verify"} ({best.score})
                          </div>
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
                        chargedAt={r.chargedAt ?? null}
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
