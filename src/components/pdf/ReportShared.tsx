import { Text, View, Svg, Path, G, Image } from '@react-pdf/renderer';
import {
    sharedPdfStyles as s,
    palette,
    kpiAccents,
    statusColor,
    fmtCurrency,
    fmtInt,
    fmtPct,
    fmtTimestamp,
    type KpiAccent,
} from './sharedPdfStyles';
import { fmtDate } from './sharedPdfStyles';

// ─── Brand header + meta strip ───────────────────────────────────────────────
// `logoSrc`: optional data-URL or file path for the company badge. The route
// reads `public/lbs-logo.png` at request time and passes it through; if the
// file isn't there we fall back to the text wordmark alone.
export const BrandHeader = ({
    reportTitle,
    subject,
    startDate,
    endDate,
    appliedPct,
    rowCount,
    logoSrc,
}: {
    reportTitle: string;
    subject: string;
    startDate: string;
    endDate: string;
    appliedPct: number;
    rowCount: number;
    logoSrc?: string | null;
}) => (
    // `fixed` repeats the navy band + meta strip on every page so the doc
    // always reads as the same official report regardless of where it broke.
    <View fixed>
        <View style={s.brandBand}>
            <View style={s.brandLeft}>
                {logoSrc && <Image src={logoSrc} style={s.brandLogoImg} />}
                <View style={s.brandLogoTextBlock}>
                    <Text style={s.brandLogo}>317 GARAGE DOOR</Text>
                    <Text style={s.brandKicker}>Official Balance Report</Text>
                </View>
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

// ─── Hero balance card (page-1 headline numbers) ───────────────────────────
// One card per metric (Balance / Balance + Tips). Headline-size value
// (24pt) so the bottom line answers itself at first glance.
// Sign convention (locked 2026-06-08):
//   positive (green) → subject owes the COMPANY
//   negative (red)   → COMPANY owes the subject
const directionCaption = (mode: 'tech' | 'location', value: number, info: boolean): string => {
    const subject = mode === 'tech' ? 'Tech' : 'Location';
    if (info) return `Informational only · excluded from settlement`;
    if (value > 0) return `${subject} owes the company`;
    if (value < 0) return `Company owes the ${subject.toLowerCase()}`;
    return 'No outstanding settlement';
};

export const HeroBalanceCard = ({
    label,
    value,
    mode,
    info = false,
}: {
    label: string;
    value: number;
    mode: 'tech' | 'location';
    info?: boolean;
}) => {
    const tone = value > 0 ? 'pos' : value < 0 ? 'neg' : undefined;
    const accentColor = tone === 'pos' ? palette.emerald600 : tone === 'neg' ? palette.red600 : palette.indigo500;
    return (
        <View style={[s.heroCard, { borderLeftColor: accentColor }] as any}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={s.heroLabel}>{label}</Text>
                {info && <Text style={s.heroBadge}>Info</Text>}
            </View>
            <Text
                style={[
                    s.heroValue,
                    tone === 'pos' ? s.heroValuePos : tone === 'neg' ? s.heroValueNeg : null,
                ].filter(Boolean) as any}
            >
                {fmtCurrency(value)}
            </Text>
            <Text style={s.heroCaption}>{directionCaption(mode, value, info)}</Text>
        </View>
    );
};

export const HeroBalanceRow = ({
    balance,
    balanceWithTips,
    mode,
}: {
    balance: number;
    balanceWithTips: number;
    mode: 'tech' | 'location';
}) => (
    // `wrap={false}` keeps the two hero cards on the same page — they
    // belong together visually and we always have room for them on
    // landscape page 1.
    <View style={s.heroRow} wrap={false}>
        <HeroBalanceCard label="Balance"        value={balance}         mode={mode} />
        <HeroBalanceCard label="Balance + Tips" value={balanceWithTips} mode={mode} info={mode === 'location'} />
    </View>
);

// ─── Key-figure cards (mid-tier emphasis between hero + KPI strip) ─────────
export const KeyFigureCard = ({
    label,
    value,
    accent = 'indigo',
}: {
    label: string;
    value: string;
    accent?: KpiAccent;
}) => (
    <View style={[s.keyCard, { borderTopColor: kpiAccents[accent] }] as any}>
        <Text style={s.keyLabel}>{label}</Text>
        <Text style={s.keyValue}>{value}</Text>
    </View>
);

export const KeyFigureRow = ({ children }: { children: React.ReactNode }) => (
    <View style={s.keyRow} wrap={false}>{children}</View>
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

// ─── Distribution panel (large donut + colored legend) ─────────────────────
// Centerpiece of Page 2. The donut has a labeled center showing total
// jobs; the legend uses larger type than the page-1 compact pie so it
// can be read at arm's length when printed.
export const DistributionPanel = ({
    slices,
    centerValue,
    centerCaption,
}: {
    slices: { label: string; value: number; color?: string }[];
    centerValue: string;
    centerCaption: string;
}) => {
    const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
    return (
        <View style={s.distPanel} wrap={false}>
            <View style={s.distTopRow}>
                <View style={s.distPieBox}>
                    <BigDonut slices={slices} size={260} />
                    <View style={[s.distCenterLabel, { width: 260, height: 260 }]}>
                        <Text style={s.distCenterValue}>{centerValue}</Text>
                        <Text style={s.distCenterCaption}>{centerCaption}</Text>
                    </View>
                </View>
                <View style={s.distLegendBox}>
                    <Text style={s.distSectionTitle}>Status Breakdown</Text>
                    {slices.map((slice, idx) => {
                        const pct = total > 0 ? (slice.value / total) * 100 : 0;
                        const color = slice.color || statusColor(idx);
                        return (
                            <View key={`${slice.label}-${idx}`} style={s.distLegendRow}>
                                <View style={[s.distLegendDot, { backgroundColor: color }] as any} />
                                <Text style={s.distLegendLabel}>{slice.label || 'Unknown'}</Text>
                                <Text style={s.distLegendCount}>{fmtInt(slice.value)}</Text>
                                <Text style={s.distLegendPct}>{fmtPct(pct)}</Text>
                            </View>
                        );
                    })}
                </View>
            </View>
        </View>
    );
};

// Bigger version of PieChart, used by DistributionPanel. Same SVG math.
const BigDonut = ({ slices, size }: { slices: { label: string; value: number; color?: string }[]; size: number }) => {
    const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
    if (total <= 0) {
        return (
            <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <Path
                    d={`M ${size / 2 - size / 2 + 4} ${size / 2} a ${size / 2 - 4} ${size / 2 - 4} 0 1 0 ${(size / 2 - 4) * 2} 0 a ${size / 2 - 4} ${size / 2 - 4} 0 1 0 -${(size / 2 - 4) * 2} 0 Z`}
                    fill={palette.slate100}
                />
            </Svg>
        );
    }
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 6;
    const innerR = r * 0.62;
    let cursor = 0;
    const segs: { d: string; color: string }[] = [];
    slices.forEach((slice, idx) => {
        if (slice.value <= 0) return;
        const sweep = (slice.value / total) * Math.PI * 2;
        const a = cursor;
        const b = cursor + sweep;
        cursor = b;
        const p1 = polar(cx, cy, r, a);
        const p2 = polar(cx, cy, r, b);
        const largeArc = b - a > Math.PI ? 1 : 0;
        const d = `M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y} Z`;
        segs.push({ d, color: slice.color || statusColor(idx) });
    });
    return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <G>
                {segs.map((p, i) => (
                    <Path key={i} d={p.d} fill={p.color} stroke={palette.surface} strokeWidth={1.5} />
                ))}
                <Path
                    d={`M ${cx - innerR} ${cy} a ${innerR} ${innerR} 0 1 0 ${innerR * 2} 0 a ${innerR} ${innerR} 0 1 0 -${innerR * 2} 0 Z`}
                    fill={palette.surface}
                />
            </G>
        </Svg>
    );
};

// ─── Horizontal bar chart row ─────────────────────────────────────────────
// Used on the Distribution page to give a second visual on top of the
// donut. Bar fills proportional to `value / max`, so the longest bar
// always reaches full width and the relative ranking is unambiguous.
export const HorizontalBars = ({
    rows,
    max,
}: {
    rows: { label: string; value: number; color?: string; valueLabel?: string }[];
    max?: number;
}) => {
    const ceiling = max ?? Math.max(1, ...rows.map((r) => r.value));
    return (
        <View style={s.barChartGroup}>
            {rows.map((r, idx) => {
                const pct = ceiling > 0 ? Math.min(100, (r.value / ceiling) * 100) : 0;
                const color = r.color || statusColor(idx);
                return (
                    <View key={`${r.label}-${idx}`} style={s.barRow}>
                        <Text style={s.barLabel}>{r.label}</Text>
                        <View style={s.barTrack}>
                            <View style={[s.barFill, { width: `${pct}%`, backgroundColor: color }] as any} />
                        </View>
                        <Text style={s.barValue}>{r.valueLabel ?? fmtInt(r.value)}</Text>
                    </View>
                );
            })}
        </View>
    );
};

// Closed-rate KPI strip — three large stat cards under the bar chart.
export const ConversionStats = ({
    closedCount,
    openCount,
    lostCount,
    totalCount,
}: {
    closedCount: number;
    openCount: number;
    lostCount: number;
    totalCount: number;
}) => {
    const rate = totalCount > 0 ? (closedCount / totalCount) * 100 : 0;
    return (
        <View style={s.closedRateRow}>
            <View style={s.closedRateCard}>
                <Text style={s.closedRateLabel}>Closed Rate</Text>
                <Text style={[s.closedRateValue, { color: palette.emerald600 }]}>{fmtPct(rate)}</Text>
            </View>
            <View style={s.closedRateCard}>
                <Text style={s.closedRateLabel}>Open Jobs</Text>
                <Text style={s.closedRateValue}>{fmtInt(openCount)}</Text>
            </View>
            <View style={s.closedRateCard}>
                <Text style={s.closedRateLabel}>Lost Jobs</Text>
                <Text style={[s.closedRateValue, { color: palette.red600 }]}>{fmtInt(lostCount)}</Text>
            </View>
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
