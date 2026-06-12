import * as THREE from "three";

// ============================================================
// 「動く大塚」チビキャラ（茶髪・太角メガネ・白衣＋黄シャツ＋青ネクタイ）を
// three.js のプリミティブだけで組み立てるモジュール。外部GLB不要。
//
// プロポーション: 頭大きめのチビ体型（可愛さ優先）。マーカー単位 ≒ 画像幅。
//
// グループ構成:
//   root（ゲーム側がマーカー平面上で移動させる）
//    └ bob（ジャンプ＝上下バウンド＋着地スクワッシュ）
//        └ body（進行方向へ向く）
//            └ パーツ各種＋頭上「大塚」ラベル
//   hitProxy（当たり判定用の透明な大きめ球。root直下）
//
// 公開API: root, hitProxy, setVisible(v), faceTowards(dx,dz),
//          setHop(phase, walkAmp), dispose()
// ============================================================

const SKIN = "#ffe0c4";
const SKIN_SHADE = "#f3cda7";
const COAT = "#f6f8fb";
const COAT_SHADE = "#dde6ee";
const HAIR = "#6e4a2f";
const HAIR_DARK = "#5a3a24";
const FRAME = "#2e2118";      // 太角メガネのフレーム
const SHIRT = "#f1de86";      // 黄色シャツ
const TIE = "#3a68c0";        // 青ネクタイ
const LEG = "#37424c";

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.74,
    metalness: opts.metalness ?? 0.04,
  });
}

// 頭上に出す「おーつか」名札スプライト（CanvasTexture）。常にカメラを向く。
function makeNameSprite(text, accent = "rgba(40, 216, 207, 0.95)") {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const r = 26;
  ctx.fillStyle = "rgba(8, 18, 22, 0.86)";
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(20 + r, 20);
  ctx.arcTo(300, 20, 300, 100, r);
  ctx.arcTo(300, 100, 20, 100, r);
  ctx.arcTo(20, 100, 20, 20, r);
  ctx.arcTo(20, 20, 300, 20, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#eef8f7";
  ctx.font = "900 56px 'Zen Kaku Gothic New', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 160, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.6, 0.24, 1);
  return sprite;
}

/**
 * @param coatColor/coatShade/frameColor 偽おーつか等のバリエーション用
 * @param labelAccent 名札の縁色
 */
export function createOtsukaCharacter({
  name = "おーつか",
  withLabel = true,
  coatColor = COAT,
  coatShade = COAT_SHADE,
  frameColor = FRAME,
  labelAccent = "rgba(40, 216, 207, 0.95)",
} = {}) {
  const root = new THREE.Group();
  root.name = "Otsuka";
  root.visible = false;

  const bob = new THREE.Group();
  root.add(bob);
  const body = new THREE.Group(); // 進行方向へ向く
  bob.add(body);

  const meshes = [];
  const add = (mesh, parent = body) => {
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  // ---- 脚（短めスタビー） ----
  const legGeo = new THREE.CapsuleGeometry(0.05, 0.08, 4, 10);
  const legMat = mat(LEG);
  for (const sx of [-1, 1]) {
    add(new THREE.Mesh(legGeo, legMat)).position.set(0.08 * sx, 0.08, 0);
    // 靴
    const shoe = add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), mat("#222a31")));
    shoe.position.set(0.08 * sx, 0.03, 0.02);
    shoe.scale.set(1, 0.7, 1.3);
  }

  // ---- 白衣（胴体）: 下が広がるテーパー、チビ短め ----
  // 前面は y が下がるほど前へ出る斜面（傾き ≈ atan(0.08/0.34) = 0.23rad）。
  // 前面に貼るパーツは rotation.x = -0.23 で斜面に平行に寝かせる。
  const COAT_SLOPE = -0.23;
  const coatGeo = new THREE.CylinderGeometry(0.16, 0.24, 0.34, 26, 1, false);
  add(new THREE.Mesh(coatGeo, mat(coatColor, { roughness: 0.86 }))).position.y = 0.33;

  // 黄シャツの襟元（首まわりのリング）
  const shirtGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.12, 18);
  add(new THREE.Mesh(shirtGeo, mat(SHIRT))).position.y = 0.5;

  // シャツ（Vゾーンにだけ覗く黄色いパネル。裾までは見せない）
  const shirtPanel = add(new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.12, 0.015), mat(SHIRT)));
  shirtPanel.position.set(0, 0.45, 0.175);
  shirtPanel.rotation.x = COAT_SLOPE;

  // 青ネクタイ（結び目＋ブレード）。シャツ前立ての上に重ねる。
  const knot = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.03), mat("#2f56a3")));
  knot.position.set(0, 0.49, 0.165);
  knot.rotation.x = COAT_SLOPE;
  const tie = add(new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.2, 0.02), mat(TIE)));
  tie.position.set(0, 0.375, 0.205);
  tie.rotation.x = COAT_SLOPE;

  // 白衣のVラペル（襟元から胸へ向かう斜めの折り返し）
  for (const sx of [-1, 1]) {
    const lapel = add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.015), mat(coatShade)));
    lapel.position.set(0.065 * sx, 0.43, 0.17);
    lapel.rotation.set(COAT_SLOPE, 0, -0.46 * sx);
  }

  // ---- 腕 ----
  const armGeo = new THREE.CapsuleGeometry(0.045, 0.16, 4, 10);
  const armMat = mat(coatColor, { roughness: 0.86 });
  const arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.215 * sx, 0.46, 0);
    body.add(pivot);
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(0.02 * sx, -0.09, 0);
    arm.rotation.z = 0.3 * sx;
    pivot.add(arm);
    meshes.push(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), mat(SKIN));
    hand.position.set(0.06 * sx, -0.19, 0);
    pivot.add(hand);
    meshes.push(hand);
    arms.push(pivot);
  }

  // ---- 首 ----
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 14), mat(SKIN_SHADE))).position.y = 0.56;

  // ---- 頭（大きめ＝チビ） ----
  const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 32, 32), mat(SKIN)));
  head.position.y = 0.78;
  head.scale.set(1, 1.02, 0.97);

  // 耳（髪ヘルメットから覗くよう、やや前方に）
  for (const sx of [-1, 1]) {
    const ear = add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), mat(SKIN_SHADE)));
    ear.position.set(0.228 * sx, 0.78, 0.07);
    ear.scale.set(0.65, 1.1, 1);
  }

  // 頬（チーク）
  for (const sx of [-1, 1]) {
    const cheek = add(new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), new THREE.MeshBasicMaterial({ color: "#ffb38f", transparent: true, opacity: 0.5 })));
    cheek.position.set(0.13 * sx, 0.73, 0.205);
  }

  // ---- 髪（茶色。頭を包むヘルメット型＋額の上の前髪） ----
  // 頭(r0.24, y0.78)より少し大きい球を「上＋後ろ」にずらして重ねる。
  // 前面だけ顔が球面から突き出る＝顔・目・メガネは露出、上/横/後ろは髪で包まれる。
  const hairMat = mat(HAIR, { roughness: 0.92 });
  const hairBall = add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 28), hairMat));
  hairBall.position.set(0, 0.815, -0.05);

  // 生え際の帯＝地毛と前髪のつなぎ目を埋める（肌が覗く剥げ防止）。
  // 額上の頭皮カーブに沿って、潰した球を弧状に重ねる。
  const bandGeo = new THREE.SphereGeometry(0.075, 14, 12);
  const hairBand = [
    { x: 0.0, y: 0.945, z: 0.15 },
    { x: -0.085, y: 0.94, z: 0.135 },
    { x: 0.085, y: 0.94, z: 0.135 },
    { x: -0.155, y: 0.925, z: 0.075 },
    { x: 0.155, y: 0.925, z: 0.075 },
  ];
  for (const b of hairBand) {
    const blob = add(new THREE.Mesh(bandGeo, hairMat));
    blob.position.set(b.x, b.y, b.z);
    blob.scale.set(1.25, 0.7, 0.75);
  }

  // 前髪＝額の上（y≥0.89）だけを横に流す毛先。目(y≈0.81)には絶対かけない。
  const fringeGeo = new THREE.ConeGeometry(0.06, 0.15, 10);
  const fringe = [
    { x: 0.0, y: 0.92, z: 0.19, rz: 1.55, rx: 0.12, s: 1.0 },    // 中央の流し
    { x: -0.07, y: 0.925, z: 0.175, rz: 1.45, rx: 0.08, s: 0.95 }, // 左へ続く束
    { x: 0.08, y: 0.92, z: 0.175, rz: 1.66, rx: 0.14, s: 0.9 },    // 額側の毛先
    { x: -0.145, y: 0.915, z: 0.13, rz: 1.38, rx: 0.06, s: 0.82 }, // 左の生え際
    { x: 0.155, y: 0.91, z: 0.12, rz: 1.74, rx: 0.1, s: 0.78 },    // 右の短い束
  ];
  for (const f of fringe) {
    const piece = add(new THREE.Mesh(fringeGeo, hairMat));
    piece.position.set(f.x, f.y, f.z);
    piece.rotation.set(f.rx, 0, f.rz);
    piece.scale.set(f.s, f.s, 0.42); // 厚みを潰して額にフィット
  }

  // ---- 眉（メガネ上枠より上に出す） ----
  for (const sx of [-1, 1]) {
    const brow = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.014, 0.02), mat(HAIR_DARK)));
    brow.position.set(0.1 * sx, 0.878, 0.208);
    brow.rotation.z = -0.12 * sx;
  }

  // ---- 太角メガネ（顔のカーブに沿わせる） ----
  // 各レンズ枠を rotation.y で外側へ振り、外縁がこめかみへ巻き込むように配置。
  // ブリッジは内縁同士（x≈±0.05, z≈0.23）を、つるは外縁からこめかみへ接続。
  const frameMat = mat(frameColor, { metalness: 0.3, roughness: 0.4 });
  function makeLensFrame(sx) {
    const g = new THREE.Group();
    const w = 0.115, h = 0.085, t = 0.02;
    const top = new THREE.Mesh(new THREE.BoxGeometry(w + t, t, t), frameMat);
    top.position.y = h / 2;
    const bot = top.clone();
    bot.position.y = -h / 2;
    const left = new THREE.Mesh(new THREE.BoxGeometry(t, h + t, t), frameMat);
    left.position.x = -w / 2;
    const right = left.clone();
    right.position.x = w / 2;
    g.add(top, bot, left, right);
    g.position.set(0.103 * sx, 0.81, 0.214);
    g.rotation.y = 0.3 * sx;
    meshes.push(top, bot, left, right);
    return g;
  }
  body.add(makeLensFrame(-1));
  body.add(makeLensFrame(1));
  // ブリッジ（内縁の高さ・奥行きに合わせる）
  const bridge = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.018), frameMat));
  bridge.position.set(0, 0.815, 0.231);
  // テンプル（つる）: レンズ外縁(±0.16, z0.197)からこめかみ(±0.235, z0.03)へ
  for (const sx of [-1, 1]) {
    const temple = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.016, 0.016), frameMat));
    temple.position.set(0.197 * sx, 0.815, 0.115);
    temple.rotation.y = 1.12 * sx;
  }

  // ---- 目（メガネの奥） ----
  for (const sx of [-1, 1]) {
    const eye = add(new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 14), mat("#23201d", { roughness: 0.3 })));
    eye.position.set(0.105 * sx, 0.81, 0.215);
    const glint = add(new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), new THREE.MeshBasicMaterial({ color: "#ffffff" })));
    glint.position.set(0.105 * sx + 0.008, 0.82, 0.236);
  }

  // ---- 鼻 ----
  const nose = add(new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 12), mat(SKIN_SHADE)));
  nose.position.set(0, 0.76, 0.235);

  // ---- 口（にっこりスマイル＝下に開いた弧） ----
  const mouth = add(new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.011, 10, 24, Math.PI),
    mat("#b8584a", { roughness: 0.5 }),
  ));
  mouth.position.set(0, 0.725, 0.225);
  mouth.rotation.set(0, 0, Math.PI); // 弧の開口を上に＝∪（笑顔）
  mouth.scale.set(1, 0.7, 1);

  // ---- ほくろ（口の下・本人の左頬＝カメラ正対で画面の右＝body +X 側） ----
  const mole = add(new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 10), mat("#5a3a26", { roughness: 0.5 })));
  mole.position.set(0.07, 0.67, 0.225);

  // 名札
  if (withLabel) {
    const nameSprite = makeNameSprite(name, labelAccent);
    nameSprite.position.set(0, 1.18, 0);
    body.add(nameSprite);
  }

  // 影
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 24),
    new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  root.add(shadow);

  // 当たり判定プロキシ（透明・大きめ＝タップしやすく）
  const hitProxy = new THREE.Mesh(
    new THREE.SphereGeometry(0.46, 8, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitProxy.position.y = 0.55;
  root.add(hitProxy);

  let facing = 0;

  // ゴールデン化＝全パーツの色を金へ寄せる（元のマテリアル状態を保存して復元）
  let isGolden = false;
  const goldenSaved = new Map();
  const GOLD = new THREE.Color("#ffd24a");
  function setGolden(on) {
    if (on === isGolden) return;
    isGolden = on;
    const mats = new Set();
    meshes.forEach((m) => {
      if (m.material?.isMeshStandardMaterial) mats.add(m.material);
    });
    for (const m of mats) {
      if (on) {
        if (!goldenSaved.has(m)) {
          goldenSaved.set(m, {
            color: m.color.clone(),
            metalness: m.metalness,
            roughness: m.roughness,
            emissive: m.emissive.clone(),
          });
        }
        m.color.lerp(GOLD, 0.78);
        m.metalness = 0.75;
        m.roughness = 0.38;
        m.emissive.set("#6e5300");
      } else {
        const saved = goldenSaved.get(m);
        if (saved) {
          m.color.copy(saved.color);
          m.metalness = saved.metalness;
          m.roughness = saved.roughness;
          m.emissive.copy(saved.emissive);
        }
      }
    }
  }

  return {
    root,
    hitProxy,
    setGolden,
    setVisible(v) {
      root.visible = v;
    },
    faceTowards(dx, dz, lerp = 0.2) {
      if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return;
      const targetAngle = Math.atan2(dx, dz);
      let diff = targetAngle - facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      facing += diff * lerp;
      body.rotation.y = facing;
    },
    setHop(phase, walkAmp = 1) {
      const h = Math.sin(Math.PI * phase);
      bob.position.y = h * 0.16 * walkAmp;
      const squash = 1 + 0.1 * (h - 0.4) * walkAmp;
      bob.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
      const swing = Math.sin(phase * Math.PI * 2) * 0.5 * walkAmp;
      if (arms[0]) arms[0].rotation.x = swing;
      if (arms[1]) arms[1].rotation.x = -swing;
    },
    dispose() {
      meshes.forEach((m) => m.geometry?.dispose());
    },
  };
}
