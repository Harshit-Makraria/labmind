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
  SkipRequestSummary,
  StepRecord,
  SafetyLogEntry,
  TraceSpan,
} from "@/lib/types";
import { db } from "@/server/db";
import { AUDIT_GENESIS_HASH, hashAuditEntry } from "@/server/tools/audit-chain";
import { DEMO_INSTRUCTOR_CODE } from "@/server/store/code-store";

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
  /** The student's own final measured value (e.g. mean titre, absorbance
   * reading) — stored alongside deviationPercent so the learning summary can
   * compare a pre-lab hypothesis against what was actually measured. */
  studentResult: number | null;
  safetyAlertCount: number;
  duplicatePhotoCount: number;
  steps: StepRecord[];
  safetyLog: SafetyLogEntry[];
  notes: string[];
  /** The student's own pre-experiment prediction — set once via POST
   * /lab/:sessionId/hypothesis, never mutated by this store, so it's read
   * here but excluded from buildPersistPayload/persist() below. */
  hypothesis: string | null;
  /** A pending skip request awaiting instructor approval — see requestSkip(). */
  skipRequestStep: number | null;
  skipRequestAt: number | null;
  /** Set once at join time; null for a solo/library session with no instructor attached. */
  instructorCode: string | null;
  /** When the session row was first created — read-only here (Prisma manages
   * it via @default(now())), needed by pacing analysis to compute elapsed
   * time from the true start rather than from this cache load. */
  createdAt: number;
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

function buildPersistPayload(s: StoredSession) {
  return {
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
    studentResult: s.studentResult,
    safetyAlertCount: s.safetyAlertCount,
    duplicatePhotoCount: s.duplicatePhotoCount,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steps: s.steps as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    safetyLog: s.safetyLog as any,
    notes: s.notes,
    skipRequestStep: s.skipRequestStep,
    skipRequestAt: s.skipRequestStep !== null ? new Date(s.skipRequestAt as number) : null,
  };
}

/** Writes the row and returns the in-flight promise so a caller can await it when the write must be durable before responding. */
function persist(s: StoredSession): Promise<void> {
  const payload = buildPersistPayload(s);
  return db.labSession
    .upsert({ where: { id: s.sessionId }, create: { id: s.sessionId, ...payload }, update: payload })
    .then(() => undefined)
    .catch((e) => console.error("[session-store] persist failed — data may be lost on restart:", e));
}

/**
 * Drop a session from the in-memory cache so the next hydrate re-reads the DB.
 * Required whenever a row is written outside this module (e.g. an instructor
 * resolving a verification), otherwise this instance keeps serving a stale copy.
 */
export function invalidateSessionCache(id: string) {
  store().sessions.delete(id);
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
      studentResult: row.studentResult,
      safetyAlertCount: row.safetyAlertCount,
      duplicatePhotoCount: row.duplicatePhotoCount,
      steps: (row.steps as unknown as StepRecord[]) ?? [],
      safetyLog: (row.safetyLog as unknown as SafetyLogEntry[]) ?? [],
      notes: (row.notes as unknown as string[]) ?? [],
      hypothesis: row.hypothesis,
      skipRequestStep: row.skipRequestStep,
      skipRequestAt: row.skipRequestAt?.getTime() ?? null,
      instructorCode: row.instructorCode,
      createdAt: row.createdAt.getTime(),
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
  /** Set on join — the DB row already has this from the direct upsert in the
   * /student/join route, but that call bypasses this in-memory cache, so a
   * freshly-created cache entry needs it passed in explicitly or the client
   * would see instructor_code: null for a session that IS instructor-led. */
  instructorCode?: string | null;
}): StoredSession {
  const existing = store().sessions.get(input.sessionId);
  const steps: StepRecord[] = Array.from({ length: input.totalSteps }, (_, i) => blankStep(i + 1));
  const session: StoredSession = existing ?? {
    sessionId: input.sessionId,
    studentName: input.studentName ?? "Student",
    experimentId: input.experimentId,
    experimentName: input.experimentName,
    currentStep: 1,
    totalSteps: input.totalSteps,
    status: "active",
    reagentHistory: [],
    lastVisionPass: null,
    deviationPercent: null,
    studentResult: null,
    safetyAlertCount: 0,
    duplicatePhotoCount: 0,
    steps,
    safetyLog: [],
    notes: [],
    hypothesis: null,
    skipRequestStep: null,
    skipRequestAt: null,
    instructorCode: input.instructorCode ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  session.experimentId = input.experimentId;
  session.experimentName = input.experimentName;
  if (input.instructorCode !== undefined) session.instructorCode = input.instructorCode;
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
  persist(s).catch(() => {}); // errors already logged inside persist()
  return s;
}

/**
 * Same as mutate(), but awaits the DB write before returning. Serverless
 * (Vercel) can freeze a function instance right after it sends its HTTP
 * response, which can cut off an in-flight fire-and-forget upsert — this is
 * why "completed" experiments intermittently never actually persisted as
 * completed. Use this for state transitions the student/instructor depend on
 * being durable the moment the request that caused them returns.
 */
async function mutateAwait(id: string, fn: (s: StoredSession) => void): Promise<StoredSession | undefined> {
  const s = store().sessions.get(id);
  if (!s) return undefined;
  fn(s);
  s.updatedAt = Date.now();
  await persist(s);
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

/** A student in an instructor-led session can't self-skip — a request sits here until the instructor approves it or it expires. */
export const SKIP_REQUEST_TIMEOUT_MS = 60_000;

export function requestSkip(id: string, stepNumber: number) {
  return mutate(id, (s) => {
    s.skipRequestStep = stepNumber;
    s.skipRequestAt = Date.now();
  });
}

/**
 * Instructor approves a pending skip request — performs the actual skip
 * (same effect as skipStep) and clears the request. Returns null if there is
 * no live (unexpired) request to approve, so the route can tell the
 * instructor their tap was too late rather than silently doing nothing.
 * Awaits the write (see mutateAwait) — the requesting student's poll loop
 * needs to see this durably, not lose it to a frozen serverless instance.
 */
export async function approveSkipRequest(id: string, affected: number[]): Promise<StoredSession | undefined | null> {
  const s = store().sessions.get(id);
  if (!s) return undefined;
  if (s.skipRequestStep === null || s.skipRequestAt === null || Date.now() - s.skipRequestAt >= SKIP_REQUEST_TIMEOUT_MS) {
    return null;
  }
  const stepNumber = s.skipRequestStep;
  return mutateAwait(id, (sess) => {
    const rec = stepRec(sess, stepNumber);
    if (rec) rec.state = "skipped";
    for (const a of affected) {
      const ar = stepRec(sess, a);
      if (ar) ar.flagged = true;
    }
    sess.skipRequestStep = null;
    sess.skipRequestAt = null;
  });
}

/** Instructor explicitly declines, or the student's poll discovers the request timed out — either way, clear it so it stops showing as pending. */
export function clearSkipRequest(id: string) {
  return mutate(id, (s) => {
    s.skipRequestStep = null;
    s.skipRequestAt = null;
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

/**
 * Append one row to the tamper-evident audit log (AuditLogEntry — insert
 * only, no update/delete path anywhere in the app). Chained from whichever
 * row was last written for this session, so the hash is fixed independently
 * of the mutable `safetyLog` JSON copy kept on the session for display.
 */
async function appendAuditEntry(sessionId: string, stepNumber: number, alerts: SafetyConflict[]) {
  const top = alerts[0];
  const summary = top ? `${top.type}: ${top.reagents.join(" + ")} — ${top.action}` : "Safety check recorded";
  const severity = top?.severity ?? "low";
  try {
    const last = await db.auditLogEntry.findFirst({ where: { sessionId }, orderBy: { id: "desc" } });
    const prevHash = last?.hash ?? AUDIT_GENESIS_HASH;
    const at = new Date();
    const hash = hashAuditEntry(prevHash, at.toISOString(), stepNumber, summary, severity);
    await db.auditLogEntry.create({ data: { sessionId, stepNumber, summary, severity, prevHash, hash, at } });
  } catch (e) {
    console.error("[session-store] audit log append failed — this entry will be missing from the tamper-evident chain:", e);
  }
}

export function recordSafetyAlert(id: string, stepNumber: number, alerts: SafetyConflict[]) {
  appendAuditEntry(id, stepNumber, alerts).catch(() => {});
  return mutate(id, (s) => {
    s.safetyAlertCount += 1;
    s.status = "safety_alert";
    s.safetyLog.push({ step_number: stepNumber, alerts, at: new Date().toISOString() });
  });
}

/**
 * Record a caught duplicate-photo submission (same image resubmitted for a
 * different step, or matching a photo submitted by another student in the
 * same cohort). Previously a clash was only console.warn'd and traced —
 * invisible to the instructor and to the risk engine. This makes it a
 * durable, instructor-visible signal like a safety alert.
 */
export function recordDuplicatePhoto(id: string, stepNumber: number, note: string) {
  return mutate(id, (s) => {
    s.duplicatePhotoCount += 1;
    s.notes.push(`Duplicate photo detected on step ${stepNumber}: ${note}`);
  });
}

export function clearSafetyAlert(id: string) {
  return mutate(id, (s) => {
    if (s.status === "safety_alert") s.status = "active";
  });
}

export function recordResult(id: string, deviationPercent: number, studentResult?: number) {
  return mutateAwait(id, (s) => {
    s.deviationPercent = deviationPercent;
    if (studentResult !== undefined) s.studentResult = studentResult;
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

/**
 * The instructor "bench wall" — scoped to this instructor's own classes.
 * Joins through instructorCode → InstructorSession.createdByUserId since
 * LabSession has no direct owner column of its own.
 *
 * This used to also include every session with NO instructor at all
 * (instructorCode: null — a student working solo from the library) and
 * every OTHER instructor's ownerless class, both visible to every instructor
 * account. Neither makes sense: a solo student's session was never part of
 * any instructor's class, and an ownerless class belonging to a different
 * instructor is exactly the leak this scoping exists to prevent. Only the
 * shared demo class (DEMO_INSTRUCTOR_CODE) still shows up for everyone.
 */
export async function allSummariesFromDB(ownerUserId?: string): Promise<SessionSummary[]> {
  const rows = await db.labSession.findMany({
    where: ownerUserId
      ? { instructor: { OR: [{ createdByUserId: ownerUserId }, { code: DEMO_INSTRUCTOR_CODE }] } }
      : undefined,
    orderBy: { updatedAt: "desc" },
    // This is polled every few seconds by every open instructor tab — select
    // only what a summary needs, not the growing reagentHistory/safetyLog/
    // notes JSON blobs that pile up over a session's lifetime.
    select: {
      id: true, studentName: true, experimentId: true, experimentName: true,
      currentStep: true, totalSteps: true, status: true, lastVisionPass: true,
      deviationPercent: true, safetyAlertCount: true, steps: true, updatedAt: true,
    },
  });
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

function skipRequestInfo(s: StoredSession): SessionDetail["skip_request"] {
  if (s.skipRequestStep === null || s.skipRequestAt === null) return null;
  const secondsRemaining = Math.max(0, Math.round((SKIP_REQUEST_TIMEOUT_MS - (Date.now() - s.skipRequestAt)) / 1000));
  return {
    step_number: s.skipRequestStep,
    requested_at: new Date(s.skipRequestAt).toISOString(),
    seconds_remaining: secondsRemaining,
  };
}

export function getSessionDetail(id: string): SessionDetail | undefined {
  const s = store().sessions.get(id);
  if (!s) return undefined;
  return { ...summarize(s), steps: s.steps, safety_log: s.safetyLog, instructor_code: s.instructorCode, skip_request: skipRequestInfo(s) };
}

export async function getSessionDetailFromDB(id: string): Promise<SessionDetail | undefined> {
  const s = await hydrateSession(id);
  if (!s) return undefined;
  return { ...summarize(s), steps: s.steps, safety_log: s.safetyLog, instructor_code: s.instructorCode, skip_request: skipRequestInfo(s) };
}

/**
 * Sessions with a live (unexpired) pending skip request, scoped to this
 * instructor's own classes — same ownership rule as allSummariesFromDB.
 */
export async function listPendingSkipRequests(ownerUserId?: string): Promise<SkipRequestSummary[]> {
  const cutoff = new Date(Date.now() - SKIP_REQUEST_TIMEOUT_MS);
  const rows = await db.labSession.findMany({
    where: {
      skipRequestStep: { not: null },
      skipRequestAt: { gte: cutoff },
      // A skip request only ever exists on an instructor-linked session
      // (request_skip falls back to an instant skip otherwise, never
      // setting these fields), so there's no "instructorCode: null" case to
      // handle here — just scope to this instructor's own classes plus the
      // shared demo one.
      ...(ownerUserId ? { instructor: { OR: [{ createdByUserId: ownerUserId }, { code: DEMO_INSTRUCTOR_CODE }] } } : {}),
    },
    select: { id: true, studentName: true, skipRequestStep: true, skipRequestAt: true },
    orderBy: { skipRequestAt: "asc" },
  });
  return rows.map((row) => ({
    session_id: row.id,
    student_name: row.studentName,
    step_number: row.skipRequestStep as number,
    requested_at: (row.skipRequestAt as Date).toISOString(),
    seconds_remaining: Math.max(0, Math.round((SKIP_REQUEST_TIMEOUT_MS - (Date.now() - (row.skipRequestAt as Date).getTime())) / 1000)),
  }));
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
