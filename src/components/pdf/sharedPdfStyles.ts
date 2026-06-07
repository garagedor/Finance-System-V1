import { StyleSheet } from '@react-pdf/renderer';

// LBS Garage Door brand palette — mirrors the dashboard
// (src/app/balance-report/styles.css) so the PDF feels like an official
// document exported from the system, not a generic white report.
//   navy900 — dashboard `--bg`                                   (#0a0f1c)
//   navy800 — chip / muted card background                      (#111827)
//   ink900 — primary text on light surfaces                     (#0f172a)
//   slate500 — muted body text                                  (#64748b)
//   slate400 — even more muted (labels)                         (#94a3b8)
//   slate300 — divider lines                                    (#cbd5e1)
//   slate100 — alt-row background                               (#f1f5f9)
//   slate50 — page background                                   (#fafbfd)
//   indigo400 — primary accent (matches dashboard kicker)       (#818cf8)
//   emerald400 — positive money / "company owed money"          (#34d399)
//   red400 — negative money / "company owes"                    (#f87171)
//   cyan400 — secondary accent                                  (#22d3ee)
//   violet400 — tertiary accent                                 (#a78bfa)
//   amber400 — warning accent                                   (#fbbf24)
export const palette = {
    navy900:    '#0a0f1c',
    navy800:    '#111827',
    ink900:     '#0f172a',
    slate700:   '#334155',
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
    emerald600: '#059669',
    red400:     '#f87171',
    red600:     '#dc2626',
    cyan400:    '#22d3ee',
    violet400:  '#a78bfa',
    amber400:   '#fbbf24',
} as const;

// Accent strip color per KPI — keeps the same hues as the dashboard's
// `BpKpi` accent prop so a tech / LM viewing the PDF sees familiar coding.
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
    page: {
        paddingTop: 0,
        paddingBottom: 50,
        paddingHorizontal: 0,
        fontSize: 8.5,
        fontFamily: 'Helvetica',
        color: palette.ink900,
        backgroundColor: palette.slate50,
    },
    body: {
        paddingTop: 14,
        paddingHorizontal: 28,
    },
    bodyTight: {
        paddingTop: 12,
        paddingHorizontal: 28,
    },

    // ── Brand header band (navy) ───────────────────────────────────────────
    brandBand: {
        backgroundColor: palette.navy900,
        paddingVertical: 14,
        paddingHorizontal: 24,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 3,
        borderBottomColor: palette.indigo400,
    },
    brandLeft: { flexDirection: 'column' },
    brandLogo: {
        fontSize: 16,
        fontFamily: 'Helvetica-Bold',
        color: palette.surface,
        letterSpacing: 1,
    },
    brandKicker: {
        fontSize: 8,
        color: palette.indigo400,
        textTransform: 'uppercase',
        letterSpacing: 1.2,
        marginTop: 2,
    },
    brandRight: { flexDirection: 'column', alignItems: 'flex-end' },
    reportTitle: {
        fontSize: 14,
        fontFamily: 'Helvetica-Bold',
        color: palette.surface,
    },
    reportSubtitle: {
        fontSize: 9,
        color: palette.slate300,
        marginTop: 3,
    },

    // ── Meta strip (under header band) ─────────────────────────────────────
    metaStrip: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 8,
        backgroundColor: palette.navy800,
        color: palette.slate300,
    },
    metaPair:  { flexDirection: 'row', alignItems: 'center', gap: 16 },
    metaLabel: { color: palette.slate400, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
    metaValue: { color: palette.surface, fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginLeft: 4 },

    // ── Section header ─────────────────────────────────────────────────────
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 18,
        marginBottom: 8,
    },
    sectionAccent: {
        width: 3,
        height: 14,
        backgroundColor: palette.indigo500,
        marginRight: 8,
    },
    sectionKicker: {
        fontSize: 7.5,
        color: palette.slate500,
        textTransform: 'uppercase',
        letterSpacing: 1.4,
    },
    sectionTitle: {
        fontSize: 11.5,
        fontFamily: 'Helvetica-Bold',
        color: palette.ink900,
        marginTop: 1,
    },
    sectionTextBlock: { flexDirection: 'column' },

    // ── Hero balance section ───────────────────────────────────────────────
    // Two oversized cards on page 1 for Balance + Balance + Tips. Wide
    // left-edge accent strip, generous padding, headline-size number.
    // The point is that a glance at page 1 immediately answers "what's
    // the bottom line?" — same role as a CFO email subject line.
    heroRow: {
        flexDirection: 'row',
        gap: 12,
    },
    heroCard: {
        flex: 1,
        backgroundColor: palette.surface,
        borderWidth: 0.5,
        borderColor: palette.slate200,
        borderLeftWidth: 5,
        borderRadius: 4,
        paddingVertical: 16,
        paddingHorizontal: 18,
        minHeight: 92,
    },
    heroLabel: {
        fontSize: 8.5,
        color: palette.slate500,
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontFamily: 'Helvetica-Bold',
    },
    heroValue: {
        fontSize: 24,
        fontFamily: 'Helvetica-Bold',
        color: palette.ink900,
        marginTop: 8,
        lineHeight: 1.1,
    },
    heroValuePos: { color: palette.emerald600 },
    heroValueNeg: { color: palette.red600 },
    heroCaption: {
        fontSize: 8.5,
        color: palette.slate500,
        marginTop: 6,
    },
    heroBadge: {
        backgroundColor: palette.slate100,
        color: palette.slate500,
        fontSize: 7,
        fontFamily: 'Helvetica-Bold',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        paddingVertical: 2,
        paddingHorizontal: 5,
        borderRadius: 2,
        marginLeft: 6,
    },

    // ── Key-figure cards (medium, between hero and KPI grid) ──────────────
    keyRow: {
        flexDirection: 'row',
        gap: 10,
    },
    keyCard: {
        flex: 1,
        backgroundColor: palette.surface,
        borderWidth: 0.5,
        borderColor: palette.slate200,
        borderTopWidth: 2,
        borderRadius: 3,
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    keyLabel: {
        fontSize: 7.5,
        color: palette.slate500,
        textTransform: 'uppercase',
        letterSpacing: 0.7,
    },
    keyValue: {
        fontSize: 15,
        fontFamily: 'Helvetica-Bold',
        color: palette.ink900,
        marginTop: 4,
    },

    // ── KPI grid (small cards) ─────────────────────────────────────────────
    kpiGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    kpiCard: {
        backgroundColor: palette.surface,
        borderWidth: 0.5,
        borderColor: palette.slate200,
        borderLeftWidth: 3,
        borderRadius: 3,
        paddingVertical: 7,
        paddingHorizontal: 9,
        minWidth: 100,
        flexGrow: 1,
        flexBasis: '17%',
    },
    kpiLabel: {
        fontSize: 7,
        color: palette.slate500,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    kpiValue: {
        fontSize: 11.5,
        fontFamily: 'Helvetica-Bold',
        color: palette.ink900,
        marginTop: 3,
    },
    kpiValuePos: { color: palette.emerald600 },
    kpiValueNeg: { color: palette.red600 },

    // ── Two-column row: pie + legend ───────────────────────────────────────
    twoColRow: {
        flexDirection: 'row',
        gap: 18,
        marginBottom: 4,
        backgroundColor: palette.surface,
        borderWidth: 0.5,
        borderColor: palette.slate200,
        borderRadius: 4,
        padding: 14,
    },
    pieBox: {
        width: 170,
        height: 170,
        alignItems: 'center',
        justifyContent: 'center',
    },
    legendBox: {
        flex: 1,
        flexDirection: 'column',
        gap: 4,
        paddingVertical: 6,
    },
    legendRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 2,
        borderBottomWidth: 0.25,
        borderBottomColor: palette.slate200,
    },
    legendDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    legendLabel: {
        fontSize: 8.5,
        color: palette.ink900,
        flex: 1,
    },
    legendCount: {
        fontSize: 8.5,
        color: palette.slate500,
        fontFamily: 'Helvetica-Bold',
        marginLeft: 4,
    },
    legendPct: {
        fontSize: 8,
        color: palette.slate400,
        marginLeft: 6,
        width: 36,
        textAlign: 'right',
    },

    // ── Table ──────────────────────────────────────────────────────────────
    tableContainer: {
        borderWidth: 0.5,
        borderColor: palette.slate200,
        borderRadius: 3,
        overflow: 'hidden',
    },
    table: { width: '100%' },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: palette.navy900,
        paddingVertical: 6,
        paddingHorizontal: 3,
    },
    tableHeaderCell: {
        fontFamily: 'Helvetica-Bold',
        fontSize: 7.5,
        color: palette.surface,
        paddingHorizontal: 3,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: palette.slate200,
        paddingVertical: 3,
        paddingHorizontal: 3,
        backgroundColor: palette.surface,
    },
    tableRowAlt: { backgroundColor: palette.slate50 },
    tableCell: { fontSize: 8, paddingHorizontal: 3, color: palette.ink900 },
    cellMuted: { color: palette.slate400 },
    cellPos:   { color: palette.emerald600, fontFamily: 'Helvetica-Bold' },
    cellNeg:   { color: palette.red600, fontFamily: 'Helvetica-Bold' },

    // ── Totals row ─────────────────────────────────────────────────────────
    tableTotals: {
        flexDirection: 'row',
        borderTopWidth: 1.5,
        borderTopColor: palette.navy900,
        backgroundColor: palette.slate100,
        paddingVertical: 5,
        paddingHorizontal: 3,
    },
    totalsCell: {
        fontFamily: 'Helvetica-Bold',
        fontSize: 8.5,
        paddingHorizontal: 3,
        color: palette.ink900,
    },

    // ── Footer ─────────────────────────────────────────────────────────────
    footer: {
        position: 'absolute',
        left: 24,
        right: 24,
        bottom: 18,
        flexDirection: 'row',
        justifyContent: 'space-between',
        fontSize: 7.5,
        color: palette.slate400,
        borderTopWidth: 0.5,
        borderTopColor: palette.slate200,
        paddingTop: 6,
    },
    footerBrand: { color: palette.slate500, fontFamily: 'Helvetica-Bold' },

    // ── Empty state ────────────────────────────────────────────────────────
    emptyState: {
        paddingVertical: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.surface,
    },
    emptyText: { fontSize: 9, color: palette.slate400, fontStyle: 'italic' },
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

// Deterministic accent assignment for arbitrary status keys (so the same
// status always gets the same color across renders). Cycles through the
// palette hues — matches the dashboard's `colorForIndex(idx)` pattern.
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
