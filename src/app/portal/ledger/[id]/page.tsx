import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { LedgerRecord, LedgerEntryRecord } from "@/types/finance-ledger";
import { fmt$, fmtDate } from "../../format";
import { PageHeader, StatPill, CardShell, Empty, BackLink } from "../../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../../_components/EntryFormModal";
import AddCrmReportModal from "./AddCrmReportModal";
import AddDisputeRefundModal from "./AddDisputeRefundModal";
import RecordPaymentModal from "./RecordPaymentModal";
import ReverseEntryButton from "./ReverseEntryButton";
import DeleteEntryButton from "./DeleteEntryButton";
import DeleteLedgerButton from "./DeleteLedgerButton";

// What source a linked/system entry came from — used to warn before deleting it.
function linkedLabelFor(e: LedgerEntryRecord): string | null {
  if (e.type === "report" || e.report_meta) return "a CRM balance report";
  if (e.payout_id) return "a payout";
  if (e.equipment_order_id) return "an equipment order";
  if (e.equipment_return_id) return "an equipment return/credit";
  if (e.dispute_id) return "a dispute/refund";
  if (e.income_id) return "an income record";
  if (e.expense_id) return "an expense record";
  if (e.bank_txn_id) return "a matched bank transaction";
  return null;
}

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  area_manager: "Area Manager",
  technician: "Technician",
};

const TYPE_OPTIONS = [
  { value: "opening_balance", label: "Opening balance" },
  { value: "debt", label: "Debt" },
  { value: "loan", label: "Loan" },
  { value: "advance", label: "Advance" },
  { value: "bonus", label: "Bonus" },
  { value: "commission", label: "Commission" },
  { value: "fee", label: "Fee" },
  { value: "reimbursement", label: "Reimbursement" },
  { value: "credit", label: "Credit" },
  { value: "dispute", label: "Dispute" },
  { value: "refund", label: "Refund" },
  { value: "equipment", label: "Equipment" },
  { value: "misc", label: "Misc" },
  { value: "settlement", label: "Settlement" },
  { value: "office_charge", label: "Office charge" },
  { value: "payment", label: "Payment" },
  { value: "deduction", label: "Deduction" },
  { value: "adjustment", label: "Adjustment" },
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.map((o) => [o.value, o.label]),
);
TYPE_LABEL.report = "CRM Balance Report";

async function load(id: string) {
  await ensureFinanceIndexes();
  const ledger = await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).findOne({ _id: id });
  if (!ledger) return null;
  // Oldest → newest so the running balance accumulates correctly.
  const entries = await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry)
    .find({ ledger_id: id })
    .sort({ date: 1, _id: 1 })
    .toArray();
  let running = 0;
  const withRunning = entries.map((e) => {
    running += e.amount;
    return { e, running };
  });
  // Entries that have been reversed by a later reversal entry.
  const reversedIds = new Set(
    entries.map((e) => e.reverses_id).filter((x): x is string => Boolean(x)),
  );
  return { ledger, rows: withRunning.reverse(), balance: running, count: entries.length, reversedIds };
}

export default async function LedgerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const d = await load(id);

  if (!d) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Tracking" title="Ledger not found" />
        <Empty
          message="This ledger doesn't exist (it may have been deleted)."
          action={<Link href="/portal/ledger" className="portal-btn portal-btn-primary">← All ledgers</Link>}
        />
      </div>
    );
  }

  const { ledger } = d;
  const entryFields: FieldDef[] = [
    { name: "date", label: "Date", kind: "date", width: "half", required: true,
      defaultValue: new Date().toISOString().slice(0, 10) },
    { name: "type", label: "Type", kind: "combo", width: "half", required: true,
      options: TYPE_OPTIONS, defaultValue: "misc",
      help: "Pick one or type your own" },
    { name: "amount", label: "Amount (signed)", kind: "money", required: true,
      placeholder: "e.g. -1500",
      help: "Negative = company owes them · Positive = they owe the company" },
    { name: "description", label: "Description", kind: "text", required: true,
      placeholder: "What is this movement?" },
  ];

  return (
    <div className="portal-page">
      <div style={{ marginBottom: 8 }}>
        <BackLink href="/portal/ledger" label="All ledgers" />
      </div>

      <PageHeader
        kicker={`Ledger · ${ROLE_LABEL[ledger.role] ?? ledger.role}`}
        title={ledger.holder_name + (ledger.label ? ` · ${ledger.label}` : "")}
        subtitle={ledger.location ? `Location / area: ${ledger.location}` : undefined}
        actions={
          <>
            <AddCrmReportModal
              ledgerId={ledger._id}
              defaultSubject={ledger.holder_name}
              defaultMode={ledger.role === "technician" ? "tech" : "location"}
            />
            <AddDisputeRefundModal
              ledgerId={ledger._id}
              defaultTech={ledger.role === "technician" ? ledger.holder_name : ""}
            />
            <RecordPaymentModal
              ledgerId={ledger._id}
              holderName={ledger.holder_name}
              currentBalance={d.balance}
            />
            <EntryFormModal
              endpoint={`/api/portal/ledger/${ledger._id}/entries`}
              title="Ledger entry"
              fields={entryFields}
              triggerLabel="+ Add entry"
              primary
            />
            <DeleteLedgerButton
              ledgerId={ledger._id}
              holderName={ledger.holder_name}
              entryCount={d.count}
            />
          </>
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Current balance" value={<BalanceText n={d.balance} />} />
        <StatPill label="Entries" value={d.count.toLocaleString()} />
        <StatPill label="Role" value={ROLE_LABEL[ledger.role] ?? ledger.role} />
        <StatPill label="Location" value={ledger.location || "—"} />
      </section>

      <CardShell
        title="Ledger entries"
        subtitle="Newest first · running balance shown after each entry"
      >
        {d.rows.length === 0 ? (
          <Empty
            message="No entries yet. Add an opening balance or the first movement."
            action={
              <EntryFormModal
                endpoint={`/api/portal/ledger/${ledger._id}/entries`}
                title="Ledger entry"
                fields={entryFields}
                triggerLabel="+ Add first entry"
              />
            }
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th>Source</th>
                <th className="right">Amount</th>
                <th className="right">Running balance</th>
                <th className="right"></th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map(({ e, running }) => {
                const isReversal = Boolean(e.reverses_id);
                const isReversed = d.reversedIds.has(e._id);
                return (
                <tr key={e._id} style={isReversed ? { opacity: 0.6 } : undefined}>
                  <td className="small mono">{fmtDate(e.date)}</td>
                  <td className="small">
                    {TYPE_LABEL[e.type] ?? e.type}
                    {isReversal && <span className="pill pill-draft" style={{ marginLeft: 6 }}>↩ reversal</span>}
                    {isReversed && <span className="pill pill-unpaid" style={{ marginLeft: 6 }}>reversed</span>}
                  </td>
                  <td>
                    {e.description ?? "—"}
                    {e.report_meta && (
                      <div className="muted small">
                        {e.report_meta.tech_count != null
                          ? `${e.report_meta.tech_count} techs · `
                          : ""}
                        {e.report_meta.job_count} closed job(s) · Balance{" "}
                        {fmt$(e.report_meta.balance, { showSign: true })} · +Tips{" "}
                        {fmt$(e.report_meta.balance_with_tips, { showSign: true })}
                      </div>
                    )}
                    {(e.type === "dispute" || e.type === "refund") &&
                      e.gross_amount != null && e.pct_applied != null && (
                        <div className="muted small">
                          {e.technician_id ? `${e.technician_id} · ` : ""}
                          {fmt$(e.gross_amount)} × {(e.pct_applied * 100).toFixed(
                            (e.pct_applied * 100) % 1 ? 1 : 0,
                          )}%
                        </div>
                      )}
                  </td>
                  <td className="muted small">
                    {e.source === "crm" ? "CRM" : e.source === "imported" ? "Imported" : "Manual"}
                    {e.bank_txn_id && <span title="Matched to a bank transaction"> · 🔗 bank</span>}
                    {e.payout_id && <span title="Matched to a portal payout"> · 🔗 payout</span>}
                  </td>
                  <td className="right" style={isReversed ? { textDecoration: "line-through" } : undefined}>
                    <BalanceText n={e.amount} />
                  </td>
                  <td className="right"><BalanceText n={running} muted /></td>
                  <td className="right">
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      {e.source === "manual" && !isReversal && !isReversed && (
                        <EntryFormModal
                          endpoint={`/api/portal/ledger/${ledger._id}/entries`}
                          title="Ledger entry"
                          fields={entryFields}
                          initial={e as unknown as Record<string, unknown>}
                          triggerLabel="Edit"
                        />
                      )}
                      {!isReversal && !isReversed && (
                        <ReverseEntryButton ledgerId={ledger._id} entryId={e._id} />
                      )}
                      <DeleteEntryButton ledgerId={ledger._id} entryId={e._id} linkedLabel={linkedLabelFor(e)} />
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardShell>

      <p className="muted small" style={{ marginTop: 4 }}>
        <span className="money-neg">Red / negative</span> = company owes them ·{" "}
        <span className="money-pos">Green / positive</span> = they owe the company. Manually-added
        entries can be edited; system entries (CRM reports, disputes, equipment, payments) are
        append-only — reverse those instead. Any line can be <strong>permanently deleted</strong>
        (can&apos;t be undone; deleting a linked line doesn&apos;t update its source record).
      </p>
    </div>
  );
}

function BalanceText({ n, muted }: { n: number; muted?: boolean }) {
  const cls = n < -0.005 ? "money-neg" : n > 0.005 ? "money-pos" : "money-zero";
  return (
    <span className={`money ${cls}`} style={{ fontWeight: muted ? 500 : 600, opacity: muted ? 0.85 : 1 }}>
      {fmt$(n, { showSign: true })}
    </span>
  );
}
