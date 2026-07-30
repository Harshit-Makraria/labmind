/**
 * Runtime LLM config that can be changed via the settings UI.
 * Overrides environment variables for the lifetime of the process.
 * Persisted to the AppSetting table so changes survive cold starts.
 */
import "server-only";
import { db } from "@/server/db";
import type { LlmProvider, CapabilityProvider } from "@/server/config";

export interface LlmRuntimeSettings {
  provider: LlmProvider;
  /**
   * Which provider leads for each capability when `provider` is "auto".
   * "auto" (the default for each) uses the built-in preference — OpenAI
   * first for chat, Gemini first for vision — but either can be pinned to a
   * specific provider independently, e.g. Claude for chat + OpenAI for
   * vision, a pairing "auto" alone can't express.
   */
  chatProvider?: CapabilityProvider;
  visionProvider?: CapabilityProvider;
  openaiKey?: string;
  geminiKey?: string;
  anthropicKey?: string;
  /** Per-provider, per-capability model overrides — set from the Settings page's model picker. Unset falls back to the env default in config.ts. */
  openaiChatModel?: string;
  openaiVisionModel?: string;
  geminiChatModel?: string;
  geminiVisionModel?: string;
  anthropicChatModel?: string;
  anthropicVisionModel?: string;
}

const KEYS = {
  provider: "llm.provider",
  chatProvider: "llm.chat_provider",
  visionProvider: "llm.vision_provider",
  openaiKey: "llm.openai_key",
  geminiKey: "llm.gemini_key",
  anthropicKey: "llm.anthropic_key",
  openaiChatModel: "llm.openai_chat_model",
  openaiVisionModel: "llm.openai_vision_model",
  geminiChatModel: "llm.gemini_chat_model",
  geminiVisionModel: "llm.gemini_vision_model",
  anthropicChatModel: "llm.anthropic_chat_model",
  anthropicVisionModel: "llm.anthropic_vision_model",
} as const;

let _cache: LlmRuntimeSettings | null = null;
let _loaded = false;

export async function loadRuntimeSettings(): Promise<LlmRuntimeSettings> {
  if (_loaded && _cache) return _cache;
  const rows = await db.appSetting.findMany({
    where: { key: { in: Object.values(KEYS) } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  _cache = {
    provider: (map[KEYS.provider] as LlmProvider) || "auto",
    chatProvider: (map[KEYS.chatProvider] as CapabilityProvider) || undefined,
    visionProvider: (map[KEYS.visionProvider] as CapabilityProvider) || undefined,
    openaiKey: map[KEYS.openaiKey] || undefined,
    geminiKey: map[KEYS.geminiKey] || undefined,
    anthropicKey: map[KEYS.anthropicKey] || undefined,
    openaiChatModel: map[KEYS.openaiChatModel] || undefined,
    openaiVisionModel: map[KEYS.openaiVisionModel] || undefined,
    geminiChatModel: map[KEYS.geminiChatModel] || undefined,
    geminiVisionModel: map[KEYS.geminiVisionModel] || undefined,
    anthropicChatModel: map[KEYS.anthropicChatModel] || undefined,
    anthropicVisionModel: map[KEYS.anthropicVisionModel] || undefined,
  };
  _loaded = true;
  return _cache;
}

export function getRuntimeSettings(): LlmRuntimeSettings | null {
  return _cache;
}

export async function saveRuntimeSettings(patch: Partial<LlmRuntimeSettings>): Promise<LlmRuntimeSettings> {
  const updates: { key: string; value: string }[] = [];

  if (patch.provider !== undefined) updates.push({ key: KEYS.provider, value: patch.provider });
  if (patch.chatProvider !== undefined) updates.push({ key: KEYS.chatProvider, value: patch.chatProvider });
  if (patch.visionProvider !== undefined) updates.push({ key: KEYS.visionProvider, value: patch.visionProvider });
  if (patch.openaiKey !== undefined) updates.push({ key: KEYS.openaiKey, value: patch.openaiKey });
  if (patch.geminiKey !== undefined) updates.push({ key: KEYS.geminiKey, value: patch.geminiKey });
  if (patch.anthropicKey !== undefined) updates.push({ key: KEYS.anthropicKey, value: patch.anthropicKey });
  if (patch.openaiChatModel !== undefined) updates.push({ key: KEYS.openaiChatModel, value: patch.openaiChatModel });
  if (patch.openaiVisionModel !== undefined) updates.push({ key: KEYS.openaiVisionModel, value: patch.openaiVisionModel });
  if (patch.geminiChatModel !== undefined) updates.push({ key: KEYS.geminiChatModel, value: patch.geminiChatModel });
  if (patch.geminiVisionModel !== undefined) updates.push({ key: KEYS.geminiVisionModel, value: patch.geminiVisionModel });
  if (patch.anthropicChatModel !== undefined) updates.push({ key: KEYS.anthropicChatModel, value: patch.anthropicChatModel });
  if (patch.anthropicVisionModel !== undefined) updates.push({ key: KEYS.anthropicVisionModel, value: patch.anthropicVisionModel });

  await Promise.all(
    updates.map((u) =>
      db.appSetting.upsert({
        where: { key: u.key },
        create: u,
        update: { value: u.value },
      }),
    ),
  );

  // Invalidate cache so next getConfig() picks up changes
  _loaded = false;
  _cache = null;
  return loadRuntimeSettings();
}

export async function getLlmStatus() {
  const settings = await loadRuntimeSettings();
  return {
    provider: settings.provider,
    chatProvider: settings.chatProvider ?? "auto",
    visionProvider: settings.visionProvider ?? "auto",
    hasClaudeKey: !!(settings.anthropicKey ?? process.env.ANTHROPIC_API_KEY),
    hasOpenaiKey: !!(settings.openaiKey ?? process.env.OPENAI_API_KEY),
    hasGeminiKey: !!(settings.geminiKey ?? process.env.GEMINI_API_KEY),
  };
}
