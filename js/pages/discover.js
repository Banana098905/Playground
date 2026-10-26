/*
 * Random Discovery（/discover）— 予想外の配色・模様・流れ・お題・実験に出会う。
 * すべての結果は「シード」から決まる。同じシードなら同じ結果になるので、気に入ったら保存・再現できる。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.pages = PZ.pages || {};
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Router = PZ.router;
  var Core = PZ.labsCore;
  var Kit = PZ.labKit;

  var MODES = [
    { id: 'all', label: 'おまかせ' }, { id: 'color', label: '配色' }, { id: 'pattern', label: '模様' },
    { id: 'flow', label: '流れ' }, { id: 'theme', label: 'お題' }, { id: 'tool', label: '実験' }
  ];
  var MIX = ['color', 'pattern', 'pattern', 'flow', 'flow', 'theme', 'tool'];
  var SAVABLE = { color: 1, pattern: 1, flow: 1 };
  var KIND_LABEL = { color: '配色', pattern: '模様', flow: '流れ', theme: 'お題', tool: '実験' };

  /** シードから結果を作る（純粋: 同じ mode+seed なら同じ結果） */
  function generate(mode, seed) {
    var kind = mode;
    if (mode === 'all') kind = MIX[Math.floor(Core.rndFrom(seed + 77)() * MIX.length)];
    var rnd = Core.rndFrom(seed);
    if (kind === 'color') { var c = PZ.labs.color.random(rnd); c = PZ.labs.color.normalize(Object.assign({}, c, { seed: seed })); return { kind: kind, seed: seed, tool: 'color', params: c }; }
    if (kind === 'pattern') return { kind: kind, seed: seed, tool: 'pattern', params: PZ.labs.pattern.normalize(Object.assign({}, PZ.labs.pattern.random(rnd), { seed: seed })) };
    if (kind === 'flow') return { kind: kind, seed: seed, tool: 'flow', params: PZ.labs.flow.normalize(Object.assign({}, PZ.labs.flow.random(rnd), { seed: seed })) };
    if (kind === 'theme') return { kind: kind, seed: seed, theme: PZ.daily.THEMES[Math.floor(rnd() * PZ.daily.THEMES.length)] };
    var tools = PZ.registry.all();
    return { kind: 'tool', seed: seed, toolDef: tools[Math.floor(rnd() * tools.length)] };
  }
  PZ.discover = { generate: generate, MODES: MODES };

  PZ.pages.discover = {
    title: 'Random Discovery',
    nav: 'discover',
    mount: function (root, ctx) {
      var alive = true;
      var mode = MODES.some(function (m) { return m.id === ctx.query.mode; }) ? ctx.query.mode : 'all';
      var seed = ctx.query.seed !== undefined && isFinite(parseInt(ctx.query.seed, 10)) ? U.clamp(parseInt(ctx.query.seed, 10), 0, 999999) : U.randomSeed();
      var cur = null, history = [];
      var viewHost = h('div', { class: 'disc-view' });
      var actionsHost = h('div', { class: 'disc-actions' });
      var histHost = h('div', { class: 'disc-history', role: 'list', 'aria-label': 'これまでの結果' });
      var seedInput = h('input', { class: 'input mono', type: 'number', min: 0, max: 999999, 'aria-label': 'シード値' });
      var modeHost = h('div', { class: 'seg disc-modes', role: 'group', 'aria-label': '発見の種類' });

      MODES.forEach(function (m) {
        var b = h('button', { type: 'button', 'aria-pressed': String(m.id === mode), onclick: function () { mode = m.id; paintModes(); roll(); } }, m.label);
        b._id = m.id; modeHost.appendChild(b);
      });
      function paintModes() { Array.prototype.forEach.call(modeHost.children, function (b) { b.setAttribute('aria-pressed', String(b._id === mode)); }); }

      /* ---- 結果の表示 ---- */
      function showCanvas(res, draw) {
        var cv = h('canvas', { width: Core.LW, height: Core.LH, role: 'img', 'aria-label': KIND_LABEL[res.kind] + 'の発見結果（シード ' + res.seed + '）' });
        var info = h('div', { class: 'lab-stage-bar' }, h('span', null, 'DISCOVERY / ' + KIND_LABEL[res.kind].toUpperCase()), h('span', null, h('b', null, 'SEED ' + res.seed)));
        viewHost.appendChild(h('div', { class: 'lab-stage lab-stage-fixed disc-stage' }, cv, info));
        requestAnimationFrame(function () { if (alive) draw(cv.getContext('2d')); });
        return cv;
      }

      function renderResult(res) {
        U.clear(viewHost);
        if (res.kind === 'color') {
          var p = res.params;
          showCanvas(res, function (g) {
            PZ.labs.color.render(g, Core.LW, Core.LH, p);
            g.font = '700 34px ' + PZ.model.FONT_STACK; g.textAlign = 'center'; g.textBaseline = 'bottom';
            var bw = Core.LW / p.colors.length;
            p.colors.forEach(function (c, i) { g.fillStyle = U.inkFor(c); g.fillText(c.toUpperCase(), bw * i + bw / 2, Core.LH - 30); });
          });
          var hexRow = h('div', { class: 'chip-group', style: { marginTop: '12px' } }, p.colors.map(function (c) {
            return h('button', { type: 'button', class: 'chip', title: 'クリックでコピー', onclick: function () { U.copyText(c.toUpperCase()).then(function (ok) { UI.toast(ok ? c.toUpperCase() + ' をコピーしました' : 'コピーできませんでした', { type: ok ? 'ok' : 'warn', duration: 1400 }); }); } },
              h('span', { class: 'chip-swatch' }, h('i', { style: { background: c } })), c.toUpperCase());
          }));
          viewHost.appendChild(hexRow);
        } else if (res.kind === 'pattern') {
          showCanvas(res, function (g) { PZ.labs.pattern.render(g, Core.LW, Core.LH, res.params); });
        } else if (res.kind === 'flow') {
          showCanvas(res, function (g) { PZ.labs.flow.render(g, Core.LW, Core.LH, res.params, 280); });
        } else if (res.kind === 'theme') {
          var t = res.theme, today = PZ.daily.todayKey();
          viewHost.appendChild(h('article', { class: 'card daily-card' },
            h('div', { class: 'daily-main' },
              h('div', { class: 'theme-date' }, 'RANDOM THEME / ' + PZ.daily.toolLabel(t.tool).toUpperCase()),
              PZ.dailyUi.titleEl(t),
              h('p', { class: 'theme-brief' }, t.brief),
              h('div', { class: 'theme-actions' }, UI.button(PZ.daily.toolLabel(t.tool) + 'で挑戦する', { icon: 'arrow', kind: 'purple', onclick: function () { Router.go(PZ.daily.href(t, today)); } }))),
            h('div', { class: 'daily-hints' },
              h('div', { class: 'panel-title' }, 'Hints', h('small', null, '制作のヒント')),
              h('ul', null, t.hints.map(function (x) { return h('li', null, x); })))));
        } else {
          var tool = res.toolDef;
          var cv2 = h('canvas', { 'aria-hidden': 'true' });
          viewHost.appendChild(h('article', { class: 'card tool-card disc-tool' },
            h('div', { class: 'tool-preview' }, cv2),
            h('div', null, h('div', { class: 'tool-code' }, tool.code), h('h3', { class: 'tool-name' }, tool.name)),
            h('p', { class: 'tool-desc' }, tool.summary),
            h('div', { class: 'chip-group' }, tool.genres.map(function (x) { return h('span', { class: 'badge purple' }, x); })),
            h('a', { class: 'tool-go', href: Router.href(tool.path) }, '実験を始める', UI.icon('arrow'))));
          requestAnimationFrame(function () { if (alive) PZ.registry.drawPreview(tool.id, cv2); });
        }
        paintActions(res);
      }

      function paintActions(res) {
        U.clear(actionsHost);
        actionsHost.appendChild(UI.button('もう一度', { icon: 'dice', kind: 'primary', class: 'btn-lg', title: 'スペースキーでも引き直せます', onclick: roll }));
        if (SAVABLE[res.kind]) {
          actionsHost.appendChild(UI.button('保存する', { icon: 'save', kind: 'ghost', onclick: function () { saveResult(res); } }));
          var tl = PZ.registry.get(res.tool);
          actionsHost.appendChild(UI.button(tl.name + 'で開く', { icon: 'edit', kind: 'ghost', onclick: function () { Router.go(tl.path + '?' + U.buildQuery(Kit.toQuery(res.params))); } }));
        }
      }

      function saveResult(res) {
        var tl = PZ.registry.get(res.tool);
        var name = 'Discovery ' + KIND_LABEL[res.kind] + ' #' + res.seed;
        PZ.projects.createExperiment(res.tool, { name: name, params: res.params, thumb: PZ.registry.thumbFor(res.tool, res.params) }).then(function () {
          UI.toast('「' + name + '」を保存しました（シード ' + res.seed + ' で再現できます）', { type: 'ok', duration: 6000, action: { label: 'My Space', onClick: function () { Router.go('/space'); } } });
        }, function (e) {
          UI.toast('保存できませんでした: ' + ((e && e.name === 'QuotaExceededError') ? '保存容量が足りません' : (e && e.message)), { type: 'error', duration: 6000 });
        });
        void tl;
      }

      /* ---- 履歴 ---- */
      function pushHistory(res) {
        var entry = { res: res, label: KIND_LABEL[res.kind] + ' #' + res.seed, img: null };
        if (SAVABLE[res.kind]) entry.img = PZ.registry.thumbFor(res.tool, res.params, 160, 100);
        history = history.filter(function (e) { return !(e.res.kind === res.kind && e.res.seed === res.seed); });
        history.unshift(entry);
        history = history.slice(0, 12);
        U.clear(histHost);
        history.forEach(function (e) {
          var b = h('button', { type: 'button', class: 'hist-item', role: 'listitem', title: e.label + ' をもう一度表示', 'aria-label': e.label + ' をもう一度表示', onclick: function () { show(e.res); } },
            e.img ? h('img', { src: e.img, alt: '' }) : h('span', { class: 'hist-noimg' }, UI.icon(e.res.kind === 'tool' ? 'lab' : 'calendar')),
            h('span', { class: 'hist-label' }, e.label));
          histHost.appendChild(b);
        });
      }

      function show(res) {
        cur = res; seed = res.seed; seedInput.value = seed;
        renderResult(res); pushHistory(res);
        try { history_replace(res); } catch (e) { /* noop */ }
      }
      function history_replace(res) {
        window.history.replaceState(null, '', location.href.split('#')[0] + '#/discover?' + U.buildQuery({ mode: mode, seed: res.seed }));
      }

      function roll() {
        var next = U.randomSeed();
        if (next === seed) next = (next + 1) % 1000000;
        show(generate(mode, next));
      }
      function useSeed() {
        var v = parseInt(seedInput.value, 10);
        if (!isFinite(v)) { seedInput.value = seed; return; }
        show(generate(mode, U.clamp(v, 0, 999999)));
      }
      seedInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); useSeed(); } });

      function onKey(e) {
        if (e.code !== 'Space') return;
        var t = e.target;
        if (t !== document.body) return;
        e.preventDefault(); roll();
      }
      document.addEventListener('keydown', onKey);

      root.appendChild(h('div', { class: 'container', style: { paddingBottom: '8px' } },
        h('header', { class: 'page-head' },
          h('div', { class: 'crumbs' }, 'Discover'),
          h('h1', { class: 'page-title' }, 'ランダム発見 ', h('em', null, 'DISCOVER')),
          h('p', { class: 'page-lead' }, '予想外の配色・模様・流れ・お題・実験に出会う場所。結果はすべてシード値から決まるので、気に入ったら保存して、いつでも同じものを呼び出せます。')),
        h('div', { class: 'disc-bar' },
          modeHost,
          h('div', { class: 'seed-row disc-seed' },
            h('label', { class: 'field-label', for: 'disc-seed' }, 'SEED'),
            seedInput,
            UI.button('このシードで表示', { kind: 'ghost', small: true, onclick: useSeed }))),
        h('div', { class: 'disc-layout' }, viewHost, h('div', { class: 'disc-side' }, actionsHost,
          h('div', { class: 'panel-title', style: { marginTop: '18px' } }, 'History', h('small', null, 'クリックで再表示')), histHost))));
      seedInput.id = 'disc-seed';

      show(generate(mode, seed));
      return function destroy() { alive = false; document.removeEventListener('keydown', onKey); };
    }
  };
})();
