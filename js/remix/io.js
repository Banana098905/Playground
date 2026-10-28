/*
 * Remix Engine — 書き出し・読み込み（PZ.remix.io）とバックアップの拡張（PZ.remix.backup）
 *
 * Remix パッケージ（.pzremix.json）:
 *   { app:'playground-zero', type:'remix-package', format:1, appVersion, exportedAt,
 *     work?:       { name, description, tags, createdAt, updatedAt, creation, remix:{origin,lineage,summary,parts} },
 *     history?:    { versions:[{ no, at, kind, name, summary, note, creation }] },   // 直近の版だけ（上限あり）
 *     components?: [ 部品… ],                                                         // 作品が使った部品・選んだ部品
 *     dependencies?: { parts:[{id,name,version}] } }
 *
 * 取り込みの流れ: inspect()（検証。何も保存しない）→ 確認画面 → apply()（承認されたときだけ）。
 *   ・作品は必ず「新しいID」の別作品になる（今ある作品は上書きしない）
 *   ・ファイルの中身は、ブロックの種類名と値としてだけ読む。許可リスト（spec.js）にないブロックや、
 *     コードのようなものが入っていても実行されず、検証で拒否される
 *   ・Phase 3 の自作ツールファイル（.pzcreate.json）もそのまま読める
 *
 * バックアップ（format 3）への追加: ルートに任意の remix:{ v:1, components[], histories{作品ID:{versions[]}} } を足す。
 *   format 番号は変えないので、Phase 3 のアプリで開いても作品は読める（remix の項目は無視される）。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var M = PZ.model;
  var Cr = PZ.creation;
  var R = (PZ.remix = PZ.remix || {});
  var L = R.LIMITS;
  var X = (R.io = {});

  X.TYPE = 'remix-package';
  X.FORMAT = 1;

  X.isPackage = function (d) { return !!(d && typeof d === 'object' && !Array.isArray(d) && d.app === 'playground-zero' && d.type === X.TYPE); };

  function arr(v) { return Array.isArray(v) ? v : []; }

  /* =============== 書き出し =============== */
  /**
   * 作品1件の書き出し。opts: { history: 含める履歴の件数(既定 R.LIMITS.packageVersions。0で含めない), components: 追加で含める部品[] }
   * 作品が「使った部品」（remix.parts）のうち、ユーザーの部品は定義ごと含める（付属の部品は ID だけ）。
   */
  X.buildPackage = function (work, opts) {
    opts = opts || {};
    var keep = opts.history === undefined ? L.packageVersions : opts.history;
    return Promise.all([
      keep > 0 ? R.store.history.get(work.id) : Promise.resolve({ versions: [] }),
      R.store.components.list()
    ]).then(function (r) {
      var versions = r[0].versions;
      var chosen = versions.filter(function (v) { return v.kind === 'origin'; });
      versions.slice(-keep).forEach(function (v) { if (chosen.indexOf(v) < 0) chosen.push(v); });
      chosen.sort(function (a, b) { return a.no - b.no; });
      var parts = (work.remix && work.remix.parts) || [];
      var mine = r[1];
      var comps = [];
      parts.forEach(function (p) { var c = mine.filter(function (x) { return x.id === p.id; })[0]; if (c) comps.push(c); });
      arr(opts.components).forEach(function (c) { if (!/^builtin:/.test(c.id) && !comps.some(function (x) { return x.id === c.id; })) comps.push(c); });
      var pkg = {
        app: 'playground-zero', type: X.TYPE, format: X.FORMAT, appVersion: PZ.config.version, exportedAt: new Date().toISOString(),
        work: {
          name: work.name, description: work.creation.description || '', tags: work.tags || [], createdAt: work.createdAt, updatedAt: work.updatedAt,
          creation: work.creation, remix: work.remix || null
        },
        history: { versions: chosen.map(function (v) { return { no: v.no, at: v.at, kind: v.kind, name: v.name, summary: v.summary, note: v.note, creation: v.creation }; }) },
        components: comps,
        dependencies: { parts: parts }
      };
      // 大きすぎるときは、古い履歴から外す
      while (JSON.stringify(pkg).length > L.packageBytes && pkg.history.versions.length > 1) {
        var di = -1;
        for (var i = 0; i < pkg.history.versions.length; i++) if (pkg.history.versions[i].kind !== 'origin') { di = i; break; }
        if (di < 0) break;
        pkg.history.versions.splice(di, 1);
      }
      return pkg;
    });
  };

  /** 部品だけのパッケージ */
  X.buildComponentPackage = function (comps) {
    return {
      app: 'playground-zero', type: X.TYPE, format: X.FORMAT, appVersion: PZ.config.version, exportedAt: new Date().toISOString(),
      components: comps.filter(function (c) { return !c.builtin; }), dependencies: { parts: [] }
    };
  };

  /* =============== 読み込み前の検証 =============== */
  function uniq(list, max) {
    var out = [];
    list.forEach(function (m) { if (out.indexOf(m) < 0 && out.length < max) out.push(m); });
    return out;
  }

  function checkWork(w, rep) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) { rep.errors.push('作品の内容（work）の形式が正しくありません。'); return null; }
    if (typeof w.name !== 'string' || !w.name.trim()) { rep.errors.push('作品の名前がありません。'); return null; }
    var v = Cr.validate(w.creation);
    if (!v.ok) {
      uniq(v.errors.map(function (e) { return e.msg; }), 8).forEach(function (m) { rep.errors.push(m); });
      rep.errors.unshift('ブロックの構成に問題があるため、読み込めません。');
      return null;
    }
    uniq(v.warnings.map(function (x) { return x.msg; }), 6).forEach(function (m) { rep.warnings.push(m); });
    var name = w.name.trim();
    if (name.length > PZ.config.limits.projectNameLength) { name = name.slice(0, PZ.config.limits.projectNameLength); rep.warnings.push('名前が長いため短くしました。'); }
    var remix = R.cleanRemix(w.remix);
    var now = Date.now();
    var project = M.sanitizeProject({
      id: U.uid(), kind: 'creation', name: name, creation: v.clean, tags: w.tags, createdAt: now, updatedAt: now, lastOpenedAt: null,
      parentId: remix && remix.origin && remix.origin.id ? remix.origin.id : null,
      remix: remix
    });
    if (!project) { rep.errors.push('作品として読み込めませんでした。'); return null; }
    return { project: project, stats: v.stats, originalId: typeof w.id === 'string' ? w.id.slice(0, 60) : null, description: v.clean.description };
  }

  /**
   * 読み込み前の検証（何も保存しない）。
   * 戻り値: Promise<{ ok, errors[], warnings[], work|null, history[], components[{comp,status}], missing[], summary }>
   *   status: 'new' | 'same' | 'copy'（同じIDで内容が違う→別IDで追加）
   */
  X.inspect = function (data, sizeBytes) {
    var rep = { ok: false, errors: [], warnings: [], kind: '', work: null, history: [], components: [], missing: [], summary: null };
    function fail(m) { rep.errors.push(m); return Promise.resolve(rep); }
    if (typeof sizeBytes === 'number' && sizeBytes > L.packageBytes) return fail('ファイルが大きすぎます（' + Math.round(L.packageBytes / 1048576) + 'MBまで）。');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('PLAYGROUND ZERO のファイルではありません。');
    if (data.app !== 'playground-zero') return fail('PLAYGROUND ZERO のファイルではありません（別のアプリのデータです）。');

    // Phase 3 の自作ツールファイル: 作品としてそのまま読める
    if (Cr.isToolFile(data)) {
      var t = Cr.inspectFile(data, sizeBytes);
      if (!t.ok) { rep.errors = t.errors; return Promise.resolve(rep); }
      rep.ok = true; rep.kind = 'tool'; rep.warnings = t.warnings;
      rep.work = { project: t.project, stats: Cr.stats(t.project.creation), originalId: null, description: t.summary.description };
      rep.summary = { name: t.project.name, blocks: t.summary.blocks, scripts: t.summary.scripts, vars: t.summary.vars, history: 0, components: 0, appVersion: t.summary.appVersion, exportedAt: t.summary.exportedAt };
      return Promise.resolve(rep);
    }
    if (data.type !== X.TYPE) return fail('Remix のファイルではありません。My Space の「読み込み」からバックアップとして開いてください。');
    if (typeof data.format !== 'number' || Math.floor(data.format) !== data.format || data.format < 1) return fail('ファイル形式のバージョンを確認できません。ファイルが壊れている可能性があります。');
    if (data.format > X.FORMAT) return fail('このアプリより新しい形式（v' + data.format + '）のファイルです。アプリを更新してから読み込んでください。');
    rep.kind = 'package';

    var hasWork = data.work !== undefined && data.work !== null;
    if (hasWork) rep.work = checkWork(data.work, rep);
    if (hasWork && !rep.work) return Promise.resolve(rep);

    // 履歴
    if (data.history && typeof data.history === 'object') {
      var vs = arr(data.history.versions);
      if (vs.length > L.versions) rep.warnings.push('履歴が多いため、新しい ' + L.versions + ' 件までを読み込みます。');
      vs.slice(-L.versions).forEach(function (v) {
        if (!v || typeof v !== 'object' || !v.creation || typeof v.creation !== 'object') return;
        var c = H_clean(v, Cr.sanitize(v.creation));
        if (c) rep.history.push(c);
      });
    }
    if (rep.history.length && !rep.work) { rep.warnings.push('作品が含まれていないため、履歴は読み込みません。'); rep.history = []; }

    // 部品
    var comps = arr(data.components);
    if (comps.length > 50) rep.warnings.push('部品が多いため、先頭の 50 件までを読み込みます。');
    var bad = 0;
    var cleanComps = [];
    comps.slice(0, 50).forEach(function (raw) {
      var s = R.parts.sanitize(raw);
      if (s.ok) cleanComps.push(s.comp); else { bad++; if (rep.warnings.length < 8) rep.warnings.push('読み込めない部品がありました: ' + s.errors[0]); }
    });
    if (bad) rep.warnings.push(bad + ' 件の部品は検証に通らなかったため、取り込みません。');

    if (!rep.work && !cleanComps.length) { rep.errors.push('取り込める作品も部品も見つかりませんでした。'); return Promise.resolve(rep); }

    return R.store.components.list().then(function (mine) {
      cleanComps.forEach(function (c) {
        var ex = mine.filter(function (x) { return x.id === c.id; })[0];
        var status = 'new';
        if (/^builtin:/.test(c.id)) status = 'same';
        else if (ex) status = (JSON.stringify(ex.blocks) === JSON.stringify(c.blocks) && JSON.stringify(ex.vars) === JSON.stringify(c.vars)) ? 'same' : 'copy';
        rep.components.push({ comp: c, status: status });
      });
      // 依存関係: 作品が使った部品のうち、手元にもファイルにも無いもの
      var deps = arr(data.dependencies && data.dependencies.parts);
      var builtinIds = R.parts.builtins().map(function (b) { return b.id; });
      deps.slice(0, L.parts).forEach(function (p) {
        if (!p || typeof p.id !== 'string') return;
        var have = builtinIds.indexOf(p.id) >= 0 || mine.some(function (x) { return x.id === p.id; }) || rep.components.some(function (x) { return x.comp.id === p.id; });
        if (!have) rep.missing.push({ id: p.id.slice(0, 60), name: R.str(p.name, 40), version: R.int(p.version, 1, 9999, 1) });
      });
      if (rep.missing.length) rep.warnings.push('この作品が使った部品のうち ' + rep.missing.length + ' 件は、ファイルにも手元にもありません（作品の中身には影響しません）。');
      var sameId = rep.work && rep.work.originalId ? PZ.projects.get(rep.work.originalId) : Promise.resolve(null);
      return sameId;
    }).then(function (ex) {
      if (ex) { rep.sameIdExists = true; rep.warnings.push('同じIDの作品がすでにあります。上書きせず、別の作品として追加します。'); }
      rep.ok = true;
      rep.summary = {
        name: rep.work ? rep.work.project.name : '', blocks: rep.work ? rep.work.stats.blocks : 0, scripts: rep.work ? rep.work.stats.scripts : 0, vars: rep.work ? rep.work.stats.vars : 0,
        history: rep.history.length, components: rep.components.length, appVersion: typeof data.appVersion === 'string' ? data.appVersion.slice(0, 20) : '',
        exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt.slice(0, 10) : ''
      };
      return rep;
    });
  };

  function H_clean(v, cleanCreation) {
    return R.store.history.cleanVersion({ no: v.no, at: v.at, kind: v.kind, name: v.name, summary: v.summary, note: v.note, pin: v.kind === 'origin', creation: cleanCreation });
  }

  /**
   * 検証済みの内容を保存する。opts: { components:true, history:true }
   * 戻り値: Promise<{ work|null, components:{added,same,copies}, history:number }>
   */
  X.apply = function (rep, opts) {
    opts = opts || {};
    var out = { work: null, components: { added: 0, same: 0, copies: 0, full: 0 }, history: 0 };
    var chain = Promise.resolve();
    if (rep.work) {
      chain = chain.then(function () {
        return PZ.projects.list().then(function (all) {
          rep.work.project.name = Cr.uniqueImportName(rep.work.project.name, all.map(function (p) { return p.name; }));
          return PZ.projects.save(rep.work.project, false);
        });
      }).then(function (saved) {
        out.work = saved;
        var versions = opts.history === false ? [] : rep.history.slice();
        versions.push({ no: (versions.reduce(function (m, v) { return Math.max(m, v.no); }, 0)) + 1, at: Date.now(), kind: 'import', name: saved.name, summary: 'ファイルから読み込み', note: '', creation: saved.creation });
        return R.store.history.restoreFrom(saved.id, versions).then(function (n) { out.history = n; }, function () { out.history = 0; });
      });
    }
    if (opts.components !== false && rep.components.length) {
      chain = chain.then(function () {
        return R.store.components.merge(rep.components.filter(function (c) { return c.status !== 'same'; }).map(function (c) { return c.comp; }))
          .then(function (r) { out.components = r; out.components.same += rep.components.filter(function (c) { return c.status === 'same'; }).length; });
      });
    }
    return chain.then(function () { return out; });
  };

  /* =============== バックアップへの出し入れ =============== */
  var B = (R.backup = {});

  /** バックアップの remix 項目を作る。ids: 対象の作品ID（省略で全部品＋全履歴）。無ければ null */
  B.export = function (projectIds, includeComponents) {
    return Promise.all([R.store.history.index(), includeComponents ? R.store.components.list() : Promise.resolve([])]).then(function (r) {
      var idx = r[0], comps = r[1];
      var ids = Object.keys(idx).filter(function (id) { return projectIds.indexOf(id) >= 0; });
      var chain = Promise.resolve(), histories = {}, total = 0, truncated = false;
      ids.forEach(function (id) {
        chain = chain.then(function () {
          if (total > L.backupBytes) { truncated = true; return null; }
          return R.store.history.get(id).then(function (h) {
            var keep = h.versions.slice(-L.backupVersions);
            h.versions.forEach(function (v) { if ((v.kind === 'origin' || v.pin) && keep.indexOf(v) < 0) keep.unshift(v); });
            keep.sort(function (a, b) { return a.no - b.no; });
            if (!keep.length) return;
            total += keep.reduce(function (s, v) { return s + v.bytes; }, 0);
            histories[id] = { versions: keep.map(function (v) { return { no: v.no, at: v.at, kind: v.kind, name: v.name, summary: v.summary, note: v.note, pin: v.pin, creation: v.creation }; }) };
          });
        });
      });
      return chain.then(function () {
        if (!comps.length && !Object.keys(histories).length) return null;
        var o = { v: R.FORMAT, components: comps, histories: histories };
        if (truncated) o.truncated = true;
        return o;
      });
    });
  };

  /** バックアップの remix 項目の検証（保存しない）。{ components[], histories{}, invalid, truncated } */
  B.inspect = function (raw) {
    var out = { components: [], histories: {}, invalid: 0, truncated: false, future: false };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    if (typeof raw.v === 'number' && raw.v > R.FORMAT) { out.future = true; return out; }
    out.truncated = raw.truncated === true;
    arr(raw.components).slice(0, L.components).forEach(function (c) {
      var s = R.parts.sanitize(c);
      if (s.ok && !/^builtin:/.test(s.comp.id)) out.components.push(s.comp); else out.invalid++;
    });
    if (raw.histories && typeof raw.histories === 'object' && !Array.isArray(raw.histories)) {
      Object.keys(raw.histories).slice(0, PZ.config.limits.importItems).forEach(function (id) {
        if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) { out.invalid++; return; }
        var h = raw.histories[id];
        var versions = [];
        arr(h && h.versions).slice(-L.versions).forEach(function (v) {
          if (!v || typeof v !== 'object' || !v.creation || typeof v.creation !== 'object') { out.invalid++; return; }
          var c = R.store.history.cleanVersion({ no: v.no, at: v.at, kind: v.kind, name: v.name, summary: v.summary, note: v.note, pin: v.pin === true, creation: Cr.sanitize(v.creation) });
          if (c) versions.push(c); else out.invalid++;
        });
        if (versions.length) out.histories[id] = versions;
      });
    }
    return out;
  };

  /** 検証済みの remix 項目を保存する。idMap: { バックアップ内の作品ID: 保存した作品ID }（追加された作品だけ） */
  B.apply = function (clean, idMap) {
    var r = { components: { added: 0, same: 0, copies: 0, full: 0 }, histories: 0 };
    if (!clean) return Promise.resolve(r);
    var chain = Promise.resolve();
    if (clean.components.length) chain = chain.then(function () { return R.store.components.merge(clean.components).then(function (x) { r.components = x; }); });
    Object.keys(clean.histories).forEach(function (oldId) {
      var newId = idMap && idMap[oldId];
      if (!newId) return;
      chain = chain.then(function () { return R.store.history.restoreFrom(newId, clean.histories[oldId]).then(function (n) { if (n) r.histories++; }, function () { /* 履歴はなくても作品は取り込める */ }); });
    });
    return chain.then(function () { return r; });
  };
})();
