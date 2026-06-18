"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, MessageSquare, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { VerificationEntry } from "@/lib/types";

export default function VerifyPage() {
  const qc = useQueryClient();
  const { data } = useQuery<VerificationEntry[]>({
    queryKey: ["verifications"],
    queryFn: async () => (await fetch("/api/instructor/verify", { cache: "no-store" })).json(),
    refetchInterval: 4000,
  });

  const resolve = useMutation({
    mutationFn: async ({ id, status, comment }: { id: string; status: "approved" | "rejected"; comment?: string }) => {
      await fetch("/api/instructor/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", id, status, comment }),
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["verifications"] }); toast.success("Decision saved"); },
  });

  const pending = (data ?? []).filter((v) => v.status === "pending");
  const resolved = (data ?? []).filter((v) => v.status !== "pending");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-[var(--color-navy)]">Verification Queue</h2>
        <p className="text-sm text-[var(--color-muted)]">Student photo submissions requiring your review</p>
      </div>

      {pending.length === 0 && (
        <div className="card flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 size={40} className="text-[var(--color-accent)]" />
          <p className="font-semibold text-[var(--color-navy)]">No pending verifications</p>
          <p className="text-sm text-[var(--color-muted)]">New submissions will appear here automatically.</p>
        </div>
      )}

      <div className="space-y-3">
        {pending.map((v) => <VerifyCard key={v.id} v={v} onResolve={(status, comment) => resolve.mutate({ id: v.id, status, comment })} />)}
      </div>

      {resolved.length > 0 && (
        <>
          <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--color-muted)]">Resolved</h3>
          <div className="space-y-2">
            {resolved.map((v) => (
              <div key={v.id} className="card flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold text-[var(--color-navy)]">{v.student_name} — Step {v.step_number}</p>
                  <p className="text-xs text-[var(--color-muted)]">{new Date(v.submitted_at).toLocaleString()}</p>
                  {v.instructor_comment && <p className="mt-1 text-sm text-[var(--color-muted)]">Note: {v.instructor_comment}</p>}
                </div>
                <span className={`chip text-white ${v.status === "approved" ? "bg-[var(--color-accent)]" : "bg-[var(--color-danger)]"}`}>
                  {v.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function VerifyCard({ v, onResolve }: { v: VerificationEntry; onResolve: (s: "approved" | "rejected", c?: string) => void }) {
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const confidencePct = Math.round(v.ai_confidence * 100);
  const isLow = v.ai_confidence < 0.7;

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-bold text-[var(--color-navy)]">{v.student_name}</p>
          <p className="text-sm text-[var(--color-muted)]">Step {v.step_number} · {new Date(v.submitted_at).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <Clock size={13} /> Pending
        </div>
      </div>

      {/* AI findings */}
      <div className={`rounded-xl p-3 text-sm ${isLow ? "bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30" : "bg-[var(--color-accent)]/8"}`}>
        <p className="font-semibold text-[var(--color-navy)]">AI Findings</p>
        {v.ai_reading !== null && <p className="mt-0.5">Detected reading: <strong>{v.ai_reading} mL</strong></p>}
        <p className="mt-0.5 text-[var(--color-muted)]">{v.ai_message}</p>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full" style={{ width: `${confidencePct}%`, backgroundColor: isLow ? "var(--color-warning)" : "var(--color-accent)" }} />
          </div>
          <span className={`text-xs font-bold ${isLow ? "text-[var(--color-warning)]" : "text-[var(--color-accent)]"}`}>{confidencePct}%</span>
        </div>
        {isLow && <p className="mt-1 text-xs font-semibold text-[var(--color-warning)]">Low confidence — instructor review required</p>}
      </div>

      {/* Simulated image placeholder */}
      <div className="flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-black/15 bg-[var(--color-surface)] text-[var(--color-muted)]">
        <div className="text-center text-sm">
          <p className="text-2xl">📷</p>
          <p>Student photo</p>
          <p className="text-xs">(Step {v.step_number} capture)</p>
        </div>
      </div>

      {/* Comment box */}
      {showComment && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment for the student…"
          className="w-full rounded-xl border border-black/15 p-3 text-sm outline-none focus:border-[var(--color-brand)]"
          rows={2}
        />
      )}

      <div className="flex gap-2">
        <button onClick={() => onResolve("approved", comment)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--color-accent)] py-2.5 font-semibold text-white">
          <CheckCircle2 size={16} /> Approve
        </button>
        <button onClick={() => onResolve("rejected", comment)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--color-danger)] py-2.5 font-semibold text-white">
          <XCircle size={16} /> Reject
        </button>
        <button onClick={() => setShowComment((s) => !s)} className="flex items-center gap-1 rounded-xl border border-black/12 px-3 text-sm font-semibold text-[var(--color-navy)]">
          <MessageSquare size={15} />
        </button>
      </div>
    </div>
  );
}
