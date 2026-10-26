/*
 * 実験レジストリ: ライブラリに載る「実際に動く実験」の一覧とメタデータ。
 * ここに載せるのは実装済みの実験だけ（未実装のものを完成済みに見せない）。
 *
 * 各実験の本体は PZ.labs[id] が持つ:
 *   defaults / normalize(params) / render(ctx, w, h, params) / random(rnd)
 * 新しい実験を足す手順は docs/ARCHITECTURE.md の「実験を追加する」を参照。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  PZ.labs = PZ.labs || {};
  var U = PZ.util;
  var R = (PZ.registry = {});

  /** ジャンル一覧（表示順）。実際に実験があるジャンルだけがライブラリに出る */
  var GENRE_ORDER = ['Generative Art', 'Particles', 'Geometry', 'Color', 'Motion', 'Physics', 'Interactive'];
  var GENRE_NOTE = {
    'Generative Art': 'ルールから絵を生む',
    'Particles': '粒子の群れ',
    'Geometry': '図形と幾何学',
    'Color': '色と配色',
    'Motion': '動き',
    'Physics': 'バネ・重力',
    'Interactive': '触って変わる'
  };

  var TOOLS = [
    {
      id: 'particles', code: 'LAB-01', name: 'Particle Lab', icon: 'particles', path: '/lab/particles',
      genres: ['Particles', 'Interactive'], tags: ['粒子', 'マウス反応', '残像', 'タッチ対応'],
      summary: '動く粒子の数・速度・色を調整。マウスに引き寄せられたり、弾かれたり、渦を巻いたり。',
      howto: ['カーソル（スマホは指）を動かすと、粒子が反応します。', '「マウスへの反応」で、引き寄せる／弾く／渦を切り替えられます。', '残像を長くすると、粒子の軌跡が絵になります。', '「保存」で設定を作品として残し、あとで再開できます。']
    },
    {
      id: 'shapes', code: 'LAB-02', name: 'Shape Machine', icon: 'shapes', path: '/lab/shapes',
      genres: ['Geometry', 'Generative Art'], tags: ['図形生成', 'シード再現', 'Studio連携'],
      summary: '図形を自動生成して、配置・色・数をいじる。ランダムで偶然の構図を探し、Studioへ引き継ぎ。',
      howto: ['キャンバスをクリックすると、別のシードで新しい構図が生まれます。', '同じシード値なら、同じ構図を何度でも再現できます。', '「Studioで開く」で図形を作品として引き継ぎ、細かく編集できます。', '「保存」で設定（シード・配置・色）を残し、あとから変更できます。']
    },
    {
      id: 'flow', code: 'LAB-03', name: 'Flow Field', icon: 'flow', path: '/lab/flow',
      genres: ['Generative Art', 'Particles', 'Motion'], tags: ['流れ', 'ノイズ', 'シード再現', '画像保存'],
      summary: '見えない風の流れに乗って、無数の粒子が線を描く。流れの向き・強さ・色を変えて模様を育てる。',
      howto: ['流れの向きと乱れ（強さ）を動かすと、模様の性格が変わります。', '粒子の数・速度・線の太さで、密度と勢いを調整します。', '「ランダム生成」で新しい流れを作成。気に入ったらシード値で再現できます。', '一時停止すると今の絵を保ったまま眺められます。「画像で保存」でPNG出力。']
    },
    {
      id: 'color', code: 'LAB-04', name: 'Color Lab', icon: 'palette', path: '/lab/color',
      genres: ['Color'], tags: ['配色', 'HEX', 'パレット保存', '調和'],
      summary: 'メインカラーから調和のとれたパレットを生成。色相・彩度・明度を調整し、HEXをコピー、お気に入りを保存。',
      howto: ['メインカラーを選ぶか、色相・彩度・明度のスライダーで調整します。', '配色ルール（補色・三色・類似色など）と色数を選ぶとパレットが生成されます。', '各色のHEXをクリックでコピー。鍵アイコンで色を固定したまま再生成できます。', '「パレットを保存」で My Space に残り、あとから開いて再編集できます。']
    },
    {
      id: 'pattern', code: 'LAB-05', name: 'Pattern Generator', icon: 'pattern', path: '/lab/pattern',
      genres: ['Geometry', 'Generative Art'], tags: ['模様', '対称', 'シード再現', 'PNG書き出し'],
      summary: '8種類の幾何学模様を、密度・大きさ・色・対称性を変えながら生成。シード値で同じ模様を再現。',
      howto: ['模様の種類を選び、密度と大きさを調整します。', '「左右対称」「四方対称」を選ぶと、鏡のような模様になります。', 'シード値が同じなら同じ模様。「ランダム生成」で新しい模様に出会えます。', '「PNGで書き出し」は高解像度（2倍）で保存します。']
    },
    {
      id: 'motion', code: 'LAB-06', name: 'Motion Playground', icon: 'motion', path: '/lab/motion',
      genres: ['Motion', 'Physics', 'Interactive'], tags: ['マウス反応', 'バネ', '重力', 'タッチ対応'],
      summary: 'カーソルや指に反応して動く図形の遊び場。追従・周回・反発・バネ・重力の動き方を切り替える。',
      howto: ['ステージの上でカーソルや指を動かすと、図形が反応します。クリック／タップで衝撃を与えられます。', '「動き方」で追従・周回・反発・バネ・重力を切り替えます。', '何も触らないときは「自動で動かす」が見本を見せてくれます。', 'スペースキーで一時停止／再開できます。']
    }
  ];
  var BY_ID = {};
  TOOLS.forEach(function (t) { BY_ID[t.id] = t; });

  R.all = function () { return TOOLS.slice(); };
  R.get = function (id) { return BY_ID[id] || null; };
  R.has = function (id) { return !!BY_ID[id]; };

  /** 実験が1つ以上あるジャンルだけ返す */
  R.genres = function () {
    return GENRE_ORDER.filter(function (g) { return TOOLS.some(function (t) { return t.genres.indexOf(g) >= 0; }); })
      .map(function (g) { return { id: g, note: GENRE_NOTE[g] || '' }; });
  };
  R.allTags = function () {
    var map = {};
    TOOLS.forEach(function (t) { t.tags.forEach(function (x) { map[x] = (map[x] || 0) + 1; }); });
    return Object.keys(map).sort(function (a, b) { return map[b] - map[a] || a.localeCompare(b, 'ja'); });
  };

  /**
   * 絞り込み。q: キーワード（名前・説明・タグ・ジャンル）, genre: 単一, tags: すべて含む, favs: お気に入りIDの配列（favOnly 時）
   */
  R.filter = function (o) {
    o = o || {};
    var q = String(o.q || '').trim().toLowerCase();
    var words = q ? q.split(/\s+/) : [];
    return TOOLS.filter(function (t) {
      if (o.genre && t.genres.indexOf(o.genre) < 0) return false;
      if (o.tags && o.tags.length && !o.tags.every(function (x) { return t.tags.indexOf(x) >= 0; })) return false;
      if (o.favOnly && (o.favs || []).indexOf(t.id) < 0) return false;
      if (words.length) {
        var hay = (t.name + ' ' + t.summary + ' ' + t.tags.join(' ') + ' ' + t.genres.join(' ') + ' ' + t.code).toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      }
      return true;
    });
  };

  R.random = function (exceptId) {
    var list = TOOLS.filter(function (t) { return t.id !== exceptId; });
    return list[Math.floor(Math.random() * list.length)];
  };

  /** ツールの静的プレビューをキャンバスへ描く（ライブラリ・ホームのカード用） */
  R.drawPreview = function (id, canvas) {
    var lab = PZ.labs[id];
    if (!lab || !canvas || !canvas.getContext) return false;
    var cw = canvas.clientWidth || 320, ch = canvas.clientHeight || 150;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try {
      if (lab.preview) lab.preview(ctx, cw, ch); else lab.render(ctx, cw, ch, lab.defaults);
    } catch (e) { if (window.console) console.warn('[PZ] preview failed', id, e); return false; }
    return true;
  };

  /** 作品カード用の小さなサムネイル(JPEG data URL)。失敗しても保存は止めない */
  R.thumbFor = function (id, params, w, h) {
    var lab = PZ.labs[id];
    if (!lab || !lab.render) return null;
    try {
      w = w || 360; h = h || 225;
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      lab.render(ctx, w, h, lab.normalize(params || {}));
      var url = c.toDataURL('image/jpeg', 0.72);
      return url.length < PZ.config.limits.thumbBytes ? url : null;
    } catch (e) { return null; }
  };
})();
