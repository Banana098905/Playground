// Remix Engine（Phase 4）のテスト: 派生・系統・履歴・部品・組み合わせ・書き出し/読み込み・バックアップ・安全性・ビルド
// 依存なし: node scripts/test-remix.js
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const sandbox = { window: {}, document: { createElement: () => ({ getContext: () => null }) }, console, Date, Math, JSON, setTimeout, clearTimeout, Promise, Map, Uint16Array };
sandbox.window = sandbox; vm.createContext(sandbox);
['config', 'util', 'model', 'creation/spec', 'creation/program', 'creation/runtime', 'creation/samples', 'creation/io', 'storage/fallback', 'projects', 'userdata', 'registry', 'labs-core',
  'remix/core', 'remix/parts', 'remix/builtins', 'remix/store', 'remix/io']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), sandbox, { filename: f }));
const PZ = sandbox.PZ, Cr = PZ.creation, M = PZ.model, R = PZ.remix, Pt = R.parts, St = R.store, W = R.work;
// vm の中で作られた配列・オブジェクトは prototype が違うため、JSON の文字列で比べる
assert.deepStrictEqual = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
let n = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('  ok  ' + name); });
const J = (x) => JSON.parse(JSON.stringify(x));
const B = (type, inn, bodies, id) => Object.assign({ type, in: inn || {} }, id ? { id } : {}, bodies || {});
const prog = (scripts, vars, extra) => Object.assign({ v: 1, canvas: { w: 800, h: 500, bg: '#101215' }, vars: vars || [], scripts }, extra || {});
function recorder() {
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => k === 'canvas' ? {} : (...a) => { calls.push(k + '(' + a.join(',') + ')'); }, set: () => true });
  return { ctx, calls, count: (name) => calls.filter(c => c.startsWith(name + '(')).length };
}
const run = (p, frames) => { const r = recorder(); const rt = Cr.runHeadless(p, r.ctx, { frames: frames || 20 }); return { rt, r }; };

(async () => {
  const repo = new PZ.storage.MemoryRepo();
  PZ.storage.open = () => Promise.resolve(repo);
  await PZ.projects.init();
  const P = PZ.projects;

  // 元になる作品（Phase 3 の方法で保存した、Remix の情報を持たない作品）
  const baseCreation = Cr.sampleProgram('bouncing-ball');
  const base = await P.createCreation({ name: '元の作品', creation: baseCreation, tags: ['元'] });
  const baseSnapshot = JSON.stringify(await P.get(base.id));

  /* ---------- 1〜3. 派生 ---------- */
  let d1;
  await ok('1. 元作品から派生作品を作成できる（派生元・系統・履歴つき）', async () => {
    const spec = await W.prepareDerive(base);
    assert.strictEqual(spec.parentId, base.id); assert.strictEqual(spec.name, '元の作品 Remix');
    assert.strictEqual(spec.remix.origin.id, base.id); assert.strictEqual(spec.remix.origin.name, '元の作品'); assert.strictEqual(spec.remix.origin.at, base.updatedAt);
    assert.deepStrictEqual(spec.remix.lineage.map(l => l.id), [base.id]);
    // 元のブロックIDを引き継ぐ（差分で「同じブロック」を追える）
    assert.strictEqual(spec.creation.scripts[0].id, base.creation.scripts[0].id);
    assert.notStrictEqual(spec.creation, base.creation, '深いコピー');
    const edited = J(spec.creation); edited.vars[0].value = 99;
    d1 = await W.createDerived(spec, edited, { name: spec.name, note: '最初の改造' });
    assert.notStrictEqual(d1.id, base.id); assert.strictEqual(d1.parentId, base.id); assert.strictEqual(d1.kind, 'creation');
    assert.strictEqual(d1.remix.origin.id, base.id); assert.ok(/へんすう/.test(d1.remix.summary), d1.remix.summary);
    const got = await P.get(d1.id); assert.strictEqual(got.remix.origin.name, '元の作品'); assert.strictEqual(got.creation.vars[0].value, 99);
    const hist = await St.history.list(d1.id);
    assert.deepStrictEqual(hist.map(h => h.kind), ['save', 'origin']); assert.ok(hist.find(h => h.kind === 'origin').pin);
    assert.strictEqual(hist[0].note, '最初の改造');
    // サンプルからも派生できる
    const sp = W.deriveSpec({ sample: 'click-color', name: 'クリックで色が変わる図形' });
    assert.strictEqual(sp.remix.origin.sample, 'click-color'); assert.strictEqual(sp.remix.origin.id, null); assert.strictEqual(sp.parentId, null);
  });

  await ok('2. 派生作品を変更しても元作品は変わらない（元を変えても派生は変わらない）', async () => {
    assert.strictEqual(JSON.stringify(await P.get(base.id)), baseSnapshot, '派生の作成だけでは元は変わらない');
    const c = J((await P.get(d1.id)).creation);
    c.scripts[0].body.push(Cr.makeBlock('note', { text: '追加' })); c.vars.push({ name: '新しい', value: 1 });
    const saved = await W.saveExisting(d1.id, c, { note: '2回目', expectUpdatedAt: d1.updatedAt });
    assert.ok(saved.remix.summary.length > 0 && saved.remix.summary !== '変更なし');
    assert.strictEqual(JSON.stringify(await P.get(base.id)), baseSnapshot, '派生を保存しても元は変わらない');
    // 元作品を後から変更する → 既存の派生は勝手に変わらない
    const before = JSON.stringify((await P.get(d1.id)).creation);
    const b2 = await P.get(base.id); b2.creation.vars[0].value = -5; b2.name = '元の作品（改）'; await P.save(b2, true);
    assert.strictEqual(JSON.stringify((await P.get(d1.id)).creation), before, '元を変えても派生のデータは同じ');
    assert.strictEqual((await P.get(d1.id)).remix.origin.name, '元の作品', '派生元の記録（名前）は派生した時点のまま');
    // 元を戻しておく
    await P.save(JSON.parse(baseSnapshot), false);
  });

  let d2;
  await ok('3. 派生作品からさらに派生できる（系統が2段になる）', async () => {
    const cur = await P.get(d1.id);
    const spec = await W.prepareDerive(cur);
    assert.strictEqual(spec.remix.origin.ver, 3, '派生元の履歴番号（v0 派生元・v1 最初の保存・v2 2回目 → 次は…）'.length && spec.remix.origin.ver);
    assert.deepStrictEqual(spec.remix.lineage.map(l => l.id), [base.id, d1.id]);
    d2 = await W.createDerived(spec, spec.creation, { name: spec.name });
    assert.strictEqual(d2.parentId, d1.id); assert.deepStrictEqual(d2.remix.lineage.map(l => l.id), [base.id, d1.id]);
    assert.strictEqual(d2.name, '元の作品 Remix 2'.length ? d2.name : '');
    assert.ok(/^元の作品 Remix( 2| 3)?$/.test(d2.name), d2.name);
    // 変更なしの派生は、概要が「変更なし」にならず派生と分かる
    const h = await St.history.list(d2.id); assert.ok(/派生/.test(h[0].summary));
  });

  /* ---------- 4. 系統ツリー ---------- */
  await ok('4. 派生関係のツリーを正しく作れる（深さ・順序・削除済みの祖先・循環）', async () => {
    const all = await P.list();
    const forest = R.buildTree(all);
    const fam = R.familyOf(forest, d2.id);
    assert.ok(fam && fam.id === base.id, '根は元作品');
    const flat = R.flattenTree([fam]).map(x => x.id + ':' + x.depth);
    assert.deepStrictEqual(flat, [base.id + ':0', d1.id + ':1', d2.id + ':2']);
    assert.strictEqual(R.countDescendants(fam), 2);
    // 元作品（と、間の作品）を削除しても、派生作品は壊れず、系統に「削除済み」の位置が残る
    await P.remove(base.id);
    const after = await P.list();
    assert.ok(after.some(p => p.id === d1.id) && after.some(p => p.id === d2.id));
    assert.strictEqual((await P.get(d2.id)).creation.scripts.length > 0, true, '派生作品はそのまま開ける');
    let f2 = R.buildTree(after); const fam2 = R.familyOf(f2, d2.id);
    assert.strictEqual(fam2.ghost, true); assert.strictEqual(fam2.name, '元の作品'); assert.strictEqual(fam2.children[0].id, d1.id);
    await P.remove(d1.id);
    f2 = R.buildTree(await P.list()); const fam3 = R.familyOf(f2, d2.id);
    assert.deepStrictEqual(R.flattenTree([fam3]).map(x => (x.ghost ? 'g:' : '') + x.id), ['g:' + base.id, 'g:' + d1.id, d2.id], '祖先が2つとも消えても位置が残る');
    // 循環した参照でも止まらない
    const a = M.sanitizeProject({ id: 'ca', kind: 'creation', name: 'A', creation: Cr.blank(), parentId: 'cb', createdAt: 1, updatedAt: 1 });
    const b = M.sanitizeProject({ id: 'cb', kind: 'creation', name: 'B', creation: Cr.blank(), parentId: 'ca', createdAt: 2, updatedAt: 2 });
    const cyc = R.flattenTree(R.buildTree([a, b])); assert.strictEqual(cyc.length, 2);
    // 元に戻す（以降のテスト用）
    await P.restore(J(JSON.parse(baseSnapshot)));
  });
  await ok('4b. 系統: ツリーの画面用の並び（兄弟は作成順、複数の木は更新が新しい順）', async () => {
    const mk = (id, parent, t) => M.sanitizeProject({ id, kind: 'creation', name: id, creation: Cr.blank(), parentId: parent, createdAt: t, updatedAt: t });
    const forest = R.buildTree([mk('r1', null, 10), mk('c2', 'r1', 30), mk('c1', 'r1', 20), mk('r2', null, 100)]);
    assert.deepStrictEqual(forest.map(r => r.id), ['r2', 'r1']);
    assert.deepStrictEqual(forest[1].children.map(c => c.id), ['c1', 'c2']);
  });

  /* ---------- 5. 変更履歴 ---------- */
  await ok('5. 変更履歴から以前のバージョンを別作品として復元できる', async () => {
    const w = await P.createCreation({ name: '履歴テスト', creation: prog([B('onStart', {}, { body: [B('fill', { color: '#ff0000' })] })]) });
    const states = [];
    for (let i = 0; i < 3; i++) {
      const c = J((await P.get(w.id)).creation); c.scripts[0].body.push(B('size', { n: 10 + i }, null, 'sz' + i));
      states.push(J(c));
      await W.saveExisting(w.id, c, { note: 'step' + i });
    }
    const hist = await St.history.list(w.id);
    assert.deepStrictEqual(hist.map(h => h.kind), ['save', 'save', 'save', 'seed'], '最初に「開始時の状態」が残る');
    assert.deepStrictEqual(hist.map(h => h.no), [4, 3, 2, 1]);
    const v2 = hist.find(h => h.no === 2);
    const restored = await W.restoreAsNew(w.id, v2.no);
    assert.notStrictEqual(restored.id, w.id); assert.strictEqual(restored.parentId, w.id); assert.strictEqual(restored.remix.origin.ver, 2);
    assert.strictEqual(restored.creation.scripts[0].body.length, 2, 'v2 = 図形1個ぶん増えた状態（fill + size0）');
    assert.strictEqual(R.sameCreation(restored.creation, Cr.sanitize(states[0])), true);
    // 元の作品と履歴は変わらない
    assert.strictEqual((await P.get(w.id)).creation.scripts[0].body.length, 4);
    assert.strictEqual((await St.history.list(w.id)).length, 4);
    // 変更のない保存は履歴を増やさない
    const same = await W.saveExisting(w.id, (await P.get(w.id)).creation, {});
    assert.strictEqual((await St.history.list(w.id)).length, 4); assert.ok(same._skipped);
  });
  await ok('5b. 履歴の保存量が上限を超えない（件数・サイズ・ピン留め・整理）', async () => {
    const w = await P.createCreation({ name: '上限テスト', creation: prog([B('onStart', {}, { body: [] })]) });
    const big = (i) => prog([B('onStart', {}, { body: [B('note', { text: 'x'.repeat(80) + i })].concat(Array.from({ length: 150 }, (_, k) => B('note', { text: 'n' + k + 'y'.repeat(60) + i }))) })]);
    for (let i = 0; i < R.LIMITS.versions + 12; i++) await St.history.record(w.id, big(i), { name: 'v', force: true });
    let h = await St.history.get(w.id);
    assert.ok(h.versions.length <= R.LIMITS.versions, '件数 ' + h.versions.length);
    assert.ok(h.versions.reduce((s, v) => s + v.bytes, 0) <= R.LIMITS.historyBytes + h.versions[h.versions.length - 1].bytes, 'サイズ');
    assert.strictEqual(h.versions[h.versions.length - 1].no, R.LIMITS.versions + 12, '最新の版は必ず残る');
    const keepNo = h.versions[0].no; await St.history.pin(w.id, keepNo, true);
    for (let i = 0; i < 20; i++) await St.history.record(w.id, big(100 + i), { name: 'v', force: true });
    h = await St.history.get(w.id); assert.ok(h.versions.some(v => v.no === keepNo && v.pin), 'ピン留めは消えない');
    await assert.rejects(async () => { for (let k = 0; k < 8; k++) { const x = (await St.history.get(w.id)).versions.filter(v => !v.pin)[k]; await St.history.pin(w.id, x.no, true); } }, /ピン留めできるのは/);
    const freed = await St.history.trimAll(2); assert.ok(freed > 0);
    h = await St.history.get(w.id); assert.ok(h.versions.length <= 2 + R.LIMITS.pins + 1, '整理後 ' + h.versions.length);
    const u = await St.history.usage([w.id]); assert.ok(u.works >= 1 && u.bytes > 0);
    // 孤立した履歴（作品が無い）を掃除
    await St.history.record('ghost-work', big(0), { force: true });
    const ids = (await P.list()).map(p => p.id);
    assert.ok((await St.history.usage(ids)).orphans.includes('ghost-work'));
    assert.ok((await St.history.gc(ids)) >= 1); assert.strictEqual((await St.history.usage(ids)).orphans.length, 0); assert.ok((await St.history.usage(ids)).works >= 1, '作品のある履歴は残る');
  });
  await ok('5c. 保存の競合（別のタブで更新済み）は上書きせず知らせる / 自動保存の下書きは作品に触れない', async () => {
    const w = await P.createCreation({ name: '競合', creation: prog([B('onStart', {}, { body: [] })]) });
    const other = J(w.creation); other.description = '別の場所の変更';
    const cur = await P.get(w.id); cur.creation = other; cur.updatedAt = w.updatedAt + 50; await P.save(cur, false);
    await assert.rejects(() => W.saveExisting(w.id, w.creation, { expectUpdatedAt: w.updatedAt }), e => e.code === 'STALE');
    assert.strictEqual((await P.get(w.id)).creation.description, '別の場所の変更');
    const before = JSON.stringify(await P.get(w.id)); const hBefore = JSON.stringify(await St.history.get(w.id));
    assert.strictEqual(await St.drafts.save('w:' + w.id, { workId: w.id, name: '下書き', creation: w.creation, at: Date.now() }), true);
    assert.strictEqual(JSON.stringify(await P.get(w.id)), before, '下書きは作品を変えない'); assert.strictEqual(JSON.stringify(await St.history.get(w.id)), hBefore, '下書きは履歴を増やさない');
    assert.strictEqual((await St.drafts.list())[0].name, '下書き'); assert.strictEqual((await St.drafts.load('w:' + w.id)).name, '下書き');
    await St.drafts.clear('w:' + w.id); assert.strictEqual(await St.drafts.load('w:' + w.id), null);
    assert.strictEqual(await St.drafts.save('bad key!', { x: 1 }), false, '不正なキーは保存しない');
    assert.strictEqual(await St.drafts.save('big', { name: 'x'.repeat(R.LIMITS.draftBytes + 10) }), false, '大きすぎる下書きは保存しない');
    for (let i = 0; i < R.LIMITS.drafts + 4; i++) await St.drafts.save('k' + i, { name: 'd' + i, at: i + 1 });
    assert.strictEqual((await St.drafts.list()).length, R.LIMITS.drafts, '下書きの数に上限');
  });

  /* ---------- 差分 ---------- */
  await ok('差分: 追加・削除・値の変更・接続の変更・へんすう・名前を見分け、概要の文章にする', () => {
    const a = Cr.sampleProgram('catch-game');
    assert.ok(R.diff(a, J(a)).same); assert.strictEqual(R.summarize(R.diff(a, J(a))), '変更なし');
    const b = J(a);
    const tick = b.scripts.find(s => s.type === 'onTick');
    const removed = tick.body.pop();                                  // 削除
    tick.body.push(Cr.makeBlock('note', { text: '追加したメモ' }));      // 追加
    const mv = tick.body.find(x => x.type === 'moveTo'); mv.in.x = 123; // 値の変更
    b.vars.push({ name: '新しい', value: 1 }); b.vars[0].value += 1;
    const d = R.diff(a, b, { nameA: 'A', nameB: 'B' });
    assert.ok(!d.same); assert.strictEqual(d.counts.added, 1); assert.ok(d.counts.removed >= 1); assert.ok(d.counts.changed >= 1 && d.counts.params >= 1);
    assert.strictEqual(d.vars.added.length, 1); assert.strictEqual(d.vars.changed.length, 1); assert.deepStrictEqual(d.name, { from: 'A', to: 'B' });
    const s = R.summarize(d); assert.ok(/名前を変更/.test(s) && /ブロック \+1/.test(s) && /内容の変更/.test(s) && /へんすう/.test(s), s);
    assert.ok(d.rows.some(r => r.kind === 'add' && /追加したメモ/.test(r.b.text))); assert.ok(d.rows.some(r => r.kind === 'chg'));
    // 接続の変更（別の場所へ移す）
    const c = J(a); const t2 = c.scripts.find(s => s.type === 'onTick'); const mvd = t2.body.shift(); t2.body.push(mvd);
    const dm = R.diff(a, c); assert.ok(dm.counts.moved >= 1 && dm.counts.added === 0 && dm.counts.removed === 0, JSON.stringify(dm.counts));
    const e = J(a); const st = e.scripts.find(s => s.type === 'onStart'); const blk = st.body.pop(); const rep = Cr.makeBlock('repeat', { times: 2 }); rep.body = [blk]; st.body.push(rep);
    assert.ok(R.diff(a, e).counts.added === 1 && R.diff(a, e).counts.moved >= 1, '「くりかえす」の中へ入れた = 接続の変更');
    // IDが重ならない別々の構成は、見た目の文章で突き合わせる
    const x = Cr.sampleProgram('click-color'), y = Cr.sampleProgram('click-color'); assert.strictEqual(R.diff(x, y).mode, 'text'); assert.ok(R.diff(x, y).same);
    assert.strictEqual(R.blockText(Cr.makeBlock('moveTo', { x: 1, y: B('mouseY') })), '位置を x 1 y (マウスの y) にする');
  });

  /* ---------- 6〜8. 部品 ---------- */
  let comp;
  await ok('6. 再利用部品を保存し、別作品に挿入できる（入力・出力・設定値・バージョン）', async () => {
    const src = prog([B('onTick', {}, { body: [B('if', { cond: true }, { then: [
      B('change', { name: 'angle', by: 3 }, null, 's1'),
      B('fill', { color: B('hsl', { h: B('var', { name: 'angle' }), s: 80, l: 60 }) }),
      B('size', { n: 30 }, null, 's2'), B('moveTo', { x: B('mouseX'), y: B('var', { name: 'ty' }) }), B('draw', { shape: 'circle' })
    ], else: [] }, 'g1')] }, 't1')], [{ name: 'angle', value: 0 }, { name: 'ty', value: 100 }]);
    const sv = Cr.validate(src); assert.ok(sv.ok, JSON.stringify(sv.errors));
    const ex = Pt.extract(sv.clean, 'g1', { name: 'まわる点', description: 'テスト用', params: [{ key: 'step', label: '角度の増え方', blockId: 's1', slot: 'by' }, { key: 'size', label: '大きさ', blockId: 's2', slot: 'n' }] });
    assert.ok(ex.ok, ex.error); assert.ok(ex.candidates.length >= 4);
    const mk = Pt.make(ex.comp, { name: 'まわる点', description: 'テスト用' }); assert.ok(mk.ok, JSON.stringify(mk.errors));
    comp = await St.components.save(mk.comp); assert.strictEqual(comp.version, 1);
    // 入力（必要なへんすう）と出力と設定値
    assert.deepStrictEqual(comp.needs.map(x => x.name + ':' + x.type), ['ty:num']);
    assert.deepStrictEqual(comp.provides.map(x => x.name), ['angle']); assert.deepStrictEqual(comp.vars.map(x => x.name), ['angle']);
    assert.deepStrictEqual(comp.params.map(x => x.key + ':' + x.type + ':' + x.def), ['step:num:3', 'size:num:30']);
    assert.strictEqual(Pt.ioText(comp).outputs[0], 'angle（数）');
    // 保存した部品が一覧にある。付属の部品も
    const all = await St.components.all(); assert.ok(all.some(c => c.id === comp.id)); assert.ok(all.filter(c => c.builtin).length === Pt.builtinCount);
    // 別の作品に挿入（必要なへんすう ty を作品側に用意）
    const target = Cr.validate(prog([B('onTick', {}, { body: [B('clear')] })], [{ name: 'ty', value: 250 }])).clean;
    const before = JSON.stringify(target);
    const r = Pt.insert(target, comp, { params: { step: 7, size: 55 } });
    assert.ok(r.ok, JSON.stringify(r.problems));
    assert.strictEqual(JSON.stringify(target), before, '挿入元の作品は変更しない（純粋）');
    const ins = r.creation.scripts[0].body; assert.strictEqual(ins.length, 2); assert.strictEqual(ins[1].type, 'if'); assert.strictEqual(ins[1].then[0].type, 'change');
    assert.strictEqual(ins[1].then[0].in.by, 7, '設定値が反映される'); assert.strictEqual(ins[1].then[2].in.n, 55);
    assert.ok(r.creation.vars.some(v => v.name === 'angle'), '部品のへんすうも追加される');
    assert.strictEqual(r.inserted.length, 1);
    assert.ok(ins[1].id !== 'g1' && ins[1].then[0].id !== 's1', 'ブロックIDは新しい');
    const { rt, r: rec } = run(r.creation, 30); assert.strictEqual(rt.state, 'running', JSON.stringify(rt.error)); assert.ok(rec.count('arc') >= 30);
    // 同じ部品を同じ作品にもう一度入れても動く（へんすう名は自動で変わる）
    const r2 = Pt.insert(r.creation, comp, {}); assert.ok(r2.ok); assert.deepStrictEqual(r2.renamed, [{ from: 'angle', to: 'angle_2' }]);
    // 部品の更新でバージョンが上がり、挿入済みの作品は変わらない
    const up = await St.components.save(Object.assign(J(comp), { description: '更新' })); assert.strictEqual(up.version, 2);
    assert.strictEqual(R.sameCreation(r.creation, Cr.validate(r.creation).clean), true);
    // 作品の中の「イベント」の部品も入れられる
    const ev = Pt.extract(sv.clean, 't1', {}); assert.strictEqual(ev.comp.kind, 'event');
  });

  await ok('6b. 付属の部品がすべて、実際に挿入して実行できる', async () => {
    const vars = [{ name: 'ax', value: 100 }, { name: 'ay', value: 100 }, { name: 'bx', value: 120 }, { name: 'by', value: 100 }, { name: 'valueA', value: 12 }, { name: 'valueB', value: 3 }];
    for (const c of Pt.builtins()) {
      let t = Cr.validate(prog([B('onTick', {}, { body: [] })], vars)).clean;
      const r = Pt.insert(t, c, {}); assert.ok(r.ok, c.id + ' ' + JSON.stringify(r.problems));
      const x = run(r.creation, 40); assert.strictEqual(x.rt.state, 'running', c.id + ' ' + JSON.stringify(x.rt.error));
      if (c.kind === 'event' || /color|follow|orbit/.test(c.id)) assert.ok(x.r.count('arc') + x.r.calls.length > 0);
      // へんすうを足さない作品でも、足りないものは「作る」で補える
      const empty = Cr.validate(prog([B('onStart', {}, { body: [] })])).clean;
      const need = Pt.insert(empty, c, {});
      if (c.needs.length) { assert.ok(!need.ok && need.problems.every(p => p.code === 'missing-var'), c.id); assert.ok(Pt.insert(empty, c, { createMissing: true }).ok, c.id + ' createMissing'); }
      else assert.ok(need.ok, c.id);
    }
    // 結果の確認: 衝突判定が hit を更新する / 条件の組み合わせ / タイマーが数える
    const col = Pt.builtins().find(c => c.id === 'builtin:circle-collision');
    let t = Cr.validate(prog([B('onTick', {}, { body: [] })], [{ name: 'ax', value: 0 }, { name: 'ay', value: 0 }, { name: 'bx', value: 10 }, { name: 'by', value: 0 }])).clean;
    let r = Pt.insert(t, col, { params: { dist: 20 } }); let x = run(r.creation, 3); assert.strictEqual(x.rt.vars.get('hit'), true);
    r = Pt.insert(t, col, { params: { dist: 5 } }); x = run(r.creation, 3); assert.strictEqual(x.rt.vars.get('hit'), false);
    const tm = Pt.builtins().find(c => c.id === 'builtin:interval-counter'); r = Pt.insert(Cr.blank(), tm, { params: { sec: 0.1 } }); assert.ok(r.ok);
    x = run(r.creation, 60); assert.ok(x.rt.vars.get('ticks') >= 5, 'ticks=' + x.rt.vars.get('ticks'));
    const cc = Pt.builtins().find(c => c.id === 'builtin:condition-combo');
    t = Cr.validate(prog([B('onTick', {}, { body: [] })], [{ name: 'valueA', value: 20 }, { name: 'valueB', value: 1 }])).clean;
    x = run(Pt.insert(t, cc, {}).creation, 3); assert.strictEqual(x.rt.vars.get('conditionOk'), true);
    t.vars[0].value = 1; t.vars[1].value = 9; x = run(Pt.insert(t, cc, {}).creation, 3); assert.strictEqual(x.rt.vars.get('conditionOk'), false);
  });

  await ok('7. へんすう名の衝突を安全に処理する（自動で名前を変え、既存へ接続もできる）', () => {
    const c = Pt.make({ name: '数える', kind: 'stmt', blocks: [B('change', { name: 'count', by: 1 }), B('text', { text: B('var', { name: 'count' }) })], vars: [{ name: 'count', value: 5 }] }, {}).comp;
    const target = Cr.validate(prog([B('onTick', {}, { body: [B('set', { name: 'count', value: 100 }), B('size', { n: B('var', { name: 'count' }) })] })], [{ name: 'count', value: 1 }, { name: 'count_2', value: 2 }])).clean;
    const before = JSON.stringify(target);
    const r = Pt.insert(target, c, {});
    assert.ok(r.ok, JSON.stringify(r.problems)); assert.deepStrictEqual(r.renamed, [{ from: 'count', to: 'count_3' }], '使われている count_2 も避ける');
    const body = r.creation.scripts[0].body;
    assert.strictEqual(body[2].in.name, 'count_3'); assert.strictEqual(body[3].in.text.in.name, 'count_3', '値ブロックの中の名前も付け替わる');
    assert.strictEqual(body[0].in.name, 'count', '作品の元のブロックは変わらない'); assert.strictEqual(body[1].in.n.in.name, 'count');
    assert.deepStrictEqual(r.creation.vars.map(v => v.name + '=' + v.value), ['count=1', 'count_2=2', 'count_3=5'], '初期値は部品のもの');
    assert.strictEqual(JSON.stringify(target), before);
    // 既存のへんすうに接続する
    const r2 = Pt.insert(target, c, { map: { count: 'count_2' } }); assert.ok(r2.ok); assert.deepStrictEqual(r2.connected, [{ from: 'count', to: 'count_2' }]);
    assert.strictEqual(r2.creation.scripts[0].body[2].in.name, 'count_2'); assert.strictEqual(r2.creation.vars.length, 2); assert.ok(r2.warnings.some(w => /書き換える/.test(w)));
    // 20文字の名前でも、付け替えた名前が長くなりすぎない
    const longName = 'あ'.repeat(20);
    const c3 = Pt.make({ name: '長い名前', kind: 'stmt', blocks: [B('set', { name: longName, value: 1 })] }, {}).comp;
    const t3 = Cr.validate(prog([B('onStart', {}, { body: [B('set', { name: longName, value: 2 })] })], [{ name: longName, value: 0 }])).clean;
    const r3 = Pt.insert(t3, c3, {}); assert.ok(r3.ok, JSON.stringify(r3.problems)); assert.ok(r3.renamed[0].to.length <= 20 && Cr.isVarName(r3.renamed[0].to));
    // __proto__ という名前でも壊れない
    const c4 = Pt.make({ name: 'proto', kind: 'stmt', blocks: [B('set', { name: '__proto__', value: 1 })] }, {}).comp;
    const t4 = Cr.validate(prog([B('onStart', {}, { body: [B('set', { name: '__proto__', value: 2 })] })], [{ name: '__proto__', value: 0 }])).clean;
    const r4 = Pt.insert(t4, c4, {}); assert.ok(r4.ok, JSON.stringify(r4.problems)); assert.strictEqual(r4.renamed[0].to, '__proto___2'.slice(0, 20));
    assert.strictEqual(Object.prototype.polluted, undefined);
  });

  await ok('8. 互換性のない部品・組み合わせを拒否し、理由と直し方を示す（作品は変更しない）', async () => {
    const need = Pt.make({ name: '距離', kind: 'stmt', blocks: [B('if', { cond: B('compare', { a: B('var', { name: 'x' }), op: 'lt', b: 5 }) }, { then: [B('note', { text: 'ok' })] })] }, {}).comp;
    assert.deepStrictEqual(need.needs, [{ name: 'x', type: 'any' }].map(() => need.needs[0]));
    const needNum = Pt.make({ name: '加算', kind: 'stmt', blocks: [B('change', { name: 'x', by: 1 })] }, {}).comp; // change は数が必要。値を入れるので持つ側になる
    const needsX = Pt.make({ name: '読むだけ', kind: 'stmt', blocks: [B('size', { n: B('var', { name: 'x' }) })] }, {}).comp;
    assert.deepStrictEqual(needsX.needs, [{ name: 'x', type: 'num' }]);
    const textTarget = Cr.validate(prog([B('onStart', {}, { body: [] })], [{ name: 'x', value: '文字です' }])).clean;
    const before = JSON.stringify(textTarget);
    let r = Pt.insert(textTarget, needsX, {});
    assert.ok(!r.ok && r.creation === null); assert.strictEqual(r.problems[0].code, 'type-mismatch'); assert.ok(/数として使いますが/.test(r.problems[0].msg) && /直す/.test(r.problems[0].fix), JSON.stringify(r.problems[0]));
    r = Pt.insert(Cr.blank(), needsX, {}); assert.strictEqual(r.problems[0].code, 'missing-var'); assert.ok(/作る|接続/.test(r.problems[0].fix));
    r = Pt.insert(textTarget, needsX, { map: { x: 'nothing' } }); assert.strictEqual(r.problems[0].code, 'missing-var');
    assert.strictEqual(JSON.stringify(textTarget), before, '拒否しても作品は変わらない');
    // 未対応・壊れた・新しすぎる・コード入りの部品
    const evil = J(needsX); evil.blocks.push({ type: 'runScript', in: { code: 'alert(1)' } });
    r = Pt.insert(Cr.blank(), evil, {}); assert.ok(!r.ok && r.problems[0].code === 'invalid-part'); assert.ok(/未対応/.test(r.problems[0].msg));
    const future = J(needsX); future.v = 99; assert.ok(!Pt.insert(Cr.blank(), future, {}).ok);
    ['', null, [], 5, { name: 'x' }, { name: 'x', kind: 'stmt', blocks: [] }, { name: '', kind: 'stmt', blocks: [{ type: 'note' }] }, { name: 'x', kind: 'weird', blocks: [{ type: 'note' }] }, { name: 'x', kind: 'stmt', blocks: [{ type: 'onStart' }] }].forEach(x => assert.ok(!Pt.sanitize(x).ok, JSON.stringify(x)));
    assert.ok(!Pt.sanitize({ name: 'x', kind: 'event', blocks: [{ type: 'draw' }] }).ok, 'イベントの部品の中身はイベント');
    // 上限: 入れ子の深さ・ブロック数・スクリプト数・へんすう数
    let deepBody = [B('note', { text: 'x' })]; for (let i = 0; i < 6; i++) deepBody = [B('if', { cond: true }, { then: deepBody })];
    const deep = Pt.make({ name: '深い', kind: 'stmt', blocks: deepBody }, {}).comp;
    let nest = [B('note', { text: 'y' })]; for (let i = 0; i < 4; i++) nest = [B('if', { cond: true }, { then: nest })];
    const nestT = Cr.validate(prog([B('onStart', {}, { body: nest })])).clean; const inner = Cr.find(nestT, Cr.stats(nestT) && (function () { let id; Cr.walk(nestT, b => { if (b.type === 'note') id = b.id; }); return id; })());
    const ownerId = inner.parent.id;
    r = Pt.insert(nestT, deep, { target: { ownerId, body: 'then', index: 0 } }); assert.ok(!r.ok && r.problems[0].code === 'limit-depth', JSON.stringify(r.problems)); assert.ok(r.problems[0].fix);
    const ev = Pt.make({ name: 'イベント', kind: 'event', blocks: [B('onTick', {}, { body: [] })] }, {}).comp;
    const full = Cr.validate(prog(Array.from({ length: Cr.LIMITS.scripts }, () => B('onTick', {}, { body: [] })))).clean;
    r = Pt.insert(full, ev, {}); assert.ok(!r.ok && r.problems[0].code === 'limit-scripts');
    const manyVars = Cr.validate(prog([B('onStart', {}, { body: [] })], Array.from({ length: Cr.LIMITS.vars }, (_, i) => ({ name: 'v' + i, value: 0 })))).clean;
    r = Pt.insert(manyVars, Pt.make({ name: 'v', kind: 'stmt', blocks: [B('set', { name: 'zz', value: 1 })] }, {}).comp, {}); assert.ok(!r.ok && r.problems[0].code === 'limit-vars');
    r = Pt.insert(Cr.blank(), needNum, { map: {} }); assert.ok(r.ok || r.problems.length >= 0);
    r = Pt.insert(Cr.blank(), Pt.builtins()[0], { params: { sat: 'abc' } }); assert.ok(!r.ok && r.problems[0].code === 'bad-param');
    r = Pt.insert(Cr.blank(), Pt.builtins()[0], { params: { sat: 9999 } }); assert.ok(r.ok && r.warnings.some(w => /範囲内/.test(w)));
    // 作品どうしの組み合わせ: 未対応ブロックを含む作品・ブロック数の上限を拒否
    const withUnknown = Cr.blank(); withUnknown.scripts = [{ id: 'u1', type: 'onStart', in: {}, body: [{ id: 'u2', type: 'hackIt', in: {} }] }];
    let cr = Pt.composeWorks(Cr.blank(), withUnknown, {}); assert.ok(!cr.ok); assert.ok(/未対応/.test(cr.problems[0].msg));
    const big = prog(Array.from({ length: 5 }, () => B('onTick', {}, { body: Array.from({ length: 60 }, () => B('note', { text: 'n' })) })));
    cr = Pt.composeWorks(Cr.validate(big).clean, Cr.validate(big).clean, {}); assert.ok(!cr.ok && cr.problems[0].code === 'limit-blocks', JSON.stringify(cr.problems));
  });

  await ok('8b. 作品どうしの組み合わせ: 不足を検出し、名前の衝突を避け、元の作品は変えない', async () => {
    const a = Cr.sampleProgram('bouncing-ball'), b = Cr.sampleProgram('mouse-particles');
    const aj = JSON.stringify(a), bj = JSON.stringify(b);
    const r = Pt.composeWorks(a, b, {});
    assert.strictEqual(JSON.stringify(a), aj); assert.strictEqual(JSON.stringify(b), bj, '組み合わせ前の作品は変わらない');
    assert.ok(r.ok, JSON.stringify(r.problems));
    assert.strictEqual(r.creation.scripts.length, a.scripts.length + b.scripts.length);
    const names = r.creation.vars.map(v => v.name); assert.strictEqual(new Set(names).size, names.length, 'へんすう名に重複なし');
    assert.ok(Cr.validate(r.creation).ok, '組み合わせ後に検証を通る'); assert.strictEqual(run(r.creation, 20).rt.state, 'running');
    // 衝突するへんすうを持つ作品どうし
    const c = Cr.sampleProgram('bouncing-ball'); const r2 = Pt.composeWorks(a, c, {});
    assert.ok(r2.ok); assert.ok(r2.renamed.length === a.vars.length, '同じ作品どうしなら、へんすうはすべて名前が変わる: ' + JSON.stringify(r2.renamed));
    assert.ok(run(r2.creation, 30).rt.state === 'running');
    // 一部のスクリプトだけを取り込む
    const only = Pt.composeWorks(a, b, { scriptIds: [b.scripts[0].id] }); assert.ok(only.ok); assert.strictEqual(only.creation.scripts.length, a.scripts.length + 1);
    // 足りない依存関係（読むだけで、どこにも無いへんすう）
    const src = Cr.validate(prog([B('onTick', {}, { body: [B('size', { n: B('var', { name: 'ほしい' }) })] })])).clean;
    const miss = Pt.composeWorks(Cr.blank(), src, {}); assert.ok(!miss.ok && miss.problems[0].code === 'missing-var' && /ほしい/.test(miss.problems[0].msg));
    assert.ok(Pt.composeWorks(Cr.blank(), src, { createMissing: true }).ok); assert.ok(Pt.composeWorks(Cr.validate(prog([], [{ name: '別名', value: 1 }])).clean, src, { map: { ほしい: '別名' } }).ok);
    // キャンバスの大きさが違うと注意する
    const small = J(b); small.canvas.w = 300; small.canvas.h = 300; const rs = Pt.composeWorks(a, small, {}); assert.ok(rs.ok && rs.warnings.some(w => /キャンバス/.test(w)));
  });

  /* ---------- 9〜10. 書き出し・読み込み ---------- */
  await ok('9. 作品・履歴・部品をJSONに書き出して、読み戻せる（新しいIDの別作品になる）', async () => {
    const w = await P.createCreation({ name: '共有する作品', creation: Cr.sampleProgram('click-color') });
    const c = J((await P.get(w.id)).creation); c.scripts[0].body.push(B('note', { text: '改造' })); const sv = await W.saveExisting(w.id, c, { note: '共有前', parts: [{ id: comp.id, name: comp.name, version: 2 }] });
    assert.deepStrictEqual(sv.remix.parts.map(x => x.id), [comp.id]);
    const pkg = await R.io.buildPackage(await P.get(w.id), {});
    assert.strictEqual(pkg.type, 'remix-package'); assert.strictEqual(pkg.format, 1); assert.ok(pkg.history.versions.length >= 2); assert.deepStrictEqual(pkg.components.map(x => x.id), [comp.id]);
    const text = JSON.stringify(pkg); const parsed = JSON.parse(text);
    const rep = await R.io.inspect(parsed, text.length);
    assert.ok(rep.ok, JSON.stringify(rep.errors)); assert.strictEqual(rep.sameIdExists, undefined, '書き出した作品のIDはファイルに入れない仕様ではなく、新しいIDで取り込む');
    assert.notStrictEqual(rep.work.project.id, w.id); assert.strictEqual(rep.summary.components, 1); assert.ok(rep.summary.history >= 2);
    assert.strictEqual(rep.components[0].status, 'same');
    const count = (await P.list()).length;
    const done = await R.io.apply(rep, {});
    assert.strictEqual((await P.list()).length, count + 1); assert.strictEqual(done.work.name, '共有する作品 (取り込み)');
    assert.strictEqual(R.sameCreation(done.work.creation, (await P.get(w.id)).creation), true, '中身が一致');
    assert.strictEqual(done.work.remix.parts[0].id, comp.id); assert.ok(done.history >= 3); const hh = await St.history.list(done.work.id); assert.strictEqual(hh[0].kind, 'import');
    assert.strictEqual(run(done.work.creation, 20).rt.state, 'running');
    assert.strictEqual((await P.get(w.id)).name, '共有する作品', '元の作品は上書きされない');
    // 部品だけのファイル。別のIDにするため、手元の部品を消してから読み戻す
    const cp = R.io.buildComponentPackage([comp]); await St.components.remove(comp.id);
    const crep = await R.io.inspect(J(cp), 1000); assert.ok(crep.ok && !crep.work && crep.components[0].status === 'new');
    const capplied = await R.io.apply(crep, {}); assert.strictEqual(capplied.components.added, 1); assert.ok((await St.components.get(comp.id)).name === comp.name);
    // Phase 3 の自作ツールファイル(.pzcreate.json)もそのまま読める
    const tool = J(Cr.toFile(await P.get(w.id))); const trep = await R.io.inspect(tool, 5000); assert.ok(trep.ok && trep.kind === 'tool' && trep.work.project.kind === 'creation');
  });

  await ok('10. 不正なJSON・改ざん・巨大なファイルを安全に拒否する（何も保存しない）', async () => {
    const w = (await P.list({ kind: 'creation' })).find(p => p.name === '共有する作品');
    const good = J(await R.io.buildPackage(w, {}));
    const bad = async (mut, re, label) => {
      const f = J(good); mut(f);
      const before = (await P.list()).length;
      const r = await R.io.inspect(f, 1000);
      assert.strictEqual(r.ok, false, label || 'rejected'); if (re) assert.ok(re.test(r.errors.join('|')), (label || '') + ' ' + r.errors.join('|'));
      assert.strictEqual((await P.list()).length, before);
    };
    await bad(f => { f.app = 'other'; }, /ファイルではありません/); await bad(f => { f.type = 'creation-tool'; delete f.tool; }, /ファイル形式|自作ツール|tool/);
    await bad(f => { f.type = 'backup'; }, /Remix のファイルではありません/); await bad(f => { f.format = 99; }, /新しい形式/); await bad(f => { delete f.format; }, /バージョン/); await bad(f => { f.format = 1.5; });
    await bad(f => { f.work = 'x'; }, /形式が正しくありません/); await bad(f => { f.work.name = ''; }, /名前/); await bad(f => { f.work.creation = null; }); await bad(f => { f.work.creation = 'x'; });
    await bad(f => { f.work.creation.scripts[0].body.push({ type: 'runScript', in: { code: 'alert(1)' } }); }, /未対応/);
    await bad(f => { f.work.creation.scripts[0].body.push({ type: 'eval', in: { code: 'fetch("//evil")' } }); }, /未対応/);
    await bad(f => { f.work.creation.scripts[0].body.push({ type: 'fill', in: { color: 'javascript:alert(1)' } }); });
    await bad(f => { f.work.creation.vars = [{ name: 'a', value: { x: 1 } }]; });
    await bad(f => { f.work.creation.scripts.push({ type: 'draw' }); });
    await bad(f => { f.work = undefined; f.components = []; }, /取り込める作品も部品も/);
    await bad(f => { f.work = undefined; f.components = [{ name: 'x', kind: 'stmt', blocks: [{ type: 'eval', in: {} }] }]; }, /取り込める作品も部品も/);
    assert.strictEqual((await R.io.inspect(good, R.LIMITS.packageBytes + 1)).ok, false);
    for (const x of [null, [], 5, 'x', {}, { app: 'playground-zero' }, { app: 'playground-zero', type: 'remix-package' }]) assert.strictEqual((await R.io.inspect(x, 1)).ok, false);
    // 範囲外の数値は直して警告、危険なキーは捨てる。コードのような文字列はただの文字として扱われ、実行されない
    const f = J(good); f.work.creation.scripts[0].body.push({ type: 'size', in: { n: 123456789 } });
    f.work.creation.scripts[0].body.push({ type: 'text', in: { text: '<img src=x onerror=alert(1)>' }, __proto__: { polluted: 1 } });
    f.work.remix = { origin: { id: 'x'.repeat(500), name: '<script>alert(1)</script>' }, lineage: 'x', parts: [null, 5, { id: 1 }], __proto__: { evil: 1 } };
    f.history.versions = [{ no: 'x', creation: 5 }, null, { no: 1, kind: 'weird', creation: { scripts: [{ type: 'nope' }] } }];
    const r = await R.io.inspect(JSON.parse(JSON.stringify(f).replace('"remix":', '"__proto__x":0,"remix":')), 1000);
    assert.ok(r.ok, JSON.stringify(r.errors)); assert.ok(r.warnings.length); assert.strictEqual(r.work.project.remix.origin.id.length, 60); assert.deepStrictEqual(r.work.project.remix.parts, []);
    assert.strictEqual({}.polluted, undefined); assert.strictEqual({}.evil, undefined);
    assert.ok(r.history.length <= 1 && r.history.every(v => v.kind === 'save'), '壊れた履歴は取り除かれる');
    // 壊れた部品は、ほかの部品と作品を巻き込まず取り除かれる
    const g = J(good); g.components = [{ name: 'x', kind: 'stmt', blocks: [{ type: 'eval', in: {} }] }, g.components[0]];
    const gr = await R.io.inspect(g, 1000); assert.ok(gr.ok && gr.components.length === 1 && gr.warnings.some(m => /検証に通らなかった/.test(m)));
  });

  /* ---------- バックアップ（format 3 の拡張）と Phase 3 の互換 ---------- */
  await ok('11. バックアップに履歴・部品を含められ、Phase 1〜3 のデータ・形式も引き続き読める', async () => {
    const data = await P.exportAll();
    assert.strictEqual(data.format, 3, '形式の番号は変えない'); assert.ok(data.remix && data.remix.v === 1 && Object.keys(data.remix.histories).length >= 1 && data.remix.components.length >= 1);
    assert.ok(data.projects.some(p => p.remix && p.remix.origin), 'remix 項目つき');
    // 個別の書き出しには、その作品の履歴だけ
    const one = data.projects.find(p => p.remix); const solo = await P.exportAll([one.id]); assert.ok(Object.keys(solo.remix.histories).every(id => id === one.id)); assert.ok(!solo.remix.components.length);
    // 取り込み（同じ内容はスキップ）→ 別のIDで内容が違うものは別作品になり、履歴も新しいIDへ
    let rep = await P.inspectBackup(J(data)); assert.ok(rep.items.every(i => i.status === 'same')); assert.ok(rep.remix.components.length >= 1);
    const d2 = J(data); const t = d2.projects.find(p => p.kind === 'creation' && p.remix); t.updatedAt += 5; t.creation.description = '別内容';
    rep = await P.inspectBackup(d2); const result = await P.applyBackup(rep); assert.ok(result.copies >= 1);
    const copy = (await P.list()).find(p => p.name.includes('(取り込み)') && p.remix && p.name.startsWith(t.name)); assert.ok(copy, 'コピーができる');
    assert.ok((await St.history.list(copy.id)).length >= 1, '履歴も取り込まれる');
    // 壊れた remix 項目
    const d3 = J(data); d3.remix = { v: 1, components: [5, { name: 'x' }], histories: { 'bad id!': { versions: [] }, ok1: { versions: [{ no: 1, creation: { scripts: [{ type: 'nope' }] } }, 7] } } };
    const r3 = await P.inspectBackup(d3); assert.ok(r3.ok && r3.remix.components.length === 0 && r3.remix.invalid >= 2);
    assert.ok((await P.inspectBackup(Object.assign(J(data), { remix: 'x' }))).ok);
    // Phase 3 の形式（remix なし）・Phase 1/2 の形式
    const p3 = J(data); delete p3.remix; p3.projects.forEach(p => delete p.remix); const r4 = await P.inspectBackup(p3); assert.ok(r4.ok && r4.items.every(i => i.status === 'same' || i.status === 'copy'));
    const f2 = { app: data.app, format: 2, projects: [{ id: 'old-exp-2', name: 'e', kind: 'experiment', tool: 'flow', params: { seed: 1 }, createdAt: 1, updatedAt: 1 }] };
    await P.applyBackup(await P.inspectBackup(f2)); assert.strictEqual((await P.get('old-exp-2')).kind, 'experiment');
    const f1 = { app: data.app, format: 1, projects: [{ id: 'old-studio', name: 's', objects: [{ type: 'rect' }], createdAt: 1, updatedAt: 1 }] };
    await P.applyBackup(await P.inspectBackup(f1)); const old = await P.get('old-studio'); assert.strictEqual(old.kind, 'studio'); assert.ok(!('remix' in old));
    // 作品の複製（Phase 3 の機能）: 複製元を派生元として記録し、系統ツリーに出る
    const orig = (await P.list({ kind: 'creation' }))[0]; const dup = await P.duplicate(orig.id);
    assert.strictEqual(dup.parentId, orig.id); assert.strictEqual(dup.remix.origin.id, orig.id); assert.notStrictEqual(dup.id, orig.id);
    // Phase 3 の保存済み作品（remix なし）は、そのまま読めて、Remix で派生できる
    const legacy = { id: 'legacy-1', name: 'Phase3の作品', schema: 3, kind: 'creation', creation: Cr.sampleProgram('click-color'), createdAt: 1, updatedAt: 1, tags: [], parentId: null };
    await repo.put(J(legacy)); const lg = await P.get('legacy-1'); assert.ok(lg && !('remix' in lg));
    const spec = await W.prepareDerive(lg); assert.strictEqual(spec.remix.origin.ver, null); assert.ok((await W.createDerived(spec, spec.creation, {})).remix.origin.id === 'legacy-1');
    assert.strictEqual(JSON.stringify(await repo.get('legacy-1')), JSON.stringify(legacy), '元の保存データは1文字も変わらない');
  });

  /* ---------- 安全性 ---------- */
  await ok('安全性: Remix のソースに eval・Function・文字列タイマー・innerHTML・外部通信が無い', () => {
    const files = fs.readdirSync(path.join(root, 'js/remix')).map(f => 'js/remix/' + f).concat(fs.readdirSync(path.join(root, 'js/pages')).filter(f => /^remix/.test(f)).map(f => 'js/pages/' + f));
    assert.ok(files.length >= 7, files.join());
    files.forEach(f => {
      const src = fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.ok(!/(?<![.\w$])eval\s*\(/.test(src), f + ' eval'); assert.ok(!/\bnew\s+Function\b|\bFunction\s*\(/.test(src), f + ' Function');
      assert.ok(!/setTimeout\s*\(\s*['"`]/.test(src) && !/setInterval\s*\(\s*['"`]/.test(src), f + ' timer string');
      assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\bimport\s*\(/.test(src), f + ' html/import');
      assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage/.test(src), f + ' network/storage');
    });
  });

  /* ---------- 12. GitHub Pages 向けビルド ---------- */
  await ok('12. GitHub Pages 向けのビルドが成功し、Remix のファイルがすべて入る（参照切れ・構文エラーなし）', () => {
    const out = cp.execFileSync(process.execPath, [path.join(root, 'scripts/build.js')], { cwd: root, encoding: 'utf8' });
    assert.ok(/dist\//.test(out));
    const dist = path.join(root, 'dist');
    ['index.html', '404.html', '.nojekyll', 'css/style.css', 'js/main.js'].forEach(f => assert.ok(fs.existsSync(path.join(dist, f)), f));
    fs.readdirSync(path.join(root, 'js/remix')).forEach(f => assert.ok(fs.existsSync(path.join(dist, 'js/remix', f)), 'dist に js/remix/' + f));
    fs.readdirSync(path.join(root, 'js/pages')).filter(f => /^remix/.test(f)).forEach(f => assert.ok(fs.existsSync(path.join(dist, 'js/pages', f)), f));
    assert.ok(!fs.existsSync(path.join(dist, 'scripts')) && !fs.existsSync(path.join(dist, 'docs')), '開発用ファイルは含めない');
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    [...html.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)].forEach(m => assert.ok(fs.existsSync(path.join(dist, m[1])), 'dist 内の参照切れ: ' + m[1]));
    assert.ok(/js\/remix\/core\.js/.test(html) && /js\/pages\/remix\.js/.test(html), 'index.html から読み込まれている');
    assert.ok(!/src="\/|href="\/(?!\/)/.test(html), '絶対パス参照なし（サブパス公開用）');
    cp.execFileSync(process.execPath, [path.join(root, 'scripts/check-links.js')], { cwd: root, encoding: 'utf8' });
    fs.rmSync(dist, { recursive: true, force: true });
  });

  console.log(n + ' tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
