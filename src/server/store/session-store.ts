/**
 * Session store — in-memory L1 cache backed by Prisma/Supabase.
 *
 * Sync API is kept so agent tools can call getSession() without await.
 * Every mutation fires a non-blocking Prisma upsert so data survives restarts.
 */
import "server-only";
import type {
  AgentDecision,
  Reagent,
  SafetyConflict,
  SessionDetail,
  SessionStatus,
  SessionSummary,
  StepRecord,
  SafetyLogEntry,
  TraceSpan,
} from "@/lib/types";
import { db } from "@/server/db";

export interface StoredSession {
  sessionId: string;
  studentName: string;
  experimentId: string;
  experimentName: string;
  currentStep: number;
  totalSteps: number;
  status: SessionStatus;
  reagentHistory: Reagent[];
  lastVisionPass: boolean | null;
  deviationPercent: number | null;
  safetyAlertCount: number;
  steps: StepRecord[];
  safetyLog: SafetyLogEntry[];
  notes: string[];
  updatedAt: number;
}

interface StoreShape {
  sessions: Map<string, StoredSession>;
  traces: TraceSpan[];
  decisions: AgentDecision[];
}

const g = globalThis as unknown as { __labmindStore?: StoreShape };
function store(): StoreShape {
  if (!g.__labmindStore) g.__labmindStore = { sessions: new Map(), traces: [], decisions: [] };
  return g.__labmindStore;
}

function blankStep(n: number): StepRecord {
  return {
    step_number: n,
    state: "pending",
    flagged: false,
    vision_attempts: 0,
    vision_reading: null,
    vision_pass: null,
    manual_override: null,
    completed_at: null,
  };
}

// ─── Prisma persistence helpers ─────────────────────────────────────

function persist(s: StoredSession) {
  db.labSession
    .upsert({
      where: { id: s.sessionId },
      create: {
        id: s.sessionId,
        studentName: s.studentName,
        experimentId: s.experimentId,
        experimentName: s.experimentName,
        currentStep: s.currentStep,
        totalSteps: s.totalSteps,
        status: s.status,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reagentHistory: s.reagentHistory as any,
        lastVisionPass: s.lastVisionPass,
        deviationPercent: s.deviationPercent,
        safetyAlertCount: s.safetyAlertCount,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        steps: s.steps as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        safetyLog: s.safetyLog as any,
        notes: s.notes,
      },
      update: {
        studentName: s.studentName,
        experimentId: s.experimentId,
        experimentName: s.experimentName,
        currentStep: s.currentStep,
        totalSteps: s.totalSteps,
        status: s.status,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reagentHistory: s.reagentHistory as any,
        lastVisionPass: s.lastVisionPass,
        deviationPercent: s.deviationPercent,
        safetyAlertCount: s.safetyAlertCount,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        steps: s.steps as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        safetyLog: s.safetyLog as any,
        notes: s.notes,
      },
    })
    .catch((e) => console.error("[session-store] persist failed:", e));
}

/** Hydrate a session from DB into the in-memory cache. */
export async function hydrateSession(id: string): Promise<StoredSession | undefined> {
  if (store().sessions.has(id)) return store().sessions.get(id);
  try {
    const row = await db.labSession.findUnique({ where: { id } });
    if (!row) return undefined;
    const s: StoredSession = {
      sessionId: row.id,
      studentName: row.studentName,
      experimentId: row.experimentId,
      experimentName: row.experimentName,
      currentStep: row.currentStep,
      totalSteps: row.totalSteps,
      status: row.status as SessionStatus,
      reagentHistory: (row.reagentHistory as unknown as Reagent[]) ?? [],
      lastVisionPass: row.lastVisionPass,
      deviationPercent: row.deviationPercent,
      safetyAlertCount: row.safetyAlertCount,
      steps: (row.steps as unknown as StepRecord[]) ?? [],
      safetyLog: (row.safetyLog as unknown as SafetyLogEntry[]) ?? [],
      notes: (row.notes as unknown as string[]) ?? [],
      updatedAt: row.updatedAt.getTime(),
    };
    store().sessions.set(id, s);
    return s;
  } catch {
    return undefined;
  }
}

// ─── Core CRUD ──────────────────────────────────────────────────────

export function upsertSession(input: {
  sessionId: string;
  studentName?: string;
  experimentId: string;
  experimentName: string;
  totalSteps: number;
}): StoredSession {
  const existing = store().sessions.get(input.sessionId);
  const steps: StepRecord[] = Array.from({ length: input.totalSteps }, (_, i) => blankStep(i + 1));
  const session: StoredSession = existing ?? {
    sessionId: input.sessionId,
    studentName: input.studentName ?? "You (live)",
    experimentId: input.experimentId,
    experimentName: input.experimentName,
    currentStep: 1,
    totalSteps: input.totalSteps,
    status: "active",
    reagentHistory: [],
    lastVisionPass: null,
    deviationPercent: null,
    safetyAlertCount: 0,
    steps,
    safetyLog: [],
    notes: [],
    updatedAt: Date.now(),
  };
  session.experimentId = input.experimentId;
  session.experimentName = input.experimentName;
  if (input.studentName) session.studentName = input.studentName;
  if (session.steps.length !== input.totalSteps) {
    session.steps = steps;
    session.totalSteps = input.totalSteps;
  }
  session.updatedAt = Date.now();
  store().sessions.set(session.sessionId, session);
  persist(session);
  return session;
}

export function getSession(id: string): StoredSession | undefined {
  return store().sessions.get(id);
}

function mutate(id: string, fn: (s: StoredSession) => void): StoredSession | undefined {
  const s = store().sessions.get(id);
  if (!s) return undefined;
  fn(s);
  s.updatedAt = Date.now();
  persist(s);
  return s;
}

function stepRec(s: StoredSession, n: number): StepRecord | undefined {
  return s.steps.find((x) => x.step_number === n);
}

export function setCurrentStep(id: string, step: number) {
  return mutate(id, (s) => { s.currentStep = step; });
}

export function setStudentName(id: string, name: string) {
  return mutate(id, (s) => { s.studentName = name; });
}

export function addReagents(id: string, reagents: Reagent[]) {
  return mutate(id, (s) => {
    for (const r of reagents) {
      if (!s.reagentHistory.some((h) => h.name.toLowerCase() === r.name.toLowerCase())) {
        s.reagentHistory.push(r);
      }
    }
  });
}

export function completeStep(id: string, stepNumber: number) {
  return mutate(id, (s) => {
    const rec = stepRec(s, stepNumber);
    if (rec) { rec.state = "completed"; rec.completed_at = new Date().toISOString(); }
  });
}

export function skipStep(id: string, stepNumber: number, affected: number[]) {
  return mutate(id, (s) => {
    const rec = stepRec(s, stepNumber);
    if (rec) rec.state = "skipped";
    for (const a of affected) {
      const ar = stepRec(s, a);
      if (ar) ar.flagged = true;
    }
  });
}

export function flagDownstreamSteps(id: string, skippedStep: number, affected: number[]) {
  return mutate(id, (s) => {
    for (const a of affected) {
      const ar = stepRec(s, a);
      if (ar) ar.flagged = true;
    }
  });
}

export function recordVision(id: string, stepNumber: number, reading: number | null, pass: boolean): number {
  let attempts = 1;
  mutate(id, (s) => {
    s.lastVisionPass = pass;
    const rec = stepRec(s, stepNumber);
    if (rec) {
      rec.vision_attempts += 1;
      rec.vision_reading = reading;
      rec.vision_pass = pass;
      attempts = rec.vision_attempts;
    }
  });
  return attempts;
}

export function manualOverride(id: string, stepNumber: number, value: number | null, note: string) {
  return mutate(id, (s) => {
    const rec = stepRec(s, stepNumber);
    if (rec) {
      rec.manual_override = { value, note };
      rec.state = "completed";
      rec.completed_at = new Date().toISOString();
    }
    s.notes.push(`Manual override on step ${stepNumber}: ${note}`);
  });
}

export function recordSafetyAlert(id: string, stepNumber: number, alerts: SafetyConflict[]) {
  return mutate(id, (s) => {
    s.safetyAlertCount += 1;
    s.status = "safety_alert";
    s.safetyLog.push({ step_number: stepNumber, alerts, at: new Date().toISOString() });
  });
}

export function clearSafetyAlert(id: string) {
  return mutate(id, (s) => {
    if (s.status === "safety_alert") s.status = "active";
  });
}

export function recordResult(id: string, deviationPercent: number) {
  return mutate(id, (s) => {
    s.deviationPercent = deviationPercent;
    s.status = "completed";
    s.currentStep = s.totalSteps;
  });
}

export function addInstructorNote(id: string, msg: string) {
  return mutate(id, (s) => { s.notes.push(msg); });
}

function summarize(s: StoredSession): SessionSummary {
  return {
    session_id: s.sessionId,
    student_name: s.studentName,
    experiment_id: s.experimentId,
    experiment_name: s.experimentName,
    current_step: s.currentStep,
    total_steps: s.totalSteps,
    status: s.status,
    last_vision_pass: s.lastVisionPass,
    deviation_percent: s.deviationPercent,
    safety_alert_count: s.safetyAlertCount,
    flagged_step_count: s.steps.filter((x) => x.flagged).length,
    override_count: s.steps.filter((x) => x.manual_override).length,
    updated_at: new Date(s.updatedAt).toISOString(),
  };
}

export function allSummaries(): SessionSummary[] {
  return Array.from(store().sessions.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(summarize);
}

export async function allSummariesFromDB(): Promise<SessionSummary[]> {
  const rows = await db.labSession.findMany({ orderBy: { updatedAt: "desc" } });
  return rows.map((row) => {
    const steps = (row.steps as unknown as StepRecord[]) ?? [];
    return {
      session_id: row.id,
      student_name: row.studentName,
      experiment_id: row.experimentId,
      experiment_name: row.experimentName,
      current_step: row.currentStep,
      total_steps: row.totalSteps,
      status: row.status as SessionStatus,
      last_vision_pass: row.lastVisionPass,
      deviation_percent: row.deviationPercent,
      safety_alert_count: row.safetyAlertCount,
      flagged_step_count: steps.filter((x) => x.flagged).length,
      override_count: steps.filter((x) => x.manual_override).length,
      updated_at: row.updatedAt.toISOString(),
    };
  });
}

export function getSessionDetail(id: string): SessionDetail | undefined {
  const s = store().sessions.get(id);
  if (!s) return undefined;
  return { ...summarize(s), steps: s.steps, safety_log: s.safetyLog };
}

export async function getSessionDetailFromDB(id: string): Promise<SessionDetail | undefined> {
  const s = await hydrateSession(id);
  if (!s) return undefined;
  return { ...summarize(s), steps: s.steps, safety_log: s.safetyLog };
}

export function getNotes(id: string): string[] {
  return store().sessions.get(id)?.notes ?? [];
}

// ─── Agent decisions ─────────────────────────────────────────────────

const MAX_DECISIONS = 60;

export function logAgentDecision(d: AgentDecision) {
  const s = store();
  s.decisions.unshift(d);
  if (s.decisions.length > MAX_DECISIONS) s.decisions.length = MAX_DECISIONS;
  db.agentDecision
    .create({
      data: {
        id: d.id,
        sessionId: d.session_id,
        trigger: d.trigger,
        plan: d.plan,
        tools: d.tools as object[],
        outcome: d.outcome,
        provider: d.provider,
        latencyMs: d.latency_ms,
      },
    })
    .catch(() => {});
}

export function getAgentDecisions(): AgentDecision[] {
  return store().decisions;
}

export async function getAgentDecisionsFromDB(): Promise<AgentDecision[]> {
  const rows = await db.agentDecision.findMany({ orderBy: { createdAt: "desc" }, take: 60 });
  return rows.map((r) => ({
    id: r.id,
    session_id: r.sessionId,
    trigger: r.trigger,
    plan: r.plan,
    tools: r.tools as AgentDecision["tools"],
    outcome: r.outcome,
    provider: r.provider,
    latency_ms: r.latencyMs,
    at: r.createdAt.toISOString(),
  }));
}

// ─── Observability traces ────────────────────────────────────────────

const MAX_TRACES = 60;

export function addTrace(span: TraceSpan) {
  const s = store();
  s.traces.unshift(span);
  if (s.traces.length > MAX_TRACES) s.traces.length = MAX_TRACES;
  db.traceSpan
    .create({
      data: {
        toolName: span.tool_name,
        inputSummary: span.input_summary,
        outputSummary: span.output_summary,
        latencyMs: span.latency_ms,
        confidence: span.confidence,
      },
    })
    .catch(() => {});
}

export function getTraces(): TraceSpan[] {
  return store().traces;
}

export async function getTracesFromDB(): Promise<TraceSpan[]> {
  const rows = await db.traceSpan.findMany({ orderBy: { createdAt: "desc" }, take: 60 });
  return rows.map((r) => ({
    tool_name: r.toolName,
    input_summary: r.inputSummary,
    output_summary: r.outputSummary,
    latency_ms: r.latencyMs,
    confidence: r.confidence,
    timestamp: r.createdAt.toISOString(),
  }));
}
