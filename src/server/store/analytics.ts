/**
 * Per-class analytics and per-student records.
 *
 * The instructor console could show a live progress table and a per-student
 * report, but three things were missing:
 *
 *   1. No aggregate view of a class — how many joined, how far they got, where
 *      the cohort actually struggles. "Which step is failing everyone?" could
 *      only be answered by reading every row.
 *   2. No full record of one student's experiment. Every step's timing,
 *      reading, override and photo was already stored; nothing surfaced it.
 *   3. Photos were written to the database but became unreachable once
 *      approved or rejected, because the verification list deliberately stops
 *      shipping base64 for resolved entries (a real payload fix). The images
 *      were saved and then effectively lost.
 *
 * Everything here reads data the app already records. No new capture, no new
 * writes — the evidence existed, it just had no way out.
 */
import "server-only";
import { db } from "@/server/db";
import { getExperiment } from "@/server/experiments";
import { analysePacing } from "@/server/tools/pacing";
import type {
  Protocol, StepRecord, SafetyLogEntry,
  SessionAnalytics, StepAnalytics, StudentRecord,
} from "@/lib/types";

// ─── Helpers ────────────────────────────────────────────────────────

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The protocol students in this class actually ran — the instructor's own
 * uploaded/hand-built one when there is one, else the library experiment's.
 * Using the library protocol for a custom class would label every step wrongly.
 */
function protocolFor(customProtocol: unknown, experimentId: string): Protocol {
  const custom = customProtocol as Protocol | null;
  if (custom?.steps?.length) return custom;
  return getExperiment(experimentId).protocol;
}

// ─── Class analytics ────────────────────────────────────────────────

export async function getSessionAnalytics(code: string): Promise<SessionAnalytics | null> {
  const instr = await db.instructorSession.findUnique({
    where: { code },
    select: { code: true, sessionName: true, experimentName: true, experimentId: true, customProtocol: true },
  });
  if (!instr) return null;

  const students = await db.labSession.findMany({
    where: { instructorCode: code },
    select: {
      id: true, studentName: true, experimentId: true, currentStep: true, totalSteps: true,
      status: true, deviationPercent: true, safetyAlertCount: true, duplicatePhotoCount: true,
      steps: true, prelabScore: true, prelabPassed: true, createdAt: true,
    },
  });

  const verifications = await db.verificationEntry.findMany({
    where: { session: { instructorCode: code } },
    select: { status: true, aiConfidence: true, stepNumber: true, sessionId: true },
  });

  const protocol = protocolFor(instr.customProtocol, instr.experimentId);
  const totalSteps = protocol.steps.length || students[0]?.totalSteps || 0;

  const completed = students.filter((s) => s.status === "completed").length;
  const notStarted = students.filter((s) => s.currentStep <= 1 && s.status !== "completed").length;
  const active = students.length - completed - notStarted;

  const deviations = students.map((s) => s.deviationPercent).filter((d): d is number => d !== null);
  const prelabScores = students.map((s) => s.prelabScore).filter((p): p is number => p !== null);

  let overrides = 0;
  let skipped = 0;
  let pacingFlags = 0;

  // Per-step accumulators
  const perStep = new Map<number, { reached: number; completed: number; skipped: number; inProgress: number; overrides: number; durations: number[]; maxAttempts: number }>();
  for (const s of protocol.steps) {
    perStep.set(s.step_number, { reached: 0, completed: 0, skipped: 0, inProgress: 0, overrides: 0, durations: [], maxAttempts: 0 });
  }

  for (const student of students) {
    const steps = (student.steps as unknown as StepRecord[]) ?? [];
    overrides += steps.filter((x) => x.manual_override).length;
    skipped += steps.filter((x) => x.state === "skipped").length;

    // Reuse the existing pacing engine rather than re-deriving timings.
    const pacing = analysePacing(steps, protocol, student.createdAt);
    pacingFlags += pacing.flagged_count;

    for (const rec of steps) {
      const bucket = perStep.get(rec.step_number);
      if (!bucket) continue;
      if (student.currentStep >= rec.step_number || rec.state !== "pending") bucket.reached += 1;
      if (rec.state === "completed") bucket.completed += 1;
      if (rec.state === "skipped") bucket.skipped += 1;
      if (rec.manual_override) bucket.overrides += 1;
      bucket.maxAttempts = Math.max(bucket.maxAttempts, rec.vision_attempts ?? 0);
      const p = pacing.steps.find((x) => x.step_number === rec.step_number);
      if (p?.elapsed_seconds != null) bucket.durations.push(p.elapsed_seconds);
    }
    const cur = perStep.get(student.currentStep);
    if (cur && student.status !== "completed") cur.inProgress += 1;
  }

  // Photo outcomes per step
  const photosByStep = new Map<number, { attempts: number; passed: number; failed: number }>();
  for (const v of verifications) {
    const b = photosByStep.get(v.stepNumber) ?? { attempts: 0, passed: 0, failed: 0 };
    b.attempts += 1;
    if (v.status === "approved") b.passed += 1;
    if (v.status === "rejected") b.failed += 1;
    photosByStep.set(v.stepNumber, b);
  }

  const stepAnalytics: StepAnalytics[] = protocol.steps.map((def) => {
    const b = perStep.get(def.step_number)!;
    const p = photosByStep.get(def.step_number) ?? { attempts: 0, passed: 0, failed: 0 };
    return {
      step_number: def.step_number,
      title: def.title,
      reached: b.reached,
      completed: b.completed,
      skipped: b.skipped,
      in_progress: b.inProgress,
      photo_attempts: p.attempts,
      photo_passed: p.passed,
      photo_failed: p.failed,
      manual_overrides: b.overrides,
      median_seconds: median(b.durations),
      max_attempts: b.maxAttempts,
    };
  });

  // "Hardest" is deliberately evidence-based rather than a vibe: a step is hard
  // when students repeatedly retake photos, get rejected, override, or skip it.
  const hardest = stepAnalytics
    .map((s) => {
      const reasons: string[] = [];
      if (s.photo_failed > 0) reasons.push(`${s.photo_failed} photo${s.photo_failed === 1 ? "" : "s"} rejected`);
      if (s.max_attempts >= 3) reasons.push(`up to ${s.max_attempts} attempts needed`);
      if (s.manual_overrides > 0) reasons.push(`${s.manual_overrides} manual override${s.manual_overrides === 1 ? "" : "s"}`);
      if (s.skipped > 0) reasons.push(`${s.skipped} skipped`);
      const weight = s.photo_failed * 3 + Math.max(0, s.max_attempts - 2) * 2 + s.manual_overrides * 2 + s.skipped * 3;
      return { step_number: s.step_number, title: s.title, reason: reasons.join(", "), weight };
    })
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(({ step_number, title, reason }) => ({ step_number, title, reason }));

  const avgProgress = students.length
    ? Math.round(students.reduce((a, s) => a + (s.totalSteps ? (s.currentStep / s.totalSteps) * 100 : 0), 0) / students.length)
    : 0;

  return {
    code: instr.code,
    session_name: instr.sessionName,
    experiment_name: instr.experimentName,
    generated_at: new Date().toISOString(),

    students_joined: students.length,
    students_active: active,
    students_completed: completed,
    students_not_started: notStarted,
    completion_rate: students.length ? Math.round((completed / students.length) * 100) : null,

    avg_progress_percent: avgProgress,
    total_steps: totalSteps,

    results_recorded: deviations.length,
    avg_deviation: deviations.length ? round1(deviations.reduce((a, b) => a + b, 0) / deviations.length) : null,
    median_deviation: median(deviations),
    within_5_percent: deviations.filter((d) => d <= 5).length,
    within_10_percent: deviations.filter((d) => d <= 10).length,

    photos_submitted: verifications.length,
    photos_auto_verified: verifications.filter((v) => v.status === "auto_verified").length,
    photos_pending_review: verifications.filter((v) => v.status === "pending").length,
    photos_approved: verifications.filter((v) => v.status === "approved").length,
    photos_rejected: verifications.filter((v) => v.status === "rejected").length,

    safety_alerts: students.reduce((a, s) => a + s.safetyAlertCount, 0),
    manual_overrides: overrides,
    skipped_steps: skipped,
    duplicate_photos: students.reduce((a, s) => a + s.duplicatePhotoCount, 0),
    pacing_flags: pacingFlags,

    prelab_taken: prelabScores.length,
    prelab_passed: students.filter((s) => s.prelabPassed === true).length,
    avg_prelab_score: prelabScores.length ? round1(prelabScores.reduce((a, b) => a + b, 0) / prelabScores.length) : null,

    steps: stepAnalytics,
    hardest_steps: hardest,
  };
}

// ─── One student's full record ──────────────────────────────────────

export async function getStudentRecord(sessionId: string): Promise<StudentRecord | null> {
  const row = await db.labSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true, studentName: true, experimentId: true, experimentName: true, status: true,
      currentStep: true, totalSteps: true, createdAt: true, updatedAt: true,
      hypothesis: true, prelabScore: true, prelabPassed: true, studentResult: true,
      deviationPercent: true, safetyAlertCount: true, duplicatePhotoCount: true,
      steps: true, safetyLog: true, notes: true, instructorCode: true,
    },
  });
  if (!row) return null;

  // Resolve the protocol this student actually ran, so step titles are right
  // for a custom experiment too.
  let customProtocol: unknown = null;
  if (row.instructorCode) {
    const instr = await db.instructorSession.findUnique({ where: { code: row.instructorCode }, select: { customProtocol: true } });
    customProtocol = instr?.customProtocol ?? null;
  }
  const protocol = protocolFor(customProtocol, row.experimentId);

  const steps = (row.steps as unknown as StepRecord[]) ?? [];
  const pacing = analysePacing(steps, protocol, row.createdAt);

  const [photos, audit, withImage] = await Promise.all([
    db.verificationEntry.findMany({
      where: { sessionId },
      orderBy: { submittedAt: "asc" },
      // Deliberately NOT selecting imageBase64 — a record with a dozen photos
      // would be megabytes. The bytes come from the per-image endpoint.
      select: {
        id: true, stepNumber: true, status: true, aiReading: true, aiConfidence: true,
        aiMessage: true, instructorComment: true, submittedAt: true, resolvedAt: true,
      },
    }),
    db.auditLogEntry.findMany({
      where: { sessionId },
      orderBy: { at: "asc" },
      select: { stepNumber: true, summary: true, severity: true, at: true },
    }),
    // Which entries actually carry bytes. The predicate runs in Postgres, so
    // the column itself is never shipped — but `has_image` then reflects
    // reality instead of always claiming true, which would render a broken
    // tile for any row stored without an image (older/seeded rows).
    db.verificationEntry.findMany({
      where: { sessionId, NOT: { imageBase64: "" } },
      select: { id: true },
    }),
  ]);
  const imageIds = new Set(withImage.map((r) => r.id));

  return {
    session_id: row.id,
    student_name: row.studentName,
    experiment_id: row.experimentId,
    experiment_name: row.experimentName,
    status: row.status,
    current_step: row.currentStep,
    total_steps: row.totalSteps,
    started_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),

    hypothesis: row.hypothesis,
    prelab_score: row.prelabScore,
    prelab_passed: row.prelabPassed,

    student_result: row.studentResult,
    deviation_percent: row.deviationPercent,

    safety_alert_count: row.safetyAlertCount,
    duplicate_photo_count: row.duplicatePhotoCount,

    steps: steps.map((s) => {
      const def = protocol.steps.find((d) => d.step_number === s.step_number);
      const p = pacing.steps.find((x) => x.step_number === s.step_number);
      return {
        ...s,
        title: def?.title ?? `Step ${s.step_number}`,
        expected_observation: def?.expected_observation ?? "",
        elapsed_seconds: p?.elapsed_seconds ?? null,
        pacing_flag: p?.flag ?? null,
      };
    }),

    safety_log: (row.safetyLog as unknown as SafetyLogEntry[]) ?? [],
    notes: (row.notes as unknown as string[]) ?? [],

    photos: photos.map((p) => ({
      id: p.id,
      step_number: p.stepNumber,
      step_title: protocol.steps.find((d) => d.step_number === p.stepNumber)?.title ?? `Step ${p.stepNumber}`,
      status: p.status,
      ai_reading: p.aiReading,
      ai_confidence: p.aiConfidence,
      ai_message: p.aiMessage,
      instructor_comment: p.instructorComment,
      submitted_at: p.submittedAt.toISOString(),
      resolved_at: p.resolvedAt?.toISOString() ?? null,
      has_image: imageIds.has(p.id),
    })),

    audit: audit.map((a) => ({ step_number: a.stepNumber, summary: a.summary, severity: a.severity, at: a.at.toISOString() })),
  };
}

/** Raw image bytes for one verification entry. Callers MUST check ownership first. */
export async function getVerificationImage(id: string): Promise<string | null> {
  const row = await db.verificationEntry.findUnique({ where: { id }, select: { imageBase64: true } });
  return row?.imageBase64 ?? null;
}
