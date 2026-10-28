/*
 * Remix Engine — 中核ロジック（PZ.remix）
 *
 * 画面（DOM）にも保存先にも依存しない、純粋な関数だけを置きます。テストは scripts/test-remix.js。
 *   ・ブロック構成の「読める文字列」化（blockText）と平坦化（flatten）
 *   ・2つの構成の差分（diff）と、変更概要の文章（summarize）
 *   ・派生関係のメタ情報（cleanRemix / originRef / lineage）と、系統ツリー（buildTree）
 *
 * 作品レコードの追加項目 remix（schema は変えない。無い作品は今までどおり読める）:
 *   { v:1, origin:{id|null, sample, name, ver, at}, lineage:[{id,name}…(古い順)], summary, parts:[{id,name,version}] }
 *   ・origin   派生元（どの作品の、いつの状態から作ったか）。派生元が消えても名前と日時が残る
 *   ・lineage  祖先の一覧。途中の作品が消えても、系統ツリーに「削除済み」として位置が残る
 *   ・summary  直近の保存の変更概要
 *   ・parts    使った部品の来歴（参照用。部品が変更されても作品の中身は変わらない）
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var Cr = PZ.creation;
  var SPEC = Cr.SPEC;
  var R = (PZ.remix = PZ.remix || {});

  R.FORMAT = 1;
  R.LIMITS = {
    versions: 30,            // 1作品あたりの履歴の最大件数
    historyBytes: 1200000,   // 1作品あたりの履歴の合計サイズ（概算・文字数）
    pins: 5,                 // ピン留めできる版の数
    lineage: 20,             // 記録する祖先の数
    summary: 200, note: 120, parts: 20,
    components: 100,         // 保存できる部品の数
    drafts: 10,              // 残しておく下書きの数
    draftBytes: 400000,
    packageBytes: 8 * 1024 * 1024,
    packageVersions: 12,     // 書き出しに含める履歴の件数
    backupVersions: 10,      // バックアップに含める履歴の件数（作品ごと）
    backupBytes: 30 * 1024 * 1024
  };

  function J(x) { return JSON.parse(JSON.stringify(x)); }
  R.clone = J;
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function int(v, min, max, def) { return (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= min && v <= max) ? v : def; }
  R.str = str; R.int = int;

  /* =============== ブロックの文字列化 =============== */
  function slotText(spec, name, v) {
    var s = spec.slots[name];
    if (v && typeof v === 'object') return '(' + R.blockText(v) + ')';
    if (s.t === 'enum') {
      for (var i = 0; i < s.options.length; i++) if (s.options[i][0] === v) return s.options[i][1];
      return String(v);
    }
    if (s.t === 'bool') return v ? 'はい' : 'いいえ';
    if (s.t === 'text') return '「' + String(v) + '」';
    if (s.t === 'var') return v ? String(v) : '（未選択）';
    return String(v);
  }

  /** ブロック1つ（中の並びは含まない）を日本語の短い文にする。例: 「位置を x 400 y 250 にする」 */
  R.blockText = function (b) {
    var spec = b && Cr.has(b.type) ? SPEC[b.type] : null;
    if (!spec || b.type === 'unknown') return '未対応のブロック';
    return spec.label.map(function (tok) {
      if (tok.charAt(0) !== '@') return tok;
      var k = tok.slice(1);
      return slotText(spec, k, b.in ? b.in[k] : undefined);
    }).join('').replace(/\s+/g, ' ').trim();
  };

  /** 入力欄の値を {キー: 文字列} にする（値ブロックの中身まで）。差分の「パラメーター変更」の数え方に使う */
  function paramEntries(b, prefix, out) {
    var spec = Cr.has(b.type) ? SPEC[b.type] : null;
    if (!spec) return;
    Object.keys(spec.slots).forEach(function (k) {
      var v = b.in ? b.in[k] : undefined, key = prefix + k;
      if (v && typeof v === 'object') { out[key] = '{' + v.type + '}'; paramEntries(v, key + '.', out); }
      else out[key] = typeof v + ':' + String(v);
    });
  }

  /** 並びの順（先頭から深さ優先）に、命令・イベントのブロックを平らな一覧にする */
  R.flatten = function (creation) {
    var out = [];
    function visit(b, parent, body, index, depth) {
      var e = {
        id: b.id, type: b.type, depth: depth, parentId: parent ? parent.id : null, body: body, index: index,
        bodyLabel: parent && Cr.has(parent.type) && SPEC[parent.type].bodyLabels ? (SPEC[parent.type].bodyLabels[body] || '') : '',
        text: R.blockText(b), params: {}
      };
      paramEntries(b, '', e.params);
      out.push(e);
      var spec = Cr.has(b.type) ? SPEC[b.type] : null;
      if (!spec) return;
      spec.bodies.forEach(function (bn) { (b[bn] || []).forEach(function (c, i) { visit(c, b, bn, i, depth + 1); }); });
    }
    ((creation && creation.scripts) || []).forEach(function (s, i) { visit(s, null, 'scripts', i, 0); });
    return out;
  };

  /* =============== 差分 =============== */
  function lcsPairs(ka, kb) {
    var n = ka.length, m = kb.length, w = m + 1;
    var t = new Uint16Array((n + 1) * w);
    var i, j;
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        t[i * w + j] = ka[i] === kb[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
      }
    }
    var pairs = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (ka[i] === kb[j]) { pairs.push([i, j]); i++; j++; }
      else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
      else j++;
    }
    return pairs;
  }

  function varDesc(v) {
    var s = typeof v.value === 'string' ? '「' + v.value + '」' : String(v.value);
    return s + (v.tune ? '（つまみ ' + v.tune.min + '〜' + v.tune.max + '）' : '');
  }

  /**
   * 構成 a（変更前）と b（変更後）の差分。
   * opts: { nameA, nameB }（名前の変更も数える）
   * 戻り値: { same, rows[], counts{added,removed,changed,moved,params}, vars{added,removed,changed}, meta[], name, mode }
   *   rows[i] = { kind:'same'|'chg'|'mov'|'add'|'del'|'movOut'|'movIn', id, depth, a:entry|null, b:entry|null }
   */
  R.diff = function (a, b, opts) {
    opts = opts || {};
    a = a || Cr.blank(); b = b || Cr.blank();
    var A = R.flatten(a), B = R.flatten(b);
    var ia = Object.create(null), ib = Object.create(null);
    A.forEach(function (e) { ia[e.id] = e; });
    B.forEach(function (e) { ib[e.id] = e; });
    var common = 0;
    A.forEach(function (e) { if (ib[e.id]) common++; });
    // ID がまったく重ならない（別々に作られた）構成どうしは、見た目の文章で突き合わせる
    var mode = (common === 0 && A.length && B.length) ? 'text' : 'id';
    function key(e) { return mode === 'id' ? e.id : e.type + '|' + e.text + '|' + e.depth; }
    var pairs = lcsPairs(A.map(key), B.map(key));
    pairs.push([A.length, B.length]);

    var rows = [], counts = { added: 0, removed: 0, changed: 0, moved: 0, params: 0 };
    var movedIds = Object.create(null);
    var i = 0, j = 0;
    function paramDiff(x, y) {
      var n = 0, seen = Object.create(null);
      Object.keys(x.params).concat(Object.keys(y.params)).forEach(function (k) {
        if (seen[k]) return; seen[k] = 1;
        if (x.params[k] !== y.params[k]) n++;
      });
      return n;
    }
    pairs.forEach(function (p) {
      var real = p[0] < A.length;
      while (i < p[0]) {
        var ea = A[i++];
        if (mode === 'id' && ib[ea.id]) { rows.push({ kind: 'movOut', id: ea.id, depth: ea.depth, a: ea, b: ib[ea.id] }); movedIds[ea.id] = 1; }
        else { rows.push({ kind: 'del', id: ea.id, depth: ea.depth, a: ea, b: null }); counts.removed++; }
      }
      while (j < p[1]) {
        var eb = B[j++];
        if (mode === 'id' && ia[eb.id]) rows.push({ kind: 'movIn', id: eb.id, depth: eb.depth, a: ia[eb.id], b: eb });
        else { rows.push({ kind: 'add', id: eb.id, depth: eb.depth, a: null, b: eb }); counts.added++; }
      }
      if (!real) return;
      var x = A[p[0]], y = B[p[1]];
      i = p[0] + 1; j = p[1] + 1;
      var textChanged = x.text !== y.text;
      var moved = mode === 'id' && (x.parentId !== y.parentId || x.body !== y.body);
      var kind = textChanged ? 'chg' : (moved ? 'mov' : 'same');
      if (textChanged) { counts.changed++; counts.params += paramDiff(x, y) || 0; }
      if (moved) movedIds[x.id] = 1;
      rows.push({ kind: kind, id: y.id, depth: y.depth, a: x, b: y });
    });
    counts.moved = Object.keys(movedIds).length;

    // へんすう
    var va = Object.create(null), vb = Object.create(null);
    (a.vars || []).forEach(function (v) { va[v.name] = v; });
    (b.vars || []).forEach(function (v) { vb[v.name] = v; });
    var vars = { added: [], removed: [], changed: [] };
    Object.keys(vb).forEach(function (k) {
      if (!va[k]) vars.added.push({ name: k, to: varDesc(vb[k]) });
      else if (JSON.stringify(va[k]) !== JSON.stringify(vb[k])) vars.changed.push({ name: k, from: varDesc(va[k]), to: varDesc(vb[k]) });
    });
    Object.keys(va).forEach(function (k) { if (!vb[k]) vars.removed.push({ name: k, from: varDesc(va[k]) }); });

    // キャンバス・説明
    var meta = [];
    var ca = a.canvas || {}, cb = b.canvas || {};
    if (ca.w !== cb.w || ca.h !== cb.h) meta.push({ label: 'キャンバスの大きさ', from: ca.w + '×' + ca.h, to: cb.w + '×' + cb.h });
    if (ca.bg !== cb.bg) meta.push({ label: '背景色', from: String(ca.bg), to: String(cb.bg) });
    if ((a.description || '') !== (b.description || '')) meta.push({ label: '説明', from: a.description || '（なし）', to: b.description || '（なし）' });
    var name = (opts.nameA !== undefined && opts.nameB !== undefined && opts.nameA !== opts.nameB) ? { from: opts.nameA, to: opts.nameB } : null;

    var d = { rows: rows, counts: counts, vars: vars, meta: meta, name: name, mode: mode };
    d.same = !name && !meta.length && !vars.added.length && !vars.removed.length && !vars.changed.length &&
      !counts.added && !counts.removed && !counts.changed && !counts.moved;
    return d;
  };

  /** 差分を1行の変更概要にする。例: 「ブロック +2 −1 ／ 値の変更 3 件 ／ へんすう +1」 */
  R.summarize = function (d) {
    if (!d || d.same) return '変更なし';
    var p = [], c = d.counts;
    if (d.name) p.push('名前を変更');
    if (c.added || c.removed) p.push('ブロック ' + [c.added ? '+' + c.added : '', c.removed ? '−' + c.removed : ''].filter(Boolean).join(' '));
    if (c.changed) p.push('内容の変更 ' + c.changed + ' 件' + (c.params ? '（値 ' + c.params + '）' : ''));
    if (c.moved) p.push('接続・並びの変更 ' + c.moved + ' 件');
    var v = d.vars;
    if (v.added.length || v.removed.length || v.changed.length) {
      p.push('へんすう ' + [v.added.length ? '+' + v.added.length : '', v.removed.length ? '−' + v.removed.length : '', v.changed.length ? '変更' + v.changed.length : ''].filter(Boolean).join(' '));
    }
    if (d.meta.length) p.push(d.meta.map(function (m) { return m.label; }).join('・') + 'を変更');
    return p.join(' ／ ').slice(0, R.LIMITS.summary);
  };

  R.diffSummary = function (a, b, opts) { return R.summarize(R.diff(a, b, opts)); };

  /* =============== 派生関係のメタ情報 =============== */
  /** 作品レコードの remix を検証して安全な形にする。無効なら null */
  R.cleanRemix = function (raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var out = { v: R.FORMAT, origin: null, lineage: [], summary: str(raw.summary, R.LIMITS.summary), parts: [] };
    var o = raw.origin;
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      var id = typeof o.id === 'string' && o.id ? o.id.slice(0, 60) : null;
      var sample = typeof o.sample === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o.sample) ? o.sample : '';
      if (id || sample) {
        out.origin = {
          id: id, sample: sample, name: str(o.name, 80),
          ver: int(o.ver, 0, 99999, null),
          at: typeof o.at === 'number' && isFinite(o.at) ? Math.max(0, Math.min(4e12, o.at)) : 0
        };
      }
    }
    if (Array.isArray(raw.lineage)) {
      raw.lineage.slice(-R.LIMITS.lineage).forEach(function (l) {
        if (l && typeof l === 'object' && typeof l.id === 'string' && l.id) out.lineage.push({ id: l.id.slice(0, 60), name: str(l.name, 80) });
      });
    }
    if (Array.isArray(raw.parts)) {
      raw.parts.slice(0, R.LIMITS.parts).forEach(function (p) {
        if (p && typeof p === 'object' && typeof p.id === 'string' && p.id) {
          out.parts.push({ id: p.id.slice(0, 60), name: str(p.name, 40), version: int(p.version, 1, 9999, 1) });
        }
      });
    }
    return out;
  };

  /** 派生元の参照（派生した瞬間の名前・更新日時・履歴番号を控える） */
  R.originRef = function (project, ver) {
    return { id: project.id, sample: '', name: str(project.name, 80), ver: int(ver, 0, 99999, null), at: project.updatedAt || 0 };
  };

  /** project の子が持つ lineage（project までの祖先 + project 自身） */
  R.lineageFor = function (project) {
    var base = (project.remix && project.remix.lineage) ? project.remix.lineage.slice() : [];
    base.push({ id: project.id, name: str(project.name, 80) });
    return base.slice(-R.LIMITS.lineage);
  };

  /** 作品を単純に複製したとき（My Space の「複製」）用の remix。元作品を派生元として記録する */
  R.remixForCopy = function (project) {
    return R.cleanRemix({ origin: R.originRef(project, null), lineage: R.lineageFor(project), summary: '', parts: project.remix ? project.remix.parts : [] });
  };

  /** 「X Remix」「X Remix 2」…と、既存の名前とぶつからない名前 */
  R.uniqueName = function (base, existing, max) {
    max = max || 80;
    var set = Object.create(null);
    (existing || []).forEach(function (n) { set[n] = 1; });
    var core = String(base).replace(/\s+Remix(\s+\d+)?$/, '');
    var n = 1, name;
    do {
      var suffix = n === 1 ? ' Remix' : ' Remix ' + n;
      name = core.slice(0, max - suffix.length) + suffix;
      n++;
    } while (set[name] && n < 1000);
    return name;
  };

  /* =============== 系統ツリー =============== */
  /**
   * 作品の一覧から、派生関係の森（複数の木）を作る。
   * ノード: { id, ghost, name, project|null, children[], depth }
   *   ghost=true は、削除された（または見つからない）祖先。lineage に名前が残っていればそれを表示する。
   * 循環した参照があっても止まらず、その作品を根として扱う。
   */
  R.buildTree = function (projects) {
    var all = Object.create(null);
    projects.forEach(function (p) { all[p.id] = p; });
    var works = projects.filter(function (p) { return p.kind === 'creation'; });
    var nodes = Object.create(null);
    function nodeFor(id, p, name) {
      if (!nodes[id]) nodes[id] = { id: id, ghost: !p, name: p ? p.name : (name || '（削除された作品）'), project: p || null, children: [], depth: 0, parent: null };
      return nodes[id];
    }
    works.forEach(function (p) { nodeFor(p.id, p); });

    function wouldCycle(child, parent) {
      var n = parent, guard = 0;
      while (n && guard++ < 200) { if (n === child) return true; n = n.parent; }
      return false;
    }
    function attach(child, parent) {
      if (!parent || child === parent || wouldCycle(child, parent)) return false;
      if (child.parent) return false;
      child.parent = parent; parent.children.push(child);
      return true;
    }

    works.forEach(function (p) {
      var me = nodes[p.id];
      var pid = p.parentId || (p.remix && p.remix.origin && p.remix.origin.id) || null;
      if (!pid || pid === p.id) return;
      var parentWork = all[pid];
      if (parentWork && parentWork.kind === 'creation') { attach(me, nodes[pid]); return; }
      if (parentWork) return; // Studio・実験の作品から作られたもの: 木には出さない
      // 親が消えている: lineage をたどって、残っている最も近い祖先の下に「削除済み」のノードを置く
      var chain = (p.remix && p.remix.lineage) ? p.remix.lineage.slice() : [];
      if (!chain.length || chain[chain.length - 1].id !== pid) chain.push({ id: pid, name: p.remix && p.remix.origin ? p.remix.origin.name : '' });
      var lastIdx = chain.length - 1;
      var upper = null;
      for (var k = chain.length - 1; k >= 0; k--) {
        var w = all[chain[k].id];
        if (w && w.kind === 'creation' && chain[k].id !== p.id) { upper = nodes[chain[k].id]; lastIdx = k; break; }
      }
      var parent = upper;
      for (var q = (upper ? lastIdx + 1 : 0); q < chain.length; q++) {
        if (chain[q].id === p.id) break;
        var g = nodeFor(chain[q].id, null, chain[q].name);
        if (parent && !g.parent) attach(g, parent);
        parent = g;
      }
      attach(me, parent);
    });

    var roots = [];
    Object.keys(nodes).forEach(function (id) { if (!nodes[id].parent) roots.push(nodes[id]); });
    function latest(n) { var t = n.project ? n.project.updatedAt : 0; n.children.forEach(function (c) { t = Math.max(t, latest(c)); }); return t; }
    function setup(n, d) {
      n.depth = d;
      n.children.sort(function (a, b) { return ((a.project && a.project.createdAt) || 0) - ((b.project && b.project.createdAt) || 0); });
      n.children.forEach(function (c) { setup(c, d + 1); });
    }
    roots.sort(function (a, b) { return latest(b) - latest(a); });
    roots.forEach(function (r) { setup(r, 0); });
    return roots;
  };

  /** 木を、表示用の平らな一覧（深さつき）にする */
  R.flattenTree = function (roots) {
    var out = [];
    (function walk(list) { list.forEach(function (n) { out.push(n); walk(n.children); }); })(roots);
    return out;
  };

  /** id を含む木（家系）を返す。無ければ null */
  R.familyOf = function (roots, id) {
    for (var i = 0; i < roots.length; i++) {
      var found = false;
      (function walk(n) { if (n.id === id) found = true; n.children.forEach(walk); })(roots[i]);
      if (found) return roots[i];
    }
    return null;
  };

  R.countDescendants = function (node) {
    var n = 0;
    (function walk(x) { x.children.forEach(function (c) { n++; walk(c); }); })(node);
    return n;
  };

  /* =============== 構成の操作（純粋） =============== */
  /** ID を保ったままの安全なコピー（派生・履歴・差分で「同じブロック」を追えるように） */
  R.cloneCreation = function (creation) { return Cr.sanitize(creation); };

  R.sameCreation = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };

  /** へんすう名を作品全体で変える（宣言と、set / change / var ブロックの両方） */
  R.renameVarIn = function (creation, from, to) {
    (creation.vars || []).forEach(function (v) { if (v.name === from) v.name = to; });
    Cr.walk(creation, function (b) {
      if ((b.type === 'set' || b.type === 'change' || b.type === 'var') && b.in && b.in.name === from) b.in.name = to;
    });
    return creation;
  };
})();
