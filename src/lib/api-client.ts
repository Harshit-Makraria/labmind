/**
 * Typed client for the LabMind Route Handlers (same-origin, ships inside the app).
 */
import type {
  AgentChatRequest,
  AgentDecision,
  AgentEvent,
  ExperimentMeta,
  InterpretRequest,
  InterpretResult,
  ParseProtocolRequest,
  ParseProtocolResponse,
  SafetyCheckRequest,
  SafetyResult,
  SessionAction,
  SessionDetail,
  SessionSummary,
  TraceSpan,
  VisionCheckRequest,
  VisionResult,
} from "@/lib/types";

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<TRes>;
}

async function get<TRes>(path: string): Promise<TRes> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<TRes>;
}

export const api = {
  experiments: () => get<ExperimentMeta[]>("/api/experiments"),

  parseProtocol: (req: ParseProtocolRequest) =>
    post<ParseProtocolRequest, ParseProtocolResponse>("/api/protocol/parse", req),

  checkVision: (req: VisionCheckRequest) =>
    post<VisionCheckRequest, VisionResult>("/api/vision/check", req),

  checkSafety: (req: SafetyCheckRequest) =>
    post<SafetyCheckRequest, SafetyResult>("/api/safety/check", req),

  interpret: (req: InterpretRequest) =>
    post<InterpretRequest, InterpretResult>("/api/results/interpret", req),

  sessionAction: (session_id: string, action: SessionAction) =>
    post<
      { session_id: string; action: SessionAction },
      { ok: boolean; current_step: number | null; pending_verification?: boolean; verification_id?: string; message?: string }
    >("/api/session/action", { session_id, action }),

  sessionDetail: (id: string) => get<SessionDetail & { notes: string[] }>(`/api/session/${id}`),

  dashboardSessions: () => get<SessionSummary[]>("/api/dashboard/sessions"),
  dashboardTraces: () => get<TraceSpan[]>("/api/dashboard/traces"),
  dashboardDecisions: () => get<AgentDecision[]>("/api/dashboard/decisions"),

  verifyPasscode: (passcode: string) =>
    get<{ ok: boolean }>(`/api/dashboard/verify?passcode=${encodeURIComponent(passcode)}`),
};

/**
 * Stream the agent's reasoning over SSE. Calls `onEvent` for every event
 * (plan / tool_call / tool_result / delta / done / error).
 */
export async function streamAgentChat(
  req: AgentChatRequest,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.body) throw new Error("no stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as AgentEvent);
      } catch {
        /* ignore malformed keep-alive */
      }
    }
  }
}
