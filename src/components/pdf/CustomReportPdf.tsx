// Custom itemized report PDF: hand-picked items grouped by category, each group
// subtotaled, with a grand total. Landscape, reusing the shared brand kit.

import { Document, Page, Text, View, Image } from "@react-pdf/renderer";
import { sharedPdfStyles as s, palette, fmtCurrency, fmtDate, fmtTimestamp } from "./sharedPdfStyles";
import { SectionHeader, KpiCard, KpiGrid, ReportFooter } from "./ReportShared";

export interface CustomPdfItem { date: string; primary: string; secondary: string; amount: number }
export interface CustomPdfGroup { type: string; label: string; amountLabel: string; items: CustomPdfItem[]; subtotal: number }

function GroupTable({ g }: { g: CustomPdfGroup }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <SectionHeader kicker={`${g.items.length} item${g.items.length === 1 ? "" : "s"}`} title={g.label} />
      <View style={s.tableContainer}>
        <View style={s.tableHeader}>
          <Text style={[s.tableHeaderCell, { flex: 1.3 }] as never}>Date</Text>
          <Text style={[s.tableHeaderCell, { flex: 3.4 }] as never}>Item</Text>
          <Text style={[s.tableHeaderCell, { flex: 2.6 }] as never}>Detail</Text>
          <Text style={[s.tableHeaderCell, { flex: 1.5, textAlign: "right" }] as never}>{g.amountLabel}</Text>
        </View>
        {g.items.map((it, i) => (
          <View key={i} style={[s.tableRow, i % 2 ? s.tableRowAlt : null].filter(Boolean) as never} wrap={false}>
            <Text style={[s.tableCell, { flex: 1.3 }] as never}>{fmtDate(it.date)}</Text>
            <Text style={[s.tableCell, { flex: 3.4 }] as never}>{it.primary || "—"}</Text>
            <Text style={[s.tableCell, { flex: 2.6 }, s.cellMuted] as never}>{it.secondary || "—"}</Text>
            <Text style={[s.tableCell, { flex: 1.5, textAlign: "right" }, it.amount > 0 ? s.cellPos : it.amount < 0 ? s.cellNeg : null].filter(Boolean) as never}>{fmtCurrency(it.amount)}</Text>
          </View>
        ))}
        <View style={s.tableTotals} wrap={false}>
          <Text style={[s.totalsCell, { flex: 1.3 }] as never}>Subtotal</Text>
          <Text style={[s.totalsCell, { flex: 6 }] as never}>{" "}</Text>
          <Text style={[s.totalsCell, { flex: 1.5, textAlign: "right" }] as never}>{fmtCurrency(g.subtotal)}</Text>
        </View>
      </View>
    </View>
  );
}

export function CustomReportPdf({
  title, from, to, preparedFor, logoSrc, groups, grandTotal,
}: {
  title: string;
  from: string;
  to: string;
  preparedFor?: string | null;
  logoSrc?: string | null;
  groups: CustomPdfGroup[];
  grandTotal: number;
}) {
  const itemCount = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <Document title={title} author="317 Garage Door">
      <Page size="A4" orientation="landscape" style={s.page}>
        <View fixed>
          <View style={s.brandBand}>
            <View style={s.brandLeft}>
              {logoSrc && <Image src={logoSrc} style={s.brandLogoImg} />}
              <View style={s.brandLogoTextBlock}>
                <Text style={s.brandLogo}>317 GARAGE DOOR</Text>
                <Text style={s.brandKicker}>Custom Report</Text>
              </View>
            </View>
            <View style={s.brandRight}>
              <Text style={s.reportTitle}>{title}</Text>
              <View style={s.brandSubjectRow}>
                <Text style={s.brandSubjectLabel}>Period: </Text>
                <Text style={s.brandSubjectValue}>{fmtDate(from)} → {fmtDate(to)}</Text>
              </View>
              {preparedFor ? (
                <View style={s.brandSubjectRow}>
                  <Text style={s.brandSubjectLabel}>Prepared for: </Text>
                  <Text style={s.brandSubjectValue}>{preparedFor}</Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={s.metaStrip}>
            <View style={s.metaPair}><Text style={s.metaLabel}>Items</Text><Text style={s.metaValue}>{itemCount}</Text></View>
            <View style={s.metaPair}><Text style={s.metaLabel}>Generated</Text><Text style={s.metaValue}>{fmtTimestamp(new Date())}</Text></View>
          </View>
        </View>

        <View style={s.body}>
          <KpiGrid>
            <KpiCard label="Groups" value={String(groups.length)} accent="indigo" />
            <KpiCard label="Items" value={String(itemCount)} accent="cyan" />
            <KpiCard label="Grand total" value={fmtCurrency(grandTotal)} accent="emerald" tone={grandTotal >= 0 ? "pos" : "neg"} />
          </KpiGrid>
          <View style={{ marginTop: 8 }}>
            {groups.length === 0 ? (
              <View style={s.emptyState}><Text style={s.emptyText}>No items selected.</Text></View>
            ) : groups.map((g) => <GroupTable key={g.type} g={g} />)}
          </View>
          {groups.length > 0 && (
            <View style={[s.tableTotals, { marginTop: 4, borderRadius: 7 }] as never} wrap={false}>
              <Text style={[s.totalsCell, { flex: 1.3, color: palette.surface }] as never}>GRAND TOTAL</Text>
              <Text style={[s.totalsCell, { flex: 6 }] as never}>{" "}</Text>
              <Text style={[s.totalsCell, { flex: 1.5, textAlign: "right", color: grandTotal >= 0 ? palette.emerald400 : palette.red400 }] as never}>{fmtCurrency(grandTotal)}</Text>
            </View>
          )}
        </View>

        <ReportFooter generatedAt={new Date().toISOString()} />
      </Page>
    </Document>
  );
}
