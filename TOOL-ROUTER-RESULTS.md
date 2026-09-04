# Tool Router 도입 결과 (2026-09-04)

"Qwen이 모든 걸 다 처리하는 것 같고, 그래서 느리다"는 지적에서 시작된 개선 작업 기록.

## 원인

`packages/core/src/index.ts`의 `sendMessage()`를 보면, 사용자가 뭘 입력하든 분기 없이 무조건 `streamText({ model: Qwen, tools })`로 넘어가는 구조였다. `transformers.js`는 ONNX 가중치를 로드하고 WASM/WebGPU 위에서 forward pass를 실행하는 순수 추론 엔진일 뿐, 의도 분류나 라우팅 같은 건 전혀 해주지 않는다 — 그래서 의도 판단, `<think>` 추론, 툴 선택, 최종 답변까지 전부 Qwen3-0.6B 하나의 오토리그레시브 스트림 안에서 처리되고 있었다.

구체적인 비용 요인:

- `enableThinking: true`가 항상 켜져 있어([App.tsx:154](examples/react-vite/src/App.tsx#L154)) 아무리 단순한 요청도 매번 `<think>` 블록부터 생성
- 툴콜 시 `MAX_TOOL_STEPS = 5`([core/src/index.ts:5](packages/core/src/index.ts#L5))까지 멀티스텝 — 스텝마다 프롬프트 전체를 다시 처리하고 새로 추론
- `allBrowserTools` 6개가 매 턴 전부 프롬프트에 노출되어([App.tsx:153](examples/react-vite/src/App.tsx#L153)) 판단할 선택지 자체가 많음

## 생각

- 모델을 GPT/Gemma로 바꾸는 방안도 검토했지만 기각했다. GPT는 `onnx-community`에 20B/120B(`gpt-oss`)만 있어 소형 변형 자체가 없고, 이미 1.7B에서도 OOM나는 현재 메모리 한계상 애초에 불가능하다. Gemma3(270M/1B)는 크기상 후보는 되지만, 지금 Qwen3를 고른 이유가 "HF 공식 통합 가이드가 툴콜용으로 추천"했기 때문인데 Gemma3는 그런 검증된 툴콜 레퍼런스가 없어 이 SDK의 핵심 기능(Tool 시스템)을 처음부터 다시 검증해야 하는 리스크가 있었다.
- 근본적으로 브라우저 WASM/CPU 추론 자체의 속도 한계는 모델을 바꿔도 해결되지 않는다고 판단했다. 대신 **"모든 요청을 Qwen에 위임하지 않는" 구조**로 바꾸기로 했다 — 명확한 패턴은 모델 없이 즉시 처리하고, 애매한 자연어만 기존처럼 Qwen에 넘기는 하이브리드 라우팅.
- guide.md 13번의 "Core와 Adapter 분리" 원칙에 맞춰, `core`는 제네릭한 `router` 훅만 제공하고, 실제 셀렉터 패턴 매칭 같은 tool-specific 지식은 `tools` 패키지에 두기로 했다 — core가 CSS 셀렉터 문법을 알 필요는 없다.

## 시도

- **`packages/core`**: `ToolRouter` 타입(`(text) => { toolName, input } | null`)과 `createChatController`의 `router` 옵션 추가. `sendMessage()`가 `streamText` 호출 전에 `router(trimmed)`를 먼저 체크하고, 매칭되면 `tools[toolName].execute()`를 직접 호출한 뒤 즉시 리턴한다 (모델 호출 자체를 생략).
- **`packages/tools`**: `createRuleBasedRouter()` 추가. `clickElement`/`fillInput`/`scrollPage`에 대한 정규식 3개로, `#`이나 `.`으로 시작하는 명시적 셀렉터가 포함된 경우만 매칭한다. 매칭 실패 시 `null`을 반환해 기존 Qwen 흐름으로 그대로 폴백 — 커버리지를 넓히려 하지 않고, 뻔한 패턴만 좁게 잡는 쪽을 택했다.
- **`packages/react`** / **`examples/react-vite`**: `BrowserAIProvider`에 `router` prop 추가, `App.tsx`에서 `createRuleBasedRouter()` 연결.
- 타입 이슈 하나: `ToolSet[string]["execute"]`가 `Tool<...>` 4종 union이라 하나의 호출 가능한 시그니처로 좁혀지지 않고(`input: never` 오버로드가 섞여 나옴), 로컬 `RoutedToolExecute` 타입 + 통제된 캐스팅으로 우회했다 (사유는 core/src/index.ts 주석 참고).

## 결과

- `tsc -b --noEmit` 클린 통과.
- headless Chromium(Playwright)으로 실측: `"#demo-accept-button 버튼을 클릭해줘"` 전송 → **102ms 만에** 버튼이 "클릭됨!"으로 반영. Qwen 호출 없이 즉시 처리됨을 확인, 콘솔 에러 없음.
- **라우팅 대상이 아닌 일반 대화는 이번 변경으로 개선되지 않는다.** 사용자가 실측한 `"안녕"` 34.1초는 셀렉터가 없어 라우터에 걸리지 않고 기존과 동일하게 Qwen 전체 파이프라인(`<think>` 포함 `streamText`)을 그대로 탄 결과다. 즉 라우터의 직접적 효과가 아니라 baseline Qwen 추론 속도로 봐야 한다. (참고용 비교: MVP2에서 비슷한 인사말이 44초, MVP3 초기 tool 호출 시도는 4분 넘게 걸렸던 기록이 있다 — 그 대비로는 34.1초 자체가 나쁘지 않은 수치이나, 이번 라우터 작업이 그 숫자를 직접 줄였다고 보긴 어렵다.)

## 결론 / 남은 과제

- 명시적 셀렉터가 포함된 상호작용 요청(클릭/입력/스크롤)은 Qwen 없이 100ms 내로 처리되는 것을 확인했다 — 해당 케이스에 한해 체감 속도 개선은 확실하다.
- 일반 대화나 애매한 요청의 속도는 여전히 Qwen 단일 모델의 추론 속도(WASM/CPU 한계)에 그대로 묶여 있다 — 이건 라우터로 해결되는 문제가 아니다.
- 다음으로 시도해볼 만한 것:
  1. 라우터 커버리지를 `getPageText`처럼 인자가 필요 없는 읽기 전용 툴까지 넓힐지 검토.
  2. 라우팅되지 않는 일반 대화 경로 자체의 지연(주로 `<think>` 오버헤드) 축소 — 짧은 요청엔 thinking을 끄는 방향 등.
  3. `<think>` 파싱/표시 개선은 MVP2·MVP3부터 이어지는 별개의 미해결 과제로 남아 있다.
