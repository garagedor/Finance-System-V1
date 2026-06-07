import { StyleSheet } from '@react-pdf/renderer';

// Shared style sheet for the Balance Report PDFs (Tech + Location).
// Built for landscape A4 — the column count is wide enough that portrait
// would force every cell to wrap. Font sizes target legibility when the page
// is printed at 100% or viewed on a phone PDF reader.
export const sharedPdfStyles = StyleSheet.create({
    page: {
        paddingTop: 36,
        paddingBottom: 50,
        paddingHorizontal: 28,
        fontSize: 8.5,
        fontFamily: 'Helvetica',
        color: '#0f172a',
    },
    // ── Header ─────────────────────────────────────────────────────────────
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        borderBottomWidth: 1.5,
        borderBottomColor: '#0f172a',
        paddingBottom: 10,
        marginBottom: 14,
    },
    brandBlock: { flexDirection: 'column' },
    brandName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#0f172a' },
    brandSub:  { fontSize: 9, color: '#475569', marginTop: 2 },
    metaBlock: { flexDirection: 'column', alignItems: 'flex-end' },
    reportTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#0f172a' },
    metaLine:    { fontSize: 9, color: '#334155', marginTop: 3 },
    metaLabel:   { color: '#64748b' },

    // ── Summary card ───────────────────────────────────────────────────────
    summarySection: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 14,
    },
    summaryCard: {
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 4,
        padding: 8,
        minWidth: 110,
        flexGrow: 1,
        flexBasis: '15%',
    },
    summaryLabel: { fontSize: 7.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 },
    summaryValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#0f172a', marginTop: 3 },
    summaryValuePos: { color: '#047857' },
    summaryValueNeg: { color: '#b91c1c' },

    // ── Table ──────────────────────────────────────────────────────────────
    table: { width: '100%' },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        paddingVertical: 5,
        paddingHorizontal: 3,
    },
    tableHeaderCell: {
        fontFamily: 'Helvetica-Bold',
        fontSize: 7.5,
        color: '#f8fafc',
        paddingHorizontal: 3,
        textTransform: 'uppercase',
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#e2e8f0',
        paddingVertical: 3,
        paddingHorizontal: 3,
    },
    tableRowAlt: { backgroundColor: '#f8fafc' },
    tableCell: { fontSize: 8, paddingHorizontal: 3, color: '#0f172a' },
    cellMuted: { color: '#94a3b8' },
    cellPos: { color: '#047857', fontFamily: 'Helvetica-Bold' },
    cellNeg: { color: '#b91c1c', fontFamily: 'Helvetica-Bold' },
    cellRight: { textAlign: 'right' },

    // ── Totals row ─────────────────────────────────────────────────────────
    tableTotals: {
        flexDirection: 'row',
        borderTopWidth: 1.5,
        borderTopColor: '#0f172a',
        backgroundColor: '#f1f5f9',
        paddingVertical: 5,
        paddingHorizontal: 3,
        marginTop: 4,
    },
    totalsCell: {
        fontFamily: 'Helvetica-Bold',
        fontSize: 8.5,
        paddingHorizontal: 3,
        color: '#0f172a',
    },
    totalsLabel: { fontFamily: 'Helvetica-Bold', fontSize: 8.5 },

    // ── Footer (page number + generated stamp) ─────────────────────────────
    footer: {
        position: 'absolute',
        left: 28,
        right: 28,
        bottom: 20,
        flexDirection: 'row',
        justifyContent: 'space-between',
        fontSize: 7.5,
        color: '#94a3b8',
        borderTopWidth: 0.5,
        borderTopColor: '#e2e8f0',
        paddingTop: 6,
    },
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
