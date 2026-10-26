/*
 * Pattern Generator — 幾何学模様。生成ロジックは labs-core.js（PZ.labs.pattern）
 * 同じシード・同じ設定なら、いつでも同じ模様になる。
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
  var L = PZ.labs.pattern;

  PZ.pages.pattern = {
    title: 'Pattern Generator',
    nav: 'lab',
    mount: function (root, ctx) {
      var params = L.normalize(Object.assign({}, L.defaults, Kit.queryParams(ctx.query)));
      var stage = Kit.stage('PATTERN GENERATOR', { role: 'img', width: Core.LW, height: Core.LH, 'aria-label': '生成された幾何学模様' });
      stage.el.classList.add('is-click');
      var canvas = stage.canvas, g = canvas.getContext('2d');
      var alive = true;

      var draw = U.rafThrottle(function () {
        if (!alive) return;
        g.setTransform(1, 0, 0, 1, 0, 0);
        L.render(g, Core.LW, Core.LH, params);
        var t = L.TYPES.filter(function (x) { return x.id === params.type; })[0];
        stage.info.textContent = (t ? t.label : params.type).toUpperCase() + ' · SEED ' + params.seed;
      });

      var controls = [];
      function add(c) { controls.push(c); return c.el; }
      function sync() { controls.forEach(function (c) { c.sync(); }); draw(); wk.changed(); }
      function update(patch) { params = L.normalize(Object.assign({}, params, patch)); sync(); }
      function reroll() { update({ seed: U.randomSeed() }); }
      stage.el.addEventListener('click', reroll);
      canvas.title = 'クリックで別のシードに切り替え';

      var wk = PZ.workKit.attach(ctx, {
        tool: 'pattern', label: 'Pattern Generator',
        getParams: function () { return U.clone(params); },
        setParams: function (p) { params = L.normalize(p); sync(); },
        defaultName: function () { return 'Pattern #' + params.seed; },
        getCanvas: function () { return canvas; },
        // 画像は2倍の解像度で書き出す（保存したパラメータから描き直す）
        exportPng: function () {
          return new Promise(function (resolve, reject) {
            var c = document.createElement('canvas'); c.width = Core.LW * 2; c.height = Core.LH * 2;
            try { L.render(c.getContext('2d'), c.width, c.height, params); } catch (e) { reject(e); return; }
            c.toBlob(function (b) { b ? resolve(b) : reject(new Error('画像を作れませんでした')); }, 'image/png');
          });
        }
      });

      var panel = h('div', { class: 'card lab-panel' },
        Kit.title('Controls', 'PATTERN'),
        h('div', { class: 'lab-buttons' },
          UI.button('ランダム生成', { icon: 'dice', kind: 'primary', onclick: function () { params = L.random(Math.random); sync(); } }),
          UI.button('シードだけ変える', { icon: 'reset', kind: 'ghost', onclick: reroll }),
          h('div', { class: 'full' }, UI.button('初期状態へ', { icon: 'reset', kind: 'ghost', onclick: function () { params = L.normalize(L.defaults); sync(); UI.toast('初期状態に戻しました', { type: 'info', duration: 1500 }); } }))),
        add(Kit.chips('模様の種類', L.TYPES, { isOn: function (id) { return params.type === id; }, toggle: function (id) { update({ type: id }); } })),
        add(Kit.seed('シード', { get: function () { return params.seed; }, set: function (v) { update({ seed: v }); } })),
        add(Kit.range('密度（横の数）', { min: 3, max: 40, step: 1, get: function () { return params.density; }, set: function (v) { update({ density: v }); }, fmt: function (v) { return v + ' 個'; } })),
        add(Kit.range('図形の大きさ', { min: 30, max: 100, step: 1, get: function () { return params.fill; }, set: function (v) { update({ fill: v }); }, fmt: function (v) { return v + '%'; } })),
        add(Kit.range('線の太さ', { min: 4, max: 60, step: 1, get: function () { return params.weight; }, set: function (v) { update({ weight: v }); }, fmt: function (v) { return v + '%'; } })),
        add(Kit.range('全体の回転', { min: 0, max: 90, step: 1, get: function () { return params.rotate; }, set: function (v) { update({ rotate: v }); }, fmt: function (v) { return v + '°'; } })),
        add(Kit.seg('対称', L.SYMMETRY, { get: function () { return params.symmetry; }, set: function (v) { update({ symmetry: v }); } })),
        add(Kit.palette('色', { max: 6, get: function () { return { colors: params.colors, bg: params.bg }; }, set: function (colors, bg) { update({ colors: colors, bg: bg }); } })),
        UI.button('この設定のリンクをコピー', { icon: 'link', kind: 'ghost', small: true, onclick: function () { Kit.copyLink('/lab/pattern', Kit.toQuery(params)); } }));

      root.appendChild(h('div', { class: 'container', style: { paddingBottom: '8px' } },
        Kit.pageHead('pattern', ['Pattern ', h('em', null, 'Generator')], '8種類の幾何学模様を、密度・色・対称を変えながら生成。模様をクリックすると、新しいシードで描き直します。'),
        h('div', { class: 'lab-layout' },
          h('div', { class: 'lab-main' }, stage.el, Kit.howto('pattern')),
          h('div', { class: 'lab-side' }, panel, wk.el))));

      sync();
      wk.start();
      return function destroy() { alive = false; wk.destroy(); };
    }
  };
})();
