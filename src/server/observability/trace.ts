/** Lightweight tool-call tracing → in-memory ring buffer for the dashboard panel. */
import "server-only";
import { addTrace } from "@/server/store/session-store";

export function recordTrace(
  toolName: string,
  inputSummary: string,
  outputSummary: string,
  latencyMs: number,
  confidence: number | null = null,
) {
  addTrace({
    tool_name: toolName,
    input_summary: inputSummary,
    output_summary: outputSummary,
    latency_ms: latencyMs,
    confidence,
    timestamp: new Date().toISOString(),
  });
}
