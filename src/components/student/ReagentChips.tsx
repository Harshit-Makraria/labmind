"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { hintFor } from "@/lib/reagent-hints";
import type { Reagent } from "@/lib/types";

const SEVERITY_TONE: Record<string, string> = {
  high: "var(--color-danger)",
  medium: "var(--color-warning)",
  low: "var(--color-brand)",
};

export function ReagentChips({ reagents }: { reagents: Reagent[] }) {
  const [open, setOpen] = useState<Reagent | null>(null);
  if (!reagents.length) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {reagents.map((r, i) => {
          const hint = hintFor(r.name);
          const tone = SEVERITY_TONE[hint.severity];
          return (
            <button
              key={`${r.name}-${i}`}
              onClick={() => setOpen(r)}
              className="flex items-center gap-1.5 rounded-full bg-[var(--color-brand)]/10 px-3 py-1 text-sm font-medium text-[var(--color-brand)] transition-transform active:scale-95"
            >
              {hint.severity !== "low" && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tone }} aria-hidden />
              )}
              {r.name}
              {r.concentration ? ` · ${r.concentration}` : ""}
              {r.volume_ml ? ` · ${r.volume_ml} mL` : ""}
            </button>
          );
        })}
      </div>

      {/* Reagent hazard sheet — slides up from the tapped chip, matching the
          design's bottom-sheet pattern. Tap-to-learn safety info that was
          previously not surfaced anywhere in the student flow. */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(null)}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-xl rounded-t-[1.4rem] bg-[var(--color-card)] p-5 pb-7 shadow-[0_-10px_40px_-14px_rgba(15,41,66,0.35)]"
            >
              <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-black/15" />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-extrabold text-[var(--color-navy)]">
                    {open.name}
                    {open.concentration ? <span className="text-[var(--color-muted)]"> · {open.concentration}</span> : ""}
                  </h3>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs font-semibold">
                    {open.volume_ml && (
                      <span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[var(--color-muted)]">{open.volume_ml} mL</span>
                    )}
                    <span
                      className="flex items-center gap-1 rounded-full px-2.5 py-1"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${SEVERITY_TONE[hintFor(open.name).severity]} 14%, transparent)`,
                        color: SEVERITY_TONE[hintFor(open.name).severity],
                      }}
                    >
                      <AlertTriangle size={11} /> {hintFor(open.name).hazard}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(null)}
                  className="shrink-0 rounded-full p-1.5 text-[var(--color-muted)] transition-colors hover:bg-black/5"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-navy)]">{hintFor(open.name).action}</p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
