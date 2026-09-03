# PoC 결과 (2026-09-03)

`guide.md` 13번 원칙 ⑤에 따라 진행한 최소 PoC의 실행 결과. 환경: headless Chromium(Playwright), React 19 + Vite, `@browser-ai/transformers-js` 3.0.2, 모델 `HuggingFaceTB/SmolLM2-360M-Instruct`.

## 실행 요약

1. 모델 다운로드 성공 (progress 0→100% 실시간 반영 확인).
2. **WebGPU 요청이 실제로 실패**했다 (`Failed to get GPU adapter`, headless 환경 특성). 코드가 이를 잡아 **자동으로 WASM으로 재시도**했고, 재시도가 성공해 `상태: ready · 디바이스: wasm`으로 전환됨.
3. 메시지 1개 전송 → 스트리밍 응답 정상 수신 (`"Hello."`).
4. 페이지 크래시/unhandled exception 없음.

측정값 (참고용, 목표 수치 아님 — guide.md 13-⑤ 참고):

- TTFT: 1656ms
- 총 응답 소요: 1660ms
- (WebGPU 대비 CPU 성능 비교는 이번 환경에서 WebGPU 자체가 불가능해 측정 불가 — 실제 GPU가 있는 환경에서 재측정 필요)

## 10개 기준 대조

| # | 기준 | 결과 |
|---|---|---|
| 1 | React + Vite 환경에서 정상 동작 | ✅ |
| 2 | 로컬 모델 로딩 성공 | ✅ |
| 3 | WebGPU 환경에서 추론 가능 | ⚠️ 미검증 — 이 환경엔 실제 GPU 어댑터가 없어 코드 경로만 확인됨. GPU 있는 환경에서 재검증 필요 |
| 4 | WebGPU 미지원/실패 시 WASM fallback 가능 | ✅ 실제로 실패 → 폴백까지 전 과정이 그대로 재현됨 |
| 5 | Streaming 응답 정상 동작 | ✅ |
| 6 | 모델 다운로드 progress 확인 가능 | ✅ |
| 7 | Chat 상태 관리가 React에서 자연스럽게 동작 | ⚠️ 부분 검증 — 이번 PoC는 최소 범위라 단일 메시지만 다룸. `useChat` 전체 통합은 MVP 1에서 검증 |
| 8 | Browser Tool 1개 이상 호출 가능 | 이번 PoC 범위 밖 (MVP 2에서 검증) |
| 9 | Main Thread를 과도하게 block하지 않음 | ✅ Worker 통해 실행, UI 응답성 유지됨 (정밀 측정은 아직 안 함) |
| 10 | provider 장애/변경 시 우리 SDK 공개 API 유지 가능 | 구조적 항목 — 이번 PoC는 provider를 직접 호출해 검증 안 됨. `Runtime Interface` 뒤에 감싼 뒤 재검증 필요 |

## 발견한 것

- `@browser-ai/transformers-js`는 **문서 그대로 동작**했다 (`transformersJS()`, `availability()`, `createSessionWithProgress()`, `TransformersJSWorkerHandler` 모두 실제 타입 정의와 동작이 일치 — HF 문서 내용이 실제 코드와 어긋나지 않음을 확인).
- 라이브러리 자체는 WebGPU 실패를 조용히 삼키지 않고 에러를 던진다 — **폴백 로직은 우리 쪽(Runtime Interface/Adapter)에서 직접 구현해야 한다**는 게 이번에 실증됨. (지금 PoC 코드는 `loadModel`에서 `["webgpu", "wasm"]` 순서로 직접 재시도하는 방식으로 구현.)
- `@huggingface/transformers`의 Node.js 백엔드(`onnxruntime-node`, `sharp`)에 걸린 npm audit high severity 취약점은 브라우저 실행 경로에서는 번들되지 않으므로 이 SDK 관점에선 영향 없음 — 다만 서버사이드 폴백(guide.md 2번 WebGPU 섹션에서 언급한 서버 폴백)을 실제로 쓸 경우 재확인 필요.

## 다음 단계

- 판단 기준 6가지(guide.md 13-⑤)와 이번 결과를 종합하면 **`@browser-ai/transformers-js` 채택 가능** 쪽으로 기운다. 단, 실제 GPU 환경에서의 WebGPU 동작(#3)과 provider 뒤에 `Runtime Interface`를 씌운 뒤의 동작(#10)은 아직 미검증이므로, MVP 1 구현 과정에서 확인한다.
- 다음은 `guide.md` 14번 MVP 1(React + Local Model + Chat, `useChat` 통합 포함)로 진행.
