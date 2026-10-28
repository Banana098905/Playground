/*
 * Remix Engine — 保存層（PZ.remix.store）と、作品の操作（PZ.remix.work）
 *
 * UI から分離した「保存と復元」の処理です。保存先は既存の meta ストア（PZ.userdata）なので、
 * IndexedDB のバージョン変更も移行処理も要りません。キー:
 *   rxh:<作品ID>   変更履歴（保存した版の一覧。上限つき）
 *   rxh-index      履歴の目録 { 作品ID: {count, bytes, at} }（容量の把握・孤立した履歴の掃除用）
 *   rxc            ユーザーの部品ライブラリ
 *   rxd:<キー>     下書き（自動保存。作品本体・履歴には触れない）
 *   rxd-index      下書きの目録（最大 R.LIMITS.drafts 件）
 *
 * 自動保存（下書き）と明示的な保存（作品＋履歴）は別の経路です。
 *   下書き … 一定間隔で上書きされる控え。作品は変わらない。
 *   保存   … 作品を書き込み、履歴に1版を追加する。上書きの前には必ず直前の状態を履歴に残す。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var M = PZ.model;
  var Cr = PZ.creation;
  var R = (PZ.remix = PZ.remix || {});
  var L = R.LIMITS;
  var UD = function () { return PZ.userdata; };

  function J(x) { return JSON.parse(JSON.stringify(x)); }
  function size(x) { try { return JSON.stringify(x).length; } catch (e) { return 0; } }
  function arr(v) { return Array.isArray(v) ? v : []; }

  var S = (R.store = {});

  /* =============== 変更履歴 =============== */
  var H = (S.history = {});
  var KINDS = { origin: '派生元', save: '保存', restore: '復元', import: '読み込み', seed: '開始時の状態' };
  H.KIND_LABEL = KINDS;

  function cleanVersion(v) {
    if (!v || typeof v !== 'object' || !v.creation || typeof v.creation !== 'object') return null;
    var no = R.int(v.no, 0, 999999, null);
    if (no === null) return null;
    return {
      no: no, at: typeof v.at === 'number' && isFinite(v.at) ? Math.max(0, Math.min(4e12, v.at)) : 0,
      kind: KINDS[v.kind] ? v.kind : 'save', name: R.str(v.name, 80), summary: R.str(v.summary, L.summary), note: R.str(v.note, L.note),
      pin: v.pin === true, bytes: R.int(v.bytes, 0, 1e9, size(v.creation)), creation: v.creation
    };
  }
  H.cleanVersion = cleanVersion;

  function cleanHistory(raw) {
    var out = { v: 1, next: 1, versions: [] };
    if (!raw || typeof raw !== 'object') return out;
    arr(raw.versions).slice(0, L.versions + 8).forEach(function (v) { var c = cleanVersion(v); if (c) out.versions.push(c); });
    out.versions.sort(function (a, b) { return a.no - b.no; });
    var maxNo = out.versions.reduce(function (m, v) { return Math.max(m, v.no); }, 0);
    out.next = Math.max(R.int(raw.next, 1, 999999, 1), maxNo + 1);
    return out;
  }

  H.get = function (workId) {
    return UD().get('rxh:' + workId, null).then(cleanHistory);
  };

  /** 履歴の一覧（creation を含まない軽い形） */
  H.list = function (workId) {
    return H.get(workId).then(function (h) {
      return h.versions.map(function (v) { var c = Object.assign({}, v); delete c.creation; return c; }).sort(function (a, b) { return b.no - a.no; });
    });
  };

  /** 版の中身（検証済みの構成）。無ければ null */
  H.getCreation = function (workId, no) {
    return H.get(workId).then(function (h) {
      var v = h.versions.filter(function (x) { return x.no === no; })[0];
      return v ? { version: v, creation: Cr.sanitize(v.creation) } : null;
    });
  };

  H.index = function () { return UD().get('rxh-index', {}).then(function (m) { return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }); };

  function writeIndex(workId, h) {
    return UD().update('rxh-index', {}, function (m) {
      m = m && typeof m === 'object' && !Array.isArray(m) ? m : {};
      if (!h || !h.versions.length) delete m[workId];
      else m[workId] = { count: h.versions.length, bytes: h.versions.reduce(function (s, v) { return s + v.bytes; }, 0), at: Date.now() };
      return m;
    });
  }

  function prune(h) {
    function total() { return h.versions.reduce(function (s, v) { return s + v.bytes; }, 0); }
    var latest = h.versions.length ? h.versions[h.versions.length - 1].no : -1;
    var dropped = 0;
    while (h.versions.length > L.versions || total() > L.historyBytes) {
      var idx = -1;
      for (var i = 0; i < h.versions.length; i++) {
        var v = h.versions[i];
        if (v.pin || v.kind === 'origin' || v.no === latest) continue;
        idx = i; break;
      }
      if (idx < 0) break;
      h.versions.splice(idx, 1); dropped++;
    }
    return dropped;
  }

  /**
   * 履歴に1版を追加する。直前の版と中身も名前も同じなら追加しない（skipped:true）。
   * opts: { name, note, kind, summary, force, at }
   * 戻り値: Promise<{ version|null, skipped, dropped }>
   */
  H.record = function (workId, creation, opts) {
    opts = opts || {};
    var clean = Cr.sanitize(creation);
    var result = { version: null, skipped: false, dropped: 0 };
    return UD().update('rxh:' + workId, null, function (raw) {
      var h = cleanHistory(raw);
      var prev = h.versions.length ? h.versions[h.versions.length - 1] : null;
      var name = R.str(opts.name, 80);
      if (prev && !opts.force && R.sameCreation(prev.creation, clean) && prev.name === name) { result.skipped = true; return raw === undefined ? null : (raw || null); }
      var summary = opts.summary;
      if (summary === undefined || summary === null) {
        summary = prev ? R.diffSummary(prev.creation, clean, { nameA: prev.name, nameB: name }) : '最初の版';
      }
      var v = {
        no: h.next, at: opts.at || Date.now(), kind: KINDS[opts.kind] ? opts.kind : 'save', name: name,
        summary: R.str(summary, L.summary), note: R.str(opts.note, L.note), pin: opts.kind === 'origin', bytes: size(clean), creation: clean
      };
      h.next = h.next + 1;
      h.versions.push(v);
      result.dropped = prune(h);
      result.version = { no: v.no, at: v.at, kind: v.kind, summary: v.summary };
      return h;
    }).then(function (h) {
      if (result.skipped) return result;
      return writeIndex(workId, cleanHistory(h)).then(function () { return result; });
    });
  };

  /**
   * 検証済みの版の一覧から、作品の履歴を作る（読み込み・バックアップの取り込み用）。
   * すでに履歴がある作品には何もしない。versions は cleanVersion を通ったもの。
   */
  H.restoreFrom = function (workId, versions, opts) {
    opts = opts || {};
    var done = false;
    return UD().update('rxh:' + workId, null, function (raw) {
      var cur = cleanHistory(raw);
      if (cur.versions.length && !opts.replace) return raw;
      var h = { v: 1, next: 1, versions: [] };
      versions.slice(0, L.versions).forEach(function (v) {
        var c = cleanVersion(v);
        if (c) { c.creation = Cr.sanitize(c.creation); c.bytes = size(c.creation); h.versions.push(c); }
      });
      h.versions.sort(function (a, b) { return a.no - b.no; });
      h.next = h.versions.reduce(function (m, v) { return Math.max(m, v.no); }, 0) + 1;
      prune(h);
      done = h.versions.length > 0;
      return h;
    }).then(function (h) {
      var ch = cleanHistory(h);
      return writeIndex(workId, ch).then(function () { return done ? ch.versions.length : 0; });
    });
  };

  H.remove = function (workId) {
    return UD().set('rxh:' + workId, null).then(function () { return writeIndex(workId, null); });
  };

  H.pin = function (workId, no, on) {
    var err = null;
    return UD().update('rxh:' + workId, null, function (raw) {
      var h = cleanHistory(raw);
      var v = h.versions.filter(function (x) { return x.no === no; })[0];
      if (!v) { err = '版が見つかりません'; return raw; }
      if (on && h.versions.filter(function (x) { return x.pin && x.kind !== 'origin'; }).length >= L.pins) { err = 'ピン留めできるのは ' + L.pins + ' 件までです'; return raw; }
      if (v.kind !== 'origin') v.pin = !!on;
      return h;
    }).then(function () { if (err) throw new Error(err); });
  };

  /** 履歴の合計（容量の目安）。existingIds を渡すと、作品が無い履歴（孤立）も数える */
  H.usage = function (existingIds) {
    return H.index().then(function (m) {
      var u = { works: 0, versions: 0, bytes: 0, orphans: [] };
      Object.keys(m).forEach(function (id) {
        u.works++; u.versions += m[id].count || 0; u.bytes += m[id].bytes || 0;
        if (existingIds && existingIds.indexOf(id) < 0) u.orphans.push(id);
      });
      return u;
    });
  };

  /** 作品が無くなった履歴を消す（孤立した履歴の掃除）。戻り値: 消した件数 */
  H.gc = function (existingIds) {
    return H.usage(existingIds).then(function (u) {
      var chain = Promise.resolve();
      u.orphans.forEach(function (id) { chain = chain.then(function () { return H.remove(id); }); });
      return chain.then(function () { return u.orphans.length; });
    });
  };

  /** 古い履歴を整理する: 各作品の履歴を最新 keep 件（＋派生元・ピン留め）にする */
  H.trimAll = function (keep) {
    keep = Math.max(1, keep || 5);
    return H.index().then(function (m) {
      var ids = Object.keys(m), freed = 0, chain = Promise.resolve();
      ids.forEach(function (id) {
        chain = chain.then(function () {
          return UD().update('rxh:' + id, null, function (raw) {
            var h = cleanHistory(raw);
            var keepNos = {};
            h.versions.slice(-keep).forEach(function (v) { keepNos[v.no] = 1; });
            var before = h.versions.length;
            h.versions = h.versions.filter(function (v) { return v.pin || v.kind === 'origin' || keepNos[v.no]; });
            freed += before - h.versions.length;
            return h;
          }).then(function (h) { return writeIndex(id, cleanHistory(h)); });
        });
      });
      return chain.then(function () { return freed; });
    });
  };

  /* =============== 下書き（自動保存） =============== */
  var D = (S.drafts = {});

  function cleanKey(k) { return typeof k === 'string' && /^[A-Za-z0-9_:-]{1,80}$/.test(k) ? k : null; }

  D.list = function () {
    return UD().get('rxd-index', []).then(function (list) {
      return arr(list).filter(function (d) { return d && cleanKey(d.key); }).map(function (d) {
        return { key: d.key, name: R.str(d.name, 80), at: typeof d.at === 'number' ? d.at : 0, workId: d.workId || null, baseId: d.baseId || null };
      }).sort(function (a, b) { return b.at - a.at; });
    });
  };
  /** 下書きを書く。大きすぎるときは書かずに false */
  D.save = function (key, data) {
    key = cleanKey(key);
    if (!key) return Promise.resolve(false);
    if (size(data) > L.draftBytes) return Promise.resolve(false);
    var dropKeys = [];
    return UD().set('rxd:' + key, data).then(function () {
      return UD().update('rxd-index', [], function (list) {
        list = arr(list).filter(function (d) { return d && d.key !== key; });
        list.unshift({ key: key, name: R.str(data.name, 80), at: data.at || Date.now(), workId: data.workId || null, baseId: data.baseId || null });
        while (list.length > L.drafts) dropKeys.push(list.pop().key);
        return list;
      });
    }).then(function () {
      return Promise.all(dropKeys.map(function (k) { return UD().set('rxd:' + k, null); }));
    }).then(function () { return true; });
  };
  D.load = function (key) {
    key = cleanKey(key);
    return key ? UD().get('rxd:' + key, null) : Promise.resolve(null);
  };
  D.clear = function (key) {
    key = cleanKey(key);
    if (!key) return Promise.resolve();
    return UD().set('rxd:' + key, null).then(function () {
      return UD().update('rxd-index', [], function (list) { return arr(list).filter(function (d) { return d && d.key !== key; }); });
    });
  };

  /* =============== 部品ライブラリ =============== */
  var C = (S.components = {});

  /** ユーザーの部品（検証済み）。壊れたものは読み飛ばす */
  C.list = function () {
    return UD().get('rxc', []).then(function (list) {
      var out = [], seen = {};
      arr(list).slice(0, L.components).forEach(function (raw) {
        var s = R.parts.sanitize(raw);
        if (s.ok && !seen[s.comp.id] && !/^builtin:/.test(s.comp.id)) { seen[s.comp.id] = 1; out.push(s.comp); }
      });
      return out;
    });
  };
  /** 付属＋ユーザーの全部品 */
  C.all = function () { return C.list().then(function (u) { return R.parts.builtins().concat(u); }); };
  C.get = function (id) { return C.all().then(function (all) { return all.filter(function (c) { return c.id === id; })[0] || null; }); };

  /**
   * 部品を保存する。同じIDの部品があれば上書き（version を +1）。asNew で別の部品として追加。
   * 戻り値: Promise<comp>
   */
  C.save = function (comp, opts) {
    opts = opts || {};
    var saved = null;
    return UD().update('rxc', [], function (list) {
      list = arr(list);
      var s = R.parts.sanitize(comp);
      if (!s.ok) throw new Error('部品を保存できません: ' + s.errors[0]);
      var c = s.comp;
      if (/^builtin:/.test(c.id)) opts.asNew = true;
      var idx = -1;
      list.forEach(function (x, i) { if (x && x.id === c.id) idx = i; });
      if (opts.asNew || idx < 0) {
        if (opts.asNew) { c.id = R.parts.newId(); c.version = 1; c.createdAt = Date.now(); }
        if (list.length >= L.components) throw new Error('部品は ' + L.components + ' 個まで保存できます。使わない部品を削除してください。');
        c.updatedAt = Date.now();
        list.push(c);
      } else {
        c.version = Math.min(9999, (R.int(list[idx].version, 1, 9999, 1)) + 1);
        c.createdAt = list[idx].createdAt || c.createdAt;
        c.updatedAt = Date.now();
        list[idx] = c;
      }
      saved = c;
      return list;
    }).then(function () { return saved; });
  };
  C.remove = function (id) {
    return UD().update('rxc', [], function (list) { return arr(list).filter(function (x) { return x && x.id !== id; }); });
  };
  /** 取り込み: 同じIDで同じ内容はスキップ、同じIDで内容が違えば別IDで追加。戻り値: {added, same, copies, full} */
  C.merge = function (comps) {
    var r = { added: 0, same: 0, copies: 0, full: 0 };
    return UD().update('rxc', [], function (list) {
      list = arr(list);
      comps.forEach(function (c) {
        if (/^builtin:/.test(c.id)) { r.same++; return; }
        var ex = list.filter(function (x) { return x && x.id === c.id; })[0];
        if (ex) {
          var a = R.parts.sanitize(ex);
          if (a.ok && JSON.stringify(a.comp.blocks) === JSON.stringify(c.blocks) && JSON.stringify(a.comp.vars) === JSON.stringify(c.vars) && JSON.stringify(a.comp.params) === JSON.stringify(c.params)) { r.same++; return; }
          c = J(c); c.id = R.parts.newId(); c.name = (c.name + ' (取り込み)').slice(0, R.parts.LIMITS.name); r.copies++;
        } else r.added++;
        if (list.length >= L.components) { r.full++; if (ex) r.copies--; else r.added--; return; }
        list.push(c);
      });
      return list;
    }).then(function () { return r; });
  };

  /* =============== 作品の操作 =============== */
  var W = (R.work = {});

  function P() { return PZ.projects; }
  function names(all) { return all.map(function (p) { return p.name; }); }

  /**
   * 派生の下書きを作る（まだ保存しない・純粋）。base: 作品(kind:'creation')、または { sample:'<id>', name }。
   * 戻り値: { name, creation, remix, parentId, baseName, baseVer }
   */
  W.deriveSpec = function (base, opts) {
    opts = opts || {};
    var creation, origin, lineage = [], parts = [], parentId = null, baseName;
    if (base && base.sample) {
      creation = Cr.sampleProgram(base.sample);
      if (!creation) throw new Error('サンプルが見つかりません');
      baseName = base.name || 'サンプル';
      origin = { id: null, sample: base.sample, name: baseName, ver: null, at: 0 };
    } else {
      if (!base || base.kind !== 'creation') throw new Error('派生できるのは自作ツール（Create / Remix の作品）です');
      creation = R.cloneCreation(base.creation);
      baseName = base.name;
      origin = R.originRef(base, opts.baseVer === undefined ? null : opts.baseVer);
      lineage = R.lineageFor(base);
      parts = base.remix ? base.remix.parts : [];
      parentId = base.id;
    }
    var name = opts.name || R.uniqueName(baseName, opts.existingNames || []);
    return {
      name: name.slice(0, PZ.config.limits.projectNameLength), creation: creation, parentId: parentId, baseName: baseName, baseVer: origin.ver,
      remix: R.cleanRemix({ origin: origin, lineage: lineage, summary: '', parts: parts })
    };
  };

  function latestVersionNo(workId) {
    return H.get(workId).then(function (h) { return h.versions.length ? h.versions[h.versions.length - 1].no : null; });
  }
  W.latestVersionNo = latestVersionNo;

  /** 保存済みの作品から派生の下書きを作る（元の履歴番号を控える）。Promise<spec> */
  W.prepareDerive = function (base, opts) {
    opts = opts || {};
    return Promise.all([base && base.id ? latestVersionNo(base.id) : Promise.resolve(null), P().list()]).then(function (r) {
      return W.deriveSpec(base, Object.assign({}, opts, { baseVer: r[0], existingNames: names(r[1]) }));
    });
  };

  /**
   * 派生の下書きを、新しい作品として保存する。元の作品は変更しない。
   * 履歴: 「派生元」(v0)と最初の保存(v1)を記録。Promise<project>
   */
  W.createDerived = function (spec, creation, o) {
    o = o || {};
    var clean = Cr.validate(creation, { lenient: true }).clean;
    var p = M.createCreationWork({ name: o.name || spec.name, creation: clean, parentId: spec.parentId, thumb: o.thumb || null, tags: o.tags || [] });
    if (!p) return Promise.reject(new Error('作品として保存できる形ではありません（大きすぎるか、壊れています）'));
    var diff = R.diff(spec.creation, clean);
    var summary = R.summarize(diff);
    p.remix = R.cleanRemix({ origin: spec.remix && spec.remix.origin, lineage: spec.remix ? spec.remix.lineage : [], summary: summary, parts: mergeParts(spec.remix ? spec.remix.parts : [], o.parts) });
    p.parentId = spec.parentId;
    return P().save(p, false).then(function (saved) {
      var base = spec.remix && spec.remix.origin ? spec.remix.origin.name : '派生元';
      return H.record(saved.id, spec.creation, { kind: 'origin', name: spec.baseName, summary: '派生元「' + base + '」' + (spec.baseVer !== null && spec.baseVer !== undefined ? ' v' + spec.baseVer : '') + ' の状態', force: true, at: p.createdAt })
        .then(function () { return H.record(saved.id, clean, { kind: 'save', name: saved.name, note: o.note, summary: summary === '変更なし' ? '派生（変更なし）' : summary, force: true }); })
        .then(function () { return saved; }, function () { saved._historyFailed = true; return saved; });
    });
  };

  /** 派生元のない新しい作品（白紙・読み込み・組み合わせ）を保存する。履歴は最初の版から。Promise<project> */
  W.createNew = function (creation, o) {
    o = o || {};
    var clean = Cr.validate(creation, { lenient: true }).clean;
    var p = M.createCreationWork({ name: o.name || '無題の自作ツール', creation: clean, thumb: o.thumb || null, tags: o.tags || [] });
    if (!p) return Promise.reject(new Error('作品として保存できる形ではありません（大きすぎるか、壊れています）'));
    p.remix = R.cleanRemix({ origin: null, lineage: [], summary: '最初の版', parts: mergeParts([], o.parts) });
    return P().save(p, false).then(function (saved) {
      return H.record(saved.id, clean, { kind: 'save', name: saved.name, note: o.note, summary: '最初の版', force: true })
        .then(function () { return saved; }, function () { saved._historyFailed = true; return saved; });
    });
  };

  function mergeParts(a, b) {
    var out = arr(a).slice();
    arr(b).forEach(function (x) {
      if (!x || !x.id) return;
      var i = -1; out.forEach(function (y, k) { if (y.id === x.id) i = k; });
      var e = { id: x.id, name: R.str(x.name, 40), version: R.int(x.version, 1, 9999, 1) };
      if (i >= 0) out[i] = e; else out.push(e);
    });
    return out.slice(-L.parts);
  }

  /**
   * 保存済みの作品を、その場で更新する（元の内容は履歴に必ず残す）。
   * o: { name, note, thumb, expectUpdatedAt, force, parts }
   * expectUpdatedAt が今の更新日時と違えば reject（e.code === 'STALE'。別のタブで更新されている）。
   */
  W.saveExisting = function (workId, creation, o) {
    o = o || {};
    var clean = Cr.validate(creation, { lenient: true }).clean;
    return P().get(workId).then(function (cur) {
      if (!cur || cur.kind !== 'creation') { var e0 = new Error('保存先の作品が見つかりません'); e0.code = 'GONE'; throw e0; }
      if (!o.force && typeof o.expectUpdatedAt === 'number' && cur.updatedAt !== o.expectUpdatedAt) {
        var e1 = new Error('この作品は、開いたあとに別の場所で更新されています'); e1.code = 'STALE'; e1.current = cur; throw e1;
      }
      var name = (o.name || cur.name).slice(0, PZ.config.limits.projectNameLength);
      var diff = R.diff(cur.creation, clean, { nameA: cur.name, nameB: name });
      var summary = R.summarize(diff);
      // 履歴がまだ無い作品は、上書きする前の状態を最初の版として残す（あとで戻せるように）
      return H.get(workId).then(function (h) {
        return h.versions.length ? null : H.record(workId, cur.creation, { kind: 'seed', name: cur.name, summary: 'Remix で編集する前の状態', force: true, at: cur.updatedAt });
      }).then(function () {
        cur.name = name; cur.creation = clean;
        if (o.thumb) cur.thumb = o.thumb;
        cur.remix = R.cleanRemix({ origin: cur.remix && cur.remix.origin, lineage: cur.remix ? cur.remix.lineage : [], summary: summary, parts: mergeParts(cur.remix ? cur.remix.parts : [], o.parts) });
        return P().save(M.sanitizeProject(cur), true);
      }).then(function (saved) {
        return H.record(workId, clean, { kind: 'save', name: name, note: o.note, summary: summary, force: false })
          .then(function (r) { saved._version = r.version; saved._skipped = r.skipped; return saved; }, function () { saved._historyFailed = true; return saved; });
      });
    });
  };

  /** 過去の版を、別の新しい作品として復元する（元の作品・履歴は変わらない）。Promise<project> */
  W.restoreAsNew = function (workId, no) {
    return Promise.all([P().get(workId), H.getCreation(workId, no), P().list()]).then(function (r) {
      var work = r[0], got = r[1];
      if (!got) throw new Error('その版が見つかりません（履歴の上限で整理された可能性があります）');
      var baseName = (got.version.name || (work && work.name) || '作品');
      var stub = work || { id: workId, name: baseName, updatedAt: got.version.at, remix: null };
      var origin = { id: workId, sample: '', name: baseName, ver: no, at: got.version.at };
      var cand = (baseName + ' v' + no).slice(0, PZ.config.limits.projectNameLength);
      var name = names(r[2]).indexOf(cand) < 0 ? cand : R.uniqueName(cand, names(r[2]));
      var spec = {
        name: name, creation: got.creation, parentId: workId, baseName: baseName, baseVer: no,
        remix: R.cleanRemix({ origin: origin, lineage: R.lineageFor(stub), summary: '', parts: work && work.remix ? work.remix.parts : [] })
      };
      return W.createDerived(spec, got.creation, { name: name, note: 'v' + no + ' から復元' });
    });
  };

  /** 作品を削除したあとに、その履歴も消したい場合（既定では残す。削除の取り消しで戻せるように） */
  W.forgetHistory = function (workId) { return H.remove(workId); };
})();
