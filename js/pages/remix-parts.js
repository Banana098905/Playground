/*
 * Remix Workspace — 部品ライブラリと「組み合わせ」の画面（PZ.remixParts）
 *   ・付属の部品／自分の部品の一覧、挿入、書き出し・読み込み、削除
 *   ・選んだブロックを部品にする
 *   ・ほかの作品のスクリプトを取り込む（組み合わせ）
 * 計算（挿入・検証・名前の衝突回避）は PZ.remix.parts が行います。ここは入力と結果の表示だけです。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Cr = PZ.creation;
  var R = PZ.remix;
  var P = R.parts;
  var Q = (PZ.remixParts = {});

  var CREATE = '__create', RENAME = '__rename';

  /* ---------- 挿入結果の表示 ---------- */
  function resultView(res) {
    var box = h('div', { class: 'rx-result', 'aria-live': 'polite' });
    if (res.problems.length) {
      box.appendChild(h('div', { class: 'notice warn', role: 'alert' }, UI.icon('alert'),
        h('div', { class: 'grow' }, h('b', null, 'このままでは挿入できません'),
          h('ul', { class: 'rx-problems' }, res.problems.map(function (p) {
            return h('li', null, h('span', null, p.msg), p.fix ? h('small', null, '→ ' + p.fix) : null);
          })))));
    } else if (res.ok) {
      box.appendChild(h('p', { class: 'cr-ok' }, UI.icon('check'), '挿入できます。挿入後のチェックも通りました。'));
    }
    var notes = [];
    res.renamed.forEach(function (r) { notes.push('へんすう「' + r.from + '」は、重なるため「' + r.to + '」に名前を変えました。'); });
    res.created.forEach(function (n) { notes.push('へんすう「' + n + '」を新しく作ります。'); });
    res.connected.forEach(function (c) { notes.push('部品の「' + c.from + '」を、作品の「' + c.to + '」につなぎます。'); });
    res.warnings.forEach(function (w) { notes.push(w); });
    if (notes.length) box.appendChild(h('ul', { class: 'rx-notes' }, notes.map(function (n) { return h('li', null, n); })));
    if (res.ok) box.appendChild(h('p', { class: 'work-hint' }, '追加されるもの: ブロック ' + res.stats.blocks + ' 個 / スクリプト ' + res.stats.scripts + ' 個 / へんすう ' + res.stats.vars + ' 個'));
    return box;
  }

  function varNames(creation) { return Cr.validate(creation, { lenient: true }).clean.vars.map(function (v) { return v.name; }); }

  /** 部品の設定値の入力欄 */
  function paramField(p, values, onChange) {
    var el;
    var id = 'rxp-' + p.key;
    if (p.type === 'color') {
      el = h('input', { class: 'in-color', type: 'color', value: /^#[0-9a-f]{6}$/i.test(String(values[p.key])) ? values[p.key] : '#b8ff3d', id: id });
      el.addEventListener('input', function () { values[p.key] = el.value; onChange(); });
    } else if (p.type === 'bool') {
      el = h('select', { class: 'select', id: id }, h('option', { value: 'true' }, 'はい'), h('option', { value: 'false' }, 'いいえ'));
      el.value = String(values[p.key]);
      el.addEventListener('change', function () { values[p.key] = el.value === 'true'; onChange(); });
    } else if (p.type === 'enum') {
      el = h('select', { class: 'select', id: id }, p.options.map(function (o) { return h('option', { value: o[0] }, o[1]); }));
      el.value = values[p.key];
      el.addEventListener('change', function () { values[p.key] = el.value; onChange(); });
    } else if (p.type === 'num') {
      el = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: String(values[p.key]), id: id, autocomplete: 'off' });
      el.addEventListener('input', function () { values[p.key] = el.value; onChange(); });
    } else {
      el = h('input', { class: 'input', type: 'text', value: String(values[p.key]), maxlength: 200, id: id, autocomplete: 'off' });
      el.addEventListener('input', function () { values[p.key] = el.value; onChange(); });
    }
    var range = p.type === 'num' && isFinite(p.min) && Math.abs(p.max) < 1e8 ? h('small', null, p.min + '〜' + p.max) : null;
    return h('div', { class: 'field rx-param' }, h('label', { class: 'field-label', for: id }, p.label), el, range);
  }

  /** へんすう接続の1行 */
  function mapRow(label, typeText, choices, current, onPick, note) {
    var sel = h('select', { class: 'select', 'aria-label': label + ' の接続先' }, choices.map(function (c) { return h('option', { value: c[0] }, c[1]); }));
    sel.value = current;
    sel.addEventListener('change', function () { onPick(sel.value); });
    return h('div', { class: 'rx-maprow' }, h('div', { class: 'rx-maplabel' }, h('b', null, label), h('small', null, typeText)), h('span', { class: 'rx-arrow', 'aria-hidden': 'true' }, '→'), sel, note ? h('small', { class: 'rx-mapnote' }, note) : null);
  }

  Q.create = function (host) {
    var alive = true;
    var all = [], query = '';
    var listHost = h('div', { class: 'rx-comps' });
    var cursorHint = h('p', { class: 'work-hint rx-target' });
    var search = h('input', { class: 'input', type: 'search', placeholder: '部品を検索', 'aria-label': '部品を検索', autocomplete: 'off' });
    search.addEventListener('input', function () { query = search.value.trim().toLowerCase(); paint(); });
    var fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-hidden': 'true' });

    var el = h('div', { class: 'rx-parts' },
      h('div', { class: 'rx-parts-tools' },
        UI.button('選んだブロックを部品にする', { small: true, kind: 'ghost', icon: 'blocks', title: '編集中のブロックを選んでから押します', onclick: function () { makeFromSelection(); } }),
        UI.button('ほかの作品と組み合わせる', { small: true, kind: 'ghost', icon: 'branch', onclick: function () { openCompose(); } }),
        UI.button('部品を読み込む', { small: true, kind: 'ghost', icon: 'upload', onclick: function () { fileInput.click(); } })),
      cursorHint, search, listHost, fileInput);

    function refresh() {
      return R.store.components.all().then(function (list) { if (!alive) return; all = list; paint(); }, function () { all = P.builtins(); paint(); });
    }
    function paint() {
      U.clear(listHost);
      var t = host.targetLabel ? host.targetLabel() : '';
      cursorHint.textContent = t ? '命令の部品は「追加先: ' + t + '」に入ります。' : '';
      var shown = all.filter(function (c) { return !query || (c.name + ' ' + c.description + ' ' + c.tags.join(' ')).toLowerCase().indexOf(query) >= 0; });
      if (!shown.length) { listHost.appendChild(h('p', { class: 'work-hint' }, '見つかりません。')); return; }
      var user = shown.filter(function (c) { return !c.builtin; }), built = shown.filter(function (c) { return c.builtin; });
      if (!all.some(function (c) { return !c.builtin; })) listHost.appendChild(h('p', { class: 'work-hint' }, 'まだ自分の部品はありません。ブロックを選んで「選んだブロックを部品にする」と、ここに増えます。'));
      if (user.length) { listHost.appendChild(h('div', { class: 'panel-title' }, '自分の部品', h('small', null, user.length + ' 個'))); user.forEach(function (c) { listHost.appendChild(card(c)); }); }
      if (built.length) { listHost.appendChild(h('div', { class: 'panel-title', style: { marginTop: '10px' } }, '付属の部品', h('small', null, built.length + ' 個'))); built.forEach(function (c) { listHost.appendChild(card(c)); }); }
    }
    function card(c) {
      var io = P.ioText(c);
      return h('div', { class: 'rx-comp' },
        h('div', { class: 'rx-comp-head' }, h('b', null, c.name), h('span', { class: 'badge' + (c.kind === 'event' ? ' purple' : '') }, c.kind === 'event' ? 'イベント' : '命令'), h('small', null, 'v' + c.version)),
        c.description ? h('p', { class: 'rx-comp-desc' }, c.description) : null,
        h('dl', { class: 'rx-io' },
          h('dt', null, '入力'), h('dd', null, io.inputs.length ? io.inputs.join('、') : 'なし'),
          h('dt', null, '設定'), h('dd', null, io.params.length ? io.params.join('、') : 'なし'),
          h('dt', null, '出力'), h('dd', null, io.outputs.length ? io.outputs.join('、') : 'なし')),
        h('div', { class: 'rx-node-acts' },
          UI.button('挿入…', { small: true, kind: 'primary', icon: 'plus', onclick: function () { openInsert(c); } }),
          c.builtin ? null : UI.button('書き出し', { small: true, kind: 'ghost', icon: 'download', onclick: function () { exportComp(c); } }),
          c.builtin ? null : UI.button('削除', { small: true, kind: 'ghost', icon: 'trash', onclick: function () { removeComp(c); } })));
    }

    /* ---------- 挿入 ---------- */
    function openInsert(comp) {
      var values = {}; comp.params.forEach(function (p) { values[p.key] = p.def; });
      var map = {}, createMissing = false;
      var base = host.get();
      var names = varNames(base);
      var paramsBox = h('div', { class: 'rx-paramgrid' });
      var mapBox = h('div', { class: 'rx-mapbox' });
      var resBox = h('div');
      var okBtn = UI.button('挿入する', { kind: 'primary', icon: 'plus', onclick: function () { doInsert(); } });
      var m;
      var last = null;

      function compute() {
        last = P.insert(base, comp, { params: values, map: map, createMissing: createMissing, target: comp.kind === 'stmt' ? host.target() : null });
        U.clear(resBox); resBox.appendChild(resultView(last));
        okBtn.disabled = !last.ok;
      }
      comp.params.forEach(function (p) { paramsBox.appendChild(paramField(p, values, compute)); });
      if (comp.needs.length) {
        mapBox.appendChild(h('div', { class: 'panel-title' }, '作品のへんすうとつなぐ', h('small', null, '入力')));
        comp.needs.forEach(function (n) {
          var has = names.indexOf(n.name) >= 0;
          var choices = [['', has ? '同じ名前「' + n.name + '」を使う' : '（まだ決めていません）'], [CREATE, '新しく作る']].concat(names.map(function (x) { return [x, x]; }));
          mapBox.appendChild(mapRow(n.name, P.TYPE_JA[n.type], choices, '', function (v) { if (v) map[n.name] = v; else delete map[n.name]; compute(); }, has ? null : 'この作品には、この名前のへんすうがありません'));
        });
        var chk = h('input', { type: 'checkbox' });
        chk.addEventListener('change', function () { createMissing = chk.checked; compute(); });
        mapBox.appendChild(h('label', { class: 'check' }, chk, h('span', { class: 'box' }), '足りないへんすうは、自動で作る'));
      }
      if (comp.vars.length) {
        mapBox.appendChild(h('div', { class: 'panel-title', style: { marginTop: '8px' } }, '部品が持つへんすう', h('small', null, '出力')));
        comp.vars.forEach(function (v) {
          var clash = names.indexOf(v.name) >= 0;
          var choices = [['', clash ? '名前を変えて追加（重なっています）' : '「' + v.name + '」として追加']].concat(names.map(function (x) { return [x, '「' + x + '」に書き込む（つなぐ）']; }));
          mapBox.appendChild(mapRow(v.name, P.TYPE_JA[typeof v.value === 'number' ? 'num' : typeof v.value === 'boolean' ? 'bool' : 'text'], choices, '', function (x) { if (x) map[v.name] = x; else delete map[v.name]; compute(); }));
        });
      }
      function doInsert() {
        if (!last || !last.ok) return;
        host.apply(last.creation, { label: '部品「' + comp.name + '」を挿入', part: { id: comp.id, name: comp.name, version: comp.version }, inserted: last.inserted });
        m.close();
      }
      var io = P.ioText(comp);
      m = UI.openModal({ className: 'wide-ish', label: '部品を挿入', initialFocus: okBtn, content: h('div', { class: 'modal-inner rx-insert' },
        h('h2', { class: 'modal-title' }, '「' + comp.name + '」を挿入'),
        comp.description ? h('p', { class: 'modal-sub' }, comp.description) : null,
        comp.kind === 'stmt' ? h('p', { class: 'work-hint' }, '入る場所: ' + (host.targetLabel() || '最後のイベントの中') + '（Script 側で場所を選んでから開くと変えられます）') : h('p', { class: 'work-hint' }, '新しいイベントとして、スクリプトの最後に追加されます。'),
        comp.params.length ? [h('div', { class: 'panel-title' }, '設定値', h('small', null, '挿入前に変えられます')), paramsBox] : h('p', { class: 'work-hint' }, '変えられる設定値はありません。'),
        mapBox,
        h('div', { class: 'panel-title', style: { marginTop: '8px' } }, '確認', h('small', null, io.outputs.length ? '出力: ' + io.outputs.join('、') : '')),
        resBox,
        h('div', { class: 'modal-actions' }, UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close(); } }), okBtn)) });
      compute();
    }

    /* ---------- ブロックを部品にする ---------- */
    function makeFromSelection() {
      var id = host.selectedId();
      if (!id) { UI.toast('先に、部品にしたいブロックを Script で選んでください（中身ごと部品になります）', { type: 'warn', duration: 4200 }); return; }
      var ex = P.extract(host.get(), id, {});
      if (!ex.ok) { UI.toast(ex.error, { type: 'warn', duration: 5000 }); return; }
      var nameIn = h('input', { class: 'input', type: 'text', value: ex.comp.name, maxlength: P.LIMITS.name, 'aria-label': '部品の名前', autocomplete: 'off' });
      var descIn = h('textarea', { class: 'textarea', rows: 2, maxlength: P.LIMITS.desc, placeholder: 'どんな部品か（任意）', 'aria-label': '部品の説明' });
      var checks = [];
      var candBox = h('div', { class: 'rx-cands' });
      ex.candidates.slice(0, 40).forEach(function (c) {
        var cb = h('input', { type: 'checkbox' });
        var lab = h('input', { class: 'input', type: 'text', value: c.label, maxlength: 30, 'aria-label': c.label + ' の表示名' });
        checks.push({ c: c, cb: cb, lab: lab });
        candBox.appendChild(h('div', { class: 'rx-cand' }, h('label', { class: 'check' }, cb, h('span', { class: 'box' }), h('span', null, c.label + ' = ' + String(c.def))), lab));
      });
      var m, okBtn = UI.button('部品に保存', { kind: 'primary', icon: 'save', onclick: save });
      function save() {
        var params = [];
        checks.forEach(function (x, i) { if (x.cb.checked) params.push({ key: 'p' + (i + 1), label: x.lab.value.trim() || x.c.label, blockId: x.c.blockId, slot: x.c.slot }); });
        var s = P.make(ex.comp, { name: nameIn.value.trim() || ex.comp.name, description: descIn.value.trim(), params: params });
        if (!s.ok) { UI.toast('部品にできませんでした: ' + s.errors[0], { type: 'error', duration: 6000 }); return; }
        R.store.components.save(s.comp).then(function (saved) {
          m.close(); refresh();
          UI.toast('部品「' + saved.name + '」を保存しました。ほかの作品でも使えます。', { type: 'ok', duration: 3800 });
        }, function (e) { UI.toast('保存できませんでした: ' + ((e && e.message) || ''), { type: 'error', duration: 6000 }); });
      }
      m = UI.openModal({ className: 'wide-ish', label: '部品にする', initialFocus: nameIn, content: h('div', { class: 'modal-inner' },
        h('h2', { class: 'modal-title' }, '選んだブロックを部品にする'),
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, '名前'), nameIn),
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, '説明'), descIn),
        h('div', { class: 'panel-title' }, '入力・出力（自動で判定）'),
        h('dl', { class: 'rx-io' },
          h('dt', null, '入力'), h('dd', null, P.ioText(ex.comp).inputs.join('、') || 'なし'),
          h('dt', null, '出力'), h('dd', null, P.ioText(ex.comp).outputs.join('、') || 'なし')),
        ex.warnings && ex.warnings.length ? h('div', { class: 'notice' }, UI.icon('alert'), h('div', { class: 'grow' }, ex.warnings.join(' '))) : null,
        checks.length ? [h('div', { class: 'panel-title' }, '設定値にする入力欄', h('small', null, '挿入するときに変えられるようになります')), candBox] : h('p', { class: 'work-hint' }, '設定値にできる入力欄はありません。'),
        h('div', { class: 'modal-actions' }, UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close(); } }), okBtn)) });
    }

    /* ---------- 書き出し・削除・読み込み ---------- */
    function exportComp(c) {
      var pkg = R.io.buildComponentPackage([c]);
      U.download(new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' }), U.safeFileName(c.name, '') + '.pzremix.json');
      UI.toast('部品「' + c.name + '」を書き出しました', { type: 'ok', duration: 3000 });
    }
    function removeComp(c) {
      UI.confirm('部品「' + c.name + '」を削除しますか？', { title: '部品を削除', okText: '削除', danger: true, detail: 'すでに作品に挿入したブロックは、そのまま残ります（部品の定義だけが消えます）。' }).then(function (ok) {
        if (!ok) return;
        R.store.components.remove(c.id).then(function () { refresh(); UI.toast('部品を削除しました', { type: 'ok', duration: 2000 }); });
      });
    }
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      Q.importFile(f, { partsOnly: true }).then(function (r) { if (r) refresh(); });
    });

    /* ---------- 組み合わせ ---------- */
    function openCompose() {
      PZ.projects.list({ kind: 'creation' }).then(function (works) {
        var self = host.workId ? host.workId() : null;
        works = works.filter(function (w) { return w.id !== self; }).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
        if (!works.length) { UI.toast('組み合わせられるほかの作品がありません。先に、別の自作ツールを保存してください。', { type: 'warn', duration: 5000 }); return; }
        var src = null, scriptIds = [], map = {}, createMissing = false, last = null;
        var pick = h('select', { class: 'select', 'aria-label': '取り込む作品' }, h('option', { value: '' }, '作品を選んでください'), works.map(function (w) { return h('option', { value: w.id }, w.name); }));
        var scriptBox = h('div', { class: 'rx-cands' });
        var mapBox = h('div', { class: 'rx-mapbox' });
        var resBox = h('div');
        var okBtn = UI.button('取り込む', { kind: 'primary', icon: 'plus', disabled: true, onclick: function () { doApply(); } });
        var m;
        function compute() {
          if (!src) { U.clear(resBox); okBtn.disabled = true; return; }
          if (!scriptIds.length) { U.clear(resBox); resBox.appendChild(h('p', { class: 'work-hint' }, '取り込むスクリプトを1つ以上選んでください。')); okBtn.disabled = true; return; }
          last = P.composeWorks(host.get(), src.creation, { scriptIds: scriptIds, map: map, createMissing: createMissing, name: src.name });
          paintMap(last.comp);
          U.clear(resBox); resBox.appendChild(resultView(last));
          okBtn.disabled = !last.ok;
        }
        var mapSig = '';
        function paintMap(comp) {
          if (!comp) return;
          var sig = JSON.stringify([comp.needs, comp.vars.map(function (v) { return v.name; })]);
          if (sig === mapSig) return;
          mapSig = sig; U.clear(mapBox);
          var names = varNames(host.get());
          if (comp.needs.length) {
            mapBox.appendChild(h('div', { class: 'panel-title' }, '足りないもの', h('small', null, '取り込む側が必要とするへんすう')));
            comp.needs.forEach(function (n) {
              var has = names.indexOf(n.name) >= 0;
              var choices = [['', has ? '同じ名前「' + n.name + '」を使う' : '（まだ決めていません）'], [CREATE, '新しく作る']].concat(names.map(function (x) { return [x, x]; }));
              mapBox.appendChild(mapRow(n.name, P.TYPE_JA[n.type], choices, map[n.name] || '', function (v) { if (v) map[n.name] = v; else delete map[n.name]; compute(); }, has ? null : '不足しています'));
            });
            var chk = h('input', { type: 'checkbox' }); chk.checked = createMissing;
            chk.addEventListener('change', function () { createMissing = chk.checked; compute(); });
            mapBox.appendChild(h('label', { class: 'check' }, chk, h('span', { class: 'box' }), '足りないへんすうは、自動で作る'));
          }
          if (comp.vars.length) mapBox.appendChild(h('p', { class: 'work-hint' }, '取り込む作品のへんすう（' + comp.vars.map(function (v) { return v.name; }).join('、') + '）は、名前が重なるときだけ自動で変えて追加します。'));
        }
        pick.addEventListener('change', function () {
          var id = pick.value; src = null; scriptIds = []; map = {}; createMissing = false; mapSig = '';
          U.clear(scriptBox); U.clear(mapBox); U.clear(resBox); okBtn.disabled = true;
          if (!id) return;
          PZ.projects.get(id).then(function (w) {
            if (!w || w.kind !== 'creation') { UI.toast('作品を読み込めませんでした', { type: 'error' }); return; }
            src = { id: w.id, name: w.name, creation: w.creation, version: w.updatedAt };
            w.creation.scripts.forEach(function (s, i) {
              var cb = h('input', { type: 'checkbox' }); cb.checked = true; scriptIds.push(s.id);
              cb.addEventListener('change', function () { scriptIds = scriptIds.filter(function (x) { return x !== s.id; }); if (cb.checked) scriptIds.push(s.id); compute(); });
              scriptBox.appendChild(h('label', { class: 'check rx-script' }, cb, h('span', { class: 'box' }), h('span', null, (i + 1) + '. ' + R.blockText(s))));
            });
            compute();
          });
        });
        function doApply() {
          if (!last || !last.ok) return;
          host.apply(last.creation, { label: '作品「' + src.name + '」を組み合わせ', part: null, composed: { name: src.name } });
          m.close();
        }
        m = UI.openModal({ className: 'wide-ish', label: '作品を組み合わせる', initialFocus: pick, content: h('div', { class: 'modal-inner rx-insert' },
          h('h2', { class: 'modal-title' }, 'ほかの作品のスクリプトを取り込む'),
          h('p', { class: 'modal-sub' }, '選んだ作品はそのまま残ります。今の作品に、選んだスクリプトのコピーとへんすうが追加されます。同じ名前のへんすうは、自動で別の名前になります。'),
          h('div', { class: 'field' }, h('label', { class: 'field-label' }, '取り込む作品'), pick),
          scriptBox, mapBox,
          h('div', { class: 'panel-title', style: { marginTop: '8px' } }, '確認'), resBox,
          h('div', { class: 'modal-actions' }, UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close(); } }), okBtn)) });
      });
    }

    refresh();
    return { el: el, refresh: refresh, openInsert: openInsert, destroy: function () { alive = false; } };
  };

  /**
   * ファイル（.pzremix.json / .pzcreate.json）を検証して、確認のうえ取り込む。
   * opts.partsOnly: 作品が入っていても部品だけを取り込む。
   * 戻り値: Promise<{ work, components, history } | null>
   */
  Q.importFile = function (f, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (f.size > R.LIMITS.packageBytes) { UI.toast('ファイルが大きすぎます（' + Math.round(R.LIMITS.packageBytes / 1048576) + 'MBまで）', { type: 'error', duration: 5000 }); resolve(null); return; }
      var reader = new FileReader();
      reader.onerror = function () { UI.toast('ファイルを読み込めませんでした', { type: 'error' }); resolve(null); };
      reader.onload = function () {
        var data;
        try { data = JSON.parse(String(reader.result)); }
        catch (e) { UI.toast('JSONとして読み込めませんでした。.pzremix.json または .pzcreate.json のファイルを選んでください。何も取り込まれていません。', { type: 'error', duration: 7000 }); resolve(null); return; }
        R.io.inspect(data, f.size).then(function (rep) {
          if (opts.partsOnly && rep.ok) { rep.work = null; rep.history = []; if (!rep.components.length) { rep.ok = false; rep.errors = ['このファイルには部品が入っていません。']; } }
          return PZ.remixUI.importDialog(rep, f.name).then(function (choice) {
            if (!choice || !rep.ok) { resolve(null); return; }
            return R.io.apply(rep, choice).then(function (r) {
              var msg = [];
              if (r.work) msg.push('作品「' + r.work.name + '」');
              var c = r.components;
              if (c.added || c.copies) msg.push('部品 ' + (c.added + c.copies) + ' 個');
              if (!(opts.workToast && r.work)) UI.toast((msg.join('と') || '内容') + 'を取り込みました。', { type: 'ok', duration: 4000 });
              resolve(r);
            });
          });
        }).catch(function (e) { UI.toast('取り込めませんでした: ' + ((e && e.message) || ''), { type: 'error', duration: 6000 }); resolve(null); });
      };
      reader.readAsText(f);
    });
  };
})();
