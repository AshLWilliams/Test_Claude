'use strict';
// «Горизонтали» — камеральная обработка: по пикетам с отметками провести горизонтали заданного сечения
// (ручная интерполяция по рёбрам треугольников, как на кальке), в «Овраге» — ещё и тальвег. Устройство — в MODES.md.
(() => {
  const LIMIT = 150;                 // время уровня, с
  const PANEL_W = 116;               // правая панель кнопок
  const MH = 130;                    // высота поля плана, ед. (1 ед. ≈ 0,25 м)
  const PAD = 7;                     // поля листа вокруг поля плана, ед.
  const CELL = 2.5;                  // шаг сетки поля высот для изолиний
  const TOL_H = 0.3;                 // линия «в допуске»: средняя ошибка ≤ 0,3 сечения
  const TOL_COV = 6;                 // линия покрывает эталонную горизонталь ближе 6 ед.
  const TOL_THAL = 6, TOL_THAL_COV = 8;
  const DONE_COV = 0.9;              // горизонталь проведена
  const INK = '#1f1d1a', BROWN = '#a0582a', BROWN_D = '#86441c', BLUE = '#2b6cb0', GREEN = '#2e8540', PAPER = '#f5f0e2';
  const PFONT = 'Arial, "Helvetica Neue", "Liberation Sans", sans-serif';
  const UP_C = '#c0601e', DN_C = '#2f6db5', ON_C = '#2c9a4a'; // пикет выше / ниже / на уровне
  const ROOFS = ['#a0463a', '#8c3b2f', '#5b6f8a', '#4f7356', '#7a5a3c', '#6d6d72', '#b5653a'];
  const NAMES = ['Лысая', 'Сосновая', 'Горелая', 'Дальняя', 'Каменная', 'Круглая', 'Берёзовая'];
  const BROOKS = ['руч. Безымянный', 'руч. Каменка', 'руч. Сухой', 'руч. Ключевой', 'руч. Ольховый'];

  // ---------- геометрия ----------
  const d2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
  function polyLen(p) { let s = 0; for (let i = 1; i < p.length; i++) s += Math.sqrt(d2(p[i - 1], p[i])); return s; }
  function resample(p, step) { // равномерная передискретизация ломаной
    if (p.length < 2) return p.slice();
    const out = [{ x: p[0].x, y: p[0].y }];
    let acc = 0;
    for (let i = 1; i < p.length; i++) {
      let a = p[i - 1], d = Math.sqrt(d2(a, p[i]));
      const b = p[i];
      while (acc + d >= step && d > 1e-9) {
        const t = (step - acc) / d, q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        out.push(q); a = q; d = Math.sqrt(d2(a, b)); acc = 0;
      }
      acc += d;
    }
    const last = p[p.length - 1];
    if (d2(out[out.length - 1], last) > 0.25) out.push({ x: last.x, y: last.y }); else out[out.length - 1] = { x: last.x, y: last.y };
    return out;
  }
  function chaikin(p, it) { // сглаживание с сохранением концов
    for (let k = 0; k < it; k++) {
      if (p.length < 3) return p;
      const o = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        o.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      o.push(p[p.length - 1]); p = o;
    }
    return p;
  }
  function segD2(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    let t = l ? ((px - a.x) * dx + (py - a.y) * dy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = a.x + dx * t - px, y = a.y + dy * t - py;
    return x * x + y * y;
  }
  function distToPoly(px, py, p) { let m = Infinity; for (let i = 1; i < p.length; i++) { const v = segD2(px, py, p[i - 1], p[i]); if (v < m) m = v; } return Math.sqrt(m); }
  function along(p, d) { // точка и направление на расстоянии d вдоль ломаной
    for (let i = 1; i < p.length; i++) {
      const l = Math.sqrt(d2(p[i - 1], p[i]));
      if (d <= l || i === p.length - 1) { const t = l ? Math.min(1, d / l) : 0; return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * t, y: p[i - 1].y + (p[i].y - p[i - 1].y) * t, a: Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x) }; }
      d -= l;
    }
    return { x: p[0].x, y: p[0].y, a: 0 };
  }
  function offsetLine(p, off) {
    return p.map((q, i) => {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: q.x - (b.y - a.y) / l * off, y: q.y + (b.x - a.x) / l * off };
    });
  }
  const upright = a => { a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return a > Math.PI / 2 && a < Math.PI * 1.5 ? a - Math.PI : a; };

  // изолинии уровня L по сетке G (nx×ny, шаг cx×cy): marching squares + сшивка в ломаные
  function isolines(G, nx, ny, cx, cy, L) {
    const NH = nx * ny, adj = new Map(), pts = new Map();
    const v = (i, j) => { const t = G[j * nx + i] - L; return t === 0 ? 1e-9 : t; };
    const P = id => {
      let q = pts.get(id);
      if (q) return q;
      if (id < NH) { const i = id % nx, j = (id / nx) | 0, a = v(i, j), b = v(i + 1, j); q = { x: (i + a / (a - b)) * cx, y: j * cy }; }
      else { const k = id - NH, i = k % nx, j = (k / nx) | 0, a = v(i, j), b = v(i, j + 1); q = { x: i * cx, y: (j + a / (a - b)) * cy }; }
      pts.set(id, q); return q;
    };
    const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push(b); adj.get(b).push(a); };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
      const T = j * nx + i, B = (j + 1) * nx + i, Lf = NH + j * nx + i, R = Lf + 1;
      const e = [];
      if ((a > 0) !== (b > 0)) e.push(T);
      if ((b > 0) !== (c > 0)) e.push(R);
      if ((d > 0) !== (c > 0)) e.push(B);
      if ((a > 0) !== (d > 0)) e.push(Lf);
      if (e.length === 2) link(e[0], e[1]);
      else if (e.length === 4) { // седловина в клетке — решаем по среднему
        const up = (a + b + c + d) > 0, ac = a > 0;
        if (up === ac) { link(T, R); link(B, Lf); } else { link(T, Lf); link(R, B); }
      }
    }
    const used = new Set(), lines = [];
    const walk = s => {
      const ids = [s]; used.add(s);
      let cur = s;
      for (;;) {
        const nb = adj.get(cur); let nx2 = -1;
        for (const n of nb) if (!used.has(n)) { nx2 = n; break; }
        if (nx2 < 0) { if (ids.length > 2 && nb.includes(s)) ids.push(s); break; }
        used.add(nx2); ids.push(nx2); cur = nx2;
      }
      return ids.map(P);
    };
    for (const [id, nb] of adj) if (nb.length === 1 && !used.has(id)) lines.push(walk(id));
    for (const [id] of adj) if (!used.has(id)) lines.push(walk(id));
    return lines.filter(l => l.length > 1);
  }

  // триангуляция Делоне (Боуэр — Ватсон) — «треугольники на кальке» между пикетами
  function delaunay(P) {
    const n = P.length, X = P.map(p => p.x).concat([-1e4, 1e4, 0]), Y = P.map(p => p.y).concat([-1e4, -1e4, 1e4]);
    const mk = (a, b, c) => {
      const ax = X[a], ay = Y[a], bx = X[b], by = Y[b], cx = X[c], cy = Y[c];
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-12;
      const A = ax * ax + ay * ay, B = bx * bx + by * by, C = cx * cx + cy * cy;
      const ux = (A * (by - cy) + B * (cy - ay) + C * (ay - by)) / d, uy = (A * (cx - bx) + B * (ax - cx) + C * (bx - ax)) / d;
      return { a, b, c, x: ux, y: uy, r2: (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy) };
    };
    let tris = [mk(n, n + 1, n + 2)];
    for (let i = 0; i < n; i++) {
      const x = X[i], y = Y[i], keep = [], edges = new Map();
      for (const t of tris) {
        if ((x - t.x) * (x - t.x) + (y - t.y) * (y - t.y) < t.r2) {
          for (const [u, w] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) { const k = u < w ? u * 4096 + w : w * 4096 + u; edges.set(k, edges.has(k) ? null : [u, w]); }
        } else keep.push(t);
      }
      tris = keep;
      for (const e of edges.values()) if (e) tris.push(mk(e[0], e[1], i));
    }
    return tris.filter(t => t.a < n && t.b < n && t.c < n).map(t => [t.a, t.b, t.c]);
  }

  // ---------- генерация рельефа ----------
  function gaussSum(G, gx, gy) {
    return (x, y) => {
      let v = gx * x + gy * y;
      for (const g of G) { const dx = x - g.x, dy = y - g.y, u = (dx * g.c + dy * g.s) / g.sx, w = (-dx * g.s + dy * g.c) / g.sy; v += g.a * Math.exp(-(u * u + w * w)); }
      return v;
    };
  }
  function terrainHill(R, MW) { // один-два холма, седловина, впадина, мелкие неровности, общий уклон
    const G = [], add = (x, y, a, sx, sy, rot) => G.push({ x, y, a, sx, sy, c: Math.cos(rot), s: Math.sin(rot) });
    if (R() < 0.62) { // два холма и седловина
      const ang = (R() - 0.5) * 0.7, d = MW * (0.42 + R() * 0.12), cx = MW * (0.45 + R() * 0.1), cy = MH * (0.44 + R() * 0.14);
      const dx = Math.cos(ang) * d / 2, dy = Math.sin(ang) * d / 2;
      add(cx - dx, cy - dy, 1, 28 + R() * 12, 25 + R() * 12, R() * 3);
      add(cx + dx, cy + dy, 0.62 + R() * 0.3, 25 + R() * 12, 23 + R() * 10, R() * 3);
    } else { // холм с отрогом
      const cx = MW * (0.36 + R() * 0.28), cy = MH * (0.42 + R() * 0.18), a = R() * 6.28;
      add(cx, cy, 1, 34 + R() * 14, 27 + R() * 10, R() * 3);
      add(cx + Math.cos(a) * 38, cy + Math.sin(a) * 24, 0.42 + R() * 0.2, 20 + R() * 8, 13 + R() * 6, a);
    }
    if (R() < 0.5) add(R() * MW, R() * MH, -0.18 - R() * 0.14, 16 + R() * 10, 14 + R() * 8, R() * 3); // впадина
    for (let i = 0; i < 3; i++) add(R() * MW, R() * MH, (R() - 0.5) * 0.14, 10 + R() * 8, 10 + R() * 8, 0);
    return { raw: gaussSum(G, (R() - 0.5) * 0.004, (R() - 0.5) * 0.004) };
  }
  function terrainRavine(R, MW, roadTop) { // долина с V-образным дном, уклон вниз по течению
    const flow = R() < 0.5 ? 1 : -1;
    const q0 = roadTop ? 0.6 + R() * 0.08 : 0.32 + R() * 0.08;
    const A1 = 5 + R() * 5, f1 = (0.6 + R() * 0.6) * 2 * Math.PI / MW, p1 = R() * 6.28;
    const A2 = 1.5 + R() * 2, f2 = (1.6 + R()) * 2 * Math.PI / MW, p2 = R() * 6.28;
    const yc = x => MH * q0 + A1 * Math.sin(f1 * x + p1) + A2 * Math.sin(f2 * x + p2);
    const w = 20 + R() * 8, drop = 0.009 + R() * 0.004, tilt = (R() - 0.5) * 0.004;
    const G = [];
    for (let i = 0; i < 3; i++) {
      const x = R() * MW, side = R() < 0.5 ? -1 : 1, y = yc(x) + side * (32 + R() * 20);
      G.push({ x, y, a: 0.1 + R() * 0.18, sx: 18 + R() * 12, sy: 14 + R() * 10, c: 1, s: 0 });
    }
    const bumps = gaussSum(G, 0, 0);
    const raw = (x, y) => {
      const d = y - yc(x), xs = flow > 0 ? x : MW - x;
      return -drop * xs + (1 - Math.exp(-(Math.sqrt(d * d + 9) - 3) / w)) + tilt * (y - MH / 2) + bumps(x, y);
    };
    return { raw, yc, flow };
  }

  // ---------- генерация участка целиком ----------
  function generate(api, variant, seed, MW) {
    const R = api.rng(seed), P = variant.params, ravine = !!P.ravine, iv = P.iv;
    const nx = Math.round(MW / CELL) + 1, ny = Math.round(MH / CELL) + 1, cx = MW / (nx - 1), cy = MH / (ny - 1);
    for (let attempt = 0; attempt < 60; attempt++) {
      const roadTop = R() < 0.5;
      const T = ravine ? terrainRavine(R, MW, roadTop) : terrainHill(R, MW);
      let rmin = Infinity, rmax = -Infinity;
      const raw = new Float64Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = T.raw(i * cx, j * cy); raw[j * nx + i] = v; if (v < rmin) rmin = v; if (v > rmax) rmax = v; }
      const relief = ravine ? 4.3 + R() * 1.3 : 4.6 + R() * 2.7, base = Math.round((118 + R() * 70) * 100) / 100;
      const k = relief / (rmax - rmin);
      const hTrue = (x, y) => base + (T.raw(x, y) - rmin) * k;
      const G = new Float64Array(nx * ny);
      for (let i = 0; i < G.length; i++) G[i] = base + (raw[i] - rmin) * k;
      const hmin = base, hmax = base + relief;
      // уровни: кратные сечению внутри листа, с заметной длиной горизонтали
      const cand = [];
      for (let L = Math.ceil((hmin + 0.08) / iv) * iv; L < hmax - 0.08; L = Math.round((L + iv) * 100) / 100) {
        const lines = isolines(G, nx, ny, cx, cy, L).map(l => chaikin(l, 1));
        if (lines.reduce((s, l) => s + polyLen(l), 0) >= 40) cand.push({ h: Math.round(L * 100) / 100, lines });
      }
      if (cand.length < P.levels[0] || cand.length > P.levels[1]) continue;
      // тальвег — линия дна долины (численно, по минимуму поперёк долины)
      let thal = null;
      if (ravine) {
        thal = [];
        for (let x = 0; x <= MW + 0.01; x += 3) {
          const y0 = T.yc(Math.min(x, MW));
          let by = y0, bh = Infinity;
          for (let y = Math.max(1, y0 - 16); y <= Math.min(MH - 1, y0 + 16); y += 0.5) { const h = hTrue(Math.min(x, MW), y); if (h < bh) { bh = h; by = y; } }
          thal.push({ x: Math.min(x, MW), y: by });
        }
        thal = chaikin(thal, 2);
        if (T.flow < 0) thal.reverse(); // от истока к устью
      }
      const sit = situation(R, MW, roadTop, ravine, thal, hTrue);
      const pk = pickets(R, MW, G, nx, ny, cx, cy, hTrue, sit, thal);
      if (pk.length < 25) continue;
      const tris = delaunay(pk);
      const TT = tris.map(([a, b, c]) => {
        const A = pk[a], B = pk[b], C = pk[c], det = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
        return { a, b, c, det, x0: Math.min(A.x, B.x, C.x), x1: Math.max(A.x, B.x, C.x), y0: Math.min(A.y, B.y, C.y), y1: Math.max(A.y, B.y, C.y) };
      }).filter(t => Math.abs(t.det) > 1e-6);
      const tinH = (x, y) => { // высота по треугольникам из пикетов (линейная интерполяция) или null вне сети
        for (const t of TT) {
          if (x < t.x0 - 1e-6 || x > t.x1 + 1e-6 || y < t.y0 - 1e-6 || y > t.y1 + 1e-6) continue;
          const A = pk[t.a], B = pk[t.b], C = pk[t.c];
          const l1 = ((B.y - C.y) * (x - C.x) + (C.x - B.x) * (y - C.y)) / t.det, l2 = ((C.y - A.y) * (x - C.x) + (A.x - C.x) * (y - C.y)) / t.det, l3 = 1 - l1 - l2;
          if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return l1 * A.h + l2 * B.h + l3 * C.h;
        }
        return null;
      };
      const GT = new Float64Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const t = tinH(i * cx, j * cy); GT[j * nx + i] = t == null ? G[j * nx + i] : t; }
      const edges = new Map();
      for (const t of TT) for (const [u, w] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) edges.set(u < w ? u * 4096 + w : w * 4096 + u, [Math.min(u, w), Math.max(u, w)]);
      const sample = lines => { const s = []; for (const l of lines) for (const q of resample(l, 3)) s.push(q); return s; };
      const levels = [];
      for (const c of cand) {
        const tinLines = isolines(GT, nx, ny, cx, cy, c.h);
        if (tinLines.reduce((s, l) => s + polyLen(l), 0) < 25) continue;
        const main = Math.abs(c.h / (5 * iv) - Math.round(c.h / (5 * iv))) < 1e-6;
        levels.push({ h: c.h, main, lines: c.lines, sTrue: sample(c.lines), sTin: sample(tinLines), cov: 0, err: null, bad: 0, q: 0, told: false });
      }
      if (levels.length < P.levels[0] - (attempt > 40 ? 1 : 0) || levels.length > P.levels[1]) continue;
      return { hTrue, tinH, G, nx, ny, cx, cy, hmin, hmax, levels, pk, tris: TT, edges, sit, thal, thalS: thal ? resample(thal, 3) : null, roadTop };
    }
    throw new Error('участок не сгенерирован');
  }

  // ситуация (генерируется «дорогой вверху», затем зеркалится): дорога, участки с домами, деревья, столбы, люки, ручей
  function situation(R, MW, roadTop, ravine, thal, hTrue) {
    const my = y => roadTop ? y : MH - y, mr = (x, y, w, h) => ({ x, y: roadTop ? y : MH - y - h, w, h });
    const S = { trees: [], tufts: [], poles: [], manholes: [], plots: [], cars: [], labels: [], slopes: [], stream: null, spring: null, ggs: null, rects: [] };
    const ph = R() * 6.28, rk = ravine && R() < 0.6 ? 'dirt' : 'asphalt';
    const rpts = []; for (let x = -12; x <= MW + 12; x += 8) rpts.push({ x, y: my(11 + 2.2 * Math.sin(x * 0.018 + ph)) });
    S.road = { pts: rpts, width: rk === 'dirt' ? 12 : 16, kind: rk, lab: rk === 'dirt' ? 'гр' : 'а' };
    // участки с домами вдоль дороги
    const nPl = Math.max(1, Math.min(1 + Math.floor(R() * 3), Math.floor(MW * 0.55 / 58))), left = R() < 0.5;
    const plW = [], depth = ravine ? 33 + R() * 4 : 38 + R() * 6;
    for (let i = 0; i < nPl; i++) plW.push(Math.round(50 + R() * 12));
    const total = plW.reduce((s, w) => s + w + 4, 0);
    let x = left ? 3 : MW - 3 - total + 4;
    const fk = ['wood', 'metal', 'chain', 'wood', 'concrete'];
    for (let i = 0; i < nPl; i++) {
      const pw = plW[i], y0 = 24, y1 = y0 + depth, kind = fk[(R() * fk.length) | 0];
      const hw = Math.round(21 + R() * 8), hh = Math.round(16 + R() * 5), hx = x + 5 + R() * (pw - hw - 10), hy = y0 + 4 + R() * 3;
      const lab = ['ж', 'ж', 'н', 'кж1', 'ж', 'ж1'][(R() * 6) | 0];
      const shL = hx - x > pw / 2 - hw / 2 ? x + 4 : x + pw - 14;
      const gx = x + pw * (0.35 + R() * 0.3);
      const fence = [{ x: gx + 5, y: my(y0) }, { x: x + pw, y: my(y0) }, { x: x + pw, y: my(y1) }, { x, y: my(y1) }, { x, y: my(y0) }, { x: gx - 5, y: my(y0) }];
      const plot = { fence, kind, gate: { x: gx, y: my(y0) }, house: Object.assign(mr(hx, hy, hw, hh), { lab, roof: R() < 0.5 ? 'gable' : 'hip', color: ROOFS[(R() * ROOFS.length) | 0], seed: (R() * 1e9) | 0, solar: R() < 0.2 }),
        shed: Object.assign(mr(shL, y1 - 12, 10, 8), { seed: (R() * 1e9) | 0 }), apples: [] };
      const na = 1 + Math.floor(R() * 3);
      for (let a = 0; a < na; a++) plot.apples.push({ x: x + 8 + R() * (pw - 16), y: my(y1 - 6 - R() * Math.max(2, depth - hh - 22)), seed: (R() * 1e9) | 0 });
      S.plots.push(plot);
      S.rects.push(mr(x - 2, y0 - 2, pw + 4, depth + 4));
      x += pw + 4;
    }
    // столбы ЛЭП вдоль дороги, люки на дороге, машины (для фото)
    for (let px = 8 + R() * 20; px < MW - 4; px += 44 + R() * 8) S.poles.push({ x: px, y: my(21.5) });
    const nm = 1 + Math.floor(R() * 2);
    for (let i = 0; i < nm; i++) S.manholes.push({ x: 15 + R() * (MW - 30), y: my(11 + (R() - 0.5) * 4), kind: ['sewer', 'water', 'tele', 'storm'][(R() * 4) | 0] });
    for (let i = 0; i < 2; i++) if (R() < 0.7) S.cars.push({ x: 20 + R() * (MW - 40), y: my(11 + (i ? 3 : -3)), rot: i ? 0 : Math.PI, seed: (R() * 1e9) | 0 });
    // ручей: от родника до нижнего края, бровки оврага на крутом участке
    if (ravine && thal) {
      const L = polyLen(thal), s0 = L * (0.38 + R() * 0.16);
      const st = [];
      let acc = 0;
      for (let i = 0; i < thal.length; i++) { if (i) acc += Math.sqrt(d2(thal[i - 1], thal[i])); if (acc >= s0) st.push(thal[i]); }
      S.stream = st; S.spring = st[0];
      const q = resample(st, 3), n = q.length, a = Math.floor(n * 0.25), b = Math.floor(n * (0.6 + R() * 0.3));
      if (b - a > 4) {
        const seg = q.slice(a, b);
        for (const sgn of [-1, 1]) S.slopes.push({ top: offsetLine(seg, sgn * 9), bot: offsetLine(seg, sgn * 3.5) });
      }
      S.brook = BROOKS[(R() * BROOKS.length) | 0];
    }
    S.R = R; S.MW = MW;
    return S;
  }

  // пикеты: углы и края листа, характерные точки рельефа (вершины, седловины, тальвег), заполнение — неравномерно
  function pickets(R, MW, G, nx, ny, cx, cy, hTrue, S, thal) {
    const N = Math.max(28, Math.min(40, Math.round(MW * MH / 900)));
    const pk = [], boxes = [];
    const inRect = (x, y, m) => S.rects.some(r => x > r.x - m && x < r.x + r.w + m && y > r.y - m && y < r.y + r.h + m);
    const houseHit = (x, y, m) => S.plots.some(p => { const h = p.house; return x > h.x - m && x < h.x + h.w + m && y > h.y - m && y < h.y + h.h + m; });
    const labBox = (x, y) => x > MW - 18 ? { x0: x - 17, x1: x, y0: y - 3, y1: y + 3 } : { x0: x, x1: x + 17, y0: y - 3, y1: y + 3 };
    const boxHit = b => boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    const free = (x, y, dmin) => {
      if (houseHit(x, y, 3)) return false;
      for (const p of pk) if ((p.x - x) ** 2 + (p.y - y) ** 2 < dmin * dmin) return false;
      const b = labBox(x, y);
      if (boxHit(b)) return false;
      return !S.plots.some(p => { const h = p.house; return b.x0 < h.x + h.w && b.x1 > h.x && b.y0 < h.y + h.h && b.y1 > h.y; });
    };
    const add = (x, y, kind) => { pk.push({ x, y, h: Math.round(hTrue(x, y) * 100) / 100, kind }); boxes.push(labBox(x, y)); };
    const dmin = Math.sqrt(MW * MH / N) * 0.74;
    // углы и края
    add(1, 1, 'edge'); add(MW - 1, 1, 'edge'); add(1, MH - 1, 'edge'); add(MW - 1, MH - 1, 'edge');
    const edgeRun = (len, fn) => { const n = Math.max(1, Math.round(len / (58 + R() * 10))); for (let i = 1; i < n; i++) { const t = (i + (R() - 0.5) * 0.5) / n; const q = fn(t * len, 1 + R() * 2.5); if (free(q.x, q.y, dmin * 0.6)) add(q.x, q.y, 'edge'); } };
    edgeRun(MW, (s, e) => ({ x: s, y: e })); edgeRun(MW, (s, e) => ({ x: s, y: MH - e }));
    edgeRun(MH, (s, e) => ({ x: e, y: s })); edgeRun(MH, (s, e) => ({ x: MW - e, y: s }));
    // характерные точки: вершины, впадины, седловины по сетке
    const ch = [];
    for (let j = 3; j < ny - 3; j++) for (let i = 3; i < nx - 3; i++) {
      const v = G[j * nx + i], ring = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].map(([a, b]) => G[(j + b) * nx + i + a] - v);
      let hi = 0, lo = 0, ch2 = 0;
      for (let r = 0; r < 8; r++) { if (ring[r] > 0) hi++; else lo++; if ((ring[r] > 0) !== (ring[(r + 1) % 8] > 0)) ch2++; }
      if (hi === 0) ch.push({ x: i * cx, y: j * cy, k: 'top', v });
      else if (lo === 0) ch.push({ x: i * cx, y: j * cy, k: 'pit', v });
      else if (ch2 >= 4) ch.push({ x: i * cx, y: j * cy, k: 'saddle', v });
    }
    ch.sort((a, b) => (a.k === 'top' ? -a.v : a.k === 'pit' ? 0 : 1) - (b.k === 'top' ? -b.v : b.k === 'pit' ? 0 : 1));
    for (const c of ch) if (free(c.x, c.y, dmin * 0.55)) add(c.x, c.y, c.k);
    if (thal) for (let d = 18 + R() * 10, L = polyLen(thal); d < L - 8; d += 34 + R() * 10) { const q = along(thal, d); if (free(q.x, q.y, dmin * 0.55)) add(q.x, q.y, 'thal'); }
    // заполнение — разреженно и неравномерно (как реальная съёмка: где-то гуще)
    const p1 = R() * 6.28, p2 = R() * 6.28;
    let f = 1;
    for (let t = 0; t < 5000 && pk.length < N; t++) {
      if (t % 1200 === 1199) f *= 0.88;
      const x = 4 + R() * (MW - 8), y = 4 + R() * (MH - 8);
      const dens = 0.78 + 0.45 * (0.5 + 0.5 * Math.sin(x * 0.028 + p1) * Math.cos(y * 0.035 + p2));
      if (free(x, y, dmin * dens * f)) add(x, y, 'fill');
    }
    return pk;
  }

  // ---------- рисование ----------
  function lab(ctx, x, y, str, size, color, rot, align, halo) { // надпись на плане с ореолом под цвет бумаги
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot);
    ctx.font = 'italic 600 ' + size + 'px ' + PFONT; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    if (halo !== false) { ctx.lineWidth = size * 0.32; ctx.strokeStyle = 'rgba(245,240,226,.92)'; ctx.lineJoin = 'round'; ctx.strokeText(str, 0, 0); }
    ctx.fillStyle = color || INK; ctx.fillText(str, 0, 0);
    ctx.restore();
  }
  function drawSituation(ctx, g, MW) { // ситуация условными знаками (Sym.plan)
    const S = g.sit;
    Sym.plan.road(ctx, S.road.pts, S.road.width, S.road.lab);
    for (const p of S.poles) Sym.plan.pole(ctx, p.x, p.y, 'power', 0);
    if (S.poles.length > 1) { ctx.beginPath(); ctx.moveTo(S.poles[0].x, S.poles[0].y); for (const p of S.poles) ctx.lineTo(p.x, p.y); ctx.strokeStyle = 'rgba(31,29,26,.55)'; ctx.lineWidth = 0.22; ctx.stroke(); }
    for (const m of S.manholes) Sym.plan.manhole(ctx, m.x, m.y, m.kind);
    for (const p of S.plots) {
      Sym.plan.fence(ctx, p.fence, p.kind);
      const h = p.house;
      Sym.plan.house(ctx, [[h.x, h.y], [h.x + h.w, h.y], [h.x + h.w, h.y + h.h], [h.x, h.y + h.h]], h.lab);
      const s = p.shed;
      Sym.plan.house(ctx, [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]], 'н');
      for (const a of p.apples) Sym.plan.tree(ctx, a.x, a.y, 'apple');
    }
    for (const s of S.slopes) Sym.plan.slope(ctx, s.top, s.bot); // бровки — под ручьём и его подписью
    if (S.stream) {
      Sym.plan.water(ctx, S.stream, 3);
      const sp = S.spring;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 1.3, 0, 7); ctx.fillStyle = '#d3e6f4'; ctx.fill(); ctx.strokeStyle = BLUE; ctx.lineWidth = 0.35; ctx.stroke();
      lab(ctx, sp.x, sp.y - 3.6, 'родн.', 3, BLUE);
      const q = resample(S.stream, 2), m = along(q, polyLen(q) * 0.62);
      lab(ctx, m.x, m.y + 4.2, S.brook, 3.4, BLUE, upright(m.a));
      const e = along(q, polyLen(q) * 0.85); // стрелка течения
      ctx.save(); ctx.translate(e.x, e.y - 3.5); ctx.rotate(e.a); ctx.strokeStyle = BLUE; ctx.lineWidth = 0.35;
      ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(3, 0); ctx.moveTo(1.6, -1); ctx.lineTo(3, 0); ctx.lineTo(1.6, 1); ctx.stroke(); ctx.restore();
    }
    for (const t of S.trees) Sym.plan.tree(ctx, t.x, t.y, t.kind);
    ctx.strokeStyle = GREEN; ctx.lineWidth = 0.25; ctx.beginPath();
    for (const t of S.tufts) { ctx.moveTo(t.x - 0.6, t.y); ctx.lineTo(t.x - 0.6, t.y - 1.4); ctx.moveTo(t.x + 0.6, t.y); ctx.lineTo(t.x + 0.6, t.y - 1.4); }
    ctx.stroke();
    if (S.ggs) { // пункт ГГС на вершине
      const p = S.ggs;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 3.4); ctx.lineTo(p.x + 3, p.y + 1.8); ctx.lineTo(p.x - 3, p.y + 1.8); ctx.closePath();
      ctx.fillStyle = 'rgba(245,240,226,.9)'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.45; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.5, 0, 7); ctx.fillStyle = INK; ctx.fill();
      lab(ctx, p.x, p.y - 6, 'пир. ' + p.name, 3.4, INK);
    }
  }
  // деревья и «луговая растительность» — после пикетов, чтобы не лезть на отметки
  function decorate(g, MW) {
    const S = g.sit, R = S.R;
    const blocked = (x, y, m) => {
      if (x < 3 || x > MW - 3 || y < 3 || y > MH - 3) return true;
      if (g.roadTop ? y < 24 : y > MH - 24) return true;
      if (S.rects.some(r => x > r.x - m && x < r.x + r.w + m && y > r.y - m && y < r.y + r.h + m)) return true;
      for (const p of g.pk) { const lx = p.x > MW - 18 ? p.x - 9 : p.x + 9; if (Math.abs(x - lx) < 10 + m && Math.abs(y - p.y) < 3.5 + m) return true; if ((x - p.x) ** 2 + (y - p.y) ** 2 < (4 + m) ** 2) return true; }
      if (g.thal && distToPoly(x, y, g.thal) < 4 + m) return true;
      if (S.ggs && (x - S.ggs.x) ** 2 + (y - S.ggs.y) ** 2 < 100) return true;
      return S.trees.some(t => (t.x - x) ** 2 + (t.y - y) ** 2 < (5 + m) ** 2);
    };
    const nc = 2 + Math.floor(R() * 3), kinds = g.thal ? ['birch', 'deciduous', 'conifer', 'birch'] : ['deciduous', 'conifer', 'birch'];
    for (let c = 0; c < nc || (S.trees.length < 5 && c < nc + 6); c++) {
      const kind = kinds[(R() * kinds.length) | 0], x0 = R() * MW, y0 = R() * MH, n = 3 + Math.floor(R() * 5);
      for (let i = 0, t = 0; i < n && t < 40; t++) {
        const x = x0 + (R() - 0.5) * 34, y = y0 + (R() - 0.5) * 26;
        if (!blocked(x, y, 0.5)) { S.trees.push({ x, y, kind, r: 7 + R() * 4, seed: (R() * 1e9) | 0 }); i++; }
      }
    }
    for (let t = 0, n = 0; t < 400 && n < 34; t++) { const x = R() * MW, y = R() * MH; if (!blocked(x, y, -1)) { S.tufts.push({ x, y }); n++; } }
  }

  function drawPencil(ctx, x, y) { // карандаш в руке: остриё — в точке касания
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.85);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.moveTo(2, 3); ctx.lineTo(14, 6); ctx.lineTo(70, 9); ctx.lineTo(70, 1); ctx.lineTo(14, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8c79a'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, -4); ctx.lineTo(12, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a3532'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(4, -1.4); ctx.lineTo(4, 1.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e9b52c'; ctx.fillRect(12, -4, 50, 8);
    ctx.fillStyle = '#f6d25e'; ctx.fillRect(12, -4, 50, 2.6);
    ctx.fillStyle = '#c08f18'; ctx.fillRect(12, 1.6, 50, 2.4);
    ctx.fillStyle = '#b9b9b9'; ctx.fillRect(62, -4, 6, 8);
    ctx.fillStyle = '#e57b8c'; ctx.fillRect(68, -4, 6, 8);
    ctx.restore();
  }

  registerMode({
    index: 5,
    id: 'contours',
    title: 'Горизонтали',
    subtitle: 'Камеральная обработка: рисовка рельефа по пикетам',
    howto: [
      'Высоту горизонтали выберите ▼▲, линию ведите пальцем.',
      'Пикет коричневый — выше, синий — ниже: линия между ними.',
      '«Интерп.»: два соседних пикета — засечки на ребре.',
      'Зелёная линия — в допуске, красная — «Отменить».',
    ],
    variants: [
      { id: 'hill', title: 'Холм', subtitle: 'Холм с отрогом или два холма с седловиной · сечение 1 м',
        howto: ['Сечение 1 м, каждая 5-я утолщена. Готово — «СДАТЬ».'],
        params: { ravine: false, iv: 1, levels: [4, 7] } },
      { id: 'ravine', title: 'Овраг и речка', subtitle: 'Долина с ручьём · сечение 0,5 м · провести тальвег',
        howto: ['«Тальвег» — линия дна через вершины «V». Затем «СДАТЬ».'],
        params: { ravine: true, iv: 0.5, levels: [8, 11] } },
    ],
    create(api, variant, seed) {
      if (Sym.prepare) Sym.prepare(['paper']);
      const ravine = !!variant.params.ravine, iv = variant.params.iv;
      const avW0 = api.W - PANEL_W - 14, s0 = (360 - 40) / (MH + 2 * PAD);
      const MW = Math.round(Math.max(170, Math.min(330, avW0 / s0 - 2 * PAD)));
      const g = generate(api, variant, seed, MW);
      const S = g.sit, levels = g.levels, pk = g.pk, NL = levels.length;
      // пункт ГГС на высшей вершине
      if (!ravine) { const top = pk.filter(p => p.kind === 'top' && !S.rects.some(r => p.x > r.x - 8 && p.x < r.x + r.w + 8 && p.y > r.y - 10 && p.y < r.y + r.h + 8)).sort((a, b) => b.h - a.h)[0]; if (top) S.ggs = { x: top.x, y: top.y, name: NAMES[(S.R() * NAMES.length) | 0] }; }
      decorate(g, MW);
      const fmt = h => iv < 1 ? h.toFixed(1) : String(Math.round(h));
      const ivTxt = iv < 1 ? '0,5 м' : '1 м';

      let time = LIMIT, done = false, sel = 0, tool = 'line', photo = false;
      let strokes = [], cur = null, curMoveAt = 0, activePtr = null, pen = null, interpA = -1, segs = [], confirmAt = -9, hintT = 7, lastBeep = 99;
      let bg = null, ph = null, B = null;
      const thalSt = { cov: 0, err: null, bad: 0, q: 0, told: false };

      // ---------- раскладка ----------
      const view = () => {
        const W = api.W, ax0 = 6, ax1 = W - PANEL_W - 6, ay0 = 34, ay1 = 356;
        const s = Math.min((ax1 - ax0) / (MW + 2 * PAD), (ay1 - ay0) / (MH + 2 * PAD));
        const pw = (MW + 2 * PAD) * s, phh = (MH + 2 * PAD) * s, px = ax0 + (ax1 - ax0 - pw) / 2, py = ay0 + (ay1 - ay0 - phh) / 2;
        return { s, ox: px + PAD * s, oy: py + PAD * s, px, py, pw, ph: phh };
      };
      const ui = () => {
        const x = api.W - PANEL_W + 2, w = PANEL_W - 8, hw = (w - 4) / 2;
        return {
          lvl: { x, y: 36, w, h: 46 },
          down: { x, y: 86, w: hw, h: 44 }, up: { x: x + hw + 4, y: 86, w: hw, h: 44 },
          line: { x, y: 134, w: hw, h: 44 }, interp: { x: x + hw + 4, y: 134, w: hw, h: 44 },
          thal: ravine ? { x, y: 182, w: hw, h: 44 } : null,
          photo: ravine ? { x: x + hw + 4, y: 182, w: hw, h: 44 } : { x, y: 182, w, h: 44 },
          undo: { x, y: 230, w, h: 44 },
          submit: { x, y: 306, w, h: 48 },
        };
      };
      const toW = p => { const v = view(); return { x: (p.x - v.ox) / v.s, y: (p.y - v.oy) / v.s }; };
      const toS = q => { const v = view(); return { x: v.ox + q.x * v.s, y: v.oy + q.y * v.s }; };

      // всплывающие надписи — свои, на тёмной плашке: голый цветной текст ядра плохо читается на светлом листе
      let toasts = [];
      const MC = document.createElement('canvas').getContext('2d');
      const pop = (x, y, t, c) => {
        MC.font = '700 12px system-ui, sans-serif';
        const hw = MC.measureText(t).width / 2 + 9;
        x = Math.max(hw + 4, Math.min(api.W - PANEL_W - hw - 2, x)); y = y < 50 ? y + 34 : Math.min(y, 340);
        for (const o of toasts) if (Math.abs(o.y - y) < 17 && Math.abs(o.x - x) < o.hw + hw) y = o.y - 18; // не наслаивать
        toasts.push({ x, y, t, c, hw, life: 1.7 });
      };
      function drawToasts(ctx) {
        ctx.font = '700 12px system-ui, sans-serif';
        for (const o of toasts) {
          const w = ctx.measureText(o.t).width + 16;
          ctx.globalAlpha = Math.min(1, o.life / 0.4);
          ctx.fillStyle = 'rgba(20,14,10,.84)'; api.roundRect(ctx, o.x - w / 2, o.y - 13, w, 19, 7); ctx.fill();
          api.text(ctx, o.t, o.x, o.y + 1, 12, o.c, 'center', '700');
        }
        ctx.globalAlpha = 1;
      }
      let chained = false;               // выбранный пикет — конец предыдущего ребра (цепочка)

      // ---------- оценка ----------
      const errAt = (x, y, L) => { const a = Math.abs(g.hTrue(x, y) - L), t = g.tinH(x, y); return t == null ? a : Math.min(a, Math.abs(t - L)); };
      const covFrac = (samples, pts, tol) => {
        if (!samples.length) return 0;
        const t2 = tol * tol; let n = 0;
        for (const s of samples) for (const p of pts) if ((p.x - s.x) * (p.x - s.x) + (p.y - s.y) * (p.y - s.y) < t2) { n++; break; }
        return n / samples.length;
      };
      const accF = e => e == null ? 0 : Math.max(0, Math.min(1, 1 - Math.max(0, e / iv - 0.1) / 0.5));
      function updateLevel(li) {
        const lv = levels[li], pts = [];
        let es = 0, ls = 0, bad = 0;
        for (const st of strokes) if (st.kind === 'c' && st.li === li) { es += st.err * st.len; ls += st.len; if (st.ok) for (const q of st.pts) pts.push(q); else bad++; }
        lv.err = ls ? es / ls : null; lv.bad = bad;
        lv.cov = pts.length ? Math.max(covFrac(lv.sTrue, pts, TOL_COV), covFrac(lv.sTin, pts, TOL_COV)) : 0;
        lv.q = Math.pow(lv.cov, 1.5) * accF(lv.err); // недоведённые линии штрафуются сильнее
      }
      function updateThal() {
        const pts = []; let es = 0, ls = 0, bad = 0;
        for (const st of strokes) if (st.kind === 't') { es += st.err * st.len; ls += st.len; if (st.ok) for (const q of st.pts) pts.push(q); else bad++; }
        thalSt.err = ls ? es / ls : null; thalSt.bad = bad;
        thalSt.cov = pts.length ? covFrac(g.thalS, pts, TOL_THAL_COV) : 0;
        thalSt.q = Math.pow(thalSt.cov, 1.5) * (thalSt.err == null ? 0 : Math.max(0, Math.min(1, 1 - Math.max(0, thalSt.err - 2) / 8)));
      }
      const quality = () => { // общая полнота×точность 0..1
        let s = 0, w = 0;
        for (const lv of levels) { s += lv.q; w++; }
        if (ravine) { s += thalSt.q * 2; w += 2; }
        const bad = strokes.filter(st => !st.ok).length;
        return Math.max(0, s / w - Math.min(0.3, bad * 0.03));
      };
      const doneCount = () => levels.filter(l => l.cov >= DONE_COV).length;
      const coverage = () => (levels.reduce((s, l) => s + l.cov, 0) + (ravine ? thalSt.cov * 2 : 0)) / (NL + (ravine ? 2 : 0));

      // ---------- действия игрока ----------
      function setLevel(i) { const n = Math.max(0, Math.min(NL - 1, i)); if (n !== sel) { sel = n; api.sfx('select'); } }
      function setTool(t) { if (tool !== t) { tool = t; interpA = -1; hintT = 6; api.sfx('tap'); } }
      function nextOpen() {
        for (let k = 1; k <= NL; k++) { const i = (sel + k) % NL; if (levels[i].cov < DONE_COV) return i; }
        return -1;
      }
      function finishStroke() {
        const st = cur; cur = null; pen = null;
        const raw = st.pts;
        if (raw.length < 2 || polyLen(raw) < 8) { const sp = toS(raw[0]); pop(sp.x, sp.y - 10, 'Слишком короткая линия', api.theme.dim); return; }
        let pts = resample(chaikin(resample(raw, 2), 1), 2); // лёгкое сглаживание: малые петли у вершин не «сжимаются»
        if (pts.length > 8 && d2(pts[0], pts[pts.length - 1]) < 49 && polyLen(pts) > 30) pts.push({ x: pts[0].x, y: pts[0].y }); // замкнуть
        st.pts = pts; st.len = polyLen(pts);
        const mid = toS(pts[Math.floor(pts.length / 2)]);
        if (st.kind === 'c') {
          const lv = levels[st.li];
          let es = 0, hs = 0;
          for (const q of pts) { es += errAt(q.x, q.y, lv.h); hs += g.hTrue(q.x, q.y) - lv.h; }
          st.err = es / pts.length; st.ok = st.err <= TOL_H * iv;
          strokes.push(st);
          const was = lv.cov;
          updateLevel(st.li);
          if (st.ok) {
            api.sfx('good'); api.burst(mid.x, mid.y, '#7be08f', 8);
            pop(mid.x, mid.y - 12, `${fmt(lv.h)} м: ±${st.err.toFixed(2)} м · ${Math.round(lv.cov * 100)} %`, api.theme.good);
            if (lv.cov >= DONE_COV && was < DONE_COV && !lv.told) {
              lv.told = true;
              setTimeout0(() => {
                api.sfx('point'); pop(mid.x, mid.y - 38, `Горизонталь ${fmt(lv.h)} готова!`, '#ffd76a');
                const n = nextOpen();
                if (n >= 0) { sel = n; } else if (!ravine || thalSt.cov >= DONE_COV) pop(api.W / 2 - PANEL_W / 2, 200, 'Все линии проведены — можно сдавать!', '#ffd76a');
                else { pop(api.W / 2 - PANEL_W / 2, 200, 'Горизонтали готовы — проведите тальвег', '#ffd76a'); }
              });
            }
          } else {
            api.sfx('bad'); api.shake(2);
            pop(mid.x, mid.y - 12, `Мимо уровня: ±${st.err.toFixed(2)} м`, api.theme.bad);
            pop(mid.x, mid.y + 8, hs / pts.length > 0 ? 'линия выше уровня — ниже по склону' : 'линия ниже уровня — выше по склону', '#ffb0a0');
          }
        } else {
          let es = 0;
          for (const q of pts) es += distToPoly(q.x, q.y, g.thal);
          st.err = es / pts.length; st.ok = st.err <= TOL_THAL;
          strokes.push(st);
          const was = thalSt.cov;
          updateThal();
          if (st.ok) {
            api.sfx('good'); api.burst(mid.x, mid.y, '#8fc8ff', 8);
            pop(mid.x, mid.y - 12, `Тальвег: ±${(st.err * 0.25).toFixed(1)} м · ${Math.round(thalSt.cov * 100)} %`, api.theme.good);
            if (thalSt.cov >= DONE_COV && was < DONE_COV) { api.sfx('point'); pop(mid.x, mid.y - 38, 'Тальвег проведён!', '#ffd76a'); }
          } else { api.sfx('bad'); api.shake(2); pop(mid.x, mid.y - 12, 'Это не дно долины — ищите вершины «V»', api.theme.bad); }
        }
      }
      let deferred = [];
      function setTimeout0(fn) { deferred.push(fn); } // отложить на кадр (порядок всплывающих надписей)
      function undo() {
        const st = strokes.pop();
        if (!st) { pop(ui().undo.x + 50, ui().undo.y - 6, 'Нечего отменять', api.theme.dim); api.sfx('warn'); return; }
        if (st.kind === 'c') { updateLevel(st.li); if (levels[st.li].cov < DONE_COV) levels[st.li].told = false; } else updateThal();
        api.sfx('drop');
        const m = toS(st.pts[Math.floor(st.pts.length / 2)]); pop(m.x, m.y, 'стёрто', api.theme.dim);
      }
      function interpTap(w) {
        const v = view();
        let bi = -1, bd = (18 / v.s) ** 2;
        pk.forEach((p, i) => { const dd = (p.x - w.x) ** 2 + (p.y - w.y) ** 2; if (dd < bd) { bd = dd; bi = i; } });
        if (bi < 0) { const s = toS(w); pop(s.x, s.y - 10, 'Тапните по пикету', api.theme.dim); return; }
        if (interpA < 0 || interpA === bi) { interpA = interpA === bi ? -1 : bi; chained = false; api.sfx('select'); return; }
        const a = Math.min(interpA, bi), b = Math.max(interpA, bi), sp = toS(pk[bi]);
        if (!g.edges.has(a * 4096 + b)) {
          if (!chained) { api.sfx('bad'); pop(sp.x, sp.y - 12, 'Не соседние — берите пикеты по ребру треугольника', api.theme.bad); }
          else api.sfx('select');
          interpA = bi; chained = false; return;
        }
        if (segs.some(sg => sg.a === a && sg.b === b)) { api.sfx('tap'); interpA = bi; chained = true; return; }
        const A = pk[a], Bp = pk[b], ticks = [];
        const lo = Math.min(A.h, Bp.h), hi = Math.max(A.h, Bp.h);
        for (let L = Math.ceil((lo + 1e-6) / iv) * iv; L < hi; L = Math.round((L + iv) * 100) / 100) {
          const t = (L - A.h) / (Bp.h - A.h);
          ticks.push({ x: A.x + (Bp.x - A.x) * t, y: A.y + (Bp.y - A.y) * t, L: Math.round(L * 100) / 100 });
        }
        segs.push({ a, b, ticks }); if (segs.length > 40) segs.shift();
        api.sfx('measure');
        pop(sp.x, sp.y - 12, ticks.length ? `${ticks.length} засеч. на ребре` : 'Между ними нет уровня', ticks.length ? api.theme.accent : api.theme.dim);
        interpA = bi; chained = true; // цепочкой — от последнего пикета
      }
      function submit() {
        if (done) return;
        if (coverage() < 0.8 && api.levelTime - confirmAt > 3) { confirmAt = api.levelTime; api.sfx('warn'); const u = ui().submit; pop(u.x + u.w / 2 - 40, u.y - 8, 'Не всё проведено — тап ещё раз', api.theme.accent); return; }
        finishLevel();
      }
      function finishLevel() {
        if (done) return;
        done = true; cur = null; pen = null; toasts = [];
        const Q = quality(), tf = Math.max(0, time) / LIMIT;
        const base = 850 * Q, bonus = 150 * Q * tf, score = Math.round(Math.min(1000, base + bonus));
        const stars = score >= 780 ? 3 : score >= 620 ? 2 : score >= 320 ? 1 : 0;
        let es = 0, ls = 0;
        for (const st of strokes) if (st.kind === 'c') { es += st.err * st.len; ls += st.len; }
        const used = LIMIT - Math.max(0, time), mm = Math.floor(used / 60), ss = String(Math.floor(used % 60)).padStart(2, '0');
        const cov = levels.reduce((s, l) => s + l.cov, 0) / NL;
        const lines = [
          `Горизонтали: ${doneCount()} из ${NL} · полнота ${Math.round(cov * 100)} %`,
          ls ? `Точность: ±${(es / ls).toFixed(2)} м при сечении ${ivTxt}` : 'Горизонтали не проведены',
        ];
        if (ravine) lines.push(`Тальвег: ${Math.round(thalSt.cov * 100)} %` + (thalSt.err != null ? ` · ±${(thalSt.err * 0.25).toFixed(1)} м` : ''));
        lines.push(`Время: ${mm}:${ss} · бонус +${Math.round(bonus)}` + (strokes.some(s => !s.ok) ? ` · брак: ${strokes.filter(s => !s.ok).length}` : ''));
        const snap = strokes.slice();
        let pic = null; // картинка итога рисуется один раз в разрешении экрана
        api.finish({ score, stars, lines, drawResult(ctx, x, y, w, h) {
          const m = ctx.getTransform(), k = m.a, key = [x, y, w, h, k].join();
          if (!pic || pic.key !== key) {
            const cv = document.createElement('canvas'); cv.width = Math.ceil(w * k) + 2; cv.height = Math.ceil(h * k) + 2;
            const c = cv.getContext('2d'); c.scale(k, k); c.translate(-x, -y);
            drawResult(c, x, y, w, h, snap);
            pic = { key, cv };
          }
          ctx.save(); ctx.setTransform(1, 0, 0, 1, Math.round(m.e + x * k), Math.round(m.f + y * k)); ctx.drawImage(pic.cv, 0, 0); ctx.restore();
        } });
      }

      // ---------- фон: стол и лист (в слой) ----------
      // свой слой в точном разрешении экрана: вывод — копирование пиксель в пиксель, без пересэмплирования
      function pxLayer(k, draw) {
        const cv = document.createElement('canvas'), W = api.W;
        cv.width = Math.max(1, Math.round(W * k)); cv.height = Math.max(1, Math.round(360 * k));
        const c = cv.getContext('2d', { alpha: false }); c.scale(k, k); draw(c);
        return { canvas: cv, k, W };
      }
      function blit(ctx, L) { const m = ctx.getTransform(); ctx.save(); ctx.setTransform(1, 0, 0, 1, Math.round(m.e), Math.round(m.f)); ctx.drawImage(L.canvas, 0, 0); ctx.restore(); }
      function makeBg(k) {
        const W = api.W, v = view();
        return pxLayer(k, c => {
          const gr = c.createLinearGradient(0, 0, W, 360); gr.addColorStop(0, '#6e4a2c'); gr.addColorStop(1, '#4f3320');
          c.fillStyle = gr; c.fillRect(0, 0, W, 360);
          const R = Sym.rng(seed ^ 0x5151); // волокна столешницы
          c.lineWidth = 1;
          for (let i = 0; i < 70; i++) {
            const y = R() * 360, a = R() * 6;
            c.strokeStyle = `rgba(${R() < 0.5 ? '30,16,6' : '150,105,60'},${0.12 + R() * 0.15})`;
            c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= W; x += 20) c.lineTo(x, y + Math.sin(x * 0.01 + a) * 4 + Math.sin(x * 0.043 + a) * 1.5); c.stroke();
          }
          c.save(); c.translate(v.ox, v.oy); c.scale(v.s, v.s);
          Sym.plan.paper(c, -PAD, -PAD, MW + 2 * PAD, MH + 2 * PAD, { stamp: false, margin: 5, grid: 50, gridX: 0, gridY: 0 });
          lab(c, MW / 2, -PAD + 2.6, `Топографический план М 1:500 · сечение рельефа ${ivTxt} · система высот Балтийская`, 3.1, INK, 0, 'center', false);
          c.save(); c.beginPath(); c.rect(0, 0, MW, MH); c.clip();
          drawSituation(c, g, MW);
          c.restore();
          for (const p of pk) { const left = p.x > MW - 18; lab(c, p.x + (left ? -1.8 : 1.8), p.y - 0.3, p.h.toFixed(2), 4.3, INK, 0, left ? 'right' : 'left'); }
          c.restore();
        });
      }
      function makePhoto(k) { // ортофотоплан участка (Sym, вид сверху) с отмывкой рельефа
        const v = view();
        return pxLayer(k, c => {
          c.drawImage(bg.canvas, 0, 0, api.W, 360);
          c.save(); c.translate(v.ox, v.oy); c.scale(v.s, v.s);
          c.beginPath(); c.rect(0, 0, MW, MH); c.clip();
          Sym.ground(c, 0, 0, MW, MH, 'meadow', seed & 0xffff);
          for (const p of S.plots) Sym.ground(c, p.fence[3].x, Math.min(p.fence[1].y, p.fence[2].y), p.fence[1].x - p.fence[3].x, Math.abs(p.fence[2].y - p.fence[1].y), 'lawn', 7);
          Sym.hillshade(c, 0, 0, MW, MH, g.hTrue, { cell: 3, alpha: 0.85, z: 0.9 });
          Sym.road(c, S.road.pts, S.road.width, S.road.kind);
          if (S.stream) Sym.stream(c, S.stream, 5, seed & 0xfff);
          for (const p of S.plots) {
            Sym.fence(c, p.fence, p.kind);
            const h = p.house; Sym.house(c, h.x, h.y, h.w, h.h, { roof: h.roof, color: h.color, seed: h.seed, solar: h.solar });
            Sym.shed(c, p.shed.x, p.shed.y, p.shed.w, p.shed.h, { seed: p.shed.seed, material: 'metal' });
            for (const a of p.apples) Sym.tree(c, a.x, a.y, 6, 'apple', a.seed);
          }
          for (const m of S.manholes) Sym.manhole(c, m.x, m.y, m.kind);
          for (const car of S.cars) Sym.car(c, car.x, car.y, car.rot, null, car.seed);
          for (const t of S.tufts) if (t.x % 3 < 1) Sym.bush(c, t.x, t.y, 2.5, (t.x * 100) | 0);
          for (const t of S.trees) Sym.tree(c, t.x, t.y, t.r, t.kind, t.seed);
          for (let i = 0; i < S.poles.length; i++) { const p = S.poles[i]; Sym.pole(c, p.x, p.y, 'power', 0); if (i) Sym.wires(c, S.poles[i - 1].x, S.poles[i - 1].y, p.x, p.y); }
          c.restore();
          c.font = 'bold 10px system-ui, sans-serif'; const tw = c.measureText('Ортофотоплан + отмывка рельефа').width + 14;
          c.fillStyle = 'rgba(20,14,10,.78)'; api.roundRect(c, v.ox + v.s * MW / 2 - tw / 2, v.oy + v.s * MH - 22, tw, 18, 6); c.fill();
          api.text(c, 'Ортофотоплан + отмывка рельефа', v.ox + v.s * MW / 2, v.oy + v.s * MH - 9, 10, '#ffd76a');
        });
      }

      // ---------- рисование линий игрока ----------
      function strokePath(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); }
      function drawStroke(ctx, st, k, halo) { // k — масштаб (для толщины в пикселях)
        if (st.pts.length < 2) return;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        if (halo) { strokePath(ctx, st.pts); ctx.strokeStyle = st.ok ? 'rgba(70,200,100,.33)' : 'rgba(235,60,45,.42)'; ctx.lineWidth = 3.4; ctx.stroke(); }
        strokePath(ctx, st.pts);
        if (st.kind === 't') { ctx.setLineDash([3.2, 1.2, 0.8, 1.2]); ctx.strokeStyle = BLUE; ctx.lineWidth = 1.5 / k; ctx.stroke(); ctx.setLineDash([]); return; }
        const lv = levels[st.li];
        ctx.strokeStyle = lv.main ? BROWN_D : BROWN; ctx.lineWidth = (lv.main ? 2.4 : 1.5) / k; ctx.stroke();
        if (lv.main && st.len > 30) {
          const m = along(st.pts, st.len * 0.5), t = fmt(lv.h);
          ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(upright(m.a));
          ctx.font = 'italic 600 4px ' + PFONT; const tw = ctx.measureText(t).width;
          ctx.fillStyle = 'rgba(245,240,226,.95)'; ctx.fillRect(-tw / 2 - 0.8, -2.3, tw + 1.6, 4.6);
          ctx.restore();
          Sym.plan.label(ctx, m.x, m.y, t, 4, BROWN_D, upright(m.a));
        }
      }
      function drawResult(ctx, x, y, w, h, snap) {
        const pw = MW + 2 * PAD, phh = MH + PAD + 32, k = Math.min(w / pw, (h - 64) / phh);
        const px = x + (w - pw * k) / 2;
        ctx.save(); ctx.translate(px + PAD * k, y + PAD * k); ctx.scale(k, k);
        Sym.plan.paper(ctx, -PAD, -PAD, pw, phh, { title: 'Горизонтали · ' + variant.title, scale: '500', section: 'Сечение рельефа ' + ivTxt, author: 'Камеральная обработка', grid: 50, gridX: 0, gridY: 0, margin: 5 });
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, MW, MH); ctx.clip();
        drawSituation(ctx, g, MW);
        ctx.globalAlpha = 0.4;
        for (const lv of levels) for (const l of lv.lines) Sym.plan.contour(ctx, l, lv.h, lv.main);
        if (g.thal) { strokePath(ctx, g.thal); ctx.setLineDash([2, 1.5]); ctx.strokeStyle = BLUE; ctx.lineWidth = 0.4; ctx.stroke(); ctx.setLineDash([]); }
        ctx.globalAlpha = 1;
        for (const st of snap) { if (!st.ok) { strokePath(ctx, st.pts); ctx.strokeStyle = 'rgba(220,50,40,.7)'; ctx.lineWidth = 1.2 / k; ctx.stroke(); } else drawStroke(ctx, st, k, false); }
        for (const p of pk) Sym.plan.spot(ctx, p.x, p.y, p.h);
        ctx.restore(); ctx.restore();
        // ведомость по уровням
        let ty = y + phh * k + 12;
        const cw = Math.max(52, Math.min(64, w / Math.min(NL + (ravine ? 1 : 0), 6))), per = Math.max(1, Math.floor(w / cw));
        const rows = Math.ceil((NL + (ravine ? 1 : 0)) / per);
        ctx.fillStyle = 'rgba(20,14,10,.8)'; api.roundRect(ctx, x, ty - 12, w, 22 + rows * 14, 8); ctx.fill(); // плашка под ведомость
        api.text(ctx, 'бледные — эталон, коричневые — ваши', x + w / 2, ty, 10, api.theme.dim, 'center', '600');
        ty += 15;
        const items = levels.map(l => ({ t: fmt(l.h), q: l.q }));
        if (ravine) items.push({ t: 'тальв.', q: thalSt.q });
        items.forEach((it, i) => {
          const r = Math.floor(i / per), cI = i % per, n = Math.min(per, items.length - r * per);
          const cx2 = x + w / 2 + (cI - (n - 1) / 2) * cw;
          const mk = it.q >= 0.8 ? '✓' : it.q >= 0.4 ? '~' : '✗', col = it.q >= 0.8 ? api.theme.good : it.q >= 0.4 ? api.theme.accent : api.theme.bad;
          api.text(ctx, it.t + ' ' + mk, cx2, ty + r * 14, 9.5, col, 'center', '700');
        });
      }

      function drawPanel(ctx) {
        const u = ui(), lv = levels[sel], T = api.theme;
        // уровень
        const b = u.lvl;
        ctx.fillStyle = 'rgba(28,20,14,.85)'; api.roundRect(ctx, b.x, b.y, b.w, b.h, 9); ctx.fill();
        ctx.strokeStyle = tool === 'line' ? (lv.main ? '#e0a060' : T.accent) : 'rgba(255,255,255,.2)'; ctx.lineWidth = 2; ctx.stroke();
        api.text(ctx, tool === 'thal' ? 'тальвег' : lv.main ? 'утолщённая' : 'горизонталь', b.x + b.w / 2, b.y + 11, 9, T.dim, 'center', '600');
        api.text(ctx, tool === 'thal' ? `${Math.round(thalSt.cov * 100)} %` : fmt(lv.h) + ' м', b.x + b.w / 2, b.y + 30, 18, tool === 'thal' ? '#8fc8ff' : lv.cov >= DONE_COV ? T.good : T.accent);
        const dw = Math.min(9, (b.w - 8) / NL);
        for (let i = 0; i < NL; i++) {
          const dx = b.x + b.w / 2 + (i - (NL - 1) / 2) * dw, l = levels[i];
          ctx.beginPath(); ctx.arc(dx, b.y + 40, i === sel ? 3.2 : 2.4, 0, 7);
          ctx.fillStyle = l.cov >= DONE_COV ? T.good : l.cov > 0.05 ? T.accent : 'rgba(255,255,255,.25)'; ctx.fill();
          if (i === sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
        }
        api.button(ctx, u.down, '▼', { disabled: sel === 0, size: 18 });
        api.button(ctx, u.up, '▲', { disabled: sel === NL - 1, size: 18 });
        api.button(ctx, u.line, 'Линия', { active: tool === 'line', size: 12 });
        api.button(ctx, u.interp, 'Интерп.', { active: tool === 'interp', size: 10.5 });
        if (u.thal) api.button(ctx, u.thal, 'Тальвег', { active: tool === 'thal', size: 10, color: '#7cb8ff' });
        api.button(ctx, u.photo, 'Фото', { active: photo, size: 12, color: '#9ad27a' });
        api.button(ctx, u.undo, '↶ Отменить', { disabled: !strokes.length, size: 12 });
        // легенда цвета пикетов
        const ly = 287;
        ctx.fillStyle = UP_C; ctx.beginPath(); ctx.arc(u.undo.x + 8, ly - 3, 3.5, 0, 7); ctx.fill();
        api.text(ctx, 'выше', u.undo.x + 14, ly + 1, 10, T.ink, 'left', '600');
        ctx.fillStyle = DN_C; ctx.beginPath(); ctx.arc(u.undo.x + 58, ly - 3, 3.5, 0, 7); ctx.fill();
        api.text(ctx, 'ниже', u.undo.x + 64, ly + 1, 10, T.ink, 'left', '600');
        const conf = api.levelTime - confirmAt < 3;
        api.button(ctx, u.submit, conf ? 'ТОЧНО?' : 'СДАТЬ', { active: conf || coverage() >= 0.8, color: T.good, size: 15 });
      }

      const inst = {
        update(dt) {
          if (done) return;
          for (const f of deferred.splice(0)) f();
          time -= dt; hintT -= dt;
          for (const o of toasts) { o.life -= dt; o.y -= 16 * dt; }
          if (toasts.length) toasts = toasts.filter(o => o.life > 0);
          if (time <= 10 && Math.ceil(time) < lastBeep) { lastBeep = Math.ceil(time); if (lastBeep > 0) api.sfx('beep'); }
          if (time <= 0) { if (cur) finishStroke(); finishLevel(); }
        },
        draw(ctx) {
          const W = api.W, v = view();
          const k = ctx.getTransform().a;
          if (!bg || bg.W !== W || bg.k !== k) bg = makeBg(k);
          if (photo) { if (!ph || ph.W !== W || ph.k !== k) ph = makePhoto(k); blit(ctx, ph); }
          else blit(ctx, bg);
          const lv = levels[sel];
          ctx.save(); ctx.translate(v.ox, v.oy); ctx.scale(v.s, v.s);
          ctx.beginPath(); ctx.rect(-1, -1, MW + 2, MH + 2); ctx.clip();
          // триангуляция и засечки интерполяции (карандашом)
          if (tool === 'interp') {
            ctx.beginPath();
            for (const [a, b] of g.edges.values()) { ctx.moveTo(pk[a].x, pk[a].y); ctx.lineTo(pk[b].x, pk[b].y); }
            ctx.setLineDash([2, 1.6]); ctx.strokeStyle = 'rgba(70,70,80,.45)'; ctx.lineWidth = 0.9 / v.s; ctx.stroke(); ctx.setLineDash([]);
            if (interpA >= 0) {
              ctx.beginPath();
              for (const [a, b] of g.edges.values()) if (a === interpA || b === interpA) { ctx.moveTo(pk[a].x, pk[a].y); ctx.lineTo(pk[b].x, pk[b].y); }
              ctx.strokeStyle = 'rgba(255,150,30,.85)'; ctx.lineWidth = 2 / v.s; ctx.stroke();
            }
          }
          for (const sg of segs) {
            const A = pk[sg.a], Bp = pk[sg.b], dx = Bp.x - A.x, dy = Bp.y - A.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
            ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(Bp.x, Bp.y); ctx.strokeStyle = 'rgba(60,60,70,.7)'; ctx.lineWidth = 1 / v.s; ctx.stroke();
            for (const t of sg.ticks) {
              const on = Math.abs(t.L - lv.h) < 1e-6 && tool !== 'thal', r = on ? 3.4 : 2;
              ctx.beginPath(); ctx.moveTo(t.x - nx * r, t.y - ny * r); ctx.lineTo(t.x + nx * r, t.y + ny * r);
              ctx.strokeStyle = on ? '#e8590c' : 'rgba(60,60,70,.85)'; ctx.lineWidth = (on ? 2.2 : 1.1) / v.s; ctx.stroke();
              if (on) { ctx.beginPath(); ctx.arc(t.x, t.y, 1.7, 0, 7); ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 1.2 / v.s; ctx.stroke(); }
            }
          }
          for (const st of strokes) drawStroke(ctx, st, v.s, true);
          if (cur && cur.pts.length > 1) {
            strokePath(ctx, cur.pts); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.strokeStyle = cur.kind === 't' ? 'rgba(43,108,176,.8)' : 'rgba(110,70,40,.75)'; ctx.lineWidth = 1.6 / v.s; ctx.stroke();
          }
          // пикеты: цвет — выше/ниже выбранного уровня
          const cmp = tool !== 'thal';
          for (let i = 0; i < pk.length; i++) {
            const p = pk[i], dh = p.h - lv.h;
            ctx.beginPath(); ctx.arc(p.x, p.y, 3 / v.s + 0.35, 0, 7);
            ctx.fillStyle = !cmp ? INK : Math.abs(dh) < 0.02 ? ON_C : dh > 0 ? UP_C : DN_C; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.9 / v.s; ctx.stroke();
          }
          if (tool === 'interp' && interpA >= 0) {
            const p = pk[interpA], r = 6 / v.s + Math.sin(api.now * 6) * 0.6;
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.strokeStyle = '#ff8c1a'; ctx.lineWidth = 2 / v.s; ctx.stroke();
          }
          ctx.restore();
          // подсказка
          if (hintT > 0) {
            const txt = tool === 'interp' ? 'Тап по двум соседним пикетам — засечки уровней на ребре'
              : tool === 'thal' ? 'Тальвег — линия дна долины через вершины «V» горизонталей'
                : `Горизонталь ${fmt(lv.h)} м — между коричневыми и синими пикетами`;
            ctx.globalAlpha = Math.min(1, hintT / 0.6);
            let fs = 12;
            do { ctx.font = `600 ${fs}px system-ui, sans-serif`; } while (ctx.measureText(txt).width > v.pw - 34 && (fs -= 0.5) > 8.5);
            const tw = ctx.measureText(txt).width + 20, cxh = v.px + v.pw / 2, yh = v.py + v.ph - 32;
            ctx.fillStyle = 'rgba(20,14,10,.86)'; api.roundRect(ctx, cxh - tw / 2, yh, tw, 24, 8); ctx.fill();
            api.text(ctx, txt, cxh, yh + 12 + fs * 0.36, fs, '#ffd76a', 'center', '600');
            ctx.globalAlpha = 1;
          }
          if (pen) drawPencil(ctx, pen.x, pen.y);
          drawToasts(ctx);
          drawPanel(ctx);
        },
        pointerDown(p) {
          if (done) return;
          if (cur) { // ведётся линия: второй палец игнорируем, но «потерянный» pointerup (пауза посреди линии) — дорисовываем
            if (p.id !== activePtr && api.levelTime - curMoveAt < 0.4) return;
            activePtr = null; finishStroke();
          }
          const u = ui();
          if (api.hit(u.down, p)) return setLevel(sel - 1);
          if (api.hit(u.up, p)) return setLevel(sel + 1);
          if (api.hit(u.line, p)) return setTool('line');
          if (api.hit(u.interp, p)) return setTool('interp');
          if (u.thal && api.hit(u.thal, p)) return setTool('thal');
          if (api.hit(u.photo, p)) { photo = !photo; api.sfx(photo ? 'paper' : 'tap'); return; }
          if (api.hit(u.undo, p)) return undo();
          if (api.hit(u.submit, p)) return submit();
          if (api.hit(u.lvl, p)) { const n = nextOpen(); if (n >= 0) { setLevel(n); } return; }
          const w = toW(p);
          if (w.x < -3 || w.y < -3 || w.x > MW + 3 || w.y > MH + 3) return;
          if (tool === 'interp') return interpTap(w);
          cur = { kind: tool === 'thal' ? 't' : 'c', li: sel, pts: [{ x: Math.max(0, Math.min(MW, w.x)), y: Math.max(0, Math.min(MH, w.y)) }] };
          activePtr = p.id; curMoveAt = api.levelTime; pen = { x: p.x, y: p.y }; hintT = Math.min(hintT, 0.6);
        },
        pointerMove(p) {
          if (!cur || p.id !== activePtr) return;
          if (p.down === false) { activePtr = null; finishStroke(); return; } // кнопку отпустили, пока игра стояла на паузе
          curMoveAt = api.levelTime;
          const w = toW(p), q = { x: Math.max(0, Math.min(MW, w.x)), y: Math.max(0, Math.min(MH, w.y)) }, last = cur.pts[cur.pts.length - 1];
          pen = { x: p.x, y: p.y };
          if (d2(q, last) >= 1.2 * 1.2) cur.pts.push(q);
        },
        pointerUp(p) {
          if (!cur || p.id !== activePtr) return;
          inst.pointerMove(p); activePtr = null; finishStroke();
        },
        key(code, down) {
          if (!down || done) return;
          if (code === 'ArrowUp') setLevel(sel + 1);
          if (code === 'ArrowDown') setLevel(sel - 1);
          if (code === 'KeyL') setTool('line');
          if (code === 'KeyI') setTool('interp');
          if (code === 'KeyT' && ravine) setTool('thal');
          if (code === 'KeyF') photo = !photo;
          if (code === 'KeyZ' || code === 'Backspace') undo();
          if (code === 'Enter') submit();
        },
        hud() {
          // заголовок ядра слева длинный — подписи только на широком кадре
          const info = api.W >= 760 ? [`Линии ${doneCount()}/${NL}` + (ravine ? ` · тальвег ${Math.round(thalSt.cov * 100)} %` : '')] : [];
          return { time: Math.max(0, time), info, progress: api.W >= 600 ? coverage() : null };
        },
        // автоигрок: интерполяция для вида, затем истинные горизонтали (marching squares) с шумом руки, тальвег, сдача
        bot(dt) {
          if (done) return;
          if (!B) {
            const R = api.rng(seed ^ 0xb07), q = [{ t: 'btn', id: 'interp' }];
            const E = [...g.edges.values()].filter(([a, b]) => Math.abs(pk[a].h - pk[b].h) > iv * 1.5);
            for (let i = 0; i < 3 && E.length; i++) { const e = E.splice((R() * E.length) | 0, 1)[0]; q.push({ t: 'pk', i: e[0] }, { t: 'pk', i: e[1] }, { t: 'wait', d: 0.5 }); }
            q.push({ t: 'btn', id: 'line' });
            levels.forEach((lv, li) => {
              for (const l of lv.lines) {
                if (polyLen(l) < 10) continue;
                const r = resample(l, 3), ph0 = R() * 6, n = offsetLine(r, 0);
                const pts = r.map((p, i) => { const o = 0.7 * Math.sin(i * 0.35 + ph0), a = n[Math.min(i + 1, r.length - 1)], b0 = n[Math.max(0, i - 1)], L = Math.hypot(a.x - b0.x, a.y - b0.y) || 1; return { x: p.x - (a.y - b0.y) / L * o, y: p.y + (a.x - b0.x) / L * o }; });
                q.push({ t: 'level', li }, { t: 'drag', pts }, { t: 'wait', d: 0.35 });
              }
            });
            if (ravine) q.push({ t: 'btn', id: 'thal' }, { t: 'drag', pts: g.thal.map(p => ({ x: p.x, y: p.y + 0.6 })) }, { t: 'wait', d: 0.5 });
            q.push({ t: 'submit' });
            B = { q, t: 0.6, drag: null };
          }
          const tap = r => { const p = { x: r.x + r.w / 2, y: r.y + r.h / 2, id: 7, button: 0 }; inst.pointerDown(p); inst.pointerUp(p); };
          B.t -= dt;
          if (B.drag) {
            const D = B.drag;
            D.d = Math.min(D.len, D.d + 75 * dt);
            const s = toS(along(D.pts, D.d));
            if (D.d >= D.len) { inst.pointerUp({ x: s.x, y: s.y, id: 7 }); B.drag = null; B.t = 0.25; }
            else inst.pointerMove({ x: s.x, y: s.y, id: 7, down: true });
            return;
          }
          if (B.t > 0) return;
          const a = B.q[0];
          if (!a) return;
          if (a.t === 'wait') { B.t = a.d; B.q.shift(); }
          else if (a.t === 'btn') { tap(ui()[a.id]); B.q.shift(); B.t = 0.3; }
          else if (a.t === 'pk') { const s = toS(pk[a.i]); inst.pointerDown({ x: s.x, y: s.y, id: 7 }); B.q.shift(); B.t = 0.45; }
          else if (a.t === 'level') { if (sel === a.li) B.q.shift(); else { tap(ui()[sel < a.li ? 'up' : 'down']); B.t = 0.15; } }
          else if (a.t === 'drag') { const s = toS(a.pts[0]); inst.pointerDown({ x: s.x, y: s.y, id: 7, button: 0 }); B.drag = { pts: a.pts, d: 0, len: polyLen(a.pts) }; B.q.shift(); }
          else if (a.t === 'submit') { tap(ui().submit); B.t = 0.6; }
        },
      };
      return inst;
    },
  });
})();
