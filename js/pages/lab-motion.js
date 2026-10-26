/*
 * Motion Playground — ポインタ（マウス・タッチ）に反応して動く図形。ロジックは labs-core.js（PZ.labs.motion）
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.pages = PZ.pages || {};
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Kit = PZ.labKit;
  var Core = PZ.labsCore;
  var L = PZ.labs.motion;

  PZ.pages.motion = {
    title: 'Motion Playground',
    nav: 'lab',
    mount: function (root, ctx) {
      var params = L.normalize(Object.assign({}, L.defaults, Kit.queryParams(ctx.query)));
      var stage = Kit.stage('MOTION PLAYGROUND', { role: 'img', width: Core.LW, height: Core.LH, 'aria-label': 'ポインタに反応して動く図形。マウスや指で触れると動きが変わります。スペースキーで一時停止できます。' });
      stage.el.tabIndex = 0;
      var canvas = stage.canvas, g = canvas.getContext('2d');
      canvas.style.touchAction = 'none'; // 指で触って動かすため、ステージ上ではスクロールしない
      canvas.style.cursor = 'crosshair';
      var cap = U.isSmallScreen() ? L.MOBILE_MAX : L.MAX_COUNT;
      var sim = new L.Sim(params);
      sim.setLimit(cap);
      var alive = true, raf = 0, last = 0, frames = 0;
      var pointer = { x: 0, y: 0, active: false };
      var reduced = U.prefersReducedMotion();
      var note = h('span', { class: 'perf-note', hidden: true });
      var guard = Kit.perfGuard(function () {
        var n = Math.max(20, Math.floor(sim.limit * 0.72));
        sim.setLimit(n);
        note.hidden = false; note.textContent = '処理が重いため、図形の数を ' + n + ' 個に自動調整しました';
      });
      var pause = Kit.pauseButton(function () { paintInfo(); });

      function paintInfo() {
        var b = L.BEHAVIORS.filter(function (x) { return x.id === params.behavior; })[0];
        stage.info.textContent = (b ? b.label : params.behavior).toUpperCase() + ' · ' + sim.items.length + ' ITEMS · ' + (pause.get() ? 'PAUSED' : (pointer.active ? 'TOUCH' : (params.auto ? 'AUTO' : 'IDLE')));
      }
      function clearCanvas() { g.globalAlpha = 1; g.fillStyle = params.bg; g.fillRect(0, 0, Core.LW, Core.LH); }
      clearCanvas();

      var lastFrame = 0;
      function frame(t) {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        if (document.hidden || pause.get()) { lastFrame = 0; return; }
        if (lastFrame && t - lastFrame < 250) guard.tick(t - lastFrame);
        lastFrame = t;
        if (t - last < 10) return;
        last = t;
        var pt = sim.step(pointer, 1);
        sim.draw(g, pt);
        if (++frames % 20 === 0) paintInfo();
      }

      /* ---- ポインタ ---- */
      function setPointer(e) {
        var r = canvas.getBoundingClientRect();
        pointer.x = (e.clientX - r.left) * Core.LW / r.width;
        pointer.y = (e.clientY - r.top) * Core.LH / r.height;
        pointer.active = true;
      }
      canvas.addEventListener('pointermove', setPointer);
      canvas.addEventListener('pointerdown', function (e) {
        setPointer(e);
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
        sim.impulse(pointer.x, pointer.y); // クリック／タップで衝撃
        if (pause.get()) { sim.draw(g, pointer); }
      });
      canvas.addEventListener('pointerleave', function () { pointer.active = false; });
      canvas.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') pointer.active = false; });
      canvas.addEventListener('pointercancel', function () { pointer.active = false; });

      /* ---- 更新 ---- */
      var controls = [];
      function add(c) { controls.push(c); return c.el; }
      function sync() { controls.forEach(function (c) { c.sync(); }); paintInfo(); wk.changed(); }
      function apply(next) {
        var prev = params;
        params = L.normalize(next);
        var restarted = sim.setParams(params);
        sim.limit = Math.min(cap, params.count); sim.fill();
        if (restarted || params.bg !== prev.bg) clearCanvas();
        if (pause.get()) sim.draw(g, null);
        sync();
      }
      function update(patch) { apply(Object.assign({}, params, patch)); }
      function restart() { sim.reset(params); sim.setLimit(cap); clearCanvas(); pause.set(false); sync(); }
      function resetAll() { params = L.normalize(L.defaults); sim.reset(params); sim.setLimit(cap); clearCanvas(); pause.set(false); sync(); UI.toast('初期状態に戻しました', { type: 'info', duration: 1500 }); }
      function randomize() { params = L.random(Math.random); sim.reset(params); sim.setLimit(cap); clearCanvas(); pause.set(false); sync(); }

      var wk = PZ.workKit.attach(ctx, {
        tool: 'motion', label: 'Motion Playground',
        getParams: function () { return U.clone(params); },
        setParams: function (p) { params = L.normalize(p); sim.reset(params); sim.setLimit(cap); clearCanvas(); pause.set(false); sync(); },
        defaultName: function () { var b = L.BEHAVIORS.filter(function (x) { return x.id === params.behavior; })[0]; return 'Motion ' + (b ? b.label : '') + ' #' + params.seed; },
        getCanvas: function () { return canvas; }
      });

      var panel = h('div', { class: 'card lab-panel' },
        Kit.title('Controls', 'MOTION'),
        h('div', { class: 'lab-buttons' },
          pause.el,
          UI.button('最初から', { icon: 'reset', kind: 'ghost', title: '同じ設定で動きをやり直す', onclick: restart }),
          UI.button('ランダム生成', { icon: 'dice', kind: 'primary', onclick: randomize }),
          UI.button('初期状態へ', { icon: 'reset', kind: 'ghost', title: 'すべての設定を初期値に戻す', onclick: resetAll })),
        add(Kit.chips('動き方', L.BEHAVIORS, { isOn: function (id) { return params.behavior === id; }, toggle: function (id) { update({ behavior: id }); } })),
        add(Kit.chips('図形', L.SHAPES, { isOn: function (id) { return params.shape === id; }, toggle: function (id) { update({ shape: id }); } })),
        add(Kit.seed('シード', { get: function () { return params.seed; }, set: function (v) { update({ seed: v }); } })),
        add(Kit.range('数', { min: 5, max: L.MAX_COUNT, step: 5, get: function () { return params.count; }, set: function (v) { update({ count: v }); }, fmt: function (v) { return v + ' 個' + (v > cap ? '（上限' + cap + '）' : ''); } })),
        add(Kit.range('速さ', { min: 10, max: 300, step: 5, get: function () { return params.speed; }, set: function (v) { update({ speed: v }); }, fmt: function (v) { return v + '%'; } })),
        add(Kit.range('反応の強さ', { min: 0, max: 100, step: 1, get: function () { return params.power; }, set: function (v) { update({ power: v }); }, fmt: function (v) { return v + '%'; } })),
        add(Kit.range('図形の大きさ', { min: 4, max: 60, step: 1, get: function () { return params.size; }, set: function (v) { update({ size: v }); }, fmt: function (v) { return v + 'px'; } })),
        add(Kit.range('残像', { min: 0, max: 95, step: 1, get: function () { return params.trail; }, set: function (v) { update({ trail: v }); }, fmt: function (v) { return v + '%'; } })),
        add(Kit.check('何も触らないときは自動で動かす', { get: function () { return params.auto; }, set: function (v) { update({ auto: v }); } })),
        add(Kit.check('進む向きに合わせて回転', { get: function () { return params.spin; }, set: function (v) { update({ spin: v }); } })),
        add(Kit.palette('色', { max: 6, get: function () { return { colors: params.colors, bg: params.bg }; }, set: function (colors, bg) { update({ colors: colors, bg: bg }); } })),
        UI.button('この設定のリンクをコピー', { icon: 'link', kind: 'ghost', small: true, onclick: function () { Kit.copyLink('/lab/motion', Kit.toQuery(params)); } }));

      root.appendChild(h('div', { class: 'container', style: { paddingBottom: '8px' } },
        Kit.pageHead('motion', ['Motion ', h('em', null, 'Playground')], 'カーソルや指に反応して動く図形の遊び場。動き方を切り替えて、触れるたびに変わる景色を探そう。'),
        h('div', { class: 'lab-layout' },
          h('div', { class: 'lab-main' }, stage.el, h('div', { class: 'perf-row' }, note), Kit.howto('motion')),
          h('div', { class: 'lab-side' }, panel, wk.el))));

      var offSpace = Kit.onSpace(canvas, function () { pause.toggle(); });
      stage.el.addEventListener('keydown', function (e) { if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); pause.toggle(); } });

      sync();
      wk.start().then(function () {
        if (!alive) return;
        if (reduced) { // 動きを抑える設定: 少し進めた静止画にして止める
          sim.reset(params); sim.setLimit(cap); clearCanvas();
          for (var i = 0; i < 90; i++) { sim.step(null, 1); sim.draw(g, null); }
          pause.set(true); paintInfo();
        }
      });
      raf = requestAnimationFrame(frame);

      return function destroy() { alive = false; cancelAnimationFrame(raf); offSpace(); wk.destroy(); };
    }
  };
})();
