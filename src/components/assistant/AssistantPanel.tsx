"use client";

import { Bot, Cpu, Loader2, Send, Sparkles, User, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { streamAgentChat } from "@/lib/api-client";
import type { ChatMessage } from "@/lib/types";

interface Pending {
  plan: string;
  trace: { tool: string; summary: string }[];
  answer: string;
}

const EMPTY: Pending = { plan: "", trace: [], answer: "" };

export function AssistantPanel({
  sessionId,
  experimentId,
  currentStep,
  suggestions = [],
  heightClass = "h-[70vh]",
}: {
  sessionId?: string;
  experimentId?: string;
  currentStep?: number;
  suggestions?: string[];
  heightClass?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = pending !== null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const userMsg: ChatMessage = { role: "user", content: q, at: new Date().toISOString() };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, userMsg]);

    let acc: Pending = { ...EMPTY };
    setPending(acc);
    try {
      await streamAgentChat(
        { session_id: sessionId, experiment_id: experimentId, current_step: currentStep, message: q, history },
        (e) => {
          if (e.type === "plan") acc = { ...acc, plan: e.text ?? "" };
          else if (e.type === "tool_call") acc = { ...acc, trace: [...acc.trace, { tool: e.tool ?? "tool", summary: e.text ?? "" }] };
          else if (e.type === "tool_result") {
            const t = [...acc.trace];
            if (t.length) t[t.length - 1] = { ...t[t.length - 1], summary: `${t[t.length - 1].summary} → ${e.text ?? ""}` };
            acc = { ...acc, trace: t };
          } else if (e.type === "delta") acc = { ...acc, answer: acc.answer + (e.text ?? "") };
          else if (e.type === "error") acc = { ...acc, answer: acc.answer + `\n[${e.text}]` };
          setPending({ ...acc });
        },
      );
    } catch (err) {
      acc = { ...acc, answer: acc.answer || `Connection error: ${(err as Error).message}` };
    }

    setMessages((m) => [
      ...m,
      { role: "assistant", content: acc.answer || "(no answer)", trace: acc.trace, at: new Date().toISOString() },
    ]);
    setPending(null);
  }

  return (
    <div className={`flex flex-col ${heightClass}`}>
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && !pending && <EmptyState onPick={send} suggestions={suggestions} />}

        {messages.map((m, i) =>
          m.role === "user" ? <UserBubble key={i} text={m.content} /> : <AssistantBubble key={i} msg={m} />,
        )}

        {pending && <PendingBubble pending={pending} />}
      </div>

      {suggestions.length > 0 && messages.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-black/5 px-3 pt-2">
          {suggestions.slice(0, 3).map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={busy}
              className="chip bg-[var(--color-brand)]/8 text-[var(--color-brand)] hover:bg-[var(--color-brand)]/15 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-black/5 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask LabMind anything about your experiment…"
          className="min-h-[46px] flex-1 rounded-[var(--radius-btn)] border border-black/12 px-4 text-[15px] outline-none focus:border-[var(--color-brand)]"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[var(--radius-btn)] bg-[var(--color-navy)] text-white disabled:opacity-40"
          aria-label="Send"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </form>
    </div>
  );
}

function EmptyState({ onPick, suggestions }: { onPick: (s: string) => void; suggestions: string[] }) {
  const fallback = [
    "Is it safe to mix HCl and NaOH?",
    "Calculate my concentration if the titre was 24.6 mL",
    "Why is my pink colour fading?",
    "What experiments can I run?",
  ];
  const chips = suggestions.length ? suggestions : fallback;
  return (
    <div className="fade-in flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-accent)] text-white shadow">
        <Sparkles size={26} />
      </div>
      <div>
        <p className="text-lg font-bold text-[var(--color-navy)]">Your AI lab partner</p>
        <p className="mt-1 max-w-sm text-sm text-[var(--color-muted)]">
          Ask about safety, calculations, technique, or what to do next. I use real tools and show my reasoning.
        </p>
      </div>
      <div className="flex max-w-md flex-wrap justify-center gap-2">
        {chips.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm text-[var(--color-navy)] hover:border-[var(--color-brand)]/40 hover:bg-[var(--color-brand)]/5"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="fade-in flex justify-end gap-2">
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[var(--color-navy)] px-4 py-2.5 text-[15px] text-white">
        {text}
      </div>
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-navy)]/10 text-[var(--color-navy)]">
        <User size={15} />
      </div>
    </div>
  );
}

function AssistantBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className="fade-in flex gap-2">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-accent)] text-white">
        <Bot size={15} />
      </div>
      <div className="max-w-[82%] space-y-2">
        {msg.trace && msg.trace.length > 0 && <TraceBlock trace={msg.trace} />}
        <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 text-[15px] text-[var(--color-ink)] shadow-sm ring-1 ring-black/5">
          {msg.content}
        </div>
      </div>
    </div>
  );
}

function PendingBubble({ pending }: { pending: Pending }) {
  return (
    <div className="fade-in flex gap-2">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-accent)] text-white">
        <Bot size={15} />
      </div>
      <div className="max-w-[82%] space-y-2">
        <div className="rounded-xl border border-[var(--color-brand)]/20 bg-[var(--color-brand)]/[0.04] p-2.5 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--color-brand)]">
            <Cpu size={13} className="animate-pulse" /> {pending.plan || "Thinking…"}
          </div>
          {pending.trace.map((t, i) => (
            <div key={i} className="mt-1 flex items-start gap-1.5 text-[var(--color-muted)]">
              <Wrench size={12} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
              <span>
                <span className="font-mono font-semibold text-[var(--color-navy)]">{t.tool}</span> {t.summary}
              </span>
            </div>
          ))}
        </div>
        {pending.answer && (
          <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 text-[15px] text-[var(--color-ink)] shadow-sm ring-1 ring-black/5">
            {pending.answer}
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-[var(--color-brand)]/60 align-middle" />
          </div>
        )}
      </div>
    </div>
  );
}

function TraceBlock({ trace }: { trace: { tool: string; summary: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-black/8 bg-black/[0.02] text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 font-semibold text-[var(--color-muted)]"
      >
        <Wrench size={12} className="text-[var(--color-accent)]" />
        Reasoning · {trace.length} tool {trace.length === 1 ? "call" : "calls"}
        <span className="ml-auto">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-1 px-2.5 pb-2">
          {trace.map((t, i) => (
            <div key={i} className="text-[var(--color-muted)]">
              <span className="font-mono font-semibold text-[var(--color-navy)]">{t.tool}</span> {t.summary}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
