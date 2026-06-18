"use client";

import { useQuery } from "@tanstack/react-query";
import { FileUp, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ExperimentCard } from "@/components/experiments/ExperimentCard";
import { useStartLab } from "@/hooks/useStartLab";
import { api } from "@/lib/api-client";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function LibraryPage() {
  const start = useStartLab();
  const { data: experiments, isLoading } = useQuery({ queryKey: ["experiments"], queryFn: api.experiments });
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("PDF must be under 10 MB");
      return;
    }
    setFileName(file.name);
    setPdfBase64(await fileToBase64(file));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[var(--color-navy)]">Experiment Library</h2>
        <p className="mt-1 text-[var(--color-muted)]">
          Pick a ready-to-run experiment, or upload your own lab PDF and the agent will structure it.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && <Loader2 className="animate-spin text-[var(--color-brand)]" />}
        {(experiments ?? []).map((e) => (
          <ExperimentCard
            key={e.id}
            experiment={e}
            starting={start.isPending}
            onStart={() => start.mutate({ experimentId: e.id })}
          />
        ))}

        {/* Custom PDF card */}
        <div className="card flex flex-col gap-3 border-dashed p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-navy)]/8 text-[var(--color-navy)]">
            <FileUp size={22} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[var(--color-navy)]">Upload your own lab</h3>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Bring any lab PDF. With an LLM key it&apos;s parsed live; in demo it loads the sample titration.
            </p>
          </div>

          <button
            onClick={() => inputRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-[var(--radius-btn)] border-2 border-dashed border-[var(--color-brand)]/40 bg-[var(--color-brand)]/5 px-4 py-3 text-sm font-semibold text-[var(--color-brand)]"
          >
            <Upload size={16} /> {fileName ?? "Choose PDF (≤10 MB)"}
          </button>
          <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />

          <button
            onClick={() => start.mutate({ pdfBase64: pdfBase64 ?? undefined })}
            disabled={start.isPending}
            className="mt-auto inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-[var(--color-navy)] px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {start.isPending ? <Loader2 size={16} className="animate-spin" /> : "Start from PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
