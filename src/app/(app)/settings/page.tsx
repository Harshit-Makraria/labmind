"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Eye, EyeOff, FlaskConical, Key, RefreshCw, Save, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/data-states";
import { fetchJson, isForbidden } from "@/lib/api-client";

type Provider = "auto" | "claude" | "openai" | "gemini" | "demo";
type CatalogProvider = "openai" | "gemini" | "claude";

type CapabilityProviderChoice = "auto" | CatalogProvider;

interface LlmStatus {
  provider: Provider;
  chatProvider: CapabilityProviderChoice;
  visionProvider: CapabilityProviderChoice;
  resolved_chat_provider: CatalogProvider;
  resolved_vision_provider: CatalogProvider;
  hasClaudeKey: boolean;
  hasOpenaiKey: boolean;
  hasGeminiKey: boolean;
  keys_exhausted: boolean;
  exhausted_providers: Record<string, string>;
  models: Record<CatalogProvider, { chat: string; vision: string }>;
}

const PROVIDER_CHOICE_LABEL: Record<CatalogProvider, string> = { openai: "OpenAI", gemini: "Gemini", claude: "Claude" };

interface ModelCatalogResponse {
  models: { id: string; label?: string }[];
  live: boolean;
  error?: string;
}

const PROVIDERS: { value: Provider; label: string; description: string }[] = [
  {
    value: "auto",
    label: "Auto (Recommended)",
    description: "Chat defaults to OpenAI, photo verification to Gemini — each falls back through the others, then demo. Override either independently below (e.g. Claude for chat + OpenAI for vision).",
  },
  {
    value: "openai",
    label: "OpenAI only",
    description: "Uses OpenAI (gpt-4o-mini for chat, gpt-4o for photo verification) exclusively. Falls back to demo if the key is missing or exhausted.",
  },
  {
    value: "gemini",
    label: "Gemini only",
    description: "Uses Gemini exclusively for both chat and photo verification. Falls back to demo if the key is missing or exhausted.",
  },
  {
    value: "claude",
    label: "Claude only",
    description: "Uses Claude exclusively for both chat and photo verification — switch to this if you'd rather not use the OpenAI/Gemini default.",
  },
  {
    value: "demo",
    label: "Demo mode",
    description: "No AI — all responses are deterministic mock data. No API key needed.",
  },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, isPaused, error, failureReason, refetch } = useQuery<LlmStatus>({
    queryKey: ["settings-llm"],
    queryFn: () => fetchJson<LlmStatus>("/api/settings/llm"),
  });

  const [provider, setProvider] = useState<Provider | null>(null);
  const [claudeKey, setClaudeKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showClaude, setShowClaude] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [showGemini, setShowGemini] = useState(false);

  // Model picks — null means "untouched, use whatever the server reports as effective".
  const [openaiChatModel, setOpenaiChatModel] = useState<string | null>(null);
  const [openaiVisionModel, setOpenaiVisionModel] = useState<string | null>(null);
  const [geminiChatModel, setGeminiChatModel] = useState<string | null>(null);
  const [geminiVisionModel, setGeminiVisionModel] = useState<string | null>(null);
  const [claudeChatModel, setClaudeChatModel] = useState<string | null>(null);
  const [claudeVisionModel, setClaudeVisionModel] = useState<string | null>(null);

  // Per-capability provider pins — only meaningful while the top-level mode
  // is "auto"; a single-provider mode ("OpenAI only" etc.) forces both anyway.
  const [chatProviderPin, setChatProviderPin] = useState<CapabilityProviderChoice | null>(null);
  const [visionProviderPin, setVisionProviderPin] = useState<CapabilityProviderChoice | null>(null);

  const effectiveProvider = provider ?? data?.provider ?? "auto";
  const effChatProviderPin = chatProviderPin ?? data?.chatProvider ?? "auto";
  const effVisionProviderPin = visionProviderPin ?? data?.visionProvider ?? "auto";
  const effOpenaiChat = openaiChatModel ?? data?.models?.openai?.chat ?? "";
  const effOpenaiVision = openaiVisionModel ?? data?.models?.openai?.vision ?? "";
  const effGeminiChat = geminiChatModel ?? data?.models?.gemini?.chat ?? "";
  const effGeminiVision = geminiVisionModel ?? data?.models?.gemini?.vision ?? "";
  const effClaudeChat = claudeChatModel ?? data?.models?.claude?.chat ?? "";
  const effClaudeVision = claudeVisionModel ?? data?.models?.claude?.vision ?? "";

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { provider: effectiveProvider };
      if (chatProviderPin) body.chat_provider = chatProviderPin;
      if (visionProviderPin) body.vision_provider = visionProviderPin;
      if (claudeKey) body.anthropic_key = claudeKey;
      if (openaiKey) body.openai_key = openaiKey;
      if (geminiKey) body.gemini_key = geminiKey;
      if (openaiChatModel) body.openai_chat_model = openaiChatModel;
      if (openaiVisionModel) body.openai_vision_model = openaiVisionModel;
      if (geminiChatModel) body.gemini_chat_model = geminiChatModel;
      if (geminiVisionModel) body.gemini_vision_model = geminiVisionModel;
      if (claudeChatModel) body.anthropic_chat_model = claudeChatModel;
      if (claudeVisionModel) body.anthropic_vision_model = claudeVisionModel;
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
      qc.invalidateQueries({ queryKey: ["settings-llm"] });
      qc.refetchQueries({ queryKey: ["meta"] });
      setClaudeKey("");
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

  if (isError || isPaused) {
    const forbidden = isForbidden(error) || isForbidden(failureReason);
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ErrorState title="Couldn't load AI settings" onRetry={() => refetch()} offline={!forbidden && isPaused} forbidden={forbidden} />
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
      <div className="grid grid-cols-3 gap-3">
        <StatusCard
          label="OpenAI"
          hasKey={data?.hasOpenaiKey ?? false}
          exhausted={!!data?.exhausted_providers?.openai}
          badge="Chat default"
        />
        <StatusCard
          label="Gemini"
          hasKey={data?.hasGeminiKey ?? false}
          exhausted={!!data?.exhausted_providers?.gemini}
          badge="Vision default"
        />
        <StatusCard
          label="Claude"
          hasKey={data?.hasClaudeKey ?? false}
          exhausted={!!data?.exhausted_providers?.anthropic}
          badge="Available"
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

      {/* Per-capability provider override — only meaningful under Auto */}
      {effectiveProvider === "auto" && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-[var(--color-navy)] flex items-center gap-2">
            <Bot size={16} /> Chat &amp; Vision Providers
          </h3>
          <p className="text-xs text-[var(--color-muted)]">
            Pin each capability to a specific provider independently — e.g. OpenAI for chat and Gemini for vision (the
            default), or any other combination like Claude for chat and OpenAI for vision.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-navy)]">Chat provider</label>
              <select
                value={effChatProviderPin}
                onChange={(e) => setChatProviderPin(e.target.value as CapabilityProviderChoice)}
                className="input-base w-full"
              >
                <option value="auto">
                  Auto (OpenAI → Gemini → Claude){data ? ` — currently ${PROVIDER_CHOICE_LABEL[data.resolved_chat_provider]}` : ""}
                </option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="claude">Claude</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-navy)]">Vision provider</label>
              <select
                value={effVisionProviderPin}
                onChange={(e) => setVisionProviderPin(e.target.value as CapabilityProviderChoice)}
                className="input-base w-full"
              >
                <option value="auto">
                  Auto (Gemini → OpenAI → Claude){data ? ` — currently ${PROVIDER_CHOICE_LABEL[data.resolved_vision_provider]}` : ""}
                </option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="claude">Claude</option>
              </select>
            </div>
          </div>
        </div>
      )}

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
                OpenAI API Key <span className="text-xs text-[var(--color-accent)] font-semibold">(Default for chat)</span>
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
              <ModelPicker provider="openai" capabilityLabel="Chat" hasKey={data?.hasOpenaiKey ?? false} value={effOpenaiChat} onChange={setOpenaiChatModel} />
              <ModelPicker provider="openai" capabilityLabel="Vision" hasKey={data?.hasOpenaiKey ?? false} value={effOpenaiVision} onChange={setOpenaiVisionModel} />
            </div>
          )}

          {(effectiveProvider === "auto" || effectiveProvider === "gemini") && (
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-navy)]">
                Gemini API Key <span className="text-xs text-[var(--color-accent)] font-semibold">(Default for photo verification)</span>
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
              <ModelPicker provider="gemini" capabilityLabel="Chat" hasKey={data?.hasGeminiKey ?? false} value={effGeminiChat} onChange={setGeminiChatModel} />
              <ModelPicker provider="gemini" capabilityLabel="Vision" hasKey={data?.hasGeminiKey ?? false} value={effGeminiVision} onChange={setGeminiVisionModel} />
            </div>
          )}

          {(effectiveProvider === "auto" || effectiveProvider === "claude") && (
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-navy)]">
                Anthropic API Key <span className="text-xs text-[var(--color-muted)]">(Available — used only as a fallback in Auto, or select &quot;Claude only&quot; above)</span>
              </label>
              <div className="relative">
                <input
                  type={showClaude ? "text" : "password"}
                  value={claudeKey}
                  onChange={(e) => setClaudeKey(e.target.value)}
                  placeholder={data?.hasClaudeKey ? "•••••••• (key already set)" : "sk-ant-..."}
                  className="input-base w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowClaude((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
                >
                  {showClaude ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <ModelPicker provider="claude" capabilityLabel="Chat" hasKey={data?.hasClaudeKey ?? false} value={effClaudeChat} onChange={setClaudeChatModel} />
              <ModelPicker provider="claude" capabilityLabel="Vision" hasKey={data?.hasClaudeKey ?? false} value={effClaudeVision} onChange={setClaudeVisionModel} />
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

/**
 * A per-capability model dropdown backed by the provider's live model-list
 * endpoint — this is what keeps model selection from silently going stale as
 * providers deprecate old IDs and ship new ones. Falls back to a static list
 * (server-side) when the live fetch fails, and always keeps the currently
 * selected id selectable even if it's since fallen out of either list.
 */
function ModelPicker({
  provider,
  capabilityLabel,
  hasKey,
  value,
  onChange,
}: {
  provider: CatalogProvider;
  capabilityLabel: string;
  hasKey: boolean;
  value: string;
  onChange: (id: string) => void;
}) {
  const { data, isFetching, refetch } = useQuery<ModelCatalogResponse>({
    queryKey: ["model-catalog", provider],
    queryFn: async () => {
      const res = await fetch(`/api/settings/models?provider=${provider}`);
      if (!res.ok) throw new Error(`Failed to load models: ${res.status}`);
      return res.json();
    },
    enabled: hasKey,
    staleTime: 5 * 60 * 1000, // re-checks for new/retired models every 5 min, not on every render
  });

  if (!hasKey) {
    return (
      <p className="mt-1.5 text-xs text-[var(--color-muted)]">
        Save the API key above, then come back here to pick a specific {capabilityLabel} model.
      </p>
    );
  }

  const fetched = data?.models ?? [];
  const options = value && !fetched.some((m) => m.id === value) ? [{ id: value }, ...fetched] : fetched;

  return (
    <div className="mt-2">
      <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{capabilityLabel} model</label>
      <div className="flex items-center gap-2">
        <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base flex-1 text-sm">
          {options.length === 0 && <option value="">{isFetching ? "Loading…" : "No models found"}</option>}
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label ? `${m.label} (${m.id})` : m.id}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Refresh the model list from the provider"
          className="shrink-0 rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-muted)] hover:text-[var(--color-brand)] disabled:opacity-50"
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
        </button>
      </div>
      {data && (
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">
          {data.live ? "Live list fetched from the provider just now." : `Showing a saved fallback list${data.error ? ` — ${data.error}` : ""}.`}
        </p>
      )}
    </div>
  );
}

function StatusCard({
  label,
  hasKey,
  exhausted,
  badge,
}: {
  label: string;
  hasKey: boolean;
  exhausted: boolean;
  badge?: string;
}) {
  const color = exhausted ? "text-red-600" : hasKey ? "text-green-600" : "text-[var(--color-muted)]";
  const bg = exhausted ? "bg-red-50 border-red-200" : hasKey ? "bg-green-50 border-green-200" : "bg-[var(--color-surface)] border-[var(--color-border)]";
  const Icon = exhausted ? XCircle : hasKey ? CheckCircle2 : XCircle;
  const status = exhausted ? "Quota exceeded" : hasKey ? "Key configured" : "No key";

  return (
    <div className={`rounded-xl border px-3 py-3 ${bg}`}>
      <div className="flex items-center justify-between gap-1">
        <p className="text-xs font-medium text-[var(--color-muted)] truncate">{label}</p>
        {badge && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-brand)]/70">{badge}</span>}
      </div>
      <div className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${color}`}>
        <Icon size={14} /> {status}
      </div>
    </div>
  );
}
