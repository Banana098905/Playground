# Creation Engine（Create）

ブロックで作った「プログラム」を、**コードを実行せずに**解釈して動かす仕組みです。

## 構成
| ファイル | 役割 |
|---|---|
| `js/creation/spec.js` | ブロックの許可リスト `Cr.SPEC`。種類（event/stmt/expr）、入力欄の型、実行処理、説明、アイコンを1か所に持つ |
| `js/creation/program.js` | 形式 `Cr.FORMAT`、上限 `Cr.LIMITS`、`validate`（厳密）／`sanitize`（寛容）。常に新しいオブジェクトを作り、余計なキーは捨てる |
| `js/creation/runtime.js` | `Cr.Runtime`（reset/start/pause/resume/stop/tick/pointer）と `Cr.runHeadless` |
| `js/creation/samples.js` | サンプル5種（検証を通る実データ） |
| `js/creation/io.js` | `.pzcreate.json` の書き出し・`inspectFile`（検証）・サムネイル |
| `js/pages/create.js` / `create-ws.js` / `create-io.js` | 画面（ページ・ブロック編集部・読み込み確認） |

## 安全性の考え方
- データに入るのは**ブロックの種類名と値だけ**。種類名は `SPEC` に自分で持つキーだけ許可（`hasOwnProperty`、null プロトタイプ）。
- `eval` / `new Function` / 文字列の `setTimeout` / `innerHTML` なし（`scripts/test-creation.js` が検査）。
- 上限: 総手数 20000、描画 3000、1ハンドラ 40ms、1フレーム 90ms、くりかえし 10000、文字 200、へんすう 40。超えたら「止まりました」と画面に出して停止。
- ペン（位置・大きさ・色・濃さ・向き）は各スクリプトの開始時に初期化。キャンバスは持続。`リセット`はハンドラ終了後に行う。乱数は seed 付き mulberry32（同じ seed なら同じ結果）。
- 実行はプレビュー用 canvas だけに描き、保存データ・他ページには触れない。

## ブロックの足し方
1. `spec.js` に `SPEC.<type> = { kind, cat, name, icon, hint, slots, run|eval }` を追加（スロットの型は `num|text|color|bool|any|var|enum`）。
2. 式ブロックなら `ACCEPT` の互換表を確認。
3. `test-creation.js` に実行と検証のテストを追加。UI（パレット・ラベル）は SPEC から自動で作られる。
4. 形式が壊れる変更（意味の変更・削除）は `Cr.FORMAT` を上げ、古いデータの変換を `program.js` に書く。

## テスト
`npm test`（`scripts/test-logic.js` + `scripts/test-creation.js` + `scripts/check-links.js`）。Phase 3 のテストは検証・実行・制限・描画・サンプル・保存・バックアップ・ファイル・安全性を含む。UI は Playwright（Chromium）で手動シナリオを確認済み（README の制限欄を参照）。
