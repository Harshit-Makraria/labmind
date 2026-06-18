"use client";

import { motion } from "framer-motion";
import { AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SafetyConflict, Severity } from "@/lib/types";

const RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

const THEME: Record<Severity, { bar: string; chip: string; icon: typeof ShieldAlert; label: string }> = {
  high: { bar: "var(--color-danger)", chip: "bg-[var(--color-danger)]", icon: ShieldAlert, label: "STOP — High Risk" },
  medium: { bar: "var(--color-warning)", chip: "bg-[var(--color-warning)]", icon: AlertTriangle, label: "Caution" },
  low: { bar: "var(--color-brand)", chip: "bg-[var(--color-brand)]", icon: ShieldCheck, label: "Heads up" },
};

export function SafetyModal({
  alerts,
  onProceed,
  onStop,
}: {
  alerts: SafetyConflict[];
  onProceed: () => void;
  onStop: () => void;
}) {
  const highest = alerts.reduce<Severity>(
    (acc, a) => (RANK[a.severity] > RANK[acc] ? a.severity : acc),
    "low",
  );
  const theme = THEME[highest];
  const Icon = theme.icon;
  const isHigh = highest === "high";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        className="w-full max-w-md overflow-hidden rounded-[var(--radius-card)] bg-white shadow-2xl"
      >
        <div className="flex items-center gap-3 px-5 py-4 text-white" style={{ backgroundColor: theme.bar }}>
          <Icon size={26} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-90">Safety Check</p>
            <h2 className="text-lg font-bold leading-tight">{theme.label}</h2>
          </div>
        </div>

        <div className="max-h-[55dvh] space-y-3 overflow-y-auto p-5">
          {alerts.map((a, i) => (
            <div key={i} className="rounded-[var(--radius-btn)] border border-black/10 p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase text-white ${THEME[a.severity].chip}`}>
                  {a.severity}
                </span>
                <span className="text-sm font-semibold text-[var(--color-navy)]">{a.type}</span>
              </div>
              <p className="text-sm text-[var(--color-navy)]/80">{a.description}</p>
              <p className="mt-2 flex flex-wrap gap-1 text-xs">
                {a.reagents.map((r) => (
                  <span key={r} className="rounded bg-black/5 px-1.5 py-0.5 font-mono">{r}</span>
                ))}
              </p>
              <p className="mt-2 text-sm font-semibold text-[var(--color-navy)]">→ {a.action}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-black/10 p-4">
          <Button onClick={onProceed} variant={isHigh ? "danger" : "primary"}>
            {isHigh ? "I understand the risk — proceed" : "Got it — continue"}
          </Button>
          {isHigh && (
            <button onClick={onStop} className="text-sm font-semibold text-[var(--color-danger)] underline-offset-2 hover:underline">
              Stop &amp; get the instructor
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
