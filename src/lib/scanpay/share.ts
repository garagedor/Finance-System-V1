import "server-only";
import type { DisputeChargeSnapshot } from "@/lib/dispute-charge";
import type { ScanpayComputedShare } from "@/types/scanpay";

// Build the stored share (party charges + the actual job's collected/amount/tip)
// from the engine's dry-run snapshot. Single place so every entry point captures
// the collected pulled from the real CRM job.
export function shareFromSnapshot(s: DisputeChargeSnapshot): ScanpayComputedShare {
  return {
    providerCharge: s.providerCharge,
    technicianPortion: s.technicianPortion,
    areaManagerOwnPortion: s.areaManagerOwnPortion,
    companyCharge: s.companyCharge,
    amLedgerCharge: s.amLedgerCharge,
    partsLoss: s.partsLoss,
    jobCollected: s.totalCollected,
    jobAmount: s.jobAmount,
    grossTip: s.grossTip,
  };
}
