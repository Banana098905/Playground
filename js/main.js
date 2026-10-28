/*
 * 起動処理: 共通レイアウトの組み立て → 保存層の初期化 → ルート登録 → ルーター開始
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var C = PZ.config;

  PZ.pages = PZ.pages || {};

  PZ.pages.notFound = {
    title: 'ページが見つかりません',
    nav: '',
    mount: function (root) {
      root.appendChild(h('div', { class: 'container', style: { paddingTop: '48px' } },
        UI.emptyState('このページは存在しません',
          'URLが間違っているか、移動した可能性があります。',
          [UI.button('ホームへ戻る', { kind: 'primary', icon: 'home', onclick: function () { PZ.router.go('/'); } })])));
    }
  };

  var NAV = [
    { id: 'home', label: 'Home', icon: 'home', path: '/' },
    { id: 'studio', label: 'Studio', icon: 'studio', path: '/studio/new' },
    { id: 'create', label: 'Create', icon: 'blocks', path: '/create' },
    { id: 'remix', label: 'Remix', icon: 'branch', path: '/remix' },
    { id: 'lab', label: 'Lab', icon: 'lab', path: '/lab' },
    { id: 'discover', label: 'Discover', icon: 'spark', path: '/discover' },
    { id: 'daily', label: 'Daily', icon: 'calendar', path: '/daily' },
    { id: 'space', label: 'My Space', icon: 'space', path: '/space' }
  ];

  function buildShell() {
    var header = document.getElementById('site-header');
    U.clear(header);

    header.appendChild(h('a', { class: 'brand', href: PZ.router.href('/'), 'aria-label': C.name + ' ホーム' },
      h('img', { class: 'brand-mark', src: 'assets/logo.svg', alt: '', width: 32, height: 32 }),
      h('span', { class: 'brand-text' }, h('b', null, 'Playground'), h('i', null, 'Zero'))));

    var nav = h('nav', { class: 'site-nav', 'aria-label': 'メインナビゲーション' });
    NAV.forEach(function (n) {
      var a = h('a', { href: PZ.router.href(n.path), 'data-nav': n.id });
      a.appendChild(UI.icon(n.icon));
      a.appendChild(h('span', null, n.label));
      nav.appendChild(a);
    });
    header.appendChild(nav);

    var tools = h('div', { class: 'header-tools' });
    if (C.portfolioUrl) {
      var pl = h('a', { class: 'btn btn-sm btn-ghost portfolio-link', href: C.portfolioUrl, rel: 'noopener' });
      pl.appendChild(UI.icon('external'));
      pl.appendChild(h('span', { class: 'btn-label' }, C.portfolioLabel));
      tools.appendChild(pl);
    }
    var led = h('span', { class: 'led', id: 'storage-led', title: '保存先を確認中' }, h('span', null, 'LOCAL'));
    tools.appendChild(led);
    header.appendChild(tools);

    var footer = document.getElementById('site-footer');
    U.clear(footer);
    footer.appendChild(h('span', null, C.name + ' · v' + C.version + ' · ' + C.phase));
    footer.appendChild(h('span', null, '作品はこのブラウザ内に保存されます。バックアップは My Space から。'));
    footer.appendChild(h('span', { class: 'footer-links' },
      h('a', { href: PZ.router.href('/') }, 'Home'),
      h('a', { href: PZ.router.href('/studio/new') }, 'Studio'),
      h('a', { href: PZ.router.href('/create') }, 'Create'),
      h('a', { href: PZ.router.href('/remix') }, 'Remix'),
      h('a', { href: PZ.router.href('/lab') }, 'Lab'),
      h('a', { href: PZ.router.href('/discover') }, 'Discover'),
      h('a', { href: PZ.router.href('/daily') }, 'Daily'),
      h('a', { href: PZ.router.href('/space') }, 'My Space')));
  }

  function updateLed() {
    var led = document.getElementById('storage-led');
    if (!led) return;
    var hl = PZ.projects.health();
    led.className = 'led' + (hl.ok ? '' : (hl.kind === 'localstorage' ? ' warn' : ' bad'));
    led.title = '保存先: ' + hl.label;
    led.firstChild.textContent = hl.ok ? 'LOCAL' : (hl.kind === 'localstorage' ? 'LIMITED' : 'NO SAVE');
  }
  PZ.updateStorageLed = updateLed;

  function registerRoutes() {
    var R = PZ.router;
    R.add('/', PZ.pages.home);
    R.add('/studio', PZ.pages.studio);
    R.add('/studio/new', PZ.pages.studio);
    R.add('/studio/:id', PZ.pages.studio);
    R.add('/create', PZ.pages.create);
    R.add('/remix', PZ.pages.remix);
    R.add('/lab', PZ.pages.lab);
    R.add('/lab/particles', PZ.pages.particles);
    R.add('/lab/shapes', PZ.pages.shapes);
    R.add('/lab/flow', PZ.pages.flow);
    R.add('/lab/color', PZ.pages.color);
    R.add('/lab/pattern', PZ.pages.pattern);
    R.add('/lab/motion', PZ.pages.motion);
    R.add('/discover', PZ.pages.discover);
    R.add('/daily', PZ.pages.daily);
    R.add('/daily/:date', PZ.pages.daily);
    R.add('/space', PZ.pages.space);
  }

  function boot() {
    buildShell();
    registerRoutes();
    var main = document.getElementById('main');

    window.addEventListener('error', function (e) {
      if (window.console) console.error('[PZ] error', e.error || e.message);
    });
    window.addEventListener('unhandledrejection', function (e) {
      if (window.console) console.error('[PZ] unhandled rejection', e.reason);
    });

    PZ.projects.init().then(function () {
      updateLed();
      var hl = PZ.projects.health();
      if (!hl.ok) {
        UI.toast(hl.kind === 'localstorage'
          ? 'このブラウザではIndexedDBが使えないため、容量の小さい代替保存を使っています。バックアップをこまめに書き出してください。'
          : 'このブラウザでは保存が使えません。作品はタブを閉じると消えます。バックアップを書き出してください。',
        { type: 'warn', duration: 9000 });
      }
      return PZ.router.start(main);
    }).catch(function (err) {
      if (window.console) console.error(err);
      U.clear(main);
      main.appendChild(h('div', { class: 'container', style: { paddingTop: '48px' } },
        UI.emptyState('起動に失敗しました', (err && err.message) || '不明なエラー',
          [UI.button('再読み込み', { kind: 'primary', icon: 'reset', onclick: function () { location.reload(); } })])));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
