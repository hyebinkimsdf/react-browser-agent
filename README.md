# 브라우저 AI 감정 분석기

Transformers.js를 이용해 서버 없이 브라우저에서 직접 AI 모델(감정 분석)을 실행하는 정적 웹사이트입니다.

## 실행 방법

빌드 도구 없이 정적 서버로 실행하면 됩니다.

```
python -m http.server 5173
```

이후 브라우저에서 http://localhost:5173 접속.

(모듈 스크립트와 모델 fetch 때문에 `file://`로 직접 열면 동작하지 않습니다. 반드시 로컬 서버를 통해 열어주세요.)

## 동작 방식

- `script.js`에서 `@huggingface/transformers`를 CDN(jsDelivr)에서 ESM으로 불러옵니다.
- `Xenova/distilbert-base-uncased-finetuned-sst-2-english` 감정 분석 모델을 최초 1회 다운로드하여 브라우저(WASM)에서 실행합니다.
- 이후에는 브라우저 캐시를 사용해 빠르게 재실행됩니다.
