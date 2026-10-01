/* ==========================================================================
   symbols.js — «Топограф»: Sym — детальная отрисовка объектов местности
   (вид сверху «как с дрона») и условные знаки топоплана 1:500 (Sym.plan).

   Соглашения (дополняют MODES.md):
   • Масштаб: 1 ед. ≈ 0,25 м. Свет с северо-запада, тени — на юго-восток.
   • Прямоугольные объекты (ground, house, building, shed, greenhouse, flowerbed,
     playground, hillshade, plan.paper): (x, y) — ЛЕВЫЙ ВЕРХНИЙ угол, w×h — размер;
     поворот opt.rot (рад) — вокруг центра прямоугольника.
     garages(x, y, n, opt): (x, y) — левый верхний угол ряда; бокс 13×24 ед.
     (opt.w, opt.h), возвращает {w, h} всего ряда.
   • Точечные объекты (tree, bush, manhole, hydrant, pole, car, bench, well,
     marker, gate, люди и приборы): (x, y) — центр / точка стояния.
   • Списки точек pts: [{x,y}, …] или [[x,y], …] или [x0,y0, x1,y1, …].
     Замкнутость полилинии — первая точка равна последней (для road/fence).
   • Углы — в радианах, 0 = восток (+x), положительные — по часовой (y вниз).
   • Всё «случайное» в рисунке — из seed (или из координат, если seed не задан),
     объекты не мерцают между кадрами. Текстуры генерируются один раз и кэшируются.
   Необязательные параметры сверх MODES.md (все можно не передавать):
     ground(…, kind, seed, {poly, edge}) — залить сглаженный контур вместо прямоугольника;
     road(…, kind, {seed, smooth:false, marking:false, cap, stage:'base'|'top'|'mark', avoid:[{pts, width}]});
     manhole(ctx, x, y, kind, r=1.7, rot);
     pole(ctx, x, y, kind, rot) — rot: направление линии/кронштейна; wires(…, kind='power'|'tele');
     gate(ctx, x, y, w, rot, open 0..1); house opt: {height, material:'tile'|'metal'|'shingle',
     solar, skylights, dish, chimney}; building/shed/greenhouse/garages opt.rot; shed opt {roof:'gable',
     material:'metal'|'wood'|'felt', chimney};
     garages opt {w, h, apron}; hillshade opt {cell=4, z=1, alpha=.6, key}; surveyorTop opt
     {pole, scale, vest, helmet}; tripodTop opt {aim, scale, legs}; dogTop(…, color);
     plan.road(…, label='а'|null); plan.water(ctx, pts, width) — с width рисуется как река/ручей;
     plan.slope(…, color); plan.pole(…, rot); plan.paper opt {title, scale, grid=100, gridX, gridY,
     stamp=false, header, section, system, author, margin}.
   Дополнительные функции: Sym.roads(ctx, [{pts, width, kind, seed, opt}]) — несколько дорог
   слоями (сначала все бордюры, потом покрытие — асфальт поверх грунтовок, потом разметка,
   прерванная на перекрёстках) — чистые примыкания и перекрёстки; Sym.plan.label(ctx, x, y,
   text, size, color, rot); Sym.hash(seed, i), Sym.rng(seed); Sym.colors.
   Производительность: тяжёлые статичные объекты (земля, дороги, дома, деревья, водоёмы…)
   рисуются один раз в спрайт под текущий масштаб экрана и затем выводятся одним drawImage
   (LRU-кэш ~8 Мпикс; спрайт заводится со второго запроса — разовая отрисовка, например в api.layer,
   идёт напрямую без лишней памяти). Sym.cache = false — отключить; Sym.clearCache() — освободить память
   (например, в конце уровня); Sym.prepare() — заранее сгенерировать текстуры (~0,2 с).
   Подвижные объекты: car/personTop без seed не меняют вид при движении (seed по умолчанию
   не зависит от координат); у car угол квантуется до 1°. Для hillshade передавайте одну и ту же
   функцию высот (или opt.key) — иначе кэш не сработает.
   ========================================================================== */
const Sym = (() => {
  'use strict';
  const TAU = Math.PI * 2, PI = Math.PI, SQ = Math.SQRT1_2;
  const TEX = 2;            // текселей на единицу в кэшированных текстурах
  const TS = 128;           // размер плитки текстуры, ед.
  const TSZ = TS * TEX;     // размер плитки текстуры, px
  const HAS_DOM = typeof document !== 'undefined';

  /* ------------------------------------------------------------------ seeds */
  function toSeed(s, fx, fy) {
    if (typeof s === 'string') {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
      return h | 0;
    }
    if (typeof s !== 'number' || s !== s) {
      return Math.imul(Math.round((fx || 0) * 4) | 0, 73856093) ^ Math.imul(Math.round((fy || 0) * 4) | 0, 19349663) ^ 0x5bd1e995;
    }
    if (!Number.isInteger(s)) s = Math.floor(s * 4294967296);
    return s | 0;
  }
  function hash(s, i) {
    let h = Math.imul((s | 0) ^ Math.imul((i | 0) + 1, 0x9E3779B1), 0x85EBCA77);
    h ^= h >>> 15; h = Math.imul(h, 0xC2B2AE3D); h ^= h >>> 13; h = Math.imul(h, 0x27D4EB2F); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function rng(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function wnoise(seed) { let st = seed | 0; return () => ((st = (Math.imul(st, 1664525) + 1013904223) | 0) >>> 0) / 4294967296; }
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------------------- canvases */
  function mkCanvas(w, h) {
    if (HAS_DOM) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    return new OffscreenCanvas(w, h);
  }
  let _hcc = null;
  const hc = () => _hcc || (_hcc = mkCanvas(4, 4).getContext('2d'));

  /* ---------------------------------------------------------------- colors */
  const _rgbC = new Map();
  function rgb(c) {
    let v = _rgbC.get(c);
    if (v !== undefined) return v;
    v = null;
    if (typeof c === 'string') {
      const g = hc(); g.fillStyle = '#000'; g.fillStyle = c; const f = g.fillStyle;
      if (f[0] === '#') { const n = parseInt(f.slice(1, 7), 16); v = [n >> 16 & 255, n >> 8 & 255, n & 255]; }
      else { const m = /rgba?\(([^)]+)\)/.exec(f); if (m) { const a = m[1].split(',').map(Number); v = [a[0], a[1], a[2]]; } }
    }
    if (_rgbC.size > 600) _rgbC.clear();
    _rgbC.set(c, v);
    return v;
  }
  const _shC = new Map();
  function shade(c, k) { // k < 0 — темнее, k > 0 — светлее
    const key = c + '|' + k;
    let v = _shC.get(key);
    if (v) return v;
    const a = rgb(c);
    if (!a) v = c;
    else {
      const t = k < 0 ? 0 : 255, f = Math.min(1, Math.abs(k));
      v = 'rgb(' + Math.round(a[0] + (t - a[0]) * f) + ',' + Math.round(a[1] + (t - a[1]) * f) + ',' + Math.round(a[2] + (t - a[2]) * f) + ')';
    }
    if (_shC.size > 3000) _shC.clear();
    _shC.set(key, v);
    return v;
  }
  function alpha(c, a) { const v = rgb(c); return v ? 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')' : c; }

  /* -------------------------------------------------------------- geometry */
  function P(pts) {
    if (!pts || !pts.length) return [];
    if (typeof pts[0] === 'number') { const o = []; for (let i = 0; i + 1 < pts.length; i += 2) o.push({ x: pts[i], y: pts[i + 1] }); return o; }
    if (Array.isArray(pts[0])) return pts.map(q => ({ x: q[0], y: q[1] }));
    return pts;
  }
  function isClosed(p) { const n = p.length; return n > 3 && Math.abs(p[0].x - p[n - 1].x) < 1e-6 && Math.abs(p[0].y - p[n - 1].y) < 1e-6; }
  function openRing(p) { return isClosed(p) ? p.slice(0, -1) : p; }
  function polyPath(ctx, p, closed) {
    if (!p.length) return;
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
    if (closed) ctx.closePath();
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }
  function circ(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  function cr(a, b, c, d, t) {
    const t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * (2 * b.x + (c.x - a.x) * t + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * t2 + (3 * b.x - a.x - 3 * c.x + d.x) * t3),
      y: 0.5 * (2 * b.y + (c.y - a.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * t2 + (3 * b.y - a.y - 3 * c.y + d.y) * t3),
    };
  }
  // точки сплайна Катмулла–Рома через p, шаг ~step ед.
  function densify(p, closed, step) {
    const n = p.length;
    if (n < 2) return p.slice();
    if (n < 3 && !closed) {
      const o = [], L = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y), k = Math.max(1, Math.ceil(L / (step * 4)));
      for (let j = 0; j <= k; j++) o.push({ x: lerp(p[0].x, p[1].x, j / k), y: lerp(p[0].y, p[1].y, j / k) });
      return o;
    }
    const out = [], N = closed ? n : n - 1;
    for (let i = 0; i < N; i++) {
      const p0 = p[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[closed ? (i + 2) % n : Math.min(i + 2, n - 1)];
      const L = Math.hypot(p2.x - p1.x, p2.y - p1.y), k = Math.max(1, Math.ceil(L / step));
      for (let j = 0; j < k; j++) out.push(cr(p0, p1, p2, p3, j / k));
    }
    if (!closed) out.push({ x: p[n - 1].x, y: p[n - 1].y });
    return out;
  }
  function smoothPath(ctx, p, closed) {
    const n = p.length;
    if (n < 3) { polyPath(ctx, p, closed); return; }
    ctx.moveTo(p[0].x, p[0].y);
    const N = closed ? n : n - 1;
    for (let i = 0; i < N; i++) {
      const p0 = p[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
      ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
    }
    if (closed) ctx.closePath();
  }
  function cum(p) {
    const c = new Float64Array(p.length);
    for (let i = 1; i < p.length; i++) c[i] = c[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    return c;
  }
  function along(p, c, s) {
    const n = p.length;
    if (n < 2) return { x: p[0].x, y: p[0].y, a: 0 };
    let lo = 1, hi = n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < s) lo = m + 1; else hi = m; }
    const a = p[lo - 1], b = p[lo], L = (c[lo] - c[lo - 1]) || 1, t = clamp((s - c[lo - 1]) / L, 0, 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  // штрихи длиной on с промежутками off вдоль ломаной q (c — накопленные длины); skip(x, y) — пропустить штрих
  function dashPath(ctx, q, c, on, off, phase, skip) {
    const L = c[c.length - 1];
    let i = 1;
    for (let d = -(phase % (on + off)); d < L; d += on + off) {
      const d0 = Math.max(0, d), d1 = Math.min(L, d + on);
      if (d1 - d0 < 0.6) continue;
      if (skip) { const m = along(q, c, (d0 + d1) / 2), a = along(q, c, d0), e = along(q, c, d1); if (skip(m.x, m.y) || skip(a.x, a.y) || skip(e.x, e.y)) continue; }
      const a = along(q, c, d0), e = along(q, c, d1);
      ctx.moveTo(a.x, a.y);
      while (i < q.length && c[i] <= d0) i++;
      while (i < q.length && c[i] < d1) { ctx.lineTo(q[i].x, q[i].y); i++; }
      ctx.lineTo(e.x, e.y);
    }
  }
  function polyDist(p, x, y) {
    let best = Infinity;
    for (let i = 1; i < p.length; i++) {
      const ax = p[i - 1].x, ay = p[i - 1].y, bx = p[i].x - ax, by = p[i].y - ay, L2 = bx * bx + by * by;
      const t = L2 ? clamp(((x - ax) * bx + (y - ay) * by) / L2, 0, 1) : 0, dx = ax + bx * t - x, dy = ay + by * t - y, d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  function offsetLine(p, d, closed) {
    const n = p.length, o = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = closed ? p[(i - 1 + n) % n] : (i > 0 ? p[i - 1] : null);
      const next = closed ? p[(i + 1) % n] : (i < n - 1 ? p[i + 1] : null);
      let n1x = 0, n1y = 0, n2x = 0, n2y = 0;
      if (prev) { const dx = p[i].x - prev.x, dy = p[i].y - prev.y, L = Math.hypot(dx, dy) || 1; n1x = -dy / L; n1y = dx / L; }
      if (next) { const dx = next.x - p[i].x, dy = next.y - p[i].y, L = Math.hypot(dx, dy) || 1; n2x = -dy / L; n2y = dx / L; }
      if (!prev) { n1x = n2x; n1y = n2y; }
      if (!next) { n2x = n1x; n2y = n1y; }
      let mx = n1x + n2x, my = n1y + n2y;
      const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
      const k = Math.max(0.4, mx * n1x + my * n1y);
      o[i] = { x: p[i].x + mx * d / k, y: p[i].y + my * d / k };
    }
    return o;
  }
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  function centroid(p) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const q = p[i], r = p[(i + 1) % n], f = q.x * r.y - r.x * q.y;
      a += f; cx += (q.x + r.x) * f; cy += (q.y + r.y) * f;
    }
    if (Math.abs(a) < 1e-9) { let sx = 0, sy = 0; for (const q of p) { sx += q.x; sy += q.y; } return { x: sx / p.length, y: sy / p.length, a: 0 }; }
    return { x: cx / (3 * a), y: cy / (3 * a), a: Math.abs(a / 2) };
  }
  function bbox(p) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
    return { x0, y0, x1, y1 };
  }
  // освещённость грани с локальной нормалью (nx, ny) при повороте (ca, sa): +1 — к свету (СЗ)
  function lit(nx, ny, ca, sa) { const wx = nx * ca - ny * sa, wy = nx * sa + ny * ca; return -(wx + wy) * SQ; }
  function shadeFill(ctx, k, s) {
    s = s || 1;
    if (k > 0.02) { ctx.fillStyle = 'rgba(255,247,228,' + (k * 0.24 * s).toFixed(3) + ')'; ctx.fill(); }
    else if (k < -0.02) { ctx.fillStyle = 'rgba(10,12,28,' + (-k * 0.34 * s).toFixed(3) + ')'; ctx.fill(); }
  }

  /* --------------------------------------------------------------- shadows */
  const SHA = 'rgba(14,24,20,';
  function shadowPoly(ctx, pts, ox, oy, a) {
    if (a == null) a = 1;
    const all = [];
    for (const q of pts) { all.push(q); all.push({ x: q.x + ox, y: q.y + oy }); }
    const h = hull(all);
    let cx = 0, cy = 0;
    for (const q of h) { cx += q.x; cy += q.y; }
    cx /= h.length; cy /= h.length;
    ctx.fillStyle = SHA + (0.09 * a).toFixed(3) + ')';
    ctx.beginPath();
    for (let i = 0; i < h.length; i++) {
      const q = h[i], dx = q.x - cx, dy = q.y - cy, L = Math.hypot(dx, dy) || 1;
      ctx.lineTo(q.x + dx / L * 1.2 + 0.3, q.y + dy / L * 1.2 + 0.3);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = SHA + (0.25 * a).toFixed(3) + ')';
    ctx.beginPath(); polyPath(ctx, h, true); ctx.fill();
  }
  const rectPts = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

  /* -------------------------------------------------------------- textures */
  function texPix(S, f) {
    const c = mkCanvas(S, S), g = c.getContext('2d'), im = g.createImageData(S, S), d = im.data, o = [0, 0, 0, 255];
    for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
      o[3] = 255; f(x, y, o, i);
      const j = i * 4; d[j] = o[0]; d[j + 1] = o[1]; d[j + 2] = o[2]; d[j + 3] = o[3];
    }
    g.putImageData(im, 0, 0);
    return { c, g };
  }
  function vnoise(S, cells, seed) {
    const R = rng(seed), g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = R();
    const out = new Float32Array(S * S), k = cells / S;
    for (let y = 0; y < S; y++) {
      const fy = y * k, iy = Math.floor(fy); let ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
      const y0 = (iy % cells) * cells, y1 = ((iy + 1) % cells) * cells;
      for (let x = 0; x < S; x++) {
        const fx = x * k, ix = Math.floor(fx); let tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
        const x0 = ix % cells, x1 = (ix + 1) % cells;
        const a = g[y0 + x0] + (g[y0 + x1] - g[y0 + x0]) * tx, b = g[y1 + x0] + (g[y1 + x1] - g[y1 + x0]) * tx;
        out[y * S + x] = a + (b - a) * ty;
      }
    }
    return out;
  }
  function fbm(S, seed, oct) {
    const out = new Float32Array(S * S);
    let tw = 0;
    oct.forEach(([c, w], k) => { const n = vnoise(S, c, seed + k * 101); for (let i = 0; i < out.length; i++) out[i] += n[i] * w; tw += w; });
    for (let i = 0; i < out.length; i++) out[i] = 0.5 + (out[i] / tw - 0.5) * 1.6;
    return out;
  }
  function worley(S, cell, seed) {
    const n = Math.max(1, Math.round(S / cell)); cell = S / n;
    const R = rng(seed), px = new Float32Array(n * n), py = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) { px[i] = (i % n + 0.12 + R() * 0.76) * cell; py[i] = (((i / n) | 0) + 0.12 + R() * 0.76) * cell; }
    const f1 = new Float32Array(S * S), f2 = new Float32Array(S * S), id = new Int32Array(S * S), vx = new Float32Array(S * S), vy = new Float32Array(S * S);
    for (let y = 0, i = 0; y < S; y++) {
      const cy = Math.floor(y / cell);
      for (let x = 0; x < S; x++, i++) {
        const cx = Math.floor(x / cell);
        let b1 = 1e9, b2 = 1e9, bi = 0, bx = 0, by = 0;
        for (let dy = -1; dy <= 1; dy++) {
          let gy = cy + dy, oy = 0;
          if (gy < 0) { gy += n; oy = -S; } else if (gy >= n) { gy -= n; oy = S; }
          for (let dx = -1; dx <= 1; dx++) {
            let gx = cx + dx, ox = 0;
            if (gx < 0) { gx += n; ox = -S; } else if (gx >= n) { gx -= n; ox = S; }
            const k = gy * n + gx, ddx = x + 0.5 - (px[k] + ox), ddy = y + 0.5 - (py[k] + oy), d = Math.sqrt(ddx * ddx + ddy * ddy);
            if (d < b1) { b2 = b1; b1 = d; bi = k; bx = ddx; by = ddy; } else if (d < b2) b2 = d;
          }
        }
        f1[i] = b1; f2[i] = b2; id[i] = bi; vx[i] = bx; vy[i] = by;
      }
    }
    return { n, cell, f1, f2, id, vx, vy };
  }
  function wrapDo(S, x, y, r, fn) {
    for (let ox = -S; ox <= S; ox += S) {
      const X = x + ox; if (X < -r || X > S + r) continue;
      for (let oy = -S; oy <= S; oy += S) { const Y = y + oy; if (Y < -r || Y > S + r) continue; fn(X, Y); }
    }
  }
  function strokesBatch(g, S, R, n, lenA, lenB, styles, width, angleFn) {
    const paths = styles.map(() => []);
    for (let k = 0; k < n; k++) {
      const x = R() * S, y = R() * S, a = angleFn ? angleFn(R) : R() * TAU, L = lenA + R() * (lenB - lenA), si = (R() * styles.length) | 0;
      const dx = Math.cos(a) * L, dy = Math.sin(a) * L;
      wrapDo(S, x, y, L + 1, (X, Y) => paths[si].push(X, Y, X + dx, Y + dy));
    }
    g.lineCap = 'round'; g.lineWidth = width;
    styles.forEach((st, i) => {
      const p = paths[i]; g.strokeStyle = st; g.beginPath();
      for (let j = 0; j < p.length; j += 4) { g.moveTo(p[j], p[j + 1]); g.lineTo(p[j + 2], p[j + 3]); }
      g.stroke();
    });
  }
  function dotsBatch(g, S, R, n, rA, rB, styles) {
    const paths = styles.map(() => []);
    for (let k = 0; k < n; k++) {
      const x = R() * S, y = R() * S, r = rA + R() * (rB - rA), si = (R() * styles.length) | 0;
      wrapDo(S, x, y, r + 1, (X, Y) => paths[si].push(X, Y, r));
    }
    styles.forEach((st, i) => {
      const p = paths[i]; g.fillStyle = st; g.beginPath();
      for (let j = 0; j < p.length; j += 3) circ(g, p[j], p[j + 1], p[j + 2]);
      g.fill();
    });
  }
  // крупномасштабную пятнистость даёт макро-слой (период 512 и 320 ед.), поэтому сама плитка 128 ед.
  // почти однородна на крупных масштабах — иначе её повтор заметен как «обои».
  function organic(seed, base, light, dark, amp, nBlades, styles, bw) {
    const S = TSZ, big = fbm(S, seed, [[16, 1], [32, 0.6]]), mid = vnoise(S, 64, seed + 5), wn = wnoise(seed + 9);
    nBlades = Math.round(nBlades * S * S / 36864);
    const r = texPix(S, (x, y, o, i) => {
      let t = (big[i] - 0.5) * 0.95 * amp + (mid[i] - 0.5) * 0.85 * amp;
      const c = t > 0 ? light : dark; t = Math.min(1, Math.abs(t));
      const n = (wn() - 0.5) * 16;
      o[0] = base[0] + (c[0] - base[0]) * t + n;
      o[1] = base[1] + (c[1] - base[1]) * t + n;
      o[2] = base[2] + (c[2] - base[2]) * t + n * 0.6;
    });
    if (nBlades) strokesBatch(r.g, S, rng(seed + 1), nBlades, 1.2, 3.2, styles, bw || 0.75);
    return r;
  }
  function pebbles(g, S, R, n, rA, rB, pal) {
    for (let k = 0; k < n; k++) {
      const x = R() * S, y = R() * S, r = rA + R() * (rB - rA), c = pal[(R() * pal.length) | 0], ry = r * (0.7 + R() * 0.3), a = R() * PI;
      wrapDo(S, x, y, r + 1, (X, Y) => {
        g.fillStyle = 'rgba(30,22,14,.35)'; g.beginPath(); g.ellipse(X + 0.5, Y + 0.5, r, ry, a, 0, TAU); g.fill();
        g.fillStyle = c; g.beginPath(); g.ellipse(X, Y, r, ry, a, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,240,.28)'; g.beginPath(); g.ellipse(X - r * 0.3, Y - r * 0.3, r * 0.45, ry * 0.4, a, 0, TAU); g.fill();
      });
    }
  }

  const GEN = {
    grass: () => organic(101, [100, 148, 62], [146, 174, 78], [60, 104, 42], 0.95, 3000,
      ['rgba(172,206,104,.5)', 'rgba(138,182,84,.42)', 'rgba(46,84,32,.5)', 'rgba(68,108,42,.42)']).c,
    lawn: () => organic(202, [108, 162, 70], [134, 182, 84], [80, 132, 54], 0.5, 2600,
      ['rgba(156,204,106,.38)', 'rgba(70,118,50,.34)', 'rgba(128,178,86,.3)'], 0.6).c,
    meadow: () => {
      const r = organic(303, [124, 154, 76], [176, 180, 92], [84, 118, 54], 1.05, 2800,
        ['rgba(190,196,112,.5)', 'rgba(150,176,86,.45)', 'rgba(60,92,40,.5)', 'rgba(110,140,60,.45)'], 0.8);
      dotsBatch(r.g, TSZ, rng(304), 380, 0.55, 1.0, ['#f6f3ea', '#f3d23a', '#c39be0', '#8fb1ea', '#f3f0e6', '#e9c43a']);
      return r.c;
    },
    dirt: () => {
      const r = organic(404, [136, 106, 74], [164, 134, 98], [100, 76, 52], 0.85, 500, ['rgba(80,58,38,.35)', 'rgba(184,154,116,.35)']);
      pebbles(r.g, TSZ, rng(405), 260, 0.5, 1.2, ['#8f877a', '#6f604d', '#a59c8a', '#7d6a55']);
      return r.c;
    },
    sand: () => {
      const r = organic(505, [218, 197, 146], [236, 218, 174], [196, 170, 122], 0.6, 0, []), g = r.g, R = rng(506), S = TSZ;
      g.lineWidth = 1;
      for (let j = 0; j < 16; j++) {
        const y0 = j * S / 16 + R() * 3, k = 1 + ((R() * 3) | 0), ph = R() * TAU, A = 1.5 + R() * 2;
        for (const oy of [-S, 0, S]) for (const [dy, st] of [[0, 'rgba(255,248,226,.32)'], [1.2, 'rgba(160,126,82,.16)']]) {
          g.strokeStyle = st; g.beginPath();
          for (let x = 0; x <= S; x += 2) { const y = y0 + oy + dy + Math.sin(x / S * TAU * k + ph) * A; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
          g.stroke();
        }
      }
      pebbles(g, S, rng(507), 40, 0.4, 0.8, ['#b9a78a', '#9c8f7c']);
      return r.c;
    },
    gravel: () => { // щебень: мелкое зерно спокойного тона + редкие крупные камни, без «телешума»
      const S = TSZ, W = worley(S, 2.6, 606), wn = wnoise(607), R = rng(608), big = fbm(S, 609, [[8, 1], [24, 0.6]]);
      const tone = new Float32Array(W.n * W.n), tint = new Float32Array(W.n * W.n);
      for (let i = 0; i < tone.length; i++) { tone[i] = 148 + R() * 34; tint[i] = (R() - 0.5) * 16; }
      const r = texPix(S, (x, y, o, i) => {
        const id = W.id[i], e = W.f2[i] - W.f1[i];
        let v = tone[id] - (W.vx[i] + W.vy[i]) / W.cell * 11 + (wn() - 0.5) * 7 + (big[i] - 0.5) * 22;
        if (e < 0.6) v *= 0.8 + e * 0.33;
        o[0] = v + tint[id] + 3; o[1] = v + tint[id] * 0.4; o[2] = v - tint[id] * 0.3 - 6;
      });
      pebbles(r.g, S, rng(610), 70, 0.7, 1.3, ['#b4ada0', '#9a9284', '#c4beb2', '#8a8478']);
      return r.c;
    },
    asphalt: () => {
      const S = TSZ, big = fbm(S, 707, [[8, 1], [24, 0.5]]), wn = wnoise(708);
      return texPix(S, (x, y, o, i) => {
        let v = 90 + (big[i] - 0.5) * 16 + (wn() - 0.5) * 14, t = 0;
        const r = wn();
        if (r < 0.045) { v += 24 + wn() * 16; t = (wn() - 0.5) * 18; } else if (r > 0.972) v -= 22;
        o[0] = v + t * 0.5; o[1] = v + 2; o[2] = v + 5 - t * 0.3;
      }).c;
    },
    concrete: () => {
      const S = TSZ, big = fbm(S, 808, [[8, 1], [32, 0.6]]), wn = wnoise(809), sw = 64, sh = 32;
      const r = texPix(S, (x, y, o, i) => {
        const sy = (y / sh) | 0, xx = x, sx = (xx / sw) | 0, st = (hash(sx * 31 + sy * 7, 3) - 0.5) * 12;
        let v = 182 + st + (big[i] - 0.5) * 14 + (wn() - 0.5) * 9;
        const jx = xx % sw, jy = y % sh;
        if (jx === 0 || jy === 0) v -= 28; else if (jx === 1 || jy === 1) v += 7; else if (jx === sw - 1 || jy === sh - 1) v -= 7;
        o[0] = v + 2; o[1] = v; o[2] = v - 6;
      });
      const R = rng(810), g = r.g;
      g.strokeStyle = 'rgba(70,68,62,.4)'; g.lineWidth = 0.6; g.beginPath();
      for (let k = 0; k < 8; k++) {
        let x0 = 24 + R() * (S - 48), y0 = 24 + R() * (S - 48), a = R() * TAU;
        g.moveTo(x0, y0);
        for (let j = 0; j < 6; j++) { a += (R() - 0.5) * 1.3; x0 += Math.cos(a) * 3.5; y0 += Math.sin(a) * 3.5; g.lineTo(x0, y0); }
      }
      g.stroke();
      return r.c;
    },
    tiles: () => {
      const S = TSZ, pw = 8, ph = 4, wn = wnoise(909), big = fbm(S, 910, [[8, 1], [24, 0.5]]);
      return texPix(S, (x, y, o, i) => {
        const row = (y / ph) | 0, off = (row & 1) ? pw / 2 : 0, xx = (x + off) % S, col = (xx / pw) | 0;
        const h = hash(row * 131 + col, 9);
        let v = 152 + (h - 0.5) * 26 + (big[i] - 0.5) * 16 + (wn() - 0.5) * 8;
        const red = h > 0.95 ? 1 : 0, jx = xx % pw, jy = y % ph;
        if (jx === 0 || jy === 0) v -= 34; else if (jx === 1 || jy === 1) v += 9; else if (jx === pw - 1 || jy === ph - 1) v -= 8;
        o[0] = v + 4 + red * 22; o[1] = v + 1 - red * 6; o[2] = v - 4 - red * 14;
      }).c;
    },
    swamp: () => {
      const S = TSZ, big = fbm(S, 1111, [[6, 1], [12, 0.7], [24, 0.4]]), W = worley(S, 8, 1112), wn = wnoise(1113);
      const r = texPix(S, (x, y, o, i) => {
        const b = big[i], n = (wn() - 0.5) * 14;
        if (b < 0.33) { // окна воды: тёмно-зелёная вода с отражением неба по краю
          const t = clamp((0.33 - b) * 10, 0, 1);
          o[0] = lerp(92, 62, t) + n * 0.4; o[1] = lerp(108, 92, t) + n * 0.4; o[2] = lerp(70, 88, t) + n * 0.4;
        } else {
          const tus = W.f1[i] < 2.8, l = tus ? (2.8 - W.f1[i]) / 2.8 : 0, sh = tus ? -(W.vx[i] + W.vy[i]) / 2.8 * 14 : 0;
          o[0] = 102 + l * 34 + sh + n + (b - 0.5) * 30; o[1] = 116 + l * 32 + sh + n + (b - 0.5) * 20; o[2] = 68 + l * 12 + sh * 0.6 + n * 0.6;
        }
      });
      strokesBatch(r.g, S, rng(1114), 1000, 1.5, 3.6, ['rgba(180,172,98,.55)', 'rgba(74,90,46,.5)', 'rgba(140,152,80,.5)'], 0.7, R => -PI / 2 + (R() - 0.5) * 1.3);
      return r.c;
    },
    water: () => {
      const S = TSZ, big = fbm(S, 1212, [[6, 1], [12, 0.6], [24, 0.4]]), wn = wnoise(1213);
      const r = texPix(S, (x, y, o, i) => { const t = (big[i] - 0.5) * 2, n = (wn() - 0.5) * 5; o[0] = 66 + t * 16 + n; o[1] = 118 + t * 18 + n; o[2] = 150 + t * 14 + n; });
      const g = r.g, R = rng(1214);
      g.lineCap = 'round';
      for (const [n, st] of [[150, 'rgba(214,236,250,.30)'], [110, 'rgba(30,72,104,.25)']]) {
        g.strokeStyle = st; g.lineWidth = 0.8; g.beginPath();
        for (let k = 0; k < n; k++) {
          const x = R() * S, y = R() * S, L = 2 + R() * 4;
          wrapDo(S, x, y, L + 2, (X, Y) => { g.moveTo(X - L, Y); g.quadraticCurveTo(X, Y - 1.3, X + L, Y); });
        }
        g.stroke();
      }
      return r.c;
    },
    field: () => {
      const S = TSZ, rowp = 8, big = fbm(S, 1313, [[8, 1], [16, 0.5]]), clump = vnoise(S, 128, 1314), wn = wnoise(1315);
      return texPix(S, (x, y, o, i) => {
        const row = (y / rowp) | 0, fy = (y % rowp) - rowp / 2 + 0.5, rv = (hash(row, 13) - 0.5) * 16;
        const crop = Math.abs(fy) < 2.6 + (clump[i] - 0.5) * 2 && clump[i] > 0.18;
        const n = (wn() - 0.5) * 18, b = (big[i] - 0.5) * 16;
        if (crop) { const sh = fy < -0.5 ? 16 : fy > 1.5 ? -14 : 0; o[0] = 92 + b + n + sh * 0.6 + rv * 0.4; o[1] = 132 + b + n + sh + rv; o[2] = 52 + n * 0.5; }
        else { o[0] = 122 + b + n; o[1] = 96 + b + n; o[2] = 66 + b * 0.5 + n * 0.6; }
      }).c;
    },
    fieldV: () => { // те же грядки, повёрнутые на 90°
      const src = texCanvas('field'), c = mkCanvas(src.width, src.height), g = c.getContext('2d');
      g.translate(src.width, 0); g.rotate(PI / 2); g.drawImage(src, 0, 0);
      return c;
    },
    forestFloor: () => {
      const S = TSZ, W = worley(S, 2.4, 1414), big = fbm(S, 1415, [[8, 1], [16, 0.6]]), R0 = rng(1416), wn = wnoise(1417);
      const pal = [[98, 82, 52], [90, 94, 56], [66, 66, 42], [118, 104, 64], [80, 74, 48]];
      const ci = new Uint8Array(W.n * W.n);
      for (let i = 0; i < ci.length; i++) ci[i] = (R0() * pal.length) | 0;
      const r = texPix(S, (x, y, o, i) => {
        const c = pal[ci[W.id[i]]], e = W.f2[i] - W.f1[i];
        let k = e < 0.6 ? 0.8 : 1; k += (wn() - 0.5) * 0.1;
        const m = clamp((big[i] - 0.6) * 2.5, 0, 0.7);
        o[0] = (c[0] * (1 - m) + 84 * m) * k; o[1] = (c[1] * (1 - m) + 112 * m) * k; o[2] = (c[2] * (1 - m) + 52 * m) * k;
      });
      strokesBatch(r.g, S, rng(1418), 800, 1.8, 3.2, ['rgba(64,44,26,.55)', 'rgba(150,120,70,.45)'], 0.55);
      strokesBatch(r.g, S, rng(1419), 30, 6, 12, ['rgba(92,70,44,.8)'], 0.9);
      return r.c;
    },
    // штрихи травы вдоль линии падения склона (ось +y плитки — вниз по склону), прозрачная
    downslope: () => {
      const S = TSZ, c = mkCanvas(S, S), g = c.getContext('2d'), R = rng(1919);
      g.lineCap = 'round';
      for (const [n, st, w] of [[1300, 'rgba(24,44,16,.19)', 0.75], [800, 'rgba(232,236,170,.13)', 0.6]]) {
        g.strokeStyle = st; g.lineWidth = w; g.beginPath();
        for (let k = 0; k < n; k++) {
          const x = R() * S, y = R() * S, L = 2 + R() * R() * 7, bend = (R() - 0.5) * 1.4;
          wrapDo(S, x, y, L + 2, (X, Y) => { g.moveTo(X, Y); g.quadraticCurveTo(X + bend, Y + L * 0.5, X + bend * 0.4, Y + L); });
        }
        g.stroke();
      }
      return c;
    },
    // штриховка огнестойких зданий на плане (45°, шаг 1,6 ед.)
    hatch: () => { // 8 px/ед., плитка 16 ед.
      const n = 128, c = mkCanvas(n, n), g = c.getContext('2d');
      g.strokeStyle = 'rgba(196,84,58,.55)'; g.lineWidth = 2.2; g.beginPath();
      for (let t = -n; t <= 2 * n; t += n / 10) { g.moveTo(t, n); g.lineTo(t + n, 0); }
      g.stroke();
      return c;
    },
    // полупрозрачное «зерно» для крыш, резины и т. п.
    grain: () => {
      const wn = wnoise(1515);
      return texPix(128, (x, y, o) => {
        const r = wn();
        if (r < 0.5) { o[0] = o[1] = o[2] = 0; o[3] = r * 2 * 46; } else { o[0] = o[1] = o[2] = 255; o[3] = (r - 0.5) * 2 * 34; }
      }).c;
    },
    // крупные пятна (вариации тона на больших площадях)
    macro: () => {
      const f = fbm(64, 1616, [[4, 1], [8, 0.6], [16, 0.3]]);
      return texPix(64, (x, y, o, i) => {
        const t = (f[i] - 0.5) * 2.2;
        if (t < 0) { o[0] = 10; o[1] = 26; o[2] = 8; o[3] = Math.min(1, -t) * 120; }
        else { o[0] = 255; o[1] = 244; o[2] = 196; o[3] = Math.min(1, t) * 96; }
      }).c;
    },
    // второй макро-слой другого периода: вместе с первым повтор не читается
    macro2: () => {
      const f = fbm(64, 1626, [[6, 1], [12, 0.5]]);
      return texPix(64, (x, y, o, i) => {
        const t = (f[i] - 0.5) * 2.4;
        if (t < 0) { o[0] = 16; o[1] = 34; o[2] = 6; o[3] = Math.min(1, -t) * 110; }
        else { o[0] = 236; o[1] = 236; o[2] = 170; o[3] = Math.min(1, t) * 80; }
      }).c;
    },
    paper: () => {
      const S = 256, big = fbm(S, 1717, [[4, 1], [16, 0.5]]), wn = wnoise(1718);
      const r = texPix(S, (x, y, o, i) => { const v = (big[i] - 0.5) * 8 + (wn() - 0.5) * 6; o[0] = 246 + v; o[1] = 241 + v; o[2] = 226 + v * 1.2; });
      strokesBatch(r.g, S, rng(1719), 260, 3, 9, ['rgba(170,156,128,.10)', 'rgba(255,255,255,.25)'], 0.6);
      return r.c;
    },
  };
  const GROUND_MACRO = { grass: 0.42, lawn: 0.26, meadow: 0.45, dirt: 0.42, sand: 0.22, gravel: 0.26, asphalt: 0.22, concrete: 0.17, tiles: 0.18, swamp: 0.4, water: 0.34, field: 0.3, forestFloor: 0.38 };
  const _pats = {}, _texc = {};
  function texCanvas(name) { return _texc[name] || (_texc[name] = GEN[name]()); }
  function pat(name) {
    let p = _pats[name];
    if (!p) p = _pats[name] = hc().createPattern(texCanvas(name), 'repeat');
    return p;
  }
  // копия текстуры, пересэмплированная в f раз (для попиксельного совпадения с экраном)
  function patRes(name, f) {
    if (f === 1) return pat(name);
    const key = name + '@' + f;
    if (key in _pats) return _pats[key];
    const src = texCanvas(name), n = Math.round(src.width * f);
    if (n > 1100 || n < 4 || Math.abs(n - src.width * f) > 1e-6) return (_pats[key] = null);
    const c = mkCanvas(n, n), g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    // три копии по краям — чтобы сглаживание на швах учитывало соседнюю плитку
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) g.drawImage(src, ox * n, oy * n, n, n);
    return (_pats[key] = hc().createPattern(c, 'repeat'));
  }
  // паттерн с привязкой к мировым координатам: сдвиг (ox, oy) ед., поворот rot, масштаб scale ед./тексель.
  // Если передан ctx без поворота и масштаб экрана кратен текселю — текстура ложится пиксель в пиксель
  // (в программном растеризаторе это в ~10 раз быстрее фильтрованной заливки).
  function patT(name, ox, oy, rot, scale, ctx) {
    const sc = scale || 1 / TEX;
    if (ctx && !rot && ctx.getTransform && typeof DOMMatrix !== 'undefined') {
      const m = ctx.getTransform();
      if (m.b === 0 && m.c === 0 && m.a > 0 && Math.abs(m.a - m.d) < 1e-9) {
        const f = sc * m.a, fq = Math.round(f * 4) / 4;
        if (fq >= 0.125 && fq <= 24 && Math.abs(f - fq) < 1e-6) {
          const p = patRes(name, fq);
          if (p && p.setTransform) {
            const k = m.a, dx = Math.round(k * (ox || 0) + m.e) - m.e, dy = Math.round(k * (oy || 0) + m.f) - m.f;
            p.setTransform(new DOMMatrix([1 / k, 0, 0, 1 / k, dx / k, dy / k]));
            return p;
          }
        }
      }
    }
    const p = pat(name);
    if (p.setTransform && typeof DOMMatrix !== 'undefined') {
      const m = new DOMMatrix();
      m.translateSelf(ox || 0, oy || 0);
      if (rot) m.rotateSelf(rot * 180 / PI);
      m.scaleSelf(sc, sc);
      p.setTransform(m);
    }
    return p;
  }
  function grainOver(ctx, x, y, w, h, a, s) {
    ctx.globalAlpha = a;
    ctx.fillStyle = patT('grain', Math.abs(s || 0) % 64, 0, 0, 0, ctx);
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
  }

  /* ================================================================ GROUND */
  // opt (необязательно): { poly: pts — залить не прямоугольник, а сглаженный контур (x,y,w,h — его габарит),
  //                       edge: ширина мягкого края в ед. (для poly, по умолчанию 3) }
  function ground(ctx, x, y, w, h, kind, seed, opt) {
    if (!(kind in GROUND_MACRO)) kind = 'grass';
    const s = toSeed(seed, x, y);
    const poly = opt && opt.poly ? openRing(P(opt.poly)) : null;
    if (poly && poly.length >= 3 && !(w > 0 && h > 0)) { const b = bbox(poly); x = b.x0; y = b.y0; w = b.x1 - x; h = b.y1 - y; }
    ctx.save();
    const tex = kind === 'field' && hash(s, 5) < 0.5 ? 'fieldV' : kind;
    const shape = () => { ctx.beginPath(); if (poly && poly.length >= 3) smoothPath(ctx, poly, true); else ctx.rect(x, y, w, h); };
    const base = patT(tex, Math.round(hash(s, 1) * TS), Math.round(hash(s, 2) * TS), 0, 0, ctx);
    const macro = patT('macro', Math.round(hash(s, 3) * 512), Math.round(hash(s, 4) * 512), 0, 8, ctx);
    const macro2 = patT('macro2', Math.round(hash(s, 8) * 320), Math.round(hash(s, 9) * 320), 0, 5, ctx);
    if (poly && poly.length >= 3) {
      const e = opt.edge != null ? opt.edge : 3;
      shape();
      if (e > 0) { ctx.lineJoin = 'round'; ctx.strokeStyle = base; ctx.globalAlpha = 0.35; ctx.lineWidth = e * 2; ctx.stroke(); ctx.globalAlpha = 0.5; ctx.lineWidth = e; ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.fillStyle = base; ctx.fill();
      ctx.clip();
    } else {
      ctx.fillStyle = base; ctx.fillRect(x, y, w, h);
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    }
    ctx.globalAlpha = GROUND_MACRO[kind];
    ctx.fillStyle = macro; ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = GROUND_MACRO[kind] * 0.8;
    ctx.fillStyle = macro2; ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    const R = rng(s + 17);
    if (kind === 'lawn') {
      const vert = hash(s, 7) < 0.5, bw = 12;
      ctx.beginPath();
      if (vert) { for (let bx = x - ((x % (bw * 2)) + bw * 2) % (bw * 2); bx < x + w; bx += bw * 2) ctx.rect(bx, y, bw, h); }
      else { for (let by = y - ((y % (bw * 2)) + bw * 2) % (bw * 2); by < y + h; by += bw * 2) ctx.rect(x, by, w, bw); }
      ctx.fillStyle = 'rgba(255,255,230,.07)'; ctx.fill();
    } else if (kind === 'asphalt' || kind === 'concrete') {
      const n = Math.min(40, Math.round(w * h / (kind === 'asphalt' ? 7000 : 12000)));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (kind === 'asphalt') {
        ctx.beginPath();
        for (let k = 0; k < n * 0.2; k++) patchPath(ctx, R, x + R() * w, y + R() * h, 5 + R() * 12, 3 + R() * 8, 0);
        ctx.fillStyle = 'rgba(30,32,36,.16)'; ctx.fill();
        ctx.strokeStyle = 'rgba(20,20,22,.14)'; ctx.lineWidth = 0.4; ctx.stroke();
      }
      crackPath(ctx, R, n, () => [x + R() * w, y + R() * h, R() * TAU]);
      ctx.strokeStyle = kind === 'asphalt' ? 'rgba(28,28,30,.55)' : 'rgba(80,76,68,.45)'; ctx.lineWidth = 0.35; ctx.stroke();
    } else if (kind === 'water') {
      ctx.beginPath();
      const n = Math.min(30, Math.round(w * h / 3000));
      for (let k = 0; k < n; k++) { const px = x + R() * w, py = y + R() * h, L = 3 + R() * 6; ctx.moveTo(px - L, py); ctx.quadraticCurveTo(px, py - 1.4, px + L, py); }
      ctx.strokeStyle = 'rgba(230,245,255,.35)'; ctx.lineWidth = 0.5; ctx.stroke();
    }
    ctx.restore();
  }
  function patchPath(ctx, R, cx, cy, l, w, a) {
    const ca = Math.cos(a), sa = Math.sin(a), n = 7;
    for (let i = 0; i < n; i++) {
      const t = i / n * TAU, rx = Math.cos(t) * l / 2 * (0.8 + R() * 0.3), ry = Math.sin(t) * w / 2 * (0.8 + R() * 0.3);
      const px = cx + rx * ca - ry * sa, py = cy + rx * sa + ry * ca;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function crackPath(ctx, R, n, start) {
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      let [cx, cy, a] = start();
      ctx.moveTo(cx, cy);
      const m = 4 + ((R() * 6) | 0);
      for (let j = 0; j < m; j++) {
        a += (R() - 0.5) * 1.4; cx += Math.cos(a) * (1.5 + R() * 3); cy += Math.sin(a) * (1.5 + R() * 3);
        ctx.lineTo(cx, cy);
        if (R() < 0.15) { const bx = cx + Math.cos(a + 1.2) * 3, by = cy + Math.sin(a + 1.2) * 3; ctx.lineTo(bx, by); ctx.moveTo(cx, cy); }
      }
    }
  }

  /* ================================================================= ROADS */
  function road(ctx, pts, width, kind, opt) {
    const p0 = P(pts);
    if (p0.length < 2) return;
    width = width > 0 ? width : 24; opt = opt || {};
    if (kind !== 'dirt' && kind !== 'path' && kind !== 'gravel') kind = 'asphalt';
    const stage = opt.stage || 'all';
    const closed = isClosed(p0);
    const base = closed ? p0.slice(0, -1) : p0;
    const q = opt.smooth === false ? (closed ? base : p0) : densify(base, closed, 3);
    const s = toSeed(opt.seed, p0[0].x * 0.7 + p0[p0.length - 1].x, p0[0].y * 0.7 + p0[p0.length - 1].y);
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = closed ? 'butt' : (opt.cap || 'butt');
    const line = pp => { ctx.beginPath(); polyPath(ctx, pp, closed); };
    const ox = Math.round(hash(s, 1) * TS), oy = Math.round(hash(s, 2) * TS);
    const c = cum(q), Ltot = c[c.length - 1];
    const band = () => { const a = offsetLine(q, width / 2, closed), b = offsetLine(q, -width / 2, closed); ctx.beginPath(); polyPath(ctx, a, closed); if (closed) { polyPath(ctx, b.slice().reverse(), true); } else { for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(b[i].x, b[i].y); ctx.closePath(); } };
    const R = rng(s + 3);
    if (kind === 'asphalt') {
      const cw = clamp(width * 0.05, 0.8, 1.5);
      if (stage === 'all' || stage === 'base') {
        line(q);
        ctx.lineWidth = width + cw * 2 + 1.4; ctx.strokeStyle = 'rgba(20,30,20,.22)'; ctx.stroke();
        ctx.lineWidth = width + cw * 2; ctx.strokeStyle = '#cfccc3'; ctx.stroke();
        ctx.setLineDash([0.35, 3.65]); ctx.strokeStyle = 'rgba(80,78,72,.55)'; ctx.stroke(); ctx.setLineDash([]);
      }
      if (stage !== 'base' && stage !== 'mark') {
        line(q); ctx.lineWidth = width; ctx.strokeStyle = patT('asphalt', ox, oy, 0, 0, ctx); ctx.stroke();
        ctx.save(); band(); ctx.clip();
        for (const sd of [-1, 1]) { line(offsetLine(q, sd * (width / 2), closed)); ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(24,24,26,.16)'; ctx.stroke(); }
        if (width >= 14) for (const sd of [-1, 1]) for (const k of [0.12, 0.36]) {
          line(offsetLine(q, sd * width * k, closed)); ctx.lineWidth = width * 0.07; ctx.strokeStyle = 'rgba(16,16,20,.08)'; ctx.stroke();
        }
        // заплатки ямочного ремонта
        ctx.beginPath();
        const np = Math.floor(Ltot / 150 * (0.3 + hash(s, 4)));
        for (let k = 0; k < np; k++) {
          const a = along(q, c, R() * Ltot), lat = (R() - 0.5) * width * 0.55;
          patchPath(ctx, R, a.x - Math.sin(a.a) * lat, a.y + Math.cos(a.a) * lat, 5 + R() * 10, 3 + R() * width * 0.2, a.a);
        }
        ctx.fillStyle = 'rgba(26,28,32,.2)'; ctx.fill(); ctx.strokeStyle = 'rgba(16,16,18,.18)'; ctx.lineWidth = 0.35; ctx.stroke();
        // сток к бордюру: светлая пыль/песок у кромки
        for (const sd of [-1, 1]) { line(offsetLine(q, sd * (width / 2 - 1.6), closed)); ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(190,180,160,.10)'; ctx.stroke(); }
        // трещины
        crackPath(ctx, R, Math.floor(Ltot / 35), () => { const a = along(q, c, R() * Ltot), lat = (R() - 0.5) * width * 0.85; return [a.x - Math.sin(a.a) * lat, a.y + Math.cos(a.a) * lat, a.a + (R() - 0.5) * 1.6]; });
        ctx.strokeStyle = 'rgba(24,24,26,.55)'; ctx.lineWidth = 0.32; ctx.lineCap = 'round'; ctx.stroke();
        ctx.restore();
      }
      if ((stage === 'all' || stage === 'mark') && width >= 16 && opt.marking !== false) {
        // осевая разметка; на перекрёстках (opt.avoid — другие дороги) штрихи не рисуются
        const av = (opt.avoid || []).map(o => { const ap = P(o.pts); return { p: ap.length > 1 ? densify(ap, false, 4) : ap, r: (o.width > 0 ? o.width : 24) / 2 + 2.5 }; }).filter(o => o.p.length > 1);
        const skip = av.length ? (px, py) => av.some(o => polyDist(o.p, px, py) < o.r) : null;
        ctx.beginPath(); dashPath(ctx, q, c, 12, 10, hash(s, 3) * 22, skip);
        ctx.lineCap = 'butt'; ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(238,236,226,.85)'; ctx.stroke();
      }
    } else if (stage === 'mark') {
      // разметка есть только у асфальта
    } else if (kind === 'dirt') {
      if (stage !== 'top') {
        line(q); ctx.lineWidth = width + 5; ctx.strokeStyle = 'rgba(96,104,52,.28)'; ctx.stroke();
        ctx.lineWidth = width + 2; ctx.strokeStyle = 'rgba(124,102,66,.45)'; ctx.stroke();
      }
      if (stage !== 'base') {
        line(q); ctx.lineWidth = width; ctx.strokeStyle = patT('dirt', ox, oy, 0, 0, ctx); ctx.stroke();
        // колеи — утоптанные, чуть темнее; между ними — травяная полоса пятнами
        for (const sd of [-1, 1]) {
          line(offsetLine(q, sd * width * 0.26, closed));
          ctx.lineWidth = width * 0.2; ctx.strokeStyle = 'rgba(92,66,42,.16)'; ctx.stroke();
          ctx.lineWidth = width * 0.09; ctx.strokeStyle = 'rgba(70,50,32,.14)'; ctx.stroke();
        }
        line(q); ctx.setLineDash([5 + hash(s, 6) * 6, 2, 9, 3, 4, 2]);
        ctx.lineWidth = Math.max(1, width * 0.16); ctx.strokeStyle = 'rgba(104,138,62,.45)'; ctx.stroke();
        ctx.setLineDash([3, 4, 6, 2]); ctx.lineWidth = Math.max(0.6, width * 0.08); ctx.strokeStyle = 'rgba(132,164,80,.4)'; ctx.stroke();
        ctx.setLineDash([]);
        for (const sd of [-1, 1]) { line(offsetLine(q, sd * width / 2, closed)); ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(100,128,60,.35)'; ctx.stroke(); }
        const np = Math.floor(Ltot / 90 * (0.2 + hash(s, 5)));
        for (let k = 0; k < np; k++) {
          const a = along(q, c, R() * Ltot), lat = (R() < 0.5 ? -1 : 1) * width * 0.26, rx = 2 + R() * 3.5, ry = Math.min(width * 0.12, 1 + R());
          const cx = a.x - Math.sin(a.a) * lat, cy = a.y + Math.cos(a.a) * lat;
          ctx.beginPath(); ctx.ellipse(cx, cy, rx + 0.7, ry + 0.5, a.a, 0, TAU); ctx.fillStyle = 'rgba(66,48,30,.35)'; ctx.fill();
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, a.a, 0, TAU); ctx.fillStyle = 'rgba(96,104,98,.85)'; ctx.fill();
          ctx.beginPath(); ctx.ellipse(cx - 0.3, cy - 0.3, rx * 0.5, ry * 0.35, a.a, 0, TAU); ctx.fillStyle = 'rgba(200,214,222,.35)'; ctx.fill();
        }
      }
    } else if (kind === 'path') {
      if (stage !== 'top') {
        line(q); ctx.lineWidth = width + 2.2; ctx.strokeStyle = 'rgba(30,40,30,.22)'; ctx.stroke();
        ctx.lineWidth = width + 1.4; ctx.strokeStyle = '#c6c2b7'; ctx.stroke();
      }
      if (stage !== 'base') {
        const a = Math.atan2(q[q.length - 1].y - q[0].y, q[q.length - 1].x - q[0].x);
        const ax = Math.abs(Math.cos(a)) > 0.92 ? 0 : Math.abs(Math.sin(a)) > 0.92 ? PI / 2 : a;
        line(q); ctx.lineWidth = width; ctx.strokeStyle = ax ? patT('tiles', ox, oy, ax) : patT('tiles', ox, oy, 0, 0, ctx); ctx.stroke();
        ctx.globalAlpha = 0.25; ctx.strokeStyle = patT('macro', ox, oy, 0, 8, ctx); ctx.stroke(); ctx.globalAlpha = 1;
      }
    } else { // gravel
      if (stage !== 'top') {
        line(q); ctx.lineWidth = width + 4; ctx.strokeStyle = 'rgba(80,84,60,.25)'; ctx.stroke();
        ctx.lineWidth = width + 1.5; ctx.strokeStyle = 'rgba(150,144,128,.7)'; ctx.stroke();
      }
      if (stage !== 'base') {
        line(q); ctx.lineWidth = width; ctx.strokeStyle = patT('gravel', ox, oy, 0, 0, ctx); ctx.stroke();
        for (const sd of [-1, 1]) { line(offsetLine(q, sd * width * 0.26, closed)); ctx.lineWidth = width * 0.14; ctx.strokeStyle = 'rgba(70,64,56,.2)'; ctx.stroke(); }
        line(q); ctx.lineWidth = width * 0.12; ctx.strokeStyle = 'rgba(230,226,214,.12)'; ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ================================================================ ROOFS */
  const FLATH = ['#7d8085', '#8e9196', '#6f6a64', '#9a958c', '#5e6266', '#857a70'];
  const ROOF = ['#a8503a', '#8e3f30', '#7b4a36', '#4f7458', '#4b6584', '#7a7f86', '#56595f', '#b7653d', '#6d3b2e', '#8c5a3c', '#a0472f', '#5d6b73'];
  function planeLines(ctx, poly, nx, ny, step, alongN, style, w, off) {
    const ux = -ny, uy = nx;
    let sx, sy, dx, dy;
    if (alongN) { sx = ux; sy = uy; dx = nx; dy = ny; } else { sx = nx; sy = ny; dx = ux; dy = uy; }
    let smin = 1e9, smax = -1e9, dmin = 1e9, dmax = -1e9;
    for (const q of poly) {
      const a = q.x * sx + q.y * sy, b = q.x * dx + q.y * dy;
      if (a < smin) smin = a; if (a > smax) smax = a; if (b < dmin) dmin = b; if (b > dmax) dmax = b;
    }
    ctx.beginPath();
    for (let t = smin + (off || 0); t < smax; t += step) { ctx.moveTo(sx * t + dx * dmin, sy * t + dy * dmin); ctx.lineTo(sx * t + dx * dmax, sy * t + dy * dmax); }
    ctx.strokeStyle = style; ctx.lineWidth = w; ctx.stroke();
  }
  function roofPlanes(ctx, planes, color, mat, ca, sa, s) {
    for (const pl of planes) {
      ctx.beginPath(); polyPath(ctx, pl.p, true); ctx.fillStyle = color; ctx.fill();
      const k = lit(pl.nx, pl.ny, ca, sa); pl.k = k;
      ctx.save(); ctx.clip();
      const b = bbox(pl.p);
      if (mat === 'metal') {
        planeLines(ctx, pl.p, pl.nx, pl.ny, 1.7, true, 'rgba(255,255,255,.18)', 0.3, 0.4);
        planeLines(ctx, pl.p, pl.nx, pl.ny, 1.7, true, 'rgba(0,0,0,.22)', 0.3, 0.8);
      } else if (mat === 'tile') {
        planeLines(ctx, pl.p, pl.nx, pl.ny, 1.15, false, 'rgba(0,0,0,.26)', 0.38, 0.2);
        planeLines(ctx, pl.p, pl.nx, pl.ny, 1.15, false, 'rgba(255,236,214,.12)', 0.3, 0.62);
        planeLines(ctx, pl.p, pl.nx, pl.ny, 2.3, true, 'rgba(0,0,0,.07)', 0.25, 0.9);
      } else {
        planeLines(ctx, pl.p, pl.nx, pl.ny, 0.95, false, 'rgba(0,0,0,.14)', 0.26, 0.3);
      }
      grainOver(ctx, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, mat === 'metal' ? 0.35 : 0.6, s);
      ctx.beginPath(); polyPath(ctx, pl.p, true); shadeFill(ctx, k);
      ctx.restore();
    }
  }
  function gablePlanes(hl, hd) {
    return [
      { p: rectPts(-hl, -hd, hl, 0), nx: 0, ny: -1 },
      { p: rectPts(-hl, 0, hl, hd), nx: 0, ny: 1 },
    ];
  }
  function hipPlanes(hl, hd) {
    const r = Math.max(0, hl - hd);
    return [
      { p: [{ x: -hl, y: -hd }, { x: hl, y: -hd }, { x: r, y: 0 }, { x: -r, y: 0 }], nx: 0, ny: -1 },
      { p: [{ x: -hl, y: hd }, { x: hl, y: hd }, { x: r, y: 0 }, { x: -r, y: 0 }], nx: 0, ny: 1 },
      { p: [{ x: -hl, y: -hd }, { x: -r, y: 0 }, { x: -hl, y: hd }], nx: -1, ny: 0 },
      { p: [{ x: hl, y: -hd }, { x: r, y: 0 }, { x: hl, y: hd }], nx: 1, ny: 0 },
    ];
  }
  function boxShadowLocal(ctx, x0, y0, x1, y1, lox, loy, d, a) { shadowPoly(ctx, rectPts(x0, y0, x1, y1), lox * d, loy * d, a); }
  function solarArray(ctx, x0, y0, cols, rows, cw, ch, lox, loy) {
    const W = cols * cw, H = rows * ch;
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x0 + lox * 0.6, y0 + loy * 0.6, W, H);
    ctx.fillStyle = '#1d2a46'; ctx.fillRect(x0, y0, W, H);
    ctx.beginPath();
    for (let i = 0; i <= cols * 3; i++) { ctx.moveTo(x0 + i * cw / 3, y0); ctx.lineTo(x0 + i * cw / 3, y0 + H); }
    for (let j = 0; j <= rows * 4; j++) { ctx.moveTo(x0, y0 + j * ch / 4); ctx.lineTo(x0 + W, y0 + j * ch / 4); }
    ctx.strokeStyle = 'rgba(120,150,200,.35)'; ctx.lineWidth = 0.14; ctx.stroke();
    ctx.beginPath();
    for (let i = 1; i < cols; i++) { ctx.moveTo(x0 + i * cw, y0); ctx.lineTo(x0 + i * cw, y0 + H); }
    for (let j = 1; j < rows; j++) { ctx.moveTo(x0, y0 + j * ch); ctx.lineTo(x0 + W, y0 + j * ch); }
    ctx.strokeStyle = 'rgba(205,214,228,.8)'; ctx.lineWidth = 0.28; ctx.stroke();
    ctx.fillStyle = 'rgba(200,220,255,.14)';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + W * 0.55, y0); ctx.lineTo(x0 + W * 0.3, y0 + H); ctx.lineTo(x0, y0 + H); ctx.fill();
    ctx.strokeStyle = '#c9cfd8'; ctx.lineWidth = 0.32; ctx.strokeRect(x0, y0, W, H);
  }
  function skylight(ctx, cx, cy, w, h, lox, loy) {
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(cx - w / 2 + lox * 0.5, cy - h / 2 + loy * 0.5, w, h);
    ctx.fillStyle = '#dcd8cf'; ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.fillStyle = '#2d4258'; ctx.fillRect(cx - w / 2 + 0.4, cy - h / 2 + 0.4, w - 0.8, h - 0.8);
    ctx.fillStyle = 'rgba(190,220,255,.4)';
    ctx.beginPath(); ctx.moveTo(cx - w / 2 + 0.4, cy - h / 2 + 0.4); ctx.lineTo(cx + w * 0.1, cy - h / 2 + 0.4); ctx.lineTo(cx - w / 2 + 0.4, cy + h * 0.15); ctx.fill();
  }
  function chimney(ctx, cx, cy, sz, lox, loy, brick, cap) {
    const h = sz / 2;
    boxShadowLocal(ctx, cx - h, cy - h, cx + h, cy + h, lox, loy, 2.4, 1.1);
    ctx.fillStyle = brick; ctx.fillRect(cx - h, cy - h, sz, sz);
    ctx.fillStyle = 'rgba(255,240,220,.18)'; ctx.fillRect(cx - h, cy - h, sz, sz * 0.3);
    if (cap) { ctx.fillStyle = '#9aa0a4'; ctx.fillRect(cx - h - 0.3, cy - h - 0.3, sz + 0.6, sz + 0.6); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(cx - h - 0.3, cy - h - 0.3, sz + 0.6, 0.5); }
    else { ctx.fillStyle = '#231d1a'; ctx.fillRect(cx - sz * 0.25, cy - sz * 0.25, sz * 0.5, sz * 0.5); }
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.25; ctx.strokeRect(cx - h, cy - h, sz, sz);
  }
  function flatTop(ctx, L, D, color, ca, sa, s, big) {
    const hl = L / 2, hd = D / 2, pw = big ? clamp(Math.min(L, D) * 0.03, 0.9, 1.6) : 0.8;
    ctx.fillStyle = shade(color, 0.22); ctx.fillRect(-hl, -hd, L, D);
    ctx.fillStyle = color; ctx.fillRect(-hl + pw, -hd + pw, L - 2 * pw, D - 2 * pw);
    ctx.save();
    ctx.beginPath(); ctx.rect(-hl + pw, -hd + pw, L - 2 * pw, D - 2 * pw); ctx.clip();
    grainOver(ctx, -hl, -hd, L, D, 0.75, s);
    ctx.beginPath();
    for (let t = -hl + pw + 3.6; t < hl; t += 3.6) { ctx.moveTo(t, -hd); ctx.lineTo(t, hd); }
    ctx.strokeStyle = 'rgba(0,0,0,.09)'; ctx.lineWidth = 0.3; ctx.stroke();
    const R = rng(s + 5);
    ctx.beginPath();
    for (let k = 0; k < 2 + L * D / 900; k++) { const px = (R() - 0.5) * L * 0.8, py = (R() - 0.5) * D * 0.8; ctx.ellipse(px, py, 2 + R() * 6, 1.5 + R() * 4, R() * PI, 0, TAU); }
    ctx.fillStyle = 'rgba(30,30,30,.06)'; ctx.fill();
    for (const [nx, ny] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const k = lit(nx, ny, ca, sa);
      if (k <= 0.05) continue;
      const sw = (big ? 2.2 : 1.3) * k;
      ctx.fillStyle = 'rgba(10,14,26,' + (0.3 * k).toFixed(3) + ')';
      if (ny === -1) ctx.fillRect(-hl, -hd + pw, L, sw);
      if (ny === 1) ctx.fillRect(-hl, hd - pw - sw, L, sw);
      if (nx === -1) ctx.fillRect(-hl + pw, -hd, sw, D);
      if (nx === 1) ctx.fillRect(hl - pw - sw, -hd, sw, D);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(20,20,20,.5)'; ctx.lineWidth = 0.35; ctx.strokeRect(-hl, -hd, L, D);
  }
  function vents(ctx, R, n, hl, hd, lox, loy, col) {
    for (let k = 0; k < n; k++) {
      const vx = (R() - 0.5) * (hl * 2 - 6), vy = (R() - 0.5) * (hd * 2 - 6);
      if (R() < 0.5) {
        const sz = 1.4 + R() * 1.2;
        boxShadowLocal(ctx, vx - sz / 2, vy - sz / 2, vx + sz / 2, vy + sz / 2, lox, loy, 1.2, 1);
        ctx.fillStyle = col || '#b9b7b0'; ctx.fillRect(vx - sz / 2, vy - sz / 2, sz, sz);
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(vx - sz / 4, vy - sz / 4, sz / 2, sz / 2);
      } else {
        const r = 0.6 + R() * 0.5;
        ctx.fillStyle = SHA + '.25)'; ctx.beginPath(); ctx.arc(vx + lox * 0.9, vy + loy * 0.9, r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c7c7c2'; ctx.beginPath(); ctx.arc(vx, vy, r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(vx, vy, r * 0.45, 0, TAU); ctx.fill();
      }
    }
  }

  /* ================================================================ HOUSE */
  function house(ctx, x, y, w, h, opt) {
    opt = opt || {};
    const s = toSeed(opt.seed, x * 3 + w, y * 3 + h);
    const roof = opt.roof || (hash(s, 1) < 0.55 ? 'gable' : 'hip');
    const color = opt.color || (roof === 'flat' ? FLATH : ROOF)[(hash(s, 2) * (roof === 'flat' ? FLATH : ROOF).length) | 0];
    let rot = opt.rot || 0, L = w, D = h;
    if (h > w) { L = h; D = w; rot += PI / 2; }
    const cx = x + w / 2, cy = y + h / 2, ca = Math.cos(rot), sa = Math.sin(rot), hl = L / 2, hd = D / 2;
    const ht = opt.height != null ? opt.height : (roof === 'flat' ? 3 + D * 0.05 : 2.8 + D * 0.1);
    const wc = rectPts(-hl, -hd, hl, hd).map(q => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
    ctx.save();
    shadowPoly(ctx, wc, ht, ht);
    ctx.translate(cx, cy); ctx.rotate(rot);
    const lox = ca + sa, loy = ca - sa;
    const R = rng(s + 77);
    if (roof === 'flat') {
      flatTop(ctx, L, D, color, ca, sa, s, false);
      vents(ctx, R, 1 + ((R() * 3) | 0), hl, hd, lox, loy);
      if (opt.solar || (opt.solar == null && hash(s, 4) < 0.25)) {
        const cols = Math.max(1, Math.floor((L - 8) / 4.4)), rows = Math.max(1, Math.min(2, Math.floor((D - 8) / 7)));
        solarArray(ctx, -cols * 2.2, -rows * 3.3, cols, rows, 4.4, 6.6, lox, loy);
      }
    } else {
      const mat = opt.material || ['tile', 'metal', 'shingle'][(hash(s, 3) * 3) | 0];
      const planes = roof === 'hip' ? hipPlanes(hl, hd) : gablePlanes(hl, hd);
      roofPlanes(ctx, planes, color, mat, ca, sa, s);
      // конёк и рёбра
      const r = roof === 'hip' ? Math.max(0, hl - hd) : hl;
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
      if (roof === 'hip') for (const sx of [-1, 1]) for (const sy of [-1, 1]) { ctx.moveTo(sx * hl, sy * hd); ctx.lineTo(sx * r, 0); }
      ctx.lineCap = 'round';
      ctx.strokeStyle = shade(color, 0.16); ctx.lineWidth = 1.0; ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 0.28; ctx.stroke();
      // водостоки по свесам и торцевые доски
      ctx.strokeStyle = 'rgba(232,230,220,.4)'; ctx.lineWidth = 0.45;
      ctx.beginPath(); ctx.moveTo(-hl + 0.3, -hd + 0.3); ctx.lineTo(hl - 0.3, -hd + 0.3); ctx.moveTo(-hl + 0.3, hd - 0.3); ctx.lineTo(hl - 0.3, hd - 0.3);
      if (roof === 'hip') { ctx.moveTo(-hl + 0.3, -hd + 0.3); ctx.lineTo(-hl + 0.3, hd - 0.3); ctx.moveTo(hl - 0.3, -hd + 0.3); ctx.lineTo(hl - 0.3, hd - 0.3); }
      ctx.stroke();
      if (roof !== 'hip') { ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(-hl, -hd, 0.6, D); ctx.fillRect(hl - 0.6, -hd, 0.6, D); }
      ctx.strokeStyle = 'rgba(25,18,14,.5)'; ctx.lineWidth = 0.35; ctx.strokeRect(-hl, -hd, L, D);
      // южный скат: солнечные панели; другие скаты — мансардные окна
      const southNy = ca >= 0 ? 1 : -1; // нормаль (0,1) в мире = (-sin, cos): смотрит на юг, если cos ≥ 0
      const effL = roof === 'hip' ? hl - hd * 0.55 : hl - 1.5;
      let used = 0;
      const wantSolar = opt.solar != null ? opt.solar : hash(s, 4) < 0.2;
      if (wantSolar && hd > 7 && effL > 5) {
        const cols = clamp(Math.floor(effL * 2 * 0.8 / 4.2), 1, 10), rows = clamp(Math.floor(hd * 0.75 / 6.6), 1, 3);
        const y0 = southNy > 0 ? hd * 0.12 : -hd * 0.12 - rows * 6.6;
        solarArray(ctx, -cols * 2.1, y0, cols, rows, 4.2, 6.6, lox, loy);
        used = southNy;
      }
      const wantSky = opt.skylights != null ? opt.skylights : hash(s, 5) < 0.3;
      if (wantSky && hd > 5) {
        const n = 1 + ((hash(s, 6) * 3) | 0), side = used ? -used : (hash(s, 7) < 0.5 ? -1 : 1);
        for (let k = 0; k < n; k++) {
          const px = (n === 1 ? 0 : -effL * 0.55 + k * (effL * 1.1 / (n - 1))) * 0.9;
          skylight(ctx, px, side * hd * 0.5, 2.6, Math.min(3.6, hd * 0.5), lox, loy);
        }
      }
      const wantDish = opt.dish != null ? opt.dish : hash(s, 8) < 0.2;
      if (wantDish) {
        const px = (hash(s, 9) - 0.5) * effL, py = southNy * hd * 0.7;
        ctx.fillStyle = SHA + '.3)'; ctx.beginPath(); ctx.ellipse(px + lox * 1.2, py + loy * 1.2, 1.3, 1.1, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e4e4df'; ctx.beginPath(); ctx.ellipse(px, py, 1.3, 1.1, 0.4, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 0.9, py + 0.4); ctx.strokeStyle = '#555'; ctx.lineWidth = 0.25; ctx.stroke();
      }
      const wantChim = opt.chimney != null ? opt.chimney : hash(s, 10) < 0.7;
      if (wantChim) {
        const sz = clamp(D * 0.095, 2, 3.4), lim = Math.max(0, (roof === 'hip' ? r : hl) - sz);
        const px = (hash(s, 11) < 0.5 ? -1 : 1) * Math.min(lim, hl * (0.2 + hash(s, 12) * 0.35));
        const py = (hash(s, 13) - 0.5) * hd * 0.5;
        chimney(ctx, px, py, sz, lox, loy, hash(s, 14) < 0.7 ? '#8b4636' : '#a59f94', hash(s, 15) < 0.3);
      }
    }
    ctx.restore();
  }

  /* ============================================================= BUILDING */
  const FLAT = ['#8e9196', '#7d8085', '#a3a19a', '#6f7377', '#9a8f86', '#868a80'];
  const IND = ['#a7aeb3', '#9fa8ad', '#b5b2a8', '#8f9ea6', '#a9a39a'];
  function building(ctx, x, y, w, h, opt) {
    opt = opt || {};
    const s = toSeed(opt.seed, x * 3 + w, y * 3 + h), kind = opt.kind === 'industrial' ? 'industrial' : 'flat';
    const floors = opt.floors > 0 ? opt.floors : (kind === 'industrial' ? 2 : 5);
    const color = opt.color || (kind === 'industrial' ? IND : FLAT)[(hash(s, 2) * (kind === 'industrial' ? IND : FLAT).length) | 0];
    let rot = opt.rot || 0, L = w, D = h;
    if (h > w) { L = h; D = w; rot += PI / 2; }
    const cx = x + w / 2, cy = y + h / 2, ca = Math.cos(rot), sa = Math.sin(rot), hl = L / 2, hd = D / 2;
    const ht = Math.min(44, 2.5 + floors * 1.8);
    const wc = rectPts(-hl, -hd, hl, hd).map(q => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
    ctx.save();
    shadowPoly(ctx, wc, ht, ht, 1.1);
    ctx.translate(cx, cy); ctx.rotate(rot);
    const lox = ca + sa, loy = ca - sa, R = rng(s + 31);
    if (kind === 'flat') {
      flatTop(ctx, L, D, color, ca, sa, s, true);
      // водосточные воронки
      ctx.fillStyle = '#3a3c3e';
      ctx.beginPath();
      for (let k = 0; k < 2 + L / 40; k++) circ(ctx, (R() - 0.5) * (L - 8), (R() - 0.5) * (D - 8), 0.55);
      ctx.fill();
      vents(ctx, R, 3 + Math.floor(L * D / 500), hl, hd, lox, loy);
      // машинные помещения лифтов / выходы на кровлю
      const nm = floors >= 5 ? Math.max(1, Math.round(L / 55)) : (L * D > 900 ? 1 : 0);
      for (let i = 0; i < nm; i++) {
        const bw = clamp(D * 0.26, 5, 13), bh = clamp(D * 0.22, 4, 10);
        const px = -hl + (i + 0.5) * L / nm + (R() - 0.5) * 4, py = (R() - 0.5) * (D - bh - 6) * 0.5;
        boxShadowLocal(ctx, px - bw / 2, py - bh / 2, px + bw / 2, py + bh / 2, lox, loy, 2.8, 1);
        ctx.fillStyle = shade(color, 0.28); ctx.fillRect(px - bw / 2, py - bh / 2, bw, bh);
        ctx.fillStyle = shade(color, 0.04); ctx.fillRect(px - bw / 2 + 0.6, py - bh / 2 + 0.6, bw - 1.2, bh - 1.2);
        grainOver(ctx, px - bw / 2, py - bh / 2, bw, bh, 0.6, s + i);
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 0.3; ctx.strokeRect(px - bw / 2, py - bh / 2, bw, bh);
        ctx.fillStyle = '#5b5e62'; ctx.fillRect(px + bw / 2 - 2.2, py - 0.8, 1.6, 1.6);
      }
      // антенны
      const na = (R() * 3) | 0;
      ctx.lineCap = 'round';
      for (let k = 0; k < na; k++) {
        const px = (R() - 0.5) * (L - 10), py = (R() - 0.5) * (D - 10), sl = 5 + R() * 5;
        ctx.strokeStyle = SHA + '.3)'; ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + lox * sl, py + loy * sl); ctx.stroke();
        ctx.strokeStyle = '#6a6d70'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(px - 1.6, py); ctx.lineTo(px + 1.6, py); ctx.moveTo(px - 1, py - 0.8); ctx.lineTo(px + 1, py - 0.8); ctx.stroke();
        ctx.fillStyle = '#3e4144'; ctx.beginPath(); ctx.arc(px, py, 0.4, 0, TAU); ctx.fill();
      }
    } else {
      // профлист
      ctx.fillStyle = color; ctx.fillRect(-hl, -hd, L, D);
      ctx.save(); ctx.beginPath(); ctx.rect(-hl, -hd, L, D); ctx.clip();
      ctx.beginPath(); for (let t = -hl + 0.5; t < hl; t += 1.1) { ctx.moveTo(t, -hd); ctx.lineTo(t, hd); }
      ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 0.32; ctx.stroke();
      ctx.beginPath(); for (let t = -hl + 0.95; t < hl; t += 1.1) { ctx.moveTo(t, -hd); ctx.lineTo(t, hd); }
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 0.25; ctx.stroke();
      // двускатная пологая кровля: освещённость половин
      ctx.beginPath(); ctx.rect(-hl, -hd, L, hd); shadeFill(ctx, lit(0, -1, ca, sa), 0.45);
      ctx.beginPath(); ctx.rect(-hl, 0, L, hd); shadeFill(ctx, lit(0, 1, ca, sa), 0.45);
      grainOver(ctx, -hl, -hd, L, D, 0.45, s);
      // ржавчина и грязь
      ctx.beginPath();
      for (let k = 0; k < 2 + L * D / 2500; k++) { const px = (R() - 0.5) * L * 0.9, py = (R() - 0.5) * D * 0.9, rr = 2 + R() * 5; ctx.moveTo(px + rr, py); ctx.ellipse(px, py, rr, rr * (0.5 + R() * 0.4), 0, 0, TAU); }
      ctx.fillStyle = 'rgba(120,80,48,.07)'; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.moveTo(-hl, 0); ctx.lineTo(hl, 0); ctx.strokeStyle = shade(color, 0.2); ctx.lineWidth = 0.9; ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.25; ctx.stroke();
      // световые фонари
      if (D >= 26) {
        const nl = D >= 60 ? 2 : 1, lw = clamp(D * 0.11, 3.5, 7), len = L * 0.8;
        for (let i = 0; i < nl; i++) {
          const py = nl === 1 ? -hd * 0.45 : (i ? hd * 0.5 : -hd * 0.5) - lw / 2 + (nl === 1 ? 0 : 0);
          const x0 = -len / 2;
          boxShadowLocal(ctx, x0, py, x0 + len, py + lw, lox, loy, 1.6, 1);
          ctx.fillStyle = '#c9d3d6'; ctx.fillRect(x0, py, len, lw);
          ctx.fillStyle = '#8eb0c2'; ctx.fillRect(x0 + 0.4, py + 0.4, len - 0.8, lw / 2 - 0.4);
          ctx.fillStyle = '#7a9db1'; ctx.fillRect(x0 + 0.4, py + lw / 2, len - 0.8, lw / 2 - 0.4);
          ctx.beginPath(); for (let t = x0 + 3; t < x0 + len; t += 3) { ctx.moveTo(t, py); ctx.lineTo(t, py + lw); }
          ctx.strokeStyle = 'rgba(230,236,238,.8)'; ctx.lineWidth = 0.3; ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x0 + 0.4, py + 0.4, len - 0.8, 0.7);
          ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.3; ctx.strokeRect(x0, py, len, lw);
        }
      }
      // крышные вентиляторы
      const nf = 2 + ((R() * 4) | 0);
      for (let k = 0; k < nf; k++) {
        const px = -hl + 5 + R() * (L - 10), py = (R() < 0.5 ? -1 : 1) * (hd * (0.15 + R() * 0.15)), r = 1.6 + R() * 0.9;
        ctx.fillStyle = SHA + '.3)'; ctx.beginPath(); ctx.arc(px + lox * 1.5, py + loy * 1.5, r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c4c8ca'; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4d5256'; ctx.beginPath(); ctx.arc(px, py, r * 0.78, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#aeb3b6'; ctx.lineWidth = 0.35; ctx.beginPath();
        const a0 = R() * PI;
        for (let b = 0; b < 4; b++) { const a = a0 + b * PI / 2; ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * r * 0.75, py + Math.sin(a) * r * 0.75); }
        ctx.stroke();
        ctx.fillStyle = '#d8dadb'; ctx.beginPath(); ctx.arc(px, py, r * 0.22, 0, TAU); ctx.fill();
      }
      // короба вентиляции и трубы
      const nb = 1 + ((R() * 3) | 0);
      for (let k = 0; k < nb; k++) {
        const bw = 3 + R() * 5, bh = 2.4 + R() * 3, px = -hl + 3 + R() * (L - bw - 6), py = (R() - 0.5) * (D - bh - 6);
        boxShadowLocal(ctx, px, py, px + bw, py + bh, lox, loy, 1.6, 1);
        ctx.fillStyle = '#c8cbc9'; ctx.fillRect(px, py, bw, bh);
        ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(px, py + bh * 0.55, bw, bh * 0.45);
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 0.25; ctx.strokeRect(px, py, bw, bh);
      }
      if (R() < 0.7) {
        const py = hd - 3, x0 = -hl + 4, x1 = -hl + 4 + L * (0.4 + R() * 0.4);
        ctx.lineCap = 'round';
        ctx.strokeStyle = SHA + '.3)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(x0 + lox, py + loy); ctx.lineTo(x1 + lox, py + loy); ctx.stroke();
        ctx.strokeStyle = '#8f9599'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(x0, py - 0.25); ctx.lineTo(x1, py - 0.25); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(20,20,20,.5)'; ctx.lineWidth = 0.4; ctx.strokeRect(-hl, -hd, L, D);
    }
    ctx.restore();
  }

  /* ========================================================= SHED, GARAGES */
  const SHEDC = { metal: ['#8c9296', '#9b5b3b', '#5f7a66', '#6d7f93', '#a8a49a'], wood: ['#8a6d4c', '#7b5a3e', '#977a58'], felt: ['#55524e', '#4a4c50', '#5e574f'] };
  // сарай / баня / хозблок: односкатная (по умолчанию) или двускатная кровля; материал metal|wood|felt
  function shed(ctx, x, y, w, h, opt) {
    opt = opt || {};
    const s = toSeed(opt.seed, x * 3 + w, y * 3 + h);
    const mat = opt.material || ['metal', 'wood', 'felt'][(hash(s, 2) * 3) | 0];
    const pal = SHEDC[mat] || SHEDC.metal, color = opt.color || pal[(hash(s, 1) * pal.length) | 0];
    let rot = opt.rot || 0, L = w, D = h;
    if (h > w) { L = h; D = w; rot += PI / 2; }
    const cx = x + w / 2, cy = y + h / 2, ca = Math.cos(rot), sa = Math.sin(rot), hl = L / 2, hd = D / 2;
    const wc = rectPts(-hl, -hd, hl, hd).map(q => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
    const R = rng(s + 9), lox = ca + sa, loy = ca - sa;
    ctx.save();
    shadowPoly(ctx, wc, 2.8, 2.8);
    ctx.translate(cx, cy); ctx.rotate(rot);
    const gable = opt.roof === 'gable', ny = hash(s, 3) < 0.5 ? 1 : -1;
    const planes = gable ? gablePlanes(hl, hd) : [{ p: rectPts(-hl, -hd, hl, hd), nx: 0, ny }];
    for (const pl of planes) {
      ctx.beginPath(); polyPath(ctx, pl.p, true); ctx.fillStyle = color; ctx.fill();
      ctx.save(); ctx.clip();
      const b = bbox(pl.p);
      if (mat === 'metal') { // профлист: волны вдоль ската
        planeLines(ctx, pl.p, pl.nx, pl.ny, 1.0, true, 'rgba(255,255,255,.22)', 0.3, 0.25);
        planeLines(ctx, pl.p, pl.nx, pl.ny, 1.0, true, 'rgba(0,0,0,.24)', 0.3, 0.7);
      } else if (mat === 'wood') { // доски внахлёст с щелями
        planeLines(ctx, pl.p, pl.nx, pl.ny, 1.4, true, 'rgba(40,24,12,.42)', 0.24, 0.3);
        planeLines(ctx, pl.p, pl.nx, pl.ny, 1.4, true, 'rgba(255,226,180,.16)', 0.2, 0.62);
        ctx.beginPath(); // торцы досок
        for (let k = 0; k < L * D / 30; k++) { const px = b.x0 + R() * (b.x1 - b.x0), py = b.y0 + R() * (b.y1 - b.y0); ctx.moveTo(px, py); ctx.lineTo(px - pl.ny * 0.7, py + pl.nx * 0.7); }
        ctx.strokeStyle = 'rgba(40,24,12,.3)'; ctx.lineWidth = 0.2; ctx.stroke();
      } else { // рубероид: полосы поперёк ската с нахлёстом + заплатки
        planeLines(ctx, pl.p, pl.nx, pl.ny, 2.4, false, 'rgba(0,0,0,.3)', 0.32, 0.8);
        planeLines(ctx, pl.p, pl.nx, pl.ny, 2.4, false, 'rgba(255,255,255,.1)', 0.25, 1.1);
        ctx.beginPath();
        for (let k = 0; k < 1 + L * D / 220; k++) { const pw = 2 + R() * 4, ph = 1.5 + R() * 2.5; ctx.rect(b.x0 + R() * (b.x1 - b.x0 - pw), b.y0 + R() * (b.y1 - b.y0 - ph), pw, ph); }
        ctx.fillStyle = 'rgba(20,20,22,.28)'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.2; ctx.stroke();
      }
      grainOver(ctx, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 0.5, s);
      // пятна: ржавчина на металле, мох и листья на дереве и рубероиде
      ctx.beginPath();
      for (let k = 0; k < 2 + L * D / 260; k++) ctx.ellipse(b.x0 + R() * (b.x1 - b.x0), b.y0 + R() * (b.y1 - b.y0), 0.8 + R() * 2.4, 0.6 + R() * 1.6, R() * PI, 0, TAU);
      ctx.fillStyle = mat === 'metal' ? 'rgba(150,74,34,.26)' : 'rgba(84,110,40,.26)'; ctx.fill();
      // скат: к нижнему краю темнее (уклон от света или к нему)
      const k = lit(pl.nx, pl.ny, ca, sa);
      const g = ctx.createLinearGradient(-pl.nx * hd, -pl.ny * hd + (gable ? pl.ny * hd : 0), pl.nx * hd, pl.ny * hd);
      g.addColorStop(0, 'rgba(255,248,228,' + (0.1 + Math.max(0, k) * 0.18).toFixed(3) + ')'); g.addColorStop(1, 'rgba(10,12,28,' + (0.12 + Math.max(0, -k) * 0.3).toFixed(3) + ')');
      ctx.fillStyle = g; ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.restore();
    }
    // конёк / верхняя планка и капельник по нижнему краю
    ctx.lineCap = 'butt';
    if (gable) {
      ctx.beginPath(); ctx.moveTo(-hl, 0); ctx.lineTo(hl, 0);
      ctx.strokeStyle = shade(color, 0.2); ctx.lineWidth = 0.9; ctx.stroke(); ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 0.22; ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(-hl, ny > 0 ? -hd : hd - 0.55, L, 0.55);
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(-hl, ny > 0 ? hd - 0.45 : -hd, L, 0.45);
    }
    // печная труба (баня) — иногда
    if (opt.chimney || (opt.chimney == null && hash(s, 6) < 0.25 && L * D > 180)) {
      const px = (hash(s, 7) - 0.5) * L * 0.5, py = gable ? 0 : (hash(s, 8) - 0.5) * D * 0.4, r = 0.85, sl = 1.3;
      ctx.fillStyle = SHA + '.28)'; ctx.beginPath(); ctx.arc(px + lox * sl, py + loy * sl, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = SHA + '.28)'; ctx.lineWidth = r * 2; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + lox * sl, py + loy * sl); ctx.stroke();
      ctx.fillStyle = '#6f7477'; ctx.beginPath(); ctx.arc(px, py, r + 0.25, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9da3a6'; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2a2826'; ctx.beginPath(); ctx.arc(px, py, r * 0.55, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.18; ctx.beginPath(); ctx.arc(px, py, r * 0.9, PI * 0.9, PI * 1.7); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(20,15,10,.6)'; ctx.lineWidth = 0.3; ctx.strokeRect(-hl, -hd, L, D);
    ctx.restore();
  }
  const GATEC = ['#4d6b4f', '#6b4a3a', '#45607a', '#7a6a50', '#8a3f2f', '#5f6466', '#3d5d6e'];
  function garages(ctx, x, y, n, opt) {
    opt = opt || {}; n = Math.max(1, n | 0);
    const s = toSeed(opt.seed, x, y), uw = opt.w || 13, ud = opt.h || 24, W = n * uw, rot = opt.rot || 0;
    const cx = x + W / 2, cy = y + ud / 2, ca = Math.cos(rot), sa = Math.sin(rot), hw = W / 2, hd = ud / 2;
    const wc = rectPts(-hw, -hd, hw, hd).map(q => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot);
    if (opt.apron) {
      ctx.fillStyle = patT('concrete', 0, 0, 0, 0, rot ? null : ctx); ctx.fillRect(-hw - 1, hd, W + 2, 6);
      ctx.fillStyle = 'rgba(40,40,30,.12)'; ctx.fillRect(-hw - 1, hd + 5, W + 2, 1);
    }
    ctx.rotate(-rot); ctx.translate(-cx, -cy);
    shadowPoly(ctx, wc, 3, 3);
    ctx.translate(cx, cy); ctx.rotate(rot);
    const lox = ca + sa, loy = ca - sa, R = rng(s + 5);
    for (let i = 0; i < n; i++) {
      const x0 = -hw + i * uw, tone = (R() - 0.5) * 0.2;
      const base = R() < 0.15 ? '#6f6a62' : '#5d5853';
      ctx.fillStyle = shade(base, tone); ctx.fillRect(x0, -hd, uw, ud);
      ctx.save(); ctx.beginPath(); ctx.rect(x0, -hd, uw, ud); ctx.clip();
      ctx.beginPath(); for (let t = -hd + 2.5; t < hd; t += 3) { ctx.moveTo(x0, t); ctx.lineTo(x0 + uw, t + (R() - 0.5) * 0.6); }
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 0.3; ctx.stroke();
      if (R() < 0.45) { ctx.fillStyle = R() < 0.5 ? 'rgba(40,40,44,.35)' : 'rgba(150,140,120,.25)'; ctx.fillRect(x0 + 1 + R() * uw * 0.3, -hd + 2 + R() * ud * 0.5, uw * (0.3 + R() * 0.4), ud * (0.15 + R() * 0.3)); }
      if (R() < 0.3) { ctx.fillStyle = 'rgba(80,100,110,.5)'; ctx.beginPath(); ctx.ellipse(x0 + uw * (0.3 + R() * 0.4), (R() - 0.5) * ud * 0.6, 1.5 + R() * 2, 1 + R(), 0, 0, TAU); ctx.fill(); }
      if (R() < 0.3) { ctx.fillStyle = 'rgba(90,120,50,.35)'; ctx.beginPath(); ctx.ellipse(x0 + uw * R(), -hd + 1.5, 2 + R() * 2, 1.2, 0, 0, TAU); ctx.fill(); }
      grainOver(ctx, x0, -hd, uw, ud, 0.42, s + i);
      // уклон кровли к задней стене: у фасада светлее, сзади — тень от парапета соседей
      ctx.fillStyle = 'rgba(255,250,230,.08)'; ctx.fillRect(x0, hd - ud * 0.3, uw, ud * 0.3);
      ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(x0, -hd, uw, 1.2);
      if (R() < 0.25) { // вытяжная труба
        const px = x0 + 2 + R() * (uw - 4), py = -hd + 3 + R() * 5;
        ctx.fillStyle = SHA + '.3)'; ctx.beginPath(); ctx.arc(px + lox * 1.2, py + loy * 1.2, 0.6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8c9296'; ctx.beginPath(); ctx.arc(px, py, 0.6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2a2826'; ctx.beginPath(); ctx.arc(px, py, 0.32, 0, TAU); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = GATEC[(R() * GATEC.length) | 0]; ctx.fillRect(x0 + 0.8, hd - 0.9, uw - 1.6, 0.9);
      ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(x0 + 0.8, hd - 0.9, uw - 1.6, 0.3);
    }
    ctx.beginPath(); for (let i = 1; i < n; i++) { ctx.moveTo(-hw + i * uw, -hd); ctx.lineTo(-hw + i * uw, hd); }
    ctx.strokeStyle = '#a19c92'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 0.25; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,240,.18)'; ctx.fillRect(-hw, -hd, W, 0.7);
    ctx.strokeStyle = 'rgba(20,20,20,.55)'; ctx.lineWidth = 0.35; ctx.strokeRect(-hw, -hd, W, ud);
    ctx.restore();
    return { w: W, h: ud };
  }
  function greenhouse(ctx, x, y, w, h, opt) {
    opt = opt || {};
    const s = toSeed(opt.seed, x * 3 + w, y * 3 + h);
    let rot = opt.rot || 0, L = w, D = h;
    if (h > w) { L = h; D = w; rot += PI / 2; }
    const cx = x + w / 2, cy = y + h / 2, ca = Math.cos(rot), sa = Math.sin(rot), hl = L / 2, hd = D / 2;
    const wc = rectPts(-hl, -hd, hl, hd).map(q => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
    ctx.save();
    shadowPoly(ctx, wc, 2, 2, 0.6);
    ctx.translate(cx, cy); ctx.rotate(rot);
    const R = rng(s + 3);
    ctx.fillStyle = '#7d6a4e'; ctx.fillRect(-hl, -hd, L, D);
    ctx.fillStyle = '#a89878'; ctx.fillRect(-hl, -D * 0.08, L, D * 0.16);
    ctx.beginPath();
    for (const side of [-1, 1]) for (let t = -hl + 1.5; t < hl - 1; t += 2.2) circ(ctx, t + (R() - 0.5) * 0.6, side * hd * 0.5 + (R() - 0.5) * hd * 0.4, 0.9 + R() * 0.9);
    ctx.fillStyle = '#4f8a3a'; ctx.fill();
    ctx.beginPath();
    for (const side of [-1, 1]) for (let t = -hl + 2; t < hl - 1; t += 3.1) circ(ctx, t + (R() - 0.5), side * hd * 0.5 + (R() - 0.5) * hd * 0.3, 0.5 + R() * 0.4);
    ctx.fillStyle = R() < 0.5 ? '#d8452f' : '#8cc152'; ctx.fill();
    // поликарбонат
    ctx.fillStyle = 'rgba(218,236,246,.42)'; ctx.fillRect(-hl, -hd, L, D);
    const k1 = lit(0, -1, ca, sa), k2 = lit(0, 1, ca, sa);
    ctx.beginPath(); ctx.rect(-hl, -hd, L, hd); shadeFill(ctx, k1, 0.8);
    ctx.beginPath(); ctx.rect(-hl, 0, L, hd); shadeFill(ctx, k2, 0.8);
    ctx.fillStyle = 'rgba(255,255,255,.34)'; ctx.fillRect(-hl, (k1 > k2 ? -hd * 0.55 : hd * 0.2), L, hd * 0.32);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-hl, (k1 > k2 ? -hd * 0.2 : hd * 0.55), L, hd * 0.12);
    ctx.beginPath(); for (let t = -hl; t <= hl + 0.01; t += Math.max(2.5, L / Math.round(L / 3.5))) { ctx.moveTo(t, -hd); ctx.lineTo(t, hd); }
    ctx.moveTo(-hl, 0); ctx.lineTo(hl, 0);
    ctx.strokeStyle = 'rgba(250,252,255,.85)'; ctx.lineWidth = 0.35; ctx.stroke();
    ctx.strokeStyle = 'rgba(90,110,120,.6)'; ctx.lineWidth = 0.35; ctx.strokeRect(-hl, -hd, L, D);
    ctx.restore();
  }

  /* ========================================================= FENCES, GATE */
  const FENCE = {
    wood: { w: 0.95, color: '#8a6845', hi: '#c49c6c', post: 1.1, pc: '#5e4630', step: 10, sh: 1.6, sa: 0.15, dash: [0.8, 0.25] },
    metal: { w: 0.7, color: '#3f6b52', hi: '#84b095', post: 1.0, pc: '#2b3530', step: 10, sh: 1.8, sa: 0.24 },
    chain: { w: 0.55, color: 'rgba(150,158,163,.95)', hi: 'rgba(228,232,234,.8)', post: 0.75, pc: '#5d6468', step: 10, sh: 1.6, sa: 0.12, dash: [0.35, 0.3], round: true },
    concrete: { w: 1.1, color: '#bdb8ad', hi: '#dcd8ce', post: 1.5, pc: '#a29d92', step: 8, sh: 2.3, sa: 0.24 },
  };
  function fence(ctx, pts, kind) {
    const p = P(pts);
    if (p.length < 2) return;
    const st = FENCE[kind] || FENCE.wood;
    ctx.save();
    ctx.fillStyle = SHA + st.sa + ')';
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1];
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x + st.sh, b.y + st.sh); ctx.lineTo(a.x + st.sh, a.y + st.sh); ctx.closePath(); ctx.fill();
    }
    ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
    ctx.beginPath(); polyPath(ctx, p, false);
    ctx.lineWidth = st.w; ctx.strokeStyle = st.color;
    if (kind === 'chain') ctx.setLineDash(st.dash);
    ctx.stroke(); ctx.setLineDash([]);
    if (kind === 'wood' || !FENCE[kind]) { ctx.setLineDash(st.dash); ctx.lineWidth = st.w * 0.55; ctx.strokeStyle = st.hi; ctx.stroke(); ctx.setLineDash([]); }
    else if (st.hi) { ctx.lineWidth = st.w * 0.3; ctx.strokeStyle = st.hi; ctx.stroke(); }
    if (kind === 'concrete') { ctx.setLineDash([0.3, st.step - 0.3]); ctx.lineWidth = st.w; ctx.strokeStyle = 'rgba(80,76,70,.6)'; ctx.stroke(); ctx.setLineDash([]); }
    // столбы
    const c = cum(p), L = c[c.length - 1], posts = [];
    for (let i = 0; i < p.length; i++) posts.push(p[i]);
    for (let d = st.step; d < L - 2; d += st.step) posts.push(along(p, c, d));
    const ps = st.post;
    ctx.fillStyle = SHA + '.25)'; ctx.beginPath();
    for (const q of posts) circ(ctx, q.x + ps * 0.7, q.y + ps * 0.7, ps * 0.55);
    ctx.fill();
    ctx.fillStyle = st.pc; ctx.beginPath();
    for (const q of posts) { if (st.round) circ(ctx, q.x, q.y, ps * 0.6); else ctx.rect(q.x - ps / 2, q.y - ps / 2, ps, ps); }
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.beginPath();
    for (const q of posts) ctx.rect(q.x - ps / 2, q.y - ps / 2, ps, ps * 0.35);
    ctx.fill();
    ctx.restore();
  }
  // ворота: две створки (рамка из профтрубы с заполнением) на столбах; open 0..1 — насколько раскрыты
  function gate(ctx, x, y, w, rot, open) {
    w = w > 0 ? w : 14; rot = rot || 0; open = clamp(open || 0, 0, 1);
    const ca = Math.cos(rot), sa = Math.sin(rot), hw = w / 2, big = w > 24;
    const lw = big ? 1.3 : 1.0, ps = big ? 2.2 : 1.7;
    ctx.save();
    ctx.lineCap = 'butt';
    const leaf = (sx) => { // концы створки в мире
      const ax = x + ca * sx * hw, ay = y + sa * sx * hw, ang = rot + (sx < 0 ? 0 : PI) + (sx < 0 ? 1 : -1) * open * 1.3;
      return [ax, ay, ax + Math.cos(ang) * (hw - 0.3), ay + Math.sin(ang) * (hw - 0.3)];
    };
    const ls = [leaf(-1), leaf(1)];
    const seg = (o, wd, st) => { ctx.beginPath(); for (const l of ls) { ctx.moveTo(l[0] + o, l[1] + o); ctx.lineTo(l[2] + o, l[3] + o); } ctx.lineWidth = wd; ctx.strokeStyle = st; ctx.stroke(); };
    seg(1.6, lw * 1.6, SHA + '.24)');                 // тень створок
    seg(0, lw + 0.4, '#1f2b26');                      // контур
    seg(0, lw, '#3c6b55');                            // рама
    ctx.setLineDash([0.35, 0.45]); seg(0, lw * 0.55, '#2b4a3c'); ctx.setLineDash([]); // прутья/профиль заполнения
    seg(-lw * 0.22, lw * 0.22, 'rgba(190,226,206,.75)'); // блик по верхней кромке
    // засов и петли
    ctx.fillStyle = '#d8b440'; ctx.beginPath(); for (const l of ls) circ(ctx, l[2], l[3], lw * 0.42); ctx.fill();
    for (const sx of [-1, 1]) {
      const px = x + ca * sx * (hw + ps * 0.4), py = y + sa * sx * (hw + ps * 0.4), h = ps / 2;
      ctx.fillStyle = SHA + '.32)'; ctx.fillRect(px - h + 1.6, py - h + 1.6, ps, ps);
      ctx.fillStyle = '#2e3336'; ctx.fillRect(px - h - 0.2, py - h - 0.2, ps + 0.4, ps + 0.4);
      ctx.fillStyle = '#7d868a'; ctx.fillRect(px - h, py - h, ps, ps);
      ctx.fillStyle = '#b9c0c3'; ctx.fillRect(px - h, py - h, ps, ps * 0.35);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(px - h * 0.4, py - h * 0.4, h * 0.8, h * 0.8);
    }
    ctx.restore();
  }

  /* ================================================================= TREES */
  const TREEPAL = {
    deciduous: [['#2f5a24', '#46762f', '#679a40', '#90bd58'], ['#2b5228', '#406d38', '#5f9049', '#87b363'], ['#355d22', '#4f7f2c', '#73a33c', '#a0c95c']],
    birch: [['#4b7330', '#6a9641', '#8fba56', '#b8d87c'], ['#527a2e', '#729c3e', '#97bf50', '#c0dc7a']],
    apple: [['#2f5a28', '#467a34', '#62964a', '#88ba66']],
    conifer: [['#17352a', '#234a35', '#33613f', '#4f8350'], ['#1b3a26', '#294f30', '#3b6a3c', '#5a8c50']],
  };
  function lobePath(ctx, L, ox, oy, k, add) {
    ctx.beginPath();
    for (const l of L) { const r = l[2] * k + (add || 0); if (r > 0) circ(ctx, l[0] + ox, l[1] + oy, r); }
  }
  function tree(ctx, x, y, r, kind, seed) {
    r = r > 0 ? r : 10;
    if (!TREEPAL[kind]) kind = 'deciduous';
    const s = toSeed(seed, x, y), R = rng(s), pals = TREEPAL[kind], pal = pals[(hash(s, 1) * pals.length) | 0];
    ctx.save();
    if (kind === 'conifer') conifer(ctx, x, y, r, R, pal);
    else broadleaf(ctx, x, y, r, R, pal, kind);
    ctx.restore();
  }
  function broadleaf(ctx, x, y, r, R, pal, kind) {
    const birch = kind === 'birch', apple = kind === 'apple';
    const n = clamp(Math.round(5 + r * 0.4), 6, 13), a0 = R() * TAU, L = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * TAU + (R() - 0.5) * 0.5, d = r * (birch ? 0.52 : 0.47) + r * R() * 0.16;
      const lr = r * (birch ? 0.28 + R() * 0.12 : apple ? 0.42 + R() * 0.1 : 0.38 + R() * 0.15);
      L.push([x + Math.cos(a) * d, y + Math.sin(a) * d, lr]);
    }
    L.push([x + (R() - 0.5) * r * 0.1, y + (R() - 0.5) * r * 0.1, r * (birch ? 0.48 : 0.58)]);
    if (birch) for (let i = 0; i < 4; i++) { const a = R() * TAU, d = r * 0.3; L.push([x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.3]); }
    const sd = r * 0.5;
    ctx.fillStyle = SHA + (birch ? '0.09)' : '0.11)'); lobePath(ctx, L, sd * 1.05, sd * 1.05, 1, 0.8); ctx.fill();
    ctx.fillStyle = SHA + (birch ? '0.11)' : '0.15)'); lobePath(ctx, L, sd * 0.8, sd * 0.8, 0.95); ctx.fill();
    ctx.fillStyle = pal[0]; lobePath(ctx, L, 0, 0, 1); ctx.fill();
    if (birch) {
      ctx.strokeStyle = 'rgba(238,234,222,.9)'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(0.3, r * 0.035);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = R() * TAU, l = r * (0.55 + R() * 0.3); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + 0.4) * l * 0.5, y + Math.sin(a + 0.4) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); }
      ctx.stroke();
    }
    const sh = -r * 0.07;
    ctx.fillStyle = pal[1]; lobePath(ctx, L, sh, sh, birch ? 0.78 : 0.84); ctx.fill();
    // объём каждой «шапки» листвы: светлое ядро, смещённое к свету (на теневой стороне — меньше)
    ctx.beginPath();
    for (const l of L) {
      const dx = l[0] - x, dy = l[1] - y, side = -(dx + dy) / (r * 1.2); // >0 — к свету
      const rr = l[2] * clamp(0.5 + side * 0.25, 0.3, 0.68);
      circ(ctx, l[0] - l[2] * 0.2 - r * 0.05, l[1] - l[2] * 0.2 - r * 0.05, rr);
    }
    ctx.fillStyle = pal[2]; ctx.fill();
    ctx.beginPath();
    for (const l of L) {
      const dx = l[0] - x, dy = l[1] - y;
      if (dx + dy > r * 0.45) continue;
      circ(ctx, l[0] - l[2] * 0.36 - r * 0.05, l[1] - l[2] * 0.36 - r * 0.05, l[2] * 0.26);
    }
    ctx.fillStyle = alpha(pal[3], 0.8); ctx.fill();
    // фактура листвы: мелкие светлые и тёмные пятнышки (не «горошек» — много, мелко и прозрачно)
    if (r >= 5) {
      const nl = Math.round(r * r * 0.45), dots = [[], []];
      for (let k = 0; k < nl; k++) {
        const l = L[(R() * L.length) | 0], a = R() * TAU, d = l[2] * Math.sqrt(R()) * 0.9, px = l[0] + Math.cos(a) * d, py = l[1] + Math.sin(a) * d;
        const lit_ = (px - l[0]) + (py - l[1]) < 0;
        dots[lit_ ? 0 : 1].push(px, py, Math.max(0.22, r * (0.025 + R() * 0.03)));
      }
      ctx.beginPath(); for (let i = 0; i < dots[0].length; i += 3) circ(ctx, dots[0][i], dots[0][i + 1], dots[0][i + 2]);
      ctx.fillStyle = alpha(pal[3], 0.32); ctx.fill();
      ctx.beginPath(); for (let i = 0; i < dots[1].length; i += 3) circ(ctx, dots[1][i], dots[1][i + 1], dots[1][i + 2]);
      ctx.fillStyle = 'rgba(10,30,8,.22)'; ctx.fill();
    }
    // просветы между шапками на теневой стороне
    ctx.beginPath();
    for (let k = 0; k < Math.round(n * 0.6); k++) {
      const l = L[(R() * L.length) | 0], a = PI * 0.25 + (R() - 0.5) * 1.6, d = l[2] * (0.6 + R() * 0.3), rr = r * (0.035 + R() * 0.035);
      circ(ctx, l[0] + Math.cos(a) * d, l[1] + Math.sin(a) * d, rr);
    }
    ctx.fillStyle = 'rgba(8,24,8,.38)'; ctx.fill();
    if (apple) {
      ctx.beginPath();
      const nf = 6 + ((R() * 7) | 0), red = R() < 0.7;
      const fr = [];
      for (let k = 0; k < nf; k++) { const a = R() * TAU, d = r * Math.sqrt(R()) * 0.78; fr.push([x + Math.cos(a) * d, y + Math.sin(a) * d]); }
      for (const f of fr) circ(ctx, f[0], f[1], Math.max(0.45, r * 0.055));
      ctx.fillStyle = red ? '#c8352b' : '#e2b234'; ctx.fill();
      ctx.beginPath(); for (const f of fr) circ(ctx, f[0] - 0.15, f[1] - 0.15, Math.max(0.15, r * 0.018));
      ctx.fillStyle = 'rgba(255,240,220,.8)'; ctx.fill();
    }
  }
  // тень конуса: касательные из точки тени вершины к кругу основания
  function coneShadow(ctx, cx, cy, r, L) {
    const d = L * Math.SQRT2, be = Math.acos(Math.min(0.99, r / d)), th = PI / 4;
    ctx.beginPath(); ctx.arc(cx, cy, r, th + be, th - be + TAU); ctx.lineTo(cx + L, cy + L); ctx.closePath();
  }
  function conifer(ctx, x, y, r, R, pal) {
    // ель/сосна сверху: ярусы звёздчатых «лап», каждый следующий меньше, светлее и смещён к свету;
    // теневая (ЮВ) половина каждого яруса притемнена, на лапах — светлые штрихи хвои.
    const jr = [];
    for (let i = 0; i < 160; i++) jr.push(R());
    const a0 = jr[0] * TAU;
    ctx.fillStyle = SHA + '0.08)'; coneShadow(ctx, x + 0.5, y + 0.5, r * 1.0, r * 1.6); ctx.fill();
    ctx.fillStyle = SHA + '0.17)'; coneShadow(ctx, x + r * 0.1, y + r * 0.1, r * 0.86, r * 1.32); ctx.fill();
    const tiers = r < 5 ? 2 : r < 9 ? 3 : 4;
    const cols = [pal[0], pal[1], shade(pal[1], 0.12), pal[2], pal[3]];
    for (let k = 0; k < tiers; k++) {
      const f = 1 - k / tiers * 0.78, rk = r * f, off = -r * 0.045 * k, cx = x + off, cy = y + off;
      const nb = Math.max(7, Math.round((k ? 10 : 13) + r * 0.35 - k * 1.5)), ak = a0 + k * 0.61;
      const tips = [];
      ctx.beginPath();
      for (let i = 0; i < nb; i++) {
        const j = jr[(k * 37 + i) % 160], a = ak + (i + (j - 0.5) * 0.35) / nb * TAU, am = ak + (i + 0.5 + (jr[(k * 41 + i * 3) % 160] - 0.5) * 0.3) / nb * TAU;
        const ro = rk * (0.84 + j * 0.16), ri = rk * (0.66 + jr[(k * 53 + i * 7) % 160] * 0.1);
        const tx = cx + Math.cos(a) * ro, ty = cy + Math.sin(a) * ro;
        tips.push([tx, ty, a, ro]);
        // лапа: два «пера» к вершине — чуть выгнутые бока
        const sx = cx + Math.cos(a - 0.5 / nb * TAU) * ri, sy = cy + Math.sin(a - 0.5 / nb * TAU) * ri;
        if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(cx + Math.cos(a - 0.12) * ro * 0.9, cy + Math.sin(a - 0.12) * ro * 0.9, tx, ty);
        ctx.quadraticCurveTo(cx + Math.cos(a + 0.12) * ro * 0.9, cy + Math.sin(a + 0.12) * ro * 0.9, cx + Math.cos(am) * ri, cy + Math.sin(am) * ri);
      }
      ctx.closePath();
      ctx.fillStyle = cols[Math.min(cols.length - 1, k)]; ctx.fill();
      // свет/тень яруса
      const g = ctx.createLinearGradient(cx - rk * SQ, cy - rk * SQ, cx + rk * SQ, cy + rk * SQ);
      g.addColorStop(0, 'rgba(255,250,210,' + (k ? 0.16 : 0.1) + ')'); g.addColorStop(0.45, 'rgba(255,250,210,0)');
      g.addColorStop(0.6, 'rgba(0,16,8,0)'); g.addColorStop(1, 'rgba(0,16,8,' + (k ? 0.32 : 0.4) + ')');
      ctx.fillStyle = g; ctx.fill();
      // тонкая тёмная кромка — разделяет ярусы
      if (k) { ctx.strokeStyle = 'rgba(6,22,12,.35)'; ctx.lineWidth = Math.max(0.15, r * 0.018); ctx.stroke(); }
      // хвоя: светлые штрихи вдоль лап на освещённой стороне
      if (r >= 4) {
        ctx.beginPath();
        for (const [tx, ty, a, ro] of tips) {
          const kk = -(Math.cos(a) + Math.sin(a)) * SQ;
          if (kk < -0.3) continue;
          ctx.moveTo(cx + Math.cos(a) * ro * 0.45, cy + Math.sin(a) * ro * 0.45); ctx.lineTo(tx - Math.cos(a) * ro * 0.08, ty - Math.sin(a) * ro * 0.08);
        }
        ctx.strokeStyle = alpha(pal[3], 0.55); ctx.lineWidth = Math.max(0.18, r * 0.028); ctx.lineCap = 'round'; ctx.stroke();
      }
    }
    // верхушка
    ctx.fillStyle = pal[2]; ctx.beginPath(); ctx.arc(x - r * 0.17, y - r * 0.17, Math.max(0.45, r * 0.12), 0, TAU); ctx.fill();
    ctx.fillStyle = shade(pal[3], 0.25); ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, Math.max(0.25, r * 0.05), 0, TAU); ctx.fill();
  }
  function bush(ctx, x, y, r, seed) {
    r = r > 0 ? r : 4;
    const s = toSeed(seed, x, y), R = rng(s);
    const pal = [['#2c5225', '#43702f', '#64954a', '#8bbd62'], ['#30562d', '#4b7838', '#6d9b4c', '#97c16c'], ['#3a5a24', '#557a2c', '#7a9e3e', '#a6c860']][(hash(s, 1) * 3) | 0];
    const n = 5 + ((R() * 3) | 0), L = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU + R() * 0.6, d = r * (0.38 + R() * 0.2); L.push([x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.42 + R() * 0.16)]); }
    L.push([x, y, r * 0.55]);
    ctx.save();
    ctx.fillStyle = SHA + '0.18)'; lobePath(ctx, L, r * 0.32, r * 0.32, 1, 0.3); ctx.fill();
    ctx.fillStyle = pal[0]; lobePath(ctx, L, 0, 0, 1); ctx.fill();
    ctx.fillStyle = pal[1]; lobePath(ctx, L, -r * 0.08, -r * 0.08, 0.8); ctx.fill();
    ctx.fillStyle = pal[2]; ctx.beginPath();
    for (const l of L) { if (l[0] - x + l[1] - y > r * 0.2) continue; circ(ctx, l[0] - r * 0.14, l[1] - r * 0.14, l[2] * 0.5); }
    ctx.fill();
    ctx.fillStyle = pal[3]; ctx.beginPath();
    for (let k = 0; k < n + 2; k++) { const a = PI * 1.25 + (R() - 0.5) * 2.2, d = r * R() * 0.7; circ(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.07 + R() * 0.06)); }
    ctx.fill();
    if (hash(s, 2) < 0.3) {
      const fc = ['#f4f0f2', '#f2a6c4', '#f6d24a', '#d9534f'][(hash(s, 3) * 4) | 0];
      ctx.fillStyle = fc; ctx.beginPath();
      for (let k = 0; k < 6 + r; k++) { const a = R() * TAU, d = r * Math.sqrt(R()) * 0.85; circ(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.3, r * 0.06)); }
      ctx.fill();
    }
    ctx.restore();
  }
  const FLOWERS = ['#e8433a', '#f4c430', '#f7f3ea', '#c063c9', '#f08cb6', '#ff8c2a', '#6f8ff0'];
  function flowerbed(ctx, x, y, w, h, seed) {
    const s = toSeed(seed, x, y), R = rng(s), round = hash(s, 1) < 0.35;
    const shape = (ins) => {
      ctx.beginPath();
      if (round) ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.1, w / 2 - ins), Math.max(0.1, h / 2 - ins), 0, 0, TAU);
      else rrect(ctx, x + ins, y + ins, w - 2 * ins, h - 2 * ins, Math.min(w, h) * 0.18);
    };
    ctx.save();
    ctx.translate(0.6, 0.6); shape(0); ctx.fillStyle = SHA + '.2)'; ctx.fill(); ctx.translate(-0.6, -0.6);
    shape(0); ctx.fillStyle = '#cdc8bc'; ctx.fill();
    shape(0.8); ctx.fillStyle = '#5b402c'; ctx.fill();
    ctx.save(); ctx.clip();
    grainOver(ctx, x, y, w, h, 0.8, s);
    const cols = [];
    const nc = 2 + ((R() * 2) | 0);
    for (let i = 0; i < nc; i++) cols.push(FLOWERS[(R() * FLOWERS.length) | 0]);
    const sp = 2.6, leaves = [], fl = cols.map(() => []);
    for (let yy = y + 1.8; yy < y + h - 1; yy += sp) for (let xx = x + 1.8; xx < x + w - 1; xx += sp) {
      const px = xx + (R() - 0.5) * 0.7, py = yy + (R() - 0.5) * 0.7;
      let ci;
      if (round) { const d = Math.hypot((px - x - w / 2) / (w / 2), (py - y - h / 2) / (h / 2)); ci = Math.min(nc - 1, Math.floor(d * nc)); }
      else ci = Math.floor((py - y) / h * nc) % nc;
      leaves.push(px, py);
      fl[ci].push(px, py);
    }
    ctx.fillStyle = '#3d6b2c'; ctx.beginPath(); for (let i = 0; i < leaves.length; i += 2) circ(ctx, leaves[i], leaves[i + 1], sp * 0.55); ctx.fill();
    ctx.fillStyle = '#5c8f3c'; ctx.beginPath(); for (let i = 0; i < leaves.length; i += 2) circ(ctx, leaves[i] - 0.3, leaves[i + 1] - 0.3, sp * 0.3); ctx.fill();
    fl.forEach((arr, ci) => {
      ctx.fillStyle = cols[ci]; ctx.beginPath();
      for (let i = 0; i < arr.length; i += 2) { circ(ctx, arr[i] + 0.5, arr[i + 1] - 0.3, 0.55); circ(ctx, arr[i] - 0.5, arr[i + 1] + 0.2, 0.5); circ(ctx, arr[i], arr[i + 1] + 0.6, 0.45); }
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,230,.6)'; ctx.beginPath();
    for (const arr of fl) for (let i = 0; i < arr.length; i += 2) circ(ctx, arr[i] + 0.35, arr[i + 1] - 0.45, 0.18);
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  /* ======================================================= MANHOLES, POLES */
  const NET = {
    water: { c: '#2f7fd1', l: 'В', lid: '#6b6a66' },
    sewer: { c: '#8a5a2b', l: 'К', lid: '#625d57' },
    gas: { c: '#e6b81e', l: 'Г', lid: '#6e6a5e' },
    tele: { c: '#e8801f', l: 'С', lid: '#676b6a' },
    heat: { c: '#9b3fb0', l: 'Т', lid: '#6c574c' },
    storm: { c: '#2a9c8c', l: 'Д', lid: '#5d5f60' },
    power: { c: '#d8352a', l: 'Э', lid: '#66625f' },
  };
  const NETALIAS = { electro: 'power', el: 'power', electric: 'power', cable: 'power', comm: 'tele', telecom: 'tele', drain: 'storm', rain: 'storm', heating: 'heat', sewage: 'sewer', gaz: 'gas' };
  const netKind = k => NET[k] ? k : NET[NETALIAS[k]] ? NETALIAS[k] : null;
  function manhole(ctx, x, y, kind, r, rot) {
    kind = netKind(kind) || 'sewer'; r = r > 0 ? r : 1.7;
    const N = NET[kind];
    ctx.save();
    if (kind === 'storm') {
      ctx.translate(x, y); ctx.rotate(rot || 0);
      const hw = r * 1.15, hh = r * 0.72;
      ctx.fillStyle = alpha(N.c, 0.45); ctx.fillRect(-hw - 0.5, -hh - 0.5, hw * 2 + 1, hh * 2 + 1);
      ctx.fillStyle = '#4a4744'; ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
      ctx.fillStyle = '#1d1c1b'; ctx.fillRect(-hw * 0.82, -hh * 0.75, hw * 1.64, hh * 1.5);
      ctx.beginPath();
      const nb = 6;
      for (let i = 0; i <= nb; i++) { const bx = -hw * 0.82 + i * hw * 1.64 / nb; ctx.moveTo(bx, -hh * 0.75); ctx.lineTo(bx, hh * 0.75); }
      ctx.moveTo(-hw * 0.82, 0); ctx.lineTo(hw * 0.82, 0);
      ctx.strokeStyle = '#6d6a65'; ctx.lineWidth = Math.max(0.18, r * 0.12); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 0.2; ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
      ctx.restore();
      return;
    }
    ctx.beginPath(); ctx.arc(x, y, r + 0.6, 0, TAU); ctx.fillStyle = alpha(N.c, 0.5); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = '#45423f'; ctx.fill();
    const lr = r * 0.84;
    ctx.beginPath(); ctx.arc(x, y, lr, 0, TAU); ctx.fillStyle = N.lid; ctx.fill();
    ctx.save(); ctx.clip();
    const lw = Math.max(0.12, r * 0.075);
    ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath();
    if (kind === 'water') {
      circ(ctx, x, y, lr * 0.68); circ(ctx, x, y, lr * 0.36);
      for (let i = 0; i < 8; i++) { const a = i * PI / 4; ctx.moveTo(x + Math.cos(a) * lr * 0.36, y + Math.sin(a) * lr * 0.36); ctx.lineTo(x + Math.cos(a) * lr * 0.68, y + Math.sin(a) * lr * 0.68); }
    } else if (kind === 'sewer') {
      const st = lr * 0.34;
      for (let t = -lr * 2; t <= lr * 2; t += st) { ctx.moveTo(x + t - lr, y - lr); ctx.lineTo(x + t + lr, y + lr); ctx.moveTo(x + t + lr, y - lr); ctx.lineTo(x + t - lr, y + lr); }
    } else if (kind === 'gas') {
      circ(ctx, x, y, lr * 0.3);
      for (let i = 0; i < 6; i++) { const a = i * PI / 3 + 0.3; ctx.moveTo(x + Math.cos(a) * lr * 0.3, y + Math.sin(a) * lr * 0.3); ctx.lineTo(x + Math.cos(a) * lr, y + Math.sin(a) * lr); }
    } else if (kind === 'tele') {
      for (let t = -lr; t <= lr; t += lr * 0.28) { ctx.moveTo(x - lr, y + t); ctx.lineTo(x + lr, y + t); }
    } else if (kind === 'heat') {
      circ(ctx, x, y, lr * 0.6); ctx.moveTo(x - lr, y); ctx.lineTo(x + lr, y); ctx.moveTo(x, y - lr); ctx.lineTo(x, y + lr);
    } else { // power
      for (let t = -lr; t <= lr; t += lr * 0.4) { ctx.moveTo(x - lr, y + t); ctx.lineTo(x + lr, y + t); ctx.moveTo(x + t, y - lr); ctx.lineTo(x + t, y + lr); }
    }
    ctx.stroke();
    if (kind === 'heat') { ctx.fillStyle = 'rgba(150,80,40,.25)'; ctx.beginPath(); ctx.arc(x + lr * 0.2, y + lr * 0.25, lr * 0.5, 0, TAU); ctx.fill(); }
    if (kind === 'tele') { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.ellipse(x, y, lr * 0.45, lr * 0.3, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
    ctx.lineWidth = Math.max(0.15, r * 0.1);
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.arc(x, y, lr, PI * 0.85, PI * 1.65); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(x, y, lr, -PI * 0.15, PI * 0.65); ctx.stroke();
    ctx.restore();
  }
  function hydrant(ctx, x, y, rot) {
    rot = rot || 0;
    ctx.save();
    ctx.lineCap = 'round'; ctx.strokeStyle = SHA + '.22)'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(x + 0.5, y + 0.5); ctx.lineTo(x + 2.6, y + 2.6); ctx.stroke();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = '#9e1f19';
    ctx.fillRect(-1.85, -0.42, 3.7, 0.84); ctx.fillRect(-0.42, 0.6, 0.84, 1.1);
    ctx.fillStyle = '#c9c4ba'; ctx.fillRect(-2.0, -0.38, 0.35, 0.76); ctx.fillRect(1.65, -0.38, 0.35, 0.76);
    ctx.rotate(-rot); ctx.translate(-x, -y);
    ctx.fillStyle = '#c92f25'; ctx.beginPath(); ctx.arc(x, y, 1.2, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8c1c16'; ctx.lineWidth = 0.22; ctx.beginPath(); ctx.arc(x, y, 0.95, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#e4574b'; ctx.beginPath(); ctx.arc(x - 0.08, y - 0.08, 0.68, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,230,.7)'; ctx.beginPath(); ctx.arc(x - 0.32, y - 0.32, 0.25, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5b1410'; ctx.beginPath(); ctx.arc(x, y, 0.2, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function pole(ctx, x, y, kind, rot) {
    if (kind !== 'lamp' && kind !== 'tele') kind = 'power';
    rot = rot || 0;
    const ca = Math.cos(rot), sa = Math.sin(rot), ux = -sa, uy = ca;
    ctx.save(); ctx.lineCap = 'round';
    if (kind === 'power') {
      const H = 13, tx = x + H, ty = y + H;
      ctx.strokeStyle = SHA + '.22)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.lineWidth = 0.55; ctx.beginPath(); ctx.moveTo(tx - ux * 3.6, ty - uy * 3.6); ctx.lineTo(tx + ux * 3.6, ty + uy * 3.6); ctx.stroke();
      ctx.strokeStyle = '#4f5254'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x - ux * 3.6, y - uy * 3.6); ctx.lineTo(x + ux * 3.6, y + uy * 3.6); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 0.2; ctx.stroke();
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.fillStyle = '#bdb9b0'; ctx.fillRect(-0.7, -0.7, 1.4, 1.4);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-0.7, -0.7, 1.4, 0.4);
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.2; ctx.strokeRect(-0.7, -0.7, 1.4, 1.4);
      ctx.restore();
      ctx.fillStyle = '#e9eef0';
      ctx.beginPath(); for (const k of [-3.2, 3.2]) circ(ctx, x + ux * k, y + uy * k, 0.45); circ(ctx, x + ca * 0.9, y + sa * 0.9, 0.42); ctx.fill();
      ctx.strokeStyle = 'rgba(60,80,90,.6)'; ctx.lineWidth = 0.15; ctx.stroke();
    } else if (kind === 'lamp') {
      const H = 10, tx = x + H, ty = y + H, al = 4.6;
      ctx.strokeStyle = SHA + '.2)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.lineTo(tx + ca * al, ty + sa * al); ctx.stroke();
      ctx.fillStyle = SHA + '.2)'; ctx.save(); ctx.translate(tx + ca * al, ty + sa * al); ctx.rotate(rot); ctx.beginPath(); rrect(ctx, -0.6, -0.7, 2.6, 1.4, 0.6); ctx.fill(); ctx.restore();
      ctx.strokeStyle = '#5f6468'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ca * al, y + sa * al); ctx.stroke();
      ctx.save(); ctx.translate(x + ca * al, y + sa * al); ctx.rotate(rot);
      ctx.fillStyle = '#7d8287'; ctx.beginPath(); rrect(ctx, -0.6, -0.7, 2.6, 1.4, 0.6); ctx.fill();
      ctx.fillStyle = '#f4efcf'; ctx.beginPath(); rrect(ctx, -0.2, -0.4, 1.9, 0.8, 0.4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(-0.4, -0.65, 2.2, 0.25);
      ctx.restore();
      ctx.fillStyle = '#4e5357'; ctx.beginPath(); ctx.arc(x, y, 0.62, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(x - 0.2, y - 0.2, 0.25, 0, TAU); ctx.fill();
    } else {
      const H = 10, tx = x + H, ty = y + H;
      ctx.strokeStyle = SHA + '.2)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(tx - ux * 1.3, ty - uy * 1.3); ctx.lineTo(tx + ux * 1.3, ty + uy * 1.3); ctx.stroke();
      ctx.strokeStyle = '#4a3a2a'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(x - ux * 1.3, y - uy * 1.3); ctx.lineTo(x + ux * 1.3, y + uy * 1.3); ctx.stroke();
      ctx.fillStyle = '#7a5a3c'; ctx.beginPath(); ctx.arc(x, y, 0.65, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#4f3a26'; ctx.lineWidth = 0.15; ctx.beginPath(); ctx.arc(x, y, 0.4, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#e8ecee'; ctx.beginPath(); circ(ctx, x - ux * 1.2, y - uy * 1.2, 0.3); circ(ctx, x + ux * 1.2, y + uy * 1.2, 0.3); ctx.fill();
    }
    ctx.restore();
  }
  function wires(ctx, x1, y1, x2, y2, kind) {
    const tele = kind === 'tele', H = tele ? 10 : 13, offs = tele ? [-1.2, 1.2] : [-3.2, 0, 3.2];
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = SHA + '.15)'; ctx.lineWidth = 0.35; ctx.beginPath();
    for (const o of offs) {
      const ax = x1 + nx * o + H, ay = y1 + ny * o + H, bx = x2 + nx * o + H, by = y2 + ny * o + H;
      ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2 - H * 0.6, (ay + by) / 2 - H * 0.6, bx, by);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(28,28,30,.75)'; ctx.lineWidth = 0.22; ctx.beginPath();
    for (const o of offs) {
      const ax = x1 + nx * o + (o === 0 && !tele ? Math.cos(Math.atan2(dy, dx)) * 0.9 : 0), ay = y1 + ny * o + (o === 0 && !tele ? Math.sin(Math.atan2(dy, dx)) * 0.9 : 0);
      ctx.moveTo(ax, ay); ctx.lineTo(x2 + nx * o, y2 + ny * o);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ========================================================== CARS, BENCH */
  const CARC = ['#d8dadd', '#2b2f35', '#9ba3ab', '#b3302c', '#2c5c9e', '#f2f2ee', '#5f7356', '#c8a24a', '#56606a', '#7a2e3c', '#3e7f8a', '#e0e0d8', '#1f3d6b'];
  const CARTYPES = {
    sedan: { L: 17.6, W: 7.2, r1: -0.42, c1: 0.2, ws: 0.3, rs: 0.18 },
    hatch: { L: 15.6, W: 7.0, r1: -0.66, c1: 0.16, ws: 0.3, rs: 0.14 },
    suv: { L: 18.6, W: 7.7, r1: -0.8, c1: 0.22, ws: 0.24, rs: 0.08 },
    van: { L: 19.8, W: 7.8, r1: -0.93, c1: 0.46, ws: 0.2, rs: 0.04 },
    pickup: { L: 20.6, W: 7.7, r1: -0.12, c1: 0.24, ws: 0.24, rs: 0.06 },
  };
  function car(ctx, x, y, rot, color, seed) {
    rot = rot || 0;
    const s = toSeed(seed, x, y);
    const tn = ['sedan', 'sedan', 'hatch', 'hatch', 'suv', 'van', 'pickup'][(hash(s, 1) * 7) | 0], T = CARTYPES[tn];
    const col = color || CARC[(hash(s, 2) * CARC.length) | 0];
    const hl = T.L / 2, hw = T.W / 2, ca = Math.cos(rot), sa = Math.sin(rot);
    ctx.save();
    const wc = rectPts(-hl, -hw, hl, hw).map(q => ({ x: x + q.x * ca - q.y * sa, y: y + q.x * sa + q.y * ca }));
    shadowPoly(ctx, wc, 1.5, 1.5, 1.1);
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = '#18191b';
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) ctx.fillRect(sx * hl * 0.62 - 1.6, sy > 0 ? hw - 0.6 : -hw - 0.15, 3.2, 0.75);
    ctx.beginPath(); rrect(ctx, -hl, -hw, T.L, T.W, hw * 0.62); ctx.fillStyle = col; ctx.fill();
    ctx.save(); ctx.clip();
    for (const [nx, ny] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
      const k = lit(nx, ny, ca, sa);
      ctx.beginPath();
      if (ny) ctx.rect(-hl, ny < 0 ? -hw : hw - 1.2, T.L, 1.2); else ctx.rect(nx < 0 ? -hl : hl - 1.0, -hw, 1.0, T.W);
      ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fill();
      shadeFill(ctx, k, 0.9);
    }
    ctx.restore();
    const r1 = hl * T.r1, c1 = hl * T.c1, ws = hl * T.ws, rs = hl * T.rs, gw = hw * 0.74, gw2 = hw * 0.86;
    if (tn === 'pickup') {
      ctx.fillStyle = shade(col, -0.35); ctx.fillRect(-hl + 0.9, -gw2 + 0.2, r1 + hl - 1.4, gw2 * 2 - 0.4);
      ctx.beginPath(); for (let t = -hl + 2.2; t < r1 - 0.8; t += 1.4) { ctx.moveTo(t, -gw2 + 0.4); ctx.lineTo(t, gw2 - 0.4); }
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.3; ctx.stroke();
    }
    // окна
    ctx.fillStyle = '#25303c';
    ctx.beginPath(); ctx.moveTo(c1, -gw); ctx.lineTo(c1 + ws, -gw2); ctx.quadraticCurveTo(c1 + ws + 0.8, 0, c1 + ws, gw2); ctx.lineTo(c1, gw); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r1, -gw); ctx.lineTo(r1 - rs, -gw2 * 0.95); ctx.quadraticCurveTo(r1 - rs - 0.5, 0, r1 - rs, gw2 * 0.95); ctx.lineTo(r1, gw); ctx.closePath(); ctx.fill();
    ctx.fillRect(r1, -gw2, c1 - r1, gw2 - gw + 0.05); ctx.fillRect(r1, gw - 0.05, c1 - r1, gw2 - gw + 0.05);
    ctx.fillStyle = 'rgba(200,225,255,.22)';
    ctx.beginPath(); ctx.moveTo(c1 + ws * 0.2, -gw); ctx.lineTo(c1 + ws * 0.6, -gw2 * 0.9); ctx.lineTo(c1 + ws * 0.85, -gw2 * 0.2); ctx.lineTo(c1 + ws * 0.4, -gw * 0.1); ctx.fill();
    // крыша
    ctx.fillStyle = col; ctx.beginPath(); rrect(ctx, r1, -gw, c1 - r1, gw * 2, 1.2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(r1 + 0.5, -gw + 0.4, c1 - r1 - 1, gw * 0.6);
    if (tn === 'suv') { ctx.strokeStyle = '#2b2d30'; ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(r1 + 0.6, -gw * 0.75); ctx.lineTo(c1 - 0.6, -gw * 0.75); ctx.moveTo(r1 + 0.6, gw * 0.75); ctx.lineTo(c1 - 0.6, gw * 0.75); ctx.stroke(); }
    if (tn === 'van') { ctx.beginPath(); for (let t = r1 + 2; t < c1 - 1; t += 2) { ctx.moveTo(t, -gw + 0.6); ctx.lineTo(t, gw - 0.6); } ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 0.4; ctx.stroke(); }
    if ((tn === 'sedan' || tn === 'hatch' || tn === 'suv') && hash(s, 3) < 0.3) {
      ctx.fillStyle = '#1d2a38'; ctx.beginPath(); rrect(ctx, c1 - 3.6, -gw * 0.42, 2.8, gw * 0.84, 0.5); ctx.fill();
      ctx.fillStyle = 'rgba(200,225,255,.25)'; ctx.fillRect(c1 - 3.4, -gw * 0.38, 1.0, gw * 0.4);
    }
    // капот
    ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 0.22;
    ctx.beginPath(); ctx.moveTo(c1 + ws + 0.8, -hw * 0.45); ctx.lineTo(hl - 1, -hw * 0.38); ctx.moveTo(c1 + ws + 0.8, hw * 0.45); ctx.lineTo(hl - 1, hw * 0.38); ctx.stroke();
    // зеркала, фары, фонари
    ctx.fillStyle = shade(col, -0.2);
    ctx.beginPath(); ctx.ellipse(c1 + ws * 0.4, -hw - 0.35, 0.6, 0.4, 0, 0, TAU); ctx.ellipse(c1 + ws * 0.4, hw + 0.35, 0.6, 0.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f6f2d8'; ctx.beginPath(); rrect(ctx, hl - 1.2, -hw * 0.82, 0.9, 1.7, 0.4); rrect(ctx, hl - 1.2, hw * 0.82 - 1.7, 0.9, 1.7, 0.4); ctx.fill();
    ctx.fillStyle = '#b51f1a'; ctx.fillRect(-hl + 0.15, -hw * 0.85, 0.6, 1.8); ctx.fillRect(-hl + 0.15, hw * 0.85 - 1.8, 0.6, 1.8);
    ctx.beginPath(); rrect(ctx, -hl, -hw, T.L, T.W, hw * 0.62); ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 0.28; ctx.stroke();
    ctx.restore();
  }
  function bench(ctx, x, y, rot) {
    rot = rot || 0;
    const L = 7.2, D = 2.6, ca = Math.cos(rot), sa = Math.sin(rot), hl = L / 2, hd = D / 2;
    ctx.save();
    const wc = rectPts(-hl, -hd, hl, hd).map(q => ({ x: x + q.x * ca - q.y * sa, y: y + q.x * sa + q.y * ca }));
    shadowPoly(ctx, wc, 0.9, 0.9);
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = '#34383b'; ctx.fillRect(-hl + 0.6, -hd, 0.6, D); ctx.fillRect(hl - 1.2, -hd, 0.6, D);
    for (let i = 0; i < 4; i++) {
      const sy = -hd + 0.15 + i * 0.62, back = i === 0;
      ctx.fillStyle = back ? '#9b6a3e' : '#b07a48'; ctx.fillRect(-hl, sy, L, back ? 0.38 : 0.48);
      ctx.fillStyle = 'rgba(255,230,190,.25)'; ctx.fillRect(-hl, sy, L, 0.14);
    }
    ctx.restore();
  }

  /* ============================================================ PLAYGROUND */
  function playground(ctx, x, y, w, h, seed) {
    const s = toSeed(seed, x, y), R = rng(s);
    const base = ['#b3644c', '#4f8a5d', '#5a7ea6', '#c08a3e'][(hash(s, 1) * 4) | 0];
    ctx.save();
    ctx.beginPath(); rrect(ctx, x, y, w, h, 2); ctx.fillStyle = '#d6cfbe'; ctx.fill();
    ctx.beginPath(); rrect(ctx, x + 0.9, y + 0.9, w - 1.8, h - 1.8, 1.5); ctx.fillStyle = base; ctx.fill();
    ctx.save(); ctx.clip(); grainOver(ctx, x, y, w, h, 1, s); grainOver(ctx, x, y, w, h, 0.6, s + 31); ctx.restore();
    const cols = w > h * 1.4 ? 3 : 2, rows = h > w * 1.4 ? 3 : 2, cw = w / cols, ch = h / rows, cells = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push([x + (i + 0.5) * cw, y + (j + 0.5) * ch]);
    const items = ['slide', 'swing', 'sandbox', 'carousel', 'rocker', 'climber'];
    for (let i = items.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [items[i], items[j]] = [items[j], items[i]]; }
    const sz = Math.min(cw, ch) * 0.82;
    cells.forEach((c, i) => playItem(ctx, items[i % items.length], c[0] + (R() - 0.5) * (cw - sz) * 0.5, c[1] + (R() - 0.5) * (ch - sz) * 0.5, sz, R));
    ctx.restore();
  }
  function playItem(ctx, kind, cx, cy, sz, R) {
    const pc = ['#e8463a', '#f2b632', '#3a8fd9', '#47b36b', '#9a5cd0'];
    const c1 = pc[(R() * pc.length) | 0], c2 = pc[(R() * pc.length) | 0];
    ctx.lineCap = 'round';
    if (kind === 'slide') {
      const t = sz * 0.32, tx = cx - sz * 0.22, ty = cy;
      ctx.fillStyle = SHA + '.25)'; ctx.fillRect(tx - t / 2 + 3, ty - t / 2 + 3, t, t);
      ctx.fillStyle = SHA + '.2)'; ctx.fillRect(tx + t / 2 + 1, ty - t * 0.2 + 1.2, sz * 0.5, t * 0.4);
      ctx.fillStyle = c2; ctx.beginPath(); rrect(ctx, tx + t / 2, ty - t * 0.2, sz * 0.5, t * 0.4, t * 0.2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(tx + t / 2, ty - t * 0.06, sz * 0.48, t * 0.12);
      const hx = t / 2;
      const tri = (ax, ay, bx, by, k) => { ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + ax, ty + ay); ctx.lineTo(tx + bx, ty + by); ctx.closePath(); ctx.fillStyle = c1; ctx.fill(); shadeFill(ctx, k); };
      tri(-hx, -hx, hx, -hx, SQ); tri(hx, -hx, hx, hx, -SQ); tri(hx, hx, -hx, hx, -SQ); tri(-hx, hx, -hx, -hx, SQ);
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 0.25; ctx.strokeRect(tx - hx, ty - hx, t, t);
      ctx.strokeStyle = '#8a8f94'; ctx.lineWidth = 0.35; ctx.beginPath();
      ctx.moveTo(tx - hx, ty - t * 0.25); ctx.lineTo(tx - hx - sz * 0.25, ty - t * 0.25); ctx.moveTo(tx - hx, ty + t * 0.25); ctx.lineTo(tx - hx - sz * 0.25, ty + t * 0.25);
      for (let k = 1; k < 4; k++) { ctx.moveTo(tx - hx - k * sz * 0.06, ty - t * 0.25); ctx.lineTo(tx - hx - k * sz * 0.06, ty + t * 0.25); }
      ctx.stroke();
    } else if (kind === 'swing') {
      const L = sz * 0.9, hb = L / 2, ly = sz * 0.22;
      ctx.strokeStyle = SHA + '.25)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(cx - hb + 4, cy + 4); ctx.lineTo(cx + hb + 4, cy + 4); ctx.stroke();
      ctx.strokeStyle = '#3d6fb0'; ctx.lineWidth = 0.6; ctx.beginPath();
      for (const sx of [-1, 1]) { ctx.moveTo(cx + sx * hb, cy - ly); ctx.lineTo(cx + sx * hb, cy); ctx.lineTo(cx + sx * hb, cy + ly); }
      ctx.stroke();
      ctx.strokeStyle = '#4d82c4'; ctx.lineWidth = 0.75; ctx.beginPath(); ctx.moveTo(cx - hb, cy); ctx.lineTo(cx + hb, cy); ctx.stroke();
      ctx.strokeStyle = 'rgba(80,80,80,.7)'; ctx.lineWidth = 0.15; ctx.beginPath();
      for (const sx of [-0.45, 0.45]) { ctx.moveTo(cx + sx * hb - 0.8, cy); ctx.lineTo(cx + sx * hb - 0.8, cy + 1.6); ctx.moveTo(cx + sx * hb + 0.8, cy); ctx.lineTo(cx + sx * hb + 0.8, cy + 1.6); }
      ctx.stroke();
      ctx.fillStyle = c1; for (const sx of [-0.45, 0.45]) { ctx.fillRect(cx + sx * hb - 1.1, cy + 1.2, 2.2, 0.9); }
    } else if (kind === 'sandbox') {
      const a = sz * 0.62;
      ctx.fillStyle = '#b98a55'; ctx.fillRect(cx - a / 2, cy - a / 2, a, a);
      ctx.fillStyle = patT('sand', 0, 0, 0, 0, ctx); ctx.fillRect(cx - a / 2 + 0.9, cy - a / 2 + 0.9, a - 1.8, a - 1.8);
      ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(cx - a / 2 + 0.9, cy - a / 2 + 0.9, a - 1.8, 0.7);
      ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(cx + a * 0.15, cy - a * 0.1, 0.6, 0, TAU); ctx.fill();
      ctx.fillStyle = c2; ctx.fillRect(cx - a * 0.25, cy + a * 0.1, 1.4, 0.8);
      ctx.strokeStyle = 'rgba(255,240,210,.4)'; ctx.lineWidth = 0.25; ctx.strokeRect(cx - a / 2, cy - a / 2, a, a);
    } else if (kind === 'carousel') {
      const r = sz * 0.3;
      ctx.fillStyle = SHA + '.2)'; ctx.beginPath(); ctx.arc(cx + 0.8, cy + 0.8, r, 0, TAU); ctx.fill();
      ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, i * PI / 2, i * PI / 2 + PI / 4); ctx.closePath(); ctx.fillStyle = c2; ctx.fill(); }
      ctx.strokeStyle = '#d9dcdf'; ctx.lineWidth = 0.4; ctx.beginPath();
      for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 8; ctx.moveTo(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3); ctx.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85); }
      ctx.stroke();
      ctx.fillStyle = '#f2b632'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.4, 0, TAU); ctx.fill();
    } else if (kind === 'rocker') {
      for (const ox of [-sz * 0.18, sz * 0.18]) {
        ctx.fillStyle = SHA + '.22)'; ctx.beginPath(); ctx.ellipse(cx + ox + 1, cy + 1, 1.8, 0.9, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = R() < 0.5 ? c1 : c2; ctx.beginPath(); ctx.ellipse(cx + ox, cy, 1.8, 0.9, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + ox + 1.5, cy, 0.7, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.ellipse(cx + ox - 0.3, cy - 0.3, 0.9, 0.35, 0, 0, TAU); ctx.fill();
      }
    } else { // climber
      const a = sz * 0.6, n = 4;
      ctx.strokeStyle = SHA + '.22)'; ctx.lineWidth = 0.4; ctx.beginPath();
      for (let i = 0; i <= n; i++) { const t = -a / 2 + i * a / n; ctx.moveTo(cx + t + 2.5, cy - a / 2 + 2.5); ctx.lineTo(cx + t + 2.5, cy + a / 2 + 2.5); ctx.moveTo(cx - a / 2 + 2.5, cy + t + 2.5); ctx.lineTo(cx + a / 2 + 2.5, cy + t + 2.5); }
      ctx.stroke();
      ctx.lineWidth = 0.45; ctx.strokeStyle = c1; ctx.beginPath();
      for (let i = 0; i <= n; i++) { const t = -a / 2 + i * a / n; ctx.moveTo(cx + t, cy - a / 2); ctx.lineTo(cx + t, cy + a / 2); }
      ctx.stroke();
      ctx.strokeStyle = c2; ctx.beginPath();
      for (let i = 0; i <= n; i++) { const t = -a / 2 + i * a / n; ctx.moveTo(cx - a / 2, cy + t); ctx.lineTo(cx + a / 2, cy + t); }
      ctx.stroke();
    }
  }
  function well(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = SHA + '.2)'; ctx.beginPath(); ctx.arc(x + 1.6, y + 1.6, 3.4, 0, TAU); ctx.fill();
    ctx.fillStyle = SHA + '.18)'; ctx.fillRect(x - 4.4 + 3, y - 1.1 + 3, 8.8, 1.4);
    ctx.fillStyle = '#b5b1a7'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill();
    ctx.save(); ctx.clip(); grainOver(ctx, x - 4, y - 4, 8, 8, 1, 3); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(x, y, 3.0, PI * 0.9, PI * 1.6); ctx.stroke();
    ctx.fillStyle = '#1b2a30'; ctx.beginPath(); ctx.arc(x, y, 2.3, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(120,170,190,.35)'; ctx.beginPath(); ctx.arc(x - 0.6, y - 0.4, 0.9, 0, TAU); ctx.fill();
    // крышка из досок (половина)
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, 2.5, PI * 0.5, PI * 1.5); ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#8a6542'; ctx.fillRect(x - 3, y - 3, 3, 6);
    ctx.strokeStyle = 'rgba(40,24,10,.5)'; ctx.lineWidth = 0.15; ctx.beginPath(); for (let t = -2.4; t < 0; t += 0.8) { ctx.moveTo(x + t, y - 3); ctx.lineTo(x + t, y + 3); } ctx.stroke();
    ctx.restore();
    // ворот
    ctx.fillStyle = '#5e4229'; ctx.fillRect(x - 4.4, y - 1.4, 1.2, 1.6); ctx.fillRect(x + 3.2, y - 1.4, 1.2, 1.6);
    ctx.fillStyle = '#7a5534'; ctx.beginPath(); rrect(ctx, x - 3.4, y - 1.1, 6.8, 1.0, 0.5); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,190,.3)'; ctx.fillRect(x - 3.2, y - 1.05, 6.4, 0.3);
    ctx.strokeStyle = '#3d3f42'; ctx.lineWidth = 0.3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + 4.4, y - 0.6); ctx.lineTo(x + 5.4, y - 0.6); ctx.lineTo(x + 5.4, y + 0.6); ctx.stroke();
    ctx.fillStyle = '#8a9096'; ctx.beginPath(); ctx.arc(x + 1.2, y + 0.9, 0.8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4a4f54'; ctx.beginPath(); ctx.arc(x + 1.2, y + 0.9, 0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* ================================================================= WATER */
  function pond(ctx, pts, seed) {
    const p = openRing(P(pts));
    if (p.length < 3) return;
    const s = toSeed(seed, p[0].x, p[0].y), R = rng(s), c = centroid(p);
    let rmax = 1;
    for (const q of p) rmax = Math.max(rmax, Math.hypot(q.x - c.x, q.y - c.y));
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.beginPath(); smoothPath(ctx, p, true);
    ctx.strokeStyle = 'rgba(96,104,60,.35)'; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = 'rgba(122,108,76,.8)'; ctx.lineWidth = 2.6; ctx.stroke();
    const g = ctx.createRadialGradient(c.x, c.y, rmax * 0.1, c.x, c.y, rmax);
    g.addColorStop(0, '#2e6683'); g.addColorStop(0.6, '#3f7c95'); g.addColorStop(1, '#6a9c94');
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    const b = bbox(p);
    ctx.globalAlpha = 0.35; ctx.fillStyle = patT('water', Math.round(hash(s, 1) * TS), 0, 0, 0, ctx); ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.globalAlpha = 1;
    ctx.beginPath(); smoothPath(ctx, p, true);
    ctx.strokeStyle = 'rgba(160,190,150,.35)'; ctx.lineWidth = 6; ctx.stroke();
    ctx.strokeStyle = 'rgba(40,52,30,.3)'; ctx.lineWidth = 1.6; ctx.stroke();
    // блики неба
    ctx.beginPath();
    for (let k = 0; k < 3 + rmax / 8; k++) {
      const a = R() * TAU, d = Math.sqrt(R()) * rmax * 0.6, px = c.x + Math.cos(a) * d, py = c.y + Math.sin(a) * d, L = 2 + R() * 5;
      ctx.moveTo(px - L, py); ctx.quadraticCurveTo(px, py - 1.2, px + L, py);
    }
    ctx.strokeStyle = 'rgba(230,245,255,.4)'; ctx.lineWidth = 0.45; ctx.stroke();
    ctx.restore();
    // кувшинки и тростник
    const ring = densify(p, true, 3), n = ring.length;
    const pads = [];
    for (let k = 0; k < 3 + rmax / 10; k++) {
      const q = ring[(R() * n) | 0], t = 0.15 + R() * 0.2;
      pads.push([lerp(q.x, c.x, t), lerp(q.y, c.y, t), 0.9 + R() * 0.9, R() * TAU]);
    }
    ctx.fillStyle = SHA + '.2)'; ctx.beginPath(); for (const pd of pads) circ(ctx, pd[0] + 0.3, pd[1] + 0.3, pd[2]); ctx.fill();
    ctx.fillStyle = '#4f8a3a'; ctx.beginPath();
    for (const pd of pads) { ctx.moveTo(pd[0], pd[1]); ctx.arc(pd[0], pd[1], pd[2], pd[3] + 0.4, pd[3] + TAU - 0.1); ctx.closePath(); }
    ctx.fill();
    ctx.fillStyle = 'rgba(180,220,120,.5)'; ctx.beginPath(); for (const pd of pads) circ(ctx, pd[0] - pd[2] * 0.3, pd[1] - pd[2] * 0.3, pd[2] * 0.35); ctx.fill();
    ctx.fillStyle = '#f4eef0'; ctx.beginPath(); for (const pd of pads) if (pd[3] < 2) circ(ctx, pd[0] + 0.3, pd[1] + 0.2, 0.45); ctx.fill();
    const stretches = 1 + ((R() * 3) | 0);
    ctx.lineCap = 'round';
    const reeds = [[], []];
    for (let k = 0; k < stretches; k++) {
      const i0 = (R() * n) | 0, len = (n * (0.08 + R() * 0.15)) | 0;
      for (let j = 0; j < len; j++) {
        const q = ring[(i0 + j) % n];
        for (let m = 0; m < 3; m++) {
          const t = (R() - 0.3) * 0.12, px = lerp(q.x, c.x, t) + (R() - 0.5) * 2, py = lerp(q.y, c.y, t) + (R() - 0.5) * 2, a = -PI / 2 + (R() - 0.5) * 1.6, l = 1.5 + R() * 2.5;
          reeds[R() < 0.5 ? 0 : 1].push(px, py, px + Math.cos(a) * l, py + Math.sin(a) * l);
        }
      }
    }
    ['#7a8f3e', '#a9a85a'].forEach((col, i) => {
      ctx.strokeStyle = col; ctx.lineWidth = 0.45; ctx.beginPath();
      const r = reeds[i];
      for (let j = 0; j < r.length; j += 4) { ctx.moveTo(r[j], r[j + 1]); ctx.lineTo(r[j + 2], r[j + 3]); }
      ctx.stroke();
    });
    ctx.fillStyle = '#5a3a22'; ctx.beginPath();
    for (let j = 0; j < reeds[0].length; j += 24) circ(ctx, reeds[0][j + 2], reeds[0][j + 3], 0.4);
    ctx.fill();
    ctx.restore();
  }
  function stream(ctx, pts, width, seed) {
    const p0 = P(pts);
    if (p0.length < 2) return;
    width = width > 0 ? width : 6;
    const s = toSeed(seed, p0[0].x, p0[0].y), R = rng(s), q = densify(p0, false, 3);
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const line = pp => { ctx.beginPath(); polyPath(ctx, pp, false); };
    line(q);
    ctx.strokeStyle = 'rgba(88,98,52,.35)'; ctx.lineWidth = width + 5; ctx.stroke();
    ctx.strokeStyle = '#7d6e4c'; ctx.lineWidth = width + 2; ctx.stroke();
    ctx.strokeStyle = '#4f88a2'; ctx.lineWidth = width; ctx.stroke();
    ctx.globalAlpha = 0.35; ctx.strokeStyle = patT('water', Math.round(hash(s, 1) * TS), 0, 0, 0, ctx); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(28,70,96,.35)'; ctx.lineWidth = width * 0.45; ctx.stroke();
    for (const sd of [-1, 1]) { line(offsetLine(q, sd * width * 0.42, false)); ctx.strokeStyle = 'rgba(150,180,150,.35)'; ctx.lineWidth = width * 0.16; ctx.stroke(); }
    // блики на воде — редкие короткие дуги по течению
    const c = cum(q), L = c[c.length - 1];
    ctx.beginPath();
    for (let k = 0; k < L / 9; k++) {
      const a = along(q, c, R() * L), lat = (R() - 0.5) * width * 0.6, l = 0.8 + R() * Math.min(3, width * 0.4);
      const cx = a.x - Math.sin(a.a) * lat, cy = a.y + Math.cos(a.a) * lat, ca = Math.cos(a.a), sa = Math.sin(a.a);
      ctx.moveTo(cx - ca * l, cy - sa * l); ctx.quadraticCurveTo(cx + sa * 0.5, cy - ca * 0.5, cx + ca * l, cy + sa * l);
    }
    ctx.strokeStyle = 'rgba(228,244,255,.45)'; ctx.lineWidth = Math.max(0.25, Math.min(0.5, width * 0.06)); ctx.stroke();
    // камни и тростник по берегам
    ctx.fillStyle = '#8f8c82'; ctx.beginPath();
    const stones = [];
    for (let k = 0; k < L / 25; k++) { const a = along(q, c, R() * L), lat = (R() - 0.5) * width * 1.1; stones.push([a.x - Math.sin(a.a) * lat, a.y + Math.cos(a.a) * lat, 0.4 + R() * 0.7]); }
    for (const st of stones) circ(ctx, st[0], st[1], st[2]);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); for (const st of stones) circ(ctx, st[0] - st[2] * 0.3, st[1] - st[2] * 0.3, st[2] * 0.4); ctx.fill();
    ctx.strokeStyle = '#7a8f3e'; ctx.lineWidth = 0.4; ctx.beginPath();
    for (let k = 0; k < L / 12; k++) {
      const a = along(q, c, R() * L), sd = R() < 0.5 ? -1 : 1, lat = sd * (width / 2 + 0.5 + R());
      const bx = a.x - Math.sin(a.a) * lat, by = a.y + Math.cos(a.a) * lat;
      for (let m = 0; m < 3; m++) { const an = -PI / 2 + (R() - 0.5) * 1.5, l = 1.2 + R() * 2; ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(an) * l, by + Math.sin(an) * l); }
    }
    ctx.stroke();
    ctx.restore();
  }
  function swamp(ctx, pts, seed) {
    const p = openRing(P(pts));
    if (p.length < 3) return;
    const s = toSeed(seed, p[0].x, p[0].y), R = rng(s), b = bbox(p);
    ctx.save();
    ctx.beginPath(); smoothPath(ctx, p, true);
    ctx.strokeStyle = 'rgba(110,124,66,.45)'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = patT('swamp', Math.round(hash(s, 1) * TS), Math.round(hash(s, 2) * TS), 0, 0, ctx); ctx.fill();
    ctx.save(); ctx.clip();
    ctx.globalAlpha = 0.5; ctx.fillStyle = patT('macro', Math.round(hash(s, 3) * 512), 0, 0, 8, ctx); ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.globalAlpha = 1;
    const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    for (let k = 0; k < 2 + area / 2500; k++) {
      const px = lerp(b.x0, b.x1, 0.15 + R() * 0.7), py = lerp(b.y0, b.y1, 0.15 + R() * 0.7), rx = 2 + R() * 6, ry = 1.5 + R() * 4, a = R() * PI;
      ctx.fillStyle = 'rgba(80,96,60,.6)'; ctx.beginPath(); ctx.ellipse(px, py, rx + 1, ry + 1, a, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3c5650'; ctx.beginPath(); ctx.ellipse(px, py, rx, ry, a, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(200,225,235,.25)'; ctx.beginPath(); ctx.ellipse(px - rx * 0.2, py - ry * 0.3, rx * 0.5, ry * 0.3, a, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = '#8c9a4c'; ctx.lineWidth = 0.4; ctx.lineCap = 'round'; ctx.beginPath();
    for (let k = 0; k < area / 400; k++) {
      const px = lerp(b.x0, b.x1, R()), py = lerp(b.y0, b.y1, R());
      for (let m = 0; m < 4; m++) { const an = -PI / 2 + (R() - 0.5) * 1.6, l = 1.2 + R() * 2.2; ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(an) * l, py + Math.sin(an) * l); }
    }
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  /* ========================================================= RELIEF, SLOPE */
  // точки ломаной q (c — накопленные длины), взятые через равные доли длины: n + 1 точка
  function resample(q, c, n) {
    const L = c[c.length - 1], o = [];
    for (let i = 0; i <= n; i++) { const a = along(q, c, L * i / n); o.push({ x: a.x, y: a.y }); }
    return o;
  }
  function slope(ctx, topPts, bottomPts) {
    const T = P(topPts), B = P(bottomPts);
    if (T.length < 2 || B.length < 2) return;
    const tq = densify(T, false, 2), bq = densify(B, false, 2), ct = cum(tq), cb = cum(bq), Lt = ct[ct.length - 1], Lb = cb[cb.length - 1];
    if (!(Lt > 0.5 && Lb > 0.5)) return;
    const M = clamp(Math.round(Math.max(Lt, Lb) / 2.5), 4, 600), tr = resample(tq, ct, M), br = resample(bq, cb, M);
    let dx = 0, dy = 0, wsum = 0;
    for (let i = 0; i <= M; i++) { const vx = br[i].x - tr[i].x, vy = br[i].y - tr[i].y; dx += vx; dy += vy; wsum += Math.hypot(vx, vy); }
    const dl = Math.hypot(dx, dy) || 1, wAvg = wsum / (M + 1); dx /= dl; dy /= dl;
    const k = -(dx + dy) * SQ; // >0 — склон обращён к свету (СЗ)
    const s = toSeed(null, T[0].x + B[B.length - 1].x, T[0].y + B[B.length - 1].y), R = rng(s);
    const at = (u, t) => { // точка склона: u — доля вдоль бровки 0..1, t — от бровки (0) к подошве (1)
      const f = u * M, i = Math.min(M - 1, Math.floor(f)), w = f - i, a = tr[i], a2 = tr[i + 1], b = br[i], b2 = br[i + 1];
      const ax = a.x + (a2.x - a.x) * w, ay = a.y + (a2.y - a.y) * w, bx = b.x + (b2.x - b.x) * w, by = b.y + (b2.y - b.y) * w;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, vx: bx - ax, vy: by - ay };
    };
    // область от бровки до линии t1 (с волнистой границей ph — чтобы ступени тона не читались «террасами»)
    const region = (t1, ph) => {
      ctx.beginPath(); polyPath(ctx, tr, false);
      for (let i = M; i >= 0; i--) {
        const t = t1 >= 1 ? 1 : clamp(t1 + (ph == null ? 0 : Math.sin(i * 0.21 + ph) * 0.06 + Math.sin(i * 0.067 + ph * 1.7) * 0.05), 0.02, 1);
        ctx.lineTo(tr[i].x + (br[i].x - tr[i].x) * t, tr[i].y + (br[i].y - tr[i].y) * t);
      }
      ctx.closePath();
    };
    ctx.save();
    region(1);
    ctx.save(); ctx.clip();
    // тон склона: чёткая бровка и мягкое затухание к подошве (вложенные полосы от бровки)
    const NS = 6, A = k >= 0 ? 0.055 + k * 0.045 : 0.06 - k * 0.07, col = k >= 0 ? 'rgba(255,246,200,' : 'rgba(12,28,14,';
    ctx.fillStyle = col + A.toFixed(3) + ')';
    for (let j = 1; j <= NS; j++) { region(j / (NS + 0.6), j * 2.3 + hash(s, 4) * 6); ctx.fill(); } // у подошвы тон сходит на нет
    // крупная пятнистость травы
    const bb = bbox(tr.concat(br));
    ctx.globalAlpha = 0.28; ctx.fillStyle = patT('macro', Math.round(hash(s, 1) * 512), 0, 0, 4, ctx); ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0); ctx.globalAlpha = 1;
    // трава «причёсана» вниз по склону: штрихи вдоль линии падения (готовая плитка, повёрнутая по склону)
    ctx.globalAlpha = 0.85 + Math.max(0, -k) * 0.15;
    ctx.fillStyle = patT('downslope', Math.round(hash(s, 2) * 64), Math.round(hash(s, 3) * 64), Math.atan2(dy, dx) - PI / 2);
    region(0.9, hash(s, 5) * 9); ctx.fill(); ctx.globalAlpha = 1;
    // редкие промоины: узкие сужающиеся борозды оголённого грунта от бровки
    const m = Math.round(Lt / 60 + R() * 1.2), soil = new Path2D(), sdark = new Path2D();
    for (let i = 0; i < m; i++) {
      const u = 0.05 + R() * 0.9, f = 0.25 + R() * 0.4, w0 = 0.9 + R() * 1.2, K = 6, wig = (R() - 0.5) * 1.6, ph = R() * TAU;
      const left = [], right = [];
      for (let j = 0; j <= K; j++) {
        const t = 0.02 + j / K * f, p = at(u, t), vl = Math.hypot(p.vx, p.vy) || 1, nx = -p.vy / vl, ny = p.vx / vl, hw = w0 * Math.sin(PI * (0.08 + 0.84 * j / K)) * (1 - j / K * 0.4), wg = Math.sin(j / K * 3 + ph) * wig;
        left.push([p.x + nx * (hw + wg), p.y + ny * (hw + wg)]); right.push([p.x - nx * (hw - wg), p.y - ny * (hw - wg)]);
      }
      soil.moveTo(left[0][0], left[0][1]); for (const q of left) soil.lineTo(q[0], q[1]); for (let j = K; j >= 0; j--) soil.lineTo(right[j][0], right[j][1]); soil.closePath();
      const p0 = at(u, 0), shadowLeft = (-p0.vy + p0.vx) > 0, L1 = shadowLeft ? left : right; // теневой борт — с юго-востока
      sdark.moveTo(L1[0][0], L1[0][1]); for (const q of L1) sdark.lineTo(q[0], q[1]);
    }
    // + пятна оголённого грунта у бровки — тем же цветом, одной заливкой
    for (let i = 0; i < Lt / 30; i++) { const p = at(R(), 0.04 + R() * 0.06), rr = 1 + R() * 3, an = Math.atan2(p.vy, p.vx) + PI / 2; soil.moveTo(p.x + Math.cos(an) * rr, p.y + Math.sin(an) * rr); soil.ellipse(p.x, p.y, rr, 0.5 + R() * 0.9, an, 0, TAU); }
    ctx.fillStyle = 'rgba(136,102,66,.2)'; ctx.fill(soil);
    ctx.strokeStyle = 'rgba(50,36,20,.12)'; ctx.lineWidth = 0.3; ctx.stroke(sdark);
    // кочки и кустики травы: тень на ЮВ + светлая макушка
    const tuftD = new Path2D(), tuftL = new Path2D();
    for (let i = 0; i < Lt * wAvg / 60; i++) {
      const p = at(R(), 0.06 + R() * 0.9), tr_ = 0.35 + R() * 0.7, e = 0.55 + R() * 0.4, an = R() * PI;
      tuftD.moveTo(p.x + 0.3 + Math.cos(an) * tr_, p.y + 0.3 + Math.sin(an) * tr_); tuftD.ellipse(p.x + 0.3, p.y + 0.3, tr_, tr_ * e, an, 0, TAU);
      tuftL.moveTo(p.x - 0.15 + Math.cos(an) * tr_ * 0.6, p.y - 0.15 + Math.sin(an) * tr_ * 0.6); tuftL.ellipse(p.x - 0.15, p.y - 0.15, tr_ * 0.6, tr_ * 0.6 * e, an, 0, TAU);
    }
    ctx.fillStyle = 'rgba(30,52,20,.2)'; ctx.fill(tuftD);
    ctx.fillStyle = 'rgba(190,206,120,.16)'; ctx.fill(tuftL);
    // влажная подошва — мягко
    ctx.beginPath(); polyPath(ctx, br, false); ctx.strokeStyle = 'rgba(30,50,26,.12)'; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
    // бровка: светлая кромка и тень под ней
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); polyPath(ctx, tr, false);
    ctx.strokeStyle = 'rgba(250,244,206,' + (0.16 + Math.max(0, k) * 0.2).toFixed(3) + ')'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.beginPath(); polyPath(ctx, tr.map(q => ({ x: q.x + dx * 0.7, y: q.y + dy * 0.7 })), false);
    ctx.strokeStyle = 'rgba(30,42,20,' + (0.2 + Math.max(0, -k) * 0.12).toFixed(3) + ')'; ctx.lineWidth = 0.45; ctx.stroke();
    ctx.restore();
  }
  const _hsCache = new WeakMap();
  function hillshade(ctx, x, y, w, h, heightFn, opt) {
    if (typeof heightFn !== 'function') return;
    opt = opt || {};
    const cell = opt.cell > 0 ? opt.cell : 4, z = opt.z > 0 ? opt.z : 1, a = opt.alpha != null ? opt.alpha : 0.6;
    const key = x + ',' + y + ',' + w + ',' + h + ',' + cell + ',' + z + ',' + (opt.key || '');
    let e = _hsCache.get(heightFn);
    if (!e || e.key !== key) {
      const nx = Math.max(2, Math.ceil(w / cell) + 1), ny = Math.max(2, Math.ceil(h / cell) + 1), H = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = +heightFn(x + i * cell, y + j * cell) || 0;
      const c = mkCanvas(nx, ny), g = c.getContext('2d'), im = g.createImageData(nx, ny), d = im.data, mpu = 0.25 * cell * 2;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(ny - 1, j + 1);
        const gx = (H[j * nx + i1] - H[j * nx + i0]) / (mpu * (i1 - i0) / 2) * z, gy = (H[j1 * nx + i] - H[j0 * nx + i]) / (mpu * (j1 - j0) / 2) * z;
        const L = Math.sqrt(gx * gx + gy * gy + 1), sh = (gx * 0.5 + gy * 0.5 + 0.7071) / L - 0.7071;
        const o = (j * nx + i) * 4;
        if (sh >= 0) { d[o] = 255; d[o + 1] = 248; d[o + 2] = 214; d[o + 3] = Math.min(150, sh * 255 * 1.5); }
        else { d[o] = 14; d[o + 1] = 30; d[o + 2] = 30; d[o + 3] = Math.min(255, -sh * 255 * 1.6); }
      }
      g.putImageData(im, 0, 0);
      e = { key, c, nx, ny };
      _hsCache.set(heightFn, e);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.globalAlpha = a; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(e.c, x - cell / 2, y - cell / 2, e.nx * cell, e.ny * cell);
    ctx.restore();
  }
  function marker(ctx, x, y, kind) {
    ctx.save(); ctx.lineCap = 'round';
    if (kind === 'benchmark') {
      ctx.fillStyle = SHA + '.25)'; ctx.fillRect(x - 1.1 + 0.9, y - 1.1 + 0.9, 2.2, 2.2);
      ctx.fillStyle = '#c3bfb5'; ctx.fillRect(x - 1.1, y - 1.1, 2.2, 2.2);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x - 1.1, y - 1.1, 2.2, 0.5);
      ctx.fillStyle = '#7c8086'; ctx.beginPath(); ctx.arc(x, y, 0.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#b9bdc2'; ctx.beginPath(); ctx.arc(x - 0.15, y - 0.15, 0.25, 0, TAU); ctx.fill();
      const px = x + 2.8, py = y - 2.2;
      ctx.strokeStyle = SHA + '.25)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 3.5, py + 3.5); ctx.stroke();
      ctx.fillStyle = '#e4572e'; ctx.beginPath(); ctx.arc(px, py, 0.65, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#f4f1ea'; ctx.lineWidth = 0.25; ctx.beginPath(); ctx.arc(px, py, 0.4, 0, TAU); ctx.stroke();
    } else if (kind === 'boundary') {
      ctx.fillStyle = 'rgba(98,72,46,.35)'; ctx.beginPath(); ctx.arc(x, y, 1.7, 0, TAU); ctx.fill();
      ctx.strokeStyle = SHA + '.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 2, y + 2); ctx.stroke();
      ctx.fillStyle = '#d63b2c'; ctx.beginPath(); ctx.arc(x, y, 0.75, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fbf6ee'; ctx.beginPath(); ctx.arc(x - 0.1, y - 0.1, 0.3, 0, TAU); ctx.fill();
    } else { // ggs
      ctx.strokeStyle = 'rgba(92,70,44,.45)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(190,180,120,.35)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(x - 0.3, y - 0.3, 5.1, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(160,150,96,.25)'; ctx.beginPath(); ctx.arc(x, y, 4.4, 0, TAU); ctx.fill();
      const legs = [[-3.4, -3.4], [3.4, -3.4], [3.4, 3.4], [-3.4, 3.4]];
      ctx.strokeStyle = SHA + '.22)'; ctx.lineWidth = 0.5; ctx.beginPath();
      for (const l of legs) { ctx.moveTo(x + l[0], y + l[1]); ctx.lineTo(x + 5, y + 5); }
      ctx.stroke();
      ctx.lineWidth = 0.55; ctx.beginPath();
      for (const l of legs) { ctx.moveTo(x + l[0], y + l[1]); ctx.lineTo(x, y); }
      ctx.strokeStyle = '#e9e4d6'; ctx.stroke();
      ctx.setLineDash([0.9, 0.9]); ctx.strokeStyle = '#d6402f'; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#c9c6bd'; ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
      ctx.fillStyle = '#d6402f'; ctx.beginPath(); ctx.arc(x, y, 0.45, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* ========================================================= PEOPLE, TOOLS */
  function localNW(dir, d) { const c = Math.cos(dir), s = Math.sin(dir); return [-d * (c + s), -d * (c - s)]; }
  function personBody(ctx, ph, jacket, torso, torsoStripes, holdRight) {
    ctx.fillStyle = '#2c2b2a';
    ctx.beginPath(); ctx.ellipse(ph * 0.9 + 0.2, -0.65, 0.75, 0.42, 0, 0, TAU); ctx.ellipse(-ph * 0.9 + 0.2, 0.65, 0.75, 0.42, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = jacket;
    const ar = holdRight ? 0.9 : ph * 0.7;
    ctx.beginPath(); ctx.ellipse(-ph * 0.7, -1.55, 0.95, 0.52, 0, 0, TAU); ctx.ellipse(ar, 1.55, 0.95, 0.52, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e1b38e';
    ctx.beginPath(); circ(ctx, -ph * 0.7 + 0.9, -1.6, 0.36); circ(ctx, ar + 0.9, 1.6, 0.36); ctx.fill();
    ctx.fillStyle = torso; ctx.beginPath(); rrect(ctx, -0.85, -1.6, 1.7, 3.2, 0.8); ctx.fill();
    if (torsoStripes) {
      ctx.strokeStyle = '#e9eef2'; ctx.lineWidth = 0.28; ctx.beginPath();
      ctx.moveTo(-0.8, -0.95); ctx.lineTo(0.8, -0.95); ctx.moveTo(-0.8, 0.95); ctx.lineTo(0.8, 0.95); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(-0.85, -1.2, 0.35, 2.4);
  }
  function surveyorTop(ctx, x, y, dir, t, opt) {
    opt = opt || {}; dir = dir || 0;
    const sc = opt.scale || 1, vest = opt.vest || '#ff7a1c', helmet = opt.helmet || '#f5f3ec', ph = Math.sin((t || 0) * 9);
    const ca = Math.cos(dir), sa = Math.sin(dir);
    ctx.save();
    ctx.fillStyle = SHA + '.2)'; ctx.beginPath(); ctx.ellipse(x + 1.7 * sc, y + 1.7 * sc, 2.6 * sc, 1.5 * sc, PI / 4, 0, TAU); ctx.fill();
    const hx = 0.9, hy = 1.95; // локальная точка вешки
    const pwx = x + (hx * ca - hy * sa) * sc, pwy = y + (hx * sa + hy * ca) * sc;
    if (opt.pole) { ctx.strokeStyle = SHA + '.2)'; ctx.lineWidth = 0.5 * sc; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(pwx, pwy); ctx.lineTo(pwx + 9 * sc, pwy + 9 * sc); ctx.stroke(); ctx.fillStyle = SHA + '.2)'; ctx.beginPath(); ctx.arc(pwx + 9 * sc, pwy + 9 * sc, 0.8 * sc, 0, TAU); ctx.fill(); }
    ctx.translate(x, y); ctx.rotate(dir); ctx.scale(sc, sc);
    personBody(ctx, ph, '#34465a', vest, true, !!opt.pole);
    const [lx, ly] = localNW(dir, 0.35);
    ctx.fillStyle = shade(helmet, -0.12); ctx.beginPath(); ctx.ellipse(0.35, 0, 1.05, 0.95, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = helmet; ctx.beginPath(); ctx.arc(0.1, 0, 0.85, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 0.2; ctx.beginPath(); ctx.moveTo(-0.7, 0); ctx.lineTo(0.9, 0); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(0.1 + lx, ly, 0.3, 0, TAU); ctx.fill();
    if (opt.pole) {
      ctx.fillStyle = '#3a3d40'; ctx.beginPath(); ctx.arc(hx, hy, 0.85, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.arc(hx, hy, 0.68, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8fa3b0'; ctx.beginPath(); ctx.arc(hx, hy, 0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(hx + lx * 0.5, hy + ly * 0.5, 0.15, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function personTop(ctx, x, y, dir, t, seed) {
    dir = dir || 0;
    const s = toSeed(seed == null ? 7 : seed), ph = Math.sin((t || 0) * 9);
    const shirts = ['#d94b3d', '#3f7bd1', '#4a9a5c', '#e2b23a', '#8a5bb8', '#e8e4da', '#2f3640', '#e07a2f', '#6aa3c8'];
    const hairs = ['#2a1d14', '#5a3b22', '#a4733e', '#d8b46a', '#8c8c88', '#1a1a1a'];
    const shirt = shirts[(hash(s, 1) * shirts.length) | 0], hair = hairs[(hash(s, 2) * hairs.length) | 0], hat = hash(s, 3) < 0.25, bag = hash(s, 4) < 0.3;
    ctx.save();
    ctx.fillStyle = SHA + '.2)'; ctx.beginPath(); ctx.ellipse(x + 1.6, y + 1.6, 2.5, 1.4, PI / 4, 0, TAU); ctx.fill();
    ctx.translate(x, y); ctx.rotate(dir);
    personBody(ctx, ph, shade(shirt, -0.12), shirt, false, false);
    if (bag) { ctx.fillStyle = '#4a4440'; ctx.beginPath(); rrect(ctx, -1.35, -1.0, 0.8, 2.0, 0.3); ctx.fill(); }
    const [lx, ly] = localNW(dir, 0.3);
    if (hat) {
      ctx.fillStyle = shade(shirt, -0.3); ctx.beginPath(); ctx.ellipse(0.45, 0, 0.75, 0.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = shade(shirt, -0.15); ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(0, 0, 0.82, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e1b38e'; ctx.beginPath(); ctx.ellipse(0.62, 0, 0.25, 0.45, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(lx, ly, 0.28, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function tripodTop(ctx, x, y, t, opt) {
    opt = opt || {};
    const sc = opt.scale || 1, aim = opt.aim || 0, la = opt.legs != null ? opt.legs : -PI / 2, H = 3.4 * sc;
    const feet = [];
    for (let k = 0; k < 3; k++) { const a = la + k * TAU / 3; feet.push([x + Math.cos(a) * 5.6 * sc, y + Math.sin(a) * 5.6 * sc]); }
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = SHA + '.2)'; ctx.lineWidth = 0.5 * sc; ctx.beginPath();
    for (const f of feet) { ctx.moveTo(f[0], f[1]); ctx.lineTo(x + H, y + H); }
    ctx.stroke();
    ctx.fillStyle = SHA + '.22)'; ctx.beginPath(); ctx.arc(x + H * 1.15, y + H * 1.15, 1.7 * sc, 0, TAU); ctx.fill();
    ctx.lineWidth = 0.6 * sc;
    ctx.strokeStyle = '#5b6066'; ctx.beginPath();
    for (const f of feet) { ctx.moveTo(f[0], f[1]); ctx.lineTo(lerp(f[0], x, 0.45), lerp(f[1], y, 0.45)); }
    ctx.stroke();
    ctx.strokeStyle = '#d9a33a'; ctx.beginPath();
    for (const f of feet) { ctx.moveTo(lerp(f[0], x, 0.45), lerp(f[1], y, 0.45)); ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.fillStyle = '#2b2d30'; ctx.beginPath(); for (const f of feet) circ(ctx, f[0], f[1], 0.35 * sc); ctx.fill();
    ctx.fillStyle = '#44484d'; ctx.beginPath();
    for (let k = 0; k < 3; k++) { const a = la + k * TAU / 3; const px = x + Math.cos(a) * 1.6 * sc, py = y + Math.sin(a) * 1.6 * sc; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fill();
    ctx.translate(x, y); ctx.rotate(aim); ctx.scale(sc, sc);
    ctx.fillStyle = '#e8b915'; ctx.beginPath(); rrect(ctx, -1.15, -1.35, 2.3, 2.7, 0.55); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(-1.15, 0.5, 2.3, 0.85);
    ctx.fillStyle = '#3a3f45'; ctx.beginPath(); rrect(ctx, -0.9, -0.45, 3.3, 0.9, 0.3); ctx.fill();
    ctx.fillStyle = '#7fb7d9'; ctx.beginPath(); ctx.arc(2.35, 0, 0.36, 0, TAU); ctx.fill();
    ctx.fillStyle = '#20262c'; ctx.fillRect(-1.55, -0.8, 0.5, 1.6);
    ctx.fillStyle = '#6fd0c0'; ctx.fillRect(-1.5, -0.55, 0.38, 0.7);
    ctx.strokeStyle = '#2a2c2f'; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(-0.6, -1.0); ctx.quadraticCurveTo(0.2, -1.6, 0.9, -1.0); ctx.stroke();
    const on = Math.sin((t || 0) * 6) > 0;
    ctx.fillStyle = on ? '#ff3b30' : 'rgba(120,20,20,.6)'; ctx.beginPath(); ctx.arc(-0.2, 1.0, 0.22, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-1.0, -1.25, 2.0, 0.35);
    ctx.restore();
  }
  function dogTop(ctx, x, y, dir, t, color) {
    dir = dir || 0;
    const c = color || '#b5783e', ph = Math.sin((t || 0) * 14), wag = Math.sin((t || 0) * 18);
    ctx.save();
    ctx.fillStyle = SHA + '.2)'; ctx.beginPath(); ctx.ellipse(x + 1.1, y + 1.1, 3, 1.4, dir, 0, TAU); ctx.fill();
    ctx.translate(x, y); ctx.rotate(dir);
    ctx.fillStyle = shade(c, -0.2);
    ctx.beginPath();
    ctx.ellipse(1.3 + ph * 0.4, -0.85, 0.45, 0.3, 0, 0, TAU); ctx.ellipse(1.3 - ph * 0.4, 0.85, 0.45, 0.3, 0, 0, TAU);
    ctx.ellipse(-1.3 - ph * 0.4, -0.85, 0.45, 0.3, 0, 0, TAU); ctx.ellipse(-1.3 + ph * 0.4, 0.85, 0.45, 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = c; ctx.lineWidth = 0.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-2.1, 0); ctx.quadraticCurveTo(-3.0, wag * 0.4, -3.5, wag * 1.0); ctx.stroke();
    ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 0, 2.3, 1.05, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(c, -0.3); ctx.beginPath(); ctx.ellipse(-0.4, 0, 1.4, 0.65, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(1.75, -0.6); ctx.lineTo(1.75, 0.6); ctx.stroke();
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(2.45, 0, 0.82, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(c, 0.15); ctx.beginPath(); ctx.ellipse(3.2, 0, 0.55, 0.38, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1e1a18'; ctx.beginPath(); ctx.arc(3.68, 0, 0.18, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(c, -0.4); ctx.beginPath();
    ctx.ellipse(2.15, -0.78 - ph * 0.08, 0.5, 0.3, -0.4, 0, TAU); ctx.ellipse(2.15, 0.78 + ph * 0.08, 0.5, 0.3, 0.4, 0, TAU); ctx.fill();
    const [lx, ly] = localNW(dir, 0.35);
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.ellipse(lx * 1.5, ly * 1.2, 1.2, 0.45, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* ============================================================ TOPOPLAN */
  const INK = '#1f1d1a', BROWN = '#a0582a', BROWN_D = '#86441c', BLUE = '#2b6cb0', GREEN = '#2e8540', PAPER = '#f5f0e2';
  const PFONT = 'Arial, "Helvetica Neue", "Liberation Sans", sans-serif';
  const UTIL = { gas: '#d9a400', water: '#2b6cb0', sewer: '#8a5a2b', tele: '#e07b1a', power: '#d0302a', heat: '#9b3fb0', storm: '#2a9c8c' };
  function label(ctx, x, y, str, size, color, rot, weight, align) {
    ctx.save();
    ctx.translate(x, y); if (rot) ctx.rotate(rot);
    ctx.font = 'italic ' + (weight || 600) + ' ' + (size || 4) + 'px ' + PFONT;
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = color || INK; ctx.fillText(String(str), 0, 0);
    ctx.restore();
  }
  const _tw = new Map();
  function textW(str, size, weight) {
    const key = str + '|' + size + '|' + weight;
    let w = _tw.get(key);
    if (w == null) { const g = hc(); g.font = 'italic ' + weight + ' ' + size + 'px ' + PFONT; w = g.measureText(str).width; if (_tw.size > 2000) _tw.clear(); _tw.set(key, w); }
    return w;
  }
  function upright(a) { a = ((a % TAU) + TAU) % TAU; return (a > PI / 2 && a < PI * 1.5) ? a - PI : a; }
  // путь по ломаной q (c — накопленные длины) с пропусками на интервалах длины gaps = [[d0, d1], …]
  function gapPath(ctx, q, c, gaps) {
    const L = c[c.length - 1], vis = [];
    let s0 = 0;
    for (const g of gaps.slice().sort((u, v) => u[0] - v[0])) { if (g[0] > s0) vis.push([s0, Math.min(g[0], L)]); s0 = Math.max(s0, g[1]); }
    if (s0 < L) vis.push([s0, L]);
    let i = 1;
    for (const [a0, a1] of vis) {
      if (a1 - a0 < 1e-6) continue;
      const a = along(q, c, a0), e = along(q, c, a1);
      ctx.moveTo(a.x, a.y);
      while (i < q.length && c[i] <= a0) i++;
      while (i < q.length && c[i] < a1) { ctx.lineTo(q[i].x, q[i].y); i++; }
      ctx.lineTo(e.x, e.y);
    }
  }
  function paper(ctx, x, y, w, h, opt) {
    opt = opt || {};
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x + 1.5, y + 2, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.1)'; ctx.fillRect(x + 0.5, y + 3.5, w + 2.5, h);
    ctx.fillStyle = patT('paper', 0, 0, 0, 0, ctx); ctx.fillRect(x, y, w, h);
    const m = opt.margin != null ? opt.margin : 6;
    ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.strokeRect(x + m, y + m, w - 2 * m, h - 2 * m);
    ctx.lineWidth = 0.3; ctx.strokeRect(x + m + 1.6, y + m + 1.6, w - 2 * m - 3.2, h - 2 * m - 3.2);
    const gs = opt.grid || 100, gx0 = opt.gridX != null ? opt.gridX : x, gy0 = opt.gridY != null ? opt.gridY : y;
    if (gs > 0) {
      ctx.beginPath();
      for (let gx = gx0 + Math.ceil((x + m + 5 - gx0) / gs) * gs; gx < x + w - m - 5; gx += gs)
        for (let gy = gy0 + Math.ceil((y + m + 5 - gy0) / gs) * gs; gy < y + h - m - 5; gy += gs) {
          ctx.moveTo(gx - 1.8, gy); ctx.lineTo(gx + 1.8, gy); ctx.moveTo(gx, gy - 1.8); ctx.lineTo(gx, gy + 1.8);
        }
      ctx.strokeStyle = INK; ctx.lineWidth = 0.35; ctx.stroke();
    }
    if (opt.header) label(ctx, x + w / 2, y + m / 2 + 0.3, opt.header, Math.min(4.2, m * 0.75), INK, 0, 600);
    if (opt.stamp !== false) {
      const sw = Math.min(124, w * 0.42), sh = 24, sx = x + w - m - 1.6 - sw, sy = y + h - m - 1.6 - sh;
      ctx.fillStyle = PAPER; ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = INK; ctx.lineWidth = 0.45; ctx.strokeRect(sx, sy, sw, sh);
      ctx.lineWidth = 0.25; ctx.beginPath();
      ctx.moveTo(sx, sy + 9); ctx.lineTo(sx + sw, sy + 9); ctx.moveTo(sx, sy + 16.5); ctx.lineTo(sx + sw, sy + 16.5);
      ctx.moveTo(sx + sw * 0.5, sy + 9); ctx.lineTo(sx + sw * 0.5, sy + sh);
      ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.rect(sx, sy, sw, sh); ctx.clip();
      label(ctx, sx + sw / 2, sy + 4.7, opt.title || 'Топографический план', 4.4, INK, 0, 700);
      label(ctx, sx + sw * 0.25, sy + 12.8, 'М 1:' + String(opt.scale || '500').replace(/^1:/, ''), 3.6, INK, 0, 600);
      label(ctx, sx + sw * 0.75, sy + 12.8, opt.section || 'Сечение рельефа 0,5 м', 3.0, INK, 0, 500);
      label(ctx, sx + sw * 0.25, sy + 20.3, opt.system || 'Система высот Балтийская', 2.6, INK, 0, 500);
      label(ctx, sx + sw * 0.75, sy + 20.3, opt.author || 'Съёмка: Топограф', 2.8, INK, 0, 500);
      ctx.restore();
    }
    ctx.restore();
  }
  function phouse(ctx, poly, lab) {
    const p = openRing(P(poly));
    if (p.length < 3) return;
    lab = lab == null ? '' : String(lab);
    const fire = /^[кКмМ]/.test(lab) || /^ж\/?б/i.test(lab);
    ctx.save();
    ctx.beginPath(); polyPath(ctx, p, true);
    ctx.fillStyle = fire ? 'rgba(236,150,112,.28)' : 'rgba(246,214,110,.38)'; ctx.fill();
    if (fire) { ctx.fillStyle = patT('hatch', 0, 0, 0, 1 / 8, ctx); ctx.fill(); }
    ctx.beginPath(); polyPath(ctx, p, true);
    ctx.strokeStyle = INK; ctx.lineWidth = 0.6; ctx.lineJoin = 'miter'; ctx.stroke();
    if (lab) {
      const c = centroid(p), b = bbox(p), size = Math.round(clamp(Math.min(b.x1 - b.x0, b.y1 - b.y0) * 0.3, 2.8, 5.4) * 4) / 4;
      const tw = textW(lab, size, 600);
      ctx.fillStyle = fire ? 'rgba(250,236,226,.85)' : 'rgba(252,244,214,.85)';
      ctx.fillRect(c.x - tw / 2 - 0.6, c.y - size * 0.55, tw + 1.2, size * 1.1);
      label(ctx, c.x, c.y, lab, size, INK, 0, 600);
    }
    ctx.restore();
  }
  function ptree(ctx, x, y, kind) {
    ctx.save();
    ctx.strokeStyle = GREEN; ctx.fillStyle = GREEN; ctx.lineWidth = 0.38; ctx.lineJoin = 'round';
    if (kind === 'conifer') {
      ctx.beginPath(); ctx.moveTo(x - 1.5, y - 0.4); ctx.lineTo(x, y - 3.8); ctx.lineTo(x + 1.5, y - 0.4); ctx.moveTo(x, y - 3.8); ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 0.45, 0, TAU); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(x, y, 1.7, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 0.42, 0, TAU); ctx.fill();
      if (kind === 'apple') { ctx.beginPath(); ctx.moveTo(x, y - 1.7); ctx.lineTo(x, y - 2.6); ctx.stroke(); }
      if (kind === 'birch') { ctx.beginPath(); ctx.moveTo(x - 1.2, y + 1.2); ctx.lineTo(x + 1.2, y - 1.2); ctx.lineWidth = 0.2; ctx.stroke(); }
    }
    ctx.restore();
  }
  function pmanhole(ctx, x, y, kind) {
    kind = netKind(kind) || 'sewer';
    const c = UTIL[kind];
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(x, y, 1.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = c; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(x, y, 1.45, 0, TAU); ctx.stroke();
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 0.35, 0, TAU); ctx.fill();
    label(ctx, x + 2.6, y - 1.6, NET[kind].l, 3.4, c, 0, 700);
    ctx.restore();
  }
  function ppole(ctx, x, y, kind, rot) {
    rot = rot || 0;
    ctx.save(); ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 0.3; ctx.lineCap = 'round';
    if (kind === 'lamp') {
      ctx.beginPath(); ctx.arc(x, y, 0.45, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1.6, y - 1.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 2.3, y - 2.3, 0.95, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 2.3, y - 2.3, 0.3, 0, TAU); ctx.fill();
    } else if (kind === 'tele') {
      ctx.beginPath(); ctx.arc(x, y, 0.85, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 0.85, PI / 2, PI * 1.5); ctx.closePath(); ctx.fill();
    } else {
      const ca = Math.cos(rot), sa = Math.sin(rot);
      ctx.beginPath(); ctx.arc(x, y, 0.95, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 0.35, 0, TAU); ctx.fill();
      ctx.beginPath();
      for (const d of [-1, 1]) {
        const bx = x + ca * d * 0.95, by = y + sa * d * 0.95, ex = x + ca * d * 2.6, ey = y + sa * d * 2.6;
        ctx.moveTo(bx, by); ctx.lineTo(ex, ey);
        ctx.moveTo(ex - ca * d * 0.7 - sa * 0.5, ey - sa * d * 0.7 + ca * 0.5); ctx.lineTo(ex, ey); ctx.lineTo(ex - ca * d * 0.7 + sa * 0.5, ey - sa * d * 0.7 - ca * 0.5);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function pfence(ctx, pts, kind) {
    const p = P(pts);
    if (p.length < 2) return;
    const c = cum(p), L = c[c.length - 1];
    ctx.save(); ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
    ctx.beginPath(); polyPath(ctx, p, false);
    if (kind === 'concrete') {
      ctx.lineWidth = 0.75; ctx.stroke();
      ctx.beginPath(); for (let d = 0; d <= L + 0.01; d += 6) { const a = along(p, c, d); ctx.rect(a.x - 0.75, a.y - 0.75, 1.5, 1.5); } ctx.fill();
    } else if (kind === 'metal') {
      ctx.lineWidth = 0.35; ctx.stroke();
      ctx.beginPath(); for (let d = 0; d <= L + 0.01; d += 5) { const a = along(p, c, d); circ(ctx, a.x, a.y, 0.6); } ctx.fill();
    } else if (kind === 'chain') {
      ctx.lineWidth = 0.3; ctx.setLineDash([2, 1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); for (let d = 2.5; d <= L; d += 5) { const a = along(p, c, d); const ca = Math.cos(a.a + PI / 4) * 0.7, sa = Math.sin(a.a + PI / 4) * 0.7; ctx.moveTo(a.x - ca, a.y - sa); ctx.lineTo(a.x + ca, a.y + sa); ctx.moveTo(a.x + sa, a.y - ca); ctx.lineTo(a.x - sa, a.y + ca); }
      ctx.lineWidth = 0.25; ctx.stroke();
    } else { // wood
      ctx.lineWidth = 0.35; ctx.stroke();
      ctx.beginPath(); for (let d = 1.5; d <= L; d += 3) { const a = along(p, c, d); const nx = -Math.sin(a.a), ny = Math.cos(a.a); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + nx * 1.2, a.y + ny * 1.2); }
      ctx.lineWidth = 0.28; ctx.stroke();
    }
    ctx.restore();
  }
  function proad(ctx, pts, width, lab) {
    const p0 = P(pts);
    if (p0.length < 2) return;
    width = width > 0 ? width : 24;
    const closed = isClosed(p0), q = densify(closed ? p0.slice(0, -1) : p0, closed, 3);
    const a = offsetLine(q, width / 2, closed), b = offsetLine(q, -width / 2, closed);
    ctx.save(); ctx.lineJoin = 'round';
    ctx.beginPath(); polyPath(ctx, q, closed); ctx.lineWidth = width; ctx.strokeStyle = 'rgba(120,112,100,.08)'; ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = 0.45;
    ctx.beginPath(); polyPath(ctx, a, closed); polyPath(ctx, b, closed); ctx.stroke();
    if (lab !== null && width >= 10) {
      const c = cum(q), L = c[c.length - 1], txt = lab == null ? 'а' : String(lab);
      for (let d = Math.min(L / 2, 60); d < L; d += 160) { const pa = along(q, c, d); label(ctx, pa.x, pa.y, txt, Math.min(4.2, width * 0.3), INK, upright(pa.a), 500); }
    }
    ctx.restore();
  }
  function pwater(ctx, pts, width) {
    const p0 = P(pts);
    if (p0.length < 2) return;
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (width > 0 || p0.length < 3) {
      const q = densify(p0, false, 3);
      if (width > 6) {
        ctx.beginPath(); polyPath(ctx, q, false); ctx.lineWidth = width; ctx.strokeStyle = '#d3e6f4'; ctx.stroke();
        ctx.strokeStyle = BLUE; ctx.lineWidth = 0.4; ctx.beginPath(); polyPath(ctx, offsetLine(q, width / 2, false), false); polyPath(ctx, offsetLine(q, -width / 2, false), false); ctx.stroke();
      } else { ctx.beginPath(); polyPath(ctx, q, false); ctx.strokeStyle = BLUE; ctx.lineWidth = clamp((width || 2) * 0.25, 0.4, 1.4); ctx.stroke(); }
    } else {
      const p = openRing(p0), b = bbox(p);
      ctx.beginPath(); smoothPath(ctx, p, true); ctx.fillStyle = '#d3e6f4'; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.beginPath(); for (let yy = b.y0 + 0.8; yy < b.y1; yy += 1.5) { ctx.moveTo(b.x0, yy); ctx.lineTo(b.x1, yy); }
      ctx.strokeStyle = 'rgba(43,108,176,.45)'; ctx.lineWidth = 0.2; ctx.stroke();
      ctx.restore();
      ctx.beginPath(); smoothPath(ctx, p, true); ctx.strokeStyle = BLUE; ctx.lineWidth = 0.5; ctx.stroke();
    }
    ctx.restore();
  }
  function pslope(ctx, topPts, bottomPts, color) {
    const T = P(topPts), B = P(bottomPts);
    if (T.length < 2 || B.length < 2) return;
    const tq = densify(T, false, 2), bq = densify(B, false, 2), ct = cum(tq), cb = cum(bq), Lt = ct[ct.length - 1], Lb = cb[cb.length - 1];
    const col = color || BROWN;
    ctx.save(); ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); polyPath(ctx, tq, false); ctx.lineWidth = 0.45; ctx.stroke();
    const m = Math.max(3, Math.ceil(Lt / 1.8));
    ctx.beginPath();
    for (let i = 0; i <= m; i++) {
      const t = i / m, a = along(tq, ct, t * Lt), b = along(bq, cb, t * Lb), f = i % 2 ? 0.5 : 1;
      ctx.moveTo(a.x, a.y); ctx.lineTo(lerp(a.x, b.x, f), lerp(a.y, b.y, f));
    }
    ctx.lineWidth = 0.28; ctx.stroke();
    ctx.restore();
  }
  function fmtH(h, dec) { return (Math.round(h * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec); }
  function pcontour(ctx, pts, h, main) {
    const p0 = P(pts);
    if (p0.length < 2) return;
    const closed = isClosed(p0), p = closed ? p0.slice(0, -1) : p0;
    ctx.save();
    // толщины < 1 px при 2x DPR рисуются быстрым «волосяным» путём; утолщённая — темнее и шире
    ctx.strokeStyle = main ? BROWN_D : BROWN; ctx.lineWidth = main ? 0.49 : 0.3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const labs = [];
    let txt = null, q = null, c = null;
    const size = 3.8;
    if (main && h != null && isFinite(h)) {
      txt = Number.isInteger(h) ? String(h) : fmtH(h, Math.abs(h * 10 - Math.round(h * 10)) < 1e-6 ? 1 : 2);
      q = densify(p, closed, 3);
      if (closed) q.push({ x: q[0].x, y: q[0].y });
      c = cum(q);
      const L = c[c.length - 1], tw = textW(txt, size, 600);
      if (L > tw * 3) {
        const n = Math.max(1, Math.floor(L / Math.max(L, 260) + 0.5));
        for (let k = 0; k < n; k++) {
          const d = L * (k + 0.5) / n, a = along(q, c, d - tw / 2), e = along(q, c, d + tw / 2);
          labs.push({ x: (a.x + e.x) / 2, y: (a.y + e.y) / 2, a: Math.atan2(e.y - a.y, e.x - a.x), d0: d - tw / 2 - 0.8, d1: d + tw / 2 + 0.8 });
        }
      }
    }
    ctx.beginPath();
    if (labs.length) gapPath(ctx, q, c, labs.map(g => [g.d0, g.d1])); else smoothPath(ctx, p, closed);
    ctx.stroke();
    for (const g of labs) label(ctx, g.x, g.y, txt, size, BROWN_D, upright(g.a), 600);
    ctx.restore();
  }
  function pspot(ctx, x, y, h) {
    ctx.save();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x, y, 0.5, 0, TAU); ctx.fill();
    if (h != null && h !== '') label(ctx, x + 1.3, y - 0.2, typeof h === 'number' ? fmtH(h, 2) : String(h), 3.3, INK, 0, 500, 'left');
    ctx.restore();
  }
  function putility(ctx, pts, kind) {
    const p0 = P(pts);
    if (p0.length < 2) return;
    kind = netKind(kind) || 'water';
    const col = UTIL[kind], letter = NET[kind].l, q = densify(p0, false, 4), c = cum(q), L = c[c.length - 1];
    const size = 3.3, gaps = [];
    for (let d = Math.min(18, L / 2); d < L - 4; d += 40) { const a = along(q, c, d); gaps.push({ x: a.x, y: a.y, a: a.a, d0: d - size * 0.6 - 0.4, d1: d + size * 0.6 + 0.4 }); }
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 0.49; ctx.lineJoin = 'round';
    if (kind === 'storm') ctx.setLineDash([3, 1.2]);
    ctx.beginPath(); gapPath(ctx, q, c, gaps.map(g => [g.d0, g.d1])); ctx.stroke();
    ctx.setLineDash([]);
    for (const g of gaps) label(ctx, g.x, g.y, letter, size, col, upright(g.a), 700);
    ctx.restore();
  }

  /* ========================================================== SPRITE CACHE */
  // Статичные «тяжёлые» объекты рисуются один раз в offscreen-спрайт (в разрешении экрана)
  // и дальше выводятся одним drawImage, выровненным по пикселям. LRU по числу пикселей.
  const SPR = new Map(), SEEN = new Set();
  let sprPx = 0, sprMiss = 0, sprWin = 0;
  const SPR_BUDGET = 8e6, SPR_MAX = 2.5e6;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // local: объект рисуется относительно (x0, y0) без привязки к сетке мира (подвижные объекты: ключ без координат)
  function cached(ctx, key, x0, y0, x1, y1, draw, opaque, local) {
    if (!out.cache || !ctx.getTransform) return draw(ctx);
    const m = ctx.getTransform(), k = Math.hypot(m.a, m.b);
    if (!(k > 0.01) || !isFinite(x0 + y0 + x1 + y1)) return draw(ctx);
    if (!local) { x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1); }
    const pw = Math.ceil((x1 - x0) * k), ph = Math.ceil((y1 - y0) * k);
    if (pw < 1 || ph < 1) return;
    if (pw * ph > SPR_MAX) return draw(ctx);
    if (opaque && (Math.abs(pw - (x1 - x0) * k) > 1e-6 || Math.abs(ph - (y1 - y0) * k) > 1e-6 || m.b !== 0 || m.c !== 0)) opaque = false; // край не по пикселю — нужна прозрачность
    if (opaque) key += '#o';
    const fk = key + '@' + k.toFixed(4) + (local ? '' : '/' + x0 + ',' + y0);
    let e = SPR.get(fk), ret;
    if (e) { SPR.delete(fk); SPR.set(fk, e); }
    else if (!SEEN.has(fk)) {
      // «привратник»: спрайт заводится только при повторном запросе того же объекта в том же масштабе.
      // Разовые отрисовки (api.layer, картинка итога, анимация масштаба) идут напрямую и не засоряют кэш.
      if (SEEN.size > 20000) SEEN.clear();
      SEEN.add(fk);
      return draw(ctx);
    } else {
      const t = now();
      if (t - sprWin > 250) { sprWin = t; sprMiss = 0; }
      if (++sprMiss > 150) return draw(ctx);            // защита от «пробуксовки» (анимация масштаба и т. п.)
      const c = mkCanvas(pw, ph), g = c.getContext('2d', opaque ? { alpha: false } : undefined);
      g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
      ret = draw(g);
      e = { c, w: pw / k, h: ph / k, px: pw * ph, ret };
      SPR.set(fk, e); sprPx += e.px;
      for (const [kk, v] of SPR) { if (sprPx <= SPR_BUDGET) break; SPR.delete(kk); sprPx -= v.px; }
    }
    let dx = x0, dy = y0;
    if (m.b === 0 && m.c === 0 && Math.abs(m.a - m.d) < 1e-9) { dx = (Math.round(m.a * x0 + m.e) - m.e) / m.a; dy = (Math.round(m.d * y0 + m.f) - m.f) / m.d; }
    ctx.drawImage(e.c, dx, dy, e.w, e.h);
    return e.ret;
  }
  const CK = function () { return Array.prototype.join.call(arguments, '|'); };
  const OK = o => (o ? JSON.stringify(o) : '');
  function ptsKey(p) { let k = ''; for (const q of p) k += Math.round(q.x * 64) + ',' + Math.round(q.y * 64) + ';'; return k; }
  function rectBox(x, y, w, h, rot, pad, sh) {
    const cx = x + w / 2, cy = y + h / 2, ca = Math.abs(Math.cos(rot || 0)), sa = Math.abs(Math.sin(rot || 0));
    const hw = (w * ca + h * sa) / 2, hh = (w * sa + h * ca) / 2;
    return [cx - hw - pad, cy - hh - pad, cx + hw + pad + sh, cy + hh + pad + sh];
  }
  // габарит сглаженной кривой: точки + контрольные точки Безье (кривая лежит в их выпуклой оболочке)
  function ptsBox(p, pad, closed) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const n = p.length, add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (let i = 0; i < n; i++) {
      const a = p[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = p[i], c = p[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      add(b.x, b.y); add(b.x + (c.x - a.x) / 6, b.y + (c.y - a.y) / 6); add(b.x - (c.x - a.x) / 6, b.y - (c.y - a.y) / 6);
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  const _fnId = new WeakMap();
  let _fnN = 0;
  const C = {
    ground(ctx, x, y, w, h, kind, seed, opt) {
      if (opt && opt.poly) {
        const p = openRing(P(opt.poly)); if (p.length < 3) return;
        const e = opt.edge != null ? opt.edge : 3, b = ptsBox(p, e + 1, true);
        return cached(ctx, CK('GP', ptsKey(p), kind, seed, e), b[0], b[1], b[2], b[3], g => ground(g, x, y, w, h, kind, seed, opt));
      }
      if (!(w > 0 && h > 0)) return;
      const whole = x === Math.round(x) && y === Math.round(y) && w === Math.round(w) && h === Math.round(h);
      return cached(ctx, CK('GD', x, y, w, h, kind, seed), x, y, x + w, y + h, g => ground(g, x, y, w, h, kind, seed), whole);
    },
    car(ctx, x, y, rot, color, seed) {
      const q = ((Math.round((rot || 0) * 180 / PI) % 360) + 360) % 360, rq = q * PI / 180;
      const sd = seed == null ? (color ? toSeed(String(color)) : 1) : seed;
      return cached(ctx, CK('CAR', q, color, sd), x - 12, y - 12, x + 14, y + 14, g => car(g, x, y, rq, color, sd), false, true);
    },
    tree(ctx, x, y, r, kind, seed) {
      r = r > 0 ? r : 10;
      return cached(ctx, CK('T', x, y, r, kind, seed), x - r * 1.3 - 1, y - r * 1.3 - 1, x + r * 2.5 + 1, y + r * 2.5 + 1, g => tree(g, x, y, r, kind, seed));
    },
    bush(ctx, x, y, r, seed) {
      r = r > 0 ? r : 4;
      return cached(ctx, CK('B', x, y, r, seed), x - r * 1.3 - 1, y - r * 1.3 - 1, x + r * 2 + 1, y + r * 2 + 1, g => bush(g, x, y, r, seed));
    },
    flowerbed(ctx, x, y, w, h, seed) { return cached(ctx, CK('F', x, y, w, h, seed), x - 1, y - 1, x + w + 2, y + h + 2, g => flowerbed(g, x, y, w, h, seed)); },
    house(ctx, x, y, w, h, opt) {
      const o = opt || {}, b = rectBox(x, y, w, h, o.rot, 2.5, (o.height || 0) + 5 + Math.min(w, h) * 0.12);
      return cached(ctx, CK('H', x, y, w, h, OK(opt)), b[0], b[1], b[2], b[3], g => house(g, x, y, w, h, opt));
    },
    building(ctx, x, y, w, h, opt) {
      const o = opt || {}, fl = o.floors > 0 ? o.floors : (o.kind === 'industrial' ? 2 : 5), b = rectBox(x, y, w, h, o.rot, 3, Math.max(10, Math.min(44, 2.5 + fl * 1.8)) + 3);
      return cached(ctx, CK('BL', x, y, w, h, OK(opt)), b[0], b[1], b[2], b[3], g => building(g, x, y, w, h, opt));
    },
    shed(ctx, x, y, w, h, opt) {
      const b = rectBox(x, y, w, h, opt && opt.rot, 2, 5);
      return cached(ctx, CK('S', x, y, w, h, OK(opt)), b[0], b[1], b[2], b[3], g => shed(g, x, y, w, h, opt));
    },
    greenhouse(ctx, x, y, w, h, opt) {
      const b = rectBox(x, y, w, h, opt && opt.rot, 2, 4);
      return cached(ctx, CK('G', x, y, w, h, OK(opt)), b[0], b[1], b[2], b[3], g => greenhouse(g, x, y, w, h, opt));
    },
    garages(ctx, x, y, n, opt) {
      const o = opt || {}, W = Math.max(1, n | 0) * (o.w || 13), D = o.h || 24, b = rectBox(x, y, W, D, o.rot, 2 + (o.apron ? 8 : 0), 5);
      return cached(ctx, CK('GR', x, y, n, OK(opt)), b[0], b[1], b[2], b[3], g => garages(g, x, y, n, opt));
    },
    playground(ctx, x, y, w, h, seed) { return cached(ctx, CK('PG', x, y, w, h, seed), x - 1, y - 1, x + w + 6, y + h + 6, g => playground(g, x, y, w, h, seed)); },
    well(ctx, x, y) { return cached(ctx, CK('W', x, y), x - 6, y - 5, x + 8, y + 8, g => well(g, x, y)); },
    road(ctx, pts, width, kind, opt) {
      const p = P(pts); if (p.length < 2) return;
      const w = width > 0 ? width : 24, b = ptsBox(p, w / 2 + 4, isClosed(p));
      return cached(ctx, CK('R', ptsKey(p), w, kind, OK(opt)), b[0], b[1], b[2], b[3], g => road(g, p, width, kind, opt));
    },
    fence(ctx, pts, kind) {
      const p = P(pts); if (p.length < 2) return;
      const b = bbox(p);
      return cached(ctx, CK('FE', ptsKey(p), kind), b.x0 - 3, b.y0 - 3, b.x1 + 5, b.y1 + 5, g => fence(g, p, kind));
    },
    pond(ctx, pts, seed) {
      const p = P(pts); if (p.length < 3) return;
      const b = ptsBox(openRing(p), 6, true);
      return cached(ctx, CK('PO', ptsKey(p), seed), b[0], b[1], b[2], b[3], g => pond(g, p, seed));
    },
    stream(ctx, pts, width, seed) {
      const p = P(pts); if (p.length < 2) return;
      const b = ptsBox(p, (width > 0 ? width : 6) / 2 + 6);
      return cached(ctx, CK('ST', ptsKey(p), width, seed), b[0], b[1], b[2], b[3], g => stream(g, p, width, seed));
    },
    swamp(ctx, pts, seed) {
      const p = P(pts); if (p.length < 3) return;
      const b = ptsBox(openRing(p), 4, true);
      return cached(ctx, CK('SW', ptsKey(p), seed), b[0], b[1], b[2], b[3], g => swamp(g, p, seed));
    },
    slope(ctx, topPts, bottomPts) {
      const T = P(topPts), B = P(bottomPts); if (T.length < 2 || B.length < 2) return;
      const b1 = ptsBox(T, 3), b2 = ptsBox(B, 3), b = [Math.min(b1[0], b2[0]), Math.min(b1[1], b2[1]), Math.max(b1[2], b2[2]), Math.max(b1[3], b2[3])];
      return cached(ctx, CK('SL', ptsKey(T), ptsKey(B)), b[0], b[1], b[2], b[3], g => slope(g, T, B));
    },
    gate(ctx, x, y, w, rot, open) { return cached(ctx, CK('GA', x, y, w, rot, open), x - (w || 14) / 2 - 4, y - (w || 14) / 2 - 4, x + (w || 14) / 2 + 6, y + (w || 14) / 2 + 6, g => gate(g, x, y, w, rot, open)); },
    paper(ctx, x, y, w, h, opt) { return cached(ctx, CK('PP', x, y, w, h, OK(opt)), x, y, x + w + 3.5, y + h + 4, g => paper(g, x, y, w, h, opt)); },
    hillshade(ctx, x, y, w, h, heightFn, opt) {
      if (typeof heightFn !== 'function') return;
      let id = opt && opt.key;
      if (id == null) { id = _fnId.get(heightFn); if (!id) _fnId.set(heightFn, id = ++_fnN); }
      return cached(ctx, CK('HS', x, y, w, h, id, OK(opt)), x, y, x + w, y + h, g => hillshade(g, x, y, w, h, heightFn, opt));
    },
  };
  // несколько дорог слоями: сначала бордюры/обочины всех, потом покрытие всех, потом разметка
  // (осевая прерывается на перекрёстках с другими дорогами списка)
  function roads(ctx, list) {
    if (!list || !list.length) return;
    const L = list.filter(r => r && P(r.pts).length >= 2);
    for (const r of L) C.road(ctx, r.pts, r.width, r.kind, Object.assign({}, r.opt, { stage: 'base', seed: r.seed }));
    // покрытие: сначала грунтовые/гравийные/тротуары, асфальт сверху (примыкание грунтовки к шоссе)
    const PRI = { path: 0, dirt: 1, gravel: 2 }, pri = r => (r.kind in PRI ? PRI[r.kind] : 3);
    const top = L.map((r, i) => [r, i]).sort((a, b) => pri(a[0]) - pri(b[0]) || a[1] - b[1]);
    for (const [r] of top) C.road(ctx, r.pts, r.width, r.kind, Object.assign({}, r.opt, { stage: 'top', seed: r.seed }));
    for (const r of L) {
      if (r.kind === 'dirt' || r.kind === 'path' || r.kind === 'gravel') continue;
      const avoid = L.filter(o => o !== r).map(o => ({ pts: P(o.pts).map(q => ({ x: q.x, y: q.y })), width: o.width }));
      C.road(ctx, r.pts, r.width, r.kind, Object.assign({}, r.opt, { stage: 'mark', seed: r.seed, avoid }));
    }
  }

  /* ================================================================= EXPORT */
  const API = Object.assign({
    roads, manhole, hydrant, pole, wires, bench, marker,
    surveyorTop, tripodTop, dogTop, personTop,
  }, C);
  const NAMES = ['ground', 'road', 'roads', 'house', 'building', 'shed', 'garages', 'greenhouse', 'fence', 'gate', 'tree', 'bush', 'flowerbed',
    'manhole', 'hydrant', 'pole', 'wires', 'car', 'bench', 'playground', 'well', 'pond', 'stream', 'swamp', 'slope', 'hillshade', 'marker',
    'surveyorTop', 'tripodTop', 'dogTop', 'personTop'];
  const ORDER = (a, b) => NAMES.indexOf(a) - NAMES.indexOf(b);
  const plan = {
    paper: C.paper, house: phouse, tree: ptree, manhole: pmanhole, pole: ppole, fence: pfence, road: proad,
    water: pwater, slope: pslope, contour: pcontour, spot: pspot, utility: putility, label,
  };
  const out = Object.assign({
    version: 1,
    cache: true,                       // false — рисовать всё напрямую, без спрайтов
    clearCache() { SPR.clear(); SEEN.clear(); sprPx = 0; },
    // заранее сгенерировать текстуры (например, пока показывается меню): Sym.prepare() или Sym.prepare(['grass', 'asphalt'])
    prepare(kinds) { for (const k of kinds || Object.keys(GROUND_MACRO).concat(['macro', 'macro2', 'grain', 'paper', 'hatch', 'downslope'])) if (GEN[k]) texCanvas(k); },
    cacheInfo() { return { sprites: SPR.size, pixels: sprPx }; },
    plan,
    hash: (s, i) => hash(toSeed(s), i || 0),
    rng: s => rng(toSeed(s)),
    colors: { ink: INK, brown: BROWN, blue: BLUE, green: GREEN, paper: PAPER, util: UTIL },
    list() { return Object.keys(API).sort(ORDER).concat(Object.keys(plan).map(k => 'plan.' + k)); },
  }, API);
  return out;
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Sym;
