"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Share2 } from "lucide-react";
import { use } from "react";
import type { LabReport } from "@/lib/types";

export default function ReportPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);

  const { data: report } = useQuery<LabReport>({
    queryKey: ["report", sessionId],
    queryFn: async () => (await fetch(`/api/lab/${sessionId}/report`, { cache: "no-store" })).json(),
  });

  if (!report) return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <Loader2 className="animate-spin text-[var(--color-brand)]" />
    </div>
  );

  const scoreColor = report.performance_score >= 80 ? "#2f9e6f" : report.performance_score >= 60 ? "#d69e2e" : "#e53e3e";

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-2">
      {/* Actions */}
      <div className="flex gap-2 print:hidden">
        <button onClick={() => window.print()} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--color-navy)] py-3 font-semibold text-white">
          <Download size={18} /> Download PDF
        </button>
        <button
          onClick={() => navigator.share?.({ title: `${report.student_name} — Lab Report`, url: window.location.href })}
          className="flex items-center gap-2 rounded-xl border border-black/12 px-4 font-semibold text-[var(--color-navy)]"
        >
          <Share2 size={18} />
        </button>
      </div>

      {/* Report preview */}
      <div className="card space-y-6 p-7 print:shadow-none" id="report-content">
        {/* Header */}
        <div className="border-b-2 border-[var(--color-navy)] pb-4 text-center">
          <h1 className="text-2xl font-extrabold text-[var(--color-navy)]">LABORATORY REPORT</h1>
          <div className="mt-3 grid grid-cols-2 gap-y-1 text-sm text-left text-[var(--color-muted)]">
            <span><strong>Student:</strong> {report.student_name}</span>
            <span><strong>Date:</strong> {report.date}</span>
            <span className="col-span-2"><strong>Experiment:</strong> {report.experiment_name}</span>
          </div>
          <div className="mt-2 flex justify-end">
            <span className="rounded-full px-3 py-1 text-sm font-bold text-white" style={{ backgroundColor: scoreColor }}>
              Score: {report.performance_score}/100
            </span>
          </div>
        </div>

        <Section title="Aim" number="1">
          <p className="text-sm">{report.aim}</p>
        </Section>

        <Section title="Apparatus" number="2">
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {report.apparatus.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </Section>

        <Section title="Safety Precautions" number="3">
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            <li>Wear appropriate PPE (goggles, gloves, lab coat) at all times</li>
            <li>Handle all chemical reagents with care</li>
            <li>Do not mix reagents unless instructed by the procedure</li>
            <li>Dispose of waste as directed by instructor</li>
          </ul>
        </Section>

        <Section title="Procedure" number="4">
          <p className="text-sm text-[var(--color-muted)]">As per the lab protocol, the experiment was conducted in {report.procedure.length || "several"} steps under AI-guided monitoring.</p>
        </Section>

        <Section title="Observations" number="5">
          {report.observations.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/12">
                  <th className="pb-1 text-left text-[var(--color-muted)]">Step</th>
                  <th className="pb-1 text-left text-[var(--color-muted)]">Observation</th>
                  <th className="pb-1 text-right text-[var(--color-muted)]">Reading</th>
                </tr>
              </thead>
              <tbody>
                {report.observations.map((o, i) => (
                  <tr key={i} className="border-b border-black/5">
                    <td className="py-1.5">{o.step}</td>
                    <td className="py-1.5">{o.observation}</td>
                    <td className="py-1.5 text-right font-mono">{o.reading ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-[var(--color-muted)]">No recorded observations.</p>}
        </Section>

        <Section title="Calculations" number="6">
          <div className="rounded-lg bg-[var(--color-surface)] p-3 font-mono text-sm">{report.calculations}</div>
        </Section>

        <Section title="Result" number="7">
          <p className="text-sm">{report.result}</p>
          {report.deviation_percent !== null && (
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/8">
                <div className="h-full rounded-full" style={{ width: `${Math.max(0, 100 - report.deviation_percent * 5)}%`, backgroundColor: scoreColor }} />
              </div>
              <span className="text-sm font-bold" style={{ color: scoreColor }}>{report.deviation_percent}% deviation</span>
            </div>
          )}
        </Section>

        {report.mistakes.length > 0 && (
          <Section title="Mistakes & Errors" number="8">
            <ul className="space-y-1 text-sm">
              {report.mistakes.map((m, i) => <li key={i} className="flex gap-2"><span className="text-[var(--color-danger)]">✗</span>{m}</li>)}
            </ul>
          </Section>
        )}

        <Section title="Instructor Remarks" number="9">
          <div className="min-h-[60px] rounded-lg border-2 border-dashed border-black/15 p-3 text-sm text-[var(--color-muted)]">
            {report.instructor_remarks}
          </div>
        </Section>

        <div className="flex justify-between border-t border-black/10 pt-4 text-xs text-[var(--color-muted)]">
          <span>Generated by LabMind AI · {report.date}</span>
          <span>Session: {sessionId.slice(0, 8)}</span>
        </div>
      </div>

      {/* Print styles injected */}
      <style>{`
        @media print {
          body > * { display: none; }
          #report-content { display: block !important; }
          .print\\:hidden { display: none !important; }
          .print\\:shadow-none { box-shadow: none; }
        }
      `}</style>
    </div>
  );
}

function Section({ title, number, children }: { title: string; number: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 font-bold text-[var(--color-navy)]">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-navy)] text-xs text-white">{number}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}
