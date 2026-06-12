// 画面UIの制御（スタート画面 / AR中HUD / リザルト / フォールバック）。
// DOM参照とイベント配線をここに集約し、main.js はコールバックだけ渡す。

const FALLBACK_COPY = {
  insecure: {
    title: "HTTPS環境で開いてください",
    message:
      "スマートフォンのブラウザでカメラを使うには HTTPS 配信が必要です。Netlify、GitHub Pages、Vercel などに配置してからアクセスしてください。localhost での開発確認は例外的に許可されます。",
  },
  unsupported: {
    title: "このブラウザではカメラARを開始できません",
    message:
      "getUserMedia に対応した iOS Safari または Android Chrome で開いてください。アプリ内ブラウザではカメラ権限が制限される場合があります。",
  },
  denied: {
    title: "カメラ権限が許可されていません",
    message:
      "ブラウザの設定でこのページのカメラ利用を許可してから、ページを再読み込みしてください。ゲーム用の表示のみを行い、映像や個人データは保存しません。",
  },
  runtime: {
    title: "ARの初期化に失敗しました",
    message:
      "通信状態、HTTPS 配信、カメラ権限を確認してください。改善しない場合は、iOS Safari または Android Chrome で開き直してください。",
  },
};

// スコアに応じたリザルトの一言
function rankComment(score) {
  if (score >= 18) return "伝説のハンター！おーつかも脱帽です。";
  if (score >= 12) return "すごい反射神経！プロ級です。";
  if (score >= 7) return "なかなかの腕前！もう一声！";
  if (score >= 3) return "いい調子！コツは先回りです。";
  if (score >= 1) return "まずは1匹！次はもっと捕まえよう。";
  return "おーつかは素早い…リベンジしよう！";
}

export function createUIController({ onStart, onStop, onRetry }) {
  const elements = {
    app: document.querySelector("#app"),
    startScreen: document.querySelector("#start-screen"),
    startButton: document.querySelector("#start-button"),
    stopButton: document.querySelector("#stop-button"),
    fallback: document.querySelector("#fallback"),
    fallbackTitle: document.querySelector("#fallback-title"),
    fallbackMessage: document.querySelector("#fallback-message"),
    runtimeUI: document.querySelector("#runtime-ui"),
    trackingStatus: document.querySelector("#tracking-status"),
    trackingHint: document.querySelector("#tracking-hint"),
    scoreValue: document.querySelector("#score-value"),
    timeValue: document.querySelector("#time-value"),
    goldBanner: document.querySelector("#gold-banner"),
    penaltyFlash: document.querySelector("#penalty-flash"),
    result: document.querySelector("#result"),
    resultScore: document.querySelector("#result-score"),
    resultComment: document.querySelector("#result-comment"),
    retryButton: document.querySelector("#retry-button"),
    endButton: document.querySelector("#end-button"),
  };

  elements.startButton.addEventListener("click", () => onStart());
  elements.stopButton.addEventListener("click", () => onStop());
  elements.retryButton.addEventListener("click", () => {
    hideResult();
    onRetry();
  });
  elements.endButton.addEventListener("click", () => {
    hideResult();
    onStop();
  });

  function setLoading(isLoading) {
    elements.startButton.disabled = isLoading;
    elements.startButton.innerHTML = isLoading
      ? "<span aria-hidden=\"true\">…</span>ARを準備中"
      : "<span aria-hidden=\"true\">▶</span>ゲームスタート";
  }

  function showRuntime() {
    elements.startScreen.hidden = true;
    elements.fallback.hidden = true;
    elements.runtimeUI.hidden = false;
    elements.goldBanner.hidden = true;
    elements.penaltyFlash.hidden = true;
    hideResult();
  }

  function showStart() {
    elements.startScreen.hidden = false;
    elements.runtimeUI.hidden = true;
    elements.fallback.hidden = true;
    hideResult();
    setTracking(false);
    setLoading(false);
  }

  function showFallback(kind, detail = "") {
    const copy = FALLBACK_COPY[kind] ?? FALLBACK_COPY.runtime;
    elements.startScreen.hidden = true;
    elements.runtimeUI.hidden = true;
    elements.fallback.hidden = false;
    elements.fallbackTitle.textContent = copy.title;
    elements.fallbackMessage.textContent = detail ? `${copy.message}\n\n詳細: ${detail}` : copy.message;
    setLoading(false);
  }

  function setTracking(isFound) {
    elements.trackingStatus.textContent = isFound ? "検出中" : "未検出";
    elements.trackingStatus.classList.toggle("is-found", isFound);
    elements.trackingStatus.classList.toggle("is-lost", !isFound);
    elements.trackingHint.classList.toggle("is-hidden", isFound);
  }

  function setScore(score) {
    elements.scoreValue.textContent = String(score);
  }

  function setTime(seconds) {
    elements.timeValue.textContent = String(seconds);
    elements.timeValue.classList.toggle("is-warning", seconds <= 10);
  }

  // ゴールデンおーつか出現中のバナー表示
  function setGoldBanner(on) {
    elements.goldBanner.hidden = !on;
  }

  // 偽おーつか誤タップの「−1」フラッシュ（CSSアニメを再生し直す）
  let penaltyTimer = null;
  function flashPenalty() {
    const el = elements.penaltyFlash;
    el.hidden = false;
    el.classList.remove("is-flashing");
    void el.offsetWidth; // リフロー強制＝アニメ再スタート
    el.classList.add("is-flashing");
    clearTimeout(penaltyTimer);
    penaltyTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove("is-flashing");
    }, 900);
  }

  function showResult(score) {
    elements.resultScore.textContent = String(score);
    elements.resultComment.textContent = rankComment(score);
    elements.result.hidden = false;
  }

  function hideResult() {
    elements.result.hidden = true;
  }

  function canUseCameraAR() {
    const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    if (!window.isSecureContext && !isLocalhost) {
      return { ok: false, reason: "insecure" };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: "unsupported" };
    }
    return { ok: true, reason: "" };
  }

  return {
    elements,
    canUseCameraAR,
    setLoading,
    showRuntime,
    showStart,
    showFallback,
    setTracking,
    setScore,
    setTime,
    setGoldBanner,
    flashPenalty,
    showResult,
    hideResult,
  };
}
