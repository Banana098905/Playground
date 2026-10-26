/*
 * 描画エンジン: Studio・My Space・Shape Machine が共有する Canvas レンダラ
 * 描画・当たり判定・選択ハンドルの幾何をここに集約する。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var M = PZ.model;
  var R = (PZ.render = {});
  var DEG = Math.PI / 180;

  /* ---------- 形状 ---------- */
  function starPoints(o) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var r = i % 2 === 0 ? 1 : 0.45;
      pts.push([Math.cos(a) * (o.w / 2) * r, Math.sin(a) * (o.h / 2) * r]);
    }
    return pts;
  }
  function trianglePoints(o) {
    return [[0, -o.h / 2], [o.w / 2, o.h / 2], [-o.w / 2, o.h / 2]];
  }
  /** 中心原点のローカル座標での多角形（三角・星のみ） */
  R.localPolygon = function (o) {
    if (o.type === 'triangle') return trianglePoints(o);
    if (o.type === 'star') return starPoints(o);
    return null;
  };

  function pathRoundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function pathShape(ctx, o) {
    if (o.type === 'rect') {
      if (o.radius > 0) pathRoundRect(ctx, -o.w / 2, -o.h / 2, o.w, o.h, o.radius);
      else ctx.rect(-o.w / 2, -o.h / 2, o.w, o.h);
    } else if (o.type === 'ellipse') {
      ctx.ellipse(0, 0, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
    } else {
      var pts = R.localPolygon(o);
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
    }
  }

  function drawText(ctx, o) {
    var lines = String(o.text || '').split('\n');
    var lineH = o.fontSize * 1.25;
    var y0 = -((lines.length - 1) * lineH) / 2;
    ctx.font = M.fontString(o);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (var i = 0; i < lines.length; i++) {
      var y = y0 + i * lineH;
      if (o.strokeWidth > 0) {
        ctx.lineWidth = o.strokeWidth;
        ctx.strokeStyle = o.stroke;
        ctx.strokeText(lines[i], 0, y);
      }
      if (o.fill) {
        ctx.fillStyle = o.fill;
        ctx.fillText(lines[i], 0, y);
      }
    }
  }

  R.drawObject = function (ctx, o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.rotation) ctx.rotate(o.rotation * DEG);
    ctx.globalAlpha = o.opacity;
    if (o.type === 'text') {
      drawText(ctx, o);
    } else {
      ctx.beginPath();
      pathShape(ctx, o);
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      if (o.strokeWidth > 0) {
        ctx.lineWidth = o.strokeWidth;
        ctx.strokeStyle = o.stroke;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  /** 作品全体を現在の座標系(論理サイズ)で描く */
  R.drawProject = function (ctx, project) {
    ctx.save();
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, project.width, project.height);
    ctx.beginPath();
    ctx.rect(0, 0, project.width, project.height);
    ctx.clip();
    for (var i = 0; i < project.objects.length; i++) R.drawObject(ctx, project.objects[i]);
    ctx.restore();
  };

  /* ---------- キャンバス補助 ---------- */
  R.setupCanvas = function (canvas, cssW, cssH, maxDpr) {
    var dpr = Math.min(window.devicePixelRatio || 1, maxDpr || 2);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, dpr: dpr };
  };

  R.fitSize = function (boxW, boxH, w, h) {
    var s = Math.min(boxW / w, boxH / h);
    return { w: Math.max(1, Math.floor(w * s)), h: Math.max(1, Math.floor(h * s)), scale: s };
  };

  /** サムネイル/プレビュー: 作品を指定の CSS 幅で描く */
  R.drawThumb = function (canvas, project, cssW, maxH) {
    var size = R.fitSize(cssW, maxH || 99999, project.width, project.height);
    var set = R.setupCanvas(canvas, size.w, size.h, 2);
    set.ctx.save();
    set.ctx.scale(size.scale, size.scale);
    R.drawProject(set.ctx, project);
    set.ctx.restore();
    return size;
  };

  R.exportPng = function (project, scale) {
    return new Promise(function (resolve, reject) {
      var s = scale || 2;
      var c = document.createElement('canvas');
      c.width = Math.round(project.width * s);
      c.height = Math.round(project.height * s);
      var ctx = c.getContext('2d');
      ctx.scale(s, s);
      R.drawProject(ctx, project);
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error('PNGの生成に失敗しました')); }, 'image/png');
    });
  };

  /* ---------- 当たり判定 ---------- */
  R.toLocal = function (o, px, py) {
    var dx = px - o.x, dy = py - o.y;
    var a = -o.rotation * DEG;
    var c = Math.cos(a), s = Math.sin(a);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  };
  R.toWorld = function (o, lx, ly) {
    var a = o.rotation * DEG;
    var c = Math.cos(a), s = Math.sin(a);
    return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c };
  };

  function pointInPolygon(pts, x, y) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  R.hitObject = function (o, px, py, pad) {
    pad = pad || 0;
    var p = R.toLocal(o, px, py);
    if (o.type === 'rect' || o.type === 'text') {
      return Math.abs(p.x) <= o.w / 2 + pad && Math.abs(p.y) <= o.h / 2 + pad;
    }
    if (o.type === 'ellipse') {
      var rx = o.w / 2 + pad, ry = o.h / 2 + pad;
      return (p.x * p.x) / (rx * rx) + (p.y * p.y) / (ry * ry) <= 1;
    }
    var poly = R.localPolygon(o);
    if (pointInPolygon(poly, p.x, p.y)) return true;
    // 細い図形でも選びやすいよう、外周付近も許容
    return pad > 0 && Math.abs(p.x) <= o.w / 2 && Math.abs(p.y) <= o.h / 2 &&
      pointInPolygon(R.localPolygon({ type: o.type, w: o.w + pad * 2, h: o.h + pad * 2 }), p.x, p.y);
  };

  /** 最前面のヒットオブジェクトを返す */
  R.hitTest = function (project, px, py, pad) {
    for (var i = project.objects.length - 1; i >= 0; i--) {
      if (R.hitObject(project.objects[i], px, py, pad)) return project.objects[i];
    }
    return null;
  };

  /* ---------- 選択ハンドル ---------- */
  var HANDLE_DEFS = [
    { id: 'nw', hx: -1, hy: -1 }, { id: 'n', hx: 0, hy: -1 }, { id: 'ne', hx: 1, hy: -1 },
    { id: 'e', hx: 1, hy: 0 }, { id: 'se', hx: 1, hy: 1 }, { id: 's', hx: 0, hy: 1 },
    { id: 'sw', hx: -1, hy: 1 }, { id: 'w', hx: -1, hy: 0 }
  ];
  R.ROTATE_OFFSET_PX = 28;

  /** 選択ハンドルのワールド座標。zoom = 画面px / 論理px */
  R.handles = function (o, zoom) {
    var list = [];
    var cornersOnly = o.type === 'text';
    HANDLE_DEFS.forEach(function (d) {
      if (cornersOnly && (d.hx === 0 || d.hy === 0)) return;
      var w = R.toWorld(o, d.hx * o.w / 2, d.hy * o.h / 2);
      list.push({ id: d.id, hx: d.hx, hy: d.hy, x: w.x, y: w.y });
    });
    var r = R.toWorld(o, 0, -o.h / 2 - R.ROTATE_OFFSET_PX / zoom);
    list.push({ id: 'rot', hx: 0, hy: 0, x: r.x, y: r.y });
    return list;
  };

  R.hitHandle = function (o, px, py, zoom) {
    var hs = R.handles(o, zoom);
    var tol = 11 / zoom;
    for (var i = hs.length - 1; i >= 0; i--) {
      var dx = px - hs[i].x, dy = py - hs[i].y;
      if (dx * dx + dy * dy <= tol * tol) return hs[i];
    }
    return null;
  };

  R.drawSelection = function (ctx, o, zoom, accent) {
    accent = accent || '#b8ff3d';
    var px = 1 / zoom;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rotation * DEG);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = accent;
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
    ctx.setLineDash([]);
    // 回転ハンドルの支線
    var ry = -o.h / 2 - R.ROTATE_OFFSET_PX * px;
    ctx.beginPath();
    ctx.moveTo(0, -o.h / 2);
    ctx.lineTo(0, ry);
    ctx.stroke();
    ctx.restore();

    var hs = R.handles(o, zoom);
    hs.forEach(function (hd) {
      ctx.save();
      ctx.translate(hd.x, hd.y);
      ctx.fillStyle = '#14161a';
      ctx.strokeStyle = hd.id === 'rot' ? '#a066ff' : accent;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      if (hd.id === 'rot') ctx.arc(0, 0, 5.5 * px, 0, Math.PI * 2);
      else ctx.rect(-4.5 * px, -4.5 * px, 9 * px, 9 * px);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  };
})();
