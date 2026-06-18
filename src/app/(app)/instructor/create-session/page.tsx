"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, FlaskConical, Loader2, Share2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import type { ExperimentMeta, InstructorSession } from "@/lib/types";

export default function CreateSessionPage() {
  const [created, setCreated] = useState<InstructorSession | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [form, setForm] = useState({ session_name: "", experiment_name: "", experiment_id: "", batch: "", department: "", date: new Date().toISOString().split("T")[0], require_verification: false });

  const { data: experiments } = useQuery<ExperimentMeta[]>({ queryKey: ["experiments"], queryFn: async () => (await fetch("/api/experiments")).json() });

  const create = useMutation({
    mutationFn: async () => {
      const exp = (experiments ?? []).find((e) => e.id === form.experiment_id);
      const res = await fetch("/api/instructor/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          experiment_name: form.experiment_name.trim() || exp?.name || "",
          experiment_id: form.experiment_id || undefined,
        }),
      });
      return res.json() as Promise<InstructorSession>;
    },
    onSuccess: (s) => setCreated(s),
    onError: (e) => toast.error((e as Error).message),
  });

  function copyCode() {
    if (!created) return;
    navigator.clipboard.writeText(created.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Code copied!");
  }

  const shareUrl = created ? `${typeof window !== "undefined" ? window.location.origin : "https://labmind.harshit.codes"}/student/join?code=${created.code}` : "";

  if (created) {
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <div className="card border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-accent)] text-white">
            <Check size={28} />
          </div>
          <h2 className="text-xl font-bold text-[var(--color-navy)]">Session created!</h2>
          <p className="text-sm text-[var(--color-muted)]">{created.session_name}</p>
        </div>

        <div className="card p-6 text-center">
          <p className="mb-2 text-sm font-semibold text-[var(--color-muted)]">Share this code with students</p>
          <p className="mb-4 font-mono text-5xl font-extrabold tracking-widest text-[var(--color-navy)]">{created.code}</p>

          <div className="mb-4 flex justify-center">
            <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm">
              <QRCodeSVG value={shareUrl} size={180} bgColor="#ffffff" fgColor="#0f2942" />
            </div>
          </div>

          <p className="mb-1 text-xs text-[var(--color-muted)]">Students can scan this QR code or visit:</p>
          <p className="mb-4 break-all rounded-lg bg-[var(--color-surface)] px-3 py-2 font-mono text-xs text-[var(--color-brand)]">{shareUrl}</p>

          <div className="flex gap-2">
            <button onClick={copyCode} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--color-navy)] py-3 font-semibold text-white">
              {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? "Copied!" : "Copy code"}
            </button>
            <button
              onClick={() => navigator.share?.({ title: "Join my LabMind session", text: `Use code ${created.code} to join`, url: shareUrl })}
              className="flex items-center gap-2 rounded-xl border border-black/12 px-4 font-semibold text-[var(--color-navy)]"
            >
              <Share2 size={18} />
            </button>
          </div>
        </div>

        <button onClick={() => setCreated(null)} className="w-full rounded-xl border border-black/12 bg-white py-3 font-semibold text-[var(--color-navy)] hover:bg-[var(--color-surface)]">
          Create another session
        </button>
      </div>
    );
  }

  const valid = form.session_name && (form.experiment_name || form.experiment_id);

  return (
    <div className="mx-auto max-w-lg">
      <div className="card space-y-5 p-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-navy)]">Create Lab Session</h2>
          <p className="text-sm text-[var(--color-muted)]">Fill in the details — a shareable code and QR will be generated instantly.</p>
        </div>

        <Field label="Session name *">
          <input value={form.session_name} onChange={(e) => setForm({ ...form, session_name: e.target.value })} placeholder="Chem Lab 3A — Titration" className="input-base" />
        </Field>

        <Field label="Experiment name">
          <input
            value={form.experiment_name}
            onChange={(e) => setForm({ ...form, experiment_name: e.target.value })}
            placeholder="Custom experiment name"
            className="input-base"
          />
          <p className="mt-1 text-xs text-[var(--color-muted)]">Leave blank to use the selected template&apos;s name.</p>
        </Field>

        <Field label="Template experiment (optional)">
          <select value={form.experiment_id} onChange={(e) => setForm({ ...form, experiment_id: e.target.value })} className="input-base">
            <option value="">— Use default template —</option>
            {(experiments ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-[var(--color-muted)]">Pick a library protocol for the session steps, or leave it blank to use the default.</p>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Batch">
            <input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} placeholder="2025-A" className="input-base" />
          </Field>
          <Field label="Department">
            <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Chemistry" className="input-base" />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.require_verification} onChange={(e) => setForm({ ...form, require_verification: e.target.checked })} />
            <span className="text-sm text-[var(--color-muted)]">Require instructor verification for manual overrides</span>
          </label>
        </div>

        <Field label="Date">
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-base" />
        </Field>

        <div className="rounded-xl border-2 border-dashed border-black/15 p-5 text-center text-sm text-[var(--color-muted)]">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setPdfName(file.name);
              setPdfUploading(true);
              try {
                const base64 = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve((reader.result as string).split(",")[1]);
                  reader.onerror = reject;
                  reader.readAsDataURL(file);
                });
                const tempId = crypto.randomUUID();
                const res = await fetch("/api/protocol/parse", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ session_id: tempId, pdf_base64: base64 }),
                });
                const data = await res.json();
                if (data.experiment_name) setForm((f) => ({ ...f, experiment_name: data.experiment_name }));
                toast.success(`PDF parsed: ${data.experiment_name ?? file.name}`);
              } catch {
                toast.error("PDF parse failed — experiment name not extracted.");
              } finally {
                setPdfUploading(false);
              }
            }}
          />
          <FlaskConical size={22} className="mx-auto mb-1 text-[var(--color-brand)]" />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pdfUploading}
            className="font-semibold text-[var(--color-brand)] hover:underline disabled:opacity-50"
          >
            {pdfUploading ? <Loader2 size={14} className="mr-1 inline animate-spin" /> : <Upload size={14} className="mr-1 inline" />}
            {pdfUploading ? "Parsing PDF…" : "Upload experiment PDF"}
          </button>
          {pdfName && <p className="mt-1 text-xs text-[var(--color-accent)]">{pdfName}</p>}
          <p className="mt-0.5 text-xs">(optional — we&apos;ll parse it with AI and fill the experiment name)</p>
        </div>

        <button
          onClick={() => create.mutate()}
          disabled={!valid || create.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-navy)] py-3.5 font-semibold text-white disabled:opacity-40"
        >
          {create.isPending ? <Loader2 size={18} className="animate-spin" /> : <FlaskConical size={18} />}
          {create.isPending ? "Creating…" : "Generate session"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-[var(--color-navy)]">{label}</span>
      {children}
    </label>
  );
}
