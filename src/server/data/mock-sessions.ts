/** Seed session so the instructor dashboard always has a populated cohort to show. */
import "server-only";
import type { SessionSummary } from "@/lib/types";

const now = () => new Date().toISOString();

export const MOCK_SESSIONS: SessionSummary[] = [
  {
    session_id: "demo-anita",
    student_name: "Anita R.",
    experiment_id: "acid-base-titration",
    experiment_name: "Acid-Base Titration",
    current_step: 4,
    total_steps: 8,
    status: "active",
    last_vision_pass: true,
    deviation_percent: null,
    safety_alert_count: 0,
    flagged_step_count: 0,
    override_count: 0,
    updated_at: now(),
  },
];
