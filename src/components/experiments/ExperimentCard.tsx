"use client";

import { Atom, Clock, Dna, FlaskConical, Layers, Loader2, ShieldAlert, Timer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExperimentDomain, ExperimentMeta } from "@/lib/types";

const DOMAIN: Record<ExperimentDomain, { icon: typeof Atom; tint: string; label: string }> = {
  chemistry: { icon: FlaskConical, tint: "var(--color-brand)", label: "Chemistry" },
  biology: { icon: Dna, tint: "var(--color-accent)", label: "Biology" },
  kinetics: { icon: Timer, tint: "var(--color-warning)", label: "Kinetics" },
};

const HAZARD_TONE = { low: "accent", medium: "warning", high: "danger" } as const;

export function ExperimentCard({
  experiment,
  onStart,
  starting,
}: {
  experiment: ExperimentMeta;
  onStart: () => void;
  starting?: boolean;
}) {
  const d = DOMAIN[experiment.domain];
  const Icon = d.icon;
  return (
    <div className="card flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]">
      <div className="flex items-start justify-between">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl text-white"
          style={{ background: `linear-gradient(135deg, ${d.tint}, ${d.tint}cc)` }}
        >
          <Icon size={22} />
        </div>
        <Badge tone={HAZARD_TONE[experiment.hazard_level]}>
          <ShieldAlert size={12} /> {experiment.hazard_level} hazard
        </Badge>
      </div>

      <div>
        <h3 className="text-lg font-bold leading-tight text-[var(--color-navy)]">{experiment.name}</h3>
        <p className="mt-1 text-sm leading-snug text-[var(--color-muted)]">{experiment.description}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone="navy">{d.label}</Badge>
        <Badge tone="muted">{experiment.difficulty}</Badge>
        <Badge tone="muted">
          <Clock size={12} /> {experiment.duration_minutes} min
        </Badge>
        <Badge tone="muted">
          <Layers size={12} /> {experiment.step_count} steps
        </Badge>
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        Measures <span className="font-semibold text-[var(--color-navy)]">{experiment.theoretical.label}</span> (
        {experiment.theoretical.value} {experiment.theoretical.unit})
      </p>

      <Button onClick={onStart} disabled={starting} size="sm" className="mt-auto">
        {starting ? <Loader2 size={16} className="animate-spin" /> : "Start experiment"}
      </Button>
    </div>
  );
}
