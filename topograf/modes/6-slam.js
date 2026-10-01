'use strict';
// «SLAM» — ручное лазерное сканирование: топограф обходит объект с ручным SLAM-сканером на короткой вешке
// (как CHCNAV RS10). Карту рисует сам маршрут: вокруг темно, вращающийся лидар (≈15 м, лучи закрываются стенами,
// колоннами, машинами) копит облако точек (цвет — высота и интенсивность) в отдельном холсте.
// Методика: инициализация стоя, ход ≤ 1 м/с, дрейф и «двойные стены», замыкание петель, опорные марки,
// вырожденные проезды, движущиеся люди и машины (шлейфы), стекло (фантомы), статика на старте в конце.
(() => {
  const Z = 1.5;               // масштаб камеры: логических единиц экрана на единицу мира
  const WW = 760, WH = 440;    // мир, ед. (1 ед. ≈ 0,25 м): 190 × 110 м
  const G = 2;                 // клетка сетки материалов (по ней идут лучи)
  const GW = WW / G, GH = WH / G;
  const WG = 4;                // клетка сетки проходимости
  const NW = WW / WG, NH = WH / WG, NN = NW * NH;
  const CC = 8;                // клетка охвата
  const CW = WW / CC, CH = WH / CC;
  const TC = 20;               // клетка траектории (поиск петель)
  const TW = WW / TC, TH = WH / TC;
  const HR = 3;                // «радиус» топографа при обходе препятствий
  const RANGE = 60;            // дальность лидара, ед. (≈ 15 м)
  const FLOOR_R = 54;          // дальше пол под острым углом почти не отражает
  const RV = 62;               // радиус «налобного фонаря»: насколько видно настоящий объект
  const V_WALK = 32, V_RUN = 52;   // шаг и бег, ед./с
  const MS = 0.9 / V_WALK;     // показ скорости, м/с на ед./с (игровое время сжато)
  const VIS = 1;               // смещение облака, ед. на 1 см дрейфа (показ с увеличением ×25)
  const BASE = 0.0016;         // рост дрейфа, см на единицу пути при спокойном шаге
  const BLUR = 4.5;            // размытие облака на бегу, см
  const TOL = 5;               // допуск толщины облака, см
  const LOOP_T = 35;           // петля: возврат к месту, снятому не меньше 35 с назад
  const LOOP_S = 400;          // … и пройдено после прошлой петли не меньше 100 м
  const INIT_T = 4, MARK_T = 3, END_T = 4;
  const COV_MIN = 3;           // отражений от пола в клетке охвата — клетка снята
  const CAP = 700000;          // точек облака в памяти (для перерисовки после петли)
  const TAU = Math.PI * 2, hyp = Math.hypot;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt = (v, n) => v.toFixed(n).replace('.', ',');
  const mmss = t => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
  function angD(a, b) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }

  // ---------- цвет облака: шкала высоты (как в CloudCompare) и интенсивность ----------
  const STOPS = [[0, 28, 60, 205], [0.2, 25, 150, 240], [0.42, 40, 215, 160], [0.6, 120, 230, 70], [0.78, 250, 220, 50], [1, 250, 70, 45]];
  const LUT = [];
  for (let i = 0; i < 256; i++) {
    const h = i / 255; let k = 1; while (k < STOPS.length - 1 && STOPS[k][0] < h) k++;
    const a = STOPS[k - 1], b = STOPS[k], t = clamp((h - a[0]) / (b[0] - a[0]), 0, 1);
    LUT.push([a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
  }
  const pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;   // RGBA в Uint32 (little-endian)
  function colH(h, a, white) { const c = LUT[clamp(Math.round(h * 255), 0, 255)], w = white || 0; return pack(Math.round(c[0] + (255 - c[0]) * w), Math.round(c[1] + (255 - c[1]) * w), Math.round(c[2] + (255 - c[2]) * w), a == null ? 255 : a); }
  const cssH = (h, a) => { const c = LUT[clamp(Math.round(h * 255), 0, 255)]; return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a == null ? 1 : a})`; };
  // материалы сетки
  const FREE = 0, WALL = 1, COL = 2, CAR = 3, GLH = 4, GLV = 5, BLD = 6, TRUNK = 7, LOW = 8;
  const MAT_H = [0, 0.8, 0.88, 0.4, 0.5, 0.5, 0.86, 0.6, 0.3], MAT_J = [0, 0.2, 0.12, 0.18, 0.1, 0.1, 0.14, 0.14, 0.08];
  const MCOL = MAT_H.map((h, m) => { const o = []; for (let v = 0; v < 16; v++) o.push(colH(h + MAT_J[m] * (v / 15 - 0.5) * 2, 255, m === GLH || m === GLV ? 0.45 : 0)); return o; });
  // покрытия пола: 0 бетон, 1 белая разметка, 2 жёлтая, 3 марка/старт, 4 газон, 5 плитка, 6 асфальт, 7 пандус
  const FLOOR_H = [0.05, 0.05, 0.07, 0.05, 0.15, 0.08, 0.02, 0.1], FLOOR_W = [0, 0.6, 0.45, 0.9, 0, 0.12, 0, 0.2];
  const FCOL = FLOOR_H.map((h, p) => { const o = []; for (let v = 0; v < 8; v++) o.push(colH(h + (v / 7 - 0.5) * 0.06, 175, FLOOR_W[p] * (0.85 + v * 0.03))); return o; });
  const PCOL = [], DCOL = [], CNCOL = [];   // люди, машины (шлейфы), кроны
  for (let v = 0; v < 8; v++) { PCOL.push(colH(0.5 + v * 0.015)); DCOL.push(colH(0.36 + v * 0.02)); CNCOL.push(colH(0.6 + v * 0.025, 210)); }
  const CARC = ['#d8dadd', '#2b2f35', '#b3302c', '#2c5c9e', '#f2f2ee', '#5f7356', '#c8a24a', '#7a2e3c', '#3e7f8a', '#56606a', '#8a8f96'];
  const RTK_NAME = ['FIX', 'FLOAT', 'NONE'], RTK_COL = ['#6cff8a', '#ffd76a', '#ff6b5b'];

  registerMode({
    index: 6,
    id: 'slam',
    title: 'SLAM',
    subtitle: 'Ручное лазерное сканирование',
    howto: [
      'Постойте 4 с на старте — инициализация. Тап по карте — идти.',
      'Шаг ≤ 1 м/с; бег (двойной тап) и резкие повороты копят дрейф.',
      'Замыкайте петли — вернитесь туда, где были ≥ 35 с назад.',
      'Займите ≥ 3 марки: встаньте на мишень, держите МАРКА 3 с.',
      'В конце — на старт и 4 с стоя. Допуск толщины облака 5 см.',
    ],
    variants: [
      { id: 'parking', title: 'Подземный паркинг', subtitle: 'спутников нет — только петли и марки',
        howto: ['Пандус без примет — идите у стены. Стекло в лоб даёт фантомы.'] },
      { id: 'yard', title: 'Двор и арка, RTK', subtitle: 'под открытым небом FIX держит дрейф, в арке — NONE',
        howto: ['RTK FIX под небом держит дрейф; у домов FLOAT, в арке — NONE.'] },
    ],
    create(api, variant, seed) { return createLevel(api, variant, seed); },
  });

  function createLevel(api, variant, seed) {
    const R = api.rng(seed), rr = (a, b) => a + R() * (b - a), ri = (a, b) => Math.floor(rr(a, b + 1));
    const sdx = () => ri(1, 999999999);
    const YARD = variant.id === 'yard', TOP = api.TOP;
    const LIMIT = api.sandbox ? api.timeLimit(300) : 300;
    const BG = YARD ? [9, 13, 12] : [7, 9, 13], BGS = `rgb(${BG})`;

    // ---------- сетки участка ----------
    const NG = GW * GH;
    const mat = new Uint8Array(NG), paint = new Uint8Array(NG), canopy = new Uint8Array(NG);
    const statics = [], S = (z, f) => statics.push({ z, f, i: statics.length });
    const degen = [], narrow = [], noneZ = [], feats = [], glass = [], spots = [];
    const carRoutes = [];
    let start = { x: 60, y: 380 }, markN = 5;
    function fill(arr, x0, y0, x1, y1, v) {
      const i0 = clamp(Math.floor(x0 / G), 0, GW - 1), i1 = clamp(Math.ceil(x1 / G) - 1, 0, GW - 1);
      const j0 = clamp(Math.floor(y0 / G), 0, GH - 1), j1 = clamp(Math.ceil(y1 / G) - 1, 0, GH - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) arr[j * GW + i] = v;
    }
    function fillC(arr, x, y, r, v) {
      for (let j = Math.floor((y - r) / G); j <= Math.ceil((y + r) / G); j++) for (let i = Math.floor((x - r) / G); i <= Math.ceil((x + r) / G); i++) {
        if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
        if (hyp((i + 0.5) * G - x, (j + 0.5) * G - y) <= r) arr[j * GW + i] = v;
      }
    }
    const solid = (x0, y0, x1, y1, m) => fill(mat, x0, y0, x1, y1, m);
    const inZ = (zs, x, y) => { for (const z of zs) if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return z; return null; };

    // ---------- рисунок: стены, колонны, разметка ----------
    function drawWall(c, x0, y0, x1, y1) {
      c.fillStyle = '#34363a'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
      c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip();
      c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 0.5; c.beginPath();
      for (let s = x0 + y0 - (y1 - y0); s < x1 + y1; s += 3) { c.moveTo(s - y0, y0); c.lineTo(s - y1, y1); }
      c.stroke(); c.restore();
      c.strokeStyle = 'rgba(200,205,210,.35)'; c.lineWidth = 0.6; c.strokeRect(x0 + 0.3, y0 + 0.3, x1 - x0 - 0.6, y1 - y0 - 0.6);
    }
    function drawColumn(c, x, y, s) {
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x - s / 2 + 1.2, y - s / 2 + 1.2, s, s);
      c.fillStyle = '#1d1d1b'; c.fillRect(x - s / 2, y - s / 2, s, s);
      c.save(); c.beginPath(); c.rect(x - s / 2, y - s / 2, s, s); c.clip();
      c.strokeStyle = '#f2c230'; c.lineWidth = 0.9; c.beginPath();
      for (let k = -s; k < s * 2; k += 1.8) { c.moveTo(x - s / 2 + k, y - s / 2); c.lineTo(x - s / 2 + k - s, y + s / 2); }
      c.stroke(); c.restore();
      c.fillStyle = '#9a9b97'; c.fillRect(x - s / 2 + 1, y - s / 2 + 1, s - 2, s - 2);
      c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(x - s / 2 + 1, y - s / 2 + 1, s - 2, 0.8);
    }
    function line(x0, y0, x1, y1, w, col, p) { // разметка: рисунок + интенсивность в облаке
      S(3, c => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); });
      fill(paint, Math.min(x0, x1) - w / 2, Math.min(y0, y1) - w / 2, Math.max(x0, x1) + w / 2, Math.max(y0, y1) + w / 2, p);
    }
    function parkedCar(x, y, rot) {
      const sd = sdx(), col = CARC[ri(0, CARC.length - 1)];
      S(20, c => Sym.car(c, x, y, rot, col, sd));
      const v = Math.abs(Math.sin(rot)) > 0.5;
      if (v) solid(x - 3.8, y - 9.4, x + 3.8, y + 9.4, CAR); else solid(x - 9.4, y - 3.8, x + 9.4, y + 3.8, CAR);
    }

    // ---------- подземный паркинг ----------
    function genParking() {
      const wt = 8, rampE = R() < 0.5, rampW = 58, partT = 6, gapN = ri(56, 70), gapS = ri(56, 70);
      const hx0 = rampE ? wt : wt + rampW + partT, hx1 = rampE ? WW - wt - rampW - partT : WW - wt;
      const rx0 = rampE ? hx1 + partT : wt, rx1 = rx0 + rampW, px0 = rampE ? hx1 : rx1;
      const gs = sdx();
      S(0, c => {
        Sym.ground(c, 0, 0, WW, WH, 'concrete', gs);
        c.fillStyle = 'rgba(10,14,22,.55)'; c.fillRect(0, 0, WW, WH);
      });
      // пандус: длинный однородный проезд
      const ry0 = wt + gapN, ry1 = WH - wt - gapS;
      fill(paint, rx0, wt, rx1, WH - wt, 7);
      S(1, c => {
        c.fillStyle = 'rgba(120,125,130,.18)'; c.fillRect(rx0, wt, rampW, WH - 2 * wt);
        c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 0.6; c.beginPath();
        for (let y = wt + 4; y < WH - wt; y += 5) { c.moveTo(rx0 + 2, y); c.lineTo(rx1 - 2, y); } c.stroke();
        c.strokeStyle = 'rgba(242,194,48,.75)'; c.lineWidth = 1.2; c.setLineDash([4, 3]);
        c.beginPath(); c.moveTo(rx0 + 2, ry0); c.lineTo(rx0 + 2, ry1); c.moveTo(rx1 - 2, ry0); c.lineTo(rx1 - 2, ry1); c.stroke(); c.setLineDash([]);
        c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.4;
        for (let y = ry0 + 30; y < ry1 - 20; y += 60) { const xm = (rx0 + rx1) / 2; c.beginPath(); c.moveTo(xm - 7, y + 5); c.lineTo(xm, y - 3); c.lineTo(xm + 7, y + 5); c.stroke(); }
        c.save(); c.translate((rx0 + rx1) / 2, (ry0 + ry1) / 2); c.rotate(-Math.PI / 2); api.text(c, 'ПАНДУС  i = 15 %', 0, 3, 7, 'rgba(255,255,255,.45)'); c.restore();
      });
      degen.push({ x0: rx0, y0: ry0 - 6, x1: rx1, y1: ry1 + 6 });
      // приметы на пандусе: пожарные шкафы у стены
      const nf = ri(1, 2);
      for (let k = 0; k < nf; k++) {
        const fy = ry0 + (ry1 - ry0) * (k + 1) / (nf + 1) + rr(-25, 25), ox = rampE ? rx1 : rx0, fx0 = rampE ? ox - 4 : ox, fx1 = fx0 + 4;
        solid(fx0, fy - 6, fx1, fy + 6, LOW); feats.push({ x: (fx0 + fx1) / 2, y: fy });
        S(8, c => { c.fillStyle = '#b3241c'; c.fillRect(fx0, fy - 6, 4, 12); c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(fx0 + 1, fy - 1, 2, 2); });
      }
      // стены
      const walls = [[0, 0, WW, wt], [0, WH - wt, WW, WH], [0, 0, wt, WH], [WW - wt, 0, WW, WH], [px0, ry0, px0 + partT, ry1]];
      for (const w of walls) { solid(w[0], w[1], w[2], w[3], WALL); S(30, c => drawWall(c, w[0], w[1], w[2], w[3])); }
      // ряды стоянок и проезды
      const cross = 30, bx0 = hx0 + cross, bx1 = hx1 - cross;
      const midX = bx0 + 10 * ri(Math.floor((bx1 - bx0) * 0.35 / 10), Math.floor((bx1 - bx0) * 0.55 / 10)), midW = 30;
      const segs = [[bx0, midX], [midX + midW, bx1]];
      const aisles = [];
      let y = wt + 20;
      const bays = (y0, depth, rot, lineTop) => {
        for (const [a, b] of segs) {
          const n = Math.floor((b - a) / 10);
          for (let i = 0; i <= n; i++) line(a + i * 10, y0 + 1, a + i * 10, y0 + depth - 1, 0.7, 'rgba(240,240,232,.8)', 1);
          line(a, lineTop, a + n * 10, lineTop, 0.7, 'rgba(240,240,232,.55)', 1);
          for (let i = 0; i < n; i++) if (R() < 0.6) parkedCar(a + i * 10 + 5, y0 + depth / 2, rot);
        }
      };
      bays(wt, 20, -Math.PI / 2, wt + 20);
      const aw = ri(25, 28), dd = 46;
      for (let d = 0; d < 4; d++) {
        aisles.push(y + aw / 2); y += aw;
        bays(y, 20, Math.PI / 2, y);
        bays(y + 26, 20, -Math.PI / 2, y + dd);
        const cy0 = y + 23;
        for (const [a, b] of segs) for (let x = a; x <= b + 0.1; x += 30) { solid(x - 2.5, cy0 - 2.5, x + 2.5, cy0 + 2.5, COL); S(25, c => drawColumn(c, x, cy0, 5)); }
        y += dd;
      }
      aisles.push(y + aw / 2); y += aw;
      // осевые линии проездов
      for (const ay of aisles) {
        for (let x = hx0 + 12; x < hx1 - 12; x += 16) line(x, ay, x + 7, ay, 0.6, 'rgba(242,194,48,.55)', 2);
      }
      // лифтовой холл со стеклянной стеной и дверью
      const lw = 96, ld = 52, lx0 = bx0 + 10 * ri(4, Math.floor((bx1 - bx0 - lw - 40) / 10)), lx1 = lx0 + lw, ly0 = WH - wt - ld;
      const dcx = (lx0 + lx1) / 2 + rr(-20, 20), dx0 = dcx - 8, dx1 = dcx + 8;
      fill(paint, lx0, ly0, lx1, WH - wt, 5);
      S(2, c => { Sym.ground(c, lx0, ly0, lw, ld, 'tiles', gs + 7); c.fillStyle = 'rgba(12,16,24,.3)'; c.fillRect(lx0, ly0, lw, ld); });
      for (const w of [[lx0, ly0, lx0 + 5, WH - wt], [lx1 - 5, ly0, lx1, WH - wt]]) { solid(w[0], w[1], w[2], w[3], WALL); S(30, c => drawWall(c, w[0], w[1], w[2], w[3])); }
      for (const g of [[lx0 + 5, dx0 - 2], [dx1 + 2, lx1 - 5]]) { solid(g[0], ly0, g[1], ly0 + 1.6, GLH); glass.push({ x0: g[0], y0: ly0, x1: g[1], y1: ly0 + 1.6 }); }
      for (const p of [[dx0 - 2, dx0], [dx1, dx1 + 2]]) { solid(p[0], ly0 - 0.4, p[1], ly0 + 2, WALL); S(31, c => { c.fillStyle = '#5b5f66'; c.fillRect(p[0], ly0 - 0.4, 2, 2.4); }); }
      narrow.push({ x0: dx0 - 5, y0: ly0 - 9, x1: dx1 + 5, y1: ly0 + 10 });
      S(9, c => { // лифты, скамья, надпись
        for (const k of [0.3, 0.7]) { const x = lx0 + lw * k; c.fillStyle = '#8f969e'; c.fillRect(x - 9, WH - wt - 2.5, 18, 2.5); c.strokeStyle = '#2c3036'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(x, WH - wt - 2.5); c.lineTo(x, WH - wt); c.stroke(); }
        api.text(c, 'ЛИФТЫ', (lx0 + lx1) / 2, WH - wt - 8, 5.5, 'rgba(255,255,255,.55)');
      });
      for (let k = 0; k < 5; k++) line(dx0 + 1 + k * 3.5, ly0 - 14, dx0 + 1 + k * 3.5, ly0 - 4, 1.6, 'rgba(240,240,232,.6)', 1);   // «зебра» у двери
      solid(lx0 + 12, ly0 + 16, lx0 + 22, ly0 + 19, LOW); S(21, c => Sym.bench(c, lx0 + 17, ly0 + 17.5, 0));
      // стоянки вдоль южной стены, кроме холла
      const sy0 = WH - wt - 20;
      for (const [a, b] of [[bx0, lx0 - 10], [lx1 + 10, bx1]]) {
        const n = Math.floor((b - a) / 10); if (n < 1) continue;
        for (let i = 0; i <= n; i++) line(a + i * 10, sy0 + 1, a + i * 10, WH - wt - 1, 0.7, 'rgba(240,240,232,.8)', 1);
        line(a, sy0, a + n * 10, sy0, 0.7, 'rgba(240,240,232,.55)', 1);
        for (let i = 0; i < n; i++) if (R() < 0.55) parkedCar(a + i * 10 + 5, sy0 + 10, Math.PI / 2);
      }
      // свет: пятна светильников на полу
      const lamps = [];
      for (const ay of aisles) for (let x = hx0 + 40; x < hx1 - 20; x += 64) lamps.push([x + rr(-6, 6), ay]);
      for (let yy = ry0 + 40; yy < ry1; yy += 80) lamps.push([(rx0 + rx1) / 2, yy]);
      S(40, c => {
        for (const [x, yy] of lamps) {
          const g = c.createRadialGradient(x, yy, 0, x, yy, 34); g.addColorStop(0, 'rgba(255,244,214,.16)'); g.addColorStop(1, 'rgba(255,244,214,0)');
          c.fillStyle = g; c.fillRect(x - 34, yy - 34, 68, 68);
          c.fillStyle = 'rgba(255,250,235,.55)'; c.fillRect(x - 5, yy - 0.7, 10, 1.4);
        }
      });
      // подвижные машины: петли по двум проездам и поперечным проездам
      const xw = hx0 + cross / 2, xe = hx1 - cross / 2;
      const order = [0, 1, 2, 3, 4].sort(() => R() - 0.5);
      for (let k = 0; k < 2; k++) {
        const a = Math.min(order[k * 2], order[k * 2 + 1]), b = Math.max(order[k * 2], order[k * 2 + 1]);
        const ya = aisles[a], yb = aisles[b === a ? Math.min(4, a + 1) : b];
        const pts = [{ x: xw, y: ya }, { x: xe, y: ya }, { x: xe, y: yb }, { x: xw, y: yb }, { x: xw, y: ya }];
        if (R() < 0.5) pts.reverse();
        carRoutes.push({ pts, loop: true });
      }
      // места для людей: холл и проезды
      spots.push({ x: dcx, y: ly0 + 26 });
      for (const ay of aisles) for (let k = 0; k < 4; k++) spots.push({ x: rr(hx0 + 10, hx1 - 10), y: ay });
      // старт — в открытой южной полосе, подальше от холла
      const sxA = lx0 - 60 > hx0 + 30 ? rr(hx0 + 25, Math.min(lx0 - 40, hx0 + 160)) : rr(lx1 + 40, Math.min(hx1 - 25, lx1 + 160));
      start = { x: sxA, y: (y + sy0) / 2 };
      markN = ri(4, 6);
    }

    // ---------- двор с аркой, RTK ----------
    function genYard() {
      const stW = ri(60, 68), bw = ri(70, 86), wx0 = stW, wx1 = stW + bw;
      const sd = ri(54, 64), sy1 = WH - ri(86, 96), sy0 = sy1 - sd;
      const nd = ri(66, 82), ed = ri(60, 76), ex0 = WW - ed;
      const ay = ri(140, sy0 - 60), ah = 28;
      const lx = 10 * ri(Math.ceil((wx1 + 130) / 10), Math.floor((ex0 - 150) / 10)), lw = 20;
      const gs = sdx();
      // покрытия
      fill(paint, 0, 0, WW, WH, 6);
      S(0, c => {
        Sym.ground(c, 0, 0, WW, WH, 'asphalt', gs);
        Sym.ground(c, stW - 24, 0, 24, sy1 + 24, 'tiles', gs + 1);
        Sym.ground(c, 0, sy1, WW, 22, 'tiles', gs + 2);
      });
      fill(paint, stW - 24, 0, stW, sy1 + 22, 5); fill(paint, 0, sy1, WW, sy1 + 22, 5);
      // проезжая часть: осевая и бордюр
      line(0, sy1 + 22 + (WH - sy1 - 22) / 2, WW, sy1 + 22 + (WH - sy1 - 22) / 2, 0.8, 'rgba(245,245,240,.85)', 1);
      for (let x = 10; x < WW; x += 22) line(x, WH - 6, x + 10, WH - 6, 0.6, 'rgba(245,245,240,.5)', 1);
      line((stW - 24) / 2, 0, (stW - 24) / 2, sy1, 0.8, 'rgba(245,245,240,.6)', 1);
      // двор: газон с деревьями, детская площадка, проезд вдоль домов
      const yx0 = wx1, yx1 = ex0, yy0 = nd, yy1 = sy0;
      const lmx0 = yx0 + ri(34, 44), lmx1 = yx1 - ri(34, 44), lmy0 = yy0 + ri(36, 44), lmy1 = yy1 - ri(26, 32);
      fill(paint, lmx0, lmy0, lmx1, lmy1, 4);
      S(1, c => {
        Sym.ground(c, lmx0, lmy0, lmx1 - lmx0, lmy1 - lmy0, 'lawn', gs + 3);
        c.strokeStyle = 'rgba(190,190,180,.9)'; c.lineWidth = 0.8; c.strokeRect(lmx0, lmy0, lmx1 - lmx0, lmy1 - lmy0);
      });
      // дорожка через газон
      const pxm = (lmx0 + lmx1) / 2 + rr(-60, 60);
      fill(paint, pxm - 5, lmy0, pxm + 5, lmy1, 5);
      S(2, c => Sym.ground(c, pxm - 5, lmy0, 10, lmy1 - lmy0, 'tiles', gs + 4));
      // дома
      const blds = [
        [wx0, 0, bw, ay, 9], [wx0, ay + ah, bw, sy1 - ay - ah, 9],
        [wx1, 0, WW - wx1, nd, 9], [ex0, nd, ed, sy0 - nd, 9],
        [wx1, sy0, lx - wx1, sd, 5], [lx + lw, sy0, WW - lx - lw, sd, 5],
      ];
      const bcol = ['#b9b2a6', '#c9bfae', '#a9a49c', '#c2b49a'][ri(0, 3)];
      for (const b of blds) { solid(b[0], b[1], b[0] + b[2], b[1] + b[3], BLD); const s = sdx(); S(50, c => Sym.building(c, b[0], b[1], b[2], b[3], { floors: b[4], color: bcol, seed: s })); }
      // арка: крытый проезд сквозь дом
      fill(paint, wx0, ay, wx1, ay + ah, 5);
      S(51, c => {
        c.fillStyle = '#3a3936'; c.fillRect(wx0, ay, bw, ah);
        c.fillStyle = 'rgba(0,0,0,.25)'; for (let x = wx0 + 3; x < wx1; x += 6) c.fillRect(x, ay, 3, ah);
        c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 0.6; c.setLineDash([3, 2]); c.strokeRect(wx0, ay, bw, ah); c.setLineDash([]);
        api.text(c, 'арка', (wx0 + wx1) / 2, ay + ah / 2 + 2.5, 7, 'rgba(255,255,255,.7)');
      });
      noneZ.push({ x0: wx0 - 2, y0: ay, x1: wx1 + 2, y1: ay + ah }); degen.push({ x0: wx0 + 6, y0: ay, x1: wx1 - 6, y1: ay + ah, k: 2.6 });
      narrow.push({ x0: wx0 - 6, y0: ay - 2, x1: wx0 + 8, y1: ay + ah + 2 }, { x0: wx1 - 8, y0: ay - 2, x1: wx1 + 6, y1: ay + ah + 2 });
      // проулок между домами
      fill(paint, lx, sy0, lx + lw, sy1, 6);
      S(51, c => { c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(lx, sy0, lw, sd); });
      noneZ.push({ x0: lx, y0: sy0, x1: lx + lw, y1: sy1 });
      narrow.push({ x0: lx - 2, y0: sy0 - 6, x1: lx + lw + 2, y1: sy1 + 6 });
      // витрины магазинов на улицу: стекло, за ним торговый зал
      const names = ['ПРОДУКТЫ', 'АПТЕКА', 'КОФЕ', 'ЦВЕТЫ', 'ОПТИКА', 'ПЕКАРНЯ'].sort(() => R() - 0.5);
      let ni = 0;
      for (const [a, b] of [[wx1 + 14, lx - 10], [lx + lw + 12, WW - 16]]) {
        let x = a;
        while (x + 46 < b) {
          const w = Math.min(b - x, ri(46, 70)), dep = 24, nm = names[ni++ % names.length];
          solid(x, sy1 - dep, x + w, sy1, FREE);
          fill(paint, x, sy1 - dep, x + w, sy1, 5);
          solid(x, sy1 - 1.6, x + w, sy1, GLH); glass.push({ x0: x, y0: sy1 - 1.6, x1: x + w, y1: sy1 });
          solid(x - 2, sy1 - dep, x, sy1, BLD); solid(x + w, sy1 - dep, x + w + 2, sy1, BLD);
          S(52, c => {
            c.fillStyle = '#6f6a62'; c.fillRect(x - 1, sy1 - dep - 1, w + 2, dep + 1);
            c.fillStyle = '#d8d2c6'; c.fillRect(x, sy1 - dep, w, dep - 1);
            c.fillStyle = 'rgba(120,110,95,.6)'; for (let k = x + 6; k < x + w - 6; k += 12) c.fillRect(k, sy1 - dep + 4, 8, 3), c.fillRect(k, sy1 - 12, 8, 3);
            c.fillStyle = '#7a3b2e'; c.fillRect(x - 1, sy1 + 0.2, w + 2, 3);
            for (let k = 0; k * 2 < w; k++) { c.fillStyle = k % 2 ? '#e8e2d4' : '#a8473a'; c.fillRect(x + k * 2, sy1 + 0.2, Math.min(2, w - k * 2), 3); }   // маркиза
            api.text(c, nm, x + w / 2, sy1 - dep / 2 + 2, 5.5, '#3a3530');
          });
          x += w + ri(12, 22);
        }
      }
      S(53, c => { for (const g of glass) { c.fillStyle = 'rgba(150,215,255,.85)'; c.fillRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0); c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(g.x0, g.y0, g.x1 - g.x0, 0.4); } });
      // деревья на газоне
      const trees = [], nt = ri(6, 9);
      for (let k = 0, tries = 0; k < nt && tries < 200; tries++) {
        const r = rr(9, 14), x = rr(lmx0 + 8, lmx1 - 8), y = rr(lmy0 + 8, lmy1 - 8);
        if (Math.abs(x - pxm) < 10) continue;
        if (trees.some(t => hyp(t.x - x, t.y - y) < t.r + r)) continue;
        trees.push({ x, y, r }); k++;
      }
      // детская площадка
      const pw = 46, ph = 32;
      let pg = null;
      for (let tries = 0; tries < 60 && !pg; tries++) {
        const x = rr(lmx0 + 6, lmx1 - pw - 6), y = rr(lmy0 + 6, lmy1 - ph - 6);
        if (x < pxm + 8 && x + pw > pxm - 8) continue;
        if (trees.some(t => t.x > x - t.r && t.x < x + pw + t.r && t.y > y - t.r && t.y < y + ph + t.r)) continue;
        pg = { x, y };
      }
      if (pg) {
        const s = sdx(); S(10, c => Sym.playground(c, pg.x, pg.y, pw, ph, s));
        solid(pg.x + 8, pg.y + 6, pg.x + 18, pg.y + 14, LOW); solid(pg.x + 28, pg.y + 16, pg.x + 38, pg.y + 26, LOW);
        fill(paint, pg.x, pg.y, pg.x + pw, pg.y + ph, 0);
      }
      for (const t of trees) {
        const s = sdx(), kind = ['deciduous', 'birch', 'deciduous', 'conifer', 'apple'][ri(0, 4)];
        S(60, c => Sym.tree(c, t.x, t.y, t.r, kind, s));
        fillC(mat, t.x, t.y, 1.6, TRUNK); fillC(canopy, t.x, t.y, t.r, 1);
      }
      // скамейки и фонари
      for (let k = 0; k < 4; k++) {
        const x = rr(lmx0 + 10, lmx1 - 10), y = R() < 0.5 ? lmy0 - 4 : lmy1 + 4;
        S(22, c => Sym.bench(c, x, y, 0)); solid(x - 3.6, y - 1.3, x + 3.6, y + 1.3, LOW);
      }
      for (let x = yx0 + 30; x < yx1 - 10; x += 70) { const y = lmy1 + 10; S(65, c => Sym.pole(c, x, y, 'lamp', -Math.PI / 2)); solid(x - 0.8, y - 0.8, x + 0.8, y + 0.8, LOW); }
      for (let y = 30; y < sy1; y += 80) { const x = stW - 3; S(65, c => Sym.pole(c, x, y, 'lamp', Math.PI)); solid(x - 0.8, y - 0.8, x + 0.8, y + 0.8, LOW); }
      // машины у дома во дворе и вдоль улиц
      const cy = yy0 + 11;
      for (let x = yx0 + 30; x + 10 < yx1 - 20; x += 10) {
        line(x, yy0 + 1, x, yy0 + 21, 0.6, 'rgba(245,245,240,.7)', 1);
        if (R() < 0.55) parkedCar(x + 5, cy, -Math.PI / 2);
      }
      for (let y = 30; y < sy1 - 20; y += 24) if (R() < 0.45 && Math.abs(y - (ay + ah / 2)) > 30) parkedCar(8, y, Math.PI / 2 * (R() < 0.5 ? 1 : -1));
      for (let x = 30; x < WW - 30; x += 26) if (R() < 0.35 && Math.abs(x - lx - lw / 2) > 30) parkedCar(x, WH - 10, R() < 0.5 ? 0 : Math.PI);
      // люки
      for (let k = 0; k < 6; k++) {
        const kind = ['sewer', 'water', 'heat', 'storm', 'tele'][ri(0, 4)];
        const x = k < 3 ? rr(yx0 + 20, yx1 - 20) : rr(20, WW - 20), y = k < 3 ? rr(yy0 + 26, lmy0 - 6) : sy1 + rr(30, 50);
        S(4, c => Sym.manhole(c, x, y, kind));
      }
      // движение: машина по улице, пешеходы
      const ln1 = sy1 + 22 + (WH - sy1 - 22) * 0.3, ln2 = sy1 + 22 + (WH - sy1 - 22) * 0.7;
      carRoutes.push({ pts: [{ x: -30, y: ln1 }, { x: WW + 30, y: ln1 }], loop: false }, { pts: [{ x: WW + 30, y: ln2 }, { x: -30, y: ln2 }], loop: false });
      for (let k = 0; k < 8; k++) spots.push({ x: rr(yx0 + 20, yx1 - 20), y: rr(yy0 + 26, yy1 - 8) });
      for (let k = 0; k < 4; k++) spots.push({ x: rr(30, WW - 30), y: sy1 + rr(4, 18) });
      spots.push({ x: stW - 12, y: rr(30, sy1 - 30) }, { x: (wx0 + wx1) / 2, y: ay + ah / 2 });
      // старт — во дворе, на открытом месте у дорожки газона
      start = { x: clamp(pxm + (R() < 0.5 ? -1 : 1) * rr(40, 90), yx0 + 30, yx1 - 30), y: (lmy1 + yy1) / 2 + 2 };
      markN = ri(4, 6);
    }

    if (YARD) genYard(); else genParking();

    // ---------- проходимость (с запасом на «радиус» топографа) ----------
    const blocked = new Uint8Array(NN), reach = new Uint8Array(NN), degK = new Float32Array(NN).fill(1), rtk = new Uint8Array(NN);
    const wcell = (x, y) => clamp(Math.floor(y / WG), 0, NH - 1) * NW + clamp(Math.floor(x / WG), 0, NW - 1);
    const wx = c => (c % NW + 0.5) * WG, wy = c => (Math.floor(c / NW) + 0.5) * WG;
    const matAt = (x, y) => (x < 0 || y < 0 || x >= WW || y >= WH) ? WALL : mat[(y / G | 0) * GW + (x / G | 0)];
    for (let c = 0; c < NN; c++) {
      const x = wx(c), y = wy(c);
      if (x < 4 || y < 4 || x > WW - 4 || y > WH - 4) { blocked[c] = 1; continue; }
      let b = 0;
      for (let dy = -HR - 1; dy <= HR + 1 && !b; dy += 1) for (let dx = -HR - 1; dx <= HR + 1; dx += 1) { if (matAt(x + dx, y + dy)) { b = 1; break; } }
      blocked[c] = b;
    }
    const free = (x, y) => x >= 0 && y >= 0 && x < WW && y < WH && !blocked[wcell(x, y)];
    function nearestFreeCell(x, y, maxR, needReach) {
      const i0 = Math.floor(x / WG), j0 = Math.floor(y / WG);
      let best = -1, bd = Infinity;
      for (let r = 0; r <= (maxR || 20); r++) {
        for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= NW || j >= NH) continue;
          const c = j * NW + i; if (blocked[c] || (needReach && !reach[c])) continue;
          const d = hyp(wx(c) - x, wy(c) - y); if (d < bd) { bd = d; best = c; }
        }
        if (best >= 0 && r * WG > bd + WG) break;
      }
      return best;
    }
    { const c = nearestFreeCell(start.x, start.y, 30, false); if (c >= 0) { start = { x: wx(c), y: wy(c) }; } }
    const sc0 = wcell(start.x, start.y);
    { const q = [sc0]; reach[sc0] = 1; for (let k = 0; k < q.length; k++) { const c = q[k], i = c % NW, j = (c / NW) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= NW || nj >= NH) continue; const n = nj * NW + ni; if (!blocked[n] && !reach[n]) { reach[n] = 1; q.push(n); } } } }
    // вырожденные места: вдали от стен и примет дрейф растёт в 3–4 раза
    for (let c = 0; c < NN; c++) {
      if (blocked[c]) continue;
      const x = wx(c), y = wy(c), z = inZ(degen, x, y); if (!z) continue;
      if (z.k) { degK[c] = z.k; continue; }
      let near = feats.some(f => hyp(f.x - x, f.y - y) < 18);
      for (let a = 0; a < 16 && !near; a++) { const ca = Math.cos(a / 16 * TAU), sa = Math.sin(a / 16 * TAU); for (let t = 2; t <= 11; t += 1.5) if (matAt(x + ca * t, y + sa * t)) { near = true; break; } }
      degK[c] = near ? 1.25 : 3.6;
    }
    // RTK: FIX под открытым небом, FLOAT у домов и под кронами, NONE в арке и проулке
    if (YARD) for (let c = 0; c < NN; c++) {
      if (blocked[c] && !reach[c]) continue;
      const x = wx(c), y = wy(c);
      if (inZ(noneZ, x, y)) { rtk[c] = 2; continue; }
      let near = canopy[(y / G | 0) * GW + (x / G | 0)] ? 1 : 0;
      for (let a = 0; a < 12 && !near; a++) { const ca = Math.cos(a / 12 * TAU), sa = Math.sin(a / 12 * TAU); for (let t = 4; t <= 22; t += 3) if (matAt(x + ca * t, y + sa * t) === BLD) { near = 1; break; } }
      rtk[c] = near;
    }
    // требуемый охват: пол, связанный со стартом (по сетке материалов)
    const req = new Uint8Array(CW * CH), covN = new Uint8Array(CW * CH);
    let needCov = 0, covered = 0;
    {
      const flood = new Uint8Array(NG), s = (start.y / G | 0) * GW + (start.x / G | 0), q = [s]; flood[s] = 1;
      for (let k = 0; k < q.length; k++) { const c = q[k], i = c % GW, j = (c / GW) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 1 || nj < 1 || ni >= GW - 1 || nj >= GH - 1) continue; const n = nj * GW + ni; if (!mat[n] && !flood[n]) { flood[n] = 1; q.push(n); } } }
      const cnt = new Uint8Array(CW * CH), per = CC / G;
      for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (flood[j * GW + i]) cnt[((j / per) | 0) * CW + ((i / per) | 0)]++;
      for (let c = 0; c < CW * CH; c++) if (cnt[c] >= per * per * 0.6) { req[c] = 1; needCov++; }
    }
    // опорные марки: разнесены по участку, на доступном свободном месте
    const marks = [];
    {
      const cand = [];
      for (let c = 0; c < NN; c++) {
        if (!reach[c]) continue;
        const i = c % NW, j = (c / NW) | 0; let ok = i > 1 && j > 1 && i < NW - 2 && j < NH - 2;
        for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) if (blocked[(j + dj) * NW + i + di]) { ok = false; break; }
        const x = wx(c), y = wy(c);
        if (!ok || inZ(narrow, x, y) || inZ(noneZ, x, y) || degK[c] > 2) continue;
        if (YARD && canopy[(y / G | 0) * GW + (x / G | 0)]) continue;
        cand.push(c);
      }
      const chosen = [{ x: start.x, y: start.y }];
      for (let k = 0; k < markN && cand.length; k++) {
        const sc = cand.map(c => { let d = Infinity; for (const p of chosen) d = Math.min(d, hyp(wx(c) - p.x, wy(c) - p.y)); return { c, d }; }).sort((a, b) => b.d - a.d);
        const pick = sc[Math.floor(R() * Math.min(sc.length, Math.max(3, sc.length * 0.05)))];
        const m = { x: wx(pick.c), y: wy(pick.c), n: k + 1, done: false, hold: 0 };
        marks.push(m); chosen.push(m);
      }
      for (const m of marks) {
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) fill(paint, m.x + di * 2 - 1, m.y + dj * 2 - 1, m.x + di * 2 + 1, m.y + dj * 2 + 1, (di + dj) & 1 ? 0 : 3);
        S(5, c => drawMarkPlate(c, m.x, m.y));
      }
      fill(paint, start.x - 3, start.y - 0.8, start.x + 3, start.y + 0.8, 3); fill(paint, start.x - 0.8, start.y - 3, start.x + 0.8, start.y + 3, 3);
      S(5, c => {
        c.strokeStyle = 'rgba(255,90,70,.9)'; c.lineWidth = 0.9; c.beginPath(); c.arc(start.x, start.y, 5, 0, TAU); c.stroke();
        c.beginPath(); c.moveTo(start.x - 4, start.y); c.lineTo(start.x + 4, start.y); c.moveTo(start.x, start.y - 4); c.lineTo(start.x, start.y + 4); c.stroke();
      });
    }
    function drawMarkPlate(c, x, y) { // марка: шахматная мишень 0,75 м на полу
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x - 3 + 0.5, y - 3 + 0.5, 6, 6);
      c.fillStyle = '#f4f2ea'; c.fillRect(x - 3, y - 3, 6, 6);
      c.fillStyle = '#16181a'; c.fillRect(x - 3, y - 3, 3, 3); c.fillRect(x, y, 3, 3);
      c.strokeStyle = '#d6302a'; c.lineWidth = 0.4; c.strokeRect(x - 3, y - 3, 6, 6);
    }

    // ---------- поиск пути (A*), сглаживание ----------
    const gMark = new Uint32Array(NN), gCost = new Float32Array(NN), gFrom = new Int32Array(NN), gDone = new Uint32Array(NN);
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
      const st = ++stamp, ex = e % NW, ey = (e / NW) | 0;
      const heur = c => { const dx = Math.abs(c % NW - ex), dy = Math.abs(((c / NW) | 0) - ey); return dx + dy - 0.5858 * Math.min(dx, dy); };
      hpC.length = 0; hpF.length = 0;
      gMark[s] = st; gCost[s] = 0; gFrom[s] = -1; hpush(s, heur(s));
      let it = 0;
      while (hpC.length && it++ < 30000) {
        const c = hpop();
        if (c === e) break;
        if (gDone[c] === st) continue; gDone[c] = st;
        const i = c % NW, j = (c / NW) | 0;
        for (const [di, dj, w] of NB) {
          const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= NW || nj >= NH) continue;
          const n = nj * NW + ni; if (blocked[n]) continue;
          if (di && dj && (blocked[j * NW + ni] || blocked[nj * NW + i])) continue;
          const nc = gCost[c] + w * (degK[n] > 2 ? 2.5 : 1);   // путь сам жмётся к стенам однородного проезда
          if (gMark[n] !== st || nc < gCost[n]) { gMark[n] = st; gCost[n] = nc; gFrom[n] = c; hpush(n, nc + heur(n)); }
        }
      }
      if (gMark[e] !== st) return null;
      const out = []; for (let c = e; c !== -1; c = gFrom[c]) out.push(c);
      return out.reverse();
    }
    function walkLine(ax, ay, bx, by) {
      const L = hyp(bx - ax, by - ay), n = Math.ceil(L / (WG * 0.5));
      for (let k = 1; k <= n; k++) { const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t; if (!free(x, y) || degK[wcell(x, y)] > 2 !== degK[wcell(ax, ay)] > 2) return false; }
      return true;
    }
    function smooth(cells, sx, sy) { // «натягивание нити»: срезаем углы, пока прямая свободна
      const P = cells.map(c => ({ x: wx(c), y: wy(c) })), out = [];
      let cur = { x: sx, y: sy }, i = 0;
      while (i < P.length) {
        let j = i;
        for (let k = i + 1; k < P.length; k++) { if (walkLine(cur.x, cur.y, P[k].x, P[k].y)) j = k; else if (k - j > 8) break; }
        out.push(P[j]); cur = P[j]; i = j + 1;
      }
      return out;
    }
    function pathTo(fx, fy, x, y) {
      let gc = wcell(x, y), exact = true;
      if (blocked[gc] || !reach[gc]) { gc = nearestFreeCell(x, y, 20, true); exact = false; if (gc < 0) return null; }
      const sc = blocked[wcell(fx, fy)] ? nearestFreeCell(fx, fy, 6, false) : wcell(fx, fy);
      const cells = astar(sc, gc); if (!cells) return null;
      const p = smooth(cells, fx, fy);
      if (exact && p.length) p[p.length - 1] = { x, y };
      return p;
    }

    // ---------- слой объекта (статичный рисунок) ----------
    let layer = null, layerFail = 0;
    statics.sort((a, b) => a.z - b.z || a.i - b.i);
    function buildLayer(k) {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(WW * k); cv.height = Math.ceil(WH * k);
      const c = cv.getContext('2d'); c.setTransform(k, 0, 0, k, 0, 0);
      const was = Sym.cache; Sym.cache = false;
      try { for (const s of statics) s.f(c); } catch (e) { console.error(e); } finally { Sym.cache = was; }
      layer = { c: cv, k };
    }
    const gameCanvas = typeof document !== 'undefined' && document.getElementById('game');
    const k0 = gameCanvas && gameCanvas.width ? gameCanvas.width / api.W : 2;
    buildLayer(clamp(k0 * Z, 1, 3));
    // пикселей облака на единицу мира — как у экрана: тогда облако выводится 1:1, без масштабирования
    const CK = clamp(Math.round(k0 * Z * 1000) / 1000, 1.5, 3), CPW = Math.ceil(WW * CK), CPH = Math.ceil(WH * CK), PS = CK >= 2.6 ? 2 : 1;

    // ---------- облако точек: буфер пикселей + хранилище для перерисовки ----------
    // холст облака — плитками 128 px: обновляются и рисуются только те, где есть точки
    const TS = 128, TX = Math.ceil(CPW / TS), TY = Math.ceil(CPH / TS);
    const img = new ImageData(CPW, CPH), buf = new Uint32Array(img.data.buffer), occ = new Uint8Array(CPW * CPH);
    const tiles = [];
    for (let j = 0; j < TY; j++) for (let i = 0; i < TX; i++) {
      const w = Math.min(TS, CPW - i * TS), h = Math.min(TS, CPH - j * TS), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      tiles.push({ cv, c: cv.getContext('2d'), x: i * TS, y: j * TS, w, h, used: false, x0: 1e9, y0: 1e9, x1: -1, y1: -1 });
    }
    let fullDirty = false, anyDirty = false;
    const PX = new Float32Array(CAP), PY = new Float32Array(CAP), PC = new Uint32Array(CAP), PK = new Uint16Array(CAP);
    let np = 0;
    const MAXK = 65000;   // куски траектории: у каждого свой дрейф (его правит замыкание петли)
    const cdx = new Float32Array(MAXK), cdy = new Float32Array(MAXK), cs = new Float32Array(MAXK), ct = new Float32Array(MAXK), cn = new Uint32Array(MAXK), cb = new Uint8Array(MAXK);
    let nk = 0, kc = 0, kT = 0, offX = 0, offY = 0;
    const vclamp = v => clamp(v * VIS, -30, 30);
    const dith = (px, py) => (((px * 73856093) ^ (py * 19349663)) >>> 0) % 100 < 46;   // пол — точками, не сплошной заливкой
    function plot(x, y, col, floor) { // точка в буфер; true — новая
      const px = (x * CK) | 0, py = (y * CK) | 0;
      if (px < 0 || py < 0 || px >= CPW || py >= CPH) return false;
      if (floor && !dith(px, py)) return false;
      const i = py * CPW + px;
      if (occ[i]) return false;
      occ[i] = 1; buf[i] = col;
      if (PS > 1 && px + 1 < CPW && py + 1 < CPH) { buf[i + 1] = col; buf[i + CPW] = col; buf[i + CPW + 1] = col; }
      const tl = tiles[(py >> 7) * TX + (px >> 7)];
      if (px < tl.x0) tl.x0 = px; if (px > tl.x1) tl.x1 = px; if (py < tl.y0) tl.y0 = py; if (py > tl.y1) tl.y1 = py;
      anyDirty = true;
      return true;
    }
    function emit(x, y, col, floor) { // точка с текущим дрейфом
      if (!plot(x + offX, y + offY, col, floor)) return false;
      mini(x + offX, y + offY, col, floor);
      if (np < CAP) { PX[np] = x; PY[np] = y; PC[np] = col; PK[np] = kc; np++; cn[kc]++; }
      return true;
    }
    function redrawCloud() {
      buf.fill(0); occ.fill(0); mbuf.fill(0); mpri.fill(0);
      for (let i = 0; i < np; i++) {
        const k = PK[i], x = PX[i] + vclamp(cdx[k]), y = PY[i] + vclamp(cdy[k]), px = (x * CK) | 0, py = (y * CK) | 0;
        mini(x, y, PC[i], (PC[i] >>> 24) < 200);
        if (px < 0 || py < 0 || px >= CPW || py >= CPH) continue;
        const j = py * CPW + px, col = PC[i]; occ[j] = 1; buf[j] = col;
        if (PS > 1 && px + 1 < CPW && py + 1 < CPH) { buf[j + 1] = col; buf[j + CPW] = col; buf[j + CPW + 1] = col; }
      }
      fullDirty = true;
    }
    function flushCloud() {
      if (fullDirty) {
        for (const tl of tiles) {
          if (tl.x1 >= 0 && PS > 1) { tl.x1 = Math.min(tl.x + tl.w - 1, tl.x1 + 1); tl.y1 = Math.min(tl.y + tl.h - 1, tl.y1 + 1); }
          const was = tl.used; tl.used = tl.x1 >= 0 || was;
          if (tl.used) { tl.c.clearRect(0, 0, tl.w, tl.h); tl.c.putImageData(img, -tl.x, -tl.y, tl.x, tl.y, tl.w, tl.h); }
          tl.x0 = tl.y0 = 1e9; tl.x1 = tl.y1 = -1;
        }
        fullDirty = false; anyDirty = false; return;
      }
      if (!anyDirty) return;
      for (const tl of tiles) {
        if (tl.x1 < 0) continue;
        if (PS > 1) { tl.x1 = Math.min(tl.x + tl.w - 1, tl.x1 + 1); tl.y1 = Math.min(tl.y + tl.h - 1, tl.y1 + 1); }
        tl.used = true; tl.c.putImageData(img, -tl.x, -tl.y, tl.x0, tl.y0, tl.x1 - tl.x0 + 1, tl.y1 - tl.y0 + 1);
        tl.x0 = tl.y0 = 1e9; tl.x1 = tl.y1 = -1;
      }
      anyDirty = false;
    }
    function drawCloud(c, x0, y0, x1, y1, ox, oy, s) { // плитки облака в мировом прямоугольнике → c (масштаб s от мировых единиц)
      for (const tl of tiles) {
        if (!tl.used) continue;
        const wx0 = tl.x / CK, wy0 = tl.y / CK, ww = tl.w / CK, wh = tl.h / CK;
        if (wx0 > x1 || wy0 > y1 || wx0 + ww < x0 || wy0 + wh < y0) continue;
        c.drawImage(tl.cv, ox + wx0 * s, oy + wy0 * s, ww * s, wh * s);
      }
    }
    let snapCv = null, snapT = 9, vign = null;
    function vignette(k) { // круг «фонаря»: от прозрачного к цвету фона, в пикселях экрана
      const n = Math.ceil(RV * 2 * k), cv = document.createElement('canvas'); cv.width = cv.height = n;
      const c = cv.getContext('2d'), g = c.createRadialGradient(n / 2, n / 2, RV * 0.3 * k, n / 2, n / 2, RV * k);
      g.addColorStop(0, `rgba(${BG},0)`); g.addColorStop(1, `rgba(${BG},1)`); c.fillStyle = g; c.fillRect(0, 0, n, n);
      return { cv, k };
    }
    function snapshot() { // облако до замыкания петли — для плавного «защёлкивания»
      flushCloud();
      if (!snapCv) { snapCv = document.createElement('canvas'); snapCv.width = CPW / 2; snapCv.height = CPH / 2; }
      const c = snapCv.getContext('2d'); c.clearRect(0, 0, CPW / 2, CPH / 2); drawCloud(c, 0, 0, WW, WH, 0, 0, CK / 2);
      snapT = 0;
    }
    // мини-карта облака (обновляется раз в полсекунды)
    const MMW = WW / 4, MMH = WH / 4, miniCv = document.createElement('canvas'); miniCv.width = MMW; miniCv.height = MMH;
    const miniCtx = miniCv.getContext('2d'), mimg = new ImageData(MMW, MMH), mbuf = new Uint32Array(mimg.data.buffer), mpri = new Uint8Array(MMW * MMH);
    function mini(x, y, col, floor) {
      const i = clamp((y / 4) | 0, 0, MMH - 1) * MMW + clamp((x / 4) | 0, 0, MMW - 1), p = floor ? 1 : 2;
      if (p >= mpri[i]) { mpri[i] = p; mbuf[i] = floor ? (col & 0xffffff) | 0x99000000 : col | 0xff000000; }
    }
    let miniT = -9;

    // ---------- состояние ----------
    const hero = { x: start.x, y: start.y, dir: -Math.PI / 2, hv: -Math.PI / 2, ph: 0 };
    let time = 0, over = false, path = null, walkPtr = null, lastRepath = -1, tapFx = null, run = false, dragT = 0;
    let lastTapT = -9, lastTapP = null, vSm = 0, omega = 0, stepT = 0, dist = 0, distLoop = 0;
    let initT = 0, initDone = false, initFails = 0, initFailT = -9, initMoved = 0;
    let endT = 0, holdPtr = null, holdKey = false, readyT = -9, stopT = 0;
    const D = { x: 0, y: 0 };   // текущий дрейф, см
    let dTh = R() * TAU, jerkCool = 0, jerkFx = 0, ghosts = 0, phantoms = 0, glassT = -9, dynT = -9, scanA = 0;
    let rtkNow = 0, rtkPrev = 0, banner = null, warnRunT = -9, lastDegMsg = -9, lastRtkMsg = -9;
    const loops = [], traj = [], lastT = new Float32Array(TW * TH).fill(-1);
    let tcPrev = -1, trajT = 0;
    const keys = { l: 0, r: 0, u: 0, d: 0, run: 0 };
    const R2 = api.rng(seed ^ 0x2545f491), r2 = (a, b) => a + R2() * (b - a);
    const VW = () => api.W / Z, VH = (api.H - TOP) / Z;
    const camMaxX = () => Math.max(0, WW - VW() + 120 / Z), camMaxY = () => Math.max(0, WH - VH + 40 / Z);
    let camX = clamp(hero.x - VW() / 2, 0, camMaxX()), camY = clamp(hero.y - VH / 2, 0, camMaxY());
    function newChunk() {
      if (nk >= MAXK) return;
      kc = nk++; cdx[kc] = D.x; cdy[kc] = D.y; cs[kc] = dist; ct[kc] = time; cn[kc] = 0; cb[kc] = run && vSm > V_WALK * 1.1 ? 1 : 0; kT = 0;
      offX = vclamp(D.x); offY = vclamp(D.y);
    }
    newChunk();

    // ---------- подвижные помехи: машины и люди ----------
    const dyn = [];
    let honkT = -9;
    const cum = p => { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + hyp(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)); return c; };
    const cars = carRoutes.map((r, k) => ({ r, c: cum(r.pts), s: r.loop ? r2(0, 1) * cum(r.pts)[r.pts.length - 1] : -1, v: 0, vmax: r2(18, 24), x: 0, y: 0, a: 0, wait: YARD ? r2(2, 12) + k * 6 : 0, color: CARC[Math.floor(R2() * CARC.length)], seed: Math.floor(R2() * 1e6), moving: false }));
    const people = [];
    for (let k = 0; k < (YARD ? 5 : 4); k++) {
      const sp = spots[Math.floor(R2() * spots.length)], c = nearestFreeCell(sp.x, sp.y, 10, true);
      if (c < 0) continue;
      people.push({ x: wx(c), y: wy(c), dir: 0, path: null, wait: r2(0, 3), v: r2(8, 11), seed: Math.floor(R2() * 1e6), ph: R2() * 9, moving: false });
    }
    function carAt(o) {
      const p = o.r.pts, c = o.c, L = c[c.length - 1];
      let s = o.s; if (o.r.loop) s = ((s % L) + L) % L;
      let i = 1; while (i < p.length - 1 && c[i] < s) i++;
      const a = p[i - 1], b = p[i], t = clamp((s - c[i - 1]) / ((c[i] - c[i - 1]) || 1), 0, 1);
      o.x = a.x + (b.x - a.x) * t; o.y = a.y + (b.y - a.y) * t;
      const ta = Math.atan2(b.y - a.y, b.x - a.x); o.a = o.a + angD(o.a, ta) * 0.25;
    }
    for (const o of cars) { if (o.s >= 0) { carAt(o); o.a = Math.atan2(o.r.pts[1].y - o.r.pts[0].y, o.r.pts[1].x - o.r.pts[0].x); carAt(o); } }
    function updDyn(dt) {
      for (const o of cars) {
        if (o.s < 0) { o.wait -= dt; o.moving = false; if (o.wait <= 0) { o.s = 0; o.a = Math.atan2(o.r.pts[1].y - o.r.pts[0].y, o.r.pts[1].x - o.r.pts[0].x); carAt(o); } continue; }
        const ca = Math.cos(o.a), sa = Math.sin(o.a), rx = hero.x - o.x, ry = hero.y - o.y, fw = rx * ca + ry * sa, sd = Math.abs(-rx * sa + ry * ca);
        const block = fw > 0 && fw < 34 && sd < 9;   // уступает дорогу топографу (и сигналит)
        if (block && o.v > 8 && time - honkT > 6 && hyp(o.x - hero.x, o.y - hero.y) < 40) { honkT = time; api.sfx('car'); }
        o.v = block ? Math.max(0, o.v - 60 * dt) : Math.min(o.vmax, o.v + 14 * dt);
        o.s += o.v * dt; o.moving = o.v > 2;
        if (!o.r.loop && o.s > o.c[o.c.length - 1]) { o.s = -1; o.wait = r2(4, 12); o.x = -999; continue; }
        carAt(o);
      }
      for (const p of people) {
        p.moving = false;
        if (p.wait > 0) { p.wait -= dt; continue; }
        if (!p.path || !p.path.length) {
          const sp = spots[Math.floor(R2() * spots.length)];
          p.path = pathTo(p.x, p.y, sp.x + r2(-8, 8), sp.y + r2(-4, 4));
          if (!p.path) { p.wait = 1; continue; }
          p.wait = r2(0.5, 3); continue;
        }
        const q = p.path[0], dx = q.x - p.x, dy = q.y - p.y, L = hyp(dx, dy), st = p.v * dt;
        if (L <= st) { p.x = q.x; p.y = q.y; p.path.shift(); }
        else { p.x += dx / L * st; p.y += dy / L * st; p.dir = p.dir + angD(p.dir, Math.atan2(dy, dx)) * Math.min(1, dt * 10); }
        p.moving = true; p.ph += dt;
      }
      dyn.length = 0;
      for (const o of cars) if (o.s >= 0) { const ca = Math.cos(o.a), sa = Math.sin(o.a); for (const k of [-6, 0, 6]) dyn.push({ x: o.x + ca * k, y: o.y + sa * k, r: 4.2, o, car: true }); }
      for (const p of people) dyn.push({ x: p.x, y: p.y, r: 1.9, o: p, car: false });
    }

    // ---------- лидар ----------
    const near = [];
    function scan(dt, nRays, floorN) {
      near.length = 0;
      for (const d of dyn) if (hyp(d.x - hero.x, d.y - hero.y) < RANGE + 6) near.push(d);
      const hx = hero.x + Math.cos(hero.dir) * 2, hy = hero.y + Math.sin(hero.dir) * 2, base = R2() * TAU, step = TAU / nRays;
      const movingHero = vSm > 3;
      for (let r = 0; r < nRays; r++) {
        const a = base + r * step, ca = Math.cos(a), sa = Math.sin(a);
        // ближайшая подвижная помеха на луче
        let dT = RANGE, dO = null;
        for (const d of near) {
          const fx = d.x - hx, fy = d.y - hy, tp = fx * ca + fy * sa; if (tp < 0) continue;
          const q = fx * fx + fy * fy - tp * tp; if (q > d.r * d.r) continue;
          const t = tp - Math.sqrt(d.r * d.r - q); if (t > 0.5 && t < dT) { dT = t; dO = d; }
        }
        let t = 1, hitT = -1, hitM = 0, glassUsed = false;
        while (t < dT) {
          const x = hx + ca * t, y = hy + sa * t;
          if (x < 0 || y < 0 || x >= WW || y >= WH) { t = dT + 1; break; }
          const gi = (y / G | 0) * GW + (x / G | 0), m = mat[gi];
          if (m) {
            if (m === GLH || m === GLV) { if (!glassUsed) { glassUsed = true; glassHit(x, y, ca, sa, t, m, gi); } t += 1; continue; }
            hitT = t; hitM = m; break;
          }
          if (canopy[gi] && R2() < 0.035) emit(x + r2(-1, 1), y + r2(-1, 1), CNCOL[(R2() * 8) | 0], false);
          t += 1;
        }
        const end = hitT > 0 ? hitT : Math.min(dT, RANGE);
        if (hitT > 0) {
          const tt = hitT - r2(0.1, 0.9);
          emit(hx + ca * tt, hy + sa * tt, MCOL[hitM][(R2() * 16) | 0], false);
        } else if (dO && dT < RANGE) { // люди и машины: шлейф, если топограф идёт, а помеха движется рядом
          if (movingHero && dO.o.moving && dT < 28) { if (emit(hx + ca * dT, hy + sa * dT, (dO.car ? DCOL : PCOL)[(R2() * 8) | 0], false)) { ghosts++; dynT = time; } }
        }
        // пол: отражения вдоль луча
        const fr = Math.min(end, FLOOR_R);
        for (let k = 0; k < floorN; k++) {
          const ft = 1.5 + R2() * (fr - 1.5); if (ft <= 1.5) break;
          const x = hx + ca * ft, y = hy + sa * ft;
          if (x < 0 || y < 0 || x >= WW || y >= WH) continue;
          const gi = (y / G | 0) * GW + (x / G | 0); if (mat[gi]) continue;
          const cc = ((y / CC) | 0) * CW + ((x / CC) | 0);
          if (covN[cc] < 255) { covN[cc]++; if (covN[cc] === COV_MIN && req[cc]) covered++; }
          emit(x, y, FCOL[paint[gi]][(R2() * 8) | 0], true);
        }
      }
    }
    function glassHit(x, y, ca, sa, t, m, gi) { // стекло: луч проходит; в лоб — отражение рисует «зеркальный зал» за стеклом
      if (R2() < 0.25) emit(x, y, MCOL[m][(R2() * 16) | 0], false);
      const cosI = m === GLH ? Math.abs(sa) : Math.abs(ca);
      if (cosI < 0.9 || t > 46 || R2() > 0.35) return;
      const rca = m === GLV ? -ca : ca, rsa = m === GLH ? -sa : sa;
      const gy = ((gi / GW | 0) + 0.5) * G, gx = (gi % GW + 0.5) * G;
      for (let u = 1; u < RANGE - t; u += 1) {
        const qx = x + rca * u, qy = y + rsa * u;
        if (qx < 0 || qy < 0 || qx >= WW || qy >= WH) return;
        const mq = mat[(qy / G | 0) * GW + (qx / G | 0)];
        if (!mq || mq === GLH || mq === GLV) continue;
        const px = m === GLV ? 2 * gx - qx : qx, py = m === GLH ? 2 * gy - qy : qy;
        if (emit(px, py, MCOL[mq][(R2() * 16) | 0], false)) { ghosts++; phantoms++; glassT = time; }
        return;
      }
    }

    // ---------- действия ----------
    const W = () => api.W;
    const btnM = () => ({ x: W() - 118, y: api.H - 64, w: 110, h: 56 });
    const btnD = () => ({ x: W() - 118, y: api.H - 64 - 50, w: 110, h: 42 });
    const mmRect = () => { const w = Math.round(Math.min(170, W() * 0.24)), h = Math.round(w * WH / WW); return { x: W() - w - 8, y: TOP + 6, w, h }; };
    const toScreen = (x, y) => ({ x: (x - camX) * Z, y: TOP + (y - camY) * Z });
    const toWorld = p => ({ x: p.x / Z + camX, y: (p.y - TOP) / Z + camY });
    const MC = document.createElement('canvas').getContext('2d');
    MC.font = 'bold 13px system-ui, sans-serif';
    const pops = [];
    function popW(x, y, t, col) { // надпись над точкой мира, не поверх панелей и других надписей
      const s = toScreen(x, y), hw = MC.measureText(t).width / 2 + 6, px = clamp(s.x, hw + 4, W() - hw - 4);
      let py = clamp(s.y - 16, TOP + 60, api.H - 40);
      for (let k = 0; k < 4; k++) { if (!pops.some(q => api.now - q.t < 1 && Math.abs(q.y - py) < 16 && Math.abs(q.x - px) < q.hw + hw)) break; py -= 17; }
      pops.push({ t: api.now, x: px, y: py, hw }); if (pops.length > 8) pops.shift();
      api.popup(px, py, t, col);
    }
    function walkTo(x, y) {
      const p = pathTo(hero.x, hero.y, x, y);
      if (!p) return false;
      path = p; return true;
    }
    function stop() { path = null; run = false; }
    const nearMark = () => { for (const m of marks) if (hyp(m.x - hero.x, m.y - hero.y) < 5) return m; return null; };
    function pressMark(on) {
      if (over) return;
      if (on) {
        const m = nearMark();
        if (!initDone) { popW(hero.x, hero.y - 10, 'Сначала инициализация — стойте', api.theme.accent); api.sfx('warn'); return; }
        if (!m) { popW(hero.x, hero.y - 10, 'Встаньте на марку (шахматная мишень)', api.theme.accent); api.sfx('bad'); return; }
        if (m.done) { popW(hero.x, hero.y - 10, `Марка М${m.n} уже занята`, api.theme.dim); return; }
        stop(); api.sfx('measure');
      }
    }
    function pressDone() {
      if (over) return;
      if (time - readyT < 2.5) { finish('early'); return; }
      readyT = time; api.sfx('select');
      popW(hero.x, hero.y - 10, 'Нажмите ГОТОВО ещё раз — сдать как есть', api.theme.accent);
    }
    function closeLoop(tOld) {
      let lo = 0, hi = nk - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ct[m] <= tOld) lo = m; else hi = m - 1; }
      const k0 = lo, s0 = cs[k0], s1 = dist, f0 = r2(0.82, 0.95);
      const ex = (D.x - cdx[k0]) * f0, ey = (D.y - cdy[k0]) * f0, before = hyp(D.x, D.y);
      snapshot();
      for (let k = k0 + 1; k < nk; k++) { const f = clamp((cs[k] - s0) / ((s1 - s0) || 1), 0, 1); cdx[k] -= ex * f; cdy[k] -= ey * f; }
      D.x -= ex; D.y -= ey; offX = vclamp(D.x); offY = vclamp(D.y);
      redrawCloud();
      const after = hyp(D.x, D.y);
      loops.push({ x: hero.x, y: hero.y, n: loops.length + 1, before, after });
      distLoop = 0;
      banner = { t: 0, text: `ПЕТЛЯ ЗАМКНУТА! дрейф ${fmt(before, 1)} → ${fmt(after, 1)} см`, col: '#6cff8a' };
      api.sfx('good'); api.sfx('point'); api.burst(toScreen(hero.x, hero.y).x, toScreen(hero.x, hero.y).y, '#6cff8a', 14);
    }
    function markDone(m) {
      m.done = true;
      const a = r2(0, TAU), v = r2(1, 2); D.x = Math.cos(a) * v; D.y = Math.sin(a) * v;
      newChunk();
      popW(m.x, m.y - 8, `Марка М${m.n} занята · дрейф ${fmt(v, 1)} см`, '#6cff8a');
      api.sfx('station'); api.burst(toScreen(m.x, m.y).x, toScreen(m.x, m.y).y, '#ffd76a', 12);
    }
    function thickness() { // итоговая толщина облака: СКО смещений точек (с размытием на бегу) + шум сканера
      let s = 0, n = 0;
      for (let k = 0; k < nk; k++) { const w = cn[k]; if (!w) continue; s += w * (cdx[k] * cdx[k] + cdy[k] * cdy[k] + (cb[k] ? BLUR * BLUR : 0)); n += w; }
      return 0.8 + (n ? Math.sqrt(s / n) : 0);
    }
    const thickNow = () => 0.8 + Math.sqrt(D.x * D.x + D.y * D.y + (run && vSm > V_WALK * 1.1 ? BLUR * BLUR : 0));
    const marksDone = () => marks.filter(m => m.done).length;

    let resultData = null;
    function finish(reason) {
      if (over) return; over = true;
      if (holdPtr != null) holdPtr = null;
      const cov = needCov ? covered / needCov : 0, T = thickness(), md = marksDone(), nl = loops.length;
      const covS = 400 * clamp((cov - 0.4) / 0.55, 0, 1);
      const thS = 250 * clamp((8 - T) / 5.5, 0, 1);
      const mkS = 30 * Math.min(md, 4), lpS = 30 * Math.min(nl, 3);
      const closeS = reason === 'static' ? 40 : 0;
      const timeS = reason === 'timeout' ? 0 : 100 * clamp((300 - time) / 150, 0, 1);
      const ghP = Math.min(100, ghosts / 10);
      const score = clamp(Math.round(covS + thS + mkS + lpS + closeS + timeS - ghP), 0, 1000);
      const ok = cov >= 0.7 && md >= 3;
      let stars = 0;
      if (ok) { stars = 1; if (T <= TOL && nl >= 1 && score >= 600) stars = 2; if (stars === 2 && T <= 3.5 && nl >= 2 && cov >= 0.9 && reason === 'static' && score >= 790) stars = 3; }
      resultData = { cov, T, md, nl };
      const fin = reason === 'static' ? `Статика на старте ✓ · ${mmss(time)}` : reason === 'early' ? `Досрочно, без статики · ${mmss(time)}` : 'Время вышло — сдано, что снято';
      api.finish({
        score, stars, drawResult,
        lines: [
          `Охват ${Math.round(cov * 100)} % · облако ${fmt(T, 1)} см (доп. ${TOL})`, // строки короткие — влезают при W=560
          `Марок ${md}${md < 3 ? ' (нужно ≥ 3)' : ''} · петель ${nl}`,
          `Призраки: ${ghosts} ${plural(ghosts, 'точка', 'точки', 'точек')}`,
          fin,
        ],
      });
    }

    // ---------- обновление ----------
    function moveHero(dx, dy) {
      const nx = hero.x + dx, ny = hero.y + dy;
      if (free(nx, ny)) { hero.x = nx; hero.y = ny; return true; }
      if (dx && free(hero.x + dx, hero.y)) { hero.x += dx; return true; }
      if (dy && free(hero.x, hero.y + dy)) { hero.y += dy; return true; }
      return false;
    }
    function update(dt) {
      if (over) return;
      time += dt;
      if (tapFx) { tapFx.t += dt; if (tapFx.t > 0.6) tapFx = null; }
      if (banner) { banner.t += dt; if (banner.t > 2.6) banner = null; }
      snapT += dt; jerkCool -= dt; jerkFx = Math.max(0, jerkFx - dt); stopT -= dt;
      updDyn(dt);
      // ход
      const ox = hero.x, oy = hero.y, oHv = hero.hv;
      const kx = keys.r - keys.l, ky = keys.d - keys.u;
      if (keys.run) run = true;
      const vmax = stopT > 0 ? 0 : run ? V_RUN : V_WALK;
      if (kx || ky) {
        path = null;
        const L = hyp(kx, ky), a = Math.atan2(ky, kx);
        hero.hv += clamp(angD(hero.hv, a), -9 * dt, 9 * dt);
        moveHero(Math.cos(hero.hv) * vmax * dt * (L ? 1 : 0), Math.sin(hero.hv) * vmax * dt);
      } else if (path && path.length && vmax > 0) {
        let left = vmax * dt, guard = 0;
        while (left > 1e-3 && path.length && guard++ < 4) {
          const q = path[0], dx = q.x - hero.x, dy = q.y - hero.y, L = hyp(dx, dy);
          if (L < 0.6) { path.shift(); continue; }
          const a = Math.atan2(dy, dx), da = angD(hero.hv, a), maxT = (run ? 7 : 4.5) * dt;
          hero.hv += clamp(da, -maxT, maxT);
          const slowK = Math.abs(angD(hero.hv, a)) > 0.9 ? 0.35 : 1, st = Math.min(left * slowK, L);
          let mx = Math.cos(hero.hv) * st, my = Math.sin(hero.hv) * st;
          if (!free(hero.x + mx, hero.y + my) || L < 3) { mx = dx / L * st; my = dy / L * st; }
          if (!moveHero(mx, my)) { hero.x += dx / L * Math.min(st, L) * 0.5; hero.y += dy / L * Math.min(st, L) * 0.5; }
          left -= st / slowK;
          if (hyp(q.x - hero.x, q.y - hero.y) < 1) path.shift();
        }
        if (!path.length) { path = null; run = false; }
      }
      const mv = hyp(hero.x - ox, hero.y - oy);
      vSm += (mv / dt - vSm) * Math.min(1, dt * 8);
      omega += (Math.abs(angD(oHv, hero.hv)) / dt - omega) * Math.min(1, dt * 10);
      if (mv > 0.01) { hero.dir = hero.dir + angD(hero.dir, hero.hv) * Math.min(1, dt * 12); hero.ph += dt; stepT -= dt; if (stepT <= 0) { stepT = 0.55; api.sfx('step'); } }
      dist += mv; distLoop += mv;
      const running = run && vSm > V_WALK * 1.1;
      // инициализация: 4 с неподвижно
      if (!initDone) {
        if (mv > 0.01) initMoved += mv;
        if (initMoved > 1.2) {
          if (initT > 0.3 || time - initFailT > 2) {
            initFails++; initFailT = time; api.sfx('bad');
            banner = { t: 0, text: 'Сбой инициализации — постойте неподвижно', col: '#ff6b5b' };
          }
          initT = 0; initMoved = 0;
        } else if (vSm < 1) {
          initT += dt;
          if (initT >= INIT_T) {
            initDone = true; api.sfx('good'); api.sfx('beep');
            banner = { t: 0, text: 'Инициализация завершена — сканируем!', col: '#6cff8a' };
            newChunk();
          }
        }
      }
      // RTK
      const hc = wcell(hero.x, hero.y);
      rtkNow = YARD ? rtk[hc] : 2;
      if (YARD && initDone && rtkNow !== rtkPrev) {
        if (rtkNow === 2 && time - lastRtkMsg > 6) { lastRtkMsg = time; popW(hero.x, hero.y - 10, 'RTK NONE — спутников нет', '#ff9d8f'); api.sfx('warn'); }
        else if (rtkNow === 0 && rtkPrev && time - lastRtkMsg > 6) { lastRtkMsg = time; popW(hero.x, hero.y - 10, 'RTK FIX', '#6cff8a'); }
      }
      rtkPrev = rtkNow;
      // дрейф
      if (initDone) {
        const dk = degK[hc];
        if (mv > 0.01) {
          let k = running ? 2.6 : 1;
          k *= dk;
          if (YARD) k *= rtkNow === 2 ? 1.5 : rtkNow === 1 ? 1.15 : 1;
          dTh += (R2() - 0.5) * 2.4 * Math.sqrt(dt);
          D.x += Math.cos(dTh) * BASE * k * mv; D.y += Math.sin(dTh) * BASE * k * mv;
          const ex = Math.max(0, omega - 2.4);   // резкий поворот: лидар «смазывает» кадр
          if (ex > 0) { D.x += Math.cos(dTh + 1.3) * 0.32 * ex * dt * (running ? 1.5 : 1); D.y += Math.sin(dTh + 1.3) * 0.32 * ex * dt * (running ? 1.5 : 1); }
          if (dk > 2 && time - lastDegMsg > 12) { lastDegMsg = time; popW(hero.x, hero.y - 10, YARD ? 'Арка: однородный тоннель, дрейф растёт' : 'Однородный проезд — идите вдоль стены', api.theme.accent); api.sfx('warn'); }
        }
        if (YARD && rtkNow === 0) { // FIX держит дрейф около 1,5 см
          const m = hyp(D.x, D.y); if (m > 1.5) { const f = (m - (m - 1.5) * Math.min(1, dt * 1.2)) / m; D.x *= f; D.y *= f; }
        }
        // узкий проход бегом — потеря трекинга
        if (running && jerkCool <= 0 && inZ(narrow, hero.x, hero.y)) {
          jerkCool = 3; jerkFx = 0.6; stopT = 0.8; path = path && path.length ? path : null;
          const a = R2() * TAU, v = r2(5, 8); D.x += Math.cos(a) * v; D.y += Math.sin(a) * v;
          api.shake(6); api.sfx('bad'); popW(hero.x, hero.y - 10, `Потеря трекинга! +${fmt(v, 1)} см`, '#ff6b5b');
        }
        if (running && time - warnRunT > 10) { warnRunT = time; api.sfx('warn'); }
        kT += dt;
        if (kT >= 0.25 || hyp(D.x - cdx[kc], D.y - cdy[kc]) > 0.25 || cb[kc] !== (running ? 1 : 0)) newChunk();
        // лидар
        scanA += dt * TAU * 1.6;
        scan(dt, running ? 22 : 40, running ? 1 : 2);
        // траектория и петли
        trajT -= dt; if (trajT <= 0) { trajT = 0.25; traj.push(hero.x, hero.y, kc); }
        const tc = clamp(Math.floor(hero.y / TC), 0, TH - 1) * TW + clamp(Math.floor(hero.x / TC), 0, TW - 1);
        if (tc !== tcPrev) {
          if (distLoop >= LOOP_S) {
            const i = tc % TW, j = (tc / TW) | 0; let old = -1;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
              const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= TW || nj >= TH) continue;
              const v = lastT[nj * TW + ni]; if (v >= 0 && time - v >= LOOP_T && (old < 0 || v < old)) old = v;
            }
            if (old >= 0) closeLoop(old);
          }
          tcPrev = tc;
        }
        lastT[tc] = time;
        // марка: держать кнопку стоя на марке
        const m = nearMark();
        if ((holdPtr != null || holdKey) && m && !m.done && vSm < 2) { m.hold += dt; if (m.hold >= MARK_T) markDone(m); }
        else for (const q of marks) if (!q.done) q.hold = 0;
        // статика в конце на старте
        if (time > 30 && dist > 400 && hyp(hero.x - start.x, hero.y - start.y) < 8 && vSm < 1.5 && !path) {
          endT += dt; if (endT >= END_T) { finish('static'); return; }
        } else endT = 0;
      }
      // камера
      camX += (clamp(hero.x - VW() / 2, 0, camMaxX()) - camX) * Math.min(1, dt * 5);
      camY += (clamp(hero.y - VH / 2, 0, camMaxY()) - camY) * Math.min(1, dt * 5);
      // перетаскивание: долгое — бегом
      if (walkPtr != null) { dragT += dt; if (dragT > 1.5 && !run && path && path.length && hyp(path[path.length - 1].x - hero.x, path[path.length - 1].y - hero.y) > 60) { run = true; popW(hero.x, hero.y - 10, 'БЕГОМ', '#ffd27a'); } }
      if (time >= LIMIT) finish('timeout');
    }

    // ---------- рисование ----------
    function draw(ctx) {
      const t = api.now, m = ctx.getTransform(), k = m.a * Z;
      if (layer && Math.abs(layer.k - Math.min(3, k)) / k > 0.04 && layerFail < 3 && k > 0.5) { layerFail++; buildLayer(clamp(k, 1, 3)); }
      flushCloud();
      ctx.save();
      ctx.beginPath(); ctx.rect(0, TOP, W(), api.H - TOP); ctx.clip();
      ctx.fillStyle = BGS; ctx.fillRect(0, TOP, W(), api.H - TOP);
      ctx.translate(0, TOP); ctx.scale(Z, Z); ctx.translate(-camX, -camY);
      const dev = m.a * Z, fast = !m.b && !m.c && Math.abs(m.a - m.d) < 1e-6;   // пикселей экрана на единицу мира
      const ox = Math.round(m.e - camX * dev), oy = Math.round(m.f + TOP * m.d - camY * dev);
      const vx0 = Math.max(0, camX), vy0 = Math.max(0, camY), vx1 = Math.min(WW, camX + VW()), vy1 = Math.min(WH, camY + VH);
      // сетка просмотрщика: 10 м
      ctx.strokeStyle = 'rgba(120,160,200,.07)'; ctx.lineWidth = 0.6; ctx.beginPath();
      for (let x = Math.ceil(vx0 / 40) * 40; x <= vx1; x += 40) { ctx.moveTo(x, vy0); ctx.lineTo(x, vy1); }
      for (let y = Math.ceil(vy0 / 40) * 40; y <= vy1; y += 40) { ctx.moveTo(vx0, y); ctx.lineTo(vx1, y); }
      ctx.stroke();
      // настоящий объект — только рядом с топографом, в свете фонаря
      {
        const x0 = Math.max(0, hero.x - RV), y0 = Math.max(0, hero.y - RV), x1 = Math.min(WW, hero.x + RV), y1 = Math.min(WH, hero.y + RV);
        ctx.save(); ctx.beginPath(); ctx.arc(hero.x, hero.y, RV, 0, TAU); ctx.clip();
        ctx.globalAlpha = YARD ? 0.6 : 0.7;
        const lk = layer.k;
        if (fast && Math.abs(lk - dev) < 1e-3) { // 1:1 по пикселям
          const sx = Math.floor(x0 * lk), sy = Math.floor(y0 * lk), sw = Math.min(layer.c.width - sx, Math.ceil((x1 - x0) * lk) + 1), sh = Math.min(layer.c.height - sy, Math.ceil((y1 - y0) * lk) + 1);
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(layer.c, sx, sy, sw, sh, ox + sx, oy + sy, sw, sh);
        } else ctx.drawImage(layer.c, x0 * lk, y0 * lk, (x1 - x0) * lk, (y1 - y0) * lk, x0, y0, x1 - x0, y1 - y0);
        ctx.globalAlpha = 1;
        if (!vign || Math.abs(vign.k - dev) > 1e-3) vign = vignette(dev);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(vign.cv, Math.round(ox + (hero.x - RV) * dev), Math.round(oy + (hero.y - RV) * dev));
        ctx.restore();
      }
      // облако
      {
        const sx = vx0 * CK, sy = vy0 * CK, sw = (vx1 - vx0) * CK, sh = (vy1 - vy0) * CK;
        if (sw > 0 && sh > 0) {
          if (snapT < 0.9 && snapCv) {
            const a = snapT / 0.9;
            ctx.globalAlpha = 1 - a; ctx.drawImage(snapCv, sx / 2, sy / 2, sw / 2, sh / 2, vx0, vy0, vx1 - vx0, vy1 - vy0);
            ctx.globalAlpha = a; drawCloud(ctx, vx0, vy0, vx1, vy1, 0, 0, 1);
            ctx.globalAlpha = 1;
          } else if (fast && Math.abs(CK - dev) < 1e-3) { // 1:1 по пикселям
            ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
            for (const tl of tiles) { if (tl.used && tl.x < vx1 * CK && tl.y < vy1 * CK && tl.x + tl.w > vx0 * CK && tl.y + tl.h > vy0 * CK) ctx.drawImage(tl.cv, ox + tl.x, oy + tl.y); }
            ctx.restore();
          } else drawCloud(ctx, vx0, vy0, vx1, vy1, 0, 0, 1);
        }
      }
      // траектория (оценка SLAM: со своим дрейфом)
      if (traj.length > 3) {
        ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.6; ctx.lineJoin = 'round'; ctx.beginPath();
        for (let i = 0; i < traj.length; i += 3) { const kk = traj[i + 2], x = traj[i] + vclamp(cdx[kk]), y = traj[i + 1] + vclamp(cdy[kk]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.lineTo(hero.x + offX, hero.y + offY); ctx.stroke();
      }
      // петли
      for (const l of loops) {
        ctx.strokeStyle = '#6cff8a'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(l.x, l.y, 5, 0, TAU); ctx.stroke();
        api.text(ctx, 'П' + l.n, l.x, l.y + 2.2, 5.5, '#6cff8a');
      }
      if (banner && snapT < 1.2 && loops.length) { const l = loops[loops.length - 1]; ctx.strokeStyle = `rgba(108,255,138,${1 - snapT / 1.2})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(l.x, l.y, 6 + snapT * 60, 0, TAU); ctx.stroke(); }
      // старт
      { const a = !initDone || (endT > 0) ? 1 : 0.75; ctx.strokeStyle = `rgba(255,110,90,${a})`; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(start.x, start.y, 7, 0, TAU); ctx.stroke(); api.text(ctx, 'СТАРТ', start.x, start.y - 9, 5.5, `rgba(255,170,150,${a})`); }
      // марки
      for (const mk of marks) {
        const d = hyp(mk.x - hero.x, mk.y - hero.y);
        if (d > RV) drawMarkPlate(ctx, mk.x, mk.y);
        ctx.fillStyle = mk.done ? '#6cff8a' : '#ffb02e'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(mk.x, mk.y - 10); ctx.lineTo(mk.x + 3.5, mk.y - 4.5); ctx.lineTo(mk.x - 3.5, mk.y - 4.5); ctx.closePath(); ctx.fill(); ctx.stroke();
        api.text(ctx, 'М' + mk.n, mk.x + 5, mk.y - 5, 5.5, mk.done ? '#9dffb5' : '#ffd76a', 'left');
        if (!mk.done && d < 14) { ctx.strokeStyle = `rgba(255,215,106,${0.5 + 0.5 * Math.sin(t * 6)})`; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(mk.x, mk.y, 5, 0, TAU); ctx.stroke(); }
        if (mk.hold > 0) { ctx.strokeStyle = '#6cff8a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(mk.x, mk.y, 7, -Math.PI / 2, -Math.PI / 2 + TAU * mk.hold / MARK_T); ctx.stroke(); }
      }
      // цель хода
      if (path && path.length) { const g = path[path.length - 1]; ctx.strokeStyle = run ? 'rgba(255,210,122,.8)' : 'rgba(126,200,255,.7)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(g.x, g.y, 2.5 + Math.sin(t * 6) * 0.6, 0, TAU); ctx.stroke(); }
      if (tapFx) { ctx.strokeStyle = `rgba(255,255,255,${1 - tapFx.t / 0.6})`; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(tapFx.x, tapFx.y, 2 + tapFx.t * 12, 0, TAU); ctx.stroke(); }
      // люди и машины: видны только рядом; у машин — фары в темноте
      for (const o of cars) {
        if (o.s < 0) continue;
        const ca = Math.cos(o.a), sa = Math.sin(o.a), fx = o.x + ca * 9, fy = o.y + sa * 9;
        if (o.x < vx0 - 40 || o.x > vx1 + 40 || o.y < vy0 - 40 || o.y > vy1 + 40) continue;
        const g = ctx.createRadialGradient(fx + ca * 14, fy + sa * 14, 1, fx + ca * 14, fy + sa * 14, 20);
        g.addColorStop(0, 'rgba(255,245,200,.22)'); g.addColorStop(1, 'rgba(255,245,200,0)'); ctx.fillStyle = g; ctx.fillRect(fx + ca * 14 - 20, fy + sa * 14 - 20, 40, 40);
        if (hyp(o.x - hero.x, o.y - hero.y) < RV + 10) Sym.car(ctx, o.x, o.y, o.a, o.color, o.seed);
        ctx.fillStyle = '#fff6d8'; for (const s of [-2.6, 2.6]) { ctx.beginPath(); ctx.arc(fx - sa * s, fy + ca * s, 0.9, 0, TAU); ctx.fill(); }
      }
      for (const p of people) if (hyp(p.x - hero.x, p.y - hero.y) < RV) Sym.personTop(ctx, p.x, p.y, p.dir, p.ph, p.seed);
      // топограф со сканером и вращающимся лучом
      {
        const hx = hero.x, hy = hero.y, ca = Math.cos(hero.dir), sa = Math.sin(hero.dir), sx = hx + ca * 2.4, sy = hy + sa * 2.4;
        if (initDone || initT > 0) {
          ctx.strokeStyle = 'rgba(120,220,255,.12)'; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(sx, sy, RANGE, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
          for (let i = 0; i < 6; i++) {
            const a = scanA - i * 0.09; ctx.strokeStyle = `rgba(120,230,255,${0.32 * (1 - i / 6)})`; ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a) * RANGE, sy + Math.sin(a) * RANGE); ctx.stroke();
          }
        }
        ctx.strokeStyle = 'rgba(255,122,28,.9)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(hx, hy, 4.4, 0, TAU); ctx.stroke();   // «вы здесь»
        Sym.surveyorTop(ctx, hx, hy, hero.dir, hero.ph, {});
        ctx.fillStyle = '#23272b'; ctx.beginPath(); ctx.arc(sx, sy, 1.3, 0, TAU); ctx.fill();
        ctx.strokeStyle = initDone ? '#7ee8ff' : '#ffd76a'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.arc(sx, sy, 1.3, scanA, scanA + 4); ctx.stroke();
        if (!initDone && initT > 0) { ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(hx, hy, 9, -Math.PI / 2, -Math.PI / 2 + TAU * initT / INIT_T); ctx.stroke(); }
        if (endT > 0) { ctx.strokeStyle = '#6cff8a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(hx, hy, 9, -Math.PI / 2, -Math.PI / 2 + TAU * endT / END_T); ctx.stroke(); }
        if (jerkFx > 0) { ctx.strokeStyle = `rgba(255,107,91,${jerkFx / 0.6})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(hx, hy, 14 - jerkFx * 10, 0, TAU); ctx.stroke(); }
      }
      ctx.restore();
      drawUI(ctx, t);
    }
    function pill(ctx, x, y, w, h, fill, stroke) { ctx.fillStyle = fill; api.roundRect(ctx, x, y, w, h, 5); ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } }
    function drawUI(ctx, t) {
      const Wd = W(), hs = toScreen(hero.x, hero.y);
      // панель сканера
      const px = 6, py = TOP + 4, pw = 196, ph = 34;
      ctx.save(); if (hs.x < px + pw + 20 && hs.y < py + ph + 24) ctx.globalAlpha = 0.3;
      pill(ctx, px, py, pw, ph, 'rgba(10,16,22,.85)', 'rgba(120,200,240,.45)');
      const running = run && vSm > V_WALK * 1.1, spd = vSm * MS;
      let l1, c1 = '#9de7ff';
      if (!initDone) { l1 = `ИНИЦИАЛИЗАЦИЯ ${Math.round(initT / INIT_T * 100)} %`; c1 = '#ffd76a'; }
      else l1 = (running ? 'БЕГОМ ' : vSm > 1 ? 'СКАН ● ' : 'СКАН ○ ') + fmt(spd, 1) + ' м/с';
      api.text(ctx, l1, px + 7, py + 13, 9.5, running ? '#ffd27a' : c1, 'left');
      // шкала скорости: зелёная до 1 м/с
      const bx = px + 120, bw = 40; ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(bx, py + 7, bw, 5);
      ctx.fillStyle = spd > 1.05 ? '#ff6b5b' : '#6cff8a'; ctx.fillRect(bx, py + 7, bw * clamp(spd / 1.6, 0, 1), 5);
      ctx.fillStyle = '#fff'; ctx.fillRect(bx + bw / 1.6 - 0.5, py + 5, 1, 9);
      const th = thickNow(), tc = th <= 3 ? '#6cff8a' : th <= TOL ? '#ffd76a' : '#ff6b5b';
      ctx.font = '600 9px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = tc;
      ctx.fillText(`Толщина облака ${fmt(th, 1)} см`, px + 7, py + 27);
      ctx.fillStyle = 'rgba(200,220,235,.6)'; ctx.fillText(`(допуск ${TOL})`, px + 133, py + 27);
      // RTK / GNSS
      const rx = px + pw + 5, rw = 50;
      if (YARD) { const col = RTK_COL[rtkNow]; pill(ctx, rx, py, rw, ph, 'rgba(10,16,22,.85)', col); api.text(ctx, 'RTK', rx + rw / 2, py + 13, 8, 'rgba(220,230,240,.7)'); api.text(ctx, RTK_NAME[rtkNow], rx + rw / 2, py + 27, 10.5, col); }
      else { pill(ctx, rx, py, rw, ph, 'rgba(10,16,22,.85)', 'rgba(150,150,150,.4)'); api.text(ctx, 'GNSS', rx + rw / 2, py + 13, 8, 'rgba(220,230,240,.55)'); api.text(ctx, 'нет', rx + rw / 2, py + 27, 10, 'rgba(220,230,240,.55)'); }
      ctx.restore();
      // мини-карта облака
      const mr = mmRect(), under = hs.x > mr.x - 14 && hs.y < mr.y + mr.h + 26;
      if (time - miniT > 0.5 || time < miniT) { miniT = time; miniCtx.putImageData(mimg, 0, 0); }
      ctx.save(); ctx.globalAlpha = under ? 0.3 : 0.95;
      pill(ctx, mr.x - 2, mr.y - 2, mr.w + 4, mr.h + 4, 'rgba(10,16,22,.9)', 'rgba(120,200,240,.4)');
      ctx.fillStyle = '#05070a'; ctx.fillRect(mr.x, mr.y, mr.w, mr.h); ctx.drawImage(miniCv, mr.x, mr.y, mr.w, mr.h);
      const sm = mr.w / WW;
      { const x0 = mr.x + camX * sm, y0 = mr.y + camY * sm, x1 = Math.min(mr.x + mr.w, x0 + VW() * sm), y1 = Math.min(mr.y + mr.h, y0 + VH * sm);
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.8; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); }
      for (const mk of marks) { ctx.fillStyle = mk.done ? '#6cff8a' : '#ffb02e'; const x = mr.x + mk.x * sm, y = mr.y + mk.y * sm; ctx.beginPath(); ctx.moveTo(x, y - 3.5); ctx.lineTo(x + 3, y + 2); ctx.lineTo(x - 3, y + 2); ctx.closePath(); ctx.fill(); }
      ctx.strokeStyle = '#ff6e5a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(mr.x + start.x * sm, mr.y + start.y * sm, 2.5, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ff7a1c'; ctx.beginPath(); ctx.arc(mr.x + hero.x * sm, mr.y + hero.y * sm, 2.4, 0, TAU); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8; ctx.stroke();
      if (!under) { const cv = needCov ? covered / needCov : 0; ctx.fillStyle = 'rgba(10,16,22,.85)'; ctx.fillRect(mr.x + mr.w - 132, mr.y + mr.h + 2, 134, 13); api.text(ctx, `ОБЛАКО · охват ${Math.round(cv * 100)} % · М ${marksDone()}/${marks.length}`, mr.x + mr.w, mr.y + mr.h + 12, 8.5, '#d8eef8', 'right'); }
      ctx.restore();
      // кнопки
      const m = nearMark(), bm = btnM(), bd = btnD(), holding = holdPtr != null || holdKey;
      const onMark = initDone && m && !m.done;
      api.button(ctx, bm, holding && onMark ? `МАРКА ${fmt(Math.max(0, MARK_T - m.hold), 1)}` : 'МАРКА', { active: !!(onMark && holding), color: onMark ? (Math.sin(t * 8) > 0 ? '#6cff8a' : '#9dffb5') : api.theme.accent, size: 15, disabled: !onMark });
      api.button(ctx, bd, time - readyT < 2.5 ? 'СДАТЬ?' : 'ГОТОВО', { active: time - readyT < 2.5, color: '#7ec8ff', size: 13 });
      // подсказка
      let hint = null, hc = '#ffd76a';
      const dk = degK[wcell(hero.x, hero.y)];
      if (!initDone) hint = initFails && time - initFailT < 4 ? 'Сбой инициализации — постойте неподвижно 4 с' : 'Инициализация: стойте, пока не заполнится кольцо';
      else if (onMark) hint = `Вы на марке М${m.n} — держите МАРКА ${MARK_T} с, не двигаясь`;
      else if (endT > 0) hint = 'Статика в конце: стойте на старте…';
      else if (dk > 2 && vSm > 2) hint = YARD ? 'Арка: однородный тоннель и нет RTK — пройдите и замкните петлю' : 'Однородный проезд: сканеру не за что зацепиться — идите у стены';
      else if (time - glassT < 1.5) hint = 'Стекло в лоб даёт фантомы — сканируйте витрину под углом';
      else if (time - dynT < 1.5) hint = 'Рядом движутся люди или машина — постойте, пусть пройдут';
      else if (running) hint = 'Бегом > 1 м/с: облако реже, дрейф растёт ×2,5';
      else if (YARD && rtkNow === 2) hint = 'RTK NONE: спутников нет — дрейф копится, замкните петлю';
      else if (hyp(D.x, D.y) > 3.5) { hint = 'Дрейф растёт — замкните петлю: вернитесь туда, где уже были'; hc = '#ff9d8f'; }
      else if (LIMIT - time < 45 && time > 40) hint = 'Пора на старт: постойте там 4 с — статика в конце';
      else if (time < 14) hint = api.IS_TOUCH ? 'Тап по карте — идти; двойной тап — бегом; тап по себе — стоп' : 'Клик по карте — идти; двойной клик — бегом; клик по себе — стоп';
      if (hint) {
        ctx.font = 'bold 11px system-ui, sans-serif'; const w = Math.min(Wd - 140, ctx.measureText(hint).width + 20);
        ctx.save(); ctx.globalAlpha = hs.x < w + 20 && hs.y > api.H - 50 ? 0.35 : 1;
        pill(ctx, 8, api.H - 30, w, 22, 'rgba(10,16,22,.88)');
        ctx.beginPath(); ctx.rect(8, api.H - 30, w, 22); ctx.clip(); api.text(ctx, hint, 18, api.H - 15, 11, hc, 'left'); ctx.restore();
      }
      if (banner) {
        const a = Math.min(1, (2.6 - banner.t) / 0.4); ctx.save(); ctx.globalAlpha = a;
        ctx.font = 'bold 14px system-ui, sans-serif'; const w = ctx.measureText(banner.text).width + 28, y = TOP + 50;
        pill(ctx, Wd / 2 - w / 2, y, w, 26, 'rgba(10,16,22,.9)', banner.col); api.text(ctx, banner.text, Wd / 2, y + 18, 14, banner.col); ctx.restore();
      }
      const left = LIMIT - time;
      if (left < 10 && !over) api.text(ctx, String(Math.ceil(left)), Wd / 2, TOP + 96, 18, `rgba(255,107,91,${0.5 + 0.5 * Math.sin(t * 8)})`);
    }

    // ---------- итог: облако в «просмотрщике» ----------
    let resCache = null;
    function drawResult(ctx, x, y, w, h) {
      const key = Math.round(w) + 'x' + Math.round(h);
      if (!resCache || resCache.key !== key) resCache = { key, layer: api.layer(w, h, c => drawViewer(c, w, h)) };
      ctx.drawImage(resCache.layer.canvas, x, y, w, h);
    }
    function drawViewer(c, w, h) {
      flushCloud();
      c.fillStyle = '#0a0d12'; api.roundRect(c, 0, 0, w, h, 8); c.fill();
      c.strokeStyle = 'rgba(120,200,240,.5)'; c.lineWidth = 1; c.stroke();
      api.text(c, 'Облако точек · вид сверху', 10, 16, 10, '#d8eef8', 'left');
      if (w > 300) api.text(c, variant.title, w - 10, 16, 8, 'rgba(200,220,235,.6)', 'right', '600');
      const s = Math.min((w - 16) / WW, (h - 124) / WH), pw = WW * s, ph = WH * s, ox = (w - pw) / 2, oy = 24;
      c.fillStyle = '#05070a'; c.fillRect(ox, oy, pw, ph);
      c.imageSmoothingEnabled = true; drawCloud(c, 0, 0, WW, WH, ox, oy, s);
      c.strokeStyle = 'rgba(120,200,240,.35)'; c.lineWidth = 0.6; c.strokeRect(ox, oy, pw, ph);
      // траектория
      c.save(); c.beginPath(); c.rect(ox, oy, pw, ph); c.clip();
      c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 0.7; c.beginPath();
      for (let i = 0; i < traj.length; i += 3) { const kk = traj[i + 2], X = ox + (traj[i] + vclamp(cdx[kk])) * s, Y = oy + (traj[i + 1] + vclamp(cdy[kk])) * s; if (i) c.lineTo(X, Y); else c.moveTo(X, Y); }
      c.stroke();
      for (const l of loops) { c.strokeStyle = '#6cff8a'; c.lineWidth = 1; c.beginPath(); c.arc(ox + l.x * s, oy + l.y * s, 3.5, 0, TAU); c.stroke(); }
      for (const mk of marks) { const X = ox + mk.x * s, Y = oy + mk.y * s; c.fillStyle = mk.done ? '#6cff8a' : 'rgba(160,160,160,.8)'; c.beginPath(); c.moveTo(X, Y - 4); c.lineTo(X + 3.5, Y + 2.5); c.lineTo(X - 3.5, Y + 2.5); c.closePath(); c.fill(); }
      c.strokeStyle = '#ff6e5a'; c.lineWidth = 1; c.beginPath(); c.arc(ox + start.x * s, oy + start.y * s, 3, 0, TAU); c.stroke();
      c.restore();
      // легенда
      let ly = oy + ph + 12;
      const bw = Math.min(110, w * 0.34);
      for (let i = 0; i < bw; i++) { c.fillStyle = cssH(i / bw); c.fillRect(10 + i, ly - 6, 1, 6); }
      api.text(c, 'высота 0 … 3 м', 10 + bw + 5, ly, 7.5, 'rgba(200,220,235,.75)', 'left', '600');
      ly += 12;
      const items = [['#fff', 'траектория'], ['#6cff8a', 'петля'], ['#6cff8a', '▲ марка'], ['#ff6e5a', 'старт']];
      let lx = 10;
      c.font = '600 7.5px system-ui, sans-serif';
      for (const [col, txt] of items) {
        if (txt === 'траектория') { c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(lx, ly - 3); c.lineTo(lx + 9, ly - 3); c.stroke(); }
        else if (txt === 'петля' || txt === 'старт') { c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.arc(lx + 4, ly - 3, 3, 0, TAU); c.stroke(); }
        api.text(c, txt === '▲ марка' ? txt : txt, lx + (txt === '▲ марка' ? 0 : 12), ly, 7.5, txt === '▲ марка' ? col : 'rgba(200,220,235,.75)', 'left', '600');
        lx += c.measureText(txt).width + (txt === '▲ марка' ? 10 : 22);
      }
      ly += 12;
      // протокол обработки
      const fit = (str, size) => { c.font = `600 ${size}px system-ui, sans-serif`; while (str.length > 8 && c.measureText(str).width > w - 20) str = str.slice(0, -2); return str; };
      const rows = [];
      if (resultData) rows.push(`Толщина ${fmt(resultData.T, 1)} см (допуск ${TOL}) · охват ${Math.round(resultData.cov * 100)} % · смещения ×25`);
      rows.push(loops.length ? 'Петли (дрейф, см): ' + loops.map(l => `П${l.n} ${fmt(l.before, 1)}→${fmt(l.after, 1)}`).join(' · ') : 'Петли не замкнуты — дрейф не уравнен');
      rows.push('Марки: ' + marks.map(m => `М${m.n} ${m.done ? '✓' : '—'}`).join('  '));
      rows.push(`Призраки: от людей и машин ${ghosts - phantoms} · фантомы стекла ${phantoms}`);
      rows.push(`Путь ${fmt(dist * 0.25 / 1000, 2)} км · точек в облаке ${np >= CAP ? '≥ ' : ''}${Math.round(np / 1000)} тыс.`);
      c.font = '600 7.5px system-ui, sans-serif';
      for (const r of rows) { // перенос по « · »
        let cur = '';
        for (const part of r.split(' · ')) {
          const tr = cur ? cur + ' · ' + part : part;
          if (cur && c.measureText(tr).width > w - 20) { if (ly <= h - 6) api.text(c, fit(cur, 7.5), 10, ly, 7.5, 'rgba(200,220,235,.78)', 'left', '600'); ly += 10; cur = '   ' + part; }
          else cur = tr;
        }
        if (cur && ly <= h - 6) api.text(c, fit(cur, 7.5), 10, ly, 7.5, 'rgba(200,220,235,.78)', 'left', '600');
        ly += 11;
      }
    }

    // ---------- бот: фронтир охвата, марки, петли, ожидание помех, возврат на старт ----------
    const bot = { kind: '', tx: 0, ty: 0, cc: -1, mark: null, re: 0, wait: 0, dynWait: 0, dynCool: 0, lastTap: -9, stuckT: 0, sx: 0, sy: 0, holding: false };
    const skip = new Uint8Array(CW * CH);
    const bfsQ = new Int32Array(NN), bfsM = new Uint32Array(NN);
    let bfsS = 0;
    function bfs(test) { // ближайшая по ходу клетка, где test(c) истинно
      const st = ++bfsS, s0 = blocked[wcell(hero.x, hero.y)] ? nearestFreeCell(hero.x, hero.y, 6, false) : wcell(hero.x, hero.y);
      if (s0 < 0) return -1;
      let h = 0, tl = 0; bfsQ[tl++] = s0; bfsM[s0] = st;
      while (h < tl) {
        const c = bfsQ[h++];
        if (test(c)) return c;
        const i = c % NW, j = (c / NW) | 0;
        for (let d = 0; d < 4; d++) {
          const ni = i + (d === 0 ? 1 : d === 1 ? -1 : 0), nj = j + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (ni < 0 || nj < 0 || ni >= NW || nj >= NH) continue;
          const n = nj * NW + ni; if (blocked[n] || bfsM[n] === st) continue;
          bfsM[n] = st; bfsQ[tl++] = n;
        }
      }
      return -1;
    }
    const covIdx = c => (((c / NW) | 0) >> 1) * CW + ((c % NW) >> 1);
    function botTap(x, y) {
      const s = toScreen(x, y), mr = mmRect();
      const ui = [btnM(), btnD()].some(b => s.x >= b.x - 4 && s.x <= b.x + b.w + 4 && s.y >= b.y - 4 && s.y <= b.y + b.h + 4) || (s.x > mr.x - 4 && s.y < mr.y + mr.h + 18) || (s.x < 270 && s.y < TOP + 44);
      if (time - bot.lastTap > 0.45 && s.x > 4 && s.x < W() - 4 && s.y > TOP + 4 && s.y < api.H - 34 && !ui && hyp(x - hero.x, y - hero.y) > 10) {
        bot.lastTap = time; inst.pointerDown({ x: s.x, y: s.y, id: 91, button: 0 }); inst.pointerUp({ x: s.x, y: s.y, id: 91, button: 0 });
      } else walkTo(x, y);
      bot.tx = x; bot.ty = y; bot.stuckT = 0; bot.sx = hero.x; bot.sy = hero.y;
    }
    function botPick() {
      const wrapT = Math.min(LIMIT, 300) - 95, cov = needCov ? covered / needCov : 1;
      const need = Math.min(4, marks.length), md = marksDone();
      const wrap = time > wrapT || cov >= 0.96;
      const open = marks.filter(m => !m.done);
      const pathLen = (x, y) => { const p = pathTo(hero.x, hero.y, x, y); if (!p) return Infinity; let L = 0, px = hero.x, py = hero.y; for (const q of p) { L += hyp(q.x - px, q.y - py); px = q.x; py = q.y; } return L; };
      let mk = null, ml = Infinity;
      for (const m of open) { if (hyp(m.x - hero.x, m.y - hero.y) > (wrap ? 2000 : 150)) continue; const L = pathLen(m.x, m.y); if (L < ml) { ml = L; mk = m; } }
      if (mk && (ml < 140 || (wrap && md < (time > wrapT + 40 ? 3 : need)))) { bot.kind = 'mark'; bot.mark = mk; botTap(mk.x, mk.y); return; }
      if (wrap) { bot.kind = 'home'; botTap(start.x, start.y); return; }
      if (distLoop > 1500 && hyp(D.x, D.y) > 2.2) { // специально замкнуть петлю
        const c = bfs(c => { const x = wx(c), y = wy(c), tc = clamp(Math.floor(y / TC), 0, TH - 1) * TW + clamp(Math.floor(x / TC), 0, TW - 1); return lastT[tc] >= 0 && time - lastT[tc] > LOOP_T + 3 && degK[c] < 2; });
        if (c >= 0) { bot.kind = 'loop'; botTap(wx(c), wy(c)); return; }
      }
      // фронтир охвата: ближайшая неснятая клетка, но не вплотную (ближние снимутся по пути)
      let first = -1;
      const c = bfs(c => { const cc = covIdx(c); if (!(req[cc] && covN[cc] < COV_MIN && !skip[cc] && degK[c] < 2)) return false; if (first < 0) first = c; return hyp(wx(c) - hero.x, wy(c) - hero.y) > 22; });
      const cg = c >= 0 ? c : first;
      if (cg >= 0) { bot.kind = 'cov'; bot.cc = covIdx(cg); botTap(wx(cg), wy(cg)); return; }
      bot.kind = 'home'; botTap(start.x, start.y);
    }
    function botStep(dt) {
      if (over) return;
      if (!initDone) return;   // стоим, пока идёт инициализация
      if (bot.wait > 0) { bot.wait -= dt; return; }
      const m = nearMark();
      if (bot.holding) {
        if (!m || m.done || m.hold === 0 && vSm > 2) { const b = btnM(); inst.pointerUp({ x: b.x + 5, y: b.y + 5, id: 92, button: 0 }); bot.holding = false; bot.kind = ''; }
        return;
      }
      if (bot.kind === 'mark' && m && !m.done && (!path || hyp(m.x - hero.x, m.y - hero.y) < 2.5)) {
        if (path) stop();
        if (vSm < 1.5) { const b = btnM(); inst.pointerDown({ x: b.x + b.w / 2, y: b.y + b.h / 2, id: 92, button: 0 }); bot.holding = true; }
        return;
      }
      // уклонение: рядом движутся люди или машина — постоять, пока не пройдут
      bot.dynCool -= dt;
      const busy = () => dyn.some(d => d.o.moving && hyp(d.x - hero.x, d.y - hero.y) < 34);
      if (bot.dynWait > 0) {
        bot.dynWait -= dt;
        if (!busy()) { bot.dynWait = 0; bot.kind = bot.kind === 'home' ? 'home' : ''; }
        else if (bot.dynWait <= 0) { bot.dynCool = 3; bot.kind = bot.kind === 'home' ? 'home' : ''; }
        return;
      }
      if (bot.dynCool <= 0 && path && busy()) {
        const s = toScreen(hero.x, hero.y);
        if (s.y > TOP + 4 && s.y < api.H - 4 && s.x > 0 && s.x < W()) { inst.pointerDown({ x: s.x, y: s.y, id: 93, button: 0 }); inst.pointerUp({ x: s.x, y: s.y, id: 93, button: 0 }); } else stop();
        bot.dynWait = 6; return;
      }
      if (bot.kind === 'home') { if (!path && hyp(start.x - hero.x, start.y - hero.y) > 4) botTap(start.x, start.y); return; }
      // застрял?
      bot.stuckT += dt;
      if (bot.stuckT > 2.5) { if (hyp(hero.x - bot.sx, hero.y - bot.sy) < 3) { if (bot.kind === 'cov' && bot.cc >= 0) skip[bot.cc] = 1; bot.kind = ''; path = null; } bot.stuckT = 0; bot.sx = hero.x; bot.sy = hero.y; }
      bot.re -= dt;
      if (!path) {
        if (bot.kind === 'cov' && bot.cc >= 0 && covN[bot.cc] < COV_MIN) skip[bot.cc] = 1;
        botPick(); return;
      }
      if (bot.kind === 'cov' && bot.re <= 0) { bot.re = 0.4; if (covN[bot.cc] >= COV_MIN) botPick(); }
      if (bot.kind === 'loop' && distLoop < 50) botPick();
    }

    // ---------- ввод ----------
    const inst = {
      update, draw,
      hud() {
        const cov = needCov ? covered / needCov : 0;
        return { time: Math.max(0, LIMIT - time), info: api.W >= 700 ? [`Охват ${Math.round(cov * 100)} %`, `Марки ${marksDone()}/${marks.length}`, `Петли ${loops.length}`] : [], progress: clamp(cov / 0.95, 0, 1) };
      },
      pointerDown(p) {
        if (over) return;
        if (api.hit(btnM(), p)) { holdPtr = p.id; pressMark(true); return; }
        if (api.hit(btnD(), p)) { pressDone(); return; }
        const mr = mmRect();
        if (api.hit(mr, p)) { const wx2 = (p.x - mr.x) / mr.w * WW, wy2 = (p.y - mr.y) / mr.h * WH; run = false; if (walkTo(wx2, wy2)) { tapFx = { x: wx2, y: wy2, t: 0 }; api.sfx('tap'); } return; }
        if (p.y < TOP) return;
        const w = toWorld(p);
        if (hyp(w.x - hero.x, w.y - hero.y) < 8) { stop(); tapFx = { x: hero.x, y: hero.y, t: 0 }; lastTapT = -9; return; }   // тап по себе — стоп
        const dbl = time - lastTapT < 0.33 && lastTapP && hyp(p.x - lastTapP.x, p.y - lastTapP.y) < 40;
        lastTapT = time; lastTapP = { x: p.x, y: p.y };
        run = dbl;
        if (dbl) { api.sfx('warn'); popW(hero.x, hero.y - 10, 'БЕГОМ', '#ffd27a'); }
        walkPtr = p.id; lastRepath = time; dragT = 0;
        if (walkTo(w.x, w.y)) tapFx = { x: w.x, y: w.y, t: 0 };
      },
      pointerMove(p) {
        if (over) return;
        if (p.id === walkPtr && p.down && time - lastRepath > 0.12 && p.y > TOP) { lastRepath = time; const w = toWorld(p); walkTo(w.x, w.y); }
      },
      pointerUp(p) {
        if (over) return;
        if (p.id === holdPtr) { holdPtr = null; for (const m of marks) if (!m.done) m.hold = 0; }
        if (p.id === walkPtr) walkPtr = null;
      },
      key(code, down) {
        const v = down ? 1 : 0;
        if (code === 'ArrowLeft' || code === 'KeyA') keys.l = v;
        else if (code === 'ArrowRight' || code === 'KeyD') keys.r = v;
        else if (code === 'ArrowUp' || code === 'KeyW') keys.u = v;
        else if (code === 'ArrowDown' || code === 'KeyS') keys.d = v;
        else if (code === 'ShiftLeft' || code === 'ShiftRight') { keys.run = v; if (!v) run = false; }
        else if (code === 'Space' || code === 'KeyF') { if (down && !holdKey) pressMark(true); holdKey = !!down; if (!down) for (const m of marks) if (!m.done) m.hold = 0; }
        else if (down && code === 'Enter') pressDone();
      },
      bot(dt) { botStep(dt); },
    };
    return inst;
  }
})();
