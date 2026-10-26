/*
 * 実験のコアロジック（DOM に依存しない）:
 *   PZ.labs.flow     Flow Field        ノイズの流れに沿って粒子が線を描く
 *   PZ.labs.color    Color Lab         配色の生成（調和ルール・HSL調整・固定）
 *   PZ.labs.pattern  Pattern Generator 8種の幾何学模様（シード再現・対称）
 *   PZ.labs.motion   Motion Playground ポインタに反応する動き（追従・周回・反発・バネ・重力）
 *
 * どの実験も次の形を持つ（UIページ・ライブラリのプレビュー・作品サムネイルが共通で使う）:
 *   defaults            既定のパラメータ
 *   normalize(params)   不正な値を丸めて安全なパラメータに（URL・保存データ・バックアップ用）
 *   render(ctx,w,h,p)   静的に1枚描く（同じパラメータなら必ず同じ絵）
 *   random(rnd)         ランダムなパラメータ（rnd は 0〜1 を返す関数。シード指定で再現可）
 * 論理サイズは固定（LW×LH）で、画面サイズが違っても同じ絵になる。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.labs = PZ.labs || {};
  var U = PZ.util;
  var Core = (PZ.labsCore = {});

  Core.LW = 1200;
  Core.LH = 750;
  var TAU = Math.PI * 2;

  /* ========== 共通ヘルパー ========== */
  Core.num = function (v, min, max, def) {
    var n = typeof v === 'string' ? parseFloat(v) : v;
    if (typeof n !== 'number' || !isFinite(n)) return def;
    return U.clamp(n, min, max);
  };
  Core.int = function (v, min, max, def) { return Math.round(Core.num(v, min, max, def)); };
  Core.oneOf = function (v, list, def) { return list.indexOf(v) >= 0 ? v : def; };
  Core.bool = function (v, def) {
    if (v === true || v === 1 || v === '1' || v === 'true') return true;
    if (v === false || v === 0 || v === '0' || v === 'false') return false;
    return def;
  };
  /** '#abc' / 'abc123' / ['#aaa', ...] / 'a,b,c' を安全な色配列にする */
  Core.hexList = function (v, fallback, min, max) {
    var arr = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[,\-\s]+/) : []);
    var out = [];
    arr.forEach(function (x) {
      if (typeof x !== 'string') return;
      x = x.trim();
      if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(x)) x = '#' + x;
      if (U.isHex(x) && out.length < (max || 6)) out.push(U.normHex(x));
    });
    if (out.length < (min || 1)) return fallback.slice();
    return out;
  };
  Core.hexQuery = function (list) { return list.map(function (c) { return c.slice(1); }).join(','); };
  Core.bgHex = function (v, fallback) {
    if (typeof v === 'string' && /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(v.trim())) v = '#' + v.trim();
    return U.normHex(v, fallback);
  };
  Core.rndFrom = function (seed) { return U.mulberry32((seed >>> 0) * 2654435761 >>> 0); };
  /** 論理サイズ(lw×lh)を描画先(w×h)へ「覆う」ように合わせる（はみ出しは切る） */
  Core.cover = function (ctx, w, h, lw, lh) {
    var s = Math.max(w / lw, h / lh);
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.translate((w - lw * s) / 2, (h - lh * s) / 2);
    ctx.scale(s, s);
    return s;
  };

  /** 共有パレット（Flow / Pattern / Motion の色プリセット） */
  Core.PALETTES = {
    neon: { label: 'ネオン', bg: '#101215', colors: ['#b8ff3d', '#a066ff', '#3de0ff', '#f2f4f8', '#ff5d9e'] },
    lime: { label: 'ライム', bg: '#11150c', colors: ['#b8ff3d', '#8fd11f', '#d8ff8a', '#4f7310', '#f2ffd0'] },
    violet: { label: 'バイオレット', bg: '#150f2b', colors: ['#a066ff', '#7c3aed', '#c9a8ff', '#4c2a9e', '#f2e9ff'] },
    sunset: { label: 'サンセット', bg: '#1d1021', colors: ['#ff5d9e', '#ffb13d', '#ff7a45', '#a066ff', '#ffe3b3'] },
    ocean: { label: 'オーシャン', bg: '#0b1622', colors: ['#3de0ff', '#2b8cff', '#7cf5d6', '#e8fbff', '#1f4fa3'] },
    forest: { label: 'フォレスト', bg: '#0d1510', colors: ['#8fd11f', '#2f8f4e', '#d8ff8a', '#1b6b45', '#f2ffd0'] },
    candy: { label: 'キャンディ', bg: '#1d1021', colors: ['#ff5d9e', '#ffd23d', '#3de0ff', '#a066ff', '#f2f4f8'] },
    paper: { label: 'ペーパー', bg: '#f2efe6', colors: ['#1c1c1c', '#d94f30', '#2d5fa8', '#e6b422', '#4a7c59'] },
    mono: { label: 'モノ', bg: '#101215', colors: ['#f2f4f8', '#c3cad6', '#8f98a6', '#5f6775', '#343a45'] }
  };
  Core.paletteList = Object.keys(Core.PALETTES);
  /** 現在の色が既存パレットと一致していれば、そのIDを返す */
  Core.matchPalette = function (colors, bg) {
    for (var i = 0; i < Core.paletteList.length; i++) {
      var p = Core.PALETTES[Core.paletteList[i]];
      var n = Math.min(p.colors.length, colors.length);
      if (p.bg === bg && colors.length === n && p.colors.slice(0, n).join() === colors.join()) return Core.paletteList[i];
    }
    return null;
  };
  Core.applyPalette = function (id, maxColors) {
    var p = Core.PALETTES[id];
    return { colors: p.colors.slice(0, maxColors || 5), bg: p.bg };
  };
  function randomPalette(rnd, n) {
    var hue = rnd() * 360, dark = rnd() < 0.8;
    var colors = [];
    for (var i = 0; i < n; i++) colors.push(U.hslToHex((hue + i * (30 + rnd() * 70)) % 360, 55 + rnd() * 40, 48 + rnd() * 24));
    return { colors: colors, bg: dark ? U.hslToHex(hue, 25 + rnd() * 25, 6 + rnd() * 6) : U.hslToHex(hue, 20, 93) };
  }
  Core.randomPalette = randomPalette;
  function pickPalette(rnd, maxColors) {
    if (rnd() < 0.3) return randomPalette(rnd, 3 + Math.floor(rnd() * 3));
    var id = Core.paletteList[Math.floor(rnd() * Core.paletteList.length)];
    return Core.applyPalette(id, maxColors);
  }

  /* ========== ノイズ（シード固定の値ノイズ） ========== */
  Core.makeNoise = function (seed) {
    var perm = new Uint8Array(512), i, j, t;
    var rnd = Core.rndFrom(seed + 101);
    for (i = 0; i < 256; i++) perm[i] = i;
    for (i = 255; i > 0; i--) { j = Math.floor(rnd() * (i + 1)); t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (i = 0; i < 256; i++) perm[i + 256] = perm[i];
    function fade(v) { return v * v * v * (v * (v * 6 - 15) + 10); }
    function n2(x, y) {
      var xf = x - Math.floor(x), yf = y - Math.floor(y);
      var xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
      var a = perm[perm[xi] + yi], b = perm[perm[xi + 1] + yi], c = perm[perm[xi] + yi + 1], d = perm[perm[xi + 1] + yi + 1];
      var u = fade(xf), v = fade(yf);
      return ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v) / 255;
    }
    return function (x, y) { return n2(x, y) * 0.65 + n2(x * 2.07 + 17.3, y * 2.07 + 9.1) * 0.35; };
  };

  /* ==========================================================================
     Flow Field
     ========================================================================== */
  var Flow = (PZ.labs.flow = {});
  Flow.MODES = [{ id: 'smooth', label: 'なめらか' }, { id: 'vortex', label: '渦' }, { id: 'steps', label: '8方向' }];
  Flow.COLOR_MODES = [{ id: 'random', label: 'ばらばら' }, { id: 'angle', label: '向きで色分け' }];
  Flow.MAX_COUNT = 3000;
  Flow.MOBILE_MAX = 1200;

  Flow.defaults = {
    seed: 7, mode: 'smooth', angle: 30, strength: 55, scale: 28, count: 900, speed: 100,
    width: 1.2, fade: 3, evolve: 0, life: 260, colorMode: 'random',
    colors: ['#b8ff3d', '#a066ff', '#3de0ff', '#f2f4f8'], bg: '#101215'
  };

  Flow.normalize = function (p) {
    p = p || {}; var d = Flow.defaults;
    return {
      seed: Core.int(p.seed, 0, 999999, d.seed),
      mode: Core.oneOf(p.mode, ['smooth', 'vortex', 'steps'], d.mode),
      angle: Core.int(p.angle, 0, 360, d.angle),
      strength: Core.int(p.strength, 0, 100, d.strength),
      scale: Core.int(p.scale, 1, 100, d.scale),
      count: Core.int(p.count, 50, Flow.MAX_COUNT, d.count),
      speed: Core.int(p.speed, 10, 300, d.speed),
      width: U.round(Core.num(p.width, 0.5, 4, d.width), 1),
      fade: Core.int(p.fade, 0, 100, d.fade),
      evolve: Core.int(p.evolve, 0, 100, d.evolve),
      life: Core.int(p.life, 40, 800, d.life),
      colorMode: Core.oneOf(p.colorMode, ['random', 'angle'], d.colorMode),
      colors: Core.hexList(p.colors, d.colors, 1, 6),
      bg: Core.bgHex(p.bg, d.bg)
    };
  };

  Flow.random = function (rnd) {
    var pal = pickPalette(rnd, 5);
    var fades = [0, 2, 4, 8, 14];
    return Flow.normalize({
      seed: Math.floor(rnd() * 1000000),
      mode: Flow.MODES[Math.floor(rnd() * 3)].id,
      angle: Math.floor(rnd() * 360),
      strength: 20 + Math.floor(rnd() * 75),
      scale: 6 + Math.floor(rnd() * 60),
      count: 600 + Math.floor(rnd() * 1000),
      speed: 70 + Math.floor(rnd() * 90),
      width: U.round(0.7 + rnd() * 1.6, 1),
      fade: fades[Math.floor(rnd() * fades.length)],
      evolve: rnd() < 0.35 ? 10 + Math.floor(rnd() * 40) : 0,
      life: 140 + Math.floor(rnd() * 360),
      colorMode: rnd() < 0.3 ? 'angle' : 'random',
      colors: pal.colors, bg: pal.bg
    });
  };

  /** 位置 (x,y) での流れの向き（ラジアン）。t はフレーム数（evolve 用） */
  Flow.angleAt = function (noise, p, x, y, t) {
    var freq = 0.0004 + (p.scale / 100) * 0.012;
    var drift = (p.evolve / 100) * 0.004 * t;
    var n = noise(x * freq + drift * 0.6, y * freq + drift);
    var turb = p.strength / 100;
    var base = p.angle * Math.PI / 180;
    var a;
    if (p.mode === 'vortex') {
      a = Math.atan2(y - Core.LH / 2, x - Core.LW / 2) + Math.PI / 2 + base * 0.25 + (n - 0.5) * turb * TAU - 0.18;
    } else {
      a = base + (n - 0.5) * turb * 2 * TAU;
      if (p.mode === 'steps') a = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
    }
    return a;
  };

  /** 粒子シミュレーション。step(ctx) で1フレーム進めて、そのまま描く（論理座標 LW×LH） */
  function FlowSim(p) { this.reset(p); }
  FlowSim.prototype.reset = function (p) {
    this.p = p;
    this.noise = Core.makeNoise(p.seed);
    this.rnd = Core.rndFrom(p.seed * 31 + 7);
    this.t = 0;
    this.parts = [];
    this.limit = p.count;
    this.fill();
  };
  FlowSim.prototype.setParams = function (p) {
    var reseed = p.seed !== this.p.seed;
    this.p = p;
    if (reseed) { this.reset(p); return true; }
    this.fill();
    return false;
  };
  FlowSim.prototype.setLimit = function (n) { this.limit = Math.max(50, Math.min(n, this.p.count)); this.fill(); };
  FlowSim.prototype.fill = function () {
    var n = Math.min(this.p.count, this.limit);
    while (this.parts.length < n) {
      var q = { x: 0, y: 0, px: 0, py: 0, age: 0, life: 0, ci: 0, k: 0, fresh: true, ok: false };
      this.spawn(q, true);
      this.parts.push(q);
    }
    if (this.parts.length > n) this.parts.length = n;
  };
  FlowSim.prototype.spawn = function (q, initial) {
    var r = this.rnd;
    q.x = r() * Core.LW; q.y = r() * Core.LH; q.px = q.x; q.py = q.y;
    q.life = this.p.life * (0.45 + r() * 0.8);
    q.age = initial ? Math.floor(r() * q.life) : 0;
    q.ci = Math.floor(r() * this.p.colors.length);
    q.k = 0.75 + r() * 0.5;
    q.fresh = true; q.ok = false;
  };
  FlowSim.prototype.step = function (ctx, dt) {
    dt = dt || 1;
    var p = this.p, parts = this.parts, n = parts.length, i, q, a;
    var nc = p.colors.length, speed = (p.speed / 100) * 2.4 * dt;
    // 残像: 背景色を薄く重ねて、古い線を消していく
    if (p.fade > 0) {
      ctx.globalAlpha = Math.min(0.5, (p.fade / 100) * 0.3 * dt);
      ctx.fillStyle = p.bg; ctx.fillRect(0, 0, Core.LW, Core.LH);
    }
    ctx.globalAlpha = 1;
    for (i = 0; i < n; i++) {
      q = parts[i];
      a = Flow.angleAt(this.noise, p, q.x, q.y, this.t);
      q.px = q.x; q.py = q.y;
      q.x += Math.cos(a) * speed * q.k; q.y += Math.sin(a) * speed * q.k;
      if (p.colorMode === 'angle') {
        var turn = (a / TAU) % 1; if (turn < 0) turn += 1;
        q.ci = Math.min(nc - 1, Math.floor(turn * nc));
      } else if (q.ci >= nc) q.ci = q.ci % nc;
      q.ok = !q.fresh;
      q.fresh = false;
      q.age += dt;
      if (q.age > q.life || q.x < 0 || q.x > Core.LW || q.y < 0 || q.y > Core.LH) { q.ok = false; this.spawn(q, false); }
    }
    ctx.lineWidth = p.width; ctx.lineCap = 'round';
    ctx.globalAlpha = 0.62;
    for (var c = 0; c < nc; c++) {
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        q = parts[i];
        if (q.ci !== c || !q.ok) continue;
        ctx.moveTo(q.px, q.py); ctx.lineTo(q.x, q.y);
      }
      ctx.strokeStyle = p.colors[c];
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.t += dt;
  };
  Flow.Sim = FlowSim;

  Flow.render = function (ctx, w, h, p, steps) {
    p = Flow.normalize(p);
    ctx.save();
    ctx.fillStyle = p.bg; ctx.fillRect(0, 0, w, h);
    Core.cover(ctx, w, h, Core.LW, Core.LH);
    var q = Object.assign({}, p, { count: Math.min(p.count, 700) });
    var sim = new FlowSim(q);
    var n = steps || 220;
    for (var i = 0; i < n; i++) sim.step(ctx, 1);
    ctx.restore();
  };

  /* ==========================================================================
     Color Lab
     ========================================================================== */
  var Color = (PZ.labs.color = {});
  Color.SCHEMES = [
    { id: 'analogous', label: '類似色', offs: [0, -28, 28, -56, 56, -84, 84, 112] },
    { id: 'complementary', label: '補色', offs: [0, 180, 20, 200, -20, 160, 40, 220] },
    { id: 'triadic', label: '3色配色', offs: [0, 120, 240, 20, 140, 260, -20, 100] },
    { id: 'tetradic', label: '4色配色', offs: [0, 90, 180, 270, 20, 110, 200, 290] },
    { id: 'split', label: 'スプリット補色', offs: [0, 150, 210, 20, 170, 230, -20, 130] },
    { id: 'monochrome', label: '単色の濃淡', offs: [0] },
    { id: 'shades', label: '彩度の段階', offs: [0] }
  ];
  var LIGHT_VAR = [0, -12, 12, -22, 22, -30, 30, 0];

  Color.defaults = { base: '#7c5cff', scheme: 'analogous', count: 5, satAdj: 0, lightAdj: 0, seed: 1 };

  /** パラメータから色配列を生成（固定色は含まない純粋な生成） */
  Color.generate = function (p) {
    var scheme = Color.SCHEMES.filter(function (s) { return s.id === p.scheme; })[0] || Color.SCHEMES[0];
    var hsl = U.hexToHsl(p.base);
    var n = p.count, out = [];
    for (var i = 0; i < n; i++) {
      var off = scheme.offs[i % scheme.offs.length];
      var cycle = Math.floor(i / scheme.offs.length);
      var hue = (hsl.h + off + 720) % 360;
      var s = hsl.s, l = hsl.l;
      if (scheme.id === 'monochrome') {
        l = n === 1 ? hsl.l : 14 + (i / (n - 1)) * 76;
      } else if (scheme.id === 'shades') {
        l = n === 1 ? hsl.l : 20 + (i / (n - 1)) * 68;
        s = n === 1 ? hsl.s : hsl.s * (1 - 0.65 * (i / (n - 1)));
      } else {
        l = hsl.l + LIGHT_VAR[cycle % LIGHT_VAR.length] * (cycle ? 1 : 0);
        s = hsl.s - cycle * 4;
      }
      s = U.clamp(s + p.satAdj, 0, 100);
      l = U.clamp(l + p.lightAdj, 6, 96);
      out.push(U.hslToHex(hue, s, l));
    }
    return out;
  };

  Color.normalize = function (p) {
    p = p || {}; var d = Color.defaults;
    var base = Core.bgHex(p.base, d.base);
    var out = {
      base: base,
      scheme: Core.oneOf(p.scheme, Color.SCHEMES.map(function (s) { return s.id; }), d.scheme),
      count: Core.int(p.count, 2, 8, d.count),
      satAdj: Core.int(p.satAdj, -50, 50, d.satAdj),
      lightAdj: Core.int(p.lightAdj, -30, 30, d.lightAdj),
      seed: Core.int(p.seed, 0, 999999, d.seed)
    };
    var gen = Color.generate(out);
    var colors = Core.hexList(p.colors, [], 0, 8);
    // 保存された色（手動で編集した色を含む）があればそれを優先。足りなければ生成色で補う
    out.colors = gen.map(function (g, i) { return colors[i] || g; });
    var locked = Array.isArray(p.locked) ? p.locked : [];
    out.locked = out.colors.map(function (_, i) { return locked[i] === true; });
    return out;
  };

  /** 配色ルールの変更に合わせて再生成。固定された色は保つ */
  Color.regenerate = function (p) {
    var gen = Color.generate(p);
    var colors = gen.map(function (g, i) { return p.locked[i] && p.colors[i] ? p.colors[i] : g; });
    return Color.normalize(Object.assign({}, p, { colors: colors }));
  };

  Color.random = function (rnd) {
    var scheme = Color.SCHEMES[Math.floor(rnd() * Color.SCHEMES.length)].id;
    var base = U.hslToHex(Math.floor(rnd() * 360), 40 + Math.floor(rnd() * 50), 38 + Math.floor(rnd() * 28));
    return Color.regenerate(Color.normalize({
      base: base, scheme: scheme, count: 4 + Math.floor(rnd() * 3), seed: Math.floor(rnd() * 1000000)
    }));
  };

  Color.render = function (ctx, w, h, p) {
    p = Color.normalize(p);
    var n = p.colors.length, bw = w / n;
    for (var i = 0; i < n; i++) {
      ctx.fillStyle = p.colors[i];
      ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, h);
    }
  };

  /** 配色を使った見本のポスター（Color Lab のプレビュー用） */
  Color.sample = function (ctx, w, h, colors) {
    var n = colors.length;
    var rnd = Core.rndFrom(U.hash32(colors.join()));
    ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    for (var i = 0; i < 9; i++) {
      var c = colors[(i + 1) % n];
      var x = rnd() * w, y = rnd() * h, s = (0.12 + rnd() * 0.3) * Math.min(w, h);
      ctx.fillStyle = c; ctx.globalAlpha = 0.9;
      var t = rnd();
      ctx.beginPath();
      if (t < 0.4) ctx.arc(x, y, s / 2, 0, TAU);
      else if (t < 0.75) ctx.rect(x - s / 2, y - s / 2, s, s * (0.5 + rnd() * 0.6));
      else { ctx.moveTo(x, y - s / 2); ctx.lineTo(x + s / 2, y + s / 2); ctx.lineTo(x - s / 2, y + s / 2); ctx.closePath(); }
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  /* ==========================================================================
     Pattern Generator
     ========================================================================== */
  var Pattern = (PZ.labs.pattern = {});
  Pattern.TYPES = [
    { id: 'blocks', label: 'ブロック' }, { id: 'truchet', label: '円弧タイル' }, { id: 'triangles', label: '三角モザイク' },
    { id: 'hex', label: '六角形' }, { id: 'rings', label: '同心円' }, { id: 'diamonds', label: 'ひし形' },
    { id: 'waves', label: '波' }, { id: 'dots', label: 'ドット' }
  ];
  Pattern.SYMMETRY = [{ id: 'none', label: 'なし' }, { id: 'h', label: '左右' }, { id: 'v', label: '上下' }, { id: 'both', label: '四方' }];
  Pattern.defaults = {
    type: 'blocks', seed: 11, density: 12, fill: 92, weight: 22, rotate: 0, symmetry: 'none',
    colors: ['#b8ff3d', '#a066ff', '#f2f4f8', '#3de0ff'], bg: '#15171b'
  };

  Pattern.normalize = function (p) {
    p = p || {}; var d = Pattern.defaults;
    return {
      type: Core.oneOf(p.type, Pattern.TYPES.map(function (t) { return t.id; }), d.type),
      seed: Core.int(p.seed, 0, 999999, d.seed),
      density: Core.int(p.density, 3, 40, d.density),
      fill: Core.int(p.fill, 30, 100, d.fill),
      weight: Core.int(p.weight, 4, 60, d.weight),
      rotate: Core.int(p.rotate, 0, 90, d.rotate),
      symmetry: Core.oneOf(p.symmetry, ['none', 'h', 'v', 'both'], d.symmetry),
      colors: Core.hexList(p.colors, d.colors, 1, 6),
      bg: Core.bgHex(p.bg, d.bg)
    };
  };

  Pattern.random = function (rnd) {
    var pal = pickPalette(rnd, 5);
    var sym = ['none', 'none', 'h', 'v', 'both'];
    return Pattern.normalize({
      type: Pattern.TYPES[Math.floor(rnd() * Pattern.TYPES.length)].id,
      seed: Math.floor(rnd() * 1000000),
      density: 5 + Math.floor(rnd() * 22),
      fill: 70 + Math.floor(rnd() * 31),
      weight: 10 + Math.floor(rnd() * 35),
      rotate: rnd() < 0.3 ? Math.floor(rnd() * 90) : 0,
      symmetry: sym[Math.floor(rnd() * sym.length)],
      colors: pal.colors, bg: pal.bg
    });
  };

  function hexPath(ctx, cx, cy, r) {
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 6 + i * Math.PI / 3;
      var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  Pattern.render = function (ctx, w, h, p) {
    p = Pattern.normalize(p);
    var colors = p.colors, nc = colors.length;
    ctx.save();
    ctx.fillStyle = p.bg; ctx.fillRect(0, 0, w, h);
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    // 回転するときは、はみ出し分を含めて広く描く
    var W = w, H = h;
    if (p.rotate) {
      var diag = Math.ceil(Math.sqrt(w * w + h * h));
      W = diag; H = diag;
      ctx.translate(w / 2, h / 2); ctx.rotate(p.rotate * Math.PI / 180); ctx.translate(-W / 2, -H / 2);
    }
    var nx = p.density, s = W / nx, ny = Math.ceil(H / s) + (p.type === 'hex' ? 1 : 0);
    var symH = p.symmetry === 'h' || p.symmetry === 'both';
    var symV = p.symmetry === 'v' || p.symmetry === 'both';
    var fillK = p.fill / 100, lw = Math.max(1, s * (p.weight / 100));
    function mi(ix, iy) {
      return [symH ? Math.min(ix, nx - 1 - ix) : ix, symV ? Math.min(iy, ny - 1 - iy) : iy];
    }
    function rnd(ix, iy, k) { var m = mi(ix, iy); return U.hashRand(p.seed, p.type, m[0], m[1], k || 0); }
    function col(ix, iy, k) { return colors[Math.floor(rnd(ix, iy, 50 + (k || 0)) * nc) % nc]; }
    var ix, iy, x, y, r;

    if (p.type === 'truchet') {
      ctx.lineWidth = lw; ctx.lineCap = 'butt';
      for (iy = 0; iy < ny; iy++) for (ix = 0; ix < nx; ix++) {
        x = ix * s; y = iy * s; r = rnd(ix, iy) < 0.5;
        var rad = s / 2;
        ctx.strokeStyle = col(ix, iy, 1);
        ctx.beginPath();
        if (r) { ctx.arc(x, y, rad, 0, Math.PI / 2); ctx.stroke(); ctx.beginPath(); ctx.strokeStyle = col(ix, iy, 2); ctx.arc(x + s, y + s, rad, Math.PI, Math.PI * 1.5); }
        else { ctx.arc(x + s, y, rad, Math.PI / 2, Math.PI); ctx.stroke(); ctx.beginPath(); ctx.strokeStyle = col(ix, iy, 2); ctx.arc(x, y + s, rad, Math.PI * 1.5, TAU); }
        ctx.stroke();
      }
    } else if (p.type === 'triangles') {
      for (iy = 0; iy < ny; iy++) for (ix = 0; ix < nx; ix++) {
        x = ix * s; y = iy * s; r = rnd(ix, iy) < 0.5;
        var tris = r ? [[[x, y], [x + s, y], [x, y + s]], [[x + s, y + s], [x + s, y], [x, y + s]]]
          : [[[x, y], [x + s, y + s], [x, y + s]], [[x, y], [x + s, y], [x + s, y + s]]];
        for (var ti = 0; ti < 2; ti++) {
          var t = tris[ti], gx = (t[0][0] + t[1][0] + t[2][0]) / 3, gy = (t[0][1] + t[1][1] + t[2][1]) / 3;
          ctx.fillStyle = col(ix, iy, ti + 1);
          ctx.beginPath();
          for (var vi = 0; vi < 3; vi++) {
            var px = gx + (t[vi][0] - gx) * (0.5 + fillK * 0.52), py = gy + (t[vi][1] - gy) * (0.5 + fillK * 0.52);
            if (vi) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          }
          ctx.closePath(); ctx.fill();
        }
      }
    } else if (p.type === 'hex') {
      var hr = s / Math.sqrt(3) * 1.0, hw = Math.sqrt(3) * hr, hv = hr * 1.5;
      var cols = Math.ceil(W / hw) + 1, rows = Math.ceil(H / hv) + 1;
      nx = cols; ny = rows; // 対称のために実際の列・行数に合わせる
      for (iy = 0; iy < rows; iy++) for (ix = 0; ix < cols; ix++) {
        x = ix * hw + (iy % 2 ? hw / 2 : 0); y = iy * hv;
        ctx.fillStyle = col(ix, iy, 1);
        ctx.beginPath(); hexPath(ctx, x, y, hr * (0.45 + fillK * 0.55)); ctx.fill();
      }
    } else if (p.type === 'rings') {
      ctx.lineWidth = Math.max(1, lw * 0.5);
      for (iy = 0; iy < ny; iy++) for (ix = 0; ix < nx; ix++) {
        x = ix * s + s / 2; y = iy * s + s / 2;
        var rings = 2 + Math.floor(rnd(ix, iy) * 3);
        for (var k = 0; k < rings; k++) {
          ctx.strokeStyle = col(ix, iy, k + 1);
          ctx.beginPath(); ctx.arc(x, y, (s / 2) * fillK * (1 - k / rings), 0, TAU); ctx.stroke();
        }
      }
    } else if (p.type === 'diamonds') {
      for (iy = 0; iy < ny; iy++) for (ix = 0; ix < nx; ix++) {
        x = ix * s + s / 2; y = iy * s + s / 2; var dr = (s / 2) * (0.35 + fillK * 0.65);
        var outline = rnd(ix, iy) < 0.4;
        ctx.beginPath(); ctx.moveTo(x, y - dr); ctx.lineTo(x + dr, y); ctx.lineTo(x, y + dr); ctx.lineTo(x - dr, y); ctx.closePath();
        if (outline) { ctx.lineWidth = Math.max(1, lw * 0.35); ctx.strokeStyle = col(ix, iy, 1); ctx.stroke(); }
        else { ctx.fillStyle = col(ix, iy, 1); ctx.fill(); }
      }
    } else if (p.type === 'waves') {
      ctx.lineWidth = Math.max(1, lw * 0.5); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (iy = 0; iy < ny; iy++) {
        var amp = s * (0.18 + rnd(0, iy, 1) * 0.5) * (0.4 + fillK * 0.7);
        var freq = (0.6 + rnd(0, iy, 2) * 2.2) * TAU / W * nx / 4;
        var ph = rnd(0, iy, 3) * TAU;
        ctx.strokeStyle = col(0, iy, 4);
        ctx.beginPath();
        for (var wx = 0; wx <= W; wx += 6) {
          var ux = symH ? Math.abs(wx - W / 2) : wx;
          var wy = iy * s + s / 2 + Math.sin(ux * freq * 4 + ph) * amp;
          if (wx) ctx.lineTo(wx, wy); else ctx.moveTo(wx, wy);
        }
        ctx.stroke();
      }
    } else if (p.type === 'dots') {
      var sx = rnd(0, 0, 90) * 6, sy = rnd(0, 0, 91) * 6;
      for (iy = 0; iy < ny; iy++) for (ix = 0; ix < nx; ix++) {
        var m = mi(ix, iy);
        var field = 0.5 + 0.5 * Math.sin(m[0] * 0.55 + sx) * Math.cos(m[1] * 0.55 + sy);
        var rr = (s / 2) * fillK * (0.12 + 0.88 * (field * 0.75 + rnd(ix, iy, 1) * 0.25));
        ctx.fillStyle = col(ix, iy, 2);
        ctx.beginPath(); ctx.arc(ix * s + s / 2, iy * s + s / 2, rr, 0, TAU); ctx.fill();
      }
    } else { // blocks（バウハウス風）
      for (iy = 0; iy < ny; iy++) for (ix = 0; ix < nx; ix++) {
        x = ix * s; y = iy * s;
        var kind = Math.floor(rnd(ix, iy) * 6), rot = Math.floor(rnd(ix, iy, 7) * 4);
        var q = s * (0.5 + fillK * 0.5);
        ctx.fillStyle = col(ix, iy, 1);
        ctx.save(); ctx.translate(x + s / 2, y + s / 2); ctx.rotate(rot * Math.PI / 2); ctx.translate(-q / 2, -q / 2);
        ctx.beginPath();
        if (kind === 0) ctx.rect(0, 0, q, q);
        else if (kind === 1) ctx.arc(q / 2, q / 2, q / 2, 0, TAU);
        else if (kind === 2) { ctx.moveTo(0, q); ctx.arc(0, q, q, -Math.PI / 2, 0); ctx.closePath(); }
        else if (kind === 3) { ctx.moveTo(0, 0); ctx.lineTo(q, q); ctx.lineTo(0, q); ctx.closePath(); }
        else if (kind === 4) { ctx.arc(q / 2, q / 2, q / 2, Math.PI, 0); ctx.closePath(); }
        else { ctx.rect(0, 0, q, q / 2); ctx.rect(q / 2, q / 2, q / 2, q / 2); }
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  };

  /* ==========================================================================
     Motion Playground
     ========================================================================== */
  var Motion = (PZ.labs.motion = {});
  Motion.BEHAVIORS = [
    { id: 'follow', label: '追従' }, { id: 'orbit', label: '周回' }, { id: 'repel', label: '反発' },
    { id: 'spring', label: 'バネ' }, { id: 'gravity', label: '重力' }
  ];
  Motion.SHAPES = [
    { id: 'circle', label: '円', icon: 'ellipse' }, { id: 'square', label: '四角', icon: 'rect' },
    { id: 'triangle', label: '三角', icon: 'triangle' }, { id: 'star', label: '星', icon: 'star' }, { id: 'line', label: '線', icon: 'up' }
  ];
  Motion.MAX_COUNT = 200;
  Motion.MOBILE_MAX = 90;

  Motion.defaults = {
    seed: 5, behavior: 'follow', shape: 'circle', count: 70, speed: 100, power: 60, size: 14, trail: 60,
    colors: ['#b8ff3d', '#a066ff', '#3de0ff', '#f2f4f8'], bg: '#101215', auto: true, spin: true
  };

  Motion.normalize = function (p) {
    p = p || {}; var d = Motion.defaults;
    return {
      seed: Core.int(p.seed, 0, 999999, d.seed),
      behavior: Core.oneOf(p.behavior, Motion.BEHAVIORS.map(function (b) { return b.id; }), d.behavior),
      shape: Core.oneOf(p.shape, Motion.SHAPES.map(function (s) { return s.id; }), d.shape),
      count: Core.int(p.count, 5, Motion.MAX_COUNT, d.count),
      speed: Core.int(p.speed, 10, 300, d.speed),
      power: Core.int(p.power, 0, 100, d.power),
      size: Core.int(p.size, 4, 60, d.size),
      trail: Core.int(p.trail, 0, 95, d.trail),
      colors: Core.hexList(p.colors, d.colors, 1, 6),
      bg: Core.bgHex(p.bg, d.bg),
      auto: Core.bool(p.auto, d.auto),
      spin: Core.bool(p.spin, d.spin)
    };
  };

  Motion.random = function (rnd) {
    var pal = pickPalette(rnd, 5);
    return Motion.normalize({
      seed: Math.floor(rnd() * 1000000),
      behavior: Motion.BEHAVIORS[Math.floor(rnd() * 5)].id,
      shape: Motion.SHAPES[Math.floor(rnd() * 5)].id,
      count: 30 + Math.floor(rnd() * 70),
      speed: 70 + Math.floor(rnd() * 100),
      power: 35 + Math.floor(rnd() * 60),
      size: 6 + Math.floor(rnd() * 26),
      trail: [0, 30, 55, 75, 88][Math.floor(rnd() * 5)],
      colors: pal.colors, bg: pal.bg
    });
  };

  function MotionSim(p) { this.reset(p); }
  MotionSim.prototype.reset = function (p) {
    this.p = p;
    this.rnd = Core.rndFrom(p.seed * 17 + 3);
    this.t = 0;
    this.items = [];
    this.limit = p.count;
    this.fill();
  };
  MotionSim.prototype.setLimit = function (n) { this.limit = Math.max(5, Math.min(n, this.p.count)); this.fill(); };
  MotionSim.prototype.fill = function () {
    var n = Math.min(this.p.count, this.limit), r = this.rnd, W = Core.LW, H = Core.LH;
    var cols = Math.max(1, Math.ceil(Math.sqrt(this.p.count * W / H))), rows = Math.ceil(this.p.count / cols);
    while (this.items.length < n) {
      var i = this.items.length;
      var hx = ((i % cols) + 0.5) * (W / cols), hy = (Math.floor(i / cols) + 0.5) * (H / rows);
      var gx = W * 0.1 + r() * W * 0.8, gy = H * 0.1 + r() * H * 0.8;
      var spring = this.p.behavior === 'spring';
      this.items.push({
        x: spring ? hx : gx, y: spring ? hy : gy, vx: 0, vy: 0,
        hx: spring ? hx : gx, hy: spring ? hy : gy,
        k: 0.35 + r() * 0.65, ph: r() * TAU, ci: Math.floor(r() * this.p.colors.length), rad: 30 + r() * 230, rot: r() * TAU
      });
    }
    if (this.items.length > n) this.items.length = n;
  };
  MotionSim.prototype.setParams = function (p) {
    var restart = p.seed !== this.p.seed || p.behavior !== this.p.behavior;
    this.p = p;
    if (restart) { this.reset(p); return true; }
    var nc = p.colors.length;
    this.items.forEach(function (it) { it.ci = it.ci % nc; });
    this.fill();
    return false;
  };
  /** 衝撃: 中心から外へ押し出す（クリック／タップ） */
  MotionSim.prototype.impulse = function (x, y) {
    var R = 180 + this.p.power * 2, f = 5 + this.p.power * 0.12;
    this.items.forEach(function (it) {
      var dx = it.x - x, dy = it.y - y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d < R) { var k = (1 - d / R) * f; it.vx += dx / d * k; it.vy += dy / d * k; }
    });
  };
  /** ポインタが無いときの「見本」の動き（自動モード） */
  MotionSim.prototype.autoPointer = function () {
    var t = this.t * 0.012 * (this.p.speed / 100);
    return { x: Core.LW / 2 + Math.cos(t * 1.3) * Core.LW * 0.33, y: Core.LH / 2 + Math.sin(t * 1.7 + 1) * Core.LH * 0.3 };
  };
  MotionSim.prototype.step = function (ptr, dt) {
    dt = dt || 1;
    var p = this.p, W = Core.LW, H = Core.LH, sp = p.speed / 100, pw = p.power / 100;
    var pt = null;
    if (ptr && ptr.active) pt = ptr; else if (p.auto) pt = this.autoPointer();
    var items = this.items, i, it, dx, dy, d, f;
    var R = 110 + pw * 170, R2 = R * R;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (p.behavior === 'follow') {
        var tx = pt ? pt.x + Math.cos(it.ph + this.t * 0.02 * sp) * it.rad * 0.35 : it.hx;
        var ty = pt ? pt.y + Math.sin(it.ph + this.t * 0.02 * sp) * it.rad * 0.35 : it.hy;
        var pull = (0.0035 + pw * 0.016) * it.k * sp;
        it.vx += (tx - it.x) * pull * dt; it.vy += (ty - it.y) * pull * dt;
        it.vx *= Math.pow(0.93, dt); it.vy *= Math.pow(0.93, dt);
      } else if (p.behavior === 'orbit') {
        var cx = pt ? pt.x : W / 2, cy = pt ? pt.y : H / 2;
        var ang = it.ph + this.t * (0.012 + it.k * 0.03) * sp;
        var rr = 25 + it.rad * (0.35 + pw * 0.65);
        var ox = cx + Math.cos(ang) * rr, oy = cy + Math.sin(ang) * rr * 0.75;
        var ease = 0.05 + pw * 0.08;
        it.vx = (ox - it.x) * ease * Math.min(1.5, sp) ; it.vy = (oy - it.y) * ease * Math.min(1.5, sp);
      } else if (p.behavior === 'repel') {
        it.vx += Math.cos(it.ph + this.t * 0.01 * it.k) * 0.03 * sp * dt;
        it.vy += Math.sin(it.ph * 1.3 + this.t * 0.012 * it.k) * 0.03 * sp * dt;
        it.vx += (it.hx - it.x) * 0.0012 * dt; it.vy += (it.hy - it.y) * 0.0012 * dt;
        if (pt) {
          dx = it.x - pt.x; dy = it.y - pt.y; d = dx * dx + dy * dy;
          if (d < R2 && d > 1) { d = Math.sqrt(d); f = (1 - d / R) * (0.4 + pw * 2.4) * sp * dt; it.vx += dx / d * f; it.vy += dy / d * f; }
        }
        it.vx *= Math.pow(0.95, dt); it.vy *= Math.pow(0.95, dt);
      } else if (p.behavior === 'spring') {
        var kk = (0.012 + it.k * 0.03) * sp;
        it.vx += (it.hx - it.x) * kk * dt; it.vy += (it.hy - it.y) * kk * dt;
        if (pt) {
          dx = it.x - pt.x; dy = it.y - pt.y; d = dx * dx + dy * dy;
          if (d < R2 && d > 1) { d = Math.sqrt(d); f = (1 - d / R) * (0.8 + pw * 4) * sp * dt; it.vx += dx / d * f; it.vy += dy / d * f; }
        }
        it.vx *= Math.pow(0.9, dt); it.vy *= Math.pow(0.9, dt);
      } else { // gravity
        it.vy += (0.08 + pw * 0.22) * sp * dt;
        if (pt) {
          dx = it.x - pt.x; dy = it.y - pt.y; d = dx * dx + dy * dy;
          if (d < R2 && d > 1) { d = Math.sqrt(d); f = (1 - d / R) * (0.6 + pw * 2.2) * sp * dt; it.vx += dx / d * f; it.vy += dy / d * f; }
        }
        it.vx *= Math.pow(0.995, dt);
      }
      var s = p.behavior === 'orbit' ? 1 : sp;
      it.x += it.vx * s * dt; it.y += it.vy * s * dt;
      if (p.behavior === 'gravity') {
        var m = p.size * 0.6;
        if (it.y > H - m) { it.y = H - m; it.vy *= -0.72; it.vx *= 0.96; if (Math.abs(it.vy) < 0.4) it.vy = 0; }
        if (it.y < m) { it.y = m; it.vy = Math.abs(it.vy) * 0.6; }
        if (it.x < m) { it.x = m; it.vx = Math.abs(it.vx) * 0.8; }
        if (it.x > W - m) { it.x = W - m; it.vx = -Math.abs(it.vx) * 0.8; }
      } else if (p.behavior !== 'spring') {
        if (it.x < 0) { it.x = 0; it.vx = Math.abs(it.vx); } else if (it.x > W) { it.x = W; it.vx = -Math.abs(it.vx); }
        if (it.y < 0) { it.y = 0; it.vy = Math.abs(it.vy); } else if (it.y > H) { it.y = H; it.vy = -Math.abs(it.vy); }
      }
    }
    this.t += dt;
    return pt;
  };

  function starPath(ctx, r) {
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      var x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  /** 現在の状態を描く（論理座標 LW×LH） */
  MotionSim.prototype.draw = function (ctx, pt) {
    var p = this.p, items = this.items, i, it;
    if (p.trail > 0) {
      ctx.globalAlpha = 1 - (p.trail / 100) * 0.94;
      ctx.fillStyle = p.bg; ctx.fillRect(0, 0, Core.LW, Core.LH);
      ctx.globalAlpha = 1;
    } else { ctx.fillStyle = p.bg; ctx.fillRect(0, 0, Core.LW, Core.LH); }
    var r = p.size;
    ctx.lineCap = 'round';
    for (i = 0; i < items.length; i++) {
      it = items[i];
      var rot = p.spin ? Math.atan2(it.vy, it.vx) + Math.PI / 2 : it.rot;
      var col = p.colors[it.ci % p.colors.length];
      var sz = r * (0.6 + it.k * 0.7);
      ctx.fillStyle = col; ctx.strokeStyle = col;
      if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(it.x, it.y, sz * 0.62, 0, TAU); ctx.fill(); continue; }
      ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(rot);
      ctx.beginPath();
      if (p.shape === 'square') ctx.rect(-sz / 2, -sz / 2, sz, sz);
      else if (p.shape === 'triangle') { ctx.moveTo(0, -sz * 0.62); ctx.lineTo(sz * 0.55, sz * 0.42); ctx.lineTo(-sz * 0.55, sz * 0.42); ctx.closePath(); }
      else if (p.shape === 'star') starPath(ctx, sz * 0.62);
      if (p.shape === 'line') { ctx.lineWidth = Math.max(1.5, sz * 0.14); ctx.moveTo(0, -sz * 0.8); ctx.lineTo(0, sz * 0.8); ctx.stroke(); }
      else ctx.fill();
      ctx.restore();
    }
    if (pt) {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 110 + (p.power / 100) * 170, 0, TAU); ctx.stroke();
    }
  };
  Motion.Sim = MotionSim;

  Motion.render = function (ctx, w, h, p, steps) {
    p = Motion.normalize(p);
    ctx.save();
    ctx.fillStyle = p.bg; ctx.fillRect(0, 0, w, h);
    Core.cover(ctx, w, h, Core.LW, Core.LH);
    var q = Object.assign({}, p, { auto: true, count: Math.min(p.count, 90) });
    var sim = new MotionSim(q);
    var n = steps || 150;
    for (var i = 0; i < n; i++) { sim.step(null, 1); sim.draw(ctx, null); }
    ctx.restore();
  };

  /* ========== 既存の実験（Particle Lab / Shape Machine）用の静的描画 ========== */
  PZ.labs.particles = PZ.labs.particles || {};
  /** Particle Lab の見た目を、設定から静的に再現する（サムネイル・プレビュー用） */
  PZ.labs.particles.render = function (ctx, w, h, p) {
    var pal = {
      gradient: ['#b8ff3d', '#a066ff'], lime: ['#b8ff3d', '#8fd11f', '#e3ffa6'], violet: ['#a066ff', '#7c3aed', '#d3b8ff'],
      neon: ['#b8ff3d', '#a066ff', '#3de0ff', '#ff5d9e'], sunset: ['#ff5d9e', '#ffb13d', '#ff7a45'], mono: ['#f2f4f8', '#8f98a6']
    };
    p = p || {};
    var cols = p.palette === 'custom' ? [U.normHex(p.custom, '#b8ff3d')] : (pal[p.palette] || pal.gradient);
    var ramp = (p.palette || 'gradient') === 'gradient';
    var n = Math.min(Math.round(Core.num(p.count, 10, 1500, 300) / 2), 260);
    var size = Core.num(p.size, 1, 10, 3);
    var rnd = Core.rndFrom(U.hash32(p.palette, p.count, p.mouse, p.trail, p.speed));
    ctx.fillStyle = '#101215'; ctx.fillRect(0, 0, w, h);
    for (var i = 0; i < n; i++) {
      var t = rnd(), x = rnd() * w, y = rnd() * h, k = rnd();
      var c = ramp ? U.mixHex(cols[0], cols[1], t) : cols[Math.floor(k * cols.length) % cols.length];
      if (p.trail > 40) { ctx.strokeStyle = c; ctx.globalAlpha = 0.25; ctx.lineWidth = size * 0.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 18 - rnd() * 20, y - 6 + rnd() * 12); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, size * (0.6 + k * 0.7), 0, TAU); ctx.fill();
    }
  };
  PZ.labs.particles.random = function (rnd) {
    var pals = ['gradient', 'lime', 'violet', 'neon', 'sunset', 'mono'], mouse = ['attract', 'repel', 'swirl', 'none'];
    return {
      count: 100 + Math.floor(rnd() * 700), speed: 30 + Math.floor(rnd() * 150), size: 1 + Math.floor(rnd() * 5),
      palette: pals[Math.floor(rnd() * pals.length)], mouse: mouse[Math.floor(rnd() * mouse.length)],
      radius: 100 + Math.floor(rnd() * 200), trail: Math.floor(rnd() * 90), links: rnd() < 0.25
    };
  };
})();
