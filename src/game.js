import * as THREE from "three";
import { createOtsukaCharacter } from "./character.js";

// ============================================================
// 「大塚をつかまえろ！」ゲーム本体。
// マーカー平面（XZ）の上を大塚キャラが跳ねながらランダムに歩き回り、
// プレイヤーが画面タップ（レイキャスト）でつかまえるとスコア加算。
// 制限時間制（既定45秒）。捕獲ごとに少しずつ速くなる。
//
// 設計メモ:
//  - マーカー単位は画像幅 ≒ 1.0。移動範囲は ±FIELD に収める。
//  - 当たり判定は character.hitProxy（透明・大きめ球）へのレイキャスト。
//  - root と hitProxy は呼び出し側でアンカーに add する。
// ============================================================

const FIELD = 0.62;       // 移動範囲（±）
const HOP_PERIOD = 0.42;  // 1ジャンプの周期（秒）
const CHAR_SCALE = 0.55;  // キャラの大きさ（マーカー比。小さめ＝難しく可愛い）
const BASE_SPEED = 0.6;   // 初速（マーカー単位/秒）
const SPEED_PER_CATCH = 0.09; // 1捕獲ごとの加速
const MAX_SPEED = 2.0;    // 速度上限
const WARP_MIN_SEC = 2.5; // ワープ間隔（最小）
const WARP_MAX_SEC = 5.5; // ワープ間隔（最大）
const WARP_VANISH_SEC = 0.28; // ワープで姿を消している時間

export function createGame({ durationSec = 45, onScore, onTime, onFinish, onCapture } = {}) {
  const character = createOtsukaCharacter({ name: "おーつか" });
  character.root.scale.setScalar(CHAR_SCALE); // 当たり判定球(hitProxy)も一緒に縮む

  const root = new THREE.Group();
  root.add(character.root);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // 状態
  let phase = "idle"; // idle | playing | finished
  let score = 0;
  let timeLeft = durationSec;
  let speed = BASE_SPEED; // 水平移動速度（マーカー単位/秒）
  let hopClock = 0;     // ジャンプ位相用
  let pos = new THREE.Vector3(0, 0, 0);
  let target = randomPoint();
  let stunTimer = 0;    // 捕獲/ワープで姿を消している時間（明けたら別位置に出現）
  let warpIn = randWarpInterval(); // 次の自発ワープまでの秒数
  let lastTimeBroadcast = -1;

  function randomPoint() {
    return new THREE.Vector3(
      (Math.random() * 2 - 1) * FIELD,
      0,
      (Math.random() * 2 - 1) * FIELD,
    );
  }

  function randWarpInterval() {
    return WARP_MIN_SEC + Math.random() * (WARP_MAX_SEC - WARP_MIN_SEC);
  }

  function start() {
    score = 0;
    timeLeft = durationSec;
    speed = BASE_SPEED;
    phase = "playing";
    stunTimer = 0;
    warpIn = randWarpInterval();
    pos.copy(randomPoint());
    target = randomPoint();
    character.root.position.copy(pos);
    character.setVisible(true);
    onScore?.(score);
    broadcastTime(true);
  }

  function stop() {
    phase = "idle";
    character.setVisible(false);
  }

  function broadcastTime(force = false) {
    const shown = Math.max(0, Math.ceil(timeLeft));
    if (force || shown !== lastTimeBroadcast) {
      lastTimeBroadcast = shown;
      onTime?.(shown);
    }
  }

  function finish() {
    phase = "finished";
    character.setVisible(false);
    onFinish?.(score);
  }

  /**
   * 画面タップ→捕獲判定。
   * @param clientX/clientY ポインタ座標（CSSピクセル）
   * @param rect ARコンテナの DOMRect
   * @param camera three.js カメラ
   * @returns true=捕獲成功
   */
  function tryCapture(clientX, clientY, rect, camera) {
    // Raycasterは非表示メッシュにも当たるため、キャラ非表示中
    // （マーカーロスト中・ワープ消滅中）は明示的に弾く＝誤加点防止。
    if (phase !== "playing" || stunTimer > 0 || !character.root.visible) return false;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(character.hitProxy, true);
    if (hits.length === 0) return false;

    // 捕獲成功
    score += 1;
    speed = Math.min(BASE_SPEED + score * SPEED_PER_CATCH, MAX_SPEED); // 捕まえるほどどんどん速く
    stunTimer = 0.35;                       // 一瞬消えてリスポーン
    warpIn = randWarpInterval();            // 捕獲リスポーン直後の連続ワープを防ぐ
    onScore?.(score);
    onCapture?.({ x: pos.x, y: 0.62, z: pos.z }); // エフェクト用に捕獲位置を通知
    return true;
  }

  function update(dt, elapsed) {
    if (phase !== "playing") return;

    // タイマー
    timeLeft -= dt;
    broadcastTime();
    if (timeLeft <= 0) {
      finish();
      return;
    }

    // 捕獲後の硬直＝姿を消してから別位置へリスポーン
    if (stunTimer > 0) {
      stunTimer -= dt;
      character.setVisible(false);
      if (stunTimer <= 0) {
        pos.copy(randomPoint());
        target = randomPoint();
        character.root.position.copy(pos);
        character.setVisible(true);
      }
      return;
    }

    // 自発ワープ＝時々ふっと消えて別の場所に出現（捕獲と同じ消滅演出を使う）
    warpIn -= dt;
    if (warpIn <= 0) {
      stunTimer = WARP_VANISH_SEC;
      warpIn = randWarpInterval();
      return;
    }

    // 目標へ向かって水平移動
    const toTarget = new THREE.Vector3().subVectors(target, pos);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < 0.06) {
      target = randomPoint();        // 到達したら次の目標
    } else {
      toTarget.normalize();
      const step = Math.min(speed * dt, dist);
      pos.addScaledVector(toTarget, step);
      character.faceTowards(toTarget.x, toTarget.z);
    }
    character.root.position.set(pos.x, 0, pos.z);

    // ジャンプ＝移動に同期して跳ねる（速くなるほどテンポも上がる）
    hopClock += dt * (0.4 + 0.6 * (speed / BASE_SPEED));
    const hopPhase = (hopClock % HOP_PERIOD) / HOP_PERIOD;
    const walkAmp = dist < 0.06 ? 0.3 : 1; // 到達中はちょこんと
    character.setHop(hopPhase, walkAmp);

    // 名札などが常にカメラを向くのは Sprite が自動でやる
  }

  return {
    root,
    start,
    stop,
    update,
    tryCapture,
    getState: () => phase,
    getScore: () => score,
    setVisible: (v) => character.setVisible(v && phase === "playing"),
  };
}
