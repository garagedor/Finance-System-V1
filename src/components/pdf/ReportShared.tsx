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
    fmtDate,
    type KpiAccent,
} from './sharedPdfStyles';

// ─── Brand header + meta strip ───────────────────────────────────────────────
// `logoSrc`: data-URL or file path for the company badge. The route reads
// public/lbs-logo.png at request time and passes it through.
//
// The header surfaces BOTH `locationName` and `techName` regardless of mode
// — a Location Report is still filtered by a single tech and the reader
// needs to see whose numbers they're looking at without re-opening the CRM.
export const BrandHeader = ({
    reportTitle,
    techName,
    locationName,
    startDate,
    endDate,
    appliedPct,
    rowCount,
    logoSrc,
}: {
    reportTitle: string;
    techName: string;
    locationName: string;
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
                <View style={s.brandSubjectRow}>
                    <Text style={s.brandSubjectLabel}>Location: </Text>
                    <Text style={s.brandSubjectValue}>{locationName || '—'}</Text>
                    <Text style={[s.brandSubjectLabel, { marginLeft: 12 }]}>Technician: </Text>
                    <Text style={s.brandSubjectValue}>{techName || '—'}</Text>
                </View>
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

// ─── Section header (indigo accent + kicker/title) ──────────────────────────
export const SectionHeader = ({ kicker, title }: { kicker: string; title: string }) => (
    <View style={s.sectionHeader}>
        <View style={s.sectionAccent} />
        <View style={s.sectionTextBlock}>
            <Text style={s.sectionKicker}>{kicker}</Text>
            <Text style={s.sectionTitle}>{title}</Text>
        </View>
    </View>
);

// ─── KPI strip card (matches dashboard BpKpi) ───────────────────────────────
// Dashboard reference: navy800 bg, ~14px radius, colored 22×22 icon tile on
// the left with the accent hue, label uppercase letter-spaced 0.16em,
// value 22px bold. PDF can't render the radial-gradient glow, but the
// solid accent tile + value give the same scanning pattern.
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
    <View style={s.kpiCard}>
        <View style={s.kpiHeadRow}>
            <View
                style={[
                    s.kpiIcon,
                    { backgroundColor: hexWithAlpha(kpiAccents[accent], 0.18) },
                ] as any}
            >
                <View style={[s.kpiIconDot, { backgroundColor: kpiAccents[accent] }] as any} />
            </View>
            <Text style={s.kpiLabel}>{label}</Text>
        </View>
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
    <View style={s.kpiGrid}>{children}</View>
);

// ─── Mid-row layout (pie left, snapshot right) ──────────────────────────────
export const MidRow = ({ children }: { children: React.ReactNode }) => (
    <View style={s.midRow} wrap={false}>{children}</View>
);

// ─── Pie/Donut panel — matches dashboard "Jobs by Status" card ──────────────
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

const Donut = ({ slices, size }: { slices: Slice[]; size: number }) => {
    const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 4;
    const innerR = r * 0.6;

    if (total <= 0) {
        return (
            <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <Path
                    d={`M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 -${r * 2} 0 Z`}
                    fill={palette.navy700}
                />
            </Svg>
        );
    }

    let cursor = 0;
    const paths: { d: string; color: string }[] = [];
    slices.forEach((slice, idx) => {
        if (slice.value <= 0) return;
        const sweep = (slice.value / total) * Math.PI * 2;
        paths.push({
            d: arcPath(cx, cy, r, cursor, cursor + sweep),
            color: slice.color || statusColor(idx),
        });
        cursor += sweep;
    });

    return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <G>
                {paths.map((p, i) => (
                    <Path key={i} d={p.d} fill={p.color} stroke={palette.navy800} strokeWidth={1.5} />
                ))}
                {/* Donut hole filled with the card bg so it reads as a ring */}
                <Path
                    d={`M ${cx - innerR} ${cy} a ${innerR} ${innerR} 0 1 0 ${innerR * 2} 0 a ${innerR} ${innerR} 0 1 0 -${innerR * 2} 0 Z`}
                    fill={palette.navy800}
                />
            </G>
        </Svg>
    );
};

export const PiePanel = ({
    slices,
    totalLabel = 'Total Jobs',
}: {
    slices: Slice[];
    totalLabel?: string;
}) => {
    const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
    return (
        <View style={s.midPanel}>
            <View style={s.midPanelHeader}>
                <View style={s.midPanelTitleBlock}>
                    <Text style={s.midPanelKicker}>Distribution</Text>
                    <Text style={s.midPanelTitle}>Jobs by Status</Text>
                </View>
                <Text style={s.midPanelPill}>{fmtInt(total)} total</Text>
            </View>
            <View style={s.pieRow}>
                <View style={s.pieBox}>
                    <Donut slices={slices} size={170} />
                    <View style={[s.pieCenterLabel, { width: 170, height: 170 }]}>
                        <Text style={s.pieCenterValue}>{fmtInt(total)}</Text>
                        <Text style={s.pieCenterCaption}>{totalLabel}</Text>
                    </View>
                </View>
                <View style={s.pieLegendBox}>
                    {slices.map((slice, idx) => {
                        const pct = total > 0 ? (slice.value / total) * 100 : 0;
                        const color = slice.color || statusColor(idx);
                        return (
                            <View key={`${slice.label}-${idx}`} style={s.pieLegendRow}>
                                <View style={[s.pieLegendDot, { backgroundColor: color }] as any} />
                                <Text style={s.pieLegendLabel}>{slice.label || 'Unknown'}</Text>
                                <Text style={s.pieLegendCount}>{fmtInt(slice.value)}</Text>
                                <Text style={s.pieLegendPct}>{fmtPct(pct)}</Text>
                            </View>
                        );
                    })}
                </View>
            </View>
        </View>
    );
};

// ─── Snapshot card (right side of mid-row, matches dashboard bp-snapshot) ──
export type SnapshotEntry = {
    label: string;
    value: number;
    /** 'normal' = label muted + value bold; 'strong' = both bolder + larger */
    weight?: 'normal' | 'strong';
    /** 'pos' / 'neg' tone for the value */
    tone?: 'pos' | 'neg' | 'auto';
    /** Indent the row so it reads as a sub-line under another total */
    sub?: boolean;
    /** Small uppercase badge to the right of the label (e.g. INFO) */
    badge?: string;
};

const SnapshotRow = ({ entry }: { entry: SnapshotEntry }) => {
    const isStrong = entry.weight === 'strong';
    let toneStyle: any = null;
    if (entry.tone === 'pos' || (entry.tone === 'auto' && entry.value > 0)) toneStyle = s.snapValuePos;
    else if (entry.tone === 'neg' || (entry.tone === 'auto' && entry.value < 0)) toneStyle = s.snapValueNeg;

    return (
        <View style={[s.snapRow, entry.sub ? s.snapSubRow : null].filter(Boolean) as any}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={isStrong ? s.snapLabelStrong : s.snapLabel}>
                    {entry.sub ? '↳ ' : ''}{entry.label}
                </Text>
                {entry.badge && <Text style={s.snapBadge}>{entry.badge}</Text>}
            </View>
            <Text style={[isStrong ? s.snapValueStrong : s.snapValue, toneStyle].filter(Boolean) as any}>
                {fmtCurrency(entry.value)}
            </Text>
        </View>
    );
};

export const SnapshotCard = ({
    title,
    kicker = 'Closed Jobs',
    pill,
    entries,
}: {
    title: string;
    kicker?: string;
    pill?: string;
    entries: (SnapshotEntry | 'divider')[];
}) => (
    <View style={s.midPanel}>
        <View style={s.midPanelHeader}>
            <View style={s.midPanelTitleBlock}>
                <Text style={s.midPanelKicker}>{kicker}</Text>
                <Text style={s.midPanelTitle}>{title}</Text>
            </View>
            {pill && <Text style={s.midPanelPill}>{pill}</Text>}
        </View>
        <View style={s.snapList}>
            {entries.map((entry, idx) =>
                entry === 'divider'
                    ? <View key={`div-${idx}`} style={[s.snapRow, s.snapRowDivider]} />
                    : <SnapshotRow key={`${entry.label}-${idx}`} entry={entry} />
            )}
        </View>
    </View>
);

// ─── Footer ──────────────────────────────────────────────────────────────────
export const ReportFooter = ({ generatedAt }: { generatedAt: string }) => (
    <View style={s.footer} fixed>
        <Text>
            <Text style={s.footerBrand}>317 Garage Door</Text>
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

// Sign-convention tone helper used by templates.
// positive (green) → subject owes the COMPANY; negative (red) → company owes.
export const balanceTone = (n: number): 'pos' | 'neg' | undefined =>
    n > 0 ? 'pos' : n < 0 ? 'neg' : undefined;

// ─── Local helpers ──────────────────────────────────────────────────────────
// Tint a hex color toward transparency by mixing with the dark page bg.
// React-PDF doesn't render alpha channels in solid backgrounds reliably,
// so we approximate `rgba(accent, alpha)` over the dark surface by alpha-
// blending the hex against navy800 numerically. Output is a solid hex.
function hexWithAlpha(hex: string, alpha: number): string {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    const r = parseInt(m[1], 16);
    const g = parseInt(m[2], 16);
    const b = parseInt(m[3], 16);
    // navy800 = #111827 → (17, 24, 39)
    const bgR = 17, bgG = 24, bgB = 39;
    const mix = (c: number, bgC: number) => Math.round(c * alpha + bgC * (1 - alpha));
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(mix(r, bgR))}${toHex(mix(g, bgG))}${toHex(mix(b, bgB))}`;
}
