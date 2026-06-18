/**
 * Safety tool (Feature 3) — reagent conflict + concentration detection.
 *
 * Pure rule engine (deterministic, no LLM). Compares the step's new reagents
 * against the full session reagent history using reagent-safety.ts, and flags
 * concentration thresholds. This is the "guardian" feature.
 */
import "server-only";
import type { Reagent, SafetyConflict, SafetyResult, Severity } from "@/lib/types";
import {
  CONCENTRATION_WARNINGS,
  CONFLICTS,
  type ConflictRule,
} from "@/server/data/reagent-safety";

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

const norm = (s: string) => s.trim().toLowerCase();

function parseMolarity(concentration?: string | null): number | null {
  if (!concentration) return null;
  const m = concentration.match(/([\d.]+)\s*M/i);
  return m ? Number.parseFloat(m[1]) : null;
}

export function checkSafety(reagents: Reagent[], history: Reagent[]): SafetyResult {
  const currentNames = new Set(reagents.map((r) => norm(r.name)));
  const allNames = new Set<string>([...currentNames, ...history.map((r) => norm(r.name))]);

  const alerts: SafetyConflict[] = [];

  // Pairwise conflicts — only raise when a *new* reagent introduces the pair.
  for (const rule of CONFLICTS) {
    const [a, b] = rule.reagents.map(norm);
    const bothPresent = allNames.has(a) && allNames.has(b);
    const isNew = currentNames.has(a) || currentNames.has(b);
    if (bothPresent && isNew) {
      alerts.push(toConflict(rule));
    }
  }

  // Concentration thresholds on the new reagents.
  for (const r of reagents) {
    const molarity = parseMolarity(r.concentration);
    if (molarity == null) continue;
    for (const w of CONCENTRATION_WARNINGS) {
      if (norm(w.reagent) === norm(r.name) && molarity > w.threshold_molarity) {
        alerts.push({
          reagents: [r.name],
          type: "Concentration Hazard",
          severity: w.severity,
          description: w.message,
          action: "Confirm you need this concentration; use the fume hood and full PPE.",
        });
      }
    }
  }

  alerts.sort((x, y) => SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity]);
  return { conflict: alerts.length > 0, alerts };
}

function toConflict(rule: ConflictRule): SafetyConflict {
  return {
    reagents: [...rule.reagents],
    type: rule.type,
    severity: rule.severity,
    description: rule.description,
    action: rule.action,
  };
}
