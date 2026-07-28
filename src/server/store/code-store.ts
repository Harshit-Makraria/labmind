/**
 * Session code store — Prisma/Supabase backed.
 * Maps short join codes ("LAB-4729") to instructor sessions and manages the
 * verification queue. Seeds demo data once on first run.
 */
import "server-only";
import { db } from "@/server/db";
import { invalidateSessionCache } from "@/server/store/session-store";
import type { InstructorSession, StepRecord, VerificationEntry, VerificationStatus } from "@/lib/types";

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
  });
  return rows.map(rowToEntry);
}

/**
 * Resolve a queued verification AND push the decision back onto the student's
 * session. Without the second half the student who was told "pending
 * verification" stays blocked forever — approving did nothing they could see.
 */
export async function resolveVerification(id: string, status: "approved" | "rejected", comment?: string) {
  const entry = await db.verificationEntry.update({
    where: { id },
    data: { status, instructorComment: comment ?? null, resolvedAt: new Date() },
  });

  const lab = await db.labSession.findUnique({
    where: { id: entry.sessionId },
    select: { steps: true, notes: true, currentStep: true },
  });
  if (!lab) return;

  const steps = ((lab.steps as unknown as StepRecord[]) ?? []).map((s) => {
    if (s.step_number !== entry.stepNumber) return s;
    return status === "approved"
      ? { ...s, state: "completed" as const, flagged: false, completed_at: new Date().toISOString() }
      : { ...s, state: "pending" as const, flagged: true, completed_at: null };
  });

  const note =
    status === "approved"
      ? `✅ Instructor approved step ${entry.stepNumber}${comment ? ` — ${comment}` : ""}`
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
