import { Document, Page, Text, View } from '@react-pdf/renderer';
import { sharedPdfStyles as s, fmtCurrency, fmtDate, fmtTimestamp } from './sharedPdfStyles';
import type { PdfReportData, PdfRow, PdfTotals } from './types';

// Column layout for Tech Report — widths are flex fractions that sum to 100.
// Includes Balance + Balance + Tips so the tech sees both at-a-glance net
// settlement and "with my tips" version.
const COLS = [
    { key: 'date',         label: 'Date',        flex: 5, align: 'left'  as const, kind: 'date'     as const },
    { key: 'address',      label: 'Address',     flex: 14, align: 'left' as const, kind: 'text'     as const },
    { key: 'paymentMethod',label: 'Pay Method',  flex: 7, align: 'left'  as const, kind: 'text'     as const },
    { key: 'paidSum',      label: 'Job Total',   flex: 6, align: 'right' as const, kind: 'currency' as const },
    { key: 'techParts',    label: 'Tech Parts',  flex: 6, align: 'right' as const, kind: 'currency' as const },
    { key: 'companyParts', label: 'Co. Parts',   flex: 6, align: 'right' as const, kind: 'currency' as const },
    { key: 'lmParts',      label: 'LM Parts',    flex: 5, align: 'right' as const, kind: 'currency' as const },
    { key: 'paymentFee',   label: 'Pay Fee',     flex: 5, align: 'right' as const, kind: 'currency' as const },
    { key: 'totalProfit',  label: 'Profit',      flex: 6, align: 'right' as const, kind: 'currency' as const },
    { key: 'shareAmount',  label: 'Payout',      flex: 6, align: 'right' as const, kind: 'currency' as const },
    { key: 'techPaidCash', label: 'Cash',        flex: 6, align: 'right' as const, kind: 'currency' as const },
    { key: 'tipsTotal',    label: 'Tips',        flex: 5, align: 'right' as const, kind: 'currency' as const },
    { key: 'balance',         label: 'Balance',         flex: 7, align: 'right' as const, kind: 'balance' as const },
    { key: 'balanceWithTips', label: 'Bal. + Tips',     flex: 8, align: 'right' as const, kind: 'balance' as const },
];

const formatCell = (row: PdfRow, col: typeof COLS[number]): { text: string; tone?: 'pos' | 'neg' } => {
    const raw = (row as any)[col.key];
    if (col.kind === 'date') return { text: fmtDate(raw) };
    if (col.kind === 'currency') return { text: fmtCurrency(raw) };
    if (col.kind === 'balance') {
        const n = Number(raw ?? 0);
        return { text: fmtCurrency(n), tone: n > 0 ? 'pos' : n < 0 ? 'neg' : undefined };
    }
    return { text: raw == null || raw === '' ? '—' : String(raw) };
};

const TableHeader = () => (
    // `fixed` makes react-pdf re-render this view at the top of every page,
    // giving us repeating column headers without any custom paging math.
    <View style={s.tableHeader} fixed>
        {COLS.map((c) => (
            <Text
                key={c.key}
                style={[s.tableHeaderCell, { flex: c.flex, textAlign: c.align }]}
            >
                {c.label}
            </Text>
        ))}
    </View>
);

const TableRow = ({ row, alt }: { row: PdfRow; alt: boolean }) => (
    // `wrap={false}` keeps an individual row intact across page breaks — a
    // row never gets cut in half. react-pdf decides where to break.
    <View style={[s.tableRow, alt ? s.tableRowAlt : null].filter(Boolean) as any} wrap={false}>
        {COLS.map((c) => {
            const cell = formatCell(row, c);
            const toneStyle = cell.tone === 'pos' ? s.cellPos : cell.tone === 'neg' ? s.cellNeg : null;
            return (
                <Text
                    key={c.key}
                    style={[s.tableCell, { flex: c.flex, textAlign: c.align }, toneStyle].filter(Boolean) as any}
                >
                    {cell.text}
                </Text>
            );
        })}
    </View>
);

const TotalsRow = ({ totals }: { totals: PdfTotals }) => (
    <View style={s.tableTotals} wrap={false}>
        {COLS.map((c, i) => {
            if (i === 0) {
                return (
                    <Text key={c.key} style={[s.totalsCell, { flex: c.flex, textAlign: 'left' }]}>
                        Totals
                    </Text>
                );
            }
            if (c.kind === 'text' || c.kind === 'date') {
                return <Text key={c.key} style={[s.totalsCell, { flex: c.flex }]}>{' '}</Text>;
            }
            const v = (totals as any)[c.key];
            const isBalance = c.kind === 'balance';
            const toneStyle = isBalance
                ? (v > 0 ? s.cellPos : v < 0 ? s.cellNeg : null)
                : null;
            return (
                <Text
                    key={c.key}
                    style={[s.totalsCell, { flex: c.flex, textAlign: c.align }, toneStyle].filter(Boolean) as any}
                >
                    {fmtCurrency(v)}
                </Text>
            );
        })}
    </View>
);

const SummaryCard = ({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) => (
    <View style={s.summaryCard}>
        <Text style={s.summaryLabel}>{label}</Text>
        <Text
            style={[
                s.summaryValue,
                tone === 'pos' ? s.summaryValuePos : tone === 'neg' ? s.summaryValueNeg : null,
            ].filter(Boolean) as any}
        >
            {value}
        </Text>
    </View>
);

export function TechReportPdf({ data }: { data: PdfReportData }) {
    const { subject, startDate, endDate, appliedPct, rows, totals, generatedAt } = data;
    const balanceTone = totals.balance > 0 ? 'pos' : totals.balance < 0 ? 'neg' : undefined;
    const balanceWithTipsTone = totals.balanceWithTips > 0 ? 'pos' : totals.balanceWithTips < 0 ? 'neg' : undefined;

    return (
        <Document
            title={`Tech Report — ${subject}`}
            subject="LBS Garage Door — Tech Balance Report"
            author="LBS Garage Door"
        >
            <Page size="A4" orientation="landscape" style={s.page}>
                {/* ── Header ───────────────────────────────────────────── */}
                <View style={s.headerRow} fixed>
                    <View style={s.brandBlock}>
                        <Text style={s.brandName}>LBS Garage Door</Text>
                        <Text style={s.brandSub}>Official Balance Report</Text>
                    </View>
                    <View style={s.metaBlock}>
                        <Text style={s.reportTitle}>Tech Report — {subject || '—'}</Text>
                        <Text style={s.metaLine}>
                            <Text style={s.metaLabel}>Range: </Text>
                            {fmtDate(startDate)} → {fmtDate(endDate)}
                        </Text>
                        <Text style={s.metaLine}>
                            <Text style={s.metaLabel}>Applied %: </Text>
                            {appliedPct}%
                            {'   '}
                            <Text style={s.metaLabel}>Closed Jobs: </Text>
                            {totals.rowCount}
                        </Text>
                    </View>
                </View>

                {/* ── Summary ──────────────────────────────────────────── */}
                <View style={s.summarySection}>
                    <SummaryCard label="Total Paid"    value={fmtCurrency(totals.paidSum)} />
                    <SummaryCard label="Payment Fees"  value={fmtCurrency(totals.paymentFee)} />
                    <SummaryCard label="Parts"         value={fmtCurrency(totals.techParts + totals.companyParts + totals.lmParts)} />
                    <SummaryCard label="Total Profit"  value={fmtCurrency(totals.totalProfit)} />
                    <SummaryCard label="Tech Payout"   value={fmtCurrency(totals.shareAmount)} />
                    <SummaryCard label="Cash Collected" value={fmtCurrency(totals.techPaidCash)} />
                    <SummaryCard label="Tips"          value={fmtCurrency(totals.tipsTotal)} />
                    <SummaryCard label="Balance"       value={fmtCurrency(totals.balance)} tone={balanceTone} />
                    <SummaryCard label="Balance + Tips" value={fmtCurrency(totals.balanceWithTips)} tone={balanceWithTipsTone} />
                </View>

                {/* ── Table ────────────────────────────────────────────── */}
                <View style={s.table}>
                    <TableHeader />
                    {rows.length === 0 ? (
                        <View style={s.tableRow}>
                            <Text style={[s.tableCell, s.cellMuted, { flex: 1, textAlign: 'center' }]}>
                                No closed jobs in this range.
                            </Text>
                        </View>
                    ) : (
                        rows.map((row, i) => <TableRow key={row.id} row={row} alt={i % 2 === 1} />)
                    )}
                    {rows.length > 0 && <TotalsRow totals={totals} />}
                </View>

                {/* ── Footer ───────────────────────────────────────────── */}
                <View style={s.footer} fixed>
                    <Text>Generated {fmtTimestamp(new Date(generatedAt))}</Text>
                    <Text
                        render={({ pageNumber, totalPages }) =>
                            `Page ${pageNumber} of ${totalPages}`
                        }
                    />
                </View>
            </Page>
        </Document>
    );
}
