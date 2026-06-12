import * as THREE from "three";
import { createOtsukaCharacter } from "./character.js";

// ============================================================
// 「大塚をつかまえろ！」ゲーム本体。
// マーカー平面（XZ）の上を大塚キャラが跳ねながらランダムに歩き回り、
// プレイヤーが画面タップ（レイキャスト）でつかまえるとスコア加算。
// 制限時間制（既定45秒）。捕獲ごとに少しずつ速くなる。
//
// 追加要素:
//  - ゴールデンおーつか: 時々金色化（少し速い）。その間に捕まえると+3点。
//  - 偽おーつか（デコイ）: 黒白衣＋赤眼鏡のそっくりさんが時々並走。
//    誤タップで−1点（0未満にはならない）。
//
// 設計メモ:
//  - マーカー単位は画像幅 ≒ 1.0。16:9横長マーカー前提で移動範囲は
//    X±FIELD_X / Z±FIELD_Z の横長矩形に収める。
//  - 当たり判定は character.hitProxy（透明・大きめ球）へのレイキャスト。
//  - root と hitProxy は呼び出し側でアンカーに add する。
// ============================================================

const FIELD_X = 0.75;     // 移動範囲（±、マーカー横方向）
const FIELD_Z = 0.30;     // 移動範囲（±、マーカー縦方向。16:9の高さ0.5625に合わせ狭め）
const HOP_PERIOD = 0.42;  // 1ジャンプの周期（秒）
const CHAR_SCALE = 0.55;  // キャラの大きさ（マーカー比。小さめ＝難しく可愛い）
const BASE_SPEED = 0.6;   // 初速（マーカー単位/秒）
const SPEED_PER_CATCH = 0.09; // 1捕獲ごとの加速
const MAX_SPEED = 2.0;    // 速度上限
const WARP_MIN_SEC = 2.5; // ワープ間隔（最小）
const WARP_MAX_SEC = 5.5; // ワープ間隔（最大）
const WARP_VANISH_SEC = 0.28; // ワープで姿を消している時間

// ゴールデンおーつか
const GOLD_FIRST_SEC = 7;    // 初回ゴールデンまでの秒数
const GOLD_GAP_MIN = 7;      // 2回目以降の間隔（最小）
const GOLD_GAP_MAX = 12;     // 同（最大）
const GOLD_DURATION = 3.2;   // 金色でいる時間
const GOLD_SCORE = 3;        // 金色捕獲の得点（金色中は常にMAX_SPEEDで爆走）
const GOLD_SPARKLE_SEC = 0.4; // 金色中のキラキラ間隔

// 偽おーつか（デコイ）
const DECOY_FIRST_SEC = 5.5;  // 初回出現までの秒数（序盤は本物だけで学習）
const DECOY_STAY_MIN = 4.5;   // 出現していられる時間（最小）
const DECOY_STAY_MAX = 6.5;   // 同（最大）
const DECOY_GAP_MIN = 3.0;    // 次の出現までの間隔（最小）
const DECOY_GAP_MAX = 6.0;    // 同（最大）
const DECOY_SPEED_MUL = 0.9;  // 本物よりわずかに遅い（見分けのヒント）
const DECOY_PENALTY = 1;      // 誤タップの減点

export function createGame({ durationSec = 45, onScore, onTime, onFinish, onCapture, onPenalty, onGolden, onSparkle } = {}) {
  const character = createOtsukaCharacter({ name: "おーつか" });
  character.root.scale.setScalar(CHAR_SCALE); // 当たり判定球(hitProxy)も一緒に縮む

  // 偽おーつか: 黒白衣＋赤眼鏡＋赤枠名札「にせつか」
  const decoy = createOtsukaCharacter({
    name: "にせつか",
    coatColor: "#2e3138",
    coatShade: "#1f2228",
    frameColor: "#d23b2f",
    labelAccent: "rgba(230, 80, 70, 0.95)",
  });
  decoy.root.scale.setScalar(CHAR_SCALE);

  const root = new THREE.Group();
  root.add(character.root);
  root.add(decoy.root);

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
  let trackVisible = true; // マーカー検出状態（外部からの表示制御）

  // ゴールデン状態
  let goldIn = GOLD_FIRST_SEC; // 次の金色化までの秒数
  let goldTimer = 0;           // 金色の残り時間（>0なら金色中）
  let sparkleClock = 0;

  // デコイ状態
  let decoyActive = false;
  let decoyTimer = DECOY_FIRST_SEC; // active中=残り出現時間 / 非active中=次の出現まで
  let decoyPos = new THREE.Vector3();
  let decoyTarget = randomPoint();
  let decoyHopClock = 0;

  function randomPoint() {
    return new THREE.Vector3(
      (Math.random() * 2 - 1) * FIELD_X,
      0,
      (Math.random() * 2 - 1) * FIELD_Z,
    );
  }

  // 本物から一定距離離れた出現位置（重なり出現の理不尽さ防止）
  function randomPointAwayFrom(other, minDist = 0.4) {
    for (let i = 0; i < 8; i++) {
      const p = randomPoint();
      if (p.distanceTo(other) >= minDist) return p;
    }
    return randomPoint();
  }

  function randWarpInterval() {
    return WARP_MIN_SEC + Math.random() * (WARP_MAX_SEC - WARP_MIN_SEC);
  }

  function randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function setGolden(on) {
    character.setGolden(on);
    onGolden?.(on);
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
    goldIn = GOLD_FIRST_SEC;
    goldTimer = 0;
    sparkleClock = 0;
    setGolden(false);
    decoyActive = false;
    decoyTimer = DECOY_FIRST_SEC;
    decoy.setVisible(false);
    onScore?.(score);
    broadcastTime(true);
  }

  function stop() {
    phase = "idle";
    setGolden(false);
    character.setVisible(false);
    decoy.setVisible(false);
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
    setGolden(false);
    character.setVisible(false);
    decoy.setVisible(false);
    onFinish?.(score);
  }

  /**
   * 画面タップ→捕獲判定。
   * 本物を先に判定（重なっていた場合にペナルティ優先で理不尽にならないように）。
   * @param clientX/clientY ポインタ座標（CSSピクセル）
   * @param rect ARコンテナの DOMRect
   * @param camera three.js カメラ
   * @returns true=捕獲成功（デコイ誤タップは false）
   */
  function tryCapture(clientX, clientY, rect, camera) {
    if (phase !== "playing") return false;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    // 本物の判定。Raycasterは非表示メッシュにも当たるため、キャラ非表示中
    // （マーカーロスト中・ワープ消滅中）は明示的に弾く＝誤加点防止。
    if (stunTimer <= 0 && character.root.visible) {
      const hits = raycaster.intersectObject(character.hitProxy, true);
      if (hits.length > 0) {
        const wasGolden = goldTimer > 0;
        score += wasGolden ? GOLD_SCORE : 1;
        speed = Math.min(BASE_SPEED + score * SPEED_PER_CATCH, MAX_SPEED); // 捕まえるほどどんどん速く
        stunTimer = 0.35;                       // 一瞬消えてリスポーン
        warpIn = randWarpInterval();            // 捕獲リスポーン直後の連続ワープを防ぐ
        if (wasGolden) {
          goldTimer = 0;
          goldIn = randRange(GOLD_GAP_MIN, GOLD_GAP_MAX);
          setGolden(false);
        }
        onScore?.(score);
        onCapture?.({ x: pos.x, y: 0.62, z: pos.z, gold: wasGolden }); // エフェクト用に捕獲位置を通知
        return true;
      }
    }

    // 偽おーつかの判定＝誤タップペナルティ
    if (decoyActive && decoy.root.visible) {
      const hits = raycaster.intersectObject(decoy.hitProxy, true);
      if (hits.length > 0) {
        score = Math.max(0, score - DECOY_PENALTY);
        decoyActive = false;
        decoy.setVisible(false);
        decoyTimer = randRange(DECOY_GAP_MIN, DECOY_GAP_MAX); // 消えて次の出現待ち
        onScore?.(score);
        onPenalty?.({ x: decoyPos.x, y: 0.62, z: decoyPos.z });
        return false;
      }
    }

    return false;
  }

  // 目標へ向かう水平移動＋ジャンプ（本物・デコイ共通）
  function moveToward(char, posVec, targetRef, moveSpeed, dt, hopMul = 1) {
    const toTarget = new THREE.Vector3().subVectors(targetRef.value, posVec);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < 0.06) {
      targetRef.value = randomPoint(); // 到達したら次の目標
    } else {
      toTarget.normalize();
      const step = Math.min(moveSpeed * dt, dist);
      posVec.addScaledVector(toTarget, step);
      char.faceTowards(toTarget.x, toTarget.z);
    }
    char.root.position.set(posVec.x, 0, posVec.z);
    return dist;
  }

  function updateReal(dt) {
    // 捕獲後の硬直＝姿を消してから別位置へリスポーン
    if (stunTimer > 0) {
      stunTimer -= dt;
      character.setVisible(false);
      if (stunTimer <= 0) {
        pos.copy(randomPoint());
        target = randomPoint();
        character.root.position.copy(pos);
        character.setVisible(trackVisible);
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

    // ゴールデン状態の進行（姿が見えている間だけ）
    if (goldTimer > 0) {
      goldTimer -= dt;
      sparkleClock += dt;
      if (sparkleClock >= GOLD_SPARKLE_SEC) {
        sparkleClock = 0;
        onSparkle?.({ x: pos.x, y: 0.7, z: pos.z });
      }
      if (goldTimer <= 0) {
        goldIn = randRange(GOLD_GAP_MIN, GOLD_GAP_MAX);
        setGolden(false);
      }
    } else {
      goldIn -= dt;
      if (goldIn <= 0) {
        goldTimer = GOLD_DURATION;
        sparkleClock = 0;
        setGolden(true);
      }
    }

    // ゴールデン中は序盤でも問答無用のマックススピード（捕れたら+3の価値がある）
    const moveSpeed = goldTimer > 0 ? MAX_SPEED : speed;
    const targetRef = { value: target };
    const dist = moveToward(character, pos, targetRef, moveSpeed, dt);
    target = targetRef.value;

    // ジャンプ＝移動に同期して跳ねる（速くなるほどテンポも上がる）
    hopClock += dt * (0.4 + 0.6 * (moveSpeed / BASE_SPEED));
    const hopPhase = (hopClock % HOP_PERIOD) / HOP_PERIOD;
    const walkAmp = dist < 0.06 ? 0.3 : 1; // 到達中はちょこんと
    character.setHop(hopPhase, walkAmp);
  }

  function updateDecoy(dt) {
    decoyTimer -= dt;

    if (!decoyActive) {
      // 出現待ち → 本物から離れた位置に出現
      if (decoyTimer <= 0) {
        decoyActive = true;
        decoyTimer = randRange(DECOY_STAY_MIN, DECOY_STAY_MAX);
        decoyPos.copy(randomPointAwayFrom(pos));
        decoyTarget = randomPoint();
        decoy.root.position.copy(decoyPos);
        decoy.setVisible(trackVisible);
      }
      return;
    }

    // 滞在時間が尽きたら退場
    if (decoyTimer <= 0) {
      decoyActive = false;
      decoy.setVisible(false);
      decoyTimer = randRange(DECOY_GAP_MIN, DECOY_GAP_MAX);
      return;
    }

    const targetRef = { value: decoyTarget };
    const dist = moveToward(decoy, decoyPos, targetRef, speed * DECOY_SPEED_MUL, dt);
    decoyTarget = targetRef.value;

    decoyHopClock += dt * (0.4 + 0.6 * (speed * DECOY_SPEED_MUL / BASE_SPEED));
    const hopPhase = (decoyHopClock % HOP_PERIOD) / HOP_PERIOD;
    decoy.setHop(hopPhase, dist < 0.06 ? 0.3 : 1);
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

    updateReal(dt);
    updateDecoy(dt);
  }

  return {
    root,
    start,
    stop,
    update,
    tryCapture,
    getState: () => phase,
    getScore: () => score,
    // デバッグ・動作確認用の内部状態スナップショット
    getDebugInfo: () => ({
      golden: goldTimer > 0,
      goldIn: goldIn,
      decoyActive,
      decoyVisible: decoy.root.visible,
      speed,
      timeLeft,
    }),
    setVisible: (v) => {
      trackVisible = v;
      const playing = phase === "playing";
      character.setVisible(v && playing && stunTimer <= 0);
      decoy.setVisible(v && playing && decoyActive);
    },
  };
}
