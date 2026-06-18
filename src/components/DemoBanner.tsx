"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Key, X } from "lucide-react";
import { useState } from "react";

interface MetaResponse {
  demo: boolean;
  keys_exhausted: boolean;
}

export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery<MetaResponse>({
    queryKey: ["meta"],
    queryFn: async () => (await fetch("/api/meta", { cache: "no-store" })).json(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (!data?.demo || dismissed) return null;

  const exhausted = data.keys_exhausted;

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
            {" "}Go to <strong>AI Settings</strong> to add your own key or switch to Demo mode.
          </>
        ) : (
          <>
            <strong>Demo mode.</strong> AI checks are simulated — session codes, instructor console, and all features still work.
            {" "}Go to <strong>AI Settings</strong> to add an API key for real AI analysis.
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
