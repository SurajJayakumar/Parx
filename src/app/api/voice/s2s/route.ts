import { NextRequest, NextResponse } from "next/server";

// ─── Environment ─────────────────────────────────────────────────────────────

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY!;
const FEATHERLESS_API_KEY = process.env.FEATHERLESS_API_KEY!;
const FEATHERLESS_BASE_URL = process.env.FEATHERLESS_BASE_URL!;
const FEATHERLESS_MODEL = process.env.FEATHERLESS_MODEL!;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID!;

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "caregiver" | "clinician";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── System prompts ───────────────────────────────────────────────────────────

function buildSystemPrompt(mode: Mode, reportContext?: string): string {
  const reportSection = reportContext
    ? `\n\nLATEST REPORT CONTEXT — use this data to ground your answers:
${reportContext}

REPORT RESPONSE RULES:
- When summarizing the report (first message), give exactly 1 to 2 sentences covering: what the main event or finding is, when it happened, and 1 key metric. Then invite the user to ask follow-up questions.
- For follow-up questions, answer in 2 to 3 short sentences using only information from the report context. If a question cannot be answered from the report, say so briefly.
- Always stay grounded in the report data. Do not speculate beyond what the report contains.`
    : "";

  const core = `\
You are a proactive Parkinson's disease mobility monitoring AI assistant, delivered entirely through voice.

YOUR FOCUS AREAS — always prioritize these topics when relevant:
- Walking speed changes and gait freezing episodes
- Step length shortening (festination patterns)
- Arm swing reduction as an early motor sign
- Postural instability and fall risk
- Bradykinesia affecting daily movement tasks

RESPONSE RULES (follow every rule, every time):
1. Speak in 3 to 5 short, natural sentences — no more, no less.
2. Never use bullet points, numbered lists, headers, dashes, or any markdown. Write as flowing speech only.
3. Structure your thinking clearly but deliver it as natural spoken prose.
4. If the user asks for a diagnosis, prognosis, or treatment decision, gently redirect them: acknowledge their concern, explain that this requires clinical evaluation, and encourage them to speak with their neurologist or movement disorder specialist.
5. Weave the medical disclaimer naturally into your response as part of a sentence — do not bolt it onto the end as a formulaic tag. For example: "Keep in mind this isn't a medical diagnosis, but what you're describing sounds worth discussing with their neurologist."
6. Be proactive: if the user describes a symptom or change, connect it to mobility monitoring context even if they didn't explicitly ask.${reportSection}`;

  if (mode === "clinician") {
    return `${core}

CLINICIAN MODE — your listener is a licensed clinician or movement disorder specialist:
- You may use clinical terminology where it adds precision: MDS-UPDRS subscores, Hoehn and Yahr staging, freezing of gait (FOG), retropulsion, camptocormia, dopaminergic wearing-off, or levodopa equivalent daily dose (LEDD).
- Be efficient and information-dense. Assume familiarity with Parkinson's pathophysiology.
- When discussing gait metrics, you may reference quantitative thresholds (e.g., walking speed below 1.0 m/s as a fall-risk marker) if contextually appropriate.
- Still speak in flowing, voice-appropriate sentences — no lists or headers.`;
  }

  return `${core}

CAREGIVER MODE — your listener is a family member, caregiver, or non-specialist:
- Use plain, warm, and supportive language. Avoid clinical jargon; if a medical term is necessary, define it briefly in plain words.
- Translate clinical concepts into observable everyday behaviors: for example, describe arm swing reduction as "one arm not swinging as much as the other when they walk."
- Offer practical, concrete suggestions they can act on at home.
- Be emotionally sensitive — caregiving is hard. Acknowledge their experience when appropriate.`;
}

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

// ─── Stage 1: Deepgram STT ───────────────────────────────────────────────────

async function transcribe(audioBlob: Blob): Promise<string> {
  const { signal, clear } = withTimeout(TIMEOUT_MS);

  try {
    const res = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          // Strip codec params — Deepgram only accepts the base MIME type
          "Content-Type": (audioBlob.type || "audio/webm").split(";")[0],
        },
        body: audioBlob,
        signal,
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`[s2s/stt] Deepgram ${res.status}:`, body);
      throw new STTError(`Deepgram error ${res.status}: ${body}`);
    }

    const json = await res.json();
    const transcript: string =
      json?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    if (!transcript.trim()) {
      throw new STTError("Deepgram returned an empty transcript.");
    }

    return transcript;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TimeoutError("stt");
    }
    throw err;
  } finally {
    clear();
  }
}

// ─── Stage 2: Featherless LLM ─────────────────────────────────────────────────

async function generateReply(
  transcript: string,
  mode: Mode,
  reportContext?: string,
  history?: ConversationMessage[]
): Promise<string> {
  const { signal, clear } = withTimeout(TIMEOUT_MS);

  const messages: { role: string; content: string }[] = [
    { role: "system", content: buildSystemPrompt(mode, reportContext) },
    ...(history ?? []),
    { role: "user", content: transcript },
  ];

  try {
    const res = await fetch(`${FEATHERLESS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FEATHERLESS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: FEATHERLESS_MODEL,
        messages,
        max_tokens: 192,
        temperature: 0.55,
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[s2s/llm] Featherless ${res.status}:`, body);
      throw new LLMError(`Featherless error ${res.status}: ${body}`);
    }

    const json = await res.json();
    const reply: string = json?.choices?.[0]?.message?.content ?? "";

    if (!reply.trim()) {
      throw new LLMError("Featherless returned an empty reply.");
    }

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

// ─── Stage 3: ElevenLabs TTS ─────────────────────────────────────────────────

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
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
        signal,
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`[s2s/tts] ElevenLabs ${res.status}:`, body);
      throw new TTSError(`ElevenLabs error ${res.status}: ${body}`);
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

// ─── Typed errors ─────────────────────────────────────────────────────────────

class STTError extends Error {
  readonly stage = "stt" as const;
}
class LLMError extends Error {
  readonly stage = "llm" as const;
}
class TTSError extends Error {
  readonly stage = "tts" as const;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Parse multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart/form-data payload." },
      { status: 400 }
    );
  }

  const fileField = formData.get("file");
  const modeField = formData.get("mode");
  const reportContextField = formData.get("reportContext");
  const historyField = formData.get("history");

  if (!fileField || !(fileField instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing or invalid 'file' field." },
      { status: 400 }
    );
  }

  const mode: Mode =
    modeField === "caregiver" || modeField === "clinician"
      ? modeField
      : "caregiver";

  const reportContext =
    typeof reportContextField === "string" && reportContextField.trim()
      ? reportContextField
      : undefined;

  let history: ConversationMessage[] | undefined;
  if (typeof historyField === "string" && historyField.trim()) {
    try {
      history = JSON.parse(historyField) as ConversationMessage[];
    } catch {
      history = undefined;
    }
  }

  try {
    const transcript = await transcribe(fileField);
    const reply = await generateReply(transcript, mode, reportContext, history);
    const audioBuffer = await synthesize(reply);

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-User-Transcript": encodeURIComponent(transcript),
        "X-Assistant-Reply": encodeURIComponent(reply),
      },
    });
  } catch (err) {
    if (err instanceof TimeoutError) {
      return NextResponse.json({ error: "Request timeout" }, { status: 504 });
    }
    if (err instanceof STTError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    if (err instanceof LLMError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    if (err instanceof TTSError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[voice/s2s] unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
