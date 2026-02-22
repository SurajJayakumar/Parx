import "server-only";

export type SeverityLabel = "normal" | "parkinson_walk" | "freezing" | "fall";

export type Inference = {
  timestampMs?: number;
  walkingSpeedMps?: number;
  stepLengthM?: number;
  turnFragmentation?: boolean;
  tremorDetected?: boolean;
  armSwingAsymmetry?: boolean;
  freezingDetected?: boolean;
  fallDetected?: boolean;
  immobileSeconds?: number;
};

export type SeverityResult = {
  score: number;
  label: SeverityLabel;
  reasons: string[];
};

// Thresholds based on published gait literature for reference ranges
const SLOW_SPEED_THRESHOLD_MPS = 1.0;
const SHORT_STEP_THRESHOLD_M = 0.4;

export function computeSeverity(inf: Inference): SeverityResult {
  const reasons: string[] = [];

  // --- Fall ---
  if (inf.fallDetected === true) {
    reasons.push("A fall event was detected.");
    if ((inf.immobileSeconds ?? 0) >= 10) {
      reasons.push(
        `Extended stillness after event (${inf.immobileSeconds}s ≥ 10s).`
      );
      return { score: 10, label: "fall", reasons };
    }
    return { score: 9, label: "fall", reasons };
  }

  // --- Freezing ---
  const prolongedImmobile = (inf.immobileSeconds ?? 0) >= 3;
  if (inf.freezingDetected === true || prolongedImmobile) {
    if (inf.freezingDetected) {
      reasons.push("Freezing-of-gait pattern was detected.");
    }
    if (prolongedImmobile) {
      reasons.push(
        `Prolonged stillness detected (${inf.immobileSeconds}s ≥ 3s).`
      );
    }
    if ((inf.immobileSeconds ?? 0) >= 8) {
      reasons.push(
        `Extended immobility (${inf.immobileSeconds}s ≥ 8s) increases concern.`
      );
      return { score: 7, label: "freezing", reasons };
    }
    return { score: 6, label: "freezing", reasons };
  }

  // --- Parkinson-walk indicators ---
  const slowSpeed =
    inf.walkingSpeedMps !== undefined &&
    inf.walkingSpeedMps < SLOW_SPEED_THRESHOLD_MPS;
  const shortStep =
    inf.stepLengthM !== undefined &&
    inf.stepLengthM < SHORT_STEP_THRESHOLD_M;
  const tremor = inf.tremorDetected === true;
  const turnFrag = inf.turnFragmentation === true;
  const asymmetry = inf.armSwingAsymmetry === true;

  const indicators = [slowSpeed, shortStep, tremor, turnFrag, asymmetry];
  const indicatorCount = indicators.filter(Boolean).length;

  if (indicatorCount > 0) {
    if (slowSpeed) {
      reasons.push(
        `Walking speed (${inf.walkingSpeedMps?.toFixed(2)} m/s) is below the reference range.`
      );
    }
    if (shortStep) {
      reasons.push(
        `Step length (${inf.stepLengthM?.toFixed(2)} m) is below the reference range.`
      );
    }
    if (tremor) {
      reasons.push("Tremor signal was detected during the session.");
    }
    if (turnFrag) {
      reasons.push("Fragmented turning pattern was observed.");
    }
    if (asymmetry) {
      reasons.push("Arm-swing asymmetry was noted.");
    }

    // Score starts at 2 and increments with each additional indicator, capped at 4
    const score = Math.min(2 + (indicatorCount - 1), 4);
    return { score, label: "parkinson_walk", reasons };
  }

  // --- Normal ---
  return {
    score: 0,
    label: "normal",
    reasons: ["No significant gait irregularities were detected."],
  };
}
