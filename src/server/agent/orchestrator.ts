/**
 * LabMind agent orchestrator.
 *
 * A genuine agent loop: receive a message + context, decide which tools to call,
 * execute them (possibly several, chained), then answer. Two engines behind one
 * interface:
 *   • real LLM (gemini/openai/azure/claude) → function-calling loop
 *   • demo (key-free) → deterministic intent planner that runs the SAME tools
 * Both stream the same events (plan → tool_call → tool_result → delta → done)
 * and log an AgentDecision for the instructor's Agent Console.
 */
import "server-only";
import type { AgentChatRequest, AgentEvent, AgentDecision } from "@/lib/types";
import { effectiveDemo, providerLabel } from "@/server/config";
import { completeWithTools } from "@/server/llm/provider";
import { getExperiment } from "@/server/experiments";
import { logAgentDecision } from "@/server/store/session-store";
import { TOOLS, toolByName, toolSchemas, type ToolContext } from "./tools";

type Emit = (e: AgentEvent) => void;

const MAX_ITERS = 5;

function systemPrompt(ctx: ToolContext): string {
  const exp = getExperiment(ctx.experimentId);
  const step = exp.protocol.steps.find((s) => s.step_number === (ctx.currentStep ?? 0));
  return [
    "You are LabMind, an expert, safety-first AI lab partner for physical science experiments.",
    `The student is running: ${exp.name} (${exp.domain}). Expected result: ${exp.theoretical.label} ≈ ${exp.theoretical.value} ${exp.theoretical.unit}.`,
    step ? `They are on step ${step.step_number}: ${step.title}.` : "",
    "Use the provided tools to ground every answer in real data — never guess about safety. Prefer check_safety/lookup_reagent for any 'is it safe' question, the calculators for any computation, and interpret_result to grade outcomes.",
    "Be concise, encouraging, and specific. Always foreground safety. You augment, never replace, the instructor.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Public entry ───────────────────────────────────────────────────

export async function runAgentStream(req: AgentChatRequest, emit: Emit): Promise<void> {
  const ctx: ToolContext = {
    sessionId: req.session_id,
    experimentId: req.experiment_id,
    currentStep: req.current_step,
  };
  const t0 = Date.now();
  const toolsUsed: AgentDecision["tools"] = [];
  let plan = "";
  let answer = "";

  try {
    if (effectiveDemo()) {
      ({ plan, answer } = await runDemo(req, ctx, emit, toolsUsed));
    } else {
      ({ plan, answer } = await runLlm(req, ctx, emit, toolsUsed));
    }
  } catch (err) {
    const msg = (err as Error).message || "agent error";
    emit({ type: "error", text: msg });
    answer = "I hit an error reaching the model, so here's safe general guidance: re-read the current step, and do not combine reagents you're unsure about — ask your instructor.";
    streamText(answer, emit);
  }

  emit({ type: "done", text: answer });

  logAgentDecision({
    id: crypto.randomUUID(),
    session_id: req.session_id ?? "anon",
    trigger: req.message,
    plan,
    tools: toolsUsed,
    outcome: answer.slice(0, 240),
    provider: providerLabel(),
    latency_ms: Date.now() - t0,
    at: new Date().toISOString(),
  });
}

// ─── Real LLM loop ──────────────────────────────────────────────────

async function runLlm(req: AgentChatRequest, ctx: ToolContext, emit: Emit, used: AgentDecision["tools"]) {
  const system = systemPrompt(ctx);
  const messages: { role: "user" | "assistant" | "tool"; content: string; toolName?: string }[] = [
    ...req.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: req.message },
  ];
  emit({ type: "plan", text: "Deciding which tools to use…" });

  let answer = "";
  for (let i = 0; i < MAX_ITERS; i++) {
    const turn = await completeWithTools(system, messages, toolSchemas());
    if (turn.toolCalls.length === 0) {
      answer = turn.text || "Done.";
      break;
    }
    for (const call of turn.toolCalls) {
      emit({ type: "tool_call", tool: call.name, text: summarizeArgs(call.args) });
      const tool = toolByName(call.name);
      const out = tool ? tool.run(call.args, ctx) : { error: "unknown tool" };
      const outStr = JSON.stringify(out);
      emit({ type: "tool_result", tool: call.name, text: truncate(outStr, 200), data: out });
      used.push({ tool: call.name, input: summarizeArgs(call.args), output: truncate(outStr, 200) });
      messages.push({ role: "assistant", content: `calling ${call.name}` });
      messages.push({ role: "tool", content: outStr, toolName: call.name });
    }
  }
  if (!answer) answer = "I gathered the data above — check the tool results.";
  streamText(answer, emit);
  return { plan: "LLM tool-calling loop", answer };
}

// ─── Deterministic demo planner (same tools, real execution) ────────

async function runDemo(req: AgentChatRequest, ctx: ToolContext, emit: Emit, used: AgentDecision["tools"]) {
  const msg = req.message.toLowerCase();
  const exp = getExperiment(ctx.experimentId);
  const nums = (req.message.match(/[-+]?\d*\.?\d+/g) ?? []).map(Number).filter((n) => !Number.isNaN(n));
  const reagents = extractReagents(req.message);

  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  let intent = "general";

  if (/(safe|mix|combine|danger|conflict|hazard|can i add|react)/.test(msg) && reagents.length >= 2) {
    intent = "safety"; calls.push({ tool: "check_safety", args: { reagents } });
  } else if (reagents.length === 1 && /(safe|hazard|about|handle|store|danger)/.test(msg)) {
    intent = "reagent"; calls.push({ tool: "lookup_reagent", args: { reagent: reagents[0] } });
  } else if (/(concentration|molarity|titre|calculate.*conc|c\(hcl\))/.test(msg)) {
    intent = "titration"; calls.push({ tool: "titration_concentration", args: { titre_volume_ml: nums[0] ?? 24.5 } });
  } else if (/(rate|1\/t|per second|clock)/.test(msg) && exp.domain === "kinetics") {
    intent = "rate"; calls.push({ tool: "reaction_rate", args: { time_seconds: nums[0] ?? 40 } });
  } else if (/(deviation|off|wrong|error|interpret|how did i do|grade|result)/.test(msg) && nums.length) {
    intent = "interpret";
    calls.push({ tool: "interpret_result", args: { measured: nums[0], expected: nums[1] ?? exp.theoretical.value, unit: exp.theoretical.unit } });
  } else if (/(skip|missed|forgot|didn'?t do)/.test(msg) && nums.length) {
    intent = "downstream"; calls.push({ tool: "flag_downstream_steps", args: { step_number: nums[0] } });
  } else if (/(experiment|library|what can|list|other lab|try)/.test(msg)) {
    intent = "library"; calls.push({ tool: "search_library", args: { query: "" } });
  } else if (/(status|progress|where am i|how far)/.test(msg)) {
    intent = "status"; calls.push({ tool: "get_session_state", args: {} });
  } else {
    intent = "step"; calls.push({ tool: "get_protocol_step", args: { step_number: ctx.currentStep } });
  }

  emit({ type: "plan", text: planText(intent, reagents, nums) });

  const results: Record<string, unknown>[] = [];
  for (const c of calls) {
    emit({ type: "tool_call", tool: c.tool, text: summarizeArgs(c.args) });
    const tool = toolByName(c.tool)!;
    const out = tool.run(c.args, ctx) as Record<string, unknown>;
    const outStr = JSON.stringify(out);
    emit({ type: "tool_result", tool: c.tool, text: truncate(outStr, 200), data: out });
    used.push({ tool: c.tool, input: summarizeArgs(c.args), output: truncate(outStr, 200) });
    results.push(out);
  }

  const answer = composeAnswer(intent, results, exp, reagents);
  streamText(answer, emit);
  return { plan: planText(intent, reagents, nums), answer };
}

// ─── Demo answer composition (grounded in real tool output) ─────────

function composeAnswer(
  intent: string,
  results: Record<string, unknown>[],
  exp: ReturnType<typeof getExperiment>,
  reagents: string[],
): string {
  const r = results[0] ?? {};
  switch (intent) {
    case "safety": {
      const alerts = (r.alerts as { severity: string; type: string; action: string }[]) ?? [];
      if (r.safe) return `Combining ${reagents.join(" + ")} is OK in this context — no conflicts in the safety database. Still add slowly and keep your goggles on.`;
      const top = alerts[0];
      return `⚠️ Caution: ${reagents.join(" + ")} is flagged as **${top.severity}** (${top.type}). ${top.action} I've logged this on the safety record.`;
    }
    case "reagent": {
      const conflicts = (r.known_conflicts as { with: string; severity: string }[]) ?? [];
      const warns = (r.concentration_warnings as string[]) ?? [];
      const parts = [`Here's what I know about ${r.reagent}:`];
      if (conflicts.length) parts.push(`Avoid combining with: ${conflicts.map((c) => `${c.with} (${c.severity})`).join(", ")}.`);
      if (warns.length) parts.push(warns.join(" "));
      if (conflicts.length === 0 && warns.length === 0) parts.push("No specific conflicts on record — handle with standard PPE.");
      return parts.join(" ");
    }
    case "titration":
      return `Using C = (M·V_titre)/V_analyte, your HCl concentration is **${(r.concentration_mol_per_L as number)} mol/L**. Compare that to the expected ${exp.theoretical.value} ${exp.theoretical.unit} — if it's off, suspect a meniscus reading or an overshot endpoint.`;
    case "rate":
      return `Rate = 1/time = **${r.rate_per_second} s⁻¹**. A faster colour change means a higher rate — temperature and concentration both push it up.`;
    case "interpret": {
      return `You're **${r.deviation_percent}% off** (${r.severity}). ${r.diagnosis} ${r.improvement}`;
    }
    case "downstream": {
      const steps = (r.unreliable_steps as number[]) ?? [];
      if (!steps.length) return `Step ${r.skipped_step} doesn't have downstream dependencies — you can recover by completing it now.`;
      return `Because step ${r.skipped_step} was skipped, steps ${steps.join(", ")} may now be unreliable — I've flagged them. Redo step ${r.skipped_step} before trusting those results.`;
    }
    case "library": {
      const list = (results[0] as unknown as { id: string; name: string; domain: string }[]) ?? [];
      const arr = Array.isArray(results[0]) ? (results[0] as unknown as { name: string; domain: string }[]) : list;
      return `The library has: ${arr.map((e) => `${e.name} (${e.domain})`).join(", ")}. Tell me which one and I'll set it up.`;
    }
    case "status":
      return `You're on step ${r.current_step}/${r.total_steps} of ${r.experiment} — status ${r.status}. ${r.safety_alerts ? `${r.safety_alerts} safety alert(s) so far. ` : ""}Keep going!`;
    default: {
      const instr = (r.instructions as string[]) ?? [];
      return `Step ${r.step_number} — ${r.title}: ${instr.join("; ")}. ${r.science ? `Why: ${r.science}` : ""}`;
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────────

function planText(intent: string, reagents: string[], nums: number[]): string {
  const map: Record<string, string> = {
    safety: `Safety question about ${reagents.join(" + ")} → I'll run the safety engine against your reagent history.`,
    reagent: `Reagent lookup for ${reagents[0]} → checking the hazard database.`,
    titration: `Concentration calc → I'll run the titration calculator${nums.length ? ` on ${nums[0]} mL` : ""}.`,
    rate: `Rate question → I'll compute 1/time.`,
    interpret: `Result grading → I'll compute deviation and diagnose the likely cause.`,
    downstream: `Skipped-step question → I'll trace which downstream steps become unreliable.`,
    library: `Library request → I'll list available experiments.`,
    status: `Progress request → I'll read your live session state.`,
    step: `Procedure question → I'll fetch the current step details.`,
  };
  return map[intent] ?? map.step;
}

const REAGENT_VOCAB = [
  "HCl", "NaOH", "H2SO4", "HNO3", "H2O2", "KMnO4", "H2O", "NaOCl", "NH3", "K", "Na",
  "glycerol", "acetone", "AgNO3", "BaCl2", "CaC2", "Zn", "NH4NO3", "CuSO4", "Pb(NO3)2",
  "KI", "Na2S2O3", "starch", "agarose", "SYBR Safe", "ethanol", "phenolphthalein",
  "TAE buffer", "DNA ladder", "loading dye", "ethanol", "acetic acid", "CH3COOH", "NaHCO3", "MnO2",
];

function extractReagents(message: string): string[] {
  const found: string[] = [];
  for (const r of REAGENT_VOCAB) {
    const re = new RegExp(`\\b${r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(message) && !found.some((f) => f.toLowerCase() === r.toLowerCase())) found.push(r);
  }
  return found;
}

function summarizeArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("/") : v}`)
    .join(", ") || "—";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function streamText(text: string, emit: Emit) {
  const words = text.split(/(\s+)/);
  for (const w of words) emit({ type: "delta", text: w });
}

export const AGENT_TOOL_NAMES = TOOLS.map((t) => t.name);
