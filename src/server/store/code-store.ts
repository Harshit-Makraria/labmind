/**
 * Session code store — Prisma/Supabase backed.
 * Maps short join codes ("LAB-4729") to instructor sessions and manages the
 * verification queue. Seeds demo data once on first run.
 */
import "server-only";
import { db } from "@/server/db";
import { invalidateSessionCache } from "@/server/store/session-store";
import { getExperiment } from "@/server/experiments";
import type { InstructorSession, StepRecord, VerificationEntry, VerificationStatus } from "@/lib/types";

const VISION_UNIT: Record<string, string> = { burette_reading: "mL", gel_band: "bp", absorbance: "AU", colour_change: "" };

/** Unit for this entry's ai_reading, derived from the step's own declared vision_expected.type — not hardcoded to "mL" for every experiment. */
function unitFor(experimentId: string, stepNumber: number): string {
  const step = getExperiment(experimentId).protocol.steps.find((s) => s.step_number === stepNumber);
  const type = step?.vision_expected?.type;
  return (type && VISION_UNIT[type]) ?? "mL";
}

// ─── Seed ────────────────────────────────────────────────────────────

export async function seedDemoData() {
  const exists = await db.instructorSession.findUnique({ where: { code: "LAB-0042" } });
  if (exists) return;

  // Demo sessions
  await db.instructorSession.createMany({
    data: [
      {
        code: "LAB-0042",
        sessionName: "Chem Lab 3A — Titration",
        experimentId: "acid-base-titration",
        experimentName: "Acid-Base Titration",
        batch: "2025-A",
        department: "Chemistry",
        date: new Date().toISOString().split("T")[0],
      },
    ],
    skipDuplicates: true,
  });

  // Demo lab session for verification foreign key
  await db.labSession.createMany({
    data: [
      { id: "demo-anita", studentName: "Anita R.", experimentId: "acid-base-titration", experimentName: "Acid-Base Titration", totalSteps: 8, instructorCode: "LAB-0042" },
    ],
    skipDuplicates: true,
  });

  // Sample pending verification
  await db.verificationEntry.createMany({
    data: [
      {
        id: "v-001",
        sessionId: "demo-anita",
        studentName: "Anita R.",
        stepNumber: 5,
        imageBase64: "",
        aiReading: 24.3,
        aiConfidence: 0.61,
        aiMessage: "Low confidence: lighting unclear, possible parallax. Confidence 61%.",
        status: "pending",
      },
    ],
    skipDuplicates: true,
  });
}

// ─── Instructor sessions ─────────────────────────────────────────────

export async function getInstructorSession(code: string): Promise<InstructorSession | null> {
  const row = await db.instructorSession.findUnique({
    where: { code: code.toUpperCase().trim() },
    include: { students: { select: { id: true } } },
  });
  if (!row) return null;
  // parse notes JSON if present (Prisma returns parsed Json)
  let require_verification = false;
  try {
    if (row.notes) {
      const n = typeof row.notes === "string" ? JSON.parse(row.notes) : (row.notes as any);
      require_verification = !!n?.require_verification;
    }
  } catch (e) {}
  return {
    code: row.code,
    session_name: row.sessionName,
    experiment_id: row.experimentId,
    experiment_name: row.experimentName,
    batch: row.batch,
    department: row.department,
    institution: (row as Record<string, unknown>)["institution"] as string ?? "",
    course_code: (row as Record<string, unknown>)["courseCode"] as string ?? "",
    status: (row as Record<string, unknown>)["status"] as string ?? "active",
    date: row.date,
    created_at: row.createdAt.toISOString(),
    student_session_ids: row.students.map((s) => s.id),
    require_verification,
  };
}

export async function listInstructorSessions(): Promise<InstructorSession[]> {
  const rows = await db.instructorSession.findMany({
    orderBy: { createdAt: "desc" },
    include: { students: { select: { id: true } } },
  });
  return rows.map((row) => ({
    code: row.code,
    session_name: row.sessionName,
    experiment_id: row.experimentId,
    experiment_name: row.experimentName,
    batch: row.batch,
    department: row.department,
    institution: (row as Record<string, unknown>)["institution"] as string ?? "",
    course_code: (row as Record<string, unknown>)["courseCode"] as string ?? "",
    status: (row as Record<string, unknown>)["status"] as string ?? "active",
    date: row.date,
    created_at: row.createdAt.toISOString(),
    student_session_ids: row.students.map((s) => s.id),
    require_verification: (() => { try { if (row.notes) { const n = typeof row.notes === "string" ? JSON.parse(row.notes) : (row.notes as any); return !!n?.require_verification; } } catch (e) {} return false; })(),
  }));
}

export async function createInstructorSession(
  meta: Omit<InstructorSession, "code" | "created_at" | "student_session_ids">,
): Promise<InstructorSession> {
  const code = await generateCode();
  const row = await db.instructorSession.create({
    data: {
      code,
      sessionName: meta.session_name,
      experimentId: meta.experiment_id,
      experimentName: meta.experiment_name,
      batch: meta.batch ?? "",
      department: meta.department ?? "",
      institution: (meta as Record<string, unknown>)["institution"] as string ?? "",
      courseCode: (meta as Record<string, unknown>)["course_code"] as string ?? "",
      date: meta.date ?? new Date().toISOString().split("T")[0],
      notes: JSON.stringify({ require_verification: !!meta["require_verification"] }),
    },
  });
  return {
    code: row.code,
    session_name: row.sessionName,
    experiment_id: row.experimentId,
    experiment_name: row.experimentName,
    batch: row.batch,
    department: row.department,
    institution: row.institution,
    course_code: row.courseCode,
    status: row.status,
    date: row.date,
    created_at: row.createdAt.toISOString(),
    student_session_ids: [],
    require_verification: !!meta["require_verification"],
  };
}

export async function addStudentToSession(code: string, studentSessionId: string) {
  await db.labSession.update({
    where: { id: studentSessionId },
    data: { instructorCode: code.toUpperCase() },
  }).catch(() => {});
}

// ─── Verification queue ──────────────────────────────────────────────

function rowToEntry(row: {
  id: string; sessionId: string; studentName: string; stepNumber: number;
  imageBase64: string; aiReading: number | null; aiConfidence: number; aiMessage: string | null;
  submittedAt: Date; status: string; instructorComment: string | null; resolvedAt: Date | null;
}): VerificationEntry {
  return {
    id: row.id,
    session_id: row.sessionId,
    student_name: row.studentName,
    step_number: row.stepNumber,
    image_base64: row.imageBase64,
    ai_reading: row.aiReading,
    ai_confidence: row.aiConfidence,
    ai_message: row.aiMessage ?? "",
    submitted_at: row.submittedAt.toISOString(),
    status: row.status as VerificationStatus,
    instructor_comment: row.instructorComment,
    resolved_at: row.resolvedAt?.toISOString() ?? null,
  };
}

export async function submitVerification(
  entry: Omit<VerificationEntry, "id" | "status" | "instructor_comment" | "resolved_at"> & { image_hash?: string | null },
): Promise<VerificationEntry> {
  const row = await db.verificationEntry.create({
    data: {
      sessionId: entry.session_id,
      studentName: entry.student_name,
      stepNumber: entry.step_number,
      imageBase64: entry.image_base64 ?? "",
      imageHash: entry.image_hash ?? null,
      aiReading: entry.ai_reading,
      aiConfidence: entry.ai_confidence,
      aiMessage: entry.ai_message,
    },
  });
  return rowToEntry(row);
}

export async function listVerifications(status?: VerificationStatus): Promise<VerificationEntry[]> {
  const rows = await db.verificationEntry.findMany({
    where: status ? { status } : undefined,
    orderBy: { submittedAt: "desc" },
    include: { session: { select: { experimentId: true } } },
  });
  return rows.map((row) => ({ ...rowToEntry(row), unit: unitFor(row.session.experimentId, row.stepNumber) }));
}

/**
 * Resolve a queued verification AND push the decision back onto the student's
 * session. Without the second half the student who was told "pending
 * verification" stays blocked forever — approving did nothing they could see.
 *
 * `correctedReading` lets the instructor's own read of the photo overrule the
 * model's — previously approving always silently kept the AI's original
 * number, so an instructor who disagreed with the value had no way to record
 * what they actually saw. Their entry becomes the authoritative reading.
 */
export async function resolveVerification(
  id: string,
  status: "approved" | "rejected",
  comment?: string,
  correctedReading?: number | null,
) {
  const entry = await db.verificationEntry.update({
    where: { id },
    data: { status, instructorComment: comment ?? null, resolvedAt: new Date() },
  });

  const lab = await db.labSession.findUnique({
    where: { id: entry.sessionId },
    select: { steps: true, notes: true, currentStep: true },
  });
  if (!lab) return;

  const overridden =
    status === "approved" &&
    correctedReading !== undefined &&
    correctedReading !== null &&
    correctedReading !== entry.aiReading;

  const existingSteps = (lab.steps as unknown as StepRecord[]) ?? [];
  const applyDecision = (s: StepRecord): StepRecord => {
    if (status !== "approved") {
      return { ...s, state: "pending", flagged: true, completed_at: null };
    }
    return {
      ...s,
      state: "completed",
      flagged: false,
      completed_at: new Date().toISOString(),
      // The instructor's own reading replaces the AI's when they disagree —
      // it becomes what the student's report and downstream analysis use.
      vision_reading: overridden ? (correctedReading as number) : s.vision_reading,
    };
  };

  const hasRecord = existingSteps.some((s) => s.step_number === entry.stepNumber);
  const steps = hasRecord
    ? existingSteps.map((s) => (s.step_number === entry.stepNumber ? applyDecision(s) : s))
    : // Defensive: a step record should always exist by the time a verification
      // is resolved (upsertSession blanks the full array on join), but if one is
      // ever missing — corrupted state, a hand-seeded fixture — synthesize it
      // rather than silently discarding the instructor's decision.
      [
        ...existingSteps,
        applyDecision({
          step_number: entry.stepNumber,
          state: "pending",
          flagged: false,
          vision_attempts: 1,
          vision_reading: entry.aiReading,
          vision_pass: null,
          manual_override: null,
          completed_at: null,
        }),
      ].sort((a, b) => a.step_number - b.step_number);

  const note =
    status === "approved"
      ? overridden
        ? `✅ Instructor corrected step ${entry.stepNumber} to ${correctedReading} (AI read ${entry.aiReading ?? "—"})${comment ? ` — ${comment}` : ""}`
        : `✅ Instructor approved step ${entry.stepNumber}${comment ? ` — ${comment}` : ""}`
      : `❌ Instructor rejected step ${entry.stepNumber} — redo this step${comment ? ` — ${comment}` : ""}`;

  const notes = [...(((lab.notes as unknown as string[]) ?? [])), note];

  await db.labSession.update({
    where: { id: entry.sessionId },
    data: {
      steps: steps as unknown as object,
      notes: notes as unknown as object,
      // On approval let the student move past the step they were held on.
      currentStep:
        status === "approved"
          ? Math.max(lab.currentStep, entry.stepNumber + 1)
          : Math.min(lab.currentStep, entry.stepNumber),
    },
  });

  // The in-memory cache is now stale for this session — drop it so the next
  // read re-hydrates from the DB rather than serving the pre-decision copy.
  invalidateSessionCache(entry.sessionId);
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function generateCode(): Promise<string> {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let num = "";
  for (let i = 0; i < 4; i++) num += chars[Math.floor(Math.random() * chars.length)];
  const code = `LAB-${num}`;
  const exists = await db.instructorSession.findUnique({ where: { code } });
  return exists ? generateCode() : code;
}
