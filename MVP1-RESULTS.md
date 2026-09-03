# MVP 1 결과 (2026-09-03)

guide.md 14번 "MVP 1 — React + Local Model + Chat" 구현 및 실행 검증 기록.

## 무엇을 만들었나

`packages/core`, `packages/transformers`, `packages/react`로 이루어진 최소 monorepo. `poc/`와 달리 provider를 직접 호출하지 않고, guide.md 13번 원칙대로 Core가 `Runtime Interface`/`Chat Interface`를 소유하고 어댑터가 그걸 구현하는 구조로 실제 코드를 짰다.

```
packages/
 ├─ core/          Runtime Interface, Chat Interface, createChatController (React 비의존)
 ├─ transformers/  Transformers Adapter — @browser-ai/transformers-js를 감쌈
 └─ react/         BrowserAIProvider, useBrowserChat (Core+Transformers Adapter를 연결)

examples/react-vite/   실제로 이 패키지들을 소비하는 React+Vite 앱
```

목표 API 그대로 동작한다:

```tsx
<BrowserAIProvider model="HuggingFaceTB/SmolLM2-360M-Instruct" device="auto">
  <Chat />
</BrowserAIProvider>
```
```tsx
const { messages, sendMessage, isLoading } = useBrowserChat();
```

## 실행 결과 (headless Chromium, Playwright)

- 모델 로딩: `상태: loading-model` → progress 0~100% 실시간 반영 → `상태: ready`.
- `device="auto"`로 지정하니 **WebGPU 실패가 에러가 아니라 warning으로 처리되고 자동으로 WASM으로 넘어감** (`removing requested execution provider "webgpu"... because it is not available`). PoC 때 직접 짠 `["webgpu","wasm"]` 재시도 루프보다 이 방식이 더 안정적이라는 걸 확인 — 그래서 `packages/transformers`는 기본값을 `device: "auto"`로 두고 자체 재시도 로직은 넣지 않았다.
- 메시지 전송 → 스트리밍 응답 정상 수신 (`"Hello."`), 콘솔 에러/크래시 없음.

## guide.md 13-⑤ PoC 기준과 비교해 새로 확인된 것

- 기준 7 "Chat 상태 관리가 React에서 자연스럽게 동작" — `useSyncExternalStore` + `createChatController`(core)로 실제 통과. PoC는 로컬 `useState`로 흉내만 냈던 부분.
- 기준 10 "provider 장애/변경 시 우리 SDK 공개 API 유지 가능" — 구조적으로는 만족(`BrowserAIProvider`/`useBrowserChat`은 `@browser-ai/transformers-js`를 몰라도 됨, `packages/transformers`만 알고 있음). 다만 실제로 provider를 교체해보진 않았으니 완전한 검증은 아니다.

## Worker/모델 dispose lifecycle (2026-09-03 추가 수정)

`BrowserAIProvider` unmount 시 dispose를 한 tick 지연시키고, 그 사이에 재마운트가 오면 취소하는 방식으로 구현했다. React StrictMode의 mount→unmount→mount는 동기적으로 일어나므로 이 지연·취소로 버텨내고, 실제 unmount(재마운트가 뒤따르지 않음)에는 정상적으로 Worker를 종료한다.

**처음 구현에 버그가 있었다**: 취소 로직을 컴포넌트 render 본문에 뒀더니, StrictMode의 phantom cleanup→remount 사이에는 render가 다시 일어나지 않아서 취소가 발동하지 않고 실제로 Worker가 죽어버렸다 (모델 로딩이 영원히 끝나지 않는 채로 확인됨). 취소 로직을 `useEffect`의 setup 함수 안으로 옮기고 나서야 — setup은 StrictMode가 다시 호출해주므로 — 의도대로 동작했다. Playwright로 재검증: StrictMode 이중 마운트에서 정상적으로 `ready`까지 도달했고, 실제 unmount→remount에서도 새 Worker로 재로딩이 정상 진행됐다.

## 알려진 한계 (의도적으로 미룬 것)

- **Tool Calling 없음**: guide.md 14번 MVP 2 범위. `AI SDK Warning: toolChoice is not supported`는 우리가 안 써서 나는 정상적인 경고.
- **`ai`/`@ai-sdk/provider` 버전 고정 여부 미검토**: `@browser-ai/transformers-js`의 peer dependency(`ai: ^7.0.0`)에 맞춰 설치했지만, 버전 범위 정책은 아직 안 정했다.

## 다음 단계

guide.md 14번 MVP 2 — 읽기 전용 Browser Tool 3개(`getPageText`, `getSelectedText`, `findElement`) 추가.
