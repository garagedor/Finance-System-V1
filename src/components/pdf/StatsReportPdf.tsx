// Statistics report PDF — a branded, printable snapshot of the /stats page
// (same data via computeStats). Landscape A4, reusing the shared brand kit.

import { Document, Page, Text, View, Image } from "@react-pdf/renderer";
import { sharedPdfStyles as s, palette, fmtCurrency, fmtInt, fmtPct, fmtDate, fmtTimestamp } from "./sharedPdfStyles";
import { SectionHeader, KpiCard, KpiGrid, PiePanel, ReportFooter } from "./ReportShared";
import type { StatsResult } from "@/app/api/stats/route";

interface Col { key: string; label: string; flex: number; align?: "left" | "right"; kind?: "text" | "currency" | "int" }

function Table({ cols, rows, totals }: { cols: Col[]; rows: Array<Record<string, string | number>>; totals?: Record<string, string | number> }) {
  if (rows.length === 0) return <View style={s.emptyState}><Text style={s.emptyText}>No rows.</Text></View>;
  const cell = (v: string | number, kind?: Col["kind"]) => kind === "currency" ? fmtCurrency(Number(v)) : kind === "int" ? fmtInt(Number(v)) : String(v ?? "—");
  return (
    <View style={s.tableContainer}>
      <View style={s.tableHeader}>
        {cols.map((c) => <Text key={c.key} style={[s.tableHeaderCell, { flex: c.flex, textAlign: c.align ?? "left" }] as never}>{c.label}</Text>)}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={[s.tableRow, i % 2 ? s.tableRowAlt : null].filter(Boolean) as never} wrap={false}>
          {cols.map((c) => <Text key={c.key} style={[s.tableCell, { flex: c.flex, textAlign: c.align ?? "left" }] as never}>{cell(r[c.key], c.kind)}</Text>)}
        </View>
      ))}
      {totals && (
        <View style={s.tableTotals} wrap={false}>
          {cols.map((c) => <Text key={c.key} style={[s.totalsCell, { flex: c.flex, textAlign: c.align ?? "left" }] as never}>{totals[c.key] == null ? "" : cell(totals[c.key], c.kind)}</Text>)}
        </View>
      )}
    </View>
  );
}

const nameCols: Col[] = [
  { key: "key", label: "Name", flex: 3 },
  { key: "count", label: "Jobs", flex: 1, align: "right", kind: "int" },
  { key: "totalAmount", label: "Total sales", flex: 1.6, align: "right", kind: "currency" },
  { key: "totalPaid", label: "Collected", flex: 1.6, align: "right", kind: "currency" },
];

const BRAND = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#84cc16", "#0ea5e9", "#f43f5e", "#a855f7"];

export function StatsReportPdf({
  title, startDate, endDate, filters, data, logoSrc,
}: {
  title: string;
  startDate: string;
  endDate: string;
  filters: { techs: string[]; locations: string[]; providers: string[] };
  data: StatsResult;
  logoSrc?: string | null;
}) {
  const sum = data.summary;
  const statusSlices = data.byStatus.map((r, i) => ({ label: r.key, value: r.count, color: BRAND[i % BRAND.length] }));
  const sumRow = (rows: Array<{ count: number; totalAmount: number; totalPaid: number }>) => ({
    count: rows.reduce((a, r) => a + r.count, 0),
    totalAmount: rows.reduce((a, r) => a + r.totalAmount, 0),
    totalPaid: rows.reduce((a, r) => a + r.totalPaid, 0),
  });
  const filterLine = [
    filters.techs.length ? `Techs: ${filters.techs.join(", ")}` : "",
    filters.locations.length ? `Locations: ${filters.locations.join(", ")}` : "",
    filters.providers.length ? `Providers: ${filters.providers.join(", ")}` : "",
  ].filter(Boolean).join("  ·  ") || "All jobs";

  return (
    <Document title={title} author="317 Garage Door">
      <Page size="A4" orientation="landscape" style={s.page}>
        <View fixed>
          <View style={s.brandBand}>
            <View style={s.brandLeft}>
              {logoSrc && <Image src={logoSrc} style={s.brandLogoImg} />}
              <View style={s.brandLogoTextBlock}>
                <Text style={s.brandLogo}>317 GARAGE DOOR</Text>
                <Text style={s.brandKicker}>Statistics Report</Text>
              </View>
            </View>
            <View style={s.brandRight}>
              <Text style={s.reportTitle}>{title}</Text>
              <View style={s.brandSubjectRow}>
                <Text style={s.brandSubjectLabel}>Range: </Text>
                <Text style={s.brandSubjectValue}>{fmtDate(startDate)} → {fmtDate(endDate)}</Text>
              </View>
            </View>
          </View>
          <View style={s.metaStrip}>
            <View style={[s.metaPair, { flex: 1 }] as never}><Text style={s.metaLabel}>Filters</Text><Text style={[s.metaValue, { flexShrink: 1 }] as never}>{filterLine}</Text></View>
            <View style={s.metaPair}><Text style={s.metaLabel}>Generated</Text><Text style={s.metaValue}>{fmtTimestamp(new Date())}</Text></View>
          </View>
        </View>

        <View style={s.body}>
          <SectionHeader kicker="Analytics" title="Summary" />
          <KpiGrid>
            <KpiCard label="Total Jobs" value={fmtInt(sum.count)} accent="indigo" />
            <KpiCard label="Closed Ratio" value={fmtPct(sum.closedRatio * 100)} accent="cyan" />
            <KpiCard label="Jobs Profit" value={fmtCurrency(sum.jobsProfit)} accent="emerald" tone={sum.jobsProfit >= 0 ? "pos" : "neg"} />
            <KpiCard label="Avg Closed Ticket" value={fmtCurrency(sum.avgClosedTicket)} accent="violet" />
            <KpiCard label="Avg Ticket" value={fmtCurrency(sum.avgTicket)} accent="amber" />
            <KpiCard label="Avg w/o Penalty" value={fmtCurrency(sum.avgTicketWithoutPenalty)} accent="cyan" />
            <KpiCard label="Total Sales" value={fmtCurrency(sum.totalAmount)} accent="indigo" />
            <KpiCard label="Total Collected" value={fmtCurrency(sum.totalPaid)} accent="emerald" />
            <KpiCard label="Total Profit" value={fmtCurrency(sum.totalProfit)} accent="violet" tone={sum.totalProfit >= 0 ? "pos" : "neg"} />
          </KpiGrid>

          <View style={{ marginTop: 10 }}>
            <SectionHeader kicker="Distribution" title="Jobs by Status" />
            <PiePanel slices={statusSlices} totalLabel="Total Jobs" />
          </View>

          <View style={{ marginTop: 10 }}>
            <SectionHeader kicker="Breakdown" title="By Location" />
            <Table cols={nameCols} rows={data.byLocation as unknown as Array<Record<string, string | number>>} totals={{ key: "Total", ...sumRow(data.byLocation) }} />
          </View>
          <View style={{ marginTop: 10 }}>
            <SectionHeader kicker="Breakdown" title="By Technician" />
            <Table cols={nameCols} rows={data.byTech as unknown as Array<Record<string, string | number>>} totals={{ key: "Total", ...sumRow(data.byTech) }} />
          </View>
          <View style={{ marginTop: 10 }}>
            <SectionHeader kicker="Breakdown" title="By Provider" />
            <Table cols={nameCols} rows={data.byProvider as unknown as Array<Record<string, string | number>>} totals={{ key: "Total", ...sumRow(data.byProvider) }} />
          </View>
        </View>

        <ReportFooter generatedAt={new Date().toISOString()} />
      </Page>
    </Document>
  );
}

void palette;
