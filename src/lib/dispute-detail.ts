// Pure formatter for a dispute/refund cost-share breakdown. Shared by the ledger
// page (interactive "view more") and the reports (printed inline under the line),
// so the content can never drift between them. No server/client-only imports.

export type DisputeLine = { label: string; value: string; head?: boolean; strong?: boolean; hi?: boolean; sub?: boolean };
export type DisputePartsExtra = { address?: string | null; techParts?: number; companyParts?: number; lmParts?: number; techName?: string | null };
export interface DisputeDetail { address: string; customer: string; tech: string; lines: DisputeLine[] }

const money = (n: number) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const pct = (n: number) => `${Math.round((Number(n) || 0) * 10) / 10}%`;
const partyLabel = (p: string) => p === "area_manager" ? "area manager" : p === "combined" ? "AM + technician" : p;

export function disputeDetail(snapshot: Record<string, unknown> | null | undefined, extra?: DisputePartsExtra): DisputeDetail {
  if (!snapshot) return { address: "", customer: "", tech: "", lines: [] };
  const n = (k: string) => Number(snapshot[k]) || 0;
  const str = (k: string) => (snapshot[k] == null ? "" : String(snapshot[k]));

  const address = str("address") || (extra?.address ?? "") || "";
  const customer = str("customer_name");
  const tech = (extra?.techName ?? "") || "";
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
    { label: `Technician${tech ? ` ${tech}` : ""} (${pct(techPct)}) — charge the tech this`, value: money(n("technicianPortion")), strong: true, hi: true },
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

  return { address, customer, tech, lines };
}

/* ── PROVIDER-facing projection ──────────────────────────────────────────
   A PROVIDER sees their own charge, never the company's internal split. This
   is an allow-list, not a filter on the full breakdown above: it reads only
   the fields named here, so a field added to the snapshot later cannot leak
   into a PROVIDER report by default. Every figure is read from the stored
   snapshot or the ledger entry itself — nothing is recalculated. */

/** Ledger roles that belong to a PROVIDER. Role strings are free text in the
 *  data ("provider", "Provider", "advertiser"), so they are normalised. */
export function isProviderLedgerRole(role: string | null | undefined): boolean {
  const r = String(role ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  return r === "provider" || r === "advertiser";
}

export interface ProviderDisputeInput {
  /** The PROVIDER's own job reference, when authorized for the report. */
  address?: string | null;
  /** The amount on the ledger entry itself — what actually hit the balance. */
  ledgerAmount: number;
}

export function providerDisputeDetail(
  snapshot: Record<string, unknown> | null | undefined,
  input: ProviderDisputeInput,
): DisputeDetail {
  if (!snapshot) return { address: "", customer: "", tech: "", lines: [] };
  const n = (k: string) => Number(snapshot[k]) || 0;
  const str = (k: string) => (snapshot[k] == null ? "" : String(snapshot[k]));
  const isRefund = str("type") === "refund";
  const kind = isRefund ? "Refund" : "Dispute";
  const classification = str("disputeClassification").toUpperCase();

  const lines: DisputeLine[] = [
    { label: kind, value: "", head: true },
    ...(classification ? [{ label: `${kind} type`, value: classification }] : []),
    { label: `${kind} amount`, value: money(n("disputeOrRefundAmount")) },
    { label: "PROVIDER share", value: money(n("providerCharge")) },
    { label: "PROVIDER charge", value: money(input.ledgerAmount), strong: true },
  ];

  return {
    address: str("address") || (input.address ?? "") || "",
    customer: str("customer_name"),
    tech: "",
    lines,
  };
}

/** A dispute/refund ledger line's label for a PROVIDER. The stored description
 *  names the charged party ("AM … + tech …"), which a PROVIDER must not see. */
export function providerDisputeLabel(type: string, snapshot: Record<string, unknown> | null | undefined, jobRef?: string | null): string {
  const kind = type === "refund" ? "Refund" : "Dispute";
  const customer = snapshot?.["customer_name"] == null ? "" : String(snapshot["customer_name"]);
  const who = customer || (jobRef ?? "");
  return who ? `${kind} — ${who}` : kind;
}
