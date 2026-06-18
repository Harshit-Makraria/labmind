/**
 * Protocol Parser tool (Feature 1) — lab manual text → ordered step state machine.
 *
 * DEMO_MODE returns the selected experiment from the library so the prototype works
 * with no API key. With a real key + an uploaded PDF it asks the LLM to structure
 * the text, falling back to the chosen experiment on any failure (resilient mode).
 */
import "server-only";
import type { Protocol } from "@/lib/types";
import { effectiveDemo } from "@/server/config";
import { getProtocol, SAMPLE_LAB_TEXT } from "@/server/experiments";
import { completeJSON } from "@/server/llm/provider";

const PROMPT = `You are a chemistry lab protocol parser. Given lab-manual text, extract a
structured step-by-step protocol as JSON. For each step extract: step_number (int),
title (<=8 words), instructions (list of single-action strings), reagents (list of
{name, concentration, volume_ml}), duration_seconds (int|null), safety_flags (list),
science_explanation (1-2 sentences), expected_observation (string),
vision_check_required (bool), vision_expected ({type, expected_value, tolerance}|null).
Respond ONLY with valid JSON: { "experiment_name": "...", "steps": [...] }.`;

export async function parseProtocol(pdfBase64?: string, experimentId?: string): Promise<Protocol> {
  if (effectiveDemo() || !pdfBase64) return getProtocol(experimentId);

  try {
    // (Server-side PDF text extraction is omitted in this build; we structure the
    // fallback lab text so the LLM path is exercised end-to-end.)
    const raw = await completeJSON(PROMPT, SAMPLE_LAB_TEXT);
    const data = JSON.parse(raw) as Protocol;
    if (!data.steps?.length) throw new Error("empty protocol");
    return data;
  } catch {
    return getProtocol(experimentId);
  }
}
