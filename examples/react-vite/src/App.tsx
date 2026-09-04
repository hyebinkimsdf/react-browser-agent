import { useEffect, useState } from "react";
import { BrowserAIProvider, useBrowserChat } from "@browser-ai-sdk/react";
import { allBrowserTools, createRuleBasedRouter } from "@browser-ai-sdk/tools";
import "./App.css";

// Tool calling needs a model that's actually decent at it — HF's own
// integration guide recommends a reasoning model like Qwen3 over MVP 1's
// tiny SmolLM2-360M for this reason.
//
// Tried Qwen3-1.7B for better Korean quality (0.6B's Korean output was
// noticeably broken). OOMs with std::bad_alloc on WASM (CPU) — expected,
// low memory ceiling. Re-tested with a real GPU (WebGPU actually acquired
// this time, confirmed via console — no "GPU adapter unavailable" fallback
// warning) and it OOM'd the same way. onnxruntime-web's WebGPU execution
// provider still loads/parses the model graph through its WASM host
// runtime before handing tensor math to the GPU, so the same WASM memory
// ceiling applies on both paths — this isn't a device="auto" config
// problem, it's a current limitation of this stack for a model this size.
// Reverted to 0.6B, which is known to work end-to-end.
const MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";

// Testing whether a scoping system prompt reduces overthinking on clear-cut
// tool-calling requests, keeping thinking ON (unlike /no_think, which skips
// reasoning entirely and risks tool-selection accuracy).
//
// Also testing whether explicit instructions curb two failure modes seen at
// 0.6B (see QUANTIZATION-RESULTS.md): (1) reasoning-style narration leaking
// as plain text after </think> instead of stopping, and (2) answers reusing
// a generic template instead of responding to what the user actually said.
const SYSTEM_PROMPT =
  "You are a browser automation assistant. For clear, unambiguous requests, " +
  "reason briefly (a sentence or two at most) and go straight to calling the " +
  "right tool or answering. Don't enumerate every possibility when the answer is obvious. " +
  "All reasoning must stay strictly inside <think></think> tags. Once you close </think>, " +
  "output ONLY the final answer in Korean — no restating what you're about to say, no meta " +
  "commentary about the user's message, and stop generating as soon as the answer is complete. " +
  "Respond specifically to what the user just said instead of reusing a generic greeting or template.";

function Chat() {
  const { messages, sendMessage, isLoading, status, progress, error, activeTool } =
    useBrowserChat();
  const [input, setInput] = useState("");
  const [demoInputValue, setDemoInputValue] = useState("");
  const [demoClicked, setDemoClicked] = useState(false);

  // Visible timer: how long the current/last message actually took, so
  // this is checkable without DevTools (see MVP2-RESULTS.md speed tests).
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (status !== "streaming" || sentAt === null) return;
    const id = setInterval(() => setElapsedSec((Date.now() - sentAt) / 1000), 200);
    return () => clearInterval(id);
  }, [status, sentAt]);

  const handleSend = () => {
    if (!input.trim()) return;
    setSentAt(Date.now());
    setElapsedSec(0);
    sendMessage(input);
    setInput("");
  };

  return (
    <main className="chat-card">
      <h1 id="page-title">Browser AI SDK — MVP 3</h1>
      <p className="chat-subtitle">
        <code>BrowserAIProvider tools={"{"}allBrowserTools{"}"}</code> · 모델:{" "}
        <code>{MODEL_ID}</code>
      </p>

      {/* Elements the model's clickElement/fillInput tools can target. */}
      <div className="demo-target-row">
        <input
          id="demo-name-input"
          placeholder="이름을 입력하세요"
          value={demoInputValue}
          onChange={(e) => setDemoInputValue(e.target.value)}
        />
        <button
          id="demo-accept-button"
          type="button"
          className={demoClicked ? "demo-clicked" : ""}
          onClick={() => setDemoClicked(true)}
        >
          {demoClicked ? "클릭됨!" : "동의"}
        </button>
      </div>

      <div className="chat-status">
        상태: {status}
        {status === "loading-model" && ` · ${progress}%`}
        {sentAt !== null && (status === "streaming" || status === "ready") && (
          <span className="chat-timer"> · {elapsedSec.toFixed(1)}초</span>
        )}
      </div>

      {activeTool && (
        <div className={`chat-tool-call chat-tool-call-${activeTool.status}`}>
          🔧 {activeTool.toolName}({JSON.stringify(activeTool.input)})
          {activeTool.status === "done" && ` → ${JSON.stringify(activeTool.output)}`}
          {activeTool.status === "error" && " (실패)"}
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            아직 대화가 없습니다. 예: "#demo-accept-button 버튼을 클릭해줘"
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-message chat-message-${m.role}`}>
            <span className="chat-message-role">
              {m.role === "user" ? "나" : "AI"}
            </span>
            <span className="chat-message-content">
              {m.isThinking && <span className="chat-thinking">🤔 생각 중…</span>}
              {m.content || (isLoading && !m.isThinking ? "…" : "")}
              {/* SDK exposes m.reasoning separately from m.content — the app
                  decides whether/how to show it. Here: an opt-in <details>. */}
              {m.reasoning && (
                <details className="chat-reasoning">
                  <summary>생각 과정 보기</summary>
                  <p>{m.reasoning}</p>
                </details>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="chat-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          disabled={status === "loading-model"}
          placeholder={status === "loading-model" ? "모델 로딩 중..." : "메시지를 입력하세요"}
        />
        <button onClick={handleSend} disabled={status === "loading-model" || status === "streaming"}>
          보내기
        </button>
      </div>

      {error && <div className="chat-error">{error}</div>}
    </main>
  );
}

function App() {
  return (
    // Testing: cap generation length instead of/alongside the system
    // prompt — 2048 vs the provider's 8192 default when thinking is on.
    // Risk: if the model is still mid-<think> at 2048, generation just
    // stops there with no final answer at all (no budget awareness).
    <BrowserAIProvider
      model={MODEL_ID}
      device="auto"
      dtype="fp16"
      tools={allBrowserTools}
      router={createRuleBasedRouter()}
      enableThinking={true}
      systemPrompt={SYSTEM_PROMPT}
      maxOutputTokens={2048}
    >
      <Chat />
    </BrowserAIProvider>
  );
}

export default App;
