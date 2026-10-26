/*
 * Daily Experiment（/daily, /daily/YYYY-MM-DD）
 * 今日のお題・制作のヒント・関連ツール・挑戦の完了記録・過去のお題の一覧。
 * 完了記録はブラウザ内（作品と同じ保存先）に残り、再読み込みしても消えない。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.pages = PZ.pages || {};
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Router = PZ.router;
  var D = PZ.daily;

  function titleEl(t) {
    var el = h('h2', { class: 'theme-title' });
    var i = t.title.indexOf(t.hl);
    if (i >= 0) {
      el.appendChild(document.createTextNode(t.title.slice(0, i)));
      el.appendChild(h('em', null, t.hl));
      el.appendChild(document.createTextNode(t.title.slice(i + t.hl.length)));
    } else el.textContent = t.title;
    return el;
  }
  function dateLabel(key) {
    var p = D.parseKey(key);
    return p.y + '.' + ('0' + p.m).slice(-2) + '.' + ('0' + p.d).slice(-2) + ' ' + D.weekday(key);
  }
  PZ.dailyUi = { titleEl: titleEl, dateLabel: dateLabel };

  PZ.pages.daily = {
    title: '今日の実験',
    nav: 'daily',
    mount: function (root, ctx) {
      var alive = true;
      var today = D.todayKey();
      var key = ctx.params.date || today;
      if (!D.parseKey(key)) {
        root.appendChild(h('div', { class: 'container', style: { paddingTop: '48px' } },
          UI.emptyState('日付の形式が正しくありません', 'YYYY-MM-DD の形式で指定してください。', [UI.button('今日のお題へ', { kind: 'primary', icon: 'calendar', onclick: function () { Router.go('/daily'); } })])));
        return null;
      }
      if (D.isFuture(key)) {
        root.appendChild(h('div', { class: 'container', style: { paddingTop: '48px' } },
          UI.emptyState('まだ先のお題です', key + ' のお題は、その日にならないと開けません。', [UI.button('今日のお題へ', { kind: 'primary', icon: 'calendar', onclick: function () { Router.go('/daily'); } })])));
        return null;
      }

      var theme = D.themeFor(key);
      var records = {};
      var mainHost = h('div');
      var worksHost = h('div');
      var statHost = h('div', { class: 'stat-row' });
      var listHost = h('div');
      var listDays = 30, onlyDone = false;

      /* ---- 日付ナビ ---- */
      var prevKey = D.addDays(key, -1), nextKey = D.addDays(key, 1);
      var nav = h('div', { class: 'day-nav', role: 'navigation', 'aria-label': '日付の移動' },
        h('a', { class: 'icon-btn', href: Router.href('/daily/' + prevKey), title: '前の日のお題', 'aria-label': '前の日のお題' }, UI.icon('back')),
        h('span', { class: 'day-label' }, dateLabel(key), key === today ? h('span', { class: 'badge' }, 'TODAY') : h('span', { class: 'badge purple' }, 'PAST')),
        key === today ? h('span', { class: 'icon-btn', 'aria-hidden': 'true', style: { opacity: 0.25 } }, UI.icon('arrow'))
          : h('a', { class: 'icon-btn', href: Router.href('/daily/' + (nextKey === today ? '' : nextKey)), title: '次の日のお題', 'aria-label': '次の日のお題' }, UI.icon('arrow')),
        key !== today ? UI.button('今日へ', { kind: 'ghost', small: true, icon: 'calendar', onclick: function () { Router.go('/daily'); } }) : null);

      /* ---- お題カード ---- */
      function renderMain() {
        U.clear(mainHost);
        var rec = records[key];
        var altBtns = theme.alt.map(function (a) {
          return h('a', { class: 'chip', href: Router.href(D.altHref(a, key, theme)) }, D.toolLabel(a));
        });
        var doneBtn = rec
          ? UI.button('完了済み · 取り消す', { icon: 'check', kind: 'ghost', onclick: undo })
          : UI.button('挑戦を完了にする', { icon: 'check', kind: 'primary', onclick: complete });
        var card = h('article', { class: 'card daily-card' + (rec ? ' is-done' : '') },
          h('div', { class: 'daily-main' },
            h('div', { class: 'theme-date' }, 'EXP-' + ('00' + theme.no).slice(-3) + ' / ' + D.toolLabel(theme.tool).toUpperCase()),
            rec ? h('span', { class: 'badge', style: { justifySelf: 'start' } }, 'COMPLETED · ' + U.fmtDate(rec.doneAt)) : h('span', { class: 'badge purple', style: { justifySelf: 'start' } }, 'CHALLENGE'),
            titleEl(theme),
            h('p', { class: 'theme-brief' }, theme.brief),
            rec && rec.note ? h('p', { class: 'daily-note' }, 'メモ: ' + rec.note) : null,
            h('div', { class: 'theme-actions' },
              UI.button(D.toolLabel(theme.tool) + 'で挑戦する', { icon: 'arrow', kind: 'purple', onclick: function () { Router.go(D.href(theme, key)); } }),
              doneBtn),
            h('div', { class: 'field', style: { marginTop: '6px' } },
              h('span', { class: 'field-label' }, '他のツールでも挑戦できる'),
              h('div', { class: 'chip-group' }, altBtns))),
          h('div', { class: 'daily-hints' },
            h('div', { class: 'panel-title' }, 'Hints', h('small', null, '制作のヒント')),
            h('ul', null, theme.hints.map(function (x) { return h('li', null, x); })),
            h('p', { class: 'work-hint' }, '保存した作品は、このお題に自動で紐づきます。')));
        mainHost.appendChild(card);
      }

      function complete() {
        UI.promptText({ title: '挑戦を完了にする', label: 'ひとことメモ（任意）', okText: '完了にする', allowEmpty: true, maxLength: 120 }).then(function (note) {
          if (note === null) return;
          return PZ.userdata.markDaily(key, theme.id, note).then(function (map) {
            records = map; refreshAll();
            UI.toast('「' + theme.title + '」を完了にしました', { type: 'ok' });
          });
        }).catch(function (e) { UI.toast('記録できませんでした: ' + ((e && e.message) || ''), { type: 'error' }); });
      }
      function undo() {
        UI.confirm('完了の記録を取り消しますか？', { title: '完了を取り消す', okText: '取り消す', detail: '作品は消えません。記録だけが外れます。' }).then(function (ok) {
          if (!ok) return;
          return PZ.userdata.unmarkDaily(key).then(function (map) { records = map; refreshAll(); UI.toast('取り消しました', { type: 'info', duration: 1500 }); });
        }).catch(function (e) { UI.toast('取り消せませんでした: ' + ((e && e.message) || ''), { type: 'error' }); });
      }

      /* ---- 統計 ---- */
      function renderStats() {
        U.clear(statHost);
        var keys = Object.keys(records);
        var month = today.slice(0, 7);
        statHost.appendChild(h('span', null, 'COMPLETED ', h('b', null, String(keys.length))));
        statHost.appendChild(h('span', null, 'THIS MONTH ', h('b', null, String(keys.filter(function (k) { return k.slice(0, 7) === month; }).length))));
        statHost.appendChild(h('span', null, 'THEMES ', h('b', null, String(D.THEMES.length))));
      }

      /* ---- この日の作品 ---- */
      function renderWorks(list) {
        U.clear(worksHost);
        var mine = list.filter(function (w) { return w.daily === key; }).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
        if (!mine.length) return;
        var grid = h('div', { class: 'work-grid' });
        mine.forEach(function (w) {
          var thumb = h('div', { class: 'work-thumb checker' });
          grid.appendChild(h('article', { class: 'card hoverable work-card' },
            h('a', { class: 'work-open', href: Router.href(PZ.projects.hrefFor(w)), 'aria-label': '「' + w.name + '」を開く' },
              thumb,
              h('div', { class: 'work-info', style: { paddingBottom: '14px' } },
                h('div', { class: 'work-name' }, w.name),
                h('div', { class: 'work-meta' }, PZ.workKit.kindLabel(w) + ' · ' + U.fmtDate(w.updatedAt))))));
          PZ.workKit.drawThumb(thumb, w);
        });
        worksHost.appendChild(h('section', { class: 'section', style: { paddingTop: '36px' } }, UI.sectionHead('// This Day\'s Works', 'この日の作品'), grid));
      }

      /* ---- 過去のお題 ---- */
      function renderList() {
        U.clear(listHost);
        var keys = D.recentKeys(today, listDays);
        if (onlyDone) keys = Object.keys(records).sort().reverse();
        var wrap = h('div', { class: 'past-list', role: 'list' });
        keys.forEach(function (k) {
          var t = D.themeFor(k);
          var rec = records[k];
          wrap.appendChild(h('a', { class: 'past-row' + (k === key ? ' current' : ''), role: 'listitem', href: Router.href('/daily/' + (k === today ? '' : k)) },
            h('span', { class: 'past-date' }, k.slice(5).replace('-', '/') + ' ' + D.weekday(k)),
            h('span', { class: 'past-title' }, t.title),
            h('span', { class: 'past-tool' }, D.toolLabel(t.tool)),
            rec ? h('span', { class: 'badge' }, 'DONE') : h('span', { class: 'badge-empty' }, '—')));
        });
        if (!keys.length) wrap.appendChild(h('p', { class: 'muted', style: { padding: '14px 4px' } }, 'まだ完了したお題はありません。'));
        listHost.appendChild(wrap);
        if (!onlyDone && listDays < 365) {
          listHost.appendChild(h('div', { style: { marginTop: '14px', textAlign: 'center' } },
            UI.button('さらに30日さかのぼる', { kind: 'ghost', icon: 'down', onclick: function () { listDays += 30; renderList(); } })));
        }
      }
      var doneToggle = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: function () {
        onlyDone = !onlyDone; doneToggle.setAttribute('aria-pressed', String(onlyDone)); renderList();
      } }, UI.icon('check'), '完了した記録だけ');

      function refreshAll() { renderMain(); renderStats(); renderList(); }

      root.appendChild(h('div', { class: 'container' },
        h('header', { class: 'page-head' },
          h('div', { class: 'crumbs' }, 'Daily'),
          h('h1', { class: 'page-title' }, '今日の実験 ', h('em', null, 'DAILY')),
          h('p', { class: 'page-lead' }, '毎日ひとつ、お題が変わります。ログインも義務もなし。気が向いた日に、過去のお題にもいつでも挑戦できます。'),
          statHost),
        h('div', { style: { marginTop: '24px' } }, nav),
        h('div', { style: { marginTop: '16px' } }, mainHost),
        worksHost,
        h('section', { class: 'section', style: { paddingTop: '40px' } },
          UI.sectionHead('// Archive', '過去のお題', doneToggle), listHost)));

      renderMain(); renderStats(); renderList();
      PZ.userdata.daily().then(function (map) { if (!alive) return; records = map; refreshAll(); }).catch(function (e) {
        UI.toast('完了記録を読み込めませんでした: ' + ((e && e.message) || ''), { type: 'warn' });
      });
      PZ.projects.list().then(function (list) { if (alive) renderWorks(list); }).catch(function () { /* 作品なしでも表示できる */ });

      return function destroy() { alive = false; };
    }
  };
})();
