/*
 * Creation Engine — プログラム（ブロック構成）の形式・検証・操作ヘルパー（PZ.creation）
 *
 * プログラムのデータ形式（creation）:
 *   { v:1, description, origin, canvas:{w,h,bg}, vars:[{name,value,tune?}], scripts:[ イベントブロック… ] }
 * ブロック:  { id, type, in:{ 入力欄名: 値 | 値ブロック }, [bodies…: ブロック配列] }
 *
 * validate() は「入力は信用しない」の中心。保存データ・インポート・実行の前に必ず通す。
 *   - 許可されたブロック種別だけを受け付ける（不明な種別・置けない場所はエラー）
 *   - 値の型・範囲・長さ、入れ子の深さ、ブロック総数を制限する
 *   - 返す clean は、仕様にある項目だけを新しく組み立てたコピー（余計なキーは捨てる）
 * lenient:true は保存データ読み込み用。エラーがあっても内容を捨てず、未対応ブロックは
 * 「unknown」の目印として残す（ユーザーのデータを黙って消さないため）。実行は ok:true のときだけ。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var Cr = (PZ.creation = PZ.creation || {});
  var SPEC = Cr.SPEC;

  Cr.FORMAT = 1;
  var L = (Cr.LIMITS = {
    blocks: 400, scripts: 30, depth: 8, exprDepth: 8, body: 200, vars: 40,
    nameLen: 20, text: 200, desc: 300, bytes: 300000, fileBytes: 2 * 1024 * 1024,
    canvasMin: 200, canvasMax: 1600, number: 1e9
  });
  Cr.DEFAULT_CANVAS = { w: 800, h: 500, bg: '#101215' };

  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var VAR_RE = /^[^\u0000-\u001f\s"'<>&\\`]{1,20}$/;
  var ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
  var HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  var HSL_RE = /^hsl\(\d{1,3},\d{1,3}%,\d{1,3}%\)$/;

  Cr.isVarName = function (s) { return typeof s === 'string' && VAR_RE.test(s); };
  /** 実行時に使える色（#rgb / #rrggbb / 計算ブロックが作る hsl()）。使えなければ null */
  Cr.cleanColor = function (s) {
    if (typeof s !== 'string') return null;
    if (HEX_RE.test(s)) return s.length === 4 ? ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase() : s.toLowerCase();
    if (HSL_RE.test(s)) return s;
    return null;
  };
  /** 入力欄に打った文字を 数・はい/いいえ・文字 に読み分ける（型が any の欄用） */
  Cr.parseAny = function (str) {
    var t = String(str).trim();
    if (/^-?\d+(\.\d+)?$/.test(t) && isFinite(Number(t))) return Number(t);
    if (t === 'true') return true;
    if (t === 'false') return false;
    return String(str).slice(0, L.text);
  };

  Cr.newId = function () { return 'b' + Math.random().toString(36).slice(2, 8); };

  Cr.blank = function () {
    return { v: Cr.FORMAT, description: '', origin: '', canvas: { w: Cr.DEFAULT_CANVAS.w, h: Cr.DEFAULT_CANVAS.h, bg: Cr.DEFAULT_CANVAS.bg }, vars: [], scripts: [] };
  };

  /** 新しいブロックを仕様の初期値で作る */
  Cr.makeBlock = function (type, inputs) {
    var spec = SPEC[type];
    if (!spec) throw new Error('未対応のブロック: ' + type);
    var b = { id: Cr.newId(), type: type, in: {} };
    Object.keys(spec.slots).forEach(function (k) { b.in[k] = spec.slots[k].def; });
    if (inputs) Object.keys(inputs).forEach(function (k) { if (own(b.in, k)) b.in[k] = inputs[k]; });
    spec.bodies.forEach(function (bn) { b[bn] = []; });
    return b;
  };

  /** ブロックの深いコピー（中身のブロックも含め、ID を振り直す） */
  Cr.cloneBlock = function (b) {
    var c = JSON.parse(JSON.stringify(b));
    (function reid(x) {
      x.id = Cr.newId();
      Object.keys(x.in || {}).forEach(function (k) { if (x.in[k] && typeof x.in[k] === 'object') reid(x.in[k]); });
      var spec = SPEC[x.type];
      if (spec) spec.bodies.forEach(function (bn) { (x[bn] || []).forEach(reid); });
    })(c);
    return c;
  };

  /* ---------- 走査 ---------- */
  /** すべてのブロックを順に fn(block, parent, where) へ。where は {script|body,slot,index} */
  Cr.walk = function (creation, fn) {
    function visit(b, parent, where) {
      fn(b, parent, where);
      var spec = SPEC[b.type];
      if (!spec) return;
      Object.keys(spec.slots).forEach(function (k) {
        var v = b.in && b.in[k];
        if (v && typeof v === 'object') visit(v, b, { slot: k });
      });
      spec.bodies.forEach(function (bn) { (b[bn] || []).forEach(function (c, i) { visit(c, b, { body: bn, index: i }); }); });
    }
    (creation.scripts || []).forEach(function (s, i) { visit(s, null, { script: true, index: i }); });
  };

  /** ID からブロックと置かれている場所を探す。見つからなければ null */
  Cr.find = function (creation, id) {
    var hit = null;
    Cr.walk(creation, function (b, parent, where) { if (!hit && b.id === id) hit = { block: b, parent: parent, where: where }; });
    return hit;
  };
  /** 場所(where)から、その並び（配列）を返す */
  Cr.listOf = function (creation, parent, where) {
    if (where.script) return creation.scripts;
    return parent[where.body];
  };

  Cr.stats = function (creation) {
    var st = { blocks: 0, scripts: (creation.scripts || []).length, vars: (creation.vars || []).length, types: {} };
    Cr.walk(creation, function (b) { st.blocks++; st.types[b.type] = (st.types[b.type] || 0) + 1; });
    return st;
  };

  /* ---------- 検証 ---------- */
  function Ctx(lenient) {
    this.lenient = lenient;
    this.errors = [];
    this.warnings = [];
    this.count = 0;
    this.ids = Object.create(null);
    this.limitHit = false;
    this.reads = [];
    this.sets = Object.create(null);
  }
  Ctx.prototype.err = function (id, msg) { if (this.errors.length < 200) this.errors.push({ id: id || null, msg: msg }); };
  Ctx.prototype.warn = function (id, msg) { if (this.warnings.length < 200) this.warnings.push({ id: id || null, msg: msg }); };
  Ctx.prototype.takeId = function (raw) {
    var id = typeof raw === 'string' && ID_RE.test(raw) && !this.ids[raw] ? raw : null;
    while (!id || this.ids[id]) id = Cr.newId();
    this.ids[id] = true;
    return id;
  };

  function slotLabel(spec, name) {
    return spec.name + (Object.keys(spec.slots).length > 1 ? '（' + name + '）' : '');
  }

  function cleanLiteral(ctx, spec, name, s, v, id) {
    var where = '「' + spec.name + '」の入力欄';
    switch (s.t) {
      case 'num':
        if (typeof v === 'number' && isFinite(v)) {
          var c = Math.max(s.min, Math.min(s.max, v));
          if (c !== v) ctx.warn(id, where + 'の値 ' + v + ' は範囲外のため ' + c + ' に直しました。');
          return c;
        }
        ctx.err(id, where + 'には数を入れてください。');
        return s.def;
      case 'text':
        if (typeof v === 'string') return v.slice(0, s.max || L.text);
        ctx.err(id, where + 'には文字を入れてください。');
        return s.def;
      case 'color': {
        var col = typeof v === 'string' && HEX_RE.test(v) ? Cr.cleanColor(v) : null;
        if (col) return col;
        ctx.err(id, where + 'の色は #rrggbb の形で指定してください。');
        return s.def;
      }
      case 'bool':
        if (typeof v === 'boolean') return v;
        ctx.err(id, where + 'には「はい / いいえ」を入れてください。');
        return s.def;
      case 'any':
        if (typeof v === 'number' && isFinite(v)) return Math.max(-L.number, Math.min(L.number, v));
        if (typeof v === 'boolean') return v;
        if (typeof v === 'string') return v.slice(0, L.text);
        ctx.err(id, where + 'の値が正しくありません。');
        return s.def;
      case 'var':
        if (v === '' || Cr.isVarName(v)) return v;
        ctx.err(id, where + 'のへんすう名が正しくありません（20文字まで、空白や記号 " \' < > & \\ は使えません）。');
        return s.def;
      case 'enum': {
        var okOpt = typeof v === 'string' && s.options.some(function (o) { return o[0] === v; });
        if (okOpt) return v;
        ctx.err(id, where + 'の選択肢が正しくありません。');
        return s.def;
      }
    }
    return s.def;
  }

  function placeholder(ctx, id, was) {
    ctx.count++;
    return { id: id, type: 'unknown', in: {}, was: String(was || '').slice(0, 30) };
  }

  /** want: 'event' | 'stmt' | 'expr'。不正なら null（lenient のときは unknown の目印を返す） */
  function cleanBlock(ctx, raw, want, slotT, depth, inRepeat, edepth) {
    if (ctx.count >= L.blocks) {
      if (!ctx.limitHit) { ctx.limitHit = true; ctx.err(null, 'ブロックが多すぎます（' + L.blocks + ' 個まで）。'); }
      return null;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { ctx.err(null, 'ブロックの形式が正しくありません。'); return null; }
    var type = typeof raw.type === 'string' ? raw.type : '';
    var id = ctx.takeId(raw.id);
    if (!Cr.has(type)) {
      ctx.err(id, '未対応のブロック「' + type.slice(0, 30) + '」が含まれています。');
      return ctx.lenient ? placeholder(ctx, id, type) : null;
    }
    if (type === 'unknown') {
      ctx.err(id, '未対応のブロックが含まれています。');
      return ctx.lenient ? placeholder(ctx, id, raw.was) : null;
    }
    var spec = SPEC[type];
    if (spec.kind !== want) {
      ctx.err(id, '「' + spec.name + '」はここには置けません。');
      return ctx.lenient ? placeholder(ctx, id, type) : null;
    }
    ctx.count++;
    var out = { id: id, type: type, in: {} };
    var hasIn = raw.in && typeof raw.in === 'object' && !Array.isArray(raw.in);

    Object.keys(spec.slots).forEach(function (name) {
      var s = spec.slots[name];
      var v = hasIn && own(raw.in, name) ? raw.in[name] : undefined;
      if (v === undefined) { out.in[name] = s.def; return; }
      if (v && typeof v === 'object') {
        if (s.t === 'var' || s.t === 'enum') { ctx.err(id, '「' + slotLabel(spec, name) + '」には値ブロックを入れられません。'); out.in[name] = s.def; return; }
        if (edepth >= L.exprDepth) { ctx.err(id, '値ブロックの入れ子が深すぎます（' + L.exprDepth + ' 段まで）。'); out.in[name] = s.def; return; }
        var e = cleanBlock(ctx, v, 'expr', s.t, depth, inRepeat, edepth + 1);
        if (e && e.type !== 'unknown' && !Cr.ACCEPT[s.t][SPEC[e.type].out]) {
          ctx.err(e.id, '「' + SPEC[e.type].name + '」は「' + spec.name + '」のこの入力欄には入りません（型が合いません）。');
          if (!ctx.lenient) e = null;
        }
        out.in[name] = e || s.def;
        return;
      }
      out.in[name] = cleanLiteral(ctx, spec, name, s, v, id);
    });

    if (type === 'set' || type === 'change') {
      if (!out.in.name) ctx.err(id, '「' + spec.name + '」のへんすうを選んでください。');
      else ctx.sets[out.in.name] = true;
    }
    if (type === 'var') {
      if (!out.in.name) ctx.err(id, '「へんすうの値」のへんすうを選んでください。');
      else ctx.reads.push({ id: id, name: out.in.name });
    }
    if (type === 'loopIndex' && !inRepeat) ctx.warn(id, '「くりかえし番号」は「くりかえす」の中でだけ使えます。');
    if (type === 'repeat' && typeof out.in.times === 'number' && out.in.times > 2000) ctx.warn(id, 'くりかえしの回数が多めです（' + out.in.times + ' 回）。重いと途中で止まります。');

    spec.bodies.forEach(function (bn) {
      var list = own(raw, bn) ? raw[bn] : undefined;
      var arr = [];
      if (list !== undefined) {
        if (!Array.isArray(list)) ctx.err(id, 'ブロックの並びの形式が正しくありません。');
        else if (depth + 1 > L.depth) { if (list.length) ctx.err(id, 'ブロックの入れ子が深すぎます（' + L.depth + ' 段まで）。'); }
        else {
          if (list.length > L.body) { ctx.err(id, '1つの並びに置けるブロックは ' + L.body + ' 個までです。'); list = list.slice(0, L.body); }
          list.forEach(function (r) {
            var c = cleanBlock(ctx, r, 'stmt', null, depth + 1, inRepeat || type === 'repeat', 0);
            if (c) arr.push(c);
          });
        }
      }
      out[bn] = arr;
    });
    return out;
  }

  function cleanVars(ctx, raw) {
    var out = [];
    if (raw === undefined) return out;
    if (!Array.isArray(raw)) { ctx.err(null, 'へんすう一覧の形式が正しくありません。'); return out; }
    if (raw.length > L.vars) ctx.err(null, 'へんすうは ' + L.vars + ' 個までです。');
    var seen = Object.create(null);
    raw.slice(0, L.vars).forEach(function (r) {
      if (!r || typeof r !== 'object' || !Cr.isVarName(r.name)) { ctx.err(null, 'へんすう名が正しくありません。'); return; }
      if (seen[r.name]) { ctx.err(null, 'へんすう「' + r.name + '」が重複しています。'); return; }
      seen[r.name] = true;
      var value = r.value;
      if (typeof value === 'number' && isFinite(value)) value = Math.max(-L.number, Math.min(L.number, value));
      else if (typeof value === 'string') value = value.slice(0, L.text);
      else if (typeof value !== 'boolean') { ctx.err(null, 'へんすう「' + r.name + '」の初期値が正しくありません。'); value = 0; }
      var v = { name: r.name, value: value };
      if (r.tune && typeof r.tune === 'object') {
        var mn = r.tune.min, mx = r.tune.max, st = r.tune.step;
        if (typeof value === 'number' && typeof mn === 'number' && typeof mx === 'number' && isFinite(mn) && isFinite(mx) && mn < mx) {
          v.tune = { min: Math.max(-L.number, mn), max: Math.min(L.number, mx), step: (typeof st === 'number' && isFinite(st) && st > 0) ? st : 1 };
        } else ctx.warn(null, 'へんすう「' + r.name + '」の「つまみ」設定が正しくないため外しました。');
      }
      out.push(v);
    });
    return out;
  }

  /**
   * 検証して安全なコピーを返す。
   * 戻り値: { ok, errors:[{id,msg}], warnings:[{id,msg}], clean, stats }
   */
  Cr.validate = function (raw, opts) {
    var lenient = !!(opts && opts.lenient);
    var ctx = new Ctx(lenient);
    var clean = Cr.blank();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      ctx.err(null, 'ブロックの構成（creation）が見つかりません。');
      return { ok: false, errors: ctx.errors, warnings: ctx.warnings, clean: clean, stats: Cr.stats(clean) };
    }
    if (raw.v !== undefined) {
      if (typeof raw.v !== 'number' || Math.floor(raw.v) !== raw.v || raw.v < 1) ctx.err(null, 'データ形式のバージョンが正しくありません。');
      else if (raw.v > Cr.FORMAT) (lenient ? ctx.warn : ctx.err).call(ctx, null, 'このアプリより新しい形式（v' + raw.v + '）のデータです。アプリを更新してください。');
    }
    clean.description = typeof raw.description === 'string' ? raw.description.slice(0, L.desc) : '';
    clean.origin = typeof raw.origin === 'string' && /^[A-Za-z0-9:_-]{0,60}$/.test(raw.origin) ? raw.origin : '';
    var cv = raw.canvas && typeof raw.canvas === 'object' ? raw.canvas : {};
    function dim(v, def) { return (typeof v === 'number' && isFinite(v)) ? Math.round(Math.max(L.canvasMin, Math.min(L.canvasMax, v))) : def; }
    clean.canvas = { w: dim(cv.w, Cr.DEFAULT_CANVAS.w), h: dim(cv.h, Cr.DEFAULT_CANVAS.h), bg: HEX_RE.test(cv.bg || '') ? Cr.cleanColor(cv.bg) : Cr.DEFAULT_CANVAS.bg };

    clean.vars = cleanVars(ctx, raw.vars);

    if (raw.scripts !== undefined && !Array.isArray(raw.scripts)) ctx.err(null, 'スクリプト一覧の形式が正しくありません。');
    else {
      var scripts = raw.scripts || [];
      if (scripts.length > L.scripts) ctx.err(null, 'スクリプト（イベント）は ' + L.scripts + ' 個までです。');
      scripts.slice(0, L.scripts).forEach(function (r) {
        var b = cleanBlock(ctx, r, 'event', null, 0, false, 0);
        if (b) clean.scripts.push(b);
      });
    }

    // 変数の使い方の確認（警告）
    var declared = Object.create(null);
    clean.vars.forEach(function (v) { declared[v.name] = true; });
    var warned = Object.create(null);
    ctx.reads.forEach(function (r) {
      if (!declared[r.name] && !ctx.sets[r.name] && !warned[r.name]) {
        warned[r.name] = true;
        ctx.warn(r.id, 'へんすう「' + r.name + '」に値を入れるブロックも初期値もありません。実行するとエラーになります。');
      }
    });
    if (!clean.scripts.length) ctx.warn(null, 'まだブロックがありません。「はじまったとき」などのイベントから始めましょう。');

    try { if (JSON.stringify(clean).length > L.bytes) ctx.err(null, 'データが大きすぎます。'); } catch (e) { ctx.err(null, 'データを読み取れません。'); }

    return { ok: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings, clean: clean, stats: Cr.stats(clean) };
  };

  /** 保存データ用: 壊れていても可能な限り内容を残して安全な形にする */
  Cr.sanitize = function (raw) {
    return Cr.validate(raw, { lenient: true }).clean;
  };

  /** ブロックの説明用の短い文字列（エラー表示など） */
  Cr.blockName = function (b) {
    var s = b && SPEC[b.type];
    return s ? s.name : '不明なブロック';
  };
})();
