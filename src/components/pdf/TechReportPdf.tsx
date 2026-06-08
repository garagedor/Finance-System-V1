import { Document, Page, Text, View } from '@react-pdf/renderer';
import {
    sharedPdfStyles as s,
    fmtCurrency,
    fmtDate,
    fmtInt,
    statusColor,
} from './sharedPdfStyles';
import {
    BrandHeader,
    SectionHeader,
    KpiCard,
    KpiGrid,
    MidRow,
    PiePanel,
    SnapshotCard,
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
    { key: 'techPaidCash', label: 'Cash',        flex: 5, align: 'right' as const, kind: 'currency' as const },
    // Tips section (added 2026-06-08) — Tip | Fee | Net Tip.
    // Net Tip is what Balance + Tips folds in; Fee = Tip − Net Tip.
    { key: 'tipsGross',    label: 'Tip',         flex: 5, align: 'right' as const, kind: 'currency' as const },
    { key: 'tipsFee',      label: 'Fee',         flex: 4, align: 'right' as const, kind: 'currency' as const },
    { key: 'tipsTotal',    label: 'Net Tip',     flex: 5, align: 'right' as const, kind: 'currency' as const },
    { key: 'balance',         label: 'Balance',         flex: 6, align: 'right' as const, kind: 'balance' as const },
    { key: 'balanceWithTips', label: 'Bal. + Tips',     flex: 7, align: 'right' as const, kind: 'balance' as const },
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
    const { techName, locationName, startDate, endDate, appliedPct, rows, totals, stats, generatedAt, logoSrc } = data;
    const statusSlices = stats.statusStats.map((st, i) => ({
        label: st.key,
        value: st.count,
        color: statusColor(i),
    }));

    const headerProps = {
        reportTitle: 'Tech Balance Report',
        techName,
        locationName,
        startDate,
        endDate,
        appliedPct,
        rowCount: totals.rowCount,
        logoSrc,
    } as const;

    return (
        <Document
            title={`Tech Report — ${techName}`}
            subject="317 Garage Door — Tech Balance Report"
            author="317 Garage Door"
        >
            {/* ════════════════════════════════════════════════════════════
                PAGE 1 — DASHBOARD SUMMARY (mirrors CRM /balance-report)
                KPI strip across the top, then a mid-row with the status
                pie/legend on the left and the Quick Totals snapshot card
                on the right. Single page, no separate analytics page.
                ════════════════════════════════════════════════════════════ */}
            <Page size="A4" orientation="landscape" style={s.page}>
                <BrandHeader {...headerProps} />

                <View style={s.body}>
                    {/* KPI strip — same 4 cards the CRM exposes by default */}
                    <SectionHeader kicker="Performance" title="Range Overview" />
                    <KpiGrid>
                        <KpiCard label="Assigned Jobs"  value={fmtInt(stats.assignedJobs)}       accent="indigo" />
                        <KpiCard label="Avg Ticket"     value={fmtCurrency(stats.avgTicket)}     accent="cyan" />
                        <KpiCard label="Job Profit"     value={fmtCurrency(stats.jobProfit)}     accent="emerald" />
                        <KpiCard label="Avg Closed Job" value={fmtCurrency(stats.avgClosedJob)}  accent="violet" />
                    </KpiGrid>

                    {/* Mid row: pie panel + snapshot. Both are dark cards
                        matching the dashboard's panels exactly. */}
                    <MidRow>
                        <PiePanel slices={statusSlices} totalLabel="Total Jobs" />
                        <SnapshotCard
                            kicker="Closed Jobs Snapshot"
                            title="Quick Totals"
                            pill={`${totals.rowCount} closed`}
                            entries={[
                                { label: 'Total Paid',     value: totals.paidSum },
                                { label: 'Total Profit',   value: totals.totalProfit },
                                { label: 'Tech Payout',    value: totals.shareAmount },
                                { label: 'Cash Collected', value: totals.techPaidCash },
                                'divider',
                                { label: 'Balance',        value: totals.balance,         weight: 'strong', tone: 'auto' },
                                { label: 'Tips',           value: totals.tipsTotal,       sub: true },
                                { label: 'Balance + Tips', value: totals.balanceWithTips, weight: 'strong', tone: 'auto' },
                            ]}
                        />
                    </MidRow>
                </View>

                <ReportFooter generatedAt={generatedAt} />
            </Page>

            {/* ════════════════════════════════════════════════════════════
                PAGE 2+ — DETAIL TABLE
                ════════════════════════════════════════════════════════════ */}
            <Page size="A4" orientation="landscape" style={s.page}>
                <BrandHeader {...headerProps} />

                <View style={s.body}>
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
