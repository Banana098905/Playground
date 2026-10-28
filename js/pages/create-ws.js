/*
 * Create — ブロックエディター部品（PZ.creationWs）
 *
 * ・パレット: 押すだけでブロックを追加（クリック操作）。マウスならドラッグでも置ける
 * ・ワークスペース: ブロックを表示・選択・並べ替え（↑↓ボタン／ドラッグ／キーボード）・複製・削除
 * ・値ブロック: 入力欄の「◇」から選んで差し込む（ポップアップ）
 * ・追加先(カーソル): 「選んだブロックの次」または「中身の最後（＋）」。画面に今の追加先を表示する
 * データ(creation)は呼び出し側が持ち、変更のたびに onChange('struct'|'value') で知らせる。
 * 画面は textContent / 属性だけで組み立てる（innerHTML を使わない）。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var UI = PZ.ui;
  var h = U.h;
  var Cr = PZ.creation;
  var SPEC = Cr.SPEC;
  var WS = (PZ.creationWs = {});

  var STMT_TABS = ['event', 'var', 'flow', 'draw', 'style'];

  function catOf(id) { return Cr.CATS.filter(function (c) { return c.id === id; })[0]; }

  WS.create = function (o) {
    var sel = null;
    var cursor = null; // {mode:'after', id} | {mode:'end', ownerId, body}
    var issueMap = {}; // id -> {err:[], warn:[]}
    var rtErrId = null;
    var tab = 'event';
    var root = h('div', { class: 'cw' });
    var palette = h('div', { class: 'cp' });
    var popover = null;

    function C() { return o.get(); }
    function changed(kind) { o.onChange(kind || 'struct'); }

    /* ---------- 木の操作 ---------- */
    function loc(id) { return Cr.find(C(), id); }
    function depthOf(id) {
      var d = 0, f = loc(id);
      while (f && f.parent) { d++; f = loc(f.parent.id); }
      return d;
    }
    function heightOf(b) {
      var spec = SPEC[b.type], hgt = 0;
      if (!spec) return 0;
      spec.bodies.forEach(function (bn) { (b[bn] || []).forEach(function (c) { hgt = Math.max(hgt, 1 + heightOf(c)); }); });
      return hgt;
    }
    function countOf(b) { var n = 0; Cr.walk({ scripts: [b] }, function () { n++; }); return n; }
    function varNames() {
      var names = [], seen = {};
      function add(n) { if (n && !seen[n]) { seen[n] = 1; names.push(n); } }
      (C().vars || []).forEach(function (v) { add(v.name); });
      Cr.walk(C(), function (b) { if ((b.type === 'set' || b.type === 'change') && b.in) add(b.in.name); });
      return names;
    }
    WS.varNames = varNames;

    function listFor(ownerId, body) {
      if (!ownerId) return C().scripts;
      var f = loc(ownerId);
      return f ? f.block[body] : null;
    }

    /** 置けるか確認（数・深さ）。置けなければ理由を返す */
    function whyNot(block, ownerId, extraRemoveCount) {
      var total = Cr.stats(C()).blocks - (extraRemoveCount || 0) + countOf(block);
      if (total > Cr.LIMITS.blocks) return 'ブロックは全部で ' + Cr.LIMITS.blocks + ' 個までです。';
      if (SPEC[block.type].kind === 'event') {
        if (C().scripts.length >= Cr.LIMITS.scripts) return 'イベントは ' + Cr.LIMITS.scripts + ' 個までです。';
        return '';
      }
      var d = ownerId ? depthOf(ownerId) + 1 : 1;
      if (d + heightOf(block) > Cr.LIMITS.depth) return 'ブロックの入れ子は ' + Cr.LIMITS.depth + ' 段までです。';
      return '';
    }

    /* ---------- 画面 ---------- */
    function tokens(spec, b, host) {
      spec.label.forEach(function (tok) {
        if (tok.charAt(0) === '@') host.appendChild(renderSlot(b, tok.slice(1)));
        else host.appendChild(h('span', { class: 'tk' }, tok));
      });
    }

    function mkSelect(options, current, onchange, label) {
      var s = h('select', { class: 'in in-sel', 'aria-label': label });
      options.forEach(function (op) { var e = h('option', { value: op[0] }, op[1]); if (op[0] === current) e.selected = true; s.appendChild(e); });
      s.addEventListener('change', function () { onchange(s.value, s); });
      return s;
    }
    function fit(inp) { inp.style.width = Math.max(3, Math.min(24, inp.value.length + 1)) + 'ch'; }

    function renderSlot(b, name) {
      var spec = SPEC[b.type], s = spec.slots[name], v = b.in[name];
      var wrap = h('span', { class: 'slot slot-' + s.t });
      var label = spec.name + ' の入力';
      if (v && typeof v === 'object') {
        wrap.appendChild(renderPill(v, function () { b.in[name] = s.def; render(); changed('struct'); }));
        return wrap;
      }
      var w;
      if (s.t === 'num') {
        w = h('input', { class: 'in in-num', type: 'text', inputmode: 'decimal', value: String(v), 'aria-label': label, autocomplete: 'off' });
        fit(w);
        w.addEventListener('input', function () {
          var t = w.value.trim(), n = Number(t);
          if (t !== '' && isFinite(n)) { b.in[name] = Math.max(s.min, Math.min(s.max, n)); w.classList.remove('bad'); changed('value'); } else w.classList.add('bad');
          fit(w);
        });
        w.addEventListener('change', function () { w.value = String(b.in[name]); w.classList.remove('bad'); fit(w); });
      } else if (s.t === 'text') {
        w = h('input', { class: 'in in-text', type: 'text', value: String(v), maxlength: s.max || Cr.LIMITS.text, 'aria-label': label, autocomplete: 'off' });
        fit(w);
        w.addEventListener('input', function () { b.in[name] = w.value; fit(w); changed('value'); });
      } else if (s.t === 'any') {
        w = h('input', { class: 'in in-text', type: 'text', value: String(v), maxlength: Cr.LIMITS.text, 'aria-label': label, autocomplete: 'off', title: '数・文字・true/false を入れられます' });
        fit(w);
        w.addEventListener('input', function () { b.in[name] = Cr.parseAny(w.value); fit(w); changed('value'); });
      } else if (s.t === 'color') {
        w = h('input', { class: 'in in-color', type: 'color', value: String(v), 'aria-label': label });
        w.addEventListener('input', function () { b.in[name] = w.value; changed('value'); });
      } else if (s.t === 'bool') {
        w = mkSelect([['true', 'はい'], ['false', 'いいえ']], String(!!v), function (val) { b.in[name] = val === 'true'; changed('value'); }, label);
      } else if (s.t === 'enum') {
        w = mkSelect(s.options, v, function (val) { b.in[name] = val; changed('value'); }, label);
      } else { // var
        var names = varNames();
        if (v && names.indexOf(v) < 0) names.push(v);
        var opts = [['', '（選ぶ）']].concat(names.map(function (n) { return [n, n]; }), [['__new', '＋ 新しいへんすう…']]);
        w = mkSelect(opts, v, function (val, el) {
          if (val !== '__new') { b.in[name] = val; render(); changed('struct'); return; }
          el.value = v;
          UI.promptText({ title: '新しいへんすうの名前', label: '20文字まで。空白や記号 " \' < > & \\ は使えません', maxLength: 20 }).then(function (nm) {
            if (!nm) return;
            if (!Cr.isVarName(nm)) { UI.toast('このへんすう名は使えません', { type: 'warn' }); return; }
            b.in[name] = nm; render(); changed('struct');
          });
        }, label);
      }
      wrap.appendChild(w);
      if (s.t !== 'var' && s.t !== 'enum') {
        var plug = h('button', { type: 'button', class: 'plug', title: '値ブロック（乱数・計算・マウスの位置など）を差し込む', 'aria-label': label + 'に値ブロックを差し込む' }, '◇');
        plug.addEventListener('click', function (e) { e.stopPropagation(); openPlug(plug, b, name); });
        wrap.appendChild(plug);
      }
      return wrap;
    }

    function renderPill(e, onUnplug) {
      var spec = SPEC[e.type];
      if (!spec || e.type === 'unknown') return h('span', { class: 'pill cat-flow has-err', 'data-id': e.id, title: '未対応のブロックです。外してください。' }, '未対応: ' + (e.was || '?'), unplugBtn());
      var el = h('span', { class: 'pill cat-' + spec.cat, 'data-id': e.id, title: spec.hint });
      tokens(spec, e, el);
      el.appendChild(unplugBtn());
      function unplugBtn() {
        var bt = h('button', { type: 'button', class: 'unplug', title: 'この値ブロックを外す', 'aria-label': '値ブロックを外す' }, '×');
        bt.addEventListener('click', function (ev) { ev.stopPropagation(); onUnplug(); });
        return bt;
      }
      return el;
    }

    function dropZone(ownerId, body, index) {
      return h('div', { class: 'drop gap', 'data-owner': ownerId, 'data-body': body, 'data-index': index });
    }

    function renderBody(owner, bn) {
      var spec = SPEC[owner.type];
      var arr = owner[bn] || [];
      var sub = h('div', { class: 'blk-sub' });
      var lbl = spec.bodyLabels && spec.bodyLabels[bn];
      if (lbl) sub.appendChild(h('div', { class: 'blk-sublabel' }, lbl));
      var list = h('div', { class: 'blk-list', 'data-owner': owner.id, 'data-body': bn });
      arr.forEach(function (c, i) { list.appendChild(dropZone(owner.id, bn, i)); list.appendChild(renderBlock(c)); });
      var end = h('button', { type: 'button', class: 'drop drop-end' + (arr.length ? '' : ' empty'), 'data-owner': owner.id, 'data-body': bn, 'data-index': arr.length,
        'aria-label': '「' + spec.name + '」の' + (lbl || '中') + 'に追加する場所を選ぶ' }, UI.icon('plus'), arr.length ? '' : 'ここにブロックを追加');
      end.addEventListener('click', function (e) { e.stopPropagation(); setCursor({ mode: 'end', ownerId: owner.id, body: bn }); });
      list.appendChild(end);
      sub.appendChild(list);
      return sub;
    }

    function renderBlock(b) {
      var spec = SPEC[b.type];
      if (!spec || b.type === 'unknown') {
        var u = h('div', { class: 'blk cat-flow has-err', 'data-id': b.id, tabindex: '0', title: 'このバージョンでは使えないブロックです。削除してください。' },
          h('div', { class: 'blk-head' }, UI.icon('alert'), h('div', { class: 'blk-label' }, '未対応のブロック（' + (b.was || '不明') + '）'), toolsFor(b)));
        return u;
      }
      var isEvent = spec.kind === 'event';
      var el = h('div', { class: 'blk cat-' + spec.cat + (isEvent ? ' blk-event' : ''), 'data-id': b.id, tabindex: '0', role: 'group', 'aria-label': spec.name });
      var head = h('div', { class: 'blk-head', title: spec.hint });
      if (!isEvent) head.appendChild(h('span', { class: 'grip', 'data-grip': b.id, title: 'ドラッグで移動', 'aria-hidden': 'true' }, UI.icon('grip')));
      head.appendChild(h('span', { class: 'blk-ico' }, UI.icon(spec.icon)));
      var lab = h('div', { class: 'blk-label' });
      tokens(spec, b, lab);
      head.appendChild(lab);
      head.appendChild(toolsFor(b));
      el.appendChild(head);
      spec.bodies.forEach(function (bn) { el.appendChild(renderBody(b, bn)); });
      return el;
    }

    function toolsFor(b) {
      var t = h('div', { class: 'blk-tools' });
      function btn(icon, title, fn) {
        var x = UI.iconButton(icon, title, function (e) { e.stopPropagation(); fn(); });
        x.classList.add('mini'); t.appendChild(x);
      }
      btn('up', '上へ', function () { move(b.id, -1); });
      btn('down', '下へ', function () { move(b.id, 1); });
      btn('copy', '複製', function () { duplicate(b.id); });
      btn('trash', '削除', function () { remove(b.id); });
      return t;
    }

    function render() {
      var hadFocus = root.contains(document.activeElement);
      var c = C();
      U.clear(root);
      if (!c.scripts.length) {
        root.appendChild(h('div', { class: 'cw-empty' },
          h('div', { class: 'cw-empty-mark', 'aria-hidden': 'true' }, UI.icon('blocks', 34)),
          h('h3', null, 'まずは1つ、ブロックを置いてみよう'),
          h('p', null, '左の「イベント」から「はじまったとき」を押すと、ここに置かれます。そこへ「描く」「色・位置」のブロックを足していくと、右のプレビューに絵が出ます。'),
          h('div', { class: 'cw-empty-actions' },
            UI.button('「はじまったとき」を置く', { kind: 'primary', icon: 'plus', onclick: function () { addBlock('onStart'); } }),
            UI.button('サンプルから始める', { kind: 'ghost', icon: 'sample', onclick: function () { if (o.onSamples) o.onSamples(); } }))));
      } else {
        c.scripts.forEach(function (s) { root.appendChild(h('div', { class: 'cw-script' }, renderBlock(s))); });
        root.appendChild(h('div', { class: 'drop drop-scripts', 'data-owner': '', 'data-body': 'scripts', 'data-index': c.scripts.length }, 'ここにイベントをドロップして新しいスクリプトを作る'));
      }
      applyMarks();
      if (hadFocus && sel) { var f = root.querySelector('.blk[data-id="' + sel + '"]'); if (f) f.focus({ preventScroll: true }); }
    }

    /** 選択・カーソル・エラー表示を DOM に反映（再描画なし） */
    function applyMarks() {
      Array.prototype.forEach.call(root.querySelectorAll('.is-sel,.is-cursor,.is-after,.has-err,.has-warn,.has-rt'), function (e) { e.classList.remove('is-sel', 'is-cursor', 'is-after', 'has-err', 'has-warn', 'has-rt'); });
      if (sel) { var s = root.querySelector('.blk[data-id="' + sel + '"]'); if (s) s.classList.add('is-sel'); else sel = null; }
      if (cursor && cursor.mode === 'after') { var a = root.querySelector('.blk[data-id="' + cursor.id + '"]'); if (a) a.classList.add('is-after'); else cursor = null; }
      else if (cursor && cursor.mode === 'end') {
        var e = root.querySelector('.drop-end[data-owner="' + cursor.ownerId + '"][data-body="' + cursor.body + '"]');
        if (e) e.classList.add('is-cursor'); else cursor = null;
      }
      Object.keys(issueMap).forEach(function (id) {
        var m = issueMap[id];
        var el = root.querySelector('[data-id="' + id + '"]');
        if (!el) return;
        el.classList.add(m.err.length ? 'has-err' : 'has-warn');
        var head = el.classList.contains('blk') ? el.querySelector('.blk-head') : el;
        if (head) head.title = (m.err.concat(m.warn)).join('\n');
      });
      if (rtErrId) { var r = root.querySelector('[data-id="' + rtErrId + '"]'); if (r) r.classList.add('has-rt'); }
      if (o.onCursor) o.onCursor(cursorText());
    }

    function cursorText() {
      if (cursor && cursor.mode === 'end') {
        var f = loc(cursor.ownerId);
        if (f) { var sp = SPEC[f.block.type]; return '「' + (sp ? sp.name : '?') + '」の' + ((sp && sp.bodyLabels && sp.bodyLabels[cursor.body]) || '中') + 'の最後'; }
      }
      if (cursor && cursor.mode === 'after') {
        var g = loc(cursor.id);
        if (g) return '「' + Cr.blockName(g.block) + '」の次';
      }
      return C().scripts.length ? '最後のスクリプトの最後' : '新しいスクリプト';
    }

    function setCursor(cur) { cursor = cur; if (cur && cur.mode === 'end') sel = null; applyMarks(); }

    function select(id, o2) {
      sel = id;
      var f = id && loc(id);
      if (f) {
        var sp = SPEC[f.block.type];
        if (sp && sp.kind === 'event') cursor = { mode: 'end', ownerId: id, body: 'body' };
        else cursor = { mode: 'after', id: id };
      }
      applyMarks();
      if (o.onSelect) o.onSelect(f && SPEC[f.block.type] ? SPEC[f.block.type] : null);
      if (o2 && o2.focus) { var el = root.querySelector('.blk[data-id="' + id + '"]'); if (el) { el.scrollIntoView({ block: 'center', behavior: U.prefersReducedMotion() ? 'auto' : 'smooth' }); el.focus({ preventScroll: true }); } }
    }

    /* ---------- 追加・移動・削除 ---------- */
    function newBlock(type) {
      var b = Cr.makeBlock(type);
      if ((type === 'set' || type === 'change') && !b.in.name) { var n = varNames()[0]; if (n) b.in.name = n; }
      return b;
    }

    function targetFor() {
      var c = C();
      if (cursor && cursor.mode === 'end') { var f = loc(cursor.ownerId); if (f) return { ownerId: cursor.ownerId, body: cursor.body, index: f.block[cursor.body].length }; }
      if (cursor && cursor.mode === 'after') {
        var g = loc(cursor.id);
        if (g && g.where.body) return { ownerId: g.parent.id, body: g.where.body, index: g.where.index + 1 };
      }
      if (c.scripts.length) { var last = c.scripts[c.scripts.length - 1]; if (SPEC[last.type] && SPEC[last.type].bodies.length) return { ownerId: last.id, body: 'body', index: (last.body || []).length }; }
      return null;
    }

    function addBlock(type) {
      var spec = SPEC[type];
      if (!spec) return;
      var c = C();
      var b = newBlock(type);
      if (spec.kind === 'expr') { plugIntoSelected(b); return; }
      if (spec.kind === 'event') {
        var why = whyNot(b, '');
        if (why) { UI.toast(why, { type: 'warn' }); return; }
        c.scripts.push(b);
        cursor = { mode: 'end', ownerId: b.id, body: 'body' };
      } else {
        var t = targetFor();
        if (!t) {
          var st = newBlock('onStart');
          if (whyNot(st, '')) { UI.toast(whyNot(st, ''), { type: 'warn' }); return; }
          c.scripts.push(st);
          t = { ownerId: st.id, body: 'body', index: 0 };
        }
        var why2 = whyNot(b, t.ownerId);
        if (why2) { UI.toast(why2, { type: 'warn' }); return; }
        listFor(t.ownerId, t.body).splice(t.index, 0, b);
        // くりかえし・もし を置いたら、続けて中に入れられるように
        if (spec.bodies.length) cursor = { mode: 'end', ownerId: b.id, body: spec.bodies[0] };
        else cursor = { mode: 'after', id: b.id };
      }
      sel = b.id;
      render();
      var el = root.querySelector('.blk[data-id="' + b.id + '"]');
      if (el) el.scrollIntoView({ block: 'nearest', behavior: U.prefersReducedMotion() ? 'auto' : 'smooth' });
      if (o.onSelect) o.onSelect(spec);
      changed('struct');
    }

    /** パレットの「値ブロック」: 選択中のブロックの、合う入力欄に差し込む */
    function plugIntoSelected(e) {
      var f = sel && loc(sel);
      if (!f || !SPEC[f.block.type]) { UI.toast('先に、差し込み先のブロックを選んでください（入力欄の「◇」からも選べます）', { type: 'info', duration: 4200 }); return; }
      var spec = SPEC[f.block.type], b = f.block, espec = SPEC[e.type];
      var names = Object.keys(spec.slots);
      for (var i = 0; i < names.length; i++) {
        var s = spec.slots[names[i]], cur = b.in[names[i]];
        if (s.t === 'var' || s.t === 'enum') continue;
        if (cur && typeof cur === 'object') continue;
        if (!Cr.ACCEPT[s.t][espec.out]) continue;
        if (e.type === 'var' && !e.in.name) { var vn = varNames()[0]; if (vn) e.in.name = vn; }
        b.in[names[i]] = e; render(); changed('struct'); return;
      }
      UI.toast('このブロックには、差し込める空きの入力欄がありません', { type: 'warn' });
    }

    function move(id, dir) {
      var f = loc(id); if (!f) return;
      var list = Cr.listOf(C(), f.parent, f.where), i = f.where.index;
      if (!list) return;
      if (dir < 0 && i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); }
      else if (dir > 0 && i < list.length - 1) { list.splice(i + 1, 0, list.splice(i, 1)[0]); }
      else if (f.parent && SPEC[f.parent.type] && SPEC[f.parent.type].kind === 'stmt') {
        // 端まで来たら、囲んでいるブロック（くりかえし・もし）の外へ出す
        var pf = loc(f.parent.id), plist = Cr.listOf(C(), pf.parent, pf.where);
        list.splice(i, 1);
        plist.splice(pf.where.index + (dir > 0 ? 1 : 0), 0, f.block);
      } else return;
      sel = id; render(); changed('struct');
      var el = root.querySelector('.blk[data-id="' + id + '"]'); if (el) el.focus({ preventScroll: true });
    }

    function duplicate(id) {
      var f = loc(id); if (!f) return;
      var copy = Cr.cloneBlock(f.block);
      var ownerId = f.parent ? f.parent.id : '';
      var why = whyNot(copy, ownerId);
      if (why) { UI.toast(why, { type: 'warn' }); return; }
      Cr.listOf(C(), f.parent, f.where).splice(f.where.index + 1, 0, copy);
      sel = copy.id; render(); changed('struct');
      UI.toast('ブロックを複製しました', { type: 'ok', duration: 1200 });
    }

    function remove(id) {
      var f = loc(id); if (!f) return;
      var list = Cr.listOf(C(), f.parent, f.where);
      var n = countOf(f.block);
      list.splice(f.where.index, 1);
      var nb = list[f.where.index] || list[f.where.index - 1];
      sel = nb ? nb.id : (f.parent ? f.parent.id : null);
      if (cursor && cursor.mode === 'after' && cursor.id === id) cursor = null;
      render(); changed('struct');
      if (n > 1) UI.toast(n + ' 個のブロックを削除しました（「元に戻す」で戻せます）', { type: 'info', duration: 2500 });
    }

    /* ---------- 値ブロックのポップアップ ---------- */
    function closePop() {
      if (!popover) return;
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onPopKey, true);
      if (popover.parentNode) popover.parentNode.removeChild(popover);
      var back = popover._anchor; popover = null;
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    }
    function onDocDown(e) { if (popover && !popover.contains(e.target)) closePop(); }
    function onPopKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } }

    function openPlug(anchor, b, name) {
      closePop();
      var s = SPEC[b.type].slots[name];
      var pop = h('div', { class: 'popover', role: 'dialog', 'aria-label': '値ブロックを選ぶ' });
      pop.appendChild(h('div', { class: 'pop-title' }, '差し込む値を選ぶ'));
      function put(e) { b.in[name] = e; closePop(); render(); changed('struct'); }
      var names = varNames();
      var okAny = Cr.ACCEPT[s.t].any;
      if (okAny) {
        pop.appendChild(h('div', { class: 'pop-sec' }, 'へんすう'));
        var row = h('div', { class: 'pop-items' });
        if (!names.length) row.appendChild(h('span', { class: 'pop-none' }, 'へんすうがまだありません（「へんすう」の「〜を〜にする」で作れます）'));
        names.forEach(function (n) {
          var bt = h('button', { type: 'button', class: 'pop-item cat-var' }, UI.icon('variable'), n);
          bt.addEventListener('click', function () { put(Cr.makeBlock('var', { name: n })); });
          row.appendChild(bt);
        });
        pop.appendChild(row);
      }
      ['calc', 'input'].forEach(function (cid) {
        var items = Object.keys(SPEC).map(function (k) { return SPEC[k]; }).filter(function (sp) { return sp.kind === 'expr' && sp.cat === cid && Cr.ACCEPT[s.t][sp.out]; });
        if (!items.length) return;
        pop.appendChild(h('div', { class: 'pop-sec' }, catOf(cid).label));
        var r = h('div', { class: 'pop-items' });
        items.forEach(function (sp) {
          var bt = h('button', { type: 'button', class: 'pop-item cat-' + sp.cat, title: sp.hint }, UI.icon(sp.icon), sp.name);
          bt.addEventListener('click', function () { put(Cr.makeBlock(sp.type)); });
          r.appendChild(bt);
        });
        pop.appendChild(r);
      });
      document.body.appendChild(pop);
      var r0 = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
      if (window.innerWidth > 720) {
        var left = Math.max(8, Math.min(r0.left, window.innerWidth - pw - 8));
        var top = r0.bottom + 6; if (top + ph > window.innerHeight - 8) top = Math.max(8, r0.top - ph - 6);
        pop.style.left = left + 'px'; pop.style.top = top + 'px';
      } else pop.classList.add('sheet');
      pop._anchor = anchor;
      popover = pop;
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('keydown', onPopKey, true);
      var first = pop.querySelector('.pop-item'); if (first) first.focus({ preventScroll: true });
    }

    /* ---------- パレット ---------- */
    var palHelp = h('div', { class: 'cp-help', 'aria-live': 'polite' });
    function setHelp(spec) {
      palHelp.textContent = spec ? spec.name + '：' + spec.hint : 'ブロックにカーソルを合わせる（スマホは長押し）と、説明が出ます。';
    }

    function renderPalette() {
      U.clear(palette);
      var tabs = h('div', { class: 'cp-tabs', role: 'tablist', 'aria-label': 'ブロックの種類' });
      STMT_TABS.concat(['value']).forEach(function (id) {
        var cat = id === 'value' ? { label: '値', icon: 'calc', note: '入力欄に差し込む値（乱数・計算・マウス…）' } : catOf(id);
        var t = h('button', { type: 'button', class: 'cp-tab' + (id === 'value' ? ' cat-calc' : ' cat-' + id), role: 'tab', 'aria-selected': String(tab === id), title: cat.note }, UI.icon(cat.icon), h('span', null, cat.label));
        t.addEventListener('click', function () { tab = id; renderPalette(); });
        tabs.appendChild(t);
      });
      palette.appendChild(tabs);
      var items = [];
      if (tab === 'value') {
        ['calc', 'input'].forEach(function (cid) { Object.keys(SPEC).forEach(function (k) { if (SPEC[k].kind === 'expr' && SPEC[k].cat === cid) items.push(SPEC[k]); }); });
        items.unshift(SPEC['var']);
      } else Cr.paletteOrder(tab).forEach(function (sp) { items.push(sp); });
      var note = tab === 'value' ? '値ブロックは、ブロックの入力欄の「◇」から選ぶのが基本です。ここから押すと、選択中のブロックの空いた入力欄へ差し込みます。' : catOf(tab).note;
      palette.appendChild(h('p', { class: 'cp-note' }, note));
      var grid = h('div', { class: 'cp-items', role: 'tabpanel' });
      items.forEach(function (sp) {
        var it = h('button', { type: 'button', class: 'cp-item cat-' + sp.cat, 'data-type': sp.type, title: sp.hint }, UI.icon(sp.icon), h('span', null, sp.name));
        it.addEventListener('click', function () { addBlock(sp.type); });
        it.addEventListener('mouseenter', function () { setHelp(sp); });
        it.addEventListener('focus', function () { setHelp(sp); });
        it.addEventListener('mouseleave', function () { setHelp(null); });
        it.addEventListener('pointerdown', function (e) { if (sp.kind !== 'expr' && e.pointerType !== 'touch' && e.button === 0) startDrag({ kind: 'new', type: sp.type }, e, sp.name); });
        grid.appendChild(it);
      });
      palette.appendChild(grid);
      palette.appendChild(palHelp);
      if (!palHelp.textContent) setHelp(null);
    }

    /* ---------- ドラッグ＆ドロップ（マウス／ペン。タッチはクリックで追加） ---------- */
    var drag = null;
    function startDrag(src, e, label) {
      if (drag) return;
      drag = { src: src, x0: e.clientX, y0: e.clientY, on: false, ghost: null, hot: null, label: label, pid: e.pointerId };
      document.addEventListener('pointermove', onDragMove);
      document.addEventListener('pointerup', onDragEnd);
      document.addEventListener('pointercancel', onDragCancel);
      document.addEventListener('keydown', onDragKey, true);
    }
    function onDragKey(e) { if (e.key === 'Escape') { e.stopPropagation(); endDrag(); } }
    function zoneAt(x, y) {
      var el = document.elementFromPoint(x, y);
      var z = el && el.closest ? el.closest('.drop') : null;
      if (!z || !root.contains(z)) return null;
      return z;
    }
    function zoneOk(z) {
      if (!z) return false;
      var evt = drag.src.kind === 'new' ? SPEC[drag.src.type].kind === 'event' : false;
      if (drag.src.kind === 'move') {
        var f = loc(drag.src.id); if (!f) return false;
        if (z.getAttribute('data-owner') && (z.getAttribute('data-owner') === drag.src.id || (function () { var anc = z.closest('.blk[data-id="' + drag.src.id + '"]'); return !!anc; })())) return false;
      }
      var isScripts = z.getAttribute('data-body') === 'scripts';
      return evt ? isScripts : !isScripts;
    }
    function onDragMove(e) {
      if (!drag) return;
      if (!drag.on) {
        if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 6) return;
        drag.on = true;
        drag.ghost = h('div', { class: 'drag-ghost' }, drag.label || (drag.src.kind === 'move' ? Cr.blockName((loc(drag.src.id) || {}).block) : ''));
        document.body.appendChild(drag.ghost);
        root.classList.add('is-dragging'); document.body.classList.add('is-dragging');
        if (drag.src.kind === 'move') { var el = root.querySelector('.blk[data-id="' + drag.src.id + '"]'); if (el) el.classList.add('drag-src'); }
      }
      e.preventDefault();
      drag.ghost.style.left = (e.clientX + 12) + 'px'; drag.ghost.style.top = (e.clientY + 8) + 'px';
      var z = zoneAt(e.clientX, e.clientY);
      if (!zoneOk(z)) z = null;
      if (drag.hot !== z) { if (drag.hot) drag.hot.classList.remove('drop-hot'); drag.hot = z; if (z) z.classList.add('drop-hot'); }
      // 端に近づいたら画面をスクロール
      if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
    }
    function onDragEnd(e) {
      if (!drag) return;
      var d = drag, z = d.on ? d.hot : null;
      endDrag();
      if (d.on && z) dropAt(d.src, z.getAttribute('data-owner'), z.getAttribute('data-body'), parseInt(z.getAttribute('data-index'), 10));
    }
    function onDragCancel() { endDrag(); }
    function endDrag() {
      if (!drag) return;
      document.removeEventListener('pointermove', onDragMove);
      document.removeEventListener('pointerup', onDragEnd);
      document.removeEventListener('pointercancel', onDragCancel);
      document.removeEventListener('keydown', onDragKey, true);
      if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
      if (drag.hot) drag.hot.classList.remove('drop-hot');
      root.classList.remove('is-dragging'); document.body.classList.remove('is-dragging');
      Array.prototype.forEach.call(root.querySelectorAll('.drag-src'), function (x) { x.classList.remove('drag-src'); });
      drag = null;
    }

    function dropAt(src, ownerId, body, index) {
      if (src.kind === 'new') {
        var b = newBlock(src.type);
        var why = whyNot(b, ownerId);
        if (why) { UI.toast(why, { type: 'warn' }); return; }
        var list = listFor(ownerId, body); if (!list) return;
        list.splice(Math.min(index, list.length), 0, b);
        sel = b.id; cursor = SPEC[b.type].bodies.length ? { mode: 'end', ownerId: b.id, body: SPEC[b.type].bodies[0] } : { mode: 'after', id: b.id };
        render(); changed('struct');
        return;
      }
      var f = loc(src.id); if (!f) return;
      var why2 = whyNot(f.block, ownerId, countOf(f.block));
      if (why2) { UI.toast(why2, { type: 'warn' }); return; }
      var from = Cr.listOf(C(), f.parent, f.where), fi = f.where.index;
      var to = listFor(ownerId, body); if (!to) return;
      var idx = Math.min(index, to.length);
      if (from === to && fi < idx) idx--;
      from.splice(fi, 1);
      to.splice(idx, 0, f.block);
      sel = src.id; cursor = { mode: 'after', id: src.id };
      render(); changed('struct');
    }

    /* ---------- 入力イベント（選択・キーボード・ドラッグの開始） ---------- */
    root.addEventListener('pointerdown', function (e) {
      var g = e.target.closest && e.target.closest('.grip');
      if (g && e.button === 0) {
        if (e.pointerType === 'touch') return;
        e.preventDefault();
        startDrag({ kind: 'move', id: g.getAttribute('data-grip') }, e);
      }
    });
    root.addEventListener('click', function (e) {
      if (e.target.closest('.drop,.plug,.unplug')) return;
      var blk = e.target.closest('.blk');
      if (blk) { var id = blk.getAttribute('data-id'); if (id !== sel) select(id); return; }
      sel = null; applyMarks(); if (o.onSelect) o.onSelect(null);
    });
    root.addEventListener('keydown', function (e) {
      var blk = e.target.classList && e.target.classList.contains('blk') ? e.target : null;
      if (!blk) return;
      var id = blk.getAttribute('data-id');
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(id); }
      else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(id, -1); }
      else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(id, 1); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicate(id); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var all = Array.prototype.slice.call(root.querySelectorAll('.blk'));
        var i = all.indexOf(blk), nx = all[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (nx) { e.preventDefault(); nx.focus(); }
      }
    });
    root.addEventListener('focusin', function (e) {
      var blk = e.target.closest && e.target.closest('.blk');
      var id = blk && blk.getAttribute('data-id');
      if (id && id !== sel) select(id);
    });

    renderPalette();
    render();

    return {
      el: root, paletteEl: palette,
      render: render,
      addBlock: addBlock,
      getSel: function () { return sel; },
      /** 今の「追加先」（Remix の部品の挿入先に使う）: { ownerId, body, index } か null。表示用の文は cursorLabel() */
      getTarget: function () { return targetFor(); },
      cursorLabel: function () { return cursorText(); },
      select: select,
      /** チェック結果（検証のエラー・警告）を各ブロックに表示。list: [{id,msg,warn?}] */
      setIssues: function (list) {
        issueMap = {};
        list.forEach(function (it) {
          if (!it.id) return;
          var m = issueMap[it.id] || (issueMap[it.id] = { err: [], warn: [] });
          (it.warn ? m.warn : m.err).push(it.msg);
        });
        applyMarks();
      },
      setRuntimeError: function (id) { rtErrId = id || null; applyMarks(); },
      focusBlock: function (id) { select(id, { focus: true }); },
      refreshPalette: renderPalette,
      destroy: function () { closePop(); endDrag(); }
    };
  };
})();
