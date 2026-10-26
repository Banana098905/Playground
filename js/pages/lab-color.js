/*
 * Color Lab — 配色を実験する。生成ロジックは labs-core.js（PZ.labs.color）
 *  メインカラー → 配色ルールでパレット生成 → 色相/彩度/明度の調整 → 固定・手動編集 → HEXコピー → 保存・再編集
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
  var L = PZ.labs.color;

  PZ.pages.color = {
    title: 'Color Lab',
    nav: 'lab',
    mount: function (root, ctx) {
      var params = L.normalize(Kit.queryParams(ctx.query));
      var alive = true;
      // 他のツールから colors= で渡された配色を受け取る（受け取った色は固定して、編集しても消えないようにする）
      var qColors = ctx.query.colors && !ctx.query.work ? Core.hexList(ctx.query.colors, [], 0, 8) : [];
      if (qColors.length >= 2) {
        params = L.normalize({ base: qColors[0], scheme: params.scheme, count: qColors.length, colors: qColors, locked: qColors.map(function () { return true; }) });
      }

      var strip = h('div', { class: 'pal-strip', role: 'list', 'aria-label': '生成された配色' });
      var sampleCanvas = h('canvas', { role: 'img', 'aria-label': 'この配色を使った見本の絵', width: 600, height: 320 });
      var codeBox = h('code', { class: 'palette-code', 'aria-label': 'HEX一覧' });

      var stage = h('div', { class: 'lab-stage color-stage' },
        h('div', { class: 'lab-stage-bar' }, h('span', null, 'COLOR LAB'), h('span', null, h('b', null, ''))),
        strip);
      var info = stage.querySelector('b');

      /* ---- 描画 ---- */
      function renderStrip() {
        U.clear(strip);
        params.colors.forEach(function (c, i) {
          var ink = U.inkFor(c);
          var hex = h('button', { type: 'button', class: 'pal-hex', title: 'クリックで ' + c.toUpperCase() + ' をコピー', 'aria-label': (i + 1) + '番目の色 ' + c + ' をコピー', style: { color: ink }, onclick: function () { copy(c); } }, c.toUpperCase());
          var lock = h('button', { type: 'button', class: 'pal-lock' + (params.locked[i] ? ' on' : ''), 'aria-pressed': String(!!params.locked[i]), title: params.locked[i] ? '固定を解除' : 'この色を固定（再生成しても変わらない）', 'aria-label': (i + 1) + '番目の色を固定', style: { color: ink }, onclick: function () { toggleLock(i); } });
          lock.appendChild(UI.icon(params.locked[i] ? 'lock' : 'unlock'));
          var pick = h('input', { type: 'color', class: 'pal-pick', value: c, 'aria-label': (i + 1) + '番目の色を編集', title: 'この色を編集' });
          pick.addEventListener('input', function () { editColor(i, pick.value); });
          var cell = h('div', { class: 'pal-swatch', role: 'listitem', style: { background: c } },
            h('div', { class: 'pal-top' }, lock, h('label', { class: 'pal-edit', style: { color: ink } }, UI.icon('edit'), pick)),
            hex);
          strip.appendChild(cell);
        });
        codeBox.textContent = params.colors.map(function (c) { return c.toUpperCase(); }).join('  ');
      }
      var drawSample = U.rafThrottle(function () {
        var g = sampleCanvas.getContext('2d');
        L.sample(g, sampleCanvas.width, sampleCanvas.height, params.colors);
      });

      function copy(text) {
        U.copyText(text).then(function (ok) {
          UI.toast(ok ? text.toUpperCase() + ' をコピーしました' : 'コピーできませんでした。手動で選択してください: ' + text, { type: ok ? 'ok' : 'warn', duration: ok ? 1500 : 5000 });
        });
      }

      /* ---- 更新 ---- */
      var controls = [];
      function add(c) { controls.push(c); return c.el; }
      function sync() {
        controls.forEach(function (c) { c.sync(); });
        renderStrip(); drawSample();
        info.textContent = params.colors.length + ' COLORS · ' + params.scheme.toUpperCase();
        wk.changed();
      }
      /** 配色ルール・メインカラーなどを変えて再生成（固定した色は保つ） */
      function regen(patch) {
        params = L.regenerate(Object.assign({}, params, patch, { colors: params.colors }));
        sync();
      }
      function toggleLock(i) {
        var locked = params.locked.slice(); locked[i] = !locked[i];
        params = L.normalize(Object.assign({}, params, { locked: locked }));
        sync();
      }
      function editColor(i, hex) {
        var colors = params.colors.slice(); colors[i] = U.normHex(hex, colors[i]);
        var locked = params.locked.slice(); locked[i] = true; // 手で直した色は、再生成で消えないよう自動で固定
        params = L.normalize(Object.assign({}, params, { colors: colors, locked: locked }));
        sync();
      }
      function setBase(hex) { regen({ base: U.normHex(hex, params.base) }); }
      function setHsl(k, v) {
        var hsl = U.hexToHsl(params.base);
        hsl[k] = v;
        setBase(U.hslToHex(hsl.h, hsl.s, hsl.l));
      }
      function randomize() {
        var np = L.random(Math.random);
        params = np; sync();
      }
      function unlockAll() { params = L.normalize(Object.assign({}, params, { locked: params.colors.map(function () { return false; }) })); regen({}); }
      function resetAll() { params = L.normalize({}); sync(); UI.toast('初期状態に戻しました', { type: 'info', duration: 1500 }); }

      /* ---- 作品（保存済みパレット） ---- */
      var wk = PZ.workKit.attach(ctx, {
        tool: 'color', label: 'Color Lab',
        getParams: function () { return U.clone(params); },
        setParams: function (p) { params = L.normalize(p); sync(); },
        defaultName: function () { return 'Palette ' + params.colors.map(function (c) { return c.slice(1, 4); }).join('').slice(0, 9).toUpperCase(); },
        onSaved: function () { if (alive) loadSaved(); },
        exportPng: function () {
          return new Promise(function (resolve, reject) {
            var c = document.createElement('canvas'); c.width = 1200; c.height = 630;
            var g = c.getContext('2d');
            L.render(g, 1200, 630, params);
            g.font = '700 34px ' + PZ.model.FONT_STACK; g.textAlign = 'center'; g.textBaseline = 'bottom';
            var n = params.colors.length, bw = 1200 / n;
            params.colors.forEach(function (col, i) { g.fillStyle = U.inkFor(col); g.fillText(col.toUpperCase(), bw * i + bw / 2, 600); });
            c.toBlob(function (b) { b ? resolve(b) : reject(new Error('画像を作れませんでした')); }, 'image/png');
          });
        }
      });

      var savedHost = h('div', { class: 'saved-palettes' });
      function loadSaved() {
        PZ.projects.list({ kind: 'experiment' }).then(function (all) {
          if (!alive) return;
          var mine = all.filter(function (w) { return w.tool === 'color'; }).sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 12);
          U.clear(savedHost);
          if (!mine.length) { savedHost.appendChild(h('p', { class: 'muted', style: { fontSize: '13px' } }, 'まだ保存したパレットはありません。「保存」で My Space にも並びます。')); return; }
          mine.forEach(function (w) {
            var cols = Core.hexList((w.params || {}).colors, [], 0, 8);
            var cur = wk.current();
            var row = h('a', { class: 'saved-pal' + (cur && cur.id === w.id ? ' current' : ''), href: PZ.router.href('/lab/color?work=' + encodeURIComponent(w.id)), title: '開いて再編集', 'aria-label': w.name + ' を開いて再編集' },
              h('span', { class: 'mini-strip' }, cols.map(function (c) { return h('i', { style: { background: c } }); })),
              h('span', { class: 'saved-name' }, w.name));
            savedHost.appendChild(row);
          });
        }).catch(function () { U.clear(savedHost); });
      }

      /* ---- パネル ---- */
      var hslNow = function () { return U.hexToHsl(params.base); };
      var baseInput = h('input', { type: 'color', 'aria-label': 'メインカラー' });
      baseInput.addEventListener('input', function () { setBase(baseInput.value); });
      var hexInput = h('input', { class: 'input mono', type: 'text', maxlength: 7, 'aria-label': 'メインカラーのHEX', placeholder: '#7c5cff', spellcheck: 'false', autocomplete: 'off' });
      hexInput.addEventListener('input', function () {
        var v = hexInput.value.trim(); if (v && v[0] !== '#') v = '#' + v;
        if (U.isHex(v)) setBase(v);
      });
      hexInput.addEventListener('blur', function () { hexInput.value = params.base; });
      var baseField = {
        el: h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'メインカラー'), h('div', { class: 'base-row' }, baseInput, hexInput)),
        sync: function () { baseInput.value = params.base; if (document.activeElement !== hexInput) hexInput.value = params.base; }
      };

      var schemeChips = Kit.chips('配色ルール', L.SCHEMES, { isOn: function (id) { return params.scheme === id; }, toggle: function (id) { regen({ scheme: id }); } });

      var panel = h('div', { class: 'card lab-panel' },
        Kit.title('Controls', 'COLOR LAB'),
        h('div', { class: 'lab-buttons' },
          UI.button('ランダム配色', { icon: 'dice', kind: 'primary', onclick: randomize }),
          UI.button('初期状態へ', { icon: 'reset', kind: 'ghost', onclick: resetAll }),
          UI.button('全てコピー', { icon: 'copy', kind: 'ghost', title: 'HEXをカンマ区切りでコピー', onclick: function () { copy(params.colors.map(function (c) { return c.toUpperCase(); }).join(', ')); } }),
          UI.button('固定を全解除', { icon: 'unlock', kind: 'ghost', onclick: unlockAll })),
        add(baseField),
        add(Kit.range('色相 (H)', { min: 0, max: 359, step: 1, get: function () { return Math.round(hslNow().h) % 360; }, set: function (v) { setHsl('h', v); }, fmt: function (v) { return v + '°'; } })),
        add(Kit.range('彩度 (S)', { min: 0, max: 100, step: 1, get: function () { return Math.round(hslNow().s); }, set: function (v) { setHsl('s', v); }, fmt: function (v) { return v + '%'; } })),
        add(Kit.range('明度 (L)', { min: 5, max: 95, step: 1, get: function () { return Math.round(hslNow().l); }, set: function (v) { setHsl('l', v); }, fmt: function (v) { return v + '%'; } })),
        add(schemeChips),
        add(Kit.range('色の数', { min: 2, max: 8, step: 1, get: function () { return params.count; }, set: function (v) { regen({ count: v }); }, fmt: function (v) { return v + '色'; } })),
        add(Kit.range('全体の彩度', { min: -50, max: 50, step: 1, get: function () { return params.satAdj; }, set: function (v) { regen({ satAdj: v }); }, fmt: function (v) { return (v > 0 ? '+' : '') + v; } })),
        add(Kit.range('全体の明度', { min: -30, max: 30, step: 1, get: function () { return params.lightAdj; }, set: function (v) { regen({ lightAdj: v }); }, fmt: function (v) { return (v > 0 ? '+' : '') + v; } })),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'この配色を他の実験で使う'),
          h('div', { class: 'chip-group' },
            h('button', { type: 'button', class: 'chip', onclick: function () { PZ.router.go('/lab/flow?' + U.buildQuery({ colors: Core.hexQuery(params.colors), bg: '101215' })); } }, UI.icon('flow'), 'Flow Field'),
            h('button', { type: 'button', class: 'chip', onclick: function () { PZ.router.go('/lab/pattern?' + U.buildQuery({ colors: Core.hexQuery(params.colors), bg: '15171b' })); } }, UI.icon('pattern'), 'Pattern'),
            h('button', { type: 'button', class: 'chip', onclick: function () { PZ.router.go('/lab/motion?' + U.buildQuery({ colors: Core.hexQuery(params.colors), bg: '101215' })); } }, UI.icon('motion'), 'Motion'))),
        UI.button('この設定のリンクをコピー', { icon: 'link', kind: 'ghost', small: true, onclick: function () { Kit.copyLink('/lab/color', Kit.toQuery({ base: params.base, scheme: params.scheme, count: params.count, satAdj: params.satAdj, lightAdj: params.lightAdj, colors: params.colors })); } }));

      root.appendChild(h('div', { class: 'container', style: { paddingBottom: '8px' } },
        Kit.pageHead('color', ['Color ', h('em', null, 'Lab')], 'メインカラーから、調和のとれたパレットを生成。色を固定したり手で直したりしながら、自分だけの配色を探そう。'),
        h('div', { class: 'lab-layout' },
          h('div', { class: 'lab-main' },
            stage,
            h('div', { class: 'card color-extra' },
              h('div', { class: 'panel-title' }, 'HEX', h('small', null, 'クリックでコピー')),
              codeBox,
              h('div', { class: 'sample-wrap' }, sampleCanvas)),
            h('div', { class: 'card color-extra' },
              h('div', { class: 'panel-title' }, 'Saved Palettes', h('small', null, 'クリックで再編集')),
              savedHost),
            Kit.howto('color')),
          h('div', { class: 'lab-side' }, panel, wk.el))));

      sync();
      wk.start().then(function () { loadSaved(); });

      return function destroy() { alive = false; wk.destroy(); };
    }
  };
})();
