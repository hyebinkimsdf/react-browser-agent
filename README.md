# Browser AI SDK

React에서 로컬 브라우저 AI Agent를 쉽게 만들 수 있는 SDK를 설계·검증하는 중이다. 서버 없이 브라우저 안에서 모델 로딩부터 대화, 페이지 조작까지 처리하는 것을 목표로 한다.

## 문서

- [`guide.md`](guide.md) — 설계 가이드. 구조, 3단계 MVP, provider 채택 검증 절차를 담고 있다.
- [`design-decisions.md`](design-decisions.md) — 왜 이 구조를 선택했는지 배경·판단·방법·결과를 짧게 정리한 노트.

## 코드

- [`packages/core`](packages/core) — Runtime Interface / Chat Interface를 소유하는 프레임워크 비의존 코어.
- [`packages/transformers`](packages/transformers) — `@browser-ai/transformers-js`를 감싸는 Transformers Adapter.
- [`packages/react`](packages/react) — `BrowserAIProvider`, `useBrowserChat()` 등 React 바인딩.
- [`packages/tools`](packages/tools) — Browser Tool: 읽기 전용(`getPageText`, `getSelectedText`, `findElement`) + 상호작용(`clickElement`, `fillInput`, `scrollPage`).
- [`examples/react-vite`](examples/react-vite) — 위 패키지들을 실제로 소비하는 React + Vite 예제 앱.

## 검증 기록

- [`poc/`](poc/) — 최소 PoC. provider를 직접 호출해 채택 가능 여부만 확인. 결과는 `poc/RESULTS.md`.
- [`MVP1-RESULTS.md`](MVP1-RESULTS.md) — MVP 1(로컬 채팅) 실행 검증 결과.
- [`MVP2-RESULTS.md`](MVP2-RESULTS.md) — MVP 2(Browser Tools) 실행 검증 결과.
- [`MVP3-RESULTS.md`](MVP3-RESULTS.md) — MVP 3(Agent, Tool 실행 상태 관리) 실행 검증 결과.

## 실행

```bash
npm install
npm run dev --workspace example-react-vite
```
