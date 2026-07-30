'use client';
// Extracted so recharts loads lazily (browser-only, off the payment-method bundle).
// Tooltips + METHODS are passed in as props so the page keeps its own definitions.
import {
  PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';

export function PiePmrChart({
  data, Tooltip,
}: {
  data: Array<{ name: string; value: number; color: string }>;
  Tooltip: React.ComponentType<any>;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={1}>
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Pie>
        <RTooltip content={<Tooltip />} isAnimationActive={false} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function BarPmrChart({
  data, methods, Tooltip,
}: {
  data: any[];
  methods: ReadonlyArray<{ key: string; color: string; label: string }>;
  Tooltip: React.ComponentType<any>;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 6, right: 12, bottom: 6, left: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
        <RTooltip content={<Tooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
        {methods.map((m) => (
          <Bar key={m.key} dataKey={m.key} stackId="a" fill={m.color} name={m.label} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
