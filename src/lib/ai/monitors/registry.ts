import "server-only";
import type { DetectorDefinition } from "./framework";
import { FINANCE_DETECTORS } from "./detectors";

// The detector catalog. New categories plug in by importing their array here —
// nothing else in the engine changes. Future:
//   ...TECHNICIAN_DETECTORS, ...AREA_MANAGER_DETECTORS, ...CUSTOMER_DETECTORS,
//   ...OPERATIONS_DETECTORS, ...INVENTORY_DETECTORS, ...STRATEGY_DETECTORS,
//   ...USER_DETECTORS (custom, DB-defined)
export const ALL_DETECTORS: DetectorDefinition[] = [...FINANCE_DETECTORS];

export function getDetector(id: string): DetectorDefinition | undefined {
  return ALL_DETECTORS.find((d) => d.id === id);
}
