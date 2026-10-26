/*
 * ハッシュルーター（#/studio/xxx 形式）
 * - サーバー設定不要、GitHub Pages のサブパス・独自ドメイン・file:// のどれでも動く
 * - ページは { title, nav, mount(root, ctx) -> cleanup } を実装する
 *   cleanup は関数 / {destroy()} / Promise のいずれでもよい（離脱時に await される）
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var Router = (PZ.router = {});

  var routes = [];
  var root = null;
  var cleanup = null;
  var token = 0;
  var current = null;

  function compile(pattern) {
    var keys = [];
    var src = pattern.replace(/\/:([A-Za-z]+)/g, function (_, k) { keys.push(k); return '/([^/]+)'; });
    return { re: new RegExp('^' + src + '/?$'), keys: keys };
  }

  Router.add = function (pattern, page) {
    var c = compile(pattern);
    routes.push({ pattern: pattern, re: c.re, keys: c.keys, page: page });
    return Router;
  };

  Router.parse = function (hash) {
    var raw = (hash || '').replace(/^#/, '') || '/';
    if (raw.charAt(0) !== '/') raw = '/' + raw;
    var qi = raw.indexOf('?');
    var path = qi < 0 ? raw : raw.slice(0, qi);
    var query = qi < 0 ? {} : U.parseQuery(raw.slice(qi));
    return { path: path, query: query };
  };

  function match(path) {
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i].re.exec(path);
      if (m) {
        var params = {};
        routes[i].keys.forEach(function (k, idx) {
          try { params[k] = decodeURIComponent(m[idx + 1]); } catch (e) { params[k] = m[idx + 1]; }
        });
        return { route: routes[i], params: params };
      }
    }
    return null;
  }

  function runCleanup() {
    var fn = cleanup;
    cleanup = null;
    if (!fn) return Promise.resolve();
    var done = Promise.resolve().then(function () {
      if (typeof fn === 'function') return fn();
      if (fn && typeof fn.destroy === 'function') return fn.destroy();
    }).catch(function (e) { if (window.console) console.error('[PZ] cleanup error', e); });
    var timeout = new Promise(function (res) { setTimeout(res, 3000); });
    return Promise.race([done, timeout]);
  }

  function setNav(name) {
    var links = document.querySelectorAll('[data-nav]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('data-nav') === name) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
  }

  function showError(err) {
    U.clear(root);
    root.className = 'view view-error page-enter';
    root.appendChild(PZ.ui.emptyState(
      '読み込みに失敗しました',
      (err && err.message) ? err.message : '予期しないエラーが発生しました。',
      [
        PZ.ui.button('ホームへ戻る', { kind: 'primary', icon: 'home', onclick: function () { Router.go('/'); } }),
        PZ.ui.button('再読み込み', { kind: 'ghost', icon: 'reset', onclick: function () { location.reload(); } })
      ]));
  }

  function resolve() {
    var my = ++token;
    var parsed = Router.parse(location.hash);
    var m = match(parsed.path);
    var next = m ? m.route.page : PZ.pages.notFound;
    var ctx = {
      path: parsed.path,
      query: parsed.query,
      params: m ? m.params : {},
      isCurrent: function () { return my === token; }
    };
    current = { path: parsed.path, page: next };

    return runCleanup().then(function () {
      if (my !== token) return;
      U.clear(root);
      root.className = 'view view-' + (next.nav || 'page');
      document.title = (next.title ? next.title + ' | ' : '') + PZ.config.name;
      setNav(next.nav);
      window.scrollTo(0, 0);

      var result;
      try { result = next.mount(root, ctx); }
      catch (e) { showError(e); return; }

      return Promise.resolve(result).then(function (c) {
        if (my !== token) {
          // 読み込み中に別ページへ移動された: 作ったものを後始末する
          cleanup = c;
          return runCleanup();
        }
        cleanup = c || null;
        void root.offsetWidth;
        root.classList.add('page-enter');
        try { root.focus({ preventScroll: true }); } catch (e) { /* noop */ }
      }, function (e) {
        if (my === token) showError(e);
      });
    });
  }

  Router.go = function (path) {
    var target = '#' + (path.charAt(0) === '/' ? path : '/' + path);
    if (location.hash === target) resolve(); else location.hash = target;
  };
  Router.replace = function (path) {
    var target = '#' + (path.charAt(0) === '/' ? path : '/' + path);
    location.replace(location.href.replace(/#.*$/, '') + target);
  };
  Router.href = function (path) { return '#' + (path.charAt(0) === '/' ? path : '/' + path); };
  Router.current = function () { return current; };

  Router.start = function (rootEl) {
    root = rootEl;
    window.addEventListener('hashchange', resolve);
    return resolve();
  };
})();
