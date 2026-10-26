/*
 * 共通ユーティリティ（DOM生成・日付・乱数など）
 * ユーザー入力は必ず textContent 経由で描画する（XSS対策）。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = (PZ.util = {});

  /** hyperscript 風の要素生成: h('div', {class:'x', onclick:fn}, 'text', child) */
  U.h = function (tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v; // 定数文字列専用
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) U.append(el, arguments[i]);
    return el;
  };

  U.append = function (parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { U.append(parent, c); }); return; }
    if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  };

  U.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); };

  U.clamp = function (v, min, max) { return Math.min(max, Math.max(min, v)); };
  U.num = function (v, fallback) { v = Number(v); return isFinite(v) ? v : fallback; };
  U.round = function (v, d) { var m = Math.pow(10, d || 0); return Math.round(v * m) / m; };
  U.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  U.uid = function () {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };
  U.oid = function () { return 'o_' + Math.random().toString(36).slice(2, 10); };

  U.debounce = function (fn, wait) {
    var t = null;
    function d() {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, wait);
    }
    d.cancel = function () { clearTimeout(t); t = null; };
    d.flush = function () { if (t !== null) { clearTimeout(t); t = null; fn(); } };
    d.pending = function () { return t !== null; };
    return d;
  };

  U.rafThrottle = function (fn) {
    var queued = false, lastArgs;
    return function () {
      lastArgs = arguments;
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; fn.apply(null, lastArgs); });
    };
  };

  /* ---------- 乱数（シード固定で再現可能） ---------- */
  U.mulberry32 = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.randomSeed = function () { return Math.floor(Math.random() * 1000000); };

  /* ---------- 日付 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  U.fmtDate = function (ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  U.relTime = function (ts, now) {
    if (!ts) return '';
    var diff = ((now || Date.now()) - ts) / 1000;
    if (diff < 45) return 'たった今';
    if (diff < 3600) return Math.round(diff / 60) + '分前';
    if (diff < 86400) return Math.round(diff / 3600) + '時間前';
    if (diff < 86400 * 2) return '昨日';
    if (diff < 86400 * 30) return Math.round(diff / 86400) + '日前';
    return '';
  };
  U.dayOfYear = function (date) {
    var d = date || new Date();
    var start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);
  };

  /* ---------- 色 ---------- */
  U.isHex = function (s) { return typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s); };
  U.normHex = function (s, fallback) {
    if (!U.isHex(s)) return fallback;
    if (s.length === 4) return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    return s.toLowerCase();
  };
  U.hsl = function (h, s, l) { return 'hsl(' + Math.round(h) + ',' + Math.round(s) + '%,' + Math.round(l) + '%)'; };
  U.hslToHex = function (h, s, l) {
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
    var x = function (v) { var h2 = Math.round(v * 255).toString(16); return h2.length < 2 ? '0' + h2 : h2; };
    return '#' + x(f(0)) + x(f(8)) + x(f(4));
  };
  U.mixHex = function (a, b, t) {
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
    var g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
    var bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  };


  /* ---------- ハッシュ・シード（座標や文字列から再現可能な乱数を作る） ---------- */
  /** 文字列/数値の並びから 32bit ハッシュ */
  U.hash32 = function () {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < arguments.length; i++) {
      var s = String(arguments[i]);
      for (var j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 16777619) >>> 0; }
      h ^= 0x9e; h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
    return h >>> 0;
  };
  /** 0〜1 の再現可能な値 */
  U.hashRand = function () { return U.hash32.apply(null, arguments) / 4294967296; };

  /** スマホ相当の画面か（重い処理の上限を下げる判断用） */
  U.isSmallScreen = function () {
    try { return window.matchMedia('(max-width: 720px)').matches; } catch (e) { return false; }
  };

  /** クリップボードへコピー。成功で true */
  U.copyText = function (text) {
    function legacy() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;left:-999px;top:0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(); });
    }
    return Promise.resolve(legacy());
  };

  /** 色の相対輝度（0〜1）。文字色の自動選択に使う */
  U.luminance = function (hex) {
    var n = parseInt(String(hex).slice(1), 16) || 0;
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
  };
  U.inkFor = function (hex) { return U.luminance(hex) > 0.42 ? '#10131a' : '#f4f6fa'; };
  U.hexToHsl = function (hex) {
    var n = parseInt(String(hex).slice(1), 16) || 0;
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, s = 0, hh = 0, d = max - min;
    if (d > 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) hh = ((g - b) / d) % 6; else if (max === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4;
      hh *= 60; if (hh < 0) hh += 360;
    }
    return { h: hh, s: s * 100, l: l * 100 };
  };

  /* ---------- URL クエリ ---------- */
  U.parseQuery = function (qs) {
    var out = {};
    if (!qs) return out;
    qs.replace(/^\?/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
      var v = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
      out[k] = v;
    });
    return out;
  };
  U.buildQuery = function (obj) {
    return Object.keys(obj).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
    }).join('&');
  };

  U.safeFileName = function (name, ext) {
    var base = String(name || 'playground-zero').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
    return (base || 'playground-zero').slice(0, 60) + (ext || '');
  };

  U.download = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  };

  U.prefersReducedMotion = function () {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };
})();
