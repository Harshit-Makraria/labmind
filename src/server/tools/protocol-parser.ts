/**
 * Protocol Parser tool (Feature 1) — lab manual PDF → ordered step state machine.
 *
 * With an LLM key and an uploaded PDF we extract the real text server-side and
 * ask the model to structure it. Without a key (or on any failure) we fall back
 * to the chosen library experiment so the flow always completes.
 */
import "server-only";
import type { Protocol } from "@/lib/types";
import { effectiveDemo } from "@/server/config";
import { getProtocol } from "@/server/experiments";
import { completeJSON } from "@/server/llm/provider";

const PROMPT = `You are a chemistry lab protocol parser. Given lab-manual text, extract a
structured step-by-step protocol as JSON. For each step extract: step_number (int),
title (<=8 words), instructions (list of single-action strings), reagents (list of
{name, concentration, volume_ml}), duration_seconds (int|null), safety_flags (list),
science_explanation (1-2 sentences), expected_observation (string),
vision_check_required (bool), vision_expected ({type, expected_value, tolerance}|null).

vision_expected.type must be one of: "burette_reading", "colour_change", "gel_band".
Set vision_check_required true only for steps with an observable, photographable state.
Respond ONLY with valid JSON: { "experiment_name": "...", "steps": [...] }.`;

/** Upper bound on text sent to the model — keeps a 60-page manual from blowing the context. */
const MAX_CHARS = 24_000;

/**
 * Extract text from a base64 PDF. Returns null when the PDF has no embedded
 * text layer (i.e. it is a scan) — callers should fall back rather than send
 * an empty string to the model.
 */
export async function extractPdfText(pdfBase64: string): Promise<string | null> {
  try {
    const raw = pdfBase64.includes(",") ? pdfBase64.split(",", 2)[1] ?? "" : pdfBase64;
    const bytes = new Uint8Array(Buffer.from(raw, "base64"));

    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });

    const cleaned = (text ?? "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    console.log(`[PDF] extracted ${cleaned.length} chars from ${totalPages} page(s)`);

    // A text layer under ~200 chars across the whole document means this is
    // almost certainly a scanned image — we have no OCR, so say so honestly.
    if (cleaned.length < 200) {
      console.warn(`[PDF] only ${cleaned.length} chars — likely a scanned PDF with no text layer`);
      return null;
    }
    return cleaned.slice(0, MAX_CHARS);
  } catch (e) {
    console.error("[PDF] extraction failed:", e);
    return null;
  }
}

export async function parseProtocol(pdfBase64?: string, experimentId?: string): Promise<Protocol> {
  if (!pdfBase64) return getProtocol(experimentId);

  if (effectiveDemo()) {
    console.warn("[PDF] demo mode — cannot structure an uploaded PDF without an LLM key");
    return getProtocol(experimentId);
  }

  const text = await extractPdfText(pdfBase64);
  if (!text) return getProtocol(experimentId);

  try {
    const raw = await completeJSON(PROMPT, text);
    const data = JSON.parse(raw) as Protocol;
    if (!data.steps?.length) throw new Error("empty protocol");

    // Normalise so a partial model response can't crash the student flow.
    data.steps = data.steps.map((s, i) => ({
      ...s,
      step_number: s.step_number ?? i + 1,
      title: s.title ?? `Step ${i + 1}`,
      instructions: Array.isArray(s.instructions) ? s.instructions : [],
      reagents: Array.isArray(s.reagents) ? s.reagents : [],
      safety_flags: Array.isArray(s.safety_flags) ? s.safety_flags : [],
      duration_seconds: s.duration_seconds ?? null,
      science_explanation: s.science_explanation ?? "",
      expected_observation: s.expected_observation ?? "",
      vision_check_required: !!s.vision_check_required,
      vision_expected: s.vision_expected ?? null,
    }));

    console.log(`[PDF] parsed "${data.experiment_name}" — ${data.steps.length} steps`);
    return data;
  } catch (e) {
    console.error("[PDF] LLM structuring failed, falling back to library:", e);
    return getProtocol(experimentId);
  }
}
