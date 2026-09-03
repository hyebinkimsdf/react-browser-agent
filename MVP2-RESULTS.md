# MVP 2 결과 (2026-09-03)

guide.md 14번 "MVP 2 — Browser Tools" 구현 및 실행 검증 기록.

## 무엇을 만들었나

- **`packages/tools`** (신규): 읽기 전용 Browser Tool 3개 — `getPageText`, `getSelectedText`, `findElement`. `ai`의 `tool()` + `jsonSchema()`로 정의 (zod 의존성 없이).
- **`packages/core`**: `createChatController(runtime, { tools })`가 `streamText`에 `tools`와 `stopWhen: stepCountIs(5)`를 넘겨 다중 스텝 tool 호출을 지원하도록 확장. `tools`를 안 넘기면 기존 MVP 1 동작(단일 스텝)과 동일 — 동작 변화 없음.
- **`packages/react`**: `BrowserAIProvider`에 `tools` prop 추가, `dtype` prop도 함께 추가(아래 참고).
- **`examples/react-vite`**: `readOnlyBrowserTools`를 `BrowserAIProvider`에 연결. 모델을 `HuggingFaceTB/SmolLM2-360M-Instruct`(MVP1) → `onnx-community/Qwen3-0.6B-ONNX`로 교체 — HF 공식 통합 가이드가 tool calling엔 reasoning 모델을 권장했기 때문.

## 예상 밖의 문제 1: OOM, guide.md 9번이 예견한 바로 그 케이스

Qwen3-0.6B를 기본 dtype(WASM 기본값 q8)으로 로딩하니 `Can't create a session. ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc`로 실패했다. **"브라우저 미지원"이 아니라 정확히 guide.md 9번이 실제 실패 케이스로 지목했던 메모리 부족(OOM)**이 headless 테스트 환경에서 그대로 재현된 것.

대응: `packages/transformers`에 `dtype` 옵션을 추가해 `q4`로 낮췄다. `@browser-ai/transformers-js`가 Transformers.js의 `dtype` 옵션을 그대로 통과시켜준다는 걸 확인했고, `q4`로는 정상적으로 모델이 로딩됐다. → **Runtime Interface에 `dtype`을 추가한 것은 YAGNI 원칙에 맞는 확장이다**: 실제로 필요해진 시점(OOM 재현)에 최소한으로 추가했다.

## 예상 밖의 문제 2: tool 배선은 확인됐지만, 완결된 응답은 못 봄

`"현재 페이지 제목 알려줘"`류 프롬프트를 보냈을 때, 모델의 `<think>` 추론 블록에 **우리가 정의한 tool 이름과 설명이 정확히 등장했다**:

> "The available tools are getSelectedText, getPageText, and findElement. ... The findElement function is designed to find elements by a CSS selector..."

이건 tool 정의(`packages/tools`)가 `BrowserAIProvider` → `createChatController` → `streamText` → provider → 모델 프롬프트까지 **정확히 전달되고 있다는 구조적 증거**다. 다만 4분 이상 기다려도 이 작은 0.6B reasoning 모델이 이 (리소스가 제한된 headless) 환경의 WASM/CPU에서 `<think>` 블록조차 다 못 끝내고 실제 tool 호출까지 도달하지 못했다 — 속도가 문제지, 배선이 문제는 아니라고 판단한다.

**결론**: MVP 2의 아키텍처적 목표(Tool이 Core→Adapter→provider→모델까지 전달되고, 다중 스텝 실행 경로가 준비됨)는 검증됐다. 다만 "실제 사용자가 납득할 속도로 tool 호출이 끝까지 완료되는지"는 이 환경에서 확인하지 못했다 — 실제 GPU가 있는 브라우저나, 더 작고 non-reasoning인 tool-calling 모델로 재검증이 필요하다.

## 알려진 한계

- tool 호출이 실제 완료되는 것을 관찰하지 못했다 (위 참고). 완결된 라운드트립 검증은 남은 숙제.
- reasoning 모델(Qwen3)의 `<think>` 블록이 그대로 `ChatMessage.content`에 섞여 들어간다. UI에서 reasoning과 최종 답변을 구분해서 보여주는 처리는 없다 (MVP 3 이후 검토).
- Tool 호출/결과 자체를 `ChatState`에 노출하지 않는다 — guide.md도 이건 MVP 3("Tool execution 상태 관리") 범위로 명시했으므로 의도된 범위.

## 다음 단계

이대로 MVP 3(Agent, 다중 Tool 연속 호출, 상호작용 Tool)로 넘어가기 전에, tool 호출 완결 여부를 더 가벼운 모델이나 실제 GPU 환경에서 한 번 더 확인하는 걸 권장한다.
