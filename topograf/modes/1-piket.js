'use strict';
// «Пикет» — тахеометрическая съёмка участка: вид сверху, реальное время, 120 с.
// Реечник с вехой обходит характерные точки (углы строений, опоры, деревья, бровки, урез воды…); тахеометр на станции
// снимает точку, если видит отражатель. Станцию переносят ходом: новая точка должна видеть прежнюю (задняя точка).
// Мир шире экрана (камера идёт за реечником, масштаб Z), участок каждый раз генерируется из зерна и проверяется на решаемость.
(() => {
  const Z = 1.5;             // масштаб камеры: логических единиц экрана на единицу мира
  const WH = 220;            // высота мира = высота игрового поля (330 / Z)
  const G = 3;               // клетка сетки проходимости, ед.
  const HR = 3;              // «радиус» реечника при обходе препятствий
  const SNAP = 9;            // реечник ближе — точку можно снять
  const T_LEVEL = 120;       // длительность уровня, с
  const SPEED = 74;          // шаг реечника, ед./с
  const MPU = 0.25;          // метров в единице
  const HI = 1.6, HV = 2.0;  // высота инструмента и отражателя, м
  const RANGE = 240;         // предельное расстояние до пикета: 60 м для контуров при съёмке М 1:500
  const TAU = Math.PI * 2, hyp = Math.hypot;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (v, n) => v.toFixed(n).replace('.', ',');
  const mmss = t => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  function dms(a) { a = ((a % 360) + 360) % 360; let d = Math.floor(a), m = Math.round((a - d) * 60); if (m === 60) { d = (d + 1) % 360; m = 0; } return String(d).padStart(3, '0') + '°' + String(m).padStart(2, '0') + '′'; }

  // ---------- геометрия ----------
  function crp(a, b, c, d, t) {
    const t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * (2 * b.x + (c.x - a.x) * t + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * t2 + (3 * b.x - a.x - 3 * c.x + d.x) * t3),
      y: 0.5 * (2 * b.y + (c.y - a.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * t2 + (3 * b.y - a.y - 3 * c.y + d.y) * t3),
    };
  }
  function dense(p, step, closed) { // сплайн Катмулла–Рома через вершины (как рисует Sym)
    const out = [], n = p.length, N = closed ? n : n - 1;
    for (let i = 0; i < N; i++) {
      const p0 = p[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
      const k = Math.max(1, Math.ceil(hyp(p2.x - p1.x, p2.y - p1.y) / step));
      for (let j = 0; j < k; j++) out.push(crp(p0, p1, p2, p3, j / k));
    }
    if (!closed) out.push({ x: p[n - 1].x, y: p[n - 1].y });
    return out;
  }
  function cum(p) { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + hyp(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)); return c; }
  function along(p, c, s) {
    const n = p.length; s = clamp(s, 0, c[n - 1]);
    let lo = 1, hi = n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < s) lo = m + 1; else hi = m; }
    const a = p[lo - 1], b = p[lo], t = (s - c[lo - 1]) / ((c[lo] - c[lo - 1]) || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  function nrm(p, i) { const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], dx = b.x - a.x, dy = b.y - a.y, L = hyp(dx, dy) || 1; return { x: -dy / L, y: dx / L }; }
  function offAt(p, i, d) { const n = nrm(p, i); return { x: p[i].x + n.x * d, y: p[i].y + n.y * d }; }
  const offs = (p, d) => p.map((_, i) => offAt(p, i, d));
  function dSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1) : 0;
    return hyp(ax + dx * t - px, ay + dy * t - py);
  }
  function dPoly(px, py, p, closed) {
    let b = Infinity; const n = p.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) { const a = p[i], c = p[(i + 1) % n]; b = Math.min(b, dSeg(px, py, a.x, a.y, c.x, c.y)); }
    return b;
  }
  function inPoly(x, y, p) {
    let ins = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i].y > y) !== (p[j].y > y) && x < (p[j].x - p[i].x) * (y - p[i].y) / (p[j].y - p[i].y) + p[i].x) ins = !ins;
    return ins;
  }
  const CLIP = [0, 0];
  function clipSeg(ax, ay, bx, by, x0, y0, x1, y1) { // отрезок ∩ прямоугольник → CLIP = [t0, t1]
    const dx = bx - ax, dy = by - ay; let t0 = 0, t1 = 1;
    if (dx === 0) { if (ax < x0 || ax > x1) return false; }
    else { let a = (x0 - ax) / dx, b = (x1 - ax) / dx; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false; }
    if (dy === 0) { if (ay < y0 || ay > y1) return false; }
    else { let a = (y0 - ay) / dy, b = (y1 - ay) / dy; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false; }
    CLIP[0] = t0; CLIP[1] = t1; return true;
  }
  function segCircT(ax, ay, bx, by, cx, cy, r) {
    const dx = bx - ax, dy = by - ay, fx = ax - cx, fy = ay - cy;
    const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
    if (c <= 0) return 0;
    const disc = b * b - 4 * a * c; if (disc < 0 || !a) return -1;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : -1;
  }
  function yOn(D, x) { // y ломаной D (монотонной по x)
    let lo = 0, hi = D.length - 1;
    if (x <= D[0].x) return D[0].y; if (x >= D[hi].x) return D[hi].y;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (D[m].x <= x) lo = m; else hi = m; }
    const a = D[lo], b = D[hi]; return lerp(a.y, b.y, (x - a.x) / ((b.x - a.x) || 1));
  }
  const ellipsePts = (x, y, a, b, th, n) => { const ca = Math.cos(th), sa = Math.sin(th), o = []; for (let k = 0; k < n; k++) { const f = k / n * TAU, lx = Math.cos(f) * a, ly = Math.sin(f) * b; o.push({ x: x + lx * ca - ly * sa, y: y + lx * sa + ly * ca }); } return o; };

  const ROOFS = ['#a8503a', '#8e3f30', '#4f7458', '#4b6584', '#7a7f86', '#b7653d', '#6d3b2e', '#5d6b73', '#9b4a3c', '#3d5a73', '#8c5a3c', '#6b6f45'];
  const CARS = ['#d8dadd', '#2b2f35', '#b3302c', '#2c5c9e', '#f2f2ee', '#5f7356', '#c8a24a', '#7a2e3c', '#3e7f8a', '#56606a'];
  const NET_NAME = { storm: 'люк ливнёвки', water: 'люк водопровода', heat: 'люк теплосети', tele: 'люк связи', sewer: 'люк канализации' };
  const TREE_NAME = { birch: 'берёза', conifer: 'ель', deciduous: 'липа', apple: 'яблоня' };

  registerMode({
    index: 1,
    id: 'piket',
    title: 'Пикет',
    subtitle: 'Тахеометрическая съёмка участка',
    howto: [
      'За 2 минуты снимите участок: тап по карте — реечник идёт.',
      'У характерной точки (угол, опора, дерево) жмите ПИКЕТ.',
      'Тахеометр должен видеть веху, а до неё — не больше 60 м.',
      'Иначе СТАНЦИЯ и тап по месту; новая должна видеть прежнюю.',
      'Дому хватит 3 углов. Пикет в пустоте — лишний, штраф.',
    ],
    variants: [
      { id: 'village', title: 'Частный сектор', subtitle: 'Усадьбы ИЖС вдоль грунтовой улицы — топоплан 1:500',
        howto: ['Собака во дворе мешает пройти, машина перекрывает луч.'] },
      { id: 'park', title: 'Парк с оврагом', subtitle: 'Дорожки, пруд, холм, овраг и роща — ситуация и рельеф',
        howto: ['Рельеф: холм, бровки и тальвег оврага, урез пруда.', 'Холм и овраг закрывают луч, бегуны и велосипед — тоже.'] },
    ],
    create(api, variant, seed) { return createLevel(api, variant, seed); },
  });

  function createLevel(api, variant, seed) {
    const R = api.rng(seed), rr = (a, b) => a + R() * (b - a), ri = (a, b) => Math.floor(rr(a, b + 1));
    const pickR = a => a[Math.floor(R() * a.length)];
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const sdx = () => ri(1, 999999999);
    const PARK = variant.id === 'park', TOP = api.TOP;
    let WW = 900, H0 = 150;
    let hAt = () => H0;                     // отметка земли, м
    let relief = false;
    const reliefBoxes = [];                 // где рельеф может закрыть луч
    let onLane = () => false;               // проезжая часть / аллея — станцию не ставить
    const objs = [], pts = [];
    const wRects = [], wSegs = [], wCircs = [], wPolys = [];   // непроходимо
    const lRects = [], lCircs = [];                             // закрывает луч
    const statics = [], S = (z, f) => statics.push({ z, f, i: statics.length });
    const occ = [], streets = [], lanes = [];
    let dogHome = null, pond = null, ravine = null, hill = null, heroStart = { x: 60, y: 120 }, laneY = () => 120;

    // ---------- точки и объекты съёмки ----------
    function pt(x, y, name) {
      x = Math.round(x * 10) / 10; y = Math.round(y * 10) / 10;
      for (const p of pts) if (Math.abs(p.x - x) < 0.6 && Math.abs(p.y - y) < 0.6) return p;
      const p = { i: pts.length, x, y, name, objs: [], taken: false, num: 0, stand: [], dead: false, h: 0 };
      pts.push(p); return p;
    }
    function obj(kind, name, list, need, plan) {
      const o = { i: objs.length, kind, name, pts: list, need: Math.min(need, list.length), plan: plan || {}, done: false, got: 0, dead: false, flash: 0 };
      for (const p of list) p.objs.push(o);
      objs.push(o); return o;
    }
    const occFree = (x0, y0, x1, y1, pad) => { for (const o of occ) if (x0 - pad < o.x1 && x1 + pad > o.x0 && y0 - pad < o.y1 && y1 + pad > o.y0) return false; return true; };
    const occAdd = (x0, y0, x1, y1) => occ.push({ x0, y0, x1, y1 });
    function solid(x, y, w, h, what, los) {
      wRects.push({ x0: x, y0: y, x1: x + w, y1: y + h });
      if (los !== false) lRects.push({ x0: x, y0: y, x1: x + w, y1: y + h, what });
      occAdd(x, y, x + w, y + h);
    }
    const corners = (x, y, w, h, nm) => [pt(x, y, nm), pt(x + w, y, nm), pt(x + w, y + h, nm), pt(x, y + h, nm)];
    const rectPoly = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    function treeDecor(x, y, r, kind) { // дерево без отдельной точки (в роще)
      wCircs.push({ x, y, r: 1.4 }); lCircs.push({ x, y, r: r * 0.78, what: 'крона' });
      const sd = sdx(); S(50, c => Sym.tree(c, x, y, r, kind, sd));
      occAdd(x - r * 0.6, y - r * 0.6, x + r * 0.6, y + r * 0.6);
    }
    function addTree(x, y, r, kind) {
      x = Math.round(x); y = Math.round(y); r = Math.round(r * 2) / 2;
      treeDecor(x, y, r, kind);
      const nm = TREE_NAME[kind] || 'дерево';
      return obj('tree', nm[0].toUpperCase() + nm.slice(1), [pt(x, y, nm)], 1, { x, y, kind, r });
    }
    function addBuilding(kind, x, y, w, h, names, label, draw) {
      x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
      solid(x, y, w, h, names[2]);
      S(kind === 'annex' ? 29 : 30, c => draw(c, x, y, w, h));
      return obj(kind, names[0], corners(x, y, w, h, 'угол ' + names[1]), 3, { poly: rectPoly(x, y, w, h), label });
    }
    function bush(x, y, r, z) { const bs = sdx(); S(z || 22, c => Sym.bush(c, x, y, r, bs)); }

    // =====================================================================================
    // Частный сектор: грунтовая улица с канавой внизу, ЛЭП по обочине, ряд из 3–4 усадеб ИЖС
    // =====================================================================================
    function genVillage() {
      H0 = rr(141, 168);
      hAt = (x, y) => H0 + x * 0.0016 - y * 0.001;
      WW = Math.round(rr(860, 960));
      const nP = R() < 0.35 ? 4 : 3, mL = Math.round(rr(34, 80)), mR = Math.round(rr(34, 80));
      const gaps = []; for (let k = 0; k < nP - 1; k++) gaps.push(R() < 0.5 ? 0 : Math.round(rr(34, 60)));
      const usable = WW - mL - mR - gaps.reduce((a, b) => a + b, 0), ws = [];
      for (let k = 0; k < nP; k++) ws.push(rr(0.9, 1.1));
      const sw = ws.reduce((a, b) => a + b, 0);
      for (let k = 0; k < nP; k++) ws[k] = Math.round(ws[k] / sw * usable);
      // улица
      const yc = rr(176, 184), RW = 22, sg = R() < 0.5 ? 1 : -1;
      const road = [{ x: -40, y: yc + rr(-3, 3) }];
      for (let i = 1; i <= 2; i++) road.push({ x: Math.round(WW * i / 3 + rr(-40, 40)), y: yc + (i % 2 ? sg : -sg) * rr(4, 6) });
      road.push({ x: WW + 40, y: yc + rr(-3, 3) });
      const RD = dense(road, 4), roadY = x => yOn(RD, x);
      laneY = roadY;
      onLane = (x, y) => Math.abs(y - roadY(x)) < RW / 2 + 2;
      const rp = [];
      for (let i = 1; i < road.length - 1; i++) for (const sd of [-1, 1]) { const q = offAt(road, i, sd * RW / 2); rp.push(pt(q.x, q.y, 'бровка дороги')); }
      const ditch = offs(road, 17), sdR = sdx();
      obj('road', 'Улица', rp, rp.length, { pts: road, width: RW, ditch });
      S(6, c => Sym.stream(c, ditch, 4, sdR));
      streets.push({ pts: road, width: RW, kind: 'dirt', seed: sdR });
      for (const lane of [5, -5]) lanes.push(RD.map((q, i) => { const n = nrm(RD, i); return { x: q.x + n.x * lane, y: q.y + n.y * lane }; }));
      const yN = Math.round(yc - 32);
      // усадьбы
      const plots = [];
      let x = mL;
      for (let k = 0; k < nP; k++) { plots.push({ x0: x, x1: x + ws[k], w: ws[k], yF: yN, depth: yN, k }); x += ws[k] + (gaps[k] || 0); }
      const kinds = shuffle(['shed', 'greenhouse', 'bath', 'toilet']), vacant = nP > 3 || R() < 0.25 ? Math.floor(R() * nP) : -1;
      let fk = 0;
      plots.forEach((pl, k) => { if (k === vacant) { pl.vacant = true; fillVacant(pl); } else { fillPlot(pl, fk === 0 ? 'shed' : fk === 1 ? 'greenhouse' : kinds[fk], fk); fk++; } });
      // заборы: передний с калиткой и воротами, боковые — за край съёмки
      const sideDone = new Set();
      for (const pl of plots) {
        if (pl.vacant) { // межевые знаки по передним углам незастроенного участка
          const ms = [pt(pl.x0, pl.yF, 'межевой знак'), pt(pl.x1, pl.yF, 'межевой знак')];
          S(24, c => { for (const q of ms) Sym.marker(c, q.x, q.y, 'boundary'); });
          obj('marker', 'Межевые знаки', ms, 2, { pts: ms.map(q => ({ x: q.x, y: q.y })) });
          continue;
        }
        const y = pl.yF, a = pl.x0, b = pl.x1, g0 = pl.gu - 7, g1 = pl.gu + 7, v0 = pl.vu - 11, v1 = pl.vu + 11, edge = -10;
        const kF = pickR(['metal', 'wood', 'wood']), kS = R() < 0.6 ? 'chain' : 'wood';
        const cuts = [[g0, g1], [v0, v1]].sort((p, q) => p[0] - q[0]);
        const pieces = [[a, cuts[0][0]], [cuts[0][1], cuts[1][0]], [cuts[1][1], b]].filter(q => q[1] - q[0] > 0.5);
        for (const q of pieces) { wSegs.push({ ax: q[0], ay: y, bx: q[1], by: y, r: 0.7 }); S(20, c => Sym.fence(c, [[q[0], y], [q[1], y]], kF)); }
        wSegs.push({ ax: v0, ay: y, bx: v1, by: y, r: 0.7 });
        S(21, c => { Sym.gate(c, pl.vu, y, 22, 0, 0); Sym.gate(c, pl.gu, y, 14, 0, 0.85); });
        const lines = [{ pts: [{ x: a, y }, { x: g0, y }], kind: kF }, { pts: [{ x: g1, y }, { x: b, y }], kind: kF }];
        for (const sx of [a, b]) {
          lines.push({ pts: [{ x: sx, y }, { x: sx, y: edge }], kind: kS });
          if (sideDone.has(sx)) continue; sideDone.add(sx);
          wSegs.push({ ax: sx, ay: y, bx: sx, by: edge, r: 0.7 });
          S(20, c => Sym.fence(c, [[sx, y], [sx, edge]], kS));
        }
        const fp = [pt(a, y, 'угол забора'), pt(g0, y, 'столб калитки'), pt(g1, y, 'столб калитки'), pt(b, y, 'угол забора')].filter(q => !q.objs.some(o => o.kind === 'fence'));
        obj('fence', 'Забор', fp, fp.length, { lines });
        streets.push({ pts: [{ x: pl.vu, y: roadY(pl.vu) }, { x: pl.vu, y: y + 2 }], width: 20, kind: 'gravel', seed: sdx() });
      }
      // опоры ЛЭП по северной обочине, провода и вводы в дома
      const RC = cum(RD), poles = [];
      let s = rr(30, 90);
      while (s < RC[RC.length - 1]) {
        const a = along(RD, RC, s), px = Math.round(a.x + Math.sin(a.a) * 21), py = Math.round(a.y - Math.cos(a.a) * 21);
        if (plots.some(pl => Math.abs(px - pl.vu) < 16 || Math.abs(px - pl.gu) < 12)) { s += 20; continue; }
        if (px > 12 && px < WW - 12) poles.push({ x: px, y: py, a: a.a });
        s += rr(200, 230);
      }
      poles.forEach(p => {
        wCircs.push({ x: p.x, y: p.y, r: 1.2 });
        S(60, c => Sym.pole(c, p.x, p.y, 'power', p.a));
        obj('pole', 'Опора ЛЭП', [pt(p.x, p.y, 'опора ЛЭП')], 1, { x: p.x, y: p.y, kind: 'power', rot: p.a });
      });
      if (poles.length) S(62, c => {
        const f = poles[0], l = poles[poles.length - 1];
        Sym.wires(c, -30, f.y, f.x, f.y);
        for (let i = 0; i + 1 < poles.length; i++) Sym.wires(c, poles[i].x, poles[i].y, poles[i + 1].x, poles[i + 1].y);
        Sym.wires(c, l.x, l.y, WW + 30, l.y);
        for (const pl of plots) if (pl.house) {
          const h = pl.house, hx = h.x + h.w / 2, hy = h.y + h.h;
          let best = poles[0]; for (const p of poles) if (Math.abs(p.x - hx) < Math.abs(best.x - hx)) best = p;
          Sym.wires(c, best.x, best.y, hx, hy, 'tele');
        }
      });
      // люк водопровода на улице, гидрант на обочине, лавочка у калитки
      if (R() < 0.45) for (let t = 0; t < 30; t++) {
        const x = Math.round(rr(70, WW - 70)), y = Math.round(roadY(x) + rr(-3, 3));
        if (plots.some(pl => Math.abs(x - pl.vu) < 18)) continue;
        S(14, c => Sym.manhole(c, x, y, 'water', 2.3, 0.4));
        obj('manhole', 'Колодец ВК', [pt(x, y, 'люк водопровода')], 1, { x, y, kind: 'water' });
        break;
      }
      for (let t = 0; t < 30; t++) {
        const x = Math.round(rr(60, WW - 60)), y = Math.round(roadY(x) - 16);
        if (poles.some(p => Math.abs(p.x - x) < 14) || plots.some(pl => Math.abs(x - pl.vu) < 18)) continue;
        wCircs.push({ x, y, r: 1.4 });
        S(14, c => Sym.hydrant(c, x, y, 0));
        obj('hydrant', 'Гидрант', [pt(x, y, 'пожарный гидрант')], 1, { x, y });
        break;
      }
      if (R() < 0.45) {
        const pl = pickR(plots), x = Math.round(pl.gu + (pl.gu < pl.vu ? -16 : 16)), y = pl.yF + 4;
        if (x > pl.x0 + 6 && x < pl.x1 - 6 && !poles.some(p => Math.abs(p.x - x) < 10)) {
          solid(x - 3.6, y - 1.3, 7.2, 2.6, 'скамейка', false);
          S(24, c => Sym.bench(c, x, y, Math.PI));
          obj('bench', 'Скамейка', [pt(x, y, 'скамейка')], 1, { x, y, rot: 0 });
        }
      }
      // пустыри по краям и проулки: луг, деревья, кусты, общественный колодец
      const lots = [[0, plots[0].x0]];
      for (let k = 0; k + 1 < plots.length; k++) if (plots[k + 1].x0 - plots[k].x1 > 20) lots.push([plots[k].x1, plots[k + 1].x0]);
      lots.push([plots[plots.length - 1].x1, WW]);
      let wellDone = R() < 0.5, lotTrees = 0;
      for (const [a, b] of lots) {
        const gs = sdx(); S(2, c => Sym.ground(c, a, 0, b - a, yN, 'meadow', gs));
        if (b - a > 56 && lotTrees < 2) for (let t = 0, n = 0; t < 30 && n < 1; t++) {
          const r = rr(9, 12), x = rr(a + r * 0.7 + 4, b - r * 0.7 - 4), y = rr(r + 10, yN - r - 12);
          if (!occFree(x - r, y - r, x + r, y + r, 4)) continue;
          addTree(x, y, r, pickR(['birch', 'birch', 'deciduous', 'conifer'])); n++; lotTrees++;
        }
        for (let k = 0; k < 3; k++) { const x = rr(a + 6, b - 6), y = rr(8, yN - 8), r = rr(3, 5.5); if (occFree(x - r, y - r, x + r, y + r, 1)) bush(x, y, r); }
        if (!wellDone && b - a > 46) {
          const x = Math.round((a + b) / 2 + rr(-8, 8)), y = yN - 12;
          if (occFree(x - 6, y - 6, x + 6, y + 6, 3)) {
            wellDone = true; wCircs.push({ x, y, r: 3.6 }); occAdd(x - 5, y - 5, x + 5, y + 5);
            S(24, c => Sym.well(c, x, y));
            obj('well', 'Колодец', [pt(x, y, 'колодец')], 1, { x, y });
          }
        }
      }
      // южная обочина за канавой: кусты, ветлы
      for (let t = 0, n = 0; t < 30 && n < 1; t++) {
        const x = rr(40, WW - 40), r = rr(9, 11), y = Math.round(roadY(x) + 28 + rr(0, 4));
        if (y + 4 > WH || !occFree(x - r, y - r, x + r, y + r, 20)) continue;
        addTree(x, y, r, pickR(['deciduous', 'birch'])); n++;
      }
      for (let k = 0; k < 8; k++) { const x = rr(10, WW - 10), y = roadY(x) + rr(23, 34), r = rr(2.5, 4.5); if (y < WH - 2 && occFree(x - r, y - r, x + r, y + r, 2)) bush(x, y, r); }
      // собака — в одной из усадеб
      const built = plots.filter(q => !q.vacant), dp = built[Math.floor(R() * built.length)];
      dogHome = { x0: dp.x0 + 6, x1: dp.x1 - 6, y0: 8, y1: dp.yF - 6 };
      heroStart = { x: rr(40, 60), y: 0 }; heroStart.y = roadY(heroStart.x);
      S(0, c => Sym.ground(c, 0, 0, WW, WH, 'grass', 11));
      S(10, c => Sym.roads(c, streets));
    }

    function fillVacant(pl) { // незастроенный участок под ИЖС: бурьян, иногда бытовка; по углам — межевые знаки
      const { x0, w, yF } = pl, gateLeft = R() < 0.5;
      pl.vu = Math.round(x0 + (gateLeft ? rr(22, 40) : w - rr(22, 40))); pl.gu = pl.vu + (gateLeft ? 22 : -22);
      const ms = sdx(); S(2, c => Sym.ground(c, x0, 0, w, yF, 'meadow', ms));
      for (let k = 0; k < 2; k++) { const fx = x0 + rr(16, w - 60), fy = rr(14, yF - 50), fw = rr(24, 40), fh = rr(16, 28), ds = sdx(); if (occFree(fx, fy, fx + fw, fy + fh, 2)) S(3, c => { c.globalAlpha = 0.55; Sym.ground(c, fx, fy, fw, fh, k ? 'sand' : 'dirt', ds, { poly: ellipsePts(fx + fw / 2, fy + fh / 2, fw / 2, fh / 2, rr(0, 3), 9), edge: 7 }); c.globalAlpha = 1; }); }
      const L = 20, D = 10, bx = Math.round(x0 + (gateLeft ? w - 40 : 18)), by = Math.round(yF - 30 - D);
      if (R() < 0.6 && occFree(bx, by, bx + L, by + D, 8)) {
        const so = { material: 'metal', color: pickR(['#4f7a9a', '#8a8f86', '#3f6b52']), seed: sdx() };
        addBuilding('shed', bx, by, L, D, ['Бытовка', 'бытовки', 'бытовка'], 'мн', (c, x, y, ww, hh) => Sym.shed(c, x, y, ww, hh, so));
      }
      for (let n = 0; n < 10; n++) { const x = x0 + rr(8, w - 8), y = rr(8, yF - 8), r = rr(2.5, 5); if (occFree(x - r, y - r, x + r, y + r, 2)) bush(x, y, r); }
    }
    function fillPlot(pl, forced, k) {
      const { x0, w, yF, depth } = pl;
      const Pp = (u, v) => ({ x: x0 + u, y: yF - v });
      const Rc = (u, v, ww, hh) => ({ x: x0 + u, y: yF - v - hh, w: ww, h: hh });
      const gateLeft = R() < 0.5;
      const vu = Math.round(gateLeft ? rr(22, 40) : w - rr(22, 40)), gu = vu + (gateLeft ? 22 : -22);
      pl.gu = x0 + gu; pl.vu = x0 + vu;
      const ls = sdx(); S(2, c => Sym.ground(c, x0, 0, w, yF, R() < 0.5 ? 'lawn' : 'grass', ls));
      // заезд, машина у ворот
      const dl = Math.round(rr(34, 44)), dr = Rc(vu - 11, 0, 22, dl), gs = sdx();
      S(8, c => Sym.ground(c, dr.x, dr.y, dr.w, dr.h, 'gravel', gs));
      occAdd(Math.min(dr.x, x0 + gu - 10), dr.y, Math.max(dr.x + dr.w, x0 + gu + 10), dr.y + dr.h);
      if (R() < 0.6 || k === 0) {
        const cp = Pp(vu, 21), cc = pickR(CARS), cs = sdx();
        solid(cp.x - 4, cp.y - 10, 8, 20, 'машина');
        S(28, c => Sym.car(c, cp.x, cp.y, -Math.PI / 2, cc, cs));
      }
      // жилой дом (иногда с пристройкой)
      const uMin = gateLeft ? gu + 14 : 12, uMax = gateLeft ? w - 12 : gu - 14;
      const hw = Math.round(Math.min(rr(36, 50), uMax - uMin)), hd = Math.round(rr(30, 40)), v0 = Math.round(rr(10, 18));
      const u0 = Math.round(rr(uMin, uMax - hw)), hr = Rc(u0, v0, hw, hd);
      const two = hw * hd > 1500 && R() < 0.4, wood = !two && R() < 0.45;
      const hopt = { roof: R() < 0.55 ? 'gable' : 'hip', color: pickR(ROOFS), material: pickR(['tile', 'metal', 'shingle']), chimney: R() < 0.75, solar: R() < 0.15, skylights: R() < 0.3, dish: R() < 0.3, seed: sdx() };
      if (two) hopt.height = 7;
      pl.house = hr;
      addBuilding('house', hr.x, hr.y, hr.w, hr.h, ['Дом', 'дома', 'дом'], two ? 'кж2' : wood ? 'дж1' : 'кж1', (c, x, y, ww, hh) => Sym.house(c, x, y, ww, hh, hopt));
      if (R() < 0.45) {
        const aw = Math.round(Math.min(rr(14, 22), hw - 6)), ad = Math.round(rr(10, 15)), au = R() < 0.5 ? u0 : u0 + hw - aw;
        const ar = Rc(au, v0 + hd, aw, ad), aopt = { roof: R() < 0.5 ? 'flat' : 'gable', color: pickR(ROOFS), height: 2.4, chimney: false, solar: false, skylights: false, dish: false, seed: sdx() };
        const far = [Pp(au, v0 + hd + ad), Pp(au + aw, v0 + hd + ad)];
        solid(ar.x, ar.y, ar.w, ar.h, 'пристройка');
        S(29, c => Sym.house(c, ar.x, ar.y, ar.w, ar.h, aopt));
        obj('annex', 'Пристройка', far.map(q => pt(q.x, q.y, 'угол пристройки')), 2, { poly: rectPoly(ar.x, ar.y, ar.w, ar.h), label: 'н' });
      }
      // дорожка от калитки к крыльцу, палисадник
      const pv = v0 + Math.min(10, hd / 2), doorU = gateLeft ? u0 - 1 : u0 + hw + 1;
      const path = [Pp(gu, 0.5), Pp(gu, pv), Pp(doorU, pv)];
      S(12, c => Sym.road(c, path, 5, 'path', { smooth: false }));
      occAdd(Math.min(x0 + gu, x0 + doorU) - 4, Math.min(path[0].y, path[2].y) - 4, Math.max(x0 + gu, x0 + doorU) + 4, Math.max(path[0].y, path[2].y) + 4);
      if (v0 >= 14 && hw > 20) { const fr = Rc(u0 + 3, 3, hw - 6, v0 - 7), fs = sdx(); S(14, c => Sym.flowerbed(c, fr.x, fr.y, fr.w, fr.h, fs)); }
      // хозпостройки в глубине участка
      const place = (ww, hh, pad, vMin) => {
        for (let t = 0; t < 80; t++) {
          const u = Math.round(rr(12, w - 12 - ww)), v = Math.round(rr(vMin || 12, depth - 12 - hh)), r = Rc(u, v, ww, hh);
          if (r.y < 8) continue;
          if (occFree(r.x, r.y, r.x + r.w, r.y + r.h, pad)) return r;
        }
        return null;
      };
      const list = [forced];
      if (R() < 0.15) list.push(pickR(['shed', 'greenhouse', 'bath', 'toilet'].filter(q => q !== forced)));
      const outs = [];
      for (const kind of list) {
        const rot = R() < 0.5;
        if (kind === 'shed') {
          const L = rr(18, 26), D = rr(13, 18), r = place(rot ? D : L, rot ? L : D, 11); if (!r) continue;
          const mat = pickR(['metal', 'wood', 'felt']), so = { material: mat, roof: R() < 0.3 ? 'gable' : undefined, seed: sdx() };
          addBuilding('shed', r.x, r.y, r.w, r.h, ['Сарай', 'сарая', 'сарай'], mat === 'metal' ? 'мн' : 'дн', (c, x, y, ww, hh) => Sym.shed(c, x, y, ww, hh, so)); outs.push(r);
        } else if (kind === 'greenhouse') {
          const L = rr(24, 30), D = rr(11, 13), r = place(rot ? D : L, rot ? L : D, 11); if (!r) continue;
          const go = { seed: sdx() };
          addBuilding('greenhouse', r.x, r.y, r.w, r.h, ['Теплица', 'теплицы', 'теплица'], 'тепл', (c, x, y, ww, hh) => Sym.greenhouse(c, x, y, ww, hh, go));
        } else if (kind === 'bath') {
          const L = rr(18, 22), D = rr(15, 18), r = place(rot ? D : L, rot ? L : D, 11); if (!r) continue;
          const bo = { roof: 'gable', color: pickR(['#6f5a46', '#7b4a36', '#5d6b73', '#8e3f30']), material: R() < 0.5 ? 'shingle' : 'metal', chimney: true, solar: false, skylights: false, dish: false, height: 2.2, seed: sdx() };
          addBuilding('bath', r.x, r.y, r.w, r.h, ['Баня', 'бани', 'баня'], 'дн', (c, x, y, ww, hh) => Sym.house(c, x, y, ww, hh, bo)); outs.push(r);
        } else {
          const r = place(8, 9, 10, 60); if (!r) continue;
          const to = { material: 'wood', color: '#7b5a3e', seed: sdx() };
          addBuilding('toilet', r.x, r.y, r.w, r.h, ['Туалет', 'туалета', 'туалет'], 'уб', (c, x, y, ww, hh) => Sym.shed(c, x, y, ww, hh, to)); outs.push(r);
        }
      }
      // тропинка от дома к хозпостройке (бетонные плиты)
      if (outs.length) {
        const o = outs[0], a = { x: hr.x + hr.w / 2, y: hr.y }, b = { x: o.x + o.w / 2, y: o.y + o.h + 1 };
        if (b.y < a.y - 8) { const pp = [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b]; S(11, c => Sym.road(c, pp, 3.5, 'gravel', { smooth: false })); }
      }
      // огород: грядки, ряды смородины
      for (let t = 0; t < 40; t++) {
        const ww = Math.round(rr(40, 64)), hh = Math.round(rr(26, 38)), u = Math.round(rr(10, w - 10 - ww)), v = Math.round(rr(50, depth - 8 - hh)), r = Rc(u, v, ww, hh);
        if (r.y < 4 || !occFree(r.x, r.y, r.x + r.w, r.y + r.h, 6)) continue;
        const fs = sdx(); occAdd(r.x, r.y, r.x + r.w, r.y + r.h);
        S(5, c => Sym.ground(c, r.x, r.y, r.w, r.h, 'field', fs));
        const n = Math.floor(r.w / 9);
        if (r.y > 16) for (let i = 0; i < n; i++) bush(r.x + 4 + i * 9, r.y - 6, rr(2.8, 3.6), 22);
        break;
      }
      // яблони, колодец, кусты вдоль забора
      const nt = 1 + (R() < 0.2 ? 1 : 0);
      for (let n = 0, t = 0; n < nt && t < 60; t++) {
        const r = rr(9, 12), u = rr(r * 0.8 + 4, w - r * 0.8 - 4), v = rr(r * 0.8 + 6, depth - r * 0.8 - 4), q = Pp(u, v);
        if (!occFree(q.x - r, q.y - r, q.x + r, q.y + r, 3)) continue;
        addTree(q.x, q.y, r, R() < 0.75 ? 'apple' : pickR(['birch', 'conifer'])); n++;
      }
      if (R() < 0.2) for (let t = 0; t < 40; t++) {
        const q = Pp(rr(12, w - 12), rr(14, depth - 12));
        if (!occFree(q.x - 6, q.y - 6, q.x + 6, q.y + 6, 5)) continue;
        const x = Math.round(q.x), y = Math.round(q.y);
        wCircs.push({ x, y, r: 3.6 }); occAdd(x - 5, y - 5, x + 5, y + 5);
        S(24, c => Sym.well(c, x, y));
        obj('well', 'Колодец', [pt(x, y, 'колодец')], 1, { x, y });
        break;
      }
      for (let n = 0; n < 9; n++) {
        const u = R() < 0.5 ? rr(4, 8) : w - rr(4, 8), q = Pp(u, rr(30, depth - 6)), r = rr(3, 5);
        if (occFree(q.x - r, q.y - r, q.x + r, q.y + r, 1)) bush(q.x, q.y, r);
      }
    }

    // =====================================================================================
    // Парк с оврагом: аллея и дорожки из плитки, фонари, скамейки, пруд, овраг, холм, роща, площадка
    // =====================================================================================
    function genPark() {
      WW = Math.round(rr(880, 960));
      H0 = rr(138, 162);
      relief = true;
      const yA = rr(128, 140), AW = 12, sg = R() < 0.5 ? 1 : -1;
      const av = [{ x: -40, y: yA + rr(-4, 4) }];
      for (let i = 1; i <= 2; i++) av.push({ x: Math.round(WW * i / 3 + rr(-50, 50)), y: yA + (i % 2 ? sg : -sg) * rr(8, 14) });
      av.push({ x: WW + 40, y: yA + rr(-4, 4) });
      const AD = dense(av, 4), AC = cum(AD), alleyY = x => yOn(AD, x);
      laneY = alleyY;
      const ap = [];
      for (let i = 1; i < av.length - 1; i++) for (const sd of [-1, 1]) { const q = offAt(av, i, sd * AW / 2); ap.push(pt(q.x, q.y, 'край дорожки')); }
      obj('path', 'Аллея', ap, ap.length, { pts: av, width: AW });
      streets.push({ pts: av, width: AW, kind: 'path', seed: sdx() });
      for (const lane of [3, -3]) lanes.push(AD.map((q, i) => { const n = nrm(AD, i); return { x: q.x + n.x * lane, y: q.y + n.y * lane }; }));
      const branches = [];
      onLane = (x, y) => Math.abs(y - alleyY(x)) < AW / 2 + 3 || branches.some(b => dPoly(x, y, b.D) < 7);
      for (const q of AD) occAdd(q.x - AW / 2 - 2, q.y - AW / 2 - 2, q.x + AW / 2 + 2, q.y + AW / 2 + 2);

      // крупные формы: трети мира × сторона аллеи
      const [tr, th, tp] = shuffle([0, 1, 2]);
      const slotX = t => Math.round((t + 0.5) * WW / 3 + rr(-25, 25));
      const bandN = x => [6, alleyY(x) - AW / 2 - 10], bandS = x => [alleyY(x) + AW / 2 + 10, WH - 6];
      const branch = (st, end) => { const mid = { x: lerp(st.x, end.x, 0.5) + rr(-16, 16), y: lerp(st.y, end.y, 0.5) }, bp = [st, mid, end]; branches.push({ pts: bp, D: dense(bp, 4) }); };
      // --- овраг (с севера, вершиной к аллее)
      {
        const xr = slotX(tr), yHead = Math.round(alleyY(xr) - AW / 2 - rr(26, 34));
        const v0 = { x: xr + rr(-30, 30), y: -16 }, head = { x: xr + rr(-14, 14), y: yHead };
        const v1 = { x: lerp(v0.x, head.x, 0.36) + rr(-18, 18), y: lerp(-16, yHead, 0.36) };
        const v2 = { x: lerp(v0.x, head.x, 0.7) + rr(-14, 14), y: lerp(-16, yHead, 0.7) };
        const TH = [v0, v1, v2, head], E = [rr(28, 32), rr(23, 27), rr(16, 19), 0], D = [rr(2.8, 3.4), rr(2.3, 2.8), rr(1.4, 1.9), 0], wb = 4;
        const top = [[], []], bot = [[], []];
        TH.forEach((q, i) => { for (const k of [0, 1]) { const sd = k ? -1 : 1; top[k].push(i < 3 ? offAt(TH, i, sd * E[i]) : { x: q.x, y: q.y }); bot[k].push(i < 3 ? offAt(TH, i, sd * wb) : { x: q.x, y: q.y }); } });
        ravine = { TH, E, D, wb, top, bot };
        const rpts = [pt(top[0][1].x, top[0][1].y, 'бровка оврага'), pt(top[0][2].x, top[0][2].y, 'бровка оврага'), pt(top[1][1].x, top[1][1].y, 'бровка оврага'), pt(top[1][2].x, top[1][2].y, 'бровка оврага'),
          pt(v1.x, v1.y, 'тальвег'), pt(v2.x, v2.y, 'тальвег'), pt(head.x, head.y, 'вершина оврага')];
        obj('ravine', 'Овраг', rpts, rpts.length, { top, bot, th: TH });
        const rs = sdx(), poly = top[0].concat(top[1].slice().reverse());
        S(4, c => Sym.ground(c, 0, 0, 0, 0, 'meadow', rs, { poly, edge: 4 }));
        S(6, c => { Sym.slope(c, top[0], bot[0]); Sym.slope(c, top[1], bot[1]); Sym.stream(c, [v0, v1, v2, { x: lerp(v2.x, head.x, 0.55), y: lerp(v2.y, head.y, 0.55) }], 2.2, rs); });
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const q of poly) { bx0 = Math.min(bx0, q.x); by0 = Math.min(by0, q.y); bx1 = Math.max(bx1, q.x); by1 = Math.max(by1, q.y); }
        reliefBoxes.push([bx0 - 4, by0 - 4, bx1 + 4, by1 + 4]);
        occAdd(bx0 - 2, by0, bx1 + 2, by1 + 6);
        for (let k = 0; k < 6; k++) { const sd = k % 2, i = 1 + (k >> 1) % 2, q = top[sd][i], b = bot[sd][i], f = rr(0.25, 0.7); bush(lerp(q.x, b.x, f) + rr(-6, 6), lerp(q.y, b.y, f) + rr(-6, 6), rr(3, 4.5), 23); }
      }
      // --- пруд (с юга)
      {
        const px = slotX(tp), [b0, b1] = bandS(px), py = (b0 + b1) / 2, ry = Math.min(rr(19, 24), (b1 - b0) / 2 - 7), rx = rr(36, 46);
        const n = R() < 0.5 ? 5 : 6, a0 = rr(0, TAU), poly = [];
        for (let k = 0; k < n; k++) { const a = a0 + k * TAU / n + rr(-0.2, 0.2), f = rr(0.88, 1.08); poly.push({ x: Math.round(px + Math.cos(a) * rx * f), y: Math.round(py + Math.sin(a) * ry * f) }); }
        const ring = dense(poly, 3, true);
        pond = { poly, ring, x: px, y: py, rx, ry };
        wPolys.push(ring);
        obj('pond', 'Пруд', poly.map(q => pt(q.x, q.y, 'урез воды')), n, { poly });
        const ps = sdx(); S(16, c => Sym.pond(c, poly, ps));
        occAdd(px - rx * 1.12 - 4, py - ry * 1.12 - 4, px + rx * 1.12 + 4, py + ry * 1.12 + 4);
        let top = ring[0]; for (const q of ring) if (q.y < top.y) top = q;
        const sx = px + rr(-24, 24);
        branch({ x: sx, y: alleyY(sx) }, { x: top.x, y: top.y - 4 });
      }
      // --- холм (с севера)
      {
        const hx = slotX(th), [b0, b1] = bandN(hx), hy = (b0 + b1) / 2, half = (b1 - b0) / 2, K = Math.sqrt(Math.log(1 / 0.12));
        const hb = Math.min(rr(26, 32), (half - 3) / K), ha = rr(40, 50), hth = rr(-0.25, 0.25), HH = rr(2.6, 3.6);
        hill = { x: hx, y: hy, a: ha, b: hb, th: hth, H: HH };
        const ca = Math.cos(hth), sa = Math.sin(hth), feet = [];
        for (let k = 0; k < 4; k++) { const f = k * Math.PI / 2 + Math.PI / 4 + rr(-0.25, 0.25), lx = Math.cos(f) * ha * K, ly = Math.sin(f) * hb * K; feet.push(pt(hx + lx * ca - ly * sa, hy + lx * sa + ly * ca, 'подошва холма')); }
        obj('hill', 'Холм', [pt(hx, hy, 'вершина холма'), ...feet], 5, { x: hx, y: hy });
        const ms = sdx(), ell = ellipsePts(hx, hy, ha * K * 1.08, hb * K * 1.08, hth, 14);
        S(3, c => Sym.ground(c, 0, 0, 0, 0, 'meadow', ms, { poly: ell, edge: 8 }));
        reliefBoxes.push([hx - ha * K - 6, hy - ha * K - 6, hx + ha * K + 6, hy + ha * K + 6]);
        occAdd(hx - 12, hy - 12, hx + 12, hy + 12);
        for (const f of feet) occAdd(f.x - 9, f.y - 9, f.x + 9, f.y + 9);
      }
      // --- остальные места: детская площадка, роща, сквер с клумбой
      const fillers = shuffle(['playground', 'grove', 'square']), slots = [[tp, -1], [th, 1], [tr, 1]];
      fillers.forEach((kind, i) => {
        const [t, side] = slots[i], gx = slotX(t), [b0, b1] = side < 0 ? bandN(gx) : bandS(gx), gy = (b0 + b1) / 2, bh = b1 - b0;
        if (kind === 'playground') {
          const pw = Math.round(rr(40, 50)), ph = Math.round(Math.min(rr(30, 36), bh - 16)), x = Math.round(gx - pw / 2), y = Math.round(gy - ph / 2), ps = sdx();
          S(14, c => Sym.playground(c, x, y, pw, ph, ps));
          occAdd(x - 4, y - 4, x + pw + 4, y + ph + 4);
          obj('playground', 'Детская площадка', corners(x, y, pw, ph, 'угол площадки'), 3, { poly: rectPoly(x, y, pw, ph) });
          const sx = gx + rr(-14, 14);
          branch({ x: sx, y: alleyY(sx) }, { x: gx + rr(-10, 10), y: side < 0 ? y + ph + 1 : y - 1 });
        } else if (kind === 'grove') {
          const rx = rr(42, 56), ry = Math.max(14, Math.min(rr(24, 32), bh / 2 - 14)), mix = pickR(['birch', 'conifer', 'mix']), trees = [];
          for (let k = 0; k < 160 && trees.length < 9; k++) {
            const a = rr(0, TAU), f = Math.sqrt(R()) * 0.92, x = gx + Math.cos(a) * rx * f, y = gy + Math.sin(a) * ry * f, r = rr(8, 11.5);
            if (trees.some(q => hyp(q.x - x, q.y - y) < (q.r + r) * 0.72)) continue;
            trees.push({ x: Math.round(x), y: Math.round(y), r, kind: mix === 'mix' ? pickR(['birch', 'conifer', 'deciduous']) : mix });
          }
          const cont = ellipsePts(gx, gy, rx + 9, ry + 9, rr(-0.2, 0.2), 5).map(q => ({ x: Math.round(q.x + rr(-4, 4)), y: Math.round(clamp(q.y + rr(-3, 3), 7, WH - 7)) }));
          for (const q of trees) treeDecor(q.x, q.y, q.r, q.kind);
          occAdd(gx - rx - 6, gy - ry - 6, gx + rx + 6, gy + ry + 6);
          const label = mix === 'birch' ? 'берёза' : mix === 'conifer' ? 'ель' : 'смеш.';
          obj('grove', 'Роща', cont.map(q => pt(q.x, q.y, 'контур рощи')), 4, { poly: cont, trees: trees.slice(0, 4), label, kind: mix === 'mix' ? 'deciduous' : mix });
          for (let k = 0; k < 5; k++) { const a = rr(0, TAU); bush(gx + Math.cos(a) * (rx + 2), gy + Math.sin(a) * (ry + 2), rr(3, 5), 21); }
        } else {
          const r0 = Math.min(22, bh / 2 - 6), cxp = gx, cyp = side < 0 ? b1 - r0 + 4 : b0 + r0 - 4, ts = sdx();
          S(9, c => Sym.ground(c, 0, 0, 0, 0, 'tiles', ts, { poly: ellipsePts(cxp, cyp, r0 + 6, r0, 0, 16), edge: 1 }));
          const fw = Math.round(rr(14, 18)), fh = Math.round(rr(12, 16)), fs = sdx();
          S(14, c => Sym.flowerbed(c, cxp - fw / 2, cyp - fh / 2, fw, fh, fs));
          occAdd(cxp - r0 - 8, cyp - r0 - 2, cxp + r0 + 8, cyp + r0 + 2);
          obj('flowerbed', 'Клумба', [pt(cxp, cyp, 'клумба')], 1, { x: cxp, y: cyp, w: fw, h: fh });
          for (const sd of [-1, 1]) {
            const bx = Math.round(cxp + sd * (r0 - 2)), by = Math.round(cyp), rot = Math.PI / 2 * sd;
            wCircs.push({ x: bx, y: by, r: 2.6 });
            S(24, c => Sym.bench(c, bx, by, rot));
            obj('bench', 'Скамейка', [pt(bx, by, 'скамейка')], 1, { x: bx, y: by, rot: Math.PI / 2 });
          }
        }
      });
      for (const b of branches) {
        const e = [offAt(b.pts, 1, 4), offAt(b.pts, 1, -4)];
        obj('path', 'Дорожка', e.map(q => pt(q.x, q.y, 'край дорожки')), 2, { pts: b.pts, width: 8 });
        streets.push({ pts: b.pts, width: 8, kind: 'path', seed: sdx() });
        for (const q of b.D) occAdd(q.x - 6, q.y - 6, q.x + 6, q.y + 6);
      }
      // фонари вдоль аллеи (по разные стороны)
      let s = rr(40, 80), side = R() < 0.5 ? 1 : -1;
      while (s < AC[AC.length - 1] - 20) {
        const a = along(AD, AC, s), nx = -Math.sin(a.a), ny = Math.cos(a.a), x = Math.round(a.x + nx * side * (AW / 2 + 3)), y = Math.round(a.y + ny * side * (AW / 2 + 3));
        if (x > 10 && x < WW - 10 && !branches.some(b => hyp(b.pts[0].x - x, b.pts[0].y - y) < 16)) {
          const rot = Math.atan2(-ny * side, -nx * side);
          wCircs.push({ x, y, r: 1 });
          S(60, c => Sym.pole(c, x, y, 'lamp', rot));
          obj('lamp', 'Фонарь', [pt(x, y, 'фонарь')], 1, { x, y });
          side = -side; s += rr(190, 220);
        } else s += 18;
      }
      // скамейки и люки на аллее
      const nearAlley = (f, n, fn) => {
        for (let k = 0, t = 0; k < n && t < 80; t++) {
          const a = along(AD, AC, rr(50, AC[AC.length - 1] - 50)), sd = R() < 0.5 ? 1 : -1, nx = -Math.sin(a.a) * sd, ny = Math.cos(a.a) * sd;
          const x = Math.round(a.x + nx * f), y = Math.round(a.y + ny * f);
          if (x < 20 || x > WW - 20 || pts.some(p => hyp(p.x - x, p.y - y) < 20)) continue;
          if (fn(x, y, a, sd)) k++;
        }
      };
      nearAlley(AW / 2 + 3.5, 1, (x, y, a, sd) => {
        if (branches.some(b => dPoly(x, y, b.D) < 10)) return false;
        const rot = a.a + (sd > 0 ? Math.PI : 0);
        wCircs.push({ x, y, r: 2.6 });
        S(24, c => Sym.bench(c, x, y, rot));
        obj('bench', 'Скамейка', [pt(x, y, 'скамейка')], 1, { x, y, rot: a.a }); return true;
      });
      nearAlley(rr(-2, 2), ri(1, 2), (x, y) => {
        const kind = pickR(['storm', 'water', 'heat', 'tele']);
        S(14, c => Sym.manhole(c, x, y, kind, 2.2, rr(0, 3)));
        obj('manhole', 'Люк', [pt(x, y, NET_NAME[kind])], 1, { x, y, kind }); return true;
      });
      // отдельно стоящие деревья: берёзы, ели, липы
      const want = ri(5, 6);
      for (let t = 0, made = 0; t < 900 && made < want; t++) {
        const r = rr(9, 13), x = rr(14, WW - 14), y = rr(10, WH - 10);
        if (Math.abs(y - alleyY(x)) < AW / 2 + r * 0.7 + 4) continue;
        if (branches.some(b => dPoly(x, y, b.D) < 4 + r * 0.6 + 3)) continue;
        if (!occFree(x - r * 0.7, y - r * 0.7, x + r * 0.7, y + r * 0.7, 5)) continue;
        if (pts.some(p => hyp(p.x - x, p.y - y) < r + 10)) continue;
        if (hill && hyp((x - hill.x) / hill.a, (y - hill.y) / hill.b) < 0.8) continue;
        addTree(x, y, r, pickR(['birch', 'birch', 'conifer', 'conifer', 'deciduous', 'deciduous', 'deciduous'])); made++;
      }
      // живая изгородь вдоль аллеи — короткими кусками
      for (let k = 0, t = 0; k < 5 && t < 60; t++) {
        const s0 = rr(30, AC[AC.length - 1] - 90), sd = R() < 0.5 ? 1 : -1, n = ri(4, 7), list = [];
        for (let i = 0; i < n; i++) { const a = along(AD, AC, s0 + i * 7), x = a.x - Math.sin(a.a) * sd * (AW / 2 + 6), y = a.y + Math.cos(a.a) * sd * (AW / 2 + 6); list.push({ x, y }); }
        if (list.some(q => q.x < 6 || q.x > WW - 6 || !occFree(q.x - 3, q.y - 3, q.x + 3, q.y + 3, 1) || pts.some(p => hyp(p.x - q.x, p.y - q.y) < 11) || branches.some(b => dPoly(q.x, q.y, b.D) < 9))) continue;
        for (const q of list) { bush(q.x, q.y, rr(3, 3.8), 21); occAdd(q.x - 3, q.y - 3, q.x + 3, q.y + 3); }
        k++;
      }
      for (let k = 0; k < 6; k++) { const x = rr(20, WW - 20), y = rr(10, WH - 10), ms = sdx(), e = ellipsePts(x, y, rr(18, 34), rr(10, 18), rr(0, 3), 9); S(1, c => Sym.ground(c, 0, 0, 0, 0, 'meadow', ms, { poly: e, edge: 6 })); }
      for (let t = 0, n = 0; t < 400 && n < 26; t++) {
        const r = rr(3, 5.5), x = rr(10, WW - 10), y = rr(8, WH - 8);
        if (Math.abs(y - alleyY(x)) < AW / 2 + 6 || !occFree(x - r, y - r, x + r, y + r, 2) || pts.some(p => hyp(p.x - x, p.y - y) < 12)) continue;
        bush(x, y, r); n++;
      }
      // рельеф: холм (гауссов купол), овраг (выемка с плоским дном), общий уклон
      const hFn = (x, y) => {
        let h = H0 + x * 0.0012;
        if (hill) { const ca = Math.cos(hill.th), sa = Math.sin(hill.th), dx = x - hill.x, dy = y - hill.y, lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca; h += hill.H * Math.exp(-(lx * lx / (hill.a * hill.a) + ly * ly / (hill.b * hill.b))); }
        if (ravine) {
          const T = ravine.TH; let bd = Infinity, bi = 0, bt = 0;
          for (let i = 0; i < T.length - 1; i++) {
            const a = T[i], b = T[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy, t = clamp(((x - a.x) * dx + (y - a.y) * dy) / L2, 0, 1), d = hyp(a.x + dx * t - x, a.y + dy * t - y);
            if (d < bd) { bd = d; bi = i; bt = t; }
          }
          const Ew = lerp(ravine.E[bi], ravine.E[bi + 1], bt), Dp = lerp(ravine.D[bi], ravine.D[bi + 1], bt), wb = Math.min(ravine.wb, Ew * 0.3);
          if (bd < Ew && Dp > 0) { const s2 = bd <= wb ? 0 : (bd - wb) / (Ew - wb); h -= Dp * (1 - s2 * s2 * (3 - 2 * s2)); }
        }
        return h;
      };
      const HC = 4, HGW = Math.ceil(WW / HC) + 2, HGH = Math.ceil(WH / HC) + 2, hg = new Float32Array(HGW * HGH);
      for (let j = 0; j < HGH; j++) for (let i = 0; i < HGW; i++) hg[j * HGW + i] = hFn(i * HC, j * HC);
      hAt = (x, y) => {
        const fx = clamp(x / HC, 0, HGW - 1.001), fy = clamp(y / HC, 0, HGH - 1.001), i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, o = j * HGW + i;
        return (hg[o] * (1 - u) + hg[o + 1] * u) * (1 - v) + (hg[o + HGW] * (1 - u) + hg[o + HGW + 1] * u) * v;
      };
      pond.level = hAt(pond.x, pond.y) - 0.6;
      S(0, c => Sym.ground(c, 0, 0, WW, WH, 'grass', 21));
      S(5, c => Sym.hillshade(c, 0, 0, WW, WH, hAt, { cell: 3, z: 2.2, alpha: 0.5 }));
      S(10, c => Sym.roads(c, streets));
      heroStart = { x: rr(36, 56), y: 0 }; heroStart.y = alleyY(heroStart.x);
    }

    if (PARK) genPark(); else genVillage();

    // ---------- сетка проходимости ----------
    const GW = Math.ceil(WW / G), GH = Math.ceil(WH / G), N = GW * GH;
    const blocked = new Uint8Array(N), slow = new Float32Array(N).fill(1), reach = new Uint8Array(N);
    const cellOf = (x, y) => clamp(Math.floor(y / G), 0, GH - 1) * GW + clamp(Math.floor(x / G), 0, GW - 1);
    const cx = c => (c % GW + 0.5) * G, cy = c => (Math.floor(c / GW) + 0.5) * G;
    function rasterBox(x0, y0, x1, y1, test) {
      const i0 = clamp(Math.floor(x0 / G), 0, GW - 1), i1 = clamp(Math.ceil(x1 / G), 0, GW - 1), j0 = clamp(Math.floor(y0 / G), 0, GH - 1), j1 = clamp(Math.ceil(y1 / G), 0, GH - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = j * GW + i; if (!blocked[c] && test((i + 0.5) * G, (j + 0.5) * G)) blocked[c] = 1; }
    }
    for (const r of wRects) rasterBox(r.x0 - HR, r.y0 - HR, r.x1 + HR, r.y1 + HR, (x, y) => x > r.x0 - HR && x < r.x1 + HR && y > r.y0 - HR && y < r.y1 + HR);
    for (const s of wSegs) rasterBox(Math.min(s.ax, s.bx) - HR - 1, Math.min(s.ay, s.by) - HR - 1, Math.max(s.ax, s.bx) + HR + 1, Math.max(s.ay, s.by) + HR + 1, (x, y) => dSeg(x, y, s.ax, s.ay, s.bx, s.by) < s.r + HR);
    for (const c of wCircs) rasterBox(c.x - c.r - HR, c.y - c.r - HR, c.x + c.r + HR, c.y + c.r + HR, (x, y) => hyp(x - c.x, y - c.y) < c.r + HR);
    for (const p of wPolys) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
      rasterBox(x0 - HR, y0 - HR, x1 + HR, y1 + HR, (x, y) => inPoly(x, y, p) || dPoly(x, y, p, true) < HR - 0.5);
    }
    for (let c = 0; c < N; c++) { const x = cx(c), y = cy(c); if (x < 4 || x > WW - 4 || y < 4 || y > WH - 4) blocked[c] = 1; }
    if (relief) for (let c = 0; c < N; c++) {
      const x = cx(c), y = cy(c), g = hyp(hAt(x + 2, y) - hAt(x - 2, y), hAt(x, y + 2) - hAt(x, y - 2)) / (4 * MPU);
      slow[c] = clamp(1 - 1.1 * g, 0.45, 1);
    }
    const free = (x, y) => x >= 0 && y >= 0 && x < WW && y < WH && !blocked[cellOf(x, y)];
    // доступность от старта
    let hs = cellOf(heroStart.x, heroStart.y);
    if (blocked[hs]) { for (let r = 1; r < 20 && blocked[hs]; r++) for (let d = -r; d <= r; d++) { const c = cellOf(heroStart.x + d * G, heroStart.y - r * G); if (!blocked[c]) { hs = c; break; } } }
    { const q = [hs]; reach[hs] = 1; for (let k = 0; k < q.length; k++) { const c = q[k], i = c % GW, j = (c / GW) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue; const n = nj * GW + ni; if (!blocked[n] && !reach[n]) { reach[n] = 1; q.push(n); } } } }

    // ---------- поиск пути (A*), сглаживание ----------
    const gMark = new Uint32Array(N), gCost = new Float32Array(N), gFrom = new Int32Array(N), gDone = new Uint32Array(N);
    let stamp = 0;
    const hpC = [], hpF = [];
    function hpush(c, f) { let i = hpC.length; hpC.push(c); hpF.push(f); while (i > 0) { const p = (i - 1) >> 1; if (hpF[p] <= f) break; hpC[i] = hpC[p]; hpF[i] = hpF[p]; i = p; } hpC[i] = c; hpF[i] = f; }
    function hpop() {
      const top = hpC[0], lc = hpC.pop(), lf = hpF.pop(), n = hpC.length;
      if (n) { let i = 0; for (;;) { let m = 2 * i + 1; if (m >= n) break; if (m + 1 < n && hpF[m + 1] < hpF[m]) m++; if (hpF[m] >= lf) break; hpC[i] = hpC[m]; hpF[i] = hpF[m]; i = m; } hpC[i] = lc; hpF[i] = lf; }
      return top;
    }
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    function astar(s, e) {
      if (s < 0 || e < 0 || blocked[e] || blocked[s]) return null;
      const st = ++stamp, ex = e % GW, ey = (e / GW) | 0;
      const heur = c => { const dx = Math.abs(c % GW - ex), dy = Math.abs(((c / GW) | 0) - ey); return dx + dy - 0.5858 * Math.min(dx, dy); };
      hpC.length = 0; hpF.length = 0;
      gMark[s] = st; gCost[s] = 0; gFrom[s] = -1; hpush(s, heur(s));
      let it = 0;
      while (hpC.length && it++ < 40000) {
        const c = hpop();
        if (c === e) break;
        if (gDone[c] === st) continue; gDone[c] = st;
        const i = c % GW, j = (c / GW) | 0;
        for (const [di, dj, w] of NB) {
          const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const n = nj * GW + ni; if (blocked[n]) continue;
          if (di && dj && (blocked[j * GW + ni] || blocked[nj * GW + i])) continue;
          const nc = gCost[c] + w / slow[n];
          if (gMark[n] !== st || nc < gCost[n]) { gMark[n] = st; gCost[n] = nc; gFrom[n] = c; hpush(n, nc + heur(n)); }
        }
      }
      if (gMark[e] !== st) return null;
      const out = []; for (let c = e; c !== -1; c = gFrom[c]) out.push(c);
      return out.reverse();
    }
    function walkLine(ax, ay, bx, by) {
      const L = hyp(bx - ax, by - ay), n = Math.ceil(L / (G * 0.5));
      for (let k = 1; k <= n; k++) { const t = k / n; if (!free(ax + (bx - ax) * t, ay + (by - ay) * t)) return false; }
      return true;
    }
    function smooth(cells, sx, sy) { // «натягивание нити»: срезаем углы, пока прямая свободна
      const P = cells.map(c => ({ x: cx(c), y: cy(c) })), out = [];
      let cur = { x: sx, y: sy }, i = 0;
      while (i < P.length) {
        let j = i;
        for (let k = i + 1; k < P.length; k++) { if (walkLine(cur.x, cur.y, P[k].x, P[k].y)) j = k; else if (k - j > 8) break; }
        out.push(P[j]); cur = P[j]; i = j + 1;
      }
      return out;
    }
    function nearestFree(x, y, maxR) {
      const i0 = Math.floor(x / G), j0 = Math.floor(y / G);
      let best = -1, bd = Infinity;
      for (let r = 0; r <= (maxR || 24); r++) {
        for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
          const c = j * GW + i; if (blocked[c] || !reach[c]) continue;
          const d = hyp(cx(c) - x, cy(c) - y); if (d < bd) { bd = d; best = c; }
        }
        if (best >= 0 && r * G > bd + G) break;
      }
      return best;
    }

    // ---------- видимость ----------
    const dyn = [];   // подвижные помехи: { x, y, r, what }
    function sight(ax, ay, bx, by, withDyn, hb) {
      let best = 2, what = null;
      const mnx = Math.min(ax, bx), mxx = Math.max(ax, bx), mny = Math.min(ay, by), mxy = Math.max(ay, by);
      for (const r of lRects) {
        if (r.x1 < mnx || r.x0 > mxx || r.y1 < mny || r.y0 > mxy) continue;
        if (clipSeg(ax, ay, bx, by, r.x0, r.y0, r.x1, r.y1) && CLIP[0] < best) { best = CLIP[0]; what = r.what; }
      }
      const circ = list => {
        for (const c of list) {
          if (c.x + c.r < mnx || c.x - c.r > mxx || c.y + c.r < mny || c.y - c.r > mxy) continue;
          if (hyp(ax - c.x, ay - c.y) < c.r || hyp(bx - c.x, by - c.y) < c.r) continue;   // из-под кроны — видно
          const t = segCircT(ax, ay, bx, by, c.x, c.y, c.r);
          if (t >= 0 && t < best) { best = t; what = c.what; }
        }
      };
      circ(lCircs);
      if (withDyn) circ(dyn);
      if (relief) {
        const za = hAt(ax, ay) + HI, zb = hAt(bx, by) + (hb || HV), L = hyp(bx - ax, by - ay);
        for (const b of reliefBoxes) {
          if (!clipSeg(ax, ay, bx, by, b[0], b[1], b[2], b[3])) continue;
          const t0 = CLIP[0], t1 = Math.min(CLIP[1], best), n = Math.max(1, Math.ceil(L * (t1 - t0) / 4));
          for (let k = 0; k <= n; k++) {
            const t = lerp(t0, t1, k / n), d = t * L;
            if (d < 3 || L - d < 3 || t >= best) continue;
            if (hAt(ax + (bx - ax) * t, ay + (by - ay) * t) > lerp(za, zb, t) - 0.08) { best = t; what = 'рельеф'; break; }
          }
        }
      }
      return best <= 1 ? { t: best, what } : null;
    }

    // ---------- решаемость: где стоять у точек, откуда их видно, цепочка станций ----------
    for (const p of pts) {
      const i0 = Math.floor(p.x / G), j0 = Math.floor(p.y / G), rad = Math.ceil(SNAP / G) + 1, list = [];
      for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
        const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
        const c = j * GW + i; if (!reach[c]) continue;
        const d = hyp(cx(c) - p.x, cy(c) - p.y); if (d <= SNAP - 1.2) list.push([d, c]);
      }
      list.sort((a, b) => a[0] - b[0]);
      const st = [];   // точки стояния: ближайшие, но разнесённые (чтобы было откуда увидеть)
      for (const [, c] of list) { if (st.length >= 5) break; if (st.every(s => hyp(cx(s) - cx(c), cy(s) - cy(c)) > 3.5)) st.push(c); }
      p.stand = st; p.dead = !st.length;
      p.h = hAt(p.x, p.y);
    }
    function stationOk(x, y) {
      const c = cellOf(x, y);
      if (blocked[c] || !reach[c] || onLane(x, y)) return false;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (blocked[c + dj * GW + di]) return false;
      return true;
    }
    const cands = [];
    for (let y = 8; y < WH - 5; y += 16) for (let x = 8; x < WW - 5; x += 16) {
      const c = cellOf(x, y); if (!stationOk(cx(c), cy(c))) continue;
      cands.push({ x: cx(c), y: cy(c), vis: [], ok: false, i: cands.length, adj: null });
    }
    const shoot = (sx, sy, x, y) => hyp(x - sx, y - sy) <= RANGE - 1 && !sight(sx, sy, x, y);
    const visFrom = (sx, sy, p) => { for (let k = 0; k < Math.min(3, p.stand.length); k++) if (shoot(sx, sy, cx(p.stand[k]), cy(p.stand[k]))) return true; return false; };
    const livePts = pts.filter(p => !p.dead);
    for (const cd of cands) for (const p of livePts) if (visFrom(cd.x, cd.y, p)) cd.vis.push(p.i);
    const adjOf = a => a.adj || (a.adj = cands.filter(b => b !== a && !sight(a.x, a.y, b.x, b.y, false, HI)));
    // первая станция — у дороги/аллеи в начале участка, откуда видно больше всего
    let s0 = null;
    for (const cd of cands) {
      if (cd.x > Math.min(api.W, 640) / Z * 0.7 || Math.abs(cd.y - laneY(cd.x)) > 34) continue;
      if (!s0 || cd.vis.length > s0.vis.length) s0 = cd;
    }
    if (!s0) s0 = cands.length ? cands.reduce((a, b) => (b.vis.length > a.vis.length ? b : a)) : { x: cx(hs), y: cy(hs), vis: [], ok: true, i: -1, adj: [] };
    { // ход: места станций, достижимые цепочкой взаимной видимости от первой
      const q = [s0]; s0.ok = true;
      let left = cands.length - 1;
      for (let k = 0; k < q.length && k < 120 && left > 0; k++) for (const b of adjOf(q[k])) if (!b.ok) { b.ok = true; q.push(b); left--; }
    }
    const seen = new Uint8Array(pts.length);
    for (const cd of cands) if (cd.ok) for (const i of cd.vis) seen[i] = 1;
    for (const p of pts) if (!seen[p.i]) p.dead = true;
    let NEED = 0;
    for (const o of objs) {
      const live = o.pts.filter(p => !p.dead).length;
      o.need = Math.min(o.need, live);
      if (!o.need) o.dead = true; else NEED += o.need;
    }
    const liveObjs = objs.filter(o => !o.dead);

    // ---------- статичный слой мира: рисуется один раз под масштаб экрана ----------
    statics.sort((a, b) => a.z - b.z || a.i - b.i);
    let layer = null, layerFail = 0;
    function buildLayer(k) {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(WW * k); cv.height = Math.ceil(WH * k);
      const c = cv.getContext('2d'); c.setTransform(k, 0, 0, k, 0, 0);
      const was = Sym.cache; Sym.cache = false;
      try { for (const s of statics) s.f(c); Sym.marker(c, s0.x, s0.y, 'benchmark'); } catch (e) { console.error(e); } finally { Sym.cache = was; }
      layer = { c: cv, k };
    }
    const gameCanvas = typeof document !== 'undefined' && document.getElementById('game');
    const k0 = gameCanvas && gameCanvas.width ? gameCanvas.width / api.W : 2;
    buildLayer(clamp(k0, 1, 3) * Z);

    // ---------- состояние уровня ----------
    const hero = { x: cx(hs), y: cy(hs), dir: 0, ph: 0, walk: false };
    let time = 0, over = false, finT = -1, path = null, walkPtr = null, lastRepath = -1, goal = null, tapFx = null;
    const keys = { l: 0, r: 0, u: 0, d: 0 };
    let st = { x: s0.x, y: s0.y }, stNo = 1, aim = Math.atan2(hero.y - s0.y, hero.x - s0.x);
    const stations = [{ x: s0.x, y: s0.y, n: 1, left: false }];
    let moving = null, placing = false, preview = null, prevPtr = null, prevInfo = null;
    let picketNo = 0, extra = 0, got = 0, doneAt = -1, failFx = 0, okFx = 0, stepT = 0, nearPt = null, nearVis = null;
    const extras = [], rings = [];
    let lastMeas = null, mmDirty = true, mmLayer = null, mmKey = '', heroSlow = 1, slowMsgT = 0;
    let fails = 0, hintT = 0, nothingHere = false;   // подсказки новичку
    const VW = () => api.W / Z;
    let camX = clamp(hero.x - VW() / 2, 0, Math.max(0, WW - VW()));
    const partner = { x: s0.x - 7, y: s0.y + 4, dir: 0, ph: 0 };

    // ---------- помехи ----------
    const R2 = api.rng(seed ^ 0x5bd1e995), r2 = (a, b) => a + R2() * (b - a);
    const dog = !PARK && dogHome ? { x: (dogHome.x0 + dogHome.x1) / 2, y: (dogHome.y0 + dogHome.y1) / 2, dir: 0, tx: 0, ty: 0, wait: 0, bark: 0, said: 0, lunge: 2, ph: 0, color: ['#b5783e', '#3b3330', '#d9c8a8', '#8a6a4a'][Math.floor(R2() * 4)] } : null;
    if (dog) { const c = nearestFree(dog.x, dog.y, 30); if (c >= 0) { dog.x = cx(c); dog.y = cy(c); } dog.tx = dog.x; dog.ty = dog.y; }
    const laneC = lanes.map(l => cum(l));
    let car = null, carT = r2(4, 8);
    const runners = [];
    if (PARK) for (let k = 0; k < 3; k++) {
      const li = k % 2, L = laneC[li][laneC[li].length - 1];
      runners.push({ lane: li, s: r2(0.1, 0.9) * L, dir: R2() < 0.5 ? 1 : -1, v: k === 2 ? r2(70, 85) : r2(28, 36), bike: k === 2, seed: Math.floor(R2() * 1e6), x: 0, y: 0, a: 0, ph: R2() * 9 });
    }
    const ducks = [];
    if (PARK && pond) for (let k = 0; k < 4; k++) {
      const q = pond.ring[Math.floor(R2() * pond.ring.length)], dx = q.x - pond.x, dy = q.y - pond.y, L = hyp(dx, dy) || 1;
      const hx = q.x + dx / L * 4, hy = q.y + dy / L * 4;
      ducks.push({ x: hx, y: hy, hx, hy, dir: R2() * TAU, state: 'shore', t: r2(0, 3), tx: hx, ty: hy, scare: 0, col: k % 2 });
    }
    function updDyn() {
      dyn.length = 0;
      if (car) { const ca = Math.cos(car.a), sa = Math.sin(car.a); for (const o of [-6, 0, 6]) dyn.push({ x: car.x + ca * o, y: car.y + sa * o, r: 4.2, what: 'машина' }); }
      for (const r of runners) dyn.push({ x: r.x, y: r.y, r: r.bike ? 4 : 3.2, what: r.bike ? 'велосипедист' : 'бегун' });
    }

    // ---------- действия ----------
    const W = () => api.W;
    const btnP = () => ({ x: W() - 118, y: api.H - 68, w: 110, h: 60 });
    const btnS = () => ({ x: W() - 118, y: api.H - 68 - 52, w: 110, h: 44 });
    const mmRect = () => { const w = Math.round(Math.min(220, W() * 0.3)), h = Math.round(w * WH / WW); return { x: W() - w - 8, y: TOP + 6, w, h }; };
    const mmUnder = mr => { const sx = (hero.x - camX) * Z, sy = TOP + hero.y * Z; return sx > mr.x - 14 && sx < mr.x + mr.w + 14 && sy < mr.y + mr.h + 30; };
    const toScreen = (x, y) => ({ x: (x - camX) * Z, y: TOP + y * Z });
    const toWorld = p => ({ x: p.x / Z + camX, y: clamp((p.y - TOP) / Z, 0, WH) });
    const MC = document.createElement('canvas').getContext('2d');   // мерить ширину всплывающих надписей
    MC.font = 'bold 13px system-ui, sans-serif';
    const pops = [];   // недавние надписи — чтобы новые не ложились поверх
    const popW = (x, y, t, col) => {
      const s = toScreen(x, y), hw = MC.measureText(t).width / 2 + 6, px = clamp(s.x, hw, W() - hw);
      let py = clamp(s.y - 16, TOP + 30, api.H - 20);
      for (let k = 0; k < 4; k++) { if (!pops.some(q => api.now - q.t < 1 && Math.abs(q.y - py) < 14 && Math.abs(q.x - px) < q.hw + hw)) break; py -= 15; }
      pops.push({ t: api.now, x: px, y: py, hw }); if (pops.length > 8) pops.shift();
      api.popup(px, py, t, col);
    };
    function walkTo(x, y) {
      let gc = cellOf(x, y), exact = true;
      if (blocked[gc] || !reach[gc]) { gc = nearestFree(x, y); exact = false; if (gc < 0) return false; }
      const sc = blocked[cellOf(hero.x, hero.y)] ? nearestFree(hero.x, hero.y) : cellOf(hero.x, hero.y);
      const cells = astar(sc, gc); if (!cells) return false;
      path = smooth(cells, hero.x, hero.y);
      if (exact && path.length) path[path.length - 1] = { x, y };
      goal = path.length ? path[path.length - 1] : null;
      return true;
    }
    const objOpen = p => p.objs.some(o => !o.dead && !o.done);
    function nearestUntaken(x, y, lim) {
      let b = null, bd = lim;
      for (const p of pts) { if (p.taken || p.dead || !objOpen(p)) continue; const d = hyp(p.x - x, p.y - y); if (d < bd) { bd = d; b = p; } }
      return b;
    }
    function nearestAny(x, y, lim) { let b = null, bd = lim; for (const p of pts) { if (p.dead) continue; const d = hyp(p.x - x, p.y - y); if (d < bd) { bd = d; b = p; } } return b; }
    function measure(x, y, name, num) {
      const dx = x - st.x, dy = y - st.y;
      lastMeas = { st: stNo, pk: num, name, hz: dms(Math.atan2(dx, -dy) * 180 / Math.PI), s: fmt(hyp(dx, dy) * MPU, 2), h: fmt(hAt(x, y), 2) };
    }
    function picket() {
      if (over) return;
      if (moving) { api.sfx('warn'); popW(hero.x, hero.y, 'Станция ещё в пути…', api.theme.accent); return; }
      if (placing) { placing = false; preview = null; }
      const dist = hyp(hero.x - st.x, hero.y - st.y);
      if (dist > RANGE) { api.sfx('bad'); failFx = 1.1; fails++; popW(hero.x, hero.y, `Далеко: ${fmt(dist * MPU, 1)} м — норма до 60 м`, api.theme.bad); return; }
      const blk = sight(st.x, st.y, hero.x, hero.y, true);
      if (blk) {
        api.sfx('bad'); failFx = 1.1; fails++;
        popW(hero.x, hero.y, 'Нет видимости!' + (blk.what ? ' (' + blk.what + ')' : ''), api.theme.bad);
        return;
      }
      const duck = ducks.find(d => d.state === 'shore' && hyp(d.x - hero.x, d.y - hero.y) < 7);
      if (duck) { duck.scare = 0.01; api.sfx('warn'); popW(hero.x, hero.y, 'Утка мешает поставить веху!', api.theme.accent); return; }
      const p = nearestUntaken(hero.x, hero.y, SNAP);
      if (!p) {
        const q = nearestAny(hero.x, hero.y, SNAP);
        if (q) { api.sfx('warn'); popW(hero.x, hero.y, q.taken ? 'Эта точка уже снята' : q.objs[0].name + ' уже на плане', api.theme.accent); return; }
        picketNo++; extra++;
        measure(hero.x, hero.y, 'лишний', picketNo);
        extras.push({ x: hero.x, y: hero.y, n: picketNo });
        api.sfx('bad'); api.shake(2);
        popW(hero.x, hero.y, 'Лишний пикет: тут нет характерной точки', api.theme.bad);
        return;
      }
      picketNo++; p.taken = true; p.num = picketNo; okFx = 0.5;
      measure(p.x, p.y, p.name, picketNo);
      rings.push({ x: p.x, y: p.y, t: 0 });
      api.sfx('point');
      const s = toScreen(p.x, p.y); api.burst(s.x, s.y, '#ffe27a', 8);
      let completed = null;
      for (const o of p.objs) {
        if (o.dead || o.done) continue;
        o.got++; got++;
        if (o.got >= o.need) { o.done = true; o.flash = 1.5; completed = o; }
      }
      mmDirty = true;
      if (completed && completed.pts.length > 1) { setTimeout(() => api.sfx('good'), 90); popW(p.x, p.y, completed.name + ' — на плане!', api.theme.good); }
      else popW(p.x, p.y, 'Пк ' + picketNo + ' · ' + p.name, '#ffe27a');
      if (got >= NEED && doneAt < 0) { doneAt = time; finT = time + 0.9; popW(hero.x, hero.y - 16, 'Съёмка завершена!', api.theme.good); }
    }
    function stationInfo(x, y) {
      if (x < 6 || x > WW - 6 || y < 6 || y > WH - 6) return { ok: false, why: 'За границей съёмки' };
      const c = cellOf(x, y);
      if (pond && inPoly(x, y, pond.ring)) return { ok: false, why: 'В воду нельзя!' };
      if (blocked[c] || !reach[c]) return { ok: false, why: lRects.some(r => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) ? 'Внутри строения нельзя!' : 'Здесь штатив не встанет' };
      if (onLane(x, y)) return { ok: false, why: PARK ? 'Не на дорожке — тут ходят люди' : 'Не на проезжей части!' };
      const b = sight(st.x, st.y, x, y, false, HI);
      if (b) return { ok: false, why: 'Не видно прежнюю станцию' + (b.what ? ' (' + b.what + ')' : ''), hit: { x: lerp(st.x, x, b.t), y: lerp(st.y, y, b.t) } };
      let n = 0;
      for (const p of pts) if (!p.taken && !p.dead && objOpen(p) && visFrom(x, y, p)) n++;
      return { ok: true, n };
    }
    function toggleStation() {
      if (over) return;
      if (moving) { api.sfx('warn'); popW(hero.x, hero.y, 'Станция уже переносится', api.theme.accent); return; }
      placing = !placing; preview = null; prevPtr = null;
      api.sfx('select');
    }
    function placeStation(x, y) {
      const inf = stationInfo(x, y);
      if (!inf.ok) { api.sfx('bad'); popW(x, y, inf.why, api.theme.bad); preview = null; return false; }
      const from = cellOf(partner.x, partner.y);
      const cells = astar(blocked[from] ? nearestFree(partner.x, partner.y) : from, cellOf(x, y));
      const P = cells ? [{ x: partner.x, y: partner.y }, ...smooth(cells, partner.x, partner.y)] : [{ x: partner.x, y: partner.y }, { x, y }];
      P[P.length - 1] = { x, y };
      const C = cum(P);
      moving = { P, C, t: 0, dur: clamp(5 + C[C.length - 1] / 500, 5, 6), to: { x, y } };
      stations[stations.length - 1].left = true;
      placing = false; preview = null;
      api.sfx('select');
      popW(x, y, 'Перенос станции' + (inf.n ? ' · видно точек: ' + inf.n : ''), api.theme.accent);
      return true;
    }

    // ---------- обновление ----------
    function moveHero(dx, dy) {
      const nx = hero.x + dx, ny = hero.y + dy;
      if (free(nx, ny)) { hero.x = nx; hero.y = ny; return true; }
      if (dx && free(hero.x + dx, hero.y)) { hero.x += dx; return true; }
      if (dy && free(hero.x, hero.y + dy)) { hero.y += dy; return true; }
      return false;
    }
    function turn(a, b, k) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * k; }
    function finish() {
      if (over) return; over = true;
      const c = NEED ? got / NEED : 1, full = got >= NEED;
      const tLeft = full ? Math.max(0, T_LEVEL - doneAt) : 0, bonus = full ? Math.round(200 * tLeft / T_LEVEL) : 0;
      const pen = Math.min(150, extra * 15) + Math.max(0, stNo - 6) * 10;
      const score = clamp(Math.round(800 * c + bonus - pen), 0, 1000);
      const stars = score >= 820 ? 3 : score >= 600 ? 2 : score >= 380 ? 1 : 0;
      const doneObjs = liveObjs.filter(o => o.done).length;
      api.finish({
        score, stars, drawResult,
        lines: [
          `Полнота съёмки: ${Math.round(c * 100)} % (${got} из ${NEED} точек)`,
          `Пикетов: ${picketNo} · лишних: ${extra} · станций: ${stNo}`,
          `На плане объектов: ${doneObjs} из ${liveObjs.length}`,
          full ? `Сдано за ${mmss(doneAt)} · премия за время +${bonus}` : 'Время вышло — план неполный',
        ],
      });
    }
    function update(dt) {
      if (over) return;
      time += dt;
      for (const o of objs) if (o.flash > 0) o.flash -= dt;
      failFx = Math.max(0, failFx - dt); okFx = Math.max(0, okFx - dt);
      for (const r of rings) r.t += dt;
      while (rings.length && rings[0].t > 1) rings.shift();
      if (tapFx) { tapFx.t += dt; if (tapFx.t > 0.6) tapFx = null; }
      // реечник
      heroSlow = 1;
      if (dog && hyp(dog.x - hero.x, dog.y - hero.y) < 11) {
        heroSlow = 0.5;
        if (time > slowMsgT) { slowMsgT = time + 4; popW(hero.x, hero.y - 8, 'Собака не даёт пройти!', api.theme.accent); }
      }
      const sp = SPEED * slow[cellOf(hero.x, hero.y)] * heroSlow * dt;
      const kx = keys.r - keys.l, ky = keys.d - keys.u;
      let mv = false;
      if (kx || ky) {
        path = null; goal = null;
        const L = hyp(kx, ky); mv = moveHero(kx / L * sp, ky / L * sp);
        hero.dir = turn(hero.dir, Math.atan2(ky, kx), Math.min(1, dt * 14));
      } else if (path && path.length) {
        let left = sp;
        while (left > 0 && path.length) {
          const wp = path[0], dx = wp.x - hero.x, dy = wp.y - hero.y, d = hyp(dx, dy);
          if (d > 0.01) hero.dir = turn(hero.dir, Math.atan2(dy, dx), Math.min(1, dt * 14));
          if (d <= left) { hero.x = wp.x; hero.y = wp.y; left -= d; path.shift(); }
          else { hero.x += dx / d * left; hero.y += dy / d * left; left = 0; }
        }
        mv = true;
        if (!path.length) { path = null; goal = null; }
      }
      hero.walk = mv;
      if (mv) { hero.ph += dt; stepT -= dt; if (stepT <= 0) { stepT = 0.34; api.sfx('step'); } }
      // камера
      camX += (clamp(hero.x - VW() / 2, 0, Math.max(0, WW - VW())) - camX) * Math.min(1, dt * 5);
      // собака: бегает по двору; на чужого — лает издали и время от времени кидается под ноги
      if (dog) {
        const h = dogHome, dh = hyp(hero.x - dog.x, hero.y - dog.y);
        const near = hero.x > h.x0 - 26 && hero.x < h.x1 + 26 && hero.y > h.y0 - 26 && hero.y < h.y1 + 30 && dh < 70;
        dog.bark -= dt;
        let tx = dog.tx, ty = dog.ty, v = 28;
        if (near) {
          dog.lunge -= dt; if (dog.lunge < -0.7) dog.lunge = r2(2.5, 4);
          const want = dog.lunge < 0 ? 6 : 15, ang = Math.atan2(dog.y - hero.y, dog.x - hero.x) + 0.6 * dt;
          tx = clamp(hero.x + Math.cos(ang) * want, h.x0, h.x1); ty = clamp(hero.y + Math.sin(ang) * want, h.y0, h.y1); v = dog.lunge < 0 ? 75 : 45;
          if (dog.bark <= 0) { dog.bark = 1.3; api.sfx('bark'); if (++dog.said % 2) popW(dog.x, dog.y - 6, 'Гав! Гав!', '#ffd76a'); }
        } else {
          dog.wait -= dt;
          if (dog.wait <= 0 && hyp(dog.tx - dog.x, dog.ty - dog.y) < 2) { dog.tx = r2(h.x0, h.x1); dog.ty = r2(h.y0, h.y1); dog.wait = r2(0.6, 2.2); }
        }
        const dx = tx - dog.x, dy = ty - dog.y, d = hyp(dx, dy);
        if (d > 1) {
          const s2 = Math.min(d, v * dt), nx = dog.x + dx / d * s2, ny = dog.y + dy / d * s2;
          if (free(nx, ny) || !free(dog.x, dog.y)) { dog.x = nx; dog.y = ny; } else { dog.tx = r2(h.x0, h.x1); dog.ty = r2(h.y0, h.y1); }
          dog.dir = turn(dog.dir, Math.atan2(dy, dx), Math.min(1, dt * 10)); dog.ph += dt;
        } else if (near) dog.dir = turn(dog.dir, Math.atan2(hero.y - dog.y, hero.x - dog.x), Math.min(1, dt * 8));
      }
      // машина по улице: тормозит перед реечником, сигналит
      if (!PARK) {
        carT -= dt;
        if (!car && carT <= 0) {
          const li = R2() < 0.5 ? 0 : 1, L = laneC[li][laneC[li].length - 1];
          car = { li, s: li === 0 ? 0 : L, dir: li === 0 ? 1 : -1, v: 0, vmax: r2(80, 100), x: -50, y: 0, a: 0, seed: Math.floor(R2() * 1e6), col: CARS[Math.floor(R2() * CARS.length)], snd: false, horn: 0, off: 0, offT: 0, wait: 0 };
          car.v = car.vmax;
        }
        if (car) {
          const lane = lanes[car.li], C = laneC[car.li], L = C[C.length - 1];
          // реечник на пути: притормозить, посигналить и объехать его по обочине
          const a0 = along(lane, C, car.s), ca = Math.cos(a0.a), sa = Math.sin(a0.a);
          const fwd = ((hero.x - a0.x) * ca + (hero.y - a0.y) * sa) * car.dir, lat = -(hero.x - a0.x) * sa + (hero.y - a0.y) * ca;
          const inPath = fwd > -6 && fwd < 26 && Math.abs(lat - car.off) < 8.5;
          if (inPath) { car.wait += dt; car.offT = clamp(lat > 0 ? lat - 12 : lat + 12, -10, 10); }
          else { car.wait = 0; car.offT = Math.abs(lat - car.off) < 12 && fwd > -12 && fwd < 30 ? car.offT : 0; }
          car.off += clamp(car.offT - car.off, -14 * dt, 14 * dt);
          car.v = inPath ? (car.wait < 1.2 ? Math.max(0, car.v - 260 * dt) : Math.min(16, car.v + 40 * dt)) : Math.min(car.vmax, car.v + 120 * dt);
          car.horn -= dt;
          if (inPath && car.horn <= 0) { car.horn = 2.5; api.sfx('warn'); popW(car.x, car.y - 8, 'Би-бип!', '#ffd76a'); }
          car.s += car.dir * car.v * dt;
          const a = along(lane, C, car.s); car.x = a.x - Math.sin(a.a) * car.off; car.y = a.y + Math.cos(a.a) * car.off; car.a = a.a + (car.dir < 0 ? Math.PI : 0);
          if (!car.snd && car.x > camX - 40 && car.x < camX + VW() + 40) { car.snd = true; api.sfx('car'); }
          if (car.s < -30 || car.s > L + 30) { car = null; carT = r2(7, 13); }
        }
      }
      // бегуны и велосипедист на аллее
      for (const r of runners) {
        const C = laneC[r.lane], L = C[C.length - 1];
        r.s += r.dir * r.v * dt;
        if (r.s < 0 || r.s > L) { r.dir = -r.dir; r.lane = 1 - r.lane; r.s = clamp(r.s, 0, laneC[r.lane][laneC[r.lane].length - 1]); }
        const a = along(lanes[r.lane], laneC[r.lane], r.s); r.x = a.x; r.y = a.y; r.a = a.a + (r.dir < 0 ? Math.PI : 0); r.ph += dt * (r.bike ? 0.6 : 1.6);
      }
      // утки: сидят у уреза, при подходе — в воду
      for (const d of ducks) {
        const dh = hyp(hero.x - d.x, hero.y - d.y);
        if (d.state === 'shore' && (dh < 13 || d.scare > 0)) {
          d.scare += dt;
          if (d.scare > 0.45 || dh < 8) {
            d.state = 'swim'; d.t = r2(6, 10);
            const a = Math.atan2(pond.y - d.y, pond.x - d.x); d.tx = pond.x + Math.cos(a + r2(-0.6, 0.6)) * pond.rx * 0.3; d.ty = pond.y + Math.sin(a) * pond.ry * 0.3;
            api.sfx('splash'); popW(d.x, d.y - 4, 'Кря!', '#ffd76a'); d.scare = 0;
          }
        } else if (d.state === 'swim') {
          d.t -= dt;
          if (d.t <= 0 && hyp(hero.x - d.hx, hero.y - d.hy) > 30) { d.state = 'back'; d.tx = d.hx; d.ty = d.hy; }
          else if (hyp(d.tx - d.x, d.ty - d.y) < 1) { d.tx = pond.x + r2(-0.5, 0.5) * pond.rx; d.ty = pond.y + r2(-0.4, 0.4) * pond.ry; }
        } else if (d.state === 'back' && hyp(d.tx - d.x, d.ty - d.y) < 1) { d.state = 'shore'; d.scare = 0; }
        else if (d.state === 'shore') { d.t -= dt; if (d.t <= 0) { d.t = r2(1.5, 4); d.tx = d.hx + r2(-3, 3); d.ty = d.hy + r2(-3, 3); } }
        const dx = d.tx - d.x, dy = d.ty - d.y, dd = hyp(dx, dy), v = d.state === 'shore' ? 4 : 16;
        if (dd > 0.3) { const s2 = Math.min(dd, v * dt); d.x += dx / dd * s2; d.y += dy / dd * s2; d.dir = turn(d.dir, Math.atan2(dy, dx), Math.min(1, dt * 6)); }
      }
      updDyn();
      // перенос станции: свернуть штатив, дойти, установить, отгоризонтировать и сориентировать
      if (moving) {
        moving.t += dt;
        const f = clamp(moving.t / moving.dur, 0, 1), L = moving.C[moving.C.length - 1], wf = clamp((f - 0.12) / 0.7, 0, 1);
        const a = along(moving.P, moving.C, wf * L);
        if (wf > 0 && wf < 1) { partner.dir = turn(partner.dir, a.a, Math.min(1, dt * 10)); partner.ph += dt; }
        partner.x = a.x; partner.y = a.y;
        if (f >= 1) {
          st = { x: moving.to.x, y: moving.to.y }; stNo++; moving = null;
          stations.push({ x: st.x, y: st.y, n: stNo, left: false });
          api.sfx('station'); setTimeout(() => api.sfx('measure'), 260); popW(st.x, st.y, 'Станция ' + stNo + ' готова', api.theme.good);
        }
      }
      if (!moving) {
        aim = turn(aim, Math.atan2(hero.y - st.y, hero.x - st.x), Math.min(1, dt * 6));
        partner.x = st.x - Math.cos(aim) * 7; partner.y = st.y - Math.sin(aim) * 7; partner.dir = aim;
      }
      nearPt = moving ? null : nearestUntaken(hero.x, hero.y, SNAP);
      hintT -= dt;
      if (hintT <= 0) { // со станции больше ничего не снять?
        hintT = 0.5;
        nothingHere = !moving && !pts.some(p => !p.taken && !p.dead && objOpen(p) && visFrom(st.x, st.y, p));
      }
      if (moving) nearVis = null;
      else { const d = hyp(hero.x - st.x, hero.y - st.y); nearVis = d > RANGE ? { t: RANGE / d, what: 'далеко', far: true } : sight(st.x, st.y, hero.x, hero.y, true); }
      if (time >= T_LEVEL) finish();
      else if (finT >= 0 && time >= finT) finish();
    }

    // ---------- отрисовка ----------
    const poly = (ctx, p, close) => { ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); if (close) ctx.closePath(); };
    function draw(ctx) {
      const t = api.now, m = ctx.getTransform(), k = m.a * Z;
      if (layer && Math.abs(layer.k - k) / k > 0.04 && layerFail < 3 && k > 0.5) { layerFail++; buildLayer(Math.min(3 * Z, k)); }
      ctx.save();
      ctx.beginPath(); ctx.rect(0, TOP, W(), api.H - TOP); ctx.clip();
      // слой мира: 1:1 по пикселям, если масштаб совпадает
      const sx = Math.floor(camX * layer.k), cxr = sx / layer.k, vw = Math.min(VW(), WW);
      const wpx = Math.min(layer.c.width - sx, Math.ceil(vw * layer.k) + 2);
      let oy = TOP;
      if (Math.abs(layer.k - k) < 1e-6 && !m.b && !m.c) {
        const dy = Math.round(m.f + TOP * m.d);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(layer.c, sx, 0, wpx, layer.c.height, Math.round(m.e), dy, wpx, layer.c.height); ctx.restore();
        oy = (dy - m.f) / m.d;
      } else ctx.drawImage(layer.c, sx, 0, wpx, layer.c.height, 0, TOP, wpx / layer.k * Z, WH * Z);
      ctx.translate(0, oy); ctx.scale(Z, Z); ctx.translate(-cxr, 0);
      const x0 = cxr - 24, x1 = cxr + VW() + 24, vis = x => x > x0 && x < x1;
      // абрис: снятые объекты обводятся линиями
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const o of objs) {
        if (o.dead || !(o.done || (o.kind === 'fence' && o.got))) continue;
        const pl = o.plan, fl = o.flash > 0 ? 0.5 + 0.5 * Math.sin(o.flash * 12) : 0;
        ctx.strokeStyle = fl ? `rgba(255,255,255,${0.6 + 0.4 * fl})` : 'rgba(255,226,110,.85)'; ctx.lineWidth = fl ? 1.3 : 0.7;
        if (o.kind === 'grove') { ctx.setLineDash([1, 2.5]); ctx.lineWidth = fl ? 1.3 : 1; poly(ctx, pl.poly, true); ctx.stroke(); ctx.setLineDash([]); }
        else if (pl.poly && o.kind !== 'pond') { poly(ctx, pl.poly, true); ctx.stroke(); }
        else if (o.kind === 'fence') {
          ctx.beginPath();
          for (let i = 0; i < 2; i++) {
            const a = pl.lines[i].pts[0], b = pl.lines[i].pts[1], pa = pts.find(p => hyp(p.x - a.x, p.y - a.y) < 1), pb = pts.find(p => hyp(p.x - b.x, p.y - b.y) < 1);
            if (pa && pb && pa.taken && pb.taken) { ctx.moveTo(a.x, a.y - 1.2); ctx.lineTo(b.x, b.y - 1.2); }
          }
          ctx.stroke();
        } else if (o.kind === 'road' || o.kind === 'path') { const e = pl.edges || (pl.edges = [-1, 1].map(sd => offs(dense(pl.pts, 6), sd * pl.width / 2))); ctx.setLineDash([4, 3]); for (const L of e) { poly(ctx, L); ctx.stroke(); } ctx.setLineDash([]); }
        else if (o.kind === 'ravine') { const e = pl.lines2 || (pl.lines2 = [dense(pl.top[0], 4), dense(pl.top[1], 4), dense(pl.th, 4)]); if (!fl) ctx.strokeStyle = 'rgba(255,190,110,.9)'; poly(ctx, e[0]); ctx.stroke(); poly(ctx, e[1]); ctx.stroke(); ctx.strokeStyle = 'rgba(120,200,255,.9)'; poly(ctx, e[2]); ctx.stroke(); }
        else if (o.kind === 'pond') { if (!fl) ctx.strokeStyle = 'rgba(140,210,255,.95)'; poly(ctx, pond.ring, true); ctx.stroke(); }
        else if (o.kind === 'hill') { if (!fl) ctx.strokeStyle = 'rgba(255,190,110,.7)'; for (const e of hillContours()) { poly(ctx, e.pts, true); ctx.stroke(); } }
      }
      // зона съёмки со станции: 60 м
      if (!moving) { ctx.setLineDash([5, 5]); ctx.lineDashOffset = -t * 4; ctx.strokeStyle = 'rgba(255,250,220,.35)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(st.x, st.y, RANGE, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      // прежние станции (колышки)
      for (const s of stations) if (s.left && vis(s.x)) { Sym.marker(ctx, s.x, s.y, 'boundary'); api.text(ctx, 'Ст' + s.n, s.x + 2.5, s.y - 2.5, 5, '#fff4d0', 'left'); }
      // лишние пикеты
      ctx.strokeStyle = 'rgba(255,90,70,.9)'; ctx.lineWidth = 0.8;
      for (const e of extras) if (vis(e.x)) { ctx.beginPath(); ctx.moveTo(e.x - 2, e.y - 2); ctx.lineTo(e.x + 2, e.y + 2); ctx.moveTo(e.x + 2, e.y - 2); ctx.lineTo(e.x - 2, e.y + 2); ctx.stroke(); }
      // характерные точки: снятые — с номером пикета; неснятые мерцают рядом с реечником, в конце — все
      const fewLeft = NEED - got <= 6;
      for (const p of pts) {
        if (p.dead || !vis(p.x)) continue;
        if (p.taken) {
          ctx.fillStyle = '#d6302a'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.2, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.5; ctx.stroke();
          api.text(ctx, String(p.num), p.x + 1.8, p.y - 1.6, 5, '#fff7d6', 'left');
          continue;
        }
        if (!objOpen(p) || p === nearPt) continue;
        const d = hyp(p.x - hero.x, p.y - hero.y);
        if (d < 50 || fewLeft) {
          const a = fewLeft ? 0.6 + 0.35 * Math.sin(t * 6 + p.i) : (0.18 + 0.15 * Math.sin(t * 5 + p.i * 1.7)) * clamp((50 - d) / 22, 0.3, 1);
          ctx.strokeStyle = `rgba(255,240,170,${a})`; ctx.lineWidth = fewLeft ? 1 : 0.6;
          ctx.beginPath(); ctx.arc(p.x, p.y, fewLeft ? 3.5 + Math.sin(t * 6) : 2.6, 0, TAU); ctx.stroke();
          ctx.fillStyle = `rgba(255,240,170,${a})`; ctx.beginPath(); ctx.arc(p.x, p.y, 0.7, 0, TAU); ctx.fill();
        }
      }
      for (const r of rings) { ctx.strokeStyle = `rgba(255,236,120,${1 - r.t})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(r.x, r.y, 2.5 + r.t * 13, 0, TAU); ctx.stroke(); }
      if (tapFx) { ctx.strokeStyle = `rgba(255,255,255,${0.8 - tapFx.t})`; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(tapFx.x, tapFx.y, 2 + tapFx.t * 11, 0, TAU); ctx.stroke(); }
      if (goal && path) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(goal.x, goal.y, 1.3, 0, TAU); ctx.fill(); }
      // утки, собака, люди, машина
      for (const d of ducks) if (vis(d.x)) drawDuck(ctx, d, t);
      if (dog && vis(dog.x)) { ctx.save(); ctx.translate(dog.x, dog.y); ctx.scale(2.2, 2.2); Sym.dogTop(ctx, 0, 0, dog.dir, dog.ph, dog.color); ctx.restore(); }
      for (const r of runners) if (vis(r.x)) {
        ctx.save(); ctx.translate(r.x, r.y); ctx.scale(1.9, 1.9);
        if (r.bike) { ctx.rotate(r.a); ctx.strokeStyle = '#25282c'; ctx.lineCap = 'round'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-2.7, 0); ctx.lineTo(2.7, 0); ctx.stroke(); ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(1.7, -1.1); ctx.lineTo(1.7, 1.1); ctx.stroke(); ctx.strokeStyle = '#d33'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(-1.6, 0); ctx.lineTo(1.2, 0); ctx.stroke(); ctx.rotate(-r.a); }
        Sym.personTop(ctx, 0, 0, r.a, r.bike ? 0 : r.ph, r.seed); ctx.restore();
      }
      if (car && vis(car.x)) Sym.car(ctx, car.x, car.y, car.a, car.col, car.seed);
      // станция, напарник, реечник
      if (moving) {
        const f = moving.t / moving.dur;
        ctx.save(); ctx.translate(partner.x, partner.y); ctx.rotate(partner.dir);
        ctx.strokeStyle = '#d9a33a'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
        ctx.beginPath(); for (const o of [-0.7, 0, 0.7]) { ctx.moveTo(-6, 3.4 + o); ctx.lineTo(5, 3.8 + o * 0.5); } ctx.stroke();
        ctx.fillStyle = '#e8b915'; ctx.fillRect(4, 2.6, 2.6, 2.6);
        ctx.restore();
        Sym.surveyorTop(ctx, partner.x, partner.y, partner.dir, partner.ph, { scale: 2, vest: '#2b7fd4', helmet: '#ffd23a' });
        ctx.strokeStyle = 'rgba(255,214,90,.9)'; ctx.setLineDash([2, 2]); ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(moving.to.x, moving.to.y, 6, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,214,90,.4)'; ctx.beginPath(); ctx.moveTo(moving.to.x, moving.to.y); ctx.arc(moving.to.x, moving.to.y, 6, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.closePath(); ctx.fill();
      } else {
        Sym.surveyorTop(ctx, partner.x, partner.y, partner.dir, 0, { scale: 2, vest: '#2b7fd4', helmet: '#ffd23a' });
        Sym.tripodTop(ctx, st.x, st.y, t, { aim, scale: 2 });
      }
      Sym.surveyorTop(ctx, hero.x, hero.y, hero.dir, hero.walk ? hero.ph : 0, { pole: true, scale: 2.2 });
      // ближайшая точка
      if (nearPt) {
        const ok = !nearVis, pul = 0.5 + 0.5 * Math.sin(t * 9);
        ctx.strokeStyle = ok ? `rgba(110,255,150,${0.7 + 0.3 * pul})` : 'rgba(255,107,91,.9)'; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.arc(nearPt.x, nearPt.y, 3.6 + pul * 1.2, 0, TAU); ctx.stroke();
        ctx.fillStyle = ok ? '#6cff8a' : '#ff6b5b'; ctx.beginPath(); ctx.arc(nearPt.x, nearPt.y, 0.9, 0, TAU); ctx.fill();
        pill(ctx, nearPt.x, nearPt.y - 8, nearPt.name, ok ? '#6cff8a' : '#ff9d8f');
      }
      // луч тахеометра → отражатель
      if (!moving) {
        const rx = hero.x + (Math.cos(hero.dir) * 0.9 - Math.sin(hero.dir) * 1.95) * 2.2, ry = hero.y + (Math.sin(hero.dir) * 0.9 + Math.cos(hero.dir) * 1.95) * 2.2;
        const ix = st.x + Math.cos(aim) * 3.5, iy = st.y + Math.sin(aim) * 3.5;
        if (!nearVis) {
          ctx.strokeStyle = okFx > 0 ? `rgba(255,255,200,${0.5 + okFx})` : 'rgba(120,255,170,.55)'; ctx.lineWidth = okFx > 0 ? 1.2 : 0.6;
          ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(rx, ry); ctx.stroke();
          ctx.setLineDash([2.5, 7]); ctx.lineDashOffset = -t * 30; ctx.strokeStyle = 'rgba(220,255,230,.85)'; ctx.stroke(); ctx.setLineDash([]);
        } else if (nearVis.far) {
          const hx = lerp(st.x, hero.x, nearVis.t), hy = lerp(st.y, hero.y, nearVis.t);
          ctx.strokeStyle = 'rgba(255,190,80,.8)'; ctx.lineWidth = failFx > 0 ? 1.3 : 0.8; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,190,80,.3)'; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(rx, ry); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#ffbe50'; ctx.beginPath(); ctx.arc(hx, hy, 1.6, 0, TAU); ctx.fill();
          pill(ctx, hx, hy - 6, '60 м', '#ffd27a');
        } else {
          const hx = lerp(st.x, hero.x, nearVis.t), hy = lerp(st.y, hero.y, nearVis.t), a = failFx > 0 ? 1 : 0.75;
          ctx.strokeStyle = `rgba(255,90,70,${a})`; ctx.lineWidth = failFx > 0 ? 1.3 : 0.8;
          ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.setLineDash([1.5, 3]); ctx.strokeStyle = 'rgba(255,90,70,.35)'; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(rx, ry); ctx.stroke(); ctx.setLineDash([]);
          ctx.lineWidth = 1.2; ctx.strokeStyle = `rgba(255,70,60,${a})`; ctx.beginPath(); ctx.moveTo(hx - 2.4, hy - 2.4); ctx.lineTo(hx + 2.4, hy + 2.4); ctx.moveTo(hx + 2.4, hy - 2.4); ctx.lineTo(hx - 2.4, hy + 2.4); ctx.stroke();
        }
      }
      // выбор места станции
      if (placing && preview) {
        const inf = prevInfo || (prevInfo = stationInfo(preview.x, preview.y));
        ctx.setLineDash([2.5, 2.5]); ctx.lineWidth = 0.8; ctx.strokeStyle = inf.ok ? 'rgba(110,255,150,.9)' : 'rgba(255,107,91,.9)';
        ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(inf.hit ? inf.hit.x : preview.x, inf.hit ? inf.hit.y : preview.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 0.65; Sym.tripodTop(ctx, preview.x, preview.y, t, { aim: 0, scale: 2 }); ctx.globalAlpha = 1;
        if (inf.ok) { ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(110,255,150,.45)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(preview.x, preview.y, RANGE, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
        pill(ctx, preview.x, preview.y - 12, inf.ok ? `отсюда видно точек: ${inf.n}` : inf.why, inf.ok ? '#6cff8a' : '#ff9d8f');
      }
      ctx.restore();
      drawUI(ctx, t);
    }
    function pill(ctx, x, y, s, col) {
      ctx.font = 'bold 6px system-ui, sans-serif';
      const w = ctx.measureText(s).width + 6;
      ctx.fillStyle = 'rgba(16,12,8,.8)'; api.roundRect(ctx, x - w / 2, y - 5.2, w, 8.4, 3); ctx.fill();
      api.text(ctx, s, x, y + 1.1, 6, col);
    }
    function drawDuck(ctx, d, t) {
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.dir); ctx.scale(1.5, 1.5);
      if (d.state !== 'shore') { ctx.strokeStyle = 'rgba(230,245,255,.5)'; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.arc(-1, 0, 2.6 + Math.sin(t * 4) * 0.3, Math.PI * 0.6, Math.PI * 1.4); ctx.stroke(); }
      ctx.fillStyle = 'rgba(14,24,20,.2)'; ctx.beginPath(); ctx.ellipse(0.5, 0.5, 2.2, 1.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = d.col ? '#8a6a48' : '#9a8a72'; ctx.beginPath(); ctx.ellipse(0, 0, 2.1, 1.15, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.ellipse(-0.4, -0.3, 1.2, 0.4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = d.col ? '#2f6b3a' : '#7d6a52'; ctx.beginPath(); ctx.arc(1.8, 0, 0.75, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8a33a'; ctx.beginPath(); ctx.ellipse(2.6, 0, 0.5, 0.28, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    function hillContours() { // горизонтали холма через 0,5 м (эллипсы гауссова купола)
      if (!hill) return [];
      if (hill.cont) return hill.cont;
      const out = [], base = hAt(hill.x + hill.a * 2.3 * Math.cos(hill.th), hill.y + hill.a * 2.3 * Math.sin(hill.th)), top = base + hill.H;
      for (let lv = Math.ceil((base + hill.H * 0.12) * 2) / 2; lv < top - 0.05; lv += 0.5) {
        const K = Math.sqrt(Math.log(hill.H / (lv - base)));
        out.push({ h: lv, pts: ellipsePts(hill.x, hill.y, hill.a * K, hill.b * K, hill.th, 28), main: Math.abs(lv / 2.5 - Math.round(lv / 2.5)) < 1e-6 });
      }
      return (hill.cont = out);
    }

    // ---------- интерфейс: экран тахеометра, абрис, кнопки ----------
    function drawUI(ctx, t) {
      const Wd = W();
      // экран тахеометра: последний пикет и слежение за отражателем
      const px = 6, py = TOP + 4, pw = 214, ph = 32;
      ctx.fillStyle = 'rgba(14,22,18,.82)'; api.roundRect(ctx, px, py, pw, ph, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(120,200,150,.5)'; ctx.lineWidth = 1; ctx.stroke();
      const l1 = moving ? `Ст.${stNo} → Ст.${stNo + 1}: перенос, ${Math.max(0, Math.ceil(moving.dur - moving.t))} с` : lastMeas ? `Ст.${lastMeas.st} · Пк ${lastMeas.pk} · ${lastMeas.name}` : `Ст.${stNo} · ориентирование выполнено`;
      api.text(ctx, l1, px + 7, py + 13, 9, '#9dffc9', 'left');
      let l2, c2 = '#e6fff0';
      if (moving) { l2 = 'Тахеометр в пути — пикеты недоступны'; c2 = '#ffd76a'; }
      else if (nearVis && nearVis.far) { l2 = `S ${fmt(hyp(hero.x - st.x, hero.y - st.y) * MPU, 1)} м — дальше 60 м!`; c2 = '#ffd27a'; }
      else if (nearVis) { l2 = 'Hz ---°--′  нет отражателя'; c2 = '#ff9d8f'; }
      else { const dx = hero.x - st.x, dy = hero.y - st.y; l2 = `Hz ${dms(Math.atan2(dx, -dy) * 180 / Math.PI)}  S ${fmt(hyp(dx, dy) * MPU, 2)} м  H ${fmt(hAt(hero.x, hero.y), 2)}`; }
      ctx.save(); ctx.font = '600 9px ui-monospace, Menlo, Consolas, monospace'; ctx.fillStyle = c2; ctx.textAlign = 'left'; ctx.fillText(l2, px + 7, py + 26); ctx.restore();
      // абрис (мини-план); над реечником — полупрозрачный
      const mr = mmRect(), under = mmUnder(mr);
      const key = mr.w + 'x' + mr.h;
      if (mmDirty || !mmLayer || key !== mmKey) { // один холст на весь уровень — перерисовываем по пикету
        const kk = clamp(Math.round(ctx.getTransform().a * 2) / 2, 1, 3), pw2 = Math.ceil(mr.w * kk), ph2 = Math.ceil(mr.h * kk);
        if (!mmLayer) mmLayer = document.createElement('canvas');
        if (mmLayer.width !== pw2 || mmLayer.height !== ph2) { mmLayer.width = pw2; mmLayer.height = ph2; }
        const c = mmLayer.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, pw2, ph2); c.setTransform(kk, 0, 0, kk, 0, 0);
        drawMini(c, mr.w / WW); mmDirty = false; mmKey = key;
      }
      ctx.globalAlpha = under ? 0.28 : 0.93;
      ctx.drawImage(mmLayer, mr.x, mr.y, mr.w, mr.h);
      const sm = mr.w / WW;
      ctx.strokeStyle = 'rgba(30,30,30,.8)'; ctx.lineWidth = 1; ctx.strokeRect(mr.x + camX * sm, mr.y + 0.5, Math.min(VW(), WW) * sm, mr.h - 1);
      for (const s of stations) if (s.left) { ctx.fillStyle = '#7a4a20'; ctx.fillRect(mr.x + s.x * sm - 1.5, mr.y + s.y * sm - 1.5, 3, 3); }
      const sp = moving ? moving.to : st;
      ctx.save(); ctx.beginPath(); ctx.rect(mr.x, mr.y, mr.w, mr.h); ctx.clip(); ctx.strokeStyle = 'rgba(29,111,209,.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.arc(mr.x + sp.x * sm, mr.y + sp.y * sm, RANGE * sm, 0, TAU); ctx.stroke(); ctx.restore();
      ctx.fillStyle = '#1d6fd1'; ctx.beginPath(); ctx.moveTo(mr.x + sp.x * sm, mr.y + sp.y * sm - 3.5); ctx.lineTo(mr.x + sp.x * sm + 3, mr.y + sp.y * sm + 2); ctx.lineTo(mr.x + sp.x * sm - 3, mr.y + sp.y * sm + 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff7a1c'; ctx.beginPath(); ctx.arc(mr.x + hero.x * sm, mr.y + hero.y * sm, 2.4, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.globalAlpha = 1;
      if (!under) { ctx.fillStyle = 'rgba(20,14,10,.75)'; ctx.fillRect(mr.x + mr.w - 100, mr.y + mr.h, 100, 12); api.text(ctx, `АБРИС · ${got}/${NEED}`, mr.x + mr.w - 4, mr.y + mr.h + 9, 8.5, '#f1e6d6', 'right'); }
      // стрелки к оставшимся точкам за краем экрана (когда их мало)
      if (NEED - got <= 6) for (const p of pts) {
        if (p.taken || p.dead || !objOpen(p)) continue;
        const sx = (p.x - camX) * Z; if (sx > 0 && sx < Wd) continue;
        const ex = sx < 0 ? 14 : Wd - 14, ey = clamp(TOP + p.y * Z, TOP + 50, api.H - 130), dir = sx < 0 ? -1 : 1, a = 0.6 + 0.4 * Math.sin(t * 6);
        ctx.fillStyle = `rgba(255,226,110,${a})`; ctx.beginPath(); ctx.moveTo(ex + dir * 8, ey); ctx.lineTo(ex - dir * 3, ey - 7); ctx.lineTo(ex - dir * 3, ey + 7); ctx.closePath(); ctx.fill();
      }
      // кнопки
      const bp = btnP(), bs = btnS(), ready = !moving && nearPt && !nearVis;
      api.button(ctx, bs, placing ? 'ОТМЕНА' : 'СТАНЦИЯ', { active: placing, color: placing ? '#ffd76a' : '#7ec8ff', size: 13, disabled: !!moving });
      api.button(ctx, bp, 'ПИКЕТ', { active: !!ready, color: ready ? (Math.sin(t * 8) > 0 ? '#6cff8a' : '#9dffb5') : api.theme.accent, size: 17, disabled: !!moving });
      let hint = null;
      if (placing) hint = api.IS_TOUCH ? 'Тап по карте — место станции (должна видеть прежнюю)' : 'Клик по карте — место станции (должна видеть прежнюю) · Пробел — здесь';
      else if (!picketNo && time < 25) hint = 'Подойдите к мерцающей точке и нажмите ПИКЕТ';
      else if (nothingHere && got < NEED) hint = 'Отсюда больше нечего снимать — нажмите СТАНЦИЯ';
      else if (fails >= 2 && stNo === 1 && !moving) hint = 'Не видно или далеко? Перенесите тахеометр: СТАНЦИЯ';
      if (hint) { // подсказка внизу слева, не под кнопками
        const s = hint;
        ctx.font = 'bold 11px system-ui, sans-serif'; const w = Math.min(Wd - 140, ctx.measureText(s).width + 20);
        const hx = (hero.x - camX) * Z, hy = TOP + hero.y * Z;
        ctx.save(); ctx.globalAlpha = hx < w + 20 && hy > api.H - 50 ? 0.35 : 1;
        ctx.fillStyle = 'rgba(20,14,10,.86)'; api.roundRect(ctx, 8, api.H - 30, w, 22, 8); ctx.fill();
        ctx.beginPath(); ctx.rect(8, api.H - 30, w, 22); ctx.clip(); api.text(ctx, s, 18, api.H - 15, 11, '#ffd76a', 'left'); ctx.restore();
      }
      const left = T_LEVEL - time;
      if (left < 10 && !over) api.text(ctx, String(Math.ceil(left)), Wd / 2, TOP + 34, 18, `rgba(255,107,91,${0.5 + 0.5 * Math.sin(t * 8)})`);
    }
    function drawMini(c, sm) { // абрис: снятые объекты упрощёнными знаками
      c.fillStyle = 'rgba(245,240,226,.92)'; c.fillRect(0, 0, WW * sm, WH * sm);
      c.save(); c.scale(sm, sm);
      const lw = 1 / sm;
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (const o of objs) {
        if (o.dead || !o.done) continue;
        const pl = o.plan;
        if (o.kind === 'road' || o.kind === 'path') { c.strokeStyle = '#6b6156'; c.lineWidth = 0.6 * lw; for (const sd of [-1, 1]) { poly(c, offs(dense(pl.pts, 8), sd * pl.width / 2)); c.stroke(); } if (pl.ditch) { c.strokeStyle = '#2b6cb0'; poly(c, dense(pl.ditch, 8)); c.stroke(); } }
        else if (o.kind === 'fence') { c.strokeStyle = '#1f1d1a'; c.lineWidth = 0.6 * lw; for (const ln of pl.lines) { poly(c, ln.pts); c.stroke(); } }
        else if (o.kind === 'pond') { c.fillStyle = '#9cc8ea'; poly(c, pond.ring, true); c.fill(); c.strokeStyle = '#2b6cb0'; c.lineWidth = 0.6 * lw; c.stroke(); }
        else if (o.kind === 'ravine') { c.strokeStyle = '#a0582a'; c.lineWidth = 0.8 * lw; poly(c, dense(pl.top[0], 6)); c.stroke(); poly(c, dense(pl.top[1], 6)); c.stroke(); c.strokeStyle = '#2b6cb0'; c.lineWidth = 0.5 * lw; poly(c, pl.th); c.stroke(); }
        else if (o.kind === 'hill') { c.strokeStyle = '#a0582a'; c.lineWidth = 0.5 * lw; for (const e of hillContours()) { poly(c, e.pts, true); c.stroke(); } }
        else if (o.kind === 'grove') { c.fillStyle = 'rgba(46,133,64,.25)'; poly(c, pl.poly, true); c.fill(); c.strokeStyle = '#2e8540'; c.lineWidth = 0.6 * lw; c.setLineDash([1.5 * lw, 1.5 * lw]); c.stroke(); c.setLineDash([]); }
        else if (pl.poly) { c.fillStyle = o.kind === 'playground' ? '#e9d7b0' : o.kind === 'greenhouse' ? '#cfe6e0' : '#f2cf6a'; poly(c, pl.poly, true); c.fill(); c.strokeStyle = '#1f1d1a'; c.lineWidth = 0.6 * lw; c.stroke(); }
        else if (o.kind === 'tree') { c.fillStyle = '#2e8540'; c.beginPath(); c.arc(pl.x, pl.y, 1.8 * lw, 0, TAU); c.fill(); }
        else if (o.kind === 'manhole' || o.kind === 'well' || o.kind === 'hydrant') { c.strokeStyle = o.kind === 'hydrant' ? '#d0302a' : '#2b6cb0'; c.lineWidth = 0.7 * lw; c.beginPath(); c.arc(pl.x, pl.y, 1.5 * lw, 0, TAU); c.stroke(); }
        else if (o.kind === 'flowerbed') { c.fillStyle = '#e78ab0'; c.beginPath(); c.arc(pl.x, pl.y, 1.6 * lw, 0, TAU); c.fill(); }
        else if (o.kind === 'marker') { c.strokeStyle = '#c0392b'; c.lineWidth = 0.6 * lw; c.setLineDash([3 * lw, 2 * lw]); poly(c, pl.pts); c.stroke(); c.setLineDash([]); }
        else { c.fillStyle = '#1f1d1a'; c.beginPath(); c.arc(pl.x, pl.y, 1.2 * lw, 0, TAU); c.fill(); }
      }
      c.fillStyle = '#c0392b';
      for (const p of pts) if (p.taken) { c.beginPath(); c.arc(p.x, p.y, 0.9 * lw, 0, TAU); c.fill(); }
      c.restore();
      c.strokeStyle = 'rgba(60,50,40,.6)'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, WW * sm - 1, WH * sm - 1);
    }

    // ---------- итог: топоплан 1:500 на двух листах ----------
    let planCache = null;
    function drawResult(ctx, x, y, w, h) {
      const key = Math.round(w) + 'x' + Math.round(h);
      if (!planCache || planCache.key !== key) planCache = { key, layer: api.layer(w, h, c => drawPlan(c, w, h)) };
      ctx.drawImage(planCache.layer.canvas, x, y, w, h);
    }
    function drawPlan(c, w, h) {
      const was = Sym.cache; Sym.cache = false;
      try {
        Sym.plan.paper(c, 0, 0, w, h, { stamp: false, grid: -1, margin: 4 });
        api.text(c, 'Топографический план М 1:500', w / 2, 16, 10, '#1f1d1a');
        let sub = variant.title + ' · сечение рельефа 0,5 м · Балтийская система высот';
        c.font = '600 6.5px system-ui, sans-serif'; if (c.measureText(sub).width > w - 16) sub = variant.title + ' · сечение 0,5 м · БСВ';
        api.text(c, sub, w / 2, 26, 6.5, '#4a443c', 'center', '600');
        const half = WW / 2, top = 31, gap = 13, s = Math.min((w - 18) / half, (h - top - 12 - gap) / (2 * WH));
        const pw = half * s, ph = WH * s, ox = (w - pw) / 2;
        const q = 1.8 / s;   // увеличение условных знаков: «единица знака» = 1,8 пикселя листа
        for (let k = 0; k < 2; k++) {
          const oy = top + k * (ph + gap);
          c.save(); c.beginPath(); c.rect(ox, oy, pw, ph); c.clip();
          c.fillStyle = 'rgba(255,253,245,.55)'; c.fillRect(ox, oy, pw, ph);
          c.translate(ox - k * half * s, oy); c.scale(s * q, s * q);
          planContents(c, 1 / q);
          c.restore();
          c.strokeStyle = '#1f1d1a'; c.lineWidth = 0.8; c.strokeRect(ox, oy, pw, ph);
          c.beginPath();   // сетка крестов через 25 м
          for (let gx = Math.ceil(k * half / 100) * 100; gx < (k + 1) * half; gx += 100) for (let gy = 60; gy < WH; gy += 100) {
            const X = ox + (gx - k * half) * s, Y = oy + gy * s; c.moveTo(X - 3, Y); c.lineTo(X + 3, Y); c.moveTo(X, Y - 3); c.lineTo(X, Y + 3);
          }
          c.lineWidth = 0.5; c.stroke();
          api.text(c, 'Лист ' + (k + 1), ox + pw - 2, oy + ph + 9, 6.5, '#4a443c', 'right', '600');
        }
        api.text(c, `Съёмка: ${stNo} ст., ${picketNo} пк · реечник — вы`, ox + 1, top + 2 * ph + gap + 9, 6.5, '#4a443c', 'left', '600');
      } catch (e) { console.error(e); } finally { Sym.cache = was; }
    }
    function planContents(c, k) { // мировые координаты × k — координаты знаков
      const P = p => p.map(q => ({ x: q.x * k, y: q.y * k })), at = o => ({ x: o.x * k, y: o.y * k });
      const SP = Sym.plan;
      const order = ['hill', 'ravine', 'pond', 'road', 'path', 'grove', 'playground', 'flowerbed', 'marker', 'fence', 'annex', 'house', 'shed', 'bath', 'toilet', 'greenhouse', 'manhole', 'well', 'hydrant', 'bench', 'pole', 'lamp', 'tree'];
      const list = liveObjs.filter(o => o.done).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
      for (const o of list) {
        const pl = o.plan;
        switch (o.kind) {
          case 'road': SP.road(c, P(pl.pts), pl.width * k, 'грунт.'); if (pl.ditch) SP.water(c, P(pl.ditch), 3 * k); break;
          case 'path': SP.road(c, P(pl.pts), pl.width * k, null); break;
          case 'fence': for (const ln of pl.lines) SP.fence(c, P(ln.pts), ln.kind); break;
          case 'pond': SP.water(c, P(pl.poly)); break;
          case 'ravine': SP.slope(c, P(pl.top[0]), P(pl.bot[0])); SP.slope(c, P(pl.top[1]), P(pl.bot[1])); SP.water(c, P(pl.th.slice(0, 3)), 1.2); break;
          case 'hill': for (const e of hillContours()) SP.contour(c, P(e.pts.concat([e.pts[0]])), e.h, e.main); break;
          case 'grove': {
            const p = P(pl.poly); c.save(); c.setLineDash([0.3, 1.4]); c.lineCap = 'round'; c.strokeStyle = '#1f1d1a'; c.lineWidth = 0.6; poly(c, p, true); c.stroke(); c.restore();
            for (const tr of pl.trees) SP.tree(c, tr.x * k, tr.y * k, pl.kind);
            const m = { x: p.reduce((a, b) => a + b.x, 0) / p.length, y: p.reduce((a, b) => a + b.y, 0) / p.length };
            SP.label(c, m.x, m.y + 3, pl.label, 3, '#2e8540'); break;
          }
          case 'playground': { const p = P(pl.poly); poly(c, p, true); c.fillStyle = 'rgba(232,214,170,.5)'; c.fill(); c.strokeStyle = '#1f1d1a'; c.lineWidth = 0.4; c.stroke(); const m = at({ x: (pl.poly[0].x + pl.poly[2].x) / 2, y: (pl.poly[0].y + pl.poly[2].y) / 2 }); SP.label(c, m.x, m.y, 'дет. пл.', 3.2); break; }
          case 'flowerbed': { const m = at(pl); c.beginPath(); c.ellipse(m.x, m.y, Math.max(1.6, pl.w * k / 2), Math.max(1.3, pl.h * k / 2), 0, 0, TAU); c.strokeStyle = '#2e8540'; c.lineWidth = 0.35; c.stroke(); SP.label(c, m.x, m.y, 'цв', 2.6, '#2e8540'); break; }
          case 'house': case 'annex': case 'shed': case 'bath': case 'toilet': case 'greenhouse': SP.house(c, P(pl.poly), pl.label); break;
          case 'tree': { const m = at(pl); SP.tree(c, m.x, m.y, pl.kind === 'apple' ? 'apple' : pl.kind); break; }
          case 'pole': { const m = at(pl); SP.pole(c, m.x, m.y, 'power', pl.rot); break; }
          case 'lamp': { const m = at(pl); SP.pole(c, m.x, m.y, 'lamp'); break; }
          case 'manhole': { const m = at(pl); SP.manhole(c, m.x, m.y, pl.kind); break; }
          case 'well': { const m = at(pl); c.beginPath(); c.arc(m.x, m.y, 1.5, 0, TAU); c.strokeStyle = '#2b6cb0'; c.lineWidth = 0.4; c.stroke(); c.beginPath(); c.arc(m.x, m.y, 0.5, 0, TAU); c.fillStyle = '#2b6cb0'; c.fill(); SP.label(c, m.x + 2.2, m.y - 2.2, 'кол.', 2.8, '#2b6cb0', 0, 600, 'left'); break; }
          case 'hydrant': { const m = at(pl); c.beginPath(); c.arc(m.x, m.y, 1.2, 0, TAU); c.fillStyle = '#d0302a'; c.fill(); SP.label(c, m.x + 2, m.y - 2, 'ПГ', 2.8, '#d0302a', 0, 700, 'left'); break; }
          case 'marker': {
            const p = P(pl.pts); c.save(); c.setLineDash([2.4, 0.8, 0.4, 0.8]); c.strokeStyle = '#1f1d1a'; c.lineWidth = 0.3; poly(c, p); c.stroke(); c.restore();
            for (const q of p) { c.beginPath(); c.arc(q.x, q.y, 0.9, 0, TAU); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = '#c0392b'; c.lineWidth = 0.35; c.stroke(); }
            SP.label(c, (p[0].x + p[1].x) / 2, p[0].y - 1.6, 'граница участка', 2.4, '#4a443c'); break;
          }
          case 'bench': { const m = at(pl); c.save(); c.translate(m.x, m.y); c.rotate(pl.rot || 0); c.strokeStyle = '#1f1d1a'; c.lineWidth = 0.35; c.strokeRect(-1.8, -0.6, 3.6, 1.2); c.restore(); break; }
        }
      }
      // отметки высот снятых точек рельефа
      if (PARK) for (const p of pts) {
        if (!p.taken || !p.objs.some(o => o.done && (o.kind === 'hill' || o.kind === 'ravine'))) continue;
        SP.spot(c, p.x * k, p.y * k, p.name === 'бровка оврага' ? '' : fmt(p.h, 2));
      }
      if (PARK && pond && liveObjs.some(o => o.kind === 'pond' && o.done)) SP.label(c, pond.x * k, pond.y * k, fmt(pond.level, 2), 3, '#2b6cb0', 0, 600);
      // пикеты незавершённых объектов — точками
      c.fillStyle = '#1f1d1a';
      for (const p of pts) if (p.taken && !p.objs.some(o => o.done)) { c.beginPath(); c.arc(p.x * k, p.y * k, 0.45, 0, TAU); c.fill(); }
      // станции съёмочного обоснования
      for (const s of stations) {
        const x = s.x * k, y = s.y * k;
        c.beginPath(); c.moveTo(x, y - 1.6); c.lineTo(x + 1.4, y + 0.9); c.lineTo(x - 1.4, y + 0.9); c.closePath(); c.strokeStyle = '#c0392b'; c.lineWidth = 0.35; c.stroke();
        c.fillStyle = '#c0392b'; c.beginPath(); c.arc(x, y, 0.35, 0, TAU); c.fill();
        SP.label(c, x + 1.8, y - 1.6, 'Ст' + s.n, 2.8, '#c0392b', 0, 700, 'left');
      }
    }

    // ---------- бот: ближайшая видимая неснятая точка; если таких нет — перенос станции ----------
    const bot = { p: null, sx: 0, sy: 0, t: 0, wait: 0, skip: new Set(), stKey: '', retry: 0 };
    const uiHit = (sx, sy) => [btnP(), btnS(), mmRect()].some(b => sx >= b.x - 4 && sx <= b.x + b.w + 4 && sy >= b.y - 16 && sy <= b.y + b.h + 4);
    function botTap(x, y) { // тап по карте, если место на экране и не под кнопкой; иначе — то же действие напрямую
      const s = toScreen(x, y);
      if (s.x > 4 && s.x < W() - 4 && s.y > TOP + 40 && s.y < api.H - 4 && !uiHit(s.x, s.y)) { inst.pointerDown({ x: s.x, y: s.y, id: 91, button: 0 }); inst.pointerUp({ x: s.x, y: s.y, id: 91, button: 0 }); }
      else if (placing) placeStation(x, y); else walkTo(x, y);
    }
    const botPress = b => { const r = b(); inst.pointerDown({ x: r.x + r.w / 2, y: r.y + r.h / 2, id: 92, button: 0 }); inst.pointerUp({ x: r.x + r.w / 2, y: r.y + r.h / 2, id: 92, button: 0 }); };
    function botChoose() {
      const S0 = moving ? moving.to : st, key = S0.x + ',' + S0.y;
      if (bot.stKey !== key) { bot.stKey = key; bot.skip.clear(); }
      const cand = [];
      for (const p of pts) {
        if (p.taken || p.dead || !objOpen(p) || bot.skip.has(p.i)) continue;
        for (const c of p.stand) if (shoot(S0.x, S0.y, cx(c), cy(c))) { cand.push({ p, c, d: hyp(cx(c) - hero.x, cy(c) - hero.y) }); break; }
      }
      if (!cand.length) return false;
      cand.sort((a, b) => a.d - b.d);
      let best = null, bd = Infinity;
      const hc = blocked[cellOf(hero.x, hero.y)] ? nearestFree(hero.x, hero.y) : cellOf(hero.x, hero.y);
      for (const e of cand.slice(0, 4)) { const cells = astar(hc, e.c), L = cells ? cells.length : Infinity; if (L < bd) { bd = L; best = e; } }
      if (!best) { for (const e of cand.slice(0, 4)) bot.skip.add(e.p.i); return true; }
      bot.p = best.p; bot.sx = cx(best.c); bot.sy = cy(best.c); bot.t = 0; bot.retry = 0;
      botTap(bot.sx, bot.sy);
      return true;
    }
    function botStation() { // поиск в ширину по местам станций (взаимная видимость) до места, откуда видны неснятые точки
      const open = new Set(); for (const p of pts) if (!p.taken && !p.dead && objOpen(p)) open.add(p.i);
      const score = cd => { let n = 0; for (const i of cd.vis) if (open.has(i)) n++; return n; };
      const from = cands.find(c => c.x === st.x && c.y === st.y);
      const roots = from ? adjOf(from) : cands.filter(b => b.ok && !sight(st.x, st.y, b.x, b.y, false, HI));
      const seen = new Set(roots.map(b => b.i)), q = roots.map(b => ({ c: b, first: b }));
      let best = null, bn = 0;
      for (const e of q) { const n = score(e.c); if (n > bn || (n === bn && n && best && hyp(e.c.x - hero.x, e.c.y - hero.y) < hyp(best.x - hero.x, best.y - hero.y))) { bn = n; best = e.c; } }
      if (!best) {
        for (let k = 0; k < q.length && k < 60 && !best; k++) for (const b of adjOf(q[k].c)) {
          if (seen.has(b.i)) continue; seen.add(b.i); q.push({ c: b, first: q[k].first });
          if (score(b) > 0) { best = q[k].first; break; }
        }
      }
      if (!best) return false;
      botPress(btnS);
      if (placing) botTap(best.x, best.y);
      return !!moving;
    }
    function botStep(dt) {
      if (over) return;
      bot.wait -= dt; if (bot.wait > 0) return;
      if (placing && !moving) { toggleStation(); return; }
      if (!bot.p || bot.p.taken || !objOpen(bot.p)) {
        bot.p = null;
        if (!botChoose() && !moving && !botStation()) bot.wait = 0.5;
        return;
      }
      bot.t += dt;
      const atSpot = hyp(hero.x - bot.sx, hero.y - bot.sy) < 1.2 || !path;
      if (!atSpot) { if (bot.t > 9) { bot.skip.add(bot.p.i); bot.p = null; } return; }
      if (moving) return;
      const np = nearestUntaken(hero.x, hero.y, SNAP);
      if (!np || !shoot(st.x, st.y, hero.x, hero.y)) { bot.skip.add(bot.p.i); bot.p = null; return; }
      if (sight(st.x, st.y, hero.x, hero.y, true) || ducks.some(d => d.state === 'shore' && hyp(d.x - hero.x, d.y - hero.y) < 7)) {
        bot.retry += dt + 0.15; if (bot.retry > 5) { bot.skip.add(bot.p.i); bot.p = null; } bot.wait = 0.15; return;
      }
      botPress(btnP);
      bot.wait = 0.05;
    }

    // ---------- ввод ----------
    const inst = {
      update, draw,
      hud() { return { time: Math.max(0, T_LEVEL - time), info: [api.W >= 700 ? `Точки ${got}/${NEED} · Ст.${stNo}` : `${got}/${NEED}`], progress: NEED ? got / NEED : 1 }; },
      pointerDown(p) {
        if (over) return;
        if (api.hit(btnP(), p)) { picket(); return; }
        if (api.hit(btnS(), p)) { toggleStation(); return; }
        const mr = mmRect();
        if (!mmUnder(mr) && !placing && api.hit(mr, p)) { const wx = (p.x - mr.x) / mr.w * WW, wy = (p.y - mr.y) / mr.h * WH; if (walkTo(wx, wy)) { tapFx = { x: wx, y: wy, t: 0 }; api.sfx('tap'); } return; }
        if (p.y < TOP) return;
        const w = toWorld(p);
        if (placing) { preview = w; prevInfo = null; prevPtr = p.id; return; }
        walkPtr = p.id; lastRepath = time;
        if (walkTo(w.x, w.y)) tapFx = { x: w.x, y: w.y, t: 0 };
      },
      pointerMove(p) {
        if (over) return;
        if (placing && (p.id === prevPtr || !p.down) && p.y > TOP) { preview = toWorld(p); prevInfo = null; return; }
        if (p.id === walkPtr && p.down && time - lastRepath > 0.12) { lastRepath = time; const w = toWorld(p); walkTo(w.x, w.y); }
      },
      pointerUp(p) {
        if (over) return;
        if (placing && p.id === prevPtr && preview) { placeStation(preview.x, preview.y); prevPtr = null; }
        if (p.id === walkPtr) walkPtr = null;
      },
      key(code, down) {
        const v = down ? 1 : 0;
        if (code === 'ArrowLeft' || code === 'KeyA') keys.l = v;
        else if (code === 'ArrowRight' || code === 'KeyD') keys.r = v;
        else if (code === 'ArrowUp' || code === 'KeyW') keys.u = v;
        else if (code === 'ArrowDown' || code === 'KeyS') keys.d = v;
        else if (down && (code === 'Space' || code === 'Enter' || code === 'KeyF')) { if (placing) placeStation(hero.x, hero.y); else picket(); }
        else if (down && (code === 'KeyQ' || code === 'KeyC' || code === 'KeyE')) toggleStation();
      },
      bot(dt) { botStep(dt); },
    };
    return inst;
  }
})();
