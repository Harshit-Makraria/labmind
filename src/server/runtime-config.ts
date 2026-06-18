/**
 * Runtime LLM config that can be changed via the settings UI.
 * Overrides environment variables for the lifetime of the process.
 * Persisted to the AppSetting table so changes survive cold starts.
 */
import "server-only";
import { db } from "@/server/db";
import type { LlmProvider } from "@/server/config";

export interface LlmRuntimeSettings {
  provider: LlmProvider;
  openaiKey?: string;
  geminiKey?: string;
}

const KEYS = {
  provider: "llm.provider",
  openaiKey: "llm.openai_key",
  geminiKey: "llm.gemini_key",
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
    openaiKey: map[KEYS.openaiKey] || undefined,
    geminiKey: map[KEYS.geminiKey] || undefined,
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
  if (patch.openaiKey !== undefined) updates.push({ key: KEYS.openaiKey, value: patch.openaiKey });
  if (patch.geminiKey !== undefined) updates.push({ key: KEYS.geminiKey, value: patch.geminiKey });

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
    hasOpenaiKey: !!(settings.openaiKey ?? process.env.OPENAI_API_KEY),
    hasGeminiKey: !!(settings.geminiKey ?? process.env.GEMINI_API_KEY),
    // Never expose actual key values to the client
  };
}
