/*
 * WorkKit — 実験ツールと「作品」をつなぐ共通部品（PZ.workKit）
 *
 *  - 実験の設定(params)を作品として保存 / 上書き保存 / 派生保存（元の作品は保持）
 *  - ?work=ID で保存した作品から実験を再開（設定を読み込み、再生成・変更できる）
 *  - ?daily=日付 で始めた実験は、保存した作品に「今日の実験」を紐づける
 *  - 作品サムネイルの表示
 * どの実験ページも attach() を呼ぶだけで、同じ保存・再開の体験になる。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Kit = PZ.labKit;
  var WK = (PZ.workKit = {});

  function nextVersionName(name) {
    var m = /^(.*?)\s+v(\d+)$/.exec(name);
    var base = m ? m[1] : name;
    var n = m ? parseInt(m[2], 10) + 1 : 2;
    return (base + ' v' + n).slice(0, PZ.config.limits.projectNameLength);
  }

  /**
   * ctx: ルーターの ctx / o: {
   *   tool, label, getParams(), setParams(p), defaultName(), getCanvas() | exportPng() -> Promise<Blob>
   * }
   * 戻り値: { el, start() -> Promise, changed(), destroy(), current() }
   */
  WK.attach = function (ctx, o) {
    var state = { work: null, savedJson: null, dailyKey: null, askedDaily: false, busy: false, refreshQueued: false };
    var dailyQ = ctx.query && PZ.model.isDateKey(ctx.query.daily) ? ctx.query.daily : null;
    state.dailyKey = dailyQ;

    var nameInput = h('input', { class: 'input', type: 'text', maxlength: PZ.config.limits.projectNameLength, placeholder: '作品名（空なら自動で付けます）', 'aria-label': '作品名', autocomplete: 'off' });
    var status = h('div', { class: 'work-status', 'aria-live': 'polite' });
    var saveBtn = UI.button('保存', { icon: 'save', kind: 'primary', title: '設定を作品として保存 (Ctrl+S)', onclick: function () { save(); } });
    var deriveBtn = UI.button('派生保存', { icon: 'branch', kind: 'ghost', title: '元の作品を残したまま、別バージョンとして保存', onclick: function () { derive(); } });
    var pngBtn = UI.button('画像で保存', { icon: 'image', kind: 'ghost', title: '見た目をPNG画像として保存（再編集はできません）', onclick: function () { exportImage(); } });
    var spaceBtn = UI.button('My Space', { icon: 'space', kind: 'ghost', title: '保存した作品の一覧へ', onclick: function () { PZ.router.go('/space'); } });

    var dailyNote = dailyQ ? (function () {
      var th = PZ.daily.themeFor(dailyQ);
      return h('div', { class: 'work-daily' }, UI.icon('calendar'), h('span', null, '今日の実験: ', h('b', null, th ? th.title : dailyQ), '（' + dailyQ + '）'));
    })() : null;

    var el = h('div', { class: 'card lab-panel work-panel' },
      Kit.title('My Work', '保存と再開'),
      status,
      dailyNote,
      nameInput,
      h('div', { class: 'lab-buttons' }, saveBtn, deriveBtn, pngBtn, spaceBtn),
      h('p', { class: 'work-hint' }, '「保存」は設定をあとで再編集できる形で残します。「画像で保存」は見た目だけをPNGにします。'));

    function paramsJson() { try { return JSON.stringify(o.getParams()); } catch (e) { return ''; } }
    function currentName() {
      var v = nameInput.value.trim();
      return v || (o.defaultName ? o.defaultName() : o.label);
    }

    function refresh() {
      var w = state.work;
      var dirty = w ? state.savedJson !== paramsJson() : false;
      var txt;
      if (!w) txt = '新しい実験 · まだ保存されていません';
      else txt = '「' + w.name + '」 · ' + (dirty ? '未保存の変更があります' : '保存済み ' + U.fmtDate(w.updatedAt).slice(11));
      status.textContent = txt;
      status.className = 'work-status' + (w ? (dirty ? ' dirty' : ' saved') : '');
      deriveBtn.disabled = !w;
      deriveBtn.title = w ? '元の作品を残したまま、別バージョンとして保存' : '先に一度「保存」すると、派生作品を作れます';
      saveBtn.querySelector('.btn-label').textContent = w ? '上書き保存' : '保存';
    }
    function changed() {
      if (state.refreshQueued) return;
      state.refreshQueued = true;
      requestAnimationFrame(function () { state.refreshQueued = false; refresh(); });
    }

    function setUrl(id) {
      // hashchange を起こさずURLだけ更新（ページを作り直さない）。リロードしても同じ作品が開く
      try {
        var base = location.href.split('#')[0];
        var q = { work: id };
        history.replaceState(null, '', base + '#' + PZ.registry.get(o.tool).path + '?' + U.buildQuery(q));
      } catch (e) { /* noop */ }
    }

    function offerDaily() {
      if (!state.dailyKey || state.askedDaily) return;
      state.askedDaily = true;
      var key = state.dailyKey, th = PZ.daily.themeFor(key);
      PZ.userdata.daily().then(function (map) {
        if (map[key]) return;
        UI.toast('今日の実験として保存しました。挑戦を完了にしますか？', {
          type: 'ok', duration: 9000,
          action: { label: '完了にする', onClick: function () {
            PZ.userdata.markDaily(key, th ? th.id : '').then(function () { UI.toast('「' + (th ? th.title : key) + '」を完了にしました', { type: 'ok' }); },
              function (e) { UI.toast('記録できませんでした: ' + (e && e.message), { type: 'error' }); });
          } }
        });
      }).catch(function () { /* 通知なしでも保存は成功 */ });
    }

    function failMsg(e) {
      if (e && e.name === 'QuotaExceededError') return '保存容量が足りません。不要な作品を削除するか、バックアップ後に整理してください。';
      return (e && e.message) || '原因不明のエラー';
    }

    function save() {
      if (state.busy) return Promise.resolve();
      state.busy = true;
      var params = o.getParams();
      var name = currentName();
      var thumb = PZ.registry.thumbFor(o.tool, params);
      var job;
      if (state.work) {
        var w = state.work;
        w.name = name.slice(0, PZ.config.limits.projectNameLength); w.params = params; w.thumb = thumb || w.thumb;
        if (state.dailyKey && !w.daily) w.daily = state.dailyKey;
        job = PZ.projects.save(PZ.model.sanitizeProject(w), true).then(function (saved) { state.work = saved; return saved; });
      } else {
        job = PZ.projects.createExperiment(o.tool, { name: name, params: params, thumb: thumb, daily: state.dailyKey }).then(function (created) {
          state.work = created; setUrl(created.id); return created;
        });
      }
      return job.then(function (saved) {
        state.savedJson = JSON.stringify(params);
        nameInput.value = saved.name;
        refresh();
        UI.toast('作品として保存しました', { type: 'ok', duration: 1800 });
        offerDaily();
        if (o.onSaved) o.onSaved(saved);
      }, function (e) {
        UI.toast('保存できませんでした: ' + failMsg(e), { type: 'error', duration: 7000 });
      }).then(function () { state.busy = false; });
    }

    function derive() {
      if (!state.work || state.busy) return Promise.resolve();
      state.busy = true;
      var params = o.getParams();
      var base = state.work.name;
      var name = nameInput.value.trim() && nameInput.value.trim() !== base ? nameInput.value.trim() : nextVersionName(base);
      var thumb = PZ.registry.thumbFor(o.tool, params);
      // 元の作品は一切書き換えず、現在の設定で新しい作品を作る
      return PZ.projects.derive(state.work.id, name, { params: params, thumb: thumb, name: name }).then(function (d) {
        state.work = d; setUrl(d.id);
        state.savedJson = JSON.stringify(params);
        nameInput.value = d.name;
        refresh();
        UI.toast('元の作品はそのままに、「' + d.name + '」を作りました', { type: 'ok', duration: 3200 });
        if (o.onSaved) o.onSaved(d);
      }, function (e) {
        UI.toast('派生作品を作れませんでした: ' + failMsg(e), { type: 'error', duration: 7000 });
      }).then(function () { state.busy = false; });
    }

    function exportImage() {
      if (o.exportPng) {
        o.exportPng().then(function (blob) {
          U.download(blob, U.safeFileName(currentName(), '.png'));
          UI.toast('画像（PNG）を保存しました', { type: 'ok', duration: 1800 });
        }).catch(function (e) { UI.toast('画像を保存できませんでした: ' + ((e && e.message) || ''), { type: 'error' }); });
      } else Kit.savePng(o.getCanvas(), currentName());
    }

    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); }
    }
    document.addEventListener('keydown', onKey);
    nameInput.addEventListener('input', function () { /* 名前だけの変更は保存ボタンで反映 */ });

    /** 開始: 最近使った実験に記録し、?work= があれば作品を読み込む */
    function start() {
      PZ.userdata.touchTool(o.tool).catch(function () { /* 記録できなくても動く */ });
      var id = ctx.query && ctx.query.work;
      if (!id) { state.savedJson = null; refresh(); return Promise.resolve(null); }
      return PZ.projects.open(id).then(function (w) {
        if (!ctx.isCurrent()) return null;
        if (!w) { UI.toast('作品が見つかりません。新しい実験として開きます。', { type: 'warn', duration: 5000 }); refresh(); return null; }
        if (w.kind !== 'experiment' || w.tool !== o.tool) {
          UI.toast('この作品は ' + (w.kind === 'studio' ? 'Studio の作品' : '別の実験の作品') + 'です。', { type: 'warn', duration: 5000 });
          refresh(); return null;
        }
        state.work = w;
        if (w.daily) state.dailyKey = w.daily;
        nameInput.value = w.name;
        o.setParams(w.params);
        state.savedJson = paramsJson();
        refresh();
        UI.toast('「' + w.name + '」を読み込みました。設定を変えて再編集できます。', { type: 'info', duration: 3200 });
        return w;
      }).catch(function (e) {
        UI.toast('作品を読み込めませんでした: ' + ((e && e.message) || ''), { type: 'error', duration: 6000 });
        refresh();
        return null;
      });
    }

    return {
      el: el, start: start, changed: changed, save: save,
      current: function () { return state.work; },
      destroy: function () { document.removeEventListener('keydown', onKey); }
    };
  };

  /* ---------- サムネイル ---------- */
  /**
   * 作品カードのサムネイルを host に描く。
   * Studio の作品はキャンバスで描画、実験の作品は保存済みのサムネイル画像（なければツールのアイコン）。
   */
  WK.drawThumb = function (host, work, pad) {
    U.clear(host);
    if (work.kind === 'creation') {
      if (work.thumb) host.appendChild(h('img', { class: 'work-img', src: work.thumb, alt: '', loading: 'lazy', decoding: 'async' }));
      else host.appendChild(h('div', { class: 'work-noimg' }, UI.icon('blocks', 40)));
      return;
    }
    if (work.kind === 'experiment') {
      if (work.thumb) {
        host.appendChild(h('img', { class: 'work-img', src: work.thumb, alt: '', loading: 'lazy', decoding: 'async' }));
      } else {
        var t = PZ.registry.get(work.tool);
        host.appendChild(h('div', { class: 'work-noimg' }, UI.icon(t ? t.icon : 'lab', 40)));
      }
      return;
    }
    var cv = h('canvas', { 'aria-hidden': 'true' });
    host.appendChild(cv);
    requestAnimationFrame(function () {
      var w = host.clientWidth - (pad === undefined ? 24 : pad), hh = host.clientHeight - (pad === undefined ? 24 : pad);
      if (w > 20 && hh > 20) PZ.render.drawThumb(cv, work, w, hh);
    });
  };

  /** 作品の種類ラベル（カードのバッジ用） */
  WK.kindLabel = function (work) {
    if (work.kind === 'creation') return 'CREATE';
    if (work.kind !== 'experiment') return 'STUDIO';
    var t = PZ.registry.get(work.tool);
    return t ? t.name.toUpperCase() : 'LAB';
  };
})();
