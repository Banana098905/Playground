/*
 * Remix Engine — 付属の部品（PZ.remix.parts.builtins）
 *
 * どれも「普通のブロック」だけでできています（Creation Engine に新しい実行の仕組みは足していません）。
 * そのため、挿入すればそのまま動きます（scripts/test-remix.js が実際に実行して確かめています）。
 * ID は固定（'builtin:…'）で、保存データには含まれません。ユーザーが消したり書き換えたりもできません。
 *   - 設定値(params)  … 挿入するときに変えられる数・色
 *   - 必要なへんすう  … 作品側にあるへんすうを使う部品（なければ、作るか接続する）
 *   - 出力            … 部品が値を入れるへんすう（ほかのブロックから読める）
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var Cr = PZ.creation;
  var R = (PZ.remix = PZ.remix || {});
  var P = (R.parts = R.parts || {});

  function B(type, inn, bodies, id) {
    var o = { type: type, in: inn || {} };
    if (id) o.id = id;
    if (bodies) Object.keys(bodies).forEach(function (k) { o[k] = bodies[k]; });
    return o;
  }
  function V(n) { return B('var', { name: n }); }
  function calc(a, op, b, id) { return B('calc', { a: a, op: op, b: b }, null, id); }
  function cmp(a, op, b, id) { return B('compare', { a: a, op: op, b: b }, null, id); }
  function set(n, v) { return B('set', { name: n, value: v }); }
  function change(n, by, id) { return B('change', { name: n, by: by }, null, id); }
  var MX = B('mouseX'), MY = B('mouseY'), W = B('width'), H = B('height');

  var DEFS = [
    {
      id: 'builtin:random-color', name: 'ランダムな色を選ぶ', kind: 'stmt', tags: ['色', '乱数'],
      description: '色相をランダムに選んで、描く色にします。「色・位置」のあとに図形を描くと、その色になります。',
      blocks: [B('fill', { color: B('hsl', { h: B('randInt', { a: 0, b: 360 }, null, 'rc_r'), s: 80, l: 60 }, null, 'rc_h') })],
      params: [
        { key: 'hmin', label: '色相の最小', blockId: 'rc_r', slot: 'a' }, { key: 'hmax', label: '色相の最大', blockId: 'rc_r', slot: 'b' },
        { key: 'sat', label: 'あざやかさ', blockId: 'rc_h', slot: 's' }, { key: 'lit', label: '明るさ', blockId: 'rc_h', slot: 'l' }
      ]
    },
    {
      id: 'builtin:mouse-follow', name: 'マウスをなめらかに追いかける', kind: 'stmt', tags: ['マウス', '位置'],
      description: 'マウス（指）の位置へ、少しずつ近づく点の位置 fx・fy を求めて、描く位置にします。「ずっと」の中に入れて使います。',
      vars: [{ name: 'fx', value: 400 }, { name: 'fy', value: 250 }],
      blocks: [
        change('fx', calc(calc(MX, 'sub', V('fx')), 'mul', 0.15, 'mf_x')),
        change('fy', calc(calc(MY, 'sub', V('fy')), 'mul', 0.15, 'mf_y')),
        B('moveTo', { x: V('fx'), y: V('fy') })
      ],
      params: [{ key: 'ease', label: '追いかける速さ（0〜1）', blockId: 'mf_x', slot: 'b' }, { key: 'easey', label: '縦の速さ（0〜1）', blockId: 'mf_y', slot: 'b' }]
    },
    {
      id: 'builtin:interval-counter', name: '一定時間ごとに数える', kind: 'event', tags: ['時間', 'タイマー'],
      description: '決まった秒数ごとに、へんすう ticks を 1 ふやします。「ticks」を文字に出したり、条件に使ったりできます。',
      vars: [{ name: 'ticks', value: 0 }],
      blocks: [B('onTimer', { sec: 1 }, { body: [change('ticks', 1, 'ic_c')] }, 'ic_t')],
      params: [{ key: 'sec', label: '間隔（秒）', blockId: 'ic_t', slot: 'sec' }, { key: 'step', label: '1回にふやす数', blockId: 'ic_c', slot: 'by' }]
    },
    {
      id: 'builtin:circle-collision', name: '円どうしの衝突を調べる', kind: 'stmt', tags: ['衝突', '条件'],
      description: '2つの円の中心 (ax, ay) と (bx, by) の距離が、しきい値より近ければ hit を「はい」にします。ax・ay・bx・by は作品側のへんすうを使います。',
      blocks: [
        set('hit', false),
        B('if', { cond: cmp(B('dist', { x1: V('ax'), y1: V('ay'), x2: V('bx'), y2: V('by') }), 'lt', 50, 'cc_c') }, { then: [set('hit', true)], else: [] })
      ],
      params: [{ key: 'dist', label: 'ぶつかる距離', blockId: 'cc_c', slot: 'b' }]
    },
    {
      id: 'builtin:bounce-move', name: '壁ではね返って動く', kind: 'event', tags: ['動き', 'ルール'],
      description: '円が一定の速さで動き、画面のふちではね返ります。位置 bx・by と速さ bvx・bvy は「つまみ」にできるへんすうです。画面は消さず、少しずつうすく消します。',
      vars: [
        { name: 'bx', value: 400 }, { name: 'by', value: 250 },
        { name: 'bvx', value: 4, tune: { min: -12, max: 12, step: 1 } }, { name: 'bvy', value: 3, tune: { min: -12, max: 12, step: 1 } }
      ],
      blocks: [B('onTick', {}, {
        body: [
          B('fade', { amount: 35 }, null, 'bm_f'),
          change('bx', V('bvx')), change('by', V('bvy')),
          B('if', { cond: B('logic', { a: B('logic', { a: cmp(V('bx'), 'lt', 20), op: 'and', b: cmp(V('bvx'), 'lt', 0) }), op: 'or', b: B('logic', { a: cmp(V('bx'), 'gt', calc(W, 'sub', 20)), op: 'and', b: cmp(V('bvx'), 'gt', 0) }) }) },
            { then: [set('bvx', calc(V('bvx'), 'mul', -1))], else: [] }),
          B('if', { cond: B('logic', { a: B('logic', { a: cmp(V('by'), 'lt', 20), op: 'and', b: cmp(V('bvy'), 'lt', 0) }), op: 'or', b: B('logic', { a: cmp(V('by'), 'gt', calc(H, 'sub', 20)), op: 'and', b: cmp(V('bvy'), 'gt', 0) }) }) },
            { then: [set('bvy', calc(V('bvy'), 'mul', -1))], else: [] }),
          B('fill', { color: '#b8ff3d' }, null, 'bm_c'), B('size', { n: 40 }, null, 'bm_s'),
          B('moveTo', { x: V('bx'), y: V('by') }), B('draw', { shape: 'circle' })
        ]
      })],
      params: [
        { key: 'fade', label: 'うすく消す（％）', blockId: 'bm_f', slot: 'amount' },
        { key: 'color', label: '色', blockId: 'bm_c', slot: 'color' }, { key: 'size', label: '大きさ', blockId: 'bm_s', slot: 'n' }
      ]
    },
    {
      id: 'builtin:condition-combo', name: '複数の条件を組み合わせる', kind: 'stmt', tags: ['条件', '論理'],
      description: '「valueA が大きく かつ valueB が小さい」または「マウスをおしている」とき、conditionOk を「はい」にします。valueA・valueB は作品側のへんすうです。',
      blocks: [B('if', { cond: B('logic', { a: B('logic', { a: cmp(V('valueA'), 'ge', 10, 'co_a'), op: 'and', b: cmp(V('valueB'), 'le', 5, 'co_b') }), op: 'or', b: B('mouseDown') }) },
        { then: [set('conditionOk', true)], else: [set('conditionOk', false)] })],
      params: [{ key: 'ta', label: 'valueA のしきい値（以上）', blockId: 'co_a', slot: 'b' }, { key: 'tb', label: 'valueB のしきい値（以下）', blockId: 'co_b', slot: 'b' }]
    },
    {
      id: 'builtin:orbit', name: '円をえがいてまわる', kind: 'event', tags: ['動き', '三角関数'],
      description: '画面の中心のまわりを、点がぐるぐるまわります。横・縦の半径を変えると楕円になります。角度は ang に入ります。',
      vars: [{ name: 'ang', value: 0 }],
      blocks: [B('onTick', {}, {
        body: [
          B('fade', { amount: 20 }, null, 'ob_f'),
          change('ang', 3, 'ob_a'),
          B('fill', { color: '#a066ff' }, null, 'ob_c'), B('size', { n: 30 }, null, 'ob_s'),
          B('moveTo', {
            x: calc(calc(W, 'div', 2), 'add', calc(B('fn', { fn: 'cos', x: V('ang') }), 'mul', 160, 'ob_rx')),
            y: calc(calc(H, 'div', 2), 'add', calc(B('fn', { fn: 'sin', x: V('ang') }), 'mul', 160, 'ob_ry'))
          }),
          B('draw', { shape: 'circle' })
        ]
      })],
      params: [
        { key: 'speed', label: 'まわる速さ（度/コマ）', blockId: 'ob_a', slot: 'by' }, { key: 'rx', label: '横の半径', blockId: 'ob_rx', slot: 'b' },
        { key: 'ry', label: '縦の半径', blockId: 'ob_ry', slot: 'b' }, { key: 'color', label: '色', blockId: 'ob_c', slot: 'color' },
        { key: 'size', label: '大きさ', blockId: 'ob_s', slot: 'n' }, { key: 'fade', label: 'うすく消す（％）', blockId: 'ob_f', slot: 'amount' }
      ]
    }
  ];

  var cache = null;
  /** 付属の部品（検証済みのコピー）。毎回新しいオブジェクトを返す */
  P.builtins = function () {
    if (!cache) {
      cache = [];
      DEFS.forEach(function (d) {
        var raw = JSON.parse(JSON.stringify(d));
        raw.builtin = true; raw.version = 1; raw.createdAt = 0; raw.updatedAt = 0; raw.canvas = { w: 800, h: 500 };
        var s = P.sanitize(raw);
        if (s.ok) { s.comp.id = d.id; s.comp.builtin = true; cache.push(s.comp); }
        else if (typeof console !== 'undefined' && console.error) console.error('[PZ remix] 付属部品が不正です:', d.id, s.errors);
      });
    }
    return JSON.parse(JSON.stringify(cache));
  };
  P.builtinCount = DEFS.length;
})();
