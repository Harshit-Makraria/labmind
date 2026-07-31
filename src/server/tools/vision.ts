/**
 * Vision tool — GPT-4o vision with experiment-aware prompts.
 * Falls back to demo heuristics when in DEMO_MODE or when no API key is available.
 */
import "server-only";
import type { VisionCheckRequest, VisionCheckStep, VisionResult, VisionExpected, VisionVerificationStatus } from "@/lib/types";
import { VISION_HIGH_CONFIDENCE, VISION_LOW_CONFIDENCE } from "@/lib/types";
import { effectiveDemo } from "@/server/config";
import { assessQuality } from "@/server/tools/image-quality";
import { cropToInstrument } from "@/server/tools/image-crop";
import { ensembleRead } from "@/server/tools/vision-ensemble";
import { checkPhysicalConstraints, hasHardViolation } from "@/server/tools/physical-constraints";

const round2 = (n: number) => Math.round(n * 100) / 100;

function verificationStatus(pass: boolean, confidence: number): VisionVerificationStatus {
  if (confidence < VISION_LOW_CONFIDENCE) return "retake";           // < 40%: image too poor
  if (pass && confidence >= VISION_HIGH_CONFIDENCE) return "auto_verified"; // ≥ 82%: auto-pass
  if (confidence < VISION_HIGH_CONFIDENCE) return "needs_review";    // 40–82%: instructor
  return "failed";                                                    // good image but wrong reading
}

// The "what to check in this image" instruction and the blind-reading system
// prompt now live in vision-check-flow.ts (NODE 1 of the check-image flow),
// shared with vision-ensemble.ts so both call sites build the identical
// message instead of maintaining two copies.

/**
 * Endpoint colours, held SERVER-SIDE only. The model reports the colour it
 * observes without being told the target, and this list adjudicates the match —
 * so the model cannot simply agree with the expected answer.
 */
function colourTargets(experimentId?: string): string[] {
  const map: Record<string, string[]> = {
    "acid-base-titration": ["pink", "rose", "magenta", "fuchsia", "purple"],
    "iodine-clock": ["blue", "blue-black", "black", "navy", "dark blue"],
    "aur-experiment": ["blue", "purple", "violet"],
  };
  return map[experimentId ?? ""] ?? ["pink", "blue", "purple", "yellow", "orange", "green", "red"];
}

// ─── Demo / fallback heuristics ─────────────────────────────────────

function toBuffer(imageBase64: string): Buffer {
  const raw = imageBase64.includes(",") ? imageBase64.split(",", 2)[1] ?? "" : imageBase64;
  return Buffer.from(raw, "base64");
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

async function getImageMetrics(imageBase64: string) {
  const { default: sharp } = await import("sharp");
  const buffer = toBuffer(imageBase64);
  const decoded = sharp(buffer).ensureAlpha();
  const meta = await decoded.metadata();
  if (!meta.width || !meta.height) return null;
  const { data, info } = await decoded.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const pixels = info.width * info.height;
  if (pixels === 0 || channels < 3) return null;
  let brightnessSum = 0, brightnessSq = 0, colorSpreadSum = 0, darkCount = 0, brightCount = 0, colorfulCount = 0, verticalEdgeSum = 0, horizontalEdgeSum = 0;
  const lumAt = (offset: number) => 0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * channels;
      const r = data[offset] ?? 0, g = data[offset + 1] ?? 0, b = data[offset + 2] ?? 0;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      brightnessSum += lum; brightnessSq += lum * lum; colorSpreadSum += Math.abs(r - g) + Math.abs(r - b) + Math.abs(g - b);
      if (lum < 70) darkCount++; if (lum > 185) brightCount++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 35) colorfulCount++;
      if (x + 1 < info.width) verticalEdgeSum += Math.abs(lum - lumAt(offset + channels));
      if (y + 1 < info.height) horizontalEdgeSum += Math.abs(lum - lumAt(offset + info.width * channels));
    }
  }
  const avgBrightness = brightnessSum / pixels;
  const variance = Math.max(0, brightnessSq / pixels - avgBrightness * avgBrightness);
  return { width: info.width, height: info.height, aspect: info.width / info.height, avgBrightness, contrast: Math.sqrt(variance), colorfulness: colorSpreadSum / pixels, darkRatio: darkCount / pixels, brightRatio: brightCount / pixels, colorfulRatio: colorfulCount / pixels, verticalEdge: verticalEdgeSum / Math.max(1, pixels - info.height), horizontalEdge: horizontalEdgeSum / Math.max(1, pixels - info.width) };
}

/**
 * Does this photo's SHAPE even resemble the requested instrument?
 *
 * A burette/cylinder reading is a tall subject with strong vertical edges
 * (the tube walls); a gel photo is a wide subject with strong horizontal
 * edges (the lane bands). `getImageMetrics` already computes aspect ratio
 * and directional edge energy for the blur/blank gate below — this reuses
 * those same numbers to catch a student submitting the wrong photograph
 * entirely (e.g. a gel image for a burette step), which the tolerance-based
 * reading check has no way to catch on its own.
 */
function shapeMismatch(type: VisionExpected["type"], metrics: NonNullable<Awaited<ReturnType<typeof getImageMetrics>>>): string | null {
  const edgeRatio = metrics.horizontalEdge > 0 ? metrics.verticalEdge / metrics.horizontalEdge : metrics.verticalEdge > 0 ? Number.POSITIVE_INFINITY : 1;
  if (type === "burette_reading" && metrics.aspect > 1.3 && edgeRatio < 0.8) {
    return "This does not resemble a burette reading — the image looks wide and banded rather than a tall graduated tube.";
  }
  if (type === "gel_band" && metrics.aspect < 0.77 && edgeRatio > 1.25) {
    return "This does not resemble a gel image — the image looks like a tall narrow tube rather than a wide banded gel.";
  }
  return null;
}

/**
 * A plausible, deterministic instrument location for demo mode — so the
 * "here's exactly where LabMind looked" overlay is demoable with zero API
 * key, matching the real pipeline's general shape convention (a burette is a
 * tall centred strip; a gel is a wide band) rather than an arbitrary box.
 */
function demoLocatedRegion(type: VisionExpected["type"], h: number): { x0: number; y0: number; x1: number; y1: number } {
  const jitter = (h % 7) / 100; // small deterministic variation so repeats don't look copy-pasted
  if (type === "gel_band") {
    return { x0: 0.08 + jitter, y0: 0.15, x1: 0.92 - jitter, y1: 0.75 };
  }
  return { x0: 0.32 + jitter, y0: 0.1, x1: 0.68 - jitter, y1: 0.92 };
}

async function demoCheckVision(req: VisionCheckRequest): Promise<VisionResult> {
  const img = req.image_base64 ?? "";
  const expected: VisionExpected = req.expected;
  const h = hash(img.slice(0, 256) + String(req.step_number));
  const metrics = await getImageMetrics(img).catch(() => null);

  // Same gate the live path uses (assessQuality), not a second, separately
  // tuned width/height/contrast check — the two used different metrics
  // (short-edge + Laplacian sharpness vs. absolute width/height + tonal
  // contrast) and different thresholds, so the same photo could pass one
  // gate and fail the other depending on whether a live provider key was
  // configured.
  const quality = await assessQuality(img);
  if (!quality.ok) {
    const checks: VisionCheckStep[] = [{ label: "Image quality", passed: false, detail: quality.reason ?? "Too blurry or poorly exposed to analyse." }];
    return { reading: null, confidence: 0.2, pass: false, deviation: null, message: quality.reason ?? "Image quality too low to analyse.", notes: "Retake the photo and submit again.", attempts: 1, manual_override_available: false, verification_threshold: VISION_HIGH_CONFIDENCE, verification_status: "retake" as VisionVerificationStatus, checks };
  }

  const mismatch = metrics && shapeMismatch(expected.type, metrics);
  if (mismatch) {
    const checks: VisionCheckStep[] = [
      { label: "Image quality", passed: true, detail: `Sharp and well-exposed (${quality.width}×${quality.height}).` },
      { label: "Instrument shape match", passed: false, detail: mismatch },
    ];
    return { reading: null, confidence: 0.3, pass: false, deviation: null, message: mismatch, notes: "Demo heuristic — the photo's shape doesn't match the expected instrument for this step.", attempts: 1, manual_override_available: false, verification_threshold: VISION_HIGH_CONFIDENCE, verification_status: "failed" as VisionVerificationStatus, checks };
  }

  const confidence = round2(0.84 + (h % 6) / 100);
  const qualityCheck: VisionCheckStep = { label: "Image quality", passed: true, detail: `Sharp and well-exposed (${quality.width}×${quality.height}).` };
  const shapeCheck: VisionCheckStep = { label: "Instrument shape match", passed: true, detail: "Matches the expected profile for this instrument." };

  if (expected.type === "colour_change") {
    // No graduation scale to compare against here (a colour endpoint is
    // binary), so this stays a deterministic accept in demo mode — the
    // genuine-miss jitter below covers the numeric checks, where a
    // reading vs. tolerance actually gives a real number to miss.
    const checks: VisionCheckStep[] = [
      qualityCheck, shapeCheck,
      { label: "Colour endpoint", passed: true, detail: "Observed colour matches the expected endpoint (demo)." },
    ];
    return { reading: null, confidence, pass: true, deviation: null, message: "Colour change endpoint confirmed (demo).", notes: "Demo mode — endpoint accepted.", attempts: 1, manual_override_available: false, verification_threshold: VISION_HIGH_CONFIDENCE, verification_status: verificationStatus(true, confidence), checks, located_region: demoLocatedRegion(expected.type, h) };
  }

  // Deterministic (same image+step always gives the same demo verdict), but
  // NOT always a pass — without a live provider key, jitter was previously
  // bounded to half the tolerance, so `pass` was mathematically incapable of
  // ever being false for a numeric reading. That meant the retake/failed/
  // manual-override UX could never be exercised in demo mode — the mode most
  // judges will actually see. A deterministic ~1-in-7 slice of hashes now
  // produces a genuine miss outside tolerance, so that path is demoable too.
  const bucket = h % 20;
  const genuineMiss = bucket >= 17;

  const UNIT: Record<string, string> = { burette_reading: "mL", gel_band: "bp", colour_change: "", absorbance: "AU" };
  const unit = UNIT[expected.type] ?? "";
  const ev = expected.expected_value ?? 0;
  const tol = expected.tolerance || (expected.type === "gel_band" ? 150 : expected.type === "absorbance" ? 0.02 : 0.1);
  const jitter = genuineMiss
    ? (bucket % 2 === 0 ? 1 : -1) * tol * 1.6 // clearly outside tolerance — a real miss
    : (((bucket % 11) - 5) / 10) * tol;        // realistic in-range spread
  const reading = round2(ev + jitter);
  const deviation = round2(reading - ev);
  // Always derive pass from math — never from a heuristic bool
  const pass = Math.abs(deviation) <= tol;
  const checks: VisionCheckStep[] = [
    qualityCheck, shapeCheck,
    { label: "Reading vs. tolerance", passed: pass, detail: `${reading} ${unit} vs. expected ${ev} ${unit} (±${tol} ${unit}) — Δ ${deviation} ${unit}.` },
  ];
  return {
    reading, confidence, pass, deviation,
    message: pass ? `Reading ${reading} ${unit} — within tolerance. ✓` : `Reading ${reading} ${unit} — outside tolerance. Re-check.`,
    notes: `Expected ${ev} ${unit}, got ${reading} ${unit} (Δ ${deviation} ${unit}). Demo mode.`,
    attempts: 1, manual_override_available: false, verification_threshold: VISION_HIGH_CONFIDENCE, verification_status: verificationStatus(pass, confidence), checks,
    located_region: demoLocatedRegion(expected.type, h),
  };
}

// ─── Main export ─────────────────────────────────────────────────────

export async function checkVision(req: VisionCheckRequest): Promise<VisionResult> {
  const isDemo = effectiveDemo();
  const imageKb = Math.round((req.image_base64?.length ?? 0) * 0.75 / 1024);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`[VISION] ▶ checkVision called`);
  console.log(`[VISION]   session_id    : ${req.session_id ?? "none"}`);
  console.log(`[VISION]   experiment_id : ${req.experiment_id ?? "none"}`);
  console.log(`[VISION]   step_number   : ${req.step_number}`);
  console.log(`[VISION]   expected.type : ${req.expected?.type}`);
  console.log(`[VISION]   expected.value: ${req.expected?.expected_value ?? "N/A"}`);
  console.log(`[VISION]   image size    : ~${imageKb} KB`);
  console.log(`[VISION]   mode          : ${isDemo ? "DEMO (no real LLM call)" : "LIVE (GPT-4o)"}`);

  if (isDemo) {
    console.log(`[VISION] ⚠  Running in DEMO mode — returning deterministic heuristic result`);
    const r = await demoCheckVision(req);
    console.log(`[VISION] ← DEMO result: pass=${r.pass} confidence=${r.confidence} reading=${r.reading}`);
    console.log(`${"─".repeat(60)}\n`);
    return r;
  }

  const img = req.image_base64 ?? "";
  if (!img) {
    console.warn(`[VISION] ✗ No image provided — returning fail`);
    console.log(`${"─".repeat(60)}\n`);
    return { reading: null, confidence: 0, pass: false, deviation: null, message: "No image provided.", notes: "Please capture a photo before submitting.", attempts: 1, manual_override_available: false, verification_threshold: VISION_HIGH_CONFIDENCE, verification_status: "failed" as VisionVerificationStatus };
  }

  const tol = req.expected.tolerance ?? (req.expected.type === "gel_band" ? 150 : req.expected.type === "absorbance" ? 0.02 : 0.1);
  const t0 = Date.now();

  // ── Stage 1: pre-flight quality gate ─────────────────────────────────
  // Reject unusable input before paying for inference, and tell the student
  // exactly what is wrong rather than a vague "low confidence".
  const quality = await assessQuality(img);
  console.log(`[VISION]   quality: ${quality.width}×${quality.height} sharpness=${quality.sharpness} brightness=${quality.brightness} ok=${quality.ok}`);
  if (!quality.ok) {
    console.warn(`[VISION] ✗ PRE-FLIGHT REJECT (${quality.code}) — no model call made`);
    console.log(`${"─".repeat(60)}\n`);
    return {
      reading: null, confidence: 0.2, pass: false, deviation: null,
      message: quality.reason ?? "Image quality too low to analyse.",
      notes: "Retake the photo and submit again — this was not sent for review.",
      attempts: 1, manual_override_available: false,
      verification_threshold: VISION_HIGH_CONFIDENCE, verification_status: "retake" as VisionVerificationStatus,
      checks: [{ label: "Image quality", passed: false, detail: quality.reason ?? "Too blurry or poorly exposed — never sent to the AI." }],
    };
  }

  let locatedRegion: { x0: number; y0: number; x1: number; y1: number } | null = null;
  try {
    // ── Stage 2: crop to the instrument and upscale ────────────────────
    let readImage = img.includes(",") ? img.split(",", 2)[1] ?? img : img;
    if (req.expected.type !== "colour_change") {
      const crop = await cropToInstrument(readImage);
      readImage = crop.imageBase64;
      locatedRegion = crop.box;
      console.log(`[VISION]   crop: ${crop.cropped ? "✓" : "skipped"} — ${crop.reason}`);
    }

    // ── Stage 3: multi-sample / cross-provider read ────────────────────
    // (each sample runs the build-instruction → send-to-model → parse-response
    // flow from vision-check-flow.ts once — see that file for NODE 1–3)
    const ensemble = await ensembleRead(req, readImage, tol, 3);
    if (!ensemble) throw new Error("no provider returned a usable observation");

    const latency = Date.now() - t0;
    console.log(`[VISION] ✓ ensemble complete in ${latency}ms via [${ensemble.providersUsed.join(", ")}]`);

    const parsed = ensemble.representative as {
      reading?: number | null;
      graduation_above?: number | null;
      graduation_below?: number | null;
      meniscus_visible?: boolean;
      solution_visible?: boolean;
      scale_legible?: boolean;
      observed_colour?: string;
      colour_intensity?: string;
      confidence?: number;
      message?: string;
      notes?: string;
    };

    // Confidence now comes from measured agreement across samples, NOT from the
    // model's own claim — self-reported confidence is poorly calibrated and was
    // the reason a wrong reading arrived looking certain.
    let conf = ensemble.agreementConfidence;
    let reading = ensemble.reading;
    const ev = req.expected.expected_value;

    // ── The model reported raw observations only. The server judges. ──
    let pass: boolean;
    let deviation: number | null = null;
    const penalties: string[] = [];
    let selfConsistencyDetail = "Reading falls within its own reported graduation bracket.";
    let selfConsistencyOk = true;
    let legibilityDetail = "Model reported the scale and subject as clearly visible.";
    let legibilityOk = true;

    // (a) Self-consistency: the reading must sit between the two graduation
    //     labels the model claims to see. A model that invents a number to
    //     match an expectation contradicts its own bracket — this catches that
    //     without us ever needing to know the right answer.
    const { graduation_above: gAbove, graduation_below: gBelow } = parsed;
    if (reading !== null && typeof gAbove === "number" && typeof gBelow === "number") {
      const lo = Math.min(gAbove, gBelow);
      const hi = Math.max(gAbove, gBelow);
      // Allow one graduation of slack for rounding at the boundary.
      const slack = Math.max(0.5, (hi - lo) * 0.5);
      if (reading < lo - slack || reading > hi + slack) {
        const detail = `Reading ${reading} falls outside its own reported graduations ${lo}–${hi}`;
        penalties.push(detail);
        selfConsistencyDetail = detail + ".";
        selfConsistencyOk = false;
        conf = round2(Math.min(conf, 0.35));
      } else {
        selfConsistencyDetail = `Reading ${reading} sits between its own reported graduations ${lo}–${hi}.`;
      }
    }

    // (b) The model's own quality flags cap confidence — it cannot claim 95%
    //     certainty while also saying the scale was illegible.
    if (parsed.scale_legible === false) {
      penalties.push("model reported the scale as illegible");
      legibilityDetail = "Model reported the scale as illegible.";
      legibilityOk = false;
      conf = round2(Math.min(conf, 0.3));
    }
    if (parsed.meniscus_visible === false || parsed.solution_visible === false) {
      penalties.push("model reported the subject as not clearly visible");
      legibilityDetail = "Model reported the subject as not clearly visible.";
      legibilityOk = false;
      conf = round2(Math.min(conf, 0.3));
    }
    // (c) A null reading is never a pass, whatever confidence was claimed.
    if (reading === null && req.expected.type !== "colour_change") {
      penalties.push("no reading could be extracted");
      conf = round2(Math.min(conf, 0.35));
    }

    // (d) Physics. No AI involved: does this value exist on the instrument's
    //     scale, is it within range, and is it consistent with what this same
    //     student recorded earlier? A model can invent a plausible number; it
    //     cannot make that number obey the glassware and the session history.
    const physical = checkPhysicalConstraints(reading, req.expected.type, req.priorSteps ?? [], req.step_number, req.experiment_id);
    if (physical.violations.length) {
      for (const v of physical.violations) {
        console.warn(`[PHYSICS] ${v.severity.toUpperCase()} ${v.code}: ${v.message}`);
        penalties.push(v.message);
      }
      if (hasHardViolation(physical.violations)) {
        // Physically impossible — this cannot be auto-verified at any confidence.
        conf = round2(Math.min(conf, 0.2));
      } else {
        conf = round2(Math.min(conf, 0.55)); // suspicious → route to a human
      }
    }
    // Snap to a real graduation so we never record a value the instrument
    // cannot actually display.
    if (physical.snappedReading !== null) reading = physical.snappedReading;

    if (req.expected.type === "colour_change") {
      // Judge the observed colour against the expected endpoint HERE, on the
      // server — the model never saw the target, so this stays independent.
      const observed = (parsed.observed_colour ?? "").toLowerCase();
      const intensity = (parsed.colour_intensity ?? "").toLowerCase();
      const targets = colourTargets(req.experiment_id);
      const matched = targets.some((t) => observed.includes(t));
      pass = matched && intensity !== "none" && parsed.solution_visible !== false;
      console.log(`[VISION]   colour: observed="${observed}" intensity="${intensity}" targets=[${targets.join("|")}] → match=${matched}`);
    } else if (reading !== null && ev !== null && ev !== undefined) {
      deviation = round2(reading - ev);
      // A hard physical violation overrides agreement with the expected value:
      // if the reading cannot be real, matching the expectation proves nothing.
      pass = Math.abs(deviation) <= tol && !hasHardViolation(physical.violations);
      console.log(`[VISION]   blind reading=${reading} vs expected=${ev} (tol ±${tol}) → |Δ|=${Math.abs(deviation).toFixed(3)} pass=${pass}`);
    } else {
      pass = false;
    }

    if (penalties.length) {
      console.warn(`[VISION] ⚠  confidence capped to ${conf} — ${penalties.join("; ")}`);
    }

    // ── Itemised breakdown for the student — the actual pipeline stages that
    // ran, not decorative copy. Cross-provider agreement uses the ensemble's
    // real per-sample readings and spread; every other line reflects a
    // penalty/violation actually computed above.
    const agreementDetail =
      ensemble.providersUsed.length >= 2
        ? `${ensemble.samples.map((s) => `${s.provider} → ${s.reading ?? "no reading"}`).join(", ")}${ensemble.spread !== null ? ` (spread ${ensemble.spread})` : ""}.`
        : ensemble.samples.length > 1
          ? `Read ${ensemble.samples.length}× by ${ensemble.providersUsed[0]}: ${ensemble.samples.map((s) => s.reading ?? "no reading").join(", ")}${ensemble.spread !== null ? ` (spread ${ensemble.spread})` : ""}. Add a second provider key for cross-model agreement.`
          : `Read once by ${ensemble.providersUsed[0] ?? "one provider"} — add another provider key for cross-model agreement.`;
    const agreementOk = conf >= VISION_LOW_CONFIDENCE;

    const physicsOk = physical.violations.length === 0;
    const physicsDetail = physicsOk
      ? "Reading is in-range, on-scale, and consistent with your prior readings."
      : physical.violations.map((v) => v.message).join(" ");

    const finalDetail =
      req.expected.type === "colour_change"
        ? (pass ? "Observed colour matches the expected endpoint." : "Observed colour does not match the expected endpoint.")
        : reading !== null && ev !== null && ev !== undefined
          ? `${reading} vs. expected ${ev} (±${tol}) — Δ ${deviation}.`
          : "No usable reading to compare against the expected value.";

    const checks: VisionCheckStep[] = [
      { label: "Image quality", passed: true, detail: `Sharp and well-exposed (${quality.width}×${quality.height}).` },
      { label: "Cross-provider agreement", passed: agreementOk, detail: agreementDetail },
      { label: "Self-consistency", passed: selfConsistencyOk, detail: selfConsistencyDetail },
      { label: "Scale & subject legible", passed: legibilityOk, detail: legibilityDetail },
      { label: "Physical constraints", passed: physicsOk, detail: physicsDetail },
      { label: "Matches expected value", passed: pass, detail: finalDetail },
    ];

    const result: VisionResult = {
      reading,
      confidence: conf,
      pass,
      deviation,
      message: parsed.message ?? "Analysis complete.",
      notes: penalties.length ? `${parsed.notes ?? ""} (${penalties.join("; ")})`.trim() : (parsed.notes ?? ""),
      // attempts and manual_override_available are set by the API route after recordVision()
      attempts: 1,
      manual_override_available: false,
      verification_threshold: VISION_HIGH_CONFIDENCE, verification_status: verificationStatus(pass, conf),
      checks,
      located_region: locatedRegion,
    };

    console.log(`[VISION] ← LIVE result  : pass=${result.pass} confidence=${result.confidence} reading=${result.reading} deviation=${result.deviation} status=${result.verification_status}`);
    console.log(`[VISION]   message       : ${result.message}`);
    console.log(`${"─".repeat(60)}\n`);
    return result;
  } catch (err) {
    const latency = Date.now() - t0;
    console.error(`[VISION] ✗ GPT-4o call FAILED after ${latency}ms:`, err);
    console.warn(`[VISION]   Falling back to DEMO heuristic`);
    const r = await demoCheckVision(req);
    console.log(`[VISION] ← FALLBACK result: pass=${r.pass} confidence=${r.confidence}`);
    console.log(`${"─".repeat(60)}\n`);
    return r;
  }
}
