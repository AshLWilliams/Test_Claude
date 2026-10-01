'use strict';
// «Невязка» — замкнутый теодолитный ход вокруг участка съёмки: рекогносцировка станций (видимость, длины сторон),
// измерение горизонтальных углов наведением трубы на марки, угловая и линейная невязки, уравнивание. Устройство — в MODES.md.
(() => {
  const WH = 330;                    // высота мира, ед. (поле под HUD)
  const DMIN = 60, DMAX = 230;       // допустимая длина стороны хода, ед.
  const MU = 0.25;                   // метров в единице
  const LIMIT = 140;                 // время уровня, с
  const TREF = 120;                  // к этому сроку бонус за время сходит на нет
  const KSEC = 2.2;                  // секунд дуги на единицу смещения марки от нити в окуляре
  const RHO = 206265;                // секунд в радиане
  const TAU = Math.PI * 2;
  const SNAP = 16;                   // тап ближе — замыкание на исходный пункт
  const ADJ_END = 5.2;               // длительность анимации уравнивания, с
  const INK = '#2a251d';
  const NAMES = ['Заречный', 'Берёзовый', 'Сосновка', 'Дубки', 'Северный', 'Луговой', 'Озёрный', 'Кедровый', 'Ключи', 'Майский', 'Рябиновый', 'Горка', 'Солнечный', 'Липки'];
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  const sub = n => String(n).split('').map(c => SUB[+c]).join('');

  // ---------- форматирование ----------
  const fmtM = u => (u * MU).toFixed(1).replace('.', ',');           // ед. → «42,5» (м)
  const fmtMm = m => (m < 0 ? '−' : '+') + Math.abs(m).toFixed(3).replace('.', ',');
  function secStr(a) { a = Math.round(Math.abs(a)); return a >= 60 ? Math.floor(a / 60) + '′' + String(a % 60).padStart(2, '0') + '″' : a + '″'; }
  const fmtSec = s => (Math.round(s) < 0 ? '−' : '+') + secStr(s);
  const fmtTol = s => '±' + secStr(s);
  function fmtDMS(rad, sum) { // радианы → «91°45′37″»; sum — сумма углов, без приведения к 360°
    let s = sum ? Math.round(rad * 180 / Math.PI * 3600) : Math.round((((rad * 180 / Math.PI) % 360) + 360) % 360 * 3600) % (360 * 3600);
    const d = Math.floor(s / 3600); s -= d * 3600; const m = Math.floor(s / 60); s -= m * 60;
    return d + '°' + String(m).padStart(2, '0') + '′' + String(s).padStart(2, '0') + '″';
  }
  const fmtTime = t => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

  // ---------- геометрия ----------
  const hyp = Math.hypot, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angN = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }; // к (−π, π]
  const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
  function segSeg(ax, ay, bx, by, cx, cy, dx, dy) {
    const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }
  function segRect(ax, ay, bx, by, x, y, w, h) {
    const ins = (px, py) => px >= x && px <= x + w && py >= y && py <= y + h;
    if (ins(ax, ay) || ins(bx, by)) return true;
    return segSeg(ax, ay, bx, by, x, y, x + w, y) || segSeg(ax, ay, bx, by, x + w, y, x + w, y + h) ||
      segSeg(ax, ay, bx, by, x + w, y + h, x, y + h) || segSeg(ax, ay, bx, by, x, y + h, x, y);
  }
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return hyp(px - ax - dx * t, py - ay - dy * t);
  }
  function distPoly(px, py, p, closed) {
    let m = Infinity;
    for (let i = 0; i < p.length - (closed ? 0 : 1); i++) { const a = p[i], b = p[(i + 1) % p.length]; m = Math.min(m, distSeg(px, py, a.x, a.y, b.x, b.y)); }
    return m;
  }
  function inPoly(x, y, p) {
    let ins = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) ins = !ins; }
    return ins;
  }
  function segPoly(a, b, p) { // отрезок задевает многоугольник
    for (let i = 0; i < p.length; i++) { const c = p[i], d = p[(i + 1) % p.length]; if (segSeg(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) return true; }
    return inPoly((a.x + b.x) / 2, (a.y + b.y) / 2, p);
  }
  function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; } return s / 2; }
  function centroid(p) {
    let a = 0, x = 0, y = 0;
    for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length], c = q.x * r.y - r.x * q.y; a += c; x += (q.x + r.x) * c; y += (q.y + r.y) * c; }
    return { x: x / (3 * a), y: y / (3 * a) };
  }
  function rayPoly(c, ang, p) { // расстояние от c по лучу до границы многоугольника
    const ux = Math.cos(ang), uy = Math.sin(ang); let best = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], ex = b.x - a.x, ey = b.y - a.y, d = ux * ey - uy * ex;
      if (Math.abs(d) < 1e-9) continue;
      const t = ((a.x - c.x) * ey - (a.y - c.y) * ex) / d, u = ((a.x - c.x) * uy - (a.y - c.y) * ux) / d;
      if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
    return best === Infinity ? 0 : best;
  }
  const perim = (p, closed) => { let s = 0; for (let i = 0; i + 1 < p.length; i++) s += hyp(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y); if (closed && p.length > 2) s += hyp(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y); return s; };

  // ---------- мир: препятствия видимости и места, где нельзя ставить штатив ----------
  function rr(R) {
    const rf = (a, b) => a + R() * (b - a);
    return { rf, ri: (a, b) => Math.floor(rf(a, b + 1)), pick: a => a[Math.floor(R() * a.length)], chance: p => R() < p, sd: () => Math.floor(R() * 2147483646) + 1 };
  }
  function world(ww, kind) { return { ww, kind, obst: [], noStand: [], base: [], top: [], pf: [], region: null, rc: null, ggs: null, lanes: [], boxes: [], walks: [], cands: null }; }
  const bbx = (o, x0, y0, x1, y1) => Object.assign(o, { bx0: x0, by0: y0, bx1: x1, by1: y1 });
  function addRect(wd, x, y, w, h, why, no, m = 1.5) {
    const o = bbx({ t: 'r', x, y, w, h, why, no }, x, y, x + w, y + h);
    if (why) wd.obst.push(o);
    if (no) wd.noStand.push(bbx({ t: 'r', x: x - m, y: y - m, w: w + 2 * m, h: h + 2 * m, no, why }, x - m, y - m, x + w + m, y + h + m));
    return o;
  }
  function addCirc(wd, x, y, rv, rs, why, no) {
    if (rv > 0) wd.obst.push(bbx({ t: 'c', x, y, r: rv, why, no }, x - rv, y - rv, x + rv, y + rv));
    if (rs > 0) wd.noStand.push(bbx({ t: 'c', x, y, r: rs, why, no }, x - rs, y - rs, x + rs, y + rs));
  }
  function ptsBox(pts, m) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); } return [x0 - m, y0 - m, x1 + m, y1 + m]; }
  function addLine(wd, pts, why) { const b = ptsBox(pts, 0.5); wd.obst.push(bbx({ t: 'l', pts, why }, b[0], b[1], b[2], b[3])); }
  function addPoly(wd, pts, no) { const b = ptsBox(pts, 0); wd.noStand.push(bbx({ t: 'p', pts, no }, b[0], b[1], b[2], b[3])); }
  function addBand(wd, pts, w, no) { const b = ptsBox(pts, w); wd.noStand.push(bbx({ t: 'b', pts, w, no }, b[0], b[1], b[2], b[3])); }

  function standHit(wd, x, y, pad) {
    for (const o of wd.noStand) {
      if (x < o.bx0 - pad || x > o.bx1 + pad || y < o.by0 - pad || y > o.by1 + pad) continue;
      if (o.t === 'r' || (o.t === 'c' && hyp(x - o.x, y - o.y) < o.r + pad) || (o.t === 'p' && inPoly(x, y, o.pts)) || (o.t === 'b' && distPoly(x, y, o.pts, false) < o.w + pad)) return o;
    }
    return null;
  }
  function losHit(wd, ax, ay, bx, by, pad) {
    const x0 = Math.min(ax, bx) - pad, x1 = Math.max(ax, bx) + pad, y0 = Math.min(ay, by) - pad, y1 = Math.max(ay, by) + pad;
    for (const o of wd.obst) {
      if (o.bx1 < x0 || o.bx0 > x1 || o.by1 < y0 || o.by0 > y1) continue;
      if (o.t === 'r') { if (segRect(ax, ay, bx, by, o.x - pad, o.y - pad, o.w + 2 * pad, o.h + 2 * pad)) return o; }
      else if (o.t === 'c') { if (distSeg(o.x, o.y, ax, ay, bx, by) < o.r + pad) return o; }
      else for (let i = 0; i + 1 < o.pts.length; i++) { const p = o.pts[i], q = o.pts[i + 1]; if (segSeg(ax, ay, bx, by, p.x, p.y, q.x, q.y)) return o; }
    }
    return null;
  }
  const fail = (r, why, hit) => { r.why = why; r.hit = hit || null; return r; };
  // можно ли поставить следующую станцию p после последней станции хода S; closing — замыкание на исходный пункт
  function check(wd, S, p, closing, pad) {
    const a = S[S.length - 1], len = hyp(p.x - a.x, p.y - a.y), r = { ok: false, len, why: '', hit: null };
    if (!closing) {
      if (p.x < 8 || p.x > wd.ww - 8 || p.y < 6 || p.y > WH - 6) return fail(r, 'За краем планшета');
      if (inPoly(p.x, p.y, wd.region) || distPoly(p.x, p.y, wd.region, true) < 4) return fail(r, 'Внутри участка нельзя — ход его обходит', 'region');
      const o = standHit(wd, p.x, p.y, pad); if (o) return fail(r, o.no, o);
      for (let i = 0; i < S.length; i++) if (hyp(p.x - S[i].x, p.y - S[i].y) < 22) return fail(r, i ? `Слишком близко к станции ${i}` : 'Слишком близко к исходному пункту');
    }
    if (len < DMIN + pad * 3) return fail(r, `Сторона ${fmtM(len)} м — короче ${fmtM(DMIN)} м`);
    if (len > DMAX - pad * 3) return fail(r, `Сторона ${fmtM(len)} м — длиннее ${fmtM(DMAX)} м`);
    if (segPoly(a, p, wd.region)) return fail(r, 'Сторона пересекает участок — его обходят кругом', 'region');
    const o = losHit(wd, a.x, a.y, p.x, p.y, pad); if (o) return fail(r, 'Нет видимости: ' + o.why, o);
    for (let i = closing ? 1 : 0; i < S.length - 2; i++) {
      if (segSeg(a.x, a.y, p.x, p.y, S[i].x, S[i].y, S[i + 1].x, S[i + 1].y)) { r.side = i; return fail(r, 'Стороны хода не должны пересекаться'); }
    }
    if (closing && !inPoly(wd.rc.x, wd.rc.y, S)) return fail(r, 'Ход не охватывает участок — обойдите его кругом');
    r.ok = true; return r;
  }

  // ---------- планировщик хода (для бота и эталона): жадный обход по углу вокруг участка с возвратом ----------
  function makeCands(wd, ex) {
    const out = [], st = 11;
    for (let y = 10, row = 0; y <= WH - 8; y += st, row++) for (let x0 = 10; x0 <= wd.ww - 10; x0 += st) {
      const x = x0 + (row % 2) * st / 2;
      if (x > wd.ww - 10 || inPoly(x, y, wd.region) || (ex && x > ex.x - 8 && x < ex.x + ex.w + 8 && y > ex.y - 8 && y < ex.y + ex.h + 8)) continue;
      const rd = distPoly(x, y, wd.region, true);
      if (rd < 7 || standHit(wd, x, y, 1.5)) continue;
      out.push({ x, y, th: Math.atan2(y - wd.rc.y, x - wd.rc.x), rd });
    }
    return out;
  }
  const CFGS = [{ kl: 0, kr: 0.15 }, { kl: 0.25, kr: 0.45 }, { kl: 0.5, kr: 1.0 }];
  function plan(wd, start, dir, cfg) {
    const g = wd.ggs, c0 = wd.rc, C = wd.cands, path = start.slice();
    const th = q => Math.atan2(q.y - c0.y, q.x - c0.x);
    let S = 0; for (let i = 0; i + 1 < path.length; i++) S += dir * angN(th(path[i + 1]) - th(path[i]));
    let budget = 2600;
    const rec = (S) => {
      const cur = path[path.length - 1], tc = th(cur);
      if (path.length >= 3) {
        const d = dir * angN(th(g) - tc);
        if (Math.abs(S + d - TAU) < 0.3 && check(wd, path, g, true, 0.8).ok) { path.push(g); return true; }
      }
      if (path.length > 15 || budget <= 0) return false;
      const list = [];
      for (const c of C) {
        const L = hyp(c.x - cur.x, c.y - cur.y); if (L < DMIN + 4 || L > DMAX - 4) continue;
        const d = dir * angN(c.th - tc); if (d < 0.06 || S + d > TAU - 0.06) continue;
        list.push({ c, d, s: d - cfg.kl * L / 100 - cfg.kr * c.rd / 100 });
      }
      list.sort((a, b) => b.s - a.s);
      let tried = 0;
      for (const it of list) {
        if (--budget <= 0) return false;
        if (!check(wd, path, it.c, false, 0.8).ok) continue;
        path.push(it.c);
        if (rec(S + it.d)) return true;
        path.pop();
        if (++tried >= 3) break;
      }
      return false;
    };
    return rec(S) ? path : null;
  }
  function bestPlan(wd, start) {
    let best = null;
    for (const dir of [1, -1]) for (const cfg of CFGS) {
      const p = plan(wd, start || [wd.ggs], dir, cfg);
      if (p && (!best || p.length < best.length || (p.length === best.length && perim(p) < perim(best)))) best = p;
    }
    return best;
  }

  // ---------- генератор: городской квартал ----------
  function genBlock(R, ww, relax) {
    const wd = world(ww, 'block');
    const { rf, ri, pick, chance, sd } = rr(R);
    const G = [], RD = [], OBJ = [], TOPL = [];
    const SWK = 8;                                                     // ширина тротуара
    const swT = pick([22, 24, 26]), swB = pick([20, 22, 24]), swL = pick([20, 22, 24]), swR = pick([20, 22, 24, 26]);
    const yT = ri(58, 74), yB = WH - ri(54, 68);
    const bw = ri(250, Math.min(350, ww - 220)), xL = Math.round(clamp((ww - bw) / 2 + rf(-50, 50), 105, ww - bw - 105)), xR = xL + bw;
    const ends = { tl: -40, tr: ww + 40, bl: -40, br: ww + 40, lt: -40, lb: WH + 40, rt: -40, rb: WH + 40 };
    if (chance(0.45)) { const k = pick(Object.keys(ends)); ends[k] = { tl: xL, tr: xR, bl: xL, br: xR, lt: yT, lb: yB, rt: yT, rb: yB }[k]; }
    // улицы: h — широтная; c — ось; a..b — протяжённость; w — ширина проезжей части; ta/tb — ширина поперечной улицы у Т-образного конца
    const streets = [
      { h: 1, c: yT, a: ends.tl, b: ends.tr, w: swT, ta: swL, tb: swR },
      { h: 1, c: yB, a: ends.bl, b: ends.br, w: swB, ta: swL, tb: swR },
      { h: 0, c: xL, a: ends.lt, b: ends.lb, w: swL, ta: swT, tb: swB },
      { h: 0, c: xR, a: ends.rt, b: ends.rb, w: swR, ta: swT, tb: swB },
    ];
    for (const s of streets) {
      const max = s.h ? ww : WH;
      s.full = s.a < 0 && s.b > max;
      s.sa = s.a >= 0 ? s.a + s.ta / 2 : s.a; s.sb = s.b <= max ? s.b - s.tb / 2 : s.b;
    }
    const P = (s, along, off) => s.h ? { x: along, y: s.c + off } : { x: s.c + off, y: along };
    // исходный пункт — на тротуаре у края планшета
    const gOpts = [];
    for (const s of streets) {
      const max = s.h ? ww : WH, off = (s.w / 2 + SWK / 2) * pick([-1, 1]);
      if (s.a < 0) gOpts.push(P(s, rf(16, 26), relax > 4 ? 0 : off));
      if (s.b > max) gOpts.push(P(s, max - rf(16, 26), relax > 4 ? 0 : off));
    }
    // ближе к кварталу — короче «хвост» хода от пункта
    const bd = q => Math.max(xL - q.x, q.x - xR, 0) + Math.max(yT - q.y, q.y - yB, 0);
    gOpts.sort((a, b) => bd(a) - bd(b));
    const g = wd.ggs = Object.assign(gOpts[Math.floor(R() * Math.min(3, gOpts.length))], { name: pick(NAMES) });
    const nearG = (x, y, r) => hyp(x - g.x, y - g.y) < r;
    // земля
    G.push(c => Sym.ground(c, 0, 0, ww, WH, 'lawn', 11));
    // тротуары и проезжие части
    const roadList = [];
    for (const s of streets) {
      for (const sg of [-1, 1]) { const o = sg * (s.w / 2 + SWK / 2); RD.push(c => Sym.road(c, [P(s, s.sa, o), P(s, s.sb, o)], SWK, 'path', { seed: 5 })); }
      roadList.push({ pts: [P(s, s.a, 0), P(s, s.b, 0)], width: s.w, kind: 'asphalt', seed: sd() });
      wd.pf.push({ t: 'road', pts: [P(s, s.a, 0), P(s, s.b, 0)], w: s.w + 2 * SWK });
    }
    RD.push(c => Sym.roads(c, roadList));
    // перекрёстки: зебры и люки
    const H = streets.filter(s => s.h), V = streets.filter(s => !s.h);
    for (const h of H) for (const v of V) {
      if (v.c < h.a - 1 || v.c > h.b + 1 || h.c < v.a - 1 || h.c > v.b + 1) continue;
      wd.boxes.push({ x0: v.c - v.w / 2, x1: v.c + v.w / 2, y0: h.c - h.w / 2, y1: h.c + h.w / 2 });
      const zb = [];
      for (const sg of [-1, 1]) {
        const zx = v.c + sg * (v.w / 2 + SWK + 5); if (zx > h.a && zx < h.b) zb.push({ x: zx - 3.5, y: h.c - h.w / 2 + 1.5, w: 7, h: h.w - 3, along: 0 });
        const zy = h.c + sg * (h.w / 2 + SWK + 5); if (zy > v.a && zy < v.b) zb.push({ x: v.c - v.w / 2 + 1.5, y: zy - 3.5, w: v.w - 3, h: 7, along: 1 });
      }
      RD.push(c => { // пешеходные переходы
        c.fillStyle = 'rgba(244,244,236,.85)';
        for (const z of zb) {
          if (z.along) for (let x = z.x; x < z.x + z.w - 1; x += 3.4) c.fillRect(x, z.y, 1.8, z.h);
          else for (let y = z.y; y < z.y + z.h - 1; y += 3.4) c.fillRect(z.x, y, z.w, 1.8);
        }
      });
    }
    // люки, столбы освещения, гидранты вдоль улиц
    const MK = ['sewer', 'water', 'storm', 'tele', 'heat', 'gas'];
    for (const s of streets) {
      const len = s.b - s.a;
      for (let k = 0; k < len / 70; k++) { const a = rf(s.a + 10, s.b - 10), o = rf(-s.w * 0.3, s.w * 0.3), q = P(s, a, o), kind = pick(MK), rot = rf(0, 3); RD.push(c => Sym.manhole(c, q.x, q.y, kind, 1.8, rot)); }
      for (const sg of [-1, 1]) {
        const o = sg * (s.w / 2 + 1.6), step = rf(58, 76);
        for (let a = s.sa + rf(10, 30); a < s.sb - 6; a += step) {
          const q = P(s, a, o); if (nearG(q.x, q.y, 10)) continue;
          const rot = s.h ? (sg < 0 ? Math.PI / 2 : -Math.PI / 2) : (sg < 0 ? 0 : Math.PI);
          OBJ.push(c => Sym.pole(c, q.x, q.y, 'lamp', rot)); addCirc(wd, q.x, q.y, 0, 2.2, '', 'Здесь фонарный столб');
        }
        if (chance(0.5)) { const q = P(s, rf(s.sa + 20, s.sb - 20), sg * (s.w / 2 + SWK - 1.5)); if (!nearG(q.x, q.y, 12)) OBJ.push(c => Sym.hydrant(c, q.x, q.y)); }
        for (let k = 0; k < (s.sb - s.sa) / 120; k++) { const q = P(s, rf(s.sa, s.sb), sg * (s.w / 2 + SWK / 2)), kind = pick(['tele', 'heat', 'water']); RD.push(c => Sym.manhole(c, q.x, q.y, kind, 1.6)); }
      }
    }
    // клетки вокруг квартала (3×3, центр — сам квартал; Т-образный перекрёсток сливает две клетки)
    const X = [-60, xL - swL / 2 - SWK, xL + swL / 2 + SWK, xR - swR / 2 - SWK, xR + swR / 2 + SWK, ww + 60];
    const Y = [-60, yT - swT / 2 - SWK, yT + swT / 2 + SWK, yB - swB / 2 - SWK, yB + swB / 2 + SWK, WH + 60];
    const cells = {};
    for (const [i, j] of [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]) cells[i + ',' + j] = { x0: X[2 * i], x1: X[2 * i + 1], y0: Y[2 * j], y1: Y[2 * j + 1] };
    const MERGE = { tl: ['0,0', '0,1'], tr: ['2,0', '2,1'], bl: ['0,1', '0,2'], br: ['2,1', '2,2'], lt: ['0,0', '1,0'], rt: ['1,0', '2,0'], lb: ['0,2', '1,2'], rb: ['1,2', '2,2'] };
    for (const k in MERGE) {
      if (ends[k] === -40 || ends[k] === ww + 40 || ends[k] === WH + 40) continue;
      const [p, q] = MERGE[k], A = cells[p], B = cells[q];
      cells[p] = { x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1), y0: Math.min(A.y0, B.y0), y1: Math.max(A.y1, B.y1) }; delete cells[q];
    }
    const placed = [];                                                // занятые прямоугольники (без наложений)
    const free = (r, m = 3) => !placed.some(q => r.x < q.x + q.w + m && r.x + r.w + m > q.x && r.y < q.y + q.h + m && r.y + r.h + m > q.y) && !(g.x > r.x - 14 && g.x < r.x + r.w + 14 && g.y > r.y - 14 && g.y < r.y + r.h + 14);
    const take = r => { placed.push(r); return r; };
    const building = (r, floors) => { const s = sd(); take(r); OBJ.push(c => Sym.building(c, r.x, r.y, r.w, r.h, { floors, seed: s })); addRect(wd, r.x, r.y, r.w, r.h, 'мешает дом', 'В здании станцию не поставить'); wd.pf.push({ t: 'house', r, label: 'кж' + floors }); };
    const house = (r) => { const s = sd(), roof = pick(['gable', 'gable', 'hip']), chimney = chance(0.7); take(r); OBJ.push(c => Sym.house(c, r.x, r.y, r.w, r.h, { roof, chimney, seed: s })); addRect(wd, r.x, r.y, r.w, r.h, 'мешает дом', 'В доме станцию не поставить'); wd.pf.push({ t: 'house', r, label: 'ж' }); };
    const shed = (r) => { const s = sd(); take(r); OBJ.push(c => Sym.shed(c, r.x, r.y, r.w, r.h, { seed: s })); addRect(wd, r.x, r.y, r.w, r.h, 'мешает сарай', 'Здесь постройка'); wd.pf.push({ t: 'house', r, label: 'н' }); };
    const tree = (x, y, r, kind, top) => { if (nearG(x, y, 14 + r)) return; const s = sd(); (top ? TOPL : OBJ).push(c => Sym.tree(c, x, y, r, kind, s)); addCirc(wd, x, y, r * 0.7, r * 0.55, 'мешают деревья', 'Под кроной нет обзора'); wd.pf.push({ t: 'tree', x, y, kind }); };
    const car = (x, y, rot) => { const s = sd(); OBJ.push(c => Sym.car(c, x, y, rot, null, s)); const h = Math.abs(Math.cos(rot)) > 0.5; addRect(wd, x - (h ? 9 : 4), y - (h ? 4 : 9), h ? 18 : 8, h ? 8 : 18, '', 'Здесь стоит машина', 1); };
    const bush = (x, y, r) => { if (nearG(x, y, 12 + r) || !free({ x: x - r, y: y - r, w: 2 * r, h: 2 * r }, 0)) return; take({ x: x - r * 0.8, y: y - r * 0.8, w: r * 1.6, h: r * 1.6 }); const s = sd(); OBJ.push(c => Sym.bush(c, x, y, r, s)); addCirc(wd, x, y, 0, r + 1, '', 'В кустах штатив не поставить'); };
    const onMap = q => q.x > -8 && q.x < ww + 8 && q.y > -8 && q.y < WH + 8;
    const fence = (pts, kind) => { OBJ.push(c => Sym.fence(c, pts, kind)); addLine(wd, pts, 'мешает забор'); wd.pf.push({ t: 'fence', pts, kind }); };
    // сторона клетки к улице: координата вдоль (a) и вглубь от улицы (d) → мир
    const toW = (c, F, a, d) => F === 'b' ? { x: a, y: c.y1 - d } : F === 't' ? { x: a, y: c.y0 + d } : F === 'r' ? { x: c.x1 - d, y: a } : { x: c.x0 + d, y: a };
    const rectAD = (c, F, a0, a1, d0, d1) => { const p = toW(c, F, a0, d0), q = toW(c, F, a1, d1); return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) }; };
    const faces = c => ({ l: c.x0 > -50, r: c.x1 < ww + 50, t: c.y0 > -50, b: c.y1 < WH + 50 });
    const span = (c, F, fc) => F === 't' || F === 'b' ? [Math.max(c.x0 + (fc.l ? 12 : 4), -30), Math.min(c.x1 - (fc.r ? 12 : 4), ww + 30)] : [Math.max(c.y0 + (fc.t ? 12 : 4), -30), Math.min(c.y1 - (fc.b ? 12 : 4), WH + 30)];
    const depthOf = (c, F) => F === 't' || F === 'b' ? c.y1 - c.y0 : c.x1 - c.x0;
    const vis = c => ({ x0: Math.max(c.x0, -4), y0: Math.max(c.y0, -4), x1: Math.min(c.x1, ww + 4), y1: Math.min(c.y1, WH + 4) });
    // деревья на газоне вдоль улицы
    function streetTrees(c, F, fc, d) {
      const [a0, a1] = span(c, F, fc);
      for (let a = a0 + rf(4, 14); a < a1 - 4; a += rf(24, 36)) {
        if (chance(0.25 + relax * 0.08)) continue;
        const q = toW(c, F, a, d), r = rf(7, 10);
        if (!free({ x: q.x - r * 0.6, y: q.y - r * 0.6, w: r * 1.2, h: r * 1.2 }, 1)) continue;
        take({ x: q.x - r * 0.5, y: q.y - r * 0.5, w: r, h: r });
        tree(q.x, q.y, r, pick(['deciduous', 'deciduous', 'birch']), true);
      }
    }
    function fillFlats(c, F, fc) {
      const [a0, a1] = span(c, F, fc), sb = rf(15, 20), dep = Math.min(rf(32, 44), depthOf(c, F) - sb - 6);
      if (chance(0.7)) streetTrees(c, F, fc, 6.5);
      let a = a0 + rf(0, 10);
      while (a < a1 - 34) {
        const len = Math.min(rf(70, 150), a1 - a);
        if (len < 36) break;
        const r = rectAD(c, F, a, a + len, sb, sb + dep);
        if (free(r)) building(r, ri(3, 9));
        a += len + rf(18, 34);
      }
      // двор за домами: деревья, кусты, иногда площадка — глубже линии видимости вдоль улицы
      const yd0 = sb + dep + 20, yd1 = depthOf(c, F) - 8;
      if (yd1 - yd0 > 24) {
        if (chance(0.5) && yd1 - yd0 > 40) { const a = rf(a0 + 10, Math.max(a0 + 11, a1 - 60)), pr = rectAD(c, F, a, a + rf(40, 54), yd0 + 4, yd0 + 4 + rf(28, 34)); if (onMap({ x: pr.x + pr.w / 2, y: pr.y + pr.h / 2 }) && free(pr, 3)) { take(pr); const s = sd(); OBJ.push(cc => Sym.playground(cc, pr.x, pr.y, pr.w, pr.h, s)); } }
        const nY = Math.round((a1 - a0) * (yd1 - yd0) / 900);
        for (let k = 0; k < nY; k++) {
          const q = toW(c, F, rf(a0 + 6, a1 - 6), rf(yd0, yd1)), r = rf(7, 11);
          if (!onMap(q)) continue;
          if (chance(0.3)) { bush(q.x, q.y, rf(3.5, 5.5)); continue; }
          if (free({ x: q.x - r * 0.6, y: q.y - r * 0.6, w: r * 1.2, h: r * 1.2 }, 1)) { take({ x: q.x - r * 0.5, y: q.y - r * 0.5, w: r, h: r }); tree(q.x, q.y, r, pick(['deciduous', 'birch', 'conifer', 'deciduous']), false); }
        }
      }
      // машины у подъездов — вдоль дома со двора
      if (chance(0.7)) {
        const d = sb + dep + 9; if (d + 6 < depthOf(c, F)) for (let k = 0, a2 = a0 + rf(6, 30); k < 4 && a2 < a1 - 12; k++, a2 += rf(20, 30)) {
          const q = toW(c, F, a2, d); if (q.x < -10 || q.x > ww + 10 || q.y < -10 || q.y > WH + 10) continue;
          if (free({ x: q.x - 9, y: q.y - 9, w: 18, h: 18 }, 1)) { take({ x: q.x - 9, y: q.y - 5, w: 18, h: 10 }); car(q.x, q.y, F === 't' || F === 'b' ? 0 : Math.PI / 2); }
        }
      }
    }
    function fillHouses(c, F, fc) {
      const [a0, a1] = span(c, F, fc), front = 3, depth = Math.min(rf(70, 92), depthOf(c, F) - 6), kind = pick(['wood', 'wood', 'metal', 'chain']);
      let a = a0 + rf(0, 6);
      const rot = F === 't' || F === 'b' ? 0 : Math.PI / 2;
      while (a < a1 - 44) {
        const lw = Math.min(rf(58, 78), a1 - a); if (lw < 44) break;
        const gw = 12, ga = a + rf(8, lw - gw - 8);
        const e0 = toW(c, F, a, front), e1 = toW(c, F, ga, front), e2 = toW(c, F, ga + gw, front), e3 = toW(c, F, a + lw, front);
        const b0 = toW(c, F, a, front + depth), b3 = toW(c, F, a + lw, front + depth);
        fence([b0, e0, e1], kind); fence([e2, e3, b3], kind);
        const gc = toW(c, F, ga + gw / 2, front), open = rf(0, 0.6); OBJ.push(cc => Sym.gate(cc, gc.x, gc.y, gw, rot, open));
        if (depth < 200) fence([b0, b3], kind);
        const hw = rf(28, 36), hd = rf(24, 32), ha = a + rf(5, Math.max(6, lw - hw - 5));
        const hrr = rectAD(c, F, ha, ha + hw, front + 12, front + 12 + hd);
        if (free(hrr, 1)) house(hrr);
        if (depth > hd + 40 && chance(0.7)) { const sa = a + rf(5, lw - 20), sr = rectAD(c, F, sa, sa + rf(12, 16), front + hd + 22, front + hd + 32); if (free(sr, 1)) shed(sr); }
        for (let k = ri(1, 3); k > 0; k--) { const q = toW(c, F, a + rf(8, lw - 8), front + rf(hd + 18, depth - 6)), r = rf(6, 9); if (free({ x: q.x - r * 0.6, y: q.y - r * 0.6, w: r * 1.2, h: r * 1.2 }, 1)) { take({ x: q.x - r * 0.5, y: q.y - r * 0.5, w: r, h: r }); tree(q.x, q.y, r, pick(['apple', 'apple', 'deciduous']), false); } }
        if (chance(0.4)) { const gr = rectAD(c, F, a + rf(6, lw - 26), 0, front + depth - 18, front + depth - 8); gr.w = 18; if (free(gr, 1)) { take(gr); OBJ.push(cc => Sym.greenhouse(cc, gr.x, gr.y, gr.w, gr.h)); } }
        if (chance(0.5)) { const fr = toW(c, F, a + rf(6, lw - 16), front + 5); const s = sd(); if (free({ x: fr.x, y: fr.y, w: 10, h: 5 }, 1)) OBJ.push(cc => Sym.flowerbed(cc, fr.x, fr.y, 10, 5, s)); }
        a += lw;
      }
    }
    function fillPark(c, F, fc) {
      const v = vis(c), m = 4;
      const x0 = v.x0 + (fc.l ? m : 0), x1 = v.x1 - (fc.r ? m : 0), y0 = v.y0 + (fc.t ? m : 0), y1 = v.y1 - (fc.b ? m : 0);
      if (x1 - x0 < 20 || y1 - y0 < 20) return;
      G.push(cc => Sym.ground(cc, x0, y0, x1 - x0, y1 - y0, 'grass', 31));
      const path = [{ x: x0 - 6, y: rf(y0, y1) }, { x: (x0 + x1) / 2 + rf(-20, 20), y: (y0 + y1) / 2 + rf(-10, 10) }, { x: x1 + 6, y: rf(y0, y1) }];
      RD.push(cc => Sym.road(cc, path, 7, 'path', { seed: 3 }));
      if (chance(0.45) && x1 - x0 > 90 && y1 - y0 > 60) { // пруд вдали от дорожки
        for (let t = 0; t < 12; t++) {
          const px = rf(x0 + 30, x1 - 30), py = rf(y0 + 22, y1 - 22), ax = rf(16, 26), ay = rf(10, 15);
          if (distPoly(px, py, path, false) < ay + 10 || !onMap({ x: px, y: py }) || nearG(px, py, 50) || !free({ x: px - ax, y: py - ay, w: 2 * ax, h: 2 * ay }, 4)) continue;
          const pts = []; for (let i = 0; i < 12; i++) { const an = i * TAU / 12, f = rf(0.85, 1.12); pts.push({ x: px + Math.cos(an) * ax * f, y: py + Math.sin(an) * ay * f }); }
          take({ x: px - ax, y: py - ay, w: 2 * ax, h: 2 * ay }); const s = sd(); G.push(cc => Sym.pond(cc, pts, s)); addPoly(wd, pts, 'В пруду штатив не поставить'); wd.pf.push({ t: 'pond', pts });
          break;
        }
      }
      for (let i = 1; i < path.length; i++) { const p0 = path[i - 1], p1 = path[i], L = hyp(p1.x - p0.x, p1.y - p0.y); for (let u = 22; u < L - 10; u += 46) { const q = { x: p0.x + (p1.x - p0.x) * u / L - (p1.y - p0.y) / L * 6, y: p0.y + (p1.y - p0.y) * u / L + (p1.x - p0.x) / L * 6 }; if (onMap(q) && free({ x: q.x - 2, y: q.y - 2, w: 4, h: 4 }, 0)) { OBJ.push(cc => Sym.pole(cc, q.x, q.y, 'lamp')); addCirc(wd, q.x, q.y, 0, 2.2, '', 'Здесь фонарный столб'); } } }
      for (let k = ri(4, 8); k > 0; k--) { const x = rf(x0 + 6, x1 - 6), y = rf(y0 + 6, y1 - 6); if (distPoly(x, y, path, false) > 9) bush(x, y, rf(3.5, 6)); }
      const nt = Math.round((x1 - x0) * (y1 - y0) / Math.max(560, 800 + relax * 250));
      for (let k = 0; k < nt; k++) {
        const x = rf(x0 + 6, x1 - 6), y = rf(y0 + 6, y1 - 6), r = rf(8, 13);
        if (distPoly(x, y, path, false) < r * 0.8 + 4 || !free({ x: x - r * 0.6, y: y - r * 0.6, w: r * 1.2, h: r * 1.2 }, 0)) continue;
        take({ x: x - r * 0.5, y: y - r * 0.5, w: r, h: r }); tree(x, y, r, pick(['deciduous', 'birch', 'conifer', 'deciduous']), false);
      }
      for (let k = 0; k < 2; k++) { const q = path[1], d = k ? 9 : -9; OBJ.push(cc => Sym.bench(cc, q.x + d, q.y - 7, 0)); }
      const fx = path[1].x - 6, fy = path[1].y + 6, s = sd(); OBJ.push(cc => Sym.flowerbed(cc, fx, fy, 12, 8, s));
    }
    function fillParking(c, F, fc) {
      const v = vis(c), m = 9;
      const x0 = v.x0 + (fc.l ? m : 0), x1 = v.x1 - (fc.r ? m : 0), y0 = v.y0 + (fc.t ? m : 0), y1 = v.y1 - (fc.b ? m : 0);
      if (x1 - x0 < 30 || y1 - y0 < 26) return;
      G.push(cc => Sym.ground(cc, Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0), 'asphalt', 41));
      const hz = F === 't' || F === 'b';
      const rows = [];
      if (hz) { const ry = F === 'b' ? y1 - 12 : y0 + 12; rows.push(ry); if (y1 - y0 > 64) rows.push(F === 'b' ? y1 - 44 : y0 + 44); }
      else { const rx = F === 'r' ? x1 - 12 : x0 + 12; rows.push(rx); if (x1 - x0 > 64) rows.push(F === 'r' ? x1 - 44 : x0 + 44); }
      const lines = [];
      for (const rw of rows) {
        const lo = hz ? x0 + 4 : y0 + 4, hi = hz ? x1 - 4 : y1 - 4;
        for (let a = lo; a + 10 < hi; a += 11) {
          lines.push(hz ? [a, rw - 10, a, rw + 10] : [rw - 10, a, rw + 10, a]);
          if (chance(0.62)) { const q = hz ? { x: a + 5.5, y: rw } : { x: rw, y: a + 5.5 }; car(q.x, q.y, hz ? (chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (chance(0.5) ? 0 : Math.PI)); }
        }
      }
      RD.push(cc => { cc.strokeStyle = 'rgba(240,240,230,.7)'; cc.lineWidth = 0.6; cc.beginPath(); for (const l of lines) { cc.moveTo(l[0], l[1]); cc.lineTo(l[2], l[3]); } cc.stroke(); });
      const bx = hz ? (fc.l ? x0 + 4 : x1 - 16) : (F === 'r' ? x0 + 4 : x1 - 14), by = hz ? (F === 'b' ? y0 + 4 : y1 - 14) : (fc.t ? y0 + 4 : y1 - 14);
      const br = { x: bx, y: by, w: 11, h: 9 }; if (free(br, 1)) { take(br); const s = sd(); OBJ.push(cc => Sym.shed(cc, br.x, br.y, br.w, br.h, { material: 'metal', seed: s })); addRect(wd, br.x, br.y, br.w, br.h, 'мешает будка', 'Здесь будка охраны'); }
    }
    function fillGarages(c, F, fc) {
      const v = vis(c), m = 8;
      const x0 = v.x0 + (fc.l ? m : 0), x1 = v.x1 - (fc.r ? m : 0), y0 = v.y0 + (fc.t ? m : 0), y1 = v.y1 - (fc.b ? m : 0);
      if (x1 - x0 < 50 || y1 - y0 < 34) return;
      G.push(cc => Sym.ground(cc, Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0), 'gravel', 51));
      for (let y = (F === 'b' ? y1 - 40 : y0 + 6); y > y0 - 30 && y + 24 < y1 + 30; y += (F === 'b' ? -44 : 44)) {
        const n = Math.max(3, Math.min(10, Math.floor((x1 - x0 - 10) / 13))), gx = x0 + 5, r = { x: gx, y, w: n * 13, h: 24 };
        if (!free(r, 1)) break;
        take({ x: r.x, y: r.y, w: r.w, h: r.h + 7 }); const s = sd();
        OBJ.push(cc => Sym.garages(cc, gx, y, n, { apron: true, seed: s })); addRect(wd, r.x, r.y, r.w, r.h, 'мешают гаражи', 'Здесь гаражи');
        wd.pf.push({ t: 'house', r, label: 'н' });
        if (F !== 'b' && F !== 't') break;
      }
    }
    const order = Object.values(cells).sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
    const types = ['houses', 'flats', 'parking', 'park', 'garages', 'flats', 'houses', 'park'];
    for (let i = types.length - 1; i > 1; i--) { const j = 2 + Math.floor(R() * (i - 1)); [types[i], types[j]] = [types[j], types[i]]; }
    order.forEach((c, i) => {
      const fc = faces(c), v = vis(c);
      const sides = ['t', 'b', 'l', 'r'].filter(F => fc[F]).map(F => ({ F, len: F === 't' || F === 'b' ? v.x1 - v.x0 : v.y1 - v.y0 })).sort((a, b) => b.len - a.len);
      if (!sides.length) return;
      const F = sides[0].F, type = types[i % types.length];
      if (type === 'houses') fillHouses(c, F, fc);
      else if (type === 'flats') fillFlats(c, F, fc);
      else if (type === 'parking') fillParking(c, F, fc);
      else if (type === 'park') fillPark(c, F, fc);
      else fillGarages(c, F, fc);
    });
    // квартал — участок съёмки: периметральная застройка и двор
    const bx0 = X[2], bx1 = X[3], by0 = Y[2], by1 = Y[3];
    const reg = [{ x: bx0 + 1, y: by0 + 1 }, { x: bx1 - 1, y: by0 + 1 }, { x: bx1 - 1, y: by1 - 1 }, { x: bx0 + 1, y: by1 - 1 }];
    if (chance(0.35)) { // срезанный угол участка
      const k = ri(0, 3), q = reg[k], pv = reg[(k + 3) % 4], nx = reg[(k + 1) % 4], cs = rf(18, 28);
      const tw = (a, b) => { const l = hyp(b.x - a.x, b.y - a.y); return { x: a.x + (b.x - a.x) / l * cs, y: a.y + (b.y - a.y) / l * cs }; };
      reg.splice(k, 1, tw(q, pv), tw(q, nx));
    }
    wd.region = reg; wd.rc = centroid(reg);
    G.push(cc => Sym.ground(cc, Math.round(bx0), Math.round(by0), Math.round(bx1 - bx0), Math.round(by1 - by0), 'lawn', 61));
    const inset = rf(7, 10), depT = rf(30, 38), depB = rf(30, 38);
    const row = (y0, dep) => {
      let a = bx0 + inset;
      while (a < bx1 - inset - 40) {
        const len = Math.min(rf(80, 170), bx1 - inset - a); if (len < 40) break;
        building({ x: a, y: y0, w: len, h: dep }, ri(4, 9)); a += len + rf(16, 26);
      }
    };
    row(by0 + inset, depT);
    const hasB = chance(0.85); if (hasB) row(by1 - inset - depB, depB);
    const yy0 = by0 + inset + depT + 8, yy1 = by1 - inset - (hasB ? depB + 8 : 4);
    for (const sx of [0, 1]) if (chance(0.5) && yy1 - yy0 > 50) { const w = rf(28, 34), x = sx ? bx1 - inset - w : bx0 + inset, r = { x, y: yy0 + 4, w, h: Math.min(rf(60, 110), yy1 - yy0 - 8) }; if (free(r, 2)) building(r, ri(3, 5)); }
    // двор: площадка, деревья, скамейки, машины, контейнеры, трансформаторная
    const yard = (w, h, tries = 30) => { for (let t = 0; t < tries; t++) { const r = { x: rf(bx0 + inset, bx1 - inset - w), y: rf(yy0, yy1 - h), w, h }; if (free(r, 4)) return take(r); } return null; };
    const pg = yard(rf(44, 60), rf(30, 40)); if (pg) { const s = sd(); OBJ.push(cc => Sym.playground(cc, pg.x, pg.y, pg.w, pg.h, s)); OBJ.push(cc => { Sym.bench(cc, pg.x + pg.w / 2, pg.y + pg.h + 5, 0); Sym.bench(cc, pg.x - 5, pg.y + pg.h / 2, Math.PI / 2); }); }
    const pk = yard(rf(50, 80), 12); if (pk) { G.push(cc => Sym.ground(cc, Math.round(pk.x), Math.round(pk.y), Math.round(pk.w), 12, 'asphalt', 71)); for (let x = pk.x + 9; x < pk.x + pk.w - 8; x += 19) if (chance(0.75)) car(x, pk.y + 6, chance(0.5) ? 0 : Math.PI); }
    if (chance(0.6)) { const tr = yard(12, 10); if (tr) { const s = sd(); OBJ.push(cc => Sym.shed(cc, tr.x, tr.y, tr.w, tr.h, { material: 'metal', color: '#9aa0a3', seed: s })); } }
    const tc = yard(14, 7); if (tc) OBJ.push(cc => { cc.fillStyle = '#b9b4a8'; cc.fillRect(tc.x - 1, tc.y - 1, tc.w + 2, tc.h + 2); const col = ['#3f7a4f', '#2f5f9a', '#7a7d80']; for (let k = 0; k < 3; k++) { cc.fillStyle = col[k]; cc.fillRect(tc.x + k * 4.7, tc.y, 4, tc.h); cc.fillStyle = 'rgba(255,255,255,.18)'; cc.fillRect(tc.x + k * 4.7, tc.y, 4, 1.2); } });
    for (let k = ri(4, 8); k > 0; k--) { const r = rf(7, 12), q = yard(r * 1.2, r * 1.2, 12); if (q) tree(q.x + q.w / 2, q.y + q.h / 2, r, pick(['deciduous', 'birch', 'conifer']), false); }
    for (let k = ri(1, 2); k > 0; k--) { const q = yard(12, 7, 10); if (q) { const s = sd(); OBJ.push(cc => Sym.flowerbed(cc, q.x, q.y, q.w, q.h, s)); } }
    for (const [x, y] of [[bx0 + 4, by0 + 4], [bx1 - 4, by0 + 4], [bx0 + 4, by1 - 4], [bx1 - 4, by1 - 4]]) { const r = rf(6, 8); if (free({ x: x - r * 0.6, y: y - r * 0.6, w: r * 1.2, h: r * 1.2 }, 0) && chance(0.6)) tree(x, y, r, 'deciduous', true); }
    for (let k = 0; k < 3; k++) { const q = { x: rf(bx0 + 10, bx1 - 10), y: rf(yy0, yy1) }, kind = pick(['sewer', 'water', 'heat']); OBJ.push(cc => Sym.manhole(cc, q.x, q.y, kind, 1.7)); }
    // раскопка с ограждением на одной из улиц (ремонт сетей)
    const fullSt = streets.filter(s => s.full);
    if (fullSt.length && chance(0.45 - relax * 0.1)) {
      const s = pick(fullSt), lo = s.h ? xL + swL / 2 + SWK + 20 : yT + swT / 2 + SWK + 20, hi = s.h ? xR - swR / 2 - SWK - 20 : yB - swB / 2 - SWK - 20;
      if (hi - lo > 60) {
        const len = rf(28, 44), a = rf(lo, hi - len), sgn = pick([-1, 1]), o0 = sgn > 0 ? 1 : -s.w / 2 + 1, o1 = sgn > 0 ? s.w / 2 - 1 : -1;
        const p0 = P(s, a, o0), p1 = P(s, a + len, o1), r = { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) };
        const pts = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }, { x: r.x, y: r.y }];
        OBJ.push(cc => { // траншея и отвал грунта
          cc.fillStyle = '#7a5a3a'; cc.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
          cc.fillStyle = '#4a3624'; if (s.h) cc.fillRect(r.x + 4, r.y + r.h / 2 - 1.6, r.w - 8, 3.2); else cc.fillRect(r.x + r.w / 2 - 1.6, r.y + 4, 3.2, r.h - 8);
          cc.fillStyle = 'rgba(160,120,80,.8)'; for (let k = 0; k < 6; k++) { cc.beginPath(); cc.arc(r.x + 4 + (k * 7.3) % (r.w - 8), r.y + 3 + (k * 5.1) % (r.h - 6), 1.6, 0, TAU); cc.fill(); }
        });
        OBJ.push(cc => Sym.fence(cc, pts, 'chain'));
        OBJ.push(cc => { cc.lineWidth = 1.4; cc.setLineDash([2, 2]); cc.strokeStyle = '#e8402f'; cc.strokeRect(r.x - 1.2, r.y - 1.2, r.w + 2.4, r.h + 2.4); cc.strokeStyle = '#f4f1ea'; cc.lineDashOffset = 2; cc.strokeRect(r.x - 1.2, r.y - 1.2, r.w + 2.4, r.h + 2.4); cc.setLineDash([]); cc.lineDashOffset = 0; });
        addLine(wd, pts, 'мешает ограждение раскопки'); addRect(wd, r.x, r.y, r.w, r.h, '', 'Здесь раскопка', 2);
        s.works = { lane: sgn };
      }
    }
    // остановка или киоск на тротуаре
    for (let k = 0; k < 2 - (relax > 2 ? 1 : 0); k++) {
      const s = pick(streets), sg = pick([-1, 1]), a = rf(s.sa + 30, s.sb - 30), q = P(s, a, sg * (s.w / 2 + SWK / 2));
      if (nearG(q.x, q.y, 40)) continue;
      const kw = k ? 10 : 18, kd = k ? 8 : 6, r = s.h ? { x: q.x - kw / 2, y: q.y - kd / 2, w: kw, h: kd } : { x: q.x - kd / 2, y: q.y - kw / 2, w: kd, h: kw };
      if (!free(r, 2)) continue;
      take(r); const sd2 = sd();
      OBJ.push(cc => Sym.shed(cc, r.x, r.y, r.w, r.h, { material: 'metal', color: k ? '#c8463a' : '#5f7a8c', seed: sd2 }));
      addRect(wd, r.x, r.y, r.w, r.h, k ? 'мешает киоск' : 'мешает остановка', k ? 'Здесь киоск' : 'Здесь остановка', 1);
    }
    // движение: полосы, тротуары для прохожих
    for (const s of streets) {
      const max = s.h ? ww : WH;
      if (s.full) for (const dir of [1, -1]) {
        if (s.works && s.works.lane === dir) continue;
        wd.lanes.push({ h: s.h, c: s.c + (s.h ? dir : -dir) * s.w / 4, dir, a: -30, b: max + 30 });
      }
      for (const sg of [-1, 1]) wd.walks.push({ h: s.h, c: s.c + sg * (s.w / 2 + SWK / 2), a: Math.max(s.sa, -10), b: Math.min(s.sb, max + 10) });
    }
    wd.base = [...G, ...RD, ...OBJ]; wd.top = TOPL;
    return wd;
  }

  // ---------- генератор: лес и болото ----------
  function genForest(R, ww, relax) {
    const wd = world(ww, 'forest');
    const { rf, ri, pick, chance, sd } = rr(R);
    const G = [], OBJ = [], trees = [];
    const k = Math.min(1.22, ww / 640);
    const cx = ww / 2 + rf(-30, 30), cy = WH / 2 + rf(-8, 10), rx = rf(98, 118) * k, ry = rf(66, 80);
    const nv = ri(8, 10), region = [];
    for (let i = 0; i < nv; i++) { const a = (i + rf(-0.22, 0.22)) * TAU / nv, f = rf(0.86, 1.06); region.push({ x: cx + Math.cos(a) * rx * f, y: cy + Math.sin(a) * ry * f }); }
    wd.region = region; const rc = wd.rc = centroid(region);
    const regR = a => rayPoly(rc, a, region);
    // открытая опушка вокруг поляны
    const NM = 18, ringW = [], meadow = [];
    for (let j = 0; j < NM; j++) ringW.push(rf(50, 74) + relax * 7);
    const ringAt = a => { const f = ((a % TAU) + TAU) % TAU / TAU * NM, i = Math.floor(f), t = f - i; return ringW[i % NM] * (1 - t) + ringW[(i + 1) % NM] * t; };
    for (let j = 0; j < NM; j++) { const a = j * TAU / NM, r = regR(a) + ringW[j]; meadow.push({ x: rc.x + Math.cos(a) * r, y: rc.y + Math.sin(a) * r }); }
    // исходный пункт у края и просека через лес
    const side = pick(ww > 720 ? ['l', 'r', 'b', 't', 'b', 't'] : ['l', 'r', 'l', 'r', 'b', 't']); // на широком планшете с боков далеко до поляны
    const g = wd.ggs = side === 'l' ? { x: rf(16, 24), y: rf(70, WH - 70) } : side === 'r' ? { x: ww - rf(16, 24), y: rf(70, WH - 70) } :
      side === 'b' ? { x: rf(ww * 0.25, ww * 0.75), y: WH - rf(14, 20) } : { x: rf(ww * 0.25, ww * 0.75), y: rf(16, 22) };
    g.name = pick(NAMES);
    const tg = { x: rc.x + rf(-0.45, 0.45) * rx, y: rc.y + rf(-0.4, 0.4) * ry }, pa = Math.atan2(tg.y - g.y, tg.x - g.x), ux = Math.cos(pa), uy = Math.sin(pa);
    const clipT = (x, y, dx, dy) => { let t = 2000; if (dx > 0) t = Math.min(t, (ww + 30 - x) / dx); if (dx < 0) t = Math.min(t, (-30 - x) / dx); if (dy > 0) t = Math.min(t, (WH + 30 - y) / dy); if (dy < 0) t = Math.min(t, (-30 - y) / dy); return t; };
    const tB = clipT(g.x, g.y, ux, uy), tA = clipT(g.x, g.y, -ux, -uy);
    const pA = { x: g.x - ux * tA, y: g.y - uy * tA }, pB = { x: g.x + ux * tB, y: g.y + uy * tB };
    const prW = rf(16, 20) + relax * 2;
    const inPros = (x, y, m) => distSeg(x, y, pA.x, pA.y, pB.x, pB.y) < prW + m;
    // болото на опушке
    const aG = Math.atan2(g.y - rc.y, g.x - rc.x);
    let aS = rf(0, TAU); for (let t = 0; t < 20 && Math.abs(angN(aS - aG)) < 1.0; t++) aS = rf(0, TAU);
    const sR = regR(aS) + ringAt(aS) * rf(0.25, 0.5), sc = { x: rc.x + Math.cos(aS) * sR, y: rc.y + Math.sin(aS) * sR };
    const sx = Math.max(16, rf(32, 52) - relax * 4), sy = Math.max(12, rf(22, 34) - relax * 3), swamp = [];
    for (let i = 0; i < 11; i++) { const a = i * TAU / 11, f = rf(0.75, 1.15); swamp.push({ x: sc.x + Math.cos(a) * sx * f, y: sc.y + Math.sin(a) * sy * f }); }
    // ручей поперёк поляны
    let aW = rf(0, Math.PI), off = rf(-0.3, 0.3) * ry;
    for (let t = 0; t < 30; t++) { const nx = -Math.sin(aW), ny = Math.cos(aW); const d = Math.abs((g.x - rc.x) * nx + (g.y - rc.y) * ny - off); if (d > 60) break; aW = rf(0, Math.PI); off = rf(-0.3, 0.3) * ry; }
    const wx = Math.cos(aW), wy = Math.sin(aW), wnx = -wy, wny = wx, stream = [];
    let lat = 0;
    for (let t = -700; t <= 700; t += 30) { lat = clamp(lat + rf(-7, 7), -14, 14); const x = rc.x + wx * t + wnx * (off + lat), y = rc.y + wy * t + wny * (off + lat); if (x > -40 && x < ww + 40 && y > -40 && y < WH + 40) stream.push({ x, y }); }
    const sw = rf(5, 7);
    // земля
    G.push(c => Sym.ground(c, 0, 0, ww, WH, 'forestFloor', 13));
    const corr = [{ x: pA.x - uy * (prW + 3), y: pA.y + ux * (prW + 3) }, { x: pB.x - uy * (prW + 3), y: pB.y + ux * (prW + 3) }, { x: pB.x + uy * (prW + 3), y: pB.y - ux * (prW + 3) }, { x: pA.x + uy * (prW + 3), y: pA.y - ux * (prW + 3) }];
    G.push(c => Sym.ground(c, 0, 0, 0, 0, 'grass', 17, { poly: corr, edge: 5 }));
    G.push(c => Sym.ground(c, 0, 0, 0, 0, 'grass', 19, { poly: meadow, edge: 9 }));
    G.push(c => Sym.ground(c, 0, 0, 0, 0, 'meadow', 23, { poly: region, edge: 6 }));
    const s1 = sd(), s2 = sd();
    G.push(c => Sym.swamp(c, swamp, s1));
    addPoly(wd, swamp, 'В болоте штатив не устоит');
    wd.pf.push({ t: 'swamp', pts: swamp });
    // лесная дорога вдоль просеки, ЛЭП
    const rdOff = -prW * 0.3, road = [{ x: pA.x - uy * rdOff, y: pA.y + ux * rdOff }, { x: pB.x - uy * rdOff, y: pB.y + ux * rdOff }];
    G.push(c => Sym.road(c, road, 11, 'dirt', { seed: 7 }));
    wd.pf.push({ t: 'road', pts: road, w: 11, dirt: 1 });
    G.push(c => Sym.stream(c, stream, sw, s2));
    addBand(wd, stream, sw / 2 + 2, 'Станцию в ручей не поставить');
    wd.pf.push({ t: 'water', pts: stream, w: sw });
    // мостик-кладка там, где дорога пересекает ручей
    for (let i = 0; i + 1 < stream.length; i++) {
      const p = stream[i], q = stream[i + 1];
      if (!segSeg(road[0].x, road[0].y, road[1].x, road[1].y, p.x, p.y, q.x, q.y)) continue;
      const d1 = (road[1].x - road[0].x) * (q.y - p.y) - (road[1].y - road[0].y) * (q.x - p.x);
      const t = ((p.x - road[0].x) * (q.y - p.y) - (p.y - road[0].y) * (q.x - p.x)) / d1, bx = road[0].x + (road[1].x - road[0].x) * t, by = road[0].y + (road[1].y - road[0].y) * t;
      OBJ.push(c => { c.save(); c.translate(bx, by); c.rotate(pa); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(-9, -5, 20, 12); for (let k = -8; k <= 8; k += 2.6) { c.fillStyle = k % 5 < 1 ? '#9a7a52' : '#8a6a44'; c.fillRect(k, -5.5, 2.2, 11); } c.fillStyle = '#6a4e30'; c.fillRect(-9, -6, 19, 1.2); c.fillRect(-9, 4.8, 19, 1.2); c.restore(); });
      break;
    }
    const step = 62, poleOff = prW * 0.62;
    const poles = [];
    for (let t = -tA + 10; t < tB; t += step) { const x = g.x + ux * t - uy * poleOff, y = g.y + uy * t + ux * poleOff; if (x > -20 && x < ww + 20 && y > -20 && y < WH + 20 && distPoly(x, y, stream, false) > sw) poles.push({ x, y }); }
    OBJ.push(c => { for (let i = 0; i + 1 < poles.length; i++) Sym.wires(c, poles[i].x, poles[i].y, poles[i + 1].x, poles[i + 1].y); for (const q of poles) Sym.pole(c, q.x, q.y, 'power', pa); });
    for (const q of poles) addCirc(wd, q.x, q.y, 0, 3, '', 'Здесь опора ЛЭП');
    const okTree = (x, y, r) => !(inPros(x, y, r * 0.5) || hyp(x - g.x, y - g.y) < 28 + r || inPoly(x, y, swamp) || distPoly(x, y, swamp, true) < r * 0.4 || distPoly(x, y, stream, false) < sw / 2 + 2 + r * 0.45);
    // густой лес вне опушки
    const spc = 21 + relax * 2;
    for (let gy = -8; gy < WH + 12; gy += spc) for (let gx = -8; gx < ww + 12; gx += spc) {
      const x = gx + rf(-6, 6), y = gy + rf(-6, 6), r = rf(9, 13);
      if (inPoly(x, y, meadow) && distPoly(x, y, meadow, true) > 6) continue;
      if (!okTree(x, y, r)) continue;
      trees.push({ x, y, r, kind: pick(['conifer', 'conifer', 'conifer', 'birch', 'deciduous', 'deciduous']) });
    }
    // группы деревьев и одиночные деревья на опушке
    const groups = Math.max(1, Math.round(rf(5, 8) * k) - relax);
    for (let gi = 0; gi < groups; gi++) {
      const a = rf(0, TAU), rr0 = regR(a) + rf(16, Math.max(18, ringAt(a) - 8)), gcx = rc.x + Math.cos(a) * rr0, gcy = rc.y + Math.sin(a) * rr0;
      const kind = pick(['birch', 'conifer', 'deciduous', 'mix']);
      for (let t = ri(3, 6); t > 0; t--) {
        const x = gcx + rf(-15, 15), y = gcy + rf(-12, 12), r = rf(7, 10.5);
        if (inPoly(x, y, region) || !okTree(x, y, r) || trees.some(q => hyp(q.x - x, q.y - y) < (q.r + r) * 0.55)) continue;
        trees.push({ x, y, r, kind: kind === 'mix' ? pick(['birch', 'conifer', 'deciduous']) : kind });
      }
    }
    for (let t = Math.max(0, ri(4, 9) - relax); t > 0; t--) {
      const a = rf(0, TAU), rr0 = regR(a) + rf(10, ringAt(a)), x = rc.x + Math.cos(a) * rr0, y = rc.y + Math.sin(a) * rr0, r = rf(7, 11);
      if (okTree(x, y, r) && !trees.some(q => hyp(q.x - x, q.y - y) < (q.r + r) * 0.6)) trees.push({ x, y, r, kind: pick(['birch', 'conifer', 'deciduous']) });
    }
    for (let t = ri(1, 3); t > 0; t--) { const a = rf(0, TAU), rr0 = regR(a) * rf(0.2, 0.7), x = rc.x + Math.cos(a) * rr0, y = rc.y + Math.sin(a) * rr0; if (distPoly(x, y, stream, false) > 14) trees.push({ x, y, r: rf(9, 12), kind: pick(['deciduous', 'birch']) }); }
    trees.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const t of trees) {
      const s = sd(); OBJ.push(c => Sym.tree(c, t.x, t.y, t.r, t.kind, s));
      addCirc(wd, t.x, t.y, t.r * 0.7, t.r * 0.55, 'мешают деревья', 'Под кроной нет обзора');
      wd.pf.push({ t: 'tree', x: t.x, y: t.y, kind: t.kind === 'conifer' ? 'conifer' : 'deciduous' });
    }
    // кусты, стога, пни, муравейник
    for (let t = ri(8, 15); t > 0; t--) {
      const a = rf(0, TAU), rr0 = regR(a) + rf(-20, ringAt(a)), x = rc.x + Math.cos(a) * rr0, y = rc.y + Math.sin(a) * rr0, r = rf(3, 5.5);
      if (!okTree(x, y, r) || inPoly(x, y, swamp)) continue;
      const s = sd(); OBJ.push(c => Sym.bush(c, x, y, r, s)); addCirc(wd, x, y, 0, r + 1, '', 'В кустах штатив не поставить');
    }
    for (let t = ri(1, 3); t > 0; t--) {
      const a = rf(0, TAU), rr0 = regR(a) * rf(0.25, 0.75), x = rc.x + Math.cos(a) * rr0, y = rc.y + Math.sin(a) * rr0, r = rf(5, 7);
      if (distPoly(x, y, stream, false) < 12) continue;
      OBJ.push(c => { // стог сена
        c.fillStyle = 'rgba(40,40,20,.25)'; c.beginPath(); c.ellipse(x + 3, y + 3, r * 1.1, r, 0, 0, TAU); c.fill();
        const gr = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r); gr.addColorStop(0, '#e2cf8a'); gr.addColorStop(1, '#a8904e'); c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(120,96,48,.6)'; c.lineWidth = 0.4; c.beginPath(); for (let i = 0; i < 12; i++) { const an = i * TAU / 12; c.moveTo(x + Math.cos(an) * r * 0.25, y + Math.sin(an) * r * 0.25); c.lineTo(x + Math.cos(an + 0.3) * r * 0.95, y + Math.sin(an + 0.3) * r * 0.95); } c.stroke();
      });
    }
    for (let t = ri(5, 10); t > 0; t--) {
      const tt = rf(-tA + 15, tB - 10), o = rf(-prW, prW), x = g.x + ux * tt - uy * o, y = g.y + uy * tt + ux * o, r = rf(1.6, 2.6);
      if (inPoly(x, y, meadow) || hyp(x - g.x, y - g.y) < 14 || distPoly(x, y, stream, false) < sw) continue;
      OBJ.push(c => { c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.arc(x + 0.8, y + 0.8, r, 0, TAU); c.fill(); c.fillStyle = '#8b6b45'; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.fillStyle = '#d2b07a'; c.beginPath(); c.arc(x, y, r * 0.72, 0, TAU); c.fill(); c.strokeStyle = 'rgba(120,80,40,.6)'; c.lineWidth = 0.2; c.beginPath(); c.arc(x, y, r * 0.45, 0, TAU); c.arc(x, y, r * 0.2, 0, TAU); c.stroke(); });
      addCirc(wd, x, y, 0, r + 1, '', 'Здесь пень');
    }
    { // муравейник на опушке
      const a = rf(0, TAU), rr0 = regR(a) + ringAt(a) - 4, x = rc.x + Math.cos(a) * rr0, y = rc.y + Math.sin(a) * rr0;
      if (okTree(x, y, 4)) { OBJ.push(c => { const gr = c.createRadialGradient(x - 1, y - 1, 0.5, x, y, 4.5); gr.addColorStop(0, '#9a7348'); gr.addColorStop(1, '#5e4428'); c.fillStyle = gr; c.beginPath(); c.arc(x, y, 4.5, 0, TAU); c.fill(); c.fillStyle = 'rgba(30,20,10,.6)'; for (let i = 0; i < 14; i++) c.fillRect(x + Math.cos(i * 2.4) * (i % 4 + 0.5), y + Math.sin(i * 2.4) * (i % 4 + 0.5), 0.5, 0.5); }); addCirc(wd, x, y, 0, 5, '', 'Здесь муравейник'); }
    }
    wd.base = [...G, ...OBJ];
    wd.prosA = pA; wd.prosB = pB;
    return wd;
  }

  // ---------- вид работ ----------
  registerMode({
    index: 2,
    id: 'traverse',
    title: 'Невязка',
    subtitle: 'Замкнутый теодолитный ход',
    howto: [
      'Тапами ставьте станции хода: от пункта ГГС вокруг участка и обратно на пункт. Сторона — 15–57,5 м.',
      'Соседние станции должны видеть друг друга: дома, деревья и заборы закрывают обзор.',
      'На станции наведите трубу назад и вперёд — тап, когда ось марки между нитями.',
      'Невязка fβ (допуск ±1′√n) — сумма ошибок. Меньше станций и быстрее — больше очков.',
    ],
    variants: [
      { id: 'block', title: 'Городской квартал', subtitle: 'Ход вокруг квартала по улицам — мешают дома, деревья, заборы', howto: ['Вдоль улиц видно далеко; в зданиях станцию не поставить.'], params: { tip: 'Совет: по проезжей части видимость лучше, чем по тротуару с деревьями' } },
      { id: 'forest', title: 'Лес и болото', subtitle: 'Поляна в лесу: группы деревьев, болото и ручей', howto: ['В болоте и ручье стоять нельзя, но через них видно.'], params: { tip: 'Совет: ищите прогалы между группами деревьев и бейте сторону через болото' } },
    ],
    create,
  });

  function create(api, variant, seed) {
    const R = api.rng(seed), forest = variant.id === 'forest';
    const ww = Math.round(clamp(api.W, 560, 860)), TH = api.theme;
    let wd = null, ref = null, tries = 0;
    // кнопка «Снять» — в нижнем углу, где нет исходного пункта (в мировых координатах при W = ww)
    const undoW = g0 => (g0.x < 130 && g0.y > WH - 80) ? { x: ww - 104, y: WH - 50, w: 96, h: 42 } : { x: 8, y: WH - 50, w: 96, h: 42 };
    for (let k = 0; k < 9 && !ref; k++) {
      wd = (forest ? genForest : genBlock)(R, ww, k < 3 ? 0 : k - 2); tries++;
      wd.cands = makeCands(wd, undoW(wd.ggs));
      ref = bestPlan(wd);
      if (ref && ref.length > 10 && k < 6) ref = null;          // слишком длинный ход — другой участок
    }
    if (!ref) { tries = 99; wd = (forest ? genForest : genBlock)(R, ww, 12); wd.cands = makeCands(wd, undoW(wd.ggs)); ref = bestPlan(wd) || [wd.ggs, wd.ggs]; }
    const undoAt = undoW(wd.ggs);
    const refN = ref.length - 1, refP = perim(ref);
    // статичный фон — один холст в точном масштабе экрана: вывод 1:1 по целым пикселям в разы дешевле масштабированного
    const devK = () => { const cv = typeof document !== 'undefined' && document.getElementById('game'); return cv && cv.width ? cv.width / api.W : 2; };
    let base = null;
    function buildBase(k) {
      const cv = document.createElement('canvas'); cv.width = Math.round(ww * k); cv.height = Math.round(WH * k);
      const c = cv.getContext('2d', { alpha: false }); c.setTransform(k, 0, 0, k, 0, 0);
      const prev = Sym.cache; Sym.cache = false;
      try { for (const f of wd.base) f(c); for (const f of wd.top) f(c); } finally { Sym.cache = prev; }
      base = { canvas: cv, k };
    }
    buildBase(devK());

    // ---------- состояние ----------
    const g = wd.ggs, S = [g];          // станции хода, S[0] — исходный пункт
    const ang = [];                      // измерения углов по станциям: { eb, ef — ошибки наведений, d — ошибка угла, ″; beta }
    let st = 'place', closed = false, cur = 0, pendAim = -1, reK = -1;
    let tUsed = 0, T = 0, finished = false, viewK = 0;
    let aim = null, adj = null, lenErr = null, resCache = null;
    let hover = null, noHover = null, downMap = false, flash = null, toastMsg = null, fails = 0;
    const view = { s: 1, ox: 0, oy: api.TOP };
    let zoomBox = null;
    const say = (text, color = TH.ink, t = 3) => { toastMsg = { text, color, t }; };
    say('Станция 1: тап в кольце 15–57,5 м от пункта ГГС, где есть видимость', TH.accent, 6);

    // ---------- вид: на весь экран или карта слева + ведомость справа ----------
    const panelW = () => clamp(Math.round(api.W * 0.42), 236, 320);
    function fitView() {
      const W = api.W, ph = api.H - api.TOP;
      const s0 = Math.min(W / ww, ph / WH), ox0 = (W - ww * s0) / 2, oy0 = api.TOP + (ph - WH * s0) / 2;
      let s1 = Math.min((W - panelW() - 18) / ww, ph / WH), ox1 = 8, oy1 = api.TOP + (ph - WH * s1) / 2;
      if (zoomBox) { // окно хода и участка — во всю левую часть
        const b = zoomBox, aw = W - panelW() - 18;
        s1 = Math.min(aw / (b[2] - b[0]), ph / (b[3] - b[1]), 1.2); ox1 = 4 + (aw - (b[2] - b[0]) * s1) / 2 - b[0] * s1; oy1 = api.TOP + (ph - (b[3] - b[1]) * s1) / 2 - b[1] * s1;
      }
      const k = ease(viewK);
      view.s = s0 + (s1 - s0) * k; view.ox = ox0 + (ox1 - ox0) * k; view.oy = oy0 + (oy1 - oy0) * k;
    }
    const toW = p => ({ x: (p.x - view.ox) / view.s, y: (p.y - view.oy) / view.s });
    const toS = q => ({ x: view.ox + q.x * view.s, y: view.oy + q.y * view.s });

    // ---------- обход участка (для прогресса) ----------
    const th = q => Math.atan2(q.y - wd.rc.y, q.x - wd.rc.x);
    function swept() { let s = 0; for (let i = 0; i + 1 < S.length; i++) s += angN(th(S[i + 1]) - th(S[i])); if (closed) s += angN(th(S[0]) - th(S[S.length - 1])); return s; }
    const nb = k => ({ b: k > 0 ? k - 1 : S.length - 1, f: k + 1 < S.length ? k + 1 : 0 });
    const stName = i => i === 0 ? 'ГГС' : 'ст. ' + i;
    function trueBeta(k, sg) { // внутренний угол хода на станции k
      const n = S.length, a = S[(k + n - 1) % n], p = S[k], b = S[(k + 1) % n];
      const tau = Math.atan2((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x), (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y));
      return Math.PI - sg * tau;
    }

    // ---------- бригада: теодолит, наблюдатель, двое с вешками; в лесу — собака ----------
    const mk = (x, y) => ({ x, y, dir: 0, t: 0, mv: false });
    const crew = { ins: mk(g.x, g.y), op: mk(g.x - 8, g.y), hb: mk(g.x - 10, g.y + 12), hf: mk(g.x + 10, g.y + 12), dog: mk(g.x + 6, g.y + 14) };
    let insAim = 0;
    function crewTargets() {
      const n = S.length, k = cur, ins = S[k];
      let bi = -1, fi = -1;
      if (st === 'aim') { bi = aim.b; fi = aim.f; }
      else if (pendAim >= 0) { const q = nb(pendAim); bi = q.b; fi = q.f; }
      else { bi = k > 0 ? k - 1 : (closed ? n - 1 : -1); fi = k + 1 < n ? k + 1 : (closed ? 0 : -1); }
      let a = insAim;
      if (st === 'aim') { const tq = S[aim.step === 0 ? aim.b : aim.f]; a = Math.atan2(tq.y - ins.y, tq.x - ins.x); }
      else if (fi >= 0) a = Math.atan2(S[fi].y - ins.y, S[fi].x - ins.x);
      else if (hover && st === 'place' && !closed) a = Math.atan2(hover.y - ins.y, hover.x - ins.x);
      insAim += angN(a - insAim) * 0.2;
      const pole = (i, side) => {
        if (i < 0 || i === k) { const pa = insAim + side * 1.9; return { x: ins.x + Math.cos(pa) * 13, y: ins.y + Math.sin(pa) * 13, dir: insAim }; }
        const q = S[i], df = Math.atan2(ins.y - q.y, ins.x - q.x), ca = Math.cos(df), sa = Math.sin(df);
        return { x: q.x - (1.8 * ca - 3.9 * sa), y: q.y - (1.8 * sa + 3.9 * ca), dir: df };
      };
      return { ins: { x: ins.x, y: ins.y }, op: { x: ins.x - Math.cos(insAim) * 7, y: ins.y - Math.sin(insAim) * 7, dir: insAim }, hb: pole(bi, 1), hf: pole(fi, -1) };
    }
    function moveTo(m, tq, dt, vmin) {
      const dx = tq.x - m.x, dy = tq.y - m.y, d = hyp(dx, dy);
      if (d < 0.4) { m.x = tq.x; m.y = tq.y; m.mv = false; if (tq.dir != null) m.dir += angN(tq.dir - m.dir) * Math.min(1, dt * 10); return true; }
      const v = Math.max(vmin, d * 5) * dt;
      m.x += dx / d * Math.min(d, v); m.y += dy / d * Math.min(d, v); m.dir += angN(Math.atan2(dy, dx) - m.dir) * Math.min(1, dt * 14); m.t += dt; m.mv = true;
      return false;
    }
    let crewOk = true;
    function updCrew(dt) {
      const t = crewTargets();
      const wasMv = crew.ins.mv;
      const a = moveTo(crew.ins, t.ins, dt, 150), b = moveTo(crew.op, t.op, dt, 150), c = moveTo(crew.hb, t.hb, dt, 170), d = moveTo(crew.hf, t.hf, dt, 170);
      if (wasMv && !crew.ins.mv) api.sfx('station');
      crewOk = a && b && c && d;
      if (forest) { // собака бегает вокруг наблюдателя
        const dg = crew.dog, ph = T * 0.7, tx = crew.op.x + Math.cos(ph) * 16, ty = crew.op.y + Math.sin(ph * 1.3) * 12;
        moveTo(dg, { x: tx, y: ty }, dt, 60);
      }
    }

    // ---------- движение в городе: машины уступают перекрёстки и ждут, если на полосе стоит бригада ----------
    const cars = [], peds = [];
    if (!forest) {
      const CC = ['#d8dadd', '#2b2f35', '#b3302c', '#2c5c9e', '#f2f2ee', '#5f7356', '#c8a24a', '#7a2e3c', '#3e7f8a'];
      for (let i = 0; i < Math.min(5, wd.lanes.length + 1) && wd.lanes.length; i++) {
        const ln = wd.lanes[i % wd.lanes.length];
        cars.push({ ln, s: ln.a + (ln.b - ln.a) * ((i * 0.37 + R()) % 1), v: 30, vmax: 34 + R() * 18, col: CC[Math.floor(R() * CC.length)], seed: 1 + Math.floor(R() * 9999), wait: 0, honk: 0 });
      }
      for (let i = 0; i < Math.min(5, wd.walks.length); i++) {
        const wk = wd.walks[Math.floor(R() * wd.walks.length)];
        peds.push({ wk, s: wk.a + (wk.b - wk.a) * R(), dir: R() < 0.5 ? 1 : -1, v: 8 + R() * 5, seed: 1 + Math.floor(R() * 9999), t: R() * 5, dog: i === 0 });
      }
    }
    const carPos = c => c.ln.h ? { x: c.s, y: c.ln.c } : { x: c.ln.c, y: c.s };
    function updTraffic(dt) {
      for (const c of cars) {
        const p = carPos(c), dir = c.ln.dir, h = c.ln.h;
        const ahead = (q) => { const da = h ? (q.x - p.x) * dir : (q.y - p.y) * dir, lat = h ? q.y - p.y : q.x - p.x; return { da, lat }; };
        let block = false;
        for (const o of cars) { if (o === c || o.ln !== c.ln) continue; const q = ahead(carPos(o)); if (q.da > 0 && q.da < 26) block = true; }
        for (const m of [crew.ins, crew.op, crew.hb, crew.hf]) { const q = ahead(m); if (q.da > 0 && q.da < 24 && Math.abs(q.lat) < 7) { block = true; c.wait += dt; } }
        for (const bx of wd.boxes) {
          const inside = (q) => q.x > bx.x0 - 9 && q.x < bx.x1 + 9 && q.y > bx.y0 - 9 && q.y < bx.y1 + 9;
          if (inside(p)) continue;
          const nx = p.x + (h ? dir * 14 : 0), ny = p.y + (h ? 0 : dir * 14);
          if (!inside({ x: nx, y: ny })) continue;
          for (const o of cars) { if (o === c || o.ln.h === h) continue; const q = carPos(o); if (inside(q) || (h === 0 && hyp(q.x - (bx.x0 + bx.x1) / 2, q.y - (bx.y0 + bx.y1) / 2) < 34)) block = true; }
        }
        if (!block) c.wait = 0;
        if (c.wait > 2.2 && c.honk <= 0 && !finished) { c.honk = 6; api.sfx('car'); const sp = toS(p); if (st === 'place') api.popup(sp.x, sp.y - 10, 'Би-бип!', '#ffd76a'); }
        c.honk -= dt;
        c.v = block ? Math.max(0, c.v - 140 * dt) : Math.min(c.vmax, c.v + 30 * dt);
        c.s += c.v * dt * dir;
        if (c.s > c.ln.b + 20 || c.s < c.ln.a - 20) { c.ln = wd.lanes[Math.floor(Math.random() * wd.lanes.length)]; c.s = c.ln.dir > 0 ? c.ln.a : c.ln.b; c.v = c.vmax * 0.8; }
      }
      for (const p of peds) {
        p.s += p.v * p.dir * dt; p.t += dt;
        if (p.s > p.wk.b) { p.s = p.wk.b; p.dir = -1; } if (p.s < p.wk.a) { p.s = p.wk.a; p.dir = 1; }
      }
    }

    // ---------- рекогносцировка: постановка станций ----------
    function tryPlace(w) {
      if (st !== 'place' || pendAim >= 0 || closed) return false;
      const n = S.length, last = S[n - 1];
      let p = { x: w.x, y: w.y }, closing = false;
      if (hyp(w.x - g.x, w.y - g.y) < SNAP) { if (n >= 3) { p = g; closing = true; } }
      const res = check(wd, S, p, closing, 0);
      if (!res.ok) {
        flash = { a: last, b: p, res, t: 2.4 }; toastMsg = null; api.sfx('bad'); fails++; // причина — подписью у точки
        if (fails >= 3 && n >= 3 && check(wd, S, g, true, 0).ok) say('Подсказка: с этой станции уже можно замкнуть ход на пункт ГГС', TH.accent, 4);
        else if (fails === 3 && variant.params && variant.params.tip) say(variant.params.tip, TH.accent, 4);
        return false;
      }
      fails = 0; flash = null;
      const sp = toS(p);
      if (closing) {
        closed = true; pendAim = n - 1; api.sfx('good'); api.burst(sp.x, sp.y, '#6cff8a', 16);
        say('Ход замкнут! Осталось измерить углы на последней станции и на пункте', TH.good, 4);
      } else {
        S.push({ x: p.x, y: p.y }); api.sfx('station'); hover = null; noHover = toS(p); api.popup(sp.x, sp.y - 14, fmtM(res.len) + ' м', '#ffe27a');
        if (n === 1) { cur = 1; say('Станция 1 стоит. Угол на пункте ГГС измерим при замыкании', TH.ink, 3.5); }
        else pendAim = n - 1;
      }
      return true;
    }
    function undo() {
      if (st !== 'place' || pendAim >= 0 || closed || S.length < 2) return;
      S.pop(); const m = S.length;
      ang[m - 1] = null; ang.length = Math.min(ang.length, m); cur = m - 1;
      api.sfx('drop'); say('Станция снята', TH.dim, 1.6); flash = null;
    }

    // ---------- наведение в окуляре ----------
    function newStep(a) {
      const tq = S[a.step === 0 ? a.b : a.f], ins = S[a.k];
      a.t = 0; a.len = hyp(tq.x - ins.x, tq.y - ins.y); a.frozen = 0; a.block = 0;
      a.A = forest ? api.rand(30, 35) : api.rand(26, 31);
      a.p = { w1: api.rand(1.5, 2.1), w2: api.rand(2.9, 3.8), w3: api.rand(1.0, 1.5), p1: api.rand(0, TAU), p2: api.rand(0, TAU), p3: api.rand(0, TAU) };
      a.pan = a.step === 0 ? -1 : 1;
      a.gust = Math.random() < (forest ? 0.45 : 0.2) ? { t0: api.rand(0.7, 2.4), dur: 1.4, amp: api.rand(16, 26) * (Math.random() < 0.5 ? -1 : 1), on: false } : null;
      const kind = forest ? 'branch' : (Math.random() < 0.6 ? 'car' : 'ped');
      a.occ = Math.random() < (forest ? 0.4 : 0.38) ? { kind, t0: api.rand(0.6, 2.2), dir: Math.random() < 0.5 ? -1 : 1, on: false } : null;
      // фон: детали «за маркой»
      const rnd = Math.random, bg = a.bg = [];
      if (forest) for (let i = 0; i < 26; i++) bg.push({ x: -280 + i * 22 + rnd() * 10, h: 40 + rnd() * 55, w: 14 + rnd() * 10, c: rnd() < 0.6 ? '#2c4a33' : '#3d5d3a', trunk: rnd() < 0.35 });
      else { let x = -300; while (x < 300) { const w = 50 + rnd() * 80; bg.push({ x, w, h: 60 + rnd() * 110, c: ['#c9bca6', '#b7b1a6', '#d8cdb8', '#a9b2b8', '#c7a98a', '#9fa7a1'][Math.floor(rnd() * 6)], tree: rnd() < 0.45 }); x += w + rnd() * 8; } }
    }
    function startAim(k) {
      const q = nb(k);
      aim = { k, b: q.b, f: q.f, step: 0, eps: [null, null], sum: 0, fz: { x: 0, y: 0 }, re: reK === k, rb0: 5 + Math.floor(Math.random() * 280), read: [0, 0] };
      newStep(aim); pendAim = -1; st = 'aim'; api.sfx('select');
    }
    function sway(a) {
      const t = a.t, p = a.p;
      let x = a.A * (0.62 * Math.sin(p.w1 * t + p.p1) + 0.38 * Math.sin(p.w2 * t + p.p2)), y = a.A * 0.38 * Math.sin(p.w3 * t + p.p3);
      if (a.gust && t > a.gust.t0 && t < a.gust.t0 + a.gust.dur) { const gg = Math.sin(Math.PI * (t - a.gust.t0) / a.gust.dur) * a.gust.amp; x += gg; y += gg * 0.25; }
      return { x, y };
    }
    const panOff = (a, R0) => (1 - ease(a.t / 0.4)) * a.pan * R0 * 1.8;
    function occX(a, R0) { // положение помехи относительно центра окуляра
      const o = a.occ; if (!o || a.t < o.t0) return null;
      const u = a.t - o.t0;
      if (o.kind === 'car') { const x = -o.dir * (R0 * 2.6) + o.dir * u * 300; return Math.abs(x) > R0 * 2.7 ? null : { x, w: R0 * 2.3 }; }
      if (o.kind === 'ped') { const x = -o.dir * (R0 * 1.4) + o.dir * u * 70; return Math.abs(x) > R0 * 1.5 ? null : { x, w: R0 * 0.42 }; }
      if (u > 2.6) return null;
      const k = Math.min(1, u / 0.5, (2.6 - u) / 0.5);
      return { x: -o.dir * R0 * (1.5 - 1.2 * k) + Math.sin(u * 3.1) * R0 * 0.5 * k, w: R0 * 0.85, branch: true };
    }
    function occluded(a) { const o = occX(a, 100); if (!o) return false; const s = sway(a); return Math.abs(o.x - s.x) < o.w / 2 + 6; }
    function aimTap() {
      const a = aim; if (!a) return;
      if (a.sum > 0) { if (a.sum < 0.9) a.sum = 0.0001; return; }
      if (a.frozen > 0) { if (a.frozen < 0.55) a.frozen = 0.0001; return; }
      if (a.t < 0.32 || a.block > 0) return;
      if (occluded(a)) { a.block = 0.5; api.sfx('warn'); a.msg = { text: forest ? 'Ветка закрыла марку!' : 'Марку закрыло — ждите!', t: 1.2 }; return; }
      const s = sway(a), e = Math.round((s.x + panOff(a, 100)) * KSEC + api.rand(-0.7, 0.7));
      a.eps[a.step] = e; a.fz = s; a.frozen = 0.9;
      // отсчёт по лимбу: на заднюю точку — около нуля, на переднюю — минус измеренный угол
      if (a.step === 0) a.read[0] = (a.rb0 + e) / RHO;
      else { const sg = closed ? (polyArea(S) > 0 ? 1 : -1) : (swept() >= 0 ? 1 : -1), bm = trueBeta(a.k, sg) + (a.eps[0] - e) / RHO; a.read[1] = a.read[0] - sg * bm; }
      const ae = Math.abs(e);
      api.sfx(ae <= 10 ? 'measure' : ae <= 25 ? 'warn' : 'bad');
      if (ae <= 5) api.sfx('good');
    }
    function updAim(dt) {
      const a = aim;
      if (a.msg) { a.msg.t -= dt; if (a.msg.t <= 0) a.msg = null; }
      if (a.sum > 0) { a.sum -= dt; if (a.sum <= 0) endAim(); return; }
      if (a.frozen > 0) {
        a.frozen -= dt;
        if (a.frozen <= 0) { if (a.step === 0) { a.step = 1; newStep(a); api.sfx('tap'); } else { a.sum = 1.5; const d = a.eps[0] - a.eps[1]; api.sfx(Math.abs(d) <= 15 ? 'point' : 'beep'); } }
        return;
      }
      a.t += dt; a.block = Math.max(0, a.block - dt);
      if (a.gust && !a.gust.on && a.t > a.gust.t0) { a.gust.on = true; api.sfx('wind'); }
      if (a.occ && !a.occ.on && a.t > a.occ.t0) { a.occ.on = true; if (a.occ.kind === 'car') api.sfx('car'); }
    }
    function endAim() {
      const a = aim, k = a.k, n = S.length;
      const sg = closed ? (polyArea(S) > 0 ? 1 : -1) : (swept() >= 0 ? 1 : -1);
      ang[k] = { eb: a.eps[0], ef: a.eps[1], d: a.eps[0] - a.eps[1], beta: trueBeta(k, sg) };
      aim = null;
      if (a.re) { reK = -1; startAdjust(true); return; }
      if (closed) { if (k === n - 1) { cur = 0; pendAim = 0; st = 'place'; } else startAdjust(false); }
      else { cur = k + 1; st = 'place'; say(`Ставьте станцию ${n}`, TH.ink, 2.2); }
    }

    // ---------- уравнивание ----------
    function startAdjust(again) {
      const n = S.length, sg = polyArea(S) > 0 ? 1 : -1;
      const beta = [], d = [], err = [];
      for (let i = 0; i < n; i++) { beta.push(trueBeta(i, sg)); d.push(hyp(S[(i + 1) % n].x - S[i].x, S[(i + 1) % n].y - S[i].y)); err.push(ang[i] ? ang[i].d : 0); }
      const fb = err.reduce((s, e) => s + e, 0), tol = Math.round(60 * Math.sqrt(n));
      // поправки поровну, остаток — в углы между короткими сторонами
      const v = new Array(n).fill(Math.trunc(-fb / n)); let rem = -fb - v[0] * n;
      const ord = [...Array(n).keys()].sort((a, b) => (d[(a + n - 1) % n] + d[a]) - (d[(b + n - 1) % n] + d[b]));
      for (let i = 0; rem !== 0 && i < n; i++) { v[ord[i]] += Math.sign(rem); rem -= Math.sign(rem); }
      if (!lenErr || lenErr.length !== n) { // ошибки измерения длин (светодальномер, ±мм) — одни и те же при перемере углов
        const gr = api.rng(seed ^ 0x5bd1e995), gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += gr(); return (s - 3) / Math.sqrt(0.5); }; lenErr = d.map(L => gauss() * (0.004 + L * MU / 9000)); }
      const run = (ka, kl, useV) => {
        const out = [{ x: S[0].x, y: S[0].y }]; let az = Math.atan2(S[1].y - S[0].y, S[1].x - S[0].x);
        for (let i = 0; i < n; i++) {
          if (i > 0) az += sg * (Math.PI - (beta[i] + (err[i] + (useV ? v[i] : 0)) * ka / RHO));
          const L = d[i] + lenErr[i] / MU * kl, q = out[out.length - 1];
          out.push({ x: q.x + Math.cos(az) * L, y: q.y + Math.sin(az) * L });
        }
        return out;
      };
      const gap = p => hyp(p[n].x - S[0].x, p[n].y - S[0].y);
      const real = run(1, 1, true), ex = real[n].x - S[0].x, ey = real[n].y - S[0].y;
      const fx = -ey * MU, fy = ex * MU, fabs = hyp(fx, fy), Pm = d.reduce((s, x) => s + x, 0) * MU, N = Math.max(100, Math.round(Pm / Math.max(fabs, 1e-6) / 100) * 100);
      const maxE = Math.max(1, ...err.map(Math.abs));
      const EA = clamp(30 / Math.max(gap(run(1, 0, false)), 1e-5), 40, Math.min(8000, 6 * 3600 / maxE));
      const EL = clamp(14 / Math.max(gap(run(0, 1, false)), 1e-5), 10, 6000);
      const poly0 = run(EA, EL, false), poly1 = run(EA, EL, true), poly2 = S.map(q => ({ x: q.x, y: q.y })).concat([{ x: S[0].x, y: S[0].y }]);
      const worst = err.reduce((m, e, i) => Math.abs(e) > Math.abs(err[m]) ? i : m, 0);
      adj = { n, sg, beta, d, err, fb, tol, ok: Math.abs(fb) <= tol, v, fx, fy, fabs, Pm, N, okL: N >= 2000, poly0, poly1, poly2, worst, t: again ? 1.2 : 0, speed: again ? 1.6 : 1, marks: {} };
      st = 'adjust'; resCache = null; api.sfx('paper');
      const all = S.concat(wd.region, poly0); zoomBox = ptsBox(all, 26);
      zoomBox = [Math.max(-10, zoomBox[0]), Math.max(-10, zoomBox[1]), Math.min(ww + 10, zoomBox[2]), Math.min(WH + 10, zoomBox[3])];
    }
    function updAdjust(dt) {
      const A = adj; A.t += dt * A.speed;
      const once = (k, f) => { if (!A.marks[k]) { A.marks[k] = 1; f(); } };
      if (A.t > 2.0) once('v', () => { api.sfx(A.ok ? 'good' : 'bad'); if (!A.ok) api.shake(4); });
      for (let i = 0; i < A.n; i++) if (A.t > 2.1 + i * 1.3 / A.n) once('c' + i, () => api.sfx('beep'));
      if (A.t > 4.0) once('l', () => api.sfx('measure'));
      if (A.t >= ADJ_END) { st = 'review'; api.sfx('paper'); }
    }
    const canRe = () => adj && tUsed < LIMIT - 8 && Math.abs(adj.err[adj.worst]) > 0;
    function remeasure() {
      if (!canRe()) return;
      const k = adj.worst; reK = k; cur = k; pendAim = k; st = 'place'; api.sfx('select');
      say(`Перемеряем угол на ${stName(k)}`, TH.accent, 2.5);
    }

    // ---------- итог ----------
    function finish() {
      if (finished) return; finished = true;
      const n = S.length, done = closed && adj;
      const lines = [];
      let score = 0, stars = 0;
      const errs = []; for (const r of ang) if (r) errs.push(Math.abs(r.eb), Math.abs(r.ef));
      const mAim = errs.length ? errs.reduce((s, e) => s + e, 0) / errs.length : 0;
      if (!done) {
        const prog = clamp(Math.abs(swept()) / TAU, 0, 1);
        score = Math.round(160 * prog);
        lines.push(closed ? 'Время вышло: углы измерены не все' : 'Время вышло: ход не замкнут', `Станций ${n - 1}, обойдено ${Math.round(prog * 100)} % участка`);
        if (errs.length) lines.push(`Точность наведения ±${Math.round(mAim)}″`);
      } else {
        const P = perim(S, true);
        // точность — главное: наведение «на авось» не окупается и скоростью (бонус за время умножается на качество наведения)
        const qAim = clamp(1 - (mAim - 4) / 20, 0, 1);
        const A = 250 * clamp(1 - Math.abs(adj.fb) / adj.tol, 0, 1) + 250 * qAim;
        const Sx = clamp(150 - 40 * Math.max(0, n - refN), 0, 150);
        const Lx = 100 * clamp(1 - 2.5 * Math.max(0, P / refP - 1), 0, 1);
        const tGood = 12 + refN * 6.5;                              // темп хорошего полевика для этого участка, с
        const Tx = 250 * clamp(1 - (tUsed - tGood) / (TREF - tGood), 0, 1) * (0.3 + 0.7 * qAim);
        score = Math.round(A + Sx + Lx + Tx);
        if (!adj.ok) score = Math.min(score, 240);
        stars = !adj.ok ? 0 : score >= 800 ? 3 : score >= 550 ? 2 : 1;
        lines.push(`fβ = ${fmtSec(adj.fb)}, допуск ${fmtTol(adj.tol)} — ${adj.ok ? 'в допуске' : 'не принят'}`);
        lines.push(`Станций ${n} (эталон ${refN}) · ход ${fmtM(P)} м`);
        lines.push(`fабс/P = 1/${adj.N} (допуск 1/2000)`);
        lines.push(`Время ${fmtTime(tUsed)} · наведение ±${Math.round(mAim)}″`);
      }
      const snap = { S: S.map(q => ({ x: q.x, y: q.y })), adj, closed: !!done, ang: ang.slice() };
      api.finish({ score, stars, lines, drawResult: (ctx, x, y, w, h) => drawResult(ctx, x, y, w, h, snap) });
    }

    // ---------- кнопки ----------
    const btnUndo = () => undoAt.x > 20 ? { x: api.W - 104, y: api.H - 50, w: 96, h: 42 } : { x: 8, y: api.H - 50, w: 96, h: 42 };
    function btnsReview() {
      const pw = panelW(), x = api.W - pw - 8 + 12, w = pw - 24, yb = api.H - 12 - 6;
      const sub2 = { x, y: yb - 44, w, h: 42 }, re = { x, y: yb - 94, w, h: 42 };
      return { sub: sub2, re };
    }

    // ---------- отрисовка: подписи ----------
    function htext(ctx, s, x, y, size, color, align = 'center', weight = 'bold') {
      ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.textAlign = align; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2.4, size * 0.32); ctx.strokeStyle = 'rgba(12,10,8,.85)'; ctx.strokeText(s, x, y);
      ctx.fillStyle = color; ctx.fillText(s, x, y);
    }
    function pill(ctx, s, x, y, size, color, bg = 'rgba(18,13,9,.86)', border) {
      ctx.font = `bold ${size}px system-ui, sans-serif`; const w = ctx.measureText(s).width + size * 1.2, h = size * 1.6;
      const x0 = clamp(x - w / 2, 4, api.W - w - 4);
      api.roundRect(ctx, x0, y - h * 0.68, w, h, h * 0.45); ctx.fillStyle = bg; ctx.fill();
      if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1.2; ctx.stroke(); }
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(s, x0 + w / 2, y);
    }

    // ---------- отрисовка: мир ----------
    function drawRegion(ctx, lw) {
      const p = wd.region;
      ctx.beginPath(); p.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
      ctx.fillStyle = 'rgba(255,96,64,.07)'; ctx.fill();
      ctx.lineJoin = 'round'; ctx.setLineDash([]); ctx.lineWidth = 4 * lw; ctx.strokeStyle = 'rgba(30,10,6,.35)'; ctx.stroke();
      ctx.setLineDash([8 * lw, 5 * lw]); ctx.lineWidth = 2.2 * lw; ctx.strokeStyle = '#ff5a3c'; ctx.stroke(); ctx.setLineDash([]);
    }
    function hiObst(ctx, o, lw, al) { // подсветка того, что помешало
      ctx.save(); ctx.globalAlpha = al; ctx.strokeStyle = '#ff3b30'; ctx.fillStyle = 'rgba(255,59,48,.22)'; ctx.lineWidth = 2.2 * lw;
      if (o === 'region') { ctx.beginPath(); wd.region.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      else if (o.t === 'r') { ctx.fillRect(o.x, o.y, o.w, o.h); ctx.strokeRect(o.x, o.y, o.w, o.h); }
      else if (o.t === 'c') { ctx.beginPath(); ctx.arc(o.x, o.y, Math.max(o.r, 4) / 0.7, 0, TAU); ctx.fill(); ctx.stroke(); }
      else if (o.t === 'l' || o.t === 'b') { ctx.beginPath(); o.pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.lineWidth = (o.t === 'b' ? o.w * 2 : 3) * lw; ctx.globalAlpha = al * 0.7; ctx.stroke(); }
      else if (o.t === 'p') { ctx.beginPath(); o.pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
    function drawSides(ctx, lw) {
      const n = S.length; if (n < 2 && !closed) return;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const path = () => { ctx.beginPath(); S.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); if (closed) ctx.closePath(); };
      path(); ctx.lineWidth = 4.2 * lw; ctx.strokeStyle = 'rgba(20,12,4,.55)'; ctx.stroke();
      path(); ctx.lineWidth = 2 * lw; ctx.strokeStyle = '#ffd84a'; ctx.stroke();
    }
    function drawStake(ctx, q, lw) { // временный знак: колышек с гвоздём
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.arc(q.x + 1, q.y + 1, 2.8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c98d4a'; ctx.beginPath(); ctx.arc(q.x, q.y, 2.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff3d6'; ctx.lineWidth = 0.9 * lw; ctx.stroke();
      ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.arc(q.x, q.y, 0.8, 0, TAU); ctx.fill();
    }
    // кэш спрайтов людей и прибора: ключ — вид, угол (шаг 5°), фаза шага; рисуются один раз в текущем масштабе
    const SPR = new Map();
    function sprite(ctx, key, x, y, r, fn) {
      const m = ctx.getTransform(), k = Math.hypot(m.a, m.b), fk = key + '@' + k.toFixed(3);
      let c = SPR.get(fk);
      if (!c) {
        const px = Math.max(2, Math.ceil(2 * r * k)); c = document.createElement('canvas'); c.width = c.height = px;
        const gg = c.getContext('2d'); gg.setTransform(k, 0, 0, k, px / 2, px / 2); fn(gg);
        SPR.set(fk, c); if (SPR.size > 400) SPR.delete(SPR.keys().next().value);
      }
      ctx.drawImage(c, x - r, y - r, 2 * r, 2 * r);
    }
    const qa = a => Math.round(((a % TAU) + TAU) % TAU / (TAU / 72)) % 72, qp = t => t ? 1 + Math.floor((((t * 9) % TAU) + TAU) % TAU / (TAU / 10)) : 0;
    function man(ctx, m, opt, vk) { const d = qa(m.dir), ph = qp(m.mv ? m.t : 0); sprite(ctx, `sv${vk}|${d}|${ph}|${opt.pole ? 1 : 0}`, m.x, m.y, opt.pole ? 26 : 9, gg => Sym.surveyorTop(gg, 0, 0, d * TAU / 72, ph ? (ph - 0.5) * (TAU / 10) / 9 : 0, opt)); }
    function drawCrew(ctx) {
      const c = crew;
      if (forest) { const d = qa(c.dog.dir), ph = c.dog.mv ? Math.floor(c.dog.t * 14 / 0.6) % 10 : 0; sprite(ctx, `dog|${d}|${ph}`, c.dog.x, c.dog.y, 7, gg => Sym.dogTop(gg, 0, 0, d * TAU / 72, ph * 0.6 / 14, '#b5783e')); }
      for (const [m, vest, helmet, vk] of [[c.hb, '#c8f03a', '#ffd23a', 'b'], [c.hf, '#3ac8ff', '#f5f3ec', 'f']]) man(ctx, m, { pole: !m.mv, scale: 2, vest, helmet }, vk);
      if (c.ins.mv) { // штатив несут на плече
        man(ctx, c.op, { scale: 2 }, 'o');
        const a = c.op.dir, px = -Math.sin(a) * 2.6, py = Math.cos(a) * 2.6;
        ctx.strokeStyle = '#d9a33a'; ctx.lineWidth = 0.9; ctx.lineCap = 'round'; ctx.beginPath();
        for (const o of [-0.5, 0, 0.5]) { ctx.moveTo(c.op.x + px + Math.cos(a) * 7 - py * o * 0.2, c.op.y + py + Math.sin(a) * 7 + px * o * 0.2); ctx.lineTo(c.op.x + px - Math.cos(a) * 7, c.op.y + py - Math.sin(a) * 7); }
        ctx.stroke(); ctx.fillStyle = '#e8b915'; ctx.fillRect(c.op.x + px + Math.cos(a) * 6 - 1.5, c.op.y + py + Math.sin(a) * 6 - 1.5, 3, 3);
      } else {
        const ai = qa(insAim), on = Math.sin(T * 6) > 0 ? 1 : 0;
        sprite(ctx, `tp|${ai}|${on}`, c.ins.x, c.ins.y, 20, gg => Sym.tripodTop(gg, 0, 0, on ? 0.2 : 0.7, { aim: ai * TAU / 72, scale: 2 }));
        man(ctx, c.op, { scale: 2 }, 'o');
      }
    }
    function drawTraffic(ctx) {
      for (const c of cars) { const p = carPos(c); Sym.car(ctx, p.x, p.y, c.ln.h ? (c.ln.dir > 0 ? 0 : Math.PI) : (c.ln.dir > 0 ? Math.PI / 2 : -Math.PI / 2), c.col, c.seed); }
      for (const p of peds) {
        const x = p.wk.h ? p.s : p.wk.c, y = p.wk.h ? p.wk.c : p.s, dir = p.wk.h ? (p.dir > 0 ? 0 : Math.PI) : (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        const ph = Math.floor(((p.t * 9) % TAU) / (TAU / 8));
        sprite(ctx, `pd|${p.seed}|${qa(dir)}|${ph}|${p.dog ? 1 : 0}`, x, y, 12, gg => {
          gg.scale(1.5, 1.5); Sym.personTop(gg, 0, 0, dir, (ph + 0.5) * (TAU / 8) / 9, p.seed);
          if (p.dog) Sym.dogTop(gg, Math.cos(dir) * 5 - Math.sin(dir) * 3, Math.sin(dir) * 5 + Math.cos(dir) * 3, dir, (ph + 0.5) * (TAU / 8) / 9, '#e8e0d0');
        });
      }
    }
    function curPoly() { // ход в анимации уравнивания
      const A = adj, k1 = ease((A.t - 2.0) / 1.4), k2 = ease((A.t - 3.6) / 1.0);
      return A.poly0.map((p, i) => { const q = A.poly1[i], r = A.poly2[i]; const x = p.x + (q.x - p.x) * k1, y = p.y + (q.y - p.y) * k1; return { x: x + (r.x - x) * k2, y: y + (r.y - y) * k2 }; });
    }
    function drawAdjustWorld(ctx, lw) {
      const A = adj, n = A.n;
      ctx.fillStyle = 'rgba(8,12,8,.42)'; ctx.fillRect(-10, -10, ww + 20, WH + 20);
      drawRegion(ctx, lw);
      // истинный ход — бледно
      ctx.beginPath(); S.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
      ctx.setLineDash([4 * lw, 4 * lw]); ctx.lineWidth = 1.2 * lw; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke(); ctx.setLineDash([]);
      const P = curPoly(), k0 = clamp(A.t / 1.2, 0, 1) * n;
      ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y);
      for (let i = 1; i <= n; i++) { if (i - 1 > k0) break; const f = Math.min(1, k0 - (i - 1)); ctx.lineTo(P[i - 1].x + (P[i].x - P[i - 1].x) * f, P[i - 1].y + (P[i].y - P[i - 1].y) * f); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = 4.4 * lw; ctx.strokeStyle = 'rgba(20,12,4,.6)'; ctx.stroke();
      ctx.lineWidth = 2.2 * lw; ctx.strokeStyle = A.t > 4.6 ? '#6cff8a' : '#ffd84a'; ctx.stroke();
      for (let i = 0; i < n && i <= k0; i++) { ctx.fillStyle = '#fff2c0'; ctx.beginPath(); ctx.arc(P[i].x, P[i].y, 2.6 * lw, 0, TAU); ctx.fill(); }
      if (k0 >= n) { // невязка — разрыв в конце хода
        const e = P[n], gg = hyp(e.x - S[0].x, e.y - S[0].y);
        if (gg > 1.5) { ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 2.4 * lw; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(S[0].x, S[0].y); ctx.stroke(); ctx.fillStyle = '#ff3b30'; ctx.beginPath(); ctx.arc(e.x, e.y, 3 * lw, 0, TAU); ctx.fill(); }
      }
      Sym.marker(ctx, g.x, g.y, 'ggs');
    }
    function drawPreview(ctx, lw) {
      if (!hover || st !== 'place' || pendAim >= 0 || closed) return;
      const a = S[S.length - 1], snapG = S.length >= 3 && hyp(hover.x - g.x, hover.y - g.y) < SNAP, p = snapG ? g : hover;
      const r = hover.res;
      ctx.lineCap = 'round';
      ctx.lineWidth = 4 * lw; ctx.strokeStyle = 'rgba(10,6,4,.5)'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      if (!r.ok) ctx.setLineDash([6 * lw, 4 * lw]);
      ctx.lineWidth = 2.2 * lw; ctx.strokeStyle = r.ok ? '#6cff8a' : '#ff6b5b'; ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 * lw, 0, TAU); ctx.lineWidth = 1.6 * lw; ctx.stroke();
      if (!r.ok && r.hit) hiObst(ctx, r.hit, lw, 0.75);
      if (r.side != null) { const q0 = S[r.side], q1 = S[r.side + 1]; ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 4 * lw; ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y); ctx.stroke(); }
    }
    function drawFlash(ctx, lw) {
      if (!flash) return;
      const al = Math.min(1, flash.t / 0.6), { a, b, res } = flash;
      ctx.globalAlpha = al; ctx.lineCap = 'round';
      ctx.lineWidth = 2.4 * lw; ctx.strokeStyle = '#ff3b30'; ctx.setLineDash([6 * lw, 4 * lw]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.lineWidth = 2.6 * lw; ctx.beginPath(); ctx.moveTo(b.x - 5, b.y - 5); ctx.lineTo(b.x + 5, b.y + 5); ctx.moveTo(b.x + 5, b.y - 5); ctx.lineTo(b.x - 5, b.y + 5); ctx.stroke();
      ctx.globalAlpha = 1;
      if (res.hit) hiObst(ctx, res.hit, lw, al * (0.6 + 0.4 * Math.sin(T * 14)));
      if (res.side != null) { const q0 = S[res.side], q1 = S[res.side + 1]; if (q1) { ctx.globalAlpha = al; ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 4 * lw; ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y); ctx.stroke(); ctx.globalAlpha = 1; } }
    }
    function drawRange(ctx, lw) {
      if (st !== 'place' || closed || pendAim >= 0) return;
      const a = S[S.length - 1];
      ctx.beginPath(); ctx.arc(a.x, a.y, DMAX, 0, TAU); ctx.arc(a.x, a.y, DMIN, 0, TAU, true);
      ctx.fillStyle = 'rgba(255,255,230,.07)'; ctx.fill();
      ctx.lineWidth = 1.3 * lw; ctx.setLineDash([5 * lw, 5 * lw]);
      ctx.strokeStyle = 'rgba(255,255,240,.5)'; ctx.beginPath(); ctx.arc(a.x, a.y, DMAX, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,140,110,.6)'; ctx.beginPath(); ctx.arc(a.x, a.y, DMIN, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    const closable = () => st === 'place' && !closed && pendAim < 0 && S.length >= 3 && check(wd, S, g, true, 0).ok;
    let closableC = { key: '', v: false };
    function isClosable() { // можно ли сейчас замкнуть ход на пункт (кэш по последней станции)
      const q = S[S.length - 1], key = S.length + ':' + q.x + ',' + q.y;
      if (closableC.key !== key) closableC = { key, v: closable() };
      return closableC.v && st === 'place' && !closed && pendAim < 0;
    }

    // ---------- отрисовка: окуляр ----------
    function eyeGeom() {
      const R0 = 100, sp = toS(S[aim.k]);
      const cx = sp.x < api.W / 2 ? api.W - R0 - 22 : R0 + 22;
      return { cx, cy: api.TOP + 132, R: R0 };
    }
    function eyeScene(ctx, a, R0) {
      const pw = clamp(1500 / a.len, 7, 25), ph = pw * 1.45, yg = ph / 2 + ph * 2.2, yh = yg - Math.max(4, pw * 0.5);
      const sky = ctx.createLinearGradient(0, -R0 * 1.4, 0, yh);
      sky.addColorStop(0, forest ? '#9cc3d8' : '#a9c4d6'); sky.addColorStop(1, forest ? '#dfe9df' : '#e6e6dc');
      ctx.fillStyle = sky; ctx.fillRect(-R0 * 3.2, -R0 * 2.2, R0 * 6.4, yh + R0 * 2.2);
      if (forest) {
        for (const b of a.bg) {
          ctx.fillStyle = b.c; ctx.beginPath(); ctx.moveTo(b.x - b.w, yh); ctx.lineTo(b.x, yh - b.h); ctx.lineTo(b.x + b.w, yh); ctx.closePath(); ctx.fill();
          if (b.trunk) { ctx.fillStyle = '#e8e4da'; ctx.fillRect(b.x + b.w * 0.6, yh - b.h * 0.6, 3, b.h * 0.6); ctx.fillStyle = '#333'; ctx.fillRect(b.x + b.w * 0.6, yh - b.h * 0.4, 3, 1.4); }
        }
        ctx.fillStyle = '#26402c'; ctx.fillRect(-R0 * 3.2, yh - 12, R0 * 6.4, 14);
        const gr = ctx.createLinearGradient(0, yh, 0, yh + R0); gr.addColorStop(0, '#7f9a52'); gr.addColorStop(1, '#4f6e34');
        ctx.fillStyle = gr; ctx.fillRect(-R0 * 3.2, yh, R0 * 6.4, R0 * 2);
      } else {
        for (const b of a.bg) {
          ctx.fillStyle = b.c; ctx.fillRect(b.x, yh - b.h, b.w, b.h);
          ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(b.x, yh - b.h, b.w, 4);
          ctx.fillStyle = 'rgba(70,90,110,.55)'; ctx.beginPath();
          for (let wy = yh - b.h + 10; wy < yh - 16; wy += 15) for (let wx = b.x + 6; wx < b.x + b.w - 8; wx += 12) ctx.rect(wx, wy, 6, 8);
          ctx.fill();
          if (b.tree) { ctx.fillStyle = 'rgba(60,96,52,.9)'; ctx.beginPath(); ctx.arc(b.x + b.w / 2, yh - 26, 18, 0, TAU); ctx.arc(b.x + b.w / 2 + 12, yh - 20, 13, 0, TAU); ctx.fill(); ctx.fillStyle = '#5a4632'; ctx.fillRect(b.x + b.w / 2 - 2, yh - 12, 4, 12); }
        }
        const gr = ctx.createLinearGradient(0, yh, 0, yh + R0); gr.addColorStop(0, '#8a8a86'); gr.addColorStop(1, '#5d5e5c');
        ctx.fillStyle = gr; ctx.fillRect(-R0 * 3.2, yh, R0 * 6.4, R0 * 2);
        ctx.fillStyle = '#c9c4b6'; ctx.fillRect(-R0 * 3.2, yh, R0 * 6.4, 3);
      }
      // помощник с вешкой и визирной маркой
      const px = pw * 1.15;
      ctx.fillStyle = '#2f3b4a'; api.roundRect(ctx, px - pw * 0.35, -ph * 0.3, pw * 0.7, ph * 1.3, pw * 0.2); ctx.fill();
      ctx.fillStyle = '#3ac8ff'; ctx.fillRect(px - pw * 0.35, -ph * 0.1, pw * 0.7, ph * 0.6);
      ctx.fillStyle = '#e1b38e'; ctx.beginPath(); ctx.arc(px, -ph * 0.5, pw * 0.26, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f5f3ec'; ctx.beginPath(); ctx.arc(px, -ph * 0.6, pw * 0.27, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#2f3b4a'; ctx.fillRect(px - pw * 0.3, ph, pw * 0.22, yg - ph); ctx.fillRect(px + pw * 0.08, ph, pw * 0.22, yg - ph);
      const vw = Math.max(1.2, pw * 0.13), top = -ph * 1.6;
      for (let y = top, i = 0; y < yg; y += ph * 0.5, i++) { ctx.fillStyle = i % 2 ? '#f4f1ea' : '#d6332a'; ctx.fillRect(-vw / 2, y, vw, Math.min(ph * 0.5, yg - y)); }
      ctx.fillStyle = '#f3efe4'; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      ctx.fillStyle = '#d2322b'; ctx.beginPath(); ctx.moveTo(-pw / 2, -ph / 2); ctx.lineTo(pw / 2, -ph / 2); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1d1d1d'; ctx.fillRect(-Math.max(0.6, pw * 0.07), -ph / 2, Math.max(1.2, pw * 0.14), ph);
      ctx.strokeStyle = '#1d1d1d'; ctx.lineWidth = Math.max(0.6, pw * 0.05); ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
    }
    function drawOcc(ctx, a, cx, cy, R0) {
      const o = occX(a, R0); if (!o) return;
      ctx.save();
      if (a.occ.kind === 'car') { // проезжающая рядом машина — крупно и не в фокусе
        const x = cx + o.x, w = o.w, col = a.occ.col || (a.occ.col = ['#8e2f2a', '#2d4f7c', '#5c6166', '#c9c4b8', '#2f5a3a'][Math.floor(Math.random() * 5)]);
        ctx.globalAlpha = 0.95; ctx.fillStyle = col; api.roundRect(ctx, x - w / 2, cy - R0 * 0.2, w, R0 * 1.0, 30); ctx.fill();
        api.roundRect(ctx, x - w * 0.34, cy - R0 * 0.66, w * 0.6, R0 * 0.56, 26); ctx.fill();
        ctx.fillStyle = 'rgba(170,200,220,.85)'; api.roundRect(ctx, x - w * 0.3, cy - R0 * 0.6, w * 0.24, R0 * 0.38, 10); ctx.fill(); api.roundRect(ctx, x - w * 0.02, cy - R0 * 0.6, w * 0.24, R0 * 0.38, 10); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x - w / 2 + 14, cy - R0 * 0.12, w - 28, 5);
        ctx.fillStyle = '#16181a'; ctx.beginPath(); ctx.arc(x - w * 0.3, cy + R0 * 0.8, R0 * 0.27, 0, TAU); ctx.arc(x + w * 0.3, cy + R0 * 0.8, R0 * 0.27, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8a8d90'; ctx.beginPath(); ctx.arc(x - w * 0.3, cy + R0 * 0.8, R0 * 0.12, 0, TAU); ctx.arc(x + w * 0.3, cy + R0 * 0.8, R0 * 0.12, 0, TAU); ctx.fill();
      } else if (a.occ.kind === 'ped') {
        const x = cx + o.x;
        ctx.globalAlpha = 0.92; ctx.fillStyle = '#3a3230'; api.roundRect(ctx, x - o.w / 2, cy - R0 * 0.4, o.w, R0 * 1.6, 18); ctx.fill();
        ctx.beginPath(); ctx.arc(x, cy - R0 * 0.62, o.w * 0.34, 0, TAU); ctx.fill();
      } else {
        const x = cx + o.x, y = cy - R0 * 0.08;
        ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x - a.occ.dir * R0 * 1.4, cy - R0 * 1.1); ctx.quadraticCurveTo(x, y - 30, x, y); ctx.stroke();
        for (let i = 0; i < 9; i++) { const an = i * 0.7, rr = 16 + (i % 3) * 6; ctx.fillStyle = i % 2 ? 'rgba(44,80,40,.96)' : 'rgba(64,104,52,.96)'; ctx.beginPath(); ctx.ellipse(x + Math.cos(an) * 24, y + Math.sin(an * 1.3) * 22, rr, rr * 0.7, an, 0, TAU); ctx.fill(); }
      }
      ctx.restore();
    }
    function drawEye(ctx) {
      const a = aim, { cx, cy, R: R0 } = eyeGeom();
      const px0 = cx - R0 - 14, pw = 2 * R0 + 28, py0 = cy - R0 - 30, ph = 2 * R0 + 94;
      api.roundRect(ctx, px0, py0, pw, ph, 14); ctx.fillStyle = 'rgba(18,14,10,.9)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,176,46,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
      api.text(ctx, `${stName(a.k)} · угол β${sub(a.k)}${a.re ? ' (повтор)' : ''}`, cx, py0 + 19, 13, TH.accent);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R0, 0, TAU); ctx.clip();
      const live = !(a.frozen > 0 || a.sum > 0), s = live ? sway(a) : a.fz, pan = live ? panOff(a, R0) : 0;
      ctx.save(); ctx.translate(cx + s.x + pan, cy + s.y); eyeScene(ctx, a, R0); ctx.restore();
      if (live) drawOcc(ctx, a, cx, cy, R0);
      if (live && a.gust && a.t > a.gust.t0 && a.t < a.gust.t0 + a.gust.dur) { // листья в порыве ветра
        ctx.fillStyle = 'rgba(90,130,50,.85)';
        for (let i = 0; i < 7; i++) { const u = (a.t - a.gust.t0) * 260 * Math.sign(a.gust.amp) + i * 61; const x = cx + ((u % (2 * R0)) + 2 * R0) % (2 * R0) - R0, y = cy - R0 * 0.7 + i * 26 + Math.sin(a.t * 9 + i) * 6; ctx.beginPath(); ctx.ellipse(x, y, 3.4, 1.6, a.t * 6 + i, 0, TAU); ctx.fill(); }
      }
      const vg = ctx.createRadialGradient(cx, cy, R0 * 0.55, cx, cy, R0); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)');
      ctx.fillStyle = vg; ctx.fillRect(cx - R0, cy - R0, 2 * R0, 2 * R0);
      // сетка нитей: биссектор сверху, одинарная нить снизу, дальномерные штрихи
      ctx.strokeStyle = 'rgba(12,12,12,.92)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + R0);
      ctx.moveTo(cx - 2.6, cy - R0); ctx.lineTo(cx - 2.6, cy - 3); ctx.moveTo(cx + 2.6, cy - R0); ctx.lineTo(cx + 2.6, cy - 3);
      ctx.moveTo(cx - R0, cy); ctx.lineTo(cx + R0, cy);
      ctx.moveTo(cx - 13, cy - R0 * 0.36); ctx.lineTo(cx + 13, cy - R0 * 0.36); ctx.moveTo(cx - 13, cy + R0 * 0.36); ctx.lineTo(cx + 13, cy + R0 * 0.36);
      ctx.stroke();
      const e = a.eps[a.step];
      if (a.frozen > 0 && e != null) { // промах — скобка от нити до оси марки
        const ae = Math.abs(e), col = ae <= 10 ? TH.good : ae <= 25 ? '#ffd24a' : TH.bad, x1 = cx + a.fz.x, y = cy + R0 * 0.2;
        ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(cx, y - 6); ctx.lineTo(cx, y + 6); ctx.moveTo(x1, y - 6); ctx.lineTo(x1, y + 6); ctx.moveTo(cx, y); ctx.lineTo(x1, y); ctx.stroke();
        htext(ctx, fmtSec(e), cx, cy + R0 * 0.55, 24, col);
        htext(ctx, 'отсчёт ' + fmtDMS(a.read[a.step]), cx, cy + R0 * 0.8, 11, '#e8f4ff', 'center', '600');
        htext(ctx, ae <= 5 ? 'Точно!' : ae <= 10 ? 'Хорошо' : ae <= 25 ? 'Неточно' : 'Промах!', cx, cy - R0 * 0.48, 14, col);
      }
      if (a.sum > 0) {
        ctx.fillStyle = 'rgba(14,10,8,.72)'; ctx.fillRect(cx - R0, cy - 34, 2 * R0, 68);
        const d = a.eps[0] - a.eps[1], beta = trueBeta(a.k, closed ? (polyArea(S) > 0 ? 1 : -1) : (swept() >= 0 ? 1 : -1)) + d / RHO;
        htext(ctx, `β${sub(a.k)} = ${fmtDMS(beta)}`, cx, cy - 6, 16, TH.ink);
        htext(ctx, `ошибка угла ${fmtSec(d)}`, cx, cy + 20, 14, Math.abs(d) <= 15 ? TH.good : Math.abs(d) <= 35 ? '#ffd24a' : TH.bad);
      }
      ctx.restore();
      if (live && a.gust && a.t > a.gust.t0 && a.t < a.gust.t0 + a.gust.dur) htext(ctx, 'Порыв ветра!', cx, cy - R0 * 0.72, 13, '#ffd76a');
      if (a.msg) htext(ctx, a.msg.text, cx, cy - R0 * 0.48, 13, '#ff8a7a');
      // оправа окуляра
      ctx.lineWidth = 8; ctx.strokeStyle = '#1b1d20'; ctx.beginPath(); ctx.arc(cx, cy, R0 + 3, 0, TAU); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(cx, cy, R0 + 6.5, Math.PI * 1.05, Math.PI * 1.7); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < 48; i++) { const an = i * TAU / 48; ctx.moveTo(cx + Math.cos(an) * (R0 + 1), cy + Math.sin(an) * (R0 + 1)); ctx.lineTo(cx + Math.cos(an) * (R0 + 5.5), cy + Math.sin(an) * (R0 + 5.5)); }
      ctx.stroke();
      // подписи: назад / вперёд
      const ly = cy + R0 + 24;
      const row = (i, y) => {
        const idx = i ? a.f : a.b, e2 = a.eps[i], cur2 = a.step === i && !(a.sum > 0);
        const L = hyp(S[idx].x - S[a.k].x, S[idx].y - S[a.k].y);
        api.text(ctx, `${i ? 'Вперёд' : 'Назад'} → ${stName(idx)} (${fmtM(L)} м)`, px0 + 14, y, 12, cur2 ? TH.accent : TH.dim, 'left');
        if (e2 != null) { const ae = Math.abs(e2); api.text(ctx, fmtSec(e2), px0 + pw - 14, y, 13, ae <= 10 ? TH.good : ae <= 25 ? '#ffd24a' : TH.bad, 'right'); }
        else if (cur2) api.text(ctx, '…', px0 + pw - 14, y, 13, TH.accent, 'right');
      };
      row(0, ly); row(1, ly + 18);
      const hint = a.sum > 0 ? 'Угол записан в журнал' : a.frozen > 0 ? 'Отсчёт снят' : (api.IS_TOUCH ? 'Тап — ось марки между нитями' : 'Клик — ось марки между нитями');
      api.text(ctx, hint, cx, ly + 38, 11, a.sum > 0 || a.frozen > 0 ? TH.good : TH.ink, 'center', '600');
      // линия визирования на карте
    }

    // ---------- отрисовка: ведомость уравнивания ----------
    function drawPanel(ctx) {
      const A = adj, pw = panelW(), x = api.W - pw - 8, y = api.TOP + 6, h = api.H - api.TOP - 12;
      Sym.plan.paper(ctx, x, y, pw, h, { stamp: false, grid: -1, margin: 4 });
      const L = x + 14, Rr = x + pw - 14; let yy = y + 26;
      const line = (s, size, color, t0, align = 'left', weight = 'bold') => {
        if (A.t >= t0) { ctx.font = `${weight} ${size}px system-ui, sans-serif`; const k = Math.min(1, (Rr - L) / Math.max(1, ctx.measureText(s).width)); api.text(ctx, s, align === 'left' ? L : align === 'right' ? Rr : x + pw / 2, yy, size * k, color, align, weight); }
        yy += size + 5;
      };
      const fs = pw < 262 ? 10.5 : 11.5, fb2 = fs + 1, col = A.ok ? '#1d7a36' : '#b3261e';
      line('УРАВНИВАНИЕ ХОДА', 13, INK, 0, 'center');
      yy += 2;
      line(`n = ${A.n} станций · P = ${(A.Pm).toFixed(1).replace('.', ',')} м`, fs, INK, 0, 'left', '600');
      const sumM = A.beta.reduce((q, b) => q + b, 0) + A.fb / RHO;
      line(`Σβ изм. = ${fmtDMS(sumM, true)}`, fs, INK, 0.3, 'left', '600');
      line(`Σβ теор. = 180°·${A.n - 2} = ${fmtDMS((A.n - 2) * Math.PI, true)}`, fs, INK, 0.6, 'left', '600');
      yy += 3;
      line(`fβ = ${fmtSec(A.fb)}  (доп. ±1′√${A.n} = ${fmtTol(A.tol)})`, fb2, col, 1.2);
      line(A.ok ? '✓ Угловая невязка в допуске' : '✗ Допуск превышен!', fb2, col, 2.0);
      const vmin = Math.min(...A.v), vmax = Math.max(...A.v);
      line(`Поправки v: ${vmin === vmax ? fmtSec(vmin) : fmtSec(vmin) + '…' + fmtSec(vmax)}, Σv = ${fmtSec(-A.fb)}`, fs, '#7a3d12', 2.2, 'left', '600');
      yy += 3;
      line(`fx = ${fmtMm(A.fx)}   fy = ${fmtMm(A.fy)} м`, fs, INK, 3.7, 'left', '600');
      line(`fабс = ${A.fabs.toFixed(3).replace('.', ',')} м · fабс/P = 1/${A.N}`, fs, INK, 3.9, 'left', '600');
      line(`${A.okL ? '✓' : '✗'} Линейная в допуске 1/2000`.replace('✗ Линейная в допуске', '✗ Линейная больше допуска'), fb2, A.okL ? '#1d7a36' : '#b3261e', 4.3);
      if (st === 'review') {
        const b = btnsReview();
        if (canRe()) api.button(ctx, b.re, `Перемерить ${stName(A.worst)} (${fmtSec(A.err[A.worst])})`, { color: A.ok ? '#c98a2a' : TH.accent, active: !A.ok });
        api.button(ctx, b.sub, A.ok ? 'Сдать ход ✓' : 'Сдать (не принят)', { color: A.ok ? '#2e9a4a' : '#8a5a4a', active: A.ok });
      } else api.text(ctx, api.IS_TOUCH ? 'тап — пропустить' : 'клик — пропустить', x + pw / 2, y + h - 12, 10, '#7a6a52', 'center', '600');
    }

    // ---------- итоговая схема хода на листе ----------
    function drawResult(ctx, x, y, w, h, snap) {
      const key = w + 'x' + h;
      if (!resCache || resCache.key !== key) resCache = { key, layer: api.layer(w, h + 6, c => drawScheme(c, w, h, snap)) };
      ctx.drawImage(resCache.layer.canvas, x, y, w, h + 6);
    }
    function drawScheme(c, w, h, snap) {
      const P = snap.S, A = snap.adj, n = P.length, lab = Sym.plan.label;
      Sym.plan.paper(c, 0, 0, w, h, { stamp: false, grid: -1, margin: 5 });
      lab(c, w / 2, 16, 'Схема теодолитного хода', 9, INK, 0, 700);
      lab(c, w / 2, 26, (forest ? 'поляна в лесу' : 'городской квартал') + ' · М 1:' + (forest ? 2000 : 1000), 6, INK, 0, 500);
      // окно схемы: ход + участок
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of P.concat(wd.region)) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
      x0 -= 18; y0 -= 18; x1 += 18; y1 += 18;
      const rows = A ? n : 0, rowH = rows > 9 ? 7 : 8, tabH = A ? 14 + rows * rowH + 22 : 16;
      const bx = 10, by = 32, bw = w - 20, bh = h - by - tabH - 10;
      const ix = bx + 16, iy = by + 10, iw = bw - 40, ih = bh - 22;                 // поля под подписи станций и стрелку севера
      const k = Math.min(iw / (x1 - x0), ih / (y1 - y0)), ox = ix + (iw - (x1 - x0) * k) / 2 - x0 * k, oy = iy + (ih - (y1 - y0) * k) / 2 - y0 * k;
      const T2 = q => ({ x: ox + q.x * k, y: oy + q.y * k });
      c.save(); c.beginPath(); c.rect(bx, by, bw, bh); c.clip();
      for (const f of wd.pf) {
        if (f.t === 'road') Sym.plan.road(c, f.pts.map(T2), f.w * k, null);
        else if (f.t === 'water') Sym.plan.water(c, f.pts.map(T2), Math.max(2, f.w * k));
      }
      for (const f of wd.pf) {
        if (f.t === 'house') { const r = f.r, q = [T2({ x: r.x, y: r.y }), T2({ x: r.x + r.w, y: r.y }), T2({ x: r.x + r.w, y: r.y + r.h }), T2({ x: r.x, y: r.y + r.h })]; Sym.plan.house(c, q, r.w * k > 14 && r.h * k > 8 ? f.label : ''); }
        else if (f.t === 'tree') { const q = T2(f); Sym.plan.tree(c, q.x, q.y, f.kind); }
        else if (f.t === 'fence') Sym.plan.fence(c, f.pts.map(T2), f.kind);
        else if (f.t === 'pond') { c.beginPath(); f.pts.map(T2).forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); c.fillStyle = 'rgba(120,180,230,.55)'; c.fill(); c.strokeStyle = Sym.colors.blue; c.lineWidth = 0.6; c.stroke(); }
        else if (f.t === 'swamp') {
          const q = f.pts.map(T2), b = ptsBox(q, 0);
          c.save(); c.beginPath(); q.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); c.clip();
          c.strokeStyle = Sym.colors.blue; c.lineWidth = 0.5; c.beginPath();
          for (let yy = b[1] + 2; yy < b[3]; yy += 3) for (let xx = b[0] + ((yy * 7) % 4); xx < b[2]; xx += 6) { c.moveTo(xx, yy); c.lineTo(xx + 3, yy); }
          c.stroke(); c.restore();
        }
      }
      // участок
      c.beginPath(); wd.region.map(T2).forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath();
      c.fillStyle = 'rgba(214,64,47,.08)'; c.fill(); c.setLineDash([4, 2.5]); c.strokeStyle = '#c0392b'; c.lineWidth = 1; c.stroke(); c.setLineDash([]);
      const rcs = T2(wd.rc); lab(c, rcs.x, rcs.y, 'участок съёмки', 6.5, '#a8321f', 0, 600);
      // ход
      const Q = P.map(T2);
      c.beginPath(); Q.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); if (snap.closed) c.closePath();
      c.strokeStyle = INK; c.lineWidth = 1.3; c.lineJoin = 'round'; c.stroke();
      for (let i = 0; i < n - (snap.closed ? 0 : 1); i++) { // длины сторон
        const a = Q[i], b = Q[(i + 1) % n], L = hyp(P[(i + 1) % n].x - P[i].x, P[(i + 1) % n].y - P[i].y);
        let an = Math.atan2(b.y - a.y, b.x - a.x); if (an > Math.PI / 2 || an < -Math.PI / 2) an += Math.PI;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, nx = -Math.sin(an) * 4, ny = Math.cos(an) * 4;
        lab(c, mx - nx, my - ny, fmtM(L), 5.5, INK, an, 600);
      }
      const ctr = T2(wd.rc);
      Q.forEach((p, i) => {
        if (i === 0) { // пункт ГГС — треугольник с точкой
          c.beginPath(); c.moveTo(p.x, p.y - 4.6); c.lineTo(p.x + 4, p.y + 2.4); c.lineTo(p.x - 4, p.y + 2.4); c.closePath(); c.fillStyle = '#f5f0e2'; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.8; c.stroke();
          c.fillStyle = INK; c.beginPath(); c.arc(p.x, p.y, 0.8, 0, TAU); c.fill();
        } else { c.beginPath(); c.arc(p.x, p.y, 2.1, 0, TAU); c.fillStyle = '#f5f0e2'; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.8; c.stroke(); c.fillStyle = INK; c.beginPath(); c.arc(p.x, p.y, 0.6, 0, TAU); c.fill(); }
        const ux = p.x - ctr.x, uy = p.y - ctr.y, ul = hyp(ux, uy) || 1, lx = p.x + ux / ul * 9, ly = p.y + uy / ul * 7;
        lab(c, lx, ly, i ? String(i) : 'ГГС', i ? 7 : 6.5, INK, 0, 700);
        if (A && A.v[i] != null) lab(c, lx, ly + 7, fmtSec(A.v[i]), 5.5, '#b3261e', 0, 600);
      });
      // стрелка севера
      c.strokeStyle = INK; c.fillStyle = INK; c.lineWidth = 0.7; c.beginPath(); c.moveTo(bx + bw - 8, by + 18); c.lineTo(bx + bw - 8, by + 4); c.stroke();
      c.beginPath(); c.moveTo(bx + bw - 8, by + 2); c.lineTo(bx + bw - 10.5, by + 7); c.lineTo(bx + bw - 5.5, by + 7); c.closePath(); c.fill();
      lab(c, bx + bw - 8, by + 23, 'С', 5.5, INK, 0, 700);
      c.restore();
      // ведомость углов
      let ty = by + bh + 8;
      if (!A) { lab(c, w / 2, ty + 6, 'Ход не замкнут — уравнивание не выполнено', 7, '#b3261e', 0, 600); return; }
      const cols = [0.08, 0.36, 0.6, 0.86].map(f => 10 + (w - 20) * f);
      c.strokeStyle = INK; c.lineWidth = 0.5; c.beginPath(); c.moveTo(10, ty); c.lineTo(w - 10, ty); c.moveTo(10, ty + 10); c.lineTo(w - 10, ty + 10); c.stroke();
      ['Ст.', 'β изм.', 'v', 'd, м'].forEach((s, i) => lab(c, cols[i], ty + 5.3, s, 6, INK, 0, 700));
      ty += 10;
      for (let i = 0; i < n; i++) {
        const yy = ty + rowH * (i + 0.5) + 0.4, bm = A.beta[i] + A.err[i] / RHO;
        lab(c, cols[0], yy, i ? String(i) : 'ГГС', 5.8, INK, 0, 600);
        lab(c, cols[1], yy, fmtDMS(bm), 5.8, INK, 0, 500);
        lab(c, cols[2], yy, fmtSec(A.v[i]), 5.8, '#b3261e', 0, 600);
        lab(c, cols[3], yy, fmtM(A.d[i]), 5.8, INK, 0, 500);
      }
      ty += rowH * n + 2;
      c.beginPath(); c.moveTo(10, ty); c.lineTo(w - 10, ty); c.stroke();
      lab(c, w / 2, ty + 7, `fβ = ${fmtSec(A.fb)} (доп. ${fmtTol(A.tol)})  ·  fабс/P = 1/${A.N}`, 6.4, A.ok ? '#1d6e30' : '#b3261e', 0, 700);
      lab(c, w / 2, ty + 15, `Σβ изм. = ${fmtDMS(A.beta.reduce((q, b) => q + b, 0) + A.fb / RHO, true)}  ·  Σβ теор. = 180°·(${n}−2) = ${fmtDMS((n - 2) * Math.PI, true)}`, 5.6, INK, 0, 500);
    }

    // ---------- бот ----------
    const B = { plan: ref.slice(), wait: 0.5, dir: 0 };
    function botReplan() {
      const p = bestPlan(wd, S.slice());
      if (p) { B.plan = p; return true; }
      return false;
    }

    // ---------- экземпляр уровня ----------
    const inst = {
      get phase() { return st; },             // для отладки и проб: фаза, попытки генерации, эталон, наведение
      dbg: () => ({ tries, refN, refP, ref, aim, adj, n: S.length, S, view, wd, tUsed, hover }),
      update(dt) {
        if (finished) return;
        T += dt;
        if (st === 'place' || st === 'aim' || st === 'review') { tUsed += dt; if (tUsed >= LIMIT) { tUsed = LIMIT; finish(); return; } }
        viewK = clamp(viewK + (st === 'adjust' || st === 'review' ? dt : -dt) * 2.2, 0, 1);
        updCrew(dt); updTraffic(dt);
        if (toastMsg) { toastMsg.t -= dt; if (toastMsg.t <= 0) toastMsg = null; }
        if (flash) { flash.t -= dt; if (flash.t <= 0) flash = null; }
        if (st === 'place' && pendAim >= 0 && crewOk) startAim(pendAim);
        else if (st === 'aim') updAim(dt);
        else if (st === 'adjust') updAdjust(dt);
      },
      draw(ctx) {
        fitView();
        const W = api.W, s = view.s, lw = 1 / Math.max(0.5, s);
        if (view.ox > 0.5 || view.oy > api.TOP + 0.5 || ww * s < W - 0.5) { ctx.fillStyle = '#1e2619'; ctx.fillRect(0, api.TOP, W, api.H - api.TOP); }
        ctx.save();
        if (viewK > 0) { ctx.beginPath(); ctx.rect(0, api.TOP, W - (panelW() + 10) * ease(viewK), api.H - api.TOP); ctx.clip(); }
        ctx.translate(view.ox, view.oy); ctx.scale(s, s);
        ctx.beginPath(); ctx.rect(0, 0, ww, WH); ctx.clip();
        { // фон: при масштабе 1 — пиксель в пиксель (быстро), иначе (уравнивание, смена размера окна) — с масштабированием
          const m = ctx.getTransform();                                // m.a — пикселей устройства на единицу мира
          if (Math.abs(s - 1) < 1e-6 && m.b === 0 && Math.abs(base.k - m.a) > 1e-3) buildBase(m.a);
          if (Math.abs(m.a - base.k) < 1e-3 && m.b === 0) { ctx.save(); ctx.setTransform(1, 0, 0, 1, Math.round(m.e), Math.round(m.f)); ctx.drawImage(base.canvas, 0, 0); ctx.restore(); }
          else ctx.drawImage(base.canvas, 0, 0, ww, WH);
        }
        drawTraffic(ctx);
        if (st === 'adjust' || st === 'review') drawAdjustWorld(ctx, lw);
        else {
          drawRegion(ctx, lw);
          drawRange(ctx, lw);
          drawSides(ctx, lw);
          drawFlash(ctx, lw);
          drawPreview(ctx, lw);
          if (st === 'aim') { // линия визирования
            const ins = S[aim.k], tq = S[aim.step === 0 ? aim.b : aim.f];
            ctx.setLineDash([3 * lw, 3 * lw]); ctx.lineDashOffset = -T * 20; ctx.strokeStyle = '#7ef0ff'; ctx.lineWidth = 1.8 * lw;
            ctx.beginPath(); ctx.moveTo(ins.x, ins.y); ctx.lineTo(tq.x, tq.y); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
            ctx.strokeStyle = '#7ef0ff'; ctx.lineWidth = 2 * lw; ctx.beginPath(); ctx.arc(tq.x, tq.y, 9 + Math.sin(T * 8) * 2, 0, TAU); ctx.stroke();
          }
          for (let i = 1; i < S.length; i++) drawStake(ctx, S[i], lw);
          // исходный пункт
          if (isClosable()) { ctx.strokeStyle = '#6cff8a'; ctx.lineWidth = 2.2 * lw; ctx.beginPath(); ctx.arc(g.x, g.y, 11 + Math.sin(T * 6) * 3, 0, TAU); ctx.stroke(); }
          ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(g.x, g.y, 8, 0, TAU); ctx.fill();
          Sym.marker(ctx, g.x, g.y, 'ggs');
          drawCrew(ctx);
        }
        ctx.restore();
        // подписи поверх карты
        const gs = toS(g), gl = 'ГГС «' + g.name + '»', gy = gs.y < api.TOP + 22 ? gs.y + 22 : gs.y - 12;
        ctx.font = 'bold 10px system-ui, sans-serif'; const ghw = ctx.measureText(gl).width / 2 + 4, gx = clamp(gs.x, ghw, W - ghw);
        if (st !== 'adjust' && st !== 'review') htext(ctx, gl, gx, gy, 10, '#ffe9a8');      // при уравнивании пункт подписан в метке поправки
        if (st === 'adjust' || st === 'review') {
          const A = adj, P = curPoly(), ctr = toS(wd.rc);
          if (A.t > 1.2) { const e = toS(P[A.n]), gg = hyp(e.x - gs.x, e.y - gs.y); if (gg > 4) htext(ctx, A.t < 3.6 ? 'невязка' : `fабс ${(A.fabs * 100).toFixed(1).replace('.', ',')} см`, e.x, e.y + (e.y > gs.y ? 16 : -10), 10, '#ff8a80'); }
          for (let i = 0; i < A.n; i++) {
            const tt = 2.1 + i * 1.3 / A.n; if (A.t < tt) continue;
            const q = toS(S[i]), ux = q.x - ctr.x, uy = q.y - ctr.y, ul = hyp(ux, uy) || 1;
            const lx = q.x + ux / ul * 16, ly = q.y + uy / ul * 13 + 4;
            pill(ctx, (i ? '' : 'ГГС ') + fmtSec(A.v[i]), lx, ly, 9, '#ffd0c8', 'rgba(60,14,10,.85)');
            if (st === 'review' && i === A.worst && canRe()) { ctx.strokeStyle = '#ffb02e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, 8 + Math.sin(T * 6) * 2, 0, TAU); ctx.stroke(); }
          }
          if (!finished) { htext(ctx, 'искажения на схеме увеличены', 10, api.H - 10, 9, 'rgba(255,255,255,.6)', 'left', '600'); drawPanel(ctx); }
        } else {
          for (let i = 1; i < S.length; i++) { const q = toS(S[i]); pill(ctx, String(i), q.x + 9, q.y - 8, 9, '#1a120a', '#ffd84a'); }
          for (let i = 0; i + 1 < S.length + (closed ? 1 : 0); i++) {
            const a = S[i], b = S[(i + 1) % S.length], L = hyp(b.x - a.x, b.y - a.y), m = toS({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            htext(ctx, fmtM(L) + ' м', m.x, m.y - 5, 9, '#fff2b0');
          }
          if (isClosable()) htext(ctx, 'замкнуть сюда', gx, gy + (gy > gs.y ? 13 : -13), 10, '#6cff8a');
          if (hover && st === 'place' && pendAim < 0 && !closed) {
            const snapG = S.length >= 3 && hyp(hover.x - g.x, hover.y - g.y) < SNAP, p = toS(snapG ? g : hover), r = hover.res;
            const ty = p.y - 16 < api.TOP + 14 ? p.y + 26 : p.y - 16;
            if (r.ok) pill(ctx, snapG ? 'Замкнуть ход · ' + fmtM(r.len) + ' м' : fmtM(r.len) + ' м · видимость есть', p.x, ty, 11, '#6cff8a');
            else pill(ctx, r.why, p.x, ty, 11, '#ff8a7a');
          }
          if (flash && !(hover && hover.res && !hover.res.ok)) { const p = toS(flash.b); pill(ctx, flash.res.why, p.x, p.y - 16 < api.TOP + 14 ? p.y + 26 : p.y - 16, 11, '#ff8a7a'); }
          if (st === 'place' && !closed && pendAim < 0) {
            api.button(ctx, btnUndo(), '↶ Снять', { disabled: S.length < 2 });
            const p = Math.abs(swept()) / TAU;
            const ub = btnUndo(), right = ub.x < W / 2;
            const ptx = `Обход участка ${Math.round(clamp(p, 0, 1) * 100)} %`; ctx.font = 'bold 11px system-ui, sans-serif';
            const pwid = ctx.measureText(ptx).width; pill(ctx, ptx, (right ? W - 10 : ub.x - 10) - pwid / 2 - 6, api.H - 16, 11, TH.ink);
          }
          if (st === 'aim') drawEye(ctx);
        }
        if (toastMsg && st !== 'aim') { ctx.globalAlpha = Math.min(1, toastMsg.t / 0.4); pill(ctx, toastMsg.text, st === 'adjust' || st === 'review' ? view.ox + ww * s / 2 : W / 2, gs.y < api.TOP + 70 ? api.H - 64 : api.TOP + 20, 12, toastMsg.color); ctx.globalAlpha = 1; }
      },
      pointerDown(p) {
        if (finished) return;
        if (st === 'aim') { aimTap(); return; }
        if (st === 'adjust') { adj.t = ADJ_END; return; }
        if (st === 'review') {
          const b = btnsReview();
          if (api.hit(b.sub, p)) { api.sfx('select'); finish(); return; }
          if (canRe() && api.hit(b.re, p)) { remeasure(); return; }
          return;
        }
        if (st !== 'place') return;
        if (api.hit(btnUndo(), p)) { undo(); return; }
        if (p.y < api.TOP || pendAim >= 0 || closed) return;
        downMap = true; this.pointerMove(Object.assign({}, p, { down: true }));
      },
      pointerMove(p) {
        if (st !== 'place' || closed || pendAim >= 0 || p.y < api.TOP) { if (!downMap) hover = null; return; }
        if (!p.down && api.IS_TOUCH) return;
        if (noHover && !p.down && hyp(p.x - noHover.x, p.y - noHover.y) < 8) return; // курсор ещё на только что поставленной станции
        noHover = null;
        const w = toW(p), n = S.length, closing = n >= 3 && hyp(w.x - g.x, w.y - g.y) < SNAP;
        hover = { x: w.x, y: w.y, res: check(wd, S, closing ? g : w, closing, 0) };
      },
      pointerUp(p) {
        if (!downMap) return;
        downMap = false;
        if (st === 'place' && p.y >= api.TOP) tryPlace(toW(p));
        if (api.IS_TOUCH || noHover) hover = null; else this.pointerMove(Object.assign({}, p, { down: false }));
      },
      key(code, down) {
        if (!down) return;
        if (code === 'Space' || code === 'Enter') { if (st === 'aim') aimTap(); else if (st === 'adjust') adj.t = ADJ_END; else if (st === 'review') finish(); }
        if ((code === 'KeyZ' || code === 'Backspace') && st === 'place') undo();
        if (code === 'KeyR' && st === 'review') remeasure();
      },
      hud() {
        const n = S.length;
        // на узком экране места для строки нет — заголовок уровня длинный
        const info = api.W < 620 ? [] : closed ? [adj ? `fβ ${fmtSec(adj.fb)}` : `ст. ${n}`] : [`ст. ${n - 1}`];
        return { time: LIMIT - tUsed, info, progress: api.W < 620 ? null : closed ? 1 : clamp(Math.abs(swept()) / TAU, 0, 1) }; // на узком — прогресс в плашке «Обход участка»
      },
      bot(dt) {
        if (finished) return;
        B.wait -= dt; if (B.wait > 0) return;
        if (st === 'place') {
          if (pendAim >= 0 || closed || !crewOk) return;
          let ok = B.plan.length > S.length;
          for (let i = 0; ok && i < S.length; i++) if (hyp(B.plan[i].x - S[i].x, B.plan[i].y - S[i].y) > 0.5) ok = false;
          if (!ok && !botReplan()) { undo(); B.wait = 0.3; return; }
          const tq = B.plan[S.length], sp = toS(tq), n0 = S.length, c0 = closed;
          this.pointerDown({ x: sp.x, y: sp.y, id: 9, button: 0 }); this.pointerUp({ x: sp.x, y: sp.y, id: 9, button: 0 });
          if (S.length === n0 && closed === c0) { if (!botReplan()) undo(); }
          B.wait = 0.35;
        } else if (st === 'aim') {
          const a = aim; if (a.sum > 0 || a.frozen > 0 || a.t < 0.45) return;
          const s = sway(a);
          if (Math.abs(s.x) < 1.4 && !occluded(a)) { const e = eyeGeom(); this.pointerDown({ x: e.cx, y: e.cy, id: 9, button: 0 }); B.wait = 0.05; }
        } else if (st === 'review') {
          const b = btnsReview(), tq = adj.ok || !canRe() ? b.sub : b.re;
          this.pointerDown({ x: tq.x + tq.w / 2, y: tq.y + tq.h / 2, id: 9, button: 0 }); B.wait = 0.6;
        }
      },
    };
    return inst;
  }
})();
