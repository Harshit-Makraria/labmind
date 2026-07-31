"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Key, X } from "lucide-react";
import { useState } from "react";

interface MetaResponse {
  demo: boolean;
  keys_exhausted: boolean;
}

export function DemoBanner({ role }: { role?: "instructor" | "student" | null }) {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery<MetaResponse>({
    queryKey: ["meta"],
    queryFn: async () => (await fetch("/api/meta", { cache: "no-store" })).json(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (!data?.demo || dismissed) return null;

  const exhausted = data.keys_exhausted;
  // /settings is instructor-only (INSTRUCTOR_PREFIXES in route.ts) — telling
  // a student to "go to AI Settings" sent them to a page that 403s on every
  // fetch it makes. Only instructors can actually act on this instruction.
  const cta = role === "instructor"
    ? <>Go to <strong>AI Settings</strong> {exhausted ? "to add your own key or switch to Demo mode." : "to add an API key for real AI analysis."}</>
    : <>Ask your instructor to add an API key in AI Settings for real AI analysis.</>;

  return (
    <div
      className="flex items-start gap-3 px-4 py-2.5 text-sm"
      style={{
        background: exhausted ? "var(--color-error, #dc2626)" : "var(--color-warning, #f59e0b)",
        color: "#fff",
      }}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <p className="flex-1 leading-snug">
        {exhausted ? (
          <>
            <strong>Paid API key limit reached.</strong> AI checks are simulated. All other features (sessions, codes, instructor console) work normally.
            {" "}{cta}
          </>
        ) : (
          <>
            <strong>Demo mode.</strong> AI checks are simulated — session codes, instructor console, and all features still work.
            {" "}{cta}
          </>
        )}
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
    </div>
  );
}
