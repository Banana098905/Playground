/*
 * Daily Experiment のロジック（UIなし）:
 *  - 日付キー 'YYYY-MM-DD'（利用者の現地日付）→ お題を決める
 *  - 同じ日付なら必ず同じお題。30日で一巡し、一巡ごとに並びが変わる（周期内で重複しない）
 *  - 過去の日付のお題も同じ規則で再現できる
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var U = PZ.util;
  var D = (PZ.daily = {});

  /* ---------- お題 ----------
   * tool: 主に使う実験（'studio' も可） / q: 実験に渡す初期設定 / alt: 他のツールでも挑戦できる
   */
  var THEMES = [
    { id: 'three-colors', title: '3色だけで作品を作る', hl: '3色', tool: 'pattern', q: { type: 'blocks', density: 9, seed: 3, colors: 'b8ff3d,a066ff,f2f4f8', bg: '15171b' }, alt: ['studio', 'color'],
      brief: '使っていいのは3色だけ。色を絞ると、形と配置の力が際立つ。', hints: ['最初に3色を決めてから作り始める', '1色は面積を大きく、1色はアクセントに', '背景色もその3色のどれかにしてみる'] },
    { id: 'mouse-pattern', title: 'マウスの動きで変化する模様を作る', hl: '変化する模様', tool: 'motion', q: { behavior: 'follow', shape: 'circle', count: 90, trail: 78, power: 70 }, alt: ['particles', 'flow'],
      brief: 'カーソルを動かすたびに表情が変わる模様を探そう。残像を長くすると、軌跡が絵になる。', hints: ['まず自動モードをオフにして、自分の手で描く', '残像を70%以上にすると線が残る', 'ゆっくり動く／急に動く、で違う絵になる'] },
    { id: 'random-shapes', title: 'ランダムな図形から作品を作る', hl: 'ランダム', tool: 'shapes', q: { count: 55, layout: 'scatter', palette: 'neon', style: 'mixed', seed: 31 }, alt: ['studio', 'pattern'],
      brief: '偶然の図形の散らばりを、作品に変えよう。気に入った構図が出るまで何度でも引き直せる。', hints: ['クリックで引き直し、気になる構図を探す', '図形の種類を1〜2個に絞ると統一感が出る', '「Studioで開く」から文字や図形を足して仕上げる'] },
    { id: 'symmetry-art', title: '左右対称のアートを作る', hl: '左右対称', tool: 'pattern', q: { type: 'truchet', density: 14, symmetry: 'h', seed: 21, weight: 26 }, alt: ['studio'],
      brief: '鏡に映したような左右対称の模様。対称は、見る人に安心感と驚きを同時に与える。', hints: ['シード値を変えて、一番「顔」に見えるものを探す', '密度を下げると大胆に、上げると繊細になる', '四方対称にすると万華鏡のように'] },
    { id: 'unusual-colors', title: '普段使わない配色を試す', hl: '普段使わない', tool: 'color', q: { base: 'ff8a00', scheme: 'tetradic', count: 5 }, alt: ['pattern', 'flow'],
      brief: 'いつもの好きな色から離れて、少し居心地の悪い配色に挑戦しよう。意外な組み合わせが見つかる。', hints: ['「ランダム生成」を5回押して、気になった色を固定する', '補色や4色配色は強い。彩度を下げて馴染ませる', 'できたパレットをPatternやFlowに持っていく'] },
    { id: 'zero-gravity', title: '無重力の花畑', hl: '無重力', tool: 'particles', q: { count: 320, speed: 35, size: 3, palette: 'gradient', mouse: 'attract', trail: 70 }, alt: ['flow', 'motion'],
      brief: '粒子をゆっくり漂わせて、花のようにまとまる瞬間を探そう。マウスで引き寄せると形が変わる。', hints: ['速度を落とすとゆったりした群れに', '引き寄せたまま止めると、花の中心ができる', '色を1色に絞ると花びらの濃淡が際立つ'] },
    { id: 'triangle-city', title: '三角形だけで街を建てる', hl: '三角形', tool: 'shapes', q: { shapes: 'triangle', count: 70, layout: 'grid', palette: 'neon', style: 'fill', seed: 21 }, alt: ['pattern', 'studio'],
      brief: '使っていい図形は三角形だけ。並べ方と色の組み合わせで、街の夜景をつくってみよう。', hints: ['格子配置から始めて、回転をオフにするとビルのように見える', '明るい色を少なめにして、窓の灯りを演出', '三角モザイクのPatternも試してみる'] },
    { id: 'magnet-swarm', title: '磁石みたいな群れ', hl: '磁石', tool: 'particles', q: { count: 700, speed: 120, size: 2, palette: 'lime', mouse: 'attract', trail: 86 }, alt: ['motion'],
      brief: '700粒の粒子が、カーソルに吸い寄せられていく。残像を長くすると、軌跡が絵になる。', hints: ['カーソルを円を描くように動かす', '反応範囲を広げると巻き込む量が増える', '一時停止して、きれいな瞬間を保存'] },
    { id: 'circle-galaxy', title: '円だけの銀河', hl: '銀河', tool: 'shapes', q: { shapes: 'ellipse', count: 120, layout: 'spiral', palette: 'violet', style: 'mixed', seed: 7 }, alt: ['pattern', 'flow'],
      brief: '円を渦巻き状に並べるだけで、小さな銀河ができる。サイズの幅をいじるのがコツ。', hints: ['最小と最大のサイズ差を大きくすると奥行きが出る', 'スタイルを「線」にすると星雲っぽくなる', 'Flow Fieldの「渦」モードとも見比べてみよう'] },
    { id: 'break-text', title: '文字を壊して遊ぶ', hl: '壊して', tool: 'studio', q: { name: '文字を壊す実験' }, alt: ['pattern'],
      brief: '大きな文字を置いたら、図形でわざと崩してみよう。壊れた先に新しいデザインがある。', hints: ['まず文字を大きく置く', '図形を重ねて、一部を隠す', '回転と不透明度で「ずれ」を作る'] },
    { id: 'rain-rhythm', title: '雨粒のリズム', hl: '雨粒', tool: 'particles', q: { count: 450, speed: 160, size: 2, palette: 'violet', mouse: 'repel', trail: 60 }, alt: ['motion', 'flow'],
      brief: '粒子を細かく速くして、マウスで弾いてみよう。雨粒が跳ねるリズムを探す実験。', hints: ['弾く反応にして、カーソルを左右にゆすってみる', '粒を小さくすると雨らしくなる', 'Motion Playgroundの「重力」と比べてみよう'] },
    { id: 'star-night', title: '星で作る夜空', hl: '夜空', tool: 'shapes', q: { shapes: 'star', count: 90, layout: 'scatter', palette: 'sunset', style: 'fill', seed: 88 }, alt: ['studio', 'color'],
      brief: '星形をばらまいて、自分だけの星座を見つけよう。気に入ったらStudioで仕上げ。', hints: ['最小サイズを小さくして、大小のコントラストを作る', '明るい色はごく少なく', '星座を線でつなぐ代わりに、Studioで文字を足す'] },
    { id: 'find-vortex', title: '渦の中心を探す', hl: '渦', tool: 'flow', q: { mode: 'vortex', strength: 35, scale: 22, count: 1100, speed: 90, fade: 2, seed: 12 }, alt: ['particles'],
      brief: '「渦」モードで流れを回してみよう。乱れの強さを少し変えるだけで、全然違う景色になる。', hints: ['強さを0にすると完全な渦、上げると崩れる', '向きの角度で渦のねじれが変わる', '線を細く、粒子を多くすると糸のような質感に'] },
    { id: 'minimal-logo', title: 'ミニマルなロゴ作り', hl: 'ロゴ', tool: 'studio', q: { name: 'ミニマルロゴ' }, alt: ['color', 'pattern'],
      brief: '図形3つだけで、架空のブランドのロゴをデザインしよう。引き算が上手さの証拠。', hints: ['図形は3つまで、色は2色まで', '中心をずらして余白に意味を持たせる', 'Color Labで先に配色を決めておく'] },
    { id: 'burst-fireworks', title: '放射状の花火', hl: '花火', tool: 'shapes', q: { shapes: 'star,ellipse,triangle', count: 90, layout: 'burst', palette: 'neon', style: 'mixed', seed: 303 }, alt: ['motion', 'particles'],
      brief: '中心から放射状に広がる配置で、静止画の花火を打ち上げよう。', hints: ['配置を「放射」にして、数を増やす', '背景は暗めのパレットにする', 'Motion Playgroundの「反発」でクリックの花火も'] },
    { id: 'whitespace', title: '余白だけで語る1枚', hl: '余白', tool: 'studio', q: { name: '余白の一枚' }, alt: ['pattern', 'color'],
      brief: '置くのは最小限。何もない場所が主役になる構図に挑戦しよう。', hints: ['要素は多くても3つ', '端に寄せて、中央を空ける', '背景に近い色を使うと静かになる'] },
    { id: 'neon-lost', title: 'ネオンの迷子たち', hl: 'ネオン', tool: 'particles', q: { count: 140, speed: 45, size: 3, palette: 'lime', mouse: 'none', links: 1, trail: 30 }, alt: ['motion', 'flow'],
      brief: '線でつなぐをオンにして、粒子のネットワークを眺めよう。ゆっくりが気持ちいい。', hints: ['粒の数を減らすと、つながりが見やすい', '速度をさらに落とすと呼吸のように', '残像を足すと光の尾ができる'] },
    { id: 'chaos-blocks', title: 'カオスな積み木', hl: '積み木', tool: 'shapes', q: { shapes: 'rect,triangle', count: 60, layout: 'scatter', palette: 'mono', style: 'fill', rotate: 1, seed: 12 }, alt: ['pattern', 'studio'],
      brief: '四角と三角を回転させて散らかそう。偶然のバランスが、思わぬ造形を生む。', hints: ['モノクロにすると形そのものが目立つ', 'サイズを大きめにして数を減らす', 'Patternの「ブロック」と比べる'] },
    { id: 'wind-map', title: '風の地図を描く', hl: '風', tool: 'flow', q: { mode: 'smooth', angle: 20, strength: 40, scale: 16, count: 1400, speed: 110, width: 1, fade: 0, seed: 5 }, alt: ['particles'],
      brief: '目に見えない風の流れを、線で可視化しよう。向きと乱れの強さで、天気図のような絵になる。', hints: ['乱れを小さくすると穏やかな風', '残像を0にすると、線が溜まって地図になる', '色を向きで色分けすると風向きが見える'] },
    { id: 'sunset-palette', title: '夕焼けグラデーションの配色', hl: '夕焼け', tool: 'color', q: { base: 'ff7a45', scheme: 'analogous', count: 6 }, alt: ['pattern', 'flow'],
      brief: '夕焼けの空のような、あたたかい配色を作ろう。類似色でつなぐと、自然なグラデーションに。', hints: ['色相を少しずつずらして、紫〜橙〜黄へ', '明るさを調整して最後の1色を暗くする', '作ったパレットをFlow Fieldに持っていく'] },
    { id: 'mono-challenge', title: 'モノクロだけで勝負', hl: 'モノクロ', tool: 'pattern', q: { type: 'triangles', density: 14, seed: 9, colors: 'f2f4f8,8f98a6,343a45', bg: '101215' }, alt: ['studio', 'color'],
      brief: '色を使わず、濃淡だけで勝負。形と密度が主役になる。', hints: ['3段階の明るさを決める', '密度を変えるとリズムが変わる', '対称にすると静かな緊張感が出る'] },
    { id: 'spring-grid', title: '揺れるバネの格子', hl: 'バネ', tool: 'motion', q: { behavior: 'spring', shape: 'square', count: 120, size: 18, trail: 40, power: 75 }, alt: ['particles'],
      brief: '格子状に並んだ図形をカーソルで押して、バネのように揺らそう。物理の気持ちよさを探す実験。', hints: ['クリックで衝撃を与えて波紋を見る', '力を上げると大きくたわむ', '図形を線に変えると布のように見える'] },
    { id: 'gravity-colors', title: '重力で落ちる色たち', hl: '重力', tool: 'motion', q: { behavior: 'gravity', shape: 'circle', count: 80, size: 20, trail: 0, power: 50 }, alt: ['color'],
      brief: '色とりどりの粒が落ちて、跳ねて、積もる。カーソルで下から突き上げてみよう。', hints: ['残像をオフにすると形がはっきり見える', 'クリックで一気に吹き飛ばす', 'Color Labで作った配色を使うとおしゃれに'] },
    { id: 'repeat-poster', title: '繰り返しだけで作るポスター', hl: '繰り返し', tool: 'pattern', q: { type: 'hex', density: 10, seed: 15, fill: 88 }, alt: ['studio'],
      brief: '同じ形の繰り返しから、ポスターを作ろう。単純な反復がリズムと奥行きを生む。', hints: ['六角形の大きさを変えて密度を調整', '回転を少し加えると動きが出る', 'Studioで見出しの文字を重ねて完成'] },
    { id: 'quiet-colors', title: '彩度を落とした静かな配色', hl: '静かな', tool: 'color', q: { base: '8a9a8a', scheme: 'shades', count: 5, satAdj: -20 }, alt: ['pattern', 'studio'],
      brief: '落ち着いた、静かな配色を作ろう。彩度を下げて、明るさの差で見せる。', hints: ['彩度を-20〜-35に', '1色だけ彩度を残してアクセントに', 'ペーパーのパレット（Pattern）と見比べる'] },
    { id: 'steps-flow', title: '流れを閉じ込めた1枚', hl: '閉じ込めた', tool: 'flow', q: { mode: 'steps', strength: 70, scale: 30, count: 1200, speed: 100, width: 1.4, fade: 0, seed: 40, colorMode: 'angle' }, alt: ['pattern'],
      brief: '8方向に限定した流れで、直線的なモザイクのような絵を描く。向きで色分けすると結晶みたいに。', hints: ['色を向きで色分けにする', '乱れを上げると複雑な分岐に', '好みのところで一時停止して保存'] },
    { id: 'dot-network', title: '点と線のネットワーク', hl: 'ネットワーク', tool: 'particles', q: { count: 200, speed: 40, size: 2, palette: 'neon', mouse: 'swirl', links: 1, trail: 20 }, alt: ['motion', 'flow'],
      brief: '点と線でできたネットワークを渦で乱してみよう。つながりが生まれて、ほどける様子を観察する。', hints: ['渦モードで中心を回す', '線でつなぐをオンにしたまま粒の数を調整', '最後に一時停止して構図を決める'] },
    { id: 'wave-layers', title: '波のレイヤー', hl: '波', tool: 'pattern', q: { type: 'waves', density: 16, seed: 77, weight: 30 }, alt: ['flow', 'color'],
      brief: '何本もの波を重ねて、海や音の波形のような絵を作ろう。線の太さと密度で印象が変わる。', hints: ['線を太くすると重なりが濃く出る', '上下対称にすると鏡の水面のように', '配色を3色に絞る'] },
    { id: 'repel-dots', title: '反発する粒', hl: '反発', tool: 'motion', q: { behavior: 'repel', shape: 'circle', count: 110, size: 12, trail: 55, power: 80 }, alt: ['particles'],
      brief: 'カーソルを避けて逃げる粒たち。触れそうで触れない距離感を楽しもう。', hints: ['力を上げると逃げ方が大きくなる', '周回に切り替えて違いを見る', '図形を星や線に変えてみる'] },
    { id: 'outline-cosmos', title: '輪郭だけの宇宙', hl: '輪郭', tool: 'shapes', q: { shapes: 'ellipse,star', count: 50, layout: 'circle', palette: 'ocean', style: 'outline', seed: 63 }, alt: ['flow', 'studio'],
      brief: '塗りつぶさず、輪郭の線だけで宇宙を描こう。重なった線が、星図のような繊細さを生む。', hints: ['スタイルを「線」にする', '円環配置から崩していく', '背景を暗めにして線を際立たせる'] }
  ];
  D.THEMES = THEMES;

  /* ---------- 日付 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  /** 利用者の現地日付から 'YYYY-MM-DD'（UTCではなくローカルの暦日） */
  D.keyOf = function (date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  D.todayKey = function (now) { return D.keyOf(now); };
  D.parseKey = function (key) {
    if (typeof key !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d };
  };
  /** 暦日の通し番号（夏時間などの影響を受けない） */
  D.dayNumber = function (key) {
    var p = D.parseKey(key);
    return p ? Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000) : null;
  };
  D.addDays = function (key, n) {
    var p = D.parseKey(key);
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  };
  D.isFuture = function (key, now) { return D.dayNumber(key) > D.dayNumber(D.todayKey(now)); };
  D.weekday = function (key) {
    var p = D.parseKey(key);
    return ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  };
  /** 新しい日付から遡って count 件のキー */
  D.recentKeys = function (endKey, count) {
    var out = [];
    for (var i = 0; i < count; i++) out.push(D.addDays(endKey, -i));
    return out;
  };

  /* ---------- お題の割り当て ---------- */
  var N = THEMES.length;
  function rawPerm(cycle) {
    var rnd = U.mulberry32(U.hash32('pz-daily', cycle));
    var a = [], i, j, t;
    for (i = 0; i < N; i++) a.push(i);
    for (i = N - 1; i > 0; i--) { j = Math.floor(rnd() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function perm(cycle) {
    var a = rawPerm(cycle);
    // 周期の境目で前日と同じお題にならないようにする
    var prevLast = rawPerm(cycle - 1)[N - 1];
    if (a[0] === prevLast) { var t = a[0]; a[0] = a[1]; a[1] = t; }
    return a;
  }
  var permCache = {};
  /** 日付キー → お題（{...theme, index, no, key}）。不正な日付は null */
  D.themeFor = function (key) {
    var n = D.dayNumber(key);
    if (n === null) return null;
    var cycle = Math.floor(n / N), pos = n - cycle * N;
    var pm = permCache[cycle] || (permCache[cycle] = perm(cycle));
    var idx = pm[pos];
    return Object.assign({}, THEMES[idx], { index: idx, no: idx + 1, key: key });
  };
  D.byId = function (id) { return THEMES.filter(function (t) { return t.id === id; })[0] || null; };

  /** お題を開くパス。daily=日付 を付け、保存した作品にお題を紐づける */
  D.href = function (theme, key) {
    var q = Object.assign({}, theme.q || {});
    if (theme.tool === 'studio') {
      var sq = { name: q.name || theme.title, daily: key };
      return '/studio/new?' + U.buildQuery(sq);
    }
    var path = (PZ.registry && PZ.registry.get(theme.tool)) ? PZ.registry.get(theme.tool).path : '/lab/' + theme.tool;
    q.daily = key;
    return path + '?' + U.buildQuery(q);
  };
  /** 他のツールで挑戦するためのパス（プリセットは主ツール用なので、daily だけ渡す） */
  D.altHref = function (toolId, key, theme) {
    if (toolId === 'studio') return '/studio/new?' + U.buildQuery({ name: theme.title, daily: key });
    var t = PZ.registry && PZ.registry.get(toolId);
    return (t ? t.path : '/lab') + '?' + U.buildQuery({ daily: key });
  };
  D.toolLabel = function (toolId) {
    if (toolId === 'studio') return 'Studio';
    var t = PZ.registry && PZ.registry.get(toolId);
    return t ? t.name : toolId;
  };
})();
