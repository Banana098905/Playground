/*
 * Studio — 制作スタジオ
 *  図形・テキストの追加/選択/移動/拡大縮小/回転、色・不透明度などの編集、
 *  元に戻す/やり直す、作品名変更、作品の複製、自動保存と復元、PNG書き出し。
 *
 *  構成: 状態(state) → 履歴(commit/undo/redo) → 保存(saveNow) → 描画(render)
 *        → 入力(pointer/keyboard) → インスペクタ(右パネル) → 組み立て(buildStudio)
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.pages = PZ.pages || {};
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var M = PZ.model;
  var Rn = PZ.render;
  var Router = PZ.router;
  var C = PZ.config;

  var MIN_SIZE = 8;
  var freshIds = {}; // この画面遷移で新規作成された作品ID（未編集のまま離れたら破棄する）

  /* ---------- 入口 ---------- */
  function createAndGo(root, name, daily) {
    root.appendChild(h('div', { class: 'loading', role: 'status', 'aria-label': '作品を準備中' }));
    return PZ.projects.create(name || '無題の作品', { daily: M.isDateKey(daily) ? daily : null }).then(function (p) {
      freshIds[p.id] = true;
      Router.replace('/studio/' + encodeURIComponent(p.id));
    });
  }

  function resumeOrCreate(root) {
    root.appendChild(h('div', { class: 'loading', role: 'status', 'aria-label': '作品を準備中' }));
    return PZ.projects.list({ kind: 'studio' }).then(function (all) {
      all.sort(function (a, b) { return (b.lastOpenedAt || b.updatedAt) - (a.lastOpenedAt || a.updatedAt); });
      if (all.length) { Router.replace('/studio/' + encodeURIComponent(all[0].id)); return; }
      return createAndGo(root, '無題の作品');
    });
  }

  PZ.pages.studio = {
    title: 'Studio',
    nav: 'studio',
    mount: function (root, ctx) {
      var id = ctx.params.id;
      var path = ctx.path.replace(/\/$/, '');
      if (!id && path === '/studio/new') return createAndGo(root, ctx.query.name, ctx.query.daily);
      if (!id) return resumeOrCreate(root);
      return PZ.projects.open(id).then(function (project) {
        if (!ctx.isCurrent()) return null;
        if (project && project.kind === 'experiment') {
          // 実験の作品は Studio ではなく、その実験ツールで開く
          Router.replace(PZ.projects.hrefFor(project));
          return null;
        }
        if (!project) {
          root.appendChild(h('div', { class: 'container', style: { paddingTop: '48px' } },
            UI.emptyState('作品が見つかりません', '削除されたか、別のブラウザで作った作品かもしれません。',
              [UI.button('My Spaceへ', { kind: 'primary', icon: 'space', onclick: function () { Router.go('/space'); } }),
                UI.button('新しく作る', { kind: 'ghost', icon: 'plus', onclick: function () { Router.go('/studio/new'); } })])));
          return null;
        }
        return buildStudio(root, project);
      });
    }
  };

  /* ---------- 本体 ---------- */
  function buildStudio(root, project) {
    var state = {
      selId: null,
      past: [], future: [],
      committed: M.snapshot(project),
      dirty: false, saveState: 'saved', touched: false,
      zoom: 1, destroyed: false
    };
    var syncers = [];
    var drag = null;

    /* ===== DOM ===== */
    var nameInput = h('input', { class: 'input studio-name', type: 'text', value: project.name, maxlength: C.limits.projectNameLength, 'aria-label': '作品名', autocomplete: 'off' });
    var saveEl = h('button', { type: 'button', class: 'save-state', title: '保存状態', 'aria-live': 'polite' }, '保存済み');
    var undoBtn = UI.iconButton('undo', '元に戻す (Ctrl+Z)', function () { undo(); });
    var redoBtn = UI.iconButton('redo', 'やり直す (Ctrl+Shift+Z)', function () { redo(); });

    var bar = h('div', { class: 'studio-bar', role: 'toolbar', 'aria-label': 'スタジオツールバー' },
      UI.iconButton('back', 'My Spaceへ戻る', function () { Router.go('/space'); }),
      nameInput,
      saveEl,
      h('span', { class: 'sep' }),
      undoBtn, redoBtn,
      h('span', { class: 'grow' }),
      UI.button('新規', { icon: 'plus', small: true, kind: 'ghost', title: '新しい作品を作る', class: 'hide-sm', onclick: function () { Router.go('/studio/new'); } }),
      UI.button('複製', { icon: 'copy', small: true, kind: 'ghost', title: 'この作品を複製', class: 'hide-sm', onclick: function () { duplicateProject(); } }),
      UI.button('PNG', { icon: 'image', small: true, kind: 'ghost', title: '画像として書き出す', onclick: function () { exportPng(); } }),
      UI.button('保存', { icon: 'save', small: true, kind: 'primary', title: '今すぐ保存 (Ctrl+S)', onclick: function () { manualSave(); } }));

    var tools = h('div', { class: 'studio-tools', role: 'group', 'aria-label': '追加するもの' },
      h('div', { class: 'tool-label' }, 'ADD'));
    [['rect', '四角'], ['ellipse', '円'], ['triangle', '三角'], ['star', '星'], ['text', 'テキスト']].forEach(function (t) {
      var b = h('button', { type: 'button', class: 'tool-btn', title: t[1] + 'を追加', 'aria-label': t[1] + 'を追加', onclick: function () { addObject(t[0]); } });
      b.appendChild(UI.icon(t[0]));
      b.appendChild(h('span', null, t[1]));
      tools.appendChild(b);
    });

    var canvas = h('canvas', { class: 'stage-canvas', role: 'img', tabindex: '0', 'aria-label': 'キャンバス。図形をクリックで選択、ドラッグで移動できます。' });
    var emptyHint = h('div', { class: 'stage-empty', style: { position: 'absolute', inset: '0', display: 'none', placeItems: 'center', textAlign: 'center', color: 'var(--dim)', fontFamily: 'var(--font-mono)', fontSize: '12px', letterSpacing: '.1em', pointerEvents: 'none', lineHeight: '1.8' } },
      h('div', null, '+ 左の「ADD」から図形やテキストを追加', h('br'), 'ADD A SHAPE TO BEGIN'));
    var wrap = h('div', { class: 'stage-wrap' }, canvas, emptyHint);
    var sizeLabel = h('div', { class: 'stage-size' });
    var stage = h('div', { class: 'studio-stage' }, wrap,
      h('div', { class: 'stage-hint hide-sm', 'aria-hidden': 'true' }, 'DRAG: MOVE · ARROWS: NUDGE · DEL: DELETE'), sizeLabel);

    var selHost = h('div');
    var layersHost = h('div');
    var inspector = h('aside', { class: 'studio-inspector', 'aria-label': 'プロパティ' }, selHost, layersHost,
      h('div', { class: 'panel hide-sm' },
        h('div', { class: 'panel-title' }, 'Shortcuts'),
        h('div', { class: 'kbd-list' },
          h('div', null, h('span', null, '元に戻す / やり直す'), h('span', null, h('kbd', null, 'Ctrl+Z'), ' ', h('kbd', null, 'Ctrl+Y'))),
          h('div', null, h('span', null, '複製'), h('kbd', null, 'Ctrl+D')),
          h('div', null, h('span', null, '削除'), h('kbd', null, 'Delete')),
          h('div', null, h('span', null, '保存'), h('kbd', null, 'Ctrl+S')),
          h('div', null, h('span', null, '微調整（10px）'), h('span', null, h('kbd', null, '矢印'), ' ', h('kbd', null, 'Shift'))),
          h('div', null, h('span', null, '回転を15°刻み'), h('span', null, h('kbd', null, 'Shift'), '+ドラッグ')))));

    var studioEl = h('div', { class: 'studio' }, bar, h('div', { class: 'studio-body' }, tools, stage, inspector));
    root.appendChild(studioEl);

    /* ===== 取得系 ===== */
    function getSel() {
      if (!state.selId) return null;
      for (var i = 0; i < project.objects.length; i++) if (project.objects[i].id === state.selId) return project.objects[i];
      return null;
    }

    /* ===== 保存状態 ===== */
    function setSaveState(s) {
      state.saveState = s;
      saveEl.className = 'save-state ' + s;
      saveEl.textContent = s === 'saved' ? '保存済み' : s === 'saving' ? '保存中…' : s === 'dirty' ? '未保存' : '保存失敗 · クリックで再試行';
    }
    var saving = false, again = false, chain = Promise.resolve(true);
    var autosave = U.debounce(function () { saveNow(); }, C.autosaveDelay);

    function markDirty() { state.dirty = true; setSaveState('dirty'); autosave(); }

    function saveNow() {
      autosave.cancel();
      commitSoon.cancel();
      commit();
      if (!state.dirty && state.saveState !== 'error') return Promise.resolve(true);
      if (saving) { again = true; return chain; }
      saving = true;
      state.dirty = false;
      setSaveState('saving');
      chain = PZ.projects.save(project, true).then(function () {
        saving = false;
        if (state.dirty || again) { again = false; return saveNow(); }
        setSaveState('saved');
        return true;
      }).catch(function (err) {
        saving = false;
        state.dirty = true;
        setSaveState('error');
        if (!state.destroyed) UI.toast('保存できませんでした: ' + ((err && err.message) || '不明なエラー') + '。バックアップの書き出しをおすすめします。', { type: 'error', duration: 7000 });
        return false;
      });
      return chain;
    }

    function manualSave() {
      saveNow().then(function (ok) { if (ok) UI.toast('保存しました', { type: 'ok', duration: 1600 }); });
    }
    saveEl.addEventListener('click', function () { if (state.saveState === 'error') saveNow(); });

    /* ===== 履歴 ===== */
    function updateHistoryButtons() {
      undoBtn.disabled = !state.past.length;
      redoBtn.disabled = !state.future.length;
    }
    function commit() {
      var snap = M.snapshot(project);
      if (snap === state.committed) return false;
      state.past.push(state.committed);
      if (state.past.length > C.limits.undoSteps) state.past.shift();
      state.future = [];
      state.committed = snap;
      state.touched = true;
      markDirty();
      updateHistoryButtons();
      return true;
    }
    var commitSoon = U.debounce(commit, 450);
    function flushCommit() { commitSoon.cancel(); commit(); }

    function restore(snap) {
      M.applySnapshot(project, snap);
      state.committed = snap;
      if (!getSel()) state.selId = null;
      markDirty();
      updateHistoryButtons();
      fit();
      buildSelection();
      renderAll();
    }
    function undo() {
      flushCommit();
      if (!state.past.length) return;
      state.future.push(state.committed);
      restore(state.past.pop());
    }
    function redo() {
      flushCommit();
      if (!state.future.length) return;
      state.past.push(state.committed);
      restore(state.future.pop());
    }

    /* ===== 描画 ===== */
    function fit() {
      var cs = getComputedStyle(stage);
      var bw = stage.clientWidth - (parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight));
      var bh = stage.clientHeight - (parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
      bw = Math.max(120, bw); bh = Math.max(120, bh);
      var s = Math.min(bw / project.width, bh / project.height, 1.5);
      var cssW = Math.max(60, Math.floor(project.width * s));
      var cssH = Math.max(40, Math.floor(project.height * s));
      state.zoom = cssW / project.width;
      Rn.setupCanvas(canvas, cssW, cssH, 2);
      sizeLabel.textContent = project.width + ' × ' + project.height + ' · ' + Math.round(state.zoom * 100) + '%';
    }
    function render() {
      if (state.destroyed) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(state.zoom, state.zoom);
      Rn.drawProject(ctx, project);
      var sel = getSel();
      if (sel) Rn.drawSelection(ctx, sel, state.zoom);
      ctx.restore();
      emptyHint.style.display = project.objects.length ? 'none' : 'grid';
    }
    var requestRender = U.rafThrottle(render);
    function renderAll() { render(); buildLayers(); syncInspector(); }

    /* ===== 編集操作 ===== */
    function select(id) {
      if (state.selId === id) { requestRender(); return; }
      state.selId = id;
      buildSelection();
      buildLayers();
      requestRender();
    }

    function addObject(type) {
      if (project.objects.length >= C.limits.objects) { UI.toast('オブジェクトが上限（' + C.limits.objects + '）に達しました', { type: 'warn' }); return; }
      flushCommit();
      var o = M.newObject(type, project);
      project.objects.push(o);
      state.selId = o.id;
      commit();
      buildSelection();
      renderAll();
      if (type === 'text') {
        var ta = document.getElementById('insp-text');
        if (ta && window.matchMedia && !window.matchMedia('(max-width: 900px)').matches) { ta.focus(); ta.select(); }
      }
    }
    function deleteSel() {
      var o = getSel();
      if (!o) return;
      flushCommit();
      project.objects = project.objects.filter(function (x) { return x.id !== o.id; });
      state.selId = null;
      commit();
      buildSelection();
      renderAll();
    }
    function duplicateSel() {
      var o = getSel();
      if (!o) return;
      if (project.objects.length >= C.limits.objects) { UI.toast('オブジェクトが上限に達しました', { type: 'warn' }); return; }
      flushCommit();
      var c = M.cloneObject(o, 24);
      project.objects.push(c);
      state.selId = c.id;
      commit();
      buildSelection();
      renderAll();
    }
    function moveZ(dir) {
      var o = getSel();
      if (!o) return;
      flushCommit();
      var i = project.objects.indexOf(o);
      var j = dir > 0 ? Math.min(project.objects.length - 1, i + 1) : Math.max(0, i - 1);
      if (i === j) return;
      project.objects.splice(i, 1);
      project.objects.splice(j, 0, o);
      commit();
      renderAll();
    }
    /** 選択中オブジェクトを変更する。mode: 'now'=すぐ履歴に記録 / 'soon'=入力が止まったら記録 */
    function change(fn, mode) {
      var o = getSel();
      if (!o) return;
      fn(o);
      if (o.type === 'text') M.fitText(o);
      requestRender();
      syncInspector();
      if (o.type === 'text') buildLayers();
      if (mode === 'now') flushCommit(); else commitSoon();
    }

    /* ===== ポインタ操作 ===== */
    function toLogical(e) {
      var r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * project.width / r.width, y: (e.clientY - r.top) * project.height / r.height };
    }

    var CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'crosshair' };

    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      canvas.focus({ preventScroll: true });
      var p = toLogical(e);
      var sel = getSel();
      if (sel) {
        var hd = Rn.hitHandle(sel, p.x, p.y, state.zoom);
        if (hd) {
          drag = { mode: hd.id === 'rot' ? 'rotate' : 'resize', handle: hd, id: sel.id, start: U.clone(sel), p0: p };
          try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
          e.preventDefault();
          return;
        }
      }
      var hit = Rn.hitTest(project, p.x, p.y, 4 / state.zoom);
      if (hit) {
        select(hit.id);
        drag = { mode: 'move', id: hit.id, p0: p, ox: hit.x, oy: hit.y };
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
        e.preventDefault();
      } else {
        select(null);
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = toLogical(e);
      if (!drag) {
        var sel = getSel();
        var cur = 'default';
        if (sel) {
          var hd = Rn.hitHandle(sel, p.x, p.y, state.zoom);
          if (hd) cur = CURSORS[hd.id];
          else if (Rn.hitObject(sel, p.x, p.y, 4 / state.zoom)) cur = 'move';
        }
        if (cur === 'default' && Rn.hitTest(project, p.x, p.y, 4 / state.zoom)) cur = 'pointer';
        canvas.style.cursor = cur;
        return;
      }
      var o = getSel();
      if (!o || o.id !== drag.id) return;
      if (drag.mode === 'move') {
        o.x = U.clamp(drag.ox + (p.x - drag.p0.x), 0, project.width);
        o.y = U.clamp(drag.oy + (p.y - drag.p0.y), 0, project.height);
      } else if (drag.mode === 'rotate') {
        var a = Math.atan2(p.y - o.y, p.x - o.x) * 180 / Math.PI + 90;
        a = ((a + 540) % 360) - 180;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        o.rotation = U.round(a, 1);
      } else {
        doResize(o, p, e.shiftKey);
      }
      requestRender();
      syncInspector();
    });

    function doResize(o, p, shift) {
      var s = drag.start, hd = drag.handle;
      var dx = p.x - s.x, dy = p.y - s.y;
      var rad = -s.rotation * Math.PI / 180;
      var lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      var ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      var nw = s.w, nh = s.h;
      if (hd.hx !== 0) nw = Math.max(MIN_SIZE, hd.hx * lx + s.w / 2);
      if (hd.hy !== 0) nh = Math.max(MIN_SIZE, hd.hy * ly + s.h / 2);
      var corner = hd.hx !== 0 && hd.hy !== 0;
      if (corner && (shift || s.type === 'text')) {
        var sc = Math.max(nw / s.w, nh / s.h);
        nw = s.w * sc; nh = s.h * sc;
        if (s.type === 'text') {
          o.fontSize = U.clamp(Math.round(s.fontSize * sc), 8, 600);
          M.fitText(o);
          nw = o.w; nh = o.h;
        }
      }
      if (s.type !== 'text') { o.w = U.round(nw, 1); o.h = U.round(nh, 1); }
      var cxl = hd.hx !== 0 ? hd.hx * (nw - s.w) / 2 : 0;
      var cyl = hd.hy !== 0 ? hd.hy * (nh - s.h) / 2 : 0;
      var r2 = s.rotation * Math.PI / 180;
      o.x = U.round(s.x + cxl * Math.cos(r2) - cyl * Math.sin(r2), 1);
      o.y = U.round(s.y + cxl * Math.sin(r2) + cyl * Math.cos(r2), 1);
    }

    function endDrag(e) {
      if (!drag) return;
      drag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      flushCommit();
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('dblclick', function (e) {
      var p = toLogical(e);
      var hit = Rn.hitTest(project, p.x, p.y, 4 / state.zoom);
      if (hit && hit.type === 'text') {
        select(hit.id);
        var ta = document.getElementById('insp-text');
        if (ta) { ta.focus(); ta.select(); }
      }
    });

    /* ===== キーボード ===== */
    function onKey(e) {
      if (state.destroyed || document.body.classList.contains('modal-open')) return;
      var t = e.target || {};
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable;
      var mod = e.ctrlKey || e.metaKey;
      var k = (e.key || '').toLowerCase();
      if (mod && k === 's') { e.preventDefault(); manualSave(); return; }
      if (typing) return;
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
      if (mod) return;
      var sel = getSel();
      if (!sel) return;
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSel(); return; }
      if (k === 'escape') { select(null); return; }
      var step = e.shiftKey ? 10 : 1;
      var moved = true;
      if (k === 'arrowleft') sel.x -= step;
      else if (k === 'arrowright') sel.x += step;
      else if (k === 'arrowup') sel.y -= step;
      else if (k === 'arrowdown') sel.y += step;
      else moved = false;
      if (moved) {
        e.preventDefault();
        sel.x = U.clamp(sel.x, 0, project.width); sel.y = U.clamp(sel.y, 0, project.height);
        requestRender(); syncInspector(); commitSoon();
      }
    }
    document.addEventListener('keydown', onKey);

    /* ===== インスペクタ部品 ===== */
    function addSync(fn) { syncers.push(fn); }
    function syncInspector() { for (var i = 0; i < syncers.length; i++) syncers[i](); }

    function fieldWrap(label, control, extra) {
      return h('div', { class: 'field' }, h('label', { class: 'field-label' }, label, extra || null), control);
    }

    function numField(label, get, set, opts) {
      opts = opts || {};
      var input = h('input', { class: 'input', type: 'number', step: opts.step || 1, min: opts.min, max: opts.max, inputmode: 'decimal', disabled: opts.readonly || null });
      var wrapEl = fieldWrap(label, input);
      var lab = wrapEl.firstChild;
      input.id = 'f-' + Math.random().toString(36).slice(2, 7);
      lab.setAttribute('for', input.id);
      function sync() {
        var o = getSel();
        if (!o || document.activeElement === input) return;
        input.value = String(U.round(get(o), 1));
      }
      input.addEventListener('input', function () {
        var v = parseFloat(input.value);
        if (!isFinite(v)) return;
        if (opts.min !== undefined) v = Math.max(opts.min, v);
        if (opts.max !== undefined) v = Math.min(opts.max, v);
        change(function (o) { set(o, v); }, 'soon');
      });
      input.addEventListener('change', function () { flushCommit(); input.value = String(U.round(get(getSel() || { }) || 0, 1)); });
      addSync(sync); sync();
      return wrapEl;
    }

    function colorField(label, get, set, withSwatches) {
      var input = h('input', { type: 'color', 'aria-label': label });
      var wrapEl = h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
      if (withSwatches) {
        var sw = h('div', { class: 'swatches' });
        M.ACCENTS.concat(['#15171b', '#ffffff']).forEach(function (c) {
          sw.appendChild(h('button', { type: 'button', class: 'swatch', style: { background: c }, 'aria-label': c + ' を適用', title: c, onclick: function () { change(function (o) { set(o, c); }, 'now'); } }));
        });
        wrapEl.appendChild(sw);
      }
      function sync() {
        var o = getSel(); if (!o) return;
        var v = get(o);
        if (v && document.activeElement !== input) input.value = v;
      }
      input.addEventListener('input', function () { change(function (o) { set(o, input.value); }, 'soon'); });
      input.addEventListener('change', function () { flushCommit(); });
      addSync(sync); sync();
      return wrapEl;
    }

    function rangeField(label, get, set, min, max, step, fmt) {
      var input = h('input', { type: 'range', min: min, max: max, step: step, 'aria-label': label });
      var out = h('output');
      var wrapEl = h('div', { class: 'field' }, h('span', { class: 'field-label' }, label, out), input);
      function paint() {
        var v = parseFloat(input.value);
        input.style.setProperty('--fill', ((v - min) / (max - min) * 100) + '%');
        out.textContent = fmt ? fmt(v) : String(v);
      }
      function sync() {
        var o = getSel(); if (!o) return;
        if (document.activeElement !== input) input.value = get(o);
        paint();
      }
      input.addEventListener('input', function () { paint(); change(function (o) { set(o, parseFloat(input.value)); }, 'soon'); });
      input.addEventListener('change', function () { flushCommit(); });
      addSync(sync); sync();
      return wrapEl;
    }

    function panel(title, small) {
      var p = h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, title, small ? h('small', null, small) : null));
      for (var i = 2; i < arguments.length; i++) U.append(p, arguments[i]);
      return p;
    }

    /* ===== 右パネル: 選択中 / キャンバス ===== */
    function buildSelection() {
      syncers = [];
      U.clear(selHost);
      var o = getSel();
      if (!o) { buildCanvasPanel(); return; }

      selHost.appendChild(panel('Object', M.TYPE_LABEL[o.type],
        h('div', { class: 'panel-actions' },
          UI.button('複製', { icon: 'copy', small: true, kind: 'ghost', onclick: duplicateSel }),
          UI.button('前面', { icon: 'up', small: true, kind: 'ghost', title: '一つ前面へ', onclick: function () { moveZ(1); } }),
          UI.button('背面', { icon: 'down', small: true, kind: 'ghost', title: '一つ背面へ', onclick: function () { moveZ(-1); } }),
          UI.button('削除', { icon: 'trash', small: true, kind: 'ghost', title: '削除 (Delete)', onclick: deleteSel }))));

      if (o.type === 'text') {
        var ta = h('textarea', { class: 'textarea', id: 'insp-text', rows: 2, maxlength: 500, 'aria-label': 'テキストの内容' });
        ta.addEventListener('input', function () { change(function (ob) { ob.text = ta.value; }, 'soon'); });
        ta.addEventListener('change', flushCommit);
        addSync(function () { var ob = getSel(); if (ob && document.activeElement !== ta) ta.value = ob.text; });
        var weight = h('div', { class: 'seg', role: 'group', 'aria-label': '文字の太さ' });
        var wb = [[400, '標準'], [700, '太字']].map(function (w) {
          var b = h('button', { type: 'button', 'aria-pressed': 'false', onclick: function () { change(function (ob) { ob.fontWeight = w[0]; }, 'now'); } }, w[1]);
          b._w = w[0]; weight.appendChild(b); return b;
        });
        addSync(function () { var ob = getSel(); if (ob) wb.forEach(function (b) { b.setAttribute('aria-pressed', String(ob.fontWeight === b._w)); }); });
        selHost.appendChild(panel('Text', null,
          fieldWrap('内容', ta),
          h('div', { class: 'field-row' },
            numField('サイズ', function (ob) { return ob.fontSize; }, function (ob, v) { ob.fontSize = U.clamp(v, 8, 600); }, { min: 8, max: 600 }),
            fieldWrap('太さ', weight))));
      }

      // 塗り
      var fillOn = h('input', { type: 'checkbox' });
      var fillColor = colorField('色', function (ob) { return ob.fill; }, function (ob, v) { ob.fill = v; }, true);
      var fillColorInput = fillColor.querySelector('input');
      var fillCheck = h('label', { class: 'check' }, fillOn, h('span', { class: 'box' }), '塗りつぶし');
      fillOn.addEventListener('change', function () {
        change(function (ob) { ob.fill = fillOn.checked ? (ob.fill || fillColorInput.value || '#b8ff3d') : null; }, 'now');
      });
      addSync(function () { var ob = getSel(); if (ob) { fillOn.checked = !!ob.fill; fillColorInput.disabled = !ob.fill; if (!ob.fill) fillColorInput.value = '#b8ff3d'; } });

      var style = panel('Style', null, fillCheck, fillColor,
        h('div', { class: 'field-row' },
          colorField('線の色', function (ob) { return ob.stroke; }, function (ob, v) { ob.stroke = v; }),
          numField('線の太さ', function (ob) { return ob.strokeWidth; }, function (ob, v) { ob.strokeWidth = U.clamp(v, 0, 80); }, { min: 0, max: 80 })),
        rangeField('不透明度', function (ob) { return Math.round(ob.opacity * 100); }, function (ob, v) { ob.opacity = v / 100; }, 0, 100, 1, function (v) { return v + '%'; }));
      if (o.type === 'rect') {
        style.appendChild(rangeField('角の丸み', function (ob) { return ob.radius || 0; }, function (ob, v) { ob.radius = v; }, 0, 200, 1, function (v) { return v + 'px'; }));
      }
      selHost.appendChild(style);

      selHost.appendChild(panel('Transform', null,
        h('div', { class: 'field-row' },
          numField('X', function (ob) { return ob.x; }, function (ob, v) { ob.x = v; }),
          numField('Y', function (ob) { return ob.y; }, function (ob, v) { ob.y = v; })),
        h('div', { class: 'field-row' },
          numField('幅', function (ob) { return ob.w; }, function (ob, v) { ob.w = Math.max(MIN_SIZE, v); }, { min: MIN_SIZE, readonly: o.type === 'text' }),
          numField('高さ', function (ob) { return ob.h; }, function (ob, v) { ob.h = Math.max(MIN_SIZE, v); }, { min: MIN_SIZE, readonly: o.type === 'text' })),
        numField('回転 (°)', function (ob) { return ob.rotation; }, function (ob, v) { ob.rotation = U.clamp(v, -360, 360); }, { min: -360, max: 360 })));
      syncInspector();
    }

    function buildCanvasPanel() {
      var bg = h('input', { type: 'color', 'aria-label': '背景色' });
      bg.value = project.background;
      bg.addEventListener('input', function () { project.background = bg.value; requestRender(); commitSoon(); });
      bg.addEventListener('change', flushCommit);
      var bgSw = h('div', { class: 'swatches' });
      ['#1d2127', '#101216', '#f2f4f8', '#ffffff', '#2a1b4d', '#12301f', '#3a1330'].forEach(function (c) {
        bgSw.appendChild(h('button', { type: 'button', class: 'swatch', style: { background: c }, 'aria-label': '背景を ' + c + ' にする', onclick: function () { project.background = c; bg.value = c; requestRender(); flushCommit(); } }));
      });
      var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'キャンバスサイズ' });
      var segBtns = M.CANVAS_PRESETS.map(function (pr) {
        var b = h('button', { type: 'button', 'aria-pressed': String(project.width === pr.w && project.height === pr.h), title: pr.w + '×' + pr.h, onclick: function () {
          flushCommit();
          project.width = pr.w; project.height = pr.h;
          commit(); fit(); render();
          segBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        } }, pr.label);
        seg.appendChild(b); return b;
      });
      selHost.appendChild(panel('Canvas', '何も選択していません',
        fieldWrap('背景色', bg), bgSw,
        fieldWrap('サイズ', seg),
        h('div', { class: 'kbd-list' },
          h('div', null, h('span', null, '作成'), h('span', null, U.fmtDate(project.createdAt))),
          h('div', null, h('span', null, 'オブジェクト'), h('span', null, project.objects.length + ' 個')))));
    }

    function buildLayers() {
      U.clear(layersHost);
      var list = h('div', { class: 'layers', role: 'list' });
      if (!project.objects.length) {
        list.appendChild(h('div', { class: 'layer-empty' }, 'まだ何もありません'));
      } else {
        for (var i = project.objects.length - 1; i >= 0; i--) {
          (function (o) {
            var b = h('button', { type: 'button', class: 'layer', role: 'listitem', 'aria-pressed': String(o.id === state.selId), onclick: function () { select(o.id); } });
            b.appendChild(UI.icon(o.type));
            b.appendChild(h('span', null, M.objectLabel(o)));
            b.appendChild(h('span', { class: 'dot', style: { background: o.fill || 'transparent' } }));
            list.appendChild(b);
          })(project.objects[i]);
        }
      }
      layersHost.appendChild(panel('Layers', project.objects.length + '', list));
    }

    /* ===== プロジェクト操作 ===== */
    function duplicateProject() {
      saveNow().then(function (ok) {
        if (!ok) { UI.toast('保存に失敗したため複製を中止しました', { type: 'error' }); return; }
        return PZ.projects.duplicate(project).then(function (c) {
          UI.toast('「' + c.name + '」を作りました', { type: 'ok' });
          Router.go('/studio/' + encodeURIComponent(c.id));
        });
      }).catch(function (e) { UI.toast('複製できませんでした: ' + (e && e.message), { type: 'error' }); });
    }
    function exportPng() {
      Rn.exportPng(project, 2).then(function (blob) {
        U.download(blob, U.safeFileName(project.name, '.png'));
        UI.toast('PNGを書き出しました', { type: 'ok', duration: 1800 });
      }).catch(function (e) { UI.toast(e.message, { type: 'error' }); });
    }

    /* ===== 作品名 ===== */
    nameInput.addEventListener('input', function () {
      project.name = nameInput.value;
      state.touched = true;
      markDirty();
    });
    nameInput.addEventListener('blur', function () {
      if (!project.name.trim()) { project.name = '無題の作品'; nameInput.value = project.name; markDirty(); }
    });
    nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') nameInput.blur(); });

    /* ===== 離脱時の保存 ===== */
    function onHide() { if (document.visibilityState === 'hidden') saveNow(); }
    function onPageHide() { saveNow(); }
    function onBeforeUnload(e) {
      if (state.saveState === 'error') { e.preventDefault(); e.returnValue = ''; return ''; }
    }
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);

    var ro = null;
    var refit = U.debounce(function () { fit(); render(); }, 60);
    if (window.ResizeObserver) { ro = new ResizeObserver(refit); ro.observe(stage); }
    else window.addEventListener('resize', refit);

    /* ===== 初期表示 ===== */
    updateHistoryButtons();
    setSaveState('saved');
    buildSelection();
    buildLayers();
    requestAnimationFrame(function () { fit(); render(); });
    // 外部（デバッグ・テスト）から状態を確認できるように
    PZ.studioDebug = { project: project, state: state, addObject: addObject, undo: undo, redo: redo, saveNow: saveNow, select: select };

    /* ===== 後片付け（ルーターが離脱時に await する） ===== */
    return function destroy() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('resize', refit);
      if (ro) ro.disconnect();
      refit.cancel();
      return saveNow().then(function () {
        // 作ってすぐ離れた「空のまま・未編集」の作品は残さない
        if (freshIds[project.id] && !state.touched && !project.objects.length) {
          delete freshIds[project.id];
          return PZ.projects.remove(project.id);
        }
      }).then(function () { state.destroyed = true; PZ.studioDebug = null; });
    };
  }
})();
