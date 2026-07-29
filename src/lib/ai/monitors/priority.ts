import "server-only";
import type { AlertSeverity, PriorityFactors, RawFinding } from "./framework";

// The Priority Engine. Turns a finding into a 0–100 score from six signals:
// financial impact, severity, urgency, probability, business risk, confidence —
// plus a quick-win nudge (fast-to-resolve items rank a little higher). Fully
// deterministic (no AI cost); every alert gets scored the same way.

const SEV_WEIGHT: Record<AlertSeverity, number> = { high: 1, medium: 0.65, low: 0.35, info: 0.15 };

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// $100k exposure ≈ 1.0; $10k ≈ 0.8; $1k ≈ 0.6 — log-scaled so big money dominates.
function impactScore(usd: number): number {
  if (usd <= 0) return 0;
  return clamp01(Math.log10(usd + 1) / Math.log10(100_000 + 1));
}

export function scoreFinding(
  f: RawFinding,
  defaultSeverity: AlertSeverity,
): { priority: number; severity: AlertSeverity; factors: PriorityFactors } {
  const severity = f.severity ?? defaultSeverity;
  const sev = SEV_WEIGHT[severity];

  const impact = f.financialImpact != null ? impactScore(f.financialImpact) : sev * 0.5;
  const confidence = clamp01(f.confidence ?? 0.7);
  const urgency = clamp01(
    f.urgency ?? (severity === "high" ? 0.85 : severity === "medium" ? 0.55 : 0.3),
  );
  const probability = clamp01(f.probability ?? confidence);
  const risk = clamp01(f.businessRisk ?? sev);
  const quickWin = f.estimatedMinutes != null ? clamp01(1 - f.estimatedMinutes / 240) : 0.4;

  const raw =
    0.34 * impact +
    0.18 * sev +
    0.14 * urgency +
    0.12 * risk +
    0.1 * probability +
    0.06 * confidence +
    0.06 * quickWin;

  return {
    priority: Math.round(clamp01(raw) * 100),
    severity,
    factors: { impact, severity: sev, urgency, probability, risk, confidence, quickWin },
  };
}
