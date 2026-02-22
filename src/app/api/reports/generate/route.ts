export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

import { getServerEnv } from "@/lib/env.server";
import { getAdminDb, hasAdminCredentials } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const EventSchema = z.object({
  type: z.enum(["symptom", "fall"]),
  severity: z.enum(["low", "medium", "high"]),
  fallDetected: z.boolean(),
  pdProbability: z.number(),
  fallProbability: z.number(),
  centralDate: z.string(),
  centralTime: z.string(),
});

const MetricSnapshotSchema = z.object({
  ts: z.number(),
  stepLength: z.number().optional(),
  armSwingL: z.number().optional(),
  armSwingR: z.number().optional(),
});

const GenerateSchema = z.object({
  uid: z.string().min(1),
  sessionId: z.string().min(1),
  patientName: z.string().min(1).optional(),
  events: z.array(EventSchema).min(0),
  metricSnapshots: z.array(MetricSnapshotSchema).optional(),
});

type GenerateInput = z.infer<typeof GenerateSchema>;
type SessionEvent = z.infer<typeof EventSchema>;
type MetricSnapshotInput = z.infer<typeof MetricSnapshotSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function computeSummaryStats(events: SessionEvent[]) {
  const total = events.length;
  const falls = events.filter((e) => e.fallDetected).length;
  const symptoms = total - falls;
  const highSeverity = events.filter((e) => e.severity === "high").length;
  const mediumSeverity = events.filter((e) => e.severity === "medium").length;
  const avgPd =
    total > 0
      ? events.reduce((s, e) => s + e.pdProbability, 0) / total
      : 0;
  const avgFall =
    total > 0
      ? events.reduce((s, e) => s + e.fallProbability, 0) / total
      : 0;

  const overallSeverity: "low" | "medium" | "high" =
    falls > 0 || highSeverity > 0
      ? "high"
      : mediumSeverity > 0
        ? "medium"
        : "low";

  return {
    total,
    falls,
    symptoms,
    highSeverity,
    mediumSeverity,
    avgPd,
    avgFall,
    overallSeverity,
  };
}

// ---------------------------------------------------------------------------
// Featherless LLM — clinical narrative
// ---------------------------------------------------------------------------

type Narrative = {
  summary: string;
  observations: string[];
  interpretation: string;
  nextSteps: string[];
  safetyNotes: string[];
  disclaimer: string;
};

// Recursively unwrap a value that might be a nested JSON string or object,
// returning the first plain prose string found, or fallback.
function extractStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    // If the string itself looks like JSON, try to parse and recurse once
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const inner = JSON.parse(trimmed) as unknown;
        if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) {
          // Try common key names the model might have nested
          const obj = inner as Record<string, unknown>;
          for (const key of ["summary", "text", "content", "value", "message"]) {
            if (typeof obj[key] === "string" && (obj[key] as string).trim()) {
              return (obj[key] as string).trim();
            }
          }
          // Return first string-valued key
          for (const v of Object.values(obj)) {
            if (typeof v === "string" && v.trim()) return v.trim();
          }
        }
      } catch {
        // Not valid JSON after all — return as-is (model put braces in prose)
        return trimmed;
      }
      return fallback;
    }
    return trimmed;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    // Model returned an object where a string was expected — grab first string value
    for (const v of Object.values(value as Record<string, unknown>)) {
      const s = extractStr(v);
      if (s) return s;
    }
  }
  return fallback;
}

function extractArr(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => extractStr(v)).filter((s) => s.length > 0);
  }
  // Model sometimes returns a newline-delimited string instead of an array
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\n+/)
      .map((l) => l.replace(/^[-•*]\s*/, "").trim())
      .filter((l) => l.length > 0);
  }
  return [];
}

// Strip any remaining JSON blobs or raw key:"value" syntax from a plain-text
// string so it never leaks into the UI or PDF.
function sanitizePlainText(text: string): string {
  if (!text) return text;

  // If the whole string is still a JSON object/array, try to extract prose
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      // Flatten to a readable string
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const prose = Object.entries(obj)
          .filter(([, v]) => typeof v === "string" && (v as string).trim())
          .map(([k, v]) => {
            const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            return `${label}: ${(v as string).trim()}`;
          })
          .join(" ");
        return prose || text;
      }
    } catch {
      // Not valid JSON — continue
    }
  }

  // Remove inline JSON-like fragments: {"key":"value"} or {"key": "value", ...}
  // that might appear embedded in otherwise readable text.
  const stripped = text.replace(/\{[^{}]*"[^"]*"\s*:\s*"[^"]*"[^{}]*\}/g, "").trim();
  // Also remove stray escaped quotes and backslashes left by the model
  return stripped.replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim() || text;
}

// Regex-based extraction for when JSON.parse fails.
// Pulls string values: "key": "value" and array values: "key": ["a","b"]
function regexExtractObj(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const kvRegex = /"(\w+)"\s*:\s*(\[[\s\S]*?\]|"(?:[^"\\]|\\.)*")/g;
  let match;
  while ((match = kvRegex.exec(text)) !== null) {
    const key = match[1];
    const raw = match[2].trim();
    if (raw.startsWith("[")) {
      const items: string[] = [];
      const itemRegex = /"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = itemRegex.exec(raw)) !== null) items.push(m[1]);
      result[key] = items;
    } else {
      result[key] = raw.replace(/^"|"$/g, "");
    }
  }
  return result;
}

function normalizeNarrative(raw: unknown): Narrative {
  let obj: Record<string, unknown>;

  if (typeof raw === "string") {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    try {
      obj = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      // JSON.parse failed — try regex extraction before falling back to raw blob
      const regexObj = regexExtractObj(cleaned);
      obj = Object.keys(regexObj).length > 0 ? regexObj : { summary: cleaned };
    }
  } else if (typeof raw === "object" && raw !== null) {
    obj = raw as Record<string, unknown>;
  } else {
    obj = {};
  }

  return {
    summary: sanitizePlainText(extractStr(
      obj.summary,
      "Session completed. No detailed summary was generated.",
    )),
    observations: extractArr(obj.observations).map(sanitizePlainText),
    interpretation: sanitizePlainText(extractStr(obj.interpretation)),
    nextSteps: extractArr(obj.next_steps ?? obj.nextSteps).map(sanitizePlainText),
    safetyNotes: extractArr(obj.safety_notes ?? obj.safetyNotes).map(sanitizePlainText),
    disclaimer: sanitizePlainText(extractStr(
      obj.disclaimer,
      "This is not a medical diagnosis. Always consult a qualified healthcare provider.",
    )),
  };
}

async function generateNarrative(
  patientName: string,
  sessionId: string,
  stats: ReturnType<typeof computeSummaryStats>,
  events: SessionEvent[],
): Promise<Narrative> {
  const env = getServerEnv();

  const timeline = events
    .slice(0, 20) // cap prompt size
    .map(
      (e, i) =>
        `${i + 1}. [${e.centralDate} ${e.centralTime}] Type=${e.type}, ` +
        `Severity=${e.severity}, FallDetected=${e.fallDetected}, ` +
        `PD-likelihood=${(e.pdProbability * 100).toFixed(1)}%, ` +
        `Fall-likelihood=${(e.fallProbability * 100).toFixed(1)}%`,
    )
    .join("\n");

  const systemMessage =
    "You are a clinical-style report writer for a Parkinson screening tool. " +
    "You must NOT diagnose. You must explain observations from gait and movement signals. " +
    "Use clear, supportive plain English language for caregivers and clinicians. " +
    'Include disclaimer: "This is not a medical diagnosis." ' +
    "Always respond with a single valid JSON object only — no markdown fences, no extra text. " +
    "Every field value must be a plain English string or array of plain English strings. " +
    "Never nest JSON objects or JSON strings inside field values. " +
    "Never include field names, curly braces, or quotes as part of the field content.";

  const userMessage =
    `Here is a session timeline of detected events with timestamps, severity scores, and signals.\n\n` +
    `Patient: ${patientName}\n` +
    `Session date: ${sessionId}\n` +
    `Total events: ${stats.total} (${stats.symptoms} symptom, ${stats.falls} fall)\n` +
    `High-severity events: ${stats.highSeverity}\n` +
    `Medium-severity events: ${stats.mediumSeverity}\n` +
    `Average PD likelihood: ${(stats.avgPd * 100).toFixed(1)}%\n` +
    `Average fall likelihood: ${(stats.avgFall * 100).toFixed(1)}%\n` +
    `Overall severity: ${stats.overallSeverity.toUpperCase()}\n\n` +
    `Event timeline:\n${timeline || "No events recorded this session."}\n\n` +
    `Generate a JSON object with exactly these fields:\n` +
    `- summary: string — 1 to 2 paragraphs written in plain English describing what happened in the session. No JSON inside this value.\n` +
    `- observations: array of strings — each item is one short plain-English bullet point. No JSON inside any item.\n` +
    `- interpretation: string — 1 to 2 plain-English sentences interpreting the overall severity. No JSON inside this value.\n` +
    `- next_steps: array of strings — each item is one plain-English recommended next step for caregivers or clinicians. No JSON inside any item.\n` +
    `- safety_notes: array of strings — each item is one plain-English fall risk or safety consideration. No JSON inside any item.\n` +
    `- disclaimer: string — must include the exact phrase "This is not a medical diagnosis." Written in plain English.\n\n` +
    `Rules: Output ONLY the top-level JSON object. No markdown fences. No extra text before or after. ` +
    `Every string value must be readable plain English — never embed JSON, braces, or escaped quotes inside a value.`;

  const res = await fetch(`${env.FEATHERLESS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.FEATHERLESS_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.FEATHERLESS_MODEL,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1000,
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Featherless API error (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const rawContent: unknown = json.choices?.[0]?.message?.content?.trim() ?? "";

  console.log(
    "[report/generate] raw model output:",
    typeof rawContent === "string" ? rawContent.slice(0, 500) : rawContent,
  );

  const narrative = normalizeNarrative(rawContent);

  console.log("[report/generate] normalized keys:", Object.keys(narrative));

  return narrative;
}

// ---------------------------------------------------------------------------
// PDF builder — pdf-lib
// ---------------------------------------------------------------------------

const BRAND = rgb(0.149, 0.388, 0.922); // #2563eb
const DARK = rgb(0.1, 0.1, 0.1);
const MID = rgb(0.4, 0.4, 0.4);
const LIGHT_BG = rgb(0.97, 0.97, 0.97);

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if ((current + " " + word).trim().length <= maxChars) {
      current = (current + " " + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ---------------------------------------------------------------------------
// Chart drawing helpers
// ---------------------------------------------------------------------------

interface ChartSeries {
  label: string;
  color: [number, number, number]; // RGB 0–1
  values: number[];
}

/**
 * Draws a line chart directly on a pdf-lib PDFPage.
 * Returns the height consumed (chart box height).
 */
function drawLineChart(
  page: ReturnType<typeof PDFDocument.prototype.addPage>,
  x: number,
  y: number, // top-left y (pdf coords — y increases upward)
  chartW: number,
  chartH: number,
  series: ChartSeries[],
  title: string,
  yUnit: string,
  bold: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>,
  regular: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>,
): void {
  const PAD_LEFT = 36;
  const PAD_RIGHT = 8;
  const PAD_TOP = 18; // space for title
  const PAD_BOTTOM = 16;

  const innerW = chartW - PAD_LEFT - PAD_RIGHT;
  const innerH = chartH - PAD_TOP - PAD_BOTTOM;
  const innerX = x + PAD_LEFT;
  const innerY = y - chartH + PAD_BOTTOM; // bottom of inner area (pdf coords up)
  const innerTop = innerY + innerH;

  // Chart title
  page.drawText(title, {
    x: x + PAD_LEFT,
    y: y - 10,
    size: 8,
    font: bold,
    color: rgb(0.3, 0.3, 0.3),
  });

  // Background rect
  page.drawRectangle({
    x: innerX,
    y: innerY,
    width: innerW,
    height: innerH,
    color: rgb(0.975, 0.975, 0.985),
    borderColor: rgb(0.85, 0.85, 0.88),
    borderWidth: 0.5,
  });

  // Compute global min/max across all series
  const allVals = series.flatMap((s) => s.values);
  if (allVals.length === 0) {
    page.drawText("No data", {
      x: innerX + innerW / 2 - 15,
      y: innerY + innerH / 2 - 4,
      size: 8,
      font: regular,
      color: rgb(0.6, 0.6, 0.6),
    });
    return;
  }

  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const spread = rawMax - rawMin || 1;
  const lo = Math.max(0, rawMin - spread * 0.1);
  const hi = rawMax + spread * 0.1;
  const range = hi - lo || 1;

  // Y-axis grid lines + labels (4 ticks)
  const TICKS = 4;
  for (let t = 0; t <= TICKS; t++) {
    const val = lo + (range / TICKS) * t;
    const yPx = innerY + (innerH / TICKS) * t;
    page.drawLine({
      start: { x: innerX, y: yPx },
      end: { x: innerX + innerW, y: yPx },
      thickness: 0.3,
      color: rgb(0.8, 0.8, 0.82),
    });
    page.drawText(val.toFixed(0), {
      x: x,
      y: yPx - 3,
      size: 6,
      font: regular,
      color: rgb(0.55, 0.55, 0.55),
    });
  }

  // Y-axis unit label
  page.drawText(yUnit, {
    x: x,
    y: innerTop + 2,
    size: 6,
    font: regular,
    color: rgb(0.55, 0.55, 0.55),
  });

  // Draw each series as a polyline using short line segments
  for (const s of series) {
    if (s.values.length < 2) continue;
    const [r, g, b] = s.color;
    const lineColor = rgb(r, g, b);

    for (let i = 1; i < s.values.length; i++) {
      const x0 = innerX + ((i - 1) / (s.values.length - 1)) * innerW;
      const y0 = innerY + ((s.values[i - 1] - lo) / range) * innerH;
      const x1 = innerX + (i / (s.values.length - 1)) * innerW;
      const y1 = innerY + ((s.values[i] - lo) / range) * innerH;
      page.drawLine({
        start: { x: x0, y: y0 },
        end: { x: x1, y: y1 },
        thickness: 1.2,
        color: lineColor,
      });
    }
  }

  // Legend — below chart
  let legX = innerX;
  for (const s of series) {
    const [r, g, b] = s.color;
    page.drawLine({
      start: { x: legX, y: innerY - 8 },
      end: { x: legX + 12, y: innerY - 8 },
      thickness: 1.5,
      color: rgb(r, g, b),
    });
    page.drawText(s.label, {
      x: legX + 14,
      y: innerY - 11,
      size: 6.5,
      font: regular,
      color: rgb(0.4, 0.4, 0.4),
    });
    legX += 14 + s.label.length * 4.5 + 8;
  }
}

// ---------------------------------------------------------------------------
// Downsample helper — keeps at most `maxPts` evenly-spaced values
// ---------------------------------------------------------------------------

function downsample(values: number[], maxPts = 120): number[] {
  if (values.length <= maxPts) return values;
  const step = values.length / maxPts;
  return Array.from({ length: maxPts }, (_, i) => values[Math.round(i * step)]);
}

async function buildPdf(
  patientName: string,
  sessionId: string,
  stats: ReturnType<typeof computeSummaryStats>,
  events: SessionEvent[],
  structured: Narrative,
  metricSnapshots: MetricSnapshotInput[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 50;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  function addPage() {
    const p = doc.addPage([PAGE_W, PAGE_H]);
    return { page: p, y: PAGE_H - MARGIN };
  }

  // ── Page 1 ──────────────────────────────────────────────────────────────
  let { page, y } = addPage();

  // Header bar
  page.drawRectangle({ x: 0, y: PAGE_H - 70, width: PAGE_W, height: 70, color: BRAND });
  page.drawText("Parxx", { x: MARGIN, y: PAGE_H - 38, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Movement Session Report", { x: MARGIN, y: PAGE_H - 57, size: 11, font: regular, color: rgb(0.85, 0.9, 1) });

  y = PAGE_H - 90;

  // Meta block
  const metaLines = [
    `Patient: ${patientName}`,
    `Session date: ${sessionId}`,
    `Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} CT`,
  ];
  for (const line of metaLines) {
    page.drawText(line, { x: MARGIN, y, size: 10, font: regular, color: MID });
    y -= 15;
  }

  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 20;

  // Summary stats cards (3 per row)
  const cardData = [
    { label: "Total Events", value: String(stats.total) },
    { label: "Symptom Events", value: String(stats.symptoms) },
    { label: "Fall Events", value: String(stats.falls) },
    { label: "High Severity", value: String(stats.highSeverity) },
    { label: "Avg PD Likelihood", value: `${(stats.avgPd * 100).toFixed(1)}%` },
    { label: "Overall Severity", value: stats.overallSeverity.toUpperCase() },
  ];

  const CARD_W = (CONTENT_W - 10) / 3;
  const CARD_H = 52;
  let cardX = MARGIN;
  let cardY = y;
  let col = 0;

  for (const card of cardData) {
    page.drawRectangle({ x: cardX, y: cardY - CARD_H, width: CARD_W, height: CARD_H, color: LIGHT_BG, borderColor: rgb(0.88, 0.88, 0.88), borderWidth: 0.5 });
    page.drawText(card.label, { x: cardX + 8, y: cardY - 18, size: 8, font: regular, color: MID });
    page.drawText(card.value, { x: cardX + 8, y: cardY - 36, size: 16, font: bold, color: DARK });
    col += 1;
    if (col < 3) {
      cardX += CARD_W + 5;
    } else {
      col = 0;
      cardX = MARGIN;
      cardY -= CARD_H + 8;
    }
  }

  y = cardY - (col > 0 ? CARD_H + 16 : 8);

  // Disclaimer
  page.drawRectangle({ x: MARGIN, y: y - 28, width: CONTENT_W, height: 28, color: rgb(1, 0.97, 0.9), borderColor: rgb(0.95, 0.8, 0.4), borderWidth: 0.5 });
  page.drawText("NON-DIAGNOSTIC — For informational purposes only. Review all findings with a qualified healthcare provider.", {
    x: MARGIN + 6, y: y - 18, size: 7.5, font: regular, color: rgb(0.55, 0.35, 0),
  });
  y -= 44;

  // ── Helpers for structured narrative rendering ───────────────────────────
  const CHARS_PER_LINE = 90;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN + 20) {
      const next = addPage();
      page = next.page;
      y = next.y;
    }
  }

  function drawSectionHeading(title: string) {
    ensureSpace(28);
    y -= 6;
    page.drawText(title.toUpperCase(), { x: MARGIN, y, size: 7.5, font: bold, color: MID });
    y -= 10;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
    y -= 10;
  }

  function drawParagraph(text: string, indent = 0) {
    const lines = wrapText(text.trim(), CHARS_PER_LINE - Math.floor(indent / 6));
    for (const line of lines) {
      ensureSpace(14);
      page.drawText(line, { x: MARGIN + indent, y, size: 9.5, font: regular, color: DARK });
      y -= 13;
    }
    y -= 4;
  }

  function drawBulletList(items: string[]) {
    for (const item of items) {
      const bulletLines = wrapText(item.trim(), CHARS_PER_LINE - 12);
      for (let li = 0; li < bulletLines.length; li++) {
        ensureSpace(14);
        if (li === 0) {
          page.drawText("•", { x: MARGIN + 4, y, size: 9.5, font: regular, color: BRAND });
        }
        page.drawText(bulletLines[li], { x: MARGIN + 16, y, size: 9.5, font: regular, color: DARK });
        y -= 13;
      }
    }
    y -= 4;
  }

  // ── Clinical Narrative — section by section ───────────────────────────────
  page.drawText("Clinical Narrative", { x: MARGIN, y, size: 13, font: bold, color: BRAND });
  y -= 18;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 14;

  if (structured.summary) {
    drawSectionHeading("Summary");
    drawParagraph(structured.summary);
  }

  if (structured.observations.length > 0) {
    drawSectionHeading("Key Observations");
    drawBulletList(structured.observations);
  }

  if (structured.interpretation) {
    drawSectionHeading("Interpretation");
    drawParagraph(structured.interpretation);
  }

  if (structured.nextSteps.length > 0) {
    drawSectionHeading("Recommended Next Steps");
    drawBulletList(structured.nextSteps);
  }

  if (structured.safetyNotes.length > 0) {
    drawSectionHeading("Safety Notes");
    drawBulletList(structured.safetyNotes);
  }

  if (structured.disclaimer) {
    ensureSpace(30);
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
    y -= 10;
    const disclaimerLines = wrapText(structured.disclaimer, CHARS_PER_LINE);
    for (const line of disclaimerLines) {
      ensureSpace(12);
      page.drawText(line, { x: MARGIN, y, size: 8, font: regular, color: MID });
      y -= 11;
    }
  }

  // ── Page 2 — Event timeline ──────────────────────────────────────────────
  const tp = addPage();
  page = tp.page;
  y = tp.y;

  page.drawText("Event Timeline", { x: MARGIN, y, size: 13, font: bold, color: BRAND });
  y -= 16;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 14;

  // Table header
  const cols = [60, 60, 40, 90, 90, 90, 75];
  const headers = ["Date (CT)", "Time (CT)", "Type", "Severity", "Fall", "PD %", "Fall %"];
  let xOff = MARGIN;
  page.drawRectangle({ x: MARGIN, y: y - 16, width: CONTENT_W, height: 18, color: BRAND });
  for (let i = 0; i < headers.length; i++) {
    page.drawText(headers[i], { x: xOff + 4, y: y - 12, size: 8, font: bold, color: rgb(1, 1, 1) });
    xOff += cols[i];
  }
  y -= 18;

  const displayEvents = events.slice(0, 40);
  for (let ri = 0; ri < displayEvents.length; ri++) {
    const ev = displayEvents[ri];
    if (y < MARGIN + 20) {
      const np = addPage();
      page = np.page;
      y = np.y;
    }
    const rowBg = ri % 2 === 0 ? rgb(1, 1, 1) : LIGHT_BG;
    page.drawRectangle({ x: MARGIN, y: y - 14, width: CONTENT_W, height: 16, color: rowBg });

    const cells = [
      ev.centralDate,
      ev.centralTime.replace(" CT", ""),
      ev.type,
      ev.severity.toUpperCase(),
      ev.fallDetected ? "YES" : "NO",
      `${(ev.pdProbability * 100).toFixed(1)}%`,
      `${(ev.fallProbability * 100).toFixed(1)}%`,
    ];

    xOff = MARGIN;
    for (let ci = 0; ci < cells.length; ci++) {
      const textColor = ci === 4 && ev.fallDetected ? rgb(0.8, 0.1, 0.1) : DARK;
      page.drawText(cells[ci], { x: xOff + 4, y: y - 10, size: 8, font: regular, color: textColor });
      xOff += cols[ci];
    }
    y -= 16;
  }

  if (events.length > 40) {
    page.drawText(`… and ${events.length - 40} more events not shown.`, {
      x: MARGIN, y: y - 12, size: 8, font: regular, color: MID,
    });
  }

  // ── Page 3 — Mobility Metrics Charts ────────────────────────────────────
  if (metricSnapshots.length > 0) {
    const mp = addPage();
    page = mp.page;
    y = mp.y;

    page.drawText("Mobility Metrics", { x: MARGIN, y, size: 13, font: bold, color: BRAND });
    y -= 16;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 20;

    // Downsample snapshots for chart clarity
    const MAX_PTS = 120;
    const step = Math.max(1, Math.floor(metricSnapshots.length / MAX_PTS));
    const sampled = metricSnapshots.filter((_, i) => i % step === 0);

    const stepVals = sampled.map((s) => s.stepLength).filter((v): v is number => v !== undefined);
    const armLVals = sampled.map((s) => s.armSwingL).filter((v): v is number => v !== undefined);
    const armRVals = sampled.map((s) => s.armSwingR).filter((v): v is number => v !== undefined);

    const CHART_W = CONTENT_W;
    const CHART_H = 160;
    const CHART_GAP = 36;

    // ── Step Length chart ──────────────────────────────────────────────────
    if (stepVals.length > 0) {
      page.drawText("STEP LENGTH", { x: MARGIN, y, size: 7.5, font: bold, color: MID });
      y -= 8;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
      y -= 4;

      drawLineChart(
        page,
        MARGIN,
        y,
        CHART_W,
        CHART_H,
        [{ label: "Step Length", color: [0.51, 0.55, 0.97], values: downsample(stepVals) }],
        "",
        "cm",
        bold,
        regular,
      );
      y -= CHART_H + CHART_GAP;
    }

    // ── Arm Swing chart ───────────────────────────────────────────────────
    const hasArm = armLVals.length > 0 || armRVals.length > 0;
    if (hasArm) {
      if (y - CHART_H - 30 < MARGIN) {
        const np2 = addPage();
        page = np2.page;
        y = np2.y;
      }

      page.drawText("ARM SWING", { x: MARGIN, y, size: 7.5, font: bold, color: MID });
      y -= 8;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
      y -= 4;

      const armSeries: ChartSeries[] = [];
      if (armLVals.length > 0)
        armSeries.push({ label: "Left Arm", color: [0.2, 0.83, 0.6], values: downsample(armLVals) });
      if (armRVals.length > 0)
        armSeries.push({ label: "Right Arm", color: [0.96, 0.45, 0.71], values: downsample(armRVals) });

      drawLineChart(
        page,
        MARGIN,
        y,
        CHART_W,
        CHART_H,
        armSeries,
        "",
        "°",
        bold,
        regular,
      );
      y -= CHART_H + CHART_GAP;
    }

    // Caption
    if (y > MARGIN + 20) {
      page.drawText(
        "Charts show movement metrics sampled throughout the session. Values are computed from pose estimation.",
        { x: MARGIN, y: y - 10, size: 7, font: regular, color: MID },
      );
    }
  }

  // Footer on every page
  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    p.drawText(`Parxx — Session Report ${sessionId}  |  Page ${idx + 1} of ${pages.length}`, {
      x: MARGIN, y: 24, size: 7, font: regular, color: MID,
    });
  });

  return doc.save();
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let input: GenerateInput;
  try {
    const body = await req.json();
    input = GenerateSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return fail(`Validation error — ${err.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`, 422);
    }
    return fail("Request body must be valid JSON.");
  }

  const { uid, sessionId, patientName = "Patient", events, metricSnapshots = [] } = input;

  try {
    const stats = computeSummaryStats(events);

    // 1. Generate clinical narrative via Featherless LLM
    const structured = await generateNarrative(patientName, sessionId, stats, events);

    // 2. Build PDF
    const pdfBytes = await buildPdf(patientName, sessionId, stats, events, structured, metricSnapshots);

    // 3. Save PDF to public/reports/
    const reportsDir = path.join(process.cwd(), "public", "reports");
    fs.mkdirSync(reportsDir, { recursive: true });

    const now = new Date();
    const datePart = now.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", year: "numeric" }).replace(/\//g, "-");
    const timePart = now.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).replace(/:/g, "-");
    const filename = `Report-${datePart}-${timePart}.pdf`;
    const fullPath = path.join(reportsDir, filename);
    fs.writeFileSync(fullPath, Buffer.from(pdfBytes));

    const pdfUrl = `/reports/${filename}`;

    // 4. Persist report metadata to Firestore
    if (hasAdminCredentials) {
      const db = getAdminDb();
      const reportsRef = db.collection("users").doc(uid).collection("reports");
      await reportsRef.add({
        sessionId,
        createdAt: FieldValue.serverTimestamp(),
        title: "Parkinson Screening Report",
        highestSeverity: stats.overallSeverity,
        summary: structured.summary,
        observations: structured.observations,
        interpretation: structured.interpretation,
        nextSteps: structured.nextSteps,
        safetyNotes: structured.safetyNotes,
        disclaimer: structured.disclaimer,
        pdfUrl,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
