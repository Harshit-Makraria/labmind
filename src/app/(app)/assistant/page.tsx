"use client";

import { AssistantPanel } from "@/components/assistant/AssistantPanel";

const SUGGESTIONS = [
  "Is it safe to mix bleach (NaOCl) and HCl?",
  "Calculate HCl concentration for a 24.6 mL titre",
  "What experiments can I run?",
  "If I skip step 3, what becomes unreliable?",
  "How did I do if my result is 0.094 vs 0.1?",
];

export default function AssistantPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-[var(--color-navy)]">Lab Assistant</h2>
        <p className="mt-1 text-[var(--color-muted)]">
          A real agent: it plans, calls tools (safety DB, calculators, protocol lookup), and shows its work.
        </p>
      </div>
      <div className="card overflow-hidden">
        <AssistantPanel suggestions={SUGGESTIONS} heightClass="h-[72vh]" />
      </div>
    </div>
  );
}
