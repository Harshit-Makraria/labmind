/**
 * In-memory tracking of exhausted LLM providers.
 * Persists for the lifetime of the server process. Resets on cold start.
 */
import "server-only";

export type ExhaustedReason = "quota" | "invalid_key";

const _exhausted = new Map<string, ExhaustedReason>();

export function markExhausted(provider: string, reason: ExhaustedReason = "quota") {
  _exhausted.set(provider, reason);
}

export function isExhausted(provider: string): boolean {
  return _exhausted.has(provider);
}

export function exhaustedProviders(): Record<string, ExhaustedReason> {
  return Object.fromEntries(_exhausted);
}

export function anyExhausted(): boolean {
  return _exhausted.size > 0;
}
