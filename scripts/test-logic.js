// UIに依存しない中核ロジック（モデル検証・バックアップ取り込み・Shape生成）のテスト
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const sandbox = { window: {}, document: { createElement: () => ({ getContext: () => null }) }, console, Date, Math, JSON, setTimeout, clearTimeout, Promise };
sandbox.window = sandbox; vm.createContext(sandbox);
['config', 'util', 'model', 'storage/fallback', 'projects', 'userdata', 'registry', 'labs-core', 'daily'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), sandbox, { filename: f }));
const PZ = sandbox.PZ; let n = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('  ok  ' + name); });
(async () => {
  const M = PZ.model;
  await ok('不正なオブジェクトを丸める', () => {
    const o = M.sanitizeObject({ type: 'rect', x: 'abc', w: -5, fill: 'javascript:1', opacity: 9 });
    assert.strictEqual(o.x, 0); assert.ok(o.w >= 4); assert.strictEqual(o.fill, '#b8ff3d'); assert.strictEqual(o.opacity, 1);
    assert.strictEqual(M.sanitizeObject({ type: 'evil' }), null);
  });
  await ok('壊れた作品は null / 欠損は補完', () => {
    assert.strictEqual(M.sanitizeProject({ name: 'x' }), null);
    const p = M.sanitizeProject({ objects: [{ type: 'ellipse' }, { type: 'nope' }] });
    assert.strictEqual(p.objects.length, 1); assert.strictEqual(p.name, '無題の作品');
  });
  await ok('複製は別IDで内容が同じ', () => {
    const p = M.createProject('A'); p.objects.push(M.newObject('star', p));
    const c = M.cloneProject(p); assert.notStrictEqual(c.id, p.id); assert.notStrictEqual(c.objects[0].id, p.objects[0].id); assert.strictEqual(c.objects.length, 1);
  });
  await ok('履歴スナップショットの往復', () => {
    const p = M.createProject('A'); p.objects.push(M.newObject('rect', p)); const s = M.snapshot(p);
    p.objects = []; M.applySnapshot(p, s); assert.strictEqual(p.objects.length, 1);
  });
  // projects は repo をモジュール内で持つため MemoryRepo で直接検証
  await ok('バックアップの書き出し/取り込み（重複スキップ・別名取り込み・不正拒否）', async () => {
    const repo = new PZ.storage.MemoryRepo();
    const S = PZ.storage; S.open = () => Promise.resolve(repo);
    await PZ.projects.init();
    const a = await PZ.projects.create('一つ目'); a.objects.push(M.newObject('rect', a)); await PZ.projects.save(a);
    const data = await PZ.projects.exportAll();
    assert.strictEqual(data.projects.length, 1);
    let r = await PZ.projects.importBackup(data); assert.strictEqual(r.skipped, 1);
    data.projects[0].updatedAt += 1000; r = await PZ.projects.importBackup(data); assert.strictEqual(r.added, 1);
    assert.strictEqual((await PZ.projects.list()).length, 2);
    await assert.rejects(() => PZ.projects.importBackup({ app: 'other' }));
    const rec = await PZ.projects.remove(a.id); assert.strictEqual((await PZ.projects.list()).length, 1);
    await PZ.projects.restore(rec); assert.strictEqual((await PZ.projects.list()).length, 2);
  });

  /* ---------- Phase 2 ---------- */
  await ok('Phase1形式の作品は kind:studio として読める（互換）', () => {
    const p = M.sanitizeProject({ id: 'old1', name: '旧作', objects: [{ type: 'rect' }], createdAt: 1, updatedAt: 2 });
    assert.strictEqual(p.kind, 'studio'); assert.strictEqual(p.objects.length, 1); assert.strictEqual(p.tags.length, 0); assert.strictEqual(p.favorite, false);
  });
  await ok('実験作品: params検証・危険キー除去・タグ上限', () => {
    const p = M.sanitizeProject({ id: 'e1', name: 'x', kind: 'experiment', tool: 'flow', params: { seed: 5, __proto__: { bad: 1 }, constructor: 1 }, tags: ['a', 'a', 'b'.repeat(99)], daily: '2026-10-26' });
    assert.strictEqual(p.kind, 'experiment'); assert.strictEqual(p.params.seed, 5);
    assert.ok(!Object.prototype.hasOwnProperty.call(p.params, 'constructor')); assert.strictEqual(p.tags[0], 'a'); assert.strictEqual(p.tags.filter(t => t === 'a').length, 1);
    assert.ok(p.tags.every(t => t.length <= 24)); assert.strictEqual(p.daily, '2026-10-26');
    assert.strictEqual(M.sanitizeProject({ kind: 'experiment', tool: 'flow', daily: 'nope' }).daily, null);
  });
  await ok('派生は元を保ち parentId を持つ', () => {
    const p = M.sanitizeProject({ id: 'e2', name: 'orig', kind: 'experiment', tool: 'pattern', params: { seed: 1 }, favorite: true });
    const c = M.cloneProject(p); assert.strictEqual(c.parentId, 'e2'); assert.strictEqual(c.favorite, false); assert.strictEqual(c.params.seed, 1); assert.notStrictEqual(c.id, 'e2');
  });
  await ok('生成器は同じシードで同じ結果・違うシードで違う結果', () => {
    const L = PZ.labs; assert.ok(L.flow && L.color && L.pattern && L.motion && L.particles);
    const rec = (seed) => { const calls = []; const ctx = new Proxy({}, { get: (t, k) => k === 'canvas' ? {} : (...a) => { calls.push(k + JSON.stringify(a.map(x => typeof x === 'number' ? Math.round(x * 100) : typeof x))); }, set: (t, k, v) => { calls.push(k + '=' + v); return true; } }); const prm = L.pattern.normalize({ seed }); L.pattern.render(ctx, 1200, 750, prm); return calls.join('|'); };
    assert.strictEqual(rec(11), rec(11)); assert.notStrictEqual(rec(11), rec(12));
    const a = L.color.normalize({ main: '#ff8a00' }), b = L.color.normalize({ main: '#ff8a00' });
    assert.strictEqual(JSON.stringify(a.colors), JSON.stringify(b.colors)); assert.ok(a.colors.every(c => /^#[0-9a-f]{6}$/i.test(c)));
    const r1 = L.flow.random(PZ.util.mulberry32 ? PZ.util.mulberry32(1) : () => 0.3), r2 = L.flow.random(PZ.util.mulberry32 ? PZ.util.mulberry32(2) : () => 0.7);
    assert.notStrictEqual(JSON.stringify(r1), JSON.stringify(r2));
  });
  await ok('Daily: 同日は同テーマ・30日周期で重複なし・形式検証', () => {
    const D = PZ.daily; assert.strictEqual(D.THEMES.length, 30);
    assert.strictEqual(D.themeFor('2026-10-26').id, D.themeFor('2026-10-26').id);
    const ids = new Set(); let k = '2026-01-01'; while (D.dayNumber(k) % 30 !== 0) k = D.addDays(k, 1); for (let i = 0; i < 30; i++) { ids.add(D.themeFor(k).id); k = D.addDays(k, 1); } 
    assert.strictEqual(ids.size, 30);
    assert.ok(D.parseKey('2026-02-28')); assert.ok(!D.parseKey('2026-02-30')); assert.ok(!D.parseKey('x'));
    assert.strictEqual(D.addDays('2026-12-31', 1), '2027-01-01');
    D.THEMES.forEach(t => { assert.ok(t.tool === 'studio' || PZ.registry.has(t.tool)); t.alt.forEach(a => assert.ok(a === 'studio' || PZ.registry.has(a))); assert.strictEqual(t.hints.length, 3); });
  });
  await ok('Registry: 検索・ジャンル・タグ・お気に入り', () => {
    const R = PZ.registry; assert.strictEqual(R.all().length, 6);
    assert.strictEqual(R.filter({ q: 'flow' }).length, 1);
    assert.ok(R.filter({ genre: 'Color' }).length >= 1);
    assert.strictEqual(R.filter({ favOnly: true, favs: ['color'] }).length, 1);
    assert.strictEqual(R.filter({ q: 'zzzz存在しない' }).length, 0);
  });
  await ok('バックアップ v2: 検証→確認→適用、上書きなし、不正/未来形式の扱い', async () => {
    const repo = new PZ.storage.MemoryRepo(); PZ.storage.open = () => Promise.resolve(repo);
    await PZ.projects.init();
    const st = await PZ.projects.create('S'); await PZ.projects.save(st);
    const ex = await PZ.projects.createExperiment('flow', { name: 'F', params: { seed: 9 } });
    await PZ.userdata.markDaily('2026-10-01', 'wave', 'memo'); await PZ.userdata.toggleFavTool('flow');
    const data = await PZ.projects.exportAll(); assert.strictEqual(data.format, 2); assert.strictEqual(data.projects.length, 2); assert.ok(data.daily['2026-10-01']);
    // 同内容 → すべてスキップ
    let rep = await PZ.projects.inspectBackup(JSON.parse(JSON.stringify(data)));
    assert.strictEqual(rep.items.filter(i => i.status === 'same').length, 2);
    // 同ID別内容 → 別名で追加（上書きしない）
    const d2 = JSON.parse(JSON.stringify(data)); d2.projects[0].updatedAt += 5000; d2.projects[0].name = '改変';
    rep = await PZ.projects.inspectBackup(d2); assert.strictEqual(rep.items.filter(i => i.status === 'copy').length, 1);
    const before = (await PZ.projects.get(d2.projects[0].id)).name;
    await PZ.projects.applyBackup(rep); assert.strictEqual((await PZ.projects.get(d2.projects[0].id)).name, before);
    assert.strictEqual((await PZ.projects.list()).length, 3);
    // 不正
    for (const bad of [{ app: 'other', projects: [] }, null, [], { app: data.app, format: 2, projects: 'zzz' }, { app: data.app, projects: [] }, { app: data.app, format: 'x', projects: [] }]) {
      const r = await PZ.projects.inspectBackup(bad); assert.strictEqual(r.ok, false); assert.ok(r.error);
    }
    await assert.rejects(() => PZ.projects.importBackup({ app: 'other' }));
    // 未来形式は警告つきで読める範囲だけ
    const fut = JSON.parse(JSON.stringify(data)); fut.format = 99; fut.projects = [Object.assign({}, fut.projects[1], { id: 'fut-1' })];
    rep = await PZ.projects.inspectBackup(fut); assert.strictEqual(rep.ok, true); assert.strictEqual(rep.futureFormat, true); assert.strictEqual(rep.items[0].status, 'new');
    // Phase1形式(format 1)
    const f1 = { app: data.app, format: 1, exportedAt: 1, projects: [{ id: 'p1-a', name: '旧', objects: [{ type: 'rect' }], createdAt: 1, updatedAt: 2 }] };
    rep = await PZ.projects.inspectBackup(f1); await PZ.projects.applyBackup(rep);
    assert.strictEqual((await PZ.projects.get('p1-a')).kind, 'studio');
  });
  console.log(n + ' tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
