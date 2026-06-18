/**
 * Session code store — Prisma/Supabase backed.
 * Maps short join codes ("LAB-4729") to instructor sessions and manages the
 * verification queue. Seeds demo data once on first run.
 */
import "server-only";
import { db } from "@/server/db";
import type { InstructorSession, VerificationEntry, VerificationStatus } from "@/lib/types";

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
    date: row.date,
    created_at: row.createdAt.toISOString(),
    student_session_ids: [],
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
  entry: Omit<VerificationEntry, "id" | "status" | "instructor_comment" | "resolved_at">,
): Promise<VerificationEntry> {
  const row = await db.verificationEntry.create({
    data: {
      sessionId: entry.session_id,
      studentName: entry.student_name,
      stepNumber: entry.step_number,
      imageBase64: entry.image_base64 ?? "",
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

export async function resolveVerification(id: string, status: "approved" | "rejected", comment?: string) {
  await db.verificationEntry.update({
    where: { id },
    data: { status, instructorComment: comment ?? null, resolvedAt: new Date() },
  });
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
