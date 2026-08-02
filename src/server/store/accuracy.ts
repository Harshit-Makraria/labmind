/**
 * Closed-loop accuracy tracking.
 *
 * Every approve/reject an instructor makes in the verification queue is a
 * LABELLED data point about whether the vision system was right. We were
 * discarding those. Aggregating them turns "the AI is quite accurate" into a
 * defensible number, and gives real evidence for tuning the confidence
 * thresholds, which are otherwise guesses.
 */
import "server-only";
import { db } from "@/server/db";
import { VISION_HIGH_CONFIDENCE } from "@/lib/types";
import type { AccuracyBucket, AccuracyReport } from "@/lib/types";
import { DEMO_INSTRUCTOR_CODE } from "@/server/store/code-store";

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000);

/** Was unscoped — every instructor got the same number, mixing every OTHER instructor's verification decisions into what read as "your class's AI accuracy." Scoped the same way as listVerifications. */
export async function getAccuracyReport(ownerUserId?: string): Promise<AccuracyReport> {
  const rows = await db.verificationEntry.findMany({
    where: ownerUserId
      ? { session: { instructor: { OR: [{ createdByUserId: ownerUserId }, { code: DEMO_INSTRUCTOR_CODE }] } } }
      : undefined,
    select: { status: true, aiConfidence: true },
  });

  const resolvedRows = rows.filter((r) => r.status === "approved" || r.status === "rejected");
  const approved = resolvedRows.filter((r) => r.status === "approved").length;
  const rejected = resolvedRows.filter((r) => r.status === "rejected").length;

  const bands: { label: string; min: number; max: number }[] = [
    { label: `High (≥${Math.round(VISION_HIGH_CONFIDENCE * 100)}%)`, min: VISION_HIGH_CONFIDENCE, max: 1.01 },
    { label: "Medium (60–82%)", min: 0.6, max: VISION_HIGH_CONFIDENCE },
    { label: "Low (<60%)", min: 0, max: 0.6 },
  ];

  const byConfidence: AccuracyBucket[] = bands.map((b) => {
    const inBand = resolvedRows.filter((r) => r.aiConfidence >= b.min && r.aiConfidence < b.max);
    const a = inBand.filter((r) => r.status === "approved").length;
    const rj = inBand.filter((r) => r.status === "rejected").length;
    return { label: b.label, total: inBand.length, approved: a, rejected: rj, agreement: pct(a, inBand.length) };
  });

  const confidentMisses = resolvedRows.filter(
    (r) => r.status === "rejected" && r.aiConfidence >= VISION_HIGH_CONFIDENCE,
  ).length;

  return {
    resolved: resolvedRows.length,
    pending: rows.filter((r) => r.status === "pending").length,
    approved,
    rejected,
    agreement: pct(approved, resolvedRows.length),
    byConfidence,
    confidentMisses,
    generatedAt: new Date().toISOString(),
  };
}
