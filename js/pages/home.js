/*
 * ホームページ: ヒーロー / 今日の実験テーマ / おすすめツール / 最近の作品 / 基地マップ
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.pages = PZ.pages || {};
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var R = PZ.router;

  /* ---------- 軽量な粒子描画（ヒーロー等で共用） ---------- */
  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** 「0 に斜線」のロゴ形に集まる粒子。カーソルで散る。 */
  function createHeroFx(canvas, host) {
    var ctx = canvas.getContext('2d');
    var w = 0, h2 = 0, dpr = 1, cx = 0, cy = 0, R0 = 100, narrow = false;
    var parts = [];
    var mouse = { x: -9999, y: -9999 };
    var LIME = hexToRgb('#b8ff3d'), PURPLE = hexToRgb('#a066ff'), WHITE = [236, 239, 244];

    function layout() {
      var rect = host.getBoundingClientRect();
      w = Math.max(1, rect.width); h2 = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h2 * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      narrow = w < 900;
      if (narrow) { cx = w * 0.72; cy = Math.min(h2 * 0.3, 190); R0 = Math.min(w * 0.3, 130); }
      else { cx = w * 0.74; cy = h2 * 0.5; R0 = Math.min(h2 * 0.34, w * 0.2); }
    }

    function build() {
      var N = narrow ? 240 : 520;
      parts = [];
      for (var i = 0; i < N; i++) {
        var kind = i % 100 < 14 ? 'slash' : (i % 100 < 24 ? 'dust' : 'ring');
        var p = {
          kind: kind, a: Math.random() * Math.PI * 2,
          off: (Math.random() - 0.5) * 2, t: (Math.random() - 0.5) * 2,
          x: Math.random() * w, y: Math.random() * h2, vx: 0, vy: 0,
          s: 0.9 + Math.random() * 1.9,
          c: kind === 'slash' ? PURPLE : (Math.random() < 0.18 ? WHITE : (Math.random() < 0.5 ? LIME : PURPLE)),
          ph: Math.random() * 6.28
        };
        parts.push(p);
      }
    }

    function target(p, time) {
      if (p.kind === 'ring') {
        var a = p.a + time * 0.00014;
        var r = R0 * (1 + p.off * 0.07);
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      }
      if (p.kind === 'slash') {
        var k = p.t * R0 * 1.12, j = p.off * 6;
        return [cx + k * 0.7071 + j * 0.7071, cy - k * 0.7071 + j * 0.7071];
      }
      var a2 = p.a - time * 0.00008;
      var r2 = R0 * (1.25 + (p.off + 1) * 0.55);
      return [cx + Math.cos(a2) * r2, cy + Math.sin(a2) * r2 * 0.9];
    }

    var running = true;
    function tick(time) {
      if (!running) return;
      ctx.clearRect(0, 0, w, h2);
      ctx.globalCompositeOperation = 'lighter';
      var baseAlpha = narrow ? 0.62 : 0.95;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        var t = target(p, time);
        p.vx += (t[0] - p.x) * 0.012;
        p.vy += (t[1] - p.y) * 0.012;
        var dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 16000) {
          var d = Math.sqrt(d2) || 1, f = (1 - d / 126.5) * 2.2;
          p.vx += (dx / d) * f; p.vy += (dy / d) * f;
        }
        p.vx *= 0.9; p.vy *= 0.9;
        p.x += p.vx; p.y += p.vy;
        var tw = 0.65 + 0.35 * Math.sin(time * 0.002 + p.ph);
        ctx.fillStyle = 'rgba(' + p.c[0] + ',' + p.c[1] + ',' + p.c[2] + ',' + (baseAlpha * tw).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function onMove(e) {
      var rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left; mouse.y = e.clientY - rect.top;
    }
    function onLeave() { mouse.x = mouse.y = -9999; }
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);

    var ro = null;
    function relayout() { layout(); build(); }
    if (window.ResizeObserver) { ro = new ResizeObserver(U.debounce(relayout, 120)); ro.observe(host); }
    relayout();

    return {
      tick: tick,
      destroy: function () {
        running = false;
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerleave', onLeave);
        if (ro) ro.disconnect();
      }
    };
  }

  /** 小さな粒子ビジュアル（テーマカード・ツールカード用） */
  function createMiniParticles(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var w = 1, h2 = 1, parts = [];
    var colors = opts.colors || ['#b8ff3d', '#a066ff'];
    var count = opts.count || 70;
    function layout() {
      var r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width); h2 = Math.max(1, r.height);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h2 * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      parts = [];
      for (var i = 0; i < count; i++) {
        var sp = (0.2 + Math.random() * 0.7) * (opts.speed || 1);
        var ang = Math.random() * 6.28;
        parts.push({ x: Math.random() * w, y: Math.random() * h2, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, s: 1 + Math.random() * 2, c: colors[i % colors.length] });
      }
    }
    layout();
    return {
      layout: layout,
      tick: function () {
        ctx.fillStyle = 'rgba(16,18,21,0.22)';
        ctx.fillRect(0, 0, w, h2);
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          p.x += p.vx; p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h2) p.vy *= -1;
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.2832); ctx.fill();
        }
      }
    };
  }

  /** Studio / Shape Machine のミニ静止画 */
  function drawStaticPreview(canvas, project) {
    var r = canvas.getBoundingClientRect();
    var w = Math.max(40, r.width || 300), hh = Math.max(40, r.height || 150);
    var set = PZ.render.setupCanvas(canvas, w, hh, 2);
    var s = Math.max(w / project.width, hh / project.height);
    set.ctx.save();
    set.ctx.translate((w - project.width * s) / 2, (hh - project.height * s) / 2);
    set.ctx.scale(s, s);
    PZ.render.drawProject(set.ctx, project);
    set.ctx.restore();
  }

  function sampleStudioProject() {
    var M = PZ.model;
    var p = M.createProject('sample', { width: 960, height: 600, background: '#1d2127' });
    var a = M.newObject('rect', p, 0); a.x = 330; a.y = 300; a.w = 300; a.h = 300; a.rotation = -8; a.fill = '#a066ff'; a.radius = 24;
    var b = M.newObject('ellipse', p, 1); b.x = 560; b.y = 280; b.w = 280; b.h = 280; b.fill = '#b8ff3d';
    var c = M.newObject('triangle', p, 2); c.x = 700; c.y = 400; c.w = 200; c.h = 180; c.rotation = 12; c.fill = '#f2f4f8'; c.opacity = 0.92;
    var t = M.newObject('text', p, 3); t.x = 400; t.y = 330; t.text = 'ZERO'; t.fontSize = 140; t.fill = '#15171b'; M.fitText(t);
    p.objects = [a, b, c, t];
    return p;
  }

  /* ---------- ページ ---------- */
  PZ.pages.home = {
    title: 'ホーム',
    nav: 'home',
    mount: function (root, ctx) {
      var fxList = [];
      var raf = 0;
      var alive = true;

      /* --- hero --- */
      var heroCanvas = h('canvas', { class: 'hero-canvas', 'aria-hidden': 'true' });
      var readout = h('div', { class: 'hero-readout', 'aria-hidden': 'true' },
        h('span', null, 'FACILITY // ', h('b', null, 'ONLINE')),
        h('span', null, 'STORAGE // ', h('b', null, PZ.projects.health().ok ? 'LOCAL OK' : 'LIMITED')),
        h('span', { id: 'readout-count' }, 'WORKS // —'));
      var hero = h('section', { class: 'hero', 'aria-labelledby': 'hero-title' },
        heroCanvas,
        h('div', { class: 'container' },
          h('div', { class: 'hero-inner' },
            h('p', { class: 'eyebrow' }, 'Digital Creation Base · ' + PZ.config.phase),
            h('h1', { class: 'hero-title', id: 'hero-title', 'aria-label': PZ.config.tagline },
              h('span', null, '作る。'), h('span', null, '壊す。'), h('span', null, '発見する。'), h('span', null, 'また作る。')),
            h('p', { class: 'hero-lead' }, 'ブラウザだけで、創作と実験を。図形とテキストで作品をつくり、流れ・配色・模様・動きの実験室で遊び、毎日のお題に挑戦する。気に入った設定は保存して、いつでも再編集。登録もインストールも要りません。'),
            h('div', { class: 'hero-cta' },
              UI.button('新しく作る', { kind: 'primary', icon: 'plus', class: 'btn-lg btn-cut', onclick: function () { R.go('/studio/new'); } }),
              UI.button('実験を始める', { kind: 'ghost', icon: 'lab', class: 'btn-lg btn-cut', onclick: function () { R.go('/lab'); } })))),
        readout);
      root.appendChild(hero);
      fxList.push(createHeroFx(heroCanvas, hero));

      /* --- 今日の実験（Daily Experiment と同じお題） --- */
      var themeSlot = h('div');
      var themeVis = null;
      var todayKey = PZ.daily.todayKey();
      function renderTheme(done) {
        U.clear(themeSlot);
        var t = PZ.daily.themeFor(todayKey);
        var now = new Date();
        var wd = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][now.getDay()];
        var dateStr = now.getFullYear() + '.' + ('0' + (now.getMonth() + 1)).slice(-2) + '.' + ('0' + now.getDate()).slice(-2) + ' ' + wd;
        var visCanvas = h('canvas', { 'aria-hidden': 'true' });
        var card = h('article', { class: 'card theme-card' },
          h('div', { class: 'theme-main' },
            h('div', { class: 'theme-date' }, dateStr + ' · TODAY'),
            h('div', { class: 'chip-group' },
              h('span', { class: 'badge purple' }, 'EXP-' + ('00' + t.no).slice(-3) + ' / ' + PZ.daily.toolLabel(t.tool)),
              done ? h('span', { class: 'badge' }, 'COMPLETED') : null),
            PZ.dailyUi.titleEl(t),
            h('p', { class: 'theme-brief' }, t.brief),
            h('div', { class: 'theme-actions' },
              UI.button(PZ.daily.toolLabel(t.tool) + 'で始める', { kind: 'purple', icon: 'arrow', onclick: function () { R.go(PZ.daily.href(t, todayKey)); } }),
              UI.button('ヒントと過去のお題', { kind: 'ghost', icon: 'calendar', onclick: function () { R.go('/daily'); } }))),
          h('div', { class: 'theme-visual' }, visCanvas));
        themeSlot.appendChild(card);
        if (themeVis) { var k = fxList.indexOf(themeVis); if (k >= 0) fxList.splice(k, 1); if (themeVis.destroy) themeVis.destroy(); }
        var colors = t.tool === 'particles' || t.tool === 'motion' ? ['#b8ff3d', '#a066ff'] : (t.tool === 'shapes' || t.tool === 'pattern' ? ['#a066ff', '#f2f4f8', '#b8ff3d'] : ['#b8ff3d', '#ff5d9e']);
        themeVis = createMiniParticles(visCanvas, { colors: colors, count: 56, speed: 1.1 });
        fxList.push(themeVis);
      }
      root.appendChild(h('div', { class: 'container' },
        h('section', { class: 'section', 'aria-labelledby': 'sec-theme' },
          h('div', { class: 'section-head' }, h('div', null, h('span', { class: 'section-code' }, '// 01 · Today\'s Experiment'), h('h2', { class: 'section-title', id: 'sec-theme' }, '今日の実験テーマ'))),
          themeSlot)));
      renderTheme(false);
      PZ.userdata.daily().then(function (map) { if (alive && map[todayKey]) renderTheme(true); }).catch(function () { /* 完了表示なしでも動く */ });

      /* --- おすすめの実験ツール --- */
      var pc = h('canvas', { 'aria-hidden': 'true' });
      var sc = h('canvas', { 'aria-hidden': 'true' });
      var tc = h('canvas', { 'aria-hidden': 'true' });
      function toolCard(code, name, desc, href, cv, cta) {
        return h('a', { class: 'card hoverable tool-card', href: R.href(href) },
          h('div', { class: 'tool-preview' }, cv),
          h('div', null, h('div', { class: 'tool-code' }, code), h('h3', { class: 'tool-name' }, name)),
          h('p', { class: 'tool-desc' }, desc),
          h('span', { class: 'tool-go' }, cta, UI.icon('arrow')));
      }
      root.appendChild(h('div', { class: 'container' },
        h('section', { class: 'section', 'aria-labelledby': 'sec-tools' },
          UI.sectionHead('// 02 · Recommended', 'おすすめの実験ツール'),
          h('div', { class: 'grid-3' },
            toolCard('LAB-01', 'Particle Lab', '粒子の数・速度・色を調整して、マウスに反応する群れを観察する。残像や線の描画で表情が変わる。', '/lab/particles', pc, '実験する'),
            toolCard('LAB-02', 'Shape Machine', '図形を自動生成して配置を探る。気に入った構図はワンクリックでStudioに引き継げる。', '/lab/shapes', sc, '実験する'),
            toolCard('STUDIO', 'Studio', '図形とテキストで作品をつくる制作スタジオ。元に戻す、複製、自動保存まで揃っている。', '/studio/new', tc, '作り始める')))));
      document.getElementById('sec-tools');
      var miniP = createMiniParticles(pc, { count: 60, colors: ['#b8ff3d', '#a066ff', '#f2f4f8'] });
      fxList.push(miniP);
      requestAnimationFrame(function () {
        if (!alive) return;
        try {
          var gen = PZ.labs && PZ.labs.shapes;
          if (gen) {
            var params = U.clone(gen.defaults); params.seed = 41; params.count = 36; params.layout = 'scatter';
            drawStaticPreview(sc, gen.project(params));
          }
          drawStaticPreview(tc, sampleStudioProject());
        } catch (e) { if (window.console) console.warn(e); }
      });

      /* --- Phase 2 の新しい実験 --- */
      var newGrid = h('div', { class: 'grid-4' });
      ['flow', 'color', 'pattern', 'motion'].forEach(function (id) {
        var t = PZ.registry.get(id);
        var cv = h('canvas', { 'aria-hidden': 'true' });
        newGrid.appendChild(h('a', { class: 'card hoverable tool-card', href: R.href(t.path) },
          h('div', { class: 'tool-preview' }, cv),
          h('div', null, h('div', { class: 'tool-code' }, t.code), h('h3', { class: 'tool-name' }, t.name)),
          h('p', { class: 'tool-desc' }, t.summary),
          h('span', { class: 'tool-go' }, '実験する', UI.icon('arrow'))));
        requestAnimationFrame(function () { if (alive) PZ.registry.drawPreview(id, cv); });
      });
      root.appendChild(h('div', { class: 'container' },
        h('section', { class: 'section', 'aria-labelledby': 'sec-new' },
          h('div', { class: 'section-head' },
            h('div', null, h('span', { class: 'section-code' }, '// 03 · New Experiments'), h('h2', { class: 'section-title', id: 'sec-new' }, '新しい実験')),
            h('div', { class: 'section-aside' }, h('a', { class: 'btn btn-sm btn-ghost', href: R.href('/lab') }, 'ライブラリを開く'), ' ', h('a', { class: 'btn btn-sm btn-ghost', href: R.href('/discover') }, 'ランダム発見'))),
          newGrid)));

      /* --- 最近の作品 --- */
      var recentSlot = h('div');
      root.appendChild(h('div', { class: 'container' },
        h('section', { class: 'section', 'aria-labelledby': 'sec-recent' },
          h('div', { class: 'section-head' },
            h('div', null, h('span', { class: 'section-code' }, '// 04 · Recent Works'), h('h2', { class: 'section-title', id: 'sec-recent' }, '最近の作品')),
            h('div', { class: 'section-aside' }, h('a', { class: 'btn btn-sm btn-ghost', href: R.href('/space') }, 'すべて見る'))),
          recentSlot)));

      PZ.projects.list().then(function (all) {
        if (!alive) return;
        var cnt = document.getElementById('readout-count');
        if (cnt) cnt.textContent = 'WORKS // ' + all.length;
        all.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
        var top = all.slice(0, 4);
        U.clear(recentSlot);
        if (!top.length) {
          recentSlot.appendChild(UI.emptyState('まだ作品がありません', '最初の1枚を作ってみましょう。Labで偶然生まれた構図をStudioに持ち込むこともできます。',
            [UI.button('新しく作る', { kind: 'primary', icon: 'plus', onclick: function () { R.go('/studio/new'); } }),
              UI.button('Labを覗く', { kind: 'ghost', icon: 'lab', onclick: function () { R.go('/lab'); } })]));
          return;
        }
        var grid = h('div', { class: 'work-grid' });
        top.forEach(function (p) {
          var thumb = h('div', { class: 'work-thumb checker' });
          var card = h('article', { class: 'card hoverable work-card' },
            h('a', { class: 'work-open', href: R.href(PZ.projects.hrefFor(p)), 'aria-label': '「' + p.name + '」を開いて編集' },
              thumb,
              h('div', { class: 'work-info', style: { paddingBottom: '14px' } },
                h('div', { class: 'work-name' }, p.name),
                h('div', { class: 'work-meta' }, PZ.workKit.kindLabel(p) + ' · 更新 ' + U.fmtDate(p.updatedAt)))));
          grid.appendChild(card);
          PZ.workKit.drawThumb(thumb, p);
        });
        recentSlot.appendChild(grid);
      }).catch(function (e) {
        U.clear(recentSlot);
        recentSlot.appendChild(UI.emptyState('作品を読み込めませんでした', e && e.message));
      });

      /* --- 基地マップ --- */
      function mapLink(code, icon, name, desc, href) {
        return h('a', { class: 'card hoverable map-link', href: R.href(href) },
          h('span', { class: 'map-code' }, code), UI.icon(icon), h('strong', null, name), h('span', { class: 'd' }, desc));
      }
      root.appendChild(h('div', { class: 'container' },
        h('section', { class: 'section', 'aria-labelledby': 'sec-map' },
          UI.sectionHead('// 05 · Base Map', '基地マップ'),
          h('div', { class: 'grid-3' },
            mapLink('A-00', 'home', 'Home', '基地の入口。今日のテーマと最近の作品。', '/'),
            mapLink('B-01', 'studio', 'Studio', '図形とテキストで作品を作る制作スタジオ。', '/studio/new'),
            mapLink('C-02', 'lab', 'Lab', '6つの実験を探して起動する実験ライブラリ。', '/lab'),
            mapLink('D-03', 'spark', 'Discover', '予想外の配色・模様・お題に出会うランダム発見。', '/discover'),
            mapLink('E-04', 'calendar', 'Daily', '毎日変わるお題と、挑戦の記録。', '/daily'),
            mapLink('F-05', 'space', 'My Space', '保存した作品の検索・整理・バックアップ。', '/space')))));

      /* --- アニメーションループ（非表示時は停止） --- */
      var reduced = U.prefersReducedMotion();
      function frame(time) {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        if (document.hidden) return;
        for (var i = 0; i < fxList.length; i++) fxList[i].tick(time);
      }
      if (reduced) {
        // 動きを抑える設定: 1フレームだけ描画
        requestAnimationFrame(function () { for (var i = 0; i < fxList.length; i++) fxList[i].tick(2000); });
      } else {
        raf = requestAnimationFrame(frame);
      }

      return function destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        fxList.forEach(function (f) { if (f.destroy) f.destroy(); });
      };
    }
  };
})();
