'use client';
// Extracted so recharts loads in a lazy chunk (see stats/page.tsx dynamic import),
// keeping it out of the Stats page's initial JS.
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import EmptyState from '@/components/EmptyState';

export type PieDatum = { name: string; value: number; percent: number; color: string };

export default function DonutCard({
  title, total, data, PieTooltip,
}: {
  title: string;
  total: number;
  data: PieDatum[];
  PieTooltip: React.ComponentType<any>;
}) {
  return (
    <div className="panel chart-card">
      <div className="panel-header">
        <div>
          <p className="stats-section-kicker">Distribution</p>
          <h3>{title}</h3>
        </div>
        <span className="stats-pill">{total} total</span>
      </div>
      <div className="chart-body">
        <div className="pie-shell">
          {data.length ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={56}
                    outerRadius={80}
                    paddingAngle={1.5}
                    animationDuration={650}
                  >
                    {data.map((entry, idx) => (
                      <Cell key={`${entry.name}-${idx}`} fill={entry.color} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} isAnimationActive={false} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center">
                <div className="donut-center-value">{total}</div>
                <div className="donut-center-label">Total</div>
              </div>
            </>
          ) : (
            <EmptyState size="sm" title="No data" />
          )}
        </div>
        <div className="legend">
          {data.map((s, idx) => {
            const tip = `${s.name}: ${s.value} (${s.percent}%)`;
            return (
              <div key={s.name || idx} className="legend-row" title={tip}>
                <span className="dot" style={{ background: s.color }} />
                <span className="label">{s.name || 'Unknown'}</span>
                <span className="muted small">
                  {s.value} ({s.percent}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
