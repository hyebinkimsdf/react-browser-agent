import { streamText, stepCountIs, type ToolSet } from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";

/** Cap on how many tool-call steps a single sendMessage() can chain (guide.md 14, MVP 2). */
const MAX_TOOL_STEPS = 5;

/**
 * Runtime Interface — Core owns this shape (guide.md 13-③).
 * A Runtime Adapter (e.g. the Transformers.js adapter) implements it;
 * Core never imports a specific provider directly.
 */
export type RuntimeAvailability = "unavailable" | "downloadable" | "available";

export interface BrowserAIRuntime {
  readonly modelId: string;
  availability(): Promise<RuntimeAvailability>;
  /** Resolves once the model is ready to use, reporting 0-100 download progress along the way. */
  prepare(onProgress?: (percent: number) => void): Promise<LanguageModelV4>;
  dispose(): void;
}

/**
 * Chat Interface — Core owns this too. It's the thin layer between a
 * BrowserAIRuntime and Vercel AI SDK's streamText, framework-agnostic
 * (guide.md 13-①: usable outside React).
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Final answer text — never contains <think> markup, even with thinking on. */
  content: string;
  /**
   * Text from inside <think>...</think> (Qwen3-style reasoning models),
   * parsed out of the raw stream — empty string for non-reasoning models
   * or turns where the model didn't reason. The SDK never renders this;
   * showing it (e.g. in a collapsible <details>) is entirely up to the
   * consuming app.
   */
  reasoning: string;
  /** True while the model is inside an unclosed <think> block right now. */
  isThinking: boolean;
}

/** Splits a model's raw output into (reasoning, content, isThinking) around <think>...</think>. */
function parseThinking(raw: string): { content: string; reasoning: string; isThinking: boolean } {
  const start = raw.indexOf("<think>");
  if (start === -1) {
    return { content: raw, reasoning: "", isThinking: false };
  }

  const afterStart = start + "<think>".length;
  const end = raw.indexOf("</think>", afterStart);
  const before = raw.slice(0, start);

  if (end === -1) {
    return { content: before, reasoning: raw.slice(afterStart), isThinking: true };
  }

  const reasoning = raw.slice(afterStart, end).trim();
  const after = raw.slice(end + "</think>".length).replace(/^\n+/, "");
  return { content: before + after, reasoning, isThinking: false };
}

export type ChatStatus = "loading-model" | "ready" | "streaming" | "error";

/** A Browser Tool call in flight or just finished (guide.md 14, MVP 3 — Tool execution 상태 관리). */
export interface ActiveToolCall {
  toolName: string;
  input: unknown;
  status: "calling" | "done" | "error";
  output?: unknown;
}

export interface ChatState {
  status: ChatStatus;
  /** 0-100, only meaningful while status is "loading-model". */
  progress: number;
  messages: ChatMessage[];
  error: string | null;
  /** The most recent tool call this turn, or null between turns / once finished. */
  activeTool: ActiveToolCall | null;
}

export interface ChatController {
  getState(): ChatState;
  subscribe(listener: () => void): () => void;
  sendMessage(text: string): Promise<void>;
  stop(): void;
  dispose(): void;
}

function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function createChatController(
  runtime: BrowserAIRuntime,
  options: { tools?: ToolSet; enableThinking?: boolean } = {},
): ChatController {
  const { tools, enableThinking } = options;
  let state: ChatState = {
    status: "loading-model",
    progress: 0,
    messages: [],
    error: null,
    activeTool: null,
  };
  const listeners = new Set<() => void>();
  let model: LanguageModelV4 | null = null;
  let abortController: AbortController | null = null;

  function setState(patch: Partial<ChatState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  const readyPromise = runtime
    .prepare((percent) => setState({ progress: percent }))
    .then((resolvedModel) => {
      model = resolvedModel;
      setState({ status: "ready", progress: 100 });
    })
    .catch((err) => {
      setState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    });

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || state.status === "streaming") return;

    await readyPromise;
    if (!model) return; // prepare() failed — state already reflects the error

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
      reasoning: "",
      isThinking: false,
    };
    const assistantMessage: ChatMessage = {
      id: createId(),
      role: "assistant",
      content: "",
      reasoning: "",
      isThinking: false,
    };
    let rawAssistantText = "";

    setState({
      status: "streaming",
      error: null,
      activeTool: null,
      messages: [...state.messages, userMessage, assistantMessage],
    });

    abortController = new AbortController();

    try {
      const promptMessages = state.messages
        .filter((m) => m.id !== assistantMessage.id)
        .map((m) => ({ role: m.role, content: m.content }));

      // Qwen's chat template only pre-empties <think> when enable_thinking
      // is explicitly false — @browser-ai/transformers-js's option only
      // ever *adds* enable_thinking:true, never sends false (see
      // MVP2-RESULTS.md), so that template branch never fires. "/no_think"
      // is a trained, prompt-level behavior in Qwen3 itself (independent of
      // the template variable) — append it only to the outgoing prompt, not
      // to the displayed ChatMessage.content.
      if (enableThinking === false) {
        const last = promptMessages.at(-1);
        if (last?.role === "user") last.content = `${last.content} /no_think`;
      }

      const result = streamText({
        model,
        messages: promptMessages,
        abortSignal: abortController.signal,
        ...(tools ? { tools, stopWhen: stepCountIs(MAX_TOOL_STEPS) } : {}),
        // "transformers-js" provider key: see @browser-ai/transformers-js
        // dist/index.mjs — reads providerOptions["transformers-js"].enableThinking.
        ...(enableThinking !== undefined
          ? { providerOptions: { "transformers-js": { enableThinking } } }
          : {}),
      });

      // fullStream (not textStream) so tool-call/tool-result events surface too.
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta": {
            rawAssistantText += part.text;
            const parsed = parseThinking(rawAssistantText);
            setState({
              messages: state.messages.map((m) =>
                m.id === assistantMessage.id ? { ...m, ...parsed } : m,
              ),
            });
            break;
          }
          case "tool-call":
            setState({
              activeTool: { toolName: part.toolName, input: part.input, status: "calling" },
            });
            break;
          case "tool-result":
            setState({
              activeTool: {
                toolName: part.toolName,
                input: part.input,
                status: "done",
                output: part.output,
              },
            });
            break;
          case "tool-error":
            setState({
              activeTool: { toolName: part.toolName, input: part.input, status: "error" },
            });
            break;
        }
      }

      setState({ status: "ready", activeTool: null });
    } catch (err) {
      setState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function stop() {
    abortController?.abort();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sendMessage,
    stop,
    dispose: () => runtime.dispose(),
  };
}
