import type { EquipmentOrderStatus } from "@/types/equipment";

const CLASS: Record<EquipmentOrderStatus, string> = {
  Draft: "pill-draft",
  PendingApproval: "pill-pending",
  Approved: "pill-open",
  ReadyForPickup: "pill-pending",
  Delivered: "pill-open",
  ChargedToLedger: "pill-paid",
  PartiallyReturned: "pill-pending",
  Returned: "pill-unpaid",
  Cancelled: "pill-unpaid",
};

const LABEL: Record<EquipmentOrderStatus, string> = {
  Draft: "Draft",
  PendingApproval: "Pending approval",
  Approved: "Approved",
  ReadyForPickup: "Ready for pickup",
  Delivered: "Delivered",
  ChargedToLedger: "Charged to ledger",
  PartiallyReturned: "Partially returned",
  Returned: "Returned",
  Cancelled: "Cancelled",
};

export function EquipmentStatusPill({ status }: { status: EquipmentOrderStatus }) {
  return <span className={`pill ${CLASS[status] ?? "pill-draft"}`}>{LABEL[status] ?? status}</span>;
}

const RETURN_CLASS: Record<string, string> = {
  Draft: "pill-draft",
  Approved: "pill-pending",
  Credited: "pill-paid",
  Cancelled: "pill-unpaid",
};

export function ReturnStatusPill({ status }: { status: string }) {
  return <span className={`pill ${RETURN_CLASS[status] ?? "pill-draft"}`}>{status}</span>;
}
