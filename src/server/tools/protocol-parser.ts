/**
 * Protocol Parser tool (Feature 1) — lab manual PDF → ordered step state machine.
 *
 * With an LLM key and an uploaded PDF we extract the real text server-side and
 * ask the model to structure it. Without a key (or on any failure) we fall back
 * to the chosen library experiment so the flow always completes.
 */
import "server-only";
import type { ExpectedResult, Protocol, VisionExpected } from "@/lib/types";
import { effectiveDemo } from "@/server/config";
import { getProtocol } from "@/server/experiments";
import { completeJSON } from "@/server/llm/provider";

const PROMPT = `You are a science lab protocol parser. The manual may be from ANY subject —
chemistry, physics, biology, electronics, computer science, engineering. Given
lab-manual text, extract a structured step-by-step protocol as JSON.

For each step extract: step_number (int), title (<=8 words), instructions (list of
single-action strings), reagents (list of {name, concentration, volume_ml} — use an
empty list for non-chemistry labs), duration_seconds (int|null), safety_flags (list),
science_explanation (1-2 sentences), expected_observation (string),
vision_check_required (bool), vision_expected ({type, expected_value, tolerance}|null).

vision_expected.type must be one of: "burette_reading", "colour_change", "gel_band",
"absorbance", "descriptive".

Use "descriptive" for ANYTHING that is not one of the four specific chemistry
instruments above — a physics ammeter or vernier caliper, a microscope field, a
breadboard circuit, a weighing balance, a terminal screenshot, an assembled
apparatus. This is the normal choice for most subjects. For "descriptive" also set:
  "description": "<plain-language statement of what the photo must show>",
  "must_show": ["<feature that must be visible>", ...],
  "must_not_show": ["<common mistake that would be visible>", ...]
and set expected_value only when a specific number should be readable in the photo
(then tolerance too); otherwise leave expected_value null.

Set vision_check_required true only for steps with an observable, photographable state.

ALSO extract the experiment's final expected result as "expected_result":
{
  "kind": "numeric" | "categorical" | "boolean" | "qualitative" | "none",
  "label": "<what the student ultimately determines, e.g. 'KMnO4 molarity', 'Focal length', 'Tissue type'>",
  "value": <number, numeric only — the expected/theoretical value stated or derivable from the manual>,
  "unit": "<unit, numeric only>",
  "tolerance": <number|null, numeric only>,
  "options": ["<choice>", ...],        // categorical only
  "correct": <"answer" | true | false>, // categorical/boolean only
  "rubric": "<how to judge a written observation>" // qualitative only
}
Choose "numeric" when the lab ends in a measured value, "categorical" when it ends in an
identification from a fixed set, "boolean" when it ends in a yes/no, "qualitative" when it
ends in a written observation, and "none" when there is no single final result.
If the manual states no expected value, use kind "qualitative" or "none" rather than
inventing a number.

Respond ONLY with valid JSON: { "experiment_name": "...", "expected_result": {...}, "steps": [...] }.`;

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

const LEGACY_TYPES = new Set(["burette_reading", "colour_change", "gel_band", "absorbance"]);

/**
 * Make any model-emitted vision_expected safe to run.
 *
 * The failure mode this prevents: the model marks a step as needing a photo but
 * emits a vision_expected the pipeline can't act on (an invented type, or
 * "descriptive" with no description). Rather than dropping the check — which
 * would silently stop verifying that step — fall back to a descriptive check
 * built from the step's own expected_observation, which the parser always
 * produces. That keeps every photographable step genuinely verified, in any
 * subject.
 */
function normaliseVisionExpected(raw: unknown, expectedObservation?: string): VisionExpected | null {
  const fallbackDescription = (expectedObservation ?? "").trim();
  if (!raw || typeof raw !== "object") {
    return fallbackDescription
      ? { type: "descriptive", expected_value: null, tolerance: 0, description: fallbackDescription }
      : null;
  }
  const v = raw as Record<string, unknown>;
  const type = typeof v.type === "string" ? v.type : "";
  const description = typeof v.description === "string" ? v.description.trim() : "";
  const expectedValue = typeof v.expected_value === "number" && Number.isFinite(v.expected_value) ? v.expected_value : null;
  const tolerance = typeof v.tolerance === "number" && v.tolerance >= 0 ? v.tolerance : 0;
  const strList = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.trim() !== "") : undefined);

  if (LEGACY_TYPES.has(type)) {
    return { type: type as VisionExpected["type"], expected_value: expectedValue, tolerance, ...(description ? { description } : {}) };
  }

  const desc = description || fallbackDescription;
  if (!desc) return null;
  return {
    type: "descriptive",
    expected_value: expectedValue,
    tolerance,
    description: desc,
    must_show: strList(v.must_show),
    must_not_show: strList(v.must_not_show),
  };
}

/**
 * Drop a parsed expected_result that doesn't carry the data its own kind needs.
 * Returning null is the honest outcome — the caller then grades against the
 * library experiment rather than against a half-extracted target.
 */
function sanitiseExpectedResult(r: ExpectedResult | null | undefined): ExpectedResult | null {
  if (!r || typeof r !== "object" || typeof r.kind !== "string") return null;
  const label = typeof r.label === "string" && r.label.trim() ? r.label.trim() : "Result";
  switch (r.kind) {
    case "numeric":
      if (typeof r.value !== "number" || !Number.isFinite(r.value)) return null;
      return { kind: "numeric", label, value: r.value, unit: r.unit ?? null, tolerance: typeof r.tolerance === "number" ? r.tolerance : null };
    case "categorical": {
      const options = Array.isArray(r.options) ? r.options.filter((o) => typeof o === "string") : [];
      if (!options.length || r.correct == null) return null;
      return { kind: "categorical", label, options, correct: r.correct };
    }
    case "boolean":
      if (typeof r.correct !== "boolean") return null;
      return { kind: "boolean", label, correct: r.correct };
    case "qualitative":
      return { kind: "qualitative", label, rubric: typeof r.rubric === "string" && r.rubric.trim() ? r.rubric.trim() : "Judged by the instructor against the expected observation." };
    case "none":
      return { kind: "none", label };
    default:
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
      vision_expected: normaliseVisionExpected(s.vision_expected, s.expected_observation),
    }));

    // Keep the parsed expected result only if it's internally consistent — a
    // model that emits {kind:"numeric"} with no value would otherwise become a
    // zero target and grade every student at 0% deviation. resolveExpectedResult
    // falls back to the library value when this is dropped.
    data.expected_result = sanitiseExpectedResult(data.expected_result);

    console.log(
      `[PDF] parsed "${data.experiment_name}" — ${data.steps.length} steps` +
        (data.expected_result ? `, expected result: ${data.expected_result.kind} (${data.expected_result.label})` : ", no expected result extracted"),
    );
    return data;
  } catch (e) {
    console.error("[PDF] LLM structuring failed, falling back to library:", e);
    return getProtocol(experimentId);
  }
}
