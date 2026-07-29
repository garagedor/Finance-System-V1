import "server-only";
import type { fetchDashboardData } from "@/lib/portal-data";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";

// The Proactive Intelligence Framework.
//
// A detector is a self-contained DEFINITION. The engine iterates definitions,
// runs each in isolation, scores the findings, and never needs to change when a
// detector is added. Aim: 50–100+ detectors across every business area, each
// independently enabled/disabled and configurable — including future
// user-created ones.

export type DashboardData = Awaited<ReturnType<typeof fetchDashboardData>>;
export type DateWindow = { from: string; to: string };
export type AlertSeverity = "high" | "medium" | "low" | "info";

export type DetectorCategory =
  | "finance"
  | "technicians"
  | "area_managers"
  | "customers"
  | "operations"
  | "inventory"
  | "strategy";

/** Which executives own which categories by default (responsibilities map). */
export const CATEGORY_OWNERS: Record<DetectorCategory, string[]> = {
  finance: ["cfo"],
  technicians: ["operations"],
  area_managers: ["controller", "operations"],
  customers: ["analyst"],
  operations: ["operations"],
  inventory: ["operations"],
  strategy: ["strategy"],
};

export type LedgerBalance = {
  ledgerId: string;
  name: string;
  role: string | null;
  location: string | null;
  balance: number;
};

/** Shared, pre-computed inputs handed to every detector — built ONCE per run so
 *  100 detectors don't each hit the database. */
export type DetectorContext = {
  today: string;
  windows: { last7: DateWindow; last30: DateWindow; prev30: DateWindow };
  dashboard30: DashboardData;
  dashboardPrev30: DashboardData;
  bankTxns: BankTransactionSyncedRecord[]; // last ~60 days
  ledgerBalances: LedgerBalance[];
  /** This detector's merged config (defaults + user overrides). */
  cfg: Record<string, number | boolean>;
};

/** A raw detector output. Priority inputs are optional — the scorer uses what's
 *  present. Recommendation fields explain WHY + WHAT to do. */
export type RawFinding = {
  key: string; // unique subject key within the detector
  severity?: AlertSeverity;
  title: string;
  detail: string;
  metric?: string; // short headline figure, e.g. "$10,445"
  // Priority inputs
  financialImpact?: number; // dollar exposure
  confidence?: number; // 0..1 — how sure we are it's real
  urgency?: number; // 0..1 — time-sensitivity
  probability?: number; // 0..1 — likelihood it's actionable
  businessRisk?: number; // 0..1
  estimatedMinutes?: number; // effort to resolve
  // Recommendation engine
  whyItMatters?: string;
  businessImpact?: string;
  rootCause?: string;
  recommendedAction?: string;
  estimatedEffort?: string; // human-readable, e.g. "~8 minutes"
  evidence?: Record<string, unknown>;
};

export type DetectorConfigField = {
  key: string;
  label: string;
  type: "number" | "boolean";
  default: number | boolean;
  description?: string;
};

/** The whole contract for adding a detector. Add one of these — nothing else. */
export type DetectorDefinition = {
  id: string; // stable, namespaced, e.g. "finance.duplicate_payments"
  title: string;
  description: string;
  category: DetectorCategory;
  executives: string[]; // one or more persona slugs
  defaultSeverity: AlertSeverity;
  enabledByDefault: boolean;
  configFields?: DetectorConfigField[];
  detect: (ctx: DetectorContext) => RawFinding[] | Promise<RawFinding[]>;
};

export type PriorityFactors = {
  impact: number;
  severity: number;
  urgency: number;
  probability: number;
  risk: number;
  confidence: number;
  quickWin: number;
};

/** A finding after the framework attaches identity + a priority score. */
export type ScoredFinding = RawFinding & {
  detectorId: string;
  category: DetectorCategory;
  executives: string[];
  severity: AlertSeverity;
  priority: number; // 0..100
  priorityFactors: PriorityFactors;
};

/** Read a numeric config value with a fallback. */
export function cfgNum(ctx: DetectorContext, key: string, fallback: number): number {
  const v = ctx.cfg[key];
  return typeof v === "number" ? v : fallback;
}
