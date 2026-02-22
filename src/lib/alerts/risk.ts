import "server-only";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Gait and movement metrics captured during an assessment session.
 * All values are optional — missing metrics are skipped in scoring.
 */
export type Metrics = {
  /** Walking speed in metres per second. Typical healthy adult: 1.2–1.6 m/s. */
  walkingSpeed?: number;
  /** Step length in centimetres. Typical healthy adult: 60–80 cm. */
  stepLength?: number;
  /** Arm swing angle in degrees (average per side). Typical healthy adult: 30–45°. */
  armSwing?: number;
};

export type Severity = "low" | "medium" | "high";

export interface RiskAssessment {
  severity: Severity;
  /** Composite score clamped to [0, 100]. Higher = greater concern. */
  riskScore: number;
  /** Human-readable explanations for each contributing factor. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Thresholds
// Each metric contributes an independent sub-score (0–100) and, when outside
// a normal range, appends a plain-language reason string.
// ---------------------------------------------------------------------------

interface ThresholdResult {
  subScore: number;
  reason: string | null;
}

/**
 * Walking speed scoring.
 * ≥ 1.0 m/s  → 0   (normal)
 * 0.8–1.0    → 30  (mildly reduced)
 * 0.6–0.8    → 60  (moderately reduced)
 * < 0.6      → 90  (markedly reduced)
 */
function scoreWalkingSpeed(mps: number): ThresholdResult {
  if (mps >= 1.0) {
    return { subScore: 0, reason: null };
  }
  if (mps >= 0.8) {
    return {
      subScore: 30,
      reason: `Walking speed (${mps.toFixed(2)} m/s) is mildly below the typical range (≥ 1.0 m/s).`,
    };
  }
  if (mps >= 0.6) {
    return {
      subScore: 60,
      reason: `Walking speed (${mps.toFixed(2)} m/s) is moderately below the typical range (≥ 1.0 m/s).`,
    };
  }
  return {
    subScore: 90,
    reason: `Walking speed (${mps.toFixed(2)} m/s) is markedly reduced compared to the typical range (≥ 1.0 m/s).`,
  };
}

/**
 * Step length scoring.
 * ≥ 55 cm    → 0   (normal)
 * 40–55 cm   → 30  (mildly reduced)
 * 25–40 cm   → 65  (moderately reduced — shuffling gait pattern)
 * < 25 cm    → 90  (markedly reduced)
 */
function scoreStepLength(cm: number): ThresholdResult {
  if (cm >= 55) {
    return { subScore: 0, reason: null };
  }
  if (cm >= 40) {
    return {
      subScore: 30,
      reason: `Step length (${cm.toFixed(1)} cm) is mildly shorter than the typical range (≥ 55 cm).`,
    };
  }
  if (cm >= 25) {
    return {
      subScore: 65,
      reason: `Step length (${cm.toFixed(1)} cm) shows a shuffling-gait pattern (typical range ≥ 55 cm).`,
    };
  }
  return {
    subScore: 90,
    reason: `Step length (${cm.toFixed(1)} cm) is markedly reduced; shuffling-gait pattern observed.`,
  };
}

/**
 * Arm swing scoring.
 * ≥ 25°      → 0   (normal)
 * 15–25°     → 35  (mildly reduced)
 * 8–15°      → 65  (moderately reduced)
 * < 8°       → 90  (markedly reduced / near absent)
 */
function scoreArmSwing(degrees: number): ThresholdResult {
  if (degrees >= 25) {
    return { subScore: 0, reason: null };
  }
  if (degrees >= 15) {
    return {
      subScore: 35,
      reason: `Arm swing (${degrees.toFixed(1)}°) is mildly reduced compared to the typical range (≥ 25°).`,
    };
  }
  if (degrees >= 8) {
    return {
      subScore: 65,
      reason: `Arm swing (${degrees.toFixed(1)}°) is moderately reduced; reduced pendular movement detected.`,
    };
  }
  return {
    subScore: 90,
    reason: `Arm swing (${degrees.toFixed(1)}°) is markedly reduced or near-absent; significant change detected.`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assesses movement patterns and returns a composite risk score with
 * plain-language reasons for each contributing factor.
 *
 * - Scores from each present metric are averaged (missing metrics are ignored).
 * - The composite score is clamped to [0, 100].
 * - Severity bands: low < 35, medium 35–64, high ≥ 65.
 */
export function assessRisk(metrics: Metrics): RiskAssessment {
  const results: ThresholdResult[] = [];

  if (metrics.walkingSpeed !== undefined) {
    results.push(scoreWalkingSpeed(metrics.walkingSpeed));
  }
  if (metrics.stepLength !== undefined) {
    results.push(scoreStepLength(metrics.stepLength));
  }
  if (metrics.armSwing !== undefined) {
    results.push(scoreArmSwing(metrics.armSwing));
  }

  const reasons = results
    .map((r) => r.reason)
    .filter((r): r is string => r !== null);

  const rawScore =
    results.length === 0
      ? 0
      : results.reduce((sum, r) => sum + r.subScore, 0) / results.length;

  const riskScore = Math.round(Math.min(100, Math.max(0, rawScore)));

  const severity: Severity =
    riskScore >= 65 ? "high" : riskScore >= 35 ? "medium" : "low";

  return { severity, riskScore, reasons };
}
