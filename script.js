import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0";

const statusEl = document.getElementById("status");
const progressWrap = document.getElementById("progress-wrap");
const progressBar = document.getElementById("progress-bar");
const inputEl = document.getElementById("input");
const analyzeBtn = document.getElementById("analyze-btn");
const resultEl = document.getElementById("result");
const resultLabelEl = document.getElementById("result-label");
const resultBarEl = document.getElementById("result-bar");
const resultScoreEl = document.getElementById("result-score");

let classifier = null;
const loadProgress = new Map();

function updateProgress() {
  const items = [...loadProgress.values()];
  if (items.length === 0) return;
  const avg = items.reduce((sum, p) => sum + p, 0) / items.length;
  progressBar.style.width = `${avg}%`;
}

async function loadModel() {
  statusEl.textContent = "AI 모델 다운로드 중... (최초 1회)";
  progressWrap.hidden = false;

  classifier = await pipeline(
    "sentiment-analysis",
    "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
    {
      progress_callback: (data) => {
        if (data.status === "progress" && data.file) {
          loadProgress.set(data.file, data.progress ?? 0);
          updateProgress();
        }
      },
    }
  );

  progressWrap.hidden = true;
  statusEl.textContent = "✅ 모델 준비 완료! 문장을 입력해보세요.";
  inputEl.disabled = false;
  analyzeBtn.disabled = false;
  inputEl.focus();
}

async function analyze() {
  const text = inputEl.value.trim();
  if (!text || !classifier) return;

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "분석 중...";

  const [output] = await classifier(text);

  const isPositive = output.label === "POSITIVE";
  const percent = Math.round(output.score * 100);

  resultEl.hidden = false;
  resultLabelEl.textContent = isPositive ? "😊 긍정적이에요" : "😞 부정적이에요";
  resultLabelEl.className = `result-label ${isPositive ? "positive" : "negative"}`;
  resultBarEl.style.width = `${percent}%`;
  resultBarEl.style.background = isPositive ? "#16a34a" : "#dc2626";
  resultScoreEl.textContent = `확신도 ${percent}%`;

  analyzeBtn.disabled = false;
  analyzeBtn.textContent = "감정 분석하기";
}

analyzeBtn.addEventListener("click", analyze);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    analyze();
  }
});

loadModel().catch((err) => {
  console.error(err);
  statusEl.textContent = "❌ 모델을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.";
});
