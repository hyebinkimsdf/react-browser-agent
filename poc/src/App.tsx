import { useCallback, useRef, useState } from "react";
import { streamText } from "ai";
import {
  transformersJS,
  doesBrowserSupportTransformersJS,
  type TransformersJSLanguageModel,
} from "@browser-ai/transformers-js";
import "./App.css";

const MODEL_ID = "HuggingFaceTB/SmolLM2-360M-Instruct";

type Status =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "generating"
  | "error";

function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [device, setDevice] = useState<"webgpu" | "wasm" | null>(null);
  const [progress, setProgress] = useState(0);
  const [prompt, setPrompt] = useState("Say hello in one short sentence.");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ttft, setTtft] = useState<number | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);

  const modelRef = useRef<TransformersJSLanguageModel | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const loadModel = useCallback(async () => {
    setError(null);
    setStatus("checking");

    // PoC 기준 3, 4: WebGPU 사용 가능 여부 감지, 불가 시 WASM으로 폴백
    const supported = doesBrowserSupportTransformersJS();
    if (!supported) {
      setStatus("error");
      setError("이 브라우저는 WebGPU/WASM을 모두 지원하지 않습니다.");
      return;
    }

    const hasWebGPU = "gpu" in navigator;
    const devicesToTry: Array<"webgpu" | "wasm"> = hasWebGPU
      ? ["webgpu", "wasm"]
      : ["wasm"];

    let lastErr: unknown = null;

    for (const candidate of devicesToTry) {
      // PoC 기준 9: 추론을 메인 스레드가 아닌 Worker에서 실행
      const worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });

      try {
        const model = transformersJS(MODEL_ID, {
          device: candidate,
          worker,
        });

        const availability = await model.availability();

        if (availability === "unavailable") {
          throw new Error(`"${candidate}" 디바이스에서 모델을 사용할 수 없습니다.`);
        }

        if (availability === "downloadable") {
          setStatus("downloading");
          setProgress(0);
          // PoC 기준 6: 다운로드 progress 확인 가능
          await model.createSessionWithProgress((progress) => {
            setProgress(Math.round(progress * 100));
          });
        }

        // 성공: 이 디바이스로 확정
        workerRef.current = worker;
        modelRef.current = model;
        setDevice(candidate);
        setStatus("ready");
        return;
      } catch (err) {
        // PoC 기준 4: WebGPU 실패 시 다음 후보(WASM)로 폴백
        worker.terminate();
        lastErr = err;
      }
    }

    setStatus("error");
    setError(
      lastErr instanceof Error
        ? lastErr.message
        : "모델 로딩에 실패했습니다 (WebGPU/WASM 모두 실패).",
    );
  }, []);

  const send = useCallback(async () => {
    if (!modelRef.current || !prompt.trim()) return;

    setStatus("generating");
    setAnswer("");
    setError(null);

    const start = performance.now();
    let firstTokenAt: number | null = null;

    try {
      // PoC 기준 5: streaming 응답이 정상 동작
      const result = streamText({
        model: modelRef.current,
        prompt,
      });

      for await (const chunk of result.textStream) {
        if (firstTokenAt === null) {
          firstTokenAt = performance.now();
          setTtft(Math.round(firstTokenAt - start));
        }
        setAnswer((prev) => prev + chunk);
      }

      setTotalMs(Math.round(performance.now() - start));
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [prompt]);

  return (
    <main className="poc-card">
      <h1>Browser AI SDK — PoC</h1>
      <p className="poc-subtitle">
        모델: <code>{MODEL_ID}</code> · 목표: 모델 로딩 + 메시지 1개 스트리밍
        (guide.md 13번 원칙 ⑤)
      </p>

      <div className="poc-status">
        <span>상태: {status}</span>
        {device && <span> · 디바이스: {device}</span>}
        {status === "downloading" && <span> · {progress}%</span>}
      </div>

      {status === "idle" && (
        <button type="button" onClick={loadModel}>
          모델 로딩 시작
        </button>
      )}

      {status === "downloading" && (
        <div className="poc-progress-wrap">
          <div className="poc-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}

      {(status === "ready" || status === "generating") && (
        <>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={status === "generating"}
          />
          <button
            type="button"
            onClick={send}
            disabled={status === "generating"}
          >
            {status === "generating" ? "생성 중..." : "메시지 보내기"}
          </button>
        </>
      )}

      {answer && (
        <div className="poc-answer">
          <div className="poc-answer-text">{answer}</div>
          <div className="poc-metrics">
            {ttft !== null && <span>TTFT: {ttft}ms</span>}
            {totalMs !== null && <span> · 총 소요: {totalMs}ms</span>}
          </div>
        </div>
      )}

      {error && <div className="poc-error">{error}</div>}
    </main>
  );
}

export default App;
