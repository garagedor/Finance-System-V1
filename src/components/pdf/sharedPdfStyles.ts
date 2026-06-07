import { StyleSheet } from '@react-pdf/renderer';

// 317 Garage Door brand palette — mirrors the dashboard
// (src/app/balance-report/styles.css) so the PDF reads as an exported
// snapshot of the dashboard. Style values picked to match the live CSS
// where possible — KPI cards `background: #111827`, card border
// `rgba(255,255,255,0.08)`, snapshot row border `rgba(255,255,255,0.05)`,
// muted text `#94a3b8`, light text `#f1f5f9`, indigo accent `#818cf8`.
export const palette = {
    navy900:    '#0a0f1c',  // dashboard --bg
    navy800:    '#111827',  // dashboard card background
    navy700:    '#1f2937',  // border on cards / slight lift
    navy600:    '#334155',
    ink900:     '#0f172a',
    slate700:   '#334155',
    slate600:   '#475569',
    slate500:   '#64748b',
    slate400:   '#94a3b8',
    slate300:   '#cbd5e1',
    slate200:   '#e2e8f0',
    slate100:   '#f1f5f9',
    slate50:    '#f8fafc',
    surface:    '#ffffff',
    indigo400:  '#818cf8',
    indigo500:  '#6366f1',
    emerald400: '#34d399',
    emerald500: '#10b981',
    red400:     '#f87171',
    red500:     '#ef4444',
    cyan400:    '#22d3ee',
    violet400:  '#a78bfa',
    amber400:   '#fbbf24',
} as const;

export const kpiAccents = {
    indigo:  palette.indigo400,
    cyan:    palette.cyan400,
    emerald: palette.emerald400,
    violet:  palette.violet400,
    amber:   palette.amber400,
    red:     palette.red400,
} as const;
export type KpiAccent = keyof typeof kpiAccents;

export const sharedPdfStyles = StyleSheet.create({
    // ── Page ───────────────────────────────────────────────────────────────
    // Single dark surface like the dashboard. All cards lift slightly with
    // navy800 backgrounds + navy700 borders. No white surfaces anywhere
    // except the (light-text) detail table cells; the goal is a snapshot
    // of the dashboard, not a printed page.
    page: {
        paddingTop: 0,
        paddingBottom: 50,
        paddingHorizontal: 0,
        fontSize: 8.5,
        fontFamily: 'Helvetica',
        color: palette.slate100,
        backgroundColor: palette.navy900,
    },
    body: {
        paddingTop: 14,
        paddingHorizontal: 24,
    },

    // ── Brand header band ──────────────────────────────────────────────────
    brandBand: {
        backgroundColor: palette.navy800,
        paddingVertical: 12,
        paddingHorizontal: 24,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 3,
        borderBottomColor: palette.indigo500,
    },
    brandLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    brandLogoImg: { width: 30, height: 30 },
    brandLogoTextBlock: { flexDirection: 'column' },
    brandLogo: {
        fontSize: 14,
        fontFamily: 'Helvetica-Bold',
        color: palette.surface,
        letterSpacing: 1,
    },
    brandKicker: {
        fontSize: 7,
        color: palette.indigo400,
        textTransform: 'uppercase',
        letterSpacing: 1.4,
        marginTop: 2,
    },
    brandRight: { flexDirection: 'column', alignItems: 'flex-end' },
    reportTitle: {
        fontSize: 13,
        fontFamily: 'Helvetica-Bold',
        color: palette.surface,
    },
    reportSubtitle: {
        fontSize: 9,
        color: palette.slate300,
        marginTop: 3,
    },
    brandSubjectRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginTop: 4,
    },
    brandSubjectLabel: {
        fontSize: 8,
        color: palette.slate400,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    brandSubjectValue: {
        fontSize: 10,
        color: palette.surface,
        fontFamily: 'Helvetica-Bold',
    },

    // ── Meta strip ─────────────────────────────────────────────────────────
    metaStrip: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 7,
        backgroundColor: palette.navy800,
        borderBottomWidth: 0.5,
        borderBottomColor: palette.navy700,
    },
    metaPair:  { flexDirection: 'row', alignItems: 'center', gap: 16 },
    metaLabel: { color: palette.slate400, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
    metaValue: { color: palette.surface, fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginLeft: 4 },

    // ── Section header ─────────────────────────────────────────────────────
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
        marginBottom: 8,
    },
    sectionAccent: {
        width: 3,
        height: 14,
        backgroundColor: palette.indigo400,
        marginRight: 8,
    },
    sectionKicker: {
        fontSize: 7,
        color: palette.indigo400,
        textTransform: 'uppercase',
        letterSpacing: 1.4,
    },
    sectionTitle: {
        fontSize: 11,
        fontFamily: 'Helvetica-Bold',
        color: palette.surface,
        marginTop: 1,
    },
    sectionTextBlock: { flexDirection: 'column' },

    // ── KPI strip cards (top of page 1, matches dashboard BpKpi) ───────────
    // Dashboard uses background #111827, 1px rgba(255,255,255,0.08) border,
    // 14px radius. PDF radius 7 reads similarly at this scale.
    kpiGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    kpiCard: {
        backgroundColor: palette.navy800,
        borderWidth: 0.5,
        borderColor: palette.navy700,
        borderRadius: 7,
        paddingVertical: 12,
        paddingHorizontal: 14,
        minWidth: 140,
        flexGrow: 1,
        flexBasis: '22%',
    },
    kpiHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    kpiIcon: {
        width: 22,
        height: 22,
        borderRadius: 5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    kpiIconDot: { width: 8, height: 8, borderRadius: 4 },
    kpiLabel: {
        fontSize: 7.5,
        color: palette.slate400,
        textTransform: 'uppercase',
        letterSpacing: 1.4,
        fontFamily: 'Helvetica-Bold',
    },
    kpiValue: {
        fontSize: 18,
        fontFamily: 'Helvetica-Bold',
        color: palette.slate100,
        marginTop: 8,
        lineHeight: 1.1,
    },
    kpiValuePos: { color: palette.emerald400 },
    kpiValueNeg: { color: palette.red400 },

    // ── Mid row: pie panel (left) + snapshot card (right) ─────────────────
    midRow: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 4,
    },
    midPanel: {
        flex: 1,
        backgroundColor: palette.navy800,
        borderWidth: 0.5,
        borderColor: palette.navy700,
        borderRadius: 7,
        padding: 14,
    },
    midPanelHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    midPanelTitleBlock: { flexDirection: 'column' },
    midPanelKicker: {
        fontSize: 7,
        color: palette.slate400,
        textTransform: 'uppercase',
        letterSpacing: 1.2,
    },
    midPanelTitle: {
        fontSize: 11,
        fontFamily: 'Helvetica-Bold',
        color: palette.slate100,
        marginTop: 2,
    },
    midPanelPill: {
        backgroundColor: palette.navy700,
        color: palette.slate300,
        fontSize: 7.5,
        fontFamily: 'Helvetica-Bold',
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 999,
    },

    // Pie chart inside the pie panel
    pieRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    pieBox: {
        width: 170,
        height: 170,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pieCenterLabel: {
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
    },
    pieCenterValue: {
        fontSize: 16,
        fontFamily: 'Helvetica-Bold',
        color: palette.slate100,
    },
    pieCenterCaption: {
        fontSize: 7,
        color: palette.slate400,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginTop: 2,
    },
    pieLegendBox: {
        flex: 1,
        flexDirection: 'column',
        gap: 4,
    },
    pieLegendRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        borderBottomWidth: 0.5,
        borderBottomColor: palette.navy700,
    },
    pieLegendDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    pieLegendLabel: {
        fontSize: 9,
        color: palette.slate100,
        flex: 1,
    },
    pieLegendCount: {
        fontSize: 9,
        color: palette.slate400,
        fontFamily: 'Helvetica-Bold',
        marginLeft: 4,
    },
    pieLegendPct: {
        fontSize: 8.5,
        color: palette.slate400,
        marginLeft: 6,
        width: 36,
        textAlign: 'right',
    },

    // Snapshot card (right side of mid row, matches dashboard bp-snapshot)
    snapList: {
        flexDirection: 'column',
        gap: 0,
    },
    snapRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 7,
        borderBottomWidth: 0.5,
        borderBottomColor: palette.navy700,
    },
    snapRowDivider: { height: 6, borderBottomWidth: 0 },
    snapLabel: {
        fontSize: 9,
        color: palette.slate400,
    },
    snapLabelStrong: {
        fontSize: 10,
        color: palette.slate100,
        fontFamily: 'Helvetica-Bold',
    },
    snapValue: {
        fontSize: 10,
        color: palette.slate100,
        fontFamily: 'Helvetica-Bold',
    },
    snapValueStrong: {
        fontSize: 12,
        color: palette.slate100,
        fontFamily: 'Helvetica-Bold',
    },
    snapValuePos: { color: palette.emerald400 },
    snapValueNeg: { color: palette.red400 },
    snapSubRow: { paddingLeft: 16, opacity: 0.75 },
    snapBadge: {
        backgroundColor: palette.navy700,
        color: palette.slate400,
        fontSize: 6.5,
        fontFamily: 'Helvetica-Bold',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: 2,
        marginLeft: 6,
    },

    // ── Detail table (dark, lives on Page 2) ───────────────────────────────
    tableContainer: {
        backgroundColor: palette.navy800,
        borderWidth: 0.5,
        borderColor: palette.navy700,
        borderRadius: 7,
        overflow: 'hidden',
    },
    table: { width: '100%' },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: palette.navy900,
        paddingVertical: 6,
        paddingHorizontal: 3,
        borderBottomWidth: 0.5,
        borderBottomColor: palette.navy700,
    },
    tableHeaderCell: {
        fontFamily: 'Helvetica-Bold',
        fontSize: 7.5,
        color: palette.slate300,
        paddingHorizontal: 3,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: palette.navy700,
        paddingVertical: 4,
        paddingHorizontal: 3,
        backgroundColor: palette.navy800,
    },
    tableRowAlt: { backgroundColor: '#161e30' },
    tableCell: { fontSize: 8, paddingHorizontal: 3, color: palette.slate100 },
    cellMuted: { color: palette.slate500 },
    cellPos:   { color: palette.emerald400, fontFamily: 'Helvetica-Bold' },
    cellNeg:   { color: palette.red400, fontFamily: 'Helvetica-Bold' },

    tableTotals: {
        flexDirection: 'row',
        borderTopWidth: 1.5,
        borderTopColor: palette.indigo500,
        backgroundColor: palette.navy900,
        paddingVertical: 6,
        paddingHorizontal: 3,
    },
    totalsCell: {
        fontFamily: 'Helvetica-Bold',
        fontSize: 8.5,
        paddingHorizontal: 3,
        color: palette.slate100,
    },

    // ── Footer ─────────────────────────────────────────────────────────────
    footer: {
        position: 'absolute',
        left: 24,
        right: 24,
        bottom: 18,
        flexDirection: 'row',
        justifyContent: 'space-between',
        fontSize: 7,
        color: palette.slate500,
        borderTopWidth: 0.5,
        borderTopColor: palette.navy700,
        paddingTop: 6,
    },
    footerBrand: { color: palette.slate300, fontFamily: 'Helvetica-Bold' },

    // ── Empty state ────────────────────────────────────────────────────────
    emptyState: {
        paddingVertical: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.navy800,
    },
    emptyText: { fontSize: 9, color: palette.slate500, fontStyle: 'italic' },
});

export const fmtCurrency = (n: number | undefined | null): string => {
    const v = Number(n ?? 0);
    return v.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
};

export const fmtInt = (n: number | undefined | null): string => {
    const v = Number(n ?? 0);
    return Math.round(v).toLocaleString('en-US');
};

export const fmtPct = (n: number | undefined | null): string => {
    const v = Number(n ?? 0);
    return `${(v).toFixed(1)}%`;
};

export const fmtDate = (iso: string | undefined | null): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
};

export const fmtTimestamp = (d: Date = new Date()): string => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
};

// Deterministic accent assignment for status keys — same wheel as the
// dashboard's `colorForIndex(idx)`.
export const statusColor = (idx: number): string => {
    const wheel = [
        palette.emerald400,
        palette.indigo400,
        palette.cyan400,
        palette.violet400,
        palette.amber400,
        palette.red400,
        '#10b981', '#f472b6', '#fb923c', '#60a5fa',
    ];
    return wheel[idx % wheel.length];
};
