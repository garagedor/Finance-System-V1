import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { readSession, hasPermission } from "@/lib/rbac";
import type { PayoutRecord } from "@/types/finance";
import { fmt$, fmtDate } from "@/app/portal/format";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

const COMPANY = "LBS Garage Door";

export default async function PayoutStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await readSession();
  if (!hasPermission(session, "finance:payouts:view")) {
    return <div style={{ padding: 40, fontFamily: "system-ui, sans-serif", color: "#111" }}>Please sign in to the portal to view this statement.</div>;
  }
  await ensureFinanceIndexes();
  const p = await coll<PayoutRecord>(FINANCE_COLLECTIONS.payout).findOne({ _id: id });
  if (!p) return <div style={{ padding: 40, fontFamily: "system-ui, sans-serif", color: "#111" }}>Payout not found.</div>;

  const period = `${fmtDate(p.period_start)} — ${fmtDate(p.period_end)}`;

  return (
    <div className="ps-root">
      <style>{CSS}</style>

      <div className="ps-toolbar">
        <PrintButton />
      </div>

      <div className="ps-sheet">
        <header className="ps-head">
          <div>
            <div className="ps-brand">{COMPANY}</div>
            <div className="ps-sub">Payout Statement</div>
          </div>
          <div className="ps-meta">
            <div><span>Statement</span> {p._id}</div>
            <div><span>Issued</span> {fmtDate(new Date().toISOString())}</div>
          </div>
        </header>

        <section className="ps-parties">
          <div>
            <div className="ps-label">Recipient</div>
            <div className="ps-recip">{p.recipient_name}</div>
            {p.recipient_role && <div className="ps-role">{p.recipient_role}</div>}
          </div>
          <div className="ps-right">
            <div><span className="ps-label">Period</span><div>{period}</div></div>
            <div style={{ marginTop: 8 }}>
              <span className="ps-label">Status</span>
              <div className={`ps-status ${p.status === "paid" ? "paid" : "unpaid"}`}>
                {p.status === "paid" ? `PAID${p.paid_at ? ` · ${fmtDate(p.paid_at)}` : ""}` : "UNPAID"}
              </div>
            </div>
          </div>
        </section>

        <table className="ps-table">
          <thead>
            <tr><th>Description</th><th className="r">Amount</th></tr>
          </thead>
          <tbody>
            {p.line_items.map((it) => (
              <tr key={it.id}>
                <td>
                  <span className="ps-kind">{it.kind.replace(/_/g, " ")}</span>
                  {it.label && it.label !== it.kind ? <span className="ps-itemlabel"> · {it.label}</span> : null}
                </td>
                <td className={`r ${it.amount < 0 ? "neg" : ""}`}>{fmt$(it.amount, { showSign: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ps-totals">
          <div className="row"><span>Gross</span><span>{fmt$(p.gross)}</span></div>
          <div className="row"><span>Deductions</span><span className="neg">−{fmt$(p.deductions)}</span></div>
          <div className="row net"><span>Net pay</span><span>{fmt$(p.net)}</span></div>
        </div>

        <section className="ps-footmeta">
          {p.payment_method && <div><span className="ps-label">Paid via</span> {p.payment_method}</div>}
          {p.notes && <div className="ps-notes"><span className="ps-label">Notes</span> {p.notes}</div>}
        </section>

        <section className="ps-sign">
          <div className="ps-sigline">
            <div className="line" /> <span>Recipient signature</span>
          </div>
          <div className="ps-sigline">
            <div className="line" /> <span>Date</span>
          </div>
        </section>

        <footer className="ps-footer">
          {COMPANY} · This statement summarizes the payout above. Generated {fmtDate(new Date().toISOString())}.
        </footer>
      </div>
    </div>
  );
}

const CSS = `
.ps-root { min-height: 100vh; background: #6b7280; padding: 24px; font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; color: #111827; }
.ps-toolbar { max-width: 720px; margin: 0 auto 14px; display: flex; justify-content: flex-end; }
.ps-print-btn { background: #4f46e5; color: #fff; border: 0; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
.ps-print-btn:hover { background: #4338ca; }
.ps-sheet { max-width: 720px; margin: 0 auto; background: #fff; border-radius: 6px; padding: 44px 48px; box-shadow: 0 10px 40px rgba(0,0,0,0.25); }
.ps-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 16px; }
.ps-brand { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.ps-sub { font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b7280; margin-top: 2px; }
.ps-meta { text-align: right; font-size: 11.5px; color: #374151; }
.ps-meta span { color: #9ca3af; display: inline-block; min-width: 58px; text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px; }
.ps-parties { display: flex; justify-content: space-between; gap: 24px; margin: 22px 0 8px; }
.ps-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 2px; }
.ps-recip { font-size: 17px; font-weight: 700; }
.ps-role { font-size: 13px; color: #6b7280; }
.ps-right { text-align: right; }
.ps-status { font-weight: 700; font-size: 13px; }
.ps-status.paid { color: #047857; }
.ps-status.unpaid { color: #b45309; }
.ps-table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13.5px; }
.ps-table thead th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; border-bottom: 1px solid #e5e7eb; padding: 8px 6px; }
.ps-table th.r, .ps-table td.r { text-align: right; }
.ps-table tbody td { padding: 9px 6px; border-bottom: 1px solid #f3f4f6; }
.ps-kind { text-transform: capitalize; font-weight: 600; }
.ps-itemlabel { color: #6b7280; }
.ps-table td.neg, .neg { color: #b91c1c; }
.ps-totals { margin: 14px 0 0; margin-left: auto; width: 260px; font-size: 13.5px; }
.ps-totals .row { display: flex; justify-content: space-between; padding: 5px 6px; }
.ps-totals .row span:first-child { color: #6b7280; }
.ps-totals .net { border-top: 2px solid #111827; margin-top: 4px; padding-top: 9px; font-size: 17px; font-weight: 800; }
.ps-totals .net span:first-child { color: #111827; }
.ps-footmeta { margin-top: 26px; font-size: 12.5px; color: #374151; display: grid; gap: 8px; }
.ps-notes { color: #4b5563; }
.ps-sign { display: flex; gap: 40px; margin-top: 48px; }
.ps-sigline { flex: 1; }
.ps-sigline .line { border-bottom: 1px solid #9ca3af; height: 28px; }
.ps-sigline span { font-size: 11px; color: #9ca3af; }
.ps-footer { margin-top: 34px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10.5px; color: #9ca3af; text-align: center; }
@media print {
  .ps-root { background: #fff; padding: 0; }
  .ps-toolbar { display: none; }
  .ps-sheet { box-shadow: none; border-radius: 0; max-width: none; padding: 0; }
  @page { margin: 18mm; }
}
`;
