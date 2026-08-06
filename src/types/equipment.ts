// Equipment Ordering & Finance workflow.
//
// The company buys equipment at an internal COMPANY COST and resells it to
// Area Managers at a predefined SELLING PRICE. A product catalog holds both
// prices; an order snapshots the prices at order time (immutable history) and,
// once approved/delivered, posts the AM SELLING TOTAL ONLY as a debit to that
// AM's finance ledger (company cost is internal profitability data — never
// charged to the AM). See src/lib/equipment/* for the services + capabilities.

export type SellingUnit = "unit" | "pair" | "box" | "set" | "roll" | "kit" | "each";

export const SELLING_UNITS: SellingUnit[] = ["unit", "pair", "box", "set", "roll", "kit", "each"];

// ── Product catalog ─────────────────────────────────────────────────────────

export interface EquipmentProduct {
  _id: string;                    // newId("prod")
  name: string;
  sku: string;                    // internal product code
  category: string;
  description?: string | null;
  sellingUnit: SellingUnit;
  companyCost: number;            // internal cost — profitability only, never charged
  amPrice: number;                // area-manager selling price — the charged amount
  active: boolean;
  trackInventory?: boolean;
  stockQty?: number | null;       // only meaningful when trackInventory
  notes?: string | null;          // internal notes
  created_at: string;
  created_by?: string;
  updated_at?: string;
  updated_by?: string;
}

// ── Orders ──────────────────────────────────────────────────────────────────

export type EquipmentOrderStatus =
  | "Draft"
  | "PendingApproval"
  | "Approved"
  | "ReadyForPickup"
  | "Delivered"
  | "ChargedToLedger"
  | "PartiallyReturned"
  | "Returned"
  | "Cancelled";

export const EQUIPMENT_ORDER_STATUSES: EquipmentOrderStatus[] = [
  "Draft", "PendingApproval", "Approved", "ReadyForPickup", "Delivered",
  "ChargedToLedger", "PartiallyReturned", "Returned", "Cancelled",
];

/** A ledger charge may be posted only from these statuses (never Draft). */
export const LEDGER_POSTABLE_STATUSES: EquipmentOrderStatus[] = ["Approved", "Delivered"];

export type DeliveryMethod = "pickup" | "delivery" | "shipping" | "other";

// Immutable price snapshot captured when the order is created. Future catalog
// price changes must NEVER alter historical orders (spec §3).
export interface EquipmentOrderItem {
  productId: string;
  productNameSnapshot: string;
  skuSnapshot: string;
  sellingUnitSnapshot: SellingUnit | string;
  qty: number;
  companyCostSnapshot: number;    // per-unit company cost at order time
  amPriceSnapshot: number;        // per-unit AM price at order time
  costLineTotal: number;          // companyCostSnapshot * qty
  chargeLineTotal: number;        // amPriceSnapshot * qty
}

export interface EquipmentOrderTotals {
  itemCount: number;              // total number of units across all lines
  lineCount: number;              // number of distinct product lines
  companyCostTotal: number;       // Σ costLineTotal — internal only
  amChargeTotal: number;          // Σ chargeLineTotal — the amount posted to ledger
  grossProfit: number;            // amChargeTotal − companyCostTotal
  grossMarginPct: number;         // grossProfit / amChargeTotal * 100 (0 when no charge)
}

export interface EquipmentOrder {
  _id: string;                    // newId("eord") — also the ledger idempotency key
  orderNumber: string;            // sequential, e.g. "EQ-2026-0001"
  areaManagerId: string | null;   // CRM AreaManager._id (roster ref, ObjectId string)
  areaManagerName: string;        // ledger holder key (ledgers key off NAME)
  area?: string | null;
  orderDate: string;              // YYYY-MM-DD
  createdBy: string;
  deliveryMethod?: DeliveryMethod | string | null;
  expectedDeliveryAt?: string | null;
  notes?: string | null;
  status: EquipmentOrderStatus;
  items: EquipmentOrderItem[];    // embedded price snapshots
  totals: EquipmentOrderTotals;

  // Ledger link (set once, on post). Permanent — never edited/deleted.
  ledgerId?: string | null;
  ledgerEntryId?: string | null;
  ledgerPostedAt?: string | null;
  ledgerPostedBy?: string | null;

  created_at: string;
  updated_at?: string;
  updated_by?: string;
  approved_at?: string | null;
  approved_by?: string | null;
  delivered_at?: string | null;
  delivered_by?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
}

// ── Returns / credits (Phase B — declared now so links exist) ────────────────

export interface EquipmentReturnItem {
  productId: string;
  productNameSnapshot: string;
  skuSnapshot: string;
  qtyReturned: number;
  amPriceSnapshot: number;        // carried from the original order line
  creditLineTotal: number;        // amPriceSnapshot * qtyReturned (if credited)
}

export interface EquipmentReturn {
  _id: string;                    // newId("eret")
  returnNumber: string;
  orderId: string;                // original EquipmentOrder._id
  orderNumber: string;
  areaManagerName: string;
  items: EquipmentReturnItem[];
  condition?: string | null;
  reason?: string | null;
  notes?: string | null;
  creditApproved: boolean;
  creditAmount: number;
  // Credit ledger link (a reversing entry against the original charge).
  originalLedgerEntryId?: string | null;
  creditLedgerEntryId?: string | null;
  creditPostedAt?: string | null;
  creditPostedBy?: string | null;
  status: "Draft" | "Approved" | "Credited" | "Cancelled";
  created_at: string;
  created_by?: string;
  updated_at?: string;
}
