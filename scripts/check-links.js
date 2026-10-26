// index.html が参照するファイルの存在と、全JSの構文を確認する
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let bad = 0;
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)].map(m => m[1]);
for (const r of new Set(refs)) {
  if (!fs.existsSync(path.join(root, r))) { console.error('MISSING:', r); bad++; }
}
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) { try { cp.execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); } catch (e) { console.error('SYNTAX:', p, String(e.stderr).split('\n')[0]); bad++; } }
  }
})(path.join(root, 'js'));
console.log(bad ? bad + ' problem(s)' : 'links & syntax OK (' + new Set(refs).size + ' refs)');
process.exit(bad ? 1 : 0);
