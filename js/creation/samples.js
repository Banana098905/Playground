/*
 * Creation Engine — サンプル作品（PZ.creation.SAMPLES）
 * どれも通常のブロック構成（検証を通る普通のデータ）です。選ぶと編集画面に「未保存の新規」として読み込まれ、
 * 自由に変えて実行できます。サンプル自体は書き換わりません。
 * ID はここでは付けません（読み込み時に validate が振ります）。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var Cr = (PZ.creation = PZ.creation || {});

  /* ---- 組み立て用の小さなヘルパー ---- */
  function B(type, inn, bodies) {
    var o = { type: type, in: inn || {} };
    if (bodies) Object.keys(bodies).forEach(function (k) { o[k] = bodies[k]; });
    return o;
  }
  function V(n) { return B('var', { name: n }); }
  function calc(a, op, b) { return B('calc', { a: a, op: op, b: b }); }
  function add(a, b) { return calc(a, 'add', b); }
  function sub(a, b) { return calc(a, 'sub', b); }
  function mul(a, b) { return calc(a, 'mul', b); }
  function div(a, b) { return calc(a, 'div', b); }
  function sin(x) { return B('fn', { fn: 'sin', x: x }); }
  function cos(x) { return B('fn', { fn: 'cos', x: x }); }
  function abs(x) { return B('fn', { fn: 'abs', x: x }); }
  function rand(a, b) { return B('rand', { a: a, b: b }); }
  function randInt(a, b) { return B('randInt', { a: a, b: b }); }
  function cmp(a, op, b) { return B('compare', { a: a, op: op, b: b }); }
  function hsl(h, s, l) { return B('hsl', { h: h, s: s, l: l }); }
  function set(n, v) { return B('set', { name: n, value: v }); }
  function change(n, by) { return B('change', { name: n, by: by }); }
  function fill(c) { return B('fill', { color: c }); }
  function size(n) { return B('size', { n: n }); }
  function moveTo(x, y) { return B('moveTo', { x: x, y: y }); }
  function draw(shape) { return B('draw', { shape: shape }); }
  function text(t) { return B('text', { text: t }); }
  function join(a, b) { return B('join', { a: a, b: b }); }
  function note(t) { return B('note', { text: t }); }
  var MX = B('mouseX'), MY = B('mouseY'), TIME = B('time'), W = B('width'), H = B('height'), I = B('loopIndex');
  function when(type, body, inn) { return B(type, inn || {}, { body: body }); }
  function repeat(times, body) { return B('repeat', { times: times }, { body: body }); }
  function iff(cond, then, els) { return B('if', { cond: cond }, { then: then, else: els || [] }); }
  function tune(name, value, min, max, step) { return { name: name, value: value, tune: { min: min, max: max, step: step || 1 } }; }

  var SAMPLES = [
    /* ---------- 1. クリックで色が変わる図形 ---------- */
    {
      id: 'click-color', name: 'クリックで色が変わる図形', level: 1,
      summary: '図形をクリックすると色がランダムに変わる、いちばん小さな実験。',
      tryIt: ['プレビューをクリックして色を変える', '「大きさ」のつまみで図形を大きくする', '「ずっと」の中の sin を ×200 にして、脈打つ速さを変える'],
      program: {
        description: 'クリックすると「色相」がランダムに変わります。色相は 0〜360 で、色の種類が一周します。',
        canvas: { w: 800, h: 500, bg: '#101215' },
        vars: [tune('色相', 200, 0, 360, 1), tune('大きさ', 160, 40, 320, 5)],
        scripts: [
          when('onClick', [set('色相', randInt(0, 360))]),
          when('onTick', [
            B('clear'),
            fill(hsl(V('色相'), 85, 60)),
            size(add(V('大きさ'), mul(sin(mul(TIME, 120)), 10))),
            draw('circle'),
            fill(hsl(add(V('色相'), 180), 85, 72)),
            size(mul(V('大きさ'), 0.38)),
            draw('star'),
            fill('#98a1b0'), size(18), moveTo(400, 468), text('CLICK!')
          ])
        ]
      }
    },

    /* ---------- 2. ランダム模様ジェネレーター ---------- */
    {
      id: 'random-pattern', name: 'ランダム模様ジェネレーター', level: 2,
      summary: '乱数で図形を散らして、毎回ちがう模様をつくる。クリックで新しい模様。',
      tryIt: ['クリックして何度も作りなおす', '「数」のつまみを増やして、びっしり埋める', '「図形を描く」を星や三角に変える'],
      program: {
        description: 'はじまったときに乱数で図形をたくさん描きます。クリックで「リセットしてやり直す」と、別の模様になります。',
        canvas: { w: 800, h: 500, bg: '#101215' },
        vars: [tune('数', 70, 10, 300, 10)],
        scripts: [
          when('onStart', [
            B('clear'),
            set('色相', rand(0, 360)),
            repeat(V('数'), [
              fill(hsl(add(V('色相'), rand(-40, 40)), 80, rand(45, 72))),
              B('alpha', { pct: rand(35, 90) }),
              size(rand(14, 110)),
              moveTo(rand(0, 800), rand(0, 500)),
              B('angle', { deg: rand(0, 360) }),
              iff(cmp(randInt(1, 3), 'eq', 1), [draw('circle')], [iff(cmp(randInt(1, 2), 'eq', 1), [draw('square')], [draw('triangle')])])
            ])
          ]),
          when('onClick', [note('クリックしたら最初からやり直し（新しい乱数で）'), B('reset')])
        ]
      }
    },

    /* ---------- 3. マウスに反応する粒子 ---------- */
    {
      id: 'mouse-particles', name: 'マウスに反応する粒子', level: 2,
      summary: 'マウス（指）のまわりを、虹色の粒がうずを巻いてついてくる。',
      tryIt: ['マウスを動かして粒を連れまわす', 'クリックすると粒がふわっと広がる', '「粒の数」のつまみで密度を変える'],
      program: {
        description: '粒はすべて「くりかえし番号」から位置を計算しています。クリックで「広がり」が大きくなり、少しずつ戻ります。',
        canvas: { w: 800, h: 500, bg: '#101215' },
        vars: [tune('粒の数', 40, 8, 120, 4), { name: '広がり', value: 0 }],
        scripts: [
          when('onStart', [B('clear')]),
          when('onClick', [set('広がり', 90)]),
          when('onTick', [
            B('fade', { amount: 16 }),
            set('広がり', calc(mul(V('広がり'), 0.93), 'max', 0)),
            repeat(V('粒の数'), [
              set('角度', add(mul(I, div(720, V('粒の数'))), mul(TIME, 100))),
              set('半径', add(add(20, mul(I, div(70, V('粒の数')))), V('広がり'))),
              fill(hsl(add(mul(I, div(360, V('粒の数'))), mul(TIME, 50)), 90, 62)),
              size(add(4, mul(div(I, V('粒の数')), 9))),
              moveTo(add(MX, mul(cos(V('角度')), V('半径'))), add(MY, mul(sin(V('角度')), V('半径')))),
              draw('circle')
            ])
          ])
        ]
      }
    },

    /* ---------- 4. 条件で動きが変わるシミュレーション ---------- */
    {
      id: 'bouncing-ball', name: 'はねるボール（条件で動きが変わる）', level: 3,
      summary: '壁や床にぶつかると向きと色が変わる。マウスをおすとボールが引き寄せられる。',
      tryIt: ['「重力」を 0 にして宇宙空間にする', '画面をおしっぱなしにして、ボールを引き寄せる', '「もし」ブロックの条件や、色の変わり方を変えてみる'],
      program: {
        description: '「もし」ブロックで、壁・床・マウスのおし方によって動きを変えています。ボールの速さは へんすう vx, vy で持っています。',
        canvas: { w: 800, h: 500, bg: '#101215' },
        vars: [
          { name: 'x', value: 400 }, { name: 'y', value: 120 }, { name: 'vx', value: 3.4 }, { name: 'vy', value: 0 }, { name: '色相', value: 200 },
          tune('重力', 0.3, 0, 1, 0.05), tune('はねかえり', 0.86, 0.3, 1, 0.02), tune('半径', 28, 10, 80, 2)
        ],
        scripts: [
          when('onStart', [B('clear')]),
          when('onTick', [
            B('fade', { amount: 30 }),
            change('vy', V('重力')),
            iff(B('mouseDown'), [change('vx', mul(sub(MX, V('x')), 0.004)), change('vy', mul(sub(MY, V('y')), 0.004))]),
            change('x', V('vx')),
            change('y', V('vy')),
            iff(cmp(V('x'), 'gt', sub(W, V('半径'))), [set('x', sub(W, V('半径'))), set('vx', mul(V('vx'), -1)), change('色相', 47)]),
            iff(cmp(V('x'), 'lt', V('半径')), [set('x', V('半径')), set('vx', mul(V('vx'), -1)), change('色相', 47)]),
            iff(cmp(V('y'), 'gt', sub(H, V('半径'))), [
              set('y', sub(H, V('半径'))),
              set('vy', mul(mul(V('vy'), -1), V('はねかえり'))),
              change('色相', 47),
              note('止まりそうになったら、上へ蹴り上げる'),
              iff(cmp(abs(V('vy')), 'lt', 1.6), [set('vy', -13)])
            ]),
            fill(hsl(V('色相'), 85, 60)),
            size(mul(V('半径'), 2)),
            moveTo(V('x'), V('y')),
            draw('circle')
          ])
        ]
      }
    },

    /* ---------- 5. ミニゲームの基本ルール ---------- */
    {
      id: 'catch-game', name: 'ミニゲーム: 的をつかまえろ', level: 3,
      summary: '落ちてくる的をクリックして点数をかせぐ。つまみでルールを変えられる。',
      tryIt: ['的をクリックして点数をかせぐ', '「落ちる速さ」「的の大きさ」「ライフ」のつまみでむずかしさを変える', '当たったときの処理に「色を変える」などを足す'],
      program: {
        description: '的の位置はへんすう（的x・的y）、ルールはつまみ（速さ・加速・的の大きさ・ライフ）で持っています。ライフが 0 になると「ここで終了」で止まります。',
        canvas: { w: 800, h: 500, bg: '#101215' },
        vars: [
          tune('速さ', 2.6, 1, 8, 0.2), tune('加速', 0.3, 0, 1.5, 0.1), tune('的の大きさ', 72, 30, 140, 2), tune('ライフ', 3, 1, 9, 1),
          { name: 'スコア', value: 0 }, { name: '的x', value: 400 }, { name: '的y', value: -40 }
        ],
        scripts: [
          when('onStart', [B('clear'), set('的x', randInt(60, sub(W, 60)))]),
          when('onClick', [
            note('マウスが的の近くなら、当たり'),
            iff(cmp(B('dist', { x1: MX, y1: MY, x2: V('的x'), y2: V('的y') }), 'lt', add(div(V('的の大きさ'), 2), 8)), [
              change('スコア', 1),
              change('速さ', V('加速')),
              set('的y', -40),
              set('的x', randInt(60, sub(W, 60)))
            ])
          ]),
          when('onTick', [
            B('clear'),
            change('的y', V('速さ')),
            iff(cmp(V('的y'), 'gt', add(H, div(V('的の大きさ'), 2))), [
              note('見のがした → ライフが減る'),
              change('ライフ', -1),
              set('的y', -40),
              set('的x', randInt(60, sub(W, 60))),
              iff(cmp(V('ライフ'), 'le', 0), [
                fill('#ff5d73'), size(60), moveTo(div(W, 2), sub(div(H, 2), 20)), text('GAME OVER'),
                fill('#eceff4'), size(26), moveTo(div(W, 2), add(div(H, 2), 40)), text(join('SCORE ', V('スコア'))),
                B('stop')
              ])
            ]),
            fill(hsl(mul(TIME, 120), 90, 60)), size(V('的の大きさ')), moveTo(V('的x'), V('的y')), draw('circle'),
            fill('#101215'), size(mul(V('的の大きさ'), 0.5)), draw('circle'),
            fill('#eceff4'), size(22), moveTo(90, 28), text(join('SCORE ', V('スコア'))),
            moveTo(sub(W, 90), 28), text(join('LIFE ', V('ライフ')))
          ])
        ]
      }
    }
  ];

  Cr.SAMPLES = SAMPLES.map(function (s) { return { id: s.id, name: s.name, level: s.level, summary: s.summary, tryIt: s.tryIt }; });

  /** サンプルのブロック構成（検証済みの新しいコピー。ID は毎回新しく振る）。無ければ null */
  Cr.sampleProgram = function (id) {
    for (var i = 0; i < SAMPLES.length; i++) {
      if (SAMPLES[i].id === id) {
        var p = JSON.parse(JSON.stringify(SAMPLES[i].program));
        p.origin = 'sample:' + id;
        return Cr.validate(p).clean;
      }
    }
    return null;
  };
  Cr.sampleInfo = function (id) {
    for (var i = 0; i < Cr.SAMPLES.length; i++) if (Cr.SAMPLES[i].id === id) return Cr.SAMPLES[i];
    return null;
  };
})();
