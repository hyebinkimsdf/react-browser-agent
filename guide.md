# React 기반 Browser AI SDK 설계 및 구현 요청

나는 **React에 최적화된 브라우저 로컬 AI SDK**를 개발하려고 한다.

목표는 개발자가 복잡한 AI/모델/Web Worker/WebGPU/대화 상태 관리 등을 직접 구현하지 않아도, npm 패키지를 설치하고 몇 줄의 코드만 작성하면 **브라우저에서 실행되는 대화형 AI Agent**를 사용할 수 있도록 만드는 것이다.

## 1. 핵심 목표

다음과 같은 구조를 목표로 한다.

```text
┌──────────────────────────────┐
│       React Application       │
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│      My Browser AI SDK       │
│                              │
│  useBrowserAI()              │
│  useBrowserChat()            │
│  BrowserAIProvider           │
│                              │
│  Browser Tool System         │
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│      Adapter Layer           │
│                              │
│  Runtime Adapter             │
│  Chat Adapter                │
└───────┬──────────────┬───────┘
        ↓              ↓
Transformers.js     AI SDK
   (provider 경유)   (Vercel AI SDK)
        ↓              ↓
   Local Model      Chat/Tool
        ↓
 WebGPU / WASM
```

중요한 점은 **Vercel AI SDK를 사용한다고 해서 Next.js에 종속되는 SDK를 만들지는 않는 것**이다.

React + Vite 환경에서도 사용할 수 있어야 하며, Next.js는 선택적인 사용 환경으로 취급한다.

또한 이 SDK는 **"Transformers.js용 React Wrapper"가 아니라 "React에서 Local Browser AI Agent를 가장 쉽게 구축하게 해주는 SDK"**로 정의한다. Runtime(Transformers.js, `@browser-ai/transformers-js` 등)과 AI SDK(Vercel AI SDK 등)는 Adapter Layer 뒤에서 교체 가능한 부품으로 취급하고, React API + Browser Tool + Agent abstraction을 이 SDK의 실제 가치로 삼는다 (자세한 원칙은 13번 참고).

구현은 한 번에 전체를 만들지 않고 3단계 MVP로 나눈다 (자세한 내용은 14번 참고).

```text
MVP 1: React + Local Model + Chat
        ↓
MVP 2: Browser Tools
        ↓
MVP 3: Browser Agent
```

---

# 2. 각 기술의 역할

각 기술의 역할을 명확하게 분리해서 설계한다.

### Transformers.js

브라우저에서 실제 AI 모델을 실행하는 핵심 Runtime으로 사용한다.

- Hugging Face 모델 실행
- WASM
- WebGPU
- Quantized Model
- 브라우저 로컬 추론

### @browser-ai/transformers-js

Transformers.js와 Vercel AI SDK를 연결하는 provider 계층으로 검토한다.

**(2026-09 조사 결과, 상세는 부록 16 참고)** 실제로 존재하는 패키지이며 Hugging Face 공식 문서에도 통합 가이드가 있지만, **1인 개발자(jakobhoeg)가 유지하는 커뮤니티 패키지**다 (`@built-in-ai/transformers-js` → `@browser-ai/transformers-js`로 최근에 이름이 바뀜, 그 전엔 `@browser-ai/core`였음). Hugging Face나 Vercel이 직접 관리하는 "공식 provider"가 아니라는 점을 반드시 인지하고, 아래 13번 "Adapter Pattern" 원칙에 따라 Core가 이 패키지를 직접 import하지 않고 최소 인터페이스로 한 번 더 감싸서 의존한다. 짧은 기간에 두 번 이름이 바뀐 이력은 이 패키지가 아직 API 안정성이 낮은 초기 단계임을 시사한다.

한편 이 provider는 Web Worker 오케스트레이션, streaming, 다운로드 progress tracking, tool calling, `useChat` 커스텀 Transport 연동까지 이미 구현하고 있다. 즉 섹션 3~6에서 목표로 하는 기능 상당 부분을 처음부터 직접 구현하지 않고 이 provider를 런타임으로 채택 + 얇은 React 어댑터만 얹는 방식으로 대체할 수 있는지부터 먼저 검토한다 (섹션 11 참고).

### Vercel AI SDK

AI 애플리케이션 레이어로 사용한다.

특히 다음 기능을 활용한다.

- `useChat`
- Streaming
- Tool Calling
- Structured Output
- Message management
- AI 응답 상태 관리

단, Vercel AI SDK가 실제 모델 추론을 담당하는 것으로 생각하지 않는다.

### Web Worker

AI 추론 때문에 React의 Main Thread가 block되지 않도록 모델 추론을 Worker로 분리한다.

목표 구조:

```text
Main Thread
 ├─ React UI
 ├─ User Interaction
 └─ Browser AI SDK
          ↓
      Web Worker
          ↓
    Transformers.js
          ↓
       WebGPU
```

### WebGPU

가능한 환경에서는 GPU 가속을 사용한다.

WebGPU가 지원되지 않는 경우 WASM 등 적절한 fallback을 제공한다.

**(2026-09 조사 결과, 상세는 부록 16 참고)** 2026년 9월 기준 WebGPU는 Chrome/Edge 완전 지원, Firefox는 버전에 따라 부분 지원(141+ Windows, 145+ macOS Apple Silicon), Safari는 26부터 지원을 시작했다. WASM은 사실상 모든 모던 브라우저에서 지원되므로, 아래 "둘 다 사용 불가"라는 시나리오는 실제로는 거의 발생하지 않는다. 실전에서 마주치는 진짜 실패 케이스는 "WASM조차 미지원"이 아니라 **모델 다운로드/로딩 중 메모리 부족(OOM)**이나 **저사양 기기에서의 심각한 속도 저하**다. 에러 처리 설계는 "미지원 브라우저 안내"보다 이 두 케이스를 우선으로 다룬다.

---

# 3. SDK가 제공해야 하는 개발자 경험

최종적으로 React 개발자가 다음처럼 사용할 수 있는 수준을 목표로 한다.

```tsx
import { BrowserAIProvider, useBrowserAI, useBrowserChat } from "my-browser-ai";
```

예를 들어:

```tsx
<BrowserAIProvider model="Qwen..." device="webgpu">
  <App />
</BrowserAIProvider>
```

그리고 컴포넌트에서는:

```tsx
const { messages, sendMessage, isLoading, stop } = useBrowserChat();
```

처럼 사용할 수 있도록 한다.

사용자는 내부적으로 Transformers.js, Web Worker, AI SDK 등이 어떻게 연결되는지 몰라도 되게 한다.

---

# 4. 브라우저 AI의 핵심 기능

단순한 Chatbot SDK가 아니라 **Browser AI Agent SDK**를 목표로 한다.

AI가 단순히 답변하는 것뿐만 아니라 브라우저의 정보를 읽고 특정 작업을 수행할 수 있도록 한다.

이 섹션은 SDK의 최종 비전을 설명하는 것이며, 실제 구현 순서는 14번의 3단계 MVP(1: Chat만 → 2: 읽기 전용 Tool → 3: Agent)를 따른다.

예:

```text
사용자:
"현재 페이지에서 광고비가 가장 높은 캠페인을 찾아줘."

        ↓

AI
        ↓
Browser Tool 선택
        ↓
페이지 데이터 조회
        ↓
Transformers.js 모델 분석
        ↓
결과 생성
        ↓
사용자에게 답변
```

---

# 5. Browser Tool 시스템

SDK 내부에 Tool 시스템을 설계한다.

**처음부터 7개 Tool을 전부 만들지 않는다.** MVP 2(14번 참고)에서 단계적으로 늘려간다.

```text
1단계 (MVP 2 시작) — 읽기 전용 3개
  getPageText()
  getSelectedText()
  findElement()

        ↓

2단계 — 상호작용 Tool 추가
  click()
  fill()
  scroll()

        ↓

3단계 (MVP 3) — Agent가 여러 Tool을 연속 호출하는 구조로 발전
```

최종 형태 예:

```tsx
const ai = useBrowserAI({
  tools: {
    getPageText,
    findElement,
    getElement,
    clickElement,
    fillInput,
    scrollPage,
    getSelectedText,
  },
});
```

Tool은 AI가 호출할 수 있는 함수로 관리한다.

각 Tool에는 다음 정보가 필요하다.

```text
name
description
parameters
execute()
```

가능하면 AI SDK의 Tool Calling 구조를 활용하되, 브라우저 환경에 맞게 abstraction한다.

---

# 6. API 설계

SDK 사용자가 최대한 단순하게 사용할 수 있도록 API를 설계한다.

예상 API:

```tsx
useBrowserAI();
useBrowserChat();
useBrowserModel();
useBrowserTool();
```

Provider:

```tsx
<BrowserAIProvider />
```

또는 필요하다면:

```tsx
createBrowserAI();
```

같은 low-level API도 제공한다.

API 설계 시 다음을 고려한다.

- React Hooks
- Context
- TypeScript
- SSR 안전성
- Browser-only 실행
- Web Worker lifecycle
- Model loading 상태
- Model unloading
- Error handling
- Streaming
- Cancellation
- Tool execution
- Memory management

---

# 7. 상태 관리

React 상태와 AI 상태를 구분한다.

### React Client State

다음은 React 상태로 관리한다.

```text
isOpen
input
selectedTool
activeConversation
UI state
```

### AI State

AI SDK를 활용하여 다음을 관리한다.

```text
messages
streaming response
loading
error
tool call
tool result
abort
```

### Model Runtime State

Transformers.js/Worker 계층에서 관리한다.

```text
model loading
model loaded
model downloading
model progress
WebGPU availability
Worker state
memory/resource state
```

각 상태를 하나의 거대한 상태 객체에 넣지 말고 계층적으로 분리한다.

---

# 8. 성능 목표

AI SDK를 추가한다고 AI 모델 자체가 빨라지는 것은 아니다.

따라서 성능 최적화는 다음 계층에서 진행한다.

```text
Model
 ↓
Quantization
 ↓
Transformers.js
 ↓
WebGPU
 ↓
Web Worker
 ↓
Streaming
 ↓
React rendering optimization
```

특히 다음을 검토한다.

### Model

브라우저에서 현실적으로 실행 가능한 소형 모델을 우선 지원한다.

### Quantization

가능하면 4-bit / 8-bit 등 브라우저 환경에 적합한 양자화 모델을 지원한다.

### WebGPU

지원 여부를 감지하고 가능한 경우 WebGPU 사용.

### Worker

모델 추론은 기본적으로 Web Worker에서 실행하도록 설계한다.

### Streaming

AI 응답을 한 번에 전달하지 않고 가능한 경우 token/chunk 단위로 UI에 전달한다.

### React Rendering

Streaming 과정에서 불필요한 전체 React Tree re-render가 발생하지 않도록 설계한다.

---

# 9. Browser Compatibility

다음 환경을 고려한다.

```text
Chrome
Edge
Safari
Firefox
```

WebGPU 지원 여부가 브라우저마다 다를 수 있으므로 capability detection을 구현한다.

예:

```text
WebGPU 지원
 → WebGPU 사용

WebGPU 미지원
 → WASM fallback

모델 로딩 중 메모리 부족(OOM) / 심각한 속도 저하
 → 더 작은/양자화된 모델 제안 또는 명확한 에러 및 대체 방법 제공
```

단, 실제 브라우저 지원 범위는 현재 공식 문서를 조사해서 결정한다.

---

# 10. Next.js 종속성 제거

SDK는 React 중심으로 만든다.

다음처럼 사용하는 것을 목표로 한다.

```text
React
Vite
Next.js
React Router
```

모두 사용할 수 있어야 한다.

Next.js에 종속적인 API를 SDK Core에 넣지 않는다.

예:

```text
❌ Next.js Server Component 의존
❌ Next.js API Route 의존
❌ Next.js 전용 환경 변수 의존
```

필요하다면 별도의 adapter package로 분리한다.

---

# 11. Package 구조

가능하면 다음과 같은 monorepo/package 구조를 검토한다.

**이 구조를 확정하기 전에 먼저 결정할 것**: `@browser-ai/transformers-js`(2번, 부록 16 참고)를 런타임으로 채택할지, 아니면 Transformers.js를 직접 제어하며 Worker/스트리밍을 처음부터 구현할지. 전자를 택하면 Worker 오케스트레이션이 provider 내부에 이미 있으므로 `worker/` 패키지를 별도 최상위로 둘 필요가 없어질 수 있다 (그 경우 `transformers/` 어댑터 내부 책임으로 흡수). 후자를 택하면 아래 구조대로 `worker/`를 독립 패키지로 유지한다. 결정 방법은 13번 원칙 ③과 ⑤(검증 프로세스)를 따른다.

`core/`는 `Runtime Interface`를 직접 소유/정의하고, `@browser-ai/transformers-js`를 직접 노출하지 않는다. `transformers/`는 그 `Runtime Interface`(13번 원칙 ③)를 구현(implements)하는 어댑터일 뿐이다 — provider의 API 모양이 Core의 인터페이스를 결정하지 않는다. 이때 `Runtime Interface`는 **provider가 지금 실제로 제공하는 기능만** 최소로 정의하고(YAGNI), 필요한 기능이 새로 생길 때만 확장한다 — 처음부터 넓게 설계하면 구현체가 못 채우는 인터페이스가 생겨 오히려 깨지기 쉽다.

```text
packages/
 ├─ core/
 │   ├─ browser-ai runtime
 │   ├─ model management
 │   ├─ worker communication
 │   └─ tool system
 │
 ├─ react/
 │   ├─ BrowserAIProvider
 │   ├─ useBrowserAI
 │   ├─ useBrowserChat
 │   └─ React bindings
 │
 ├─ transformers/
 │   └─ Transformers.js adapter
 │
 ├─ worker/
 │   └─ Web Worker runtime
 │
 └─ tools/
     └─ browser tools
```

다만 실제로 더 좋은 구조가 있다면 이유와 함께 수정한다.

---

# 12. Vercel AI SDK와 다른 선택지 비교

Vercel AI SDK를 무조건 사용하는 것으로 가정하지 말고 다음을 비교한다.

```text
Vercel AI SDK
LangChain.js
Transformers.js 자체 API
직접 구현
기타 React/Browser AI 관련 SDK
```

다음 기준으로 평가한다.

| 기준                 | 평가 |
| -------------------- | ---- |
| React 친화성         |      |
| Transformers.js 연동 |      |
| Browser 실행         |      |
| WebGPU               |      |
| Web Worker           |      |
| Streaming            |      |
| Tool Calling         |      |
| Agent 구현           |      |
| TypeScript           |      |
| 번들 크기            |      |
| 개발 난이도          |      |
| 유지보수             |      |
| 생태계               |      |
| 브라우저 독립성      |      |
| Next.js 종속성       |      |

특히 **현재 Transformers.js 공식 문서에서 어떤 AI SDK/provider를 권장하는지 최신 정보를 조사한 후 판단한다.**

**(2026-09 조사 결과)** Hugging Face 공식 문서에 `@browser-ai/transformers-js`를 사용하는 통합 가이드가 있지만, 이는 Hugging Face/Vercel이 직접 유지하는 게 아니라 커뮤니티(1인 개발자) 패키지를 문서에서 소개하는 형태다. "공식 권장 provider가 있다"와 "그 provider가 공식 유지보수된다"는 다른 문제이므로, 평가표의 "유지보수" 항목에서 이 점을 반드시 감점 요인으로 반영한다. 상세는 부록 16 참고.

---

# 13. 중요한 설계 원칙

다음 원칙을 반드시 지킨다.

### ① Core와 React를 분리

```text
Browser AI Core
        ↑
React Adapter
```

React가 아닌 환경에서도 Core를 사용할 수 있도록 한다.

### ② AI SDK에 과도하게 종속하지 않는다

Vercel AI SDK를 사용하더라도 내부 architecture를 완전히 AI SDK에 종속시키지 않는다.

나중에 다른 AI framework로 교체할 수 있도록 Adapter Pattern을 사용한다.

### ③ Transformers.js도 Adapter로 추상화

**Core가 `Runtime Interface`를 소유하고, Adapter가 그 인터페이스를 구현(implements)한다.** Core가 provider의 API 모양에 맞춰지는 게 아니라, 그 반대다 — 이 방향이 바뀌면 provider가 바뀔 때마다 Core도 흔들리게 되어 Adapter Pattern이 이름만 남는다.

```text
core
 └── Runtime Interface   ← Core가 소유/정의
          ↑
          │ implements
          │
transformers adapter
          ↓
@browser-ai/transformers-js (검증 대상, ⑤ 참고)
          ↓
Transformers.js
```

향후 다른 browser inference engine을 지원할 수 있도록 한다.

`Runtime Interface`는 YAGNI에 가깝게 설계한다 — provider가 지금 실제로 제공하는 기능만 최소 인터페이스로 정의하고, 필요 기능이 생길 때 확장한다. 미래에 필요할 것 같은 기능을 미리 인터페이스에 넣지 않는다. (단, 인터페이스의 "모양"은 어디까지나 Core가 결정하고, provider 구현은 그 모양에 맞춘다 — provider의 API를 그대로 베껴 인터페이스로 삼지 않는다.)

### ④ Tool 시스템은 SDK의 핵심 차별점

단순 chatbot보다:

```text
Chat
+
Local AI
+
Browser Tools
+
Agent
```

를 핵심 가치로 한다.

### ⑤ 외부 provider(`@browser-ai/transformers-js` 등) 채택은 "조사"만으로 결정하지 않는다

다음 순서로 **시간을 제한**해서 진행한다.

```text
조사 (문서/버전/이슈 확인)
        ↓
최소 PoC (실제로 짜보기)
        ↓
채택 / 교체 결정
```

- **PoC를 반드시 포함한다.** 문서 조사만으로 "괜찮아 보인다"고 판단하지 않고, MVP 1 수준의 아주 작은 코드(모델 로딩 + 메시지 1개 스트리밍)를 직접 provider로 짜본 뒤 결정한다.
- **검증 기간에 상한을 둔다.** 예: 조사 4~6시간 + PoC 1~2일 이내. 이 안에 결론이 안 나면 "완벽한 기술 선택"을 더 찾지 말고, 그 시점까지 확인된 정보로 채택 여부를 정하고 MVP 구현으로 넘어간다.
- 판단 기준(6가지):
  1. 우리가 필요한 API를 전부 제공하는가?
  2. 버전 변경에 대응하기 쉬운가?
  3. Worker lifecycle을 충분히 제어할 수 있는가?
  4. Tool Calling을 우리가 원하는 수준으로 확장할 수 있는가?
  5. React에서 불필요한 추상화/번들 비용이 생기지 않는가?
  6. 프로젝트가 중단돼도 직접 fork하거나 대체할 수 있는가?
- 이 기준을 통과하면 `Transformers.js Adapter`(원칙 ③) 뒤에서 채택하고, 통과하지 못하면 Transformers.js를 직접 제어하는 구현으로 대체한다. 어느 쪽이든 `Runtime Interface` 상위 레이어(SDK, React API)는 영향받지 않아야 한다 — 이게 Adapter Pattern을 쓰는 이유다.

**PoC 성공 기준** — 위 6가지가 구조적 판단 기준이라면, 아래는 PoC 자체의 pass/fail 체크리스트다. 다음을 충족하면 PoC 통과로 본다.

1. React + Vite 환경에서 정상 동작
2. 로컬 모델 로딩 성공
3. WebGPU 환경에서 추론 가능
4. WebGPU 미지원/실패 시 WASM fallback 가능
5. Streaming 응답 정상 동작
6. 모델 다운로드 progress 확인 가능
7. Chat 상태 관리가 React에서 자연스럽게 동작
8. Browser Tool 1개 이상 호출 가능
9. Main Thread를 과도하게 block하지 않음
10. provider 장애/변경 시 우리 SDK의 공개 API를 유지할 수 있음

**성능 기준은 이 단계에서 절대 수치로 정하지 않는다.** "30 tokens/sec 이상" 같은 목표를 지금 정해봐야 근거 없는 숫자가 된다. 대신 다음을 측정만 해서 기록한다.

- 동일 모델/환경에서 CPU(WASM) 대비 WebGPU의 성능 차이
- 모델 로딩 시간과 첫 응답 시간(TTFT)
- 메모리 사용량과 실패 여부

이 측정값은 이후 단계에서 실제 기준을 정할 때의 근거 데이터로 쓴다.

### 최종 구조 요약

```text
                    React App
                       │
                       ▼
              ┌─────────────────┐
              │ My Browser AI   │
              │      SDK        │
              └────────┬────────┘
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
      Runtime Interface     Chat Interface
       (Core가 소유)         (Core가 소유)
             │                   │
             ▼                   ▼
   Transformers Adapter     Chat Adapter
     (implements)             (implements)
             │                   │
             ▼                   ▼
 @browser-ai/transformers-js   Vercel AI SDK
             │
             ▼
       Transformers.js
             │
       ┌─────┴─────┐
       ▼           ▼
    WebGPU        WASM
```

이 위에 14번의 3단계 MVP(1: Local Chat → 2: Read-only Browser Tools → 3: Browser Agent)가 올라간다.

핵심은 **"Vercel AI SDK를 쓰기 위해 SDK를 만드는 것"이 아니라 "Browser AI Agent라는 목적을 위해 Vercel AI SDK와 Transformers.js를 필요에 따라 활용하는 것"**이라는 방향을 유지하는 것이다. 이 SDK의 가치는 특정 provider가 아니라 React API + Browser Tool + Agent abstraction에 있다.

---

# 14. 목표 — 3단계 MVP

처음부터 Agent, Tool, Worker, Runtime abstraction을 전부 구현하지 않는다. 아래 3단계로 나눠 각 단계가 실제로 동작하는 걸 확인한 뒤 다음 단계로 넘어간다.

## MVP 1 — React + Local Model + Chat

목표: **"React 앱에서 로컬 모델을 로딩하고 사용자와 대화할 수 있다."** 여기까지만.

```tsx
<BrowserAIProvider model="..." device="auto">
  <Chat />
</BrowserAIProvider>
```

```tsx
const { messages, sendMessage, isLoading } = useBrowserChat();
```

```text
사용자
 ↓
"안녕하세요"
 ↓
Browser Local Model
 ↓
Streaming
 ↓
"안녕하세요!"
```

포함: 브라우저 로컬 AI, WebGPU/WASM fallback, Web Worker, Streaming, Model Loading/Progress, Error Handling, TypeScript, React Hooks.
제외: Tool Calling, Browser Tool, Agent — MVP 2/3로 미룬다.

## MVP 2 — Browser Tools

MVP 1이 성공하면, 5번에서 정의한 1단계 Tool(읽기 전용 3개: `getPageText`, `getSelectedText`, `findElement`) 정도만 추가한다.

```text
사용자
 ↓
"현재 페이지 제목 알려줘"
 ↓
AI
 ↓
getPageText()
 ↓
Local Model
 ↓
답변
```

## MVP 3 — Browser Agent

MVP 2에서 검증된 Tool 시스템을 다중 Tool 연속 호출이 가능한 Agent 구조로 확장한다. 이 단계에서 Cancellation, Tool execution 상태 관리, 상호작용 Tool(`click`, `fill`, `scroll`)을 포함한 전체 기능 목록을 목표로 한다.

```tsx
const { messages, sendMessage } = useBrowserChat();

await sendMessage("현재 페이지에서 광고비가 가장 높은 캠페인을 찾아줘.");
```

AI는 필요한 경우 여러 Browser Tool을 연속 호출하고, 페이지 데이터를 가져온 뒤 로컬 모델을 통해 결과를 사용자에게 자연어로 설명한다.

---

# 15. 구현 전 반드시 먼저 할 것

바로 코드를 작성하지 말고 먼저 다음을 수행한다.

1. ~~현재 Transformers.js 최신 버전과 공식 문서 확인~~ → 2026-09 조사 완료, 부록 16 참고 (단, 실제 구현 시작 시점에 버전이 더 올라갔을 수 있으니 재확인)
2. ~~현재 Transformers.js에서 공식적으로 지원/권장하는 AI SDK 확인~~ → 2026-09 조사 완료, 부록 16 참고
3. ~~`@browser-ai/transformers-js`의 현재 상태와 역할 확인~~ → 2026-09 조사 완료, 부록 16 참고 (커뮤니티/1인 유지보수, 최근 2회 리네이밍 이력)
4. 현재 Vercel AI SDK 최신 버전 및 React API 확인 (미조사 — 구현 착수 시점에 확인)
5. LangChain.js와 비교 (미조사)
6. ~~WebGPU / Web Worker 지원 방식 확인~~ → 2026-09 조사 완료, 부록 16 참고
7. 브라우저에서 실제로 가능한 모델 크기와 양자화 방식 확인 (미조사)
8. 각 기술의 라이선스 확인 → `@browser-ai/transformers-js`는 Apache-2.0 확인됨, 나머지 미조사
9. npm package 구조 설계 → 11번 참고, `@browser-ai/transformers-js` 채택 여부에 따라 갈림
10. 최소 MVP architecture 설계 → 14번의 3단계 MVP 참고

3, 4번 항목(provider/AI SDK 채택 여부)은 조사만으로 끝내지 말고, 13번 원칙 ⑤의 시간제한 PoC를 반드시 거쳐서 결론을 낸다.

그 후 **왜 이 구조를 선택했는지 기술적인 근거를 설명하고**, 14번의 MVP 1부터 단계적으로 구현한다.

특히 "Vercel AI SDK가 좋다"라는 결론을 미리 정하지 말고, 최신 공식 문서를 기반으로 객관적으로 비교한 뒤 최종 architecture를 결정한다.

최종 결과물은 단순 예제 코드가 아니라 **실제로 npm 패키지로 배포할 수 있는 React Browser AI SDK를 염두에 둔 production-oriented architecture**로 설계한다.

---

# 16. 부록: 사전 조사 결과 (2026-09-03 기준)

구현 착수 전 재확인 필요 (버전/문서가 바뀌었을 수 있음). 조사 시점 기준 사실관계만 정리.

### `@browser-ai/transformers-js`

- 실존하는 npm 패키지. 최신 3.0.x. Apache-2.0 라이선스.
- 유지보수: 1인 개발자(jakobhoeg, jakobhoeg.dev). Hugging Face나 Vercel의 공식 유지보수가 아님.
- 최근 리네이밍 이력: `@browser-ai/core`(구) → `@built-in-ai/transformers-js` → `@browser-ai/transformers-js`(현재). 짧은 기간 내 2회 개명 → API 안정성 낮은 초기 단계로 판단.
- Hugging Face 공식 문서(huggingface.co/docs/transformers.js)에 이 패키지를 사용하는 통합 가이드 페이지가 존재함 → "문서에 소개됨"이지 "HF가 직접 유지보수함"은 아님.
- 기능적으로는 Web Worker 오케스트레이션, streaming, 다운로드 progress tracking, tool calling(Qwen3 등 reasoning 모델 권장), `useChat` 커스텀 `ChatTransport` 연동, WebGPU 옵션까지 이미 구현되어 있음. 즉 이 SDK가 새로 만들려는 기능의 상당 부분과 겹침.
- **결론/권장**: Core가 이 패키지를 직접 노출/의존하지 말고, 최소 인터페이스로 한 번 더 감싸서 사용 (섹션 13 원칙과 일치). 처음부터 전부 직접 구현할지, 이 provider를 런타임으로 채택하고 얇게 wrap할지는 실제 구현 착수 시점에 최신 상태를 다시 확인한 뒤 결정.

### WebGPU 브라우저 지원 현황

- Chrome/Edge: 완전 지원 (Windows/macOS/ChromeOS, Android는 Chrome 121+ 일부 기기).
- Firefox: 버전에 따라 부분 지원 (141+ Windows, 145+ macOS Apple Silicon). 이전 버전은 플래그 필요.
- Safari: 26부터 지원 시작 (macOS Tahoe 26, iOS/iPadOS 26).
- Transformers.js는 v3부터 WebGPU/WebNN 지원, 미지원 시 WASM으로 자동 폴백.
- WASM은 사실상 모든 모던 브라우저에서 지원됨 → "WebGPU도 WASM도 둘 다 불가능"한 시나리오는 실질적으로 거의 없음. 실제 실패 케이스는 모델 로딩 중 메모리 부족(OOM)과 저사양 기기에서의 속도 저하.

### 참고 출처

- https://www.npmjs.com/package/@browser-ai/transformers-js
- https://huggingface.co/docs/transformers.js/en/integrations/vercel-ai-sdk
- https://github.com/jakobhoeg/browser-ai
- https://web.dev/blog/webgpu-supported-major-browsers
