"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bot, X } from "lucide-react";
import { useState } from "react";

import { AssistantPanel } from "@/components/assistant/AssistantPanel";

/** Floating, context-aware assistant available during a lab run. */
export function AssistantDock({
  sessionId,
  experimentId,
  currentStep,
  suggestions,
}: {
  sessionId: string;
  experimentId?: string;
  currentStep?: number;
  suggestions?: string[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-accent)] px-4 py-3 font-semibold text-white shadow-[var(--shadow-pop)] md:bottom-6"
        >
          <Bot size={20} /> Ask LabMind
        </button>
      )}

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/30"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-md flex-col bg-[var(--color-card)] shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-black/8 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-accent)] text-white">
                    <Bot size={17} />
                  </div>
                  <div className="leading-tight">
                    <p className="font-bold text-[var(--color-navy)]">LabMind Assistant</p>
                    <p className="text-[11px] text-[var(--color-muted)]">Knows your experiment &amp; current step</p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} className="text-[var(--color-muted)] hover:text-[var(--color-navy)]">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <AssistantPanel
                  sessionId={sessionId}
                  experimentId={experimentId}
                  currentStep={currentStep}
                  suggestions={suggestions}
                  heightClass="h-full"
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
