/*
 * Create（Creation Engine）— ブロックを組み合わせて、自分だけのインタラクティブな実験を作るページ
 *
 *  ・左: ブロックのパレット / 中央: ブロックを並べる場所 / 右: リアルタイムプレビュー・つまみ・へんすう・チェック
 *  ・実行は PZ.creation.Runtime（安全なインタープリター）。実行前に必ず検証する
 *  ・保存は既存の作品サービス層（PZ.projects）。kind:'creation' の作品として My Space に並ぶ
 *    新規保存 / 上書き保存 / 複製して保存 を区別し、サンプルや元の作品を勝手に書き換えない
 *  ・未保存の編集は下書きとして別に控える（作品本体は「保存」を押すまで変わらない）
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

  var RUN_LABEL = { idle: 'IDLE', running: 'RUNNING', paused: 'PAUSED', stopped: 'STOPPED', finished: 'FINISHED', error: 'ERROR' };
  function J(x) { return JSON.parse(JSON.stringify(x)); }
  function noop() { /* 失敗しても動作は続ける */ }

  function nextVersionName(name) {
    var m = /^(.*?)\s+v(\d+)$/.exec(name);
    var base = m ? m[1] : name, n = m ? parseInt(m[2], 10) + 1 : 2;
    return (base + ' v' + n).slice(0, PZ.config.limits.projectNameLength);
  }

  PZ.pages.create = {
    title: 'Create',
    nav: 'create',
    mount: function (root, ctx) {
      var alive = true;
      var st = { creation: Cr.blank(), workId: null, loadedAt: 0, loadedName: '', defaultName: '', tags: [], baseJson: '', busy: false, check: null };
      var past = [], future = [], lastSnap = '';
      var rt = null, hasRun = false, raf = 0, lastT = 0, lastWatch = 0, prevState = 'idle', watchKey = '';
      var autoRun = true;
      var reduced = U.prefersReducedMotion();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);

      /* ================= 部品 ================= */
      var nameInput = h('input', { class: 'input cr-name', type: 'text', maxlength: PZ.config.limits.projectNameLength, placeholder: '自作ツールの名前', 'aria-label': '自作ツールの名前', autocomplete: 'off' });
      var statusEl = h('span', { class: 'cr-status', role: 'status', 'aria-live': 'polite' });
      var undoBtn = UI.iconButton('undo', '元に戻す (Ctrl+Z)', function () { undo(); });
      var redoBtn = UI.iconButton('redo', 'やり直す (Ctrl+Y)', function () { redo(); });
      var saveBtn = UI.button('保存', { icon: 'save', kind: 'primary', title: '保存 (Ctrl+S)', onclick: function () { save('save'); } });
      var copyBtn = UI.button('複製して保存', { icon: 'branch', kind: 'ghost', title: '元の作品はそのまま、別の作品として保存します', onclick: function () { save('copy'); } });
      var fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-hidden': 'true' });

      var bar = h('div', { class: 'card cr-bar' },
        h('div', { class: 'cr-bar-row' }, nameInput, statusEl),
        h('div', { class: 'cr-bar-row cr-tools' },
          UI.button('新規', { icon: 'plus', kind: 'ghost', small: true, onclick: function () { confirmDiscard().then(function (ok) { if (ok) { clearDraft(); loadBlank(); } }); } }),
          UI.button('サンプル', { icon: 'sample', kind: 'ghost', small: true, onclick: function () { openSamples(); } }),
          undoBtn, redoBtn,
          h('span', { class: 'grow' }),
          UI.button('読み込み', { icon: 'upload', kind: 'ghost', small: true, title: '自作ツールのファイル(JSON)を読み込む。内容を確認してから取り込みます', onclick: function () { fileInput.click(); } }),
          UI.button('書き出し', { icon: 'download', kind: 'ghost', small: true, title: '自作ツールをJSONファイルとして書き出す（他の人に渡せます）', onclick: function () { exportTool(); } }),
          UI.button('Remixで改造', { icon: 'branch', kind: 'ghost', small: true, title: '保存済みの作品を、元を残したまま派生させて改造します', onclick: function () { if (st.workId) { confirmDiscard().then(function (ok) { if (ok) PZ.router.go('/remix?from=' + encodeURIComponent(st.workId)); }); } else PZ.router.go('/remix'); } }),
          copyBtn, saveBtn));

      var bannerHost = h('div');

      /* ---- ワークスペース ---- */
      var cursorEl = h('div', { class: 'cr-cursor', 'aria-live': 'polite' });
      var selHelp = h('div', { class: 'cr-selhelp' });
      var countEl = h('small', null, '');
      var ws = PZ.creationWs.create({
        get: function () { return st.creation; },
        onChange: onChange,
        onCursor: function (t) { cursorEl.textContent = ''; cursorEl.appendChild(h('span', null, '追加先: '));  cursorEl.appendChild(h('b', null, t)); },
        onSelect: function (spec) { selHelp.textContent = spec ? spec.name + '：' + spec.hint : ''; },
        onSamples: function () { openSamples(); }
      });

      var palCard = h('aside', { class: 'card cr-pal', 'aria-label': 'ブロックのパレット' },
        Kit.title('Blocks', 'ブロックを押して追加'), cursorEl, ws.paletteEl);
      var workCard = h('section', { class: 'card cr-work', 'aria-label': 'ブロックを並べる場所' },
        h('div', { class: 'panel-title' }, 'Script', countEl),
        selHelp, ws.el);

      /* ---- プレビュー ---- */
      var canvas = h('canvas', { class: 'cr-canvas', role: 'img', 'aria-label': '自作ツールのプレビュー。クリックやタップ、マウスの動きに反応します。' });
      var g = canvas.getContext('2d');
      var stateInfo = h('b', null, 'IDLE');
      var stageEl = h('div', { class: 'lab-stage cr-stage', tabindex: '0' }, canvas,
        h('div', { class: 'lab-stage-bar' }, h('span', null, 'PREVIEW'), h('span', { 'aria-live': 'off' }, stateInfo)));
      var runBtn = UI.button('実行', { icon: 'play', kind: 'primary', onclick: function () { runOrPause(); } });
      var stopBtn = UI.button('停止', { icon: 'stop', kind: 'ghost', title: '止める（絵はそのまま残ります）', onclick: function () { if (rt) { rt.stop(); syncRun(); } } });
      var resetBtn = UI.button('リセット', { icon: 'reset', kind: 'ghost', title: '画面とへんすうを最初の状態に戻す', onclick: function () { resetRun(); } });
      var autoChk = Kit.check('ブロックを変えたら、すぐ反映', { get: function () { return autoRun; }, set: function (v) { autoRun = v; } });
      autoChk.sync();
      var errBox = h('div', { class: 'cr-err', role: 'alert', hidden: true });
      var stageCard = h('div', { class: 'card lab-panel cr-stagecard' },
        Kit.title('Preview', 'リアルタイム'), stageEl,
        h('div', { class: 'cr-controls' }, runBtn, stopBtn, resetBtn), errBox, autoChk.el);

      var tuneHost = h('div', { class: 'cr-tune' });
      var tuneCard = h('div', { class: 'card lab-panel', hidden: true }, Kit.title('Knobs', 'つまみ（ルールを変える）'), tuneHost);
      var liveHost = h('div', { class: 'cr-live' });
      var varsHost = h('div', { class: 'cr-vars' });
      var varsCard = h('details', { class: 'card cr-fold' },
        h('summary', null, UI.icon('variable'), h('span', null, 'へんすう'), h('small', null, '初期値・つまみ')),
        h('div', { class: 'cr-fold-body' },
          h('p', { class: 'work-hint' }, 'へんすうは、数や文字をしまっておく箱です。「初期値」は実行・リセットのたびに戻る値。「つまみ」にすると、右のプレビュー横にスライダーが出ます。'),
          varsHost, h('div', { class: 'panel-title', style: { marginTop: '10px' } }, 'Live', h('small', null, '実行中の値')), liveHost));
      var aboutHost = h('div', { class: 'cr-about' });
      var aboutCard = h('details', { class: 'card cr-fold' },
        h('summary', null, UI.icon('note'), h('span', null, 'このツールについて'), h('small', null, '説明・背景色')),
        h('div', { class: 'cr-fold-body' }, aboutHost));
      var checkHost = h('div', { class: 'cr-check' });
      var checkCard = h('div', { class: 'card lab-panel' }, Kit.title('Check', 'ブロックのチェック'), checkHost);
      var howto = h('details', { class: 'card howto' },
        h('summary', null, UI.icon('eye'), h('span', null, '使い方（3ステップ）'), h('small', null, 'CREATE')),
        h('ol', null,
          h('li', null, 'まず「イベント」から「はじまったとき」か「ずっと」を押して置きます。'),
          h('li', null, '「描く」「色・位置」のブロックを押して足していきます。置かれた場所は「追加先」に出ます。ブロックの順番に上から実行されます。'),
          h('li', null, '数字や色の横の「◇」を押すと、乱数・計算・マウスの位置などを差し込めます。「実行」でプレビューに出ます。')),
        h('p', { class: 'work-hint', style: { margin: '10px 0 0' } }, 'ドラッグでも置けます（スマホはボタンで追加、↑↓で順番を変更）。キーボードでは Tab でブロックへ移動し、Alt+↑↓ で並べ替え、Delete で削除。'));
      var stageCol = stageCard;
      var aux = h('div', { class: 'cr-aux' }, tuneCard, varsCard, aboutCard, checkCard, howto);

      root.appendChild(h('div', { class: 'container cr-page' },
        h('header', { class: 'page-head' },
          h('div', { class: 'crumbs' }, 'Create', h('span', null, '/'), h('span', { style: { color: 'var(--lime)' } }, 'Creation Engine')),
          h('h1', { class: 'page-title' }, 'ブロックで作る ', h('em', null, 'CREATE')),
          h('p', { class: 'page-lead' }, 'コードは書かなくて大丈夫。ブロックを組み合わせて、動いて、反応する、自分だけの実験を作ろう。作ったものは保存して、ファイルで人に渡せます。')),
        bar, bannerHost,
        h('div', { class: 'cr-layout' }, palCard, workCard, stageCol, aux),
        fileInput));

      /* ================= 状態・履歴 ================= */
      function snapJson() { return JSON.stringify({ n: nameInput.value, c: st.creation }); }
      function isDirty() { return snapJson() !== st.baseJson; }

      function updateStatus() {
        var dirty = isDirty(), txt, cls = 'cr-status';
        if (st.busy) txt = '保存中…';
        else if (!st.workId) { txt = '未保存の新規' + (dirty ? '（変更あり）' : ''); cls += ' new'; }
        else if (dirty) { txt = '未保存の変更があります'; cls += ' dirty'; }
        else { txt = '保存済み ' + U.fmtDate(st.loadedAt).slice(11); cls += ' saved'; }
        statusEl.textContent = txt; statusEl.className = cls;
        saveBtn.querySelector('.btn-label').textContent = st.workId ? '上書き保存' : '保存';
        copyBtn.disabled = !st.workId;
        copyBtn.title = st.workId ? '元の作品はそのまま、別の作品として保存します' : '先に一度「保存」すると、複製して保存できます';
        undoBtn.disabled = !past.length; redoBtn.disabled = !future.length;
      }

      function commit() {
        var cur = JSON.stringify(st.creation);
        if (cur !== lastSnap) { past.push(lastSnap); if (past.length > 100) past.shift(); future = []; lastSnap = cur; }
      }
      var commitSoon = U.debounce(function () { commit(); updateStatus(); }, 500);

      function afterReplace() {
        ws.render(); validateNow(); renderVars(); renderTune(); renderAbout(); applyCanvasSize(); updateStatus(); saveDraft(); restartSoon();
      }
      function undo() { commitSoon.cancel(); commit(); if (!past.length) return; future.push(lastSnap); lastSnap = past.pop(); st.creation = JSON.parse(lastSnap); afterReplace(); }
      function redo() { commitSoon.cancel(); if (!future.length) return; past.push(lastSnap); lastSnap = future.pop(); st.creation = JSON.parse(lastSnap); afterReplace(); }

      /** ブロックの編集があった（ws から）。kind: 'struct'（置く・外す・動かす）| 'value'（入力欄の値） */
      function onChange(kind) {
        if (kind === 'struct') { commitSoon.cancel(); commit(); renderVars(); renderTune(); } else commitSoon();
        validateNow(); updateStatus(); saveDraft(); restartSoon();
      }

      function validateNow() {
        var v = Cr.validate(st.creation);
        st.check = v;
        var list = v.errors.map(function (e) { return { id: e.id, msg: e.msg }; }).concat(v.warnings.map(function (w) { return { id: w.id, msg: w.msg, warn: true }; }));
        ws.setIssues(list);
        countEl.textContent = v.stats.blocks + ' ブロック · ' + v.stats.scripts + ' スクリプト';
        renderChecks();
      }

      function renderChecks() {
        U.clear(checkHost);
        var v = st.check;
        if (!v.errors.length && !v.warnings.length) {
          checkHost.appendChild(h('p', { class: 'cr-ok' }, UI.icon('check'), 'ブロックに問題はありません。'));
          return;
        }
        function row(it, cls) {
          var inner = [UI.icon(cls === 'err' ? 'alert' : 'eye'), h('span', null, it.msg)];
          if (it.id) return h('button', { type: 'button', class: 'cr-issue ' + cls, onclick: function () { ws.focusBlock(it.id); } }, inner);
          return h('div', { class: 'cr-issue ' + cls }, inner);
        }
        v.errors.slice(0, 8).forEach(function (e) { checkHost.appendChild(row(e, 'err')); });
        if (v.errors.length > 8) checkHost.appendChild(h('p', { class: 'work-hint' }, '…ほか ' + (v.errors.length - 8) + ' 件'));
        v.warnings.slice(0, 6).forEach(function (w) { checkHost.appendChild(row(w, 'warn')); });
        checkHost.appendChild(h('p', { class: 'work-hint' }, v.errors.length ? 'エラーがあると実行できません。メッセージを押すと、そのブロックへ移動します。' : '警告があっても実行できます。'));
      }

      /* ================= へんすう・つまみ・説明 ================= */
      function typeOf(v) { return typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : 'text'; }

      function renderVars() {
        U.clear(varsHost);
        st.creation.vars.forEach(function (v, i) {
          var type = typeOf(v.value);
          var typeSel = h('select', { class: 'select cv-type', 'aria-label': v.name + ' の種類' },
            h('option', { value: 'num' }, '数'), h('option', { value: 'text' }, '文字'), h('option', { value: 'bool' }, 'はい/いいえ'));
          typeSel.value = type;
          typeSel.addEventListener('change', function () {
            v.value = typeSel.value === 'num' ? 0 : typeSel.value === 'bool' ? true : '';
            delete v.tune; onChange('struct');
          });
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
          var row = h('div', { class: 'cv-row' },
            h('div', { class: 'cv-main' }, h('b', { class: 'cv-name' }, v.name), typeSel, valEl,
              UI.iconButton('edit', v.name + ' の名前を変える', function () { renameVar(v); }, 'mini'),
              UI.iconButton('trash', v.name + ' を削除', function () { st.creation.vars.splice(i, 1); onChange('struct'); }, 'mini danger')));
          if (type === 'num') {
            var tuneOn = !!v.tune;
            var chk = h('input', { type: 'checkbox' }); chk.checked = tuneOn;
            var mn = h('input', { class: 'input cv-mm', type: 'text', inputmode: 'decimal', value: tuneOn ? String(v.tune.min) : '0', 'aria-label': v.name + ' つまみの最小' });
            var mx = h('input', { class: 'input cv-mm', type: 'text', inputmode: 'decimal', value: tuneOn ? String(v.tune.max) : '100', 'aria-label': v.name + ' つまみの最大' });
            var stp = h('input', { class: 'input cv-mm', type: 'text', inputmode: 'decimal', value: tuneOn ? String(v.tune.step) : '1', 'aria-label': v.name + ' つまみの刻み' });
            function applyTune() {
              var a = Number(mn.value), b = Number(mx.value), s = Number(stp.value);
              if (!chk.checked) { delete v.tune; onChange('struct'); return; }
              if (!isFinite(a) || !isFinite(b) || a >= b) { UI.toast('つまみの「最小」は「最大」より小さくしてください', { type: 'warn', duration: 2600 }); return; }
              v.tune = { min: a, max: b, step: isFinite(s) && s > 0 ? s : 1 };
              v.value = Math.max(a, Math.min(b, v.value));
              onChange('struct');
            }
            chk.addEventListener('change', applyTune);
            [mn, mx, stp].forEach(function (x) { x.addEventListener('change', function () { if (chk.checked) applyTune(); }); });
            row.appendChild(h('div', { class: 'cv-tune' }, h('label', { class: 'check' }, chk, h('span', { class: 'box' }), 'つまみにする'),
              h('span', { class: 'cv-mmwrap', hidden: !tuneOn }, '最小', mn, '最大', mx, '刻み', stp)));
            row.querySelector('.cv-mmwrap').hidden = !tuneOn;
            chk.addEventListener('change', function () { row.querySelector('.cv-mmwrap').hidden = !chk.checked; });
          }
          varsHost.appendChild(row);
        });
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
        if (any) tuneHost.appendChild(h('p', { class: 'work-hint' }, 'つまみは今すぐ反映されます。リセットや再実行のあとも、この値から始まります。'));
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
        var W = st.creation.canvas.w, H = st.creation.canvas.h;
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        canvas.style.aspectRatio = W + ' / ' + H;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (!rt || !rt.isActive()) paintIdle();
      }
      function paintIdle() { g.save(); g.globalAlpha = 1; g.fillStyle = st.creation.canvas.bg; g.fillRect(0, 0, st.creation.canvas.w, st.creation.canvas.h); g.restore(); }

      function startRun() {
        applyCanvasSize();
        rt = new Cr.Runtime(st.creation, g, { font: PZ.model.FONT_STACK });
        hasRun = true;
        rt.start();
        lastT = 0; prevState = rt.state;
        syncRun(); showRuntimeError();
      }
      function runOrPause() {
        if (rt && rt.state === 'running') { rt.pause(); syncRun(); return; }
        if (rt && rt.state === 'paused') { rt.resume(); lastT = 0; syncRun(); return; }
        startRun();
      }
      function resetRun() {
        if (rt) rt.reset(); else paintIdle();
        showRuntimeError(); syncRun(); renderLive(true);
      }

      function syncRun() {
        var s = rt ? rt.state : 'idle';
        var label = s === 'running' ? '一時停止' : s === 'paused' ? '再開' : (s === 'idle' ? '実行' : '最初から実行');
        var icon = s === 'running' ? 'pause' : 'play';
        runBtn.replaceChildren(UI.icon(icon), h('span', { class: 'btn-label' }, label));
        stopBtn.disabled = !(rt && rt.isActive());
        resetBtn.disabled = !rt;
        var txt = RUN_LABEL[s];
        if (s === 'finished') txt += '（▶で最初から）';
        stateInfo.textContent = txt;
        stageEl.setAttribute('data-state', s);
        canvas.style.touchAction = s === 'running' ? 'none' : 'auto';
        canvas.style.cursor = s === 'running' ? 'crosshair' : 'default';
      }

      function showRuntimeError() {
        var e = rt && rt.state === 'error' ? rt.error : null;
        errBox.hidden = !e;
        U.clear(errBox);
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

      /** 読み込み直後: 問題がなければプレビューを動かす（動きを減らす設定なら、少し進めた静止画で止めておく） */
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

      function pointerPos(e) {
        var r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) * st.creation.canvas.w / r.width, (e.clientY - r.top) * st.creation.canvas.h / r.height];
      }
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

      /* ================= 読み込み（新規・サンプル・保存済み・下書き） ================= */
      function setCreation(c) {
        commitSoon.cancel();
        st.creation = c; past = []; future = []; lastSnap = JSON.stringify(c);
        rt = null; hasRun = false; watchKey = '';
        applyCanvasSize();
        ws.render(); validateNow(); renderVars(); renderTune(); renderAbout(); syncRun(); showRuntimeError(); renderLive(true);
      }
      function setUrl(q) {
        try { history.replaceState(null, '', location.href.split('#')[0] + '#/create' + (q ? '?' + q : '')); } catch (e) { /* noop */ }
      }
      function loadNew(creation, name) {
        st.workId = null; st.loadedAt = 0; st.loadedName = ''; st.tags = []; st.defaultName = name || '';
        nameInput.value = name || '';
        setCreation(creation);
        st.baseJson = snapJson();
        updateStatus(); setUrl('');
      }
      function loadBlank() { loadNew(Cr.blank(), ''); }
      function loadSample(id) {
        var prog = Cr.sampleProgram(id), info = Cr.sampleInfo(id);
        if (!prog) { UI.toast('サンプルが見つかりません', { type: 'warn' }); return; }
        loadNew(prog, info.name);
        autostart();
        UI.toast('サンプル「' + info.name + '」を開きました。自由に変えて大丈夫です（保存するまで、どこも変わりません）。', { type: 'info', duration: 5200 });
      }
      function loadProject(p) {
        st.workId = p.id; st.loadedAt = p.updatedAt; st.loadedName = p.name; st.tags = p.tags; st.defaultName = p.name;
        nameInput.value = p.name;
        setCreation(J(p.creation));
        st.baseJson = snapJson();
        updateStatus(); setUrl('work=' + encodeURIComponent(p.id));
      }

      function confirmDiscard() {
        if (!isDirty()) return Promise.resolve(true);
        return UI.confirm('保存していない変更があります。破棄して続けますか？', { title: '変更を破棄', okText: '破棄して続ける', danger: true, detail: '変更はこの画面に下書きとして残りますが、完全には保証されません。' });
      }

      function openSamples() {
        var m;
        var list = h('div', { class: 'cr-samples' });
        Cr.SAMPLES.forEach(function (s) {
          list.appendChild(h('div', { class: 'cr-sample' },
            h('div', { class: 'cr-sample-head' }, h('b', null, s.name), h('span', { class: 'badge' + (s.level > 2 ? ' purple' : '') }, '★'.repeat(s.level))),
            h('p', null, s.summary),
            h('ul', null, s.tryIt.map(function (t) { return h('li', null, t); })),
            UI.button('このサンプルで始める', { kind: 'primary', small: true, icon: 'arrow', onclick: function () {
              confirmDiscard().then(function (ok) { if (!ok) return; m.close(); clearDraft(); loadSample(s.id); });
            } })));
        });
        m = UI.openModal({ className: 'wide-ish', label: 'サンプル作品', content: h('div', { class: 'modal-inner' },
          h('h2', { class: 'modal-title' }, 'サンプルから始める'),
          h('p', { class: 'modal-sub' }, '選ぶと、編集画面に読み込まれます。自由に変えて実行できます。サンプル自体は変わりません。'),
          list,
          h('div', { class: 'modal-actions' }, UI.button('閉じる', { kind: 'ghost', onclick: function () { m.close(); } }))) });
      }

      /* ================= 下書き ================= */
      function writeDraft() {
        if (!isDirty()) return PZ.userdata.set('creationDraft', null).catch(noop);
        return PZ.userdata.set('creationDraft', { workId: st.workId, name: nameInput.value, creation: st.creation, at: Date.now() }).catch(noop);
      }
      var saveDraft = U.debounce(function () { if (alive) writeDraft(); }, 1500);
      function clearDraft() { saveDraft.cancel(); return PZ.userdata.set('creationDraft', null).catch(noop); }

      function offerDraft(forWork) {
        PZ.userdata.get('creationDraft', null).then(function (d) {
          if (!alive || !ctx.isCurrent() || !d || typeof d !== 'object' || !d.creation || typeof d.creation !== 'object') return;
          if ((d.workId || null) !== (forWork ? forWork.id : null) && forWork) return;
          if (forWork && !(d.at > forWork.updatedAt)) return;
          if (!forWork && isDirty()) return;
          var when = U.fmtDate(d.at);
          var banner = h('div', { class: 'notice', role: 'status' }, UI.icon('alert'),
            h('div', { class: 'grow' }, '保存されていない編集が残っています（' + when + '）。' + (d.name ? '「' + String(d.name).slice(0, 40) + '」' : '')),
            UI.button('復元する', { small: true, kind: 'purple', onclick: function () { restoreDraft(d); U.clear(bannerHost); } }),
            UI.button('破棄', { small: true, kind: 'ghost', onclick: function () { clearDraft(); U.clear(bannerHost); } }));
          U.clear(bannerHost); bannerHost.appendChild(banner);
        }).catch(noop);
      }
      function restoreDraft(d) {
        var base = d.workId ? P.get(d.workId) : Promise.resolve(null);
        base.then(function (p) {
          if (!alive) return;
          if (p && p.kind === 'creation') loadProject(p); else loadBlank();
          var c = Cr.sanitize(d.creation);
          st.creation = c; commitSoon.cancel(); past = []; future = []; lastSnap = JSON.stringify(c);
          nameInput.value = typeof d.name === 'string' ? d.name.slice(0, PZ.config.limits.projectNameLength) : '';
          ws.render(); validateNow(); renderVars(); renderTune(); renderAbout(); applyCanvasSize(); updateStatus();
          UI.toast('下書きを復元しました。「保存」を押すまでは、保存済みの作品は変わりません。', { type: 'ok', duration: 4500 });
          autostart();
        }).catch(function (e) { UI.toast('復元できませんでした: ' + ((e && e.message) || ''), { type: 'error' }); });
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
          if (!(hasRun && rt && rt.state !== 'idle')) { src = document.createElement('canvas'); Cr.renderToCanvas(st.creation, src, { frames: 45 }); }
          return Cr.thumbFromCanvas(src);
        } catch (e) { return null; }
      }

      /** 別のタブなどで作品が更新されていたら、上書きの前に選んでもらう */
      function askStale() {
        return new Promise(function (resolve) {
          var m;
          var content = h('div', { class: 'modal-inner' },
            h('h2', { class: 'modal-title' }, '別の場所で更新されています'),
            h('p', { class: 'modal-text' }, 'この作品は、開いたあとに別のタブなどで保存されています。このまま上書きすると、そちらの変更は失われます。'),
            h('div', { class: 'modal-actions' },
              UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close('cancel'); } }),
              UI.button('複製として保存', { kind: 'primary', onclick: function () { m.close('copy'); } }),
              UI.button('上書きする', { kind: 'danger', onclick: function () { m.close('overwrite'); } })));
          m = UI.openModal({ content: content, label: '別の場所で更新されています', initialFocus: content.querySelector('.btn-primary') });
          m.closed.then(function (v) { resolve(v || 'cancel'); });
        });
      }

      function save(mode) {
        if (st.busy) return Promise.resolve();
        commitSoon.cancel(); commit();
        st.busy = true; updateStatus();
        var clean = Cr.validate(st.creation, { lenient: true }).clean;
        var name = currentName();
        var thumb = makeThumb();
        var job;
        if (mode === 'copy' && st.workId) {
          var nm = name === st.loadedName ? nextVersionName(name) : name;
          job = P.derive(st.workId, nm, { creation: clean, thumb: thumb, name: nm });
        } else if (!st.workId) {
          job = P.createCreation({ name: name, creation: clean, thumb: thumb, tags: st.tags });
        } else {
          job = P.get(st.workId).then(function (cur) {
            if (!cur) return P.createCreation({ name: name, creation: clean, thumb: thumb, tags: st.tags });
            var stale = cur.updatedAt !== st.loadedAt ? askStale() : Promise.resolve('overwrite');
            return stale.then(function (choice) {
              if (choice === 'cancel') return null;
              if (choice === 'copy') { var nm2 = nextVersionName(name); return P.derive(st.workId, nm2, { creation: clean, thumb: thumb, name: nm2 }); }
              cur.name = name; cur.creation = clean; cur.thumb = thumb || cur.thumb;
              return P.save(PZ.model.sanitizeProject(cur), true);
            });
          });
        }
        return job.then(function (saved) {
          st.busy = false;
          if (!saved) { updateStatus(); return; }
          var derived = mode === 'copy' || (saved.id !== st.workId && st.workId);
          st.workId = saved.id; st.loadedAt = saved.updatedAt; st.loadedName = saved.name; st.defaultName = saved.name; st.tags = saved.tags;
          nameInput.value = saved.name;
          st.baseJson = snapJson();
          setUrl('work=' + encodeURIComponent(saved.id));
          clearDraft(); updateStatus();
          UI.toast(derived ? '元の作品はそのままに、「' + saved.name + '」を作りました' : '「' + saved.name + '」を保存しました', { type: 'ok', duration: 2600 });
        }, function (e) {
          st.busy = false; updateStatus();
          UI.toast('保存できませんでした: ' + failMsg(e), { type: 'error', duration: 7000 });
        });
      }

      /* ================= 書き出し・読み込み ================= */
      function exportTool() {
        var v = Cr.validate(st.creation);
        if (!v.ok) { UI.toast('ブロックのチェックに問題があるため、書き出せません。右の「Check」を確認してください。', { type: 'warn', duration: 5000 }); return; }
        var now = Date.now();
        var proj = { name: currentName(), tags: st.tags, createdAt: now, updatedAt: now, creation: v.clean };
        var file = Cr.toFile(proj);
        U.download(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), U.safeFileName(proj.name, '') + '.pzcreate.json');
        UI.toast('「' + proj.name + '」を自作ツールファイルとして書き出しました。他の人に渡せます。', { type: 'ok', duration: 4000 });
      }

      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!f) return;
        if (f.size > Cr.LIMITS.fileBytes) { UI.toast('ファイルが大きすぎます（' + Math.round(Cr.LIMITS.fileBytes / 1048576) + 'MBまで）', { type: 'error' }); return; }
        var reader = new FileReader();
        reader.onerror = function () { UI.toast('ファイルを読み込めませんでした', { type: 'error' }); };
        reader.onload = function () {
          var data;
          try { data = JSON.parse(String(reader.result)); }
          catch (e) { UI.toast('JSONとして読み込めませんでした。自作ツールのファイル（.pzcreate.json）を選んでください。', { type: 'error', duration: 6000 }); return; }
          if (data && data.app === 'playground-zero' && !Cr.isToolFile(data)) { UI.toast('これは自作ツールではなくバックアップのファイルです。My Space の「読み込み」から開いてください。', { type: 'warn', duration: 6500 }); return; }
          PZ.creationUI.importToolFile(data, f.name, f.size, { mode: 'edit', onLoad: function (project) {
            confirmDiscard().then(function (ok) {
              if (!ok) return;
              clearDraft();
              loadNew(project.creation, project.name);
              st.tags = project.tags;
              autostart();
              UI.toast('「' + project.name + '」を読み込みました（未保存）。保存すると My Space に入ります。', { type: 'ok', duration: 5000 });
            });
          } });
        };
        reader.readAsText(f);
      });

      /* ================= キー操作・離脱 ================= */
      function inField(e) { var t = e.target; return t && t.matches && t.matches('input,textarea,select'); }
      function onKey(e) {
        var mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(st.workId ? 'save' : 'save'); }
        else if (mod && !inField(e) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (mod && !inField(e) && (e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) { e.preventDefault(); redo(); }
      }
      function onBeforeUnload(e) { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } }
      document.addEventListener('keydown', onKey);
      window.addEventListener('beforeunload', onBeforeUnload);
      nameInput.addEventListener('input', function () { updateStatus(); saveDraft(); });

      /* ================= 開始 ================= */
      var q = ctx.query || {};
      validateNow(); renderVars(); renderTune(); renderAbout(); applyCanvasSize(); syncRun(); renderLive(true);
      st.baseJson = snapJson(); lastSnap = JSON.stringify(st.creation); updateStatus();
      if (q.work) {
        P.open(q.work).then(function (p) {
          if (!alive || !ctx.isCurrent()) return;
          if (!p || p.kind !== 'creation') {
            UI.toast(p ? 'この作品は自作ツールではありません。' : '作品が見つかりません。新しい自作ツールとして開きます。', { type: 'warn', duration: 5000 });
            loadBlank(); offerDraft(null); return;
          }
          loadProject(p); autostart(); offerDraft(p);
        }).catch(function (e) { UI.toast('作品を読み込めませんでした: ' + ((e && e.message) || ''), { type: 'error', duration: 6000 }); });
      } else if (q.sample) {
        loadSample(q.sample);
      } else {
        offerDraft(null);
      }
      raf = requestAnimationFrame(frame);

      return function destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('beforeunload', onBeforeUnload);
        restartSoon.cancel(); commitSoon.cancel(); saveDraft.cancel();
        if (rt) rt.stop();
        ws.destroy();
        return isDirty() ? writeDraft() : undefined;
      };
    }
  };
})();
