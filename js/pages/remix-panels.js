/*
 * Remix Workspace — 画面部品（PZ.remixUI）
 *   差分の一覧 / 系統ツリー / 変更履歴 / 作品を開く / 保存前の確認 / 並べて比較 / 読み込み確認
 * データの計算は PZ.remix（core.js 他）が行い、ここは表示と操作だけを担当します。
 * 文字はすべて textContent 経由（innerHTML は使いません）。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Cr = PZ.creation;
  var R = PZ.remix;
  var X = (PZ.remixUI = {});

  function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  X.fmtBytes = fmtBytes;

  /* =============== 差分の一覧 =============== */
  var MARK = { add: '＋', del: '－', chg: '～', mov: '↔', movIn: '↔', movOut: '↔' };
  var LABEL = { add: '追加', del: '削除', chg: '変更', mov: '接続変更', movIn: '移動先', movOut: '移動元' };

  /** d: R.diff の結果。opts: { onFocus(id), all } */
  X.diffList = function (d, opts) {
    opts = opts || {};
    var host = h('div', { class: 'rx-diff' });
    host.appendChild(h('p', { class: 'rx-diff-sum' + (d.same ? ' same' : '') }, R.summarize(d)));
    if (d.same) return host;
    var items = h('div', { class: 'rx-diff-list', role: 'list' });
    if (d.name) items.appendChild(h('div', { class: 'rx-row chg', role: 'listitem' }, h('span', { class: 'rx-mark' }, MARK.chg), h('span', { class: 'rx-text' }, '名前: ', h('s', null, d.name.from), ' → ', h('b', null, d.name.to))));
    d.meta.forEach(function (m) {
      items.appendChild(h('div', { class: 'rx-row chg', role: 'listitem' }, h('span', { class: 'rx-mark' }, MARK.chg), h('span', { class: 'rx-text' }, m.label + ': ', h('s', null, m.from), ' → ', h('b', null, m.to))));
    });
    d.vars.added.forEach(function (v) { items.appendChild(h('div', { class: 'rx-row add', role: 'listitem' }, h('span', { class: 'rx-mark' }, MARK.add), h('span', { class: 'rx-text' }, 'へんすう ', h('b', null, v.name), ' = ' + v.to))); });
    d.vars.removed.forEach(function (v) { items.appendChild(h('div', { class: 'rx-row del', role: 'listitem' }, h('span', { class: 'rx-mark' }, MARK.del), h('span', { class: 'rx-text' }, 'へんすう ', h('b', null, v.name), ' = ' + v.from))); });
    d.vars.changed.forEach(function (v) { items.appendChild(h('div', { class: 'rx-row chg', role: 'listitem' }, h('span', { class: 'rx-mark' }, MARK.chg), h('span', { class: 'rx-text' }, 'へんすう ', h('b', null, v.name), ': ', h('s', null, v.from), ' → ', h('b', null, v.to)))); });
    var same = 0;
    function flush() {
      if (same && !opts.all) items.appendChild(h('div', { class: 'rx-row skip', role: 'listitem' }, '… 変更のないブロック ' + same + ' 個'));
      same = 0;
    }
    d.rows.forEach(function (r) {
      if (r.kind === 'same') {
        if (opts.all) items.appendChild(rowEl(r)); else same++;
        return;
      }
      flush();
      items.appendChild(rowEl(r));
    });
    flush();
    function rowEl(r) {
      var e = r.kind === 'del' || r.kind === 'movOut' ? r.a : r.b;
      var el = h('div', { class: 'rx-row ' + (r.kind === 'movIn' || r.kind === 'movOut' ? 'mov' : r.kind), role: 'listitem', style: { paddingLeft: (10 + e.depth * 14) + 'px' } },
        h('span', { class: 'rx-mark', title: LABEL[r.kind] || '' }, MARK[r.kind] || '・'),
        h('span', { class: 'rx-text' },
          e.bodyLabel ? h('em', null, e.bodyLabel + ': ') : null,
          r.kind === 'chg' ? [h('s', null, r.a.text), ' → ', h('b', null, r.b.text)] : e.text),
        LABEL[r.kind] ? h('small', { class: 'rx-tag' }, LABEL[r.kind]) : null);
      if (opts.onFocus && r.kind !== 'del' && r.kind !== 'movOut') {
        el.classList.add('link'); el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button');
        el.addEventListener('click', function () { opts.onFocus(r.id); });
        el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); opts.onFocus(r.id); } });
      }
      return el;
    }
    host.appendChild(items);
    return host;
  };

  /* =============== 系統ツリー =============== */
  /** roots: R.buildTree の結果（表示したい木）。h: { currentId, onOpen(project), onDerive(project) } */
  X.treeView = function (roots, o) {
    var ul = h('ul', { class: 'rx-tree', role: 'tree' });
    function node(n) {
      var p = n.project;
      var cur = n.id === o.currentId;
      var info = [];
      if (n.ghost) info.push(h('span', { class: 'badge purple' }, '削除済み'));
      else {
        if (cur) info.push(h('span', { class: 'badge' }, '今ここ'));
        if (p.remix && p.remix.origin && p.remix.origin.ver !== null && p.remix.origin.ver !== undefined) info.push(h('span', { class: 'rx-ver' }, 'v' + p.remix.origin.ver + ' から'));
        info.push(h('time', { class: 'rx-time', title: U.fmtDate(p.updatedAt) }, U.fmtDate(p.updatedAt)));
      }
      var title = h('div', { class: 'rx-node-main' }, h('b', { class: 'rx-node-name' }, n.name), info);
      var acts = h('div', { class: 'rx-node-acts' });
      if (!n.ghost) {
        acts.appendChild(UI.button('開く', { small: true, kind: 'ghost', icon: 'edit', onclick: function () { o.onOpen(p); } }));
        acts.appendChild(UI.button('ここから派生', { small: true, kind: 'ghost', icon: 'branch', onclick: function () { o.onDerive(p); } }));
      }
      var summary = !n.ghost && p.remix && p.remix.summary ? h('div', { class: 'rx-node-sum' }, p.remix.summary) : null;
      var li = h('li', { role: 'treeitem', 'aria-expanded': n.children.length ? 'true' : null },
        h('div', { class: 'rx-node' + (cur ? ' cur' : '') + (n.ghost ? ' ghost' : '') }, title, summary, acts));
      if (n.children.length) {
        var sub = h('ul', { role: 'group' });
        n.children.forEach(function (c) { sub.appendChild(node(c)); });
        li.appendChild(sub);
      }
      return li;
    }
    roots.forEach(function (r) { ul.appendChild(node(r)); });
    return ul;
  };

  /* =============== 変更履歴 =============== */
  /** list: H.list の結果。o: { currentNo, onCompare(v), onRestore(v), onPin(v) } */
  X.historyList = function (list, o) {
    var ul = h('ul', { class: 'rx-hist' });
    list.forEach(function (v) {
      var kind = R.store.history.KIND_LABEL[v.kind] || v.kind;
      ul.appendChild(h('li', { class: 'rx-hist-item' + (v.no === o.latestNo ? ' latest' : '') },
        h('div', { class: 'rx-hist-head' },
          h('b', null, 'v' + v.no), h('span', { class: 'badge' + (v.kind === 'origin' ? ' purple' : '') }, kind),
          v.pin && v.kind !== 'origin' ? h('span', { class: 'rx-pin', title: 'ピン留め（自動で消えません）' }, '📌') : null,
          h('time', { class: 'rx-time' }, U.fmtDate(v.at)), h('small', { class: 'rx-size' }, fmtBytes(v.bytes))),
        h('div', { class: 'rx-hist-name' }, v.name),
        v.summary ? h('div', { class: 'rx-hist-sum' }, v.summary) : null,
        v.note ? h('div', { class: 'rx-hist-note' }, '📝 ' + v.note) : null,
        h('div', { class: 'rx-node-acts' },
          UI.button('この版と比較', { small: true, kind: 'ghost', icon: 'eye', onclick: function () { o.onCompare(v); } }),
          UI.button('別作品として復元', { small: true, kind: 'ghost', icon: 'branch', onclick: function () { o.onRestore(v); } }),
          v.kind === 'origin' ? null : UI.button(v.pin ? 'ピンを外す' : 'ピン留め', { small: true, kind: 'ghost', onclick: function () { o.onPin(v); } }))));
    });
    return ul;
  };

  /* =============== 作品を開く =============== */
  /**
   * 作品・サンプルを選ぶ。Promise<{ type:'derive'|'edit'|'sample', project?, sampleId? } | null>
   */
  X.openDialog = function () {
    return PZ.projects.list({ kind: 'creation' }).then(function (works) {
      return new Promise(function (resolve) {
        var m;
        var children = {};
        works.forEach(function (p) { if (p.parentId) children[p.parentId] = (children[p.parentId] || 0) + 1; });
        works.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
        var q = h('input', { class: 'input', type: 'search', placeholder: '作品を検索', 'aria-label': '作品を検索', autocomplete: 'off' });
        var list = h('div', { class: 'rx-pick' });
        function pick(v) { m.close(v); }
        function paint() {
          U.clear(list);
          var term = q.value.trim().toLowerCase();
          var shown = works.filter(function (p) { return !term || p.name.toLowerCase().indexOf(term) >= 0; });
          if (!works.length) list.appendChild(h('p', { class: 'work-hint' }, 'まだ自作ツールがありません。下の「サンプル」から始めるか、Create で作って保存してください。'));
          else if (!shown.length) list.appendChild(h('p', { class: 'work-hint' }, '見つかりません。'));
          shown.forEach(function (p) {
            var st = PZ.creation.stats(p.creation);
            list.appendChild(h('div', { class: 'rx-pick-row' },
              h('div', { class: 'rx-pick-main' },
                h('b', null, p.name),
                h('small', null, st.scripts + ' スクリプト · ' + st.blocks + ' ブロック · ' + U.fmtDate(p.updatedAt) + (p.parentId ? ' · 派生' : '') + (children[p.id] ? ' · 派生が ' + children[p.id] + ' 件' : ''))),
              h('div', { class: 'rx-node-acts' },
                UI.button('派生して開く', { small: true, kind: 'primary', icon: 'branch', title: '元の作品はそのまま。保存すると新しい作品になります', onclick: function () { pick({ type: 'derive', project: p }); } }),
                UI.button('そのまま編集', { small: true, kind: 'ghost', icon: 'edit', title: 'この作品を直接編集します（保存前の状態は履歴に残ります）', onclick: function () { pick({ type: 'edit', project: p }); } }))));
          });
        }
        q.addEventListener('input', paint);
        paint();
        var samples = h('div', { class: 'rx-pick' });
        Cr.SAMPLES.forEach(function (s) {
          samples.appendChild(h('div', { class: 'rx-pick-row' },
            h('div', { class: 'rx-pick-main' }, h('b', null, s.name), h('small', null, s.summary)),
            h('div', { class: 'rx-node-acts' }, UI.button('派生して開く', { small: true, kind: 'primary', icon: 'branch', onclick: function () { pick({ type: 'sample', sampleId: s.id }); } }))));
        });
        m = UI.openModal({ className: 'wide-ish', label: '作品を開く', initialFocus: q, content: h('div', { class: 'modal-inner' },
          h('h2', { class: 'modal-title' }, '改造する作品を選ぶ'),
          h('p', { class: 'modal-sub' }, '「派生して開く」なら、元の作品は変わりません。改造した結果は新しい作品として保存されます。'),
          h('div', { class: 'panel-title' }, '自分の作品', h('small', null, works.length + ' 件')), q, list,
          h('div', { class: 'panel-title', style: { marginTop: '14px' } }, 'サンプル'), samples,
          h('div', { class: 'modal-actions' }, UI.button('閉じる', { kind: 'ghost', onclick: function () { m.close(null); } }))) });
        m.closed.then(function (v) { resolve(v); });
      });
    });
  };

  /* =============== 保存前の確認 =============== */
  /**
   * o: { title, target(文章), name, baselineLabel, diff, okText, askNote, warnOverwrite }
   * Promise<{ name, note } | null>
   */
  X.saveDialog = function (o) {
    return new Promise(function (resolve) {
      var m;
      var nameIn = h('input', { class: 'input', type: 'text', value: o.name, maxlength: PZ.config.limits.projectNameLength, 'aria-label': '作品名', autocomplete: 'off' });
      var noteIn = h('input', { class: 'input', type: 'text', maxlength: R.LIMITS.note, placeholder: '例: 色を虹色にした（任意）', 'aria-label': '変更メモ', autocomplete: 'off' });
      function go() { m.close({ name: nameIn.value.trim() || o.name, note: noteIn.value.trim() }); }
      [nameIn, noteIn].forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } }); });
      var ok = UI.button(o.okText || '保存する', { kind: o.warnOverwrite ? 'danger' : 'primary', icon: 'save', onclick: go });
      m = UI.openModal({ className: 'wide-ish', label: o.title || '保存の確認', initialFocus: noteIn, content: h('div', { class: 'modal-inner' },
        h('h2', { class: 'modal-title' }, o.title || '保存の確認'),
        h('div', { class: 'notice' + (o.warnOverwrite ? ' warn' : ''), style: { marginTop: '0' } }, UI.icon(o.warnOverwrite ? 'alert' : 'branch'), h('div', { class: 'grow' }, o.target)),
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, '作品名'), nameIn),
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, '変更メモ'), noteIn),
        h('div', { class: 'panel-title' }, '変更内容', h('small', null, o.baselineLabel)),
        h('div', { class: 'rx-confirm-diff' }, X.diffList(o.diff, {})),
        h('div', { class: 'modal-actions' }, UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close(null); } }), ok)) });
      m.closed.then(function (v) { resolve(v); });
    });
  };

  /* =============== 並べて比較 =============== */
  /**
   * a, b: { creation, label }。2つを同じ条件（同じ乱数の種）で同時に動かして並べる。
   * 片方の上でマウスを動かすと、両方に伝わる。閉じると止まる。
   */
  X.compareDialog = function (a, b, d) {
    var m, raf = 0, alive = true, running = true, last = 0;
    var dpr = 1;
    function mk(side) {
      var cv = h('canvas', { class: 'rx-cmp-canvas', role: 'img', 'aria-label': side.label + ' のプレビュー' });
      cv.width = side.creation.canvas.w; cv.height = side.creation.canvas.h;
      cv.style.aspectRatio = side.creation.canvas.w + ' / ' + side.creation.canvas.h;
      var g = cv.getContext('2d');
      var rt = new Cr.Runtime(side.creation, g, { seed: 7, font: PZ.model.FONT_STACK });
      rt.start();
      return { cv: cv, g: g, rt: rt, side: side, err: h('div', { class: 'cr-err', hidden: true, role: 'alert' }) };
    }
    var A = mk(a), Bb = mk(b);
    var all = [A, Bb];
    function show(x) {
      var e = x.rt.state === 'error' ? x.rt.error : null;
      x.err.hidden = !e; U.clear(x.err);
      if (e) x.err.appendChild(h('p', null, 'この版はエラーで止まりました: ' + e.message));
    }
    all.forEach(function (x) {
      show(x);
      function pos(e) { var r = x.cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
      function fwd(kind, e) { var p = pos(e); all.forEach(function (y) { y.rt.pointer(kind, p[0] * y.rt.W, p[1] * y.rt.H); }); }
      x.cv.addEventListener('pointermove', function (e) { fwd('move', e); });
      x.cv.addEventListener('pointerdown', function (e) { fwd('down', e); });
      x.cv.addEventListener('pointerup', function (e) { fwd('up', e); });
      x.cv.addEventListener('pointerleave', function () { all.forEach(function (y) { y.rt.pointer('leave'); }); });
    });
    function frame(t) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (!running || document.hidden) { last = 0; return; }
      if (last) { var dt = t - last; if (dt < 14) return; all.forEach(function (x) { x.rt.tick(dt); if (x.rt.state === 'error') show(x); }); }
      last = t;
    }
    var playBtn = UI.button('一時停止', { icon: 'pause', kind: 'ghost', small: true, onclick: function () {
      running = !running; playBtn.replaceChildren(UI.icon(running ? 'pause' : 'play'), h('span', { class: 'btn-label' }, running ? '一時停止' : '再開'));
    } });
    var resetBtn = UI.button('最初から', { icon: 'reset', kind: 'ghost', small: true, onclick: function () { all.forEach(function (x) { x.rt.start(); show(x); }); } });
    function col(x, tag) {
      return h('div', { class: 'rx-cmp-col' }, h('div', { class: 'rx-cmp-tag' }, h('span', { class: 'badge' + (tag === 'AFTER' ? '' : ' purple') }, tag), h('b', null, x.side.label)), h('div', { class: 'lab-stage' }, x.cv), x.err);
    }
    m = UI.openModal({ className: 'wide', label: '変更前と変更後の比較', content: h('div', { class: 'modal-inner rx-cmp' },
      h('h2', { class: 'modal-title' }, '変更前と変更後を比べる'),
      h('p', { class: 'modal-sub' }, '同じ条件（乱数の種）で同時に動かしています。どちらかの上でマウスを動かす・クリックすると、両方に伝わります。'),
      h('div', { class: 'rx-cmp-grid' }, col(A, 'BEFORE'), col(Bb, 'AFTER')),
      h('div', { class: 'rx-cmp-ctl' }, playBtn, resetBtn),
      d ? h('div', { class: 'rx-confirm-diff' }, X.diffList(d, {})) : null,
      h('div', { class: 'modal-actions' }, UI.button('閉じる', { kind: 'primary', onclick: function () { m.close(); } }))) });
    raf = requestAnimationFrame(frame);
    m.closed.then(function () { alive = false; cancelAnimationFrame(raf); all.forEach(function (x) { x.rt.stop(); }); });
    return m;
  };

  /* =============== 読み込みの確認（Remix パッケージ・自作ツールファイル） =============== */
  /** rep: R.io.inspect の結果。Promise<{ ok, result }>（キャンセルは null） */
  X.importDialog = function (rep, fileName) {
    return new Promise(function (resolve) {
      var m;
      if (!rep.ok) {
        m = UI.openModal({ className: 'wide-ish', label: '読み込めませんでした', content: h('div', { class: 'modal-inner import-modal' },
          h('h2', { class: 'modal-title' }, '読み込めませんでした'),
          h('p', { class: 'modal-sub' }, fileName),
          h('div', { class: 'notice warn', role: 'alert' }, UI.icon('alert'), h('div', { class: 'grow' }, rep.errors.map(function (e) { return h('div', null, e); }))),
          h('p', { class: 'modal-sub' }, '何も取り込まれていません。ファイルを書き出した人に、もう一度書き出してもらってください。'),
          h('div', { class: 'modal-actions' }, UI.button('閉じる', { kind: 'primary', onclick: function () { m.close(null); } }))) });
        m.closed.then(function () { resolve(null); });
        return;
      }
      var s = rep.summary;
      var compChk = h('input', { type: 'checkbox' }); compChk.checked = true;
      var histChk = h('input', { type: 'checkbox' }); histChk.checked = true;
      var okBtn = UI.button('取り込む', { kind: 'primary', icon: 'upload', onclick: function () { m.close({ components: compChk.checked, history: histChk.checked }); } });
      m = UI.openModal({ className: 'wide-ish', label: '読み込みの確認', initialFocus: okBtn, content: h('div', { class: 'modal-inner import-modal' },
        h('h2', { class: 'modal-title' }, '読み込みの確認'),
        h('p', { class: 'modal-sub' }, fileName + (s.appVersion ? ' · アプリ v' + s.appVersion : '') + (s.exportedAt ? ' · ' + s.exportedAt + ' 書き出し' : '')),
        rep.warnings.length ? h('div', { class: 'notice warn' }, UI.icon('alert'), h('div', { class: 'grow' }, rep.warnings.map(function (w) { return h('div', null, w); }))) : null,
        h('dl', { class: 'dl import-summary' },
          rep.work ? [h('dt', null, '作品'), h('dd', null, s.name),
            h('dt', null, '構成'), h('dd', null, s.scripts + ' スクリプト / ' + s.blocks + ' ブロック / へんすう ' + s.vars + ' 個'),
            rep.work.project.remix && rep.work.project.remix.origin ? [h('dt', null, '派生元'), h('dd', null, rep.work.project.remix.origin.name || '（名前なし）')] : null] : null,
          h('dt', null, '履歴'), h('dd', null, s.history ? s.history + ' 件' : 'なし'),
          h('dt', null, '部品'), h('dd', null, rep.components.length ? rep.components.map(function (c) { return c.comp.name + '（' + (c.status === 'same' ? '手元にあります' : c.status === 'copy' ? '別の部品として追加' : '新規') + '）'; }).join('、') : 'なし')),
        rep.missing.length ? h('p', { class: 'work-hint' }, '不足している部品: ' + rep.missing.map(function (x) { return x.name || x.id; }).join('、')) : null,
        rep.history.length ? h('label', { class: 'check' }, histChk, h('span', { class: 'box' }), '変更履歴も取り込む') : null,
        rep.components.some(function (c) { return c.status !== 'same'; }) ? h('label', { class: 'check' }, compChk, h('span', { class: 'box' }), '部品も取り込む') : null,
        h('p', { class: 'modal-sub' }, rep.work ? '新しい作品として追加します。今ある作品は上書きされません。ファイルの中身は、許可されたブロックとしてだけ読み込まれ、プログラムとして実行されることはありません。' : '部品ライブラリに追加します。'),
        h('div', { class: 'modal-actions' }, UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close(null); } }), okBtn)) });
      m.closed.then(function (v) { resolve(v); });
    });
  };
})();
