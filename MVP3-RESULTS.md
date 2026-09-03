# MVP 3 결과 (2026-09-03)

guide.md 14번 "MVP 3 — Browser Agent" 구현 및 검증 기록.

## 무엇을 만들었나

- **`packages/tools`**: 상호작용 Tool 3개 추가 — `clickElement`, `fillInput`, `scrollPage`. `readOnlyBrowserTools` + `interactionBrowserTools` = `allBrowserTools`로 묶었다.
- **`packages/core`**: `sendMessage`가 `result.textStream` 대신 `result.fullStream`을 소비하도록 바꿨다 — `text-delta`뿐 아니라 `tool-call`/`tool-result`/`tool-error` 이벤트까지 받기 위해서다. `ChatState`에 `activeTool`(호출 중/완료/실패 중인 tool 1개) 필드를 추가했다 — guide.md 14번이 명시한 "Tool execution 상태 관리".
- **`packages/react`**: `useBrowserChat()`이 `activeTool`을 반환하도록 확장.
- **`examples/react-vite`**: `allBrowserTools` 연결, `activeTool` UI 표시, `clickElement`/`fillInput`이 실제로 조작할 수 있는 데모 엘리먼트(`#demo-name-input`, `#demo-accept-button`) 추가.

## 검증 방법을 바꿨다 — 실제 모델 대신 가짜 모델로 유닛 테스트

MVP2에서 0.6B reasoning 모델이 이 환경에서 4분 넘게 걸려도 tool 호출을 못 끝내는 걸 봤기 때문에, `fullStream` 리팩터가 맞는지를 매번 느린 실제 모델로 기다려서 확인하는 건 비효율적이라고 판단했다. 대신 **`LanguageModelV4` 스펙을 흉내 내는 가짜 모델**을 만들어 `packages/core`의 `createChatController`에 직접 주입하고, 결정적(deterministic)으로 상태 전이를 확인했다 (스크립트는 검증 후 삭제, 저장소에는 안 남김).

**이 과정에서 실제 버그를 하나 찾았다** — 처음 만든 가짜 모델은 `finishReason: "tool-calls"`처럼 문자열을 넣었는데, 실제 `LanguageModelV4FinishReason`은 `{ unified: 'tool-calls' | 'stop' | ..., raw: string }` 형태의 객체여야 한다. 문자열을 넣으면 AI SDK 내부의 `isToolExecutionAllowedFinishReason()` 체크가 조용히 실패해서 **tool의 `execute()`가 아예 호출되지 않고, 두 번째 스텝으로도 안 넘어간다** — 에러 없이 그냥 1스텝 만에 조용히 끝나버린다. 이건 우리 `packages/core` 코드의 버그가 아니라 테스트용 가짜 모델의 스펙 오류였지만, 고치고 나니 다음이 전부 확인됐다:

- tool-call 발생 시 `activeTool.status === "calling"`
- tool 실행 완료 시 `activeTool.status === "done"`, `output`에 실제 실행 결과
- 여러 스텝에 걸친 text-delta가 하나의 assistant 메시지로 올바르게 합쳐짐
- 최종적으로 `status === "ready"`, `activeTool === null`로 정리됨

## 실제 브라우저에서의 회귀 확인

`fullStream`으로 바꾼 게 일반 텍스트 스트리밍(도구 호출 없이)까지 망가뜨리지 않았는지는 실제로 확인했다: 모델 로딩(캐시 덕에 ~30초) → `ready` → 메시지 전송 → 스트리밍 시작(`<think>` 블록 생성 중)까지 콘솔 에러 없이 정상 진행. 다만 이번에도 tool 호출까지 실제로 완료되는 걸 끝까지 기다리진 않았다 (MVP2와 동일한 속도 문제이며, 위 유닛 테스트로 로직 자체는 이미 검증했기 때문에 반복 확인은 비효율적이라 판단).

## 알려진 한계

- **실제 모델 + 실제 브라우저에서 tool 호출이 끝까지 완료되는 걸 눈으로 확인한 적은 아직 없다.** 유닛 테스트(가짜 모델)로 로직은 검증했지만, 실제 Qwen3-0.6B가 우리 tool 스키마를 보고 올바른 tool을 실제로 골라 호출하는지는 여전히 미확인 — MVP2에서 남긴 숙제가 그대로 이어진다.
- `clickElement`/`fillInput`을 모델이 실제로 사용해서 데모 버튼을 클릭하거나 입력창을 채우는 것도 아직 관찰하지 못했다.
- reasoning 모델의 `<think>` 블록이 여전히 최종 답변과 섞여서 `ChatMessage.content`에 들어간다 (MVP2와 동일한 한계, 아직 미해결).
- Cancellation(`stop()`)은 tool 호출 중간에 끊었을 때도 correctly 정리되는지 별도로 검증하지 않았다.

## 다음 단계

1. 실제 GPU가 있는 브라우저 환경이나 더 가벼운 tool-calling 모델로, tool 호출이 실제로 끝까지 완료되고 `clickElement`가 데모 버튼을 누르는 것까지 눈으로 확인.
2. `<think>` 추론과 최종 답변을 UI에서 구분해서 보여주는 처리.
3. 위 유닛 테스트 방식(가짜 `LanguageModelV4`)을 vitest 등으로 정식 테스트 스위트로 만들어 회귀를 계속 잡을 수 있게 하는 것 — 지금은 검증 후 버렸지만 값어치가 있었다.
