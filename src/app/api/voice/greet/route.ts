import { NextRequest, NextResponse } from "next/server";

// ─── Environment ─────────────────────────────────────────────────────────────

const FEATHERLESS_API_KEY = process.env.FEATHERLESS_API_KEY!;
const FEATHERLESS_BASE_URL = process.env.FEATHERLESS_BASE_URL!;
const FEATHERLESS_MODEL = process.env.FEATHERLESS_MODEL!;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID!;

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "caregiver" | "clinician";

// ─── Timeout helper ──────────────────────────────────────────────────────────

const TIMEOUT_MS = 30_000;

class TimeoutError extends Error {
  readonly stage: string;
  constructor(stage: string) {
    super("Request timeout");
    this.stage = stage;
  }
}

function withTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(id) };
}

// ─── LLM call ────────────────────────────────────────────────────────────────

async function generateGreeting(
  reportContext: string,
  mode: Mode
): Promise<string> {
  const { signal, clear } = withTimeout(TIMEOUT_MS);

  const modeNote =
    mode === "clinician"
      ? "The listener is a clinician — be precise and efficient, using clinical terms where helpful."
      : "The listener is a caregiver — use plain, warm language and avoid jargon.";

  const systemPrompt = `\
You are a Parkinson's disease mobility monitoring AI assistant speaking through voice.
${modeNote}

REPORT DATA:
${reportContext}

TASK — deliver a brief, friendly opening summary of this report:
- In exactly 1 to 2 sentences, tell the listener: what the main event or finding is, when it happened, and one key metric or severity detail.
- End with a short, natural invitation for the listener to ask follow-up questions (e.g. "Feel free to ask me anything about it.").
- Never use bullet points, numbered lists, headers, or markdown. Plain spoken prose only.
- Do not add a medical disclaimer in this greeting.`;

  try {
    const res = await fetch(`${FEATHERLESS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FEATHERLESS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: FEATHERLESS_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Please summarize the latest report for me." },
        ],
        max_tokens: 120,
        temperature: 0.45,
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[greet/llm] Featherless ${res.status}:`, body);
      throw new Error(`Featherless error ${res.status}`);
    }

    const json = await res.json();
    const reply: string = json?.choices?.[0]?.message?.content ?? "";
    if (!reply.trim()) throw new Error("Empty reply from LLM");
    return reply;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TimeoutError("llm");
    }
    throw err;
  } finally {
    clear();
  }
}

// ─── TTS ─────────────────────────────────────────────────────────────────────

async function synthesize(text: string): Promise<ArrayBuffer> {
  const { signal, clear } = withTimeout(TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal,
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`[greet/tts] ElevenLabs ${res.status}:`, body);
      throw new Error(`ElevenLabs error ${res.status}`);
    }

    return res.arrayBuffer();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TimeoutError("tts");
    }
    throw err;
  } finally {
    clear();
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { reportContext?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { reportContext, mode: modeRaw } = body;

  if (!reportContext || !reportContext.trim()) {
    return NextResponse.json(
      { error: "Missing reportContext." },
      { status: 400 }
    );
  }

  const mode: Mode =
    modeRaw === "caregiver" || modeRaw === "clinician" ? modeRaw : "caregiver";

  try {
    const greeting = await generateGreeting(reportContext, mode);
    const audioBuffer = await synthesize(greeting);

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Greeting-Text": encodeURIComponent(greeting),
      },
    });
  } catch (err) {
    if (err instanceof TimeoutError) {
      return NextResponse.json({ error: "Request timeout" }, { status: 504 });
    }
    console.error("[voice/greet] unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
