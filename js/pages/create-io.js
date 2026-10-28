/*
 * Create — 自作ツールファイルの読み込み確認画面（PZ.creationUI）
 * 検証（Cr.inspectFile）→ 内容と警告を表示 → 承認されたときだけ取り込む。今ある作品は上書きしない。
 *   mode:'edit'  エディターに「未保存の新規」として読み込む（opts.onLoad(project)）
 *   mode:'save'  My Space に新しい作品として保存する（opts.onSaved(project)）
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Cr = PZ.creation;
  var X = (PZ.creationUI = {});

  X.importToolFile = function (data, fileName, size, opts) {
    opts = opts || {};
    var rep = Cr.inspectFile(data, size);
    var m;
    var content;
    if (!rep.ok) {
      content = h('div', { class: 'modal-inner import-modal' },
        h('h2', { class: 'modal-title' }, '読み込めませんでした'),
        h('p', { class: 'modal-sub' }, fileName),
        h('div', { class: 'notice warn', role: 'alert' }, UI.icon('alert'),
          h('div', { class: 'grow' }, rep.errors.map(function (e) { return h('div', null, e); }))),
        h('p', { class: 'modal-sub' }, '何も取り込まれていません。ファイルを書き出した人に、もう一度書き出してもらってください。'),
        h('div', { class: 'modal-actions' }, UI.button('閉じる', { kind: 'primary', onclick: function () { m.close(); } })));
      m = UI.openModal({ content: content, className: 'wide-ish', label: '読み込めませんでした' });
      return;
    }
    var s = rep.summary;
    var okBtn = UI.button(opts.mode === 'save' ? 'My Space に追加' : 'エディターに読み込む', {
      kind: 'primary', icon: opts.mode === 'save' ? 'save' : 'upload',
      onclick: function () {
        okBtn.disabled = true;
        if (opts.mode !== 'save') { m.close(); if (opts.onLoad) opts.onLoad(rep.project); return; }
        PZ.projects.list().then(function (all) {
          rep.project.name = Cr.uniqueImportName(rep.project.name, all.map(function (p) { return p.name; }));
          return PZ.projects.save(rep.project, false);
        }).then(function (saved) {
          m.close();
          UI.toast('「' + saved.name + '」を自作ツールとして追加しました', { type: 'ok', duration: 4000 });
          if (opts.onSaved) opts.onSaved(saved);
        }).catch(function (e) {
          okBtn.disabled = false;
          UI.toast('取り込みに失敗しました: ' + ((e && e.message) || ''), { type: 'error', duration: 6000 });
        });
      }
    });
    content = h('div', { class: 'modal-inner import-modal' },
      h('h2', { class: 'modal-title' }, '自作ツールの読み込み確認'),
      h('p', { class: 'modal-sub' }, fileName + (s.appVersion ? ' · アプリ v' + s.appVersion : '') + (s.exportedAt ? ' · ' + s.exportedAt + ' 書き出し' : '')),
      rep.warnings.length ? h('div', { class: 'notice warn' }, UI.icon('alert'), h('div', { class: 'grow' }, rep.warnings.map(function (w) { return h('div', null, w); }))) : null,
      h('dl', { class: 'dl import-summary' },
        h('dt', null, '名前'), h('dd', null, s.name),
        s.description ? [h('dt', null, '説明'), h('dd', null, s.description)] : null,
        h('dt', null, '構成'), h('dd', null, s.scripts + ' スクリプト / ' + s.blocks + ' ブロック / へんすう ' + s.vars + ' 個'),
        h('dt', null, '検証'), h('dd', null, '形式・ブロックの種類・値の範囲を確認しました。未対応のブロックはありません。')),
      h('div', { class: 'chip-group', 'aria-label': '使われているブロック' }, s.kinds.slice(0, 14).map(function (k) {
        return h('span', { class: 'chip chip-sm', style: { cursor: 'default' } }, k.name + ' ', h('small', null, '×' + k.count));
      })),
      h('p', { class: 'modal-sub' }, opts.mode === 'save'
        ? '新しい作品として追加します。今ある作品は上書きされません。実行はエディターで開いたときに行われます。'
        : '未保存の新しい作品としてエディターに開きます。保存するまで、今ある作品は変わりません。'),
      h('div', { class: 'modal-actions' }, UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close(); } }), okBtn));
    m = UI.openModal({ content: content, className: 'wide-ish', label: '自作ツールの読み込み確認', initialFocus: okBtn });
  };
})();
