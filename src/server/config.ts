/**
 * Server-only configuration.
 * Provider-agnostic LLM selection.
 * Default: "auto" — chat/text prefers OpenAI then Gemini; vision (photo
 * verification) prefers Gemini then OpenAI. Claude is available on both but
 * only used when explicitly selected. Either capability can also be pinned
 * independently to a specific provider (chatProvider/visionProvider below) —
 * e.g. Claude for chat + OpenAI for vision, a pairing "auto" alone can't
 * express. Falls back to demo mode if no provider key is configured or all
 * are exhausted.
 */
import "server-only";
import { getRuntimeSettings } from "@/server/runtime-config";
import { anyExhausted, isExhausted } from "@/server/llm/provider-state";

export type LlmProvider = "demo" | "auto" | "gemini" | "openai" | "azure" | "claude";
/** A provider pin for one capability (chat or vision) — "auto" uses that capability's built-in default order. */
export type CapabilityProvider = "auto" | "openai" | "gemini" | "claude";

export interface LabmindConfig {
  llmProvider: LlmProvider;
  /** Resolved provider preference for chat/text calls — "auto" uses the OpenAI → Gemini → Claude order. */
  chatProvider: CapabilityProvider;
  /** Resolved provider preference for vision calls — "auto" uses the Gemini → OpenAI → Claude order. */
  visionProvider: CapabilityProvider;
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

/**
 * A single-provider top-level mode ("openai"/"gemini"/"claude") forces BOTH
 * capabilities to that provider, overriding any per-capability pin — that's
 * what "X only" means. Otherwise (top-level "auto") each capability resolves
 * independently: the per-capability pin if one is set, else "auto".
 */
export function resolveCapabilityProvider(top: LlmProvider, override: CapabilityProvider | undefined): CapabilityProvider {
  if (top === "openai" || top === "gemini" || top === "claude") return top;
  return override ?? "auto";
}

export function getConfig(): LabmindConfig {
  const env = process.env;
  const rt = getRuntimeSettings(); // null until first DB load — falls back to env
  const llmProvider = rt?.provider ?? (env.LLM_PROVIDER as LlmProvider) ?? "auto";
  return {
    llmProvider,
    chatProvider: resolveCapabilityProvider(llmProvider, rt?.chatProvider),
    visionProvider: resolveCapabilityProvider(llmProvider, rt?.visionProvider),
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
 * Ordered fallback chain for one capability, given its pin. "auto" uses the
 * built-in default order for that capability; a specific pin tries that
 * provider first and falls back through the remaining two. Exported so
 * provider.ts's actual routing and this file's providerLabel() share exactly
 * one definition of "what order do we try providers in" — they must never
 * silently drift apart.
 */
export function resolveWaterfallOrder(capability: "chat" | "vision", pin: CapabilityProvider): CapabilityProvider[] {
  const base: CapabilityProvider[] = capability === "chat" ? ["openai", "gemini", "claude"] : ["gemini", "openai", "claude"];
  if (pin === "auto") return base;
  return [pin, ...base.filter((p) => p !== pin)];
}

/** The concrete provider that would actually be called right now for a given waterfall order (skipping missing/exhausted keys). Exported for the Settings API to show e.g. "Auto — currently Gemini" instead of a bare, unresolved "auto". */
export function firstAvailableProvider(order: CapabilityProvider[], c: LabmindConfig): CapabilityProvider {
  for (const p of order) {
    if (p === "openai" && c.openaiApiKey && !isExhausted("openai")) return p;
    if (p === "gemini" && c.geminiApiKey && !isExhausted("gemini")) return p;
    if (p === "claude" && c.anthropicApiKey && !isExhausted("anthropic")) return p;
  }
  return "claude";
}

/**
 * Human-readable label for the active engine(s) (shown in the UI / traces).
 * Chat and vision can now resolve to different providers (e.g. "Claude for
 * chat + OpenAI for vision"), so this shows both when they differ.
 */
export function providerLabel(): string {
  const c = getConfig();
  if (effectiveDemo(c)) return "demo";
  const chat = firstAvailableProvider(resolveWaterfallOrder("chat", c.chatProvider), c);
  const vision = firstAvailableProvider(resolveWaterfallOrder("vision", c.visionProvider), c);
  return chat === vision ? chat : `${chat} chat / ${vision} vision`;
}
