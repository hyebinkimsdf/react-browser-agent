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

## 후속 검증 (2026-09-04): 실제 GPU에서도 1.7B는 안 됨 — 가설 정정

한국어 품질 개선을 위해 `Qwen3-1.7B-ONNX`(`dtype="q4f16"`, 1.43GB)로 다시 시도해봤다. 처음엔 "headless 테스트 환경에 GPU가 없어서 WASM으로 떨어진 게 원인"이라고 판단해서, 실제 GPU가 있는 사용자 브라우저에서 재검증했다.

**결과: 실제 GPU(WebGPU)로도 똑같이 `std::bad_alloc`.** 콘솔에 `"GPU adapter unavailable"` 같은 폴백 경고는 없었고, 오히려 WebGPU 어댑터가 실제로 잡혔을 때만 뜨는 Chrome 경고(`powerPreference ignored on Windows`)가 있었다 — 즉 이번엔 진짜 GPU 경로로 시도했는데도 실패한 것.

**"GPU면 될 것"이라는 가설은 틀렸다.** onnxruntime-web의 WebGPU 실행 경로도 모델 그래프 로딩/파싱 자체는 WASM 호스트 런타임을 거친 뒤에야 실제 행렬 연산을 GPU로 넘긴다 — 그래서 WASM의 메모리 천장이 CPU 경로든 GPU 경로든 똑같이 적용된다. `device="auto"` 설정 문제가 아니라, 이 정도 크기 모델에 대한 현재 스택(Transformers.js/onnxruntime-web)의 구조적 한계로 판단하고 0.6B로 되돌렸다.

## 후속 확인 (2026-09-04): `enableThinking: false`로 thinking을 못 끔

`<think>` 블록이 그대로 노출되는 문제(위 "알려진 한계" 참고)를 줄여보려고, `@browser-ai/transformers-js`가 지원하는 `providerOptions["transformers-js"].enableThinking` 옵션을 `packages/core`/`packages/react`에 배선하고(`enableThinking` prop) 실제로 `false`를 넣어 테스트했다.

**결과: 그대로 `<think>`가 나온다.** provider 소스(`dist/index.mjs`)를 보면 원인이 명확하다:

```js
const enableThinking = transformersJsOptions?.enableThinking ?? false;
...
...enableThinking ? { enable_thinking: true } : {}
```

`false`일 땐 `enable_thinking: false`를 명시적으로 안 보내고 **그냥 아무것도 안 보낸다.** Qwen3 채팅 템플릿이 그 값이 없을 때 기본으로 thinking을 켜는 것으로 보인다 — 즉 이 옵션은 "켜기"만 되고 "끄기"는 안 되는 반쪽 스위치다. `packages/react`의 `enableThinking` prop 자체는 남겨뒀다(정상적으로 provider에 값을 전달하는 배선이라 `true`를 넘기는 용도로는 유효), 다만 docstring에 이 한계를 명시했고 예제 앱에선 뺐다.

## 후속 확인 (2026-09-04): `/no_think`는 실제로 됨

원인을 더 파보니, Qwen3의 채팅 템플릿 자체엔 `enable_thinking is defined and is false`일 때 `<think>\n\n</think>\n\n`을 미리 채워 넣는 로직이 있다:

```jinja
{%- if enable_thinking is defined and enable_thinking is false %}
    {{- '<think>\n\n</think>\n\n' }}
{%- endif %}
```

문제는 provider가 `false`일 때 이 변수 자체를 안 보낸다는 것(위 참고) — 그래서 이 분기가 발동을 못 했던 것. 이건 우회할 방법이 없어 보여서, 대신 **모델 자체에 학습돼 있다는 `/no_think` 프롬프트 지시어**를 시도했다: `enableThinking === false`일 때 `packages/core`의 `sendMessage`가 실제로 모델에 보내는 프롬프트의 마지막 사용자 메시지 끝에 ` /no_think`를 붙이도록 했다(화면에 표시되는 `ChatMessage.content`는 그대로 두고, 모델에 보내는 값만 조작).

**결과: 됐다.** 응답이 `"<think>\n\n</think>\n\nHello!"`로 나왔다 — `<think>` 태그 자체는 남아있지만 **안이 비어있다**(실제 추론 텍스트를 생성 안 함). 속도도 확 빨라졌다: 메시지 전송부터 완료까지 **44초** (MVP 3에서 비슷한 인사말에 4분 넘게 걸렸던 것과 비교됨).

즉 template의 `enable_thinking:false` 프리필과 똑같은 결과(빈 think 블록)를, provider 버그를 우회해서 프롬프트 레벨로 얻어냈다. 빈 `<think></think>` 자체는 여전히 텍스트로 남아있어서, UI에서 완전히 깔끔하게 보이려면 정규식으로 걸러내는 후처리가 추가로 필요하다(아직 안 함).

## 후속 확인 (2026-09-04): thinking은 켠 채로, `<think>`만 화면에서 분리

`/no_think`로 껐을 때 나오는 속도 이득은 확인했지만, tool calling 정확도엔 thinking이 도움된다는 게 애초에 이 모델을 고른 이유였다(위 참고). 그래서 thinking은 켠 채로 유지하고, **`<think>` 텍스트 자체를 화면에 안 보이게** 하는 쪽으로 방향을 잡았다.

`packages/core`의 `ChatMessage`에 `reasoning: string`과 `isThinking: boolean`을 추가하고, `text-delta`가 올 때마다 누적된 원본 텍스트를 매번 다시 파싱해서 `<think>...</think>` 안쪽은 `reasoning`으로, 바깥쪽은 `content`로 분리했다(`parseThinking()`, 순수 함수라 유닛 테스트로 검증 — 스트리밍 중 청크가 태그 중간에서 끊기는 경우 포함). `ChatMessage.content`는 이제 **thinking을 켜든 끄든 `<think>` 마크업이 절대 안 들어간다.**

**설계 결정: SDK는 reasoning을 감추지 않고 분리만 한다.** `content`/`reasoning`을 어떻게 보여줄지(숨기기/접기/펼치기)는 전적으로 SDK를 쓰는 앱의 몫이다 — `examples/react-vite`에서는 `reasoning`이 있으면 `<details>`로 접어서 보여주는 식으로 데모했다(기본은 접힘, 원하면 펼쳐볼 수 있음).

실제 테스트 결과: 화면엔 `"Hey there! 🌟"`만 보이고 `<think>` 텍스트는 전혀 노출 안 됨, `.chat-reasoning` 안에 실제 추론 텍스트("Okay, the user wants a short sentence...")가 정상적으로 들어있는 것 확인. `isThinking`이 true인 동안 "🤔 생각 중…" 표시도 정상 동작.

## 다음 단계

이대로 MVP 3(Agent, 다중 Tool 연속 호출, 상호작용 Tool)로 넘어가기 전에, tool 호출 완결 여부를 더 가벼운(0.6B 이하) 모델로 한 번 더 확인하는 걸 권장한다 — "더 큰 모델 + GPU"는 이번 검증으로 막힌 경로다.
