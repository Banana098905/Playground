/*
 * 実験ページ共通の部品キット（PZ.labKit）
 * ※ 実験の一覧（Experiment Library）は pages/library.js にあります。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.pages = PZ.pages || {};
  PZ.labs = PZ.labs || {};
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Router = PZ.router;

  /* ========== 共通の操作パーツ ========== */
  var Kit = (PZ.labKit = {});
  var uid = 0;

  Kit.range = function (label, o) {
    var id = 'lk-' + (++uid);
    var input = h('input', { type: 'range', id: id, min: o.min, max: o.max, step: o.step || 1 });
    var out = h('output', { for: id });
    var el = h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label, out), input);
    function paint() {
      var v = parseFloat(input.value);
      input.style.setProperty('--fill', ((v - o.min) / (o.max - o.min) * 100) + '%');
      out.textContent = o.fmt ? o.fmt(v) : String(v);
    }
    input.addEventListener('input', function () { o.set(parseFloat(input.value)); paint(); });
    return { el: el, sync: function () { input.value = o.get(); paint(); } };
  };

  /** 複数選択 / 単一選択のチップ群。options: [{id,label,icon}] */
  Kit.chips = function (label, options, o) {
    var group = h('div', { class: 'chip-group', role: 'group', 'aria-label': label });
    var btns = options.map(function (op) {
      var b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: function () { o.toggle(op.id); } });
      if (op.icon) b.appendChild(UI.icon(op.icon));
      b.appendChild(document.createTextNode(op.label));
      b._id = op.id;
      group.appendChild(b);
      return b;
    });
    var el = h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), group);
    return {
      el: el,
      sync: function () {
        btns.forEach(function (b) { b.setAttribute('aria-pressed', String(!!o.isOn(b._id))); });
      }
    };
  };

  Kit.seg = function (label, options, o) {
    var seg = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    var btns = options.map(function (op) {
      var b = h('button', { type: 'button', 'aria-pressed': 'false', onclick: function () { o.set(op.id); } }, op.label);
      b._id = op.id;
      seg.appendChild(b);
      return b;
    });
    return {
      el: h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), seg),
      sync: function () { var v = o.get(); btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b._id === v)); }); }
    };
  };

  Kit.check = function (label, o) {
    var input = h('input', { type: 'checkbox' });
    input.addEventListener('change', function () { o.set(input.checked); });
    return {
      el: h('label', { class: 'check' }, input, h('span', { class: 'box' }), label),
      sync: function () { input.checked = !!o.get(); }
    };
  };

  Kit.title = function (text, small) {
    return h('div', { class: 'panel-title' }, text, small ? h('small', null, small) : null);
  };

  Kit.crumbs = function (current) {
    return h('div', { class: 'crumbs' },
      h('a', { href: Router.href('/lab') }, 'Lab'), h('span', null, '/'), h('span', { style: { color: 'var(--lime)' } }, current));
  };

  /** 設定をURLにして共有（バックエンド不要） */
  Kit.copyLink = function (path, query) {
    var url = location.href.split('#')[0] + '#' + path + '?' + U.buildQuery(query);
    function done() { UI.toast('設定リンクをコピーしました', { type: 'ok', duration: 1800 }); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = h('textarea', { style: { position: 'fixed', opacity: '0', left: '-999px' } }, url);
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { UI.toast(url, { duration: 8000 }); }
      ta.remove();
    }
  };

  /** 入力途中でも落ちない数値パース */
  Kit.num = function (v, min, max, def) {
    var n = parseFloat(v);
    if (!isFinite(n)) return def;
    return U.clamp(n, min, max);
  };

  /** 実験ページの見出し（パンくず・タイトル・説明） */
  Kit.pageHead = function (toolId, titleHtml, lead) {
    var t = PZ.registry.get(toolId);
    return h('header', { class: 'page-head' },
      Kit.crumbs(t ? t.name : toolId),
      h('h1', { class: 'page-title' }, titleHtml),
      h('p', { class: 'page-lead' }, lead || (t && t.summary) || ''));
  };

  /** 使い方（レジストリの howto を表示）。狭い画面では閉じた状態で始める */
  Kit.howto = function (toolId) {
    var t = PZ.registry.get(toolId);
    if (!t) return null;
    var d = h('details', { class: 'howto card' },
      h('summary', null, UI.icon('eye'), h('span', null, '使い方'), h('small', null, t.code)),
      h('ol', null, t.howto.map(function (x) { return h('li', null, x); })),
      h('div', { class: 'chip-group', style: { marginTop: '12px' } }, t.genres.map(function (g) { return h('span', { class: 'badge purple' }, g); })));
    if (!U.isSmallScreen()) d.setAttribute('open', '');
    return d;
  };

  /** ステージ（キャンバス＋上部の情報バー）。canvas は論理サイズ固定、CSS で幅いっぱいに */
  Kit.stage = function (label, canvasAttrs) {
    var canvas = h('canvas', canvasAttrs || {});
    var info = h('b', null, '');
    var bar = h('div', { class: 'lab-stage-bar' }, h('span', null, label), h('span', { 'aria-live': 'off' }, info));
    var el = h('div', { class: 'lab-stage lab-stage-fixed' }, canvas, bar);
    return { el: el, canvas: canvas, info: info };
  };

  /** シード入力 + 振り直しボタン */
  Kit.seed = function (label, o) {
    var input = h('input', { class: 'input mono', type: 'number', min: 0, max: 999999, 'aria-label': 'シード値' });
    input.addEventListener('input', function () { var v = parseInt(input.value, 10); if (isFinite(v)) o.set(U.clamp(v, 0, 999999)); });
    input.addEventListener('change', function () { input.value = o.get(); });
    var dice = UI.iconButton('dice', '新しいシードにする', function () { o.set(U.randomSeed()); });
    return {
      el: h('div', { class: 'field' }, h('label', { class: 'field-label' }, label || 'シード', h('output', null, '同じ値なら同じ結果')),
        h('div', { class: 'seed-row' }, input, dice)),
      sync: function () { if (document.activeElement !== input) input.value = o.get(); }
    };
  };

  /** 色セット（プリセット + 個別の色 + 背景）。o: { get() -> {colors,bg}, set(colors,bg), max } */
  Kit.palette = function (label, o) {
    var Core = PZ.labsCore;
    var max = o.max || 6;
    var presets = h('div', { class: 'chip-group', role: 'group', 'aria-label': label + 'のプリセット' });
    Core.paletteList.forEach(function (id) {
      var b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: function () { var p = Core.applyPalette(id, max); o.set(p.colors, p.bg); } });
      var sw = h('span', { class: 'chip-swatch' });
      Core.PALETTES[id].colors.slice(0, 3).forEach(function (c) { sw.appendChild(h('i', { style: { background: c } })); });
      b.appendChild(sw); b.appendChild(document.createTextNode(Core.PALETTES[id].label)); b._id = id;
      presets.appendChild(b);
    });
    var randBtn = h('button', { type: 'button', class: 'chip', onclick: function () { var p = Core.randomPalette(Math.random, 3 + Math.floor(Math.random() * 3)); o.set(p.colors, p.bg); } });
    randBtn.appendChild(UI.icon('dice')); randBtn.appendChild(document.createTextNode('ランダム'));
    presets.appendChild(randBtn);

    var row = h('div', { class: 'color-row' });
    var bgInput = h('input', { type: 'color', 'aria-label': '背景色' });
    bgInput.addEventListener('input', function () { var c = o.get(); o.set(c.colors, bgInput.value); });
    var addBtn = UI.iconButton('plus', '色を追加', function () {
      var c = o.get(); if (c.colors.length >= max) return;
      var last = c.colors[c.colors.length - 1], hsl = U.hexToHsl(last);
      o.set(c.colors.concat([U.hslToHex((hsl.h + 47) % 360, Math.max(45, hsl.s), U.clamp(hsl.l, 40, 65))]), c.bg);
    });
    var delBtn = UI.iconButton('close', '最後の色を減らす', function () {
      var c = o.get(); if (c.colors.length <= 1) return; o.set(c.colors.slice(0, -1), c.bg);
    });
    var inputs = [];
    return {
      el: h('div', { class: 'field' },
        h('span', { class: 'field-label' }, label),
        presets,
        h('div', { class: 'field-label', style: { marginTop: '4px' } }, '色（クリックで変更）'),
        row,
        h('div', { class: 'color-bg' }, h('label', { class: 'field-label' }, '背景'), bgInput)),
      sync: function () {
        var c = o.get();
        // 色の数が変わったときだけ入力欄を作り直す（ドラッグ中の入力を邪魔しない）
        if (inputs.length !== c.colors.length) {
          U.clear(row); inputs = [];
          c.colors.forEach(function (_, i) {
            var inp = h('input', { type: 'color', 'aria-label': (i + 1) + '番目の色' });
            inp.addEventListener('input', function () { var cur = o.get(); var next = cur.colors.slice(); next[i] = inp.value; o.set(next, cur.bg); });
            inputs.push(inp); row.appendChild(inp);
          });
          row.appendChild(addBtn); row.appendChild(delBtn);
        }
        c.colors.forEach(function (col, i) { if (inputs[i].value !== col) inputs[i].value = col; });
        addBtn.disabled = c.colors.length >= max; delBtn.disabled = c.colors.length <= 1;
        if (bgInput.value !== c.bg) bgInput.value = c.bg;
        var match = Core.matchPalette(c.colors, c.bg);
        Array.prototype.forEach.call(presets.querySelectorAll('.chip'), function (b) { if (b._id) b.setAttribute('aria-pressed', String(b._id === match)); });
      }
    };
  };

  /** 一時停止ボタン（状態を持つ）。onToggle(paused) */
  Kit.pauseButton = function (onToggle) {
    var btn = UI.button('一時停止', { icon: 'pause', kind: 'ghost' });
    var paused = false;
    function paint() {
      U.clear(btn);
      btn.appendChild(UI.icon(paused ? 'play' : 'pause'));
      btn.appendChild(h('span', { class: 'btn-label' }, paused ? '再開' : '一時停止'));
      btn.setAttribute('aria-pressed', String(paused));
    }
    btn.addEventListener('click', function () { paused = !paused; paint(); onToggle(paused); });
    return { el: btn, set: function (v) { paused = !!v; paint(); }, get: function () { return paused; }, toggle: function () { paused = !paused; paint(); onToggle(paused); } };
  };

  /** スペースキーで操作する（入力欄やボタン上では無効）。解除関数を返す */
  Kit.onSpace = function (canvas, fn) {
    function on(e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      var t = e.target;
      if (t !== document.body && t !== canvas && !(t && t.classList && t.classList.contains('lab-stage'))) return;
      e.preventDefault(); fn();
    }
    document.addEventListener('keydown', on);
    return function () { document.removeEventListener('keydown', on); };
  };

  /** ブラウザの負荷に応じて数を自動で減らす（重い実験用）。tick(frameMs) を毎フレーム呼ぶ */
  Kit.perfGuard = function (onReduce) {
    var avg = 16, slow = 0, reduced = 0;
    return {
      tick: function (ms) {
        avg += (ms - avg) * 0.08;
        if (avg > 26) { slow++; } else { slow = Math.max(0, slow - 1); }
        if (slow > 50) { slow = 0; avg = 16; reduced++; onReduce(reduced); }
      },
      reduced: function () { return reduced; }
    };
  };

  /** キャンバスを PNG として保存 */
  Kit.savePng = function (canvas, name) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (!b) { reject(new Error('画像を作れませんでした')); return; }
        U.download(b, U.safeFileName(name, '.png'));
        resolve();
      }, 'image/png');
    }).then(function () { UI.toast('画像（PNG）を保存しました', { type: 'ok', duration: 1800 }); },
      function (e) { UI.toast('画像を保存できませんでした: ' + ((e && e.message) || ''), { type: 'error' }); });
  };

  /** クエリ → 実験パラメータ（work / daily などの共通キーを除く） */
  Kit.queryParams = function (q) {
    var out = {};
    Object.keys(q || {}).forEach(function (k) { if (k !== 'work' && k !== 'daily') out[k] = q[k]; });
    return out;
  };

  /** 現在のパラメータをURLクエリ用の値にする（配列は # なしのカンマ区切り） */
  Kit.toQuery = function (p) {
    var out = {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (Array.isArray(v)) {
        if (v.length && typeof v[0] === 'string' && v[0].charAt(0) === '#') out[k] = PZ.labsCore.hexQuery(v);
        else if (v.length && typeof v[0] === 'boolean') return;
        else out[k] = v.join(',');
      } else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
      else if (typeof v === 'string' && v.charAt(0) === '#') out[k] = v.slice(1);
      else out[k] = v;
    });
    return out;
  };
})();
