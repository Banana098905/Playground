# 公開手順（GitHub Pages）

PLAYGROUND ZERO は静的ファイルだけで動くため、ビルド設定なしで公開できます。

## A. 自動公開（推奨）

1. GitHub で新しいリポジトリを作る（例: `playground-zero`、Public）
   - **既存ポートフォリオのリポジトリとは別**にしてください（独立サイトにするため）
2. このフォルダで:
   ```bash
   git init
   git add .
   git commit -m "PLAYGROUND ZERO Phase 1"
   git branch -M main
   git remote add origin https://github.com/<ユーザー名>/playground-zero.git
   git push -u origin main
   ```
3. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
4. **Actions** タブでデプロイ完了を待つ（1〜2分）
5. 公開URL: `https://<ユーザー名>.github.io/playground-zero/`

`main` に push するたびに、テスト（構文・リンク・ロジック）→ 公開の順で自動実行されます。テストが失敗すると公開されません。

## B. 手動公開（Actions を使わない）

1. `npm run build` で `dist/` を作る（Node 不要なら、`scripts/` `docs/` `.github/` 以外をそのままコピーでも可）
2. `dist/` の中身を `gh-pages` ブランチのルートに置く
3. Settings → Pages → Source を **Deploy from a branch** → `gh-pages` / `/ (root)` にする

## C. 他の静的ホスティング

`dist/`（または `index.html` と `css/ js/ assets/` 一式）をアップロードするだけです。Netlify / Cloudflare Pages / Vercel などでも、ビルドコマンド無し・公開ディレクトリ `dist`（または `.`）で動きます。

## 独自ドメインの設定

1. ドメインのDNSで、サブドメイン（例 `zero.example.com`）を `<ユーザー名>.github.io` への **CNAME** にする
   （ルートドメインの場合は GitHub が案内する A レコード）
2. Settings → Pages → **Custom domain** にドメインを入力し、**Enforce HTTPS** をオン
3. リポジトリ直下に `CNAME` ファイル（中身はドメイン1行）が作られます。`scripts/build.js` は `CNAME` も `dist/` にコピーします
4. `index.html` の `og:image` / `og:url` を絶対URL（`https://zero.example.com/assets/og-image.png`）に変更

> **注意:** ブラウザの保存データ（IndexedDB）は **オリジン（ドメイン）ごと** に別です。
> `github.io` で作った作品は、独自ドメインに切り替えると**引き継がれません**。
> 切り替え前に My Space の「バックアップ」で書き出し、新ドメインで「読み込み」してください。
> 公開後にドメインを変える予定があるなら、最初から独自ドメインで公開するのが安全です。

## 公開後のチェックリスト

- [ ] `https://…/` を開いてホームが表示される
- [ ] ナビ（Home / Studio / Lab / My Space）が全て動く
- [ ] Studio で図形を追加 → 再読み込み → 作品が残っている
- [ ] My Space でバックアップを書き出し → 読み込みができる
- [ ] スマートフォン実機で、ボトムタブ・Studioの操作・Labのタッチ反応を確認
- [ ] SNSでURLを貼ってOG画像が出る（`og:image` を絶対URLにした後）

## ポートフォリオにリンクを貼る

既存サイトに次のようなリンクを1つ追加するだけです（既存コードの統合は不要）。

```html
<a href="https://<ユーザー名>.github.io/playground-zero/" target="_blank" rel="noopener">PLAYGROUND ZERO</a>
```

## キャッシュについて

`index.html` は JS/CSS を `?v=2.0.0` 付きで読み込みます。更新を出すときは `index.html` 内の `v=` と `js/config.js` の `version` を同時に上げると、利用者のブラウザが確実に新しいファイルを取得します。
