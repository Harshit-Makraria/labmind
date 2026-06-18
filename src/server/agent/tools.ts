/**
 * Agent tool registry.
 *
 * Each tool has a JSON-schema (for real LLM function-calling) AND a server-side
 * `run` implementation. The agent loop — whether driven by a real LLM or the
 * deterministic demo planner — executes these exact tools, so the reasoning
 * trace shown to the jury is genuine in every mode.
 */
import "server-only";
import type { Reagent } from "@/lib/types";
import { getExperiment, listExperiments } from "@/server/experiments";
import { checkSafety } from "@/server/tools/safety";
import { interpret } from "@/server/tools/result-interpreter";
import { CONCENTRATION_WARNINGS, CONFLICTS } from "@/server/data/reagent-safety";
import {
  addInstructorNote,
  flagDownstreamSteps,
  getSession,
} from "@/server/store/session-store";

export interface ToolContext {
  sessionId?: string;
  experimentId?: string;
  currentStep?: number;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => unknown;
}

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : Number.parseFloat(String(v ?? "")) || d);

export const TOOLS: AgentTool[] = [
  {
    name: "get_protocol_step",
    description:
      "Get the full details of a step in the current experiment's protocol (reagents, safety flags, science, expected observation). Use to answer questions about what to do.",
    parameters: {
      type: "object",
      properties: { step_number: { type: "number", description: "1-based step number; omit for current step" } },
    },
    run: (args, ctx) => {
      const exp = getExperiment(ctx.experimentId);
      const n = num(args.step_number, ctx.currentStep ?? 1);
      const step = exp.protocol.steps.find((s) => s.step_number === n) ?? exp.protocol.steps[0];
      return {
        experiment: exp.name,
        step_number: step.step_number,
        title: step.title,
        instructions: step.instructions,
        reagents: step.reagents.map((r) => r.name),
        safety_flags: step.safety_flags,
        science: step.science_explanation,
        expected: step.expected_observation,
      };
    },
  },
  {
    name: "check_safety",
    description:
      "Check whether combining the given reagents (with the reagents already used this session) is safe. Returns conflicts with severity and required action.",
    parameters: {
      type: "object",
      properties: {
        reagents: { type: "array", items: { type: "string" }, description: "Reagent names to check, e.g. ['HCl','NaOH']" },
      },
      required: ["reagents"],
    },
    run: (args, ctx) => {
      const names = Array.isArray(args.reagents) ? (args.reagents as unknown[]).map((x) => String(x)) : [];
      const current: Reagent[] = names.map((name) => ({ name }));
      const history = (ctx.sessionId ? getSession(ctx.sessionId)?.reagentHistory : []) ?? [];
      const res = checkSafety(current, history);
      return {
        safe: !res.conflict,
        alerts: res.alerts.map((a) => ({ reagents: a.reagents, type: a.type, severity: a.severity, action: a.action })),
      };
    },
  },
  {
    name: "lookup_reagent",
    description: "Look up known hazards, conflicts and concentration warnings for a single reagent.",
    parameters: {
      type: "object",
      properties: { reagent: { type: "string", description: "Reagent name or formula, e.g. 'H2SO4'" } },
      required: ["reagent"],
    },
    run: (args) => {
      const name = str(args.reagent).toLowerCase();
      const conflicts = CONFLICTS.filter((c) => c.reagents.some((r) => r.toLowerCase() === name)).map((c) => ({
        with: c.reagents.find((r) => r.toLowerCase() !== name) ?? c.reagents[0],
        type: c.type,
        severity: c.severity,
        action: c.action,
      }));
      const warnings = CONCENTRATION_WARNINGS.filter((w) => w.reagent.toLowerCase() === name).map((w) => w.message);
      return { reagent: args.reagent, known_conflicts: conflicts, concentration_warnings: warnings };
    },
  },
  {
    name: "titration_concentration",
    description:
      "Compute an unknown acid concentration from a titration. C(unknown) = (titrant_molarity × titre_volume_ml) / analyte_volume_ml (1:1 mole ratio).",
    parameters: {
      type: "object",
      properties: {
        titre_volume_ml: { type: "number" },
        titrant_molarity: { type: "number", description: "default 0.1" },
        analyte_volume_ml: { type: "number", description: "default 25" },
      },
      required: ["titre_volume_ml"],
    },
    run: (args) => {
      const titre = num(args.titre_volume_ml);
      const m = num(args.titrant_molarity, 0.1);
      const v = num(args.analyte_volume_ml, 25);
      const c = v > 0 ? (m * titre) / v : 0;
      return { concentration_mol_per_L: Math.round(c * 10000) / 10000, formula: "C = (M·Vtitre)/Vanalyte" };
    },
  },
  {
    name: "reaction_rate",
    description: "Compute reaction rate as 1/time for a clock reaction. Returns rate in s^-1.",
    parameters: {
      type: "object",
      properties: { time_seconds: { type: "number" } },
      required: ["time_seconds"],
    },
    run: (args) => {
      const t = num(args.time_seconds);
      return { rate_per_second: t > 0 ? Math.round((1 / t) * 10000) / 10000 : null };
    },
  },
  {
    name: "interpret_result",
    description:
      "Grade a measured result against the expected value: percent deviation, severity (green/amber/red), likely cause, and how to improve.",
    parameters: {
      type: "object",
      properties: {
        measured: { type: "number" },
        expected: { type: "number" },
        unit: { type: "string" },
      },
      required: ["measured", "expected"],
    },
    run: (args, ctx) => {
      const r = interpret({
        session_id: ctx.sessionId ?? "agent",
        student_result: num(args.measured),
        theoretical_value: num(args.expected),
        unit: str(args.unit, ""),
        experiment_id: ctx.experimentId,
      });
      return { deviation_percent: r.deviation_percent, severity: r.severity, diagnosis: r.diagnosis, improvement: r.improvement };
    },
  },
  {
    name: "flag_downstream_steps",
    description:
      "Given a step that was skipped or failed, return the downstream steps whose results become unreliable (cross-step reasoning).",
    parameters: {
      type: "object",
      properties: { step_number: { type: "number" } },
      required: ["step_number"],
    },
    run: (args, ctx) => {
      const n = num(args.step_number, ctx.currentStep ?? 1);
      const affected = flagDownstreamStepsFor(ctx.experimentId, n);
      if (ctx.sessionId) flagDownstreamSteps(ctx.sessionId, n, affected);
      return { skipped_step: n, unreliable_steps: affected };
    },
  },
  {
    name: "search_library",
    description: "List or search the available lab experiments in the library.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "optional keyword / domain filter" } },
    },
    run: (args) => {
      const q = str(args.query).toLowerCase();
      return listExperiments()
        .filter((e) => !q || `${e.name} ${e.domain} ${e.difficulty}`.toLowerCase().includes(q))
        .map((e) => ({ id: e.id, name: e.name, domain: e.domain, difficulty: e.difficulty, steps: e.step_count }));
    },
  },
  {
    name: "get_session_state",
    description: "Get the current student session status: experiment, current step, vision result, safety alerts, deviation.",
    parameters: { type: "object", properties: {} },
    run: (_args, ctx) => {
      const s = ctx.sessionId ? getSession(ctx.sessionId) : undefined;
      if (!s) return { status: "no active session" };
      return {
        experiment: s.experimentName,
        current_step: s.currentStep,
        total_steps: s.totalSteps,
        status: s.status,
        last_vision_pass: s.lastVisionPass,
        safety_alerts: s.safetyAlertCount,
        deviation_percent: s.deviationPercent,
      };
    },
  },
  {
    name: "notify_instructor",
    description: "Send a note to the instructor's console (e.g. to flag that a student needs help or overrode a check).",
    parameters: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
    run: (args, ctx) => {
      const msg = str(args.message);
      if (ctx.sessionId) addInstructorNote(ctx.sessionId, msg);
      return { delivered: true, message: msg };
    },
  },
];

export function flagDownstreamStepsFor(experimentId: string | undefined, stepNumber: number): number[] {
  const exp = getExperiment(experimentId);
  const step = exp.protocol.steps.find((s) => s.step_number === stepNumber);
  return step?.affects_steps ?? [];
}

export function toolByName(name: string): AgentTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function toolSchemas() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}
