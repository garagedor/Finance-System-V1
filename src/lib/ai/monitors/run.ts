import "server-only";
import { buildDetectorContext } from "./context";
import { getAllDetectorConfig } from "./config";
import { scoreFinding } from "./priority";
import { ALL_DETECTORS } from "./registry";
import type { ScoredFinding } from "./framework";

// The runner. Builds the shared context ONCE, runs each enabled detector in
// ISOLATION (a thrown detector is logged and skipped, never breaking the run),
// scores every finding, and returns them priority-ranked. Scales to 100+
// detectors without any change here.
export async function runAllDetectors(): Promise<ScoredFinding[]> {
  const [base, cfgMap] = await Promise.all([buildDetectorContext(), getAllDetectorConfig()]);
  const results: ScoredFinding[] = [];

  for (const det of ALL_DETECTORS) {
    const override = cfgMap[det.id];
    const enabled = override?.enabled ?? det.enabledByDefault;
    if (!enabled) continue;

    let findings;
    try {
      findings = await det.detect({ ...base, cfg: override?.config ?? {} });
    } catch (e) {
      console.error(`[ai] detector ${det.id} failed:`, e instanceof Error ? e.message : e);
      continue;
    }

    for (const f of findings) {
      const { priority, severity, factors } = scoreFinding(f, det.defaultSeverity);
      results.push({
        ...f,
        detectorId: det.id,
        category: det.category,
        executives: det.executives,
        severity,
        priority,
        priorityFactors: factors,
      });
    }
  }

  results.sort((a, b) => b.priority - a.priority);
  return results;
}
