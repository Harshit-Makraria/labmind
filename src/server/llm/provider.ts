/**
 * Provider-agnostic LLM layer.
 *
 * DEMO_MODE never reaches here — tools/agent short-circuit to deterministic logic.
 *
 * "auto" provider waterfall: OpenAI (gpt-4o-mini) → Gemini (gemini-1.5-flash) → demo.
 * A 429 / quota error marks that provider exhausted and falls to the next.
 *
 * Three capabilities: completeJSON, completeVision, completeWithTools.
 */
import "server-only";
import { getConfig, type LabmindConfig } from "@/server/config";
import { markExhausted, isExhausted } from "@/server/llm/provider-state";

export interface VisionInput {
  imageBase64: string;
  prompt: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolTurnResult {
  toolCalls: ToolCall[];
  text: string;
}

// ─── Quota-error detection ──────────────────────────────────────────

function isQuotaError(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status === 402) return true;
  const lower = body.toLowerCase();
  return (
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("insufficient_quota") ||
    lower.includes("exceeded")
  );
}

// ─── Public API ─────────────────────────────────────────────────────

export async function completeJSON(system: string, user: string): Promise<string> {
  const c = getConfig();
  if (c.llmProvider === "auto") return autoCompleteJSON(c, system, user);
  if (c.llmProvider === "gemini") return geminiText(c, system, user);
  if (c.llmProvider === "openai" || c.llmProvider === "azure")
    return openaiChat(c, [{ role: "system", content: system }, { role: "user", content: user }]);
  if (c.llmProvider === "claude") return anthropicChat(c, system, [{ role: "user", content: user }]);
  throw new Error("LLM called in demo mode");
}

export async function completeVision(system: string, input: VisionInput): Promise<string> {
  const c = getConfig();
  if (c.llmProvider === "auto") return autoCompleteVision(c, system, input);
  if (c.llmProvider === "gemini") return geminiVision(c, system, input);
  if (c.llmProvider === "claude") {
    return anthropicChat(c, system, [{
      role: "user",
      content: [
        { type: "text", text: input.prompt },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.imageBase64 } },
      ],
    }]);
  }
  return openaiVisionChat(c, system, input);
}

export async function completeWithTools(
  system: string,
  messages: { role: "user" | "assistant" | "tool"; content: string; toolName?: string }[],
  tools: ToolSchema[],
): Promise<ToolTurnResult> {
  const c = getConfig();
  if (c.llmProvider === "auto") return autoCompleteWithTools(c, system, messages, tools);
  if (c.llmProvider === "gemini") return geminiTools(c, system, messages, tools);
  if (c.llmProvider === "claude") return anthropicTools(c, system, messages, tools);
  return openaiTools(c, system, messages, tools);
}

// ─── Auto waterfall ──────────────────────────────────────────────────

// Auto waterfall order: Claude → GPT-4o → Gemini → demo
// Claude is default; GPT-4o kicks in if Claude key is exhausted.

async function autoCompleteJSON(c: LabmindConfig, system: string, user: string): Promise<string> {
  if (c.anthropicApiKey && !isExhausted("anthropic")) {
    try {
      return await anthropicChat(c, system, [{ role: "user", content: user }]);
    } catch (e) {
      if (isQuotaErr(e)) { markExhausted("anthropic"); console.warn("[LLM] Claude quota hit — falling back to GPT-4o"); }
      else throw e;
    }
  }
  if (c.openaiApiKey && !isExhausted("openai")) {
    try {
      return await openaiChat(c, [{ role: "system", content: system }, { role: "user", content: user }]);
    } catch (e) {
      if (isQuotaErr(e)) { markExhausted("openai"); console.warn("[LLM] GPT-4o quota hit — falling back to Gemini"); }
      else throw e;
    }
  }
  if (c.geminiApiKey && !isExhausted("gemini")) {
    try {
      return await geminiText(c, system, user);
    } catch (e) {
      if (isQuotaErr(e)) { markExhausted("gemini"); }
      else throw e;
    }
  }
  throw new Error("ALL_KEYS_EXHAUSTED");
}

async function autoCompleteVision(c: LabmindConfig, system: string, input: VisionInput): Promise<string> {
  if (c.anthropicApiKey && !isExhausted("anthropic")) {
    try {
      return await anthropicChat(c, system, [{
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.imageBase64 } },
        ],
      }]);
    } catch (e) {
      if (isQuotaErr(e)) { markExhausted("anthropic"); console.warn("[VISION] Claude quota hit — falling back to GPT-4o"); }
      else throw e;
    }
  }
  if (c.openaiApiKey && !isExhausted("openai")) {
    try {
      return await openaiVisionChat(c, system, input);
    } catch (e) {
      if (isQuotaErr(e)) { markExhausted("openai"); console.warn("[VISION] GPT-4o quota hit — falling back to Gemini"); }
      else throw e;
    }
  }
  if (c.geminiApiKey && !isExhausted("gemini")) {
    try {
      return await geminiVision(c, system, input);
    } catch (e) {
      if (isQuotaErr(e)) { markExhausted("gemini"); }
      else throw e;
    }
  }
  throw new Error("ALL_KEYS_EXHAUSTED");
}

async function autoCompleteWithTools(
  c: LabmindConfig,
  system: string,
  messages: { role: "user" | "assistant" | "tool"; content: string; toolName?: string }[],
  tools: ToolSchema[],
): Promise<ToolTurnResult> {
  if (c.anthropicApiKey && !isExhausted("anthropic")) {
    try {
      return await anthropicTools(c, system, messages, tools);
    } catch (e) {
      if (isQuotaErr(e)) { markExhausted("anthropic"); console.warn("[LLM] Claude quota hit — falling back to GPT-4o"); }
      else throw e;
    }
  }
  if (c.openaiApiKey && !isExhausted("openai")) {
    try {
      return await openaiTools(c, system, messages, tools);
    } catch (e) {
      if (isQuotaErr(e)) { markExhausted("openai"); console.warn("[LLM] GPT-4o quota hit — falling back to Gemini"); }
      else throw e;
    }
  }
  if (c.geminiApiKey && !isExhausted("gemini")) {
    try {
      return await geminiTools(c, system, messages, tools);
    } catch (e) {
      if (isQuotaErr(e)) { markExhausted("gemini"); }
      else throw e;
    }
  }
  throw new Error("ALL_KEYS_EXHAUSTED");
}

function isQuotaErr(e: unknown): boolean {
  if (e instanceof Error) return isQuotaError(0, e.message);
  return false;
}

// ─── Gemini ──────────────────────────────────────────────────────────

function geminiUrl(c: LabmindConfig, method: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${c.geminiModel}:${method}?key=${c.geminiApiKey}`;
}

async function geminiText(c: LabmindConfig, system: string, user: string): Promise<string> {
  const res = await fetch(geminiUrl(c, "generateContent"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (isQuotaError(res.status, body)) throw new Error(`QUOTA:${res.status}: ${body}`);
    throw new Error(`Gemini error ${res.status}: ${body}`);
  }
  return geminiTextOf(JSON.parse(body) as GeminiResponse);
}

async function geminiVision(c: LabmindConfig, system: string, input: VisionInput): Promise<string> {
  const res = await fetch(geminiUrl(c, "generateContent"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{
        role: "user",
        parts: [
          { text: input.prompt },
          { inlineData: { mimeType: "image/jpeg", data: input.imageBase64 } },
        ],
      }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (isQuotaError(res.status, body)) throw new Error(`QUOTA:${res.status}: ${body}`);
    throw new Error(`Gemini vision error ${res.status}: ${body}`);
  }
  return geminiTextOf(JSON.parse(body) as GeminiResponse);
}

async function geminiTools(
  c: LabmindConfig,
  system: string,
  messages: { role: "user" | "assistant" | "tool"; content: string; toolName?: string }[],
  tools: ToolSchema[],
): Promise<ToolTurnResult> {
  const contents = messages.map((m) => {
    if (m.role === "tool") {
      return { role: "user", parts: [{ functionResponse: { name: m.toolName, response: { result: m.content } } }] };
    }
    return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
  });
  const res = await fetch(geminiUrl(c, "generateContent"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (isQuotaError(res.status, body)) throw new Error(`QUOTA:${res.status}: ${body}`);
    throw new Error(`Gemini tools error ${res.status}: ${body}`);
  }
  const data = JSON.parse(body) as GeminiResponse;
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const toolCalls: ToolCall[] = [];
  let text = "";
  for (const p of parts) {
    if (p.functionCall) toolCalls.push({ name: p.functionCall.name, args: p.functionCall.args ?? {} });
    else if (p.text) text += p.text;
  }
  return { toolCalls, text };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[] } }[];
}
function geminiTextOf(data: GeminiResponse): string {
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

// ─── OpenAI / Azure ──────────────────────────────────────────────────

// Vision-specific OpenAI call: uses gpt-4o (not gpt-4o-mini) for accuracy,
// avoids response_format json_object which can conflict with image inputs on some versions.
async function openaiVisionChat(c: LabmindConfig, system: string, input: VisionInput): Promise<string> {
  const { url, headers, isAzure } = openaiEndpoint(c);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: isAzure ? undefined : "gpt-4o",
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${input.imageBase64}`, detail: "high" } },
          ],
        },
      ],
      temperature: 0.1,   // low temperature for precise numeric readings
      max_tokens: 800,    // enough for full JSON + reasoning notes
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (isQuotaError(res.status, body)) throw new Error(`QUOTA:${res.status}: ${body}`);
    throw new Error(`OpenAI vision error ${res.status}: ${body}`);
  }
  const data = JSON.parse(body) as { choices: { message: { content: string } }[] };
  const raw = data.choices[0]?.message?.content ?? "";
  // Strip markdown code fences if model wraps response in ```json ... ```
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

async function openaiChat(c: LabmindConfig, messages: unknown[]): Promise<string> {
  const { url, headers, isAzure } = openaiEndpoint(c);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: isAzure ? undefined : c.openaiModel,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (isQuotaError(res.status, body)) throw new Error(`QUOTA:${res.status}: ${body}`);
    throw new Error(`OpenAI error ${res.status}: ${body}`);
  }
  const data = JSON.parse(body) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}

async function openaiTools(
  c: LabmindConfig,
  system: string,
  messages: { role: "user" | "assistant" | "tool"; content: string; toolName?: string }[],
  tools: ToolSchema[],
): Promise<ToolTurnResult> {
  const { url, headers, isAzure } = openaiEndpoint(c);
  const msgs: unknown[] = [{ role: "system", content: system }];

  // OpenAI requires: assistant msg with tool_calls → tool result msgs.
  // Our orchestrator stores synthetic pairs: { role:"assistant", content:"calling X" } + { role:"tool", toolName:"X" }.
  // Convert each assistant+following-tool-messages block into proper format.
  const callId = (name: string) => `call_${name.replace(/\W/g, "_")}`;
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === "assistant") {
      // Collect all immediately following tool messages
      const toolResults: typeof messages = [];
      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool") {
        toolResults.push(messages[j]);
        j++;
      }
      if (toolResults.length > 0) {
        // Emit one assistant message with tool_calls, then all tool results
        msgs.push({
          role: "assistant",
          content: null,
          tool_calls: toolResults.map((tr) => ({
            id: callId(tr.toolName ?? "tool"),
            type: "function",
            function: { name: tr.toolName ?? "unknown", arguments: "{}" },
          })),
        });
        for (const tr of toolResults) {
          msgs.push({ role: "tool", content: tr.content, tool_call_id: callId(tr.toolName ?? "tool") });
        }
        i = j;
      } else {
        msgs.push({ role: "assistant", content: m.content });
        i++;
      }
    } else if (m.role === "tool") {
      i++; // already consumed above; skip orphans
    } else {
      msgs.push({ role: m.role, content: m.content });
      i++;
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: isAzure ? undefined : c.openaiModel,
      messages: msgs,
      tools: tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (isQuotaError(res.status, body)) throw new Error(`QUOTA:${res.status}: ${body}`);
    throw new Error(`OpenAI tools error ${res.status}: ${body}`);
  }
  const data = JSON.parse(body) as {
    choices: { message: { content: string | null; tool_calls?: { function: { name: string; arguments: string } }[] } }[];
  };
  const msg = data.choices[0]?.message;
  const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
    name: tc.function.name,
    args: safeParse(tc.function.arguments),
  }));
  return { toolCalls, text: msg?.content ?? "" };
}

function openaiEndpoint(c: LabmindConfig) {
  const isAzure = c.llmProvider === "azure";
  const url = isAzure
    ? `${c.azureEndpoint}/openai/deployments/${c.azureDeployment}/chat/completions?api-version=${c.azureApiVersion}`
    : "https://api.openai.com/v1/chat/completions";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (isAzure) headers["api-key"] = c.azureApiKey ?? "";
  else headers["Authorization"] = `Bearer ${c.openaiApiKey ?? ""}`;
  return { url, headers, isAzure };
}

// ─── Anthropic ───────────────────────────────────────────────────────

async function anthropicChat(c: LabmindConfig, system: string, messages: unknown[]): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: anthropicHeaders(c),
    body: JSON.stringify({ model: c.anthropicModel, max_tokens: 1500, system, messages }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (isQuotaError(res.status, body)) throw new Error(`QUOTA:${res.status}: ${body}`);
    throw new Error(`Anthropic error ${res.status}: ${body}`);
  }
  const data = JSON.parse(body) as { content: { type: string; text?: string }[] };
  // Strip markdown fences in case Claude wraps JSON in ```json ... ```
  const raw = data.content.map((b) => b.text ?? "").join("");
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

async function anthropicTools(
  c: LabmindConfig,
  system: string,
  messages: { role: "user" | "assistant" | "tool"; content: string; toolName?: string }[],
  tools: ToolSchema[],
): Promise<ToolTurnResult> {
  const msgs = messages.map((m) =>
    m.role === "tool"
      ? { role: "user", content: [{ type: "tool_result", tool_use_id: m.toolName ?? "t", content: m.content }] }
      : { role: m.role, content: m.content },
  );
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: anthropicHeaders(c),
    body: JSON.stringify({
      model: c.anthropicModel,
      max_tokens: 1500,
      system,
      messages: msgs,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic tools error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    content: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
  };
  const toolCalls: ToolCall[] = [];
  let text = "";
  for (const b of data.content) {
    if (b.type === "tool_use" && b.name) toolCalls.push({ name: b.name, args: b.input ?? {} });
    else if (b.type === "text" && b.text) text += b.text;
  }
  return { toolCalls, text };
}

function anthropicHeaders(c: LabmindConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": c.anthropicApiKey ?? "",
    "anthropic-version": "2023-06-01",
  };
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}
