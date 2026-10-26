/*
 * ユーザーデータ層: 作品以外の「自分の状態」を meta ストアに保存する。
 *   favTools     お気に入りの実験       ['flow', 'color', ...]
 *   recentTools  最近使った実験         [{ id, at }]
 *   daily        今日の実験の完了記録   { 'YYYY-MM-DD': { themeId, doneAt, note } }
 *   collections  作品コレクション       [{ id, name, createdAt }]
 *
 * 保存先は作品と同じリポジトリ（IndexedDB → localStorage → メモリ）の meta。
 * 読み→書きが重なっても壊れないよう、同じキーの更新は直列に処理する。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var C = PZ.config;
  var M = PZ.model;
  var UD = (PZ.userdata = {});

  var chains = {};

  function repo() {
    var r = PZ.projects && PZ.projects._repo();
    if (!r) throw new Error('保存先がまだ準備できていません');
    return r;
  }

  UD.get = function (key, def) {
    return Promise.resolve().then(function () { return repo().getMeta(key); }).then(function (v) {
      return v === null || v === undefined ? def : v;
    });
  };

  UD.set = function (key, value) {
    return Promise.resolve().then(function () { return repo().setMeta(key, value); });
  };

  /** 読み→変更→書きを同じキーで直列化する。fn(現在値) は新しい値を返す */
  UD.update = function (key, def, fn) {
    var prev = chains[key] || Promise.resolve();
    var run = prev.then(function () {
      return UD.get(key, def).then(function (cur) {
        var next = fn(U.clone(cur));
        return UD.set(key, next).then(function () { return next; });
      });
    });
    chains[key] = run.catch(function () { /* 次の更新を止めない */ });
    return run;
  };

  /* ---------- 値の検証（壊れたデータでも落ちない） ---------- */
  function cleanIds(list, max) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (x) { if (typeof x === 'string' && /^[a-z0-9_-]{1,24}$/i.test(x) && out.indexOf(x) < 0 && out.length < max) out.push(x); });
    return out;
  }
  function cleanCollections(list) {
    if (!Array.isArray(list)) return [];
    var out = [], seen = {};
    list.forEach(function (c) {
      if (!c || typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(c.id) || seen[c.id]) return;
      var name = String(c.name || '').replace(/\s+/g, ' ').trim().slice(0, C.limits.collectionNameLength);
      if (!name || out.length >= C.limits.collections) return;
      seen[c.id] = 1;
      out.push({ id: c.id, name: name, createdAt: U.clamp(U.num(c.createdAt, Date.now()), 0, 4e12) });
    });
    return out;
  }
  function cleanDaily(map) {
    var out = {};
    if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
    Object.keys(map).slice(0, 5000).forEach(function (k) {
      if (!M.isDateKey(k)) return;
      var r = map[k];
      if (!r || typeof r !== 'object') return;
      out[k] = {
        themeId: String(r.themeId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40),
        doneAt: U.clamp(U.num(r.doneAt, Date.now()), 0, 4e12),
        note: String(r.note || '').slice(0, 120)
      };
    });
    return out;
  }
  UD.clean = { ids: cleanIds, collections: cleanCollections, daily: cleanDaily };

  /* ---------- お気に入り・最近使った実験 ---------- */
  UD.favTools = function () { return UD.get('favTools', []).then(function (v) { return cleanIds(v, 50); }); };
  UD.toggleFavTool = function (id) {
    var now = false;
    return UD.update('favTools', [], function (list) {
      list = cleanIds(list, 50);
      var i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1); else list.push(id);
      now = i < 0;
      return list;
    }).then(function () { return now; });
  };

  UD.recentTools = function () {
    return UD.get('recentTools', []).then(function (v) {
      if (!Array.isArray(v)) return [];
      return v.filter(function (r) { return r && typeof r.id === 'string' && /^[a-z0-9_-]{1,24}$/i.test(r.id); })
        .map(function (r) { return { id: r.id, at: U.num(r.at, 0) }; }).slice(0, 12);
    });
  };
  UD.touchTool = function (id) {
    return UD.update('recentTools', [], function (list) {
      list = (Array.isArray(list) ? list : []).filter(function (r) { return r && r.id !== id; });
      list.unshift({ id: id, at: Date.now() });
      return list.slice(0, 12);
    });
  };

  /* ---------- 今日の実験: 完了記録 ---------- */
  UD.daily = function () { return UD.get('daily', {}).then(cleanDaily); };
  UD.markDaily = function (dateKey, themeId, note) {
    if (!M.isDateKey(dateKey)) return Promise.reject(new Error('日付の形式が正しくありません'));
    return UD.update('daily', {}, function (map) {
      map = cleanDaily(map);
      map[dateKey] = { themeId: themeId || '', doneAt: Date.now(), note: String(note || '').slice(0, 120) };
      return map;
    });
  };
  UD.unmarkDaily = function (dateKey) {
    return UD.update('daily', {}, function (map) { map = cleanDaily(map); delete map[dateKey]; return map; });
  };

  /* ---------- コレクション ---------- */
  UD.collections = function () { return UD.get('collections', []).then(cleanCollections); };
  UD.createCollection = function (name) {
    name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, C.limits.collectionNameLength);
    if (!name) return Promise.reject(new Error('コレクション名を入力してください'));
    var created = null;
    return UD.update('collections', [], function (list) {
      list = cleanCollections(list);
      var dup = list.filter(function (c) { return c.name === name; })[0];
      if (dup) { created = dup; return list; }
      if (list.length >= C.limits.collections) throw new Error('コレクションは ' + C.limits.collections + ' 個までです');
      created = { id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, createdAt: Date.now() };
      list.push(created);
      return list;
    }).then(function () { return created; });
  };
  UD.renameCollection = function (id, name) {
    name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, C.limits.collectionNameLength);
    if (!name) return Promise.reject(new Error('コレクション名を入力してください'));
    return UD.update('collections', [], function (list) {
      list = cleanCollections(list);
      list.forEach(function (c) { if (c.id === id) c.name = name; });
      return list;
    });
  };
  UD.removeCollection = function (id) {
    return UD.update('collections', [], function (list) { return cleanCollections(list).filter(function (c) { return c.id !== id; }); });
  };

  /* ---------- バックアップへの出し入れ ---------- */
  UD.exportExtras = function () {
    return Promise.all([UD.collections(), UD.daily(), UD.favTools()]).then(function (r) {
      return { collections: r[0], daily: r[1], favTools: r[2] };
    });
  };

  /** 書き出し内容を検証して、取り込み予定の件数を返す（まだ保存しない） */
  UD.inspectExtras = function (extras) {
    extras = extras && typeof extras === 'object' ? extras : {};
    return {
      collections: cleanCollections(extras.collections),
      daily: cleanDaily(extras.daily),
      favTools: cleanIds(extras.favTools, 50)
    };
  };

  /** 既存の記録は上書きせず、足りないものだけ追加する */
  UD.mergeExtras = function (clean) {
    var added = { collections: 0, daily: 0, favTools: 0 };
    return UD.update('collections', [], function (list) {
      list = cleanCollections(list);
      clean.collections.forEach(function (c) {
        if (list.some(function (x) { return x.id === c.id; })) return;
        if (list.length >= C.limits.collections) return;
        list.push(c); added.collections++;
      });
      return list;
    }).then(function () {
      return UD.update('daily', {}, function (map) {
        map = cleanDaily(map);
        Object.keys(clean.daily).forEach(function (k) { if (!map[k]) { map[k] = clean.daily[k]; added.daily++; } });
        return map;
      });
    }).then(function () {
      return UD.update('favTools', [], function (list) {
        list = cleanIds(list, 50);
        clean.favTools.forEach(function (id) { if (list.indexOf(id) < 0) { list.push(id); added.favTools++; } });
        return list;
      });
    }).then(function () { return added; });
  };
})();
