/**
 * Server-only configuration.
 * Provider-agnostic LLM selection.
 * Default: "auto" — tries OpenAI (gpt-4o-mini) then Gemini (gemini-1.5-flash), falls back to demo.
 */
import "server-only";
import { getRuntimeSettings } from "@/server/runtime-config";

export type LlmProvider = "demo" | "auto" | "gemini" | "openai" | "azure" | "claude";

export interface LabmindConfig {
  llmProvider: LlmProvider;
  demoMode: boolean;
  geminiApiKey?: string;
  geminiModel: string;
  openaiApiKey?: string;
  openaiModel: string;
  anthropicApiKey?: string;
  anthropicModel: string;
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
    geminiModel: env.GEMINI_MODEL ?? "gemini-1.5-flash",
    openaiApiKey: rt?.openaiKey ?? env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL ?? "gpt-4o-mini",
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",
    azureEndpoint: env.AZURE_OPENAI_ENDPOINT,
    azureApiKey: env.AZURE_OPENAI_API_KEY,
    azureDeployment: env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o-mini",
    azureApiVersion: env.AZURE_OPENAI_API_VERSION ?? "2024-02-01",
    instructorPasscode: env.INSTRUCTOR_PASSCODE ?? "labmind2026",
  };
}

/** Demo if explicitly toggled, or no keys are available for the chosen provider. */
export function effectiveDemo(c: LabmindConfig = getConfig()): boolean {
  if (c.demoMode || c.llmProvider === "demo") return true;
  if (c.llmProvider === "auto") {
    // auto mode: demo only if both keys are missing
    return !c.openaiApiKey && !c.geminiApiKey;
  }
  if (c.llmProvider === "gemini" && !c.geminiApiKey) return true;
  if (c.llmProvider === "openai" && !c.openaiApiKey) return true;
  if (c.llmProvider === "azure" && !c.azureApiKey) return true;
  if (c.llmProvider === "claude" && !c.anthropicApiKey) return true;
  return false;
}

/** Human-readable label for the active engine (shown in the UI / traces). */
export function providerLabel(): string {
  const c = getConfig();
  if (effectiveDemo(c)) return "demo";
  if (c.llmProvider === "auto") {
    // show which will be tried first
    if (c.openaiApiKey) return "openai";
    return "gemini";
  }
  return c.llmProvider;
}
