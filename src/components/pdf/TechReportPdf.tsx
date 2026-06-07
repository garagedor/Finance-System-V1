import { Document, Page, Text, View } from '@react-pdf/renderer';
import {
    sharedPdfStyles as s,
    fmtCurrency,
    fmtDate,
    fmtInt,
} from './sharedPdfStyles';
import {
    BrandHeader,
    SectionHeader,
    KpiCard,
    KpiGrid,
    KeyFigureCard,
    KeyFigureRow,
    HeroBalanceRow,
    PieChart,
    PieLegend,
    ReportFooter,
    balanceTone,
} from './ReportShared';
import type { PdfReportData, PdfRow, PdfTotals } from './types';

// Column layout for Tech Report — flex weights sum to ~100 so the row fits
// landscape A4 without horizontal scroll. Sign convention (2026-06-08):
// positive = subject owes the company (green), negative = company owes (red).
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

const formatCell = (row: PdfRow, col: typeof COLS[number]) => {
    const raw = (row as any)[col.key];
    if (col.kind === 'date') return { text: fmtDate(raw) };
    if (col.kind === 'currency') return { text: fmtCurrency(raw) };
    if (col.kind === 'balance') {
        const n = Number(raw ?? 0);
        return { text: fmtCurrency(n), tone: balanceTone(n) };
    }
    return { text: raw == null || raw === '' ? '—' : String(raw) };
};

const TableHeader = () => (
    // `fixed` makes react-pdf re-render this header at the top of every page
    // — no custom paging logic needed for repeating headers.
    <View style={s.tableHeader} fixed>
        {COLS.map((c) => (
            <Text key={c.key} style={[s.tableHeaderCell, { flex: c.flex, textAlign: c.align }]}>
                {c.label}
            </Text>
        ))}
    </View>
);

const TableRow = ({ row, alt }: { row: PdfRow; alt: boolean }) => (
    // `wrap={false}` keeps a single row intact across page breaks — never split.
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

export function TechReportPdf({ data }: { data: PdfReportData }) {
    const { subject, startDate, endDate, appliedPct, rows, totals, stats, generatedAt } = data;
    const totalParts = totals.techParts + totals.companyParts + totals.lmParts;

    return (
        <Document
            title={`Tech Report — ${subject}`}
            subject="LBS Garage Door — Tech Balance Report"
            author="LBS Garage Door"
        >
            {/* ════════════════════════════════════════════════════════════
                PAGE 1 — EXECUTIVE SUMMARY
                Headline balance numbers first (the "answer"), then key
                figures (Total Profit, Total Paid, Payout), then range KPIs
                and status distribution. The detail table lives on page 2
                so the exec view is never crowded by raw rows.
                ════════════════════════════════════════════════════════════ */}
            <Page size="A4" orientation="landscape" style={s.page}>
                <BrandHeader
                    reportTitle="Tech Balance Report"
                    subject={subject}
                    startDate={startDate}
                    endDate={endDate}
                    appliedPct={appliedPct}
                    rowCount={totals.rowCount}
                />

                <View style={s.body}>
                    {/* HERO — the headline bottom-line numbers */}
                    <SectionHeader kicker="Executive Summary" title="Bottom Line" />
                    <HeroBalanceRow
                        balance={totals.balance}
                        balanceWithTips={totals.balanceWithTips}
                        mode="tech"
                    />

                    {/* KEY FIGURES — the three numbers a manager scans next */}
                    <SectionHeader kicker="Key Figures" title="Period Financials" />
                    <KeyFigureRow>
                        <KeyFigureCard label="Total Paid"   value={fmtCurrency(totals.paidSum)}     accent="indigo" />
                        <KeyFigureCard label="Total Profit" value={fmtCurrency(totals.totalProfit)} accent="emerald" />
                        <KeyFigureCard label="Tech Payout"  value={fmtCurrency(totals.shareAmount)} accent="cyan" />
                    </KeyFigureRow>

                    {/* RANGE KPIs — overall performance signal */}
                    <SectionHeader kicker="Performance" title="Range Overview" />
                    <KpiGrid>
                        <KpiCard label="Assigned Jobs"   value={fmtInt(stats.assignedJobs)}       accent="indigo" />
                        <KpiCard label="Avg Ticket"      value={fmtCurrency(stats.avgTicket)}     accent="cyan" />
                        <KpiCard label="Job Profit"      value={fmtCurrency(stats.jobProfit)}     accent="emerald" />
                        <KpiCard label="Avg Closed Job"  value={fmtCurrency(stats.avgClosedJob)}  accent="violet" />
                        <KpiCard label="Payment Fees"    value={fmtCurrency(totals.paymentFee)}   accent="amber" />
                        <KpiCard label="Total Parts"     value={fmtCurrency(totalParts)}          accent="amber" />
                        <KpiCard label="Cash Collected"  value={fmtCurrency(totals.techPaidCash)} accent="violet" />
                        <KpiCard label="Tips"            value={fmtCurrency(totals.tipsTotal)}    accent="violet" />
                    </KpiGrid>

                    {/* STATUS PIE — visual breakdown */}
                    {stats.statusStats.length > 0 && (
                        <>
                            <SectionHeader kicker="Distribution" title="Jobs by Status" />
                            <View style={s.twoColRow} wrap={false}>
                                <PieChart
                                    slices={stats.statusStats.map((st) => ({ label: st.key, value: st.count }))}
                                    size={170}
                                />
                                <PieLegend
                                    slices={stats.statusStats.map((st) => ({ label: st.key, value: st.count }))}
                                />
                            </View>
                        </>
                    )}
                </View>

                <ReportFooter generatedAt={generatedAt} />
            </Page>

            {/* ════════════════════════════════════════════════════════════
                PAGE 2+ — DETAIL TABLE
                Same brand header so it reads as one document. The fixed
                table header above each row block means continuation pages
                always carry their column labels.
                ════════════════════════════════════════════════════════════ */}
            <Page size="A4" orientation="landscape" style={s.page}>
                <BrandHeader
                    reportTitle="Tech Balance Report"
                    subject={subject}
                    startDate={startDate}
                    endDate={endDate}
                    appliedPct={appliedPct}
                    rowCount={totals.rowCount}
                />

                <View style={s.bodyTight}>
                    <SectionHeader kicker="Detail" title="Closed Jobs Breakdown" />
                    <View style={s.tableContainer}>
                        <View style={s.table}>
                            <TableHeader />
                            {rows.length === 0 ? (
                                <View style={s.emptyState}>
                                    <Text style={s.emptyText}>No closed jobs in this range.</Text>
                                </View>
                            ) : (
                                rows.map((row, i) => <TableRow key={row.id} row={row} alt={i % 2 === 1} />)
                            )}
                            {rows.length > 0 && <TotalsRow totals={totals} />}
                        </View>
                    </View>
                </View>

                <ReportFooter generatedAt={generatedAt} />
            </Page>
        </Document>
    );
}
