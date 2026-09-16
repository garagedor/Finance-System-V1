// Configurable "full financial picture" PDF for the accountant.
//
// The layout is TEMPLATE-driven: the caller passes an ordered list of enabled
// section keys and this renders exactly those, in that order, under a branded
// header. Reuses the shared brand kit (sharedPdfStyles + ReportShared) so it
// reads as the same official family as the Balance Report PDFs.

import { Document, Page, Text, View, Image } from "@react-pdf/renderer";
import {
  sharedPdfStyles as s,
  palette,
  fmtCurrency,
  fmtInt,
  fmtDate,
  fmtTimestamp,
} from "./sharedPdfStyles";
import { SectionHeader, KpiCard, KpiGrid, SnapshotCard, ReportFooter, balanceTone } from "./ReportShared";
import type { SectionKey, FinancialReportData } from "@/lib/financial-report";

// ── Generic data table (dark, matches the balance-report detail table) ──────
type Align = "left" | "right";
type Kind = "text" | "currency" | "int";
interface Col { key: string; label: string; flex: number; align?: Align; kind?: Kind; tone?: boolean }
type Cell = string | number;

function fmtCell(v: Cell, kind?: Kind): string {
  if (kind === "currency") return fmtCurrency(Number(v));
  if (kind === "int") return fmtInt(Number(v));
  return v == null ? "—" : String(v);
}

function DataTable({ cols, rows, totals }: { cols: Col[]; rows: Array<Record<string, Cell>>; totals?: Record<string, Cell> }) {
  if (rows.length === 0) {
    return (
      <View style={s.emptyState}><Text style={s.emptyText}>No rows for the selected filters.</Text></View>
    );
  }
  return (
    <View style={s.tableContainer}>
      <View style={s.tableHeader} fixed>
        {cols.map((c) => (
          <Text key={c.key} style={[s.tableHeaderCell, { flex: c.flex, textAlign: c.align ?? "left" }] as never}>{c.label}</Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={[s.tableRow, i % 2 ? s.tableRowAlt : null].filter(Boolean) as never} wrap={false}>
          {cols.map((c) => {
            const raw = r[c.key];
            const toneStyle = c.tone && c.kind === "currency"
              ? (Number(raw) > 0 ? s.cellPos : Number(raw) < 0 ? s.cellNeg : null)
              : null;
            return (
              <Text key={c.key} style={[s.tableCell, { flex: c.flex, textAlign: c.align ?? "left" }, toneStyle].filter(Boolean) as never}>
                {fmtCell(raw, c.kind)}
              </Text>
            );
          })}
        </View>
      ))}
      {totals && (
        <View style={s.tableTotals} wrap={false}>
          {cols.map((c) => (
            <Text key={c.key} style={[s.totalsCell, { flex: c.flex, textAlign: c.align ?? "left" }] as never}>
              {totals[c.key] == null ? "" : fmtCell(totals[c.key], c.kind)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const roleLabel = (r: string) =>
  r === "area_manager" ? "Area Manager" : r === "technician" ? "Technician" : r.replace(/_/g, " ");

// ── Section renderers ───────────────────────────────────────────────────────
function PnlSection({ d }: { d: FinancialReportData }) {
  const p = d.pnl;
  return (
    <View>
      <SectionHeader kicker="Profit & Loss" title="P&L Summary" />
      <KpiGrid>
        <KpiCard label="Total Revenue" value={fmtCurrency(p.totalRevenue)} accent="indigo" />
        <KpiCard label="Gross Profit" value={fmtCurrency(p.grossProfit)} accent="cyan" tone={p.grossProfit >= 0 ? "pos" : "neg"} />
        <KpiCard label="Operating Expenses" value={fmtCurrency(p.totalExpenses)} accent="amber" />
        <KpiCard label="Net Profit" value={fmtCurrency(p.netProfit)} accent="emerald" tone={p.netProfit >= 0 ? "pos" : "neg"} />
        <KpiCard label="Net After Disputes" value={fmtCurrency(p.netAfterDisputes)} accent="violet" tone={p.netAfterDisputes >= 0 ? "pos" : "neg"} />
        <KpiCard label="Cash on Hand" value={fmtCurrency(p.cashOnHand)} accent="cyan" tone={p.cashOnHand >= 0 ? "pos" : "neg"} />
      </KpiGrid>
      <View style={{ marginTop: 12 }}>
        <SnapshotCard
          title="Profit & Loss statement"
          kicker={`${p.jobCount} closed jobs`}
          pill={`${fmtDate(d.meta.from)} → ${fmtDate(d.meta.to)}`}
          entries={[
            { label: "Job revenue", value: p.jobRevenue, sub: true },
            { label: "Manual income", value: p.manualIncome, sub: true },
            { label: "Total revenue", value: p.totalRevenue, weight: "strong" },
            "divider",
            { label: "Gross profit", value: p.grossProfit, weight: "strong", tone: "auto" },
            { label: "Operating expenses", value: -p.totalExpenses, tone: "neg" },
            { label: "Payouts", value: -p.payouts, tone: "neg" },
            { label: "Net profit", value: p.netProfit, weight: "strong", tone: "auto" },
            "divider",
            { label: "Dispute impact", value: p.disputeImpact, tone: "auto", badge: "period" },
            { label: "Refund loss", value: -p.refundLoss, tone: "neg" },
            { label: "Net after disputes", value: p.netAfterDisputes, weight: "strong", tone: "auto" },
          ]}
        />
      </View>
    </View>
  );
}

function IncomeSection({ d }: { d: FinancialReportData }) {
  const rows = d.income.map((r) => ({ source: r.source === "crm_jobs" ? "CRM jobs (collected)" : r.source, total: r.total }));
  const total = d.income.reduce((s2, r) => s2 + r.total, 0);
  return (
    <View>
      <SectionHeader kicker="Money in" title="Income breakdown" />
      <DataTable
        cols={[
          { key: "source", label: "Source", flex: 3 },
          { key: "total", label: "Amount", flex: 1.4, align: "right", kind: "currency" },
        ]}
        rows={rows}
        totals={{ source: "Total income", total }}
      />
    </View>
  );
}

function ExpensesSection({ d }: { d: FinancialReportData }) {
  const rows = d.expenses.map((r) => ({ category: r.category || "Uncategorized", count: r.count, total: r.total }));
  const total = d.expenses.reduce((s2, r) => s2 + r.total, 0);
  const count = d.expenses.reduce((s2, r) => s2 + r.count, 0);
  return (
    <View>
      <SectionHeader kicker="Money out" title="Expenses breakdown" />
      <DataTable
        cols={[
          { key: "category", label: "Category", flex: 3 },
          { key: "count", label: "Count", flex: 1, align: "right", kind: "int" },
          { key: "total", label: "Amount", flex: 1.4, align: "right", kind: "currency" },
        ]}
        rows={rows}
        totals={{ category: "Total expenses", count, total }}
      />
      <Text style={{ fontSize: 7.5, color: palette.slate500, marginTop: 6 }}>
        Unpaid portion: {fmtCurrency(d.pnl.unpaidExpenses)}
      </Text>
    </View>
  );
}

function DisputesSection({ d }: { d: FinancialReportData }) {
  const x = d.disputes;
  return (
    <View>
      <SectionHeader kicker="Adjustments" title="Disputes & Refunds impact" />
      <SnapshotCard
        title="Company-slice impact for the period"
        kicker={`${x.disputeCount} disputes filed`}
        pill={`${fmtCurrency(x.disputeTotalAmount)} disputed`}
        entries={[
          { label: "Disputed amount (gross)", value: x.disputeTotalAmount, sub: true },
          { label: "Won (returned)", value: x.disputeWonAmount, sub: true, tone: "pos" },
          { label: "Lost", value: x.disputeLostAmount, sub: true, tone: "neg" },
          "divider",
          { label: "Company slice lost on disputes filed", value: -x.filedLoss, tone: "neg" },
          { label: "Company slice recovered (won)", value: x.recoveredSlice, tone: "pos" },
          { label: "Net dispute impact", value: x.impact, weight: "strong", tone: "auto" },
          "divider",
          { label: "Refund loss (company slice)", value: -x.refundLoss, weight: "strong", tone: "neg" },
        ]}
      />
    </View>
  );
}

function ByLocationSection({ d }: { d: FinancialReportData }) {
  const rows = d.byLocation.map((r) => ({ area: r.area || "—", count: r.count, total: r.total }));
  const total = d.byLocation.reduce((s2, r) => s2 + r.total, 0);
  const count = d.byLocation.reduce((s2, r) => s2 + r.count, 0);
  return (
    <View>
      <SectionHeader kicker="Distribution" title="Revenue by location" />
      <DataTable
        cols={[
          { key: "area", label: "Location", flex: 3 },
          { key: "count", label: "Jobs", flex: 1, align: "right", kind: "int" },
          { key: "total", label: "Collected", flex: 1.4, align: "right", kind: "currency" },
        ]}
        rows={rows}
        totals={{ area: "Total", count, total }}
      />
    </View>
  );
}

function LedgersSection({ d }: { d: FinancialReportData }) {
  const L = d.ledgers;
  const rows = L.rows.map((r) => ({
    holder: r.holderName,
    role: roleLabel(r.role),
    location: r.location || "—",
    opening: r.opening,
    movement: r.movement,
    closing: r.closing,
    current: r.current,
  }));
  return (
    <View>
      <SectionHeader kicker="Settlement" title="Ledgers — balances to settle" />
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
        <KpiCard label="Owed to company" value={fmtCurrency(L.totalOwedToCompany)} accent="emerald" tone="pos" />
        <KpiCard label="Company owes" value={fmtCurrency(L.totalCompanyOwes)} accent="red" tone="neg" />
        <KpiCard label="Net position" value={fmtCurrency(L.netPosition)} accent="indigo" tone={L.netPosition >= 0 ? "pos" : "neg"} />
      </View>
      <DataTable
        cols={[
          { key: "holder", label: "Holder", flex: 2.4 },
          { key: "role", label: "Role", flex: 1.4 },
          { key: "location", label: "Location", flex: 1.8 },
          { key: "opening", label: "Opening", flex: 1.3, align: "right", kind: "currency", tone: true },
          { key: "movement", label: "Movement", flex: 1.3, align: "right", kind: "currency", tone: true },
          { key: "closing", label: "Closing", flex: 1.3, align: "right", kind: "currency", tone: true },
          { key: "current", label: "Current", flex: 1.3, align: "right", kind: "currency", tone: true },
        ]}
        rows={rows}
        totals={{
          holder: "Totals",
          current: L.netPosition,
        }}
      />
      <Text style={{ fontSize: 7.5, color: palette.slate500, marginTop: 6 }}>
        Positive = the holder owes the company (collect); negative = the company owes them (pay out).
        Opening/Movement/Closing are for the period; Current is the live balance to settle now.
      </Text>
    </View>
  );
}

const RENDERERS: Record<SectionKey, (p: { d: FinancialReportData }) => React.ReactElement> = {
  pnl: PnlSection,
  income: IncomeSection,
  expenses: ExpensesSection,
  disputes: DisputesSection,
  byLocation: ByLocationSection,
  ledgers: LedgersSection,
};

// ── Header band (generic — not tied to tech/location like BrandHeader) ──────
function ReportHeader({ title, from, to, preparedFor, logoSrc }: {
  title: string; from: string; to: string; preparedFor: string | null; logoSrc?: string | null;
}) {
  return (
    <View fixed>
      <View style={s.brandBand}>
        <View style={s.brandLeft}>
          {logoSrc && <Image src={logoSrc} style={s.brandLogoImg} />}
          <View style={s.brandLogoTextBlock}>
            <Text style={s.brandLogo}>317 GARAGE DOOR</Text>
            <Text style={s.brandKicker}>Financial Report</Text>
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
        <View style={s.metaPair}>
          <Text style={s.metaLabel}>Report</Text>
          <Text style={s.metaValue}>Full financial picture</Text>
        </View>
        <View style={s.metaPair}>
          <Text style={s.metaLabel}>Generated</Text>
          <Text style={s.metaValue}>{fmtTimestamp(new Date())}</Text>
        </View>
      </View>
    </View>
  );
}

export function FinancialReportPdf({
  data,
  sections,
  title,
  preparedFor,
  logoSrc,
}: {
  data: FinancialReportData;
  sections: SectionKey[];
  title: string;
  preparedFor?: string | null;
  logoSrc?: string | null;
}) {
  const ordered = sections.filter((k) => RENDERERS[k]);
  return (
    <Document title={title} author="317 Garage Door">
      <Page size="A4" style={s.page}>
        <ReportHeader title={title} from={data.meta.from} to={data.meta.to} preparedFor={preparedFor ?? null} logoSrc={logoSrc} />
        <View style={s.body}>
          {ordered.map((key, i) => {
            const Renderer = RENDERERS[key];
            return (
              <View key={key} style={i > 0 ? { marginTop: 6 } : undefined}>
                <Renderer d={data} />
              </View>
            );
          })}
          {ordered.length === 0 && (
            <View style={s.emptyState}><Text style={s.emptyText}>No sections selected.</Text></View>
          )}
        </View>
        <ReportFooter generatedAt={data.meta.generatedAt} />
      </Page>
    </Document>
  );
}

// Ordering-only tone helper kept in case future rows need it.
void balanceTone;
