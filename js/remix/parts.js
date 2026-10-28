/*
 * Remix Engine — 再利用部品と組み合わせ（PZ.remix.parts）
 *
 * 「部品」= 便利なブロックの組み合わせに、名前・説明・入力・出力・必要なへんすう・バージョンを付けたもの。
 * 部品の中身は普通のブロック（spec.js の許可リストにあるものだけ）なので、新しい実行の仕組みは要りません。
 * 保存・読み込みのたびに sanitize() で検証し、入力・出力・必要なへんすうは「ブロックの中身から」毎回計算し直します
 * （ファイルに嘘が書かれていても、実際の中身とずれません）。
 *
 * 部品のデータ（format 1）:
 *   { id, v:1, name, description, kind:'event'|'stmt', version, createdAt, updatedAt, tags[],
 *     blocks:[…], vars:[{name,value,tune?}],             // この部品が持つ（自分で値を入れる）へんすう
 *     params:[{key,label,blockId,slot}],                 // 挿入時に変えられる設定値（ブロックの入力欄に対応）
 *     canvas:{w,h}?                                      // 作られたときのキャンバス（座標の前提）
 *   }
 *   計算される項目: needs（作品側に必要なへんすう）/ provides（他のブロックから読める出力）/ types
 *
 * insert() / fromWork() はどちらも「入力を変更しない」純粋な関数で、成功したときだけ新しい構成を返します。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var Cr = PZ.creation;
  var SPEC = Cr.SPEC;
  var R = (PZ.remix = PZ.remix || {});
  var P = (R.parts = {});
  var J = function (x) { return JSON.parse(JSON.stringify(x)); };
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  P.FORMAT = 1;
  P.LIMITS = { blocks: 200, vars: 12, params: 12, name: 40, desc: 200, bytes: 60000, tags: 6 };

  var ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
  var KEY_RE = /^[a-z][a-z0-9_]{0,11}$/;
  var TYPE_OF_OUT = { num: 'num', text: 'text', color: 'text', bool: 'bool', any: 'any' };

  function newMap() { return Object.create(null); }
  P.newId = function () { return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };

  function typeOfValue(v) { return typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : 'text'; }
  function defaultFor(type) { return type === 'text' ? '' : type === 'bool' ? false : 0; }
  function mergeType(map, name, t) {
    if (!t) return;
    if (!map[name]) map[name] = t;
    else if (map[name] !== t) map[name] = 'any';
  }
  /** 部品が求める型(need) と、作品側のへんすうの型(have)がぶつからないか。どちらかが any/不明なら通す */
  function compatible(need, have) { return !need || !have || need === 'any' || have === 'any' || need === have; }
  var TYPE_JA = { num: '数', text: '文字', bool: 'はい/いいえ', any: 'なんでも' };

  /* =============== へんすうの使われ方 =============== */
  /**
   * ブロックの並び（blocks）を調べる。
   *  sets/changes/reads: へんすう名の集合 / req: 読み取り側が求める型 / put: 値を入れる側の型
   */
  P.analyze = function (blocks) {
    var a = { sets: newMap(), changes: newMap(), reads: newMap(), req: newMap(), put: newMap(), order: [] };
    function seen(n) { if (a.order.indexOf(n) < 0) a.order.push(n); }
    Cr.walk({ scripts: blocks }, function (b, parent, where) {
      if (!b.in) return;
      if (b.type === 'set' && b.in.name) {
        a.sets[b.in.name] = 1; seen(b.in.name);
        var v = b.in.value;
        if (v && typeof v === 'object') mergeType(a.put, b.in.name, Cr.has(v.type) ? TYPE_OF_OUT[SPEC[v.type].out] : 'any');
        else mergeType(a.put, b.in.name, typeOfValue(v));
      } else if (b.type === 'change' && b.in.name) {
        a.changes[b.in.name] = 1; seen(b.in.name);
        mergeType(a.req, b.in.name, 'num'); mergeType(a.put, b.in.name, 'num');
      } else if (b.type === 'var' && b.in.name) {
        a.reads[b.in.name] = 1; seen(b.in.name);
        var t = 'any';
        if (parent && where && where.slot && Cr.has(parent.type)) {
          var st = SPEC[parent.type].slots[where.slot];
          if (st && (st.t === 'num' || st.t === 'bool')) t = st.t;
          else if (st && st.t === 'text') t = 'any'; // 文字の欄には何でも入るので、型の縛りにしない
        }
        mergeType(a.req, b.in.name, t);
      }
    });
    return a;
  };

  /** 作品（構成）の中のへんすうの型 { 名前: 'num'|'text'|'bool'|'any' }。宣言された値の型を優先する */
  P.varTypes = function (creation) {
    var types = newMap();
    var a = P.analyze(creation.scripts || []);
    Object.keys(a.put).forEach(function (n) { types[n] = a.put[n]; });
    (creation.vars || []).forEach(function (v) { types[v.name] = typeOfValue(v.value); });
    Object.keys(a.reads).forEach(function (n) { if (!types[n]) types[n] = 'any'; });
    return types;
  };

  /** 作品で使われている（宣言・値を入れる・読む）へんすう名の集合 */
  P.usedNames = function (creation) {
    var used = newMap();
    (creation.vars || []).forEach(function (v) { used[v.name] = 1; });
    var a = P.analyze(creation.scripts || []);
    ['sets', 'changes', 'reads'].forEach(function (k) { Object.keys(a[k]).forEach(function (n) { used[n] = 1; }); });
    return used;
  };

  /* =============== 部品の組み立て・検証 =============== */
  function cleanVarDecls(raw, errors) {
    var out = [], seen = newMap();
    if (!Array.isArray(raw)) return out;
    raw.slice(0, P.LIMITS.vars).forEach(function (r) {
      if (!r || typeof r !== 'object' || !Cr.isVarName(r.name) || seen[r.name]) return;
      var value = r.value;
      if (typeof value === 'number' && isFinite(value)) value = Math.max(-Cr.LIMITS.number, Math.min(Cr.LIMITS.number, value));
      else if (typeof value === 'string') value = value.slice(0, Cr.LIMITS.text);
      else if (typeof value !== 'boolean') value = 0;
      var v = { name: r.name, value: value };
      if (r.tune && typeof r.tune === 'object' && typeof value === 'number' && typeof r.tune.min === 'number' && typeof r.tune.max === 'number' &&
        isFinite(r.tune.min) && isFinite(r.tune.max) && r.tune.min < r.tune.max) {
        v.tune = { min: r.tune.min, max: r.tune.max, step: (typeof r.tune.step === 'number' && r.tune.step > 0 && isFinite(r.tune.step)) ? r.tune.step : 1 };
      }
      seen[r.name] = 1; out.push(v);
    });
    return out;
  }

  /** 設定値にできる入力欄（数・色・はい/いいえ・選択肢・文字）の候補。{blockId, slot, type, label, def, min, max, options} */
  P.paramCandidates = function (blocks) {
    var out = [];
    Cr.walk({ scripts: blocks }, function (b) {
      if (!Cr.has(b.type) || b.type === 'unknown' || !b.in) return;
      var spec = SPEC[b.type];
      Object.keys(spec.slots).forEach(function (k) {
        var s = spec.slots[k], v = b.in[k];
        if (v && typeof v === 'object') return;
        if (s.t === 'var') return;
        if (b.type === 'note') return;
        var c = { blockId: b.id, slot: k, type: s.t === 'any' ? typeOfValue(v) : s.t, label: spec.name + '（' + k + '）', def: v };
        if (s.t === 'num') { c.min = s.min; c.max = s.max; }
        if (s.t === 'enum') c.options = s.options.map(function (o) { return [o[0], o[1]]; });
        out.push(c);
      });
    });
    return out;
  };

  function findLiteral(blocks, blockId, slot) {
    var hit = null;
    Cr.walk({ scripts: blocks }, function (b) {
      if (!hit && b.id === blockId && Cr.has(b.type) && b.in && own(SPEC[b.type].slots, slot)) hit = b;
    });
    if (!hit) return null;
    var v = hit.in[slot];
    if (v && typeof v === 'object') return null;
    return { block: hit, spec: SPEC[hit.type], slot: SPEC[hit.type].slots[slot], value: v };
  }

  /**
   * 部品データを検証して、安全で一貫した部品にする。
   * 戻り値: { ok, errors[], warnings[], comp }  ok でなければ comp は null
   * opts.ownRule: 'declared'（既定: 宣言されたへんすう＋値を入れるもの＝部品が持つ） | 'written'（値を入れるものだけ。取り出し用）
   */
  P.sanitize = function (raw, opts) {
    opts = opts || {};
    var errors = [], warnings = [];
    function fail(m) { errors.push(m); return { ok: false, errors: errors, warnings: warnings, comp: null }; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('部品のデータではありません。');
    if (raw.v !== undefined && (typeof raw.v !== 'number' || Math.floor(raw.v) !== raw.v || raw.v < 1)) return fail('部品の形式バージョンが正しくありません。');
    if (typeof raw.v === 'number' && raw.v > P.FORMAT) return fail('このアプリより新しい形式（v' + raw.v + '）の部品です。アプリを更新してください。');
    var name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim().slice(0, P.LIMITS.name) : '';
    if (!name) return fail('部品の名前がありません。');
    var kind = raw.kind === 'event' ? 'event' : raw.kind === 'stmt' ? 'stmt' : '';
    if (!kind) return fail('部品の種類（kind）が正しくありません。');
    if (!Array.isArray(raw.blocks) || !raw.blocks.length) return fail('部品の中身（ブロック）が空です。');
    var maxB = opts.large ? Cr.LIMITS.blocks : P.LIMITS.blocks, maxBytes = opts.large ? Cr.LIMITS.bytes : P.LIMITS.bytes;
    if (raw.blocks.length > maxB) return fail('部品のブロックが多すぎます（' + maxB + ' 個まで）。');
    try { if (JSON.stringify(raw.blocks).length > maxBytes * 2) return fail('部品のデータが大きすぎます。'); } catch (e) { return fail('部品のデータを読み取れません。'); }

    var wrapper = { v: Cr.FORMAT, canvas: Cr.DEFAULT_CANVAS, vars: [], scripts: kind === 'event' ? raw.blocks : [{ type: 'onStart', id: 'w0', body: raw.blocks }] };
    var v = Cr.validate(wrapper);
    if (!v.ok) {
      var uniq = [];
      v.errors.forEach(function (e) { if (uniq.indexOf(e.msg) < 0) uniq.push(e.msg); });
      uniq.slice(0, 5).forEach(function (m) { errors.push(m); });
      if (uniq.length > 5) errors.push('…ほか ' + (uniq.length - 5) + ' 件の問題があります。');
      return { ok: false, errors: errors, warnings: warnings, comp: null };
    }
    var blocks = kind === 'event' ? v.clean.scripts : v.clean.scripts[0].body;
    if (!blocks.length) return fail('部品の中身（ブロック）が空です。');
    var count = 0;
    Cr.walk({ scripts: blocks }, function () { count++; });
    if (count > maxB) return fail('部品のブロックが多すぎます（' + maxB + ' 個まで）。');
    var wasUnknown = false;
    Cr.walk({ scripts: blocks }, function (b) { if (b.type === 'unknown') wasUnknown = true; });
    if (wasUnknown) return fail('未対応のブロックが含まれています。');

    // へんすう: 部品が「持つ」もの / 作品側に「必要」なもの を中身から決める
    var an = P.analyze(blocks);
    var decl = cleanVarDecls(raw.vars);
    var declMap = newMap();
    decl.forEach(function (d) { declMap[d.name] = d; });
    var ownNames = [];
    an.order.forEach(function (n) {
      // 既定: 値を入れる(set)か、宣言されているもの。'written': 値を入れる(set)か増やす(change)もの（作品から取り出すとき）
      var isOwn = an.sets[n] || (opts.ownRule === 'written' ? an.changes[n] : declMap[n]);
      if (isOwn) ownNames.push(n);
    });
    // 宣言されているが使われていないへんすうも、部品が持つものとして残す（初期値の設定用）
    decl.forEach(function (d) { if (ownNames.indexOf(d.name) < 0 && opts.ownRule !== 'written') ownNames.push(d.name); });
    var vars = ownNames.slice(0, P.LIMITS.vars).map(function (n) {
      var d = declMap[n];
      if (d) return d;
      var t = an.put[n] && an.put[n] !== 'any' ? an.put[n] : (an.req[n] && an.req[n] !== 'any' ? an.req[n] : 'num');
      return { name: n, value: defaultFor(t) };
    });
    var ownSet = newMap();
    vars.forEach(function (x) { ownSet[x.name] = 1; });
    var needs = [];
    an.order.forEach(function (n) {
      if (ownSet[n]) return;
      if (an.reads[n] || an.changes[n]) needs.push({ name: n, type: an.req[n] || 'any' });
    });
    if (needs.length > P.LIMITS.vars) return fail('必要なへんすうが多すぎます（' + P.LIMITS.vars + ' 個まで）。');
    var types = newMap();
    vars.forEach(function (x) { types[x.name] = typeOfValue(x.value); });
    var provides = vars.filter(function (x) { return an.sets[x.name] || an.changes[x.name]; })
      .map(function (x) { return { name: x.name, type: types[x.name] }; });

    // 設定値: 実際にあるリテラルの入力欄にだけ結びつける。型・初期値・範囲はブロックから決める
    var params = [], keys = newMap();
    (Array.isArray(raw.params) ? raw.params : []).slice(0, P.LIMITS.params).forEach(function (p) {
      if (!p || typeof p !== 'object' || typeof p.key !== 'string' || !KEY_RE.test(p.key) || keys[p.key]) return;
      var blockId = typeof p.blockId === 'string' ? p.blockId : '', slot = typeof p.slot === 'string' ? p.slot : '';
      var lit = ID_RE.test(blockId) && slot ? findLiteral(blocks, blockId, slot) : null;
      if (!lit || lit.slot.t === 'var') { warnings.push('設定値「' + String(p.label || p.key).slice(0, 20) + '」の対象が見つからないため外しました。'); return; }
      var type = lit.slot.t === 'any' ? typeOfValue(lit.value) : lit.slot.t;
      var q = { key: p.key, label: (typeof p.label === 'string' && p.label.trim() ? p.label.trim() : lit.spec.name).slice(0, 30), blockId: blockId, slot: slot, type: type, def: lit.value };
      if (type === 'num') { q.min = lit.slot.t === 'num' ? lit.slot.min : -Cr.LIMITS.number; q.max = lit.slot.t === 'num' ? lit.slot.max : Cr.LIMITS.number; }
      if (lit.slot.t === 'enum') q.options = lit.slot.options.map(function (o) { return [o[0], o[1]]; });
      keys[p.key] = 1; params.push(q);
    });

    var now = Date.now();
    var comp = {
      id: typeof raw.id === 'string' && /^[A-Za-z0-9_:-]{1,60}$/.test(raw.id) ? raw.id : P.newId(),
      v: P.FORMAT, name: name,
      description: typeof raw.description === 'string' ? raw.description.slice(0, P.LIMITS.desc) : '',
      kind: kind,
      version: R.int(raw.version, 1, 9999, 1),
      createdAt: typeof raw.createdAt === 'number' && isFinite(raw.createdAt) ? Math.max(0, Math.min(4e12, raw.createdAt)) : now,
      updatedAt: typeof raw.updatedAt === 'number' && isFinite(raw.updatedAt) ? Math.max(0, Math.min(4e12, raw.updatedAt)) : now,
      tags: Array.isArray(raw.tags) ? raw.tags.filter(function (t) { return typeof t === 'string' && t; }).map(function (t) { return t.slice(0, 20); }).slice(0, P.LIMITS.tags) : [],
      blocks: blocks, vars: vars, params: params, needs: needs, provides: provides, types: Object.keys(types).reduce(function (o, k) { o[k] = types[k]; return o; }, {})
    };
    if (raw.canvas && typeof raw.canvas === 'object' && typeof raw.canvas.w === 'number' && typeof raw.canvas.h === 'number') {
      comp.canvas = { w: Math.max(Cr.LIMITS.canvasMin, Math.min(Cr.LIMITS.canvasMax, Math.round(raw.canvas.w))), h: Math.max(Cr.LIMITS.canvasMin, Math.min(Cr.LIMITS.canvasMax, Math.round(raw.canvas.h))) };
    }
    if (raw.builtin === true) comp.builtin = true;
    try { if (JSON.stringify(comp).length > maxBytes) return fail('部品のデータが大きすぎます。'); } catch (e) { return fail('部品のデータを読み取れません。'); }
    return { ok: true, errors: errors, warnings: warnings, comp: comp };
  };

  /**
   * 作品の中の1つのブロック（中身ごと）を部品にする下書きを作る。
   * イベントブロックなら kind:'event'、それ以外は命令の部品（kind:'stmt'）。
   * 戻り値: { ok, error, comp, candidates[] }  candidates は設定値にできる入力欄の一覧
   */
  P.extract = function (creation, blockId, info) {
    info = info || {};
    var hit = Cr.find(creation, blockId);
    if (!hit) return { ok: false, error: '選んだブロックが見つかりません。', comp: null, candidates: [] };
    var spec = Cr.has(hit.block.type) ? SPEC[hit.block.type] : null;
    if (!spec || hit.block.type === 'unknown') return { ok: false, error: '未対応のブロックは部品にできません。', comp: null, candidates: [] };
    if (spec.kind === 'expr') return { ok: false, error: '値ブロックは、そのまま部品にはできません。それを使う命令ごと選んでください。', comp: null, candidates: [] };
    var blocks = [J(hit.block)];
    var raw = {
      name: info.name || spec.name, description: info.description || '', kind: spec.kind === 'event' ? 'event' : 'stmt',
      blocks: blocks, vars: creation.vars, params: info.params || [], tags: info.tags || [],
      canvas: creation.canvas, version: 1
    };
    var s = P.sanitize(raw, { ownRule: 'written' });
    if (!s.ok) return { ok: false, error: s.errors[0], comp: null, candidates: [] };
    return { ok: true, error: '', comp: s.comp, candidates: P.paramCandidates(s.comp.blocks), warnings: s.warnings };
  };

  /** 作品のスクリプト（複数可）をまとめた部品を作る（組み合わせ用）。宣言されたへんすうは「部品が持つ」ものとして扱う */
  P.fromWork = function (source, opts) {
    opts = opts || {};
    var v = Cr.validate(source, { lenient: true });
    var scripts = v.clean.scripts;
    if (opts.scriptIds && opts.scriptIds.length) scripts = scripts.filter(function (s) { return opts.scriptIds.indexOf(s.id) >= 0; });
    if (!scripts.length) return { ok: false, error: '取り込めるスクリプトがありません。', comp: null };
    var unknown = false;
    Cr.walk({ scripts: scripts }, function (b) { if (b.type === 'unknown') unknown = true; });
    if (unknown) return { ok: false, error: '未対応のブロックを含む作品は組み合わせられません。先に、その作品を開いて未対応のブロックを削除してください。', comp: null };
    var s = P.sanitize({ name: opts.name || '組み合わせ', kind: 'event', blocks: scripts, vars: v.clean.vars, canvas: v.clean.canvas, description: v.clean.description }, { large: true });
    if (!s.ok) return { ok: false, error: s.errors[0], comp: null };
    return { ok: true, error: '', comp: s.comp };
  };

  /** 新しい部品として保存できる形（ID・日時・バージョンを付ける）にする */
  P.make = function (draft, info) {
    info = info || {};
    var raw = J(draft);
    raw.id = info.id || P.newId();
    raw.name = info.name !== undefined ? info.name : raw.name;
    raw.description = info.description !== undefined ? info.description : raw.description;
    raw.version = info.version || 1;
    raw.createdAt = info.createdAt || Date.now();
    raw.updatedAt = Date.now();
    raw.params = info.params !== undefined ? info.params : raw.params;
    raw.tags = info.tags !== undefined ? info.tags : raw.tags;
    delete raw.builtin;
    return P.sanitize(raw);
  };

  /* =============== 挿入 =============== */
  function uniqueName(base, avoid) {
    var n = 2, name;
    do {
      var suffix = '_' + n;
      name = base.slice(0, 20 - suffix.length) + suffix;
      n++;
    } while (avoid[name] && n < 1000);
    return name;
  }

  function msgToProblem(msg) {
    if (/入れ子が深すぎ/.test(msg)) return { code: 'limit-depth', msg: msg, fix: '挿入先をもっと浅い場所（イベントの直下など）にしてください。' };
    if (/ブロックが多すぎ|個まで/.test(msg)) return { code: 'limit-blocks', msg: msg, fix: '作品か部品のブロックを減らしてください。' };
    if (/へんすうは .* 個まで/.test(msg)) return { code: 'limit-vars', msg: msg, fix: '使っていないへんすうを削除してください。' };
    return { code: 'invalid', msg: msg, fix: '' };
  }

  function coerceParam(p, val) {
    if (p.type === 'num') {
      var n = typeof val === 'number' ? val : Number(String(val).trim());
      if (String(val).trim() === '' || !isFinite(n)) return { error: '「' + p.label + '」には数を入れてください。' };
      var c = Math.max(p.min, Math.min(p.max, n));
      return { value: c, clamped: c !== n };
    }
    if (p.type === 'color') {
      var col = typeof val === 'string' ? Cr.cleanColor(val) : null;
      return col && /^#/.test(col) ? { value: col } : { error: '「' + p.label + '」の色は #rrggbb の形で指定してください。' };
    }
    if (p.type === 'bool') {
      if (typeof val === 'boolean') return { value: val };
      if (val === 'true' || val === 'false') return { value: val === 'true' };
      return { error: '「' + p.label + '」は「はい/いいえ」で指定してください。' };
    }
    if (p.type === 'enum') {
      return p.options.some(function (o) { return o[0] === val; }) ? { value: val } : { error: '「' + p.label + '」の選択肢が正しくありません。' };
    }
    return typeof val === 'string' ? { value: val.slice(0, Cr.LIMITS.text) } : { error: '「' + p.label + '」には文字を入れてください。' };
  }

  /**
   * 部品 comp を作品 target（構成）に入れた新しい構成を作る。target は変更しない。
   * opts: {
   *   params: { 設定値のキー: 値 },
   *   map:   { 部品のへんすう名: 作品のへんすう名 | '__create'（新しく作る） | '__rename'（名前を変えて追加） },
   *   createMissing: true なら、足りない「必要なへんすう」を自動で作る,
   *   target: { ownerId, body, index }  命令の部品の挿入先（省略: 最後のイベントの中の最後）
   * }
   * 戻り値: { ok, creation, problems[{code,msg,fix}], warnings[], renamed[{from,to}], created[], connected[{from,to}], inserted[ids], stats }
   */
  P.insert = function (targetIn, compIn, opts) {
    opts = opts || {};
    var res = { ok: false, creation: null, problems: [], warnings: [], renamed: [], created: [], connected: [], inserted: [], stats: { blocks: 0, scripts: 0, vars: 0 } };
    function prob(code, msg, fix) { res.problems.push({ code: code, msg: msg, fix: fix || '' }); }

    var s = P.sanitize(compIn, { large: !!opts.large });
    if (!s.ok) { prob('invalid-part', '部品として使えません: ' + s.errors[0], '部品を作り直すか、書き出した人に確認してください。'); return res; }
    var comp = s.comp;
    var before = Cr.validate(targetIn, { lenient: true });
    var T = before.clean;
    var preErr = newMap();
    before.errors.forEach(function (e) { preErr[(e.id || '') + '|' + e.msg] = 1; });
    if (before.errors.length) res.warnings.push('この作品には、もともとチェックのエラーが ' + before.errors.length + ' 件あります（部品の挿入とは別の問題です）。');

    var types = P.varTypes(T);
    var used = P.usedNames(T);
    var map = opts.map || {};

    // ---- 挿入先 ----
    var place = null;
    if (comp.kind === 'event') {
      if (T.scripts.length + comp.blocks.length > Cr.LIMITS.scripts) {
        prob('limit-scripts', 'スクリプト（イベント）が上限（' + Cr.LIMITS.scripts + ' 個）を超えます。', '使っていないイベントを削除してください。');
      }
    } else {
      var t = opts.target;
      if (t && t.ownerId) {
        var owner = Cr.find(T, t.ownerId);
        if (!owner || !Cr.has(owner.block.type) || !SPEC[owner.block.type].bodies.length || SPEC[owner.block.type].bodies.indexOf(t.body || 'body') < 0) {
          prob('bad-target', '挿入先のブロックが見つかりません。', '挿入先を選び直してください。');
        } else place = { owner: owner.block, body: t.body || 'body', index: typeof t.index === 'number' ? t.index : (owner.block[t.body || 'body'] || []).length };
      } else {
        var last = null;
        T.scripts.forEach(function (sc) { if (SPEC[sc.type] && SPEC[sc.type].bodies.indexOf('body') >= 0) last = sc; });
        if (last) place = { owner: last, body: 'body', index: last.body.length };
        else place = { owner: null, body: 'body', index: 0, wrap: true };
      }
      if (place && place.wrap) {
        if (T.scripts.length >= Cr.LIMITS.scripts) prob('limit-scripts', 'スクリプト（イベント）が上限（' + Cr.LIMITS.scripts + ' 個）です。', '使っていないイベントを削除してください。');
        else res.warnings.push('この作品にはイベントが無かったため、「はじまったとき」を新しく作って入れます。');
      }
    }

    // ---- へんすうの接続 ----
    var rename = newMap();
    var finalTaken = newMap();
    Object.keys(used).forEach(function (k) { finalTaken[k] = 1; });
    var reserved = newMap();
    comp.vars.forEach(function (v) { reserved[v.name] = 1; });
    comp.needs.forEach(function (n) { reserved[n.name] = 1; });
    var newVars = [];

    comp.needs.forEach(function (n) {
      var to = own(map, n.name) ? map[n.name] : (used[n.name] ? n.name : null);
      if (to === '__create' || (!to && opts.createMissing)) {
        var nm = !used[n.name] && !finalTaken[n.name] ? n.name : uniqueName(n.name, Object.assign(newMap(), finalTaken, reserved));
        finalTaken[nm] = 1; rename[n.name] = nm; newVars.push({ name: nm, value: defaultFor(n.type === 'any' ? 'num' : n.type) });
        res.created.push(nm);
        return;
      }
      if (!to) {
        prob('missing-var', '部品が必要とするへんすう「' + n.name + '」（' + TYPE_JA[n.type] + '）がこの作品にありません。',
          '「' + n.name + '」という名前のへんすうを作るか、既存のへんすうに接続してください。');
        return;
      }
      if (!used[to]) { prob('missing-var', '接続先のへんすう「' + to + '」がこの作品にありません。', '接続先を選び直してください。'); return; }
      if (!compatible(n.type, types[to])) {
        prob('type-mismatch', '部品は「' + n.name + '」を' + TYPE_JA[n.type] + 'として使いますが、この作品のへんすう「' + to + '」は' + TYPE_JA[types[to]] + 'です。',
          '「' + to + '」を' + TYPE_JA[n.type] + 'に直すか、別のへんすうに接続してください。');
        return;
      }
      rename[n.name] = to;
      if (to !== n.name) res.connected.push({ from: n.name, to: to });
    });

    comp.vars.forEach(function (v) {
      var m = own(map, v.name) ? map[v.name] : '__rename';
      if (m && m !== '__rename' && m !== '__create') {
        if (!used[m]) { prob('missing-var', '接続先のへんすう「' + m + '」がこの作品にありません。', '接続先を選び直してください。'); return; }
        if (!compatible(typeOfValue(v.value), types[m])) {
          prob('type-mismatch', '部品のへんすう「' + v.name + '」は' + TYPE_JA[typeOfValue(v.value)] + 'ですが、接続先の「' + m + '」は' + TYPE_JA[types[m]] + 'です。',
            '同じ型のへんすうに接続するか、「名前を変えて追加」にしてください。');
          return;
        }
        rename[v.name] = m; res.connected.push({ from: v.name, to: m });
        res.warnings.push('部品が、既存のへんすう「' + m + '」の値を書き換えるようになります。');
        return;
      }
      var nm = v.name;
      if (finalTaken[nm]) {
        nm = uniqueName(v.name, Object.assign(newMap(), finalTaken, reserved));
        res.renamed.push({ from: v.name, to: nm });
      }
      finalTaken[nm] = 1; rename[v.name] = nm;
      var nv = { name: nm, value: v.value }; if (v.tune) nv.tune = v.tune;
      newVars.push(nv);
    });
    if ((T.vars.length + newVars.length) > Cr.LIMITS.vars) {
      prob('limit-vars', 'へんすうが上限（' + Cr.LIMITS.vars + ' 個）を超えます。', '使っていないへんすうを削除してください。');
    }

    // ---- 設定値 ----
    var givenParams = opts.params || {};
    var paramVals = newMap();
    comp.params.forEach(function (p) {
      var val = own(givenParams, p.key) ? givenParams[p.key] : p.def;
      var c = coerceParam(p, val);
      if (c.error) { prob('bad-param', c.error, '値を直してください。'); return; }
      if (c.clamped) res.warnings.push('「' + p.label + '」の値は範囲内に直しました（' + c.value + '）。');
      paramVals[p.key] = c.value;
    });

    if (res.problems.length) return res;

    // ---- ブロックの複製（新しいID）→ へんすう名の付け替え → 設定値の反映 ----
    var blocks = J(comp.blocks);
    var ids = newMap();
    Cr.walk(T, function (b) { ids[b.id] = 1; });
    var idMap = newMap();
    Cr.walk({ scripts: blocks }, function (b) {
      var id;
      do { id = Cr.newId(); } while (ids[id]);
      ids[id] = 1; idMap[b.id] = id; b.id = id;
    });
    Cr.walk({ scripts: blocks }, function (b) {
      if ((b.type === 'set' || b.type === 'change' || b.type === 'var') && b.in && own(rename, b.in.name)) b.in.name = rename[b.in.name];
    });
    comp.params.forEach(function (p) {
      var nid = idMap[p.blockId];
      var hit = nid ? Cr.find({ scripts: blocks }, nid) : null;
      if (hit && own(paramVals, p.key)) hit.block.in[p.slot] = paramVals[p.key];
    });

    // ---- 作品に入れる（コピーに対して） ----
    var out = J(T);
    newVars.forEach(function (nv) { out.vars.push(nv); });
    if (comp.kind === 'event') {
      blocks.forEach(function (b) { out.scripts.push(b); });
      res.inserted = blocks.map(function (b) { return b.id; });
    } else if (place.wrap) {
      var wrap = Cr.makeBlock('onStart'); wrap.body = blocks; out.scripts.push(wrap);
      res.inserted = blocks.map(function (b) { return b.id; });
    } else {
      var o = Cr.find(out, place.owner.id).block;
      var list = o[place.body];
      var idx = Math.max(0, Math.min(list.length, place.index));
      Array.prototype.splice.apply(list, [idx, 0].concat(blocks));
      res.inserted = blocks.map(function (b) { return b.id; });
    }

    if (comp.canvas && T.canvas && (Math.abs(comp.canvas.w - T.canvas.w) > 40 || Math.abs(comp.canvas.h - T.canvas.h) > 40)) {
      res.warnings.push('この部品は ' + comp.canvas.w + '×' + comp.canvas.h + ' のキャンバスを前提に作られています（この作品は ' + T.canvas.w + '×' + T.canvas.h + '）。位置の数値は調整が必要かもしれません。');
    }

    // ---- 組み合わせ後の検証 ----
    var after = Cr.validate(out);
    var fresh = after.errors.filter(function (e) { return !preErr[(e.id || '') + '|' + e.msg]; });
    if (fresh.length) {
      var seenMsg = newMap();
      fresh.forEach(function (e) { if (!seenMsg[e.msg]) { seenMsg[e.msg] = 1; var p = msgToProblem(e.msg); prob(p.code, p.msg, p.fix); } });
      return res;
    }
    after.warnings.forEach(function (w) { if (res.warnings.indexOf(w.msg) < 0 && res.warnings.length < 8) res.warnings.push(w.msg); });
    res.ok = true;
    res.creation = after.ok ? after.clean : Cr.validate(out, { lenient: true }).clean;
    res.stats = { blocks: Cr.stats(res.creation).blocks - Cr.stats(T).blocks, scripts: res.creation.scripts.length - T.scripts.length, vars: newVars.length };
    return res;
  };

  /** 作品 source の（選んだ）スクリプトを target に取り込む。source・target は変更しない。結果は insert と同じ形 */
  P.composeWorks = function (target, source, opts) {
    opts = opts || {};
    var f = P.fromWork(source, { scriptIds: opts.scriptIds, name: opts.name });
    if (!f.ok) return { ok: false, creation: null, problems: [{ code: 'bad-source', msg: f.error, fix: '' }], warnings: [], renamed: [], created: [], connected: [], inserted: [], stats: { blocks: 0, scripts: 0, vars: 0 }, comp: null };
    var r = P.insert(target, f.comp, { map: opts.map, createMissing: opts.createMissing, params: {}, large: true });
    r.comp = f.comp;
    return r;
  };

  /** 部品の説明用: 入力・出力を短い文にする */
  P.ioText = function (comp) {
    var ins = comp.needs.map(function (n) { return n.name + '（' + TYPE_JA[n.type] + '）'; });
    var outs = comp.provides.map(function (n) { return n.name + '（' + TYPE_JA[n.type] + '）'; });
    return { inputs: ins, params: comp.params.map(function (p) { return p.label; }), outputs: outs };
  };
  P.TYPE_JA = TYPE_JA;
})();
