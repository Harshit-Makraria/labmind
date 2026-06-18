"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

import { formatDuration } from "@/lib/utils";

export function StepTimer({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    setRemaining(seconds);
    setRunning(true);
  }, [seconds]);

  useEffect(() => {
    if (!running || remaining <= 0) return;
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [running, remaining]);

  const done = remaining <= 0;
  return (
    <button
      onClick={() => setRunning((r) => !r)}
      className={`flex items-center gap-2 rounded-[var(--radius-btn)] px-3 py-2 text-sm font-semibold ${
        done
          ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
          : "bg-black/5 text-[var(--color-navy)]"
      }`}
    >
      <Clock size={16} />
      {done ? "Time complete" : formatDuration(remaining)}
      {!done && <span className="text-xs opacity-60">{running ? "(tap to pause)" : "(paused)"}</span>}
    </button>
  );
}
