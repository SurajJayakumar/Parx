import "server-only";

import { Resend } from "resend";
import { getServerEnv } from "@/lib/env.server";

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const { RESEND_API_KEY } = getServerEnv();
    _resend = new Resend(RESEND_API_KEY);
  }
  return _resend;
}

/**
 * Sends an email via Resend and returns the message id.
 * Throws a descriptive error if the send fails.
 */
export async function sendEmail({
  to,
  subject,
  html,
  attachments,
}: SendEmailOptions): Promise<string> {
  const { ALERTS_FROM_EMAIL } = getServerEnv();

  const { data, error } = await getResend().emails.send({
    from: ALERTS_FROM_EMAIL,
    to,
    subject,
    html,
    attachments: attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });

  if (error || !data) {
    const detail = error
      ? `${error.name}: ${error.message} (status ${error.statusCode})`
      : "No data returned from Resend";
    throw new Error(`Failed to send email to "${to}": ${detail}`);
  }

  return data.id;
}
