import { useState } from "react";
import { BrowserAIProvider, useBrowserChat } from "@browser-ai-sdk/react";
import { allBrowserTools } from "@browser-ai-sdk/tools";
import "./App.css";

// Tool calling needs a model that's actually decent at it — HF's own
// integration guide recommends a reasoning model like Qwen3 over MVP 1's
// tiny SmolLM2-360M for this reason.
const MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";

function Chat() {
  const { messages, sendMessage, isLoading, status, progress, error, activeTool } =
    useBrowserChat();
  const [input, setInput] = useState("");
  const [demoInputValue, setDemoInputValue] = useState("");
  const [demoClicked, setDemoClicked] = useState(false);

  const handleSend = () => {
    if (!input.trim()) return;
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
            <span className="chat-message-content">{m.content || (isLoading ? "…" : "")}</span>
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
    <BrowserAIProvider model={MODEL_ID} device="auto" dtype="q4" tools={allBrowserTools}>
      <Chat />
    </BrowserAIProvider>
  );
}

export default App;
