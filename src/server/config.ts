/**
 * Server-only configuration.
 * Provider-agnostic LLM selection.
 * Default: "auto" — chat/text prefers OpenAI then Gemini; vision (photo
 * verification) prefers Gemini then OpenAI. Claude is available on both but
 * only used when explicitly selected in Settings ("Claude only"). Falls back
 * to demo mode if no provider key is configured or all are exhausted.
 */
import "server-only";
import { getRuntimeSettings } from "@/server/runtime-config";
import { anyExhausted, isExhausted } from "@/server/llm/provider-state";

export type LlmProvider = "demo" | "auto" | "gemini" | "openai" | "azure" | "claude";

export interface LabmindConfig {
  llmProvider: LlmProvider;
  demoMode: boolean;
  geminiApiKey?: string;
  geminiModel: string;
  /** Model used ONLY for image-analysis calls — separate from geminiModel (chat/JSON) since Gemini is the default vision provider and deserves its own picked model. */
  geminiVisionModel: string;
  openaiApiKey?: string;
  openaiModel: string;
  /** Model used ONLY for image-analysis calls — deliberately separate from openaiModel (chat/JSON), which may be set to a cheaper model. */
  openaiVisionModel: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  /** Model used ONLY for image-analysis calls — deliberately separate from anthropicModel (chat/JSON). Reading a burette/gel/absorbance photo correctly is the single highest-value accuracy lever in the app, so this defaults to the strongest current Claude model regardless of what the text model is set to. */
  anthropicVisionModel: string;
  azureEndpoint?: string;
  azureApiKey?: string;
  azureDeployment: string;
  azureApiVersion: string;
  instructorPasscode: string;
}

export function getConfig(): LabmindConfig {
  const env = process.env;
  const rt = getRuntimeSettings(); // null until first DB load — falls back to env
  return {
    llmProvider: rt?.provider ?? (env.LLM_PROVIDER as LlmProvider) ?? "auto",
    demoMode: env.DEMO_MODE === "true",
    geminiApiKey: rt?.geminiKey ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY,
    // Model picked from Settings (backed by the live model-catalog fetch)
    // always wins over the env default, which itself can drift out of date.
    geminiModel: rt?.geminiChatModel ?? env.GEMINI_MODEL ?? "gemini-1.5-flash",
    geminiVisionModel: rt?.geminiVisionModel ?? env.GEMINI_VISION_MODEL ?? env.GEMINI_MODEL ?? "gemini-1.5-flash",
    openaiApiKey: rt?.openaiKey ?? env.OPENAI_API_KEY,
    openaiModel: rt?.openaiChatModel ?? env.OPENAI_MODEL ?? "gpt-4o-mini",
    openaiVisionModel: rt?.openaiVisionModel ?? env.OPENAI_VISION_MODEL ?? "gpt-4o",
    anthropicApiKey: rt?.anthropicKey ?? env.ANTHROPIC_API_KEY,
    anthropicModel: rt?.anthropicChatModel ?? env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",
    anthropicVisionModel: rt?.anthropicVisionModel ?? env.ANTHROPIC_VISION_MODEL ?? "claude-sonnet-5",
    azureEndpoint: env.AZURE_OPENAI_ENDPOINT,
    azureApiKey: env.AZURE_OPENAI_API_KEY,
    azureDeployment: env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o-mini",
    azureApiVersion: env.AZURE_OPENAI_API_VERSION ?? "2024-02-01",
    instructorPasscode: env.INSTRUCTOR_PASSCODE ?? "labmind2026",
  };
}

/** Demo if explicitly toggled, no keys available, or all active providers are exhausted. */
export function effectiveDemo(c: LabmindConfig = getConfig()): boolean {
  if (c.demoMode || c.llmProvider === "demo") return true;
  if (c.llmProvider === "auto") {
    const hasClaude = !!c.anthropicApiKey;
    const hasOpenai = !!c.openaiApiKey;
    const hasGemini = !!c.geminiApiKey;
    if (!hasClaude && !hasOpenai && !hasGemini) return true;
    // All available keys exhausted → demo
    const claudeOk  = hasClaude  && !isExhausted("anthropic");
    const openaiOk  = hasOpenai  && !isExhausted("openai");
    const geminiOk  = hasGemini  && !isExhausted("gemini");
    if (!claudeOk && !openaiOk && !geminiOk) return true;
    return false;
  }
  if (c.llmProvider === "gemini" && !c.geminiApiKey) return true;
  if (c.llmProvider === "openai" && !c.openaiApiKey) return true;
  if (c.llmProvider === "azure" && !c.azureApiKey) return true;
  if (c.llmProvider === "claude" && !c.anthropicApiKey) return true;
  return false;
}

/**
 * Human-readable label for the active engine (shown in the UI / traces).
 * Reflects the CHAT waterfall order (OpenAI → Gemini → Claude) — vision
 * calls follow a different order (Gemini → OpenAI → Claude), see provider.ts.
 */
export function providerLabel(): string {
  const c = getConfig();
  if (effectiveDemo(c)) return "demo";
  if (c.llmProvider === "auto") {
    if (c.openaiApiKey && !isExhausted("openai")) return "openai";
    if (c.geminiApiKey && !isExhausted("gemini")) return "gemini";
    return "claude";
  }
  return c.llmProvider;
}
