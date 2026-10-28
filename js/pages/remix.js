/*
 * Remix Workspace（PZ.pages.remix）— 作品を「改造」するための作業場
 *
 *  ・自作ツールを開いて、元はそのままに派生させる（保存すると新しい作品）／その場で編集する（履歴に残る）
 *  ・ブロックの追加・削除・複製・移動・つなぎ替え・数や色の変更は Create と同じエディター（PZ.creationWs）
 *  ・変更前との差分、並べて比較、保存前の確認、変更履歴、系統ツリー、部品、組み合わせ
 *  ・自動保存（下書き）と明示的な保存（作品＋履歴）は別。作品を勝手に上書きしない
 * 計算とデータは PZ.remix.*、画面の部品は PZ.remixUI / PZ.remixParts にあります。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.pages = PZ.pages || {};
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Cr = PZ.creation;
  var Kit = PZ.labKit;
  var P = PZ.projects;
  var R = PZ.remix;
  var W = R.work;
  var X = PZ.remixUI;

  var RUN_LABEL = { idle: 'IDLE', running: 'RUNNING', paused: 'PAUSED', stopped: 'STOPPED', finished: 'FINISHED', error: 'ERROR' };
  function J(x) { return JSON.parse(JSON.stringify(x)); }
  function noop() { /* 失敗しても動作は続ける */ }
  var TABS = [['diff', '変更'], ['parts', '部品'], ['hist', '履歴'], ['tree', '系統'], ['vars', 'へんすう'], ['check', 'チェック']];

  PZ.pages.remix = {
    title: 'Remix',
    nav: 'remix',
    mount: function (root, ctx) {
      var alive = true;
      // mode: 'start'（まだ何も開いていない）| 'derive'（元から派生。未保存）| 'edit'（保存済みの作品をその場で編集）| 'new'（白紙・読み込み。未保存）
      var st = {
        mode: 'start', creation: Cr.blank(), workId: null, spec: null, baseline: null, baselineLabel: '', loadedAt: 0, name: '', defaultName: '',
        tags: [], parts: [], baseJson: '', busy: false, check: null, draftKey: null, originName: ''
      };
      var past = [], future = [], lastSnap = '';
      var rt = null, raf = 0, lastT = 0, lastWatch = 0, prevState = 'idle', watchKey = '';
      var autoRun = true, tab = 'diff';
      var reduced = U.prefersReducedMotion();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var diffCache = null;

      /* ================= 部品 ================= */
      var nameInput = h('input', { class: 'input cr-name', type: 'text', maxlength: PZ.config.limits.projectNameLength, placeholder: '作品の名前', 'aria-label': '作品の名前', autocomplete: 'off' });
      var statusEl = h('span', { class: 'cr-status', role: 'status', 'aria-live': 'polite' });
      var originEl = h('div', { class: 'rx-origin' });
      var undoBtn = UI.iconButton('undo', '元に戻す (Ctrl+Z)', function () { undo(); });
      var redoBtn = UI.iconButton('redo', 'やり直す (Ctrl+Y)', function () { redo(); });
      var saveBtn = UI.button('保存', { icon: 'save', kind: 'primary', title: '変更内容を確認してから保存 (Ctrl+S)', onclick: function () { save('main'); } });
      var saveAsBtn = UI.button('別の派生として保存', { icon: 'branch', kind: 'ghost', title: '今の作品はそのまま、新しい作品として保存します', onclick: function () { save('derive'); } });
      var fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-hidden': 'true' });
      var openBtn = UI.button('開く', { icon: 'folder', kind: 'ghost', small: true, onclick: function () { openPicker(); } });
      var bar = h('div', { class: 'card cr-bar', hidden: true },
        h('div', { class: 'cr-bar-row' }, nameInput, statusEl),
        originEl,
        h('div', { class: 'cr-bar-row cr-tools' },
          openBtn,
          UI.button('新規', { icon: 'plus', kind: 'ghost', small: true, onclick: function () { confirmDiscard().then(function (ok) { if (ok) { startBlank(); } }); } }),
          undoBtn, redoBtn,
          h('span', { class: 'grow' }),
          UI.button('読み込み', { icon: 'upload', kind: 'ghost', small: true, title: 'Remix ファイル(.pzremix.json)や自作ツールファイルを、内容を確認してから取り込む', onclick: function () { fileInput.click(); } }),
          UI.button('書き出し', { icon: 'download', kind: 'ghost', small: true, title: '作品・履歴・部品をまとめて .pzremix.json に書き出す', onclick: function () { exportPackage(); } }),
          saveAsBtn, saveBtn));
      var bannerHost = h('div');
      var startHost = h('div');

      /* ---- ワークスペース ---- */
      var cursorEl = h('div', { class: 'cr-cursor', 'aria-live': 'polite' });
      var selHelp = h('div', { class: 'cr-selhelp' });
      var countEl = h('small', null, '');
      var ws = PZ.creationWs.create({
        get: function () { return st.creation; },
        onChange: onChange,
        onCursor: function (t) { cursorEl.textContent = ''; cursorEl.appendChild(h('span', null, '追加先: ')); cursorEl.appendChild(h('b', null, t)); },
        onSelect: function (spec) { selHelp.textContent = spec ? spec.name + '：' + spec.hint : ''; },
        onSamples: function () { openPicker(); }
      });
      var palCard = h('aside', { class: 'card cr-pal', 'aria-label': 'ブロックのパレット' }, Kit.title('Blocks', 'ブロックを押して追加'), cursorEl, ws.paletteEl);
      var workCard = h('section', { class: 'card cr-work', 'aria-label': 'ブロックを並べる場所' }, h('div', { class: 'panel-title' }, 'Script', countEl), selHelp, ws.el);

      /* ---- プレビュー ---- */
      var canvas = h('canvas', { class: 'cr-canvas', role: 'img', 'aria-label': '作品のプレビュー。クリックやタップ、マウスの動きに反応します。' });
      var g = canvas.getContext('2d');
      var stateInfo = h('b', null, 'IDLE');
      var stageEl = h('div', { class: 'lab-stage cr-stage', tabindex: '0' }, canvas,
        h('div', { class: 'lab-stage-bar' }, h('span', null, 'PREVIEW'), h('span', { 'aria-live': 'off' }, stateInfo)));
      var runBtn = UI.button('実行', { icon: 'play', kind: 'primary', onclick: function () { runOrPause(); } });
      var stopBtn = UI.button('停止', { icon: 'stop', kind: 'ghost', title: '止める（絵はそのまま残ります）', onclick: function () { if (rt) { rt.stop(); syncRun(); } } });
      var resetBtn = UI.button('リセット', { icon: 'reset', kind: 'ghost', title: '画面とへんすうを最初の状態に戻す', onclick: function () { resetRun(); } });
      var cmpBtn = UI.button('変更前と並べて比べる', { icon: 'eye', kind: 'ghost', small: true, onclick: function () { openCompare(null); } });
      var autoChk = Kit.check('ブロックを変えたら、すぐ反映', { get: function () { return autoRun; }, set: function (v) { autoRun = v; } });
      autoChk.sync();
      var errBox = h('div', { class: 'cr-err', role: 'alert', hidden: true });
      var stageCard = h('div', { class: 'card lab-panel cr-stagecard' },
        Kit.title('Preview', 'リアルタイム'), stageEl,
        h('div', { class: 'cr-controls' }, runBtn, stopBtn, resetBtn), errBox, autoChk.el, h('div', { class: 'rx-cmpbtn' }, cmpBtn));
      var tuneHost = h('div', { class: 'cr-tune' });
      var tuneCard = h('div', { class: 'card lab-panel', hidden: true }, Kit.title('Knobs', 'つまみ（ルールを変える）'), tuneHost);
      var liveHost = h('div', { class: 'cr-live' });
      var liveCard = h('details', { class: 'card cr-fold' }, h('summary', null, UI.icon('variable'), h('span', null, '実行中の値'), h('small', null, 'Live')), h('div', { class: 'cr-fold-body' }, liveHost));
      var aux = h('div', { class: 'cr-aux' }, tuneCard, liveCard);

      /* ---- インスペクター（タブ） ---- */
      var tabBtns = {}, panels = {};
      var tabList = h('div', { class: 'rx-tabs', role: 'tablist', 'aria-label': 'Remix の作業パネル' });
      TABS.forEach(function (t) {
        var b = h('button', { type: 'button', class: 'rx-tab', role: 'tab', id: 'rxt-' + t[0], 'aria-controls': 'rxp-' + t[0], 'aria-selected': 'false', tabindex: '-1' }, t[1]);
        b.addEventListener('click', function () { setTab(t[0], true); });
        b.addEventListener('keydown', function (e) {
          var i = TABS.map(function (x) { return x[0]; }).indexOf(t[0]);
          var to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
          if (to < 0) return;
          e.preventDefault(); setTab(TABS[(to + TABS.length) % TABS.length][0], true);
        });
        tabBtns[t[0]] = b; tabList.appendChild(b);
        panels[t[0]] = h('div', { class: 'rx-panel', role: 'tabpanel', id: 'rxp-' + t[0], 'aria-labelledby': 'rxt-' + t[0], hidden: true });
      });
      var diffHost = h('div'), histHost = h('div'), treeHost = h('div'), varsHost = h('div', { class: 'cr-vars' }), checkHost = h('div', { class: 'cr-check' });
      var aboutHost = h('div', { class: 'cr-about' });
      panels.diff.appendChild(diffHost); panels.hist.appendChild(histHost); panels.tree.appendChild(treeHost);
      panels.vars.appendChild(h('p', { class: 'work-hint' }, 'へんすうは、数や文字をしまっておく箱です。「初期値」は実行・リセットのたびに戻る値。「つまみ」にすると、プレビューの横にスライダーが出ます。'));
      panels.vars.appendChild(varsHost); panels.vars.appendChild(h('div', { class: 'panel-title', style: { marginTop: '12px' } }, 'このツールについて')); panels.vars.appendChild(aboutHost);
      panels.check.appendChild(checkHost);
      var partsUI = PZ.remixParts.create({
        get: function () { return st.creation; },
        target: function () { return ws.getTarget(); },
        targetLabel: function () { return ws.cursorLabel(); },
        selectedId: function () { return ws.getSel(); },
        workId: function () { return st.workId; },
        apply: applyParts
      });
      panels.parts.appendChild(partsUI.el);
      var inspector = h('section', { class: 'card rx-inspector', 'aria-label': '作業パネル' }, tabList, TABS.map(function (t) { return panels[t[0]]; }));

      var howto = h('details', { class: 'card howto' },
        h('summary', null, UI.icon('eye'), h('span', null, 'Remix の使い方（4ステップ）'), h('small', null, 'REMIX')),
        h('ol', null,
          h('li', null, '「開く」で、改造したい作品かサンプルを選びます。「派生して開く」なら、元の作品はそのままです。'),
          h('li', null, 'ブロックを足す・消す・並べ替える・数や色を変える。すぐにプレビューへ反映されます（下の「変更」に差分が出ます）。'),
          h('li', null, '「部品」から、動きの部品を挿入したり、ほかの作品のスクリプトを組み合わせたりできます。'),
          h('li', null, '「保存」を押すと、変更内容を確認してから保存します。昔の版は「履歴」から、別の作品として復元できます。')),
        h('p', { class: 'work-hint', style: { margin: '10px 0 0' } }, 'ドラッグでも置けます（スマホはボタンで追加、↑↓で順番を変更）。キーボードでは Tab でブロックへ移動し、Alt+↑↓ で並べ替え、Delete で削除、Ctrl+D で複製。'));

      var workspace = h('div', { class: 'rx-workspace', hidden: true },
        h('div', { class: 'cr-layout rx-layout' }, palCard, workCard, stageCard, aux), inspector);

      root.appendChild(h('div', { class: 'container cr-page rx-page' },
        h('header', { class: 'page-head' },
          h('div', { class: 'crumbs' }, 'Create', h('span', null, '/'), h('span', { style: { color: 'var(--lime)' } }, 'Remix Workspace')),
          h('h1', { class: 'page-title' }, '作品を改造する ', h('em', null, 'REMIX')),
          h('p', { class: 'page-lead' }, '自分の作品を、元を残したまま派生させて作り変えよう。変更は差分で確認でき、昔の版にも戻せます。部品をつなげて、新しい動きも足せます。')),
        bar, bannerHost, startHost, workspace, howto, fileInput));

      /* ================= タブ ================= */
      function setTab(id, focus) {
        tab = id;
        TABS.forEach(function (t) {
          var on = t[0] === id;
          tabBtns[t[0]].setAttribute('aria-selected', on ? 'true' : 'false');
          tabBtns[t[0]].tabIndex = on ? 0 : -1;
          panels[t[0]].hidden = !on;
        });
        if (focus) tabBtns[id].focus();
        paintTab(id);
      }
      function paintTab(id) {
        if (id === 'diff') paintDiff(); else if (id === 'hist') paintHist(); else if (id === 'tree') paintTree();
        else if (id === 'parts') partsUI.refresh();
      }
      function markTab(id, text) {
        var t = TABS.filter(function (x) { return x[0] === id; })[0];
        tabBtns[id].textContent = t[1] + (text ? ' ' + text : '');
      }

      /* ================= 状態・履歴（Undo/Redo） ================= */
      function snapJson() { return JSON.stringify({ n: nameInput.value, c: st.creation }); }
      function isDirty() { return st.mode !== 'start' && snapJson() !== st.baseJson; }
      function changedFromBaseline() { return st.baseline ? !R.sameCreation(st.baseline, st.creation) : false; }

      function updateStatus() {
        var dirty = isDirty(), txt, cls = 'cr-status';
        if (st.busy) txt = '保存中…';
        else if (st.mode === 'derive') { txt = dirty ? '派生中・未保存の変更あり' : '派生中（まだ保存していません）'; cls += ' new'; }
        else if (st.mode === 'new') { txt = '未保存の新規' + (dirty ? '（変更あり）' : ''); cls += ' new'; }
        else if (dirty) { txt = '未保存の変更があります'; cls += ' dirty'; }
        else { txt = '保存済み ' + U.fmtDate(st.loadedAt).slice(11); cls += ' saved'; }
        statusEl.textContent = txt; statusEl.className = cls;
        var lbl = saveBtn.querySelector('.btn-label');
        lbl.textContent = st.mode === 'edit' ? '上書き保存' : st.mode === 'derive' ? '派生として保存' : '保存';
        saveAsBtn.hidden = st.mode !== 'edit';
        undoBtn.disabled = !past.length; redoBtn.disabled = !future.length;
        U.clear(originEl);
        if (st.mode === 'derive') {
          originEl.appendChild(h('span', { class: 'badge purple' }, '派生元'));
          originEl.appendChild(h('b', null, st.originName));
          originEl.appendChild(h('small', null, '元の作品は変わりません。保存すると新しい作品になります。'));
        } else if (st.mode === 'edit') {
          var w = st.remixInfo;
          if (w && w.origin) {
            originEl.appendChild(h('span', { class: 'badge purple' }, '派生元'));
            originEl.appendChild(h('b', null, w.origin.name || '（名前なし）'));
            if (w.origin.ver !== null && w.origin.ver !== undefined) originEl.appendChild(h('small', null, 'v' + w.origin.ver + ' から派生'));
          } else originEl.appendChild(h('small', null, 'この作品を直接編集しています。保存前の状態は履歴に残ります。'));
        }
      }

      function commit() {
        var cur = JSON.stringify(st.creation);
        if (cur !== lastSnap) { past.push(lastSnap); if (past.length > 100) past.shift(); future = []; lastSnap = cur; }
      }
      var commitSoon = U.debounce(function () { commit(); updateStatus(); }, 500);
      var diffSoon = U.debounce(function () { diffCache = null; if (alive && tab === 'diff') paintDiff(); updateDiffMark(); }, 300);

      function afterReplace() {
        diffCache = null;
        ws.render(); validateNow(); renderVars(); renderTune(); renderAbout(); applyCanvasSize(); updateStatus(); saveDraft(); restartSoon(); diffSoon();
      }
      function undo() { commitSoon.cancel(); commit(); if (!past.length) return; future.push(lastSnap); lastSnap = past.pop(); st.creation = JSON.parse(lastSnap); afterReplace(); }
      function redo() { commitSoon.cancel(); if (!future.length) return; past.push(lastSnap); lastSnap = future.pop(); st.creation = JSON.parse(lastSnap); afterReplace(); }

      function onChange(kind) {
        if (kind === 'struct') { commitSoon.cancel(); commit(); renderVars(); renderTune(); } else commitSoon();
        validateNow(); updateStatus(); saveDraft(); restartSoon(); diffSoon();
      }

      function validateNow() {
        var v = Cr.validate(st.creation);
        st.check = v;
        var list = v.errors.map(function (e) { return { id: e.id, msg: e.msg }; }).concat(v.warnings.map(function (w) { return { id: w.id, msg: w.msg, warn: true }; }));
        ws.setIssues(list);
        countEl.textContent = v.stats.blocks + ' ブロック · ' + v.stats.scripts + ' スクリプト';
        renderChecks();
        markTab('check', v.errors.length ? '(' + v.errors.length + ')' : '');
      }

      function renderChecks() {
        U.clear(checkHost);
        var v = st.check;
        if (!v.errors.length && !v.warnings.length) { checkHost.appendChild(h('p', { class: 'cr-ok' }, UI.icon('check'), 'ブロックに問題はありません。')); return; }
        function row(it, cls) {
          var inner = [UI.icon(cls === 'err' ? 'alert' : 'eye'), h('span', null, it.msg)];
          if (it.id) return h('button', { type: 'button', class: 'cr-issue ' + cls, onclick: function () { ws.focusBlock(it.id); } }, inner);
          return h('div', { class: 'cr-issue ' + cls }, inner);
        }
        v.errors.slice(0, 8).forEach(function (e) { checkHost.appendChild(row(e, 'err')); });
        if (v.errors.length > 8) checkHost.appendChild(h('p', { class: 'work-hint' }, '…ほか ' + (v.errors.length - 8) + ' 件'));
        v.warnings.slice(0, 6).forEach(function (w) { checkHost.appendChild(row(w, 'warn')); });
        checkHost.appendChild(h('p', { class: 'work-hint' }, v.errors.length ? 'エラーがあると実行できません。押すと、そのブロックへ移動します。' : '警告があっても実行できます。'));
      }

      /* ================= 差分 ================= */
      function currentDiff() {
        if (!st.baseline) return null;
        if (!diffCache) diffCache = R.diff(st.baseline, st.creation);
        return diffCache;
      }
      function updateDiffMark() {
        var d = currentDiff();
        var n = d && !d.same ? d.counts.added + d.counts.removed + d.counts.changed + d.counts.moved + d.vars.added.length + d.vars.removed.length + d.vars.changed.length + d.meta.length + (d.name ? 1 : 0) : 0;
        markTab('diff', n ? '(' + n + ')' : '');
        cmpBtn.disabled = !changedFromBaseline();
      }
      function paintDiff() {
        U.clear(diffHost);
        var d = currentDiff();
        if (!d) { diffHost.appendChild(h('p', { class: 'work-hint' }, '作品を開くと、ここに変更前との違いが出ます。')); return; }
        diffHost.appendChild(h('p', { class: 'work-hint' }, '比べている相手: ' + st.baselineLabel + (d.same ? '' : '（押すと、そのブロックへ移動します）')));
        diffHost.appendChild(X.diffList(d, { onFocus: function (id) { ws.focusBlock(id); } }));
        if (!d.same) diffHost.appendChild(h('div', { class: 'rx-node-acts' }, UI.button('並べて動かして比べる', { small: true, kind: 'ghost', icon: 'eye', onclick: function () { openCompare(null); } })));
      }
      function openCompare(other) {
        var after = { creation: Cr.validate(st.creation, { lenient: true }).clean, label: '今の編集' };
        var before = other || { creation: st.baseline, label: st.baselineLabel };
        if (!before.creation) { UI.toast('比べる相手がありません', { type: 'warn' }); return; }
        if (rt && rt.state === 'running') { rt.pause(); syncRun(); }
        X.compareDialog(before, after, R.diff(before.creation, after.creation));
      }

      /* ================= 履歴 ================= */
      function paintHist() {
        U.clear(histHost);
        if (!st.workId) {
          histHost.appendChild(UI.emptyState('履歴は、保存すると始まります', st.mode === 'derive' ? '派生して保存すると、「派生元の状態」と最初の保存が履歴に入ります。' : '保存するたびに、変更の要約つきで版が増えます。', null));
          return;
        }
        var id = st.workId;
        R.store.history.list(id).then(function (list) {
          if (!alive || id !== st.workId || tab !== 'hist') return;
          U.clear(histHost);
          if (!list.length) { histHost.appendChild(UI.emptyState('まだ履歴がありません', '上書き保存すると、保存前の状態と新しい版が記録されます。', null)); return; }
          histHost.appendChild(h('p', { class: 'work-hint' }, '最大 ' + R.LIMITS.versions + ' 版まで残します（古い版から自動で整理。ピン留めした版と派生元は残ります）。自動保存の下書きは、ここには入りません。'));
          histHost.appendChild(X.historyList(list, {
            latestNo: list[0].no,
            onCompare: function (v) {
              R.store.history.getCreation(id, v.no).then(function (got) {
                if (!got) { UI.toast('その版を読み込めませんでした', { type: 'warn' }); return; }
                openCompare({ creation: got.creation, label: 'v' + v.no + '（' + R.store.history.KIND_LABEL[v.kind] + '）' });
              });
            },
            onRestore: function (v) {
              UI.confirm('v' + v.no + ' を、新しい別の作品として復元しますか？', { title: '版を復元', okText: '別の作品として復元', detail: '今の作品は変わりません。復元した作品は、この版から派生した作品として My Space に追加されます。' }).then(function (ok) {
                if (!ok) return;
                W.restoreAsNew(id, v.no).then(function (p) {
                  UI.toast('「' + p.name + '」として復元しました', { type: 'ok', duration: 6000, action: { label: '開く', onClick: function () { go('work', p.id); } } });
                  paintHist(); if (tab === 'tree') paintTree();
                }, function (e) { UI.toast('復元できませんでした: ' + ((e && e.message) || ''), { type: 'error', duration: 6000 }); });
              });
            },
            onPin: function (v) {
              R.store.history.pin(id, v.no, !v.pin).then(function (r) {
                if (r === false) UI.toast('ピン留めは ' + R.LIMITS.pins + ' 個までです', { type: 'warn' });
                paintHist();
              }, noop);
            }
          }));
        }, function () { U.clear(histHost); histHost.appendChild(h('p', { class: 'work-hint' }, '履歴を読み込めませんでした。')); });
      }

      /* ================= 系統ツリー ================= */
      function paintTree() {
        U.clear(treeHost);
        P.list({ kind: 'creation' }).then(function (works) {
          if (!alive || tab !== 'tree') return;
          U.clear(treeHost);
          var focusId = st.workId || (st.spec && st.spec.parentId) || null;
          var roots = R.buildTree(works);
          if (st.mode === 'derive' && st.spec && !st.spec.parentId) {
            treeHost.appendChild(h('p', { class: 'work-hint' }, 'サンプル「' + st.originName + '」から派生中です。保存すると、ここに系統が出ます。'));
          }
          var fam = focusId ? R.familyOf(roots, focusId) : null;
          if (!fam) {
            treeHost.appendChild(UI.emptyState('系統はまだありません', 'この作品はまだ保存されていないか、ほかの作品とつながっていません。派生して保存すると、ここに系統ツリーが出ます。', null));
            return;
          }
          var count = R.flattenTree([fam]).length;
          treeHost.appendChild(h('p', { class: 'work-hint' }, 'この作品の系統（' + count + ' 件）。元の作品を後から変えても、派生した作品は変わりません。元の作品を削除しても、系統は「削除済み」として残ります。'));
          treeHost.appendChild(X.treeView([fam], {
            currentId: st.workId,
            onOpen: function (p) { go('work', p.id); },
            onDerive: function (p) { go('from', p.id); }
          }));
        }, function () { U.clear(treeHost); treeHost.appendChild(h('p', { class: 'work-hint' }, '作品の一覧を読み込めませんでした。')); });
      }

      /* ================= へんすう・つまみ・説明 ================= */
      function typeOf(v) { return typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : 'text'; }
      function renderVars() {
        U.clear(varsHost);
        st.creation.vars.forEach(function (v, i) {
          var type = typeOf(v.value);
          var typeSel = h('select', { class: 'select cv-type', 'aria-label': v.name + ' の種類' }, h('option', { value: 'num' }, '数'), h('option', { value: 'text' }, '文字'), h('option', { value: 'bool' }, 'はい/いいえ'));
          typeSel.value = type;
          typeSel.addEventListener('change', function () { v.value = typeSel.value === 'num' ? 0 : typeSel.value === 'bool' ? true : ''; delete v.tune; onChange('struct'); });
          var valEl;
          if (type === 'bool') {
            valEl = h('select', { class: 'select cv-val', 'aria-label': v.name + ' の初期値' }, h('option', { value: 'true' }, 'はい'), h('option', { value: 'false' }, 'いいえ'));
            valEl.value = String(v.value);
            valEl.addEventListener('change', function () { v.value = valEl.value === 'true'; onChange('value'); });
          } else {
            valEl = h('input', { class: 'input cv-val', type: 'text', value: String(v.value), inputmode: type === 'num' ? 'decimal' : null, maxlength: 200, 'aria-label': v.name + ' の初期値', autocomplete: 'off' });
            valEl.addEventListener('input', function () {
              if (type === 'num') { var n = Number(valEl.value.trim()); if (valEl.value.trim() !== '' && isFinite(n)) { v.value = Math.max(-Cr.LIMITS.number, Math.min(Cr.LIMITS.number, n)); valEl.classList.remove('bad'); onChange('value'); } else valEl.classList.add('bad'); }
              else { v.value = valEl.value; onChange('value'); }
            });
          }
          var row = h('div', { class: 'cv-row' }, h('div', { class: 'cv-main' }, h('b', { class: 'cv-name' }, v.name), typeSel, valEl,
            UI.iconButton('edit', v.name + ' の名前を変える', function () { renameVar(v); }, 'mini'),
            UI.iconButton('trash', v.name + ' を削除', function () { st.creation.vars.splice(i, 1); onChange('struct'); }, 'mini danger')));
          if (type === 'num') {
            var tuneOn = !!v.tune;
            var chk = h('input', { type: 'checkbox' }); chk.checked = tuneOn;
            var mn = h('input', { class: 'input cv-mm', type: 'text', inputmode: 'decimal', value: tuneOn ? String(v.tune.min) : '0', 'aria-label': v.name + ' つまみの最小' });
            var mx = h('input', { class: 'input cv-mm', type: 'text', inputmode: 'decimal', value: tuneOn ? String(v.tune.max) : '100', 'aria-label': v.name + ' つまみの最大' });
            var stp = h('input', { class: 'input cv-mm', type: 'text', inputmode: 'decimal', value: tuneOn ? String(v.tune.step) : '1', 'aria-label': v.name + ' つまみの刻み' });
            var applyTune = function () {
              var a = Number(mn.value), b = Number(mx.value), s = Number(stp.value);
              if (!chk.checked) { delete v.tune; onChange('struct'); return; }
              if (!isFinite(a) || !isFinite(b) || a >= b) { UI.toast('つまみの「最小」は「最大」より小さくしてください', { type: 'warn', duration: 2600 }); return; }
              v.tune = { min: a, max: b, step: isFinite(s) && s > 0 ? s : 1 };
              v.value = Math.max(a, Math.min(b, v.value));
              onChange('struct');
            };
            chk.addEventListener('change', applyTune);
            [mn, mx, stp].forEach(function (x) { x.addEventListener('change', function () { if (chk.checked) applyTune(); }); });
            var wrap = h('span', { class: 'cv-mmwrap', hidden: !tuneOn }, '最小', mn, '最大', mx, '刻み', stp);
            row.appendChild(h('div', { class: 'cv-tune' }, h('label', { class: 'check' }, chk, h('span', { class: 'box' }), 'つまみにする'), wrap));
            chk.addEventListener('change', function () { wrap.hidden = !chk.checked; });
          }
          varsHost.appendChild(row);
        });
        if (!st.creation.vars.length) varsHost.appendChild(h('p', { class: 'work-hint' }, 'へんすうはまだありません。'));
        var nn = h('input', { class: 'input', type: 'text', maxlength: 20, placeholder: '新しいへんすうの名前', 'aria-label': '新しいへんすうの名前', autocomplete: 'off' });
        function add() {
          var nm = nn.value.trim();
          if (!nm) { nn.focus(); return; }
          if (!Cr.isVarName(nm)) { UI.toast('この名前は使えません（20文字まで。空白や記号 " \' < > & \\ は不可）', { type: 'warn' }); return; }
          if (st.creation.vars.some(function (x) { return x.name === nm; })) { UI.toast('同じ名前のへんすうがあります', { type: 'warn' }); return; }
          if (st.creation.vars.length >= Cr.LIMITS.vars) { UI.toast('へんすうは ' + Cr.LIMITS.vars + ' 個までです', { type: 'warn' }); return; }
          st.creation.vars.push({ name: nm, value: 0 }); onChange('struct');
        }
        nn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        varsHost.appendChild(h('div', { class: 'seed-row cv-add' }, nn, UI.button('追加', { kind: 'ghost', small: true, icon: 'plus', onclick: add })));
      }
      function renameVar(v) {
        UI.promptText({ title: 'へんすうの名前を変える', value: v.name, maxLength: 20 }).then(function (nm) {
          if (!nm || nm === v.name) return;
          if (!Cr.isVarName(nm)) { UI.toast('この名前は使えません', { type: 'warn' }); return; }
          if (st.creation.vars.some(function (x) { return x.name === nm; })) { UI.toast('同じ名前のへんすうがあります', { type: 'warn' }); return; }
          var old = v.name; v.name = nm;
          Cr.walk(st.creation, function (b) { if ((b.type === 'set' || b.type === 'change' || b.type === 'var') && b.in.name === old) b.in.name = nm; });
          ws.render(); onChange('struct');
          UI.toast('ブロックの中の名前も、まとめて変えました', { type: 'ok', duration: 2000 });
        });
      }
      function renderTune() {
        U.clear(tuneHost);
        var any = false;
        st.creation.vars.forEach(function (v) {
          if (!v.tune || typeof v.value !== 'number') return;
          any = true;
          var r = Kit.range(v.name, {
            min: v.tune.min, max: v.tune.max, step: v.tune.step,
            get: function () { return v.value; },
            set: function (val) { v.value = val; if (rt) rt.setVarLive(v.name, val); onChange('value'); },
            fmt: function (val) { return String(Math.round(val * 1000) / 1000); }
          });
          r.sync(); tuneHost.appendChild(r.el);
        });
        tuneCard.hidden = !any;
      }
      function renderAbout() {
        U.clear(aboutHost);
        var desc = h('textarea', { class: 'textarea', rows: 3, maxlength: Cr.LIMITS.desc, placeholder: 'どんなツールか、遊び方など（任意）', 'aria-label': '説明' });
        desc.value = st.creation.description || '';
        desc.addEventListener('input', function () { st.creation.description = desc.value; onChange('value'); });
        var bg = h('input', { class: 'in-color', type: 'color', value: st.creation.canvas.bg, 'aria-label': '背景色' });
        bg.addEventListener('input', function () { st.creation.canvas.bg = bg.value; onChange('value'); });
        aboutHost.appendChild(h('div', { class: 'field' }, h('label', { class: 'field-label' }, '説明'), desc));
        aboutHost.appendChild(h('div', { class: 'field' }, h('label', { class: 'field-label' }, '背景色（「画面を消す」の色）'), bg));
      }

      /* ================= 実行・プレビュー ================= */
      function applyCanvasSize() {
        var Wd = st.creation.canvas.w, Ht = st.creation.canvas.h;
        canvas.width = Math.round(Wd * dpr); canvas.height = Math.round(Ht * dpr);
        canvas.style.aspectRatio = Wd + ' / ' + Ht;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (!rt || !rt.isActive()) paintIdle();
      }
      function paintIdle() { g.save(); g.globalAlpha = 1; g.fillStyle = st.creation.canvas.bg; g.fillRect(0, 0, st.creation.canvas.w, st.creation.canvas.h); g.restore(); }
      function startRun() {
        applyCanvasSize();
        rt = new Cr.Runtime(st.creation, g, { font: PZ.model.FONT_STACK });
        rt.start();
        lastT = 0; prevState = rt.state;
        syncRun(); showRuntimeError();
      }
      function runOrPause() {
        if (rt && rt.state === 'running') { rt.pause(); syncRun(); return; }
        if (rt && rt.state === 'paused') { rt.resume(); lastT = 0; syncRun(); return; }
        startRun();
      }
      function resetRun() { if (rt) rt.reset(); else paintIdle(); showRuntimeError(); syncRun(); renderLive(true); }
      function syncRun() {
        var s = rt ? rt.state : 'idle';
        var label = s === 'running' ? '一時停止' : s === 'paused' ? '再開' : (s === 'idle' ? '実行' : '最初から実行');
        runBtn.replaceChildren(UI.icon(s === 'running' ? 'pause' : 'play'), h('span', { class: 'btn-label' }, label));
        stopBtn.disabled = !(rt && rt.isActive());
        resetBtn.disabled = !rt;
        stateInfo.textContent = RUN_LABEL[s] + (s === 'finished' ? '（▶で最初から）' : '');
        stageEl.setAttribute('data-state', s);
        canvas.style.touchAction = s === 'running' ? 'none' : 'auto';
        canvas.style.cursor = s === 'running' ? 'crosshair' : 'default';
      }
      function showRuntimeError() {
        var e = rt && rt.state === 'error' ? rt.error : null;
        errBox.hidden = !e; U.clear(errBox);
        ws.setRuntimeError(e && e.blockId);
        if (!e) return;
        errBox.appendChild(h('div', { class: 'cr-err-head' }, UI.icon('alert'), e.kind === 'limit' ? '処理が多すぎて止めました' : e.kind === 'invalid' ? '実行できません（チェックの問題）' : '実行中にエラー'));
        errBox.appendChild(h('p', null, e.message));
        if (e.blockId) errBox.appendChild(UI.button('そのブロックを見る', { small: true, kind: 'ghost', icon: 'eye', onclick: function () { ws.focusBlock(e.blockId); } }));
      }
      function renderLive(force) {
        var items = rt ? rt.watch() : [];
        var key = items.map(function (x) { return x.name; }).join('|');
        if (force || key !== watchKey) {
          watchKey = key; U.clear(liveHost);
          if (!items.length) liveHost.appendChild(h('p', { class: 'work-hint' }, '実行すると、ここに値が出ます。'));
          items.forEach(function (it) { liveHost.appendChild(h('div', { class: 'cl-row', 'data-n': it.name }, h('span', null, it.name), h('b', null, ''))); });
        }
        Array.prototype.forEach.call(liveHost.querySelectorAll('.cl-row'), function (row, i) { if (items[i]) row.lastChild.textContent = Cr.formatValue(items[i].value); });
      }
      function frame(t) {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        if (document.hidden) { lastT = 0; return; }
        if (rt && rt.state === 'running') {
          if (lastT) { var dt = t - lastT; if (dt < 14) return; rt.tick(dt); }
          lastT = t;
          if (rt.state !== prevState) { prevState = rt.state; syncRun(); showRuntimeError(); }
        } else lastT = 0;
        if (t - lastWatch > 250) { lastWatch = t; if (rt) renderLive(false); }
      }
      var restartSoon = U.debounce(function () {
        if (!alive || !autoRun || !rt) return;
        if (['running', 'paused', 'error', 'finished'].indexOf(rt.state) < 0) return;
        if (!st.check || !st.check.ok) return;
        var wasPaused = rt.state === 'paused';
        startRun();
        if (wasPaused && rt.state === 'running') { rt.pause(); syncRun(); }
      }, 450);
      function autostart() {
        if (!st.check || !st.check.ok || !st.creation.scripts.length) { rt = null; syncRun(); return; }
        startRun();
        if (reduced && rt && rt.state === 'running') {
          for (var i = 0; i < 40 && rt.state === 'running'; i++) rt.tick(16.7);
          if (rt.state === 'running') rt.pause();
          syncRun();
          UI.toast('「動きを減らす」設定のため、一時停止した状態で開きました。▶で再生できます。', { type: 'info', duration: 5000 });
        }
      }
      function pointerPos(e) { var r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * st.creation.canvas.w / r.width, (e.clientY - r.top) * st.creation.canvas.h / r.height]; }
      canvas.addEventListener('pointermove', function (e) { if (rt) { var p = pointerPos(e); rt.pointer('move', p[0], p[1]); } });
      canvas.addEventListener('pointerdown', function (e) {
        if (!rt) return;
        var p = pointerPos(e);
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
        rt.pointer('down', p[0], p[1]);
        stageEl.focus({ preventScroll: true });
      });
      canvas.addEventListener('pointerup', function (e) { if (rt) { var p = pointerPos(e); rt.pointer('up', p[0], p[1]); } });
      canvas.addEventListener('pointercancel', function () { if (rt) rt.pointer('leave'); });
      canvas.addEventListener('pointerleave', function () { if (rt && !rt.mouse.down) rt.pointer('leave'); });
      stageEl.addEventListener('keydown', function (e) { if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); runOrPause(); } });

      /* ================= 作品の読み込み（開く） ================= */
      function setUrl(q) { try { history.replaceState(null, '', location.href.split('#')[0] + '#/remix' + (q ? '?' + q : '')); } catch (e) { /* noop */ } }
      function go(kind, id) {
        confirmDiscard().then(function (ok) {
          if (!ok) return;
          clearDraft().then(function () { PZ.router.go('/remix?' + kind + '=' + encodeURIComponent(id)); });
        });
      }
      function showWorkspace() {
        bar.hidden = false; workspace.hidden = false; startHost.hidden = true; U.clear(startHost);
        if (!tab || !panels[tab]) tab = 'diff';
      }
      function setCreation(c) {
        commitSoon.cancel();
        st.creation = c; past = []; future = []; lastSnap = JSON.stringify(c); diffCache = null;
        rt = null; watchKey = '';
        applyCanvasSize();
        ws.render(); validateNow(); renderVars(); renderTune(); renderAbout(); syncRun(); showRuntimeError(); renderLive(true);
      }
      function afterLoad() {
        st.baseJson = snapJson();
        showWorkspace(); updateStatus(); updateDiffMark(); setTab(tab, false);
        autostart();
      }

      /** 派生して開く。base: 保存済みの作品、または { sample, name } */
      function openDerive(base, opts) {
        return W.prepareDerive(base, {}).then(function (spec) {
          if (!alive || !ctx.isCurrent()) return;
          st.mode = 'derive'; st.spec = spec; st.workId = null; st.loadedAt = 0; st.tags = []; st.parts = spec.remix.parts.slice(); st.remixInfo = null;
          st.originName = spec.baseName; st.defaultName = spec.name; nameInput.value = spec.name;
          st.baseline = J(spec.creation); st.baselineLabel = '派生元「' + spec.baseName + '」' + (spec.baseVer !== null && spec.baseVer !== undefined ? ' v' + spec.baseVer : '');
          st.draftKey = base && base.sample ? 's:' + base.sample : 'd:' + base.id;
          setCreation(J(spec.creation));
          setUrl(base && base.sample ? 'sample=' + encodeURIComponent(base.sample) : 'from=' + encodeURIComponent(base.id));
          afterLoad();
          offerDraft(null);
          if (!opts || !opts.quiet) UI.toast('「' + spec.baseName + '」から派生して開きました。元の作品は変わりません。', { type: 'info', duration: 4200 });
        });
      }
      /** そのまま編集 */
      function openEdit(p) {
        st.mode = 'edit'; st.spec = null; st.workId = p.id; st.loadedAt = p.updatedAt; st.tags = p.tags; st.parts = p.remix ? p.remix.parts.slice() : []; st.remixInfo = p.remix || null;
        st.originName = ''; st.defaultName = p.name; nameInput.value = p.name;
        st.baseline = J(p.creation); st.baselineLabel = '開いたときの状態（' + U.fmtDate(p.updatedAt).slice(5) + ' 保存）'; st.draftKey = 'w:' + p.id;
        setCreation(J(p.creation));
        setUrl('work=' + encodeURIComponent(p.id));
        afterLoad();
        offerDraft(p);
      }
      function startBlank() {
        st.mode = 'new'; st.spec = null; st.workId = null; st.loadedAt = 0; st.tags = []; st.parts = []; st.remixInfo = null; st.originName = '';
        st.defaultName = ''; nameInput.value = '';
        st.baseline = null; st.baselineLabel = ''; st.draftKey = 'blank';
        setCreation(Cr.blank());
        setUrl('new=1');
        afterLoad();
        offerDraft(null);
      }
      function startImported(project) {
        st.mode = 'new'; st.spec = null; st.workId = null; st.loadedAt = 0; st.tags = project.tags || []; st.parts = []; st.remixInfo = null; st.originName = '';
        st.defaultName = project.name; nameInput.value = project.name;
        st.baseline = null; st.baselineLabel = ''; st.draftKey = 'blank';
        setCreation(J(project.creation));
        setUrl('new=1');
        afterLoad();
      }

      function openPicker() {
        confirmDiscard().then(function (ok) {
          if (!ok) return;
          X.openDialog().then(function (c) {
            if (!c || !alive) return;
            clearDraft().then(function () {
              if (c.type === 'derive') go2('from', c.project.id);
              else if (c.type === 'edit') go2('work', c.project.id);
              else if (c.type === 'sample') go2('sample', c.sampleId);
            });
          });
        });
      }
      function go2(kind, id) { PZ.router.go('/remix?' + kind + '=' + encodeURIComponent(id)); }

      function confirmDiscard() {
        if (!isDirty()) return Promise.resolve(true);
        return UI.confirm('保存していない変更があります。破棄して続けますか？', { title: '変更を破棄', okText: '破棄して続ける', danger: true, detail: '変更は下書きとして控えられていますが、保存した作品ではありません。' });
      }

      /* ================= 下書き（自動保存。作品・履歴には触れない） ================= */
      function draftData() { return { name: nameInput.value, creation: st.creation, workId: st.workId, baseId: st.spec ? st.spec.parentId : null, mode: st.mode, at: Date.now() }; }
      function writeDraft() {
        if (!st.draftKey) return Promise.resolve();
        if (!isDirty()) return R.store.drafts.clear(st.draftKey).catch(noop);
        return R.store.drafts.save(st.draftKey, draftData()).catch(noop);
      }
      var saveDraft = U.debounce(function () { if (alive) writeDraft(); }, 1500);
      function clearDraft() { saveDraft.cancel(); return st.draftKey ? R.store.drafts.clear(st.draftKey).catch(noop) : Promise.resolve(); }
      function offerDraft(work) {
        if (!st.draftKey) return;
        var key = st.draftKey;
        R.store.drafts.load(key).then(function (d) {
          if (!alive || !ctx.isCurrent() || key !== st.draftKey || !d || typeof d !== 'object' || !d.creation || typeof d.creation !== 'object') return;
          if (work && !(d.at > work.updatedAt)) return;
          if (isDirty()) return;
          var banner = h('div', { class: 'notice', role: 'status' }, UI.icon('alert'),
            h('div', { class: 'grow' }, '保存されていない編集が残っています（自動保存 ' + U.fmtDate(d.at) + '）。' + (d.name ? '「' + String(d.name).slice(0, 40) + '」' : '')),
            UI.button('復元する', { small: true, kind: 'purple', onclick: function () { restoreDraft(d); U.clear(bannerHost); } }),
            UI.button('破棄', { small: true, kind: 'ghost', onclick: function () { clearDraft(); U.clear(bannerHost); } }));
          U.clear(bannerHost); bannerHost.appendChild(banner);
        }).catch(noop);
      }
      function restoreDraft(d) {
        var c = Cr.sanitize(d.creation);
        st.creation = c; commitSoon.cancel(); past = []; future = []; lastSnap = JSON.stringify(c); diffCache = null;
        nameInput.value = typeof d.name === 'string' ? d.name.slice(0, PZ.config.limits.projectNameLength) : '';
        ws.render(); validateNow(); renderVars(); renderTune(); renderAbout(); applyCanvasSize(); updateStatus(); updateDiffMark(); if (tab === 'diff') paintDiff();
        UI.toast('下書きを復元しました。「保存」を押すまでは、保存済みの作品は変わりません。', { type: 'ok', duration: 4500 });
        autostart();
      }

      /* ================= 部品・組み合わせの適用 ================= */
      function applyParts(creation, info) {
        commitSoon.cancel(); commit();
        st.creation = creation;
        if (info && info.part && !st.parts.some(function (p) { return p.id === info.part.id && p.version === info.part.version; })) {
          st.parts = st.parts.filter(function (p) { return p.id !== info.part.id; }).concat([info.part]).slice(-R.LIMITS.parts);
        }
        commit(); diffCache = null;
        ws.render(); validateNow(); renderVars(); renderTune(); renderAbout(); applyCanvasSize(); updateStatus(); saveDraft(); restartSoon(); diffSoon();
        if (info && info.inserted && info.inserted[0]) { try { ws.focusBlock(info.inserted[0]); } catch (e) { /* noop */ } }
        UI.toast((info && info.label ? info.label : '追加') + 'しました。「変更」で差分を確認できます。元に戻すのは Ctrl+Z。', { type: 'ok', duration: 4500 });
        setTab('diff', false);
        if (!rt || rt.state === 'idle') autostart();
      }

      /* ================= 保存 ================= */
      function failMsg(e) {
        if (e && e.name === 'QuotaExceededError') return '保存容量が足りません。不要な作品を削除するか、バックアップ後に整理してください。';
        return (e && e.message) || '原因不明のエラー';
      }
      function currentName() { return (nameInput.value.trim() || st.defaultName || '無題の自作ツール').slice(0, PZ.config.limits.projectNameLength); }
      function makeThumb() {
        try {
          var src = canvas;
          if (!(rt && rt.state !== 'idle')) { src = document.createElement('canvas'); Cr.renderToCanvas(st.creation, src, { frames: 45 }); }
          return Cr.thumbFromCanvas(src);
        } catch (e) { return null; }
      }
      function askStale() {
        return new Promise(function (resolve) {
          var m;
          var content = h('div', { class: 'modal-inner' },
            h('h2', { class: 'modal-title' }, '別の場所で更新されています'),
            h('p', { class: 'modal-text' }, 'この作品は、開いたあとに別のタブなどで保存されています。そのまま上書きすると、そちらの変更は失われます（履歴には残ります）。'),
            h('div', { class: 'modal-actions' },
              UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close('cancel'); } }),
              UI.button('別の派生として保存', { kind: 'primary', onclick: function () { m.close('derive'); } }),
              UI.button('上書きする', { kind: 'danger', onclick: function () { m.close('overwrite'); } })));
          m = UI.openModal({ content: content, label: '別の場所で更新されています', initialFocus: content.querySelector('.btn-primary') });
          m.closed.then(function (v) { resolve(v || 'cancel'); });
        });
      }

      /** mode: 'main'（今の状態に応じた保存）| 'derive'（編集中の作品から、別の派生として保存） */
      function save(mode) {
        if (st.busy || st.mode === 'start') return Promise.resolve();
        commitSoon.cancel(); commit();
        if (st.check && st.check.errors.length) {
          UI.toast('ブロックのチェックにエラーがあります。保存はできますが、そのままでは実行できません。', { type: 'warn', duration: 4500 });
        }
        var clean = Cr.validate(st.creation, { lenient: true }).clean;
        var name = currentName();
        var kind = st.mode === 'edit' && mode === 'main' ? 'edit' : st.mode === 'edit' ? 'derive-from-edit' : st.mode;
        var baseline = st.baseline;
        var info;
        if (kind === 'derive') info = { title: '派生として保存', target: '「' + st.originName + '」から派生した、新しい作品として保存します。元の作品は変わりません。', okText: '派生として保存' };
        else if (kind === 'edit') info = { title: '上書き保存の確認', target: '「' + st.defaultName + '」を上書き保存します。保存前の状態は変更履歴に残り、あとから別の作品として復元できます。', okText: '上書き保存', warn: true };
        else if (kind === 'derive-from-edit') info = { title: '別の派生として保存', target: '「' + st.defaultName + '」から派生した新しい作品として保存します。今の作品は変わりません。', okText: '派生として保存' };
        else info = { title: '新しい作品として保存', target: '新しい作品として保存します。', okText: '保存する' };
        var d = baseline ? R.diff(baseline, clean) : R.diff(Cr.blank(), clean);
        var dlgName = kind === 'derive-from-edit' ? R.uniqueName(st.defaultName, []) : name;
        return X.saveDialog({ title: info.title, target: info.target, name: dlgName, baselineLabel: baseline ? st.baselineLabel : '空の状態から', diff: d, okText: info.okText, warnOverwrite: !!info.warn }).then(function (choice) {
          if (!choice) return;
          st.busy = true; updateStatus();
          var thumb = makeThumb();
          var job;
          var opts = { name: choice.name, note: choice.note, thumb: thumb, parts: st.parts, tags: st.tags };
          if (kind === 'derive') job = W.createDerived(st.spec, clean, opts);
          else if (kind === 'new') job = W.createNew(clean, opts);
          else if (kind === 'derive-from-edit') job = deriveFromStored(clean, opts);
          else {
            opts.expectUpdatedAt = st.loadedAt;
            job = W.saveExisting(st.workId, clean, opts).catch(function (e) {
              if (!e || e.code !== 'STALE') throw e;
              st.busy = false;
              return askStale().then(function (c) {
                st.busy = true;
                if (c === 'cancel') return null;
                if (c === 'derive') return deriveFromStored(clean, opts);
                opts.force = true; return W.saveExisting(st.workId, clean, opts);
              });
            });
          }
          return job.then(function (saved) {
            st.busy = false;
            if (!saved) { updateStatus(); return; }
            var derived = kind === 'derive' || kind === 'derive-from-edit';
            st.mode = 'edit'; st.spec = null; st.workId = saved.id; st.loadedAt = saved.updatedAt; st.defaultName = saved.name; st.tags = saved.tags; st.originName = '';
            st.remixInfo = saved.remix || null; st.parts = saved.remix ? saved.remix.parts.slice() : st.parts;
            nameInput.value = saved.name;
            st.baseline = J(clean); st.baselineLabel = '保存した版（' + U.fmtDate(saved.updatedAt).slice(11) + '）';
            st.baseJson = snapJson(); diffCache = null;
            // 下書きは、保存したので不要。保存先が変わった（派生）ときは新しいキーで続ける
            var oldKey = st.draftKey; st.draftKey = 'w:' + saved.id;
            saveDraft.cancel(); R.store.drafts.clear(oldKey).catch(noop); R.store.drafts.clear(st.draftKey).catch(noop);
            setUrl('work=' + encodeURIComponent(saved.id));
            updateStatus(); updateDiffMark(); paintTab(tab); partsUI.refresh();
            U.clear(bannerHost);
            var msg = derived ? '新しい作品「' + saved.name + '」として保存しました。元の作品は変わっていません。' : '「' + saved.name + '」を保存しました。';
            if (saved._historyFailed) msg += '（履歴の記録に失敗しました）';
            else if (saved._skipped) msg += '（内容が前の版と同じため、履歴は増やしていません）';
            UI.toast(msg, { type: saved._historyFailed ? 'warn' : 'ok', duration: 4500 });
          }, function (e) {
            st.busy = false; updateStatus();
            UI.toast('保存できませんでした: ' + failMsg(e), { type: 'error', duration: 7000 });
          });
        });
      }
      /** 保存済みの作品から、今の編集内容で別の派生を作る */
      function deriveFromStored(clean, opts) {
        return P.get(st.workId).then(function (cur) {
          if (!cur) return W.createNew(clean, opts);
          return W.prepareDerive(cur, {}).then(function (spec) {
            var o = Object.assign({}, opts); o.name = opts.name === cur.name ? spec.name : opts.name;
            return W.createDerived(spec, clean, o);
          });
        });
      }

      /* ================= 書き出し・読み込み ================= */
      function exportPackage() {
        if (st.mode === 'start') return;
        var proceed = function (work) {
          R.io.buildPackage(work, {}).then(function (pkg) {
            U.download(new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' }), U.safeFileName(work.name, '') + '.pzremix.json');
            UI.toast('「' + work.name + '」を書き出しました（履歴 ' + pkg.history.versions.length + ' 件・部品 ' + pkg.components.length + ' 個を含む）。', { type: 'ok', duration: 4500 });
          }, function (e) { UI.toast('書き出せませんでした: ' + ((e && e.message) || ''), { type: 'error' }); });
        };
        var v = Cr.validate(st.creation);
        if (!v.ok) { UI.toast('ブロックのチェックに問題があるため、書き出せません。「チェック」を確認してください。', { type: 'warn', duration: 5000 }); return; }
        if (st.workId && !isDirty()) {
          P.get(st.workId).then(function (w) { if (w) proceed(w); else UI.toast('作品が見つかりません', { type: 'warn' }); });
        } else {
          var now = Date.now();
          var tmp = { id: st.workId || 'tmp', name: currentName(), tags: st.tags, createdAt: now, updatedAt: now, creation: v.clean, remix: R.cleanRemix({ origin: st.spec ? st.spec.remix.origin : (st.remixInfo && st.remixInfo.origin), lineage: st.spec ? st.spec.remix.lineage : (st.remixInfo ? st.remixInfo.lineage : []), summary: '', parts: st.parts }) };
          proceed(tmp);
        }
      }
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!f) return;
        PZ.remixParts.importFile(f, { workToast: true }).then(function (r) {
          if (!r || !alive) return;
          partsUI.refresh();
          if (r.work) {
            UI.toast('「' + r.work.name + '」を取り込みました。', { type: 'ok', duration: 7000, action: { label: '開く', onClick: function () { go('work', r.work.id); } } });
            if (tab === 'tree') paintTree();
          }
        });
      });

      /* ================= 開始画面 ================= */
      function paintStart(drafts) {
        U.clear(startHost); startHost.hidden = false;
        var cards = h('div', { class: 'rx-start-grid' },
          startCard('folder', '作品を開いて改造する', '自分の作品やサンプルを選びます。「派生して開く」なら、元の作品は変わりません。', UI.button('作品を選ぶ', { kind: 'primary', icon: 'folder', onclick: function () { openPicker(); } })),
          startCard('plus', '白紙から作る', 'ブロックを置くところから始めます。部品を組み合わせて作ることもできます。', UI.button('新しく始める', { kind: 'ghost', icon: 'plus', onclick: function () { startBlank(); } })),
          startCard('upload', 'ファイルから取り込む', '.pzremix.json（作品・履歴・部品）か、Create の .pzcreate.json を、内容を確認してから取り込みます。', UI.button('ファイルを選ぶ', { kind: 'ghost', icon: 'upload', onclick: function () { fileInput.click(); } })));
        startHost.appendChild(h('section', { class: 'card rx-start' }, h('div', { class: 'panel-title' }, 'はじめる', h('small', null, 'START')), cards));
        if (drafts && drafts.length) {
          var list = h('ul', { class: 'rx-drafts' });
          drafts.forEach(function (d) {
            list.appendChild(h('li', null, h('div', { class: 'rx-pick-main' }, h('b', null, d.name || '（名前なし）'), h('small', null, '自動保存 ' + U.fmtDate(d.at))),
              h('div', { class: 'rx-node-acts' }, UI.button('続きから', { small: true, kind: 'primary', onclick: function () { resumeDraft(d); } }), UI.button('捨てる', { small: true, kind: 'ghost', onclick: function () { R.store.drafts.clear(d.key).then(function () { R.store.drafts.list().then(paintStart); }); } }))));
          });
          startHost.appendChild(h('section', { class: 'card rx-start' }, h('div', { class: 'panel-title' }, '保存していない編集', h('small', null, '自動保存された下書き')), list));
        }
      }
      function startCard(icon, title, text, action) {
        return h('div', { class: 'rx-startcard' }, h('div', { class: 'rx-start-icon', 'aria-hidden': 'true' }, UI.icon(icon)), h('h3', null, title), h('p', null, text), action);
      }
      function resumeDraft(d) {
        var key = d.key;
        var m = /^([wds]):(.+)$/.exec(key);
        if (!m && key !== 'blank') return;
        if (key === 'blank') { startBlank(); return; }
        go2(m[1] === 'w' ? 'work' : m[1] === 'd' ? 'from' : 'sample', m[2]);
      }

      /* ================= キー操作・離脱 ================= */
      function inField(e) { var t = e.target; return t && t.matches && t.matches('input,textarea,select'); }
      function onKey(e) {
        if (st.mode === 'start') return;
        var mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save('main'); }
        else if (mod && !inField(e) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (mod && !inField(e) && (e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) { e.preventDefault(); redo(); }
      }
      function onBeforeUnload(e) { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } }
      document.addEventListener('keydown', onKey);
      window.addEventListener('beforeunload', onBeforeUnload);
      nameInput.addEventListener('input', function () { updateStatus(); saveDraft(); });

      /* ================= 開始 ================= */
      var q = ctx.query || {};
      setTab('diff', false);
      validateNow(); renderVars(); renderTune(); renderAbout(); applyCanvasSize(); syncRun(); renderLive(true);
      raf = requestAnimationFrame(frame);

      function fail(msg) { UI.toast(msg, { type: 'warn', duration: 5500 }); R.store.drafts.list().then(paintStart, function () { paintStart([]); }); }
      if (q.from || q.work) {
        P.open(q.from || q.work).then(function (p) {
          if (!alive || !ctx.isCurrent()) return;
          if (!p || p.kind !== 'creation') { fail(p ? 'この作品は自作ツールではないため、Remix では開けません。' : '作品が見つかりません。'); return; }
          if (q.from) return openDerive(p); else openEdit(p);
        }).catch(function (e) { fail('作品を開けませんでした: ' + failMsg(e)); });
      } else if (q.sample) {
        if (!Cr.sampleProgram(q.sample)) fail('サンプルが見つかりません。');
        else openDerive({ sample: q.sample, name: (Cr.sampleInfo(q.sample) || {}).name }).catch(function (e) { fail('開けませんでした: ' + failMsg(e)); });
      } else if (q.new) {
        startBlank();
      } else {
        R.store.drafts.list().then(function (l) { if (alive && ctx.isCurrent()) paintStart(l); }, function () { paintStart([]); });
      }

      return function destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('beforeunload', onBeforeUnload);
        restartSoon.cancel(); commitSoon.cancel(); saveDraft.cancel(); diffSoon.cancel();
        if (rt) rt.stop();
        ws.destroy(); partsUI.destroy();
        return isDirty() ? writeDraft() : undefined;
      };
    }
  };
})();
