// Pure formatter for a dispute/refund cost-share breakdown. Shared by the ledger
// page (interactive "view more") and the reports (printed inline under the line),
// so the content can never drift between them. No server/client-only imports.

export type DisputeLine = { label: string; value: string; head?: boolean; strong?: boolean; hi?: boolean; sub?: boolean };
export type DisputePartsExtra = { address?: string | null; techParts?: number; companyParts?: number; lmParts?: number };
export interface DisputeDetail { address: string; customer: string; lines: DisputeLine[] }

const money = (n: number) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const pct = (n: number) => `${Math.round((Number(n) || 0) * 10) / 10}%`;
const partyLabel = (p: string) => p === "area_manager" ? "area manager" : p === "combined" ? "AM + technician" : p;

export function disputeDetail(snapshot: Record<string, unknown> | null | undefined, extra?: DisputePartsExtra): DisputeDetail {
  if (!snapshot) return { address: "", customer: "", lines: [] };
  const n = (k: string) => Number(snapshot[k]) || 0;
  const str = (k: string) => (snapshot[k] == null ? "" : String(snapshot[k]));

  const address = str("address") || (extra?.address ?? "") || "";
  const customer = str("customer_name");
  const hasParts = !!extra && extra.techParts != null;
  const partsTotal = hasParts ? (extra!.techParts! + extra!.companyParts! + extra!.lmParts!) : n("partsCost");

  const techPct = n("technicianPercent");
  const amPool = n("areaManagerPoolPercent");
  const amOwn = Math.max(0, amPool - techPct);
  const provPct = n("providerPercent");
  const coPct = n("companyPercent");

  const lines: DisputeLine[] = [
    { label: "Job (from CRM)", value: "", head: true },
    { label: "Job amount", value: money(n("jobAmount")) },
    { label: "Collected", value: money(n("totalCollected")) },
    { label: "Gross / net tip", value: `${money(n("grossTip"))} / ${money(n("netTip"))}` },
    ...(hasParts
      ? [
          { label: "Parts (total)", value: money(partsTotal) },
          { label: "Tech parts", value: money(extra!.techParts!), sub: true },
          { label: "Company parts", value: money(extra!.companyParts!), sub: true },
          { label: "LM parts", value: money(extra!.lmParts!), sub: true },
        ]
      : [{ label: "Parts", value: money(partsTotal) }]),
    { label: "Operational profit", value: money(n("operationalProfit")) },

    { label: `Dispute${str("disputeClassification") ? ` · ${str("disputeClassification")}` : ""}`, value: "", head: true },
    { label: "Dispute / refund amount", value: money(n("disputeOrRefundAmount")) },
    { label: "Parts loss", value: money(n("partsLoss")) },

    { label: "Cost-share split", value: "", head: true },
    { label: `Technician (${pct(techPct)}) — charge the tech this`, value: money(n("technicianPortion")), strong: true, hi: true },
    { label: `Area manager own (${pct(amOwn)})`, value: money(n("areaManagerOwnPortion")) },
    { label: `Provider (${pct(provPct)})`, value: money(n("providerCharge")) },
    { label: `Company (${pct(coPct)})`, value: money(n("companyCharge")) },
    { label: "Total AM ledger charge (tech + AM)", value: money(n("amLedgerCharge")), strong: true },
  ];

  const party = str("posted_party");
  if (party) {
    lines.push({ label: "Posted to this ledger", value: "", head: true });
    lines.push({ label: partyLabel(party), value: money(n("posted_amount")), strong: true });
  }

  return { address, customer, lines };
}
