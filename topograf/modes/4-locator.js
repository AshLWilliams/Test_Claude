'use strict';
// «Трассоискатель» — поиск и съёмка подземных коммуникаций: замеры сигнала трассоискателем по сетке 6×6 м,
// разметка трасс краской, сдача исполнительной съёмки. Логическая игра на одном экране. Устройство — в MODES.md.
(() => {
  const COLS = 22, ROWS = 11, CS = 24, GW = COLS * CS, GH = ROWS * CS, N = COLS * ROWS;
  const EXT = 190;                   // запас сцены слева/справа за границей участка (широкий экран)
  const LIMIT = 150;                 // время уровня, с
  const CELL_M = CS * 0.25;          // клетка — 6 м
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const OPP = d => (d + 2) & 3, BIT = d => 1 << d;
  const BAR_H = 42, BAR_Y = 360 - BAR_H - 3, FIELD_TOP = 31;
  const INK = '#2a251d';
  // сети: буква, кнопка, полное название, цвет краски, повороты только в колодцах
  const NET = {
    water: { l: 'В', name: 'вода', full: 'Водопровод', paint: '#3d8ff0', mh: true },
    sewer: { l: 'К', name: 'канализ.', full: 'Канализация', paint: '#b77b3c', mh: true },
    tele: { l: 'С', name: 'связь', full: 'Кабель связи', paint: '#ff8f2a', mh: true },
    gas: { l: 'Г', name: 'газ', full: 'Газопровод', paint: '#ffd21e', mh: false },
    power: { l: 'Э', name: 'электро', full: 'Электрокабель', paint: '#ff4a3a', mh: false },
    heat: { l: 'Т', name: 'тепло', full: 'Теплосеть', paint: '#c96ae8', mh: true },
  };
  const STREETS = ['Геодезистов', 'Нивелирная', 'Полевая', 'Лесная', 'Садовая', 'Строителей', 'Мира', 'Заводская'];

  // ---------- утилиты сетки ----------
  const cOf = i => i % COLS, rOf = i => (i / COLS) | 0;
  const cx = i => cOf(i) * CS + CS / 2, cy = i => rOf(i) * CS + CS / 2;
  const inb = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
  const step = (i, d) => { const c = cOf(i) + DX[d], r = rOf(i) + DY[d]; return inb(c, r) ? r * COLS + c : -1; };
  const cheb = (a, b) => Math.max(Math.abs(cOf(a) - cOf(b)), Math.abs(rOf(a) - rOf(b)));
  const popc = m => (m & 1) + (m >> 1 & 1) + (m >> 2 & 1) + (m >> 3 & 1);
  const straightMask = m => m === 5 || m === 10;
  const edgeCell = i => cOf(i) === 0 || rOf(i) === 0 || cOf(i) === COLS - 1 || rOf(i) === ROWS - 1;
  const fmtTime = t => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

  class Heap { // двоичная куча (стоимость, состояние)
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(k, v) {
      const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v);
      while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
      K[i] = k; V[i] = v;
    }
    pop() {
      const K = this.k, V = this.v, rk = K[0], rv = V[0], lk = K.pop(), lv = V.pop(), n = K.length;
      if (n) {
        let i = 0;
        for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= lk) break; K[i] = K[c]; V[i] = V[c]; i = c; }
        K[i] = lk; V[i] = lv;
      }
      this.lastK = rk; return rv;
    }
  }

  // ---------- генерация: общая часть ----------
  function newG(kinds) {
    return {
      blk: new Int16Array(N), res: new Int8Array(N).fill(-1), blds: [], draws: [], hidden: [],
      nets: kinds.map(k => ({ kind: k, links: new Uint8Array(N), ends: [], manholes: [], sig: null, cells: [] })),
    };
  }
  function addBld(g, b) { g.blds.push(b); for (let r = b.r; r < b.r + b.h; r++) for (let c = b.c; c < b.c + b.w; c++) g.blk[r * COLS + c] = g.blds.length; return b; }
  function otherAt(g, ni, i) { for (let k = 0; k < g.nets.length; k++) if (k !== ni && g.nets[k].links[i]) return true; return false; }

  // ввод (выпуск) сети ni в здание b: клетка у стены снаружи, направление — от стены
  function pickEnd(g, ni, b, R, pref) {
    const cand = [];
    for (let d = 0; d < 4; d++) {
      const cells = [];
      if (d === 0) for (let r = b.r; r < b.r + b.h; r++) cells.push([b.c + b.w, r]);
      if (d === 2) for (let r = b.r; r < b.r + b.h; r++) cells.push([b.c - 1, r]);
      if (d === 1) for (let c = b.c; c < b.c + b.w; c++) cells.push([c, b.r + b.h]);
      if (d === 3) for (let c = b.c; c < b.c + b.w; c++) cells.push([c, b.r - 1]);
      for (const [c, r] of cells) {
        if (!inb(c, r)) continue;
        const i = r * COLS + c, o = step(i, d);
        if (g.blk[i] || g.res[i] >= 0 || o < 0 || g.blk[o] || g.res[o] >= 0) continue;
        let near = false;
        for (let k = 0; k < N && !near; k++) if (g.res[k] >= 0 && cheb(k, i) <= 1) near = true;
        if (near) continue;
        let busy = false; for (const n of g.nets) if (n.links[i] || n.links[o]) busy = true;
        if (busy) continue;
        cand.push({ cell: i, dir: d, w: (pref ? pref(d, c, r) : 1) * (0.5 + R()) });
      }
    }
    if (!cand.length) return null;
    cand.sort((a, b2) => b2.w - a.w);
    const e = cand[0];
    g.res[e.cell] = ni;
    const end = { cell: e.cell, dir: e.dir, bld: b };
    g.nets[ni].ends.push(end);
    return end;
  }

  // трассировка Дейкстрой по состояниям (клетка, направление): повороты дороже, чужие сети — только перпендикулярно
  function route(g, ni, starts, goal, turnCost, R) {
    const net = g.nets[ni], me = net.links;
    const noise = new Float32Array(N); for (let i = 0; i < N; i++) noise[i] = R() * 0.9;
    const dist = new Float64Array(N * 4).fill(Infinity), prev = new Int32Array(N * 4).fill(-1);
    const heap = new Heap(), startSet = new Set();
    for (const s of starts) { const st = s.cell * 4 + s.dir; dist[st] = s.cost || 0; heap.push(dist[st], st); startSet.add(s.cell); }
    const build = (st, last) => { const out = [last]; for (let s = st; s >= 0; s = prev[s]) out.push(s >> 2); return out.reverse(); };
    while (heap.size) {
      const st = heap.pop(), d0 = heap.lastK;
      if (d0 > dist[st]) continue;
      const c = st >> 2, dir = st & 3, cOther = otherAt(g, ni, c);
      for (let nd = 0; nd < 4; nd++) {
        if (nd === OPP(dir)) continue;
        let cost = d0 + 1;
        if (nd !== dir) { if (startSet.has(c) || cOther) continue; cost += turnCost; }
        const n = step(c, nd);
        if (n < 0 || g.blk[n]) continue;
        if (me[n] || g.res[n] >= 0) { // своя сеть или чей-то ввод: только как цель
          if (goal.join && goal.join(n, nd)) return build(st, n);
          continue;
        }
        const perp = (nd & 1) ? 5 : 10;
        let ok = true, cross = 0;
        for (let k = 0; k < g.nets.length; k++) if (k !== ni && g.nets[k].links[n]) { if (g.nets[k].links[n] !== perp) ok = false; cross++; }
        if (!ok || cross > 1) continue;
        let adj = 0;
        for (let d = 0; d < 4; d++) { const q = step(n, d); if (q >= 0 && q !== c && me[q]) adj = 1; }
        cost += cross * 3 + noise[n] + adj * 1.6 + (edgeCell(n) ? 0.8 : 0);
        if (goal.free && goal.free(n, nd)) { if (!cross) return build(st, n); continue; }
        const ns = n * 4 + nd;
        if (cost < dist[ns]) { dist[ns] = cost; prev[ns] = st; heap.push(cost, ns); }
      }
    }
    return null;
  }
  function commit(g, ni, path) {
    const L = g.nets[ni].links;
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k], b = path[k + 1];
      const d = cOf(b) > cOf(a) ? 0 : cOf(b) < cOf(a) ? 2 : rOf(b) > rOf(a) ? 1 : 3;
      L[a] |= BIT(d); L[b] |= BIT(OPP(d));
    }
  }
  // магистраль: от края до края участка (горизонтально или вертикально), предпочтительные ряды/колонки
  function routeMain(g, ni, orient, prefLines, R) {
    const starts = [], horiz = orient === 'h', count = horiz ? ROWS : COLS;
    const flipDir = R() < 0.5;
    const dir = horiz ? (flipDir ? 2 : 0) : (flipDir ? 3 : 1);
    for (let l = 0; l < count; l++) {
      const c = horiz ? (dir === 0 ? 0 : COLS - 1) : l, r = horiz ? l : (dir === 1 ? 0 : ROWS - 1), i = r * COLS + c;
      if (g.blk[i] || g.res[i] >= 0 || otherAt(g, ni, i)) continue;
      const pref = !prefLines || prefLines.includes(l);
      starts.push({ cell: i, dir, cost: (pref ? 0 : 14) + R() * 3 + (l === 0 || l === count - 1 ? 6 : 0) });
    }
    if (!starts.length) return false;
    const far = i => dir === 0 ? cOf(i) === COLS - 1 : dir === 2 ? cOf(i) === 0 : dir === 1 ? rOf(i) === ROWS - 1 : rOf(i) === 0;
    const path = route(g, ni, starts, { free: (n, nd) => far(n) && nd === dir }, 9, R);
    if (!path) return false;
    commit(g, ni, path);
    return true;
  }
  // ответвление от ввода к уже проложенной сети (или первое — от ввода к выпуску источника)
  function routeBranch(g, ni, end, target, R) {
    const net = g.nets[ni], me = net.links, tc = NET[net.kind].mh ? 5 : 2.5;
    const join = target
      ? (n, nd) => n === target.cell && nd === OPP(target.dir)
      : (n) => me[n] && g.res[n] < 0 && !otherAt(g, ni, n) && !edgeCell(n);
    const path = route(g, ni, [{ cell: end.cell, dir: end.dir }], { join }, tc, R);
    if (!path) return false;
    commit(g, ni, path);
    return true;
  }

  // колодцы, сигналы, цепочки для плана
  function finalize(g, R) {
    for (let ni = 0; ni < g.nets.length; ni++) {
      const net = g.nets[ni], L = net.links, mh = NET[net.kind].mh, isEnd = new Set(net.ends.map(e => e.cell));
      net.cells = []; for (let i = 0; i < N; i++) if (L[i]) net.cells.push(i);
      const man = new Set();
      if (mh) for (const i of net.cells) { if (isEnd.has(i)) continue; const m = L[i]; if (popc(m) >= 3 || (popc(m) === 2 && !straightMask(m))) man.add(i); }
      // смотровые колодцы на длинных прямых участках
      if (mh) {
        const node = i => man.has(i) || isEnd.has(i) || popc(L[i]) !== 2 || !straightMask(L[i]);
        for (const a of net.cells) {
          if (!node(a)) continue;
          for (let d = 0; d < 4; d++) {
            if (!(L[a] & BIT(d))) continue;
            const run = []; let q = step(a, d);
            while (q >= 0 && !node(q)) { run.push(q); q = step(q, d); }
            const b = q >= 0 ? q : -1;
            if (b >= 0 && b < a) continue; // каждую цепочку — один раз
            if (run.length < 7) continue;
            const k = Math.ceil((run.length + 1) / 6) - 1, stp = (run.length + 1) / (k + 1);
            for (let j = 1; j <= k; j++) {
              let p = Math.round(j * stp) - 1;
              for (let t = 0; t < 3; t++) { const cand = run[Math.max(0, Math.min(run.length - 1, p + [0, 1, -1][t]))]; if (!otherAt(g, ni, cand)) { man.add(cand); break; } }
            }
          }
        }
      }
      // у безколодезных сетей — колодец/ковер только на развилках, где нет чужих сетей
      if (!mh) for (const i of net.cells) if (!isEnd.has(i) && popc(L[i]) >= 3) man.add(i);
      net.manholes = [...man];
      // сигнал 0–9 по расстоянию до трассы
      net.sig = new Uint8Array(N); net.on = new Uint8Array(N);
      for (const i of net.cells) net.on[i] = 1;
      for (let i = 0; i < N; i++) {
        let best = 1e9; const c = cOf(i), r = rOf(i);
        for (const t of net.cells) { const dc = cOf(t) - c, dr = rOf(t) - r, d2 = dc * dc + dr * dr; if (d2 < best) best = d2; }
        net.sig[i] = Math.max(0, Math.min(9, Math.round(9 * Math.exp(-best / 2.2))));
      }
      // цепочки (ломаные между узлами) для плана
      net.chains = [];
      const nodeP = i => man.has(i) || isEnd.has(i) || popc(L[i]) !== 2;
      const seen = new Set();
      for (const a of net.cells) {
        if (!nodeP(a)) continue;
        for (let d = 0; d < 4; d++) {
          if (!(L[a] & BIT(d))) continue;
          const pts = [a]; let q = step(a, d), pd = d;
          while (q >= 0) {
            pts.push(q);
            if (nodeP(q)) break;
            let nd2 = -1; for (let e = 0; e < 4; e++) if (e !== OPP(pd) && (L[q] & BIT(e))) nd2 = e;
            if (nd2 < 0) break; pd = nd2; q = step(q, nd2);
          }
          const key = Math.min(a, pts[pts.length - 1]) + ':' + Math.max(a, pts[pts.length - 1]) + ':' + pts.length + ':' + (pts[1] + pts[pts.length - 2]);
          if (seen.has(key)) continue; seen.add(key);
          net.chains.push(pts);
        }
      }
    }
  }

  // ---------- генерация: двор многоэтажки ----------
  function layoutYard(R) {
    const g = newG(['water', 'sewer', 'tele']);
    const flip = R() < 0.5;                           // улица снизу или сверху
    const fr = (r, h = 1) => flip ? ROWS - r - h : r;
    const fy = (y, h = 0) => flip ? GH - y - h : y;
    const fa = a => flip ? -a : a;
    const D = (z, f) => g.draws.push({ z, f });
    g.streetRows = [fr(9), fr(10), fr(8)];
    const street = STREETS[(R() * STREETS.length) | 0], num = 2 + ((R() * 40) | 0);
    // дом 9 эт. (ряды 1–2 канонической схемы)
    const L = 8 + ((R() * 4) | 0), c0 = 1 + ((R() * (COLS - L - 1)) | 0);
    const H9 = addBld(g, { c: c0, r: fr(1, 2), w: L, h: 2, kind: 'house9', label: 'кж9', name: `${street}, ${num}`, color: ['#8e9196', '#a3a19a', '#9a8f86', '#868a80', '#7d8085'][(R() * 5) | 0] });
    // второй дом: пятиэтажка рядом или магазин во дворе
    const left = c0 - 1, right = COLS - (c0 + L) - 1;
    let second = null;
    if (Math.max(left, right) >= 5 && R() < 0.75) {
      const onLeft = left >= 5 && (right < 5 || R() < 0.5), span = onLeft ? left : right;
      if (R() < 0.5 && span >= 4) { // торцом к улице
        const c = onLeft ? 1 + ((R() * (span - 3)) | 0) : COLS - 2 - 1 - ((R() * (span - 3)) | 0);
        second = addBld(g, { c, r: fr(1, 4), w: 2, h: 4, kind: 'house5', label: 'кж5', name: `${street}, ${num + 2}` });
      } else {
        const w = Math.min(span - 1, 4 + ((R() * 3) | 0)), c = onLeft ? 1 + ((R() * Math.max(1, span - w)) | 0) : COLS - 1 - w - ((R() * Math.max(1, span - w)) | 0);
        second = addBld(g, { c: Math.max(1, Math.min(COLS - 1 - w, c)), r: fr(1, 2), w, h: 2, kind: 'house5', label: 'кж5', name: `${street}, ${num + 2}` });
      }
    }
    // проезд (ряд 4) с выездами на улицу
    const ca = 1 + ((R() * 4) | 0), cb = COLS - 2 - ((R() * 4) | 0);
    let shop = null;
    if (!second) {
      const w = 3, cs = ca + 2 + ((R() * (cb - ca - w - 3)) | 0);
      shop = addBld(g, { c: cs, r: fr(5, 2), w, h: 2, kind: 'shop', label: 'кн1', name: 'Магазин' });
    }
    // площадка и стоянка
    const used = new Set(); for (let c = ca - 1; c <= ca + 1; c++) used.add(c); for (let c = cb - 1; c <= cb + 1; c++) used.add(c);
    if (shop) for (let c = shop.c - 1; c <= shop.c + shop.w; c++) used.add(c);
    const freeSpan = (w) => { const opts = []; for (let c = 1; c + w <= COLS - 1; c++) { let ok = true; for (let k = c; k < c + w; k++) if (used.has(k)) ok = false; if (ok) opts.push(c); } return opts.length ? opts[(R() * opts.length) | 0] : -1; };
    const pw = 3 + ((R() * 2) | 0), pc = freeSpan(pw);
    if (pc >= 0) for (let c = pc; c < pc + pw; c++) used.add(c);
    const parkN = 3 + ((R() * 4) | 0), parkW = Math.ceil(parkN * 11 / CS), kc = freeSpan(parkW);
    if (kc >= 0) for (let c = kc; c < kc + parkW; c++) used.add(c);

    // --- рисунок ---
    const yRoad = 246, ySide = 221, yDrive = 108;
    D(0, c => Sym.ground(c, -EXT, -40, GW + 2 * EXT, GH + 120, 'lawn', 11));
    // гаражи и соседние дома за границей участка
    D(1, c => { Sym.garages(c, -EXT + 30, fy(30, 24), 6, { seed: 5 }); Sym.garages(c, GW + 30, fy(30, 24), 5, { seed: 6 }); });
    D(1, c => { Sym.building(c, -EXT + 20, fy(100, 48), 120, 48, { floors: 5, seed: 21 }); Sym.building(c, GW + 50, fy(100, 48), 110, 48, { floors: 9, seed: 22 }); });
    const rl = [
      { pts: [[-EXT - 20, fy(yRoad)], [GW + EXT + 20, fy(yRoad)]], width: 30, kind: 'asphalt', seed: 3 },
      { pts: [[-EXT - 20, fy(ySide)], [GW + EXT + 20, fy(ySide)]], width: 10, kind: 'path', seed: 4 },
      { pts: [[ca * CS + 12, fy(yRoad)], [ca * CS + 12, fy(yDrive)], [cb * CS + 12, fy(yDrive)], [cb * CS + 12, fy(yRoad)]], width: 20, kind: 'asphalt', seed: 5, opt: { marking: false } },
    ];
    const blds = [H9, second].filter(Boolean);
    for (const b of blds) { // тротуар вдоль фасада
      const yy = b.kind === 'house9' || b.h === 2 ? (flip ? (b.r - 0.5) * CS : (b.r + b.h + 0.5) * CS) : null;
      if (yy != null) rl.push({ pts: [[b.c * CS - 4, yy], [(b.c + b.w) * CS + 4, yy]], width: 9, kind: 'path', seed: 9 + b.c });
    }
    D(2, c => Sym.roads(c, rl));
    if (kc >= 0) D(3, c => {
      const y0 = fy(119, 24); Sym.ground(c, kc * CS + 2, y0, parkW * CS - 4, 24, 'asphalt', 8);
      c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 0.7; c.beginPath();
      for (let k = 0; k <= parkN; k++) { const x = kc * CS + 6 + k * 11; c.moveTo(x, y0 + 2); c.lineTo(x, y0 + 22); } c.stroke();
      for (let k = 0; k < parkN; k++) if (R() < 0.85) Sym.car(c, kc * CS + 11.5 + k * 11, fy(131), fa(Math.PI / 2) + (R() - 0.5) * 0.06, null, (R() * 1e6) | 0);
    });
    if (pc >= 0) {
      const px = pc * CS + 4, py = fy(150, 2 * CS - 12), ww = pw * CS - 8, hh = 2 * CS - 12, ps = (R() * 1e6) | 0;
      D(3, c => { Sym.playground(c, px, py, ww, hh, ps); Sym.fence(c, [[px - 2, py - 2], [px + ww + 2, py - 2], [px + ww + 2, py + hh + 2], [px - 2, py + hh + 2], [px - 2, py - 2]], 'metal'); });
      D(6, c => { Sym.bench(c, px + ww * 0.3, py + (flip ? -6 : hh + 6), 0); Sym.bench(c, px + ww * 0.7, py + (flip ? -6 : hh + 6), 0); });
    }
    // здания
    for (const b of g.blds) {
      const x = b.c * CS + 2, y = b.r * CS + 2, w = b.w * CS - 4, h = b.h * CS - 4, s = (R() * 1e6) | 0;
      if (b.kind === 'shop') D(4, c => Sym.building(c, x, y, w, h, { floors: 1, kind: 'industrial', color: '#b9b2a2', seed: s }));
      else D(4, c => Sym.building(c, x, y, w, h, { floors: b.kind === 'house9' ? 9 : 5, color: b.color, seed: s }));
      // подъезды: козырьки, клумбы, скамейки со двора
      if (b.h === 2 && b.kind !== 'shop') {
        const n = Math.max(2, Math.round(b.w / 2.6)), yy = flip ? y - 1 : y + h + 1;
        for (let k = 0; k < n; k++) {
          const ex = x + (k + 0.5) * w / n, fs = (R() * 1e6) | 0;
          D(5, c => { c.fillStyle = '#c9c2b4'; c.fillRect(ex - 4, flip ? yy - 4 : yy, 8, 4); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(ex - 4, flip ? yy - 1 : yy + 3, 8, 1); Sym.flowerbed(c, ex + 6, flip ? yy - 8 : yy + 3, 7, 4, fs); Sym.bush(c, ex - 8, flip ? yy - 6 : yy + 5, 2.6, fs + 1); });
        }
      }
    }
    // фонари вдоль проезда
    for (let c = ca + 2; c < cb - 1; c += 4) { const x = c * CS + 12; D(7, cc => Sym.pole(cc, x, fy(yDrive + 13), 'lamp', fa(-Math.PI / 2))); }
    for (let x = -EXT + 40; x < GW + EXT; x += 110) D(7, cc => Sym.pole(cc, x, fy(212), 'lamp', fa(Math.PI / 2)));
    // деревья: газон за домом, двор, обочина
    const kinds = ['deciduous', 'deciduous', 'birch', 'conifer', 'apple', 'deciduous', 'birch'];
    const free = (x, y, r) => {
      const c = Math.floor(x / CS), rr = Math.floor(y / CS);
      if (x > -EXT && x < GW + EXT && (c < 0 || c >= COLS)) return y > 10 && Math.abs(y - fy(yRoad)) > 30 && Math.abs(y - fy(ySide)) > 12 && Math.abs(y - fy(100, 48) - 24) > 34 && Math.abs(y - fy(30, 24) - 12) > 22;
      if (!inb(c, rr)) return false;
      for (const b of g.blds) if (x > b.c * CS - r && x < (b.c + b.w) * CS + r && y > b.r * CS - r && y < (b.r + b.h) * CS + r) return false;
      const yc = flip ? GH - y : y;
      if (yc > 200 || (yc > 92 && yc < 126) || (yc > 72 && yc < 98)) return false;
      if (Math.abs(x - (ca * CS + 12)) < 16 + r * 0.5 && yc > 100 || Math.abs(x - (cb * CS + 12)) < 16 + r * 0.5 && yc > 100) return false;
      if (pc >= 0 && x > pc * CS - r && x < (pc + pw) * CS + r && yc > 140) return false;
      if (kc >= 0 && x > kc * CS - r && x < (kc + parkW) * CS + r && yc > 116 && yc < 148) return false;
      if (shop && x > (shop.c - 1) * CS && x < (shop.c + shop.w + 1) * CS && yc > 100) return false;
      return true;
    };
    const trees = [];
    for (let k = 0; k < 140 && trees.length < 34; k++) {
      const x = -EXT + R() * (GW + 2 * EXT), y = R() * GH, r = 7 + R() * 6;
      if (!free(x, y, r)) continue;
      if (trees.some(t => Math.hypot(t.x - x, t.y - y) < (t.r + r) * 0.9)) continue;
      trees.push({ x, y, r, kind: kinds[(R() * kinds.length) | 0], s: (R() * 1e6) | 0 });
    }
    for (let x = -EXT + 20; x < GW + EXT; x += 44 + R() * 30) { const y = fy(203 + R() * 5); trees.push({ x, y, r: 8 + R() * 3, kind: R() < 0.7 ? 'deciduous' : 'birch', s: (R() * 1e6) | 0 }); }
    trees.sort((a, b) => a.y - b.y);
    for (const t of trees) D(8, c => Sym.tree(c, t.x, t.y, t.r, t.kind, t.s));
    for (let k = 0; k < 8; k++) { const x = R() * GW, y = R() * GH, r = 3 + R() * 2; if (free(x, y, r + 4)) D(5, c => Sym.bush(c, x, y, r, k * 31 + 7)); }
    // машины на улице
    for (let x = -EXT + 30; x < GW + EXT - 20; x += 24 + R() * 60) if (R() < 0.55) { const s = (R() * 1e6) | 0; D(6, c => Sym.car(c, x, fy(yRoad - 9), 0, null, s)); }
    g.street = street; g.num = num; g.flip = flip; g.yRoad = fy(yRoad); g.ySide = fy(ySide);
    g.roadsPlan = rl;

    // --- сети ---
    const towardStreet = d => (flip ? d === 3 : d === 1) ? 3 : 1, awayStreet = d => (flip ? d === 1 : d === 3) ? 3 : 1;
    const homes = g.blds.filter(b => b.kind !== 'shop');
    for (const b of g.blds) if (!pickEnd(g, 0, b, R, towardStreet)) return null;
    for (const b of homes) { if (!pickEnd(g, 1, b, R, R() < 0.6 ? awayStreet : towardStreet)) return null; if (b.kind === 'house9' && !pickEnd(g, 1, b, R, towardStreet)) return null; }
    if (shop && !pickEnd(g, 1, shop, R, null)) return null;
    for (const b of g.blds) if (!pickEnd(g, 2, b, R, null)) return null;
    const sr = [fr(9), fr(10), fr(8)];
    const ord = R() < 0.5 ? [sr[0], sr[1]] : [sr[1], sr[0]];
    if (!routeMain(g, 0, 'h', [ord[0]], R)) return null;
    if (!routeMain(g, 1, 'h', [ord[1]], R)) return null;
    const teleBack = R() < 0.4;
    if (!routeMain(g, 2, 'h', teleBack ? [fr(0)] : [sr[2], fr(7)], R)) return null;
    for (let ni = 0; ni < 3; ni++) for (const e of g.nets[ni].ends) if (!routeBranch(g, ni, e, null, R)) return null;
    return g;
  }

  // ---------- генерация: промзона ----------
  function layoutIndustrial(R) {
    const g = newG(['water', 'sewer', 'heat', 'gas', 'power']);
    const D = (z, f) => g.draws.push({ z, f });
    const rm = 4 + ((R() * 3) | 0), cv = 4 + ((R() * 14) | 0), vUp = R() < 0.5;
    const road = new Uint8Array(N);
    for (let c = 0; c < COLS; c++) road[rm * COLS + c] = 1;
    for (let r = vUp ? 0 : rm; vUp ? r <= rm : r < ROWS; r++) road[r * COLS + cv] = 1;
    const plant = 1 + ((R() * 30) | 0);
    const list = [
      { kind: 'shop', name: 'Цех №1', label: 'кн2', w: 6 + ((R() * 3) | 0), h: 3 },
      { kind: 'shop', name: 'Цех №2', label: 'кн1', w: 5 + ((R() * 3) | 0), h: 2 + ((R() * 2) | 0) },
      { kind: 'store', name: 'Склад', label: 'мн1', w: 4 + ((R() * 3) | 0), h: 2 },
      { kind: 'boiler', name: 'Котельная', label: 'кн', w: 2, h: 2 },
      { kind: 'tp', name: 'ТП', label: 'ТП', w: R() < 0.5 ? 2 : 1, h: 1 },
      { kind: 'grp', name: 'ГРП', label: 'ГРП', w: 1, h: 1 },
    ];
    for (const b of list) {
      let placed = false;
      for (let t = 0; t < 300 && !placed; t++) {
        const c = 1 + ((R() * (COLS - 1 - b.w)) | 0), r = 1 + ((R() * (ROWS - 1 - b.h)) | 0);
        if (r + b.h > ROWS - 1 || c + b.w > COLS - 1) continue;
        let ok = true;
        for (let rr = r - 1; rr <= r + b.h && ok; rr++) for (let cc = c - 1; cc <= c + b.w && ok; cc++) {
          if (!inb(cc, rr)) continue;
          const i = rr * COLS + cc, inside = rr >= r && rr < r + b.h && cc >= c && cc < c + b.w;
          if (g.blk[i]) ok = false;
          if (inside && road[i]) ok = false;
        }
        if (ok) { addBld(g, Object.assign(b, { c, r })); placed = true; }
      }
      if (!placed) return null;
    }
    const B = k => g.blds.find(b => b.name === k);
    // --- рисунок ---
    D(0, c => { Sym.ground(c, -EXT, -40, GW + 2 * EXT, GH + 120, 'grass', 17); Sym.ground(c, 2, 2, GW - 4, GH - 4, 'concrete', 18); });
    // газонные островки
    const islands = [];
    for (let t = 0; t < 40 && islands.length < 3; t++) {
      const c = 1 + ((R() * (COLS - 4)) | 0), r = 1 + ((R() * (ROWS - 3)) | 0), w = 2 + ((R() * 2) | 0), h = 1 + ((R() * 2) | 0);
      let ok = true;
      for (let rr = r - 1; rr <= r + h && ok; rr++) for (let cc = c - 1; cc <= c + w && ok; cc++) if (inb(cc, rr) && (g.blk[rr * COLS + cc] || road[rr * COLS + cc])) ok = false;
      if (ok && !islands.some(o => !(c + w < o.c || o.c + o.w < c || r + h < o.r || o.r + o.h < r))) islands.push({ c, r, w, h });
    }
    const yR = rm * CS + 12, xV = cv * CS + 12;
    const rl = [
      { pts: [[-EXT - 20, yR], [GW + EXT + 20, yR]], width: 22, kind: 'asphalt', seed: 7 },
      { pts: [[xV, yR], [xV, vUp ? 14 : GH - 14]], width: 18, kind: 'asphalt', seed: 8, opt: { marking: false } },
    ];
    D(2, c => Sym.roads(c, rl));
    for (const o of islands) {
      const x = o.c * CS + 3, y = o.r * CS + 3, w = o.w * CS - 6, h = o.h * CS - 6, s = (R() * 1e6) | 0;
      D(2, c => { Sym.ground(c, x, y, w, h, 'lawn', s); c.strokeStyle = '#9d9a92'; c.lineWidth = 1.2; c.strokeRect(x, y, w, h); });
      const n = 1 + ((R() * 3) | 0);
      for (let k = 0; k < n; k++) { const tx = x + 8 + R() * (w - 16), ty = y + 6 + R() * (h - 12), tr = 6 + R() * 4, kind = ['deciduous', 'birch', 'conifer'][(R() * 3) | 0]; D(8, c => Sym.tree(c, tx, ty, tr, kind, s + k)); }
    }
    // ограждение с воротами
    const fp = 3;
    D(7, c => {
      Sym.fence(c, [[fp, yR - 16], [fp, fp], [GW - fp, fp], [GW - fp, yR - 16]], 'concrete');
      Sym.fence(c, [[fp, yR + 16], [fp, GH - fp], [GW - fp, GH - fp], [GW - fp, yR + 16]], 'concrete');
      Sym.gate(c, fp, yR, 30, Math.PI / 2, 0.15); Sym.gate(c, GW - fp, yR, 30, Math.PI / 2, 0.85);
    });
    // за оградой: деревья, опоры ЛЭП
    for (let x = -EXT + 20; x < GW + EXT; x += 30 + R() * 40) {
      if (x > -14 && x < GW + 14) continue;
      for (const y of [30 + R() * 40, GH - 40 - R() * 50]) { const r = 8 + R() * 5, s = (R() * 1e6) | 0, kind = ['deciduous', 'birch', 'conifer'][(R() * 3) | 0]; if (Math.abs(y - yR) > 26) D(8, c => Sym.tree(c, x, y, r, kind, s)); }
    }
    for (const sx of [-1, 1]) {
      const xs = sx < 0 ? [-30, -100, -170] : [GW + 30, GW + 100, GW + 170];
      D(9, c => { for (let k = 0; k < xs.length; k++) { Sym.pole(c, xs[k], yR - 30, 'power', 0); if (k) Sym.wires(c, xs[k - 1], yR - 30, xs[k], yR - 30); } });
    }
    // здания
    for (const b of g.blds) {
      const x = b.c * CS + 2, y = b.r * CS + 2, w = b.w * CS - 4, h = b.h * CS - 4, s = (R() * 1e6) | 0;
      if (b.kind === 'shop') D(4, c => Sym.building(c, x, y, w, h, { kind: 'industrial', floors: 3, seed: s }));
      else if (b.kind === 'store') D(4, c => Sym.building(c, x, y, w, h, { kind: 'industrial', floors: 2, color: '#9fa8ad', seed: s }));
      else if (b.kind === 'boiler') D(4, c => {
        Sym.building(c, x, y, w, h, { kind: 'industrial', floors: 2, color: '#b08a6e', seed: s });
        const tx = x + w * 0.72, ty = y + h * 0.3; // дымовая труба
        c.strokeStyle = 'rgba(0,0,0,.22)'; c.lineWidth = 6; c.lineCap = 'round'; c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx + 34, ty + 34); c.stroke();
        c.fillStyle = '#8a4a34'; c.beginPath(); c.arc(tx, ty, 4.2, 0, 7); c.fill(); c.fillStyle = '#e8e2d8'; c.beginPath(); c.arc(tx, ty, 3.2, 0, 7); c.fill();
        c.fillStyle = '#c0392b'; c.beginPath(); c.arc(tx, ty, 2.4, 0, 7); c.fill(); c.fillStyle = '#2b2522'; c.beginPath(); c.arc(tx, ty, 1.7, 0, 7); c.fill();
      });
      else if (b.kind === 'tp') D(4, c => {
        Sym.building(c, x, y, w, h, { kind: 'industrial', floors: 1, color: '#d6d2c6', seed: s });
        c.fillStyle = '#f2c230'; c.beginPath(); c.moveTo(x + w / 2, y + 3); c.lineTo(x + w / 2 + 4, y + 10); c.lineTo(x + w / 2 - 4, y + 10); c.closePath(); c.fill();
        c.fillStyle = '#c0392b'; c.fillRect(x + w / 2 - 0.6, y + 5, 1.2, 3.4);
      });
      else D(4, c => { Sym.building(c, x, y, w, h, { kind: 'industrial', floors: 1, color: '#e3c25a', seed: s }); });
    }
    // контейнеры, машины, фонари
    const freeCell = () => { for (let t = 0; t < 60; t++) { const c = 1 + ((R() * (COLS - 2)) | 0), r = 1 + ((R() * (ROWS - 2)) | 0), i = r * COLS + c; if (!g.blk[i] && !road[i] && !islands.some(o => c >= o.c - 1 && c <= o.c + o.w && r >= o.r - 1 && r <= o.r + o.h)) { let near = false; for (const b of g.blds) if (c >= b.c - 1 && c <= b.c + b.w && r >= b.r - 1 && r <= b.r + b.h) near = true; if (!near) return i; } } return -1; };
    for (let k = 0; k < 3; k++) { const i = freeCell(); if (i < 0) continue; const s = (R() * 1e6) | 0, rot = R() < 0.5 ? 0 : Math.PI / 2; D(5, c => Sym.shed(c, cx(i) - (rot ? 5 : 11), cy(i) - (rot ? 11 : 5), rot ? 10 : 22, rot ? 22 : 10, { material: 'metal', seed: s, color: ['#3f6f9a', '#a6402f', '#4f7a4a', '#b07a2a'][s % 4] })); }
    for (let k = 0; k < 4; k++) { const i = freeCell(); if (i < 0) continue; const s = (R() * 1e6) | 0, rot = R() < 0.5 ? 0 : Math.PI / 2; D(6, c => Sym.car(c, cx(i), cy(i), rot, null, s)); }
    for (let x = 30; x < GW; x += 120) D(9, c => Sym.pole(c, x, yR - 14, 'lamp', -Math.PI / 2));
    g.yRoad = yR; g.roadsPlan = rl; g.plant = plant; g.islands = islands;

    // --- сети ---
    const shops = g.blds.filter(b => b.kind === 'shop'), store = B('Склад'), boiler = B('Котельная'), tp = B('ТП'), grp = B('ГРП');
    const sh = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
    // выпуски источников
    const oHeat = pickEnd(g, 2, boiler, R, null), oGas = pickEnd(g, 3, grp, R, null), oPow = pickEnd(g, 4, tp, R, null);
    if (!oHeat || !oGas || !oPow) return null;
    for (const e of [oHeat, oGas, oPow]) e.outlet = true;
    const wIn = [boiler, ...sh(shops.slice()).slice(0, 1 + ((R() * 2) | 0))];
    for (const b of wIn) if (!pickEnd(g, 0, b, R, null)) return null;
    for (const b of sh(shops.slice()).slice(0, 1 + ((R() * 2) | 0))) if (!pickEnd(g, 1, b, R, null)) return null;
    for (const b of sh([...shops, store]).slice(0, 2)) if (!pickEnd(g, 2, b, R, null)) return null;
    if (!pickEnd(g, 3, boiler, R, null)) return null;
    if (R() < 0.5 && !pickEnd(g, 3, shops[(R() * shops.length) | 0], R, null)) return null;
    for (const b of sh([...shops, store]).slice(0, 2 + ((R() * 2) | 0))) if (!pickEnd(g, 4, b, R, null)) return null;
    const o1 = R() < 0.5 ? 'h' : 'v';
    if (!routeMain(g, 0, o1, null, R)) return null;
    if (!routeMain(g, 1, o1 === 'h' ? 'v' : 'h', null, R)) return null;
    for (const ni of [2, 3, 4]) {
      const net = g.nets[ni], src = net.ends.find(e => e.outlet), ins = net.ends.filter(e => !e.outlet);
      if (!routeBranch(g, ni, ins[0], src, R)) return null;
      for (let k = 1; k < ins.length; k++) if (!routeBranch(g, ni, ins[k], null, R)) return null;
    }
    for (const ni of [0, 1]) for (const e of g.nets[ni].ends) if (!routeBranch(g, ni, e, null, R)) return null;
    return g;
  }

  function generate(api, variant, seed) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const R = api.rng((seed + attempt * 7919) >>> 0);
      const g = variant.id === 'yard' ? layoutYard(R) : layoutIndustrial(R);
      if (!g) continue;
      finalize(g, R);
      if (g.nets.some(n => n.cells.length < 6)) continue;
      // гидрант у водопроводного колодца, «ковер» газа у ГРП — детали после трассировки
      const w = g.nets[0];
      const wm = w.manholes.slice().sort((a, b) => Math.abs(cy(a) - g.yRoad) - Math.abs(cy(b) - g.yRoad))[0];
      if (wm != null) g.hydrant = wm;
      return g;
    }
    throw new Error('участок не сгенерирован');
  }

  registerMode({
    index: 4,
    id: 'locator',
    title: 'Трассоискатель',
    subtitle: 'Поиск и съёмка подземных коммуникаций',
    howto: [
      'Выберите сеть внизу и тапайте по клеткам: прибор покажет сигнал 0–9 (9 — прямо над трубой). Каждый замер тратит заряд.',
      'Колодцы и вводы в здания — точки трассы. Трубы идут прямо, поворачивают и ветвятся в колодцах; ввод — перпендикулярно стене.',
      '«Краска»: проведите пальцем по клеткам — разметьте трассу. «Ластик» стирает.',
      'Готово — «СДАТЬ»: разметку сверят с исполнительной съёмкой (допуск — клетка 6 м).',
    ],
    variants: [
      { id: 'yard', title: 'Двор многоэтажки', subtitle: 'Водопровод, канализация и связь: магистрали под улицей, вводы в дома', params: { battery: 45 } },
      { id: 'industrial', title: 'Промзона', subtitle: 'Пять сетей, цеха, склад, котельная, ТП и ГРП за бетонным забором',
        howto: ['Газ и кабель колодцев не имеют — повороты ищите по сигналу; Т идёт от котельной, Э — от ТП, Г — от ГРП.'], params: { battery: 40 } },
    ],
    create(api, variant, seed) {
      if (Sym.prepare) Sym.prepare(['lawn', 'grass', 'asphalt', 'concrete', 'paper']);
      const g = generate(api, variant, seed);
      const nets = g.nets, NN = nets.length;
      const BAT = variant.params.battery;
      let battery = BAT, time = LIMIT, done = false;
      let sel = 0, tool = 'meas';
      const meas = nets.map(() => new Int8Array(N).fill(-1));
      const marks = nets.map(() => new Uint8Array(N));
      const nodeOf = nets.map(n => { const s = new Set(n.manholes); for (const e of n.ends) s.add(e.cell); return s; });
      let last = null;                    // последний замер {ni, cell, v, t}
      let stroke = null, confirmAt = -10, lastPaintSfx = 0, warned = {};
      const hero = { x: 2 * CS, y: g.yRoad != null ? g.yRoad - 14 : GH - 20, tx: 0, ty: 0, dir: -0.6, walk: 0, scan: -10 };
      hero.tx = hero.x; hero.ty = hero.y;
      const fx = [];                      // эффекты: волны, вспышки клеток
      // прохожие во дворе
      const walkers = [];
      if (variant.id === 'yard') {
        walkers.push({ x: -40, y: g.ySide, v: 16, seed: 3, dog: true }, { x: GW + 60, y: g.ySide + 2, v: -12, seed: 8 });
      } else walkers.push({ x: 60, y: g.yRoad + 6, v: 14, seed: 12, worker: true });
      const carMove = variant.id === 'yard' ? { x: -EXT - 40, v: 70, seed: 42 } : null;

      // ---------- раскладка экрана ----------
      let L = null, layer = null, layerKey = '';
      function layout() {
        const W = api.W;
        if (L && L.W === W) return L;
        const availH = BAR_Y - 2 - FIELD_TOP, s = Math.min((W - 12) / GW, availH / GH);
        const ox = (W - GW * s) / 2, oy = FIELD_TOP + (availH - GH * s) / 2;
        // нижняя панель: сети, инструменты, заряд, СДАТЬ
        const bw = 44, gap = 4, nw = NN * bw + (NN - 1) * gap, tw = 3 * bw + 2 * gap, bat = 50, sw = 76;
        const total = nw + 12 + tw + 12 + bat + 8 + sw, x0 = Math.max(6, (W - total) / 2);
        const netB = nets.map((n, k) => ({ x: x0 + k * (bw + gap), y: BAR_Y, w: bw, h: BAR_H }));
        const tx0 = x0 + nw + 12, toolB = ['meas', 'paint', 'erase'].map((t, k) => ({ id: t, x: tx0 + k * (bw + gap), y: BAR_Y, w: bw, h: BAR_H }));
        const batB = { x: tx0 + tw + 12, y: BAR_Y, w: bat, h: BAR_H }, subB = { x: batB.x + bat + 8, y: BAR_Y, w: sw, h: BAR_H };
        L = { W, s, ox, oy, netB, toolB, batB, subB, side: ox > 96 };
        return L;
      }
      const toWorld = p => { const l = layout(); return { x: (p.x - l.ox) / l.s, y: (p.y - l.oy) / l.s }; };
      const cellAt = p => { const w = toWorld(p), c = Math.floor(w.x / CS), r = Math.floor(w.y / CS); return inb(c, r) ? r * COLS + c : -1; };
      const scr = i => { const l = layout(); return { x: l.ox + cx(i) * l.s, y: l.oy + cy(i) * l.s }; };

      // ---------- статичный слой: сцена, колодцы, вводы ----------
      function drawStatic(c) {
        const ds = g.draws.slice().sort((a, b) => a.z - b.z);
        for (const d of ds) d.f(c);
        // колодцы и буквы-«метки краской» рядом
        for (let ni = 0; ni < NN; ni++) {
          const n = nets[ni], k = n.kind, col = NET[k].paint;
          for (const i of n.manholes) {
            const x = cx(i), y = cy(i), mk = NET[k].mh ? k : (k === 'gas' ? 'gas' : 'power');
            Sym.manhole(c, x, y, mk, NET[k].mh ? 4.4 : 3.2, 0);
            c.font = 'bold 8px system-ui, sans-serif'; c.textAlign = 'center';
            c.lineWidth = 2.2; c.strokeStyle = 'rgba(0,0,0,.55)'; c.strokeText(NET[k].l, x + 8, y - 5); c.fillStyle = col; c.fillText(NET[k].l, x + 8, y - 5);
          }
          for (const e of n.ends) {
            const x = cx(e.cell) - DX[e.dir] * CS / 2, y = cy(e.cell) - DY[e.dir] * CS / 2;
            c.save(); c.translate(x, y); c.rotate(e.dir * Math.PI / 2);
            c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(-1.5, -4.5, 6, 9);
            c.fillStyle = '#5a5f63'; c.fillRect(-2, -3.6, 5, 7.2);
            c.fillStyle = col; c.fillRect(-1.2, -2.6, 4, 5.2);
            c.restore();
            c.font = 'bold 8px system-ui, sans-serif'; c.textAlign = 'center';
            const lx = x + DX[e.dir] * 7 + (e.dir & 1 ? 7 : 0), ly = y + DY[e.dir] * 7 + (e.dir & 1 ? 3 : -5);
            c.lineWidth = 2.2; c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeText(NET[k].l, lx, ly); c.fillStyle = col; c.fillText(NET[k].l, lx, ly);
          }
        }
        if (g.hydrant != null) Sym.hydrant(c, cx(g.hydrant) - 9, cy(g.hydrant) + 7, 0);
        // подписи зданий
        for (const b of g.blds) {
          const x = (b.c + b.w / 2) * CS, y = (b.r + b.h / 2) * CS, t = b.kind === 'house9' || b.kind === 'house5' ? b.name : b.name;
          c.font = 'bold 8px system-ui, sans-serif'; const tw = c.measureText(t).width;
          c.fillStyle = 'rgba(255,255,255,.72)'; c.fillRect(x - tw / 2 - 3, y - 6, tw + 6, 11);
          c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.6; c.strokeRect(x - tw / 2 - 3, y - 6, tw + 6, 11);
          c.fillStyle = INK; c.textAlign = 'center'; c.fillText(t, x, y + 2.5);
        }
        // за границей участка — притушить; граница — штрих-пунктир
        c.fillStyle = 'rgba(12,16,10,.38)';
        c.fillRect(-EXT - 40, -60, EXT + 40, GH + 200); c.fillRect(GW, -60, EXT + 40, GH + 200); c.fillRect(0, GH, GW, 120);
        c.strokeStyle = 'rgba(255,90,60,.85)'; c.lineWidth = 1.2; c.setLineDash([10, 3, 2, 3]); c.strokeRect(0, 0, GW, GH); c.setLineDash([]);
        // сетка 6×6 м
        c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = 0.5; c.beginPath();
        for (let k = 1; k < COLS; k++) { c.moveTo(k * CS, 0); c.lineTo(k * CS, GH); }
        for (let k = 1; k < ROWS; k++) { c.moveTo(0, k * CS); c.lineTo(GW, k * CS); }
        c.stroke();
        c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath();
        for (let a = 1; a < COLS; a++) for (let b = 1; b < ROWS; b++) { c.rect(a * CS - 1.5, b * CS - 0.25, 3, 0.5); c.rect(a * CS - 0.25, b * CS - 1.5, 0.5, 3); }
        c.fill();
      }
      function ensureLayer() {
        const l = layout(), key = l.W + ':' + l.s.toFixed(4);
        if (layer && layerKey === key) return layer;
        layerKey = key;
        layer = api.layer(l.W, 360 - FIELD_TOP + 1, c => { c.translate(l.ox, l.oy - FIELD_TOP + 1); c.scale(l.s, l.s); drawStatic(c); });
        return layer;
      }
      ensureLayer();

      // ---------- действия ----------
      function measure(i) {
        const n = nets[sel], k = n.kind, p = scr(i);
        hero.tx = cx(i) - 13; hero.ty = cy(i) + 11; hero.dir = Math.atan2(cy(i) - hero.ty, cx(i) - hero.tx);
        if (g.blk[i]) { api.popup(p.x, p.y - 10, 'Здание — замер невозможен', api.theme.bad); api.sfx('bad'); return; }
        if (meas[sel][i] >= 0) { last = { ni: sel, cell: i, v: meas[sel][i], t: api.now }; api.sfx('select'); return; }
        if (nodeOf[sel].has(i)) { // колодец / ввод своей сети: трасса здесь, заряд не тратим
          meas[sel][i] = 9; last = { ni: sel, cell: i, v: 9, t: api.now };
          api.popup(p.x, p.y - 12, 'Колодец/ввод ' + NET[k].l + ' — трасса здесь', NET[k].paint); api.sfx('point'); hero.scan = api.now; return;
        }
        if (battery <= 0) { api.popup(p.x, p.y - 10, 'Батарея села!', api.theme.bad); api.sfx('bad'); api.shake(3); return; }
        battery--;
        const v = n.sig[i];
        meas[sel][i] = v; last = { ni: sel, cell: i, v, t: api.now }; hero.scan = api.now;
        fx.push({ kind: 'wave', cell: i, t: api.now, col: NET[k].paint, v });
        if (v === 9) { api.sfx('good'); api.popup(p.x, p.y - 14, '9 — над трассой!', NET[k].paint); api.burst(p.x, p.y, NET[k].paint, 8); }
        else if (v >= 5) api.sfx('point');
        else if (v >= 1) api.sfx('measure');
        else api.sfx('beep');
        if ((battery === 10 || battery === 5) && !warned[battery]) { warned[battery] = 1; api.popup(layout().batB.x + 25, BAR_Y - 8, 'Заряд: ' + battery, api.theme.bad); api.sfx('warn'); }
        if (battery === 0) { api.popup(layout().batB.x + 25, BAR_Y - 8, 'Батарея села', api.theme.bad); api.sfx('warn'); }
      }
      function paintCell(i, erase) {
        if (i < 0) return;
        if (g.blk[i]) return;
        if (erase) {
          if (marks[sel][i]) marks[sel][i] = 0;
          else { for (let k = 0; k < NN; k++) if (marks[k][i]) { marks[k][i] = 0; break; } }
        } else {
          if (marks[sel][i]) return;
          marks[sel][i] = 1;
          fx.push({ kind: 'spray', cell: i, t: api.now, col: NET[nets[sel].kind].paint });
        }
        hero.tx = cx(i) - 13; hero.ty = cy(i) + 11; hero.dir = Math.atan2(cy(i) - hero.ty, cx(i) - hero.tx);
        if (api.now - lastPaintSfx > 0.09) { api.sfx(erase ? 'paper' : 'tap'); lastPaintSfx = api.now; }
      }
      function strokeTo(p) { // протяжка: все клетки по отрезку
        const w = toWorld(p), a = stroke.w;
        const len = Math.hypot(w.x - a.x, w.y - a.y), n = Math.max(1, Math.ceil(len / 5));
        for (let k = 1; k <= n; k++) {
          const x = a.x + (w.x - a.x) * k / n, y = a.y + (w.y - a.y) * k / n, c = Math.floor(x / CS), r = Math.floor(y / CS);
          if (!inb(c, r)) continue;
          const i = r * COLS + c;
          if (i !== stroke.last) { paintCell(i, stroke.erase); stroke.last = i; }
        }
        stroke.w = w;
      }
      function selectNet(k) { if (k === sel || k < 0 || k >= NN) return; sel = k; api.sfx('select'); }
      function selectTool(t) { if (t === tool) return; tool = t; api.sfx('tap'); }

      // ---------- итог ----------
      function evaluate() {
        const per = nets.map((n, ni) => {
          const T = n.cells, M = []; for (let i = 0; i < N; i++) if (marks[ni][i]) M.push(i);
          let found = 0, exact = 0, near = 0, far = 0;
          for (const t of T) if (M.some(m => cheb(m, t) <= 1)) found++;
          const cls = new Int8Array(N);
          for (const m of M) { if (n.on[m]) { exact++; cls[m] = 1; } else if (T.some(t => cheb(t, m) <= 1)) { near++; cls[m] = 2; } else { far++; cls[m] = 3; } }
          const missed = T.filter(t => !M.some(m => cheb(m, t) <= 1));
          const q = Math.max(0, Math.min(1, found / T.length - (far + 0.25 * near) / T.length));
          return { kind: n.kind, T: T.length, M: M.length, found, exact, near, far, q, cls, missed, len: (T.length - 1) * CELL_M };
        });
        const tot = per.reduce((a, p) => a + p.T, 0), acc = per.reduce((a, p) => a + p.q * p.T, 0) / tot;
        return { per, acc };
      }
      function submit() {
        if (done) return;
        done = true;
        const ev = evaluate(), acc = ev.acc;
        const score = Math.round(acc * (800 + 130 * battery / BAT + 70 * time / LIMIT));
        const stars = score >= 800 ? 3 : score >= 600 ? 2 : score >= 350 ? 1 : 0;
        const ok = ev.per.filter(p => p.q >= 0.6).length, extra = ev.per.reduce((a, p) => a + p.far, 0);
        const lines = [
          `Совпадение трасс: ${Math.round(acc * 100)} % (допуск — клетка 6 м)`,
          `Сетей найдено: ${ok}/${NN} · лишней разметки: ${extra} кл.`,
          `Заряд: ${battery}/${BAT} · время: ${fmtTime(LIMIT - time)}`,
          ev.per.map(p => NET[p.kind].l + ' ' + Math.round(p.q * 100) + '%').join(' · '),
        ];
        api.sfx(stars >= 2 ? 'win' : 'paper');
        let cache = null;
        api.finish({
          score, stars, lines,
          drawResult(ctx, x, y, w, h) {
            const key = w + ':' + h;
            if (!cache || cache.key !== key) cache = { key, layer: api.layer(w + 4, h + 5, c => drawPlan(c, w, h, ev)) };
            ctx.drawImage(cache.layer.canvas, x, y, w + 4, h + 5);
          },
        });
      }

      // ---------- план сетей (экспликация) ----------
      function drawPlan(c, w, h, ev) {
        Sym.plan.paper(c, 0, 0, w, h, { title: 'План подземных сетей', scale: '500', stamp: false, grid: 0 });
        const m = 10, z = 1.25, k = (w - 2 * m) / GW, mx = m, my = 24;
        const P = (wx, wy) => [(mx + wx * k) / z, (my + wy * k) / z];
        Sym.plan.label(c, w / 2, 13, 'Исполнительная съёмка подземных коммуникаций', Math.min(7, w / 44), INK, 0, 700);
        c.save(); c.beginPath(); c.rect(mx, my, GW * k, GH * k); c.clip();
        c.scale(z, z);
        // дороги и здания
        for (const r of g.roadsPlan || []) if (r.kind !== 'path') Sym.plan.road(c, r.pts.map(q => P(q[0], q[1])), r.width * k / z, null);
        for (const b of g.blds) {
          const [x0, y0] = P(b.c * CS + 2, b.r * CS + 2), [x1, y1] = P((b.c + b.w) * CS - 2, (b.r + b.h) * CS - 2);
          Sym.plan.house(c, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], b.label);
        }
        // истинные трассы
        for (const n of nets) for (const ch of n.chains) Sym.plan.utility(c, ch.map(i => P(cx(i), cy(i))), n.kind);
        for (const n of nets) for (const i of n.manholes) { const [x, y] = P(cx(i), cy(i)); Sym.plan.manhole(c, x, y, NET[n.kind].mh ? n.kind : n.kind); }
        // разметка игрока: верно — цвет сети, рядом — кружок, мимо — красный крест; пропуски — красные штрихи
        ev.per.forEach((p, ni) => {
          const col = NET[p.kind].paint;
          for (let i = 0; i < N; i++) {
            if (!p.cls[i]) continue;
            const [x, y] = P(cx(i), cy(i)), r = 1.3;
            if (p.cls[i] === 1) { c.fillStyle = col; c.globalAlpha = 0.55; c.fillRect(x - r, y - r, 2 * r, 2 * r); c.globalAlpha = 1; }
            else if (p.cls[i] === 2) { c.strokeStyle = col; c.lineWidth = 0.5; c.strokeRect(x - r, y - r, 2 * r, 2 * r); }
            else { c.strokeStyle = '#e0281c'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r); c.stroke(); }
          }
          c.fillStyle = '#e0281c';
          for (const i of p.missed) { const [x, y] = P(cx(i), cy(i)); c.beginPath(); c.arc(x, y, 0.8, 0, 7); c.fill(); }
        });
        c.restore();
        c.strokeStyle = INK; c.lineWidth = 0.5; c.strokeRect(mx, my, GW * k, GH * k);
        // экспликация
        let ty = my + GH * k + 12;
        const fs = Math.max(6, Math.min(8, w / 40)), rowH = Math.max(10, Math.min(15, (h - ty - 8) / (NN + 1.4)));
        Sym.plan.label(c, m + 2, ty, 'Экспликация сетей', fs + 0.5, INK, 0, 700, 'left');
        Sym.plan.label(c, w - m - 2, ty, 'длина · совпадение', fs - 0.5, INK, 0, 500, 'right');
        ty += rowH * 0.95;
        ev.per.forEach(p => {
          const col = NET[p.kind].paint;
          c.strokeStyle = Sym.colors.util[p.kind] || col; c.lineWidth = 1.4; c.beginPath(); c.moveTo(m + 2, ty); c.lineTo(m + 16, ty); c.stroke();
          Sym.plan.label(c, m + 9, ty - 0.3, NET[p.kind].l, fs, Sym.colors.util[p.kind], 0, 700);
          Sym.plan.label(c, m + 21, ty, NET[p.kind].full, fs, INK, 0, 600, 'left');
          const pc = Math.round(p.q * 100);
          Sym.plan.label(c, w - m - 2, ty, `${Math.round(p.len)} м · ${pc} %`, fs, pc >= 80 ? '#2f7a3a' : pc >= 50 ? '#9a6a10' : '#c0281c', 0, 700, 'right');
          ty += rowH;
        });
      }

      // ---------- рисование кадра ----------
      function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
      function drawPaint(c, l) {
        for (let pass = 0; pass < 2; pass++) for (let ni = 0; ni < NN; ni++) {
          const active = ni === sel;
          if ((pass === 1) !== active) continue;
          const mk = marks[ni], col = NET[nets[ni].kind].paint, off = (ni - (NN - 1) / 2) * (active ? 0 : 1.6);
          const segs = [], dots = [];
          for (let i = 0; i < N; i++) {
            if (!mk[i]) continue;
            let any = false;
            for (const d of [0, 1]) { const q = step(i, d); if (q >= 0 && mk[q]) { segs.push([i, q]); any = true; } }
            for (const d of [2, 3]) { const q = step(i, d); if (q >= 0 && mk[q]) any = true; }
            if (!any) dots.push(i);
          }
          c.save(); c.globalAlpha = active ? 1 : 0.6; c.lineCap = 'round';
          const path = () => { c.beginPath(); for (const [a, b] of segs) { c.moveTo(cx(a) + off, cy(a) + off); c.lineTo(cx(b) + off, cy(b) + off); } };
          path(); c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = active ? 5.2 : 4; c.setLineDash([7, 4]); c.stroke();
          path(); c.strokeStyle = col; c.lineWidth = active ? 3.2 : 2.4; c.stroke();
          c.setLineDash([]);
          for (const i of dots) { c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.arc(cx(i) + off, cy(i) + off, 4, 0, 7); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(cx(i) + off, cy(i) + off, 2.8, 0, 7); c.fill(); }
          c.restore();
        }
      }
      function drawReadings(c, l) {
        const now = api.now;
        // замеры других сетей — точки в углу клетки
        for (let ni = 0; ni < NN; ni++) {
          if (ni === sel) continue;
          const col = NET[nets[ni].kind].paint, m = meas[ni];
          c.fillStyle = col;
          for (let i = 0; i < N; i++) if (m[i] >= 0) { c.beginPath(); c.arc(cOf(i) * CS + 3 + ni * 3.2, rOf(i) * CS + 3, 1.5, 0, 7); c.fill(); }
        }
        const m = meas[sel], col = NET[nets[sel].kind].paint;
        c.font = 'bold 13px system-ui, sans-serif'; c.textAlign = 'center';
        for (let i = 0; i < N; i++) {
          const v = m[i]; if (v < 0) continue;
          const x = cx(i), y = cy(i);
          c.globalAlpha = 0.18 + v / 9 * 0.5; c.fillStyle = v ? col : '#555'; c.fillRect(cOf(i) * CS + 1, rOf(i) * CS + 1, CS - 2, CS - 2); c.globalAlpha = 1;
          roundRect(c, x - 8, y - 8, 16, 16, 4); c.fillStyle = v >= 9 ? col : 'rgba(20,16,12,.82)'; c.fill();
          c.strokeStyle = v ? col : '#888'; c.lineWidth = 1.2; c.stroke();
          c.fillStyle = v >= 9 ? '#1a120a' : '#fff'; c.fillText(String(v), x, y + 4.6);
        }
        // свежий замер — подсветка
        if (last && last.ni === sel && now - last.t < 0.9) {
          const a = 1 - (now - last.t) / 0.9; c.strokeStyle = col; c.globalAlpha = a; c.lineWidth = 2;
          c.strokeRect(cOf(last.cell) * CS + 1, rOf(last.cell) * CS + 1, CS - 2, CS - 2); c.globalAlpha = 1;
        }
      }
      function drawHints(c) { // колодцы и вводы выбранной сети — пульсирующие кольца
        const n = nets[sel], col = NET[n.kind].paint, ph = (Math.sin(api.now * 4) + 1) / 2;
        c.save(); c.strokeStyle = col; c.lineWidth = 1.4 + ph; c.globalAlpha = 0.55 + ph * 0.4;
        for (const i of n.manholes) { c.beginPath(); c.arc(cx(i), cy(i), 8 + ph * 2, 0, 7); c.stroke(); }
        for (const e of n.ends) {
          const x = cx(e.cell) - DX[e.dir] * CS / 2, y = cy(e.cell) - DY[e.dir] * CS / 2;
          c.beginPath(); c.arc(x, y, 6 + ph * 2, 0, 7); c.stroke();
          // стрелка «ввод перпендикулярно стене»
          c.beginPath(); c.moveTo(x + DX[e.dir] * 9, y + DY[e.dir] * 9); c.lineTo(x + DX[e.dir] * 16, y + DY[e.dir] * 16); c.stroke();
        }
        c.restore();
      }
      function drawHero(c) {
        const t = api.now, sc = 2.1;
        Sym.surveyorTop(c, hero.x, hero.y, hero.dir, hero.walk, { scale: sc, vest: '#ff7a1c' });
        // трассоискатель: штанга с катушкой впереди, приёмник в руке
        const ca = Math.cos(hero.dir), sa = Math.sin(hero.dir);
        const hx = hero.x + ca * 3.5 - sa * 2.4, hy = hero.y + sa * 3.5 + ca * 2.4;
        const ex = hero.x + ca * 14, ey = hero.y + sa * 14;
        c.save(); c.lineCap = 'round';
        c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(hx + 2, hy + 2); c.lineTo(ex + 3, ey + 3); c.stroke();
        c.strokeStyle = '#2d3135'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(hx, hy); c.lineTo(ex, ey); c.stroke();
        c.translate(ex, ey); c.rotate(hero.dir);
        c.fillStyle = '#f2c230'; c.beginPath(); c.ellipse(0, 0, 2.2, 4.2, 0, 0, 7); c.fill();
        c.strokeStyle = '#2d3135'; c.lineWidth = 0.8; c.stroke();
        c.rotate(-hero.dir); c.translate(-ex, -ey);
        c.fillStyle = '#f2c230'; c.fillRect(hx - 2.6, hy - 2, 5.2, 4); c.fillStyle = '#3a5a3a'; c.fillRect(hx - 1.8, hy - 1.3, 3.6, 2.4);
        // волны при замере
        const dt = t - hero.scan;
        if (dt >= 0 && dt < 0.8) {
          const col = NET[nets[sel].kind].paint;
          for (let k = 0; k < 3; k++) { const r = 3 + ((dt * 22 + k * 6) % 18); c.globalAlpha = Math.max(0, 1 - r / 21) * (1 - dt / 0.8); c.strokeStyle = col; c.lineWidth = 1.4; c.beginPath(); c.arc(ex, ey, r, 0, 7); c.stroke(); }
          c.globalAlpha = 1;
        }
        c.restore();
      }
      function drawIcon(c, id, x, y, col) {
        c.save(); c.translate(x, y); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2; c.lineCap = 'round';
        if (id === 'meas') { // трассоискатель
          c.beginPath(); c.moveTo(-7, 6); c.lineTo(5, -6); c.stroke();
          c.beginPath(); c.ellipse(-7, 6, 4, 2, -0.8, 0, 7); c.stroke();
          c.lineWidth = 1.3; c.beginPath(); c.arc(5, -6, 4, -2.2, -0.2); c.stroke(); c.beginPath(); c.arc(5, -6, 7, -2.2, -0.2); c.stroke();
        } else if (id === 'paint') { // баллончик
          c.fillRect(-4, -3, 8, 11); c.fillRect(-2, -6, 4, 3);
          c.lineWidth = 1.2; for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(4, -7 + k * 2); c.lineTo(8, -9 + k * 3); c.stroke(); }
        } else { // ластик
          c.rotate(-0.6); c.strokeRect(-7, -4, 14, 8); c.fillRect(-7, -4, 5, 8);
        }
        c.restore();
      }
      function drawBar(c, l) {
        c.fillStyle = 'rgba(20,14,10,.72)'; c.fillRect(0, BAR_Y - 3, l.W, 360 - BAR_Y + 3);
        // сети
        nets.forEach((n, k) => {
          const b = l.netB[k], col = NET[n.kind].paint, a = k === sel;
          roundRect(c, b.x, b.y, b.w, b.h, 8); c.fillStyle = a ? 'rgba(255,255,255,.16)' : 'rgba(30,22,16,.85)'; c.fill();
          c.lineWidth = a ? 3 : 1.5; c.strokeStyle = a ? col : 'rgba(255,255,255,.22)'; c.stroke();
          c.fillStyle = col; c.beginPath(); c.arc(b.x + b.w / 2, b.y + 15, 10, 0, 7); c.fill();
          api.text(c, NET[n.kind].l, b.x + b.w / 2, b.y + 20, 14, '#1a120a');
          api.text(c, NET[n.kind].name, b.x + b.w / 2, b.y + 36, 8.5, a ? '#fff' : api.theme.dim, 'center', '600');
          let cnt = 0; for (let i = 0; i < N; i++) cnt += marks[k][i];
          if (cnt) { c.fillStyle = col; c.beginPath(); c.arc(b.x + b.w - 5, b.y + 5, 3, 0, 7); c.fill(); }
        });
        // инструменты
        const names = { meas: 'Замер', paint: 'Краска', erase: 'Ластик' };
        for (const b of l.toolB) {
          const a = tool === b.id;
          roundRect(c, b.x, b.y, b.w, b.h, 8); c.fillStyle = a ? api.theme.accent : 'rgba(30,22,16,.85)'; c.fill();
          c.lineWidth = 1.5; c.strokeStyle = a ? '#fff' : 'rgba(255,176,46,.6)'; c.stroke();
          drawIcon(c, b.id, b.x + b.w / 2, b.y + 15, a ? '#1a120a' : api.theme.ink);
          api.text(c, names[b.id], b.x + b.w / 2, b.y + 36, 8.5, a ? '#1a120a' : api.theme.dim, 'center', '700');
        }
        // заряд
        const bb = l.batB, f = battery / BAT, bc = f > 0.4 ? api.theme.good : f > 0.15 ? api.theme.accent : api.theme.bad;
        roundRect(c, bb.x, bb.y, bb.w, bb.h, 8); c.fillStyle = 'rgba(30,22,16,.85)'; c.fill(); c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = 1.5; c.stroke();
        c.strokeStyle = bc; c.lineWidth = 1.5; c.strokeRect(bb.x + 9, bb.y + 7, 28, 12); c.fillStyle = bc; c.fillRect(bb.x + 37, bb.y + 10, 3, 6);
        c.fillRect(bb.x + 11, bb.y + 9, 24 * f, 8);
        api.text(c, battery + '/' + BAT, bb.x + bb.w / 2, bb.y + 34, 11, bc);
        // сдать
        const sb = l.subB, conf = api.now - confirmAt < 2.5;
        api.button(c, sb, conf ? 'Точно?' : 'СДАТЬ', { active: conf, color: conf ? api.theme.good : '#6cd27a', size: 14 });
      }
      function drawSide(c, l) { // широкий экран: экран прибора слева, легенда справа
        const pw = Math.min(150, l.ox - 14), px = (l.ox - pw) / 2, py = l.oy + 8;
        roundRect(c, px, py, pw, 150, 12); c.fillStyle = '#e3b62c'; c.fill(); c.strokeStyle = '#6a5010'; c.lineWidth = 2; c.stroke();
        roundRect(c, px + 8, py + 8, pw - 16, 94, 6); c.fillStyle = '#1d2a1e'; c.fill();
        const n = nets[sel], col = NET[n.kind].paint, lv = last && last.ni === sel ? last.v : null;
        api.text(c, 'Сеть ' + NET[n.kind].l + ' · ' + NET[n.kind].full, px + pw / 2, py + 22, 9.5, '#9fe0a0', 'center', '700');
        api.text(c, lv == null ? '–' : String(lv), px + pw / 2, py + 66, 38, lv == null ? '#557055' : lv >= 9 ? col : '#c8f5c0');
        for (let k = 0; k < 9; k++) { c.fillStyle = lv != null && k < lv ? col : 'rgba(160,220,160,.15)'; c.fillRect(px + 14 + k * (pw - 28) / 9, py + 82, (pw - 28) / 9 - 2, 12); }
        api.text(c, 'ТРАССОИСКАТЕЛЬ', px + pw / 2, py + 118, 9, '#3a2c08');
        api.text(c, 'заряд ' + battery + ' · ' + fmtTime(time), px + pw / 2, py + 136, 10, '#3a2c08', 'center', '700');
        // легенда
        const rx = l.ox + GW * l.s + (l.W - l.ox - GW * l.s - pw) / 2;
        roundRect(c, rx, py, pw, 28 + NN * 22, 10); c.fillStyle = 'rgba(20,14,10,.8)'; c.fill();
        api.text(c, 'Сети участка', rx + pw / 2, py + 18, 11, api.theme.accent);
        nets.forEach((nn, k) => {
          const y = py + 38 + k * 22, cl = NET[nn.kind].paint; let cnt = 0; for (let i = 0; i < N; i++) cnt += marks[k][i];
          c.fillStyle = cl; c.beginPath(); c.arc(rx + 16, y - 4, 7, 0, 7); c.fill();
          api.text(c, NET[nn.kind].l, rx + 16, y, 9, '#1a120a');
          api.text(c, NET[nn.kind].full, rx + 28, y, 9.5, k === sel ? '#fff' : api.theme.dim, 'left', '600');
          api.text(c, cnt ? cnt + ' кл.' : '', rx + pw - 8, y, 9, cl, 'right');
        });
      }

      // ---------- бот: трассирует по сигналу, размечает, сдаёт ----------
      let botIt = null, botWait = 0;
      const tapAt = (x, y) => { this_.pointerDown({ x, y, id: 1, button: 0 }); this_.pointerUp({ x, y, id: 1, button: 0 }); };
      const center = b => [b.x + b.w / 2, b.y + b.h / 2];
      function* wait(t) { botWait = t; yield; }
      function* tapBtn(b) { tapAt(...center(b)); yield* wait(0.25); }
      function* probe(ni, i) {
        if (meas[ni][i] >= 0) return meas[ni][i];
        if (battery <= 0 && !nodeOf[ni].has(i)) return -1;
        const p = scr(i); tapAt(p.x, p.y); yield* wait(0.55);
        return meas[ni][i];
      }
      function walk(i, d, nodes) { // клетки от i в направлении d до узла / края / здания
        const run = []; let q = step(i, d);
        while (q >= 0 && !g.blk[q]) { if (nodes.has(q)) return { run, end: q, kind: 'node' }; run.push(q); q = step(q, d); }
        return { run, end: -1, kind: q < 0 ? 'edge' : 'wall' };
      }
      function* botMh(ni, segs) {
        const n = nets[ni], nodes = nodeOf[ni], done = new Set();
        for (const e of n.ends) { // ввод: прямо от стены до первого колодца
          const w = walk(e.cell, e.dir, nodes);
          if (w.kind === 'node') { segs.push([e.cell, ...w.run, w.end]); done.add(e.cell + ':' + e.dir); done.add(w.end + ':' + OPP(e.dir)); }
        }
        for (const X of n.manholes) for (let d = 0; d < 4; d++) {
          if (done.has(X + ':' + d)) continue;
          done.add(X + ':' + d);
          const w = walk(X, d, nodes);
          if (w.kind === 'wall') continue;
          if (w.kind === 'node') { done.add(w.end + ':' + OPP(d)); if (!w.run.length) continue; }
          if (!w.run.length) continue;
          const known = w.run.find(i => meas[ni][i] >= 0);
          const pi = known != null ? known : w.kind === 'node' ? w.run[w.run.length >> 1] : w.run[0];
          const v = yield* probe(ni, pi);
          if (v === 9) segs.push([X, ...w.run, ...(w.kind === 'node' ? [w.end] : [])]);
        }
      }
      function* botFree(ni, segs) {
        const n = nets[ni], nodes = nodeOf[ni], traced = new Set();
        const ends = n.ends.filter(e => !e.outlet).concat(n.ends.filter(e => e.outlet));
        const target = (from) => { // ближайшая известная точка трассы (для выбора стороны поворота)
          let best = null, bd = 1e9;
          for (const t of [...traced, ...n.ends.map(e => e.cell), ...n.manholes]) { if (t === from) continue; const d = Math.abs(cOf(t) - cOf(from)) + Math.abs(rOf(t) - rOf(from)); if (d < bd) { bd = d; best = t; } }
          return best;
        };
        const ok = q => q >= 0 && !g.blk[q];
        for (const E of ends) {
          if (traced.has(E.cell)) continue;
          const path = [E.cell], own = new Set(path); let cur = E.cell, d = E.dir, guard = 0;
          const isJoin = q => q !== E.cell && !own.has(q) && (traced.has(q) || nodes.has(q));
          while (guard++ < 50 && battery >= 0) {
            const a = step(cur, d);
            if (ok(a) && isJoin(a)) { path.push(a); break; }
            let turnAt = -1;
            if (!ok(a)) turnAt = cur;
            else {
              const b = step(a, d);
              if (ok(b) && isJoin(b)) { const va = yield* probe(ni, a); if (va === 9) { path.push(a, b); break; } turnAt = cur; }
              else {
                let vb = -2;
                if (ok(b)) vb = yield* probe(ni, b);
                if (vb === -1) break;
                if (vb === 9) { path.push(a, b); own.add(a); own.add(b); cur = b; continue; }
                const va = yield* probe(ni, a);
                if (va === -1) break;
                if (va === 9) { path.push(a); own.add(a); cur = a; turnAt = a; } else turnAt = cur;
              }
            }
            // поворот в клетке turnAt: пробуем сторону к ближайшей известной точке трассы
            const tgt = target(turnAt), sides = [(d + 3) & 3, (d + 1) & 3].filter(s => ok(step(turnAt, s)));
            if (!sides.length) break;
            if (tgt != null) sides.sort((s1, s2) => {
              const q1 = step(turnAt, s1), q2 = step(turnAt, s2);
              return (Math.abs(cOf(tgt) - cOf(q1)) + Math.abs(rOf(tgt) - rOf(q1))) - (Math.abs(cOf(tgt) - cOf(q2)) + Math.abs(rOf(tgt) - rOf(q2)));
            });
            const q1 = step(turnAt, sides[0]);
            if (isJoin(q1)) { path.push(q1); break; }
            const v1 = yield* probe(ni, q1);
            if (v1 === -1) break;
            if (v1 === 9 || sides.length === 1) { d = sides[0]; } else d = sides[1];
            cur = turnAt;
          }
          for (const q of path) traced.add(q);
          segs.push(path);
        }
      }
      function* botStroke(cells) {
        const pts = cells.map(i => scr(i));
        this_.pointerDown({ x: pts[0].x, y: pts[0].y, id: 1, button: 0 });
        for (let k = 1; k < pts.length; k++) this_.pointerMove({ x: pts[k].x, y: pts[k].y, id: 1, down: true });
        this_.pointerUp({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, id: 1 });
        yield* wait(0.45);
      }
      function* botMain() {
        yield* wait(0.8);
        const l = layout();
        for (let ni = 0; ni < NN; ni++) {
          yield* tapBtn(l.netB[ni]);
          yield* tapBtn(l.toolB[0]);
          const segs = [];
          if (NET[nets[ni].kind].mh) yield* botMh(ni, segs); else yield* botFree(ni, segs);
          yield* tapBtn(l.toolB[1]);
          for (const s of segs) if (s.length) yield* botStroke(s);
        }
        yield* wait(0.6);
        yield* tapBtn(l.subB);
        yield* tapBtn(l.subB);
        for (;;) yield* wait(1);
      }

      const this_ = {
        update(dt) {
          if (done) return;
          time -= dt;
          if (time <= 0) { time = 0; api.popup(api.W / 2, 180, 'Время вышло — сдаём, что есть', api.theme.bad); submit(); return; }
          // герой идёт к точке замера
          const dx = hero.tx - hero.x, dy = hero.ty - hero.y, d = Math.hypot(dx, dy);
          if (d > 0.5) { const v = Math.min(d, 320 * dt); hero.x += dx / d * v; hero.y += dy / d * v; hero.walk += dt; if (d > 4) hero.dir = Math.atan2(dy, dx); }
          else if (hero.ty !== hero.y || hero.tx !== hero.x) { hero.x = hero.tx; hero.y = hero.ty; }
          for (const w of walkers) { w.x += w.v * dt; if (w.x > GW + EXT + 40) w.x = -EXT - 40; if (w.x < -EXT - 40) w.x = GW + EXT + 40; }
          if (carMove) { carMove.x += carMove.v * dt; if (carMove.x > GW + EXT + 300) carMove.x = -EXT - 300; }
          for (let k = fx.length - 1; k >= 0; k--) if (api.now - fx[k].t > 1) fx.splice(k, 1);
        },
        draw(ctx) {
          const l = layout(), ly = ensureLayer();
          ctx.drawImage(ly.canvas, 0, FIELD_TOP - 1, ly.w, ly.h);
          ctx.save();
          ctx.beginPath(); ctx.rect(0, FIELD_TOP, l.W, BAR_Y - 3 - FIELD_TOP); ctx.clip();
          ctx.translate(l.ox, l.oy); ctx.scale(l.s, l.s);
          // живая сцена: прохожие, машина
          for (const w of walkers) {
            if (w.worker) Sym.surveyorTop(ctx, w.x, w.y, w.v > 0 ? 0 : Math.PI, api.now, { scale: 1.6, vest: '#e8d23a', helmet: '#f2c230' });
            else Sym.personTop(ctx, w.x, w.y, w.v > 0 ? 0 : Math.PI, api.now, w.seed);
            if (w.dog) Sym.dogTop(ctx, w.x + 9, w.y + 4, 0, api.now);
          }
          if (carMove) Sym.car(ctx, carMove.x, g.yRoad + 7, 0, '#c8a24a', carMove.seed);
          drawPaint(ctx, l);
          drawHints(ctx);
          drawReadings(ctx, l);
          for (const f of fx) if (f.kind === 'spray') {
            const a = 1 - (api.now - f.t); if (a <= 0) continue;
            ctx.globalAlpha = a * 0.6; ctx.fillStyle = f.col;
            for (let k = 0; k < 6; k++) { const an = k * 1.05 + f.t * 7, r = 3 + (1 - a) * 8; ctx.beginPath(); ctx.arc(cx(f.cell) + Math.cos(an) * r, cy(f.cell) + Math.sin(an) * r, 1.1, 0, 7); ctx.fill(); }
            ctx.globalAlpha = 1;
          }
          drawHero(ctx);
          ctx.restore();
          if (l.side) drawSide(ctx, l);
          drawBar(ctx, l);
        },
        pointerDown(p) {
          if (done) return;
          const l = layout();
          for (let k = 0; k < NN; k++) if (api.hit(l.netB[k], p)) { selectNet(k); return; }
          for (const b of l.toolB) if (api.hit(b, p)) { selectTool(b.id); return; }
          if (api.hit(l.subB, p)) {
            if (api.now - confirmAt < 2.5) submit();
            else { confirmAt = api.now; api.sfx('warn'); api.popup(l.subB.x + l.subB.w / 2, BAR_Y - 10, 'Тап ещё раз — сдать работу', api.theme.accent); }
            return;
          }
          if (p.y > BAR_Y - 3) return;
          const i = cellAt(p);
          if (i < 0) return;
          if (tool === 'meas') measure(i);
          else { stroke = { w: toWorld(p), last: i, erase: tool === 'erase' }; paintCell(i, stroke.erase); }
        },
        pointerMove(p) { if (stroke && p.down !== false) strokeTo(p); },
        pointerUp(p) { if (stroke) { strokeTo(p); stroke = null; } },
        key(code, down) {
          if (!down || done) return;
          const m = /^Digit([1-6])$/.exec(code);
          if (m) selectNet(+m[1] - 1);
          if (code === 'KeyQ') selectTool('meas');
          if (code === 'KeyW') selectTool('paint');
          if (code === 'KeyE') selectTool('erase');
          if (code === 'Enter') this_.pointerDown({ x: layout().subB.x + 5, y: layout().subB.y + 5 });
        },
        hud() {
          return { time, info: ['Заряд: ' + battery + '/' + BAT, 'Сеть: ' + NET[nets[sel].kind].full], progress: battery / BAT };
        },
        bot(dt) {
          if (done) return;
          if (!botIt) botIt = botMain();
          botWait -= dt;
          if (botWait <= 0) botIt.next();
        },
      };
      return this_;
    },
  });
})();
