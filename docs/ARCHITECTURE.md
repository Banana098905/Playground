# アーキテクチャ

## 方針

- **依存なし・ビルドなし**: グローバル名前空間 `window.PZ` に各モジュールを登録する古典的なスクリプト構成。`<script>` の読み込み順（`index.html`）が依存順です。ES Modules にしなかったのは `file://` で開いても動かすため。
- **UIと保存の分離**: ページ（`pages/*`）は `PZ.projects`（サービス層）だけを呼び、保存先の実装（IndexedDB 等）を知りません。
- **入力は信用しない**: 保存データ・バックアップ・URLクエリは必ず `PZ.model.sanitizeProject` / 各 `normalize` を通します。ユーザー入力の描画は `textContent` 経由（`util.h`）です。

## レイヤー

```
pages/*  ──►  projects.js (サービス層) ──►  storage/* (Repo)
  │                 │
  │                 └─ model.js (検証・複製・スナップショット)
  └─ render.js (Canvas描画・当たり判定) / ui.js (部品) / router.js
```

## 保存層（Repo インターフェース）

```
kind: 'indexeddb' | 'localstorage' | 'memory'
list() / get(id) / put(record) / remove(id)   -> Promise
getMeta(key) / setMeta(key, value)            -> Promise
persist()                                     -> Promise<boolean>
```

- `storage/index.js` が IndexedDB → localStorage → メモリ の順に試し、書き込み確認（probe）に成功したものを採用します。
- 起動時に `navigator.storage.persist()` を要求し、ブラウザによる自動削除の対象外にしてもらいます（許可されるかはブラウザ次第）。
- IndexedDB の書き込みは `durability: 'strict'` を指定します（対応ブラウザのみ）。

### クラウド保存への移行

1. `storage/cloud.js` に同じインターフェースの `CloudRepo` を実装（認証付きAPI）
2. `storage/index.js` で「ログイン中は CloudRepo、そうでなければ IndexedDB」を返す
3. 競合解決のため、作品に `updatedAt`（既に有り）と将来 `revision` を持たせる
4. ローカル→クラウドの初回移行は、既存の `exportAll()` / `importBackup()` をそのまま使える

UI側（ページ）は変更不要です。**秘密鍵はフロントに置かず**、APIはサーバー側でトークン検証してください。

## データモデル

```
Project { id, schema, name, width, height, background, objects[], createdAt, updatedAt, lastOpenedAt }
Object  { id, type: rect|ellipse|triangle|star|text, x, y, w, h, rotation, fill|null, stroke, strokeWidth, opacity,
          rect: radius / text: text, fontSize, fontWeight }
```

`schema` はデータ形式の版です。形式を変えるときは `sanitizeProject` に移行処理を足します。

## Studio の仕組み

- **履歴**: 変更のたびに全体を JSON スナップショットにして `past / future` に積む（最大100）。ドラッグ・スライダー・数値入力は `commitSoon`（入力が止まって450ms）または操作終了時にまとめて1ステップにします。
- **自動保存**: 変更→`dirty`→0.7秒後に保存。保存中に変更があれば終了後に再保存。タブ非表示・pagehide・ページ離脱時にも保存。失敗時は状態表示が赤になり、クリックで再試行できます。
- **選択ハンドル**: 回転した図形でも正しく動くよう、ポインタ座標を図形のローカル座標へ変換して計算（`render.js`）。
- **空の新規作品**: 作成直後に何もせず離れた作品は自動で破棄（一覧にゴミを残さない）。

## ルーター

`#/path?query` 形式。ページは `{ title, nav, mount(root, ctx) -> cleanup }`。`cleanup`（Promise可）は次のページに移る前に await されます（Studio の最終保存のため）。読み込み中に別ページへ移動された場合は、後から完了した側を破棄する競合対策（トークン方式）を入れています。

## デザインシステム

`css/style.css` の `:root` にトークン（色・フォント・半径）。背景チャコール `#15171b`、アクセントのライム `#b8ff3d` と紫 `#a066ff`。カードの四隅マーク、角を落としたCTA、モノスペースのラベルで「実験施設」の雰囲気を作っています。`prefers-reduced-motion` ではアニメーションを抑制。720px 以下ではナビがボトムタブになります。

## 既知の制限

- Studio のキャンバス操作は単一選択のみ（複数選択・グループ化は Phase 2）。
- テキストは中央揃え・複数行対応・フォントはシステムフォント（Webフォントは未同梱）。
- 作品間の共有はバックアップファイル経由のみ。


## Phase 2 の追加構成

- **実験の共通API**: `PZ.labs[id] = { defaults, normalize(p), render(ctx, w, h, p), random(rnd) }`（`js/labs-core.js`、DOM非依存）。論理キャンバスは 1200×750 固定で、表示サイズに関係なく同じ絵になる。乱数は `mulberry32(seed)` で、**シード＋設定が同じなら同じ結果**。
- **レジストリ**: `PZ.registry`（`js/registry.js`）が実験の名前・ジャンル・タグ・使い方・プレビューを持つ。ライブラリ・Daily・Discover はすべてここを参照するため、**実験を足すときは `labs-core.js`（または専用ファイル）に生成ロジック、`registry.js` に1件、`pages/lab-xxx.js` にページ、`main.js` にルートを追加**する。
- **WorkKit**（`js/pages/workkit.js`）: 各実験ページに「作品として保存／上書き／派生保存／画像で保存／Ctrl+S／`?work=ID` からの再開／`?daily=` との紐づけ」を提供する共通部品。
- **userdata**（`js/userdata.js`）: `meta` ストアの値（お気に入り・最近・コレクション・Daily記録）をキーごとに直列化して更新する。
- **Daily**: 日付キー `YYYY-MM-DD`（端末の現地時間）→ 通算日数 → 30日周期。周期ごとにシード付きシャッフルで並べ替え、周期内は重複なし、周期の境目で同じお題が連続しない。
- **パフォーマンス**: 携帯端末では粒子数に上限（Flow 1200 / Motion 90）。フレーム間隔が長い状態が続くと自動で数を減らす（`Kit.perfGuard`）。固定ステップで更新するため端末の速さで挙動が変わらない。
- 保存データの形式は [`DATA-FORMAT.md`](DATA-FORMAT.md)。
