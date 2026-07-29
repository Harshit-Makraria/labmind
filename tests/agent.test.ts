import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@/lib/types";
import { runAgentStream } from "@/server/agent/orchestrator";
import { toolByName } from "@/server/agent/tools";

async function collect(message: string, ctx: { experiment_id?: string; current_step?: number } = {}) {
  const events: AgentEvent[] = [];
  await runAgentStream({ message, history: [], ...ctx }, (e) => events.push(e));
  return events;
}

describe("agent orchestrator (demo loop runs real tools)", () => {
  it("routes a safety question to check_safety and answers", async () => {
    const events = await collect("Is it safe to mix HCl and NaOH right now?", { experiment_id: "acid-base-titration" });
    const calls = events.filter((e) => e.type === "tool_call").map((e) => e.tool);
    expect(calls).toContain("check_safety");
    expect(events.some((e) => e.type === "plan")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
    const answer = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
    expect(answer.toLowerCase()).toMatch(/medium|caution/);
  });

  it("routes a calculation question to the titration calculator", async () => {
    const events = await collect("calculate my concentration if the titre was 24.6 mL", {
      experiment_id: "acid-base-titration",
    });
    expect(events.filter((e) => e.type === "tool_call").map((e) => e.tool)).toContain("titration_concentration");
  });

  it("routes a library question to search_library", async () => {
    const events = await collect("what experiments can I run?");
    expect(events.filter((e) => e.type === "tool_call").map((e) => e.tool)).toContain("search_library");
  });

  it("chains a SECOND tool call from the first one's real output for a high-severity conflict", async () => {
    // KMnO4 + H2O2 is a real "high" severity pair in reagent-safety.ts — the
    // demo planner should not just call check_safety and stop; it should
    // read that result and escalate to notify_instructor on its own.
    const events = await collect("Is it safe to mix KMnO4 and H2O2?", { experiment_id: "acid-base-titration" });
    const calls = events.filter((e) => e.type === "tool_call").map((e) => e.tool);
    expect(calls).toEqual(["check_safety", "notify_instructor"]);
    const plans = events.filter((e) => e.type === "plan").map((e) => e.text);
    expect(plans.length).toBeGreaterThanOrEqual(2); // one plan for the primary call, one for the follow-up
    const answer = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
    expect(answer.toLowerCase()).toMatch(/notified/);
  });

  it("does NOT chain a follow-up for a low/medium-severity conflict", async () => {
    const events = await collect("Is it safe to mix HCl and NaOH?", { experiment_id: "acid-base-titration" });
    const calls = events.filter((e) => e.type === "tool_call").map((e) => e.tool);
    expect(calls).toEqual(["check_safety"]);
  });
});

describe("agent tools compute correctly", () => {
  it("titration_concentration: (0.1 × 24.6)/25 ≈ 0.0984", () => {
    const out = toolByName("titration_concentration")!.run({ titre_volume_ml: 24.6 }, {}) as {
      concentration_mol_per_L: number;
    };
    expect(out.concentration_mol_per_L).toBeCloseTo(0.0984, 3);
  });

  it("reaction_rate: 1/40 = 0.025", () => {
    const out = toolByName("reaction_rate")!.run({ time_seconds: 40 }, {}) as { rate_per_second: number };
    expect(out.rate_per_second).toBe(0.025);
  });

  it("flag_downstream_steps returns affected steps for titration step 1", () => {
    const out = toolByName("flag_downstream_steps")!.run({ step_number: 1 }, { experimentId: "acid-base-titration" }) as {
      unreliable_steps: number[];
    };
    expect(out.unreliable_steps.length).toBeGreaterThan(0);
  });
});
