/**
 * Hono catch-all — handles every /api/* route.
 * All individual route files under /api/ have been removed; this is the sole entry point.
 */
import { Hono } from "hono";
import { handle } from "hono/vercel";

import type { AgentChatRequest, AgentEvent, InterpretRequest, ParseProtocolRequest, SafetyCheckRequest, SessionAction, VisionCheckRequest } from "@/lib/types";
import { VISION_HIGH_CONFIDENCE } from "@/lib/types";
import { effectiveDemo, getConfig, providerLabel } from "@/server/config";
import { DEFAULT_EXPERIMENT_ID, getExperiment, listExperiments } from "@/server/experiments";
import { recordTrace } from "@/server/observability/trace";
import { runAgentStream } from "@/server/agent/orchestrator";
import { AGENT_TOOL_NAMES } from "@/server/agent/orchestrator";
import { flagDownstreamStepsFor } from "@/server/agent/tools";
import { checkSafety } from "@/server/tools/safety";
import { checkVision } from "@/server/tools/vision";
import { interpret } from "@/server/tools/result-interpreter";
import { parseProtocol } from "@/server/tools/protocol-parser";
import { buildLearningSummary, buildReport } from "@/server/tools/summary";
import { MOCK_SESSIONS } from "@/server/data/mock-sessions";
import { generatePrelabQuiz, scorePrelabQuiz } from "@/server/tools/prelab-quiz";
import {
  addReagents, allSummariesFromDB, clearSafetyAlert, completeStep,
  flagDownstreamSteps, getAgentDecisionsFromDB, getSessionDetailFromDB,
  getTracesFromDB, hydrateSession, logAgentDecision, manualOverride,
  recordResult, recordSafetyAlert, recordVision, setCurrentStep, setStudentName,
  upsertSession,
} from "@/server/store/session-store";
import { db } from "@/server/db";
import {
  addStudentToSession, createInstructorSession, getInstructorSession,
  listInstructorSessions, listVerifications, resolveVerification,
  seedDemoData, submitVerification,
} from "@/server/store/code-store";
import { getLlmStatus, loadRuntimeSettings, saveRuntimeSettings } from "@/server/runtime-config";
import { exhaustedProviders, anyExhausted } from "@/server/llm/provider-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const app = new Hono().basePath("/api");

app.onError((err, c) => {
  console.error("[API error]", err);
  return c.json({ error: err.message ?? "Internal server error" }, 500);
});

// ─── Init on first request ───────────────────────────────────────────
let seeded = false;
app.use("*", async (_c, next) => {
  if (!seeded) {
    seeded = true;
    await Promise.all([
      seedDemoData().catch(() => {}),
      loadRuntimeSettings().catch(() => {}),
    ]);
  }
  return next();
});

// ─── Experiments ────────────────────────────────────────────────────
app.get("/experiments", (c) => c.json(listExperiments()));

// ─── Meta ────────────────────────────────────────────────────────────
app.get("/meta", (c) => {
  const keysExhausted = anyExhausted();
  const isDemo = effectiveDemo() || keysExhausted;
  return c.json({
    provider: providerLabel(),
    configured_provider: getConfig().llmProvider,
    demo: isDemo,
    keys_exhausted: keysExhausted,
    exhausted_providers: exhaustedProviders(),
    agent_tools: AGENT_TOOL_NAMES,
  });
});

// ─── LLM Settings ────────────────────────────────────────────────────
app.get("/settings/llm", async (c) => {
  const status = await getLlmStatus();
  const keysExhausted = anyExhausted();
  return c.json({
    ...status,
    keys_exhausted: keysExhausted,
    exhausted_providers: exhaustedProviders(),
  });
});

app.patch("/settings/llm", async (c) => {
  const body = await c.req.json<{ provider?: string; openai_key?: string; gemini_key?: string }>();
  const updated = await saveRuntimeSettings({
    provider: body.provider as Parameters<typeof saveRuntimeSettings>[0]["provider"],
    openaiKey: body.openai_key,
    geminiKey: body.gemini_key,
  });
  return c.json({ ok: true, provider: updated.provider });
});

// ─── Protocol parse ──────────────────────────────────────────────────
app.post("/protocol/parse", async (c) => {
  const body = await c.req.json<ParseProtocolRequest>();
  if (!body?.session_id) return c.json({ error: "session_id required" }, 400);
  const t0 = Date.now();
  const exp = getExperiment(body.experiment_id);
  const protocol = await parseProtocol(body.pdf_base64, body.experiment_id);
  upsertSession({ sessionId: body.session_id, studentName: body.student_name, experimentId: exp.id, experimentName: protocol.experiment_name, totalSteps: protocol.steps.length });
  recordTrace("protocol_parser", body.pdf_base64 ? "PDF upload" : `library: ${exp.id}`, `${protocol.experiment_name} · ${protocol.steps.length} steps`, Date.now() - t0);
  return c.json({ ...protocol, session_id: body.session_id, experiment_id: exp.id, theoretical: exp.theoretical });
});

// ─── Safety check ────────────────────────────────────────────────────
app.post("/safety/check", async (c) => {
  const body = await c.req.json<SafetyCheckRequest>();
  const t0 = Date.now();
  if (body.session_id) addReagents(body.session_id, body.reagents ?? []);
  const session = body.session_id ? await hydrateSession(body.session_id) : undefined;
  const history = session?.reagentHistory ?? [];
  const result = checkSafety(body.reagents ?? [], history);
  if (body.session_id) {
    if (result.conflict) {
      recordSafetyAlert(body.session_id, body.step_number, result.alerts);
      logAgentDecision({
        id: crypto.randomUUID(), session_id: body.session_id,
        trigger: `Reagents at step ${body.step_number}: ${(body.reagents ?? []).map((r) => r.name).join(", ")}`,
        plan: "New reagents detected → run safety engine against session history.",
        tools: [{ tool: "check_safety", input: (body.reagents ?? []).map((r) => r.name).join(" + "), output: `${result.alerts.length} alert(s): ${result.alerts[0]?.type} (${result.alerts[0]?.severity})` }],
        outcome: `Halted with a ${result.alerts[0]?.severity} alert until acknowledged.`,
        provider: providerLabel(), latency_ms: Date.now() - t0, at: new Date().toISOString(),
      });
    } else {
      clearSafetyAlert(body.session_id);
    }
  }
  recordTrace("safety_tool", (body.reagents ?? []).map((r) => r.name).join(" + ") || "none", result.conflict ? `${result.alerts.length} alert(s): ${result.alerts[0]?.type}` : "clear", Date.now() - t0);
  return c.json(result);
});

// ─── Vision check ────────────────────────────────────────────────────
app.post("/vision/check", async (c) => {
  const body = await c.req.json<VisionCheckRequest>();
  const t0 = Date.now();
  console.log(`\n[ROUTE /vision/check] ▶ session=${body.session_id} step=${body.step_number} type=${body.expected?.type} exp_value=${body.expected?.expected_value}`);

  const result = await checkVision(body);
  const latency = Date.now() - t0;

  let attempts = 1;
  if (body.session_id) attempts = recordVision(body.session_id, body.step_number, result.reading, result.pass);
  result.attempts = attempts;
  result.manual_override_available = !result.pass && attempts >= 2;

  // ─── Confidence-based routing ──────────────────────────────────────
  // HIGH confidence (≥ 0.82) + pass  →  auto_verified  →  step completes immediately
  // LOW confidence (< 0.82)          →  needs_review   →  auto-queue for instructor
  // fail                             →  failed         →  retry / manual override after 2×
  const isHighConf = result.confidence >= VISION_HIGH_CONFIDENCE;
  const isLowConf  = !isHighConf;

  if (result.pass && isHighConf) {
    result.verification_status = "auto_verified";
    console.log(`[ROUTE /vision/check] ✅ AUTO VERIFIED — conf=${result.confidence} ≥ ${VISION_HIGH_CONFIDENCE} reading=${result.reading}`);
  } else if (isLowConf && body.session_id) {
    result.verification_status = "needs_review";
    console.log(`[ROUTE /vision/check] 🔍 LOW CONFIDENCE (${result.confidence} < ${VISION_HIGH_CONFIDENCE}) — auto-queuing for instructor review`);
    // Auto-submit to instructor verification queue
    try {
      const labRow = await db.labSession.findUnique({
        where: { id: body.session_id },
        select: { instructorCode: true, studentName: true },
      });
      if (labRow?.instructorCode) {
        const entry = await submitVerification({
          session_id: body.session_id,
          student_name: labRow.studentName,
          step_number: body.step_number,
          image_base64: body.image_base64,
          ai_reading: result.reading,
          ai_confidence: result.confidence,
          ai_message: `Low confidence (${(result.confidence * 100).toFixed(0)}%): ${result.message}`,
          submitted_at: new Date().toISOString(),
        });
        console.log(`[ROUTE /vision/check] ✓ Queued for instructor review: entry_id=${entry.id} instructorCode=${labRow.instructorCode}`);
      } else {
        console.log(`[ROUTE /vision/check]   No instructorCode on session — skipping verification queue`);
      }
    } catch (e) {
      console.error(`[ROUTE /vision/check] ✗ Failed to queue for review:`, e);
    }
  } else {
    result.verification_status = "failed";
    console.log(`[ROUTE /vision/check] ✗ FAILED — pass=${result.pass} conf=${result.confidence} attempt=${attempts}`);
  }

  if (result.manual_override_available) {
    console.log(`[ROUTE /vision/check] ⚠  Manual override UNLOCKED after ${attempts} failed attempts`);
    logAgentDecision({
      id: crypto.randomUUID(), session_id: body.session_id,
      trigger: `Vision failed ${attempts}× on step ${body.step_number}`,
      plan: "Two low-confidence captures → offer manual override and log for instructor.",
      tools: [{ tool: "analyze_image", input: `step ${body.step_number}`, output: `conf=${result.confidence} pass=${result.pass}` }],
      outcome: "Manual override unlocked.",
      provider: providerLabel(), latency_ms: latency, at: new Date().toISOString(),
    });
  }

  console.log(`[ROUTE /vision/check] ← status=${result.verification_status} pass=${result.pass} conf=${result.confidence} reading=${result.reading} latency=${latency}ms`);
  recordTrace("vision_tool", `step ${body.step_number} · ${body.expected?.type}`, `${result.verification_status} conf=${result.confidence} reading=${result.reading ?? "—"}`, latency, result.confidence);
  return c.json(result);
});

// ─── Results interpret ───────────────────────────────────────────────
app.post("/results/interpret", async (c) => {
  const body = await c.req.json<InterpretRequest>();
  const t0 = Date.now();
  const result = interpret(body);
  if (body.session_id) recordResult(body.session_id, result.deviation_percent);
  recordTrace("result_interpreter", `${body.student_result} ${body.unit} vs ${body.theoretical_value}`, `${result.deviation_percent}% · ${result.severity}`, Date.now() - t0);
  return c.json(result);
});

// ─── Session GET ─────────────────────────────────────────────────────
app.get("/session/:sessionId", async (c) => {
  const { sessionId } = c.req.param();
  const detail = await getSessionDetailFromDB(sessionId);
  if (!detail) return c.json({ error: "not found" }, 404);
  const session = await hydrateSession(sessionId);
  return c.json({ ...detail, notes: session?.notes ?? [] });
});

// ─── Session action ──────────────────────────────────────────────────
app.post("/session/action", async (c) => {
  const { session_id, action } = await c.req.json<{ session_id: string; action: SessionAction }>();
  if (!session_id) return c.json({ error: "session_id required" }, 400);
  const session = await hydrateSession(session_id);
  if (!session) return c.json({ error: "Session not found" }, 404);
  const experimentId = session.experimentId;
  switch (action.type) {
    case "complete_step":
      completeStep(session_id, action.step_number);
      setCurrentStep(session_id, action.step_number + 1);
      // if this session belongs to the AUR experiment, record a lightweight audit trace
      try {
        const labRow = await db.labSession.findUnique({ where: { id: session_id }, select: { experimentId: true } });
        if (labRow?.experimentId === "aur-experiment") recordTrace("aur_audit", `complete_step`, `step ${action.step_number} completed`, 0, null);
      } catch {}
      break;
    case "skip_step": {
      const affected = flagDownstreamStepsFor(experimentId, action.step_number);
      flagDownstreamSteps(session_id, action.step_number, affected);
      setCurrentStep(session_id, action.step_number + 1);
      break;
    }
    case "manual_override": {
        console.log(`\n[ROUTE /session/action] ▶ manual_override session=${session_id} step=${action.step_number} value=${action.value}`);
        // Only route to instructor verification if:
        // 1. The instructor session has require_verification = true, AND
        // 2. The student actually had vision failures (note contains "failed vision checks")
        //    — we don't queue skips or "can't capture" bypasses.
        const isFromFailedVision = (action.note ?? "").toLowerCase().includes("failed vision");
        console.log(`[ROUTE /session/action]   is_from_failed_vision=${isFromFailedVision} note="${action.note}"`);
        try {
          const labRow = await db.labSession.findUnique({ where: { id: session_id }, select: { instructorCode: true, studentName: true, experimentId: true } });
          const instrCode = labRow?.instructorCode;
          console.log(`[ROUTE /session/action]   instructorCode=${instrCode ?? "none"}`);
          if (instrCode && isFromFailedVision) {
            const instr = await getInstructorSession(instrCode);
            console.log(`[ROUTE /session/action]   require_verification=${instr?.require_verification ?? false}`);
            if (instr?.require_verification) {
              const entry = await submitVerification({
                session_id: session_id,
                student_name: labRow?.studentName ?? "Student",
                step_number: action.step_number,
                image_base64: "",
                ai_reading: action.value ?? null,
                ai_confidence: 0,
                ai_message: `Manual override after failed vision checks: ${action.note ?? ""}`,
                submitted_at: new Date().toISOString(),
              });
              console.log(`[ROUTE /session/action] ✓ Queued for instructor verification: entry_id=${entry.id}`);
              if (labRow?.experimentId === "aur-experiment") recordTrace("aur_audit", `manual_override queued`, `step ${action.step_number} queued id=${entry.id}`, 0, null);
              return c.json({ ok: false, pending_verification: true, verification_id: entry.id, message: "Manual override queued for instructor verification" });
            }
          }
          if (instrCode && !isFromFailedVision) {
            console.log(`[ROUTE /session/action]   Skipping verification queue — not from a failed vision check`);
          }
        } catch (e) {
          console.error(`[ROUTE /session/action] ✗ Error checking verification requirement:`, e);
          // fall through to immediate override
        }
        manualOverride(session_id, action.step_number, action.value, action.note);
        setCurrentStep(session_id, action.step_number + 1);
        console.log(`[ROUTE /session/action] ✓ Manual override applied immediately`);
        break;
      }
    case "set_student_name":
      setStudentName(session_id, action.name);
      break;
  }
  const detail = await hydrateSession(session_id);
  return c.json({ ok: true, current_step: detail?.currentStep ?? null });
});

// ─── Dashboard ───────────────────────────────────────────────────────
app.get("/dashboard/sessions", async (c) => {
  const live = await allSummariesFromDB();
  return c.json(live);
});

app.get("/instructor/sessions/:code/students", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const rows = await db.labSession.findMany({
    where: { instructorCode: code },
    orderBy: { updatedAt: "desc" },
  });
  return c.json(rows.map((row) => {
    const steps = (row.steps as unknown as { flagged?: boolean; manual_override?: boolean }[]) ?? [];
    return {
      session_id: row.id,
      student_name: row.studentName,
      experiment_id: row.experimentId,
      experiment_name: row.experimentName,
      current_step: row.currentStep,
      total_steps: row.totalSteps,
      status: row.status,
      last_vision_pass: row.lastVisionPass,
      deviation_percent: row.deviationPercent,
      safety_alert_count: row.safetyAlertCount,
      flagged_step_count: steps.filter((x) => x.flagged).length,
      override_count: steps.filter((x) => x.manual_override).length,
      updated_at: row.updatedAt.toISOString(),
    };
  }));
});

app.get("/dashboard/verify", (c) => {
  const passcode = c.req.query("passcode") ?? "";
  return c.json({ ok: passcode === getConfig().instructorPasscode });
});

app.get("/dashboard/traces", async (c) => c.json(await getTracesFromDB()));
app.get("/dashboard/decisions", async (c) => c.json(await getAgentDecisionsFromDB()));

// ─── Agent chat (SSE) ────────────────────────────────────────────────
app.post("/agent/chat", async (c) => {
  const body = await c.req.json<AgentChatRequest>();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      try {
        await runAgentStream(body, emit);
      } catch (err) {
        const msg = (err as Error).message;
        const isExhausted = msg.includes("ALL_KEYS_EXHAUSTED");
        emit({
          type: "error",
          text: isExhausted
            ? "⚠️ API key limit reached — all providers exhausted. Running in demo mode. Add your own API key to resume real AI processing."
            : msg,
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
});

// ─── Instructor sessions ─────────────────────────────────────────────
app.get("/instructor/sessions", async (c) => c.json(await listInstructorSessions()));
app.get("/instructor/sessions/:code", async (c) => {
  const sess = await getInstructorSession(c.req.param("code"));
  if (!sess) return c.json({ error: "Not found" }, 404);
  return c.json(sess);
});

app.patch("/instructor/sessions/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const { status } = await c.req.json<{ status: string }>();
  await db.instructorSession.update({ where: { code }, data: { status } as Record<string, unknown> });
  return c.json({ ok: true, status });
});

app.post("/instructor/sessions", async (c) => {
  const body = await c.req.json();
  const experimentId = typeof body.experiment_id === "string" && body.experiment_id.trim() ? body.experiment_id.trim() : DEFAULT_EXPERIMENT_ID;
  const experimentName = typeof body.experiment_name === "string" && body.experiment_name.trim() ? body.experiment_name.trim() : getExperiment(experimentId).name;
  const session = await createInstructorSession({
    session_name: body.session_name,
    experiment_id: experimentId,
    experiment_name: experimentName,
    batch: body.batch ?? "",
    department: body.department ?? "",
    institution: body.institution ?? "",
    course_code: body.course_code ?? "",
    date: body.date ?? new Date().toISOString().split("T")[0],
    require_verification: !!body.require_verification,
  } as Parameters<typeof createInstructorSession>[0]);
  return c.json(session);
});

// ─── Pre-lab quiz ────────────────────────────────────────────────────
app.get("/lab/:sessionId/prelab", async (c) => {
  const { sessionId } = c.req.param();
  const session = await hydrateSession(sessionId);
  const experimentId = session?.experimentId;
  const exp = getExperiment(experimentId);
  const quiz = await generatePrelabQuiz(exp.protocol, exp.id);
  // Strip correct answers before sending to client
  return c.json({ ...quiz, questions: quiz.questions.map(({ correct: _c, ...q }) => q) });
});

app.post("/lab/:sessionId/prelab", async (c) => {
  const { sessionId } = c.req.param();
  const { answers } = await c.req.json<{ answers: Record<string, number> }>();
  const session = await hydrateSession(sessionId);
  // Idempotency: if already passed, don't re-score (prevent gaming by re-submitting)
  const existing = await db.labSession.findUnique({ where: { id: sessionId }, select: { prelabPassed: true } });
  if (existing?.prelabPassed) return c.json({ error: "Pre-lab already completed", ok: false }, 400);
  const exp = getExperiment(session?.experimentId);
  const quiz = await generatePrelabQuiz(exp.protocol, exp.id);
  const result = scorePrelabQuiz(quiz, answers);
  await db.labSession.update({ where: { id: sessionId }, data: { prelabScore: result.score, prelabPassed: result.passed } });
  return c.json(result);
});

// ─── Hypothesis ───────────────────────────────────────────────────────
app.post("/lab/:sessionId/hypothesis", async (c) => {
  const { sessionId } = c.req.param();
  const { hypothesis } = await c.req.json<{ hypothesis: string }>();
  await db.labSession.update({ where: { id: sessionId }, data: { hypothesis } }).catch(() => {});
  return c.json({ ok: true });
});

// ─── Benchmarking ─────────────────────────────────────────────────────
app.get("/lab/:sessionId/benchmark", async (c) => {
  const { sessionId } = c.req.param();
  const row = await db.labSession.findUnique({ where: { id: sessionId }, select: { experimentId: true, deviationPercent: true } });
  if (!row) return c.json({ class_avg_deviation: null, your_deviation: null, percentile: null });
  const peers = await db.labSession.findMany({
    where: { experimentId: row.experimentId, deviationPercent: { not: null }, id: { not: sessionId } },
    select: { deviationPercent: true },
  });
  const deviations = peers.map((p) => p.deviationPercent).filter((d): d is number => d !== null && !Number.isNaN(d));
  const classAvg = deviations.length ? Math.round(deviations.reduce((a, b) => a + b, 0) / deviations.length * 10) / 10 : null;
  const your = row.deviationPercent;
  const better = your !== null ? deviations.filter((d) => d > your).length : 0;
  const percentile = deviations.length ? Math.round((better / deviations.length) * 100) : null;
  return c.json({ class_avg_deviation: classAvg, your_deviation: your, percentile, peer_count: deviations.length });
});

// ─── CSV export ───────────────────────────────────────────────────────
app.get("/instructor/sessions/:code/students/export", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const rows = await db.labSession.findMany({ where: { instructorCode: code }, orderBy: { updatedAt: "desc" } });
  const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Student Name","Experiment","Steps Completed","Total Steps","Status","Deviation %","Safety Alerts","Overrides","Pre-lab Score","Pre-lab Passed","Updated At"].map(csv).join(","),
    ...rows.map((r) => {
      let steps: { manual_override?: boolean }[] = [];
      try { steps = (r.steps as { manual_override?: boolean }[]) ?? []; } catch { steps = []; }
      const overrides = steps.filter((s) => s.manual_override).length;
      return [r.studentName, r.experimentName, r.currentStep, r.totalSteps, r.status, r.deviationPercent ?? "", r.safetyAlertCount, overrides, r.prelabScore ?? "", r.prelabPassed ?? "", r.updatedAt.toISOString()].map(csv).join(",");
    }),
  ].join("\n");
  return new Response(lines, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="session-${code}.csv"` } });
});

// ─── Verification queue ──────────────────────────────────────────────
// Require instructor passcode on all verify endpoints to prevent unauthenticated access
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkInstructorPasscode(c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } }): boolean {
  const passcode = c.req.header("x-instructor-passcode") ?? c.req.query("passcode") ?? "";
  return passcode === getConfig().instructorPasscode;
}

app.get("/instructor/verify", async (c) => {
  if (!checkInstructorPasscode(c)) return c.json({ error: "Unauthorized" }, 401);
  const status = c.req.query("status") as "pending" | "approved" | "rejected" | undefined;
  return c.json(await listVerifications(status));
});

app.post("/instructor/verify", async (c) => {
  if (!checkInstructorPasscode(c)) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  if (body.action === "resolve") {
    await resolveVerification(body.id, body.status, body.comment);
    return c.json({ ok: true });
  }
  const entry = await submitVerification({
    session_id: body.session_id,
    student_name: body.student_name,
    step_number: body.step_number,
    image_base64: body.image_base64 ?? "",
    ai_reading: body.ai_reading,
    ai_confidence: body.ai_confidence,
    ai_message: body.ai_message,
    submitted_at: new Date().toISOString(),
  });
  return c.json(entry);
});

// ─── Student join ─────────────────────────────────────────────────────
app.post("/student/join", async (c) => {
  const { code, student_name, session_id } = await c.req.json();
  console.log(`\n[ROUTE /student/join] ▶ code=${code} student="${student_name}" session_id=${session_id}`);
  const instrSession = await getInstructorSession(code);
  if (!instrSession) {
    console.warn(`[ROUTE /student/join] ✗ Invalid code: ${code}`);
    return c.json({ error: "Invalid session code" }, 404);
  }
  if (instrSession.status === "ended") {
    console.warn(`[ROUTE /student/join] ✗ Session ${code} is ended`);
    return c.json({ error: "This session has been ended by the instructor" }, 403);
  }
  const exp = getExperiment(instrSession.experiment_id);
  // Atomically upsert the labSession with instructorCode in one DB call so the
  // foreign key is always set — avoids the race where a fire-and-forget persist
  // hadn't committed yet when addStudentToSession tried to UPDATE the same row.
  await db.labSession.upsert({
    where: { id: session_id },
    create: {
      id: session_id,
      studentName: student_name ?? "Student",
      experimentId: exp.id,
      experimentName: exp.name,
      totalSteps: exp.protocol.steps.length,
      instructorCode: code.toUpperCase(),
    },
    update: { instructorCode: code.toUpperCase(), studentName: student_name ?? "Student" },
  });
  upsertSession({ sessionId: session_id, studentName: student_name ?? "Student", experimentId: exp.id, experimentName: exp.name, totalSteps: exp.protocol.steps.length });
  console.log(`[ROUTE /student/join] ✓ Joined: session_id=${session_id} experiment=${exp.id} name="${student_name}" instructor_code=${code}`);
  return c.json({ ok: true, experiment_id: exp.id, experiment_name: exp.name, session_name: instrSession.session_name });
});

// ─── Lab summary & report ────────────────────────────────────────────
app.get("/lab/:sessionId/summary", async (c) => {
  const { sessionId } = c.req.param();
  return c.json(await buildLearningSummary(sessionId));
});

app.get("/lab/:sessionId/report", async (c) => {
  const { sessionId } = c.req.param();
  return c.json(await buildReport(sessionId));
});

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
