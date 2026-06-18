"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Eye, EyeOff, FlaskConical, Key, Save, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Provider = "auto" | "openai" | "gemini" | "demo";

interface LlmStatus {
  provider: Provider;
  hasOpenaiKey: boolean;
  hasGeminiKey: boolean;
  keys_exhausted: boolean;
  exhausted_providers: Record<string, string>;
}

const PROVIDERS: { value: Provider; label: string; description: string }[] = [
  {
    value: "auto",
    label: "Auto (Recommended)",
    description: "Tries OpenAI first, falls back to Gemini, then demo mode if both exhausted.",
  },
  {
    value: "openai",
    label: "OpenAI only",
    description: "Uses gpt-4o-mini exclusively. Falls back to demo if key is missing or exhausted.",
  },
  {
    value: "gemini",
    label: "Gemini only",
    description: "Uses gemini-1.5-flash exclusively. Falls back to demo if key is missing or exhausted.",
  },
  {
    value: "demo",
    label: "Demo mode",
    description: "No AI — all responses are deterministic mock data. No API key needed.",
  },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<LlmStatus>({
    queryKey: ["settings-llm"],
    queryFn: async () => (await fetch("/api/settings/llm")).json(),
  });

  const [provider, setProvider] = useState<Provider | null>(null);
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showOpenai, setShowOpenai] = useState(false);
  const [showGemini, setShowGemini] = useState(false);

  const effectiveProvider = provider ?? data?.provider ?? "auto";

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { provider: effectiveProvider };
      if (openaiKey) body.openai_key = openaiKey;
      if (geminiKey) body.gemini_key = geminiKey;
      const res = await fetch("/api/settings/llm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`Saved — provider: ${data.provider}`);
      // Refetch both queries immediately (bypass staleTime)
      qc.invalidateQueries({ queryKey: ["settings-llm"] });
      qc.refetchQueries({ queryKey: ["meta"] });
      setOpenaiKey("");
      setGeminiKey("");
    },
    onError: (e) => toast.error(`Save failed: ${(e as Error).message}`),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--color-navy)]">AI Provider Settings</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Choose which AI model powers LabMind. Changes take effect immediately.
        </p>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatusCard
          label="OpenAI (gpt-4o-mini)"
          hasKey={data?.hasOpenaiKey ?? false}
          exhausted={!!data?.exhausted_providers?.openai}
        />
        <StatusCard
          label="Gemini (gemini-1.5-flash)"
          hasKey={data?.hasGeminiKey ?? false}
          exhausted={!!data?.exhausted_providers?.gemini}
        />
      </div>

      {data?.keys_exhausted && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>API key limit reached.</strong> One or more providers hit their quota. Enter a new key below or switch to demo mode.
        </div>
      )}

      {/* Provider selector */}
      <div className="card space-y-3">
        <h3 className="font-semibold text-[var(--color-navy)] flex items-center gap-2">
          <Bot size={16} /> Provider Mode
        </h3>
        <div className="space-y-2">
          {PROVIDERS.map((p) => (
            <label
              key={p.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                effectiveProvider === p.value
                  ? "border-[var(--color-brand)] bg-[var(--color-brand)]/5"
                  : "border-[var(--color-border)] hover:border-[var(--color-brand)]/40"
              }`}
            >
              <input
                type="radio"
                name="provider"
                value={p.value}
                checked={effectiveProvider === p.value}
                onChange={() => setProvider(p.value)}
                className="mt-0.5 accent-[var(--color-brand)]"
              />
              <div>
                <p className="font-medium text-[var(--color-navy)]">{p.label}</p>
                <p className="text-xs text-[var(--color-muted)]">{p.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* API keys */}
      {effectiveProvider !== "demo" && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-[var(--color-navy)] flex items-center gap-2">
            <Key size={16} /> API Keys
          </h3>
          <p className="text-xs text-[var(--color-muted)]">
            Leave blank to keep the existing key. Keys are stored encrypted in the database and never sent to the client.
          </p>

          {(effectiveProvider === "auto" || effectiveProvider === "openai") && (
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-navy)]">
                OpenAI API Key
              </label>
              <div className="relative">
                <input
                  type={showOpenai ? "text" : "password"}
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder={data?.hasOpenaiKey ? "•••••••• (key already set)" : "sk-..."}
                  className="input-base w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenai((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
                >
                  {showOpenai ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          )}

          {(effectiveProvider === "auto" || effectiveProvider === "gemini") && (
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-navy)]">
                Gemini API Key
              </label>
              <div className="relative">
                <input
                  type={showGemini ? "text" : "password"}
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder={data?.hasGeminiKey ? "•••••••• (key already set)" : "AIza..."}
                  className="input-base w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowGemini((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
                >
                  {showGemini ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Demo info */}
      {effectiveProvider === "demo" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex gap-3">
            <FlaskConical size={16} className="mt-0.5 shrink-0" />
            <span>
              Demo mode uses pre-built mock responses. All AI checks are simulated — no real data analysis occurs.
              Sessions, instructor codes, and all other features work normally.
            </span>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
            <p className="font-semibold text-[var(--color-navy)] mb-2">Pre-seeded demo sessions you can use:</p>
            <div className="space-y-1.5">
              {[
                { code: "LAB-0042", name: "Acid-Base Titration", role: "Instructor" },
              ].map((s) => (
                <div key={s.code} className="flex items-center gap-2 rounded-lg bg-white border border-[var(--color-border)] px-3 py-2">
                  <code className="font-mono text-[var(--color-brand)] font-bold">{s.code}</code>
                  <span className="text-[var(--color-muted)]">—</span>
                  <span className="text-[var(--color-navy)]">{s.name}</span>
                  <span className="ml-auto text-xs text-[var(--color-muted)]">{s.role}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--color-muted)]">Students can join these sessions using the codes above on the Join Session page.</p>
          </div>
        </div>
      )}

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="btn-primary flex items-center gap-2"
      >
        <Save size={15} />
        {mutation.isPending ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}

function StatusCard({
  label,
  hasKey,
  exhausted,
}: {
  label: string;
  hasKey: boolean;
  exhausted: boolean;
}) {
  const color = exhausted ? "text-red-600" : hasKey ? "text-green-600" : "text-[var(--color-muted)]";
  const bg = exhausted ? "bg-red-50 border-red-200" : hasKey ? "bg-green-50 border-green-200" : "bg-[var(--color-surface)] border-[var(--color-border)]";
  const Icon = exhausted ? XCircle : hasKey ? CheckCircle2 : XCircle;
  const status = exhausted ? "Quota exceeded" : hasKey ? "Key configured" : "No key";

  return (
    <div className={`rounded-xl border px-4 py-3 ${bg}`}>
      <p className="text-xs font-medium text-[var(--color-muted)]">{label}</p>
      <div className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${color}`}>
        <Icon size={14} /> {status}
      </div>
    </div>
  );
}
