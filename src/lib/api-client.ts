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
  ProfileData,
  SafetyCheckRequest,
  SafetyResult,
  SessionAction,
  SessionDetail,
  SessionSummary,
  SkipRequestSummary,
  TraceSpan,
  VisionCheckRequest,
  VisionResult,
} from "@/lib/types";

/** Thrown so callers can branch on a specific server rejection (e.g. the pre-lab gate). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
  }
}

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text); } catch { /* non-JSON error body */ }
    throw new ApiError(
      (parsed.error as string) ?? `${path} failed: ${res.status}`,
      res.status,
      parsed,
    );
  }
  return res.json() as Promise<TRes>;
}

async function patch<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text); } catch { /* non-JSON error body */ }
    throw new ApiError((parsed.error as string) ?? `${path} failed: ${res.status}`, res.status, parsed);
  }
  return res.json() as Promise<TRes>;
}

/**
 * Shared GET helper — throws ApiError (status attached) on a non-ok response,
 * consistent with post() above. Exported as fetchJson so pages that need a
 * plain GET (dashboard, risk, verify, wall, session/[code], integrity) can
 * distinguish a real 401/403 from a transport failure instead of duplicating
 * a local helper that threw a bare Error with no status — which is what let
 * a genuine "Forbidden" response render as "You're offline" (that copy is
 * driven by TanStack Query's isPaused, not by inspecting the actual error).
 */
async function get<TRes>(path: string): Promise<TRes> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text); } catch { /* non-JSON error body */ }
    throw new ApiError((parsed.error as string) ?? `${path} failed: ${res.status}`, res.status, parsed);
  }
  return res.json() as Promise<TRes>;
}

export const fetchJson = get;

/** True for a genuine 401/403 — never fixed by retrying, unlike a network blip. */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
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

  skipRequests: () => get<SkipRequestSummary[]>("/api/instructor/skip-requests"),
  approveSkipRequest: (sessionId: string) =>
    post<Record<string, never>, { ok: boolean; step_number: number }>(`/api/instructor/skip-requests/${sessionId}/approve`, {}),
  denySkipRequest: (sessionId: string) =>
    post<Record<string, never>, { ok: boolean }>(`/api/instructor/skip-requests/${sessionId}/deny`, {}),

  profile: () => get<ProfileData>("/api/profile"),
  updateProfileName: (name: string) => patch<{ name: string }, { ok: boolean; name: string }>("/api/profile", { name }),
  deleteAccount: () => post<{ confirm: string }, { ok: boolean }>("/api/profile/delete", { confirm: "DELETE" }),
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
