/*
 * Particle Lab — 動く粒子。数・速度・色の調整、マウス反応、一時停止/再開/リセット。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.pages = PZ.pages || {};
  PZ.labs = PZ.labs || {};
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Kit = PZ.labKit;

  var PALETTES = {
    gradient: { label: 'ライム→紫', colors: ['#b8ff3d', '#a066ff'], ramp: true },
    lime: { label: 'ライム', colors: ['#b8ff3d', '#8fd11f', '#e3ffa6'] },
    violet: { label: 'バイオレット', colors: ['#a066ff', '#7c3aed', '#d3b8ff'] },
    neon: { label: 'ネオン', colors: ['#b8ff3d', '#a066ff', '#3de0ff', '#ff5d9e'] },
    sunset: { label: 'サンセット', colors: ['#ff5d9e', '#ffb13d', '#ff7a45'] },
    mono: { label: 'モノ', colors: ['#f2f4f8', '#8f98a6'] }
  };
  var MOUSE = [{ id: 'attract', label: '引き寄せる' }, { id: 'repel', label: '弾く' }, { id: 'swirl', label: '渦' }, { id: 'none', label: 'なし' }];

  var DEFAULTS = { count: 300, speed: 60, size: 3, palette: 'gradient', mouse: 'attract', radius: 160, trail: 55, links: false, custom: '#b8ff3d' };

  function normalize(p) {
    var d = DEFAULTS;
    return {
      count: Math.floor(Kit.num(p.count, 10, 1500, d.count)),
      speed: Kit.num(p.speed, 0, 300, d.speed),
      size: Kit.num(p.size, 1, 10, d.size),
      palette: PALETTES[p.palette] || p.palette === 'custom' ? p.palette : d.palette,
      mouse: MOUSE.some(function (m) { return m.id === p.mouse; }) ? p.mouse : d.mouse,
      radius: Kit.num(p.radius, 40, 400, d.radius),
      trail: Kit.num(p.trail, 0, 95, d.trail),
      links: p.links === true || p.links === 1 || p.links === '1' || p.links === 'true',
      custom: U.normHex(p.custom, d.custom)
    };
  }
  PZ.labs.particles = Object.assign(PZ.labs.particles || {}, { defaults: DEFAULTS, normalize: normalize });

  function paletteColors(p) {
    if (p.palette === 'custom') return [p.custom];
    return PALETTES[p.palette].colors;
  }

  /** シミュレーション本体（描画とは独立。論理サイズ w,h の中で動く） */
  function Sim() {
    this.parts = [];
    this.w = 800; this.h = 500;
    this.mouse = { x: 0, y: 0, active: false };
  }
  Sim.prototype.reset = function (p) {
    this.parts = [];
    this.fill(p);
  };
  Sim.prototype.fill = function (p) {
    var cols = paletteColors(p);
    var ramp = p.palette === 'gradient';
    while (this.parts.length < p.count) {
      var t = Math.random();
      var ang = Math.random() * Math.PI * 2;
      var sp = 0.4 + Math.random() * 0.9;
      this.parts.push({
        x: Math.random() * this.w, y: Math.random() * this.h,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        k: Math.random(), t: t,
        c: ramp ? U.mixHex(cols[0], cols[1], t) : cols[Math.floor(Math.random() * cols.length)]
      });
    }
    if (this.parts.length > p.count) this.parts.length = p.count;
  };
  Sim.prototype.recolor = function (p) {
    var cols = paletteColors(p), ramp = p.palette === 'gradient';
    this.parts.forEach(function (q) {
      q.c = ramp ? U.mixHex(cols[0], cols[1], q.t) : cols[Math.floor(q.k * cols.length) % cols.length];
    });
  };
  Sim.prototype.step = function (p, dt) {
    var w = this.w, hh = this.h, m = this.mouse;
    var sp = p.speed / 60;
    var R = p.radius, R2 = R * R;
    var useMouse = m.active && p.mouse !== 'none';
    for (var i = 0; i < this.parts.length; i++) {
      var q = this.parts[i];
      if (useMouse) {
        var dx = m.x - q.x, dy = m.y - q.y, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 1) {
          var d = Math.sqrt(d2), f = (1 - d / R) * 0.9 * dt * 60;
          if (p.mouse === 'attract') { q.vx += dx / d * f * 0.5; q.vy += dy / d * f * 0.5; }
          else if (p.mouse === 'repel') { q.vx -= dx / d * f * 1.4; q.vy -= dy / d * f * 1.4; }
          else { q.vx += (-dy / d) * f * 0.9 + dx / d * f * 0.12; q.vy += (dx / d) * f * 0.9 + dy / d * f * 0.12; }
        }
      }
      // 速度を目標スピードへ緩やかに戻す
      var v = Math.sqrt(q.vx * q.vx + q.vy * q.vy) || 0.001;
      var target = (0.5 + q.k * 0.8) * sp;
      var nv = v + (target - v) * 0.04;
      if (sp === 0) nv = v * 0.9;
      q.vx *= nv / v; q.vy *= nv / v;
      q.x += q.vx * dt * 60; q.y += q.vy * dt * 60;
      if (q.x < 0) { q.x = 0; q.vx = Math.abs(q.vx); } else if (q.x > w) { q.x = w; q.vx = -Math.abs(q.vx); }
      if (q.y < 0) { q.y = 0; q.vy = Math.abs(q.vy); } else if (q.y > hh) { q.y = hh; q.vy = -Math.abs(q.vy); }
    }
  };
  PZ.labs.ParticleSim = Sim;

  PZ.pages.particles = {
    title: 'Particle Lab',
    nav: 'lab',
    mount: function (root, ctx) {
      var params = normalize(Object.assign({}, DEFAULTS, Kit.queryParams(ctx.query)));
      var sim = new Sim();
      var canvas = h('canvas', { role: 'img', 'aria-label': '動く粒子のシミュレーション。マウスやタッチに反応します。' });
      var info = h('b', null, '');
      var stageEl = h('div', { class: 'lab-stage' }, canvas,
        h('div', { class: 'lab-stage-bar' }, h('span', null, 'PARTICLE LAB'), h('span', { 'aria-live': 'off' }, info)));
      var ctx2 = canvas.getContext('2d');
      var paused = false, alive = true, raf = 0, last = 0, fps = 60, cssW = 0, cssH = 0, dpr = 1;
      var reduced = U.prefersReducedMotion();

      function resize() {
        var w = Math.max(280, stageEl.clientWidth);
        var hh = Math.round(Math.min(Math.max(w * 0.62, 300), 620));
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
        canvas.style.height = hh + 'px';
        cssW = w; cssH = hh;
        ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2.fillStyle = '#101215'; ctx2.fillRect(0, 0, w, hh);
        var ow = sim.w, oh = sim.h;
        sim.w = w; sim.h = hh;
        sim.parts.forEach(function (q) { q.x = q.x / ow * w; q.y = q.y / oh * hh; });
      }

      function draw() {
        var fade = params.trail / 100;
        ctx2.globalCompositeOperation = 'source-over';
        ctx2.fillStyle = 'rgba(16,18,21,' + (1 - fade * 0.93).toFixed(3) + ')';
        ctx2.fillRect(0, 0, cssW, cssH);
        var s = params.size, parts = sim.parts, i, q;
        if (params.links) {
          ctx2.lineWidth = 1;
          var L = 70, L2 = L * L, n = Math.min(parts.length, 260);
          for (i = 0; i < n; i++) {
            for (var j = i + 1; j < n; j++) {
              var dx = parts[i].x - parts[j].x, dy = parts[i].y - parts[j].y, d2 = dx * dx + dy * dy;
              if (d2 < L2) {
                ctx2.strokeStyle = parts[i].c;
                ctx2.globalAlpha = (1 - d2 / L2) * 0.55;
                ctx2.beginPath(); ctx2.moveTo(parts[i].x, parts[i].y); ctx2.lineTo(parts[j].x, parts[j].y); ctx2.stroke();
              }
            }
          }
          ctx2.globalAlpha = 1;
        }
        for (i = 0; i < parts.length; i++) {
          q = parts[i];
          ctx2.fillStyle = q.c;
          ctx2.beginPath(); ctx2.arc(q.x, q.y, s * (0.6 + q.k * 0.7), 0, 6.2832); ctx2.fill();
        }
        if (sim.mouse.active && params.mouse !== 'none') {
          ctx2.strokeStyle = 'rgba(255,255,255,0.18)'; ctx2.lineWidth = 1;
          ctx2.beginPath(); ctx2.arc(sim.mouse.x, sim.mouse.y, params.radius, 0, 6.2832); ctx2.stroke();
        }
      }

      function frame(t) {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        if (document.hidden) { last = t; return; }
        var dt = Math.min(0.05, (t - last) / 1000 || 0.016);
        last = t;
        fps += (1 / Math.max(dt, 0.001) - fps) * 0.05;
        if (!paused) sim.step(params, dt);
        draw();
        info.textContent = (paused ? 'PAUSED' : 'RUNNING') + ' · ' + sim.parts.length + ' PARTICLES · ' + Math.round(fps) + ' FPS';
      }

      /* ---- ポインタ ---- */
      function setMouse(e) {
        var r = canvas.getBoundingClientRect();
        sim.mouse.x = (e.clientX - r.left) * cssW / r.width;
        sim.mouse.y = (e.clientY - r.top) * cssH / r.height;
        sim.mouse.active = true;
      }
      canvas.style.touchAction = 'pan-y'; // 縦スクロールは許可しつつ、タッチ中は反応させる
      canvas.addEventListener('pointermove', setMouse);
      canvas.addEventListener('pointerdown', function (e) { setMouse(e); });
      canvas.addEventListener('pointerleave', function () { sim.mouse.active = false; });
      canvas.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') sim.mouse.active = false; });
      canvas.addEventListener('pointercancel', function () { sim.mouse.active = false; });

      /* ---- コントロール ---- */
      var controls = [];
      function add(c) { controls.push(c); return c.el; }
      function sync() { controls.forEach(function (c) { c.sync(); }); }
      function update(patch, opts) {
        var prev = params;
        params = normalize(Object.assign({}, params, patch));
        if (params.count !== prev.count) sim.fill(params);
        if (params.palette !== prev.palette || params.custom !== prev.custom) sim.recolor(params);
        sync();
        if (reduced || paused) draw();
      }

      var pauseBtn = UI.button('一時停止', { icon: 'pause', kind: 'ghost', onclick: togglePause });
      function togglePause() {
        paused = !paused;
        U.clear(pauseBtn);
        pauseBtn.appendChild(UI.icon(paused ? 'play' : 'pause'));
        pauseBtn.appendChild(h('span', { class: 'btn-label' }, paused ? '再開' : '一時停止'));
        pauseBtn.setAttribute('aria-pressed', String(paused));
      }
      function resetAll() {
        params = normalize(DEFAULTS);
        sim.reset(params);
        ctx2.fillStyle = '#101215'; ctx2.fillRect(0, 0, cssW, cssH);
        sync();
      }

      var customInput = h('input', { type: 'color', 'aria-label': 'カスタム色' });
      customInput.addEventListener('input', function () { update({ palette: 'custom', custom: customInput.value }); });
      var customField = { el: h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'カスタム色'), customInput), sync: function () { customInput.value = params.custom; } };

      var palOptions = Object.keys(PALETTES).map(function (k) { return { id: k, label: PALETTES[k].label }; });

      var panel = h('div', { class: 'card lab-panel' },
        Kit.title('Controls', 'PARTICLE LAB'),
        h('div', { class: 'lab-buttons' },
          pauseBtn,
          UI.button('リセット', { icon: 'reset', kind: 'ghost', onclick: resetAll }),
          h('div', { class: 'full' }, UI.button('粒子を撒き直す', { icon: 'dice', kind: 'primary', onclick: function () { sim.reset(params); } }))),
        add(Kit.range('粒子の数', { min: 10, max: 1500, step: 10, get: function () { return params.count; }, set: function (v) { update({ count: v }); }, fmt: function (v) { return v + ' 個'; } })),
        add(Kit.range('速度', { min: 0, max: 300, step: 5, get: function () { return params.speed; }, set: function (v) { update({ speed: v }); }, fmt: function (v) { return v + '%'; } })),
        add(Kit.range('粒の大きさ', { min: 1, max: 10, step: 0.5, get: function () { return params.size; }, set: function (v) { update({ size: v }); }, fmt: function (v) { return v + 'px'; } })),
        add(Kit.chips('色', palOptions, { isOn: function (id) { return params.palette === id; }, toggle: function (id) { update({ palette: id }); } })),
        add(customField),
        add(Kit.seg('マウスへの反応', MOUSE, { get: function () { return params.mouse; }, set: function (v) { update({ mouse: v }); } })),
        add(Kit.range('反応する範囲', { min: 40, max: 400, step: 10, get: function () { return params.radius; }, set: function (v) { update({ radius: v }); }, fmt: function (v) { return v + 'px'; } })),
        add(Kit.range('残像', { min: 0, max: 95, step: 1, get: function () { return params.trail; }, set: function (v) { update({ trail: v }); }, fmt: function (v) { return v + '%'; } })),
        add(Kit.check('近くの粒子を線でつなぐ', { get: function () { return params.links; }, set: function (v) { update({ links: v }); } })),
        UI.button('この設定のリンクをコピー', { icon: 'link', kind: 'ghost', small: true, onclick: function () {
          Kit.copyLink('/lab/particles', { count: params.count, speed: params.speed, size: params.size, palette: params.palette, custom: params.custom, mouse: params.mouse, radius: params.radius, trail: params.trail, links: params.links ? 1 : 0 });
        } }));

      /* ---- 作品として保存・再開 ---- */
      var wk = PZ.workKit.attach(ctx, {
        tool: 'particles', label: 'Particle Lab',
        getParams: function () { return U.clone(params); },
        setParams: function (p) { params = normalize(p); sim.reset(params); ctx2.fillStyle = '#101215'; ctx2.fillRect(0, 0, cssW, cssH); sync(); },
        defaultName: function () { return 'Particle Lab ' + params.palette + ' ' + params.count; },
        getCanvas: function () { return canvas; }
      });
      var origSync = sync;
      sync = function () { origSync(); wk.changed(); };

      root.appendChild(h('div', { class: 'container', style: { paddingBottom: '8px' } },
        Kit.pageHead('particles', ['Particle ', h('em', null, 'Lab')], '動く粒子の群れを観察する実験。カーソル（スマホは指）を動かして、粒子の反応を確かめよう。'),
        h('div', { class: 'lab-layout' },
          h('div', { class: 'lab-main' }, stageEl, Kit.howto('particles')),
          h('div', { class: 'lab-side' }, panel, wk.el))));
      wk.start();

      resize();
      sim.reset(params);
      sync();
      var ro = window.ResizeObserver ? new ResizeObserver(U.debounce(resize, 100)) : null;
      if (ro) ro.observe(stageEl);
      if (reduced) { paused = true; U.clear(pauseBtn); pauseBtn.appendChild(UI.icon('play')); pauseBtn.appendChild(h('span', { class: 'btn-label' }, '再開')); draw(); }
      raf = requestAnimationFrame(function (t) { last = t; frame(t); });

      return function destroy() { alive = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); wk.destroy(); };
    }
  };
})();
