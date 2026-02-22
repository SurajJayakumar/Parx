import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAlert } from "@/lib/alerts/logAlert";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const LogSchema = z.object({
  uid: z.string().min(1),
  caregiverEmail: z.string().email(),
  patientName: z.string().min(1),
  severityScore: z.number().min(0).max(10),
  severityLabel: z.string().min(1),
  reasons: z.array(z.string()),
  /** Client-supplied epoch ms. Defaults to server time when omitted. */
  createdAtMs: z.number().positive().optional(),
});

type LogInput = z.infer<typeof LogSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

// ---------------------------------------------------------------------------
// POST /api/alerts/log
// ---------------------------------------------------------------------------

/**
 * Logs a severity alert event to Firestore under users/{uid}/alerts/{autoId}.
 *
 * This endpoint is intentionally lightweight — validation, one Firestore write,
 * and a response. Authentication enforcement should be added (e.g. verify the
 * Firebase ID token from the Authorization header) before exposing this in prod.
 */
export async function POST(req: NextRequest) {
  // 1. Parse + validate
  let input: LogInput;
  try {
    const body = await req.json();
    input = LogSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const detail = err.issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      return fail(`Validation error — ${detail}`, 422);
    }
    return fail("Request body must be valid JSON.", 400);
  }

  // 2. Write to Firestore
  let docId: string;
  try {
    docId = await logAlert(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Failed to write alert log: ${msg}`, 500);
  }

  return ok({ docId }, 201);
}
