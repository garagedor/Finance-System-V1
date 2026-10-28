'use client';

// Several technicians' Balance Reports on one page — one section per tech,
// one after another, plus a combined total. Each section reads the SAME
// /api/balance-report the single-tech view uses, so every number matches it.

import { useEffect, useState } from 'react';
import { formatCurrency, formatDisplayDate } from '../utils/jobUtils';
import { LoadingOverlay } from '@/components/LoadingOverlay';

type Row = {
  id: string;
  date: string;
  address: string;
  status: string;
  paymentMethod: string;
  paidSum: number;
  techParts: number;
  companyParts: number;
  lmParts: number;
  paymentFee: number;
  lmCheckFee: number;
  totalProfit: number;
  shareAmount: number;
  techPaidCash: number;
  tipsTotal: number;
  balance: number;
  balanceWithTips: number;
};

type TechReport = {
  tech: string;
  location: string;
  appliedPct: number;
  rows: Row[];
  error?: string;
};

type Sums = { paid: number; profit: number; share: number; cash: number; tips: number; balance: number; balanceWithTips: number };

const sumRows = (rows: Row[]): Sums =>
  rows.reduce<Sums>(
    (s, r) => ({
      paid: s.paid + (r.paidSum || 0),
      profit: s.profit + (r.totalProfit || 0),
      share: s.share + (r.shareAmount || 0),
      cash: s.cash + (r.techPaidCash || 0),
      tips: s.tips + (r.tipsTotal || 0),
      balance: s.balance + (r.balance || 0),
      balanceWithTips: s.balanceWithTips + (r.balanceWithTips || 0),
    }),
    { paid: 0, profit: 0, share: 0, cash: 0, tips: 0, balance: 0, balanceWithTips: 0 },
  );

// Balance sign (calculations.ts, locked 2026-06-08):
//   positive → the subject owes the company · negative → the company owes the subject.
const direction = (balance: number, subject: string) =>
  Math.abs(balance) < 0.005 ? 'Settled' : balance > 0 ? `${subject} owes company` : `Company owes ${subject}`;

export default function MultiTechReports({
  techs,
  start,
  end,
  mode,
  locationOf,
  onOpen,
}: {
  techs: string[];
  start: string;
  end: string;
  mode: 'tech' | 'location';
  locationOf: (tech: string) => string;
  onOpen: (tech: string) => void;
}) {
  const [reports, setReports] = useState<TechReport[]>([]);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify({ techs, start, end, mode });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      // A few at a time — keeps the page quick without flooding the API.
      const out: TechReport[] = new Array(techs.length);
      let next = 0;
      const worker = async () => {
        while (next < techs.length) {
          const i = next++;
          const tech = techs[i];
          const location = locationOf(tech);
          try {
            const q = new URLSearchParams({ startDate: start, endDate: end, tech, mode });
            const res = await fetch(`/api/balance-report?${q.toString()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const rows = ((data.rows ?? []) as Row[]).filter((r) => (r.status || '') === 'Closed');
            out[i] = { tech, location, appliedPct: Number(data.appliedPct) || 0, rows };
          } catch (err) {
            out[i] = { tech, location, appliedPct: 0, rows: [], error: err instanceof Error ? err.message : 'Failed' };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, techs.length) }, worker));
      if (alive) {
        setReports(out);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const subjectOf = (r: TechReport) => (mode === 'location' ? r.location || r.tech : r.tech);
  const all = sumRows(reports.flatMap((r) => r.rows));

  return (
    <div className="bp-multi">
      {loading && <LoadingOverlay message={`Loading ${techs.length} reports…`} />}

      {/* Combined total across every selected technician */}
      <div className="panel animate-fade-up">
        <div className="panel-header">
          <div>
            <p className="bp-section-kicker">All selected</p>
            <h3>{techs.length} {mode === 'tech' ? 'technicians' : 'location reports'}</h3>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="bp-multi-table">
            <thead>
              <tr>
                <th>Technician</th>
                <th>Location</th>
                <th>%</th>
                <th>Closed</th>
                <th>Total Paid</th>
                <th>Total Profit</th>
                <th>{mode === 'tech' ? 'Tech Payout' : 'LM Share'}</th>
                <th>Balance</th>
                <th>Balance + Tips</th>
                <th>Direction</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const s = sumRows(r.rows);
                return (
                  <tr key={r.tech}>
                    <td>
                      <button type="button" className="bp-multi-link" onClick={() => onOpen(r.tech)} title="Open this technician's full report">
                        {r.tech}
                      </button>
                    </td>
                    <td>{r.location || '—'}</td>
                    <td>{r.appliedPct}%</td>
                    <td>{r.error ? 'error' : r.rows.length}</td>
                    <td>{formatCurrency(s.paid)}</td>
                    <td>{formatCurrency(s.profit)}</td>
                    <td>{formatCurrency(s.share)}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(s.balance)}</td>
                    <td>{formatCurrency(s.balanceWithTips)}</td>
                    <td>{direction(s.balance, subjectOf(r))}</td>
                  </tr>
                );
              })}
            </tbody>
            {reports.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  <td>{reports.reduce((n, r) => n + r.rows.length, 0)}</td>
                  <td>{formatCurrency(all.paid)}</td>
                  <td>{formatCurrency(all.profit)}</td>
                  <td>{formatCurrency(all.share)}</td>
                  <td>{formatCurrency(all.balance)}</td>
                  <td>{formatCurrency(all.balanceWithTips)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* One section per technician */}
      {reports.map((r) => {
        const s = sumRows(r.rows);
        return (
          <div key={r.tech} className="panel bp-table-panel animate-fade-up">
            <div className="panel-header">
              <div>
                <p className="bp-section-kicker">
                  {mode === 'tech' ? 'Tech Report' : 'Location Report'} · {r.location || '—'} · {r.appliedPct}%
                </p>
                <h3>{r.tech}</h3>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="bp-pill">{r.rows.length} closed</span>
                <span className="bp-pill">
                  Balance <strong>{formatCurrency(s.balance)}</strong> · {direction(s.balance, subjectOf(r))}
                </span>
                <button type="button" className="bp-pill bp-multi-link" onClick={() => onOpen(r.tech)}>
                  Open full report
                </button>
              </div>
            </div>
            {r.error ? (
              <p style={{ padding: 12 }}>Could not load this report ({r.error}).</p>
            ) : r.rows.length === 0 ? (
              <p style={{ padding: 12 }}>No closed jobs in this range.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="bp-multi-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Address</th>
                      <th>Payment</th>
                      <th>Job Total</th>
                      <th>Parts</th>
                      <th>Fee</th>
                      <th>Total Profit</th>
                      <th>{mode === 'tech' ? 'Tech Share' : 'LM Share'}</th>
                      <th>Cash</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((j) => (
                      <tr key={j.id}>
                        <td>{formatDisplayDate(j.date)}</td>
                        <td>{j.address}</td>
                        <td>{j.paymentMethod}</td>
                        <td>{formatCurrency(j.paidSum)}</td>
                        <td>{formatCurrency((j.techParts || 0) + (j.companyParts || 0) + (j.lmParts || 0))}</td>
                        <td>{formatCurrency(j.paymentFee)}</td>
                        <td>{formatCurrency(j.totalProfit)}</td>
                        <td>{formatCurrency(j.shareAmount)}</td>
                        <td>{formatCurrency(j.techPaidCash)}</td>
                        <td style={{ fontWeight: j.balance !== 0 ? 600 : undefined }}>{formatCurrency(j.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Total</td>
                      <td>{formatCurrency(s.paid)}</td>
                      <td colSpan={2} />
                      <td>{formatCurrency(s.profit)}</td>
                      <td>{formatCurrency(s.share)}</td>
                      <td>{formatCurrency(s.cash)}</td>
                      <td>{formatCurrency(s.balance)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
