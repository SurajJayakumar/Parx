import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { reportReadyTemplate } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/sendEmail";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const SeveritySchema = z.enum(["low", "medium", "high"]);

const NotifySchema = z.object({
  caregiverEmail: z.string().email(),
  patientName: z.string().min(1),
  /** ISO 8601 date string or any human-readable date label, e.g. "2026-02-21" */
  reportDate: z.string().min(1),
  severity: SeveritySchema,
  riskScore: z.number().min(0).max(100),
  dashboardUrl: z.string().url(),
  reportUrl: z.string().url(),
  /** Base64-encoded PDF. When present the report is attached to the email. */
  pdfBase64: z.string().min(1).optional(),
});

type NotifyInput = z.infer<typeof NotifySchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Map severity + riskScore to concise bullet-point highlights for the template. */
function buildHighlights(
  patientName: string,
  severity: NotifyInput["severity"],
  riskScore: number,
  reportDate: string
): string[] {
  const severityLabel =
    severity === "high"
      ? "High — notable changes observed"
      : severity === "medium"
        ? "Medium — some changes observed"
        : "Low — patterns within expected range";

  return [
    `Patient: ${patientName}`,
    `Report date: ${reportDate}`,
    `Overall risk score: ${riskScore}/100`,
    `Alert level: ${severityLabel}`,
  ];
}

/** Format an ISO date string as a readable period label. */
function formatReportPeriod(reportDate: string): string {
  const d = new Date(reportDate);
  if (isNaN(d.getTime())) return reportDate; // fall back to the raw string if unparseable
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// ---------------------------------------------------------------------------
// POST /api/reports/notify
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // 1. Parse + validate
  let input: NotifyInput;
  try {
    const body = await req.json();
    input = NotifySchema.parse(body);
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
    reportDate,
    severity,
    riskScore,
    dashboardUrl,
    reportUrl,
    pdfBase64,
  } = input;

  // 2. Build email content
  const { subject, html } = reportReadyTemplate({
    userName: patientName,
    reportPeriod: formatReportPeriod(reportDate),
    highlights: buildHighlights(patientName, severity, riskScore, reportDate),
    dashboardUrl,
    reportUrl,
  });

  // 3. Send — attach PDF when provided
  try {
    await sendEmail({
      to: caregiverEmail,
      subject,
      html,
      attachments: pdfBase64
        ? [{ filename: "report.pdf", content: pdfBase64 }]
        : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `Email could not be sent: ${msg}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
