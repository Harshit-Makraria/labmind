"use client";

/**
 * Manual experiment authoring — the surface that makes LabMind universal.
 *
 * Until now an instructor could only pick one of four built-in chemistry/biology
 * experiments or upload a PDF. Anything else — a physics practical, a microscopy
 * slide, a breadboard circuit, a programming lab — simply could not be created.
 *
 * The important field here is the per-step photo DESCRIPTION. Rather than asking
 * an instructor to choose from a fixed list of instruments the developers
 * happened to implement, they write in plain language what the photo must show,
 * and the vision pipeline is judged against that. That single field is what lets
 * any subject be verified without new code per instrument.
 */

import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ExpectedResult, Protocol, ProtocolStep, ResultKind } from "@/lib/types";

/** Newline-separated textarea ⇄ string[] — the least fiddly way to enter lists. */
const toLines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const fromLines = (a: string[] | undefined) => (a ?? []).join("\n");

export function emptyStep(stepNumber: number): ProtocolStep {
  return {
    step_number: stepNumber,
    title: "",
    instructions: [],
    reagents: [],
    duration_seconds: null,
    safety_flags: [],
    science_explanation: "",
    expected_observation: "",
    vision_check_required: false,
    vision_expected: null,
  };
}

export const emptyProtocol = (): Protocol => ({
  experiment_name: "",
  steps: [emptyStep(1)],
  expected_result: { kind: "numeric", label: "", value: null, unit: "" },
});

export function ExperimentBuilder({ value, onChange }: { value: Protocol; onChange: (p: Protocol) => void }) {
  const [openStep, setOpenStep] = useState<number>(0);

  const setStep = (i: number, patch: Partial<ProtocolStep>) =>
    onChange({ ...value, steps: value.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

  const addStep = () => {
    onChange({ ...value, steps: [...value.steps, emptyStep(value.steps.length + 1)] });
    setOpenStep(value.steps.length);
  };

  const removeStep = (i: number) => {
    // Renumber after removal so step_number always matches position — the
    // pacing analysis and downstream-dependency logic both key on it.
    const steps = value.steps.filter((_, k) => k !== i).map((s, k) => ({ ...s, step_number: k + 1 }));
    onChange({ ...value, steps: steps.length ? steps : [emptyStep(1)] });
    setOpenStep(-1);
  };

  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.steps.length) return;
    const steps = [...value.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    onChange({ ...value, steps: steps.map((s, k) => ({ ...s, step_number: k + 1 })) });
    setOpenStep(j);
  };

  return (
    <div className="space-y-4">
      <Field label="Experiment name *">
        <input
          value={value.experiment_name}
          onChange={(e) => onChange({ ...value, experiment_name: e.target.value })}
          placeholder="e.g. Ohm's Law — Verify V = IR"
          className="input-base"
        />
      </Field>

      {/* ── Steps ───────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-sm font-semibold text-[var(--color-navy)]">
          Steps <span className="font-normal text-[var(--color-muted)]">({value.steps.length})</span>
        </p>

        <div className="space-y-2">
          {value.steps.map((step, i) => {
            const open = openStep === i;
            return (
              <div key={i} className="rounded-xl border border-black/10 bg-white">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <GripVertical size={15} className="shrink-0 text-[var(--color-muted)]" />
                  <span className="shrink-0 text-sm font-bold text-[var(--color-brand)]">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => setOpenStep(open ? -1 : i)}
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[var(--color-navy)]"
                  >
                    {step.title || <span className="text-[var(--color-muted)]">Untitled step</span>}
                    {step.vision_check_required && <span className="ml-2 text-xs text-[var(--color-brand)]">📷</span>}
                  </button>
                  <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`} className="p-1 text-[var(--color-muted)] disabled:opacity-25">
                    <ChevronUp size={15} />
                  </button>
                  <button type="button" onClick={() => moveStep(i, 1)} disabled={i === value.steps.length - 1} aria-label={`Move step ${i + 1} down`} className="p-1 text-[var(--color-muted)] disabled:opacity-25">
                    <ChevronDown size={15} />
                  </button>
                  <button type="button" onClick={() => removeStep(i)} aria-label={`Delete step ${i + 1}`} className="p-1 text-[var(--color-muted)] hover:text-[var(--color-danger)]">
                    <Trash2 size={15} />
                  </button>
                </div>

                {open && (
                  <div className="space-y-3 border-t border-black/8 p-3">
                    <Field label="Step title *">
                      <input value={step.title} onChange={(e) => setStep(i, { title: e.target.value })} placeholder="Connect the circuit" className="input-base" />
                    </Field>

                    <Field label="Instructions — one per line">
                      <textarea
                        rows={3}
                        value={fromLines(step.instructions)}
                        onChange={(e) => setStep(i, { instructions: toLines(e.target.value) })}
                        placeholder={"Connect the ammeter in series\nClose the switch"}
                        className="input-base"
                      />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Duration (minutes)">
                        <input
                          type="number"
                          min={0}
                          value={step.duration_seconds ? Math.round(step.duration_seconds / 60) : ""}
                          onChange={(e) => setStep(i, { duration_seconds: e.target.value ? Number(e.target.value) * 60 : null })}
                          placeholder="5"
                          className="input-base"
                        />
                      </Field>
                      <Field label="Expected observation">
                        <input value={step.expected_observation} onChange={(e) => setStep(i, { expected_observation: e.target.value })} placeholder="Bulb lights up" className="input-base" />
                      </Field>
                    </div>

                    <Field label="Safety warnings — one per line">
                      <textarea
                        rows={2}
                        value={fromLines(step.safety_flags)}
                        onChange={(e) => setStep(i, { safety_flags: toLines(e.target.value) })}
                        placeholder={"Do not exceed 6 V\nSwitch off before rewiring"}
                        className="input-base"
                      />
                    </Field>

                    <Field label="Why this matters (shown to students)">
                      <textarea rows={2} value={step.science_explanation} onChange={(e) => setStep(i, { science_explanation: e.target.value })} placeholder="Current is the same at every point in a series circuit." className="input-base" />
                    </Field>

                    {/* ── Photo verification — the universal bit ─────────── */}
                    <div className="rounded-lg bg-[var(--color-brand)]/6 p-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={step.vision_check_required}
                          onChange={(e) =>
                            setStep(i, {
                              vision_check_required: e.target.checked,
                              vision_expected: e.target.checked
                                ? step.vision_expected ?? { type: "descriptive", expected_value: null, tolerance: 0, description: "" }
                                : null,
                            })
                          }
                        />
                        <span className="text-sm font-semibold text-[var(--color-navy)]">Require a photo the AI must verify</span>
                      </label>

                      {step.vision_check_required && (
                        <div className="mt-3 space-y-3">
                          <Field label="What must the photo show? *">
                            <textarea
                              rows={2}
                              value={step.vision_expected?.description ?? ""}
                              onChange={(e) =>
                                setStep(i, {
                                  vision_expected: {
                                    type: "descriptive",
                                    expected_value: step.vision_expected?.expected_value ?? null,
                                    tolerance: step.vision_expected?.tolerance ?? 0,
                                    description: e.target.value,
                                    must_show: step.vision_expected?.must_show,
                                    must_not_show: step.vision_expected?.must_not_show,
                                  },
                                })
                              }
                              placeholder="The ammeter display with the needle clearly readable, and the circuit switch closed."
                              className="input-base"
                            />
                            <p className="mt-1 text-xs text-[var(--color-muted)]">
                              Describe it as you would to a student. The AI is judged against exactly this — so be specific about what must be visible.
                            </p>
                          </Field>

                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Must be visible — one per line">
                              <textarea
                                rows={2}
                                value={fromLines(step.vision_expected?.must_show)}
                                onChange={(e) =>
                                  setStep(i, { vision_expected: { ...(step.vision_expected ?? { type: "descriptive", expected_value: null, tolerance: 0 }), type: "descriptive", must_show: toLines(e.target.value) } })
                                }
                                placeholder={"needle deflected\nswitch closed"}
                                className="input-base"
                              />
                            </Field>
                            <Field label="Fails if seen — one per line">
                              <textarea
                                rows={2}
                                value={fromLines(step.vision_expected?.must_not_show)}
                                onChange={(e) =>
                                  setStep(i, { vision_expected: { ...(step.vision_expected ?? { type: "descriptive", expected_value: null, tolerance: 0 }), type: "descriptive", must_not_show: toLines(e.target.value) } })
                                }
                                placeholder={"loose wire\nneedle off-scale"}
                                className="input-base"
                              />
                            </Field>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Expected reading (optional)">
                              <input
                                type="number"
                                step="any"
                                value={step.vision_expected?.expected_value ?? ""}
                                onChange={(e) =>
                                  setStep(i, { vision_expected: { ...(step.vision_expected ?? { type: "descriptive", tolerance: 0 }), type: "descriptive", expected_value: e.target.value === "" ? null : Number(e.target.value), tolerance: step.vision_expected?.tolerance ?? 0 } })
                                }
                                placeholder="0.52"
                                className="input-base"
                              />
                            </Field>
                            <Field label="Tolerance (±)">
                              <input
                                type="number"
                                step="any"
                                value={step.vision_expected?.tolerance || ""}
                                onChange={(e) =>
                                  setStep(i, { vision_expected: { ...(step.vision_expected ?? { type: "descriptive", expected_value: null }), type: "descriptive", expected_value: step.vision_expected?.expected_value ?? null, tolerance: e.target.value === "" ? 0 : Number(e.target.value) } })
                                }
                                placeholder="0.05"
                                className="input-base"
                              />
                            </Field>
                          </div>
                          <p className="text-xs text-[var(--color-muted)]">
                            Leave the reading blank when the photo just needs to show something is correct, rather than display a number.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={addStep}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-black/20 py-2.5 text-sm font-semibold text-[var(--color-brand)] hover:bg-[var(--color-brand)]/5"
        >
          <Plus size={15} /> Add step
        </button>
      </div>

      {/* ── Final result ────────────────────────────────────────── */}
      <ExpectedResultEditor
        value={value.expected_result ?? { kind: "numeric", label: "", value: null, unit: "" }}
        onChange={(expected_result) => onChange({ ...value, expected_result })}
      />
    </div>
  );
}

const KINDS: { kind: ResultKind; label: string; hint: string }[] = [
  { kind: "numeric", label: "A measured number", hint: "Concentration, focal length, resistance" },
  { kind: "categorical", label: "An identification", hint: "Which tissue, which species, which compound" },
  { kind: "boolean", label: "Yes / no", hint: "Does the circuit work, did it compile" },
  { kind: "qualitative", label: "A written observation", hint: "Reviewed by you, not auto-graded" },
  { kind: "none", label: "No final result", hint: "Graded on the steps alone" },
];

function ExpectedResultEditor({ value, onChange }: { value: ExpectedResult; onChange: (r: ExpectedResult) => void }) {
  return (
    <div className="rounded-xl border border-black/10 p-3">
      <p className="mb-2 text-sm font-semibold text-[var(--color-navy)]">What does the student submit at the end?</p>

      <div className="mb-3 grid gap-1.5">
        {KINDS.map((k) => (
          <label
            key={k.kind}
            className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors"
            style={{ borderColor: value.kind === k.kind ? "var(--color-brand)" : "rgba(15,41,66,.10)" }}
          >
            <input type="radio" name="result-kind" checked={value.kind === k.kind} onChange={() => onChange({ ...value, kind: k.kind })} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium text-[var(--color-navy)]">{k.label}</span>
              <span className="block text-xs text-[var(--color-muted)]">{k.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {value.kind !== "none" && (
        <Field label="What are they determining? *">
          <input value={value.label} onChange={(e) => onChange({ ...value, label: e.target.value })} placeholder="e.g. Resistance of the wire" className="input-base" />
        </Field>
      )}

      {value.kind === "numeric" && (
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="Expected value *">
            <input type="number" step="any" value={value.value ?? ""} onChange={(e) => onChange({ ...value, value: e.target.value === "" ? null : Number(e.target.value) })} placeholder="4.7" className="input-base" />
          </Field>
          <Field label="Unit">
            <input value={value.unit ?? ""} onChange={(e) => onChange({ ...value, unit: e.target.value })} placeholder="Ω" className="input-base" />
          </Field>
          <Field label="Tolerance (±)">
            <input type="number" step="any" value={value.tolerance ?? ""} onChange={(e) => onChange({ ...value, tolerance: e.target.value === "" ? null : Number(e.target.value) })} placeholder="0.2" className="input-base" />
          </Field>
        </div>
      )}

      {value.kind === "categorical" && (
        <div className="mt-3 space-y-3">
          <Field label="Options — one per line *">
            <textarea
              rows={3}
              value={fromLines(value.options)}
              onChange={(e) => onChange({ ...value, options: toLines(e.target.value) })}
              placeholder={"Cardiac muscle\nSkeletal muscle\nSmooth muscle"}
              className="input-base"
            />
          </Field>
          <Field label="Correct answer *">
            <select value={typeof value.correct === "string" ? value.correct : ""} onChange={(e) => onChange({ ...value, correct: e.target.value })} className="input-base">
              <option value="">— Choose the correct option —</option>
              {(value.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
        </div>
      )}

      {value.kind === "boolean" && (
        <Field label="Correct answer *">
          <select value={value.correct === true ? "yes" : value.correct === false ? "no" : ""} onChange={(e) => onChange({ ...value, correct: e.target.value === "yes" })} className="input-base">
            <option value="">— Choose —</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
      )}

      {value.kind === "qualitative" && (
        <Field label="What are you looking for? *">
          <textarea rows={2} value={value.rubric ?? ""} onChange={(e) => onChange({ ...value, rubric: e.target.value })} placeholder="Should describe the colour change and name the gas produced." className="input-base" />
          <p className="mt-1 text-xs text-[var(--color-muted)]">Written answers are sent to you for review — LabMind will not auto-mark them right or wrong.</p>
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-[var(--color-navy)]">{label}</span>
      {children}
    </label>
  );
}

/** Is this protocol complete enough to publish? Returns the blocking reason, or null. */
export function validateProtocol(p: Protocol): string | null {
  if (!p.experiment_name.trim()) return "Give the experiment a name.";
  if (!p.steps.length) return "Add at least one step.";
  const untitled = p.steps.findIndex((s) => !s.title.trim());
  if (untitled >= 0) return `Step ${untitled + 1} needs a title.`;
  const noDesc = p.steps.findIndex((s) => s.vision_check_required && !s.vision_expected?.description?.trim());
  if (noDesc >= 0) return `Step ${noDesc + 1} requires a photo — describe what it must show.`;
  const r = p.expected_result;
  if (r && r.kind !== "none") {
    if (!r.label.trim()) return "Say what the student is determining at the end.";
    if (r.kind === "numeric" && (r.value === null || r.value === undefined)) return "Enter the expected value.";
    if (r.kind === "categorical" && (!r.options?.length || !r.correct)) return "Add the options and mark the correct one.";
    if (r.kind === "boolean" && typeof r.correct !== "boolean") return "Choose the correct yes/no answer.";
    if (r.kind === "qualitative" && !r.rubric?.trim()) return "Describe what you're looking for in the written answer.";
  }
  return null;
}
