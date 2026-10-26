// 公開用フォルダ dist/ を作る（コピーのみ。ビルド工程は不要な構成）。
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
const skip = new Set(['dist', 'node_modules', '.git', 'scripts', 'docs', '.github', 'package.json']);
function copy(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (src === root && skip.has(f)) continue;
    const s = path.join(src, f), d = path.join(dst, f);
    fs.statSync(s).isDirectory() ? copy(s, d) : fs.copyFileSync(s, d);
  }
}
copy(root, dist);
console.log('dist/ を作成しました。この中身をそのまま静的ホスティングへ置けます。');
