import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assessRisk } from "@/lib/alerts/risk";
import {
  canSend,
  markSent,
  HIGH_RISK_COOLDOWN_MS,
  URGENT_COOLDOWN_MS,
} from "@/lib/alerts/throttle";
import { logAlertBestEffort } from "@/lib/alerts/logAlert";
import { computeSeverity } from "@/lib/severity/severityScore";
import { highRiskAlertTemplate } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/sendEmail";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const MetricsSchema = z.object({
  walkingSpeed: z.number().nonnegative().optional(),
  stepLength: z.number().nonnegative().optional(),
  armSwing: z.number().nonnegative().optional(),
});

const InferenceSchema = z.object({
  timestampMs: z.number().optional(),
  walkingSpeedMps: z.number().nonnegative().optional(),
  stepLengthM: z.number().nonnegative().optional(),
  turnFragmentation: z.boolean().optional(),
  tremorDetected: z.boolean().optional(),
  armSwingAsymmetry: z.boolean().optional(),
  freezingDetected: z.boolean().optional(),
  fallDetected: z.boolean().optional(),
  immobileSeconds: z.number().nonnegative().optional(),
});

const IngestSchema = z.object({
  /** Firebase Auth uid of the patient. When supplied, alert events are logged to Firestore. */
  uid: z.string().min(1).optional(),
  caregiverEmail: z.string().email(),
  patientName: z.string().min(1),
  metrics: MetricsSchema,
  /** ML-model inference output. When present it drives severity scoring. */
  inference: InferenceSchema.optional(),
  dashboardUrl: z.string().url(),
  reportUrl: z.string().url().optional(),
});

type IngestInput = z.infer<typeof IngestSchema>;

// ---------------------------------------------------------------------------
// Severity thresholds
// ---------------------------------------------------------------------------

/** severityScore at or above this value triggers an alert email. */
const ALERT_THRESHOLD = 5;

/** severityScore at or above this value is considered urgent. */
const URGENT_THRESHOLD = 8;

/**
 * severityScore at or above this value may bypass the normal 6-hour throttle,
 * falling back to the shorter URGENT_COOLDOWN_MS window instead.
 */
const THROTTLE_BYPASS_THRESHOLD = 9;

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function ok(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

// ---------------------------------------------------------------------------
// POST /api/sessions/ingest
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // 1. Parse + validate body
  let input: IngestInput;
  try {
    const body = await req.json();
    input = IngestSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const detail = err.issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      return fail(`Validation error — ${detail}`, 422);
    }
    return fail("Request body must be valid JSON.", 400);
  }

  const { uid, caregiverEmail, patientName, metrics, inference, dashboardUrl, reportUrl } =
    input;

  // 2. Compute severity from inference (when provided) and derive risk assessment
  const {
    score: severityScore,
    label: severityLabel,
    reasons: severityReasons,
  } = inference ? computeSeverity(inference) : { score: 0, label: "normal" as const, reasons: [] };

  let assessment: ReturnType<typeof assessRisk>;
  try {
    assessment = assessRisk(metrics, inference);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Risk assessment failed: ${msg}`, 500);
  }

  const { riskLevel, riskScore } = assessment;

  // Merge reasons: severity reasons first, then any extra gait-metric reasons
  const reasons = [
    ...severityReasons,
    ...assessment.reasons.filter((r) => !severityReasons.includes(r)),
  ];

  const base = { severityScore, severityLabel, reasons, riskScore, riskLevel };

  // 3. Not alert-worthy — no email needed
  if (severityScore < ALERT_THRESHOLD) {
    return ok({ sent: false, ...base });
  }

  // 4. Log the alert event to Firestore (best effort — never blocks the response)
  if (uid) {
    logAlertBestEffort({
      uid,
      caregiverEmail,
      patientName,
      severityScore,
      severityLabel,
      reasons,
      createdAtMs: Date.now(),
    });
  }

  // 6. Determine urgency and select the appropriate throttle window
  const isUrgent = severityScore >= URGENT_THRESHOLD;
  const canBypassNormalThrottle = severityScore >= THROTTLE_BYPASS_THRESHOLD;

  const throttleKey = `${caregiverEmail}:${patientName}`;
  const urgentThrottleKey = `${throttleKey}:urgent`;

  // For bypass-eligible events, allow sending if either:
  //   (a) the normal 6-hour window has elapsed, OR
  //   (b) the 30-minute urgent window has elapsed
  const normalWindowOpen = canSend(throttleKey, HIGH_RISK_COOLDOWN_MS);
  const urgentWindowOpen =
    canBypassNormalThrottle && canSend(urgentThrottleKey, URGENT_COOLDOWN_MS);

  if (!normalWindowOpen && !urgentWindowOpen) {
    return ok({ sent: false, throttled: true, ...base });
  }

  // 7. Build + send alert email
  try {
    const { subject, html } = highRiskAlertTemplate({
      userName: patientName,
      detectedAt: new Date().toISOString(),
      sessionDescription: "Automated gait & movement assessment",
      observations: reasons.length > 0 ? reasons : ["Elevated risk pattern detected."],
      dashboardUrl,
      reportUrl,
      urgent: isUrgent,
      severityScore,
      severityLabel,
    });

    await sendEmail({ to: caregiverEmail, subject, html });

    // Mark both keys so the appropriate window resets correctly
    markSent(throttleKey);
    if (canBypassNormalThrottle) {
      markSent(urgentThrottleKey);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Alert email could not be sent: ${msg}`, 502);
  }

  return ok({ sent: true, urgent: isUrgent, ...base });
}
