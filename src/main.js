import * as THREE from "three";
import { createGame } from "./game.js";
import { createConfetti } from "./effects.js";
import { createUIController } from "./ui.js";

// ============================================================
// 「おーつかをつかまえろ！」エントリポイント。
//
// 通常モード: MindAR（マーカー型WebAR）でマーカー上にゲームを表示。
//   マーカーを初めて検出した瞬間にゲーム開始。ロスト中はタイマー停止。
// デバッグモード (?debug=1): カメラ・MindARなしの平面シーンで
//   ゲームループを直接プレイできる（開発・動作確認用）。
//
// URLパラメータ:
//   ?target=...  マーカー(.mind)の差し替え
//   ?time=30     制限時間（秒）
//   ?debug=1     デバッグモード
//   ?session=...  出席登録用の授業回ID
//   ?form=...     出席登録フォームURL（一時上書き用）
// ============================================================

const DEFAULT_IMAGE_TARGET = "./assets/targets.mind";
const DEFAULT_ATTENDANCE_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdOYNy1yo9OU1kcP02e2ysI-HH1jldxUFcbKl4xbmoSU_N1vw/viewform";
const DEFAULT_FORM_ENTRY_IDS = {
  name: "entry.1552158824",
  studentId: "entry.1718740779",
  recognitionId: "entry.133270326",
  score: "entry.228502941",
  sessionId: "entry.2078430568",
  finishedAt: "entry.1118050961",
};

// ゴールデンおーつか捕獲時のボイス「ウルトラソウル！」
// タップ（ユーザー操作）起点で再生されるためモバイルの自動再生制限にかからない。
const ultraSoulVoice = new Audio("./assets/ultrasoul.m4a");
ultraSoulVoice.preload = "auto";

const params = new URLSearchParams(window.location.search);
const imageTargetSrc = params.get("target") || DEFAULT_IMAGE_TARGET;
const durationSec = Math.max(10, parseInt(params.get("time"), 10) || 30);
const isDebug = params.get("debug") === "1";
const sessionId = params.get("session") || `OTSUKA-${formatDateId(new Date())}`;
const attendanceFormUrl = params.get("form") || DEFAULT_ATTENDANCE_FORM_URL;
const formEntryIds = {
  name: params.get("entryName") || DEFAULT_FORM_ENTRY_IDS.name,
  studentId: params.get("entryStudentId") || DEFAULT_FORM_ENTRY_IDS.studentId,
  recognitionId: params.get("entryRecognitionId") || DEFAULT_FORM_ENTRY_IDS.recognitionId,
  score: params.get("entryScore") || DEFAULT_FORM_ENTRY_IDS.score,
  sessionId: params.get("entrySessionId") || DEFAULT_FORM_ENTRY_IDS.sessionId,
  finishedAt: params.get("entryFinishedAt") || DEFAULT_FORM_ENTRY_IDS.finishedAt,
};

let mindarThree = null;
let renderer = null;
let game = null;
let confetti = null;
let animationClock = null;
let isTracking = false;
let isStarted = false;
let tapHandler = null;
let tapTarget = null;
// デバッグモード用
let debugRenderer = null;
let debugScene = null;
let debugCamera = null;

const ui = createUIController({
  onStart: () => (isDebug ? startDebug() : startAR()),
  onStop: stopAll,
});

ui.setScore(0);
ui.setTime(durationSec);

function buildGame(camera, container) {
  confetti = createConfetti();
  game = createGame({
    durationSec,
    onScore: (s) => ui.setScore(s),
    onTime: (t) => ui.setTime(t),
    onFinish: (score) => ui.showResult(score, createAttendancePayload(score)),
    onCapture: (pos) => {
      if (pos.gold) {
        confetti.burstGold(pos);
        ultraSoulVoice.currentTime = 0;
        ultraSoulVoice.play().catch(() => {}); // 再生不可環境では無音のまま続行
        navigator.vibrate?.([40, 50, 40, 50, 60]);
      } else {
        confetti.burst(pos);
        navigator.vibrate?.(40);
      }
      if (pos.combo >= 2) ui.flashCombo(pos.combo, pos.gain);
    },
    onPenalty: (pos) => {
      confetti.burstPenalty(pos);
      ui.flashPenalty();
      navigator.vibrate?.(160);
    },
    onGolden: (on) => ui.setGoldBanner(on),
    onSparkle: (pos) => confetti.sparkle(pos),
    onMiss: () => {
      ui.flashMiss();
      navigator.vibrate?.(20);
    },
  });

  // 画面タップ→捕獲判定（UIボタンは pointer-events で除外されている）
  tapTarget = container;
  tapHandler = (event) => {
    if (!game) return;
    const rect = container.getBoundingClientRect();
    game.tryCapture(event.clientX, event.clientY, rect, camera);
  };
  container.addEventListener("pointerdown", tapHandler);
}

function makeLights() {
  const hemi = new THREE.HemisphereLight("#ffffff", "#43525a", 1.35);
  const ambient = new THREE.AmbientLight("#ffffff", 0.35);
  const key = new THREE.DirectionalLight("#fff6ec", 1.2);
  key.position.set(1.5, 2.5, 2);
  const fill = new THREE.DirectionalLight("#ffffff", 0.7);
  fill.position.set(0, 1.2, 3);
  return [hemi, ambient, key, fill];
}

// ---------------- 通常モード（MindAR） ----------------

async function startAR() {
  const support = ui.canUseCameraAR();
  if (!support.ok) {
    ui.showFallback(support.reason);
    return;
  }

  ui.setLoading(true);

  try {
    const { MindARThree } = await import("mindar-image-three");
    const container = ui.elements.app.querySelector("#ar-container");
    mindarThree = new MindARThree({
      container,
      imageTargetSrc,
      filterMinCF: 0.0001,
      filterBeta: 0.001,
    });

    const { scene, camera } = mindarThree;
    makeLights().forEach((light) => scene.add(light));

    buildGame(camera, container);

    const anchor = mindarThree.addAnchor(0);
    anchor.group.add(game.root);
    anchor.group.add(confetti.object3D);
    anchor.onTargetFound = () => {
      isTracking = true;
      ui.setTracking(true);
      if (game.getState() === "idle") {
        game.start(); // 初検出でゲーム開始
      } else {
        game.setVisible(true);
      }
    };
    anchor.onTargetLost = () => {
      isTracking = false;
      ui.setTracking(false);
      game.setVisible(false);
    };

    await mindarThree.start();

    renderer = mindarThree.renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    animationClock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const delta = Math.min(animationClock.getDelta(), 0.05);
      if (isTracking) {
        game.update(delta);
        confetti.update(delta);
      }
      renderer.render(scene, camera);
    });

    isStarted = true;
    ui.showRuntime();
    ui.setLoading(false);
  } catch (error) {
    const fallbackKind = error?.name === "NotAllowedError" ? "denied" : "runtime";
    ui.showFallback(fallbackKind, getReadableError(error));
    await stopAll({ showStart: false });
  }
}

// ---------------- デバッグモード（MindARなし） ----------------

function startDebug() {
  const container = ui.elements.app.querySelector("#ar-container");
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  container.appendChild(canvas);

  debugRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  debugRenderer.outputColorSpace = THREE.SRGBColorSpace;
  debugScene = new THREE.Scene();
  debugScene.background = new THREE.Color("#10222a");
  debugCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  debugCamera.position.set(0, 1.7, 2.0);
  debugCamera.lookAt(0, 0.2, 0);

  makeLights().forEach((l) => debugScene.add(l));
  // 16:9横長マーカーに合わせた床（移動範囲の目安）
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 1.1),
    new THREE.MeshStandardMaterial({ color: "#1b3a42", roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  debugScene.add(ground);

  buildGame(debugCamera, container);
  debugScene.add(game.root);
  debugScene.add(confetti.object3D);

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    debugRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    debugRenderer.setSize(w, h, false);
    debugCamera.aspect = w / h;
    debugCamera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  isTracking = true;
  ui.showRuntime();
  ui.setTracking(true);
  game.start();

  animationClock = new THREE.Clock();
  debugRenderer.setAnimationLoop(() => {
    const delta = Math.min(animationClock.getDelta(), 0.05);
    game.update(delta);
    confetti.update(delta);
    debugRenderer.render(debugScene, debugCamera);
  });

  isStarted = true;
  window.__game = game; // デバッグ用フック
  // デバッグ用: 本物キャラの画面座標に正確にタップを撃つ（コンボ検証用）
  window.__tapChar = () => {
    const charRoot = game.root.children[0];
    const v = new THREE.Vector3();
    charRoot.getWorldPosition(v);
    v.y += 0.3;
    v.project(debugCamera);
    const rect = container.getBoundingClientRect();
    container.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: rect.left + ((v.x + 1) / 2) * rect.width,
      clientY: rect.top + ((1 - (v.y + 1) / 2) * rect.height),
      bubbles: true,
    }));
  };
}

// ---------------- 共通 ----------------

async function stopAll(options = { showStart: true }) {
  game?.stop();

  if (renderer) renderer.setAnimationLoop(null);
  if (debugRenderer) debugRenderer.setAnimationLoop(null);

  if (tapTarget && tapHandler) {
    tapTarget.removeEventListener("pointerdown", tapHandler);
  }
  tapTarget = null;
  tapHandler = null;

  if (mindarThree) {
    try {
      await mindarThree.stop();
    } catch (error) {
      console.warn("MindAR stop failed", error);
    }
  }

  const container = ui.elements.app.querySelector("#ar-container");
  container.replaceChildren();
  mindarThree = null;
  renderer = null;
  debugRenderer = null;
  debugScene = null;
  debugCamera = null;
  game = null;
  confetti = null;
  animationClock = null;
  isTracking = false;
  isStarted = false;

  if (options.showStart) {
    ui.showStart();
  }
}

function getReadableError(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || error.name || "";
}

function createAttendancePayload(score) {
  const finishedAt = new Date();
  const recognitionId = createRecognitionId({ score, finishedAt });
  return {
    recognitionId,
    url: buildAttendanceUrl({ score, recognitionId, finishedAt }),
  };
}

function createRecognitionId({ score, finishedAt }) {
  return [
    sessionId,
    formatTimeId(finishedAt),
    `S${score}`,
    randomCode(4),
  ].join("-");
}

function buildAttendanceUrl({ score, recognitionId, finishedAt }) {
  if (!attendanceFormUrl) return "";

  let url;
  try {
    url = new URL(attendanceFormUrl, window.location.href);
  } catch {
    return "";
  }

  const fields = {
    recognitionId,
    score: String(score),
    sessionId,
    finishedAt: finishedAt.toISOString(),
  };

  for (const [field, value] of Object.entries(fields)) {
    const entryId = formEntryIds[field];
    if (entryId) url.searchParams.set(entryId, value);
  }

  // entry ID未設定でも、動作確認や別フォーム実装で値を拾えるように通常パラメータも付ける。
  url.searchParams.set("recognition_id", recognitionId);
  url.searchParams.set("score", String(score));
  url.searchParams.set("session_id", sessionId);
  url.searchParams.set("finished_at", finishedAt.toISOString());

  return url.toString();
}

function formatDateId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function formatTimeId(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}${m}${s}`;
}

function randomCode(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

window.addEventListener("pagehide", () => {
  if (isStarted) {
    stopAll({ showStart: false });
  }
});
