/*
 * Creation Engine — ブロック仕様（PZ.creation.SPEC）
 *
 * ここが「許可されたブロック」のすべてです。保存データ(JSON)にはブロックの種別名と値しか入らず、
 * 実行コード（run / eval）はこのファイルの中にだけあります。データから関数が生まれることはありません。
 * → 新しいブロックを足すときは、このファイルに1件登録するだけです（docs/CREATION-ENGINE.md 参照）。
 *
 * ブロックの種類(kind):
 *   event  スクリプトの先頭。イベント（はじまったとき／ずっと／クリック…）で動き出す
 *   stmt   命令。上から順に実行される。bodies を持つものは中に命令を入れられる（くりかえし・もし）
 *   expr   値。入力欄に差し込む（乱数・計算・マウス位置…）。out が値の型
 *
 * 入力欄(slot)の型 t:  num / text / color / bool / any / var(変数名) / enum(選択肢)
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var Cr = (PZ.creation = PZ.creation || {});

  var SPEC = (Cr.SPEC = Object.create(null));

  /** 値ブロックの出力型 → 入力欄の型 で差し込めるか */
  Cr.ACCEPT = {
    num: { num: 1, any: 1 },
    text: { text: 1, num: 1, any: 1, bool: 1, color: 1 },
    color: { color: 1, text: 1, any: 1 },
    bool: { bool: 1, any: 1 },
    any: { num: 1, text: 1, bool: 1, color: 1, any: 1 }
  };

  /** カテゴリ（パレットの見出し・色）。値ブロックは calc / input */
  Cr.CATS = [
    { id: 'event', label: 'イベント', note: 'ここから動き出す', icon: 'bolt' },
    { id: 'var', label: 'へんすう', note: '数や文字をしまっておく', icon: 'variable' },
    { id: 'flow', label: '流れ', note: 'くりかえし・分かれ道', icon: 'loop' },
    { id: 'draw', label: '描く', note: '図形と文字を描く', icon: 'brush' },
    { id: 'style', label: '色・位置', note: '色・大きさ・場所を決める', icon: 'palette' },
    { id: 'calc', label: '計算・乱数', note: '値をつくる（入力欄に差し込む）', icon: 'calc' },
    { id: 'input', label: 'マウス・時間', note: '今の状態を読む（入力欄に差し込む）', icon: 'mouse' }
  ];

  var MAXN = 1e9;
  var SHAPES = [['circle', '円'], ['square', '四角'], ['triangle', '三角'], ['star', '星'], ['line', '線']];

  function reg(s) {
    s.slots = s.slots || {};
    s.bodies = s.bodies || [];
    SPEC[s.type] = s;
    return s;
  }
  function num(def, min, max) { return { t: 'num', def: def, min: min === undefined ? -MAXN : min, max: max === undefined ? MAXN : max }; }

  /* ================= イベント ================= */
  reg({ type: 'onStart', kind: 'event', cat: 'event', icon: 'bolt', name: 'はじまったとき',
    label: ['はじまったとき'], bodies: ['body'],
    hint: '「実行」を押した最初に、1回だけ動きます。準備や、最初の絵を描くのに使います。' });
  reg({ type: 'onTick', kind: 'event', cat: 'event', icon: 'loop', name: 'ずっと',
    label: ['ずっと（毎フレーム）'], bodies: ['body'],
    hint: '実行中、1秒に約60回くりかえし動きます。アニメーションの基本です。' });
  reg({ type: 'onTimer', kind: 'event', cat: 'event', icon: 'clock', name: '○秒ごと',
    label: ['@sec', '秒ごと'], slots: { sec: num(1, 0.1, 3600) }, bodies: ['body'],
    hint: '決まった時間ごとに動きます。ときどき何かを起こしたいときに。' });
  reg({ type: 'onClick', kind: 'event', cat: 'event', icon: 'mouse', name: 'クリックしたとき',
    label: ['クリック／タップしたとき'], bodies: ['body'],
    hint: 'プレビューをクリック（スマホはタップ）した瞬間に動きます。' });
  reg({ type: 'onMove', kind: 'event', cat: 'event', icon: 'mouse', name: 'マウスが動いたとき',
    label: ['マウス（指）が動いたとき'], bodies: ['body'],
    hint: 'プレビューの上でマウスや指を動かしている間、くりかえし動きます。' });

  /* ================= へんすう ================= */
  reg({ type: 'set', kind: 'stmt', cat: 'var', icon: 'variable', name: 'へんすうを〜にする',
    label: ['へんすう ', '@name', ' を ', '@value', ' にする'],
    slots: { name: { t: 'var', def: '' }, value: { t: 'any', def: 0 } },
    hint: '数や文字に名前をつけてしまっておきます。あとで「へんすうの値」ブロックで取り出せます。',
    run: function (rt, b, env) { rt.setVar(b.in.name, rt.any(b, 'value', env), b); } });
  reg({ type: 'change', kind: 'stmt', cat: 'var', icon: 'variable', name: 'へんすうをふやす',
    label: ['へんすう ', '@name', ' を ', '@by', ' ふやす'],
    slots: { name: { t: 'var', def: '' }, by: num(1) },
    hint: '数のへんすうを増やします。マイナスの数なら減ります。',
    run: function (rt, b, env) {
      var by = rt.num(b, 'by', env);
      var cur = rt.getVar(b.in.name, b);
      if (typeof cur !== 'number') rt.fail(b, 'へんすう「' + b.in.name + '」は数ではないので、ふやせません。', 'type');
      rt.setVar(b.in.name, rt.finite(cur + by, b), b);
    } });

  /* ================= 流れ ================= */
  reg({ type: 'repeat', kind: 'stmt', cat: 'flow', icon: 'loop', name: 'くりかえす',
    label: ['@times', ' 回くりかえす'], slots: { times: num(10, 0, 100000) }, bodies: ['body'],
    hint: '中のブロックを、指定した回数だけくりかえします。「くりかえし番号」で何回目かがわかります。',
    run: function (rt, b, env) {
      var n = Math.floor(rt.num(b, 'times', env));
      if (n > rt.limits.maxRepeat) rt.fail(b, 'くりかえしの回数が多すぎます（' + n + ' 回）。' + rt.limits.maxRepeat + ' 回までにしてください。', 'limit');
      for (var i = 1; i <= n; i++) {
        env.loops.push(i);
        try { rt.execList(b.body, env); } finally { env.loops.pop(); }
      }
    } });
  reg({ type: 'if', kind: 'stmt', cat: 'flow', icon: 'branch', name: 'もし〜なら',
    label: ['もし ', '@cond', ' なら'], slots: { cond: { t: 'bool', def: true } }, bodies: ['then', 'else'],
    bodyLabels: { then: '', else: 'そうでなければ' },
    hint: '条件が合っているときだけ中のブロックを動かします。「そうでなければ」の側は、合っていないときに動きます。',
    run: function (rt, b, env) { rt.execList(rt.bool(b, 'cond', env) ? b.then : b.else, env); } });
  reg({ type: 'stop', kind: 'stmt', cat: 'flow', icon: 'stop', name: 'ここで終了',
    label: ['ここで終了（止める）'],
    hint: 'プログラム全体を終わらせます。ゲームオーバーのときなどに使います。',
    run: function (rt) { throw rt.SIG_STOP; } });
  reg({ type: 'reset', kind: 'stmt', cat: 'flow', icon: 'reset', name: 'リセットしてやり直す',
    label: ['結果をリセットしてやり直す'],
    hint: '画面とへんすうを最初の状態に戻して、「はじまったとき」からやり直します。このブロックの後ろは動きません。',
    run: function (rt, b, env) {
      if (env.inStart) rt.fail(b, '「はじまったとき」の中ではリセットできません（無限にくりかえしてしまうため）。', 'logic');
      throw rt.SIG_RESET;
    } });
  reg({ type: 'note', kind: 'stmt', cat: 'flow', icon: 'note', name: 'メモ',
    label: ['メモ: ', '@text'], slots: { text: { t: 'text', def: '', max: 80 } },
    hint: '自分用のメモです。動作には影響しません。',
    run: function () { /* 何もしない */ } });

  /* ================= 描く ================= */
  reg({ type: 'clear', kind: 'stmt', cat: 'draw', icon: 'brush', name: '画面を消す',
    label: ['画面を背景色で消す'],
    hint: '描いたものをすべて消します。動かすときは、毎回これで消してから描きなおします。',
    run: function (rt) { rt.clearScreen(1); } });
  reg({ type: 'fade', kind: 'stmt', cat: 'draw', icon: 'brush', name: '画面をうすく消す',
    label: ['画面を ', '@amount', ' ％ うすく消す'], slots: { amount: num(12, 0, 100) },
    hint: '前に描いたものを少しだけ消します。動くものの尻尾（残像）が作れます。',
    run: function (rt, b, env) { rt.clearScreen(rt.num(b, 'amount', env) / 100); } });
  reg({ type: 'draw', kind: 'stmt', cat: 'draw', icon: 'shapes', name: '図形を描く',
    label: ['図形 ', '@shape', ' を描く'], slots: { shape: { t: 'enum', def: 'circle', options: SHAPES } },
    hint: '今の「色・大きさ・位置・向き」で図形を1つ描きます。',
    run: function (rt, b) { rt.drawShape(b.in.shape, b); } });
  reg({ type: 'text', kind: 'stmt', cat: 'draw', icon: 'text', name: '文字を描く',
    label: ['文字 ', '@text', ' を描く'], slots: { text: { t: 'text', def: 'HELLO' } },
    hint: '今の「色・大きさ・位置」で文字を描きます。点数の表示などに使います。大きさは文字の高さです。',
    run: function (rt, b, env) { rt.drawText(rt.text(b, 'text', env), b); } });

  /* ================= 色・位置（ペンの状態。各スクリプトの最初にリセットされる） ================= */
  reg({ type: 'fill', kind: 'stmt', cat: 'style', icon: 'palette', name: '色を決める',
    label: ['色を ', '@color', ' にする'], slots: { color: { t: 'color', def: '#b8ff3d' } },
    hint: '描くときの色を決めます。「色相・彩度・明るさ」ブロックで虹色も作れます。',
    run: function (rt, b, env) { rt.pen.color = rt.color(b, 'color', env); } });
  reg({ type: 'size', kind: 'stmt', cat: 'style', icon: 'shapes', name: '大きさを決める',
    label: ['大きさを ', '@n', ' にする'], slots: { n: num(40, 1, 3000) },
    hint: '図形の大きさ（円は直径）を決めます。',
    run: function (rt, b, env) { rt.pen.size = rt.clamp(rt.num(b, 'n', env), 1, 3000); } });
  reg({ type: 'moveTo', kind: 'stmt', cat: 'style', icon: 'arrow', name: '位置を決める',
    label: ['位置を x ', '@x', ' y ', '@y', ' にする'], slots: { x: num(400, -5000, 5000), y: num(250, -5000, 5000) },
    hint: '描く場所を決めます。左上が (0, 0)、右へ行くほど x、下へ行くほど y が大きくなります。',
    run: function (rt, b, env) { rt.pen.x = rt.num(b, 'x', env); rt.pen.y = rt.num(b, 'y', env); } });
  reg({ type: 'moveBy', kind: 'stmt', cat: 'style', icon: 'arrow', name: '位置をずらす',
    label: ['位置を x ', '@dx', ' y ', '@dy', ' だけずらす'], slots: { dx: num(10, -5000, 5000), dy: num(0, -5000, 5000) },
    hint: '今の場所から、指定した分だけずらします。',
    run: function (rt, b, env) { rt.pen.x += rt.num(b, 'dx', env); rt.pen.y += rt.num(b, 'dy', env); } });
  reg({ type: 'angle', kind: 'stmt', cat: 'style', icon: 'reset', name: '向きを決める',
    label: ['向きを ', '@deg', ' 度にする'], slots: { deg: num(0, -3600, 3600) },
    hint: '図形をかたむけます。時計まわりに回ります。',
    run: function (rt, b, env) { rt.pen.angle = rt.num(b, 'deg', env); } });
  reg({ type: 'alpha', kind: 'stmt', cat: 'style', icon: 'eye', name: '濃さを決める',
    label: ['濃さを ', '@pct', ' ％ にする'], slots: { pct: num(100, 0, 100) },
    hint: '100 ならはっきり、小さいほど透けます。',
    run: function (rt, b, env) { rt.pen.alpha = rt.clamp(rt.num(b, 'pct', env), 0, 100) / 100; } });

  /* ================= 値: 計算・乱数 ================= */
  reg({ type: 'var', kind: 'expr', cat: 'var', out: 'any', icon: 'variable', name: 'へんすうの値',
    label: ['@name'], slots: { name: { t: 'var', def: '' } },
    hint: 'しまっておいたへんすうの今の値です。',
    eval: function (rt, b) { return rt.getVar(b.in.name, b); } });
  reg({ type: 'calc', kind: 'expr', cat: 'calc', out: 'num', icon: 'calc', name: '計算',
    label: ['@a', ' ', '@op', ' ', '@b'],
    slots: { a: num(0), op: { t: 'enum', def: 'add', options: [['add', '＋'], ['sub', '−'], ['mul', '×'], ['div', '÷'], ['mod', '余り'], ['min', '小さい方'], ['max', '大きい方']] }, b: num(1) },
    hint: '足し算・引き算・かけ算・わり算などをします。',
    eval: function (rt, b, env) {
      var x = rt.num(b, 'a', env), y = rt.num(b, 'b', env), op = b.in.op;
      if ((op === 'div' || op === 'mod') && y === 0) rt.fail(b, '0 でわり算はできません。', 'logic');
      var r = op === 'add' ? x + y : op === 'sub' ? x - y : op === 'mul' ? x * y : op === 'div' ? x / y
        : op === 'mod' ? ((x % y) + y) % y : op === 'min' ? Math.min(x, y) : Math.max(x, y);
      return rt.finite(r, b);
    } });
  reg({ type: 'fn', kind: 'expr', cat: 'calc', out: 'num', icon: 'calc', name: 'sin・cos など',
    label: ['@fn', ' ( ', '@x', ' )'],
    slots: { fn: { t: 'enum', def: 'sin', options: [['sin', 'sin（度）'], ['cos', 'cos（度）'], ['abs', '絶対値'], ['round', '四捨五入'], ['floor', '切り捨て'], ['ceil', '切り上げ'], ['sqrt', '平方根']] }, x: num(0) },
    hint: 'sin と cos は波や円運動を作るのに便利です（角度は「度」）。sin(時間×90) は ゆっくり −1〜1 をゆれ動きます。',
    eval: function (rt, b, env) {
      var x = rt.num(b, 'x', env), f = b.in.fn, r;
      if (f === 'sin') r = Math.sin(x * Math.PI / 180);
      else if (f === 'cos') r = Math.cos(x * Math.PI / 180);
      else if (f === 'abs') r = Math.abs(x);
      else if (f === 'round') r = Math.round(x);
      else if (f === 'floor') r = Math.floor(x);
      else if (f === 'ceil') r = Math.ceil(x);
      else { if (x < 0) rt.fail(b, '負の数の平方根は計算できません。', 'logic'); r = Math.sqrt(x); }
      return rt.finite(r, b);
    } });
  reg({ type: 'rand', kind: 'expr', cat: 'calc', out: 'num', icon: 'dice', name: '乱数',
    label: ['@a', ' 〜 ', '@b', ' の乱数'], slots: { a: num(0), b: num(100) },
    hint: '指定した範囲のランダムな数（小数あり）です。',
    eval: function (rt, b, env) {
      var x = rt.num(b, 'a', env), y = rt.num(b, 'b', env);
      return rt.finite(x + rt.rng() * (y - x), b);
    } });
  reg({ type: 'randInt', kind: 'expr', cat: 'calc', out: 'num', icon: 'dice', name: '整数の乱数',
    label: ['@a', ' 〜 ', '@b', ' の整数の乱数'], slots: { a: num(1), b: num(6) },
    hint: '指定した範囲のランダムな整数です（両端を含む）。サイコロなら 1〜6。',
    eval: function (rt, b, env) {
      var x = Math.ceil(rt.num(b, 'a', env)), y = Math.floor(rt.num(b, 'b', env));
      if (y < x) { var t = x; x = y; y = t; }
      return x + Math.floor(rt.rng() * (y - x + 1));
    } });
  reg({ type: 'compare', kind: 'expr', cat: 'calc', out: 'bool', icon: 'branch', name: '比べる',
    label: ['@a', ' ', '@op', ' ', '@b'],
    slots: { a: { t: 'any', def: 0 }, op: { t: 'enum', def: 'lt', options: [['lt', '＜'], ['le', '≦'], ['eq', '＝'], ['ne', '≠'], ['ge', '≧'], ['gt', '＞']] }, b: { t: 'any', def: 0 } },
    hint: '2つを比べて、合っていれば「はい」、違えば「いいえ」になります。「もし」ブロックに差し込みます。',
    eval: function (rt, b, env) {
      var x = rt.any(b, 'a', env), y = rt.any(b, 'b', env), op = b.in.op;
      if (op === 'eq' || op === 'ne') {
        var same = (typeof x === 'number' && typeof y === 'number') ? x === y : String(x) === String(y);
        return op === 'eq' ? same : !same;
      }
      if (typeof x !== 'number' || typeof y !== 'number') rt.fail(b, '「' + (op === 'lt' || op === 'le' ? '＜ ≦' : '＞ ≧') + '」で比べられるのは数だけです。', 'type');
      return op === 'lt' ? x < y : op === 'le' ? x <= y : op === 'ge' ? x >= y : x > y;
    } });
  reg({ type: 'logic', kind: 'expr', cat: 'calc', out: 'bool', icon: 'branch', name: 'かつ・または',
    label: ['@a', ' ', '@op', ' ', '@b'],
    slots: { a: { t: 'bool', def: true }, op: { t: 'enum', def: 'and', options: [['and', 'かつ'], ['or', 'または']] }, b: { t: 'bool', def: true } },
    hint: '2つの条件を組み合わせます。',
    eval: function (rt, b, env) {
      var x = rt.bool(b, 'a', env), y = rt.bool(b, 'b', env);
      return b.in.op === 'and' ? (x && y) : (x || y);
    } });
  reg({ type: 'not', kind: 'expr', cat: 'calc', out: 'bool', icon: 'branch', name: '〜ではない',
    label: ['@a', ' ではない'], slots: { a: { t: 'bool', def: true } },
    hint: '「はい」と「いいえ」を入れかえます。',
    eval: function (rt, b, env) { return !rt.bool(b, 'a', env); } });
  reg({ type: 'join', kind: 'expr', cat: 'calc', out: 'text', icon: 'text', name: '文字をつなぐ',
    label: ['@a', ' と ', '@b', ' をつなぐ'], slots: { a: { t: 'text', def: 'SCORE ' }, b: { t: 'text', def: '' } },
    hint: '文字と数をつなげて1つの文字にします。「文字を描く」で点数を表示するときに。',
    eval: function (rt, b, env) { return (rt.text(b, 'a', env) + rt.text(b, 'b', env)).slice(0, rt.limits.maxText); } });
  reg({ type: 'hsl', kind: 'expr', cat: 'calc', out: 'color', icon: 'palette', name: '色相・彩度・明るさ',
    label: ['色相 ', '@h', ' 彩度 ', '@s', ' 明るさ ', '@l', ' の色'], slots: { h: num(200), s: num(80, 0, 100), l: num(60, 0, 100) },
    hint: '色相（0〜360 で色の種類が一周）・彩度（あざやかさ）・明るさから色を作ります。色相を変えると虹色になります。',
    eval: function (rt, b, env) {
      var h = rt.num(b, 'h', env), s = rt.num(b, 's', env), l = rt.num(b, 'l', env);
      h = ((Math.round(h) % 360) + 360) % 360;
      return 'hsl(' + h + ',' + Math.round(rt.clamp(s, 0, 100)) + '%,' + Math.round(rt.clamp(l, 0, 100)) + '%)';
    } });
  reg({ type: 'dist', kind: 'expr', cat: 'calc', out: 'num', icon: 'arrow', name: '2点の距離',
    label: ['(', '@x1', ', ', '@y1', ') と (', '@x2', ', ', '@y2', ') の距離'],
    slots: { x1: num(0), y1: num(0), x2: num(0), y2: num(0) },
    hint: '2つの点のあいだの長さです。「マウスが的に近いか」の判定などに使います。',
    eval: function (rt, b, env) {
      var dx = rt.num(b, 'x1', env) - rt.num(b, 'x2', env), dy = rt.num(b, 'y1', env) - rt.num(b, 'y2', env);
      return rt.finite(Math.sqrt(dx * dx + dy * dy), b);
    } });

  /* ================= 値: マウス・時間 ================= */
  function sensor(type, name, label, out, hint, fn) {
    reg({ type: type, kind: 'expr', cat: 'input', out: out, icon: type === 'time' || type === 'frame' ? 'clock' : 'mouse', name: name, label: [label], hint: hint,
      eval: function (rt, b, env) { return fn(rt, env, b); } });
  }
  sensor('mouseX', 'マウスの x', 'マウスの x', 'num', 'マウス（指）がいる場所の横位置です。', function (rt) { return rt.mouse.x; });
  sensor('mouseY', 'マウスの y', 'マウスの y', 'num', 'マウス（指）がいる場所の縦位置です。', function (rt) { return rt.mouse.y; });
  sensor('mouseDown', 'おしている', 'マウスをおしている', 'bool', 'マウスのボタン（指）をおしている間は「はい」です。', function (rt) { return rt.mouse.down; });
  sensor('time', '経過時間', '経過した秒数', 'num', '実行してから何秒たったかです（一時停止の間は進みません）。', function (rt) { return rt.time; });
  sensor('frame', 'フレーム数', 'フレーム数', 'num', '実行してから何コマ動いたかです。', function (rt) { return rt.frame; });
  sensor('width', '画面の幅', '画面の幅', 'num', 'プレビュー画面の横の長さです。', function (rt) { return rt.W; });
  sensor('height', '画面の高さ', '画面の高さ', 'num', 'プレビュー画面の縦の長さです。', function (rt) { return rt.H; });
  sensor('loopIndex', 'くりかえし番号', 'くりかえし番号', 'num', '「くりかえす」の中で、今が何回目か（1, 2, 3…）です。', function (rt, env, b) {
    if (!env.loops.length) rt.fail(b, '「くりかえし番号」は「くりかえす」の中でだけ使えます。', 'logic');
    return env.loops[env.loops.length - 1];
  });

  /* ================= 未対応ブロックの置き場（保存データを壊さないための目印。実行はできない） ================= */
  reg({ type: 'unknown', kind: 'stmt', cat: 'flow', out: 'any', icon: 'alert', name: '未対応のブロック', hidden: true,
    label: ['未対応のブロック'], hint: 'このバージョンでは使えないブロックです。削除してください。',
    run: function () { /* validate() が先に拒否する */ } });

  /** パレットに並べる順（カテゴリごと）。値ブロックは入力欄のポップアップから選ぶ */
  Cr.paletteOrder = function (cat) {
    var out = [];
    Object.keys(SPEC).forEach(function (k) { var s = SPEC[k]; if (s.cat === cat && !s.hidden) out.push(s); });
    return out;
  };

  Cr.has = function (type) { return typeof type === 'string' && type in SPEC; };
  Cr.spec = function (type) { return Cr.has(type) ? SPEC[type] : null; };
})();
