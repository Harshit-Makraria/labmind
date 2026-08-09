/**
 * Hono catch-all — handles every /api/* route.
 * All individual route files under /api/ have been removed; this is the sole entry point.
 */
import { Hono } from "hono";
import { handle } from "hono/vercel";

import { auth } from "@/auth";

import type { AgentChatRequest, AgentEvent, InterpretRequest, ParseProtocolRequest, Protocol, SafetyCheckRequest, SafetyConflict, SessionAction, StepRecord, VisionCheckRequest } from "@/lib/types";
import { fingerprint, isDuplicate } from "@/server/tools/image-fingerprint";
import { analysePacing } from "@/server/tools/pacing";
import { assessRisk } from "@/server/tools/risk";
import { buildChain, verifyChain } from "@/server/tools/audit-chain";
import { VISION_HIGH_CONFIDENCE, VISION_LOW_CONFIDENCE } from "@/lib/types";
import { effectiveDemo, firstAvailableProvider, getConfig, providerLabel, resolveWaterfallOrder } from "@/server/config";
import { DEFAULT_EXPERIMENT_ID, getExperiment, listExperiments } from "@/server/experiments";
import { recordTrace } from "@/server/observability/trace";
import { runAgentStream } from "@/server/agent/orchestrator";
import { AGENT_TOOL_NAMES } from "@/server/agent/orchestrator";
import { flagDownstreamStepsFor } from "@/server/agent/tools";
import { checkSafety } from "@/server/tools/safety";
import { checkVision } from "@/server/tools/vision";
import { interpretUniversal } from "@/server/tools/result-interpreter";
import { resolveExpectedResult } from "@/server/tools/expected-result";
import { parseProtocol } from "@/server/tools/protocol-parser";
import { buildLearningSummary, buildReport } from "@/server/tools/summary";
import { MOCK_SESSIONS } from "@/server/data/mock-sessions";
import { generatePrelabQuiz, scorePrelabQuiz } from "@/server/tools/prelab-quiz";
import {
  addInstructorNote, addReagents, allSummariesFromDB, approveSkipRequest, clearSafetyAlert, clearSkipRequest, completeStep,
  getAgentDecisionsFromDB, getSessionDetailFromDB,
  getTracesFromDB, hydrateSession, invalidateSessionCache, listPendingSkipRequests, logAgentDecision, manualOverride,
  recordDuplicatePhoto, recordResult, recordSafetyAlert, recordVision, requestSkip, setCurrentStep, setStudentName,
  skipStep, upsertSession,
} from "@/server/store/session-store";
import { db } from "@/server/db";
import { getSessionAnalytics, getStudentRecord, getVerificationImage } from "@/server/store/analytics";
import {
  addStudentToSession, createInstructorSession, getInstructorSession,
  instructorOwnsCode, instructorOwnsVerification,
  listInstructorSessions, listVerifications, resolveVerification,
  seedDemoData, submitVerification,
} from "@/server/store/code-store";
import { getAccuracyReport } from "@/server/store/accuracy";
import { getLlmStatus, loadRuntimeSettings, saveRuntimeSettings } from "@/server/runtime-config";
import { exhaustedProviders, anyExhausted } from "@/server/llm/provider-state";
import { fetchModelCatalog } from "@/server/llm/model-catalog";
import { rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Vars = { user: { id: string; email?: string | null; name?: string | null; role?: string } };

const app = new Hono<{ Variables: Vars }>().basePath("/api");

/**
 * Can this authenticated user read/mutate this student's lab session? A
 * LabSession has no route-level ownership check by default, so a client that
 * knows (or guesses/leaks) another student's session_id could otherwise read
 * or write their grading-relevant data. Allowed for: the owning student, the
 * instructor who owns the session's class, or anyone when the session
 * predates user-attribution (userId null — treated as ownerless, matching
 * the same rule used for pre-ownership InstructorSession rows).
 */
function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function sessionAccess(sessionId: string, user: Vars["user"]): Promise<"allowed" | "not_found" | "forbidden"> {
  const row = await db.labSession.findUnique({ where: { id: sessionId }, select: { userId: true, instructorCode: true } });
  if (!row) return "not_found";
  if (!row.userId || row.userId === user.id) return "allowed";
  if (user.role === "instructor" && row.instructorCode && (await instructorOwnsCode(row.instructorCode, user.id))) return "allowed";
  return "forbidden";
}

app.onError((err, c) => {
  console.error("[API error]", err);
  // Full detail is logged above for debugging — the client only ever gets a
  // generic message in production, since err.message can carry internal
  // detail (DB constraint text, file paths, provider error bodies) that
  // shouldn't leave the server.
  const message = process.env.NODE_ENV === "production" ? "Internal server error" : (err.message ?? "Internal server error");
  return c.json({ error: message }, 500);
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

// ─── Authentication ──────────────────────────────────────────────────
// Next's `middleware.ts` matcher deliberately excludes /api/*, so it provides
// NO protection here — every route below must be gated in this layer.
//
// PUBLIC       : unauthenticated reads with no user data
// INSTRUCTOR   : prefixes that expose or mutate cross-student data
// everything else requires a signed-in user of any role.

const PUBLIC_PATHS = ["/api/meta", "/api/experiments"];

const INSTRUCTOR_PREFIXES = [
  "/api/instructor",
  "/api/dashboard",
  "/api/settings",
];

app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (PUBLIC_PATHS.includes(path)) return next();

  const session = await auth().catch((e) => {
    // A throw here means session resolution itself is broken (not just a
    // logged-out user) — that would 401 every legitimate request, so make it loud.
    console.error("[AUTH] session resolution FAILED — all requests will 401:", e);
    return null;
  });
  if (!session?.user) {
    console.warn(`[AUTH] 401 — unauthenticated request to ${c.req.method} ${path}`);
    return c.json({ error: "Unauthorized" }, 401);
  }

  const needsInstructor = INSTRUCTOR_PREFIXES.some((p) => path.startsWith(p));
  if (needsInstructor && session.user.role !== "instructor") {
    console.warn(`[AUTH] 403 — ${session.user.email} (${session.user.role}) tried ${c.req.method} ${path}`);
    return c.json({ error: "Forbidden — instructor access required" }, 403);
  }

  c.set("user", session.user);
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
  const cfg = getConfig();
  return c.json({
    ...status,
    keys_exhausted: keysExhausted,
    exhausted_providers: exhaustedProviders(),
    // What "Auto" actually resolves to right now, given which keys exist and
    // aren't exhausted — lets the UI show e.g. "Auto → currently Gemini"
    // rather than a bare, uninformative "Auto".
    resolved_chat_provider: firstAvailableProvider(resolveWaterfallOrder("chat", cfg.chatProvider), cfg),
    resolved_vision_provider: firstAvailableProvider(resolveWaterfallOrder("vision", cfg.visionProvider), cfg),
    // Effective model per provider/capability right now (override if set via
    // Settings, otherwise the env default) — what the picker shows as selected.
    models: {
      openai: { chat: cfg.openaiModel, vision: cfg.openaiVisionModel },
      gemini: { chat: cfg.geminiModel, vision: cfg.geminiVisionModel },
      claude: { chat: cfg.anthropicModel, vision: cfg.anthropicVisionModel },
    },
  });
});

app.patch("/settings/llm", async (c) => {
  const body = await c.req.json<{
    provider?: string; chat_provider?: string; vision_provider?: string;
    openai_key?: string; gemini_key?: string; anthropic_key?: string;
    openai_chat_model?: string; openai_vision_model?: string;
    gemini_chat_model?: string; gemini_vision_model?: string;
    anthropic_chat_model?: string; anthropic_vision_model?: string;
  }>();
  const updated = await saveRuntimeSettings({
    provider: body.provider as Parameters<typeof saveRuntimeSettings>[0]["provider"],
    chatProvider: body.chat_provider as Parameters<typeof saveRuntimeSettings>[0]["chatProvider"],
    visionProvider: body.vision_provider as Parameters<typeof saveRuntimeSettings>[0]["visionProvider"],
    openaiKey: body.openai_key,
    geminiKey: body.gemini_key,
    anthropicKey: body.anthropic_key,
    openaiChatModel: body.openai_chat_model,
    openaiVisionModel: body.openai_vision_model,
    geminiChatModel: body.gemini_chat_model,
    geminiVisionModel: body.gemini_vision_model,
    anthropicChatModel: body.anthropic_chat_model,
    anthropicVisionModel: body.anthropic_vision_model,
  });
  return c.json({ ok: true, provider: updated.provider, chat_provider: updated.chatProvider, vision_provider: updated.visionProvider });
});

// Live model catalog for the Settings picker — fetches from the provider's
// own API using whichever key is already saved, so the list can't go stale
// the way a hardcoded model ID would.
app.get("/settings/models", async (c) => {
  const provider = c.req.query("provider");
  if (provider !== "openai" && provider !== "gemini" && provider !== "claude") {
    return c.json({ error: "provider must be one of: openai, gemini, claude" }, 400);
  }
  const cfg = getConfig();
  const apiKey = provider === "openai" ? cfg.openaiApiKey : provider === "gemini" ? cfg.geminiApiKey : cfg.anthropicApiKey;
  const result = await fetchModelCatalog(provider, apiKey);
  return c.json(result);
});

// ─── Protocol parse ──────────────────────────────────────────────────
app.post("/protocol/parse", async (c) => {
  const body = await c.req.json<ParseProtocolRequest>();
  if (!body?.session_id) return c.json({ error: "session_id required" }, 400);
  const t0 = Date.now();
  const exp = getExperiment(body.experiment_id);
  const protocol = await parseProtocol(body.pdf_base64, body.experiment_id);

  // Tell the client the truth about where the protocol came from. The parser
  // falls back to the library on a scanned PDF, a missing key, or a model
  // failure — the UI must not claim "PDF parsed" in those cases.
  const parsedFromPdf = !!body.pdf_base64 && protocol.experiment_name !== exp.protocol.experiment_name;
  const fallbackReason = !body.pdf_base64
    ? null
    : parsedFromPdf
      ? null
      : effectiveDemo()
        ? "No AI key configured — add one in AI Settings to parse your own PDF."
        : "Could not read text from that PDF (it may be a scan). Loaded the library experiment instead.";

  upsertSession({ sessionId: body.session_id, studentName: body.student_name, experimentId: exp.id, experimentName: protocol.experiment_name, totalSteps: protocol.steps.length });
  recordTrace("protocol_parser", body.pdf_base64 ? "PDF upload" : `library: ${exp.id}`, `${protocol.experiment_name} · ${protocol.steps.length} steps${parsedFromPdf ? " (from PDF)" : ""}`, Date.now() - t0);
  // Only attach the library experiment's own written description when this
  // IS that library experiment — a genuinely custom PDF parsed into a
  // different protocol has no matching description to show honestly.
  const description = parsedFromPdf ? null : exp.description;
  return c.json({ ...protocol, session_id: body.session_id, experiment_id: exp.id, theoretical: exp.theoretical, description, parsed_from_pdf: parsedFromPdf, fallback_reason: fallbackReason });
});

// Same parsing as above, but with NO session-store side effect — /protocol/
// parse's upsertSession() call assumes a real (or soon-to-be-real) LabSession
// behind session_id, which an instructor uploading a PDF while CREATING a
// session doesn't have yet. Calling that route with a throwaway random id
// (the previous approach) left a permanently orphaned LabSession row behind
// on every upload. This is a pure {pdf, experiment_id} -> parsed protocol
// call the instructor's create-session form can preview against safely, as
// many times as they like, with nothing written to the database.
app.post("/protocol/preview", async (c) => {
  const body = await c.req.json<{ pdf_base64?: string; experiment_id?: string }>();
  if (!body?.pdf_base64) return c.json({ error: "pdf_base64 required" }, 400);
  const t0 = Date.now();
  const exp = getExperiment(body.experiment_id);
  const protocol = await parseProtocol(body.pdf_base64, body.experiment_id);
  const parsedFromPdf = protocol.experiment_name !== exp.protocol.experiment_name;
  const fallbackReason = parsedFromPdf
    ? null
    : effectiveDemo()
      ? "No AI key configured — add one in AI Settings to parse your own PDF."
      : "Could not read text from that PDF (it may be a scan). Loaded the library experiment instead.";
  recordTrace("protocol_parser", "PDF preview", `${protocol.experiment_name} · ${protocol.steps.length} steps${parsedFromPdf ? " (from PDF)" : ""}`, Date.now() - t0);
  return c.json({ ...protocol, experiment_id: exp.id, parsed_from_pdf: parsedFromPdf, fallback_reason: fallbackReason });
});

// ─── Safety check ────────────────────────────────────────────────────
app.post("/safety/check", async (c) => {
  const body = await c.req.json<SafetyCheckRequest>();
  if (body.session_id && (await sessionAccess(body.session_id, c.get("user"))) === "forbidden") {
    return c.json({ error: "Forbidden" }, 403);
  }
  const t0 = Date.now();
  // Hydrate BEFORE mutating. The store's sync mutators no-op when the session
  // isn't in this instance's in-memory Map — on serverless that silently threw
  // away the reagent history and ran the safety engine against an empty list.
  const prior = body.session_id ? await hydrateSession(body.session_id) : undefined;
  // Conflicts must be evaluated against the history as it was BEFORE this step's
  // reagents were merged in, otherwise every reagent trivially matches itself.
  const history = [...(prior?.reagentHistory ?? [])];
  if (body.session_id) addReagents(body.session_id, body.reagents ?? []);
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
  if (body.session_id && (await sessionAccess(body.session_id, c.get("user"))) === "forbidden") {
    return c.json({ error: "Forbidden" }, 403);
  }
  const t0 = Date.now();
  console.log(`\n[ROUTE /vision/check] ▶ session=${body.session_id} step=${body.step_number} type=${body.expected?.type} exp_value=${body.expected?.expected_value}`);

  // Hydrate first — recordVision() is a sync store mutator that silently no-ops
  // when the session isn't in this instance's memory Map. Without this the
  // attempt counter never increments past 1 and manual override never unlocks.
  const priorSession = body.session_id ? await hydrateSession(body.session_id) : undefined;

  // Fetched once, up front, so both the duplicate guard (needs instructorCode
  // to scope across the cohort) and the risk assessment below (needs
  // createdAt for pacing) share the same row instead of querying twice.
  let labRow: { instructorCode: string | null; studentName: string; prelabPassed: boolean | null; createdAt: Date } | null = null;
  if (body.session_id) {
    labRow = await db.labSession.findUnique({
      where: { id: body.session_id },
      select: { instructorCode: true, studentName: true, prelabPassed: true, createdAt: true },
    });
  }

  // ── Duplicate-image guard ──────────────────────────────────────────
  // Nothing previously stopped the same photo being submitted for a different
  // step, or two students submitting the same apparatus. Both yield a valid
  // reading and pass every downstream check. Scoped across every session in
  // the SAME cohort (instructorCode), not just this student's own session —
  // a single-session scope could never catch the more realistic cheating
  // mode of two students photographing the same physical setup.
  const fp = await fingerprint(body.image_base64);
  if (!fp && body.session_id) {
    // fingerprint() already console.error's the underlying decode failure —
    // this is the signal that the duplicate-photo guard was silently SKIPPED
    // for this submission, which is otherwise invisible to the instructor.
    // An unreadable/corrupt image is exactly the kind of malformed upload
    // that could otherwise slip past the cheating check unnoticed.
    console.warn(`[DUPLICATE-GUARD] session=${body.session_id} step=${body.step_number} — image fingerprint failed, duplicate check skipped for this submission`);
    recordTrace("vision_tool", `step ${body.step_number} fingerprint`, "duplicate-photo guard skipped — image could not be fingerprinted", Date.now() - t0, 0);
  }
  if (fp && body.session_id) {
    const priorImages = await db.verificationEntry.findMany({
      where: labRow?.instructorCode
        ? { session: { instructorCode: labRow.instructorCode }, NOT: { imageHash: null } }
        : { sessionId: body.session_id, NOT: { imageHash: null } },
      select: { imageHash: true, stepNumber: true, sessionId: true, studentName: true },
    });
    const clash = priorImages.find(
      (p) => !(p.sessionId === body.session_id && p.stepNumber === body.step_number) && p.imageHash && isDuplicate(fp, p.imageHash),
    );
    if (clash) {
      const sameStudent = clash.sessionId === body.session_id;
      const note = sameStudent
        ? `matches this student's own step ${clash.stepNumber}`
        : `matches a photo submitted by ${clash.studentName} for step ${clash.stepNumber}`;
      console.warn(`[DUPLICATE] session=${body.session_id} step=${body.step_number} ${note} (hash ${fp})`);
      recordDuplicatePhoto(body.session_id, body.step_number, note);
      recordTrace("vision_tool", `step ${body.step_number} duplicate`, note, Date.now() - t0, 0);
      // Keep the duplicate itself. This is the single strongest cheating
      // signal the system can produce, and it was the one submission that
      // left no image behind — the instructor saw a counter increment with
      // no way to look at what was actually submitted.
      if (labRow?.instructorCode) {
        try {
          await submitVerification({
            session_id: body.session_id,
            student_name: labRow.studentName,
            step_number: body.step_number,
            image_base64: body.image_base64,
            ai_reading: null,
            ai_confidence: 0,
            ai_message: `Duplicate photo — ${note}.`,
            submitted_at: new Date().toISOString(),
            image_hash: fp,
          }, "failed");
        } catch (e) {
          console.error(`[DUPLICATE] failed to save the duplicate image as evidence:`, e);
        }
      }
      return c.json({
        reading: null, confidence: 0, pass: false, deviation: null,
        message: sameStudent
          ? `This is the same photo you already submitted for step ${clash.stepNumber}.`
          : `This photo matches one already submitted by another student for step ${clash.stepNumber}.`,
        notes: "Take a new photo of the current state of your apparatus.",
        attempts: 1, manual_override_available: false,
        verification_threshold: VISION_HIGH_CONFIDENCE,
        verification_status: "retake",
      });
    }
  }

  // Feed the student's own earlier readings to the physical-constraint layer.
  // Assigned from the server's copy and never taken from the request body — a
  // client could otherwise forge a history that makes any reading look valid.
  const result = await checkVision({ ...body, priorSteps: priorSession?.steps ?? [] });
  const latency = Date.now() - t0;

  let attempts = 1;
  if (body.session_id) attempts = recordVision(body.session_id, body.step_number, result.reading, result.pass);
  result.attempts = attempts;
  result.manual_override_available = !result.pass && attempts >= 2;

  // ── Adaptive auto-verify bar ────────────────────────────────────────
  // The risk engine computes a per-student threshold (0.78–0.94: a clean
  // record lowers it, safety alerts/overrides/skips/retries raise it) and it
  // was previously DISPLAY-ONLY on the risk ranking page — this route always
  // compared against the fixed 0.82 constant regardless of who submitted.
  // That meant "adaptive thresholds" never actually changed what happened
  // when a student submitted a photo. It now does.
  let threshold = VISION_HIGH_CONFIDENCE;
  if (body.session_id && labRow) {
    // Pacing needs the protocol + session start time, both one query away —
    // compute it for real here instead of passing 0, so the exact submission
    // that trips an impossibly-fast step is graded with that fact already
    // incorporated, not just on the instructor's next risk-page poll.
    const exp = getExperiment(priorSession?.experimentId);
    const pacing = analysePacing(priorSession?.steps ?? [], exp.protocol, labRow.createdAt);
    const risk = assessRisk({
      sessionId: body.session_id,
      studentName: labRow.studentName,
      steps: priorSession?.steps ?? [],
      safetyAlertCount: priorSession?.safetyAlertCount ?? 0,
      deviationPercent: priorSession?.deviationPercent ?? null,
      prelabPassed: labRow.prelabPassed,
      pacingFlagged: pacing.flagged_count,
      duplicatePhotoCount: priorSession?.duplicatePhotoCount ?? 0,
    });
    threshold = risk.verification_threshold;
    if (threshold !== VISION_HIGH_CONFIDENCE) {
      console.log(`[ROUTE /vision/check]   adaptive threshold: ${threshold} (risk score ${risk.score}/${risk.band}) — was ${VISION_HIGH_CONFIDENCE}`);
    }
  }
  result.verification_threshold = threshold;

  // ─── Confidence-based routing ─────────────────────────────────────
  // < 40%              →  retake        →  image too poor, ask student to retake (no instructor queue)
  // 40%–threshold      →  needs_review  →  auto-queue for instructor, student continues
  // ≥ threshold + pass →  auto_verified →  step completes immediately
  // ≥ threshold + fail →  failed        →  retry / manual override after 2×
  const isTooLow   = result.confidence < VISION_LOW_CONFIDENCE;
  const isHighConf = result.confidence >= threshold;

  if (isTooLow) {
    result.verification_status = "retake";
    console.log(`[ROUTE /vision/check] 📷 RETAKE — conf=${result.confidence} < ${VISION_LOW_CONFIDENCE} (image too poor, not queued)`);
  } else if (result.pass && isHighConf) {
    result.verification_status = "auto_verified";
    console.log(`[ROUTE /vision/check] ✅ AUTO VERIFIED — conf=${result.confidence} ≥ ${threshold} reading=${result.reading}`);
  } else if (!isHighConf && body.session_id) {
    result.verification_status = "needs_review";
    console.log(`[ROUTE /vision/check] 🔍 NEEDS REVIEW — conf=${result.confidence} (40%–${threshold}) — auto-queuing for instructor`);
  } else {
    result.verification_status = "failed";
    console.log(`[ROUTE /vision/check] ✗ FAILED — good image but wrong reading, pass=${result.pass} conf=${result.confidence} attempt=${attempts}`);
  }

  // ─── Persist the submitted photo, whatever the outcome ────────────
  //
  // Previously ONLY "needs_review" captures were written, so an auto-verified
  // photo — the overwhelming majority — was analysed and then thrown away. The
  // instructor could never see the evidence behind a passed step, and a
  // rejected or blurry attempt left no trace at all. Every submission is now
  // recorded with the outcome it actually got.
  //
  // Only "needs_review" is stored as "pending", so the instructor's action
  // queue and its badge count behave exactly as before — the rest is evidence,
  // not a task.
  if (body.session_id && labRow?.instructorCode) {
    const storedStatus =
      result.verification_status === "needs_review" ? "pending"
      : result.verification_status === "auto_verified" ? "auto_verified"
      : result.verification_status === "retake" ? "retake"
      : "failed";
    try {
      const entry = await submitVerification({
        session_id: body.session_id,
        student_name: labRow.studentName,
        step_number: body.step_number,
        image_base64: body.image_base64,
        ai_reading: result.reading,
        ai_confidence: result.confidence,
        ai_message: `Confidence ${(result.confidence * 100).toFixed(0)}% (${result.verification_status}): ${result.message}`,
        submitted_at: new Date().toISOString(),
        image_hash: fp,
      }, storedStatus);
      console.log(`[ROUTE /vision/check] ✓ Photo saved as "${storedStatus}": entry_id=${entry.id}`);
    } catch (e) {
      // Never fail the student's step because the evidence write failed —
      // the verification result itself is still valid and already computed.
      console.error(`[ROUTE /vision/check] ✗ Failed to save photo evidence:`, e);
    }
  } else if (body.session_id && !labRow?.instructorCode) {
    console.log(`[ROUTE /vision/check]   Solo/library session — no class to record evidence against`);
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

// ─── Safety escalation ───────────────────────────────────────────────
// Backs the "Stop & get the instructor" button on a high-severity safety modal.
// Writes a note onto the student's session, holds them at the current step, and
// logs an agent decision so it surfaces in the instructor console immediately.
app.post("/safety/escalate", async (c) => {
  const body = await c.req.json<{ session_id: string; step_number: number; alerts?: SafetyConflict[] }>();
  if (!body?.session_id) return c.json({ error: "session_id required" }, 400);

  const session = await hydrateSession(body.session_id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const alerts = body.alerts ?? [];
  const top = alerts[0];
  const summary = top ? `${top.type} (${top.severity}) — ${top.reagents.join(" + ")}` : "unspecified hazard";

  console.warn(`\n[ESCALATE] 🚨 student=${session.studentName} session=${body.session_id} step=${body.step_number} — ${summary}`);

  addInstructorNote(
    body.session_id,
    `🚨 STUDENT REQUESTED INSTRUCTOR — step ${body.step_number}: ${summary}`,
  );
  recordSafetyAlert(body.session_id, body.step_number, alerts);

  logAgentDecision({
    id: crypto.randomUUID(),
    session_id: body.session_id,
    trigger: `Student pressed "Stop & get the instructor" on step ${body.step_number}`,
    plan: "High-severity safety conflict acknowledged by the student → escalate to a human and hold the session.",
    tools: [{ tool: "notify_instructor", input: summary, output: "Session flagged; instructor console updated." }],
    outcome: `Session held at step ${body.step_number} awaiting instructor.`,
    provider: providerLabel(),
    latency_ms: 0,
    at: new Date().toISOString(),
  });

  return c.json({ ok: true, escalated: true, student_name: session.studentName, summary });
});

// ─── Results interpret ───────────────────────────────────────────────
app.post("/results/interpret", async (c) => {
  const body = await c.req.json<InterpretRequest>();
  if (body.session_id && (await sessionAccess(body.session_id, c.get("user"))) === "forbidden") {
    return c.json({ error: "Forbidden" }, 403);
  }
  const t0 = Date.now();

  // The "Expected value" field is rendered as an editable input on the client
  // (ResultEntry.tsx) purely to show the student what's expected — it was
  // never meant to be authoritative, but the server previously trusted
  // body.theoretical_value verbatim. That let a student set it equal to their
  // own measured result and always get a fabricated 0%-deviation "on target"
  // grade. The real target is a property of the experiment, not of the
  // request, so derive it server-side and ignore whatever the client sent —
  // resolving experiment_id from the session's own DB row when available, so
  // a client can't lie about that either.
  let experimentId = body.experiment_id;
  // The instructor's own uploaded/hand-built protocol for this session, when
  // there is one. This is what makes a custom experiment gradeable against ITS
  // OWN expected result instead of against the library experiment it happens
  // to be filed under.
  let sessionProtocol: Protocol | null = null;
  if (body.session_id) {
    const row = await db.labSession.findUnique({ where: { id: body.session_id }, select: { experimentId: true, instructorCode: true } });
    // A session_id that doesn't resolve (deleted/expired session, stale deep
    // link) must not silently fall back to a default experiment — that
    // previously graded e.g. a gel-electrophoresis reading against
    // titration's theoretical value and returned a nonsense diagnosis as an
    // authoritative 200 result.
    if (!row) return c.json({ error: "Session not found" }, 404);
    experimentId = row.experimentId;
    if (row.instructorCode) {
      const instr = await db.instructorSession.findUnique({ where: { code: row.instructorCode }, select: { customProtocol: true } });
      sessionProtocol = (instr?.customProtocol as unknown as Protocol | null) ?? null;
    }
  }
  const experiment = getExperiment(experimentId);
  const expected = resolveExpectedResult(sessionProtocol, experiment);
  const result = interpretUniversal(
    expected,
    { numeric: body.student_result, answer: body.student_answer ?? null },
    { ...body, experiment_id: experimentId, theoretical_value: expected.value ?? 0, unit: body.unit || expected.unit || "" },
    // A protocol that declares its own expected result is a custom experiment
    // of unknown subject — it must not inherit the library experiments'
    // chemistry-specific coaching.
    { custom: !!sessionProtocol?.expected_result },
  );

  // hydrate before the mutator, else it no-ops. And AWAIT the write itself —
  // Vercel can freeze this function right after the response is sent, which
  // was cutting off the fire-and-forget DB upsert before "completed" ever
  // reached Postgres, so a student who finished an experiment would see it
  // stay stuck at "active" forever.
  if (body.session_id) {
    await hydrateSession(body.session_id);
    // Non-numeric experiments have no deviation to record — passing null keeps
    // them out of the numeric averages (class average, accuracy stats) rather
    // than poisoning those with a fabricated 0%.
    await recordResult(body.session_id, result.deviation_percent, body.student_result);
  }
  const submittedLabel = expected.kind === "numeric" ? `${body.student_result} ${body.unit || expected.unit || ""}`.trim() : String(body.student_answer ?? "—");
  const gradeLabel = result.deviation_percent !== null ? `${result.deviation_percent}%` : result.correct === null ? "needs review" : result.correct ? "correct" : "incorrect";
  recordTrace("result_interpreter", `${submittedLabel} vs ${expected.value ?? expected.correct ?? expected.label}`, `${gradeLabel} · ${result.severity}`, Date.now() - t0);
  return c.json(result);
});

// ─── Session GET ─────────────────────────────────────────────────────
app.get("/session/:sessionId", async (c) => {
  const { sessionId } = c.req.param();
  const access = await sessionAccess(sessionId, c.get("user"));
  if (access === "not_found") return c.json({ error: "not found" }, 404);
  if (access === "forbidden") return c.json({ error: "Forbidden" }, 403);
  const detail = await getSessionDetailFromDB(sessionId);
  if (!detail) return c.json({ error: "not found" }, 404);
  const session = await hydrateSession(sessionId);
  return c.json({ ...detail, notes: session?.notes ?? [] });
});

// ─── Session action ──────────────────────────────────────────────────
app.post("/session/action", async (c) => {
  const { session_id, action } = await c.req.json<{ session_id: string; action: SessionAction }>();
  if (!session_id) return c.json({ error: "session_id required" }, 400);
  const access = await sessionAccess(session_id, c.get("user"));
  if (access === "forbidden") return c.json({ error: "Forbidden" }, 403);
  const session = await hydrateSession(session_id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  // Pre-lab gate — enforced here, not just in the UI, so a student cannot skip
  // it by navigating straight to a step URL. Only step-advancing actions are
  // gated; renaming yourself is always allowed.
  const ADVANCING = new Set(["complete_step", "skip_step", "request_skip", "manual_override"]);
  if (ADVANCING.has(action.type)) {
    const gate = await db.labSession.findUnique({
      where: { id: session_id },
      select: { prelabPassed: true, instructorCode: true },
    });
    if (gate?.instructorCode && gate.prelabPassed !== true) {
      console.warn(`[GATE] blocked ${action.type} on ${session_id} — pre-lab not passed (${gate.prelabPassed})`);
      return c.json(
        { error: "Pre-lab quiz must be passed before starting the experiment", prelab_required: true },
        403,
      );
    }
  }

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
      // Enforced here, not just left to client choice — a session joined via
      // an instructor code must go through request_skip/instructor approval;
      // only a solo/library session (no instructorCode) may self-skip.
      if (session.instructorCode) {
        return c.json(
          { error: "This is an instructor-led session — request a skip instead of skipping directly", instructor_approval_required: true },
          403,
        );
      }
      const affected = flagDownstreamStepsFor(experimentId, action.step_number);
      // skipStep marks the step itself as "skipped" AND flags the downstream
      // ones. flagDownstreamSteps only did the latter, so skipped steps stayed
      // "pending" forever and never showed up in the learning summary.
      skipStep(session_id, action.step_number, affected);
      setCurrentStep(session_id, action.step_number + 1);
      break;
    }
    case "request_skip": {
      // A solo/library session has no instructor to approve anything —
      // fall back to an instant skip rather than stranding the student
      // waiting for an approval that will never come.
      if (!session.instructorCode) {
        const affected = flagDownstreamStepsFor(experimentId, action.step_number);
        skipStep(session_id, action.step_number, affected);
        setCurrentStep(session_id, action.step_number + 1);
        break;
      }
      requestSkip(session_id, action.step_number);
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
  const live = await allSummariesFromDB(c.get("user").id);
  return c.json(live);
});

app.get("/instructor/sessions/:code/students", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!(await instructorOwnsCode(code, c.get("user").id))) return c.json({ error: "Not found" }, 404);
  const rows = await db.labSession.findMany({
    where: { instructorCode: code },
    orderBy: { updatedAt: "desc" },
    // Polled every few seconds by the class bench view — only what's rendered.
    select: {
      id: true, studentName: true, experimentId: true, experimentName: true,
      currentStep: true, totalSteps: true, status: true, lastVisionPass: true,
      deviationPercent: true, safetyAlertCount: true, steps: true, updatedAt: true,
    },
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
  if (!rateLimit(`dashboard-verify:${clientIp(c)}`, 10, 5 * 60 * 1000)) {
    return c.json({ error: "Too many attempts. Try again in a few minutes." }, 429);
  }
  const passcode = c.req.query("passcode") ?? "";
  return c.json({ ok: passcode === getConfig().instructorPasscode });
});

// TraceSpan has no sessionId (pure tool-latency telemetry — tool name,
// generic in/out summaries, no student/class link), so unlike decisions
// below there is nothing to scope it by; it's genuinely app-wide.
app.get("/dashboard/traces", async (c) => c.json(await getTracesFromDB()));
app.get("/dashboard/decisions", async (c) => c.json(await getAgentDecisionsFromDB(c.get("user").id)));

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
// Every route below is scoped to classes the calling instructor actually
// created (instructorOwnsCode) — otherwise any instructor account could
// read, export, or mutate any other instructor's cohort by guessing/knowing
// its join code. The one exception is the shared demo class
// (DEMO_INSTRUCTOR_CODE); every other ownerless row is owner-only, not
// visible to everyone — see instructorOwnsCode's own doc comment.
app.get("/instructor/sessions", async (c) => c.json(await listInstructorSessions(c.get("user").id)));
app.get("/instructor/sessions/:code", async (c) => {
  const code = c.req.param("code");
  if (!(await instructorOwnsCode(code, c.get("user").id))) return c.json({ error: "Not found" }, 404);
  const sess = await getInstructorSession(code);
  if (!sess) return c.json({ error: "Not found" }, 404);
  return c.json(sess);
});

app.patch("/instructor/sessions/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!(await instructorOwnsCode(code, c.get("user").id))) return c.json({ error: "Not found" }, 404);
  const { status } = await c.req.json<{ status: string }>();
  await db.instructorSession.update({ where: { code }, data: { status } as Record<string, unknown> });
  return c.json({ ok: true, status });
});

// Minimal shape check on a client-supplied protocol before trusting it —
// this only ever arrives from the SAME instructor's own just-completed
// /protocol/preview call (never entered by hand), but the endpoint that
// creates a session accepting an arbitrary JSON blob still deserves a floor:
// reject anything that isn't at least a named list of real steps.
function isValidProtocolShape(x: unknown): x is Protocol {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  return typeof p.experiment_name === "string" && Array.isArray(p.steps) && p.steps.length > 0;
}

app.post("/instructor/sessions", async (c) => {
  const body = await c.req.json();
  const experimentId = typeof body.experiment_id === "string" && body.experiment_id.trim() ? body.experiment_id.trim() : DEFAULT_EXPERIMENT_ID;
  const customProtocol = isValidProtocolShape(body.custom_protocol) ? body.custom_protocol : null;
  // A custom protocol's own parsed name wins over the form field — that's
  // the whole point of uploading a PDF instead of typing a name.
  const experimentName = customProtocol
    ? customProtocol.experiment_name
    : typeof body.experiment_name === "string" && body.experiment_name.trim()
      ? body.experiment_name.trim()
      : getExperiment(experimentId).name;
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
  } as Parameters<typeof createInstructorSession>[0], c.get("user").id, customProtocol);
  return c.json(session);
});

// ─── Pre-lab quiz ────────────────────────────────────────────────────
app.get("/lab/:sessionId/prelab", async (c) => {
  const { sessionId } = c.req.param();
  if ((await sessionAccess(sessionId, c.get("user"))) === "forbidden") return c.json({ error: "Forbidden" }, 403);
  const session = await hydrateSession(sessionId);
  const experimentId = session?.experimentId;
  const exp = getExperiment(experimentId);
  const quiz = await generatePrelabQuiz(exp.protocol, exp.id);
  // Strip correct answers before sending to client
  return c.json({ ...quiz, questions: quiz.questions.map(({ correct: _c, ...q }) => q) });
});

app.post("/lab/:sessionId/prelab", async (c) => {
  const { sessionId } = c.req.param();
  if ((await sessionAccess(sessionId, c.get("user"))) === "forbidden") return c.json({ error: "Forbidden" }, 403);
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
  if ((await sessionAccess(sessionId, c.get("user"))) === "forbidden") return c.json({ error: "Forbidden" }, 403);
  const { hypothesis } = await c.req.json<{ hypothesis: string }>();
  await db.labSession.update({ where: { id: sessionId }, data: { hypothesis } }).catch(() => {});
  // This session is very likely already cached in-memory from the join/parse
  // calls moments earlier on this same instance — without dropping it, the
  // cache would keep serving the pre-hypothesis (null) copy for the rest of
  // this instance's lifetime, and the summary/report would never see it.
  invalidateSessionCache(sessionId);
  return c.json({ ok: true });
});

// ─── Benchmarking ─────────────────────────────────────────────────────
app.get("/lab/:sessionId/benchmark", async (c) => {
  const { sessionId } = c.req.param();
  if ((await sessionAccess(sessionId, c.get("user"))) === "forbidden") return c.json({ error: "Forbidden" }, 403);
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
  if (!(await instructorOwnsCode(code, c.get("user").id))) return c.json({ error: "Not found" }, 404);
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
// Note: these routes are called from instructor pages that are already protected
// by NextAuth middleware at the page level. No additional passcode check needed.

// Instructor decisions are ground truth — aggregate them into a live accuracy
// figure rather than discarding them.
app.get("/instructor/accuracy", async (c) => c.json(await getAccuracyReport(c.get("user").id)));

app.get("/instructor/verify", async (c) => {
  const status = c.req.query("status") as "pending" | "approved" | "rejected" | undefined;
  return c.json(await listVerifications(status, c.get("user").id));
});

app.post("/instructor/verify", async (c) => {
  const body = await c.req.json();
  if (body.action === "resolve") {
    if (!(await instructorOwnsVerification(body.id, c.get("user").id))) return c.json({ error: "Not found" }, 404);
    const corrected = typeof body.corrected_reading === "number" ? body.corrected_reading : null;
    await resolveVerification(body.id, body.status, body.comment, corrected);
    return c.json({ ok: true });
  }
  if (body.action === "bulk_resolve") {
    const ids: unknown = body.ids;
    const status = body.status === "rejected" ? "rejected" : "approved";
    if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "No ids provided" }, 400);
    const userId = c.get("user").id;
    let resolved = 0;
    // Sequential, not Promise.all — each resolve does a read-modify-write on the
    // student's labSession row, and concurrent writes to the same session (two
    // queued entries for the same student) would race and drop one.
    for (const id of ids) {
      if (typeof id !== "string") continue;
      if (!(await instructorOwnsVerification(id, userId))) continue;
      await resolveVerification(id, status, body.comment);
      resolved++;
    }
    return c.json({ ok: true, resolved });
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

// ─── Skip requests (instructor-led sessions only) ──────────────────────
// A student in a session joined via an instructor code can't self-skip a
// step (see the "skip_step" gate in /session/action) — they queue a
// request here instead, which the instructor approves or denies from
// their own dashboard within SKIP_REQUEST_TIMEOUT_MS.
app.get("/instructor/skip-requests", async (c) => {
  return c.json(await listPendingSkipRequests(c.get("user").id));
});

app.post("/instructor/skip-requests/:sessionId/approve", async (c) => {
  const { sessionId } = c.req.param();
  const row = await db.labSession.findUnique({
    where: { id: sessionId },
    select: { instructorCode: true, experimentId: true, skipRequestStep: true },
  });
  if (!row?.instructorCode || !(await instructorOwnsCode(row.instructorCode, c.get("user").id))) {
    return c.json({ error: "Not found" }, 404);
  }
  if (row.skipRequestStep === null) return c.json({ error: "No pending request" }, 404);
  await hydrateSession(sessionId);
  const affected = flagDownstreamStepsFor(row.experimentId, row.skipRequestStep);
  const result = await approveSkipRequest(sessionId, affected);
  if (result === null) return c.json({ error: "Request expired before it could be approved" }, 409);
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true, step_number: row.skipRequestStep });
});

app.post("/instructor/skip-requests/:sessionId/deny", async (c) => {
  const { sessionId } = c.req.param();
  const row = await db.labSession.findUnique({ where: { id: sessionId }, select: { instructorCode: true } });
  if (!row?.instructorCode || !(await instructorOwnsCode(row.instructorCode, c.get("user").id))) {
    return c.json({ error: "Not found" }, 404);
  }
  await hydrateSession(sessionId);
  clearSkipRequest(sessionId);
  return c.json({ ok: true });
});

// ─── Student join ─────────────────────────────────────────────────────
app.post("/student/join", async (c) => {
  // Join codes are 4 chars over a ~32-char alphabet (~1M combinations) — cheap
  // enough to brute-force without a throttle. Keyed by IP, not by code, so a
  // single guesser is slowed without penalizing everyone hitting one popular
  // code from a shared classroom NAT.
  if (!rateLimit(`student-join:${clientIp(c)}`, 20, 5 * 60 * 1000)) {
    return c.json({ error: "Too many attempts. Try again in a few minutes." }, 429);
  }
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

  // If the instructor uploaded their own PDF at session-creation time, every
  // student joining this code gets THAT parsed protocol instead of the
  // library one for experiment_id — this is what actually makes the upload
  // meaningful; previously the parsed steps were discarded and every student
  // silently got the generic library experiment regardless.
  const protocolRow = await db.instructorSession.findUnique({
    where: { code: code.toUpperCase().trim() },
    select: { customProtocol: true },
  });
  const customProtocol = (protocolRow?.customProtocol as unknown as Protocol | null) ?? null;
  const totalSteps = customProtocol ? customProtocol.steps.length : exp.protocol.steps.length;
  const experimentName = customProtocol ? customProtocol.experiment_name : exp.name;

  // Attribute the session to the AUTHENTICATED account, not to a typed-in name.
  // Previously studentName came straight from the join form, so a student could
  // record work under a classmate's name and nothing linked a session to a user
  // — which meant no history, no cross-device resume, and no defensible record.
  const user = c.get("user");
  const attributedName = user?.name ?? user?.email ?? student_name ?? "Student";

  // Atomically upsert the labSession with instructorCode in one DB call so the
  // foreign key is always set — avoids the race where a fire-and-forget persist
  // hadn't committed yet when addStudentToSession tried to UPDATE the same row.
  await db.labSession.upsert({
    where: { id: session_id },
    create: {
      id: session_id,
      studentName: attributedName,
      experimentId: exp.id,
      experimentName,
      totalSteps,
      instructorCode: code.toUpperCase(),
      userId: user?.id ?? null,
    },
    update: { instructorCode: code.toUpperCase(), studentName: attributedName, userId: user?.id ?? null },
  });
  upsertSession({ sessionId: session_id, studentName: attributedName, experimentId: exp.id, experimentName, totalSteps, instructorCode: code.toUpperCase() });
  console.log(`[ROUTE /student/join] ✓ Joined: session_id=${session_id} experiment=${exp.id} user=${user?.email ?? "?"} name="${attributedName}" instructor_code=${code}${customProtocol ? " (custom protocol)" : ""}`);
  return c.json({
    ok: true,
    experiment_id: exp.id,
    experiment_name: experimentName,
    session_name: instrSession.session_name,
    custom_protocol: customProtocol,
    // A custom protocol has no library "textbook answer" of its own — the
    // base experiment's theoretical value is the best available reference,
    // same fallback /protocol/parse already uses for a genuinely-parsed PDF.
    theoretical: exp.theoretical,
  });
});

// ─── Student history ─────────────────────────────────────────────────
// Sessions are attributed to the authenticated account, so a student's record
// follows them across devices instead of living in one browser's sessionStorage.
app.get("/student/history", async (c) => {
  const user = c.get("user");
  if (!user?.id) return c.json([]);
  const rows = await db.labSession.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
  return c.json(
    rows.map((row) => {
      const steps = (row.steps as unknown as StepRecord[]) ?? [];
      return {
        session_id: row.id,
        experiment_id: row.experimentId,
        experiment_name: row.experimentName,
        status: row.status,
        current_step: row.currentStep,
        total_steps: row.totalSteps,
        steps_completed: steps.filter((s) => s.state === "completed").length,
        deviation_percent: row.deviationPercent,
        prelab_score: row.prelabScore,
        safety_alert_count: row.safetyAlertCount,
        override_count: steps.filter((s) => s.manual_override).length,
        started_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      };
    }),
  );
});

// ─── Pacing / integrity timeline ─────────────────────────────────────
// Uses the completed_at timestamps the store has always recorded. Catches a
// fraud mode the vision pipeline structurally cannot: valid photos of someone
// else's apparatus still cannot beat the clock.
app.get("/lab/:sessionId/pacing", async (c) => {
  const { sessionId } = c.req.param();
  if ((await sessionAccess(sessionId, c.get("user"))) === "forbidden") return c.json({ error: "Forbidden" }, 403);
  const session = await hydrateSession(sessionId);
  if (!session) return c.json({ error: "Session not found" }, 404);
  const row = await db.labSession.findUnique({ where: { id: sessionId }, select: { createdAt: true } });
  const exp = getExperiment(session.experimentId);
  return c.json(analysePacing(session.steps, exp.protocol, row?.createdAt ?? new Date()));
});

// ─── Tamper-evident safety log ───────────────────────────────────────
app.get("/lab/:sessionId/audit", async (c) => {
  const { sessionId } = c.req.param();
  if ((await sessionAccess(sessionId, c.get("user"))) === "forbidden") return c.json({ error: "Forbidden" }, 403);
  const session = await hydrateSession(sessionId);
  if (!session) return c.json({ error: "Session not found" }, 404);
  // Read from the append-only AuditLogEntry table, NOT the mutable safetyLog
  // JSON column — each row's hash was fixed at insert time, so this can
  // actually detect a post-hoc edit instead of re-deriving a fresh,
  // self-consistent chain from whatever the log currently contains.
  const rows = await db.auditLogEntry.findMany({ where: { sessionId }, orderBy: { id: "asc" } });
  const chain = buildChain(rows);
  return c.json({ chain, verification: verifyChain(chain), student_name: session.studentName });
});

// ─── Risk ranking across a session ───────────────────────────────────
// Ranks who the instructor should walk over to first, and sets a per-student
// auto-verification bar so scarce attention goes where the risk actually is.
// ─── Class analytics, student records, and saved photos ──────────────
//
// Everything the app already records, finally readable by the instructor who
// owns the class. All three are ownership-scoped the same way as every other
// instructor route — a code you don't own returns 404, not someone else's data.

app.get("/instructor/sessions/:code/analytics", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!(await instructorOwnsCode(code, c.get("user").id))) return c.json({ error: "Not found" }, 404);
  const analytics = await getSessionAnalytics(code);
  if (!analytics) return c.json({ error: "Not found" }, 404);
  return c.json(analytics);
});

/** One student's complete experiment record — every step, timing, photo, note. */
app.get("/instructor/students/:sessionId/record", async (c) => {
  const { sessionId } = c.req.param();
  // Reuse the same access rule as the student-facing session routes, so an
  // instructor sees exactly the sessions they already have a right to see.
  const access = await sessionAccess(sessionId, c.get("user"));
  if (access === "not_found") return c.json({ error: "Not found" }, 404);
  if (access === "forbidden") return c.json({ error: "Forbidden" }, 403);
  const record = await getStudentRecord(sessionId);
  if (!record) return c.json({ error: "Not found" }, 404);
  return c.json(record);
});

/**
 * The bytes of one submitted photo.
 *
 * Photos were always written to the database, but the verification list stops
 * shipping base64 for resolved entries to keep that payload small — which meant
 * an approved or rejected photo became unreachable. Serving them one at a time,
 * on demand, keeps lists light AND makes every photo permanently viewable.
 */
app.get("/instructor/verifications/:id/image", async (c) => {
  const { id } = c.req.param();
  if (!(await instructorOwnsVerification(id, c.get("user").id))) return c.json({ error: "Not found" }, 404);
  const image = await getVerificationImage(id);
  if (!image) return c.json({ error: "Not found" }, 404);
  const raw = image.includes(",") ? image.split(",", 2)[1] ?? "" : image;
  const bytes = Buffer.from(raw, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      // Deliberately NOT cached, despite the bytes never changing.
      //
      // These are students' submitted photos behind an ownership check, and lab
      // machines are shared. With a long-lived cache the browser replays a hit
      // WITHOUT re-contacting the server, so after instructor A logs out and
      // instructor B logs in on the same computer, B could be served A's
      // students' photos straight from cache — the ownership check never runs.
      // Verified: a cached fetch returned 200 for a non-owner while a
      // no-store fetch correctly returned 404. The images are a few KB, so
      // re-fetching costs far less than that leak.
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
});

app.get("/instructor/sessions/:code/risk", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!(await instructorOwnsCode(code, c.get("user").id))) return c.json({ error: "Not found" }, 404);
  const rows = await db.labSession.findMany({ where: { instructorCode: code } });

  const assessments = await Promise.all(
    rows.map(async (row) => {
      const steps = (row.steps as unknown as StepRecord[]) ?? [];
      const exp = getExperiment(row.experimentId);
      const pacing = analysePacing(steps, exp.protocol, row.createdAt);
      return {
        ...assessRisk({
          sessionId: row.id,
          studentName: row.studentName,
          steps,
          safetyAlertCount: row.safetyAlertCount,
          deviationPercent: row.deviationPercent,
          prelabPassed: row.prelabPassed,
          pacingFlagged: pacing.flagged_count,
          duplicatePhotoCount: row.duplicatePhotoCount,
        }),
        pacing_verdict: pacing.verdict,
        integrity_score: pacing.integrity_score,
        current_step: row.currentStep,
        total_steps: row.totalSteps,
      };
    }),
  );

  assessments.sort((a, b) => b.score - a.score);
  return c.json(assessments);
});

// ─── Lab summary & report ────────────────────────────────────────────
app.get("/lab/:sessionId/summary", async (c) => {
  const { sessionId } = c.req.param();
  if ((await sessionAccess(sessionId, c.get("user"))) === "forbidden") return c.json({ error: "Forbidden" }, 403);
  return c.json(await buildLearningSummary(sessionId));
});

app.get("/lab/:sessionId/report", async (c) => {
  const { sessionId } = c.req.param();
  if ((await sessionAccess(sessionId, c.get("user"))) === "forbidden") return c.json({ error: "Forbidden" }, 403);
  return c.json(await buildReport(sessionId));
});

// ─── Profile ───────────────────────────────────────────────────────────
// Every route here acts on the CALLER's own account only — there is no
// :userId param anywhere below, deliberately, so there's no ownership check
// to get wrong: you can only ever read, edit, export, or delete yourself.
app.get("/profile", async (c) => {
  const authUser = c.get("user");
  const user = await db.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  if (!user) return c.json({ error: "Not found" }, 404);

  const base = { id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.createdAt.toISOString() };

  if (user.role === "instructor") {
    const [classesCreated, totalStudents, accuracy] = await Promise.all([
      db.instructorSession.count({ where: { createdByUserId: user.id } }),
      db.labSession.count({ where: { instructor: { createdByUserId: user.id } } }),
      getAccuracyReport(user.id),
    ]);
    return c.json({
      ...base,
      instructor_stats: {
        classes_created: classesCreated,
        total_students: totalStudents,
        verifications_resolved: accuracy.resolved,
        agreement: accuracy.agreement,
      },
    });
  }

  const sessions = await db.labSession.findMany({ where: { userId: user.id }, select: { status: true, deviationPercent: true } });
  const completed = sessions.filter((s) => s.status === "completed");
  const accurate = completed.filter((s) => s.deviationPercent !== null && s.deviationPercent <= 5).length;
  const deviations = completed.map((s) => s.deviationPercent).filter((d): d is number => d !== null);
  const avgDeviation = deviations.length ? Math.round((deviations.reduce((a, b) => a + b, 0) / deviations.length) * 10) / 10 : null;
  return c.json({
    ...base,
    student_stats: {
      experiments_started: sessions.length,
      experiments_completed: completed.length,
      accurate_count: accurate,
      avg_deviation: avgDeviation,
    },
  });
});

app.patch("/profile", async (c) => {
  const authUser = c.get("user");
  const { name } = await c.req.json<{ name?: string }>();
  if (typeof name !== "string" || !name.trim()) return c.json({ error: "Name cannot be empty" }, 400);
  const trimmed = name.trim().slice(0, 100);
  await db.user.update({ where: { id: authUser.id }, data: { name: trimmed } });
  return c.json({ ok: true, name: trimmed });
});

// Right to data portability (GDPR Art. 20 / India's DPDP Act) — a full
// export of everything tied to this account, not just the profile fields.
app.get("/profile/export", async (c) => {
  const authUser = c.get("user");
  const user = await db.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  if (!user) return c.json({ error: "Not found" }, 404);

  const labSessions = await db.labSession.findMany({ where: { userId: user.id } });
  const instructorSessions =
    user.role === "instructor" ? await db.instructorSession.findMany({ where: { createdByUserId: user.id } }) : [];

  const payload = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.createdAt.toISOString() },
    lab_sessions: labSessions,
    instructor_sessions: instructorSessions,
  };
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="labmind-data-${user.id}.json"`,
    },
  });
});

// Right to erasure. Deletes the account's OWN lab history (personal data),
// but a class an instructor created isn't their personal data — it belongs
// to the students who joined it, so it's orphaned (owner cleared) rather
// than deleted, same as any other ownerless class under the ownership
// scoping enforced everywhere else in this file.
app.post("/profile/delete", async (c) => {
  const authUser = c.get("user");
  const { confirm } = await c.req.json<{ confirm?: string }>();
  if (confirm !== "DELETE") return c.json({ error: 'Type "DELETE" to confirm' }, 400);

  const ownSessions = await db.labSession.findMany({ where: { userId: authUser.id }, select: { id: true } });
  const ids = ownSessions.map((s) => s.id);
  if (ids.length) {
    await db.verificationEntry.deleteMany({ where: { sessionId: { in: ids } } });
    await db.agentDecision.deleteMany({ where: { sessionId: { in: ids } } });
    await db.auditLogEntry.deleteMany({ where: { sessionId: { in: ids } } });
    await db.labSession.deleteMany({ where: { id: { in: ids } } });
  }
  await db.instructorSession.updateMany({ where: { createdByUserId: authUser.id }, data: { createdByUserId: null } });
  await db.user.delete({ where: { id: authUser.id } });

  return c.json({ ok: true });
});

// Every verb used by a Hono route MUST be re-exported here — Next.js returns
// 405 for any verb it doesn't see, before the request ever reaches Hono.
// PATCH was missing, which silently broke saving AI settings and ending a session.
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
