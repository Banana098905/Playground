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

## バックアップファイル（format 2）
```jsonc
{
  "app": "playground-zero",
  "format": 2,
  "appVersion": "2.0.0",
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

## 作品単体の書き出し
My Space のプレビューから、作品1件を同じ形式（`projects` が1件のバックアップ）で書き出せます。別環境の「読み込み」でそのまま復元できます。
