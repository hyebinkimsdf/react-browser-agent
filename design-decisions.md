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

**다음 단계**: ~~`guide.md` 13번 원칙 ⑤에 따라 최소 PoC(모델 로딩 + 메시지 1개 스트리밍)부터 진행한다.~~ → `poc/`에서 실행 완료, 결과는 `poc/RESULTS.md` 참고. 모델 다운로드·스트리밍은 성공했고, WebGPU 실패 시 WASM 폴백도 실제로 재현·검증됐다. 다음은 `guide.md` 14번 MVP 1(React + Local Model + Chat, `useChat` 통합 포함)로 진행.
