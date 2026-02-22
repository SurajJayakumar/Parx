import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { weeklySummaryTemplate } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/sendEmail";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const WeeklySchema = z.object({
  caregiverEmail: z.string().email(),
  patientName: z.string().min(1),
  /** Human-readable week label, e.g. "Feb 17–23, 2026" */
  weekRange: z.string().min(1),
  /** Flat map of metric name → value, e.g. { walkingSpeed: 1.2, stepLength: 0.65 } */
  metrics: z.record(z.string(), z.number()),
  /** Short prose summary of observed trends for the week */
  trendSummary: z.string().min(1),
  dashboardUrl: z.string().url(),
  reportUrl: z.string().url().optional(),
});

type WeeklyInput = z.infer<typeof WeeklySchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Convert the flat metrics record to a formatted bullet list.
 * e.g. { walkingSpeed: 1.2 } → ["Walking speed: 1.2"]
 */
function metricsToLines(metrics: Record<string, number>): string[] {
  return Object.entries(metrics).map(([key, value]) => {
    const label = key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
    return `${label}: ${value}`;
  });
}

// ---------------------------------------------------------------------------
// POST /api/alerts/weekly
// Hook this endpoint to Vercel Cron weekly.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // 1. Parse + validate
  let input: WeeklyInput;
  try {
    const body = await req.json();
    input = WeeklySchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const detail = err.issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      return fail(`Validation error — ${detail}`, 422);
    }
    return fail("Request body must be valid JSON.", 400);
  }

  const {
    caregiverEmail,
    patientName,
    weekRange,
    metrics,
    trendSummary,
    dashboardUrl,
    reportUrl,
  } = input;

  // 2. Build email content
  const metricLines = metricsToLines(metrics);
  const { subject, html } = weeklySummaryTemplate({
    userName: patientName,
    weekLabel: weekRange,
    sessionsCompleted: metricLines.length,
    trendsObserved: [trendSummary, ...metricLines],
    dashboardUrl,
    reportUrl,
  });

  // 3. Send
  try {
    await sendEmail({ to: caregiverEmail, subject, html });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `Email could not be sent: ${msg}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
