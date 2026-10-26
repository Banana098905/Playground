/*
 * 作品サービス層: UI からは保存先の実装(IndexedDB等)を意識せず、ここだけを呼ぶ。
 * 作成・保存・複製・削除・整理（お気に入り/タグ/コレクション）・バックアップの業務ロジックを持つ。
 *
 * 作品は2種類（kind）:
 *   'studio'      Studio で作る図形・テキストの作品（objects を持つ）
 *   'experiment'  実験ツールの設定を保存した作品（tool と params を持ち、再編集・再生成できる）
 * どちらも同じ作品レコード・同じ保存先・同じバックアップ形式で扱う。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var M = PZ.model;
  var P = (PZ.projects = {});

  var repo = null;
  P.persisted = false;

  P.init = function () {
    return PZ.storage.open().then(function (r) {
      repo = r;
      // 初回のみ「ブラウザによる自動削除の対象外にしてほしい」と要求する
      r.persist().then(function (ok) { P.persisted = !!ok; });
      return r;
    });
  };

  P.kind = function () { return repo ? repo.kind : 'none'; };
  P._repo = function () { return repo; }; // テスト・移行用

  /* ---------- 読み取り ---------- */
  /** filter: { kind: 'studio' | 'experiment' } 省略で全て */
  P.list = function (filter) {
    return repo.list().then(function (records) {
      var out = [];
      records.forEach(function (r) {
        var p = M.sanitizeProject(r);
        if (p && (!filter || !filter.kind || p.kind === filter.kind)) out.push(p);
      });
      return out;
    });
  };

  P.get = function (id) {
    return repo.get(id).then(function (r) { return r ? M.sanitizeProject(r) : null; });
  };

  /** 作品を開く: 取得して「最近開いた」時刻を記録する（更新日時は変えない） */
  P.open = function (id) {
    return P.get(id).then(function (p) {
      if (!p) return null;
      p.lastOpenedAt = Date.now();
      return repo.put(p).then(function () { return p; }, function () { return p; });
    });
  };

  P.recent = function (limit) {
    return P.list().then(function (all) {
      return all.filter(function (p) { return p.lastOpenedAt; })
        .sort(function (a, b) { return b.lastOpenedAt - a.lastOpenedAt; })
        .slice(0, limit || 4);
    });
  };

  P.count = function () { return P.list().then(function (a) { return a.length; }); };

  /** 作品を開くURL（種類に応じて Studio か各実験ツールへ） */
  P.hrefFor = function (p) {
    if (p.kind === 'experiment') {
      var t = PZ.registry && PZ.registry.get(p.tool);
      return (t ? t.path : '/lab') + '?work=' + encodeURIComponent(p.id);
    }
    return '/studio/' + encodeURIComponent(p.id);
  };

  /** 使われているタグと件数 [{tag, count}]（多い順） */
  P.tagCounts = function (list) {
    var map = {};
    list.forEach(function (p) { p.tags.forEach(function (t) { map[t] = (map[t] || 0) + 1; }); });
    return Object.keys(map).map(function (t) { return { tag: t, count: map[t] }; })
      .sort(function (a, b) { return b.count - a.count || a.tag.localeCompare(b.tag, 'ja'); });
  };

  /* ---------- 書き込み ---------- */
  /** 保存。touch=true なら更新日時を現在にする */
  P.save = function (project, touch) {
    if (touch !== false) project.updatedAt = Date.now();
    return repo.put(U.clone(project)).then(function () { return project; });
  };

  P.create = function (name, opts) {
    var p = M.createProject(name, opts);
    p.lastOpenedAt = Date.now();
    return P.save(p, false);
  };

  /** 実験の設定を作品として保存する（opts: name, params, thumb, parentId, daily, tags） */
  P.createExperiment = function (tool, opts) {
    var p = M.createExperimentWork(tool, opts);
    return P.save(p, false);
  };

  P.duplicate = function (idOrProject) {
    var src = typeof idOrProject === 'string' ? P.get(idOrProject) : Promise.resolve(idOrProject);
    return src.then(function (p) {
      if (!p) throw new Error('複製元の作品が見つかりません');
      var c = M.cloneProject(p);
      return P.save(c, false);
    });
  };

  /** 派生作品: 元の作品はそのまま、設定を引き継いだ新しい作品を作る（parentId に元を記録） */
  P.derive = function (idOrProject, name, patch) {
    var src = typeof idOrProject === 'string' ? P.get(idOrProject) : Promise.resolve(idOrProject);
    return src.then(function (p) {
      if (!p) throw new Error('派生元の作品が見つかりません');
      var c = M.cloneProject(p, name);
      if (patch) Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
      c.lastOpenedAt = Date.now();
      return P.save(M.sanitizeProject(c), false);
    });
  };

  P.rename = function (id, name) {
    return P.get(id).then(function (p) {
      if (!p) throw new Error('作品が見つかりません');
      p.name = String(name).trim().slice(0, PZ.config.limits.projectNameLength) || p.name;
      return P.save(p, true);
    });
  };

  /** 整理用の変更（お気に入り・タグ・コレクション）。作品の「更新日時」は変えない */
  P.patch = function (id, fn) {
    return P.get(id).then(function (p) {
      if (!p) throw new Error('作品が見つかりません');
      fn(p);
      return P.save(M.sanitizeProject(p), false);
    });
  };
  P.setFavorite = function (id, on) { return P.patch(id, function (p) { p.favorite = !!on; }); };
  P.setTags = function (id, tags) { return P.patch(id, function (p) { p.tags = M.cleanTags(tags); }); };
  P.setCollections = function (id, ids) { return P.patch(id, function (p) { p.collections = ids.slice(0, 20); }); };

  /** 削除。元に戻せるよう削除した作品を返す */
  P.remove = function (id) {
    return repo.get(id).then(function (rec) {
      return repo.remove(id).then(function () { return rec; });
    });
  };
  P.restore = function (record) {
    return record ? repo.put(record) : Promise.resolve();
  };

  /* ---------- コレクション ---------- */
  P.collections = function () { return PZ.userdata.collections(); };
  P.createCollection = function (name) { return PZ.userdata.createCollection(name); };
  P.renameCollection = function (id, name) { return PZ.userdata.renameCollection(id, name); };
  /** コレクションを削除（中の作品は消さず、所属だけ外す） */
  P.removeCollection = function (id) {
    return PZ.userdata.removeCollection(id).then(function () {
      return P.list().then(function (all) {
        var chain = Promise.resolve();
        all.forEach(function (p) {
          if (p.collections.indexOf(id) < 0) return;
          chain = chain.then(function () {
            p.collections = p.collections.filter(function (c) { return c !== id; });
            return P.save(p, false);
          });
        });
        return chain;
      });
    });
  };

  /* ---------- バックアップ（プロジェクトデータのJSON） ---------- */
  /**
   * 書き出し用データ。ids を渡すとその作品だけ（個別の書き出し）。
   * 形式: { app, format, appVersion, exportedAt, projects[], collections[], daily{}, favTools[] }
   * ※ 画像(PNG)の保存とは別物。これは再編集できるプロジェクトデータ。
   */
  P.exportAll = function (ids) {
    return Promise.all([P.list(), PZ.userdata.exportExtras()]).then(function (r) {
      var projects = r[0], extras = r[1];
      var only = ids && ids.length;
      if (only) projects = projects.filter(function (p) { return ids.indexOf(p.id) >= 0; });
      var used = {};
      projects.forEach(function (p) { p.collections.forEach(function (c) { used[c] = 1; }); });
      var out = {
        app: 'playground-zero',
        format: PZ.config.backupFormat,
        appVersion: PZ.config.version,
        exportedAt: new Date().toISOString(),
        projects: projects
      };
      out.collections = only ? extras.collections.filter(function (c) { return used[c.id]; }) : extras.collections;
      if (!only) { out.daily = extras.daily; out.favTools = extras.favTools; }
      return out;
    });
  };
  P.markBackedUp = function () { return repo.setMeta('lastBackupAt', Date.now()); };
  P.lastBackupAt = function () { return repo.getMeta('lastBackupAt'); };

  /**
   * 取り込み前の検証（保存はしない）。確認画面に出す内容を返す。
   *  - 形式が違う/壊れている → { ok:false, error }
   *  - 新しい形式のファイル → { ok:true, futureFormat:true }（読める範囲だけ取り込む。確認画面で警告）
   * items[].status: 'new'（新規）/ 'copy'（同じIDで内容が違う→別作品として追加）/ 'same'（同じ内容→スキップ）
   */
  P.inspectBackup = function (data) {
    var C = PZ.config;
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.app !== 'playground-zero') {
      return Promise.resolve({ ok: false, error: 'PLAYGROUND ZERO のバックアップファイルではありません。' });
    }
    var format = data.format;
    if (typeof format !== 'number' || !isFinite(format) || Math.floor(format) !== format || format < 1) {
      return Promise.resolve({ ok: false, error: 'バックアップの形式バージョンを確認できません。ファイルが壊れているか、別のアプリのデータです。' });
    }
    if (!Array.isArray(data.projects)) {
      return Promise.resolve({ ok: false, error: '作品データ（projects）が見つかりません。' });
    }
    var future = C.supportedBackupFormats.indexOf(format) < 0;
    var raws = data.projects.slice(0, C.limits.importItems);
    var report = {
      ok: true, format: format, futureFormat: future,
      appVersion: typeof data.appVersion === 'string' ? data.appVersion.slice(0, 20) : '',
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt.slice(0, 40) : '',
      items: [], invalid: 0, truncated: Math.max(0, data.projects.length - raws.length),
      extras: PZ.userdata.inspectExtras(data)
    };
    var seen = {};
    var chain = Promise.resolve();
    raws.forEach(function (raw) {
      chain = chain.then(function () {
        var p = M.sanitizeProject(raw);
        if (!p) { report.invalid++; return null; }
        var dupInFile = !!seen[p.id];
        seen[p.id] = true;
        return repo.get(p.id).then(function (existing) {
          var status = 'new';
          if (dupInFile) status = 'copy';
          else if (existing) status = existing.updatedAt === p.updatedAt ? 'same' : 'copy';
          report.items.push({ project: p, status: status });
        });
      });
    });
    return chain.then(function () { return report; });
  };

  /** 検証済みの内容を保存する。既存の作品は決して上書きしない（衝突は別IDの別作品にする） */
  P.applyBackup = function (report) {
    var result = { added: 0, copies: 0, skipped: 0, invalid: report.invalid, failed: 0, error: '', extras: { collections: 0, daily: 0, favTools: 0 } };
    var chain = PZ.userdata.mergeExtras(report.extras).then(function (added) { result.extras = added; return PZ.userdata.collections(); })
      .then(function (cols) {
        var known = {};
        cols.forEach(function (c) { known[c.id] = 1; });
        var inner = Promise.resolve();
        report.items.forEach(function (it) {
          if (it.status === 'same') { result.skipped++; return; }
          inner = inner.then(function () {
            var p = it.project;
            p.collections = p.collections.filter(function (c) { return known[c]; });
            if (it.status === 'copy') {
              p.parentId = p.parentId || p.id;
              p.id = U.uid();
              p.name = (p.name + ' (取り込み)').slice(0, PZ.config.limits.projectNameLength);
            }
            return repo.put(p).then(function () {
              result.added++;
              if (it.status === 'copy') result.copies++;
            }, function (e) {
              result.failed++;
              if (!result.error) result.error = (e && e.name === 'QuotaExceededError') ? '保存容量が足りません' : ((e && e.message) || '保存に失敗しました');
            });
          });
        });
        return inner;
      });
    return chain.then(function () { return result; });
  };

  /** 検証→取り込みを一度に行う（確認画面を挟まない内部用・テスト用） */
  P.importBackup = function (data) {
    return P.inspectBackup(data).then(function (report) {
      if (!report.ok) throw new Error(report.error);
      return P.applyBackup(report);
    });
  };

  /** 保存の安全状況（UI表示用） */
  P.health = function () {
    var kind = repo ? repo.kind : 'none';
    return {
      kind: kind,
      ok: kind === 'indexeddb',
      persisted: P.persisted,
      label: kind === 'indexeddb' ? 'IndexedDB' : kind === 'localstorage' ? 'localStorage（容量小）' : 'メモリのみ（保存されません）'
    };
  };
})();
