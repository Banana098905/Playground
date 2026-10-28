/*
 * Creation Engine — インタープリター（PZ.creation.Runtime）
 *
 * ブロックの木を直接たどって実行する「木構造インタープリター」です。
 *   - eval / new Function / 文字列の setTimeout は使いません（tests で確認）
 *   - 実行できるのは spec.js に登録されたブロックだけ（データには種別名と値しか入らない）
 *   - 実行前に必ず Cr.validate() を通し、通らなければ動かさない
 *   - 1回の動き（イベント1つ）につき、ブロック実行回数・描画回数・処理時間に上限がある
 *     超えたら「止めました」とエラーにして停止する（無限ループ・過剰な描画の対策）
 *
 * DOM に依存しません。描画先は Canvas 2D 互換の ctx を渡します（テストでは記録用の偽物）。
 *
 * 状態: idle → running ⇄ paused → stopped / finished(「ここで終了」) / error
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var Cr = (PZ.creation = PZ.creation || {});
  var U = PZ.util;
  var SPEC = Cr.SPEC;

  Cr.RUN_LIMITS = {
    maxSteps: 20000,   // 1回の動きで実行できるブロック数
    maxDraws: 3000,    // 1回の動きで描ける図形・文字の数
    maxMs: 40,         // 1回の動きに使える時間(ms)
    maxTickMs: 90,     // 1フレーム全体に使える時間(ms)
    maxRepeat: 10000,  // くりかえし1つの最大回数
    maxText: 200,      // 文字の最大長
    maxVars: 40,       // へんすうの最大数
    maxQueue: 20       // たまったクリックの最大数
  };

  function CreationError(message, blockId, kind) {
    this.name = 'CreationError';
    this.message = message;
    this.blockId = blockId || null;
    this.kind = kind || 'logic';
  }
  CreationError.prototype = Object.create(Error.prototype);
  Cr.CreationError = CreationError;

  function short(v) { var s = String(v); return s.length > 12 ? s.slice(0, 12) + '…' : s; }
  function fmt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
    if (typeof v === 'boolean') return v ? 'はい' : 'いいえ';
    return String(v);
  }
  Cr.formatValue = fmt;

  function defaultPen(W, H) { return { x: W / 2, y: H / 2, size: 40, color: '#b8ff3d', alpha: 1, angle: 0 }; }

  /**
   * creation: プログラム（検証されるのでそのまま渡してよい） / ctx: Canvas 2D 互換 / opts: { seed, limits, now, font }
   */
  function Runtime(creation, ctx, opts) {
    opts = opts || {};
    var v = Cr.validate(creation);
    this.program = v.clean;
    this.problems = v.ok ? null : v.errors;
    this.warnings = v.warnings;
    this.ctx = ctx || null;
    this.W = this.program.canvas.w;
    this.H = this.program.canvas.h;
    this.bg = this.program.canvas.bg;
    this.limits = Object.assign({}, Cr.RUN_LIMITS, opts.limits || {});
    this.now = opts.now || ((typeof performance !== 'undefined' && performance.now) ? function () { return performance.now(); } : Date.now);
    this.font = opts.font || 'sans-serif';
    this.seedOpt = opts.seed;
    this.SIG_STOP = { sig: 'stop' };
    this.SIG_RESET = { sig: 'reset' };
    this.byEvent = { onStart: [], onTick: [], onTimer: [], onClick: [], onMove: [] };
    this.program.scripts.forEach(function (s) { if (this.byEvent[s.type]) this.byEvent[s.type].push(s); }, this);
    this.state = 'idle';
    this.error = null;
    this._initState(true);
  }
  Cr.Runtime = Runtime;
  var P = Runtime.prototype;

  P._initState = function (full) {
    var self = this;
    if (full) {
      var seed = typeof this.seedOpt === 'number' ? this.seedOpt : Math.floor(Math.random() * 4294967296);
      this.rng = U.mulberry32(seed);
    }
    this.vars = new Map();
    this.program.vars.forEach(function (d) { self.vars.set(d.name, d.value); });
    this.time = 0;
    this.frame = 0;
    this.mouse = { x: this.W / 2, y: this.H / 2, down: false };
    this.queue = [];
    this.timers = this.byEvent.onTimer.map(function (s) { return { block: s, acc: 0 }; });
    this.pendingReset = false;
    this.steps = 0; this.draws = 0; this.t0 = 0; this.tickT0 = 0; this.cur = null;
    this.pen = defaultPen(this.W, this.H);
  };

  /* ---------- 公開API ---------- */
  /** 画面とへんすうを最初の状態に戻して、待機状態にする（まだ動かない） */
  P.reset = function () {
    this.state = 'idle'; this.error = null;
    this._initState(true);
    this.clearScreen(1);
  };

  /** 最初から実行する。検証に通らなければ動かさず false */
  P.start = function () {
    this.reset();
    if (this.problems) {
      var p = this.problems[0];
      this.state = 'error';
      this.error = { message: p.msg + (this.problems.length > 1 ? '（ほか ' + (this.problems.length - 1) + ' 件）' : ''), blockId: p.id, kind: 'invalid' };
      return false;
    }
    this.state = 'running';
    this.tickT0 = this.now();
    this._runStart();
    return this.state !== 'error';
  };

  P._runStart = function () {
    var list = this.byEvent.onStart;
    for (var i = 0; i < list.length && this.state === 'running'; i++) this.runHandler(list[i], true);
  };

  P.pause = function () { if (this.state === 'running') this.state = 'paused'; };
  P.resume = function () { if (this.state === 'paused') this.state = 'running'; };
  P.stop = function () { if (this.state === 'running' || this.state === 'paused') this.state = 'stopped'; };
  P.isActive = function () { return this.state === 'running' || this.state === 'paused'; };

  /** 1フレーム進める。dtMs は前回からの経過ミリ秒（大きすぎる値は丸める） */
  P.tick = function (dtMs) {
    if (this.state !== 'running') return;
    var dt = Math.min(Math.max(Number(dtMs) || 0, 0), 100) / 1000;
    this.time += dt;
    this.frame++;
    this.tickT0 = this.now();
    var q = this.queue; this.queue = [];
    for (var i = 0; i < q.length && this.state === 'running' && !this.pendingReset; i++) {
      this.runList(q[i] === 'click' ? this.byEvent.onClick : this.byEvent.onMove);
    }
    for (var t = 0; t < this.timers.length && this.state === 'running' && !this.pendingReset; t++) {
      var tm = this.timers[t], iv = Math.max(0.1, tm.block.in.sec);
      tm.acc += dt;
      if (tm.acc >= iv) { tm.acc = tm.acc > iv * 3 ? 0 : tm.acc - iv; this.runHandler(tm.block, false); }
    }
    if (this.state === 'running' && !this.pendingReset) this.runList(this.byEvent.onTick);
    if (this.pendingReset && this.state === 'running') this._doReset();
  };

  P._doReset = function () {
    this._initState(false);
    this.clearScreen(1);
    this.tickT0 = this.now();
    this._runStart();
  };

  /** 入力。kind: 'down' | 'up' | 'move' | 'leave'（座標は論理座標） */
  P.pointer = function (kind, x, y) {
    if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) {
      this.mouse.x = this.clamp(x, 0, this.W); this.mouse.y = this.clamp(y, 0, this.H);
    }
    if (kind === 'down') this.mouse.down = true;
    else if (kind === 'up' || kind === 'leave') this.mouse.down = false;
    if (this.state !== 'running') return;
    if (kind === 'down' && this.byEvent.onClick.length && this.queue.length < this.limits.maxQueue) this.queue.push('click');
    else if (kind === 'move' && this.byEvent.onMove.length && this.queue.indexOf('move') < 0) this.queue.push('move');
  };

  /** つまみ（へんすうの初期値）の変更を、動いている最中のへんすうにも反映する */
  P.setVarLive = function (name, value) { if (this.vars.has(name)) this.vars.set(name, value); };
  /** へんすうの今の値 [{name,value}]（画面表示用） */
  P.watch = function () {
    var out = [];
    this.vars.forEach(function (v, k) { out.push({ name: k, value: v }); });
    return out;
  };

  /* ---------- 実行の内部 ---------- */
  P.runList = function (list) {
    for (var i = 0; i < list.length && this.state === 'running'; i++) {
      this.runHandler(list[i], false);
      if (this.pendingReset) return;
    }
  };

  P.runHandler = function (script, inStart) {
    this.steps = 0; this.draws = 0; this.t0 = this.now();
    this.pen = defaultPen(this.W, this.H);
    var env = { loops: [], inStart: !!inStart };
    try {
      this.execList(script.body, env);
    } catch (e) {
      if (e === this.SIG_STOP) this.state = 'finished';
      else if (e === this.SIG_RESET) this.pendingReset = true;
      else if (e instanceof CreationError) { this.state = 'error'; this.error = { message: e.message, blockId: e.blockId, kind: e.kind }; }
      else {
        this.state = 'error';
        this.error = { message: '予期しないエラーで止まりました（' + ((e && e.message) || e) + '）', blockId: this.cur, kind: 'internal' };
        if (typeof console !== 'undefined' && console.error) console.error('[PZ creation]', e);
      }
    }
  };

  P.fail = function (b, msg, kind) { throw new CreationError(msg, (b && b.id) || this.cur, kind); };

  P.step = function (b) {
    this.cur = b.id;
    if (++this.steps > this.limits.maxSteps) {
      this.fail(b, '1回の動きでブロックを ' + this.limits.maxSteps + ' 回より多く実行したため止めました。くりかえしの回数を減らすか、中の処理を軽くしてください。', 'limit');
    }
    if ((this.steps & 63) === 0) {
      var n = this.now();
      if (n - this.t0 > this.limits.maxMs || n - this.tickT0 > this.limits.maxTickMs) {
        this.fail(b, '処理に時間がかかりすぎたため止めました。くりかえしの回数や描く数を減らしてください。', 'limit');
      }
    }
  };

  P.execList = function (list, env) {
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      this.step(b);
      SPEC[b.type].run(this, b, env);
    }
  };

  P.evalExpr = function (b, env) {
    this.step(b);
    return SPEC[b.type].eval(this, b, env);
  };

  /* ---------- 値の取り出しと型の確認（spec.js から使う） ---------- */
  P.arg = function (b, name, env) {
    var v = b.in[name];
    return (v !== null && typeof v === 'object') ? this.evalExpr(v, env) : v;
  };
  P.any = P.arg;
  P.num = function (b, name, env) {
    var v = this.arg(b, name, env);
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') { var t = v.trim(); if (t !== '' && isFinite(Number(t))) return Number(t); }
    return this.fail(b, '数が必要なところに「' + short(v) + '」が入っています。', 'type');
  };
  P.text = function (b, name, env) { return fmt(this.arg(b, name, env)).slice(0, this.limits.maxText); };
  P.bool = function (b, name, env) {
    var v = this.arg(b, name, env);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return this.fail(b, '「はい / いいえ」が必要なところに「' + short(v) + '」が入っています。', 'type');
  };
  P.color = function (b, name, env) {
    var v = this.arg(b, name, env);
    var c = Cr.cleanColor(v);
    if (!c) this.fail(b, '色として使えない値です（「' + short(v) + '」）。#ff8800 のような色か、「色相・彩度・明るさ」ブロックを使ってください。', 'type');
    return c;
  };
  P.finite = function (x, b) {
    if (typeof x !== 'number' || !isFinite(x)) this.fail(b, '計算結果が大きすぎるか、数になりません。', 'logic');
    return x;
  };
  P.clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };

  P.getVar = function (name, b) {
    if (!this.vars.has(name)) this.fail(b, 'へんすう「' + name + '」にまだ値が入っていません。「はじまったとき」で先に値を入れるか、へんすうの初期値を設定してください。', 'logic');
    return this.vars.get(name);
  };
  P.setVar = function (name, v, b) {
    if (!this.vars.has(name) && this.vars.size >= this.limits.maxVars) this.fail(b, 'へんすうは ' + this.limits.maxVars + ' 個までです。', 'limit');
    if (typeof v === 'string') v = v.slice(0, this.limits.maxText);
    else if (typeof v === 'number') this.finite(v, b);
    this.vars.set(name, v);
  };

  /* ---------- 描画 ---------- */
  P.clearScreen = function (alpha) {
    var c = this.ctx;
    if (!c) return;
    c.save();
    c.globalAlpha = alpha;
    c.fillStyle = this.bg;
    c.fillRect(0, 0, this.W, this.H);
    c.restore();
  };

  P._countDraw = function (b) {
    if (++this.draws > this.limits.maxDraws) this.fail(b, '1回の動きで描ける数（' + this.limits.maxDraws + ' 個）を超えたため止めました。描く数を減らしてください。', 'limit');
  };

  P.drawShape = function (shape, b) {
    this._countDraw(b);
    var c = this.ctx, p = this.pen;
    if (!c) return;
    var s = p.size, r = s / 2;
    c.save();
    c.globalAlpha = p.alpha;
    c.fillStyle = p.color; c.strokeStyle = p.color;
    c.translate(p.x, p.y);
    if (p.angle) c.rotate(p.angle * Math.PI / 180);
    if (shape === 'circle') { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); }
    else if (shape === 'square') { c.fillRect(-r, -r, s, s); }
    else if (shape === 'triangle') { c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 0.92, r * 0.78); c.lineTo(-r * 0.92, r * 0.78); c.closePath(); c.fill(); }
    else if (shape === 'star') {
      c.beginPath();
      for (var i = 0; i < 10; i++) {
        var rad = i % 2 === 0 ? r : r * 0.45, a = -Math.PI / 2 + i * Math.PI / 5;
        if (i === 0) c.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); else c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      c.closePath(); c.fill();
    } else { // line: 長さ=大きさ。太さは大きさに応じる
      c.lineWidth = Math.max(1.5, s / 14); c.lineCap = 'round';
      c.beginPath(); c.moveTo(-r, 0); c.lineTo(r, 0); c.stroke();
    }
    c.restore();
  };

  P.drawText = function (str, b) {
    this._countDraw(b);
    var c = this.ctx, p = this.pen;
    if (!c) return;
    c.save();
    c.globalAlpha = p.alpha;
    c.fillStyle = p.color;
    c.font = '700 ' + Math.max(6, Math.round(p.size)) + 'px ' + this.font;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.translate(p.x, p.y);
    if (p.angle) c.rotate(p.angle * Math.PI / 180);
    c.fillText(str, 0, 0);
    c.restore();
  };

  /**
   * 画面を使わずに（または オフスクリーン canvas で）一定フレームだけ進めて結果を得る。
   * サムネイル作成・テストで使う。戻り値: Runtime
   */
  Cr.runHeadless = function (creation, ctx, o) {
    o = o || {};
    var rt = new Runtime(creation, ctx, { seed: o.seed === undefined ? 1 : o.seed, limits: o.limits, now: o.now, font: o.font });
    rt.start();
    var frames = o.frames === undefined ? 30 : o.frames;
    for (var i = 0; i < frames && rt.state === 'running'; i++) {
      if (o.pointer && o.pointer[i]) { var pe = o.pointer[i]; rt.pointer(pe[0], pe[1], pe[2]); }
      rt.tick(o.dt || 16.7);
    }
    return rt;
  };
})();
