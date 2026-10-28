/*
 * Creation Engine — 自作ツールファイル（JSON）の書き出しと、読み込み前の検証（PZ.creation）
 *
 * ファイル形式（type:'creation-tool'）:
 *   { app:'playground-zero', type:'creation-tool', format:1, appVersion, exportedAt,
 *     tool:{ name, description, tags[], createdAt, updatedAt, creation:{…ブロック構成…} } }
 *
 * 読み込みの流れ: inspectFile()（検証。何も保存しない）→ 確認画面（内容と警告）→ 承認されたときだけ保存。
 * 取り込んだものは必ず「新しい作品」になり、今ある作品を上書きしません。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var Cr = (PZ.creation = PZ.creation || {});
  var U = PZ.util;
  var M = PZ.model;

  Cr.FILE_TYPE = 'creation-tool';
  Cr.FILE_FORMAT = 1;

  Cr.isToolFile = function (data) {
    return !!(data && typeof data === 'object' && !Array.isArray(data) && data.app === 'playground-zero' && data.type === Cr.FILE_TYPE);
  };

  /** 作品(kind:'creation')を書き出し用オブジェクトにする */
  Cr.toFile = function (project) {
    return {
      app: 'playground-zero',
      type: Cr.FILE_TYPE,
      format: Cr.FILE_FORMAT,
      appVersion: PZ.config.version,
      exportedAt: new Date().toISOString(),
      tool: {
        name: project.name,
        description: project.creation.description || '',
        tags: project.tags || [],
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        creation: project.creation
      }
    };
  };

  /** 画面に出す「使われているブロックの種類」 */
  function kindsUsed(types) {
    return Object.keys(types).map(function (t) { return { type: t, name: Cr.SPEC[t] ? Cr.SPEC[t].name : t, count: types[t] }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  /**
   * 読み込み前の検証。sizeBytes はファイルサイズ（分かれば）。
   * 戻り値: { ok, errors:[文字列], warnings:[文字列], summary, project }
   *   ok のとき project は保存できる新しい作品（新しいID・タイムスタンプ）。ok でなければ project は null。
   */
  Cr.inspectFile = function (data, sizeBytes) {
    var rep = { ok: false, errors: [], warnings: [], summary: null, project: null };
    function fail(msg) { rep.errors.push(msg); return rep; }
    if (typeof sizeBytes === 'number' && sizeBytes > Cr.LIMITS.fileBytes) {
      return fail('ファイルが大きすぎます（' + Math.round(Cr.LIMITS.fileBytes / 1048576) + 'MBまで）。');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('PLAYGROUND ZERO の自作ツールファイルではありません。');
    if (data.app !== 'playground-zero') return fail('PLAYGROUND ZERO のファイルではありません（別のアプリのデータです）。');
    if (data.type !== Cr.FILE_TYPE) return fail('自作ツールのファイルではありません。My Space の「読み込み」からバックアップとして開いてください。');
    if (typeof data.format !== 'number' || Math.floor(data.format) !== data.format || data.format < 1) return fail('ファイル形式のバージョンを確認できません。ファイルが壊れている可能性があります。');
    if (data.format > Cr.FILE_FORMAT) return fail('このアプリより新しい形式（v' + data.format + '）のファイルです。アプリを更新してから読み込んでください。');
    var tool = data.tool;
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return fail('ツールの内容（tool）が見つかりません。');
    if (typeof tool.name !== 'string' || !tool.name.trim()) return fail('ツールの名前がありません。');

    var v = Cr.validate(tool.creation);
    var errs = v.errors.map(function (e) { return e.msg; });
    var uniq = [];
    errs.forEach(function (m) { if (uniq.indexOf(m) < 0) uniq.push(m); });
    if (!v.ok) {
      rep.errors = uniq.slice(0, 8);
      if (uniq.length > 8) rep.errors.push('…ほか ' + (uniq.length - 8) + ' 件の問題があります。');
      rep.errors.unshift('ブロックの構成に問題があるため、読み込めません。');
      return rep;
    }
    v.warnings.forEach(function (w) { if (rep.warnings.indexOf(w.msg) < 0 && rep.warnings.length < 8) rep.warnings.push(w.msg); });

    var name = tool.name.trim();
    if (name.length > PZ.config.limits.projectNameLength) { name = name.slice(0, PZ.config.limits.projectNameLength); rep.warnings.push('名前が長いため短くしました。'); }
    if (typeof tool.description === 'string' && tool.description && tool.description !== v.clean.description && !v.clean.description) {
      v.clean.description = tool.description.slice(0, Cr.LIMITS.desc);
    }
    var now = Date.now();
    var project = M.sanitizeProject({
      id: U.uid(), kind: 'creation', name: name, creation: v.clean,
      tags: tool.tags, createdAt: now, updatedAt: now, lastOpenedAt: null, parentId: null
    });
    if (!project) return fail('作品として読み込めませんでした。');
    rep.ok = true;
    rep.project = project;
    rep.summary = {
      name: name, description: v.clean.description, scripts: v.stats.scripts, blocks: v.stats.blocks, vars: v.stats.vars,
      kinds: kindsUsed(v.stats.types), appVersion: typeof data.appVersion === 'string' ? data.appVersion.slice(0, 20) : '',
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt.slice(0, 10) : ''
    };
    return rep;
  };

  /* ---------- 画像（サムネイル・PNG）: 呼ばれたときだけ DOM を使う ---------- */
  /** 画面なしで一定フレーム進めた結果を canvas に描く。戻り値: Runtime */
  Cr.renderToCanvas = function (creation, canvas, o) {
    o = o || {};
    var v = Cr.validate(creation);
    var sc = o.scale || 1;
    canvas.width = Math.round(v.clean.canvas.w * sc);
    canvas.height = Math.round(v.clean.canvas.h * sc);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    return Cr.runHeadless(v.clean, ctx, { frames: o.frames === undefined ? 45 : o.frames, seed: o.seed === undefined ? 1 : o.seed, font: M.FONT_STACK });
  };

  /** canvas を縮小して JPEG の data URL にする（作品カードのサムネイル用）。大きすぎる／失敗時は null */
  Cr.thumbFromCanvas = function (src, w, h) {
    try {
      w = w || 360; h = h || 225;
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var g = c.getContext('2d');
      g.drawImage(src, 0, 0, w, h);
      var url = c.toDataURL('image/jpeg', 0.72);
      return url.length < PZ.config.limits.thumbBytes ? url : null;
    } catch (e) { return null; }
  };

  /**
   * ファイル名が重複しないよう、保存先に同名の作品がある場合は「（取り込み）」を付ける。
   * existingNames: 保存済みの作品名の配列
   */
  Cr.uniqueImportName = function (name, existingNames) {
    if (existingNames.indexOf(name) < 0) return name;
    return (name + ' (取り込み)').slice(0, PZ.config.limits.projectNameLength);
  };
})();
