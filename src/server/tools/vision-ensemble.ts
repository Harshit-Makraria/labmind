/**
 * Multi-sample and cross-provider reading.
 *
 * Self-reported confidence is the weakest signal a vision model produces —
 * models are poorly calibrated, which is exactly how a wrong burette reading
 * arrived with high confidence. This module replaces that with an EMPIRICAL
 * measure: read the same image several times (and, where possible, with two
 * different providers), then derive confidence from how much the readings
 * actually agree.
 *
 *   24.50, 24.50, 24.45  → spread 0.05  → trustworthy
 *   24.50,  6.00, 18.20  → spread 18.5  → send to a human
 *
 * A genuinely legible meniscus is stable across samples. A hallucinated one is
 * not, and two independently-trained models rarely hallucinate the same value.
 */
import "server-only";
import type { VisionCheckRequest } from "@/lib/types";
import { getConfig } from "@/server/config";
import { isExhausted } from "@/server/llm/provider-state";
import type { VisionProvider } from "@/server/llm/provider";
import { runImageCheck, type ImageCheckObservation } from "@/server/tools/vision-check-flow";

/** @deprecated use ImageCheckObservation from vision-check-flow.ts — kept as an alias so existing imports don't churn. */
export type RawObservation = ImageCheckObservation;

export interface EnsembleResult {
  /** Median of the numeric readings that were obtained. */
  reading: number | null;
  /** Max − min across samples, in instrument units. null when <2 numeric reads. */
  spread: number | null;
  /** Confidence derived from agreement, not from the model's own claim. */
  agreementConfidence: number;
  /** The observation closest to the median — used for its qualitative fields. */
  representative: RawObservation;
  samples: { provider: VisionProvider; reading: number | null; confidence: number }[];
  providersUsed: VisionProvider[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : round2((s[mid - 1] + s[mid]) / 2);
}

/**
 * For a colour_change check there is no numeric median to fall back on, so
 * the categorical verdict has to come from ONE observation's `observed_colour`
 * — previously always `observations[0]`, whichever provider happened to
 * return first. If two providers agree on a colour and one doesn't, the vote
 * winner is what gets judged; only when there's no majority (every provider
 * says something different, or too few samples) does this fall back to the
 * first observation, same as before.
 */
export function colourVoteRepresentative(observations: { provider: VisionProvider; obs: RawObservation }[]): RawObservation {
  const colours = observations.map((o) => (o.obs.observed_colour ?? "").trim().toLowerCase()).filter(Boolean);
  if (colours.length < 2) return observations[0].obs;

  const counts = new Map<string, number>();
  for (const c of colours) counts.set(c, (counts.get(c) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  if (maxCount < 2) return observations[0].obs; // no real majority — every provider disagreed

  const winner = [...counts.entries()].find(([, n]) => n === maxCount)?.[0];
  return observations.find((o) => (o.obs.observed_colour ?? "").trim().toLowerCase() === winner)?.obs ?? observations[0].obs;
}

/**
 * Map observed spread onto a confidence score.
 * `tolerance` is the experiment's own pass tolerance, so agreement is judged
 * on the scale that actually matters for this measurement.
 */
function confidenceFromSpread(spread: number, tolerance: number): number {
  if (spread <= tolerance * 0.5) return 0.95;  // effectively identical
  if (spread <= tolerance) return 0.88;        // within tolerance of each other
  if (spread <= tolerance * 3) return 0.6;     // loose — a human should look
  if (spread <= tolerance * 10) return 0.35;   // poor agreement
  return 0.15;                                  // models fundamentally disagree
}

/** Providers to sample from, best-first, skipping any that are exhausted. */
function availableProviders(): VisionProvider[] {
  const c = getConfig();
  const out: VisionProvider[] = [];
  if (c.anthropicApiKey && !isExhausted("anthropic")) out.push("claude");
  if (c.openaiApiKey && !isExhausted("openai")) out.push("openai");
  if (c.geminiApiKey && !isExhausted("gemini")) out.push("gemini");
  return out;
}

/**
 * Read one image several times and fuse the results.
 *
 * Strategy: prefer breadth (two different providers) over depth (same provider
 * twice), because independent models are far less likely to share a failure
 * mode. Falls back to repeated sampling of one provider when only one is
 * configured. Each individual read is the SAME three-node flow
 * (instruction → model → parse) from vision-check-flow.ts — this module's
 * job is purely the fan-out/fan-in around it, not the call itself.
 */
export async function ensembleRead(
  req: Pick<VisionCheckRequest, "expected" | "step_number" | "experiment_id">,
  imageBase64: string,
  tolerance: number,
  samples = 3,
): Promise<EnsembleResult | null> {
  const providers = availableProviders();
  if (providers.length === 0) return null;

  // Round-robin across available providers up to `samples` reads.
  const plan: VisionProvider[] = Array.from({ length: samples }, (_, i) => providers[i % providers.length]);

  const settled = await Promise.allSettled(
    // Vary temperature slightly across repeats of the SAME provider so the
    // samples are genuinely independent rather than identical replays.
    plan.map((p, i) => runImageCheck(p, req, imageBase64, i === 0 ? 0 : 0.3)),
  );

  const observations: { provider: VisionProvider; obs: RawObservation }[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      observations.push({ provider: plan[i], obs: r.value });
    } else if (r.status === "fulfilled") {
      console.warn(`[ENSEMBLE] ${plan[i]} returned unparseable JSON`);
    } else {
      console.warn(`[ENSEMBLE] ${plan[i]} failed:`, r.reason);
    }
  });

  if (observations.length === 0) return null;

  const numeric = observations
    .map((o) => o.obs.reading)
    .filter((r): r is number => typeof r === "number" && Number.isFinite(r));

  const providersUsed = [...new Set(observations.map((o) => o.provider))];
  const sampleLog = observations.map((o) => ({
    provider: o.provider,
    reading: o.obs.reading ?? null,
    confidence: round2(Math.max(0, Math.min(1, o.obs.confidence ?? 0.5))),
  }));

  // No numeric readings at all (e.g. colour_change, or nothing legible).
  if (numeric.length === 0) {
    const rep = colourVoteRepresentative(observations);
    const selfConf = round2(Math.max(0, Math.min(1, rep.confidence ?? 0.5)));
    // With several samples and no number anywhere, unreadability is the
    // consistent finding — that agreement is itself informative.
    const agreement = observations.length >= 2 ? Math.min(selfConf, 0.4) : selfConf;
    return {
      reading: null,
      spread: null,
      agreementConfidence: agreement,
      representative: rep,
      samples: sampleLog,
      providersUsed,
    };
  }

  const med = median(numeric);
  const spread = numeric.length >= 2 ? round2(Math.max(...numeric) - Math.min(...numeric)) : null;

  // Use the observation nearest the median for the qualitative fields, so the
  // message and quality flags describe the reading we actually report.
  const representative = observations.reduce((best, cur) => {
    const bd = Math.abs((best.obs.reading ?? Infinity) - med);
    const cd = Math.abs((cur.obs.reading ?? Infinity) - med);
    return cd < bd ? cur : best;
  }).obs;

  let agreementConfidence: number;
  if (spread === null) {
    // Only one usable read — fall back to the model's own claim, capped, since
    // a single sample provides no agreement evidence.
    agreementConfidence = round2(Math.min(representative.confidence ?? 0.5, 0.8));
  } else {
    agreementConfidence = confidenceFromSpread(spread, tolerance);
    // Cross-provider agreement is stronger evidence than one model repeating
    // itself, so allow a modest boost when two engines independently concur.
    if (providersUsed.length >= 2 && spread <= tolerance) {
      agreementConfidence = round2(Math.min(0.97, agreementConfidence + 0.05));
    }
  }

  console.log(
    `[ENSEMBLE] ${observations.length} read(s) from [${providersUsed.join(", ")}]: ` +
    `${numeric.join(", ")} → median=${med} spread=${spread ?? "n/a"} → confidence=${agreementConfidence}`,
  );

  return { reading: med, spread, agreementConfidence, representative, samples: sampleLog, providersUsed };
}
