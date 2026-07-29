/**
 * Live model catalog — asks each provider what models actually exist right
 * now, instead of trusting a hardcoded ID that can quietly expire as
 * providers deprecate old models and ship new ones.
 *
 * Every fetch is defensive: on any network/auth/shape error it falls back to
 * a small static list of known-good IDs so the Settings picker never breaks,
 * it just stops being "live" until the next successful fetch.
 */
import "server-only";

export interface CatalogModel {
  id: string;
  /** Human-friendly label, when the provider gives one distinct from the id. */
  label?: string;
}

export interface ModelCatalogResult {
  models: CatalogModel[];
  /** True when this list came from the provider's live API, not the static fallback. */
  live: boolean;
  error?: string;
}

const STATIC_FALLBACK: Record<"openai" | "gemini" | "claude", CatalogModel[]> = {
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
  gemini: [
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
  claude: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
  ],
};

/** Models actually usable for chat/vision — excludes embeddings, TTS, moderation, image-gen, etc. */
function isUsableOpenaiModel(id: string): boolean {
  // "image" excludes gpt-image-*/chatgpt-image-* (DALL-E-style generation
  // models) — they show up in /v1/models but aren't chat-completion models,
  // so picking one here would hard-fail the very next vision/chat call.
  if (/embedding|whisper|tts|moderation|dall-e|davinci|babbage|ada|curie|realtime|audio|transcribe|image/i.test(id)) return false;
  return /^(gpt-|o1|o3|o4|chatgpt)/i.test(id);
}

async function fetchOpenaiModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenAI models list failed: ${res.status}`);
  const data = (await res.json()) as { data: { id: string; created?: number }[] };
  return data.data
    .filter((m) => isUsableOpenaiModel(m.id))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .map((m) => ({ id: m.id }));
}

/**
 * Google's model list mixes real Gemini chat/vision models in with image
 * generation ("Nano Banana"), TTS, music (Lyria), robotics, and agent-preview
 * models that all happen to support generateContent too. None of those are
 * usable for a plain "describe this photo" chat call, so this keeps only the
 * models actually named `gemini-*` and excludes the non-chat sub-families.
 */
function isUsableGeminiModel(id: string): boolean {
  if (!id.startsWith("gemini-")) return false;
  return !/image|tts|robotics|computer-use/i.test(id);
}

async function fetchGeminiModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!res.ok) throw new Error(`Gemini models list failed: ${res.status}`);
  const data = (await res.json()) as {
    models: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  return data.models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName }))
    .filter((m) => isUsableGeminiModel(m.id));
}

async function fetchAnthropicModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=50", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  if (!res.ok) throw new Error(`Anthropic models list failed: ${res.status}`);
  const data = (await res.json()) as { data: { id: string; display_name?: string; created_at?: string }[] };
  return data.data
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    .map((m) => ({ id: m.id, label: m.display_name }));
}

export async function fetchModelCatalog(
  provider: "openai" | "gemini" | "claude",
  apiKey: string | undefined,
): Promise<ModelCatalogResult> {
  if (!apiKey) {
    return { models: STATIC_FALLBACK[provider], live: false, error: "No API key saved for this provider yet." };
  }
  try {
    const models =
      provider === "openai" ? await fetchOpenaiModels(apiKey)
      : provider === "gemini" ? await fetchGeminiModels(apiKey)
      : await fetchAnthropicModels(apiKey);
    if (models.length === 0) throw new Error("empty model list");
    return { models, live: true };
  } catch (e) {
    console.warn(`[MODEL-CATALOG] ${provider} live fetch failed, using static fallback:`, e);
    return { models: STATIC_FALLBACK[provider], live: false, error: (e as Error).message };
  }
}
