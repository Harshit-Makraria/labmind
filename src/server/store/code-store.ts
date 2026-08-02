/**
 * Session code store — Prisma/Supabase backed.
 * Maps short join codes ("LAB-4729") to instructor sessions and manages the
 * verification queue. Seeds demo data once on first run.
 */
import "server-only";
import { db } from "@/server/db";
import { invalidateSessionCache } from "@/server/store/session-store";
import { getExperiment } from "@/server/experiments";
import type { InstructorSession, Protocol, StepRecord, VerificationEntry, VerificationStatus } from "@/lib/types";

const VISION_UNIT: Record<string, string> = { burette_reading: "mL", gel_band: "bp", absorbance: "AU", colour_change: "" };

/** Unit for this entry's ai_reading, derived from the step's own declared vision_expected.type — not hardcoded to "mL" for every experiment. */
function unitFor(experimentId: string, stepNumber: number): string {
  const step = getExperiment(experimentId).protocol.steps.find((s) => s.step_number === stepNumber);
  const type = step?.vision_expected?.type;
  return (type && VISION_UNIT[type]) ?? "mL";
}

// ─── Seed ────────────────────────────────────────────────────────────

/**
 * The one InstructorSession every instructor account is meant to see
 * regardless of who created it — a built-in sandbox to explore the app with,
 * seeded once below. This is the ONLY legitimate "shared across every
 * instructor" row; anything else with no owner is orphaned data (e.g. a
 * class created before ownership tracking existed, or a bug), not something
 * every instructor should be able to browse into.
 */
export const DEMO_INSTRUCTOR_CODE = "LAB-0042";

export async function seedDemoData() {
  const exists = await db.instructorSession.findUnique({ where: { code: DEMO_INSTRUCTOR_CODE } });
  if (exists) return;

  // Demo sessions
  await db.instructorSession.createMany({
    data: [
      {
        code: DEMO_INSTRUCTOR_CODE,
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
      { id: "demo-anita", studentName: "Anita R.", experimentId: "acid-base-titration", experimentName: "Acid-Base Titration", totalSteps: 8, instructorCode: DEMO_INSTRUCTOR_CODE },
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
    created_by_user_id: (row as Record<string, unknown>)["createdByUserId"] as string | null,
  };
}

/**
 * Sessions owned by this instructor, plus the one shared demo class. This
 * used to also include every OTHER ownerless row (createdByUserId === null)
 * on the theory that pre-ownership classes shouldn't vanish — but in
 * practice that meant any class created before ownership tracking existed
 * (including another instructor's real students) was visible to every
 * instructor account. Only the deliberately-shared demo code gets that
 * treatment now; a genuinely orphaned class is owner-only-unreachable, not
 * everyone-reachable.
 */
export async function listInstructorSessions(ownerUserId?: string): Promise<InstructorSession[]> {
  const rows = await db.instructorSession.findMany({
    where: ownerUserId ? { OR: [{ createdByUserId: ownerUserId }, { code: DEMO_INSTRUCTOR_CODE }] } : undefined,
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
    created_by_user_id: (row as Record<string, unknown>)["createdByUserId"] as string | null,
  }));
}

export async function createInstructorSession(
  meta: Omit<InstructorSession, "code" | "created_at" | "student_session_ids">,
  createdByUserId?: string,
  /** The AI-parsed protocol from an uploaded PDF, when the instructor provided one. Every student who joins this code gets THIS protocol instead of the library one for experimentId. */
  customProtocol?: Protocol | null,
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
      createdByUserId: createdByUserId ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      customProtocol: (customProtocol ?? null) as any,
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
    created_by_user_id: createdByUserId ?? null,
  };
}

/**
 * Does this instructor own the class behind this code? Only the shared demo
 * code is open to everyone — a genuinely ownerless row (createdByUserId
 * null, e.g. a class created before ownership tracking existed) used to be
 * treated as owned-by-anyone too, which meant any instructor could open,
 * export, or approve/deny actions on any other instructor's orphaned class.
 * Now it's owner-only, same as any other class; nobody happens to be able to
 * manage a truly orphaned one, which is the safe default.
 */
export async function instructorOwnsCode(code: string, userId: string): Promise<boolean> {
  const normalized = code.toUpperCase().trim();
  if (normalized === DEMO_INSTRUCTOR_CODE) return true;
  const row = await db.instructorSession.findUnique({
    where: { code: normalized },
    select: { createdByUserId: true } as Record<string, boolean>,
  });
  if (!row) return false;
  const owner = (row as Record<string, unknown>)["createdByUserId"] as string | null;
  return owner === userId;
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
  imageBase64?: string; aiReading: number | null; aiConfidence: number; aiMessage: string | null;
  submittedAt: Date; status: string; instructorComment: string | null; resolvedAt: Date | null;
}): VerificationEntry {
  return {
    id: row.id,
    session_id: row.sessionId,
    student_name: row.studentName,
    step_number: row.stepNumber,
    image_base64: row.imageBase64 ?? "",
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

const BASE_FIELDS = {
  id: true, sessionId: true, studentName: true, stepNumber: true,
  aiReading: true, aiConfidence: true, aiMessage: true, submittedAt: true,
  status: true, instructorComment: true, resolvedAt: true,
  session: { select: { experimentId: true } },
} as const;

/**
 * Verification-queue entries scoped to this instructor's own classes. Joins
 * through the student's session → instructorCode → InstructorSession owner,
 * since VerificationEntry itself has no direct owner column. Only the shared
 * demo class is visible across every instructor account — a genuinely
 * ownerless (orphaned) class is owner-only, same rule as
 * listInstructorSessions/instructorOwnsCode.
 *
 * Resolved entries never render their photo (the "Resolved" list in the UI
 * is text-only) but the base64 image column is the single biggest field on
 * this row, and this endpoint gets polled every few seconds — so only
 * pending entries (the ones actually shown with a photo) fetch imageBase64;
 * resolved rows skip it, keeping the payload from growing unbounded as a
 * class accumulates history.
 */
export async function listVerifications(status?: VerificationStatus, ownerUserId?: string): Promise<VerificationEntry[]> {
  const ownerWhere = ownerUserId
    ? { session: { instructor: { OR: [{ createdByUserId: ownerUserId }, { code: DEMO_INSTRUCTOR_CODE }] } } }
    : {};

  if (status) {
    const rows = await db.verificationEntry.findMany({
      where: { status, ...ownerWhere },
      orderBy: { submittedAt: "desc" },
      select: { ...BASE_FIELDS, imageBase64: status === "pending" },
    });
    return rows.map((row) => ({ ...rowToEntry(row), unit: unitFor(row.session.experimentId, row.stepNumber) }));
  }

  const [pendingRows, resolvedRows] = await Promise.all([
    db.verificationEntry.findMany({
      where: { status: "pending", ...ownerWhere },
      orderBy: { submittedAt: "desc" },
      select: { ...BASE_FIELDS, imageBase64: true },
    }),
    db.verificationEntry.findMany({
      where: { status: { not: "pending" }, ...ownerWhere },
      orderBy: { submittedAt: "desc" },
      select: { ...BASE_FIELDS, imageBase64: false },
    }),
  ]);
  return [...pendingRows, ...resolvedRows].map((row) => ({ ...rowToEntry(row), unit: unitFor(row.session.experimentId, row.stepNumber) }));
}

/** Does this instructor own the class the given verification entry's student session belongs to? */
export async function instructorOwnsVerification(verificationId: string, userId: string): Promise<boolean> {
  const entry = await db.verificationEntry.findUnique({
    where: { id: verificationId },
    select: { session: { select: { instructorCode: true } } },
  });
  if (!entry) return false;
  if (!entry.session.instructorCode) return true; // no class attached — nothing to scope
  return instructorOwnsCode(entry.session.instructorCode, userId);
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
