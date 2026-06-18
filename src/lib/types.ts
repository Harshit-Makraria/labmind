/**
 * LabMind canonical types.
 * Shared by the React client and the Next.js Route Handlers (the "backend").
 */

// ─── Protocol & experiments ─────────────────────────────────────────

export type VisionCheckType = "burette_reading" | "colour_change" | "gel_band";

export interface Reagent {
  name: string;
  concentration?: string;
  volume_ml?: number | null;
}

export interface VisionExpected {
  type: VisionCheckType;
  expected_value: number | null;
  tolerance: number;
}

export interface ProtocolStep {
  step_number: number;
  title: string;
  instructions: string[];
  reagents: Reagent[];
  duration_seconds: number | null;
  safety_flags: string[];
  science_explanation: string;
  expected_observation: string;
  vision_check_required: boolean;
  vision_expected: VisionExpected | null;
  /** Steps whose results become unreliable if this one is skipped/failed. */
  affects_steps?: number[];
}

export interface Protocol {
  experiment_name: string;
  steps: ProtocolStep[];
}

export type ExperimentDomain = "chemistry" | "biology" | "kinetics";
export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface ExperimentMeta {
  id: string;
  name: string;
  domain: ExperimentDomain;
  difficulty: Difficulty;
  duration_minutes: number;
  description: string;
  hazard_level: "low" | "medium" | "high";
  /** What the student ultimately measures, with the expected (theoretical) value. */
  theoretical: { label: string; value: number; unit: string };
  step_count: number;
  reagent_names: string[];
}

export interface Experiment extends ExperimentMeta {
  protocol: Protocol;
}

export interface ParseProtocolRequest {
  pdf_base64?: string;
  session_id: string;
  student_name?: string;
  experiment_id?: string;
}

export interface ParseProtocolResponse extends Protocol {
  session_id: string;
  experiment_id: string;
  theoretical: { label: string; value: number; unit: string };
}

// ─── Vision verification ────────────────────────────────────────────

export interface VisionCheckRequest {
  session_id: string;
  step_number: number;
  image_base64: string;
  expected: VisionExpected;
  experiment_id?: string;
}

export interface VisionResult {
  reading: number | null;
  confidence: number;
  pass: boolean;
  deviation: number | null;
  message: string;
  notes: string;
  /** Total attempts made for this step, incl. this one. */
  attempts: number;
  /** True once attempts >= 2 and still failing — UI offers manual entry. */
  manual_override_available: boolean;
}

// ─── Safety engine ──────────────────────────────────────────────────

export type Severity = "low" | "medium" | "high";

export interface SafetyCheckRequest {
  session_id: string;
  step_number: number;
  reagents: Reagent[];
  experiment_id?: string;
}

export interface SafetyConflict {
  reagents: string[];
  type: string;
  severity: Severity;
  description: string;
  action: string;
}

export interface SafetyResult {
  conflict: boolean;
  alerts: SafetyConflict[];
}

// ─── Result interpretation ──────────────────────────────────────────

export type ResultSeverity = "green" | "amber" | "red";

export interface InterpretRequest {
  session_id: string;
  student_result: number;
  unit: string;
  theoretical_value: number;
  experiment_id?: string;
}

export interface InterpretResult {
  deviation_percent: number;
  severity: ResultSeverity;
  diagnosis: string;
  improvement: string;
  learning_point: string;
}

// ─── Sessions ───────────────────────────────────────────────────────

export type SessionStatus = "active" | "completed" | "safety_alert";
export type StepState = "pending" | "completed" | "skipped";

export interface StepRecord {
  step_number: number;
  state: StepState;
  flagged: boolean; // unreliable because a dependency was skipped
  vision_attempts: number;
  vision_reading: number | null;
  vision_pass: boolean | null;
  manual_override: { value: number | null; note: string } | null;
  completed_at: string | null;
}

export interface SafetyLogEntry {
  step_number: number;
  alerts: SafetyConflict[];
  at: string;
}

export interface SessionSummary {
  session_id: string;
  student_name: string;
  experiment_id: string;
  experiment_name: string;
  current_step: number;
  total_steps: number;
  status: SessionStatus;
  last_vision_pass: boolean | null;
  deviation_percent: number | null;
  safety_alert_count: number;
  flagged_step_count: number;
  override_count: number;
  updated_at: string;
}

export interface SessionDetail extends SessionSummary {
  steps: StepRecord[];
  safety_log: SafetyLogEntry[];
}

export type SessionAction =
  | { type: "complete_step"; step_number: number }
  | { type: "skip_step"; step_number: number }
  | { type: "manual_override"; step_number: number; value: number | null; note: string }
  | { type: "set_student_name"; name: string };

// ─── Agent ──────────────────────────────────────────────────────────

export type AgentEventType = "plan" | "tool_call" | "tool_result" | "delta" | "done" | "error";

export interface AgentEvent {
  type: AgentEventType;
  /** plan: the reasoning text · tool_call/result: summaries · delta: answer chunk */
  text?: string;
  tool?: string;
  data?: unknown;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** The agent's visible reasoning trail for this answer. */
  trace?: { tool: string; summary: string }[];
  at: string;
}

export interface AgentChatRequest {
  session_id?: string;
  experiment_id?: string;
  current_step?: number;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
}

/** A logged agent decision, shown in the instructor Agent Console. */
export interface AgentDecision {
  id: string;
  session_id: string;
  trigger: string; // what the agent was asked / reacted to
  plan: string;
  tools: { tool: string; input: string; output: string }[];
  outcome: string;
  provider: string;
  latency_ms: number;
  at: string;
}

// ─── Observability ──────────────────────────────────────────────────

export interface TraceSpan {
  tool_name: string;
  input_summary: string;
  output_summary: string;
  latency_ms: number;
  confidence: number | null;
  timestamp: string;
}

// ─── Session codes & instructor sessions ────────────────────────────

export interface InstructorSession {
  code: string;          // short join code e.g. "LAB-4729"
  session_name: string;
  experiment_id: string;
  experiment_name: string;
  batch: string;
  department: string;
  date: string;
  created_at: string;
  student_session_ids: string[];
  require_verification?: boolean;
}

// ─── Verification queue ─────────────────────────────────────────────

export type VerificationStatus = "pending" | "approved" | "rejected";

export interface VerificationEntry {
  id: string;
  session_id: string;
  student_name: string;
  step_number: number;
  image_base64: string;
  ai_reading: number | null;
  ai_confidence: number;
  ai_message: string;
  submitted_at: string;
  status: VerificationStatus;
  instructor_comment: string | null;
  resolved_at: string | null;
}

// ─── Learning summary & badges ──────────────────────────────────────

export interface Badge {
  id: string;
  label: string;
  description: string;
  icon: string; // emoji
  earned: boolean;
}

export interface LearningSummary {
  session_id: string;
  experiment_name: string;
  performance_score: number;     // 0–100
  accuracy_score: number;        // 0–100
  steps_completed: number;
  steps_total: number;
  skipped_steps: number;
  safety_alerts: number;
  overrides: number;
  mistakes: string[];
  concepts_learned: string[];
  improvement_suggestions: string[];
  badges: Badge[];
}

// ─── Lab report ─────────────────────────────────────────────────────

export interface LabReport {
  session_id: string;
  student_name: string;
  experiment_name: string;
  date: string;
  aim: string;
  apparatus: string[];
  procedure: string[];
  observations: { step: number; observation: string; reading?: number | null }[];
  calculations: string;
  result: string;
  deviation_percent: number | null;
  mistakes: string[];
  instructor_remarks: string;
  performance_score: number;
}
