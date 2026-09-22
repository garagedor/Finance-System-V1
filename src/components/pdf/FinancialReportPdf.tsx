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

function DataTable({ cols, rows, totals, stickyHeader = true }: { cols: Col[]; rows: Array<Record<string, Cell>>; totals?: Record<string, Cell>; stickyHeader?: boolean }) {
  if (rows.length === 0) {
    return (
      <View style={s.emptyState}><Text style={s.emptyText}>No rows for the selected filters.</Text></View>
    );
  }
  return (
    <View style={s.tableContainer}>
      <View style={s.tableHeader} fixed={stickyHeader}>
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

function DisputesByPartySection({ d }: { d: FinancialReportData }) {
  const p = d.disputesByParty;
  const table = (title: string, rows: FinancialReportData["disputesByParty"]["byProvider"]) => (
    <View style={{ marginBottom: 8 }}>
      <Text style={{ fontSize: 8.5, color: palette.slate300, fontFamily: "Helvetica-Bold", marginBottom: 4 }}>{title}</Text>
      <DataTable
        cols={[
          { key: "name", label: "Name", flex: 2.6 },
          { key: "count", label: "Count", flex: 1, align: "right", kind: "int" },
          { key: "disputed", label: "Disputed", flex: 1.4, align: "right", kind: "currency" },
          { key: "share", label: "Charged share", flex: 1.6, align: "right", kind: "currency" },
        ]}
        rows={rows.map((g) => ({ name: g.name, count: g.count, disputed: g.disputed, share: g.share }))}
      />
    </View>
  );
  return (
    <View>
      <SectionHeader kicker="Chargebacks" title="Disputes by provider / tech / AM" />
      {table("By provider", p.byProvider)}
      {table("By technician", p.byTechnician)}
      {table("By area manager", p.byAreaManager)}
    </View>
  );
}

function PayoutsSection({ d }: { d: FinancialReportData }) {
  const p = d.payouts;
  return (
    <View>
      <SectionHeader kicker="Money out" title="Payouts" />
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
        <KpiCard label="Paid" value={fmtCurrency(p.paid)} accent="emerald" />
        <KpiCard label="Unpaid" value={fmtCurrency(p.unpaid)} accent="amber" />
        <KpiCard label="Payouts" value={fmtInt(p.count)} accent="indigo" />
      </View>
      <DataTable
        cols={[
          { key: "recipient", label: "Recipient", flex: 2.6 },
          { key: "role", label: "Role", flex: 1.6 },
          { key: "periodEnd", label: "Period end", flex: 1.6 },
          { key: "status", label: "Status", flex: 1.2 },
          { key: "net", label: "Net", flex: 1.4, align: "right", kind: "currency" },
        ]}
        rows={p.rows.map((r) => ({ recipient: r.recipient, role: r.role || "—", periodEnd: fmtDate(r.periodEnd), status: r.status, net: r.net }))}
        totals={{ recipient: "Total", net: p.paid + p.unpaid }}
      />
    </View>
  );
}

function DebtsSection({ d }: { d: FinancialReportData }) {
  const p = d.debts;
  return (
    <View>
      <SectionHeader kicker="Outstanding" title="Debts & balances (open)" />
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
        <KpiCard label="Open debts" value={fmtCurrency(p.openTotal)} accent="red" />
        <KpiCard label="Count" value={fmtInt(p.count)} accent="indigo" />
      </View>
      <DataTable
        cols={[
          { key: "from", label: "Owes", flex: 2 },
          { key: "to", label: "Owed to", flex: 2 },
          { key: "reason", label: "Reason", flex: 2.4 },
          { key: "dueDate", label: "Due", flex: 1.3 },
          { key: "amount", label: "Amount", flex: 1.4, align: "right", kind: "currency" },
        ]}
        rows={p.rows.map((r) => ({ from: r.from, to: r.to, reason: r.reason || "—", dueDate: r.dueDate ? fmtDate(r.dueDate) : "—", amount: r.amount }))}
        totals={{ from: "Total open", amount: p.openTotal }}
      />
    </View>
  );
}

function EquipmentSection({ d }: { d: FinancialReportData }) {
  const p = d.equipment;
  return (
    <View>
      <SectionHeader kicker="Inventory" title="Equipment orders" />
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
        <KpiCard label="AM charged" value={fmtCurrency(p.amCharge)} accent="indigo" />
        <KpiCard label="Company cost" value={fmtCurrency(p.companyCost)} accent="amber" />
        <KpiCard label="Gross profit" value={fmtCurrency(p.grossProfit)} accent="emerald" tone={p.grossProfit >= 0 ? "pos" : "neg"} />
        <KpiCard label="Orders" value={fmtInt(p.orderCount)} accent="cyan" />
      </View>
      <DataTable
        cols={[
          { key: "order", label: "Order", flex: 1.6 },
          { key: "areaManager", label: "Area manager", flex: 2.2 },
          { key: "date", label: "Date", flex: 1.3 },
          { key: "status", label: "Status", flex: 1.3 },
          { key: "amCharge", label: "AM charge", flex: 1.4, align: "right", kind: "currency" },
          { key: "grossProfit", label: "Gross profit", flex: 1.4, align: "right", kind: "currency", tone: true },
        ]}
        rows={p.rows.map((r) => ({ order: r.order, areaManager: r.areaManager, date: fmtDate(r.date), status: r.status, amCharge: r.amCharge, grossProfit: r.grossProfit }))}
        totals={{ order: "Total", amCharge: p.amCharge, grossProfit: p.grossProfit }}
      />
    </View>
  );
}

function BankingSection({ d }: { d: FinancialReportData }) {
  const p = d.banking;
  return (
    <View>
      <SectionHeader kicker="Liquidity" title="Cash & banking" />
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
        <KpiCard label="Total balance" value={fmtCurrency(p.balanceTotal)} accent="cyan" tone={p.balanceTotal >= 0 ? "pos" : "neg"} />
        <KpiCard label="Money in (period)" value={fmtCurrency(p.inflow)} accent="emerald" tone="pos" />
        <KpiCard label="Money out (period)" value={fmtCurrency(p.outflow)} accent="red" tone="neg" />
        <KpiCard label="Net flow" value={fmtCurrency(p.net)} accent="indigo" tone={p.net >= 0 ? "pos" : "neg"} />
      </View>
      <DataTable
        cols={[
          { key: "label", label: "Account", flex: 2.6 },
          { key: "bank", label: "Bank", flex: 2 },
          { key: "kind", label: "Type", flex: 1.2 },
          { key: "balance", label: "Balance", flex: 1.4, align: "right", kind: "currency", tone: true },
        ]}
        rows={p.accounts.map((a) => ({ label: a.label, bank: a.bank || "—", kind: a.isCredit ? "Credit" : "Cash", balance: a.balance }))}
        totals={{ label: "Total", balance: p.balanceTotal }}
      />
    </View>
  );
}

function LedgerStatement({ l }: { l: FinancialReportData["ledgerDetail"]["rows"][number] }) {
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: palette.slate100 }}>
          {l.holderName}
          <Text style={{ fontSize: 8, color: palette.slate400, fontFamily: "Helvetica" }}>  ·  {roleLabel(l.role)}{l.location ? `  ·  ${l.location}` : ""}</Text>
        </Text>
        <Text style={{ fontSize: 8.5, color: palette.slate300 }}>
          Opening {fmtCurrency(l.opening)}  →  Closing {fmtCurrency(l.closing)}  ·  Current {fmtCurrency(l.current)}
        </Text>
      </View>
      {l.entries.length === 0 ? (
        <View style={s.emptyState}><Text style={s.emptyText}>No entries in this period.</Text></View>
      ) : (
        <DataTable
          stickyHeader={false}
          cols={[
            { key: "date", label: "Date", flex: 1.3 },
            { key: "type", label: "Type", flex: 1.5 },
            { key: "description", label: "Description", flex: 3.6 },
            { key: "amount", label: "Amount", flex: 1.3, align: "right", kind: "currency", tone: true },
            { key: "running", label: "Running", flex: 1.3, align: "right", kind: "currency", tone: true },
          ]}
          rows={l.entries.map((e) => ({ date: fmtDate(e.date), type: e.type, description: e.description || "—", amount: e.amount, running: e.running }))}
          totals={{ date: "Closing", running: l.closing }}
        />
      )}
      {l.truncated && <Text style={{ fontSize: 7.5, color: palette.slate500, marginTop: 3 }}>Showing the first 300 entries — narrow the period to see the rest.</Text>}
    </View>
  );
}

function LedgerDetailSection({ d }: { d: FinancialReportData }) {
  const rows = d.ledgerDetail.rows;
  return (
    <View>
      <SectionHeader kicker="Statements" title="Ledger detail — per ledger" />
      {rows.length === 0 ? (
        <View style={s.emptyState}><Text style={s.emptyText}>No ledgers in scope. Adjust the ledger-scope filters.</Text></View>
      ) : rows.map((l) => <LedgerStatement key={l.id} l={l} />)}
      {d.ledgerDetail.truncatedLedgers && (
        <Text style={{ fontSize: 7.5, color: palette.slate500, marginTop: 6 }}>
          Only the first 40 ledgers are detailed — narrow the ledger scope (role / location / holder) to report the rest.
        </Text>
      )}
    </View>
  );
}

const RENDERERS: Record<SectionKey, (p: { d: FinancialReportData }) => React.ReactElement> = {
  pnl: PnlSection,
  income: IncomeSection,
  expenses: ExpensesSection,
  disputes: DisputesSection,
  disputesByParty: DisputesByPartySection,
  byLocation: ByLocationSection,
  payouts: PayoutsSection,
  debts: DebtsSection,
  equipment: EquipmentSection,
  banking: BankingSection,
  ledgers: LedgersSection,
  ledgerDetail: LedgerDetailSection,
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
      <Page size="A4" orientation="landscape" style={s.page}>
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
