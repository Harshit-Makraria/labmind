/**
 * LabMind canonical types.
 * Shared by the React client and the Next.js Route Handlers (the "backend").
 */

// ─── Protocol & experiments ─────────────────────────────────────────

/**
 * How a step's photo evidence is judged.
 *
 * The first four are hand-tuned readers for specific instruments — they get
 * bespoke prompts and deterministic physics validation (a burette has no
 * graduation at 24.37 mL, so no honest reading can produce one).
 *
 * "descriptive" is the universal one. The instructor writes, in plain language,
 * what the photo must show, and the model is judged against that description
 * instead of against a hardcoded instrument. This is what lets a physics
 * ammeter, a vernier caliper, a microscope field, a breadboard circuit or a
 * terminal screenshot be verified without anyone writing a new prompt for each
 * one — previously anything outside the four types below simply could not be
 * checked at all.
 */
export type VisionCheckType = "burette_reading" | "colour_change" | "gel_band" | "absorbance" | "descriptive";

export interface Reagent {
  name: string;
  concentration?: string;
  volume_ml?: number | null;
}

export interface VisionExpected {
  type: VisionCheckType;
  expected_value: number | null;
  tolerance: number;
  /**
   * "descriptive" checks only — the instructor's plain-language statement of
   * what must be visible in the photo. This replaces a hardcoded instrument
   * prompt, so any subject works without new code.
   */
  description?: string;
  /** Criteria that must ALL be present for the step to pass. */
  must_show?: string[];
  /** Criteria whose presence FAILS the step (a common mistake made visible). */
  must_not_show?: string[];
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

/**
 * What kind of answer an experiment actually produces.
 *
 * Not every lab ends in a number. A titration does ("0.1 mol/L"), but a
 * microscopy practical ends in a category ("cardiac muscle"), a circuit test
 * ends in a yes/no, and a programming lab ends in a description of what the
 * output showed. Grading all four as "percent deviation from a float" is why
 * anything that wasn't a chemistry measurement couldn't be graded at all.
 */
export type ResultKind = "numeric" | "categorical" | "boolean" | "qualitative" | "none";

export interface ExpectedResult {
  kind: ResultKind;
  /** What the student is measuring/identifying — "HCl concentration", "Tissue type". */
  label: string;
  /** numeric only — the target value. */
  value?: number | null;
  unit?: string | null;
  /** numeric only — absolute tolerance in `unit`, when the protocol states one. */
  tolerance?: number | null;
  /** categorical only — the choices offered to the student. */
  options?: string[];
  /** categorical/boolean/qualitative — the answer key. */
  correct?: string | string[] | boolean | null;
  /** qualitative only — how a free-text answer should be judged. */
  rubric?: string | null;
}

export interface Protocol {
  experiment_name: string;
  steps: ProtocolStep[];
  /**
   * The experiment's OWN expected result. Present on AI-parsed and manually
   * built protocols; absent on the built-in library protocols, which carry it
   * on `Experiment.theoretical` instead (resolveExpectedResult() bridges the
   * two). Without this, a custom uploaded experiment had no expected value of
   * its own and was graded against whatever library experiment it was filed
   * under — so every deviation figure for a custom experiment was wrong.
   */
  expected_result?: ExpectedResult | null;
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
  /** The experiment's real scientific objective, when known — null when a genuinely custom PDF was parsed into a different protocol than any library experiment. */
  description: string | null;
  /** True only when the server actually structured an uploaded PDF into this protocol — false whenever it fell back to the library experiment (no PDF, no key, scan with no text layer, parse failure). */
  parsed_from_pdf: boolean;
  /** Human-readable reason a PDF upload fell back to the library experiment — null when no PDF was uploaded or it parsed successfully. */
  fallback_reason: string | null;
}

// ─── Vision verification ────────────────────────────────────────────

export interface VisionCheckRequest {
  session_id: string;
  step_number: number;
  image_base64: string;
  expected: VisionExpected;
  experiment_id?: string;
  /**
   * Steps already recorded for this session. Server-populated (never sent by
   * the client) so the physical-constraint layer can check this reading against
   * the student's own earlier ones — monotonicity, plausible titre, concordance.
   */
  priorSteps?: StepRecord[];
}

/** Confidence thresholds for verification routing. */
export const VISION_HIGH_CONFIDENCE = 0.82;  // above → auto-verify
export const VISION_LOW_CONFIDENCE  = 0.40;  // below → ask student to retake

export type VisionVerificationStatus =
  | "auto_verified"   // confidence >= 0.82 + pass — step completes immediately
  | "needs_review"    // confidence 0.40–0.82 — queued for instructor, student continues
  | "retake"          // confidence < 0.40 — image too poor, ask student to retake
  | "failed";         // pass=false (good image) — retry or manual override after 2×

/**
 * One stage of the verification pipeline, surfaced to the student instead of
 * staying server-side log output. Turns "the AI said no" into an itemised,
 * inspectable breakdown of what was actually checked and why it did or
 * didn't pass — every field here reflects a real check that ran, not
 * decorative copy.
 */
export interface VisionCheckStep {
  label: string;
  passed: boolean;
  detail: string;
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
  /** Routing decision based on confidence threshold. */
  verification_status: VisionVerificationStatus;
  /**
   * The confidence bar this specific student had to clear to auto-verify —
   * adapts to their record (0.78–0.94), not a fixed global constant. Lets the
   * UI draw the marker at the bar the student actually had to clear.
   */
  verification_threshold: number;
  /** Itemised pipeline breakdown — see VisionCheckStep. Optional only for
   * backward compatibility with any caller that predates this field. */
  checks?: VisionCheckStep[];
  /**
   * The instrument bounding box the two-pass zoom-and-crop stage actually
   * located, as fractions (0-1) of the ORIGINAL uploaded photo's width/height
   * — not the cropped image. Lets the UI draw "here's exactly where LabMind
   * looked" directly on the student's own photo. Null when cropping was
   * skipped or the model couldn't localise the instrument.
   */
  located_region?: { x0: number; y0: number; x1: number; y1: number } | null;
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
  /**
   * Numeric result. Kept required-ish for backwards compatibility with the
   * existing numeric flow; non-numeric experiments send `student_answer`
   * instead and leave this at 0.
   */
  student_result: number;
  /** Non-numeric result — the selected option, the boolean, or the free text. */
  student_answer?: string | boolean | null;
  unit: string;
  theoretical_value: number;
  experiment_id?: string;
}

export interface InterpretResult {
  /**
   * Percent deviation from the expected value. null for non-numeric results,
   * where "how far off" isn't a meaningful question — those report `correct`
   * instead.
   */
  deviation_percent: number | null;
  /** Non-numeric grading outcome. null for numeric results. */
  correct?: boolean | null;
  /** Which kind of grading actually ran, so the client renders the right thing. */
  result_kind?: ResultKind;
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
  /** Set for a session joined via an instructor code, null for solo/library use. */
  instructor_code: string | null;
  /** A student-initiated skip awaiting instructor approval — null once approved (step becomes "skipped"), denied, or after seconds_remaining hits 0. */
  skip_request: { step_number: number; requested_at: string; seconds_remaining: number } | null;
}

export interface SkipRequestSummary {
  session_id: string;
  student_name: string;
  step_number: number;
  requested_at: string;
  seconds_remaining: number;
}

// ─── Profile ────────────────────────────────────────────────────────

export interface ProfileData {
  id: string;
  name: string | null;
  email: string;
  role: "instructor" | "student";
  created_at: string;
  instructor_stats?: {
    classes_created: number;
    total_students: number;
    verifications_resolved: number;
    agreement: number | null;
  };
  student_stats?: {
    experiments_started: number;
    experiments_completed: number;
    accurate_count: number;
    avg_deviation: number | null;
  };
}

export type SessionAction =
  | { type: "complete_step"; step_number: number }
  /** Solo/library sessions only (no instructorCode) — skips instantly. */
  | { type: "skip_step"; step_number: number }
  /** Instructor-led sessions — queues a request instead of skipping immediately. */
  | { type: "request_skip"; step_number: number }
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
  status?: string;
  institution?: string;
  course_code?: string;
  created_by_user_id?: string | null;
}

// ─── Verification queue ─────────────────────────────────────────────

/**
 * Lifecycle of one submitted photo.
 *
 * Only "pending" is an instructor TASK — it is what the verification queue and
 * its badge count are built on. The rest are outcomes kept as evidence, so a
 * step that passed (or failed, or was too blurry to read) still has its photo
 * on record. Before these existed, only queued photos were saved at all and
 * every auto-verified capture was discarded after analysis.
 */
export type VerificationStatus =
  | "pending"        // needs instructor review — appears in the queue
  | "approved"       // instructor approved it
  | "rejected"       // instructor rejected it
  | "auto_verified"  // passed automatically, no review needed
  | "failed"         // clear image, but didn't show what the step required
  | "retake";        // image quality too low to judge

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
  /** Unit for ai_reading (mL / bp / AU), derived from the step's vision_expected.type. Optional — absent for entries built outside listVerifications(). */
  unit?: string;
}

// ─── Measured vision accuracy ───────────────────────────────────────
// Derived from instructor approve/reject decisions — ground truth, not a claim.

export interface AccuracyBucket {
  label: string;
  total: number;
  approved: number;
  rejected: number;
  /** Share of resolved items the instructor agreed with, 0–1. */
  agreement: number | null;
}

export interface AccuracyReport {
  resolved: number;
  pending: number;
  approved: number;
  rejected: number;
  agreement: number | null;
  byConfidence: AccuracyBucket[];
  /** High-confidence readings the instructor still rejected — the costly failures. */
  confidentMisses: number;
  generatedAt: string;
}

// ─── Pacing / integrity ─────────────────────────────────────────────

export type PacingFlag = "impossibly_fast" | "no_dwell" | "suspicious_uniformity";

export interface StepPacing {
  step_number: number;
  title: string;
  elapsed_seconds: number | null;
  expected_seconds: number | null;
  flag: PacingFlag | null;
  reason: string | null;
}

export interface PacingReport {
  steps: StepPacing[];
  total_seconds: number | null;
  expected_total_seconds: number;
  flagged_count: number;
  /** null until enough steps are completed to judge — no data is not a pass. */
  integrity_score: number | null;
  verdict: "no_data" | "consistent" | "review_recommended" | "implausible";
  summary: string;
}

// ─── Risk / adaptive supervision ────────────────────────────────────

export interface RiskFactor {
  code: string;
  label: string;
  weight: number;
}

export interface RiskAssessment {
  session_id: string;
  student_name: string;
  score: number;
  band: "low" | "moderate" | "elevated" | "high";
  factors: RiskFactor[];
  verification_threshold: number;
  recommendation: string;
  pacing_verdict: PacingReport["verdict"];
  integrity_score: number | null;
  current_step: number;
  total_steps: number;
}

// ─── Tamper-evident audit chain ─────────────────────────────────────

export interface ChainedEvent {
  index: number;
  at: string;
  step_number: number;
  summary: string;
  severity: string;
  prev_hash: string;
  hash: string;
}

export interface ChainVerification {
  intact: boolean;
  verified_count: number;
  broken_at: number | null;
  message: string;
}

// ─── Student history ────────────────────────────────────────────────

export interface HistoryEntry {
  session_id: string;
  experiment_id: string;
  experiment_name: string;
  status: SessionStatus;
  current_step: number;
  total_steps: number;
  steps_completed: number;
  deviation_percent: number | null;
  prelab_score: number | null;
  safety_alert_count: number;
  override_count: number;
  started_at: string;
  updated_at: string;
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
  /** The student's own pre-experiment prediction, null if they skipped it. */
  hypothesis: string | null;
  /** Plain-language verdict comparing that prediction to the measured
   * result — null whenever there's no hypothesis or no result yet to judge it against. */
  hypothesis_verdict: string | null;
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

// ─── Instructor analytics & student records ──────────────────────────
//
// Shared (not server-only) because the instructor console renders them
// directly. The server module that builds them imports these same types.

export interface StepAnalytics {
  step_number: number;
  title: string;
  reached: number;
  completed: number;
  skipped: number;
  in_progress: number;
  photo_attempts: number;
  photo_passed: number;
  photo_failed: number;
  manual_overrides: number;
  median_seconds: number | null;
  max_attempts: number;
}

export interface SessionAnalytics {
  code: string;
  session_name: string;
  experiment_name: string;
  generated_at: string;

  students_joined: number;
  students_active: number;
  students_completed: number;
  students_not_started: number;
  completion_rate: number | null;

  avg_progress_percent: number;
  total_steps: number;

  results_recorded: number;
  avg_deviation: number | null;
  median_deviation: number | null;
  within_5_percent: number;
  within_10_percent: number;

  photos_submitted: number;
  photos_auto_verified: number;
  photos_pending_review: number;
  photos_approved: number;
  photos_rejected: number;

  safety_alerts: number;
  manual_overrides: number;
  skipped_steps: number;
  duplicate_photos: number;
  pacing_flags: number;

  prelab_taken: number;
  prelab_passed: number;
  avg_prelab_score: number | null;

  steps: StepAnalytics[];
  hardest_steps: { step_number: number; title: string; reason: string }[];
}

export interface StudentPhoto {
  id: string;
  step_number: number;
  step_title: string;
  status: string;
  ai_reading: number | null;
  ai_confidence: number;
  ai_message: string | null;
  instructor_comment: string | null;
  submitted_at: string;
  resolved_at: string | null;
  has_image: boolean;
}

export interface StudentRecordStep extends StepRecord {
  title: string;
  expected_observation: string;
  elapsed_seconds: number | null;
  pacing_flag: string | null;
}

export interface StudentRecord {
  session_id: string;
  student_name: string;
  experiment_id: string;
  experiment_name: string;
  status: string;
  current_step: number;
  total_steps: number;
  started_at: string;
  updated_at: string;

  hypothesis: string | null;
  prelab_score: number | null;
  prelab_passed: boolean | null;

  student_result: number | null;
  deviation_percent: number | null;

  safety_alert_count: number;
  duplicate_photo_count: number;

  steps: StudentRecordStep[];
  safety_log: SafetyLogEntry[];
  notes: string[];
  photos: StudentPhoto[];
  audit: { step_number: number; summary: string; severity: string; at: string }[];
}
