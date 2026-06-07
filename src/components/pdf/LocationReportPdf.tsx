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
    DistributionPanel,
    HorizontalBars,
    ConversionStats,
    ReportFooter,
    balanceTone,
} from './ReportShared';
import { statusColor } from './sharedPdfStyles';
import type { PdfReportData, PdfRow, PdfTotals } from './types';

// Location Report column layout. Tips and Balance + Tips are INFORMATIONAL
// ONLY — they don't affect any LM settlement / payout / company-liability
// calculation. The AM still doesn't receive tips, but the figures are
// surfaced so the AM can see total tech earnings + total job economics
// for the period. Sign convention (locked 2026-06-08):
// positive (green) = LM owes company; negative (red) = company owes LM.
const COLS = [
    { key: 'date',            label: 'Date',         flex: 5,  align: 'left'  as const, kind: 'date'     as const },
    { key: 'address',         label: 'Address',      flex: 14, align: 'left'  as const, kind: 'text'     as const },
    { key: 'paymentMethod',   label: 'Pay Method',   flex: 6,  align: 'left'  as const, kind: 'text'     as const },
    { key: 'paidSum',         label: 'Job Total',    flex: 6,  align: 'right' as const, kind: 'currency' as const },
    { key: 'techParts',       label: 'Tech Parts',   flex: 5,  align: 'right' as const, kind: 'currency' as const },
    { key: 'companyParts',    label: 'Co. Parts',    flex: 5,  align: 'right' as const, kind: 'currency' as const },
    { key: 'lmParts',         label: 'LM Parts',     flex: 5,  align: 'right' as const, kind: 'currency' as const },
    { key: 'paymentFee',      label: 'Pay Fee',      flex: 5,  align: 'right' as const, kind: 'currency' as const },
    { key: 'totalProfit',     label: 'Profit',       flex: 6,  align: 'right' as const, kind: 'currency' as const },
    { key: 'shareAmount',     label: 'LM Payout',    flex: 6,  align: 'right' as const, kind: 'currency' as const },
    { key: 'lmCash',          label: 'LM Cash',      flex: 5,  align: 'right' as const, kind: 'currency' as const },
    { key: 'lmCheck',         label: 'LM Check',     flex: 5,  align: 'right' as const, kind: 'currency' as const },
    { key: 'techPaidCash',    label: 'Tech Cash',    flex: 5,  align: 'right' as const, kind: 'currency' as const },
    { key: 'tipsTotal',       label: 'Tips (info)',  flex: 5,  align: 'right' as const, kind: 'currency' as const },
    { key: 'balance',         label: 'Balance',      flex: 6,  align: 'right' as const, kind: 'balance' as const },
    { key: 'balanceWithTips', label: 'Bal. + Tips',  flex: 7,  align: 'right' as const, kind: 'balance' as const },
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
    <View style={s.tableHeader} fixed>
        {COLS.map((c) => (
            <Text key={c.key} style={[s.tableHeaderCell, { flex: c.flex, textAlign: c.align }]}>
                {c.label}
            </Text>
        ))}
    </View>
);

const TableRow = ({ row, alt }: { row: PdfRow; alt: boolean }) => (
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

export function LocationReportPdf({ data }: { data: PdfReportData }) {
    const { subject, startDate, endDate, appliedPct, rows, totals, stats, generatedAt, logoSrc } = data;
    const totalParts = totals.techParts + totals.companyParts + totals.lmParts;
    const statusSlices = stats.statusStats.map((st, i) => ({
        label: st.key,
        value: st.count,
        color: statusColor(i),
    }));
    const closedCount = stats.statusStats.find((s) => s.key === 'Closed')?.count ?? 0;
    const lostCount   = stats.statusStats.find((s) => s.key.toLowerCase().includes('lost'))?.count ?? 0;
    const xCloseCount = stats.statusStats.find((s) => s.key === 'X close')?.count ?? 0;
    const openCount   = Math.max(0, stats.assignedJobs - closedCount - lostCount - xCloseCount);

    const headerProps = {
        reportTitle: 'Location Balance Report',
        subject,
        startDate,
        endDate,
        appliedPct,
        rowCount: totals.rowCount,
        logoSrc,
    } as const;

    return (
        <Document
            title={`Location Report — ${subject}`}
            subject="317 Garage Door — Location Balance Report"
            author="317 Garage Door"
        >
            {/* ════════════════════════════════════════════════════════════
                PAGE 1 — EXECUTIVE SUMMARY
                ════════════════════════════════════════════════════════════ */}
            <Page size="A4" orientation="landscape" style={s.page}>
                <BrandHeader {...headerProps} />

                <View style={s.body}>
                    <SectionHeader kicker="Executive Summary" title="Bottom Line" />
                    <HeroBalanceRow
                        balance={totals.balance}
                        balanceWithTips={totals.balanceWithTips}
                        mode="location"
                    />

                    <SectionHeader kicker="Key Figures" title="Period Financials" />
                    <KeyFigureRow>
                        <KeyFigureCard label="Total Paid"   value={fmtCurrency(totals.paidSum)}     accent="indigo" />
                        <KeyFigureCard label="Total Profit" value={fmtCurrency(totals.totalProfit)} accent="emerald" />
                        <KeyFigureCard label="LM Payout"    value={fmtCurrency(totals.shareAmount)} accent="cyan" />
                    </KeyFigureRow>

                    <SectionHeader kicker="Performance" title="Range Overview" />
                    <KpiGrid>
                        <KpiCard label="Assigned Jobs"   value={fmtInt(stats.assignedJobs)}       accent="indigo" />
                        <KpiCard label="Avg Ticket"      value={fmtCurrency(stats.avgTicket)}     accent="cyan" />
                        <KpiCard label="Job Profit"      value={fmtCurrency(stats.jobProfit)}     accent="emerald" />
                        <KpiCard label="Avg Closed Job"  value={fmtCurrency(stats.avgClosedJob)}  accent="violet" />
                        <KpiCard label="Payment Fees"    value={fmtCurrency(totals.paymentFee)}   accent="amber" />
                        <KpiCard label="Total Parts"     value={fmtCurrency(totalParts)}          accent="amber" />
                        <KpiCard label="LM Cash"         value={fmtCurrency(totals.lmCash)}       accent="cyan" />
                        <KpiCard label="LM Check"        value={fmtCurrency(totals.lmCheck)}      accent="cyan" />
                        <KpiCard label="Tech Cash"       value={fmtCurrency(totals.techPaidCash)} accent="violet" />
                        <KpiCard label="Tips (info)"     value={fmtCurrency(totals.tipsTotal)}    accent="violet" />
                    </KpiGrid>
                </View>

                <ReportFooter generatedAt={generatedAt} />
            </Page>

            {/* ════════════════════════════════════════════════════════════
                PAGE 2 — DISTRIBUTION ANALYTICS
                ════════════════════════════════════════════════════════════ */}
            {stats.statusStats.length > 0 && (
                <Page size="A4" orientation="landscape" style={s.page}>
                    <BrandHeader {...headerProps} />

                    <View style={s.body}>
                        <SectionHeader kicker="Analytics" title="Job Status Distribution" />
                        <DistributionPanel
                            slices={statusSlices}
                            centerValue={fmtInt(stats.assignedJobs)}
                            centerCaption="Total Jobs"
                        />

                        <SectionHeader kicker="Volume" title="Jobs per Status" />
                        <View style={s.distPanel} wrap={false}>
                            <HorizontalBars
                                rows={statusSlices.map((sl) => ({
                                    label: sl.label,
                                    value: sl.value,
                                    color: sl.color,
                                }))}
                            />
                            <ConversionStats
                                closedCount={closedCount}
                                openCount={openCount}
                                lostCount={lostCount}
                                totalCount={stats.assignedJobs}
                            />
                        </View>
                    </View>

                    <ReportFooter generatedAt={generatedAt} />
                </Page>
            )}

            {/* ════════════════════════════════════════════════════════════
                PAGE 3+ — DETAIL TABLE
                ════════════════════════════════════════════════════════════ */}
            <Page size="A4" orientation="landscape" style={s.page}>
                <BrandHeader {...headerProps} />

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
