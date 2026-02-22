import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assessRisk } from "@/lib/alerts/risk";
import {
  canSend,
  markSent,
  HIGH_RISK_COOLDOWN_MS,
} from "@/lib/alerts/throttle";
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

const IngestSchema = z.object({
  caregiverEmail: z.string().email(),
  patientName: z.string().min(1),
  metrics: MetricsSchema,
  dashboardUrl: z.string().url(),
  reportUrl: z.string().url().optional(),
});

type IngestInput = z.infer<typeof IngestSchema>;

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

  const { caregiverEmail, patientName, metrics, dashboardUrl, reportUrl } =
    input;

  // 2. Assess risk
  let assessment: ReturnType<typeof assessRisk>;
  try {
    assessment = assessRisk(metrics);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Risk assessment failed: ${msg}`, 500);
  }

  const { severity, riskScore, reasons } = assessment;
  const base = { severity, riskScore, reasons };

  // 3. Non-high severity — no email needed
  if (severity !== "high") {
    return ok({ sent: false, ...base });
  }

  // 4. High severity — check throttle
  const throttleKey = `${caregiverEmail}:${patientName}`;
  if (!canSend(throttleKey, HIGH_RISK_COOLDOWN_MS)) {
    return ok({ sent: false, throttled: true, ...base });
  }

  // 5. Build + send alert email
  try {
    const { subject, html } = highRiskAlertTemplate({
      userName: patientName,
      detectedAt: new Date().toISOString(),
      sessionDescription: "Automated gait & movement assessment",
      observations: reasons,
      dashboardUrl,
      reportUrl,
    });

    await sendEmail({ to: caregiverEmail, subject, html });
    markSent(throttleKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Alert email could not be sent: ${msg}`, 502);
  }

  return ok({ sent: true, ...base });
}
