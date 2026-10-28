# 保存データの形式

すべてブラウザ内（IndexedDB。DB名は `js/config.js` 参照）に保存されます。

## 保存先
| ストア | 内容 |
|---|---|
| `projects` | 作品（Studio作品・実験作品）。キーは `id` |
| `meta` | お気に入り実験 `favTools`／最近使った実験 `recentTools`／コレクション `collections`／Daily完了記録 `daily`／最終バックアップ時刻 など |

DB のバージョンは Phase 1 から変えていません。Phase 1 の作品は読み込み時に `kind:'studio'` として補完されるため、**移行処理やデータの初期化は不要**です。

## 作品レコード（schema 2）
```jsonc
{
  "id": "…", "name": "作品名", "schema": 2,
  "kind": "studio" | "experiment",
  "createdAt": 0, "updatedAt": 0, "lastOpenedAt": 0,
  "tags": ["最大10個", "各24文字まで"],
  "favorite": false,
  "collections": ["コレクションID"],
  "parentId": null,            // 派生元の作品ID（派生保存したとき）
  "daily": null,               // "YYYY-MM-DD"（Dailyのお題から作った作品）
  "thumb": "data:image/…",     // サムネイル（任意・検証あり）

  // kind:"studio"
  "width": 1200, "height": 800, "background": "#…", "objects": [ … ],

  // kind:"experiment"
  "tool": "flow" | "color" | "pattern" | "motion" | "particles" | "shapes",
  "params": { "seed": 7, … }   // ツールごとの設定。シードが同じなら同じ結果になる
}
```
- 読み込み時はすべて検証・丸め込み（`model.sanitizeProject`）されます。`__proto__` などの危険なキー、範囲外の数値、長すぎる文字列は取り除かれます。
- `params` は 20KB まで、サムネイルは 90KB までです。

## 自作ツール（kind:'creation'）
作品レコードに `creation` が入ります（他の kind では `null`）。
```jsonc
"creation": {
  "v": 1,                       // ブロック形式のバージョン
  "description": "…", "origin": "sample:click-color" | "",
  "canvas": { "w": 800, "h": 500, "bg": "#101215" },
  "vars": [ { "name": "score", "value": 0, "tune": { "min": 0, "max": 10, "step": 1 } } ],
  "scripts": [ { "id": "b1", "type": "onStart", "body": [ { "id": "b2", "type": "fill", "in": { "color": "#b8ff3d" } } ] } ]
}
```
- 値の入力は数・文字・色・真偽の**リテラル**か、値ブロック（`{type, in}`）。コードは入りません。
- 保存・読み込み時は `Cr.validate` / `sanitize` で検証され、未知のブロックは `unknown` として目印だけ残ります。上限は `Cr.LIMITS`（400ブロック・30スクリプト・深さ8・300KBなど）。
- 名前・説明・ブロック・初期値（vars）・作成／更新日時・形式バージョン（`v`, `schema`）・元の作品ID（`parentId`）を保持します。

### 自作ツールファイル（`.pzcreate.json`）
`{ app:"playground-zero", type:"creation-tool", format:1, appVersion, exportedAt, tool:{ name, description, tags, createdAt, updatedAt, creation } }`。

## バックアップファイル（format 3。format 1・2 も読めます）
```jsonc
{
  "app": "playground-zero",
  "format": 3,
  "appVersion": "4.0.0",
  "exportedAt": "2026-10-26T…Z",
  "projects": [ /* 作品レコード */ ],
  "collections": [ { "id": "…", "name": "…" } ],
  "daily": { "2026-10-26": { "themeId": "…", "doneAt": 0, "note": "…" } },
  "favTools": [ "flow", "color" ]
}
```
- **format 1**（Phase 1）と **format 2** を読めます。それより新しい形式は警告つきで「読める範囲だけ」取り込みます。
- 取り込みの流れ: `inspectBackup`（検証・件数計算。何も書き込まない）→ 確認画面 → `applyBackup`。
  - 新規: 追加
  - 同じID・同じ更新時刻: スキップ
  - 同じID・内容が違う: **別IDの別作品として追加**（名前に「（取り込み）」）。既存は上書きしない
- 上限: 1ファイル 50MB、1000作品まで。超えた分は無視して警告します。

### Phase 4 の追加（format 3 のまま・すべて任意）
- 作品レコードに `remix`（`kind:'creation'` のみ）: `{ v:1, origin, lineage, summary, parts }`。無ければ従来どおり。詳細は `docs/REMIX-ENGINE.md`。
- バックアップのルートに `remix: { v:1, components:[…], histories:{ 作品ID:{ versions:[…] } } }`。古いアプリは無視します。
- `meta` ストアのキー: `rxh:<作品ID>`（履歴）／`rxh-index`／`rxc`（部品）／`rxd:<キー>`／`rxd-index`（下書き）。
- Remix パッケージ `.pzremix.json`（`type:'remix-package'`, `format:1`）。

## 作品単体の書き出し
My Space のプレビューから、作品1件を同じ形式（`projects` が1件のバックアップ）で書き出せます。別環境の「読み込み」でそのまま復元できます。
