"use client";

import { FlaskConical, Loader2, QrCode } from "lucide-react";
import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { saveSession } from "@/hooks/useSession";
import { api } from "@/lib/api-client";
import { newSessionId } from "@/lib/utils";

function JoinInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: authSession } = useSession();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function join() {
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setLoading(true);
    try {
      const storedName = localStorage.getItem("labmind:name");
      const studentName = authSession?.user?.name ?? authSession?.user?.email ?? storedName
        ?? `Student-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const sessionId = newSessionId();

      const res = await fetch("/api/student/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: clean, student_name: studentName, session_id: sessionId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { toast.error(data.error ?? "Invalid code"); setLoading(false); return; }

      // Parse protocol so we have steps client-side
      const protocol = await api.parseProtocol({ session_id: sessionId, experiment_id: data.experiment_id });
      saveSession({ sessionId, protocol, currentStepIndex: 0 });

      toast.success(`Joined ${data.session_name}`);
      router.push(`/lab/${sessionId}/overview`);
    } catch (e) {
      toast.error((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5 py-4">
      <div>
        <h2 className="text-2xl font-bold text-[var(--color-navy)]">Join a Session</h2>
        <p className="text-[var(--color-muted)]">Enter the code your instructor shared</p>
      </div>

      <div className="card space-y-4 p-6">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-[var(--color-navy)]">Session code</span>
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && join()}
            placeholder="LAB-XXXX"
            maxLength={8}
            className="w-full rounded-xl border-2 border-black/12 px-4 py-4 text-center font-mono text-2xl font-bold uppercase tracking-widest outline-none focus:border-[var(--color-brand)]"
          />
        </label>

        <button
          onClick={join}
          disabled={!code.trim() || loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-navy)] py-3.5 font-semibold text-white disabled:opacity-40"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <FlaskConical size={18} />}
          {loading ? "Joining…" : "Join session"}
        </button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-black/8" />
          <span className="text-xs text-[var(--color-muted)]">or</span>
          <div className="h-px flex-1 bg-black/8" />
        </div>

        <button
          onClick={() => toast.info("Point your phone camera at the QR code shown in class")}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-black/12 py-3 font-semibold text-[var(--color-navy)]"
        >
          <QrCode size={18} /> Scan QR code
        </button>
      </div>

      {/* Demo hint */}
      <div className="rounded-xl bg-[var(--color-brand)]/8 p-4 text-sm">
        <p className="font-semibold text-[var(--color-brand)]">Demo codes to try</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {["LAB-0042"].map((c) => (
            <button key={c} onClick={() => setCode(c)} className="font-mono font-bold text-[var(--color-navy)] underline">{c}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return <Suspense><JoinInner /></Suspense>;
}
