/*
 * 共通UI部品: アイコン / トースト / モーダル / 確認・入力ダイアログ
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var h = PZ.util.h;
  var UI = (PZ.ui = {});

  /* ---------- アイコン (24x24, stroke) ---------- */
  var ICONS = {
    home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
    studio: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.5 7.5',
    lab: 'M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3M7.5 15h9',
    space: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    plus: 'M12 5v14M5 12h14',
    undo: 'M3 4v6h6M3.5 14a9 9 0 1 0 2.1-9.4L3 10',
    redo: 'M21 4v6h-6M20.5 14a9 9 0 1 1-2.1-9.4L21 10',
    trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    upload: 'M12 15V3M7 8l5-5 5 5M4 21h16',
    play: 'M7 4l13 8-13 8z',
    pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
    reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
    dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
    back: 'M15 5l-7 7 7 7',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    rect: 'M4 6h16v12H4z',
    ellipse: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
    triangle: 'M12 4l9 16H3z',
    star: 'M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z',
    text: 'M5 6V4h14v2M12 4v16M9 20h6',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
    close: 'M6 6l12 12M18 6L6 18',
    check: 'M5 12l5 5L20 7',
    alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    particles: 'M5 6h.01M12 4h.01M18 8h.01M7 13h.01M14 11h.01M19 15h.01M10 19h.01M16 20h.01',
    shapes: 'M3 13h8v8H3zM15 3l6 10h-12zM17 15a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
    tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
    folder: 'M3 6h6l2 3h10v11H3z',
    flow: 'M3 8c4-5 6 5 10 0s6 3 8-1M3 14c4-5 6 5 10 0s6 3 8-1M3 20c4-5 6 5 10 0s6 3 8-1',
    palette: 'M12 3a9 9 0 1 0 0 18c1.4 0 2-1 1.6-2.2-.4-1.2.3-2.3 1.6-2.3H17a4 4 0 0 0 4-4c0-5-4-9.5-9-9.5zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
    pattern: 'M3 3h8v8H3zM13 13h8v8h-8zM13 3l4 8h-8zM7 13l4 4-4 4-4-4z',
    motion: 'M4 18a3 3 0 1 0 0-.01M20 6a3 3 0 1 0 0-.01M7 17c5-1 5-9 10-10',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4',
    spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
    heart: 'M12 20s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 5.8-8 11-8 11z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2',
    branch: 'M6 3v12M18 9a3 3 0 1 0 0-.01M6 21a3 3 0 1 0 0-.01M18 12c0 4-12 2-12 6'
  };
  var FILLED = { play: 1, pause: 1 };

  UI.iconSvg = function (name) {
    var d = ICONS[name] || ICONS.plus;
    var fill = FILLED[name] ? 'currentColor' : 'none';
    return '<svg viewBox="0 0 24 24" fill="' + fill + '" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>';
  };
  UI.icon = function (name, size) {
    var el = h('span', { class: 'ico', 'aria-hidden': 'true', html: UI.iconSvg(name) });
    if (size) { el.style.width = size + 'px'; el.style.height = size + 'px'; }
    return el;
  };

  /** ラベル付きボタン。opts: {kind:'primary'|'ghost'|'danger'|'', icon, title, onclick} */
  UI.button = function (label, opts) {
    opts = opts || {};
    var cls = 'btn' + (opts.kind ? ' btn-' + opts.kind : '') + (opts.small ? ' btn-sm' : '') + (opts.class ? ' ' + opts.class : '');
    var el = h('button', { type: 'button', class: cls, title: opts.title, 'aria-label': opts.aria || (label ? null : opts.title), onclick: opts.onclick, disabled: opts.disabled });
    if (opts.icon) el.appendChild(UI.icon(opts.icon));
    if (label) el.appendChild(h('span', { class: 'btn-label' }, label));
    return el;
  };
  UI.iconButton = function (icon, title, onclick, extraClass) {
    var el = h('button', { type: 'button', class: 'icon-btn' + (extraClass ? ' ' + extraClass : ''), title: title, 'aria-label': title, onclick: onclick });
    el.appendChild(UI.icon(icon));
    return el;
  };

  /* ---------- トースト ---------- */
  var toastRoot = null;
  function ensureToastRoot() {
    if (toastRoot && document.body.contains(toastRoot)) return toastRoot;
    toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastRoot);
    return toastRoot;
  }
  /** UI.toast('保存しました', {type:'ok'|'warn'|'error', duration:3200, action:{label, onClick}}) */
  UI.toast = function (message, opts) {
    opts = opts || {};
    var root = ensureToastRoot();
    var el = h('div', { class: 'toast toast-' + (opts.type || 'info') },
      h('span', { class: 'toast-msg' }, message));
    var timer = null;
    function dismiss() {
      clearTimeout(timer);
      if (!el.parentNode) return;
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }
    if (opts.action) {
      el.appendChild(h('button', {
        type: 'button', class: 'toast-action',
        onclick: function () { try { opts.action.onClick(); } finally { dismiss(); } }
      }, opts.action.label));
    }
    root.appendChild(el);
    while (root.children.length > 4) root.removeChild(root.firstChild);
    var duration = opts.duration === undefined ? 3200 : opts.duration;
    if (duration > 0) timer = setTimeout(dismiss, duration);
    return { dismiss: dismiss };
  };

  /* ---------- モーダル ---------- */
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  /**
   * UI.openModal({content: Node, className, label, initialFocus: Node|selector, dismissible})
   * 戻り値: { el, close(value), closed: Promise<value> }
   */
  UI.openModal = function (opts) {
    var previouslyFocused = document.activeElement;
    var resolveFn;
    var closed = new Promise(function (res) { resolveFn = res; });
    var isClosed = false;

    var dialog = h('div', { class: 'modal ' + (opts.className || ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label || null, tabindex: '-1' }, opts.content);
    var backdrop = h('div', { class: 'modal-backdrop' }, dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('modal-open');
    requestAnimationFrame(function () { backdrop.classList.add('in'); });

    function close(value) {
      if (isClosed) return;
      isClosed = true;
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('hashchange', onNav);
      backdrop.classList.remove('in');
      backdrop.classList.add('out');
      setTimeout(function () { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }, 180);
      if (!document.querySelector('.modal-backdrop:not(.out)')) document.body.classList.remove('modal-open');
      if (previouslyFocused && previouslyFocused.focus && document.contains(previouslyFocused)) {
        try { previouslyFocused.focus(); } catch (e) { /* noop */ }
      }
      resolveFn(value === undefined ? null : value);
    }

    // 画面遷移（戻る・リンク移動）ではモーダルも閉じる。背景が残って操作を塞がないように
    function onNav() { close(null); }
    window.addEventListener('hashchange', onNav);

    function onKey(e) {
      if (e.key === 'Escape' && opts.dismissible !== false) {
        e.stopPropagation();
        close(null);
      } else if (e.key === 'Tab') {
        var f = dialog.querySelectorAll(FOCUSABLE);
        if (!f.length) { e.preventDefault(); return; }
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);

    backdrop.addEventListener('mousedown', function (e) {
      if (e.target === backdrop && opts.dismissible !== false) close(null);
    });

    setTimeout(function () {
      var target = null;
      if (typeof opts.initialFocus === 'string') target = dialog.querySelector(opts.initialFocus);
      else if (opts.initialFocus instanceof Node) target = opts.initialFocus;
      if (!target) target = dialog.querySelector(FOCUSABLE);
      (target || dialog).focus();
    }, 30);

    return { el: dialog, close: close, closed: closed };
  };

  /** 確認ダイアログ。Promise<boolean> */
  UI.confirm = function (message, opts) {
    opts = opts || {};
    var cancelBtn, okBtn, m;
    cancelBtn = UI.button(opts.cancelText || 'キャンセル', { kind: 'ghost', onclick: function () { m.close(false); } });
    okBtn = UI.button(opts.okText || 'OK', { kind: opts.danger ? 'danger' : 'primary', onclick: function () { m.close(true); } });
    var content = h('div', { class: 'modal-inner' },
      h('h2', { class: 'modal-title' }, opts.title || '確認'),
      h('p', { class: 'modal-text' }, message),
      opts.detail ? h('p', { class: 'modal-sub' }, opts.detail) : null,
      h('div', { class: 'modal-actions' }, cancelBtn, okBtn));
    m = UI.openModal({ content: content, label: opts.title || '確認', initialFocus: opts.danger ? cancelBtn : okBtn });
    return m.closed.then(function (v) { return v === true; });
  };

  /** テキスト入力ダイアログ。Promise<string|null> */
  UI.promptText = function (opts) {
    opts = opts || {};
    var m;
    var input = h('input', { type: 'text', class: 'input', value: opts.value || '', maxlength: opts.maxLength || 80, 'aria-label': opts.label || opts.title || '入力', autocomplete: 'off' });
    function submit() {
      var v = input.value.trim();
      if (!v && !opts.allowEmpty) { input.focus(); return; }
      m.close(v);
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    var content = h('div', { class: 'modal-inner' },
      h('h2', { class: 'modal-title' }, opts.title || '入力'),
      opts.label ? h('label', { class: 'field-label' }, opts.label) : null,
      input,
      h('div', { class: 'modal-actions' },
        UI.button('キャンセル', { kind: 'ghost', onclick: function () { m.close(null); } }),
        UI.button(opts.okText || 'OK', { kind: 'primary', onclick: submit })));
    m = UI.openModal({ content: content, label: opts.title || '入力', initialFocus: input });
    setTimeout(function () { input.select(); }, 40);
    return m.closed;
  };

  /* ---------- 小さな部品 ---------- */
  UI.emptyState = function (title, text, actions) {
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-mark', 'aria-hidden': 'true' },
        h('span', { class: 'empty-ring' }), h('span', { class: 'empty-dot' })),
      h('h3', { class: 'empty-title' }, title),
      text ? h('p', { class: 'empty-text' }, text) : null,
      actions ? h('div', { class: 'empty-actions' }, actions) : null);
  };

  UI.sectionHead = function (code, title, aside) {
    return h('div', { class: 'section-head' },
      h('div', null,
        h('span', { class: 'section-code' }, code),
        h('h2', { class: 'section-title' }, title)),
      aside ? h('div', { class: 'section-aside' }, aside) : null);
  };
})();
