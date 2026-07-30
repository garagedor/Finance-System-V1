'use client';
// Extracted so recharts loads lazily (browser-only, off the AI chat panel bundle).
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";

const colors = ["#818cf8", "#34d399", "#f59e0b", "#f472b6"];

type ChartBlock = {
  chartType?: "bar" | "line" | string;
  data?: any[];
  xKey?: string;
  series: Array<{ key: string; label?: string }>;
};

export default function ChatChart({ b }: { b: ChartBlock }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {b.chartType === "bar" ? (
        <BarChart data={b.data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey={b.xKey} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
          <RTooltip contentStyle={{ background: "#1a2236", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }} />
          {b.series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} />)}
        </BarChart>
      ) : (
        <LineChart data={b.data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey={b.xKey} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
          <RTooltip contentStyle={{ background: "#1a2236", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }} />
          {b.series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colors[i % colors.length]} dot={false} strokeWidth={2} />)}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}
