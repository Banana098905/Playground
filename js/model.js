/*
 * データモデル: 作品(Project)とオブジェクト(Shape/Text)の生成・検証・複製
 * 保存データは必ず sanitizeProject() を通す（壊れたデータ・不正なバックアップ対策）。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var C = PZ.config;
  var M = (PZ.model = {});

  M.SCHEMA = 2; // 2: kind/tool/params/tags/favorite/collections/parentId/daily/thumb を追加（1 のデータはそのまま読める）
  M.KINDS = ['studio', 'experiment'];
  M.TYPES = ['rect', 'ellipse', 'triangle', 'star', 'text'];
  M.TYPE_LABEL = { rect: '四角', ellipse: '円', triangle: '三角', star: '星', text: 'テキスト' };
  M.ACCENTS = ['#b8ff3d', '#a066ff', '#f2f4f8', '#ff5d9e', '#3de0ff', '#ffb13d'];
  M.FONT_STACK = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Yu Gothic","Noto Sans JP","Meiryo",system-ui,-apple-system,"Segoe UI",sans-serif';
  M.CANVAS_PRESETS = [
    { id: 'wide', label: '横長', w: 960, h: 600 },
    { id: 'square', label: '正方形', w: 800, h: 800 },
    { id: 'tall', label: '縦長', w: 600, h: 960 }
  ];

  var DEFAULTS = {
    rect: { w: 200, h: 130, radius: 0 },
    ellipse: { w: 160, h: 160 },
    triangle: { w: 170, h: 150 },
    star: { w: 170, h: 170 },
    text: { w: 120, h: 70, text: 'TEXT', fontSize: 56, fontWeight: 700 }
  };

  M.fontString = function (o) {
    return (o.fontWeight >= 600 ? '700' : '400') + ' ' + o.fontSize + 'px ' + M.FONT_STACK;
  };

  /* ---------- テキスト寸法 ---------- */
  var mctx = null;
  function measureCtx() {
    if (mctx) return mctx;
    try { mctx = document.createElement('canvas').getContext('2d'); } catch (e) { mctx = null; }
    return mctx;
  }
  /** テキストオブジェクトの w/h を内容から再計算する */
  M.fitText = function (o) {
    var lines = String(o.text || '').split('\n');
    var ctx = measureCtx();
    var maxW = 0, i;
    if (ctx && ctx.measureText) {
      ctx.font = M.fontString(o);
      for (i = 0; i < lines.length; i++) maxW = Math.max(maxW, ctx.measureText(lines[i]).width || 0);
    }
    if (!maxW) {
      for (i = 0; i < lines.length; i++) maxW = Math.max(maxW, lines[i].length * o.fontSize * 0.9);
    }
    o.w = Math.max(12, Math.ceil(maxW + (o.strokeWidth || 0)));
    o.h = Math.max(12, Math.ceil(lines.length * o.fontSize * 1.25));
    return o;
  };

  /* ---------- オブジェクト ---------- */
  M.newObject = function (type, project, index) {
    var d = DEFAULTS[type] || DEFAULTS.rect;
    var n = typeof index === 'number' ? index : (project ? project.objects.length : 0);
    var o = {
      id: U.oid(),
      type: type,
      x: project ? Math.round(project.width / 2 + ((n % 6) - 2.5) * 18) : 480,
      y: project ? Math.round(project.height / 2 + ((n % 6) - 2.5) * 18) : 300,
      w: d.w,
      h: d.h,
      rotation: 0,
      fill: type === 'text' ? '#f2f4f8' : M.ACCENTS[n % 2 === 0 ? 0 : 1],
      stroke: '#14161a',
      strokeWidth: 0,
      opacity: 1
    };
    if (type === 'rect') o.radius = d.radius;
    if (type === 'text') {
      o.text = d.text; o.fontSize = d.fontSize; o.fontWeight = d.fontWeight;
      M.fitText(o);
    }
    return o;
  };

  M.cloneObject = function (o, offset) {
    var c = U.clone(o);
    c.id = U.oid();
    var off = offset === undefined ? 24 : offset;
    c.x += off; c.y += off;
    return c;
  };

  function numIn(v, min, max, fallback) { return U.clamp(U.num(v, fallback), min, max); }

  /** 不正な値を丸めて安全なオブジェクトにする。型が不明なら null */
  M.sanitizeObject = function (raw) {
    if (!raw || typeof raw !== 'object' || M.TYPES.indexOf(raw.type) < 0) return null;
    var o = {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : U.oid(),
      type: raw.type,
      x: numIn(raw.x, -5000, 10000, 0),
      y: numIn(raw.y, -5000, 10000, 0),
      w: numIn(raw.w, 4, 8000, 100),
      h: numIn(raw.h, 4, 8000, 100),
      rotation: numIn(raw.rotation, -360, 360, 0),
      fill: raw.fill === null ? null : U.normHex(raw.fill, '#b8ff3d'),
      stroke: U.normHex(raw.stroke, '#14161a'),
      strokeWidth: numIn(raw.strokeWidth, 0, 80, 0),
      opacity: numIn(raw.opacity, 0, 1, 1)
    };
    if (o.type === 'rect') o.radius = numIn(raw.radius, 0, 1000, 0);
    if (o.type === 'text') {
      o.text = String(raw.text === undefined ? 'TEXT' : raw.text).slice(0, 500);
      o.fontSize = numIn(raw.fontSize, 8, 600, 48);
      o.fontWeight = raw.fontWeight >= 600 ? 700 : 400;
      M.fitText(o);
    }
    return o;
  };

  /* ---------- 作品 ---------- */
  M.createProject = function (name, opts) {
    opts = opts || {};
    var now = Date.now();
    return {
      id: U.uid(),
      schema: M.SCHEMA,
      name: String(name || '無題の作品').slice(0, C.limits.projectNameLength),
      width: opts.width || C.canvas.width,
      height: opts.height || C.canvas.height,
      background: opts.background || C.canvas.background,
      objects: opts.objects || [],
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      kind: 'studio',
      tool: '',
      params: null,
      tags: [],
      favorite: false,
      collections: [],
      parentId: null,
      daily: opts.daily ? String(opts.daily) : null,
      thumb: null
    };
  };

  /** 実験ツールの結果を「再編集できる作品」として作る（paramsにツール固有の設定を持つ） */
  M.createExperimentWork = function (tool, opts) {
    opts = opts || {};
    var now = Date.now();
    return M.sanitizeProject({
      id: U.uid(),
      kind: 'experiment',
      tool: tool,
      name: opts.name || '無題の実験',
      params: opts.params || {},
      width: opts.width || 1200,
      height: opts.height || 750,
      background: opts.background || '#101215',
      objects: [],
      tags: opts.tags || [],
      parentId: opts.parentId || null,
      daily: opts.daily || null,
      collections: opts.collections || [],
      thumb: opts.thumb || null,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now
    });
  };

  /* ---------- 付加情報の検証（タグ・パラメータ・サムネイルなど） ---------- */
  var DANGEROUS_KEYS = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };
  /** 実験パラメータを安全なJSONに（深さ・長さ・危険なキーを制限）。不正なら null */
  M.cleanParams = function (v, depth) {
    depth = depth || 0;
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v === 'string') return v.slice(0, 200);
    if (depth > 4) return null;
    if (Array.isArray(v)) return v.slice(0, 64).map(function (x) { return M.cleanParams(x, depth + 1); });
    if (typeof v === 'object') {
      var out = {};
      Object.keys(v).slice(0, 64).forEach(function (k) {
        if (DANGEROUS_KEYS[k]) return;
        out[k.slice(0, 40)] = M.cleanParams(v[k], depth + 1);
      });
      return out;
    }
    return null;
  };
  function cleanParamsTop(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    var c = M.cleanParams(v, 0);
    try { if (JSON.stringify(c).length > C.limits.paramsBytes) return {}; } catch (e) { return {}; }
    return c;
  }
  M.cleanTags = function (list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (t) {
      if (typeof t !== 'string') return;
      t = t.replace(/[\s\u3000]+/g, ' ').replace(/^#/, '').trim().slice(0, C.limits.tagLength);
      if (t && out.indexOf(t) < 0 && out.length < C.limits.tags) out.push(t);
    });
    return out;
  };
  function cleanIdList(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (t) { if (typeof t === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(t) && out.indexOf(t) < 0 && out.length < 20) out.push(t); });
    return out;
  }
  M.isDateKey = function (s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); };
  function cleanThumb(t) {
    if (typeof t !== 'string' || t.length > C.limits.thumbBytes) return null;
    return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(t) ? t : null;
  }

  /** 作品の複製（新しいID・名前・時刻を持つ別作品になる） */
  M.cloneProject = function (project, name) {
    var now = Date.now();
    var c = U.clone(project);
    c.id = U.uid();
    c.name = String(name || (project.name + ' のコピー')).slice(0, C.limits.projectNameLength);
    c.createdAt = now;
    c.updatedAt = now;
    c.lastOpenedAt = null;
    c.favorite = false;
    c.parentId = project.id; // 元の作品は変更せず、派生元として記録する
    c.objects.forEach(function (o) { o.id = U.oid(); });
    return c;
  };

  /** 外部/保存データを検証して安全な作品へ。壊れていれば null */
  M.sanitizeProject = function (raw) {
    if (!raw || typeof raw !== 'object') return null;
    var kind = raw.kind === 'experiment' ? 'experiment' : 'studio';
    if (kind === 'studio' && !Array.isArray(raw.objects)) return null;
    if (!Array.isArray(raw.objects)) raw = Object.assign({}, raw, { objects: [] });
    if (raw.schema !== undefined && U.num(raw.schema, 1) > M.SCHEMA) {
      // 将来のバージョンのデータ。読める範囲で読み込む（不明な型は捨てる）
    }
    var now = Date.now();
    var objects = [];
    for (var i = 0; i < raw.objects.length && objects.length < C.limits.objects; i++) {
      var o = M.sanitizeObject(raw.objects[i]);
      if (o) objects.push(o);
    }
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 60) : U.uid(),
      schema: M.SCHEMA,
      name: String(raw.name === undefined || raw.name === '' ? '無題の作品' : raw.name).slice(0, C.limits.projectNameLength),
      width: numIn(raw.width, 200, 4000, C.canvas.width),
      height: numIn(raw.height, 200, 4000, C.canvas.height),
      background: U.normHex(raw.background, C.canvas.background),
      objects: objects,
      createdAt: numIn(raw.createdAt, 0, 4e12, now),
      updatedAt: numIn(raw.updatedAt, 0, 4e12, now),
      lastOpenedAt: raw.lastOpenedAt === null || raw.lastOpenedAt === undefined ? null : numIn(raw.lastOpenedAt, 0, 4e12, now),
      kind: kind,
      tool: kind === 'experiment' ? String(raw.tool || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) : '',
      params: kind === 'experiment' ? cleanParamsTop(raw.params) : null,
      tags: M.cleanTags(raw.tags),
      favorite: raw.favorite === true,
      collections: cleanIdList(raw.collections),
      parentId: typeof raw.parentId === 'string' && raw.parentId ? raw.parentId.slice(0, 60) : null,
      daily: M.isDateKey(raw.daily) ? raw.daily : null,
      thumb: cleanThumb(raw.thumb)
    };
  };

  /* ---------- 履歴スナップショット ---------- */
  M.snapshot = function (project) {
    return JSON.stringify({ w: project.width, h: project.height, bg: project.background, o: project.objects });
  };
  M.applySnapshot = function (project, snap) {
    var s = JSON.parse(snap);
    project.width = s.w; project.height = s.h; project.background = s.bg; project.objects = s.o;
  };

  M.objectLabel = function (o) {
    if (o.type === 'text') {
      var t = String(o.text || '').replace(/\s+/g, ' ').trim();
      return t ? (t.length > 14 ? t.slice(0, 14) + '…' : t) : 'テキスト';
    }
    return M.TYPE_LABEL[o.type] || o.type;
  };
})();
