# Browser AI SDK 설계 노트

`guide.md`의 상세 스펙과 별개로, 여기까지 오면서 무엇 때문에 무슨 판단을 했는지만 짧게 정리한다.

## 배경

브라우저에서 서버 비용 없이 돌아가는 AI를 웹사이트에 쉽게 붙이고 싶었다. 처음엔 "설치 스크립트 하나로 끝나는 위젯"을 생각했지만, UI를 위젯 형태로 고정하면 그걸 쓰는 사이트마다 자유도가 떨어진다는 문제가 있었다. 그래서 UI는 고정하지 않고, 엔진/기능만 제공하는 쪽으로 방향을 틀었다.

## 판단

- 원격 API를 감싸는 게 아니라 브라우저 안에서 실행이 완결되므로, "API 라이브러리"보다는 "SDK"가 실체와 업계 관행 둘 다에 맞는 이름이다.
- 범위를 React 생태계로 좁히고, Transformers.js(런타임)와 Vercel AI SDK(애플리케이션 레이어)를 조합하는 구조로 구체화했다.
- 이 둘을 잇는 브릿지로 `@browser-ai/transformers-js`라는 패키지가 실제로 존재하는 걸 확인했다. 다만 이건 1인 개발자가 유지하는 초기 단계 커뮤니티 패키지였고, 짧은 기간에 이름이 두 번 바뀐 이력도 있었다. "공식 문서에 소개됨"과 "공식이 유지보수함"은 다른 문제라는 걸 확인한 셈이다.
- 그래서 이 패키지를 기본 전제로 깔지 않고, 검증을 통과해야만 채택하는 "검증 대상"으로 다루기로 했다.

## 방법

- **Adapter로 이중 분리**: Runtime(Transformers.js 계열)과 Chat(AI SDK 계열)을 각각 인터페이스로 떼어내되, 그 인터페이스는 Core가 소유하고 각 어댑터가 구현(implements)하는 방향으로 고정했다. Provider의 API 모양이 Core를 결정하지 않도록 하기 위함이다.
- **인터페이스는 최소로 시작(YAGNI)**: provider가 지금 실제로 주는 기능만 정의하고, 필요할 때 넓힌다.
- **채택 여부는 조사만으로 정하지 않는다**: 시간을 제한(조사 4~6시간 + PoC 1~2일)해서 최소 PoC를 직접 짜보고, 10개 pass/fail 기준으로 판정한다. 성능은 절대 수치 대신 측정 항목(TTFT, WebGPU vs CPU, 메모리)만 기록해두고, 기준은 나중에 데이터가 쌓이면 정한다.
- **기능도 한 번에 다 만들지 않는다**: Tool을 읽기 전용 3개 → 상호작용 3개 → 다중 호출 Agent 순으로 단계적으로 넓힌다.

## 결과

최종 구조는 React App → SDK → (Runtime Interface / Chat Interface) → (Transformers Adapter / Chat Adapter) → (provider / Vercel AI SDK) → Transformers.js → WebGPU/WASM. 그 위에 3단계 MVP(로컬 채팅 → 읽기 전용 Tool → Agent)를 얹는다.

이 SDK의 정체성은 "Transformers.js용 React Wrapper"가 아니라 "React에서 Local Browser AI Agent를 만드는 SDK"다. provider와 AI SDK는 교체 가능한 부품이고, React API·Tool 시스템·Agent abstraction이 실제 가치다.

**다음 단계**: ~~`guide.md` 13번 원칙 ⑤에 따라 최소 PoC(모델 로딩 + 메시지 1개 스트리밍)부터 진행한다.~~ → `poc/`에서 실행 완료, 결과는 `poc/RESULTS.md` 참고. 모델 다운로드·스트리밍은 성공했고, WebGPU 실패 시 WASM 폴백도 실제로 재현·검증됐다.

~~다음은 `guide.md` 14번 MVP 1로 진행.~~ → `packages/core`(Runtime/Chat Interface 소유) + `packages/transformers`(Adapter) + `packages/react`(`BrowserAIProvider`/`useBrowserChat`)로 실제 구현, `examples/react-vite`에서 끝까지 동작 확인. 결과는 `MVP1-RESULTS.md` 참고.

~~다음은 `guide.md` 14번 MVP 2 — 읽기 전용 Browser Tool 3개 추가.~~ → `packages/tools`(getPageText/getSelectedText/findElement) + core의 다중 스텝 tool 호출 배선까지 구현. tool 정의가 모델까지 전달되는 건 확인했지만(모델이 우리 tool 이름/설명으로 추론함), 이 테스트 환경의 속도 문제로 실제 호출 완료까지는 못 봄. OOM(guide.md 9번이 예견한 실패 케이스)도 실제로 재현됐고 `dtype: "q4"`로 해결. 상세는 `MVP2-RESULTS.md` 참고.

~~다음은 `guide.md` 14번 MVP 3 — Agent(상호작용 Tool, Tool 실행 상태 관리).~~ → `clickElement`/`fillInput`/`scrollPage` 추가, `activeTool` 상태 노출(`fullStream` 기반으로 재작성). 실제 느린 모델로 매번 기다리는 대신 가짜 `LanguageModelV4`로 유닛 테스트를 해서 로직을 결정적으로 검증했고, 그 과정에서 진짜 버그(`finishReason`이 문자열이면 tool이 조용히 실행 안 됨 — 우리 테스트 모델의 스펙 오류였지 core 코드 버그는 아니었음)를 하나 잡았다. 다만 **실제 모델+브라우저에서 tool 호출이 끝까지 완료되는 걸 본 적은 아직 없다** — MVP2부터 이어지는 숙제. 상세는 `MVP3-RESULTS.md` 참고.

**Next.js 호환성 테스트** (guide.md 1번/10번 — Next.js도 선택 지원 대상). 지금까지 Vite에서만 검증했던 걸 별도 저장소(`../browser-ai-sdk-nextjs-example`, `file:` 의존성으로 이 저장소의 `packages/*`를 그대로 참조)에서 실제로 돌려봤다. Turbopack(Next.js 16 dev 기본값)은 우리 `file:` 패키지를 아예 resolve 못 해서 아직 안 되고(webpack으로 우회 가능), webpack에서도 `@huggingface/transformers`가 모듈 평가 시점에 URL을 구성하는 코드 때문에 `next/dynamic(..., {ssr:false})`로 감싸야만 SSR 크래시를 피할 수 있었다. 그 과정에서 `packages/react`의 진짜 버그(`BrowserAIProvider`가 render 시점에 동기적으로 Worker를 만들어서 SSR에서 죽음)를 찾아 고쳤다 — Vite에서는 SSR이 없어서 지금까지 안 드러났던 문제. 상세는 `../browser-ai-sdk-nextjs-example/README.md` 참고 (이 저장소 밖에 있음 — 무관한 대형 저장소에 속해 있어 별도 관리).
