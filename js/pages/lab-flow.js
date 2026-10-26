/*
 * Flow Field — 見えない流れに沿って粒子が線を描く。生成ロジックは labs-core.js（PZ.labs.flow）
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
  var L = PZ.labs.flow;

  PZ.pages.flow = {
    title: 'Flow Field',
    nav: 'lab',
    mount: function (root, ctx) {
      var params = L.normalize(Object.assign({}, L.defaults, Kit.queryParams(ctx.query)));
      var stage = Kit.stage('FLOW FIELD', { role: 'img', width: Core.LW, height: Core.LH, 'aria-label': '流れに沿って線を描く粒子のアニメーション。スペースキーで一時停止できます。' });
      stage.el.tabIndex = 0;
      var canvas = stage.canvas, g = canvas.getContext('2d');
      var sim = new L.Sim(params);
      var alive = true, raf = 0, lastStep = 0, step = 0;
      var cap = U.isSmallScreen() ? L.MOBILE_MAX : L.MAX_COUNT;
      sim.setLimit(cap);
      var reduced = U.prefersReducedMotion();
      var note = h('span', { class: 'perf-note', hidden: true });

      function clearCanvas() { g.globalAlpha = 1; g.fillStyle = params.bg; g.fillRect(0, 0, Core.LW, Core.LH); step = 0; }
      clearCanvas();

      var guard = Kit.perfGuard(function () {
        var n = Math.max(150, Math.floor(sim.limit * 0.72));
        sim.setLimit(n);
        note.hidden = false; note.textContent = '処理が重いため、線の数を ' + n + ' 本に自動調整しました';
      });

      var pause = Kit.pauseButton(function () { paintInfo(); });

      function paintInfo() {
        stage.info.textContent = 'SEED ' + params.seed + ' · ' + sim.parts.length + ' LINES · ' + (pause.get() ? 'PAUSED' : 'RUNNING');
      }

      var lastFrame = 0;
      function frame(t) {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        if (document.hidden || pause.get()) { lastFrame = 0; return; }
        if (lastFrame && t - lastFrame < 250) guard.tick(t - lastFrame);
        lastFrame = t;
        if (t - lastStep < 10) return; // 描画は最大60回/秒。高リフレッシュレートでも同じ速さにする
        lastStep = t;
        sim.step(g, 1);
        step++;
        if (step % 20 === 0) paintInfo();
      }

      /* ---- パラメータ更新 ---- */
      var controls = [];
      function add(c) { controls.push(c); return c.el; }
      function sync() { controls.forEach(function (c) { c.sync(); }); paintInfo(); wk.changed(); }

      function apply(next, opts) {
        var prev = params;
        params = L.normalize(next);
        var reseeded = sim.setParams(params);
        sim.limit = Math.min(cap, params.count); sim.fill();
        if (reseeded || params.bg !== prev.bg || (opts && opts.clear)) clearCanvas();
        sync();
      }
      function update(patch, opts) { apply(Object.assign({}, params, patch), opts); }

      function restart() { sim.reset(params); sim.setLimit(cap); clearCanvas(); if (pause.get()) pause.set(false); sync(); }
      function resetAll() { params = L.normalize(L.defaults); sim.reset(params); sim.setLimit(cap); clearCanvas(); pause.set(false); sync(); UI.toast('初期状態に戻しました', { type: 'info', duration: 1500 }); }
      function randomize() {
        params = L.random(Math.random);
        sim.reset(params); sim.setLimit(cap); clearCanvas(); pause.set(false); sync();
      }

      /* ---- 作品として保存・再開 ---- */
      var wk = PZ.workKit.attach(ctx, {
        tool: 'flow', label: 'Flow Field',
        getParams: function () { return U.clone(params); },
        setParams: function (p) { params = L.normalize(p); sim.reset(params); sim.setLimit(cap); clearCanvas(); pause.set(false); sync(); },
        defaultName: function () { return 'Flow Field #' + params.seed; },
        getCanvas: function () { return canvas; }
      });

      var rangeFmt = {
        deg: function (v) { return v + '°'; }, pct: function (v) { return v + '%'; }, px: function (v) { return v + 'px'; }
      };

      var panel = h('div', { class: 'card lab-panel' },
        Kit.title('Controls', 'FLOW FIELD'),
        h('div', { class: 'lab-buttons' },
          pause.el,
          UI.button('描き直す', { icon: 'reset', kind: 'ghost', title: '同じ設定で最初から描き直す', onclick: restart }),
          UI.button('ランダム生成', { icon: 'dice', kind: 'primary', onclick: randomize }),
          UI.button('初期状態へ', { icon: 'reset', kind: 'ghost', title: 'すべての設定を初期値に戻す', onclick: resetAll })),
        add(Kit.seed('シード', { get: function () { return params.seed; }, set: function (v) { update({ seed: v }); } })),
        add(Kit.seg('流れのタイプ', L.MODES, { get: function () { return params.mode; }, set: function (v) { update({ mode: v }); } })),
        add(Kit.range('流れの向き', { min: 0, max: 360, step: 5, get: function () { return params.angle; }, set: function (v) { update({ angle: v }); }, fmt: rangeFmt.deg })),
        add(Kit.range('流れの乱れ（強さ）', { min: 0, max: 100, step: 1, get: function () { return params.strength; }, set: function (v) { update({ strength: v }); }, fmt: rangeFmt.pct })),
        add(Kit.range('模様の細かさ', { min: 1, max: 100, step: 1, get: function () { return params.scale; }, set: function (v) { update({ scale: v }); } })),
        add(Kit.range('粒子の数', { min: 50, max: L.MAX_COUNT, step: 50, get: function () { return params.count; }, set: function (v) { update({ count: v }); }, fmt: function (v) { return v + '本' + (v > cap ? '（上限' + cap + '）' : ''); } })),
        add(Kit.range('速度', { min: 10, max: 300, step: 5, get: function () { return params.speed; }, set: function (v) { update({ speed: v }); }, fmt: rangeFmt.pct })),
        add(Kit.range('線の太さ', { min: 0.5, max: 4, step: 0.1, get: function () { return params.width; }, set: function (v) { update({ width: v }); }, fmt: rangeFmt.px })),
        add(Kit.range('線の消える速さ', { min: 0, max: 100, step: 1, get: function () { return params.fade; }, set: function (v) { update({ fade: v }); }, fmt: function (v) { return v === 0 ? '消えない' : v + '%'; } })),
        add(Kit.range('流れの時間変化', { min: 0, max: 100, step: 1, get: function () { return params.evolve; }, set: function (v) { update({ evolve: v }); }, fmt: function (v) { return v === 0 ? '固定' : v + '%'; } })),
        add(Kit.seg('色の付け方', L.COLOR_MODES, { get: function () { return params.colorMode; }, set: function (v) { update({ colorMode: v }); } })),
        add(Kit.palette('色', { max: 6, get: function () { return { colors: params.colors, bg: params.bg }; }, set: function (colors, bg) { update({ colors: colors, bg: bg }); } })),
        UI.button('この設定のリンクをコピー', { icon: 'link', kind: 'ghost', small: true, onclick: function () { Kit.copyLink('/lab/flow', Kit.toQuery(params)); } }));

      root.appendChild(h('div', { class: 'container', style: { paddingBottom: '8px' } },
        Kit.pageHead('flow', ['Flow ', h('em', null, 'Field')], '見えない風の流れに乗って、無数の粒子が線を描く。向きと乱れを動かして、模様の性格を育てよう。'),
        h('div', { class: 'lab-layout' },
          h('div', { class: 'lab-main' }, stage.el, h('div', { class: 'perf-row' }, note), Kit.howto('flow')),
          h('div', { class: 'lab-side' }, panel, wk.el))));

      var offSpace = Kit.onSpace(canvas, function () { pause.toggle(); });
      stage.el.addEventListener('keydown', function (e) { if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); pause.toggle(); } });

      sync();
      wk.start().then(function () {
        if (!alive) return;
        if (reduced) { // 動きを抑える設定: 静止画として描いて止める
          sim.reset(params); sim.setLimit(Math.min(cap, 700)); clearCanvas();
          for (var i = 0; i < 160; i++) sim.step(g, 1);
          pause.set(true); paintInfo();
        }
      });
      raf = requestAnimationFrame(frame);

      return function destroy() { alive = false; cancelAnimationFrame(raf); offSpace(); wk.destroy(); };
    }
  };
})();
