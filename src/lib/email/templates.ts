// Pure data-transformation module — no server-only import needed (no secrets used here).

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const BRAND_COLOR = "#2563eb"; // blue-600
const WARN_COLOR = "#dc2626";  // red-600
const MUTED = "#6b7280";       // gray-500
const DISCLAIMER =
  "<em>This is not a medical diagnosis. Always consult a qualified healthcare professional before making any medical decisions.</em>";

function layout(accentColor: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:8px;overflow:hidden;
                      box-shadow:0 1px 3px rgba(0,0,0,0.1);max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:${accentColor};padding:24px 32px;">
              <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">
                Parkinson AI
              </span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e5e7eb;background:#f9fafb;">
              <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">
                ${DISCLAIMER}
              </p>
              <p style="margin:8px 0 0;font-size:12px;color:${MUTED};">
                You received this email because you have alerts enabled on your Parkinson AI account.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function bulletList(items: string[]): string {
  const rows = items
    .map(
      (item) =>
        `<tr>
           <td style="padding:4px 0;vertical-align:top;width:20px;color:#6b7280;">&#8226;</td>
           <td style="padding:4px 0;font-size:15px;line-height:1.6;color:#374151;">${item}</td>
         </tr>`
    )
    .join("\n");
  return `<table cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;">${rows}</table>`;
}

function ctaButton(label: string, href: string, color = BRAND_COLOR): string {
  return `<a href="${href}"
     style="display:inline-block;margin-top:24px;padding:12px 24px;
            background:${color};color:#ffffff;font-size:15px;font-weight:600;
            border-radius:6px;text-decoration:none;">
    ${label}
  </a>`;
}

function linkLine(label: string, href: string): string {
  return `<p style="margin:8px 0;font-size:14px;">
    ${label}: <a href="${href}" style="color:${BRAND_COLOR};text-decoration:underline;">${href}</a>
  </p>`;
}

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

export interface HighRiskAlertInput {
  /** Recipient's display name */
  userName: string;
  /** ISO 8601 timestamp of when the alert was triggered */
  detectedAt: string;
  /** Short human-readable description of the session or activity assessed */
  sessionDescription: string;
  /** Specific observations that raised the alert (2-5 items) */
  observations: string[];
  /** Full URL to the user's dashboard */
  dashboardUrl: string;
  /** Full URL to the specific report, if available */
  reportUrl?: string;
}

export interface ReportReadyInput {
  /** Recipient's display name */
  userName: string;
  /** Human-readable label for the report period, e.g. "Week of Feb 17–23, 2026" */
  reportPeriod: string;
  /** Key findings from the report (2-5 items) */
  highlights: string[];
  /** Full URL to the user's dashboard */
  dashboardUrl: string;
  /** Full URL to download or view the report */
  reportUrl: string;
}

export interface WeeklySummaryInput {
  /** Recipient's display name */
  userName: string;
  /** Human-readable label for the week, e.g. "Feb 17–23, 2026" */
  weekLabel: string;
  /** Number of sessions completed during the week */
  sessionsCompleted: number;
  /** Notable trends or changes observed this week (2-5 items) */
  trendsObserved: string[];
  /** Any positive consistency streaks or improvements (optional) */
  highlights?: string[];
  /** Full URL to the user's dashboard */
  dashboardUrl: string;
  /** Full URL to the weekly report, if generated */
  reportUrl?: string;
}

// ---------------------------------------------------------------------------
// Template return type
// ---------------------------------------------------------------------------

export interface EmailTemplate {
  subject: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Exported templates
// ---------------------------------------------------------------------------

/**
 * Sent immediately when the AI detects patterns that warrant a high-priority alert.
 */
export function highRiskAlertTemplate(input: HighRiskAlertInput): EmailTemplate {
  const {
    userName,
    detectedAt,
    sessionDescription,
    observations,
    dashboardUrl,
    reportUrl,
  } = input;

  const formattedDate = new Date(detectedAt).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${WARN_COLOR};">
      Attention Required
    </h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
      Hi ${userName}, Parkinson AI detected notable patterns during your recent activity
      that may warrant your attention or a conversation with your care team.
    </p>

    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.05em;">
      Session
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827;">${sessionDescription}</p>

    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.05em;">
      Detected at
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827;">${formattedDate}</p>

    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.05em;">
      Changes observed
    </p>
    ${bulletList(observations)}

    ${ctaButton("View Dashboard", dashboardUrl, WARN_COLOR)}
    ${reportUrl ? `<br/>${ctaButton("View Full Report", reportUrl, BRAND_COLOR)}` : ""}

    <hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb;" />
    <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.6;">
      If you believe this alert was triggered in error, you can review and dismiss it
      from your <a href="${dashboardUrl}" style="color:${BRAND_COLOR};">dashboard</a>.
    </p>
  `;

  return {
    subject: `[Parkinson AI] Attention Required — Patterns Detected in Your Recent Session`,
    html: layout(WARN_COLOR, body),
  };
}

/**
 * Sent when a new AI-generated report is ready for the user to review.
 */
export function reportReadyTemplate(input: ReportReadyInput): EmailTemplate {
  const { userName, reportPeriod, highlights, dashboardUrl, reportUrl } = input;

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">
      Your Report Is Ready
    </h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
      Hi ${userName}, your Parkinson AI report for <strong>${reportPeriod}</strong>
      has been generated and is ready to review.
    </p>

    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.05em;">
      Key patterns &amp; changes observed
    </p>
    ${bulletList(highlights)}

    ${ctaButton("View Report", reportUrl)}
    <br />
    ${linkLine("Dashboard", dashboardUrl)}
  `;

  return {
    subject: `[Parkinson AI] Your Report for ${reportPeriod} Is Ready`,
    html: layout(BRAND_COLOR, body),
  };
}

/**
 * Sent at the end of each week with a summary of activity and observed trends.
 */
export function weeklySummaryTemplate(input: WeeklySummaryInput): EmailTemplate {
  const {
    userName,
    weekLabel,
    sessionsCompleted,
    trendsObserved,
    highlights,
    dashboardUrl,
    reportUrl,
  } = input;

  const sessionWord = sessionsCompleted === 1 ? "session" : "sessions";

  const highlightsSection =
    highlights && highlights.length > 0
      ? `<p style="margin:16px 0 4px;font-size:13px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.05em;">
           Consistency &amp; improvements
         </p>
         ${bulletList(highlights)}`
      : "";

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">
      Weekly Summary — ${weekLabel}
    </h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
      Hi ${userName}, here is your Parkinson AI summary for the week of
      <strong>${weekLabel}</strong>. You completed
      <strong>${sessionsCompleted} ${sessionWord}</strong> this week.
    </p>

    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.05em;">
      Trends &amp; changes observed
    </p>
    ${bulletList(trendsObserved)}

    ${highlightsSection}

    ${ctaButton("View Dashboard", dashboardUrl)}
    ${reportUrl ? `<br />${linkLine("Full weekly report", reportUrl)}` : ""}
  `;

  return {
    subject: `[Parkinson AI] Your Weekly Summary — ${weekLabel}`,
    html: layout(BRAND_COLOR, body),
  };
}
