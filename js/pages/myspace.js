/*
 * My Space — 保存した作品の一覧・検索・整理（お気に入り/タグ/コレクション）・プレビュー・複製・バックアップ
 *  作品は Studio の作品と、実験ツールの作品（設定を保存した再編集できる作品）の両方が並ぶ。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.pages = PZ.pages || {};
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Router = PZ.router;
  var C = PZ.config;

  var SORTS = [
    { id: 'updated', label: '更新が新しい順', fn: function (a, b) { return b.updatedAt - a.updatedAt; } },
    { id: 'updated-asc', label: '更新が古い順', fn: function (a, b) { return a.updatedAt - b.updatedAt; } },
    { id: 'created', label: '作成が新しい順', fn: function (a, b) { return b.createdAt - a.createdAt; } },
    { id: 'created-asc', label: '作成が古い順', fn: function (a, b) { return a.createdAt - b.createdAt; } },
    { id: 'opened', label: '最近開いた順', fn: function (a, b) { return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0); } },
    { id: 'name', label: '名前順（あ→Z）', fn: function (a, b) { return a.name.localeCompare(b.name, 'ja'); } },
    { id: 'name-desc', label: '名前順（Z→あ）', fn: function (a, b) { return b.name.localeCompare(a.name, 'ja'); } }
  ];
  var KINDS = [{ id: '', label: 'すべて' }, { id: 'studio', label: 'Studio' }, { id: 'experiment', label: '実験' }, { id: 'creation', label: 'Create' }];
  var PAGE = 60;

  PZ.pages.space = {
    title: 'My Space',
    nav: 'space',
    mount: function (root, ctx) {
      var all = [], collections = [];
      var st = { q: '', sort: 'updated', kind: '', favOnly: false, tags: [], collection: '', shown: PAGE };
      var alive = true;
      var listHost = h('div');
      var recentHost = h('div');
      var statHost = h('div', { class: 'stat-row' });
      var noticeHost = h('div');
      var tagHost = h('div', { class: 'chip-group', role: 'group', 'aria-label': 'タグで絞り込み' });
      var fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-hidden': 'true' });

      /* ---- ツールバー ---- */
      var search = h('input', { class: 'input search', type: 'search', placeholder: '名前・タグ・ツール名で検索', 'aria-label': '作品を検索' });
      search.addEventListener('input', function () { st.q = search.value.trim().toLowerCase(); st.shown = PAGE; renderList(); });
      var sortSel = h('select', { class: 'select', 'aria-label': '並び替え' }, SORTS.map(function (s) { return h('option', { value: s.id }, s.label); }));
      sortSel.addEventListener('change', function () { st.sort = sortSel.value; renderList(); });
      var kindSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '作品の種類' });
      KINDS.forEach(function (k) {
        var b = h('button', { type: 'button', 'aria-pressed': String(st.kind === k.id), onclick: function () { st.kind = k.id; st.shown = PAGE; paintKinds(); renderList(); } }, k.label);
        b._id = k.id; kindSeg.appendChild(b);
      });
      function paintKinds() { Array.prototype.forEach.call(kindSeg.children, function (b) { b.setAttribute('aria-pressed', String(b._id === st.kind)); }); }
      var favChip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: function () { st.favOnly = !st.favOnly; favChip.setAttribute('aria-pressed', String(st.favOnly)); st.shown = PAGE; renderList(); } }, UI.icon('heart'), 'お気に入り');
      var colSel = h('select', { class: 'select', 'aria-label': 'コレクションで絞り込み' });
      colSel.addEventListener('change', function () { st.collection = colSel.value; st.shown = PAGE; renderList(); });
      var colManage = UI.iconButton('folder', 'コレクションを管理', function () { manageCollections(); });

      var toolbar = h('div', { class: 'space-toolbar' },
        search, sortSel, h('span', { class: 'grow' }),
        UI.button('読み込み', { icon: 'upload', kind: 'ghost', title: 'プロジェクトデータ(JSON)を読み込む', onclick: function () { fileInput.click(); } }),
        UI.button('バックアップ', { icon: 'download', kind: 'ghost', title: 'すべての作品をプロジェクトデータ(JSON)として書き出す', onclick: function () { doBackup(); } }),
        UI.button('新しく作る', { icon: 'plus', kind: 'primary', onclick: function () { Router.go('/studio/new'); } }));
      var filterRow = h('div', { class: 'space-filters' }, kindSeg, favChip, h('span', { class: 'col-wrap' }, colSel, colManage));

      root.appendChild(h('div', { class: 'container', style: { paddingBottom: '8px' } },
        h('header', { class: 'page-head' },
          h('div', { class: 'crumbs' }, 'My Space'),
          h('h1', { class: 'page-title' }, '自分の基地 ', h('em', null, 'MY SPACE')),
          h('p', { class: 'page-lead' }, '保存した作品はここに並びます。開いて続きを編集したり、複製して別案を作ったり。お気に入り・タグ・コレクションで整理できます。'),
          statHost),
        noticeHost,
        h('div', { class: 'section', style: { paddingTop: '26px' } }, toolbar, filterRow, tagHost, recentHost, listHost, fileInput)));

      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (f) importFile(f);
      });

      /* ---- データ ---- */
      function load() {
        return Promise.all([PZ.projects.list(), PZ.projects.collections()]).then(function (r) {
          if (!alive) return;
          all = r[0]; collections = r[1];
          if (st.collection && !collections.some(function (c) { return c.id === st.collection; })) st.collection = '';
          renderStats(); renderNotice(); paintCollections(); renderTags(); renderList();
        }).catch(function (e) {
          if (!alive) return;
          U.clear(listHost);
          listHost.appendChild(UI.emptyState('作品を読み込めませんでした', (e && e.message) || '', [UI.button('再読み込み', { icon: 'reset', kind: 'primary', onclick: load })]));
        });
      }

      function colName(id) { var c = collections.filter(function (x) { return x.id === id; })[0]; return c ? c.name : ''; }

      function renderStats() {
        U.clear(statHost);
        var hl = PZ.projects.health();
        var exp = all.filter(function (p) { return p.kind === 'experiment'; }).length;
        var cre = all.filter(function (p) { return p.kind === 'creation'; }).length;
        statHost.appendChild(h('span', null, 'WORKS ', h('b', null, String(all.length))));
        statHost.appendChild(h('span', null, 'STUDIO ', h('b', null, String(all.length - exp - cre))));
        statHost.appendChild(h('span', null, 'EXPERIMENTS ', h('b', null, String(exp))));
        statHost.appendChild(h('span', null, 'CREATE ', h('b', null, String(cre))));
        statHost.appendChild(h('span', null, '★ ', h('b', null, String(all.filter(function (p) { return p.favorite; }).length))));
        statHost.appendChild(h('span', null, 'STORAGE ', h('b', null, hl.label + (PZ.projects.persisted ? ' · 保護済み' : ''))));
      }

      function renderNotice() {
        U.clear(noticeHost);
        var hl = PZ.projects.health();
        if (!hl.ok) {
          noticeHost.appendChild(h('div', { class: 'notice warn', role: 'alert' }, UI.icon('alert'),
            h('div', { class: 'grow' }, hl.kind === 'memory'
              ? 'このブラウザでは保存機能が使えません。作品はタブを閉じると消えます。こまめにバックアップを書き出してください。'
              : '代替保存で動作中です（容量が小さめです）。バックアップをこまめに書き出してください。'),
            UI.button('バックアップ', { icon: 'download', small: true, onclick: function () { doBackup(); } })));
          return;
        }
        if (!all.length) return;
        PZ.projects.lastBackupAt().then(function (t) {
          if (!alive) return;
          var days = t ? (Date.now() - t) / 86400000 : Infinity;
          if (days < C.backupReminderDays) return;
          U.clear(noticeHost);
          noticeHost.appendChild(h('div', { class: 'notice' }, UI.icon('alert'),
            h('div', { class: 'grow' }, t
              ? '前回のバックアップから ' + Math.floor(days) + ' 日たちました。作品はこのブラウザの中にだけ保存されています。'
              : '作品はこのブラウザの中にだけ保存されています。ブラウザのデータ削除や端末の変更で失われないよう、ファイルにバックアップしておきましょう。'),
            UI.button('バックアップを書き出す', { icon: 'download', small: true, kind: 'purple', onclick: function () { doBackup(); } })));
        }).catch(function () { /* 通知はなくても動く */ });
      }

      function paintCollections() {
        U.clear(colSel);
        colSel.appendChild(h('option', { value: '' }, 'すべてのコレクション'));
        collections.forEach(function (c) {
          var n = all.filter(function (p) { return p.collections.indexOf(c.id) >= 0; }).length;
          colSel.appendChild(h('option', { value: c.id }, c.name + '（' + n + '）'));
        });
        colSel.value = st.collection;
      }

      function renderTags() {
        U.clear(tagHost);
        var counts = PZ.projects.tagCounts(all).slice(0, 24);
        st.tags = st.tags.filter(function (t) { return counts.some(function (c) { return c.tag === t; }); });
        if (!counts.length) return;
        tagHost.appendChild(h('span', { class: 'lib-filter-label' }, 'TAG'));
        counts.forEach(function (c) {
          var on = st.tags.indexOf(c.tag) >= 0;
          tagHost.appendChild(h('button', { type: 'button', class: 'chip chip-sm', 'aria-pressed': String(on), onclick: function () {
            var i = st.tags.indexOf(c.tag); if (i >= 0) st.tags.splice(i, 1); else st.tags.push(c.tag);
            st.shown = PAGE; renderTags(); renderList();
          } }, '#' + c.tag + ' ', h('small', null, String(c.count))));
        });
      }

      /* ---- 一覧 ---- */
      function matches(p) {
        if (st.kind && p.kind !== st.kind) return false;
        if (st.favOnly && !p.favorite) return false;
        if (st.collection && p.collections.indexOf(st.collection) < 0) return false;
        if (st.tags.length && !st.tags.every(function (t) { return p.tags.indexOf(t) >= 0; })) return false;
        if (st.q) {
          var tool = p.kind === 'experiment' ? ((PZ.registry.get(p.tool) || {}).name || p.tool) : (p.kind === 'creation' ? 'create 自作ツール ブロック ' + (p.creation.description || '') : 'studio');
          var hay = (p.name + ' ' + p.tags.join(' ') + ' ' + tool + ' ' + p.collections.map(colName).join(' ')).toLowerCase();
          return st.q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
        }
        return true;
      }
      function filtersActive() { return !!(st.q || st.kind || st.favOnly || st.tags.length || st.collection); }

      function card(p, opts) {
        opts = opts || {};
        var thumb = h('div', { class: 'work-thumb checker' });
        thumb.appendChild(h('span', { class: 'badge' + (p.kind === 'experiment' ? ' purple' : (p.kind === 'creation' ? ' pink' : '')) }, PZ.workKit.kindLabel(p)));
        var content = h('div', { class: 'work-thumb-inner' });
        thumb.appendChild(content);
        var fav = h('button', { type: 'button', class: 'fav-btn on-thumb', 'aria-pressed': String(p.favorite), title: p.favorite ? 'お気に入りから外す' : 'お気に入りに追加', 'aria-label': '「' + p.name + '」' + (p.favorite ? 'をお気に入りから外す' : 'をお気に入りに追加'), onclick: function (e) {
          e.stopPropagation(); toggleFav(p);
        } }, UI.icon('heart'));
        var tags = h('div', { class: 'work-tags' }, p.tags.slice(0, 3).map(function (t) {
          return h('button', { type: 'button', class: 'tag-pill', title: '#' + t + ' で絞り込む', onclick: function () { if (st.tags.indexOf(t) < 0) st.tags.push(t); st.shown = PAGE; renderTags(); renderList(); } }, '#' + t);
        }));
        if (p.tags.length > 3) tags.appendChild(h('span', { class: 'tag-more' }, '+' + (p.tags.length - 3)));
        var meta2;
        if (p.kind === 'creation') { var cs = PZ.creation.stats(p.creation); meta2 = cs.scripts + ' スクリプト · ' + cs.blocks + ' ブロック' + (p.parentId ? ' · 派生' : ''); }
        else if (p.kind === 'experiment') meta2 = (PZ.registry.get(p.tool) ? PZ.registry.get(p.tool).name : p.tool) + (p.parentId ? ' · 派生' : '');
        else meta2 = p.objects.length + ' オブジェクト' + (p.parentId ? ' · 派生' : '');
        var el = h('article', { class: 'card hoverable work-card' },
          h('div', { class: 'work-wrap' },
            h('a', { class: 'work-open', href: Router.href(PZ.projects.hrefFor(p)), 'aria-label': '「' + p.name + '」を開いて編集' },
              thumb,
              h('div', { class: 'work-info' },
                h('div', { class: 'work-name' }, p.name),
                h('div', { class: 'work-meta' }, '更新 ' + U.fmtDate(p.updatedAt)),
                h('div', { class: 'work-meta' }, meta2 + (U.relTime(p.lastOpenedAt) ? ' · ' + U.relTime(p.lastOpenedAt) + 'に開いた' : '')))),
            fav),
          p.tags.length ? tags : null,
          opts.compact ? null : h('div', { class: 'work-actions' },
            UI.iconButton('eye', 'プレビュー', function () { preview(p); }),
            UI.iconButton('edit', '開いて編集', function () { Router.go(PZ.projects.hrefFor(p)); }),
            p.kind === 'creation' ? UI.iconButton('branch', 'Remixで開く（派生して改造）', function () { Router.go('/remix?from=' + encodeURIComponent(p.id)); }) : null,
            UI.iconButton('copy', '複製', function () { dup(p); }),
            UI.iconButton('tag', 'タグを編集', function () { editTags(p); }),
            UI.iconButton('folder', 'コレクションに入れる', function () { editCollections(p); }),
            h('span', { class: 'spacer' }),
            UI.iconButton('trash', '削除', function () { del(p); }, 'danger')));
        PZ.workKit.drawThumb(content, p);
        return el;
      }

      function renderList() {
        U.clear(listHost); U.clear(recentHost);
        if (!all.length) {
          listHost.appendChild(UI.emptyState('まだ作品がありません', 'Studioで最初の1枚を作るか、Labの実験・Createの自作ツールを保存するか、バックアップファイルを読み込んでください。',
            [UI.button('新しく作る', { icon: 'plus', kind: 'primary', onclick: function () { Router.go('/studio/new'); } }),
              UI.button('Labで遊ぶ', { icon: 'lab', kind: 'ghost', onclick: function () { Router.go('/lab'); } }),
              UI.button('ブロックで作る', { icon: 'blocks', kind: 'ghost', onclick: function () { Router.go('/create'); } })]));
          return;
        }
        var sort = SORTS.filter(function (s) { return s.id === st.sort; })[0];
        var shown = all.filter(matches).sort(sort.fn);

        // 最近開いた作品（絞り込み中は出さない）
        if (!filtersActive()) {
          var rec = all.filter(function (p) { return p.lastOpenedAt; }).sort(SORTS[4].fn).slice(0, 4);
          if (rec.length) {
            var rg = h('div', { class: 'work-grid recent-grid' });
            rec.forEach(function (p) { rg.appendChild(card(p, { compact: true })); });
            recentHost.appendChild(h('section', { class: 'recent-section', 'aria-label': '最近開いた作品' },
              h('div', { class: 'panel-title', style: { margin: '6px 0 12px' } }, 'Recently Opened', h('small', null, '最近開いた作品')), rg));
          }
        }

        listHost.appendChild(h('div', { class: 'result-count' }, shown.length + ' 件' + (filtersActive() ? '（全 ' + all.length + ' 件中）' : '')));
        if (!shown.length) {
          listHost.appendChild(UI.emptyState('条件に一致する作品はありません', '検索語や絞り込みを変えてみてください。',
            [UI.button('絞り込みを解除', { icon: 'reset', kind: 'primary', onclick: clearFilters })]));
          return;
        }
        var grid = h('div', { class: 'work-grid' });
        shown.slice(0, st.shown).forEach(function (p) { grid.appendChild(card(p)); });
        listHost.appendChild(grid);
        if (shown.length > st.shown) {
          listHost.appendChild(h('div', { style: { marginTop: '20px', textAlign: 'center' } },
            UI.button('さらに表示（残り ' + (shown.length - st.shown) + ' 件）', { kind: 'ghost', icon: 'down', onclick: function () { st.shown += PAGE; renderList(); } })));
        }
      }

      function clearFilters() {
        st.q = ''; st.kind = ''; st.favOnly = false; st.tags = []; st.collection = ''; st.shown = PAGE;
        search.value = ''; paintKinds(); favChip.setAttribute('aria-pressed', 'false'); colSel.value = '';
        renderTags(); renderList();
      }

      /* ---- 操作 ---- */
      function replaceLocal(updated) {
        all = all.map(function (x) { return x.id === updated.id ? updated : x; });
      }
      function toggleFav(p) {
        PZ.projects.setFavorite(p.id, !p.favorite).then(function (u) { replaceLocal(u); renderStats(); renderList(); })
          .catch(function (e) { UI.toast('お気に入りを変更できませんでした: ' + (e && e.message), { type: 'error' }); });
      }

      function dup(p) {
        PZ.projects.duplicate(p).then(function (c) {
          UI.toast('「' + c.name + '」を作りました（元の作品はそのままです）', { type: 'ok' });
          return load();
        }).catch(function (e) { UI.toast('複製できませんでした: ' + (e && e.message), { type: 'error' }); });
      }

      function del(p) {
        UI.confirm('「' + p.name + '」を削除しますか？', { title: '作品を削除', okText: '削除する', danger: true, detail: '削除直後なら、画面下の「元に戻す」で復元できます。' })
          .then(function (ok) {
            if (!ok) return;
            return PZ.projects.remove(p.id).then(function (rec) {
              all = all.filter(function (x) { return x.id !== p.id; });
              renderStats(); renderTags(); renderList();
              UI.toast('「' + p.name + '」を削除しました', {
                type: 'info', duration: 8000,
                action: { label: '元に戻す', onClick: function () { PZ.projects.restore(rec).then(load).then(function () { UI.toast('復元しました', { type: 'ok', duration: 1600 }); }); } }
              });
            });
          }).catch(function (e) { UI.toast('削除できませんでした: ' + (e && e.message), { type: 'error' }); });
      }

      function editTags(p) {
        var m;
        var input = h('input', { class: 'input', type: 'text', value: p.tags.join(' '), maxlength: 200, placeholder: 'スペースか、で区切って入力', 'aria-label': 'タグ', autocomplete: 'off' });
        var existing = PZ.projects.tagCounts(all).filter(function (t) { return p.tags.indexOf(t.tag) < 0; }).slice(0, 12);
        function parse() { return PZ.model.cleanTags(input.value.split(/[\s,、，]+/)); }
        function save() {
          var tags = parse();
          PZ.projects.setTags(p.id, tags).then(function (u) { replaceLocal(u); m.close(); renderTags(); renderList(); UI.toast('タグを保存しました', { type: 'ok', duration: 1400 }); })
            .catch(function (e) { UI.toast('タグを保存できませんでした: ' + (e && e.message), { type: 'error' }); });
        }
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } });
        var content = h('div', { class: 'modal-inner' },
          h('h2', { class: 'modal-title' }, 'タグを編集'),
          h('p', { class: 'modal-sub' }, '「' + p.name + '」 · 最大 ' + C.limits.tags + ' 個、1つ ' + C.limits.tagLength + ' 文字まで'),
          input,
          existing.length ? h('div', { class: 'chip-group' }, existing.map(function (t) {
            return h('button', { type: 'button', class: 'chip chip-sm', onclick: function () { input.value = (input.value.trim() + ' ' + t.tag).trim(); input.focus(); } }, '+ #' + t.tag);
          })) : null,
          h('div', { class: 'modal-actions' }, UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close(); } }), UI.button('保存', { kind: 'primary', onclick: save })));
        m = UI.openModal({ content: content, label: 'タグを編集', initialFocus: input });
      }

      function editCollections(p) {
        var m, chosen = p.collections.slice();
        var listEl = h('div', { class: 'col-list' });
        var newInput = h('input', { class: 'input', type: 'text', maxlength: C.limits.collectionNameLength, placeholder: '新しいコレクション名', 'aria-label': '新しいコレクション名', autocomplete: 'off' });
        function paint() {
          U.clear(listEl);
          if (!collections.length) listEl.appendChild(h('p', { class: 'muted', style: { fontSize: '13px' } }, 'コレクションはまだありません。下で作成できます。'));
          collections.forEach(function (c) {
            var cb = h('input', { type: 'checkbox' });
            cb.checked = chosen.indexOf(c.id) >= 0;
            cb.addEventListener('change', function () { if (cb.checked) { if (chosen.indexOf(c.id) < 0) chosen.push(c.id); } else chosen = chosen.filter(function (x) { return x !== c.id; }); });
            listEl.appendChild(h('label', { class: 'check' }, cb, h('span', { class: 'box' }), c.name));
          });
        }
        function addNew() {
          var v = newInput.value.trim(); if (!v) return;
          PZ.projects.createCollection(v).then(function (c) {
            if (collections.every(function (x) { return x.id !== c.id; })) collections.push(c);
            if (chosen.indexOf(c.id) < 0) chosen.push(c.id);
            newInput.value = ''; paint();
          }).catch(function (e) { UI.toast((e && e.message) || '作成できませんでした', { type: 'error' }); });
        }
        newInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addNew(); } });
        function save() {
          PZ.projects.setCollections(p.id, chosen).then(function (u) { replaceLocal(u); m.close(); paintCollections(); renderList(); UI.toast('コレクションを更新しました', { type: 'ok', duration: 1400 }); })
            .catch(function (e) { UI.toast('保存できませんでした: ' + (e && e.message), { type: 'error' }); });
        }
        paint();
        var content = h('div', { class: 'modal-inner' },
          h('h2', { class: 'modal-title' }, 'コレクションに入れる'),
          h('p', { class: 'modal-sub' }, '「' + p.name + '」'),
          listEl,
          h('div', { class: 'seed-row' }, newInput, UI.button('作成', { kind: 'ghost', small: true, onclick: addNew })),
          h('div', { class: 'modal-actions' }, UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close(); } }), UI.button('保存', { kind: 'primary', onclick: save })));
        m = UI.openModal({ content: content, label: 'コレクションに入れる' });
      }

      function manageCollections() {
        var m;
        var listEl = h('div', { class: 'col-manage' });
        var newInput = h('input', { class: 'input', type: 'text', maxlength: C.limits.collectionNameLength, placeholder: '新しいコレクション名', 'aria-label': '新しいコレクション名', autocomplete: 'off' });
        function paint() {
          U.clear(listEl);
          if (!collections.length) listEl.appendChild(h('p', { class: 'muted' }, 'まだコレクションがありません。'));
          collections.forEach(function (c) {
            var n = all.filter(function (p) { return p.collections.indexOf(c.id) >= 0; }).length;
            listEl.appendChild(h('div', { class: 'col-row' },
              h('span', { class: 'col-name' }, c.name, h('small', null, ' ' + n + ' 件')),
              UI.iconButton('edit', '名前を変更', function () {
                UI.promptText({ title: 'コレクション名を変更', value: c.name, maxLength: C.limits.collectionNameLength }).then(function (v) {
                  if (!v) return;
                  return PZ.projects.renameCollection(c.id, v).then(function () { c.name = v; paint(); paintCollections(); renderList(); });
                }).catch(function (e) { UI.toast((e && e.message) || '変更できませんでした', { type: 'error' }); });
              }),
              UI.iconButton('trash', 'コレクションを削除', function () {
                UI.confirm('コレクション「' + c.name + '」を削除しますか？', { title: 'コレクションを削除', okText: '削除する', danger: true, detail: '中の作品は削除されません。コレクションへの所属だけ外れます。' }).then(function (ok) {
                  if (!ok) return;
                  return PZ.projects.removeCollection(c.id).then(load).then(function () { paint(); UI.toast('コレクションを削除しました', { type: 'info', duration: 1600 }); });
                }).catch(function (e) { UI.toast((e && e.message) || '削除できませんでした', { type: 'error' }); });
              }, 'danger')));
          });
        }
        function addNew() {
          var v = newInput.value.trim(); if (!v) return;
          PZ.projects.createCollection(v).then(function (c) {
            if (collections.every(function (x) { return x.id !== c.id; })) collections.push(c);
            newInput.value = ''; paint(); paintCollections();
          }).catch(function (e) { UI.toast((e && e.message) || '作成できませんでした', { type: 'error' }); });
        }
        newInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addNew(); } });
        paint();
        m = UI.openModal({ label: 'コレクションの管理', content: h('div', { class: 'modal-inner' },
          h('h2', { class: 'modal-title' }, 'コレクションの管理'),
          listEl,
          h('div', { class: 'seed-row' }, newInput, UI.button('作成', { kind: 'ghost', small: true, onclick: addNew })),
          h('div', { class: 'modal-actions' }, UI.button('閉じる', { kind: 'primary', onclick: function () { m.close(); } }))) });
      }

      /* ---- プレビュー ---- */
      function imageBlob(p) {
        if (p.kind === 'creation') {
          return new Promise(function (resolve, reject) {
            var c = document.createElement('canvas');
            try { PZ.creation.renderToCanvas(p.creation, c, { frames: 45, scale: 2 }); } catch (e) { reject(e); return; }
            c.toBlob(function (b) { b ? resolve(b) : reject(new Error('画像を作れませんでした')); }, 'image/png');
          });
        }
        if (p.kind === 'experiment') {
          var lab = PZ.labs[p.tool];
          if (!lab || !lab.render) return Promise.reject(new Error('この実験の画像を再生成できません'));
          return new Promise(function (resolve, reject) {
            var c = document.createElement('canvas'); c.width = 2400; c.height = 1500;
            try { lab.render(c.getContext('2d'), c.width, c.height, lab.normalize(p.params || {})); } catch (e) { reject(e); return; }
            c.toBlob(function (b) { b ? resolve(b) : reject(new Error('画像を作れませんでした')); }, 'image/png');
          });
        }
        return PZ.render.exportPng(p, 2);
      }

      function preview(p) {
        var stageEl = h('div', { class: 'preview-stage checker' });
        var m;
        var tool = p.kind === 'experiment' ? PZ.registry.get(p.tool) : null;
        var cst = p.kind === 'creation' ? PZ.creation.stats(p.creation) : null;
        var side = h('div', { class: 'preview-side' },
          h('h2', null, p.name),
          p.kind === 'creation' && p.creation.description ? h('p', { class: 'muted', style: { fontSize: '13px' } }, p.creation.description) : null,
          h('dl', { class: 'dl' },
            h('dt', null, '種類'), h('dd', null, p.kind === 'creation' ? 'Create（自作ツール）' : (p.kind === 'experiment' ? (tool ? tool.name : p.tool) : 'Studio')),
            cst ? [h('dt', null, '構成'), h('dd', null, cst.scripts + ' スクリプト / ' + cst.blocks + ' ブロック / へんすう ' + cst.vars)] : null,
            h('dt', null, '更新'), h('dd', null, U.fmtDate(p.updatedAt)),
            h('dt', null, '作成'), h('dd', null, U.fmtDate(p.createdAt)),
            h('dt', null, '最終'), h('dd', null, p.lastOpenedAt ? U.fmtDate(p.lastOpenedAt) : '—'),
            p.kind === 'studio' ? [h('dt', null, 'サイズ'), h('dd', null, p.width + ' × ' + p.height), h('dt', null, '要素'), h('dd', null, p.objects.length + ' 個')] : null,
            p.tags.length ? [h('dt', null, 'タグ'), h('dd', null, p.tags.map(function (t) { return '#' + t; }).join(' '))] : null,
            p.collections.length ? [h('dt', null, '集まり'), h('dd', null, p.collections.map(colName).filter(Boolean).join(' / '))] : null,
            p.daily ? [h('dt', null, 'お題'), h('dd', null, p.daily)] : null),
          UI.button('開いて編集', { icon: 'edit', kind: 'primary', onclick: function () { m.close(); Router.go(PZ.projects.hrefFor(p)); } }),
          p.kind === 'creation' ? UI.button('Remixで開く', { icon: 'branch', kind: 'ghost', onclick: function () { m.close(); Router.go('/remix?from=' + encodeURIComponent(p.id)); } }) : null,
          h('div', { class: 'preview-export' },
            h('span', { class: 'field-label' }, '書き出し'),
            UI.button('画像 (PNG)', { icon: 'image', kind: 'ghost', small: true, title: '見た目だけの画像。再編集はできません', onclick: function () {
              imageBlob(p).then(function (b) { U.download(b, U.safeFileName(p.name, '.png')); UI.toast('画像（PNG）を保存しました', { type: 'ok', duration: 1600 }); })
                .catch(function (e) { UI.toast('画像を保存できませんでした: ' + (e && e.message), { type: 'error' }); });
            } }),
            p.kind === 'creation' ? UI.button('自作ツール (JSON)', { icon: 'download', kind: 'ghost', small: true, title: '他の人に渡せる自作ツールファイル。読み込み前に内容が検証されます', onclick: function () { exportTool(p); } }) : null,
            UI.button('データ (JSON)', { icon: 'download', kind: 'ghost', small: true, title: '再編集できるプロジェクトデータ。別の環境でも読み込めます', onclick: function () { exportOne(p); } })),
          UI.button('閉じる', { kind: 'ghost', onclick: function () { m.close(); } }));
        m = UI.openModal({ className: 'wide', label: p.name + ' のプレビュー', content: h('div', { class: 'preview-modal' }, stageEl, side) });
        requestAnimationFrame(function () {
          if (p.kind === 'creation') {
            var cc = h('canvas', { 'aria-label': p.name + ' のプレビュー', role: 'img', style: { maxWidth: '100%' } });
            stageEl.appendChild(cc);
            try { PZ.creation.renderToCanvas(p.creation, cc, { frames: 45, scale: 1 }); cc.style.width = Math.max(240, Math.min(stageEl.clientWidth - 48, 720)) + 'px'; cc.style.height = 'auto'; }
            catch (e) { stageEl.appendChild(h('p', { class: 'muted' }, 'プレビューを描画できませんでした')); }
          } else if (p.kind === 'experiment') {
            var lab = PZ.labs[p.tool];
            var w = Math.max(240, Math.min(stageEl.clientWidth - 48, 720));
            var cv = h('canvas', { 'aria-label': p.name + ' のプレビュー', role: 'img' });
            stageEl.appendChild(cv);
            var dpr = Math.min(window.devicePixelRatio || 1, 2), hh = Math.round(w * 0.625);
            cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); cv.style.width = w + 'px'; cv.style.height = hh + 'px';
            var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
            try { lab.render(g, w, hh, lab.normalize(p.params || {})); } catch (e) { stageEl.appendChild(h('p', { class: 'muted' }, 'プレビューを描画できませんでした')); }
          } else {
            var cs = h('canvas', { 'aria-label': p.name + ' のプレビュー', role: 'img' });
            stageEl.appendChild(cs);
            PZ.render.drawThumb(cs, p, Math.max(200, Math.min(stageEl.clientWidth - 48, 720)), Math.max(200, Math.min(window.innerHeight * 0.6, 520)));
          }
        });
      }

      /* ---- 書き出し・読み込み（プロジェクトデータ） ---- */
      function stamp() {
        var d = new Date();
        return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
      }
      function download(data, filename) {
        U.download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
      }
      function doBackup() {
        PZ.projects.exportAll().then(function (data) {
          if (!data.projects.length) { UI.toast('書き出す作品がありません', { type: 'warn' }); return; }
          download(data, 'playground-zero-backup-' + stamp() + '.json');
          return PZ.projects.markBackedUp().then(function () {
            UI.toast(data.projects.length + ' 件の作品をプロジェクトデータとして書き出しました', { type: 'ok' });
            renderNotice();
          });
        }).catch(function (e) { UI.toast('バックアップに失敗しました: ' + (e && e.message), { type: 'error' }); });
      }
      function exportTool(p) {
        download(PZ.creation.toFile(p), U.safeFileName(p.name, '') + '-' + stamp() + '.pzcreate.json');
        UI.toast('「' + p.name + '」を自作ツールファイルとして書き出しました', { type: 'ok' });
      }
      function exportOne(p) {
        PZ.projects.exportAll([p.id]).then(function (data) {
          download(data, U.safeFileName(p.name, '') + '-' + stamp() + '.pz.json');
          UI.toast('「' + p.name + '」をプロジェクトデータとして書き出しました', { type: 'ok' });
        }).catch(function (e) { UI.toast('書き出せませんでした: ' + (e && e.message), { type: 'error' }); });
      }

      function importFile(f) {
        if (f.size > C.limits.importBytes) { UI.toast('ファイルが大きすぎます（' + Math.round(C.limits.importBytes / 1048576) + 'MBまで）', { type: 'error' }); return; }
        var reader = new FileReader();
        reader.onerror = function () { UI.toast('ファイルを読み込めませんでした', { type: 'error' }); };
        reader.onload = function () {
          var data;
          try { data = JSON.parse(String(reader.result)); }
          catch (e) { UI.toast('JSONとして読み込めませんでした。PLAYGROUND ZERO のプロジェクトデータ（.json）を選んでください。', { type: 'error', duration: 6500 }); return; }
          if (PZ.creation.isToolFile(data)) {
            // 自作ツールファイル: 検証 → 確認画面 → 新しい作品として保存（既存は上書きしない）
            PZ.creationUI.importToolFile(data, f.name, f.size, { mode: 'save', onSaved: function () { load(); } });
            return;
          }
          PZ.projects.inspectBackup(data).then(function (report) {
            if (!report.ok) { UI.toast(report.error, { type: 'error', duration: 7000 }); return; }
            confirmImport(report, f.name);
          }).catch(function (e) { UI.toast('検証に失敗しました: ' + (e && e.message), { type: 'error', duration: 6000 }); });
        };
        reader.readAsText(f);
      }

      /** 取り込み前の確認画面: 何がどう追加されるかを見せて、承認されたときだけ保存する */
      function confirmImport(report, fileName) {
        var n = { new: 0, copy: 0, same: 0 };
        report.items.forEach(function (it) { n[it.status]++; });
        var ex = report.extras;
        var extraCount = ex.collections.length + Object.keys(ex.daily).length + ex.favTools.length;
        var importable = n.new + n.copy;
        var m;
        var rows = report.items.slice(0, 8).map(function (it) {
          var label = it.status === 'new' ? '新規' : it.status === 'copy' ? '別作品として追加' : '同じ内容（スキップ）';
          return h('li', null, h('span', { class: 'imp-name' }, (it.project.kind === 'creation' ? '▤ ' : (it.project.kind === 'experiment' ? '◇ ' : '▣ ')) + it.project.name),
            h('span', { class: 'badge' + (it.status === 'same' ? ' purple' : '') }, label));
        });
        var okBtn = UI.button(importable || extraCount ? '取り込む' : '取り込む内容がありません', { kind: 'primary', disabled: !(importable || extraCount), onclick: function () {
          okBtn.disabled = true;
          PZ.projects.applyBackup(report).then(function (r) {
            m.close();
            var parts = [r.added + ' 件を取り込みました'];
            if (r.copies) parts.push(r.copies + ' 件は同じIDのため別作品として追加');
            if (r.skipped) parts.push(r.skipped + ' 件は同じ内容のためスキップ');
            if (r.invalid) parts.push(r.invalid + ' 件は壊れていたため無視');
            if (r.failed) parts.push(r.failed + ' 件は保存に失敗（' + r.error + '）');
            UI.toast(parts.join(' / '), { type: r.failed ? 'warn' : (r.added || extraCount ? 'ok' : 'warn'), duration: 7000 });
            return load();
          }).catch(function (e) { okBtn.disabled = false; UI.toast('取り込みに失敗しました: ' + (e && e.message), { type: 'error', duration: 7000 }); });
        } });
        var content = h('div', { class: 'modal-inner import-modal' },
          h('h2', { class: 'modal-title' }, '取り込みの確認'),
          h('p', { class: 'modal-sub' }, fileName + ' · 形式 v' + report.format + (report.appVersion ? ' · アプリ v' + report.appVersion : '') + (report.exportedAt ? ' · ' + report.exportedAt.slice(0, 10) + ' 書き出し' : '')),
          report.futureFormat ? h('div', { class: 'notice warn' }, UI.icon('alert'), h('div', { class: 'grow' }, 'このファイルは、このアプリより新しい形式(v' + report.format + ')です。読み取れる内容だけを取り込み、未対応の項目は無視されます。')) : null,
          h('dl', { class: 'dl import-summary' },
            h('dt', null, '新規'), h('dd', null, n.new + ' 件'),
            h('dt', null, '別作品'), h('dd', null, n.copy + ' 件（同じIDで内容が違うため、別の作品として追加）'),
            h('dt', null, 'スキップ'), h('dd', null, n.same + ' 件（すでに同じ内容があります）'),
            report.invalid ? [h('dt', null, '無効'), h('dd', null, report.invalid + ' 件（壊れているため取り込みません）')] : null,
            report.truncated ? [h('dt', null, '省略'), h('dd', null, report.truncated + ' 件（1回に取り込める上限を超えています）')] : null,
            extraCount ? [h('dt', null, 'その他'), h('dd', null, 'コレクション ' + ex.collections.length + ' / 完了記録 ' + Object.keys(ex.daily).length + ' / お気に入り実験 ' + ex.favTools.length)] : null),
          report.remix && (report.remix.components.length || Object.keys(report.remix.histories).length) ? h('p', { class: 'modal-sub' }, 'Remix のデータ: 部品 ' + report.remix.components.length + ' 個 / 変更履歴 ' + Object.keys(report.remix.histories).length + ' 作品分'+ (report.remix.invalid ? '（' + report.remix.invalid + ' 件は壊れているため無視）' : '') + ' も一緒に取り込みます。') : null,
          rows.length ? h('ul', { class: 'import-list' }, rows, report.items.length > 8 ? h('li', { class: 'muted' }, '…ほか ' + (report.items.length - 8) + ' 件') : null) : null,
          h('p', { class: 'modal-sub' }, '今ある作品は上書きされません。取り込みはこの確認のあとにだけ実行されます。'),
          h('div', { class: 'modal-actions' }, UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close(); } }), okBtn));
        m = UI.openModal({ content: content, className: 'wide-ish', label: '取り込みの確認', initialFocus: okBtn });
      }

      var relayout = U.debounce(function () { if (alive) renderList(); }, 200);
      var lastW = window.innerWidth;
      function onResize() { if (window.innerWidth !== lastW) { lastW = window.innerWidth; relayout(); } }
      window.addEventListener('resize', onResize);

      load();
      return function destroy() { alive = false; relayout.cancel(); window.removeEventListener('resize', onResize); };
    }
  };
})();
