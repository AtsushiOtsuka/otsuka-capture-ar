# おーつかをつかまえろ！ WebAR捕獲ゲーム

マーカー型 WebAR のミニゲームです。スマートフォンのブラウザでページを開き、カメラをトリガー画像（マーカー）に向けると、白衣にメガネの「おーつか」がマーカーの上を跳ねながら逃げ回ります。タップして制限時間内にできるだけたくさん捕まえてください。

技術構成は [il13-lebrikizumab-webar](../il13-lebrikizumab-webar) と同じ MindAR + three.js（CDN・ビルド不要・静的ファイルのみ）です。

## 遊び方

1. ページを開いて「ゲームスタート」を押す（カメラはここで初めて起動）
2. カメラをマーカーに向ける → 検出した瞬間にゲーム開始（45秒）
3. 跳ね回るおーつかをタップ → 捕獲！パーティクルが上がりスコア+1
4. 捕まえるたびにおーつかはどんどん速くなる
5. タイムアップでリザルト表示 →「もう一度」でリトライ

マーカーを見失っている間はタイマーも停止します（覗いている間だけ進む）。

## 構成

```text
.
├── index.html        ゲーム本体（AR）
├── preview.html      キャラ確認用ターンテーブル（カメラ不要）
├── src/
│   ├── main.js       エントリ（MindAR統合＋デバッグモード）
│   ├── game.js       ゲームロジック（移動・捕獲判定・タイマー）
│   ├── character.js  ちびキャラ大塚（three.jsプリミティブ製）
│   ├── effects.js    捕獲お祝いパーティクル
│   ├── ui.js         画面UI制御
│   └── styles.css
└── assets/
    ├── targets.mind            既定マーカー（MindAR公式card例）
    └── slide-marker-sample.png 上記の印刷・表示用画像
```

## URLパラメータ

| パラメータ | 意味 | 例 |
|---|---|---|
| `?debug=1` | カメラ・マーカーなしでゲームを直接プレイ（開発用） | `index.html?debug=1` |
| `?time=30` | 制限時間（秒、最小10） | `index.html?time=30` |
| `?target=...` | マーカー(.mind)の差し替え | `index.html?target=./assets/my.mind` |

## チューニング値（src/game.js 冒頭）

- `CHAR_SCALE = 0.7` キャラの大きさ
- `BASE_SPEED = 0.6` 初速
- `SPEED_PER_CATCH = 0.09` 1捕獲ごとの加速
- `MAX_SPEED = 2.0` 速度上限
- `FIELD = 0.62` 移動範囲（マーカー中心±）

## ローカル確認

```bash
python3 -m http.server 4185
# http://localhost:4185/            … ARモード（localhostはカメラ許可される）
# http://localhost:4185/?debug=1    … カメラなしデバッグプレイ
# http://localhost:4185/preview.html … キャラ単体プレビュー
```

スマートフォン実機では HTTPS が必要です（localhost 以外の HTTP ではカメラが起動しません）。

## デプロイ

静的ホスティング（Netlify Drop、GitHub Pages、Vercel など）にディレクトリごと配置するだけです。バックエンド、DB、ログイン、Cookie は使っていません。

## マーカーの差し替え

1. トリガーにしたい画像（特徴量が多く高コントラストなもの）を PNG/JPG で用意
2. MindAR 画像コンパイラ <https://hiukim.github.io/mind-ar-js-doc/tools/compile> で `targets.mind` を生成
3. `assets/targets.mind` を置き換え（または `?target=` で指定）

既定では MindAR 公式 card 例（`assets/slide-marker-sample.png` と同じ絵柄）を使っています。この画像を別画面や紙に表示してカメラを向けると動作確認できます。
