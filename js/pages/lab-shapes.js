/*
 * Shape Machine — 図形の自動生成。シード固定で再現でき、Studio へ引き継げる。
 * 生成ロジック(PZ.labs.shapes.generate)はUIから独立しているので、テストやホームの装飾にも使う。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.pages = PZ.pages || {};
  PZ.labs = PZ.labs || {};
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var M = PZ.model;
  var Kit = PZ.labKit;
  var Router = PZ.router;

  var W = 960, H = 600;
  var ALL_SHAPES = ['rect', 'ellipse', 'triangle', 'star'];

  var PALETTES = {
    neon: { label: 'ネオン', bg: '#15171b', colors: ['#b8ff3d', '#a066ff', '#f2f4f8', '#3de0ff', '#ff5d9e'] },
    lime: { label: 'ライム', bg: '#11150c', colors: ['#b8ff3d', '#8fd11f', '#d8ff8a', '#4f7310', '#f2ffd0'] },
    violet: { label: 'バイオレット', bg: '#150f2b', colors: ['#a066ff', '#7c3aed', '#c9a8ff', '#4c2a9e', '#f2e9ff'] },
    sunset: { label: 'サンセット', bg: '#1d1021', colors: ['#ff5d9e', '#ffb13d', '#ff7a45', '#a066ff', '#ffe3b3'] },
    mono: { label: 'モノ', bg: '#15171b', colors: ['#f2f4f8', '#c3cad6', '#8f98a6', '#5f6775', '#343a45'] },
    random: { label: 'ランダム', bg: null, colors: null }
  };
  var LAYOUTS = [
    { id: 'scatter', label: '散らす' }, { id: 'grid', label: '格子' }, { id: 'circle', label: '円環' },
    { id: 'spiral', label: '渦巻き' }, { id: 'burst', label: '放射' }
  ];
  var STYLES = [{ id: 'fill', label: '塗り' }, { id: 'outline', label: '線' }, { id: 'mixed', label: 'ミックス' }];

  var DEFAULTS = {
    seed: 1, count: 40, shapes: ALL_SHAPES.slice(), layout: 'scatter', palette: 'neon',
    style: 'mixed', min: 30, max: 140, rotate: true
  };

  function oneOf(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }

  /** 不正値を丸めて安全なパラメーターにする（URLクエリ・外部入力用） */
  function normalize(p) {
    var d = DEFAULTS;
    var shapes = (Array.isArray(p.shapes) ? p.shapes : String(p.shapes || '').split(','))
      .filter(function (s, i, a) { return ALL_SHAPES.indexOf(s) >= 0 && a.indexOf(s) === i; });
    var min = Kit.num(p.min, 8, 400, d.min);
    var max = Kit.num(p.max, 8, 500, d.max);
    if (max < min) max = min;
    return {
      seed: Math.floor(Kit.num(p.seed, 0, 999999, d.seed)),
      count: Math.floor(Kit.num(p.count, 1, 200, d.count)),
      shapes: shapes.length ? shapes : ALL_SHAPES.slice(),
      layout: oneOf(p.layout, LAYOUTS.map(function (l) { return l.id; }), d.layout),
      palette: oneOf(p.palette, Object.keys(PALETTES), d.palette),
      style: oneOf(p.style, STYLES.map(function (s) { return s.id; }), d.style),
      min: min, max: max,
      rotate: p.rotate === undefined ? d.rotate : (p.rotate === true || p.rotate === 1 || p.rotate === '1' || p.rotate === 'true')
    };
  }

  function parseQuery(q) {
    var out = {};
    ['seed', 'count', 'shapes', 'layout', 'palette', 'style', 'min', 'max', 'rotate'].forEach(function (k) {
      if (q[k] !== undefined) out[k] = q[k];
    });
    return normalize(Object.assign({}, DEFAULTS, out));
  }

  function toQuery(p) {
    return { seed: p.seed, count: p.count, shapes: p.shapes.join(','), layout: p.layout, palette: p.palette, style: p.style, min: p.min, max: p.max, rotate: p.rotate ? 1 : 0 };
  }

  /** 図形を生成して { width, height, background, objects } を返す（純粋関数） */
  function project(params) {
    var p = normalize(params);
    var rnd = U.mulberry32(p.seed * 7919 + 17);
    var pal = PALETTES[p.palette];
    var colors, bg;
    if (p.palette === 'random') {
      var hue = rnd() * 360;
      bg = U.hslToHex(hue, 30 + rnd() * 30, 8 + rnd() * 6);
      colors = [];
      for (var c = 0; c < 5; c++) colors.push(U.hslToHex((hue + c * (40 + rnd() * 50)) % 360, 60 + rnd() * 35, 50 + rnd() * 20));
    } else { colors = pal.colors; bg = pal.bg; }

    var n = p.count;
    var cols = Math.ceil(Math.sqrt(n * W / H));
    var rows = Math.ceil(n / cols);
    var cell = Math.min(W / cols, H / rows);
    var objects = [];

    for (var i = 0; i < n; i++) {
      var type = p.shapes[Math.floor(rnd() * p.shapes.length)];
      var size = p.min + rnd() * (p.max - p.min);
      var x, y, rot = p.rotate ? Math.floor(rnd() * 360) - 180 : 0;

      if (p.layout === 'grid') {
        size = Math.min(size, cell * 0.92);
        x = (i % cols + 0.5) * (W / cols); y = (Math.floor(i / cols) + 0.5) * (H / rows);
        if (rows * cols > n && Math.floor(i / cols) === rows - 1) x += (cols * (rows * cols - n) / (2 * cols)) * (W / cols) * 0; // 最終行は左詰め
      } else if (p.layout === 'circle') {
        var a = (i / n) * Math.PI * 2 - Math.PI / 2, r = Math.min(W, H) * 0.36;
        x = W / 2 + Math.cos(a) * r * (W / H > 1 ? 1.25 : 1); y = H / 2 + Math.sin(a) * r;
        if (p.rotate) rot = Math.round(a * 180 / Math.PI) + 90;
      } else if (p.layout === 'spiral') {
        var ang = i * 2.39996, rr = Math.sqrt((i + 0.5) / n) * Math.min(W, H) * 0.46;
        x = W / 2 + Math.cos(ang) * rr * 1.3; y = H / 2 + Math.sin(ang) * rr;
        size = p.min + (p.max - p.min) * (0.25 + 0.75 * (1 - i / n)) * (0.7 + rnd() * 0.3);
      } else if (p.layout === 'burst') {
        var ba = rnd() * Math.PI * 2, br = Math.pow(rnd(), 0.65) * Math.min(W, H) * 0.47;
        x = W / 2 + Math.cos(ba) * br * 1.35; y = H / 2 + Math.sin(ba) * br;
        if (p.rotate) rot = Math.round(ba * 180 / Math.PI) + 90;
        size = p.min + (p.max - p.min) * (0.3 + 0.7 * rnd()) * (0.5 + 0.5 * (br / (Math.min(W, H) * 0.47)));
      } else {
        x = rnd() * W; y = rnd() * H;
      }
      size = Math.max(8, size);

      var o = M.newObject(type, null, i);
      o.x = U.round(x, 1); o.y = U.round(y, 1);
      o.w = size; o.h = size;
      if (type === 'rect') { o.w = size * (0.8 + rnd() * 0.8); o.h = size * (0.6 + rnd() * 0.6); if (rnd() < 0.3) o.radius = Math.round(size * 0.2); }
      if (type === 'ellipse') { o.h = size * (0.65 + rnd() * 0.5); }
      o.w = U.round(o.w, 1); o.h = U.round(o.h, 1);
      o.rotation = rot;
      var col = colors[Math.floor(rnd() * colors.length)];
      var look = p.style === 'mixed' ? (rnd() < 0.6 ? 'fill' : (rnd() < 0.65 ? 'outline' : 'both')) : (p.style === 'outline' ? 'outline' : 'fill');
      o.opacity = U.round(0.72 + rnd() * 0.28, 2);
      if (look === 'fill') { o.fill = col; o.strokeWidth = 0; }
      else if (look === 'outline') { o.fill = null; o.stroke = col; o.strokeWidth = 3 + Math.round(rnd() * 4); o.opacity = 1; }
      else { o.fill = col; o.stroke = colors[(colors.indexOf(col) + 2) % colors.length]; o.strokeWidth = 3; }
      objects.push(o);
    }
    return { width: W, height: H, background: bg, objects: objects };
  }

  function randomParams() {
    var rnd = Math.random;
    var shapes = ALL_SHAPES.filter(function () { return rnd() < 0.6; });
    if (!shapes.length) shapes = [ALL_SHAPES[Math.floor(rnd() * ALL_SHAPES.length)]];
    var min = 16 + Math.floor(rnd() * 60);
    return normalize({
      seed: U.randomSeed(),
      count: 12 + Math.floor(rnd() * rnd() * 150),
      shapes: shapes,
      layout: LAYOUTS[Math.floor(rnd() * LAYOUTS.length)].id,
      palette: Object.keys(PALETTES)[Math.floor(rnd() * 6)],
      style: STYLES[Math.floor(rnd() * 3)].id,
      min: min, max: min + 30 + Math.floor(rnd() * 170),
      rotate: rnd() < 0.7
    });
  }

  PZ.labs.shapes = {
    defaults: DEFAULTS, normalize: normalize, parseQuery: parseQuery, toQuery: toQuery, project: project,
    generate: function (p) { return project(p).objects; }, randomParams: randomParams, PALETTES: PALETTES,
    /** 静的描画（ライブラリのプレビュー・作品サムネイル・画像書き出し用） */
    render: function (ctx, w, h, params) {
      var pr = project(params);
      var s = Math.max(w / pr.width, h / pr.height);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      ctx.fillStyle = pr.background; ctx.fillRect(0, 0, w, h);
      ctx.translate((w - pr.width * s) / 2, (h - pr.height * s) / 2); ctx.scale(s, s);
      PZ.render.drawProject(ctx, pr);
      ctx.restore();
    },
    random: function (rnd) {
      var shapes = ALL_SHAPES.filter(function () { return rnd() < 0.6; });
      if (!shapes.length) shapes = [ALL_SHAPES[Math.floor(rnd() * ALL_SHAPES.length)]];
      var min = 16 + Math.floor(rnd() * 60);
      return normalize({ seed: Math.floor(rnd() * 1000000), count: 12 + Math.floor(rnd() * rnd() * 150), shapes: shapes,
        layout: LAYOUTS[Math.floor(rnd() * LAYOUTS.length)].id, palette: Object.keys(PALETTES)[Math.floor(rnd() * 6)],
        style: STYLES[Math.floor(rnd() * 3)].id, min: min, max: min + 30 + Math.floor(rnd() * 170), rotate: rnd() < 0.7 });
    }
  };

  /* ---------- ページ ---------- */
  PZ.pages.shapes = {
    title: 'Shape Machine',
    nav: 'lab',
    mount: function (root, ctx) {
      var params = parseQuery(Kit.queryParams(ctx.query));
      var canvas = h('canvas', { role: 'img', 'aria-label': '生成された図形のプレビュー。クリックで別のシードに切り替わります。', style: { cursor: 'pointer' } });
      var info = h('b', null, '');
      var stageBar = h('div', { class: 'lab-stage-bar' }, h('span', null, 'SHAPE MACHINE'), h('span', { 'aria-live': 'polite' }, info));
      var stageEl = h('div', { class: 'lab-stage' }, canvas, stageBar);
      var current = null;

      function draw() {
        current = project(params);
        var w = stageEl.clientWidth || 600;
        PZ.render.drawThumb(canvas, current, w, 99999);
        info.textContent = 'SEED ' + params.seed + ' · ' + current.objects.length + ' OBJECTS';
      }
      var redraw = U.rafThrottle(draw);

      var controls = [];
      function add(c) { controls.push(c); return c.el; }
      function syncAll() { controls.forEach(function (c) { c.sync(); }); seedInput.value = params.seed; }
      function update(patch) { Object.assign(params, patch); params = normalize(params); syncAll(); redraw(); }

      var seedInput = h('input', { class: 'input mono', type: 'number', min: 0, max: 999999, 'aria-label': 'シード値' });
      seedInput.addEventListener('input', function () { var v = parseInt(seedInput.value, 10); if (isFinite(v)) { params.seed = U.clamp(v, 0, 999999); redraw(); } });
      seedInput.addEventListener('change', function () { syncAll(); });

      function reroll() { update({ seed: U.randomSeed() }); }
      canvas.addEventListener('click', reroll);

      function toStudio() {
        var p = current || project(params);
        PZ.projects.create('Shape Machine #' + params.seed, { width: p.width, height: p.height, background: p.background, objects: U.clone(p.objects) })
          .then(function (np) {
            UI.toast('Studioに引き継ぎました。ここから作品づくりを続けられます。', { type: 'ok' });
            Router.go('/studio/' + encodeURIComponent(np.id));
          })
          .catch(function (e) { UI.toast('引き継げませんでした: ' + (e && e.message), { type: 'error' }); });
      }

      var panel = h('div', { class: 'card lab-panel' },
        Kit.title('Controls', 'SHAPE MACHINE'),
        h('div', { class: 'lab-buttons' },
          UI.button('再生成', { icon: 'dice', kind: 'ghost', onclick: reroll }),
          UI.button('ランダム設定', { icon: 'shapes', kind: 'ghost', onclick: function () { params = randomParams(); syncAll(); redraw(); } }),
          h('div', { class: 'full' }, UI.button('Studioで開く', { icon: 'studio', kind: 'primary', class: 'btn-lg', onclick: toStudio }))),
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'シード', h('output', null, '同じ値なら同じ結果')), seedInput),
        add(Kit.range('数', { min: 1, max: 200, step: 1, get: function () { return params.count; }, set: function (v) { update({ count: v }); }, fmt: function (v) { return v + ' 個'; } })),
        add(Kit.chips('図形', [{ id: 'rect', label: '四角', icon: 'rect' }, { id: 'ellipse', label: '円', icon: 'ellipse' }, { id: 'triangle', label: '三角', icon: 'triangle' }, { id: 'star', label: '星', icon: 'star' }], {
          isOn: function (id) { return params.shapes.indexOf(id) >= 0; },
          toggle: function (id) {
            var s = params.shapes.slice(), i = s.indexOf(id);
            if (i >= 0) { if (s.length === 1) { UI.toast('図形は1種類以上選んでください', { type: 'warn', duration: 1600 }); return; } s.splice(i, 1); } else s.push(id);
            update({ shapes: s });
          }
        })),
        add(Kit.chips('配置', LAYOUTS, { isOn: function (id) { return params.layout === id; }, toggle: function (id) { update({ layout: id }); } })),
        add(Kit.chips('パレット', Object.keys(PALETTES).map(function (k) { return { id: k, label: PALETTES[k].label }; }), { isOn: function (id) { return params.palette === id; }, toggle: function (id) { update({ palette: id }); } })),
        add(Kit.seg('スタイル', STYLES, { get: function () { return params.style; }, set: function (v) { update({ style: v }); } })),
        h('div', { class: 'field-row' },
          add(Kit.range('最小サイズ', { min: 8, max: 300, step: 2, get: function () { return params.min; }, set: function (v) { update({ min: v }); }, fmt: function (v) { return v + 'px'; } })),
          add(Kit.range('最大サイズ', { min: 8, max: 400, step: 2, get: function () { return params.max; }, set: function (v) { update({ max: Math.max(v, params.min) }); }, fmt: function (v) { return v + 'px'; } }))),
        add(Kit.check('ランダムに回転させる', { get: function () { return params.rotate; }, set: function (v) { update({ rotate: v }); } })),
        UI.button('この設定のリンクをコピー', { icon: 'link', kind: 'ghost', small: true, onclick: function () { Kit.copyLink('/lab/shapes', toQuery(params)); } }));

      /* ---- 作品として保存・再開 ---- */
      var wk = PZ.workKit.attach(ctx, {
        tool: 'shapes', label: 'Shape Machine',
        getParams: function () { return U.clone(params); },
        setParams: function (p) { params = normalize(p); syncAll(); redraw(); },
        defaultName: function () { return 'Shape Machine #' + params.seed; },
        getCanvas: function () { return canvas; }
      });
      var baseSync = syncAll;
      syncAll = function () { baseSync(); wk.changed(); };

      root.appendChild(h('div', { class: 'container', style: { paddingBottom: '8px' } },
        Kit.pageHead('shapes', ['Shape ', h('em', null, 'Machine')], '図形を自動生成して、構図を探す機械。キャンバスをクリックすると別の組み合わせに。気に入ったらStudioに連れていこう。'),
        h('div', { class: 'lab-layout' },
          h('div', { class: 'lab-main' }, stageEl, Kit.howto('shapes')),
          h('div', { class: 'lab-side' }, panel, wk.el))));

      syncAll();
      wk.start();
      requestAnimationFrame(draw);
      var ro = window.ResizeObserver ? new ResizeObserver(U.debounce(draw, 80)) : null;
      if (ro) ro.observe(stageEl);

      return function destroy() { if (ro) ro.disconnect(); wk.destroy(); };
    }
  };
})();
