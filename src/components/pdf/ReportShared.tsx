import { Text, View, Svg, Path, G } from '@react-pdf/renderer';
import {
    sharedPdfStyles as s,
    palette,
    kpiAccents,
    statusColor,
    fmtTimestamp,
    type KpiAccent,
} from './sharedPdfStyles';
import { fmtDate } from './sharedPdfStyles';

// ─── Brand header + meta strip ───────────────────────────────────────────────
export const BrandHeader = ({
    reportTitle,
    subject,
    startDate,
    endDate,
    appliedPct,
    rowCount,
}: {
    reportTitle: string;
    subject: string;
    startDate: string;
    endDate: string;
    appliedPct: number;
    rowCount: number;
}) => (
    // `fixed` repeats the navy band + meta strip on every page so the doc
    // always reads as the same official report regardless of where it broke.
    <View fixed>
        <View style={s.brandBand}>
            <View style={s.brandLeft}>
                <Text style={s.brandLogo}>LBS GARAGE DOOR</Text>
                <Text style={s.brandKicker}>Official Balance Report</Text>
            </View>
            <View style={s.brandRight}>
                <Text style={s.reportTitle}>{reportTitle}</Text>
                <Text style={s.reportSubtitle}>Subject: {subject || '—'}</Text>
            </View>
        </View>
        <View style={s.metaStrip}>
            <View style={s.metaPair}>
                <Text style={s.metaLabel}>Range</Text>
                <Text style={s.metaValue}>{fmtDate(startDate)} → {fmtDate(endDate)}</Text>
            </View>
            <View style={s.metaPair}>
                <Text style={s.metaLabel}>Applied %</Text>
                <Text style={s.metaValue}>{Math.round(appliedPct * 10) / 10}%</Text>
                <Text style={[s.metaLabel, { marginLeft: 14 }]}>Closed Jobs</Text>
                <Text style={s.metaValue}>{rowCount}</Text>
            </View>
        </View>
    </View>
);

// ─── Section header (used between major content blocks) ─────────────────────
export const SectionHeader = ({ kicker, title }: { kicker: string; title: string }) => (
    <View style={s.sectionHeader}>
        <View style={s.sectionAccent} />
        <View style={s.sectionTextBlock}>
            <Text style={s.sectionKicker}>{kicker}</Text>
            <Text style={s.sectionTitle}>{title}</Text>
        </View>
    </View>
);

// ─── KPI card ────────────────────────────────────────────────────────────────
export const KpiCard = ({
    label,
    value,
    accent = 'indigo',
    tone,
}: {
    label: string;
    value: string;
    accent?: KpiAccent;
    tone?: 'pos' | 'neg';
}) => (
    <View
        style={[
            s.kpiCard,
            { borderLeftColor: kpiAccents[accent] },
        ] as any}
    >
        <Text style={s.kpiLabel}>{label}</Text>
        <Text
            style={[
                s.kpiValue,
                tone === 'pos' ? s.kpiValuePos : tone === 'neg' ? s.kpiValueNeg : null,
            ].filter(Boolean) as any}
        >
            {value}
        </Text>
    </View>
);

export const KpiGrid = ({ children }: { children: React.ReactNode }) => (
    <View style={s.kpiGrid} wrap={false}>{children}</View>
);

// ─── SVG Pie chart ───────────────────────────────────────────────────────────
// Drawn with react-pdf's SVG primitives (no rasterization, no screenshot).
// Vector → renders crisply at any zoom + prints sharply.
type Slice = { label: string; value: number; color?: string };

const polar = (cx: number, cy: number, r: number, angleRad: number) => ({
    x: cx + r * Math.sin(angleRad),
    y: cy - r * Math.cos(angleRad),
});

const arcPath = (cx: number, cy: number, r: number, startAngle: number, endAngle: number): string => {
    const p1 = polar(cx, cy, r, startAngle);
    const p2 = polar(cx, cy, r, endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y} Z`;
};

export const PieChart = ({
    slices,
    size = 130,
}: {
    slices: Slice[];
    size?: number;
}) => {
    const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
    if (total <= 0) {
        return (
            <View style={[s.pieBox, { width: size, height: size }]}>
                <Text style={s.emptyText}>No data</Text>
            </View>
        );
    }

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 4;
    const innerR = r * 0.55; // donut hole — matches dashboard styling

    // Walk slices; each consumes (value/total) × 2π radians.
    let cursor = 0;
    const paths: { d: string; color: string }[] = [];
    slices.forEach((slice, idx) => {
        if (slice.value <= 0) return;
        const sweep = (slice.value / total) * Math.PI * 2;
        const start = cursor;
        const end = cursor + sweep;
        cursor = end;
        paths.push({ d: arcPath(cx, cy, r, start, end), color: slice.color || statusColor(idx) });
    });

    return (
        <View style={[s.pieBox, { width: size, height: size }]}>
            <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <G>
                    {paths.map((p, i) => (
                        <Path key={i} d={p.d} fill={p.color} stroke={palette.surface} strokeWidth={1} />
                    ))}
                    {/* Center donut hole */}
                    <Path
                        d={`M ${cx - innerR} ${cy} a ${innerR} ${innerR} 0 1 0 ${innerR * 2} 0 a ${innerR} ${innerR} 0 1 0 -${innerR * 2} 0 Z`}
                        fill={palette.slate50}
                    />
                </G>
            </Svg>
        </View>
    );
};

export const PieLegend = ({ slices }: { slices: Slice[] }) => {
    const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
    if (total <= 0) return null;
    return (
        <View style={s.legendBox}>
            {slices.map((slice, idx) => {
                const pct = total > 0 ? Math.round((slice.value / total) * 1000) / 10 : 0;
                const color = slice.color || statusColor(idx);
                return (
                    <View key={`${slice.label}-${idx}`} style={s.legendRow}>
                        <View style={[s.legendDot, { backgroundColor: color }] as any} />
                        <Text style={s.legendLabel}>{slice.label || 'Unknown'}</Text>
                        <Text style={s.legendCount}>{slice.value}</Text>
                        <Text style={s.legendPct}>{pct}%</Text>
                    </View>
                );
            })}
        </View>
    );
};

// ─── Footer ──────────────────────────────────────────────────────────────────
export const ReportFooter = ({ generatedAt }: { generatedAt: string }) => (
    <View style={s.footer} fixed>
        <Text>
            <Text style={s.footerBrand}>LBS Garage Door</Text>
            {' — Generated '}
            {fmtTimestamp(new Date(generatedAt))}
        </Text>
        <Text
            render={({ pageNumber, totalPages }) =>
                `Page ${pageNumber} of ${totalPages}`
            }
        />
    </View>
);

// Tone helper — keeps Balance / Balance + Tips coloring consistent
// across templates. Sign convention (locked 2026-06-08):
//   positive (green) → subject owes the COMPANY
//   negative (red)   → COMPANY owes the subject
export const balanceTone = (n: number): 'pos' | 'neg' | undefined =>
    n > 0 ? 'pos' : n < 0 ? 'neg' : undefined;
