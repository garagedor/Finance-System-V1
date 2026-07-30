'use client';
// Extracted so recharts loads lazily (browser-only, off the balance-report bundle).
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

export default function StatusPieChart({
  data, PieTooltip,
}: {
  data: Array<{ name: string; value: number; color: string }>;
  PieTooltip: React.ComponentType<any>;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={80}
          paddingAngle={1}
          animationDuration={650}
        >
          {data.map((entry, idx) => (
            <Cell key={`${entry.name}-${idx}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip content={<PieTooltip />} isAnimationActive={false} />
      </PieChart>
    </ResponsiveContainer>
  );
}
