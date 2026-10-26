/*
 * Experiment Library（/lab）— 実装済みの実験を探して起動する。
 * 検索・ジャンル・タグ絞り込み・お気に入り・最近使った実験・ランダム起動・使い方表示
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.pages = PZ.pages || {};
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Router = PZ.router;
  var Reg = PZ.registry;

  PZ.pages.lab = {
    title: 'Lab',
    nav: 'lab',
    mount: function (root, ctx) {
      var alive = true;
      var st = { q: '', genre: '', tags: [], favOnly: false, favs: [], recent: [] };
      var gridHost = h('div');
      var recentHost = h('div');
      var countEl = h('span', { class: 'lib-count', 'aria-live': 'polite' });

      /* ---- 検索・絞り込み ---- */
      var search = h('input', { class: 'input search', type: 'search', placeholder: '実験を検索（名前・タグ・ジャンル）', 'aria-label': '実験を検索' });
      search.addEventListener('input', function () { st.q = search.value; renderGrid(); });

      var genreHost = h('div', { class: 'chip-group', role: 'group', 'aria-label': 'ジャンル' });
      var tagHost = h('div', { class: 'chip-group', role: 'group', 'aria-label': 'タグ' });
      var favChip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: function () { st.favOnly = !st.favOnly; paintFilters(); renderGrid(); } }, UI.icon('heart'), 'お気に入りのみ');

      function paintFilters() {
        U.clear(genreHost);
        var all = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!st.genre), onclick: function () { st.genre = ''; paintFilters(); renderGrid(); } }, 'すべて');
        genreHost.appendChild(all);
        Reg.genres().forEach(function (g) {
          genreHost.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(st.genre === g.id), title: g.note, onclick: function () { st.genre = st.genre === g.id ? '' : g.id; paintFilters(); renderGrid(); } }, g.id));
        });
        U.clear(tagHost);
        Reg.allTags().forEach(function (t) {
          var on = st.tags.indexOf(t) >= 0;
          tagHost.appendChild(h('button', { type: 'button', class: 'chip chip-sm', 'aria-pressed': String(on), onclick: function () {
            var i = st.tags.indexOf(t); if (i >= 0) st.tags.splice(i, 1); else st.tags.push(t);
            paintFilters(); renderGrid();
          } }, '#' + t));
        });
        favChip.setAttribute('aria-pressed', String(st.favOnly));
      }

      /* ---- カード ---- */
      function card(t, opts) {
        opts = opts || {};
        var cv = h('canvas', { 'aria-hidden': 'true' });
        var isFav = st.favs.indexOf(t.id) >= 0;
        var fav = h('button', { type: 'button', class: 'fav-btn', 'aria-pressed': String(isFav), title: isFav ? 'お気に入りから外す' : 'お気に入りに追加', 'aria-label': t.name + (isFav ? ' をお気に入りから外す' : ' をお気に入りに追加'), onclick: function (e) {
          e.preventDefault(); e.stopPropagation();
          PZ.userdata.toggleFavTool(t.id).then(function (on) {
            if (on) { if (st.favs.indexOf(t.id) < 0) st.favs.push(t.id); } else st.favs = st.favs.filter(function (x) { return x !== t.id; });
            renderGrid(); renderRecent();
            UI.toast(on ? 'お気に入りに追加しました' : 'お気に入りから外しました', { type: 'ok', duration: 1400 });
          }, function (err) { UI.toast('保存できませんでした: ' + (err && err.message), { type: 'error' }); });
        } }, UI.icon('heart'));
        var el = h('article', { class: 'card hoverable lib-card' + (opts.compact ? ' compact' : '') },
          h('a', { class: 'lib-open', href: Router.href(t.path), 'aria-label': t.name + ' を開く' },
            h('div', { class: 'tool-preview' }, cv),
            h('div', { class: 'lib-body' },
              h('div', { class: 'tool-code' }, t.code),
              h('h3', { class: 'tool-name' }, t.name),
              opts.compact ? null : h('p', { class: 'tool-desc' }, t.summary))),
          fav);
        if (!opts.compact) {
          el.appendChild(h('div', { class: 'lib-meta' },
            h('div', { class: 'chip-group' }, t.genres.map(function (g) { return h('span', { class: 'badge purple' }, g); })),
            h('div', { class: 'chip-group' }, t.tags.map(function (g) { return h('span', { class: 'badge' }, '#' + g); })),
            h('details', { class: 'lib-howto' },
              h('summary', null, '使い方・操作方法'),
              h('ol', null, t.howto.map(function (x) { return h('li', null, x); }))),
            h('a', { class: 'tool-go', href: Router.href(t.path) }, '実験を始める', UI.icon('arrow'))));
        }
        requestAnimationFrame(function () { if (alive) Reg.drawPreview(t.id, cv); });
        return el;
      }

      function renderGrid() {
        U.clear(gridHost);
        var list = Reg.filter({ q: st.q, genre: st.genre, tags: st.tags, favOnly: st.favOnly, favs: st.favs });
        countEl.textContent = list.length + ' / ' + Reg.all().length + ' 件';
        if (!list.length) {
          gridHost.appendChild(UI.emptyState('条件に合う実験がありません',
            st.favOnly && !st.favs.length ? 'まだお気に入りがありません。カードのハートで登録できます。' : '検索語やジャンル・タグの絞り込みを変えてみてください。',
            [UI.button('絞り込みを解除', { icon: 'reset', kind: 'primary', onclick: clearFilters })]));
          return;
        }
        var grid = h('div', { class: 'grid-3 lib-grid' });
        list.forEach(function (t) { grid.appendChild(card(t)); });
        gridHost.appendChild(grid);
      }

      function renderRecent() {
        U.clear(recentHost);
        var items = st.recent.map(function (r) { return Reg.get(r.id); }).filter(Boolean).slice(0, 4);
        if (!items.length) return;
        var grid = h('div', { class: 'grid-4 lib-recent' });
        items.forEach(function (t) { grid.appendChild(card(t, { compact: true })); });
        recentHost.appendChild(h('section', { class: 'section', style: { paddingTop: '28px' }, 'aria-labelledby': 'sec-recent-tools' },
          UI.sectionHead('// Recently Used', '最近使った実験'), grid));
        var hd = recentHost.querySelector('.section-title'); if (hd) hd.id = 'sec-recent-tools';
      }

      function clearFilters() {
        st.q = ''; st.genre = ''; st.tags = []; st.favOnly = false; search.value = '';
        paintFilters(); renderGrid();
      }

      function openRandom() {
        var t = Reg.random();
        UI.toast(t.name + ' を開きます', { type: 'info', duration: 1200 });
        Router.go(t.path);
      }

      root.appendChild(h('div', { class: 'container' },
        h('header', { class: 'page-head' },
          h('div', { class: 'crumbs' }, 'Lab'),
          h('h1', { class: 'page-title' }, '実験ライブラリ ', h('em', null, 'LAB')),
          h('p', { class: 'page-lead' }, '失敗してもいい、壊してもいい。ここに並ぶのは、今すぐ触れる実験だけ。気に入った設定は作品として保存して、あとから再編集できます。')),
        h('div', { class: 'lib-toolbar' },
          search,
          UI.button('ランダムな実験を開く', { icon: 'dice', kind: 'purple', onclick: openRandom }),
          UI.button('ランダム発見へ', { icon: 'spark', kind: 'ghost', onclick: function () { Router.go('/discover'); } })),
        h('div', { class: 'lib-filters' },
          h('div', { class: 'lib-filter-row' }, h('span', { class: 'lib-filter-label' }, 'GENRE'), genreHost),
          h('div', { class: 'lib-filter-row' }, h('span', { class: 'lib-filter-label' }, 'TAG'), tagHost),
          h('div', { class: 'lib-filter-row' }, favChip, countEl)),
        recentHost,
        h('div', { class: 'section', style: { paddingTop: '24px' } }, gridHost)));

      paintFilters();
      renderGrid();
      Promise.all([PZ.userdata.favTools(), PZ.userdata.recentTools()]).then(function (r) {
        if (!alive) return;
        st.favs = r[0]; st.recent = r[1];
        renderGrid(); renderRecent();
      }).catch(function () { /* お気に入りなしでも一覧は使える */ });

      return function destroy() { alive = false; };
    }
  };
})();
