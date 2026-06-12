# おーつかをつかまえろ！ WebAR捕獲ゲーム

**公開URL: <https://atsushiotsuka.github.io/otsuka-capture-ar/>**（マーカーは [marker.html](https://atsushiotsuka.github.io/otsuka-capture-ar/marker.html) を印刷 or 別画面に表示）

マーカー型 WebAR のミニゲームです。スマートフォンのブラウザでページを開き、カメラをトリガー画像（マーカー）に向けると、白衣にメガネの「おーつか」がマーカーの上を跳ねながら逃げ回ります。タップして制限時間内にできるだけたくさん捕まえてください。

技術構成は [il13-lebrikizumab-webar](../il13-lebrikizumab-webar) と同じ MindAR + three.js（CDN・ビルド不要・静的ファイルのみ）です。

## 遊び方

1. ページを開いて「ゲームスタート」を押す（カメラはここで初めて起動）
2. カメラをマーカーに向ける → 検出した瞬間にゲーム開始（30秒）
3. 跳ね回るおーつかをタップ → 捕獲！パーティクルが上がりスコア+1
4. 捕まえるたびにおーつかはどんどん速くなる
5. タイムアップでリザルト表示 →「もう一度」でリトライ

マーカーを見失っている間はタイマーも停止します（覗いている間だけ進む）。

### ゴールデンおーつか

数秒おきに本物が約3秒だけ金色になります。金色中は**常にマックススピードで爆走**しますが、捕まえると**+3点**。

### 偽おーつか（にせつか）

黒い白衣＋赤メガネ＋赤い名札のそっくりさんが時々並走します。間違えてタップすると**−1点**（0点未満にはなりません）。本物よりわずかに足が遅いのもヒント。

**残り10秒からは終盤ラッシュ**：にせつかが最大3体に増殖し、タップで消してもすぐ戻ってきます。本物を見失わないように！

## 構成

```text
.
├── index.html        ゲーム本体（AR）
├── preview.html      キャラ確認用ターンテーブル（カメラ不要）
├── marker.html       マーカー印刷用ページ（マーカー＋QR＋遊び方）
├── src/
│   ├── main.js       エントリ（MindAR統合＋デバッグモード）
│   ├── game.js       ゲームロジック（移動・捕獲判定・タイマー）
│   ├── character.js  ちびキャラ大塚（three.jsプリミティブ製）
│   ├── effects.js    捕獲お祝いパーティクル
│   ├── ui.js         画面UI制御
│   └── styles.css
└── assets/
    ├── targets.mind            マーカーデータ（marker-wide.png をコンパイルしたもの）
    ├── marker-wide.png         16:9マーカー画像（スライド全面貼り付け用）
    ├── marker-design-wide.html マーカー画像の元デザイン（再生成用）
    ├── qr.png                  公開URLのQRコード
    └── _char_front.png         キャラ正面画像（マーカーデザインで使用）
```

## URLパラメータ

| パラメータ | 意味 | 例 |
|---|---|---|
| `?debug=1` | カメラ・マーカーなしでゲームを直接プレイ（開発用） | `index.html?debug=1` |
| `?time=45` | 制限時間（秒、最小10。既定30） | `index.html?time=45` |
| `?target=...` | マーカー(.mind)の差し替え | `index.html?target=./assets/my.mind` |

## チューニング値（src/game.js 冒頭）

- `CHAR_SCALE = 0.55` キャラの大きさ
- `BASE_SPEED = 0.6` 初速 / `SPEED_PER_CATCH = 0.09` 1捕獲ごとの加速 / `MAX_SPEED = 2.0` 上限
- `FIELD_X = 0.75` / `FIELD_Z = 0.30` 移動範囲（16:9マーカーに合わせた横長矩形）
- `GOLD_*` ゴールデンおーつかの間隔・持続・得点（金色中は常にMAX_SPEED）
- `DECOY_*` 偽おーつかの出現間隔・滞在時間・減点

## ローカル確認

```bash
python3 -m http.server 4185
# http://localhost:4185/            … ARモード（localhostはカメラ許可される）
# http://localhost:4185/?debug=1    … カメラなしデバッグプレイ
# http://localhost:4185/preview.html … キャラ単体プレビュー
```

スマートフォン実機では HTTPS が必要です（localhost 以外の HTTP ではカメラが起動しません）。

## デプロイ

GitHub Pages で公開しています（master ブランチ直下を配信）。push すれば自動で反映されます。静的ファイルのみで、バックエンド、DB、ログイン、Cookie は使っていません。

## マーカーの差し替え

1. トリガーにしたい画像（特徴量が多く高コントラストなもの）を PNG/JPG で用意
   - 現行マーカーは `assets/marker-design-wide.html` をブラウザで開き 1920×1080 でスクリーンショットしたもの
2. MindAR 画像コンパイラ <https://hiukim.github.io/mind-ar-js-doc/tools/compile> で `targets.mind` を生成
3. `assets/targets.mind` を置き換え（または `?target=` で指定）

マーカー画像は `assets/marker-wide.png`（16:9、スライド全面貼り付け用。`marker.html` で印刷・表示可能）です。
**スライドに貼った後でスライド側を編集した場合も、マーカー画像自体が変わらなければ再コンパイルは不要**です（認識されるのは画像領域のみ）。
