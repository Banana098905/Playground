// Creation Engine（Phase 3）のテスト: ブロック仕様・検証・インタープリター・保存・ファイル入出力・安全性
// 依存なし: node scripts/test-creation.js
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const sandbox = { window: {}, document: { createElement: () => ({ getContext: () => null }) }, console, Date, Math, JSON, setTimeout, clearTimeout, Promise, Map };
sandbox.window = sandbox; vm.createContext(sandbox);
['config', 'util', 'model', 'creation/spec', 'creation/program', 'creation/runtime', 'creation/samples', 'creation/io', 'storage/fallback', 'projects', 'userdata', 'registry', 'labs-core']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), sandbox, { filename: f }));
const PZ = sandbox.PZ, Cr = PZ.creation, M = PZ.model;
let n = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('  ok  ' + name); });
const J = (x) => JSON.parse(JSON.stringify(x));

/** 描画呼び出しを記録する偽の ctx */
function recorder() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (t, k) => k === 'canvas' ? {} : (...a) => { calls.push(k + '(' + a.map(x => typeof x === 'number' ? Math.round(x * 100) / 100 : String(x)).join(',') + ')'); },
    set: (t, k, v) => { calls.push(k + '=' + v); return true; }
  });
  return { ctx, calls, count: (name) => calls.filter(c => c.startsWith(name + '(')).length };
}
const B = (type, inn, bodies) => Object.assign({ type, in: inn || {} }, bodies || {});
const prog = (scripts, vars) => ({ v: 1, canvas: { w: 800, h: 500, bg: '#101215' }, vars: vars || [], scripts });
const run = (p, o) => { const r = recorder(); const rt = Cr.runHeadless(p, r.ctx, Object.assign({ frames: 5 }, o)); return { rt, r }; };

(async () => {
  /* ---------- ブロック仕様 ---------- */
  await ok('仕様: すべてのブロックが整合している（ラベル・初期値・実行関数）', () => {
    const types = Object.keys(Cr.SPEC); assert.ok(types.length >= 35, '種類数 ' + types.length);
    const cats = Cr.CATS.map(c => c.id);
    types.forEach(t => {
      const s = Cr.SPEC[t];
      assert.ok(['event', 'stmt', 'expr'].includes(s.kind), t); assert.ok(cats.includes(s.cat), t + ' cat');
      assert.ok(s.name && s.hint && s.label.length, t + ' 表示'); assert.ok(s.icon, t + ' icon');
      s.label.forEach(tok => { if (tok[0] === '@') assert.ok(s.slots[tok.slice(1)], t + ' ラベルの欄 ' + tok); });
      Object.keys(s.slots).forEach(k => { assert.ok(s.label.includes('@' + k), t + ' 欄 ' + k + ' がラベルに無い'); assert.ok(['num', 'text', 'color', 'bool', 'any', 'var', 'enum'].includes(s.slots[k].t), t); });
      if (s.kind === 'expr') { assert.ok(['num', 'text', 'color', 'bool', 'any'].includes(s.out), t + ' out'); assert.strictEqual(typeof s.eval, 'function', t); }
      else if (s.kind === 'stmt') assert.strictEqual(typeof s.run, 'function', t);
      if (s.kind === 'event') assert.strictEqual(JSON.stringify(s.bodies), '["body"]', t);
    });
    // 既定のブロックはそのまま検証を通る（unknown と空のへんすう名は除く）
    types.filter(t => !['unknown', 'set', 'change', 'var'].includes(t)).forEach(t => {
      const s = Cr.SPEC[t]; const b = Cr.makeBlock(t);
      const p = s.kind === 'event' ? prog([b]) : s.kind === 'stmt' ? prog([Cr.makeBlock('onStart')].map(e => { e.body = [b]; return e; })) : prog([Object.assign(Cr.makeBlock('onStart'), { body: [Cr.makeBlock('set', { name: 'a', value: 0 })] })]);
      if (s.kind === 'expr') { const st = Cr.makeBlock('set', { name: 'a', value: b }); p.scripts[0].body = [st]; if (!Cr.ACCEPT.any[s.out]) return; }
      const v = Cr.validate(p); assert.ok(v.ok, t + ' → ' + JSON.stringify(v.errors));
    });
  });

  /* ---------- 検証 ---------- */
  await ok('検証: 空・最小のプログラムと、補完・不要キーの除去', () => {
    assert.ok(Cr.validate(Cr.blank()).ok);
    const v = Cr.validate({ scripts: [{ type: 'onStart', evil: 'x', __proto__x: 1, body: [{ type: 'draw', extra: 1 }] }] });
    assert.ok(v.ok); assert.strictEqual(v.clean.scripts[0].body[0].in.shape, 'circle'); assert.ok(!('evil' in v.clean.scripts[0])); assert.ok(!('extra' in v.clean.scripts[0].body[0]));
    assert.ok(v.clean.scripts[0].id && v.clean.scripts[0].body[0].id);
  });
  await ok('検証: 不明なブロック種別・置けない場所は拒否（strict）/ 目印で保持（lenient）', () => {
    const bad = prog([B('onStart', {}, { body: [B('hackIt', { code: 'alert(1)' })] })]);
    const v = Cr.validate(bad); assert.ok(!v.ok); assert.ok(v.errors.some(e => /未対応/.test(e.msg))); assert.strictEqual(v.clean.scripts[0].body.length, 0);
    const l = Cr.validate(bad, { lenient: true }); assert.ok(!l.ok); assert.strictEqual(l.clean.scripts[0].body[0].type, 'unknown'); assert.strictEqual(l.clean.scripts[0].body[0].was, 'hackIt');
    assert.ok(!Cr.validate(prog([B('draw')])).ok, 'イベント以外が先頭');
    assert.ok(!Cr.validate(prog([B('onStart', {}, { body: [B('calc')] })])).ok, '値ブロックを命令の場所に');
    assert.ok(!Cr.validate(prog([B('onStart', {}, { body: [B('unknown')] })])).ok, 'unknown は実行不可');
    ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].forEach(t => assert.ok(!Cr.validate(prog([B('onStart', {}, { body: [B(t)] })])).ok, t));
  });
  await ok('検証: 値の型・範囲・長さ・色・選択肢', () => {
    const w = (b) => Cr.validate(prog([B('onStart', {}, { body: [b] })]));
    assert.ok(!w(B('size', { n: 'abc' })).ok); assert.ok(!w(B('size', { n: null })).ok);
    let v = w(B('size', { n: 99999 })); assert.ok(v.ok); assert.strictEqual(v.clean.scripts[0].body[0].in.n, 3000); assert.ok(v.warnings.length);
    assert.ok(!w(B('fill', { color: 'red' })).ok); assert.ok(!w(B('fill', { color: 'url(javascript:1)' })).ok); assert.ok(w(B('fill', { color: '#abc' })).ok);
    assert.strictEqual(w(B('fill', { color: '#ABC' })).clean.scripts[0].body[0].in.color, '#aabbcc');
    assert.ok(!w(B('draw', { shape: 'dragon' })).ok); assert.ok(!w(B('set', { name: 'a b', value: 1 })).ok); assert.ok(!w(B('set', { name: '', value: 1 })).ok);
    assert.ok(!w(B('set', { name: '<img>', value: 1 })).ok); assert.ok(!w(B('size', { n: Infinity })).ok); assert.ok(!w(B('size', { n: NaN })).ok);
    assert.ok(!w(B('text', { text: 5 })).ok); assert.ok(!w(B('if', { cond: 'yes' }, { then: [] })).ok);
    v = w(B('text', { text: 'x'.repeat(999) })); assert.strictEqual(v.clean.scripts[0].body[0].in.text.length, 200);
    assert.ok(!w(B('set', { name: 'a', value: { type: 'size' } })).ok, '命令ブロックを値の場所に');
    // 型の合わない値ブロック
    assert.ok(!w(B('fill', { color: B('mouseDown') })).ok); assert.ok(!w(B('size', { n: B('hsl') })).ok); assert.ok(w(B('size', { n: B('mouseX') })).ok);
    assert.ok(!w(B('draw', { shape: B('mouseX') })).ok, 'enum に値ブロックは入れない');
  });
  await ok('検証: 深さ・個数・へんすう・スクリプト数の上限', () => {
    let body = []; for (let i = 0; i < 12; i++) body = [B('if', { cond: true }, { then: body })];
    assert.ok(!Cr.validate(prog([B('onStart', {}, { body })])).ok, '入れ子が深い');
    let e = B('mouseX'); for (let i = 0; i < 12; i++) e = B('calc', { a: e, b: 1 });
    assert.ok(!Cr.validate(prog([B('onStart', {}, { body: [B('size', { n: e })] })])).ok, '式が深い');
    const many = Array.from({ length: 500 }, () => B('draw'));
    const v = Cr.validate(prog([B('onStart', {}, { body: many })])); assert.ok(!v.ok); assert.ok(v.stats.blocks <= Cr.LIMITS.blocks);
    assert.ok(!Cr.validate(prog(Array.from({ length: 40 }, () => B('onClick')))).ok);
    assert.ok(!Cr.validate(prog([], Array.from({ length: 60 }, (_, i) => ({ name: 'v' + i, value: 1 })))).ok);
    assert.ok(!Cr.validate(prog([], [{ name: 'a', value: 1 }, { name: 'a', value: 2 }])).ok, '重複');
    assert.ok(!Cr.validate(prog([], [{ name: 'a', value: {} }])).ok);
  });
  await ok('検証: 危険なキー・壊れた入力は安全に扱う', () => {
    const evil = JSON.parse('{"v":1,"scripts":[{"type":"onStart","__proto__":{"polluted":1},"constructor":{"x":1},"body":[{"type":"set","in":{"name":"a","value":1,"__proto__":{"polluted":2}}}]}],"vars":[{"name":"__proto__","value":1}]}');
    const v = Cr.validate(evil); assert.strictEqual({}.polluted, undefined);
    assert.ok(v.clean.vars.every(x => x.name !== '__proto__') || v.clean.vars.length === 1);
    [null, undefined, 5, 'x', [], { scripts: 'x' }, { scripts: [null, 5, 'x', []] }, { vars: 'x' }, { v: 'x' }, { v: 99, scripts: [] }, { v: 0 }].forEach(x => { const r = Cr.validate(x); assert.ok(typeof r.ok === 'boolean'); assert.ok(Array.isArray(r.clean.scripts)); });
    assert.ok(Cr.validate({ v: 99, scripts: [] }, { lenient: true }).warnings.length, '新しい版は lenient では警告');
    assert.ok(!Cr.validate({ v: 99, scripts: [] }).ok);
    const dup = Cr.validate(prog([B('onStart', {}, { body: [{ id: 'same', type: 'draw' }, { id: 'same', type: 'draw' }] })]));
    const ids = []; Cr.walk(dup.clean, b => ids.push(b.id)); assert.strictEqual(new Set(ids).size, ids.length, 'IDは一意');
  });
  await ok('検証: 変数の警告・くりかえし番号の位置', () => {
    const v = Cr.validate(prog([B('onStart', {}, { body: [B('size', { n: B('var', { name: 'zzz' }) })] })]));
    assert.ok(v.ok); assert.ok(v.warnings.some(w => /zzz/.test(w.msg)));
    const v2 = Cr.validate(prog([B('onStart', {}, { body: [B('size', { n: B('loopIndex') })] })])); assert.ok(v2.warnings.some(w => /くりかえし/.test(w.msg)));
    assert.ok(Cr.validate(prog([B('onStart', {}, { body: [B('set', { name: 'a', value: 1 }), B('size', { n: B('var', { name: 'a' }) })] })])).warnings.length === 0);
  });

  /* ---------- 実行エンジン ---------- */
  await ok('実行: へんすう・計算・条件・くりかえしが期待どおりに動く', () => {
    const p = prog([B('onStart', {}, { body: [
      B('set', { name: 'a', value: 2 }), B('change', { name: 'a', by: 3 }),
      B('set', { name: 'b', value: B('calc', { a: B('var', { name: 'a' }), op: 'mul', b: 4 }) }),
      B('repeat', { times: 3 }, { body: [B('change', { name: 'c', by: B('loopIndex') })] }),
      B('if', { cond: B('compare', { a: B('var', { name: 'b' }), op: 'eq', b: 20 }) }, { then: [B('set', { name: 'ok', value: true })], else: [B('set', { name: 'ok', value: false })] }),
      B('set', { name: 'txt', value: B('join', { a: 'S=', b: B('var', { name: 'a' }) }) })] })], [{ name: 'c', value: 0 }]);
    const { rt } = run(p, { frames: 1 }); assert.strictEqual(rt.state, 'running', JSON.stringify(rt.error));
    const g = (k) => rt.vars.get(k); assert.strictEqual(g('a'), 5); assert.strictEqual(g('b'), 20); assert.strictEqual(g('c'), 6); assert.strictEqual(g('ok'), true); assert.strictEqual(g('txt'), 'S=5');
  });
  await ok('実行: 計算ブロック（余り・min/max・sin/cos・整数乱数の範囲）', () => {
    const calc = (op, a, b) => { const { rt } = run(prog([B('onStart', {}, { body: [B('set', { name: 'r', value: B('calc', { a, op, b }) })] })]), { frames: 0 }); assert.strictEqual(rt.state, 'running'); return rt.vars.get('r'); };
    assert.strictEqual(calc('mod', -1, 3), 2); assert.strictEqual(calc('div', 7, 2), 3.5); assert.strictEqual(calc('min', 3, 9), 3); assert.strictEqual(calc('max', 3, 9), 9); assert.strictEqual(calc('sub', 1, 3), -2);
    const f = (fn, x) => run(prog([B('onStart', {}, { body: [B('set', { name: 'r', value: B('fn', { fn, x }) })] })]), { frames: 0 }).rt.vars.get('r');
    assert.ok(Math.abs(f('sin', 90) - 1) < 1e-9); assert.ok(Math.abs(f('cos', 180) + 1) < 1e-9); assert.strictEqual(f('round', 2.6), 3); assert.strictEqual(f('floor', -1.2), -2); assert.strictEqual(f('sqrt', 9), 3); assert.strictEqual(f('abs', -4), 4);
    const seen = new Set(); for (let s = 0; s < 200; s++) seen.add(run(prog([B('onStart', {}, { body: [B('set', { name: 'r', value: B('randInt', { a: 1, b: 6 }) })] })]), { frames: 0, seed: s }).rt.vars.get('r'));
    assert.strictEqual(JSON.stringify([...seen].sort()), '[1,2,3,4,5,6]');
  });
  await ok('実行: 同じシードなら同じ結果・違うシードなら違う結果', () => {
    const p = Cr.sampleProgram('random-pattern');
    const a = run(p, { seed: 7, frames: 3 }).r.calls.join('|'), b = run(p, { seed: 7, frames: 3 }).r.calls.join('|'), c = run(p, { seed: 8, frames: 3 }).r.calls.join('|');
    assert.strictEqual(a, b); assert.notStrictEqual(a, c);
  });
  await ok('実行: 「ここで終了」「リセット」「タイマー」「クリック」', () => {
    let { rt } = run(prog([B('onTick', {}, { body: [B('change', { name: 'n', by: 1 }), B('if', { cond: B('compare', { a: B('var', { name: 'n' }), op: 'ge', b: 3 }) }, { then: [B('stop')] })] })], [{ name: 'n', value: 0 }]), { frames: 10 });
    assert.strictEqual(rt.state, 'finished'); assert.strictEqual(rt.vars.get('n'), 3);
    // リセット: へんすうが初期値に戻り、はじまったときがもう一度動く
    const p = prog([B('onStart', {}, { body: [B('change', { name: 'starts', by: 1 })] }), B('onClick', {}, { body: [B('set', { name: 'x', value: 99 }), B('reset')] })], [{ name: 'x', value: 1 }, { name: 'starts', value: 0 }]);
    const r = recorder(); rt = new Cr.Runtime(p, r.ctx, { seed: 1 }); rt.start(); rt.tick(16); rt.pointer('down', 10, 10); rt.tick(16);
    assert.strictEqual(rt.vars.get('x'), 1); assert.strictEqual(rt.vars.get('starts'), 1); assert.strictEqual(rt.state, 'running');
    // タイマー: 2.5秒で 2回（1秒ごと）
    rt = new Cr.Runtime(prog([B('onTimer', { sec: 1 }, { body: [B('change', { name: 't', by: 1 })] })], [{ name: 't', value: 0 }]), recorder().ctx, { seed: 1 }); rt.start();
    for (let i = 0; i < 150; i++) rt.tick(16.7); assert.strictEqual(rt.vars.get('t'), 2);
    // クリックは座標を持つ・一時停止中は無視・停止後は無反応
    rt = new Cr.Runtime(prog([B('onClick', {}, { body: [B('set', { name: 'mx', value: B('mouseX') }), B('change', { name: 'k', by: 1 })] })], [{ name: 'k', value: 0 }]), recorder().ctx, { seed: 1 }); rt.start();
    rt.pointer('down', 123, 45); rt.tick(16); assert.strictEqual(rt.vars.get('mx'), 123); assert.strictEqual(rt.vars.get('k'), 1);
    rt.pause(); rt.pointer('down', 1, 1); rt.resume(); rt.tick(16); assert.strictEqual(rt.vars.get('k'), 1, '一時停止中のクリックは無視');
    const t0 = rt.time; rt.pause(); rt.tick(1000); assert.strictEqual(rt.time, t0, '一時停止中は時間が進まない');
    rt.stop(); rt.pointer('down', 1, 1); rt.tick(16); assert.strictEqual(rt.vars.get('k'), 1);
    rt.pointer('move', 99999, -5); assert.ok(rt.mouse.x <= rt.W && rt.mouse.y >= 0, '座標は画面内に丸める');
  });
  await ok('実行: エラーはブロックIDつきで止まる（0割り・未設定へんすう・型・番号の位置・リセットの位置）', () => {
    const at = (body) => run(prog([B('onStart', {}, { body })]), { frames: 1 }).rt;
    let rt = at([B('set', { name: 'a', value: B('calc', { a: 1, op: 'div', b: 0 }) })]); assert.strictEqual(rt.state, 'error'); assert.ok(/0/.test(rt.error.message)); assert.ok(rt.error.blockId);
    rt = at([B('size', { n: B('var', { name: 'nothing' }) })]); assert.strictEqual(rt.state, 'error'); assert.ok(/nothing/.test(rt.error.message));
    rt = at([B('set', { name: 's', value: 'abc' }), B('size', { n: B('var', { name: 's' }) })]); assert.strictEqual(rt.state, 'error'); assert.strictEqual(rt.error.kind, 'type');
    rt = at([B('set', { name: 's', value: 'abc' }), B('fill', { color: B('var', { name: 's' }) })]); assert.strictEqual(rt.state, 'error');
    rt = at([B('size', { n: B('loopIndex') })]); assert.strictEqual(rt.state, 'error');
    rt = at([B('reset')]); assert.strictEqual(rt.state, 'error');
    rt = at([B('set', { name: 's', value: 'x' }), B('change', { name: 's', by: 1 })]); assert.strictEqual(rt.state, 'error');
    rt = at([B('set', { name: 'a', value: B('fn', { fn: 'sqrt', x: -1 }) })]); assert.strictEqual(rt.state, 'error');
    rt = at([B('if', { cond: B('compare', { a: 'a', op: 'lt', b: 'b' }) }, { then: [] })]); assert.strictEqual(rt.state, 'error');
    rt = at([B('set', { name: 'a', value: 1e9 }), B('repeat', { times: 100 }, { body: [B('set', { name: 'a', value: B('calc', { a: B('var', { name: 'a' }), op: 'mul', b: 1e9 }) })] })]); assert.strictEqual(rt.state, 'error', '巨大な数は止める');
    rt = run(prog([B('onStart', {}, { body: [B('size', { n: B('var', { name: 'x' }) })] })]), { frames: 1 }).rt; assert.strictEqual(rt.state, 'error');
    rt.tick(16); assert.strictEqual(rt.state, 'error', 'エラー後は進まない');
  });
  await ok('制限: 無限に近い処理・描きすぎ・時間超過を安全に止める', () => {
    const lim = (body, o) => run(prog([B('onStart', {}, { body })]), Object.assign({ frames: 1 }, o)).rt;
    let rt = lim([B('repeat', { times: 100000 }, { body: [B('draw')] })]); assert.strictEqual(rt.state, 'error'); assert.strictEqual(rt.error.kind, 'limit'); assert.ok(/回数/.test(rt.error.message));
    rt = lim([B('repeat', { times: 300 }, { body: [B('repeat', { times: 300 }, { body: [B('set', { name: 'a', value: 1 })] })] })], {}); assert.strictEqual(rt.state, 'error'); assert.strictEqual(rt.error.kind, 'limit');
    rt = lim([B('repeat', { times: 5000 }, { body: [B('draw')] })]); assert.strictEqual(rt.state, 'error'); assert.ok(/描ける数/.test(rt.error.message));
    let t = 0; rt = lim([B('repeat', { times: 5000 }, { body: [B('set', { name: 'a', value: 1 })] })], { now: () => (t += 1) }); assert.strictEqual(rt.state, 'error'); assert.ok(/時間/.test(rt.error.message), rt.error && rt.error.message);
    rt = lim(Array.from({ length: 60 }, (_, i) => B('set', { name: 'v' + i, value: 1 }))); assert.strictEqual(rt.state, 'error'); assert.ok(/40/.test(rt.error.message), 'へんすう数の上限');
    // 重いイベントでも1回の動きの上限で止まり、画面は固まらない（同期処理の総ステップが有限）
    const t0 = Date.now(); rt = lim([B('repeat', { times: 10000 }, { body: [B('repeat', { times: 10000 }, { body: [B('set', { name: 'a', value: 1 })] })] })]); assert.ok(Date.now() - t0 < 1500, '重い入れ子でも素早く止まる'); assert.strictEqual(rt.state, 'error');
    // 文字は増殖しない
    rt = lim([B('set', { name: 's', value: 'abcdefghij' }), B('repeat', { times: 40 }, { body: [B('set', { name: 's', value: B('join', { a: B('var', { name: 's' }), b: B('var', { name: 's' }) }) })] })]); assert.strictEqual(rt.state, 'running'); assert.ok(rt.vars.get('s').length <= 200);
    // 検証に通らないプログラムは動かさない
    rt = new Cr.Runtime(prog([B('onStart', {}, { body: [B('nope')] })]), recorder().ctx); assert.strictEqual(rt.start(), false); assert.strictEqual(rt.state, 'error'); assert.strictEqual(rt.error.kind, 'invalid');
  });
  await ok('描画: 図形・文字・消去・うすく消す・ペンは各スクリプトの最初にリセット', () => {
    const { r } = run(prog([B('onStart', {}, { body: [B('fill', { color: '#ff0000' }), B('size', { n: 20 }), B('moveTo', { x: 10, y: 20 }), B('draw', { shape: 'star' }), B('draw', { shape: 'line' }), B('text', { text: 'Hi' }), B('fade', { amount: 50 })] }),
      B('onClick', {}, { body: [B('draw', { shape: 'circle' })] })]), { frames: 0 });
    assert.strictEqual(r.count('fillText'), 1); assert.ok(r.calls.includes('fillStyle=#ff0000')); assert.ok(r.calls.some(c => c.startsWith('translate(10,20)'))); assert.ok(r.calls.includes('globalAlpha=0.5')); assert.ok(r.count('stroke') >= 1);
    const clicked = recorder(); const rt = new Cr.Runtime(prog([B('onStart', {}, { body: [B('fill', { color: '#ff0000' })] }), B('onClick', {}, { body: [B('draw', { shape: 'circle' })] })]), clicked.ctx, { seed: 1 }); rt.start(); rt.pointer('down', 1, 1); rt.tick(16);
    assert.ok(clicked.calls.includes('fillStyle=#b8ff3d') && !clicked.calls.includes('fillStyle=#ff0000'), '別スクリプトの色は引き継がない');
  });

  /* ---------- サンプル ---------- */
  await ok('サンプル: 5種が検証を通り、エラーなく動き、実際に描画する', () => {
    assert.strictEqual(Cr.SAMPLES.length, 5);
    Cr.SAMPLES.forEach(s => {
      const p = Cr.sampleProgram(s.id); assert.ok(p, s.id);
      const v = Cr.validate(p); assert.ok(v.ok, s.id + JSON.stringify(v.errors)); assert.strictEqual(v.warnings.length, 0, s.id + JSON.stringify(v.warnings));
      assert.ok(p.origin === 'sample:' + s.id); assert.ok(s.tryIt.length >= 3 && s.summary);
      const events = [[0, 'move', 400, 250], [10, 'down', 400, 250], [20, 'up', 400, 250], [30, 'move', 100, 100]]; const ptr = {}; events.forEach(e => { ptr[e[0]] = [e[1], e[2], e[3]]; });
      const { rt, r } = run(p, { frames: 400, seed: 3, pointer: ptr });
      assert.ok(rt.state === 'running' || rt.state === 'finished', s.id + ' ' + JSON.stringify(rt.error)); assert.ok(r.calls.length > 20, s.id + ' 描画'); 
    });
    assert.strictEqual(Cr.sampleProgram('nothing'), null);
    // IDは毎回新しい（サンプル自体は書き換わらない）
    assert.notStrictEqual(Cr.sampleProgram('click-color').scripts[0].id, Cr.sampleProgram('click-color').scripts[0].id);
  });
  await ok('サンプル: 操作に反応する（クリックで色が変わる・ゲームのルール）', () => {
    const p = Cr.sampleProgram('click-color'); const r = recorder(); const rt = new Cr.Runtime(p, r.ctx, { seed: 5 }); rt.start(); rt.tick(16);
    const before = rt.vars.get('色相'); let changed = false; for (let i = 0; i < 6 && !changed; i++) { rt.pointer('down', 5, 5); rt.tick(16); changed = rt.vars.get('色相') !== before; } assert.ok(changed);
    // ゲーム: 的をクリックで得点、見のがしでライフが減り、0で終了
    const g = Cr.sampleProgram('catch-game'); const rt2 = new Cr.Runtime(g, recorder().ctx, { seed: 2 }); rt2.start(); rt2.tick(16);
    rt2.vars.set('的x', 300); rt2.vars.set('的y', 200); rt2.pointer('down', 300, 200); rt2.tick(16); assert.strictEqual(rt2.vars.get('スコア'), 1); assert.ok(rt2.vars.get('速さ') > 2.6);
    for (let i = 0; i < 20000 && rt2.state === 'running'; i++) rt2.tick(16.7); assert.strictEqual(rt2.state, 'finished'); assert.strictEqual(rt2.vars.get('ライフ'), 0);
    const g2 = Cr.sampleProgram('catch-game'); g2.vars.forEach(v => { if (v.name === 'ライフ') v.value = 1; }); const rt3 = new Cr.Runtime(g2, recorder().ctx, { seed: 2 }); rt3.start(); for (let i = 0; i < 5000 && rt3.state === 'running'; i++) rt3.tick(16.7); assert.strictEqual(rt3.state, 'finished');
  });

  /* ---------- 保存・複製・バックアップ ---------- */
  const repo = new PZ.storage.MemoryRepo(); PZ.storage.open = () => Promise.resolve(repo); await PZ.projects.init();
  await ok('保存: 自作ツールの作成・読み込み・形式（ID/名前/説明/ブロック/初期値/日時/バージョン）', async () => {
    const creation = Cr.sampleProgram('bouncing-ball'); creation.description = '説明です';
    const w = await PZ.projects.createCreation({ name: 'テスト', creation, tags: ['a'] });
    const got = await PZ.projects.get(w.id);
    assert.strictEqual(got.kind, 'creation'); assert.strictEqual(got.name, 'テスト'); assert.strictEqual(got.creation.description, '説明です'); assert.ok(got.creation.scripts.length >= 2); assert.ok(got.creation.vars.length >= 5);
    assert.ok(got.createdAt && got.updatedAt); assert.strictEqual(got.creation.v, 1); assert.strictEqual(got.schema, 3); assert.strictEqual(got.parentId, null); assert.strictEqual(got.creation.origin, 'sample:bouncing-ball');
    assert.strictEqual(PZ.projects.hrefFor(got), '/create?work=' + got.id); assert.ok((await PZ.projects.list({ kind: 'creation' })).length >= 1);
    assert.strictEqual(M.sanitizeProject({ kind: 'creation', name: 'x' }), null, 'creationが無いものは無効'); assert.strictEqual(M.sanitizeProject({ kind: 'creation', creation: [] }), null);
  });
  await ok('保存: 上書き・複製（派生）で元の作品が壊れない', async () => {
    const a = await PZ.projects.createCreation({ name: '元', creation: Cr.sampleProgram('click-color') });
    const d = await PZ.projects.derive(a.id, '元 v2', { creation: Object.assign(J(a.creation), { description: '変更' }) });
    assert.notStrictEqual(d.id, a.id); assert.strictEqual(d.parentId, a.id); assert.strictEqual(d.creation.description, '変更');
    const orig = await PZ.projects.get(a.id); assert.strictEqual(orig.name, '元'); assert.notStrictEqual(orig.creation.description, '変更');
    const c = await PZ.projects.duplicate(a.id); assert.strictEqual(c.parentId, a.id); assert.strictEqual(c.kind, 'creation'); assert.ok(c.creation.scripts.length);
    orig.creation.description = '上書き'; await PZ.projects.save(orig, true); assert.strictEqual((await PZ.projects.get(a.id)).creation.description, '上書き'); assert.strictEqual((await PZ.projects.get(d.id)).creation.description, '変更');
  });
  await ok('保存: 壊れた保存データでも落ちず、内容を残して未対応ブロックだけ目印にする', async () => {
    const raw = { id: 'broken1', kind: 'creation', name: 'こわれ', creation: { v: 1, scripts: [B('onStart', {}, { body: [B('future-block'), B('draw')] })] }, createdAt: 1, updatedAt: 1 };
    await repo.put(raw); const p = await PZ.projects.get('broken1');
    assert.strictEqual(p.creation.scripts[0].body[0].type, 'unknown'); assert.strictEqual(p.creation.scripts[0].body[1].type, 'draw');
    assert.ok(!Cr.validate(p.creation).ok, '目印があるので実行はできない');
  });
  await ok('バックアップ(format 3): 自作ツールを含めて書き出し→検証→取り込み、上書きなし。Phase1/2形式も読める', async () => {
    const data = await PZ.projects.exportAll(); assert.strictEqual(data.format, 3); assert.ok(data.projects.some(p => p.kind === 'creation'));
    let rep = await PZ.projects.inspectBackup(J(data)); assert.ok(rep.items.every(i => i.status === 'same'));
    const d2 = J(data); const target = d2.projects.find(p => p.kind === 'creation'); target.updatedAt += 9999; target.creation.description = '別内容';
    rep = await PZ.projects.inspectBackup(d2); assert.ok(rep.items.some(i => i.status === 'copy'));
    const before = (await PZ.projects.get(target.id)).creation.description; await PZ.projects.applyBackup(rep); assert.strictEqual((await PZ.projects.get(target.id)).creation.description, before);
    const f2 = { app: data.app, format: 2, projects: [{ id: 'old-exp', name: 'e', kind: 'experiment', tool: 'flow', params: { seed: 1 }, createdAt: 1, updatedAt: 1 }] };
    rep = await PZ.projects.inspectBackup(f2); assert.ok(rep.ok && !rep.futureFormat); await PZ.projects.applyBackup(rep); assert.strictEqual((await PZ.projects.get('old-exp')).kind, 'experiment');
    rep = await PZ.projects.inspectBackup({ app: data.app, format: 4, projects: [] }); assert.ok(rep.futureFormat);
  });

  /* ---------- ファイルの書き出し・読み込み ---------- */
  await ok('ファイル: 書き出し→読み込み検証で内容が一致し、新しい作品として取り込める', async () => {
    const src = await PZ.projects.createCreation({ name: '共有するツール', creation: Cr.sampleProgram('mouse-particles'), tags: ['共有'] });
    const file = J(Cr.toFile(src)); assert.strictEqual(file.type, 'creation-tool'); assert.strictEqual(file.format, 1); assert.ok(Cr.isToolFile(file));
    const rep = Cr.inspectFile(file, JSON.stringify(file).length); assert.ok(rep.ok, JSON.stringify(rep.errors));
    assert.strictEqual(rep.summary.name, '共有するツール'); assert.ok(rep.summary.blocks > 10 && rep.summary.scripts === 3 && rep.summary.kinds.length > 5);
    assert.notStrictEqual(rep.project.id, src.id); assert.strictEqual(rep.project.parentId, null); assert.strictEqual(rep.project.kind, 'creation');
    assert.strictEqual(JSON.stringify(Cr.stats(rep.project.creation)), JSON.stringify(Cr.stats(src.creation)));
    const before = await PZ.projects.list(); const saved = await PZ.projects.save(rep.project, false); assert.strictEqual((await PZ.projects.list()).length, before.length + 1);
    assert.strictEqual((await PZ.projects.get(src.id)).name, '共有するツール'); assert.strictEqual(Cr.uniqueImportName('共有するツール', before.map(p => p.name)), '共有するツール (取り込み)');
    // 取り込んだものがそのまま実行できる
    assert.ok(run(saved.creation, { frames: 30 }).rt.state === 'running');
  });
  await ok('ファイル: 不正・改ざん・未対応・巨大なファイルは安全に拒否し、何も保存しない', async () => {
    const src = (await PZ.projects.list({ kind: 'creation' }))[0]; const good = J(Cr.toFile(src));
    const bad = (mut, re) => { const f = J(good); mut(f); const r = Cr.inspectFile(f, 1000); assert.strictEqual(r.ok, false, 'rejected'); assert.strictEqual(r.project, null); if (re) assert.ok(re.test(r.errors.join('|')), r.errors.join('|')); };
    bad(f => { f.app = 'other'; }, /ファイルではありません/); bad(f => { f.type = 'backup'; }, /自作ツール/); bad(f => { f.format = 99; }, /新しい形式/); bad(f => { delete f.format; }, /バージョン/); bad(f => { f.format = 1.5; });
    bad(f => { delete f.tool; }, /tool/); bad(f => { f.tool.name = ''; }, /名前/); bad(f => { f.tool.creation = 'x'; }); bad(f => { f.tool.creation = null; });
    bad(f => { f.tool.creation.scripts[0].body.push({ type: 'runScript', in: { code: 'alert(1)' } }); }, /未対応/);
    bad(f => { f.tool.creation.scripts[0].body.push({ type: 'eval', in: { code: 'alert(1)' } }); }, /未対応/);
    bad(f => { f.tool.creation.scripts[0].type = 'draw'; }); bad(f => { f.tool.creation.vars = [{ name: 'a', value: { x: 1 } }]; });
    bad(f => { f.tool.creation.scripts.push({ type: 'onStart', body: [{ type: 'fill', in: { color: 'javascript:alert(1)' } }] }); });
    assert.strictEqual(Cr.inspectFile(good, Cr.LIMITS.fileBytes + 1).ok, false); [null, [], 5, 'x', {}].forEach(x => assert.strictEqual(Cr.inspectFile(x, 1).ok, false));
    const w = J(good); w.tool.creation.scripts[0].body.push({ type: 'size', in: { n: 123456789 } }); const r = Cr.inspectFile(w, 1); assert.ok(r.ok && r.warnings.length, '範囲外の数は直して警告');
    const count = (await PZ.projects.list()).length; bad(f => { f.tool.creation.scripts = [{ type: 'nope' }]; }); assert.strictEqual((await PZ.projects.list()).length, count);
  });

  /* ---------- 安全性: eval / Function を使っていない ---------- */
  await ok('安全性: Creation Engine のソースに eval・Function・文字列タイマー・innerHTML が無い', () => {
    const files = fs.readdirSync(path.join(root, 'js/creation')).map(f => 'js/creation/' + f).concat(fs.readdirSync(path.join(root, 'js/pages')).filter(f => /^create/.test(f)).map(f => 'js/pages/' + f));
    assert.ok(files.length >= 7, files.join());
    files.forEach(f => {
      const src = fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.ok(!/(?<![.\w$])eval\s*\(/.test(src), f + " eval"); assert.ok(!/\bnew\s+Function\b|\bFunction\s*\(/.test(src), f + ' Function');
      assert.ok(!/setTimeout\s*\(\s*['"`]/.test(src) && !/setInterval\s*\(\s*['"`]/.test(src), f + ' timer string');
      assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\bimport\s*\(/.test(src), f + ' html/import');
      assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sendBeacon/.test(src.replace(/localStorage/g, '')) || /create\.js/.test(f) === false, f + ' network');
    });
  });
  await ok('安全性: 仕様に無い関数はデータから呼べない（プロトタイプ経由・継承プロパティ）', () => {
    const polluted = JSON.parse('{"type":"onStart","body":[{"type":"toString"},{"type":"__proto__"},{"type":"constructor"}]}');
    assert.ok(!Cr.validate(prog([polluted])).ok); assert.strictEqual(Cr.has('constructor'), false); assert.strictEqual(Cr.has('hasOwnProperty'), false); assert.strictEqual(Cr.spec('__proto__'), null);
  });

  console.log(n + ' tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
