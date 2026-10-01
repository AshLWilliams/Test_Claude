'use strict';
// «Реечник» — техническое нивелирование трассы и продольный профиль: вид сбоку (разрез), 140 с.
// Реечник идёт по трассе с рейкой РН-3; сзади на станции нивелир на штативе и наблюдатель. Рейку ставят на пикеты
// (через 20 м), перегибы рельефа и характерные точки; луч нивелира горизонтален — отсчёт = ГИ − отметка точки.
// Отсчёт берётся, пока пузырёк круглого уровня рейки в центре. Луч не достаёт, проходит над/под рейкой или упирается
// в бугор — перенос станции. Участок каждый раз генерируется из зерна, решаемость проверяется при генерации.
// Итог — бланк продольного профиля: истинный рельеф и профиль по отсчётам, отметки, расстояния, пикеты, план трассы.
(() => {
  const Z = 1.5;              // масштаб камеры: логических единиц экрана на единицу мира
  const MX = 4;               // ед. на метр по горизонтали (пикет 20 м = 80 ед.)
  const VY = 14;              // ед. на метр по вертикали; в этом же масштабе люди и предметы (рельеф ×3,5)
  const PK = 80;              // шаг пикетов, ед.
  const T_LEVEL = 140;        // длительность уровня, с
  const SPEED = 92;           // шаг реечника, ед./с
  const ACC = 1100;           // разгон и торможение, ед./с²
  const RANGE = 260;          // предельное плечо, ед. (65 м)
  const STAFF = 3;            // длина рейки, м
  const TOL = 7;              // допуск постановки рейки на точку, ед.
  const SNAP = 17;            // в этих пределах реечник сам делает шаг к колышку (палец не попадёт в 7 ед. на ходу)
  const HOLD = 0.7;           // пузырёк в центре столько секунд — отсчёт взят
  const ZONE = 0.24;          // радиус «центра» круглого уровня (доля хода пузырька)
  const MOVE_T = 4;           // перенос нивелира, с
  const GRAV = 430, JUMP_V = 118;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (v, n) => v.toFixed(n).replace('.', ',');
  const pad4 = v => String(Math.max(0, Math.round(v))).padStart(4, '0');
  const mmss = t => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const smooth = t => t * t * (3 - 2 * t);
  // Слой ровно под текущую плотность пикселей и вывод «пиксель в пиксель»: копия 1:1 без пересчёта в разы дешевле
  // масштабированной (api.layer округляет плотность вверх до целого — каждый кадр лишняя выборка).
  let api0 = null;
  const curK = () => { const cv = document.getElementById('game'); return cv && cv.width && api0 ? cv.width / api0.W : 1; }; // плотность кадра ядра
  function layer(w, h, draw, kMax) {
    const k = Math.min(curK(), kMax || 4), cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
    const c = cv.getContext('2d'); c.scale(cv.width / w, cv.height / h); draw(c);
    return { canvas: cv, w, h, k };
  }
  // вывести часть слоя (sx, sy, sw, sh — в его пикселях) в точку (x, y) текущей системы координат, d — её плотность
  function px(c, ly, sx, sy, sw, sh, x, y, d) {
    if (sw <= 0 || sh <= 0) return;
    const m = c.getTransform(), kk = ly.canvas.width / ly.w;
    if (Math.abs(kk * (d || 1) - m.a) > 0.02 * m.a || m.b || m.c) { c.drawImage(ly.canvas, sx, sy, sw, sh, x, y, sw / kk / (d || 1), sh / kk / (d || 1)); return; } // плотность сменилась (поворот экрана) — обычный вывод
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(ly.canvas, sx, sy, sw, sh, Math.round(m.a * x + m.e), Math.round(m.d * y + m.f), sw, sh);
    c.setTransform(m);
  }
  function rngOf(s) { let a = s | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shade(hex, k) { // k < 0 — темнее, k > 0 — светлее
    const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255, t = k < 0 ? 0 : 255, f = Math.abs(k);
    return 'rgb(' + Math.round(r + (t - r) * f) + ',' + Math.round(g + (t - g) * f) + ',' + Math.round(b + (t - b) * f) + ')';
  }
  function mix(h1, h2, t) {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const r = Math.round(lerp(a >> 16 & 255, b >> 16 & 255, t)), g = Math.round(lerp(a >> 8 & 255, b >> 8 & 255, t)), bl = Math.round(lerp(a & 255, b & 255, t));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function outlined(c, str, x, y, size, color, align, weight) { // подпись с тёмной обводкой — читается на любом фоне
    c.font = `${weight || 'bold'} ${size}px system-ui, sans-serif`; c.textAlign = align || 'center';
    c.lineWidth = 3; c.lineJoin = 'round'; c.strokeStyle = 'rgba(20,14,10,.78)'; c.strokeText(str, x, y);
    c.fillStyle = color; c.fillText(str, x, y);
  }

  // ---------- рисунок: люди и приборы (вид сбоку; (x, y) — точка стояния, dir — куда смотрит) ----------
  const HERO = { jacket: '#35557a', vest: '#ff7a1a', stripe: '#eef1f2', pants: '#2c3646', boots: '#2a211b', hat: 'helmet', hatCol: '#f4f1e8', skin: '#f0c49b', hair: '#5a3a22' };
  const MATE = { jacket: '#5b6b3c', vest: '#d4f53c', stripe: '#f4f6ee', pants: '#3a3d44', boots: '#2b2420', hat: 'cap', hatCol: '#c0392b', skin: '#eab88e', hair: '#2e2620' };
  function skel(pose, ph) { // скелет: таз, плечо, голова (локально, ступни в 0,0)
    const walk = pose === 'walk' || pose === 'carry';
    const bob = walk ? -Math.abs(Math.cos(ph)) * 0.7 : 0;
    const crouch = pose === 'jump' ? 1.8 : pose === 'bend' ? 0.8 : pose === 'climb' ? 1.2 : 0;
    const hip = { x: 0, y: -12.6 + bob + crouch };
    const tilt = pose === 'bend' ? 0.55 : pose === 'climb' ? 0.35 : walk ? 0.09 : 0.02;
    const sh = { x: hip.x + Math.sin(tilt) * 8.6, y: hip.y - Math.cos(tilt) * 8.6 };
    const hd = { x: sh.x + Math.sin(tilt + 0.2) * 3.3, y: sh.y - Math.cos(tilt + 0.2) * 3.3 };
    return { walk, hip, sh, hd, tilt };
  }
  function person(c, x, y, o, look) {
    const s = o.s || 1, ph = o.ph || 0, pose = o.pose || 'stand';
    const { walk, hip, sh, hd, tilt } = skel(pose, ph);
    const sw = walk ? Math.sin(ph) : 0;
    c.save(); c.translate(x, y); c.scale((o.dir || 1) * s, s);
    c.lineCap = 'round'; c.lineJoin = 'round';
    const leg = (a, bend, col) => {
      const kx = hip.x + Math.sin(a) * 6.2, ky = hip.y + Math.cos(a) * 6.2;
      const b = a - bend, ax = kx + Math.sin(b) * 6.0, ay = ky + Math.cos(b) * 6.0;
      c.strokeStyle = col; c.lineWidth = 2.7;
      c.beginPath(); c.moveTo(hip.x, hip.y); c.lineTo(kx, ky); c.lineTo(ax, ay); c.stroke();
      c.strokeStyle = look.boots; c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(ax - 0.9, ay - 0.2); c.lineTo(ax + 1.9, ay); c.stroke();
    };
    const arm = (ex, ey, hx, hy, col) => {
      c.strokeStyle = col; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(sh.x, sh.y + 0.6); c.lineTo(ex, ey); c.lineTo(hx, hy); c.stroke();
      c.fillStyle = look.skin; c.beginPath(); c.arc(hx, hy, 0.95, 0, TAU); c.fill();
    };
    // ноги и руки: дальние темнее
    let la, lb, ra, rb;
    if (pose === 'jump') { la = 0.55; lb = 1.3; ra = -0.25; rb = 0.9; }
    else if (pose === 'bend') { la = 0.18; lb = 0.35; ra = -0.12; rb = 0.3; }
    else if (pose === 'climb') { la = 0.8; lb = 1.4; ra = -0.1; rb = 0.4; }
    else { la = 0.45 * sw; lb = Math.max(0, -sw) * 0.55 + 0.05; ra = -0.45 * sw; rb = Math.max(0, sw) * 0.55 + 0.05; }
    const farCol = shade(look.pants, -0.3), farJ = shade(look.jacket, -0.3);
    // дальняя рука
    if (pose === 'hold') arm(sh.x + 1.6, sh.y + 4.4, 4.1, -14.4, farJ);
    else if (pose === 'bend') arm(sh.x + 2.6, sh.y + 3.4, sh.x + 5.2, sh.y + 2.6, farJ);
    else if (walk) { const a = 0.5 * sw; arm(sh.x + Math.sin(a) * 4.5, sh.y + Math.cos(a) * 4.5, sh.x + Math.sin(a + 0.4) * 8.4, sh.y + Math.cos(a + 0.4) * 8.2, farJ); }
    else arm(sh.x + 0.6, sh.y + 4.5, sh.x + 1.4, sh.y + 8.6, farJ);
    leg(ra, rb, farCol);
    // корпус: куртка + сигнальный жилет со светоотражающими полосами
    const nx = Math.cos(tilt), ny = Math.sin(tilt);
    c.fillStyle = look.jacket;
    c.beginPath(); c.moveTo(hip.x - nx * 2.2, hip.y - ny * 2.2 + 0.6); c.lineTo(hip.x + nx * 2.3, hip.y + ny * 2.3 + 0.6);
    c.lineTo(sh.x + nx * 2.5, sh.y + ny * 2.5); c.quadraticCurveTo(sh.x, sh.y - 1.2, sh.x - nx * 2.3, sh.y - ny * 2.3); c.closePath(); c.fill();
    c.fillStyle = look.vest;
    const v0 = 0.12, v1 = 0.9, P = (t, k) => ({ x: lerp(hip.x, sh.x, t) + nx * k, y: lerp(hip.y, sh.y, t) + ny * k });
    let a1 = P(v0, -2.3), a2 = P(v0, 2.4), a3 = P(v1, 2.5), a4 = P(v1, -2.3);
    c.beginPath(); c.moveTo(a1.x, a1.y); c.lineTo(a2.x, a2.y); c.lineTo(a3.x, a3.y); c.lineTo(a4.x, a4.y); c.closePath(); c.fill();
    c.strokeStyle = look.stripe; c.lineWidth = 0.9; c.beginPath();
    for (const t of [0.3, 0.55]) { const q1 = P(t, -2.3), q2 = P(t, 2.45); c.moveTo(q1.x, q1.y); c.lineTo(q2.x, q2.y); }
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 0.5; c.beginPath(); a1 = P(0.1, 0.3); a2 = P(0.95, 0.5); c.moveTo(a1.x, a1.y); c.lineTo(a2.x, a2.y); c.stroke();
    leg(la, lb, look.pants);
    // голова и каска/кепка
    c.fillStyle = look.skin; c.beginPath(); c.arc(hd.x, hd.y, 2.0, 0, TAU); c.fill();
    c.fillStyle = look.hair; c.beginPath(); c.arc(hd.x - 0.4, hd.y - 0.1, 1.9, Math.PI * 0.55, Math.PI * 1.25); c.lineTo(hd.x - 0.4, hd.y); c.fill();
    c.fillStyle = '#1d1712'; c.beginPath(); c.arc(hd.x + 1.15, hd.y - 0.35, 0.33, 0, TAU); c.fill();
    c.fillStyle = shade(look.skin, -0.15); c.beginPath(); c.arc(hd.x + 2.0, hd.y + 0.25, 0.45, 0, TAU); c.fill();
    c.fillStyle = look.hatCol;
    if (look.hat === 'helmet') {
      c.beginPath(); c.arc(hd.x, hd.y - 0.5, 2.35, Math.PI, TAU); c.fill();
      c.fillRect(hd.x - 2.6, hd.y - 0.75, 5.7, 0.8);
      c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(hd.x - 0.3, hd.y - 2.8, 0.6, 2.2);
    } else {
      c.beginPath(); c.arc(hd.x, hd.y - 0.6, 2.15, Math.PI, TAU); c.fill();
      c.fillRect(hd.x, hd.y - 0.85, 3.6, 0.7);
    }
    // ближняя рука
    if (pose === 'hold') arm(sh.x + 2.4, sh.y + 2.8, 4.1, -18.6, look.jacket);
    else if (pose === 'bend') arm(sh.x + 2.8, sh.y + 3.0, sh.x + 5.6, sh.y + 1.4, look.jacket);
    else if (pose === 'carry') arm(sh.x + 2.2, sh.y + 3.4, sh.x + 2.4, sh.y - 0.4, look.jacket);
    else if (pose === 'book') { arm(sh.x + 0.8, sh.y + 4.4, sh.x + 3.4, sh.y + 3.2, look.jacket); c.fillStyle = '#2b4a6e'; c.fillRect(sh.x + 2.8, sh.y + 0.6, 2.6, 3.4); c.fillStyle = '#f2ede0'; c.fillRect(sh.x + 3.1, sh.y + 0.9, 2.0, 2.8); }
    else if (walk) { const a = -0.5 * sw; arm(sh.x + Math.sin(a) * 4.5, sh.y + Math.cos(a) * 4.5, sh.x + Math.sin(a + 0.4) * 8.4, sh.y + Math.cos(a + 0.4) * 8.2, look.jacket); }
    else if (pose === 'jump') arm(sh.x + 3.2, sh.y + 1.4, sh.x + 5.4, sh.y - 1.8, look.jacket);
    else arm(sh.x + 0.9, sh.y + 4.5, sh.x + 1.8, sh.y + 8.6, look.jacket);
    c.restore();
    return { sx: x + sh.x * (o.dir || 1) * s, sy: y + sh.y * s, hx: x + hd.x * (o.dir || 1) * s, hy: y + hd.y * s };
  }

  // нивелирная рейка РН-3: 3 м, «шашки» по 5 см (метры через один — чёрные и красные); (x, y) — пятка, a — наклон от вертикали
  function staffSide(c, x, y, a) {
    const L = STAFF * VY, w = 2.2, u = VY / 20;
    c.save(); c.translate(x, y); c.rotate(a);
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(-w / 2 + 0.5, -L + 0.5, w, L);
    c.fillStyle = '#c9c2ad'; c.fillRect(-w / 2 - 0.35, -L, w + 0.7, L);
    c.fillStyle = '#fbf9f1'; c.fillRect(-w / 2, -L, w, L);
    for (const red of [false, true]) {
      c.beginPath();
      for (let k = 0; k < 30; k++) {
        if ((Math.floor(k / 10) === 1) !== red) continue;
        const y0 = -k * 2 * u;
        c.rect(-w / 2, y0 - u, w / 2, u); c.rect(0, y0 - 2 * u, w / 2, u);
      }
      c.fillStyle = red ? '#cf2f27' : '#1c1c1c'; c.fill();
    }
    c.fillStyle = '#c8322a'; for (let m = 1; m < 3; m++) { c.beginPath(); c.arc(0, -m * VY, 0.55, 0, TAU); c.fill(); }
    c.fillStyle = '#7d8489'; c.fillRect(-w / 2 - 0.45, -1.1, w + 0.9, 1.1); c.fillRect(-w / 2 - 0.5, -L / 2 - 0.55, w + 1.0, 1.1);
    c.fillStyle = '#5c6266'; c.fillRect(-w / 2 - 0.45, -L, w + 0.9, 0.6);
    c.restore();
  }

  // нивелир на штативе: i — высота визирного луча над землёй (м); dir — куда смотрит объектив
  function levelSide(c, x, y, i, dir, umbrella) {
    const yt = y - i * VY, yh = yt + 3.2;
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    if (umbrella) { // геодезический зонт от солнца
      const ux = x - 1.5 * dir, uy = y - 2.55 * VY;
      c.strokeStyle = '#6d6a62'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(x - 9 * dir, y + 0.5); c.lineTo(ux, uy); c.stroke();
      const R = 13, Hh = 6.5;
      for (let k = 0; k < 6; k++) {
        const t0 = k / 6, t1 = (k + 1) / 6;
        c.fillStyle = k % 2 ? '#f3efe6' : '#d23a2c';
        c.beginPath();
        c.moveTo(ux + (t0 * 2 - 1) * R, uy + Hh * 0.35 * (1 - Math.abs(t0 * 2 - 1)) + 0.6);
        for (let j = 0; j <= 4; j++) { const t = lerp(t0, t1, j / 4), sx = t * 2 - 1; c.lineTo(ux + sx * R, uy - Hh * Math.sqrt(1 - sx * sx) + 1.2); }
        c.lineTo(ux + (t1 * 2 - 1) * R, uy + 0.6);
        c.closePath(); c.fill();
      }
      c.strokeStyle = 'rgba(60,30,20,.45)'; c.lineWidth = 0.35; c.beginPath();
      for (let k = 0; k <= 6; k++) { const sx = k / 3 - 1; c.moveTo(ux, uy - Hh + 1.2); c.lineTo(ux + sx * R, uy + 0.6 + (Math.abs(sx) < 1 ? 0 : 0)); }
      c.stroke();
      c.fillStyle = '#4a463e'; c.beginPath(); c.arc(ux, uy - Hh + 0.9, 0.7, 0, TAU); c.fill();
    }
    // ящик прибора
    const bx = x + 8 * dir;
    c.fillStyle = '#d9822b'; c.fillRect(bx - 3, y - 4.6, 6, 4.6);
    c.fillStyle = '#9d5a1c'; c.fillRect(bx - 3, y - 4.6, 6, 0.9); c.fillRect(bx - 1, y - 5.4, 2, 0.8);
    c.fillStyle = '#e8e2d0'; c.fillRect(bx - 1.6, y - 3.1, 3.2, 1.4);
    // ноги штатива: дальняя, две ближние
    const leg = (fx, col, w) => {
      c.strokeStyle = col; c.lineWidth = w;
      c.beginPath(); c.moveTo(x + (fx > x ? 0.9 : -0.9), yh + 0.8); c.lineTo(lerp(x, fx, 0.62), lerp(yh, y, 0.62)); c.stroke();
      c.lineWidth = w * 0.72; c.beginPath(); c.moveTo(lerp(x, fx, 0.6), lerp(yh, y, 0.6)); c.lineTo(fx, y - 1.2); c.stroke();
      c.strokeStyle = '#3f4448'; c.lineWidth = w * 0.6; c.beginPath(); c.moveTo(fx - (fx - x) * 0.02, y - 1.6); c.lineTo(fx + (fx > x ? 0.35 : -0.35), y + 0.3); c.stroke();
      c.fillStyle = '#2f3336'; c.fillRect(lerp(x, fx, 0.58) - 0.6, lerp(yh, y, 0.58) - 0.5, 1.2, 1.0);
    };
    leg(x + 2.4 * dir, '#9a7a45', 1.3);
    leg(x - 8.4, '#c79e57', 1.6); leg(x + 8.6, '#c79e57', 1.6);
    // головка штатива и трегер с подъёмными винтами
    c.fillStyle = '#4c5257'; c.fillRect(x - 3.4, yh, 6.8, 1.1);
    c.fillStyle = '#2e3236'; c.fillRect(x - 3.0, yh - 1.2, 6.0, 1.2);
    c.fillStyle = '#6f777d'; for (const k of [-2.3, 0, 2.3]) { c.beginPath(); c.arc(x + k, yh - 0.4, 0.55, 0, TAU); c.fill(); }
    // корпус и зрительная труба (увеличено для читаемости)
    c.fillStyle = '#e9e5d8'; rr(c, x - 2.6, yt - 1.2, 5.2, yh - 1.2 - (yt - 1.2), 0.8); c.fill();
    c.fillStyle = '#c9c4b4'; c.fillRect(x - 2.6, yh - 2.2, 5.2, 1.0);
    c.fillStyle = '#d9d4c5'; rr(c, x - 4.4, yt - 1.15, 8.9, 2.3, 0.9); c.fill();
    c.fillStyle = '#2f6f8f'; c.fillRect(x - 1.4, yt - 1.15, 2.8, 2.3);
    const ox = x + 4.6 * dir, ex = x - 4.4 * dir;
    c.fillStyle = '#33383c'; c.beginPath(); c.ellipse(ox, yt, 0.75, 1.45, 0, 0, TAU); c.fill();
    c.fillStyle = '#7fc4e8'; c.beginPath(); c.ellipse(ox + 0.25 * dir, yt - 0.2, 0.3, 0.75, 0, 0, TAU); c.fill();
    c.fillStyle = '#26292c'; c.fillRect(Math.min(ex, ex - 1.4 * dir), yt - 0.65, 1.4, 1.3);
    c.fillStyle = '#26292c'; c.beginPath(); c.arc(x + 1.2 * dir, yt + 1.6, 0.8, 0, TAU); c.fill();
    c.fillStyle = '#3d9a52'; c.beginPath(); c.ellipse(x - 1.2 * dir, yt - 1.5, 0.9, 0.4, 0, 0, TAU); c.fill();
    c.strokeStyle = '#2b2e31'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(x - 0.6 * dir, yt - 1.2); c.lineTo(x + 0.6 * dir, yt - 2.0); c.lineTo(x + 1.6 * dir, yt - 1.2); c.stroke();
    c.restore();
    return { ox, oy: yt };
  }

  // штатив с прибором на плече (при переносе): (x, y) — плечо наблюдателя
  function levelCarried(c, x, y, dir) {
    c.save(); c.lineCap = 'round';
    c.strokeStyle = '#c79e57'; c.lineWidth = 1.5;
    for (const k of [-0.6, 0, 0.6]) { c.beginPath(); c.moveTo(x + 2 * dir, y - 1 + k); c.lineTo(x - 15 * dir, y + 9 + k); c.stroke(); }
    c.fillStyle = '#e9e5d8'; rr(c, x + 1 * dir - 3, y - 4.4, 6, 3.2, 0.8); c.fill();
    c.fillStyle = '#33383c'; c.beginPath(); c.arc(x + 4 * dir, y - 2.8, 0.9, 0, TAU); c.fill();
    c.strokeStyle = '#d23a2c'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x - 3 * dir, y + 3); c.lineTo(x + 5 * dir, y + 15); c.stroke();
    c.restore();
  }

  // ---------- рисунок: деревья, кусты и прочее (вид сбоку) ----------
  // дерево: (x, y) — основание ствола, h — высота, kind: birch, spruce, pine, oak, willow
  function treeSide(c, x, y, h, kind, seed) {
    const R = rngOf(seed), lit = 0.18;
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    const blob = (cx, cy, r, col) => { c.fillStyle = col; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill(); };
    const crown = (cx, cy, rx, ry, base, n) => { // клубы листвы: тень, тело, свет
      const pts = [];
      for (let k = 0; k < n; k++) { const a = R() * TAU, d = Math.sqrt(R()); pts.push([cx + Math.cos(a) * rx * d * 0.8, cy + Math.sin(a) * ry * d * 0.8, (0.32 + R() * 0.25) * Math.min(rx, ry)]); }
      for (const p of pts) blob(p[0] + 1.2, p[1] + 1.6, p[2], shade(base, -0.28));
      for (const p of pts) blob(p[0], p[1], p[2] * 0.92, base);
      for (const p of pts) if (p[0] < cx + rx * 0.2 && p[1] < cy + ry * 0.1) blob(p[0] - p[2] * 0.25, p[1] - p[2] * 0.28, p[2] * 0.55, shade(base, lit));
      c.fillStyle = shade(base, 0.3);
      for (let k = 0; k < n * 2; k++) { const a = R() * TAU, d = Math.sqrt(R()); const px = cx + Math.cos(a) * rx * d * 0.9, py = cy + Math.sin(a) * ry * d * 0.9; if (px < cx && py < cy) c.fillRect(px, py, 0.9, 0.9); }
    };
    if (kind === 'spruce') {
      c.fillStyle = '#4a3423'; c.fillRect(x - 1.3, y - h * 0.15, 2.6, h * 0.15);
      const tiers = 7 + (R() * 3 | 0), base = R() < 0.5 ? '#2f5a3a' : '#2b5236';
      for (let k = 0; k < tiers; k++) {
        const t = k / tiers, wy = y - h * 0.1 - t * h * 0.88, w = h * 0.32 * (1 - t * 0.85) + 2, th = h * 0.2;
        c.fillStyle = shade(base, -0.25); c.beginPath(); c.moveTo(x - w, wy + 1); c.lineTo(x, wy - th); c.lineTo(x + w + 1, wy + 1.5); c.closePath(); c.fill();
        c.fillStyle = base; c.beginPath(); c.moveTo(x - w, wy); c.lineTo(x, wy - th); c.lineTo(x + w * 0.6, wy - 0.5); c.closePath(); c.fill();
        c.fillStyle = shade(base, 0.16); c.beginPath(); c.moveTo(x - w * 0.9, wy - 0.4); c.lineTo(x, wy - th); c.lineTo(x - w * 0.2, wy - 1.2); c.closePath(); c.fill();
      }
    } else if (kind === 'pine') {
      c.strokeStyle = '#a0603a'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 1, y - h * 0.72); c.stroke();
      c.strokeStyle = '#6f3f24'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(x - 0.8, y); c.lineTo(x + 0.2, y - h * 0.4); c.stroke();
      c.strokeStyle = '#7a4a2a'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(x + 0.8, y - h * 0.62); c.lineTo(x - h * 0.12, y - h * 0.78); c.moveTo(x + 1, y - h * 0.66); c.lineTo(x + h * 0.13, y - h * 0.8); c.stroke();
      crown(x - h * 0.1, y - h * 0.8, h * 0.17, h * 0.07, '#3a6b3e', 7);
      crown(x + h * 0.11, y - h * 0.85, h * 0.15, h * 0.07, '#3a6b3e', 6);
      crown(x, y - h * 0.92, h * 0.14, h * 0.07, '#447a45', 6);
    } else if (kind === 'birch') {
      const lean = (R() - 0.5) * h * 0.06;
      c.strokeStyle = '#efece4'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + lean, y - h * 0.5, x + lean * 1.5, y - h * 0.82); c.stroke();
      c.fillStyle = '#26221d';
      for (let k = 0; k < 9; k++) { const t = 0.05 + R() * 0.7; c.fillRect(x + lean * t * 1.6 - 1.2 + (R() < 0.5 ? 0.5 : 0), y - h * t, 1.2 + R(), 0.5); }
      c.strokeStyle = '#d8d3c8'; c.lineWidth = 0.9; c.beginPath();
      for (let k = 0; k < 4; k++) { const t = 0.45 + k * 0.1, sx = x + lean * t * 1.5, sy = y - h * t, d = k % 2 ? 1 : -1; c.moveTo(sx, sy); c.lineTo(sx + d * h * 0.1, sy - h * 0.08); }
      c.stroke();
      const base = R() < 0.5 ? '#6f9e45' : '#7aa84c';
      crown(x + lean, y - h * 0.68, h * 0.2, h * 0.27, base, 14);
      c.strokeStyle = shade(base, -0.2); c.lineWidth = 0.5; c.beginPath();
      for (let k = 0; k < 10; k++) { const sx = x + lean + (R() - 0.5) * h * 0.36, sy = y - h * (0.55 + R() * 0.3); c.moveTo(sx, sy); c.lineTo(sx + (R() - 0.5) * 1.5, sy + 3 + R() * 4); }
      c.stroke();
    } else if (kind === 'willow') {
      c.strokeStyle = '#5c4a3a'; c.lineWidth = 3.6; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x - 2, y - h * 0.3, x + 1, y - h * 0.5); c.stroke();
      c.lineWidth = 1.8; c.beginPath(); c.moveTo(x + 0.5, y - h * 0.45); c.lineTo(x - h * 0.15, y - h * 0.65); c.moveTo(x + 0.8, y - h * 0.48); c.lineTo(x + h * 0.16, y - h * 0.66); c.stroke();
      const base = '#8aa05a';
      crown(x, y - h * 0.68, h * 0.3, h * 0.22, base, 14);
      c.strokeStyle = '#7b9150'; c.lineWidth = 0.7; c.beginPath();
      for (let k = 0; k < 26; k++) { const sx = x + (R() - 0.5) * h * 0.6, sy = y - h * (0.6 + R() * 0.15); c.moveTo(sx, sy); c.quadraticCurveTo(sx + 1, sy + h * 0.15, sx + (R() - 0.5) * 2, sy + h * (0.22 + R() * 0.2)); }
      c.stroke();
    } else { // дуб / клён / липа
      c.fillStyle = '#5a4130';
      c.beginPath(); c.moveTo(x - 2.4, y); c.lineTo(x - 1.4, y - h * 0.42); c.lineTo(x + 1.4, y - h * 0.42); c.lineTo(x + 2.6, y); c.closePath(); c.fill();
      c.strokeStyle = '#5a4130'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x, y - h * 0.38); c.lineTo(x - h * 0.16, y - h * 0.58); c.moveTo(x, y - h * 0.4); c.lineTo(x + h * 0.18, y - h * 0.6); c.stroke();
      c.strokeStyle = '#3e2d21'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(x + 0.8, y); c.lineTo(x + 0.6, y - h * 0.38); c.stroke();
      const base = ['#4f7f3a', '#5a8a3c', '#46773a'][R() * 3 | 0];
      crown(x, y - h * 0.66, h * 0.36, h * 0.3, base, 20);
    }
    c.restore();
  }
  // куст: (x, y) — основание, r — радиус
  function bushSide(c, x, y, r, seed, col, flowers) {
    const R = rngOf(seed);
    const base = col || '#4f7d36';
    const pts = [];
    for (let k = 0; k < 9; k++) pts.push([x + (R() - 0.5) * r * 1.6, y - r * 0.45 - R() * r * 0.75, r * (0.35 + R() * 0.3)]);
    c.fillStyle = shade(base, -0.3); for (const p of pts) { c.beginPath(); c.arc(p[0] + 0.8, p[1] + 1, p[2], 0, TAU); c.fill(); }
    c.fillStyle = base; for (const p of pts) { c.beginPath(); c.arc(p[0], p[1], p[2] * 0.9, 0, TAU); c.fill(); }
    c.fillStyle = shade(base, 0.2); for (const p of pts) if (p[0] < x + r * 0.3) { c.beginPath(); c.arc(p[0] - p[2] * 0.25, p[1] - p[2] * 0.3, p[2] * 0.5, 0, TAU); c.fill(); }
    if (flowers) { c.fillStyle = flowers; for (let k = 0; k < 7; k++) { const p = pts[k % pts.length]; c.beginPath(); c.arc(p[0] + (R() - 0.5) * p[2], p[1] + (R() - 0.5) * p[2], 0.7, 0, TAU); c.fill(); } }
    c.fillStyle = shade(base, -0.4); c.fillRect(x - r * 0.7, y - 1.2, r * 1.4, 1.2);
  }
  // пучок травы/цветов (для фона в разрезе)
  function flowers(c, x, y, R, kind) {
    c.lineWidth = 0.5; c.strokeStyle = '#4f7a34'; c.beginPath();
    const n = 3 + (R() * 3 | 0), pts = [];
    for (let k = 0; k < n; k++) { const fx = x + (R() - 0.5) * 6, fh = 3 + R() * 4; c.moveTo(fx, y); c.lineTo(fx + (R() - 0.5) * 1.5, y - fh); pts.push([fx, y - fh]); }
    c.stroke();
    for (const p of pts) {
      if (kind === 0) { c.fillStyle = '#ffffff'; c.beginPath(); c.arc(p[0], p[1], 1.0, 0, TAU); c.fill(); c.fillStyle = '#f2c230'; c.beginPath(); c.arc(p[0], p[1], 0.42, 0, TAU); c.fill(); }
      else if (kind === 1) { c.fillStyle = '#4c78d8'; c.beginPath(); c.arc(p[0], p[1], 0.85, 0, TAU); c.fill(); }
      else if (kind === 2) { c.fillStyle = '#c45aa0'; c.fillRect(p[0] - 0.5, p[1] - 2.2, 1.0, 2.6); }
      else { c.fillStyle = '#f5d33a'; c.beginPath(); c.arc(p[0], p[1], 0.8, 0, TAU); c.fill(); }
    }
  }
  // крапива: стебли с парными зубчатыми листьями
  function nettleSide(c, x, y, w, seed) {
    const R = rngOf(seed);
    for (let k = 0; k < w / 2.6; k++) {
      const sx = x + R() * w, h = 9 + R() * 8, lean = (R() - 0.5) * 2.5;
      c.strokeStyle = '#3d5e2a'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(sx, y); c.lineTo(sx + lean, y - h); c.stroke();
      for (let j = 1; j < 5; j++) {
        const t = j / 5, lx = sx + lean * t, ly = y - h * t, s = 2.6 * (1.1 - t * 0.5);
        for (const d of [-1, 1]) {
          c.fillStyle = j % 2 ? '#3f6d2c' : '#4b7d33';
          c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx + d * s * 0.6, ly - s * 0.55); c.lineTo(lx + d * s * 1.2, ly + s * 0.05); c.lineTo(lx + d * s * 0.7, ly + s * 0.25); c.closePath(); c.fill();
        }
      }
      c.fillStyle = '#6a8b3a'; c.fillRect(sx + lean - 0.6, y - h - 2, 1.2, 2.2);
    }
  }
  // камыш и рогоз
  function reedsSide(c, x, y, w, seed, front) {
    const R = rngOf(seed);
    for (let k = 0; k < w / 1.6; k++) {
      const sx = x + R() * w, h = 18 + R() * 14, bend = (R() - 0.5) * 6;
      c.strokeStyle = front ? (R() < 0.5 ? '#6f8a3a' : '#829a44') : (R() < 0.5 ? '#7d9448' : '#91a453'); c.lineWidth = 0.75;
      c.beginPath(); c.moveTo(sx, y + 1); c.quadraticCurveTo(sx + bend * 0.3, y - h * 0.6, sx + bend, y - h); c.stroke();
      if (R() < 0.3) { c.fillStyle = '#6b4128'; rr(c, sx + bend * 0.8 - 0.9, y - h * 0.86 - 4, 1.8, 4.6, 0.8); c.fill(); }
    }
  }
  // бревно поперёк трассы — видим торец: годичные кольца, кора
  function logSide(c, x, y, r) {
    c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(x + 1.5, y, r * 1.3, 1.4, 0, 0, TAU); c.fill();
    c.fillStyle = '#5a3d27'; c.beginPath(); c.arc(x, y - r, r, 0, TAU); c.fill();
    c.fillStyle = '#d9b27a'; c.beginPath(); c.arc(x, y - r, r * 0.84, 0, TAU); c.fill();
    c.strokeStyle = '#b48650'; c.lineWidth = 0.4;
    for (let k = 1; k < 5; k++) { c.beginPath(); c.arc(x + 0.3, y - r + 0.2, r * 0.84 * k / 5, 0, TAU); c.stroke(); }
    c.strokeStyle = '#6e4a2c'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(x + 0.3, y - r + 0.2); c.lineTo(x + r * 0.7, y - r - r * 0.4); c.stroke();
    c.fillStyle = 'rgba(255,240,210,.35)'; c.beginPath(); c.arc(x - r * 0.3, y - r * 1.3, r * 0.25, 0, TAU); c.fill();
  }
  // рулон сена (торец со спиралью)
  function hayRoll(c, x, y, r) {
    c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(x + 2, y, r * 1.2, 1.5, 0, 0, TAU); c.fill();
    c.fillStyle = '#c9a04a'; c.beginPath(); c.arc(x, y - r, r, 0, TAU); c.fill();
    c.strokeStyle = '#a77f32'; c.lineWidth = 0.6; c.beginPath();
    for (let a = 0; a < 18; a += 0.25) { const rr2 = r * 0.92 * a / 18, px = x + Math.cos(a) * rr2, py = y - r + Math.sin(a) * rr2; if (a === 0) c.moveTo(px, py); else c.lineTo(px, py); }
    c.stroke();
    c.fillStyle = 'rgba(255,235,170,.35)'; c.beginPath(); c.arc(x - r * 0.35, y - r * 1.35, r * 0.35, 0, TAU); c.fill();
  }
  // стог сена
  function haystack(c, x, y, w, h, seed) {
    const R = rngOf(seed);
    c.fillStyle = '#b8913f'; c.beginPath(); c.moveTo(x - w / 2, y); c.quadraticCurveTo(x - w * 0.55, y - h * 0.8, x, y - h); c.quadraticCurveTo(x + w * 0.55, y - h * 0.8, x + w / 2, y); c.closePath(); c.fill();
    c.strokeStyle = '#9a7630'; c.lineWidth = 0.5; c.beginPath();
    for (let k = 0; k < 40; k++) { const t = R(), px = x + (R() - 0.5) * w * (1 - t * 0.8), py = y - t * h * 0.95; c.moveTo(px, py); c.lineTo(px + (R() - 0.5) * 3, py + 2); }
    c.stroke();
    c.strokeStyle = '#5a4130'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y - h - 4); c.lineTo(x, y - h * 0.7); c.stroke();
  }
  // корова (пасётся на лугу)
  function cowSide(c, x, y, dir, seed) {
    const R = rngOf(seed);
    c.save(); c.translate(x, y); c.scale(dir, 1);
    c.strokeStyle = '#3b2f28'; c.lineWidth = 1.6; c.lineCap = 'round';
    c.beginPath(); for (const lx of [-9, -6, 6, 8.5]) { c.moveTo(lx, -9); c.lineTo(lx + 0.3, -0.5); } c.stroke();
    c.fillStyle = '#f2ede4'; rr(c, -12, -19, 23, 11, 5); c.fill();
    c.fillStyle = '#3a2f2a';
    for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(-8 + R() * 15, -15 + R() * 4, 2.5 + R() * 2, 1.8 + R(), R(), 0, TAU); c.fill(); }
    c.fillStyle = '#f2ede4'; c.beginPath(); c.ellipse(13.5, -8, 3.2, 4.2, 0.6, 0, TAU); c.fill();
    c.fillStyle = '#e8b3a8'; c.beginPath(); c.ellipse(15.6, -5.6, 2.0, 1.6, 0.4, 0, TAU); c.fill();
    c.fillStyle = '#1d1712'; c.beginPath(); c.arc(13.6, -10, 0.55, 0, TAU); c.fill();
    c.strokeStyle = '#d8cbb6'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(12, -12.2); c.lineTo(11, -14); c.stroke();
    c.strokeStyle = '#3b2f28'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(-12, -16); c.quadraticCurveTo(-14, -10, -13, -6); c.stroke();
    c.fillStyle = '#e8b3a8'; c.beginPath(); c.ellipse(1, -7.6, 2.2, 1.3, 0, 0, TAU); c.fill();
    c.restore();
  }
  // километровый знак 6.13 на стойке
  function kmPost(c, x, y, km) {
    c.fillStyle = '#9aa0a4'; c.fillRect(x - 0.5, y - 26, 1.0, 26);
    c.fillStyle = '#ffffff'; c.fillRect(x - 5, y - 32, 10, 8); c.strokeStyle = '#1d1d1d'; c.lineWidth = 0.6; c.strokeRect(x - 4.4, y - 31.4, 8.8, 6.8);
    c.fillStyle = '#1d1d1d'; c.font = 'bold 5.5px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(String(km), x, y - 25.7);
  }
  // сигнальный столбик с катафотом
  function delineator(c, x, y) {
    c.fillStyle = '#f4f4f0'; c.fillRect(x - 0.8, y - 11, 1.6, 11);
    c.fillStyle = '#1d1d1d'; c.fillRect(x - 0.8, y - 9.5, 1.6, 2.2);
    c.fillStyle = '#ff9d1a'; c.fillRect(x - 0.6, y - 10.6, 1.2, 0.9);
  }
  // дорожный знак на стойке: kind 'main' (главная), 'work' (дорожные работы)
  function roadSign(c, x, y, kind) {
    c.fillStyle = '#8f969a'; c.fillRect(x - 0.45, y - 30, 0.9, 30);
    if (kind === 'main') {
      c.save(); c.translate(x, y - 33); c.rotate(Math.PI / 4);
      c.fillStyle = '#ffffff'; c.fillRect(-4.6, -4.6, 9.2, 9.2); c.fillStyle = '#f7c519'; c.fillRect(-3.3, -3.3, 6.6, 6.6);
      c.strokeStyle = '#333'; c.lineWidth = 0.3; c.strokeRect(-4.6, -4.6, 9.2, 9.2); c.restore();
    } else {
      c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(x, y - 41); c.lineTo(x + 6.2, y - 30.5); c.lineTo(x - 6.2, y - 30.5); c.closePath(); c.fill();
      c.strokeStyle = '#d22f27'; c.lineWidth = 1.3; c.lineJoin = 'round'; c.stroke();
      c.fillStyle = '#1d1d1d'; c.beginPath(); c.arc(x - 0.6, y - 36, 0.7, 0, TAU); c.fill();
      c.strokeStyle = '#1d1d1d'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(x - 0.6, y - 35.3); c.lineTo(x + 0.3, y - 33.2); c.lineTo(x - 1, y - 32); c.moveTo(x - 0.2, y - 34.6); c.lineTo(x + 1.6, y - 33.6); c.stroke();
      c.fillStyle = '#1d1d1d'; c.fillRect(x + 1.2, y - 32.6, 2.2, 0.8);
    }
  }
  // дорожный каток (на насыпи)
  function rollerSide(c, x, y, dir) {
    c.save(); c.translate(x, y); c.scale(dir, 1);
    c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(2, 0, 30, 2, 0, 0, TAU); c.fill();
    c.fillStyle = '#3a3d40'; c.beginPath(); c.arc(16, -9, 9, 0, TAU); c.fill();
    c.fillStyle = '#6c7175'; c.beginPath(); c.arc(16, -9, 7.4, 0, TAU); c.fill();
    c.fillStyle = '#f2b51c'; c.fillRect(8, -21, 16, 5); c.fillRect(13, -14, 6, 5);
    c.fillStyle = '#f2b51c'; rr(c, -26, -24, 30, 16, 2); c.fill();
    c.fillStyle = '#d99a12'; c.fillRect(-26, -12, 30, 3);
    c.fillStyle = '#2b2e31'; c.beginPath(); c.arc(-14, -8, 8, 0, TAU); c.fill(); c.fillStyle = '#5b6064'; c.beginPath(); c.arc(-14, -8, 4, 0, TAU); c.fill();
    c.fillStyle = '#f2b51c'; c.fillRect(-21, -42, 2, 18); c.fillRect(-4, -42, 2, 18); c.fillRect(-23, -44, 23, 3);
    c.fillStyle = 'rgba(160,210,235,.75)'; c.fillRect(-19, -40, 15, 12);
    c.fillStyle = '#2b2e31'; c.fillRect(-14, -30, 4, 4); c.fillRect(-2, -26, 6, 2);
    c.fillStyle = '#ff8a1a'; c.fillRect(-13, -46, 4, 2);
    c.fillStyle = '#1d1d1d'; c.font = 'bold 3px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('ДОРСТРОЙ', -11, -16);
    c.restore();
  }
  // куча щебня
  function gravelPile(c, x, y, w, h, seed) {
    const R = rngOf(seed);
    c.fillStyle = '#8b8a84'; c.beginPath(); c.moveTo(x - w / 2, y); c.quadraticCurveTo(x - w * 0.15, y - h * 1.3, x + w * 0.05, y - h); c.quadraticCurveTo(x + w * 0.3, y - h * 0.9, x + w / 2, y); c.closePath(); c.fill();
    for (let k = 0; k < w * h * 0.25; k++) { const t = R(), px = x + (R() - 0.5) * w * (1 - t) * 0.95, py = y - t * h * 0.95; c.fillStyle = R() < 0.5 ? '#6d6c67' : '#a8a7a0'; c.fillRect(px, py, 0.9, 0.7); }
  }
  // лодка, вытащенная на берег (борт — доски, вёсла)
  function boatSide(c, x, y, dir, tilt) {
    c.save(); c.translate(x, y); c.rotate(tilt || 0); c.scale(dir, 1);
    c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(0, 0.5, 26, 2, 0, 0, TAU); c.fill();
    c.fillStyle = '#4f6f8a'; c.beginPath(); c.moveTo(-26, -9); c.lineTo(24, -10); c.quadraticCurveTo(22, -1, 14, 0); c.lineTo(-20, 0); c.quadraticCurveTo(-25, -2, -26, -9); c.closePath(); c.fill();
    c.strokeStyle = '#3c566c'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(-25, -6); c.lineTo(22.5, -6.5); c.moveTo(-23, -3); c.lineTo(19, -3.2); c.stroke();
    c.fillStyle = '#e9e4d6'; c.fillRect(-26, -10.4, 50, 1.6);
    c.fillStyle = '#a77a4a'; c.fillRect(-6, -11.6, 2, 1.4); c.fillRect(8, -11.8, 2, 1.4);
    c.strokeStyle = '#b48a55'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(-10, -12); c.lineTo(18, -17); c.stroke();
    c.fillStyle = '#b48a55'; c.beginPath(); c.ellipse(19.5, -17.3, 2.6, 0.9, -0.18, 0, TAU); c.fill();
    c.fillStyle = '#c94a32'; c.font = 'bold 3.2px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('Р-17', -12, -4.5);
    c.restore();
  }
  // утка (селезень/утка), (x, y) — уровень воды
  function duckSide(c, x, y, dir, drake, t) {
    c.save(); c.translate(x, y + Math.sin(t * 3) * 0.3); c.scale(dir, 1);
    c.fillStyle = drake ? '#8f8a80' : '#8a6a46'; c.beginPath(); c.ellipse(0, -1.6, 4.2, 2.2, 0, 0, TAU); c.fill();
    c.fillStyle = drake ? '#5b4a3a' : '#6e5235'; c.beginPath(); c.moveTo(-4.2, -2); c.lineTo(-6, -3.4); c.lineTo(-3.6, -2.9); c.fill();
    c.fillStyle = drake ? '#3f2b22' : '#7e603e'; c.beginPath(); c.ellipse(1.2, -2.6, 2.6, 1.1, -0.2, 0, TAU); c.fill();
    c.fillStyle = drake ? '#1e6b3a' : '#8a6a46'; c.beginPath(); c.arc(3.6, -4.8, 1.5, 0, TAU); c.fill();
    if (drake) { c.fillStyle = '#ffffff'; c.fillRect(2.6, -3.5, 1.8, 0.45); }
    c.fillStyle = '#e8b33a'; c.beginPath(); c.moveTo(4.8, -5); c.lineTo(6.6, -4.4); c.lineTo(4.9, -4.2); c.closePath(); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.arc(4.1, -5.2, 0.32, 0, TAU); c.fill();
    c.restore();
  }
  // грунтовый репер с опознавательным столбом
  function benchmark(c, x, y, name) {
    c.fillStyle = '#a9a69c'; c.fillRect(x - 2.4, y - 1.6, 4.8, 1.6);
    c.fillStyle = '#c9c5b8'; c.fillRect(x - 1.6, y - 2.6, 3.2, 1.2);
    c.fillStyle = '#d7a335'; c.beginPath(); c.arc(x, y - 2.8, 0.9, Math.PI, TAU); c.fill();
    c.fillStyle = '#e6e1d3'; c.fillRect(x + 5, y - 15, 1.6, 15);
    c.fillStyle = '#ffffff'; c.fillRect(x + 1.2, y - 22, 9.2, 7);
    c.strokeStyle = '#c8322a'; c.lineWidth = 0.6; c.strokeRect(x + 1.6, y - 21.6, 8.4, 6.2);
    c.fillStyle = '#c8322a'; c.font = 'bold 2.8px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('ГГС', x + 5.8, y - 19); c.fillText(name, x + 5.8, y - 16.2);
  }
  // баня у реки (сруб, двускатная крыша, труба)
  function banya(c, x, y, seed) {
    const R = rngOf(seed);
    const w = 44, h = 28, roof = ['#7a3b2e', '#4f6b5a', '#5a5f66'][R() * 3 | 0];
    c.fillStyle = '#8a5a34'; c.fillRect(x - w / 2, y - h, w, h);
    c.strokeStyle = '#6a4224'; c.lineWidth = 0.6; c.beginPath();
    for (let yy = y - h + 2.4; yy < y; yy += 2.4) { c.moveTo(x - w / 2, yy); c.lineTo(x + w / 2, yy); }
    c.stroke();
    c.fillStyle = '#a06c40'; for (let yy = y - h + 1.2; yy < y; yy += 2.4) { c.beginPath(); c.arc(x - w / 2, yy, 1.2, 0, TAU); c.arc(x + w / 2, yy, 1.2, 0, TAU); c.fill(); }
    c.fillStyle = roof; c.beginPath(); c.moveTo(x - w / 2 - 4, y - h + 1); c.lineTo(x, y - h - 14); c.lineTo(x + w / 2 + 4, y - h + 1); c.closePath(); c.fill();
    c.fillStyle = shade(roof, 0.18); c.beginPath(); c.moveTo(x - w / 2 - 4, y - h + 1); c.lineTo(x, y - h - 14); c.lineTo(x - 2, y - h + 1); c.closePath(); c.fill();
    c.fillStyle = '#6b6e72'; c.fillRect(x + 8, y - h - 14, 3, 9);
    c.fillStyle = '#e6dfcf'; c.fillRect(x - 15, y - h + 8, 8, 7); c.fillStyle = '#7fb3cf'; c.fillRect(x - 14, y - h + 9, 6, 5);
    c.strokeStyle = '#e6dfcf'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(x - 11, y - h + 9); c.lineTo(x - 11, y - h + 14); c.stroke();
    c.fillStyle = '#5a3a22'; c.fillRect(x + 4, y - 20, 9, 20);
    c.fillStyle = '#e0c060'; c.beginPath(); c.arc(x + 11, y - 10, 0.6, 0, TAU); c.fill();
  }
  // забор из штакетника
  function picketFence(c, x0, x1, gy, col) {
    c.fillStyle = col || '#b9a27a';
    for (let x = x0; x < x1; x += 3) { const y = gy(x); c.fillRect(x - 0.7, y - 11, 1.4, 11); c.beginPath(); c.moveTo(x - 0.7, y - 11); c.lineTo(x, y - 12.2); c.lineTo(x + 0.7, y - 11); c.fill(); }
    c.strokeStyle = shade(col || '#b9a27a', -0.3); c.lineWidth = 0.9; c.beginPath();
    for (const k of [3.5, 8.5]) { c.moveTo(x0, gy(x0) - k); for (let x = x0 + 4; x <= x1; x += 4) c.lineTo(x, gy(x) - k); }
    c.stroke();
  }
  // деревянная опора ЛЭП 0,4 кВ с траверсой и изоляторами
  function powerPole(c, x, y) {
    c.fillStyle = '#6e5a44'; c.fillRect(x - 1.1, y - 62, 2.2, 62);
    c.fillStyle = '#8a8f93'; c.fillRect(x - 1.4, y - 14, 2.8, 14);
    c.fillStyle = '#4e4e4e'; c.fillRect(x - 9, y - 57, 18, 1.4);
    c.fillStyle = '#e8e4da'; for (const k of [-7.5, -2.5, 2.5, 7.5]) { c.fillRect(x + k - 0.6, y - 60, 1.2, 3); }
    c.strokeStyle = 'rgba(40,40,40,.6)'; c.lineWidth = 0.35; c.beginPath();
    for (const k of [-7.5, -2.5, 2.5, 7.5]) { c.moveTo(x + k, y - 60); c.lineTo(x + k * 1.6 + 6, y - 61.5); }
    c.stroke();
  }

  registerMode({
    index: 3,
    id: 'staffman',
    title: 'Реечник',
    subtitle: 'Нивелирование трассы — продольный профиль',
    howto: [ // на W = 560 карточка вмещает 9 строк — вместе со строкой варианта
      '◀ ▶ — идти, ▲ или свайп вверх — прыжок через канаву и бревно.',
      'Снимите все пикеты ПК, перегибы и характерные точки: у колышка держите РЕЙКА.',
      'Гоните пузырёк уровня в центр ◀ ▶ или пальцем; 0,7 с в центре — отсчёт.',
      'Луч горизонтален: дальше 65 м, над/под рейкой, за бугром — «Не вижу!» → ПЕРЕНОС.',
    ],
    variants: [
      { id: 'road', title: 'Трасса дороги', subtitle: 'Поле, насыпь с трубой, переезд через шоссе с кюветами',
        howto: ['Точки: бровка и дно кювета, край проезжей части, подошва и бровка насыпи.'] },
      { id: 'river', title: 'Берег реки', subtitle: 'Луг, крутой берег, отмель и брод — профиль через реку',
        howto: ['Точки: бровка и подошва откоса, урез воды, дно, уступ. В воде рейка шатается.'] },
    ],
    create(api, variant, seed) { api0 = api; return createLevel(api, variant, seed); },
  });

  // ---------- генерация участка ----------
  // Рельеф — ломаная по вершинам {x, h}; вершины внутри трассы — перегибы и характерные точки (их надо снять).
  // Точка либо совпадает с пикетом, либо отстоит от пикетов и соседей не меньше чем на 16 ед. (4 м).
  function genWorld(seed, vid) {
    for (let a = 0; a < 30; a++) { const w = tryGen(rngOf((seed ^ Math.imul(a + 1, 0x9E3779B1)) | 0), vid, false); if (w) return w; }
    return tryGen(rngOf(seed), vid, true); // запас: спокойный рельеф без препятствий — решаем всегда
  }
  function tryGen(R, vid, simple) {
    const rnd = (a, b) => a + R() * (b - a), ri = (a, b) => Math.floor(rnd(a, b + 1));
    const N = ri(14, 16), L = N * PK, XA = -300, XB = L + 320;
    const H0 = Math.round(rnd(132, 186) * 100) / 100;
    const V = [], feats = [];
    let x = XA, h = H0, s = rnd(-0.015, 0.015);
    V.push({ x, h });
    const fixX = (nx, prev) => {
      nx = Math.max(nx, prev + 16);
      if (nx < -8 || nx > L + 8) return nx;
      const k = Math.round(nx / PK), pk = k * PK, d = nx - pk;
      if (k < 0 || k > N || Math.abs(d) >= 16) return nx;
      if (Math.abs(d) <= 8 && pk >= prev + 16) return pk;
      if (d < 0) return pk - 16 >= prev + 16 ? pk - 16 : pk;
      return pk + 16;
    };
    const lim = simple ? 0.02 : 0.045;
    function walkTo(xEnd) { // поле с перегибами до xEnd
      for (let guard = 0; guard < 60; guard++) {
        const rem = xEnd - x;
        if (rem < 64) break;
        let nx = fixX(x + rnd(44, Math.min(122, rem - 22)), x);
        if (nx > xEnd - 20) break;
        h += s * (nx - x) / MX; x = nx;
        let ns = s;
        for (let g = 0; g < 12 && Math.abs(ns - s) < 0.015; g++) ns = clamp(s + (R() < 0.5 ? -1 : 1) * rnd(0.016, simple ? 0.022 : 0.04) + (H0 - h) * 0.006, -lim, lim);
        V.push({ x, h, brk: Math.abs(ns - s) >= 0.015 });
        s = ns;
      }
    }
    function start(xs, name) { const nx = fixX(xs, x); h += s * (nx - x) / MX; x = nx; V.push({ x, h, name }); }
    function emit(dx, nh, name) { const nx = fixX(x + dx, x); x = nx; h = nh; V.push({ x, h, name }); }
    if (!simple && vid === 'road') {
      const order = R() < 0.5 ? ['road', 'emb'] : ['emb', 'road'];
      let pos = rnd(0.14, 0.3) * L;
      for (const f of order) {
        walkTo(pos);
        if (f === 'road') {
          start(pos, 'бровка кювета');
          const a0 = x, h0 = h, dd = rnd(0.6, 0.85), up = rnd(0.35, 0.7), gr = rnd(-0.08, 0.08), h1 = h0 + rnd(-0.25, 0.25);
          emit(18, h0 - dd, 'дно кювета'); const d1 = x;
          emit(22, h0 + up, 'край проезжей части'); const e1 = x;
          emit(40, h0 + up + gr, 'край проезжей части'); const e2 = x;
          emit(22, h1 - dd * rnd(0.85, 1.1), 'дно кювета'); const d2 = x;
          emit(18, h1, 'бровка кювета');
          feats.push({ kind: 'road', x0: a0, x1: x, d1, d2, e1, e2, km: ri(3, 48) });
          s = rnd(-0.02, 0.02);
        } else {
          start(pos, 'подошва насыпи');
          const a0 = x, h0 = h, E = rnd(1.5, 2.1);
          emit(ri(24, 30), h0 + E, 'бровка насыпи'); const t0 = x;
          emit(ri(110, 160), h0 + E + rnd(-0.25, 0.25), 'бровка насыпи'); const t1 = x;
          const h1 = h0 + rnd(-0.35, 0.35);
          emit(ri(24, 30), h1, 'подошва насыпи');
          feats.push({ kind: 'emb', x0: a0, x1: x, t0, t1, hA: h0, hB: h1, dip: rnd(0.55, 0.95), pipeR: rnd(0.5, 0.65) });
          s = rnd(-0.02, 0.02);
        }
        pos = x + rnd(90, 210);
      }
      if (x > L - 70) return null;
    } else if (!simple) {
      walkTo(rnd(0.18, 0.32) * L);
      start(x + 40, 'бровка берега');
      const b0 = x, hTop = h;
      emit(ri(34, 44), hTop - rnd(2.4, 3.1), 'подошва откоса'); const b1 = x;
      const Hw = h - rnd(0.25, 0.4);
      emit(ri(24, 34), Hw, 'урез воды'); const w0 = x;
      const n = ri(2, 3), Wd = ri(150, 190), parts = [];
      let sum = 0; for (let k = 0; k <= n; k++) { const v = 0.6 + R(); parts.push(v); sum += v; }
      const deep = ri(0, n - 1);
      for (let k = 0; k < n; k++) emit(32 + (Wd - 32 * (n + 1)) * parts[k] / sum, Hw - (k === deep ? rnd(0.62, 0.8) : rnd(0.3, 0.62)), 'дно реки');
      emit(32 + (Wd - 32 * (n + 1)) * parts[n] / sum, Hw, 'урез воды'); const w1 = x;
      emit(ri(64, 96), Hw + rnd(0.25, 0.5), 'подошва уступа'); const t0 = x;
      emit(ri(24, 32), h + rnd(1.0, 1.45), 'бровка уступа'); const t1 = x;
      feats.push({ kind: 'river', b0, b1, w0, w1, Hw, t0, t1, hTop });
      s = rnd(-0.012, 0.02);
      if (x > L - 90) return null;
    }
    walkTo(XB);
    h += s * (XB - x) / MX; x = XB; V.push({ x, h });

    // высоты по сетке 1 ед.: HB — профиль, HW — поверхность, по которой ходят (с канавами)
    const n1 = XB - XA + 1, HB = new Float32Array(n1);
    for (let i = 0, j = 0; i < n1; i++) {
      const xx = XA + i;
      while (j < V.length - 2 && V[j + 1].x <= xx) j++;
      const a = V[j], b = V[j + 1];
      HB[i] = a.h + (b.h - a.h) * clamp((xx - a.x) / ((b.x - a.x) || 1), 0, 1);
    }
    const HW = HB.slice();
    const w = { vid, N, L, XA, XB, H0, V, HB, HW, feats, simple };
    geo(w);

    // обязательные точки: пикеты, перегибы, характерные точки
    const pts = [];
    for (let k = 0; k <= N; k++) pts.push({ x: k * PK, kind: 'pk', name: 'ПК' + k, alt: '' });
    for (const v of V) {
      if (v.x < -0.5 || v.x > L + 0.5 || !(v.brk || v.name)) continue;
      const k = Math.round(v.x / PK);
      if (Math.abs(v.x - k * PK) < 0.5) { pts[k].alt = v.name || 'перегиб'; continue; }
      pts.push({ x: v.x, kind: v.name ? 'char' : 'brk', name: v.name || 'перегиб', alt: '' });
    }
    pts.sort((a, b) => a.x - b.x);
    for (const p of pts) {
      const k = Math.floor(p.x / PK + 1e-6), d = (p.x - k * PK) / MX;
      p.k = k; p.lab = d < 0.05 ? 'ПК' + k : 'ПК' + k + '+' + fmt(d, d % 1 ? 1 : 0);
      p.h = w.hb(p.x);
    }
    w.pts = pts;

    // препятствия: канавы (прыжок), бревно (прыжок), крапива и лужи (замедление), кусты на трассе (закрывают луч)
    const ob = w.ob = { ditch: [], log: [], nettle: [], puddle: [], bush: [], reeds: [] };
    const fx = feats.map(f => [Math.min(f.x0 ?? f.b0, f.b0 ?? f.x0) - 26, Math.max(f.x1 ?? f.t1, f.t1 ?? f.x1) + 26]);
    const nearPt = (a, b, m) => pts.some(p => p.x > a - m && p.x < b + m);
    const nearOb = (a, b, m) => ob.ditch.concat(ob.log, ob.bush).some(o => a < o.x1 + m && b > o.x0 - m);
    const inFeat = (a, b) => fx.some(f => a < f[1] && b > f[0]);
    const place = (len, cond, tries) => {
      for (let t = 0; t < (tries || 60); t++) { const a = rnd(30, L - 30 - len), b = a + len; if (cond(a, b)) return [a, b]; }
      return null;
    };
    if (!simple) {
      const riv = feats.find(f => f.kind === 'river');
      const nD = vid === 'road' ? ri(1, 2) : 1;
      for (let k = 0; k < nD; k++) {
        const len = ri(18, 24), r = place(len, (a, b) => !inFeat(a, b) && !nearPt(a, b, 17) && !nearOb(a, b, 80), 160);
        if (r) { const dd = rnd(0.8, 1.0); ob.ditch.push({ x0: r[0], x1: r[1], dd }); for (let xx = Math.ceil(r[0]); xx <= r[1]; xx++) HW[xx - XA] = HB[xx - XA] - dd * Math.min(1, (xx - r[0]) / 5, (r[1] - xx) / 5); }
      }
      if (vid === 'road' ? R() < 0.75 || !ob.ditch.length : true) {
        const r = place(14, (a, b) => !nearPt(a, b, 19) && !nearOb(a, b, 80) && (riv ? (a > riv.w1 + 10 && b < riv.t0 - 10) || !inFeat(a, b) : !inFeat(a, b)), 160);
        if (r) ob.log.push({ x0: r[0], x1: r[1], x: (r[0] + r[1]) / 2, r: rnd(4.4, 5.6) });
      }
      for (let k = ri(1, 2); k > 0; k--) {
        const len = ri(26, 44), r = place(len, (a, b) => !inFeat(a, b) && !nearOb(a, b, 16) && !ob.nettle.some(o => a < o.x1 + 30 && b > o.x0 - 30));
        if (r) ob.nettle.push({ x0: r[0], x1: r[1] });
      }
      for (let k = vid === 'road' ? ri(1, 2) : 1; k > 0; k--) {
        const len = ri(18, 28), r = place(len, (a, b) => (riv ? a > riv.w1 + 8 && b < riv.t0 - 4 : !inFeat(a, b)) && !nearOb(a, b, 12) && Math.abs(w.slope(a)) < 0.03 && Math.abs(w.slope(b)) < 0.03 && !ob.nettle.some(o => a < o.x1 + 8 && b > o.x0 - 8) && !ob.puddle.some(o => a < o.x1 + 40 && b > o.x0 - 40));
        if (r) ob.puddle.push({ x0: r[0], x1: r[1] });
      }
      if (vid === 'road' && R() < 0.7) {
        const len = ri(14, 20), r = place(len, (a, b) => !inFeat(a, b) && !nearPt(a, b, 22) && !nearOb(a, b, 60) && !ob.nettle.some(o => a < o.x1 && b > o.x0) && !ob.puddle.some(o => a < o.x1 && b > o.x0));
        if (r) ob.bush.push({ x0: r[0], x1: r[1], x: (r[0] + r[1]) / 2, top: w.hb((r[0] + r[1]) / 2) + rnd(2.0, 2.4), seed: ri(1, 1e6) });
      }
      if (riv) { ob.reeds.push({ x0: riv.w0 - 14, x1: riv.w0 + 10 }, { x0: riv.w1 - 10, x1: riv.w1 + 16 }); }
    }
    w.I = Math.round(rnd(1.46, 1.58) * 100) / 100; // высота инструмента, м
    w.water = null;
    const riv = feats.find(f => f.kind === 'river');
    if (riv) w.water = { x0: riv.w0, x1: riv.w1, Hw: riv.Hw };
    const emb = feats.find(f => f.kind === 'emb');
    if (emb) { // труба: не меньше 0,35 м засыпки над трубой
      const xc = (emb.x0 + emb.x1) / 2, hn = lerp(emb.hA, emb.hB, 0.5) - emb.dip;
      const cover = w.hb(xc) - (hn + 0.12 + 2 * emb.pipeR);
      if (cover < 0.35) emb.dip = Math.max(0.1, emb.dip - (0.35 - cover));
      emb.xc = xc;
    }

    // проверка решаемости: жадный проход (как бот) и перенос на каждую точку
    const st0 = w.reloc(-30, 1, 0);
    let stX = st0, n = 0;
    for (const p of pts) {
      if (!w.sight(p.x, stX).ok) { stX = w.reloc(p.x - 4, 1, p.x); n++; if (!w.sight(p.x, stX).ok) return null; }
    }
    for (const p of pts) {
      for (const d of [1, -1]) { const sx = w.reloc(p.x - 4 * d, d, p.x); if (!w.sight(p.x, sx).ok) return null; }
      if (ob.ditch.some(o => p.x > o.x0 - 12 && p.x < o.x1 + 12) || ob.log.some(o => Math.abs(p.x - o.x) < 16)) return null;
    }
    w.st0 = st0; w.relocMin = n;
    return w;
  }

  // геометрия участка: высоты, уклон, видимость рейки, выбор места станции
  function geo(w) {
    const { XA, XB, HB, HW } = w;
    const smp = (A, x) => { let i = x - XA; if (i <= 0) return A[0]; if (i >= A.length - 1) return A[A.length - 1]; const i0 = i | 0, f = i - i0; return A[i0] + (A[i0 + 1] - A[i0]) * f; };
    w.hb = x => smp(HB, x);
    w.hw = x => smp(HW, x);
    w.slope = x => (smp(HW, x + 2) - smp(HW, x - 2)) / (4 / MX);
    w.inWater = x => !!w.water && x > w.water.x0 && x < w.water.x1 && smp(HW, x) < w.water.Hw - 0.01;
    w.stationOK = x => {
      if (x < XA + 30 || x > XB - 30) return false;
      if (w.water && x > w.water.x0 - 3 && x < w.water.x1 + 3) return false;
      if (Math.abs(w.slope(x)) > 0.12 || Math.abs(w.slope(x - 5)) > 0.2 || Math.abs(w.slope(x + 5)) > 0.2) return false;
      const ob = w.ob;
      if (ob) {
        for (const o of ob.ditch) if (x > o.x0 - 9 && x < o.x1 + 9) return false;
        for (const o of ob.log) if (Math.abs(x - o.x) < 14) return false;
        for (const o of ob.bush) if (x > o.x0 - 8 && x < o.x1 + 8) return false;
        for (const o of ob.puddle) if (x > o.x0 - 4 && x < o.x1 + 4) return false;
      }
      return true;
    };
    // видна ли рейка в точке sx с нивелира на станции stX: { ok, why, r — отсчёт, м; at — где упёрся луч }
    w.sight = (sx, stX, hiAbs) => {
      const HI = hiAbs != null ? hiAbs : smp(HW, stX) + w.I;
      const d = Math.abs(sx - stX);
      const r = HI - smp(HW, sx);
      if (d > RANGE) return { ok: false, why: 'far', r, HI };
      const dir = sx >= stX ? 1 : -1;
      for (let x = stX + dir * 6; dir > 0 ? x < sx - 3 : x > sx + 3; x += dir * 2) if (smp(HW, x) > HI - 0.04) return { ok: false, why: 'hill', r, at: x, HI };
      if (w.ob) for (const b of w.ob.bush) if ((b.x - stX) * dir > 4 && (sx - b.x) * dir > 3 && b.top > HI) return { ok: false, why: 'bush', r, at: b.x, HI };
      if (r < 0.02) return { ok: false, why: 'low', r, HI };
      if (r > STAFF - 0.03) return { ok: false, why: 'high', r, HI };
      return { ok: true, r, HI };
    };
    // куда ставить нивелир при переносе: рядом с реечником (позади него), на сухом и ровном, откуда видна рейка
    w.reloc = (heroX, facing, sx) => {
      const base = heroX - 8 * facing;
      let first = null;
      for (let d = 0; d <= 160; d += 2) {
        for (let k = 0; k < (d ? 2 : 1); k++) {
          const x = k ? base + facing * d : base - facing * d;
          if (k && d > 26) continue;
          if (!w.stationOK(x)) continue;
          if (first === null) first = x;
          if (w.sight(sx, x).ok) return x;
        }
      }
      return first !== null ? first : base;
    };
  }

  // жилой дом сбоку (для среднего плана): сруб/сайдинг/кирпич, наличники, двускатная крыша
  function houseSide(c, x, y, wd, ht, R) {
    const walls = ['#c8a26b', '#7f9cb0', '#d7c98f', '#9cae7c', '#b3644a', '#e0d6c2'], roofs = ['#7a3b2e', '#3f6b54', '#5a5f66', '#8a4f2a', '#2f5d7a'];
    const wc = walls[R() * walls.length | 0], rc = roofs[R() * roofs.length | 0], log = R() < 0.4;
    c.fillStyle = wc; c.fillRect(x - wd / 2, y - ht, wd, ht);
    c.strokeStyle = shade(wc, -0.18); c.lineWidth = 0.5; c.beginPath();
    for (let yy = y - ht + (log ? 2.2 : 1.5); yy < y; yy += log ? 2.2 : 1.5) { c.moveTo(x - wd / 2, yy); c.lineTo(x + wd / 2, yy); }
    c.stroke();
    c.fillStyle = shade(wc, -0.35); c.fillRect(x - wd / 2, y - 2.5, wd, 2.5);
    const nw = Math.max(2, Math.round(wd / 12));
    for (let k = 0; k < nw; k++) {
      const wx = x - wd / 2 + (k + 0.5) * wd / nw;
      c.fillStyle = '#f4f1ea'; c.fillRect(wx - 3.2, y - ht * 0.72 - 1, 6.4, 9.5);
      c.beginPath(); c.moveTo(wx - 3.8, y - ht * 0.72 - 1); c.lineTo(wx, y - ht * 0.72 - 3.4); c.lineTo(wx + 3.8, y - ht * 0.72 - 1); c.fill();
      c.fillStyle = R() < 0.3 ? '#f3d58a' : '#6f97ad'; c.fillRect(wx - 2.4, y - ht * 0.72, 4.8, 7.5);
      c.fillStyle = '#f4f1ea'; c.fillRect(wx - 0.3, y - ht * 0.72, 0.6, 7.5); c.fillRect(wx - 2.4, y - ht * 0.72 + 2.6, 4.8, 0.5);
    }
    const rh = ht * (0.55 + R() * 0.2);
    c.fillStyle = rc; c.beginPath(); c.moveTo(x - wd / 2 - 3, y - ht + 0.5); c.lineTo(x, y - ht - rh); c.lineTo(x + wd / 2 + 3, y - ht + 0.5); c.closePath(); c.fill();
    c.fillStyle = shade(rc, 0.2); c.beginPath(); c.moveTo(x - wd / 2 - 3, y - ht + 0.5); c.lineTo(x, y - ht - rh); c.lineTo(x - 1, y - ht + 0.5); c.closePath(); c.fill();
    c.strokeStyle = shade(rc, -0.25); c.lineWidth = 0.4; c.beginPath();
    for (let k = 1; k < 6; k++) { const t = k / 6; c.moveTo(lerp(x - wd / 2 - 3, x, t), lerp(y - ht + 0.5, y - ht - rh, t)); c.lineTo(lerp(x + wd / 2 + 3, x, t), lerp(y - ht + 0.5, y - ht - rh, t)); }
    c.stroke();
    if (R() < 0.8) { c.fillStyle = '#8a3b2b'; c.fillRect(x + wd * 0.18, y - ht - rh * 0.75, 3, rh * 0.55); c.fillStyle = '#5a5a5a'; c.fillRect(x + wd * 0.18 - 0.4, y - ht - rh * 0.75 - 0.8, 3.8, 0.9); }
    if (R() < 0.4) { c.strokeStyle = '#555'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(x - wd * 0.2, y - ht - rh * 0.5); c.lineTo(x - wd * 0.2, y - ht - rh - 6); c.moveTo(x - wd * 0.2 - 3, y - ht - rh - 4); c.lineTo(x - wd * 0.2 + 3, y - ht - rh - 4); c.stroke(); }
    if (R() < 0.5) { c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x + wd * 0.3, y - ht * 0.3, 2.2, 0, TAU); c.fill(); c.fillStyle = '#ddd'; c.fillRect(x + wd * 0.3 - 0.3, y - ht * 0.3, 0.6, 3); }
  }
  // церковь с луковкой (силуэт дальнего плана)
  function church(c, x, y, s, col, dome) {
    c.fillStyle = col; c.fillRect(x - 6 * s, y - 16 * s, 12 * s, 16 * s); c.fillRect(x - 3.5 * s, y - 26 * s, 7 * s, 10 * s);
    c.fillRect(x + 8 * s, y - 30 * s, 5 * s, 30 * s);
    c.fillStyle = dome; c.beginPath(); c.ellipse(x, y - 28 * s, 3.6 * s, 3.6 * s, 0, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(x - 2.4 * s, y - 30 * s); c.lineTo(x, y - 34 * s); c.lineTo(x + 2.4 * s, y - 30 * s); c.fill();
    c.beginPath(); c.moveTo(x + 8 * s, y - 30 * s); c.lineTo(x + 10.5 * s, y - 37 * s); c.lineTo(x + 13 * s, y - 30 * s); c.fill();
    c.fillRect(x - 0.3 * s, y - 37 * s, 0.6 * s, 3 * s); c.fillRect(x - 1.2 * s, y - 36 * s, 2.4 * s, 0.5 * s);
  }

  function createLevel(api, variant, seed) {
    const vid = variant.id;
    const w = genWorld(seed, vid);
    const titleW = (() => { try { const c = document.createElement('canvas').getContext('2d'); c.font = 'bold 12px system-ui, sans-serif'; return c.measureText('Реечник · ' + variant.title).width; } catch (e) { return 170; } })();
    const { L, N, XA, XB, pts, ob, feats } = w;
    const R = rngOf(seed ^ 0x51ed27), rnd = (a, b) => a + R() * (b - a), ri = (a, b) => Math.floor(rnd(a, b + 1));
    const HREF = w.H0 + 2;
    const yOf = hh => (HREF - hh) * VY;
    const gy = x => yOf(w.hw(x));
    const road = feats.find(f => f.kind === 'road'), emb = feats.find(f => f.kind === 'emb'), riv = feats.find(f => f.kind === 'river');
    const inZ = (arr, x) => { for (const o of arr) if (x > o.x0 && x < o.x1) return o; return null; };

    // ---------- время суток и палитра ----------
    const TOD = [
      { sky0: '#7fb6e6', sky1: '#f4e3c3', sun: '#fff2c4', sx: 0.18, sy: 0.2, haze: '#cfdbe0', far: '#8fa7b4', far2: '#7d98a3', light: 1 },
      { sky0: '#4f97da', sky1: '#cfe6f5', sun: '#ffffff', sx: 0.62, sy: 0.08, haze: '#c8dbe6', far: '#86a3b5', far2: '#6f90a3', light: 1.05 },
      { sky0: '#5b6fae', sky1: '#f2b179', sun: '#ffd9a0', sx: 0.82, sy: 0.3, haze: '#e1c3a8', far: '#8f8aa0', far2: '#7a7790', light: 0.92 },
    ][R() < 0.4 ? 0 : R() < 0.6 ? 1 : 2];

    // ---------- материалы поверхности ----------
    const zones = [];
    for (let x = XA; x < XB;) { const len = rnd(140, 360), m = vid === 'road' ? (R() < 0.5 ? 'field' : 'grass') : (R() < 0.75 ? 'grass' : 'mown'); zones.push({ x0: x, x1: x + len, m }); x += len; }
    const setZone = (x0, x1, m) => { // наложить участок материала поверх
      const out = [];
      for (const z of zones) {
        if (z.x1 <= x0 || z.x0 >= x1) { out.push(z); continue; }
        if (z.x0 < x0) out.push({ x0: z.x0, x1: x0, m: z.m });
        if (z.x1 > x1) out.push({ x0: x1, x1: z.x1, m: z.m });
      }
      out.push({ x0, x1, m }); out.sort((a, b) => a.x0 - b.x0); zones.length = 0; zones.push(...out);
    };
    if (road) { setZone(road.x0 - 4, road.x1 + 4, 'grass'); setZone(road.e1 - 9, road.e1, 'shoulder'); setZone(road.e2, road.e2 + 9, 'shoulder'); setZone(road.e1, road.e2, 'asphalt'); setZone(road.d1 - 7, road.d1 + 7, 'sedge'); setZone(road.d2 - 7, road.d2 + 7, 'sedge'); }
    if (emb) setZone(emb.x0, emb.x1, 'embank');
    if (riv) { setZone(riv.b0 - 30, riv.b0 + 1, 'grass'); setZone(riv.b0 + 1, riv.b1, 'clay'); setZone(riv.b1, riv.w0, 'sand'); setZone(riv.w0, riv.w1, 'silt'); setZone(riv.w1, riv.w1 + 12, 'sand'); setZone(riv.w1 + 12, riv.t1 + 4, 'wet'); }
    for (const o of ob.ditch) setZone(o.x0 - 3, o.x1 + 3, 'sedge');
    const matAt = x => { for (const z of zones) if (x >= z.x0 && x < z.x1) return z.m; return 'grass'; };

    // ---------- декор: позади разреза (в кэш грунта), деревья (спрайты), передний план ----------
    const deco = [], trees = [];
    const busy = []; // занятые места (не ставить крупный декор поверх)
    const free = (a, b) => !busy.some(r => a < r[1] && b > r[0]) && !(road && a < road.x1 + 10 && b > road.x0 - 10) && !(riv && a < riv.w1 + 6 && b > riv.b0 - 6);
    const add = (o, a, b) => { deco.push(o); if (a != null) busy.push([a, b]); };
    add({ kind: 'bm', x: -66, name: 'Рп ' + ri(11, 98) }, -76, -50);
    add({ kind: 'bm', x: L + 44, name: 'Рп ' + ri(11, 98) }, L + 34, L + 60);
    if (road) {
      add({ kind: 'deli', x: road.e1 + 2 }); add({ kind: 'deli', x: road.e2 - 2 });
      add({ kind: 'sign', x: road.e1 - 5, s: 'main' }); add({ kind: 'km', x: road.e2 + 6, km: road.km });
    }
    if (emb) {
      const rx = lerp(emb.t0, emb.t1, rnd(0.3, 0.7)), dir = R() < 0.5 ? 1 : -1;
      add({ kind: 'roller', x: rx, dir }, rx - 30, rx + 30);
      add({ kind: 'sign', x: emb.x0 - 10, s: 'work' }, emb.x0 - 16, emb.x0 - 4);
      const gx = R() < 0.5 ? emb.t0 + 14 : emb.t1 - 14;
      if (Math.abs(gx - rx) > 44) add({ kind: 'gravel', x: gx, w: 26, h: 9, seed: ri(1, 1e6) });
    }
    if (riv) {
      add({ kind: 'boat', x: lerp(riv.b1, riv.w0, 0.55), dir: R() < 0.5 ? 1 : -1 });
      add({ kind: 'holes', x0: riv.b0 + 4, x1: riv.b1 - 10 });
      add({ kind: 'roots', x0: riv.b0 - 2, x1: riv.b0 + 8 });
      const bx = riv.t1 + rnd(50, 120);
      if (bx < XB - 80) add({ kind: 'banya', x: bx, seed: ri(1, 1e6) }, bx - 34, bx + 34), add({ kind: 'fence', x0: bx + 34, x1: bx + 34 + rnd(60, 110) }, bx + 34, bx + 150);
    }
    for (let k = 0, n = vid === 'road' ? ri(2, 3) : ri(1, 2); k < n; k++) { // рулоны сена или стог, корова
      for (let t = 0; t < 30; t++) {
        const x = rnd(XA + 60, XB - 60);
        if (!free(x - 16, x + 16)) continue;
        if (vid === 'road') add({ kind: 'hay', x, r: rnd(6.5, 8) }, x - 12, x + 12);
        else if (k === 0) add({ kind: 'stack', x, w: rnd(26, 34), h: rnd(30, 38), seed: ri(1, 1e6) }, x - 20, x + 20);
        else add({ kind: 'cow', x, dir: R() < 0.5 ? 1 : -1, seed: ri(1, 1e6) }, x - 20, x + 20);
        break;
      }
    }
    for (let k = 0, n = ri(1, 2); k < n; k++) for (let t = 0; t < 30; t++) { const x = rnd(XA + 60, XB - 60); if (free(x - 12, x + 12)) { add({ kind: 'pole', x }, x - 12, x + 12); break; } }
    for (let k = 0, n = ri(4, 7); k < n; k++) for (let t = 0; t < 30; t++) { const x = rnd(XA + 30, XB - 30); if (!busy.some(r => x > r[0] - 6 && x < r[1] + 6)) { add({ kind: 'bush', x, r: rnd(5, 9), seed: ri(1, 1e6), fl: R() < 0.3 ? (R() < 0.5 ? '#f4f0e6' : '#e86a8a') : null }); break; } }
    // деревья у трассы (позади разреза): разные породы
    const kinds = vid === 'road' ? ['birch', 'birch', 'oak', 'pine', 'spruce'] : ['willow', 'birch', 'oak', 'willow', 'pine', 'spruce'];
    for (let k = 0, n = ri(7, 10); k < n; k++) for (let tt = 0; tt < 40; tt++) {
      const x = rnd(XA + 40, XB - 40);
      if (trees.some(q => Math.abs(q.x - x) < 70) || !free(x - 20, x + 20)) continue;
      let kind = kinds[R() * kinds.length | 0];
      if (riv && x > riv.w1 && x < riv.t0 && R() < 0.7) kind = 'willow';
      trees.push({ x, kind, h: kind === 'spruce' ? rnd(95, 135) : kind === 'willow' ? rnd(70, 95) : rnd(95, 150), seed: ri(1, 1e6) });
      break;
    }
    if (riv) trees.push({ x: riv.w1 + rnd(30, 50), kind: 'willow', h: rnd(70, 90), seed: ri(1, 1e6) });

    // ---------- кэш: разрез грунта кусками по CW ед. ----------
    let ymin = Infinity, ymax = -Infinity;
    for (let x = XA; x <= XB; x += 2) { const y = gy(x); if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    const yTopC = Math.floor(ymin - 64), yBotC = Math.ceil(ymax + 86), CW = 160;
    const DEEP = '#8a6a48';
    const SOIL = ['#9b7a52', '#8c6a45', '#a8875c', '#7d5c3c', '#9a7448', '#b19166'];
    function surfPath(c, x0, x1, dy) { c.moveTo(x0, gy(x0) + (dy ? dy(x0) : 0)); for (let x = x0 + 2; x <= x1; x += 2) c.lineTo(x, gy(x) + (dy ? dy(x) : 0)); c.lineTo(x1, gy(x1) + (dy ? dy(x1) : 0)); }
    function drawChunk(c, x0, x1, yBotC) {
      const Rc = rngOf(seed + Math.round(x0) * 31);
      const a = x0 - 6, b = x1 + 6;
      // тело грунта и геологические слои (горизонтальные, с волной)
      c.save();
      c.beginPath(); surfPath(c, a, b); c.lineTo(b, yBotC + 2); c.lineTo(a, yBotC + 2); c.closePath();
      c.fillStyle = DEEP; c.fill(); c.clip();
      for (let k = -2, y = Math.floor(ymin / 15) * 15 - 30; y < yBotC; y += 15, k++) {
        c.fillStyle = SOIL[((k % SOIL.length) + SOIL.length) % SOIL.length];
        c.beginPath(); c.moveTo(a, y + Math.sin(a * 0.02 + k) * 2.5);
        for (let x = a; x <= b; x += 8) c.lineTo(x, y + Math.sin(x * 0.021 + k * 1.7) * 2.6 + Math.sin(x * 0.067 + k) * 1.1);
        c.lineTo(b, y + 15 + 4); c.lineTo(a, y + 15 + 4); c.closePath(); c.fill();
      }
      // гумус и подпочва — по поверхности
      const band = (d0, d1, col) => { c.fillStyle = col; c.beginPath(); surfPath(c, a, b, x => d0 + Math.sin(x * 0.05) * 0.8); for (let x = b; x >= a; x -= 2) c.lineTo(x, gy(x) + d1 + Math.sin(x * 0.037 + 1) * 1.6 + Math.sin(x * 0.11) * 0.7); c.closePath(); c.fill(); };
      band(0, 18, 'rgba(110,78,48,.55)');
      band(0, 8, '#4a3626');
      // камни и корни
      for (let k = 0; k < (b - a) * 0.35; k++) {
        const x = a + Rc() * (b - a), y = gy(x) + 10 + Rc() * 70;
        c.fillStyle = Rc() < 0.5 ? 'rgba(70,58,48,.55)' : 'rgba(190,175,150,.5)';
        c.beginPath(); c.ellipse(x, y, 0.8 + Rc() * 1.8, 0.6 + Rc() * 1.1, Rc() * 3, 0, TAU); c.fill();
      }
      c.strokeStyle = 'rgba(40,28,18,.6)'; c.lineWidth = 0.35; c.beginPath();
      for (let k = 0; k < (b - a) * 0.25; k++) { const x = a + Rc() * (b - a), m = matAt(x); if (m !== 'grass' && m !== 'mown' && m !== 'wet') continue; const y = gy(x) + 1.5; c.moveTo(x, y); c.quadraticCurveTo(x + (Rc() - 0.5) * 3, y + 3, x + (Rc() - 0.5) * 4, y + 3 + Rc() * 4); }
      c.stroke();
      // насыпь будущей дороги: грунт насыпи, послойное уплотнение, погребённый растительный слой, труба
      if (emb && emb.x1 > a && emb.x0 < b) {
        const nat = x => { const t = clamp((x - emb.x0) / (emb.x1 - emb.x0), 0, 1); return yOf(lerp(emb.hA, emb.hB, t) - emb.dip * Math.sin(Math.PI * t)); };
        c.fillStyle = '#c9a66a'; c.beginPath(); surfPath(c, emb.x0, emb.x1); for (let x = emb.x1; x >= emb.x0; x -= 2) c.lineTo(x, nat(x)); c.closePath(); c.fill();
        c.save(); c.clip();
        c.strokeStyle = 'rgba(120,90,50,.35)'; c.lineWidth = 0.4; c.setLineDash([3, 2]); c.beginPath();
        for (let y = ymin - 10; y < ymax + 20; y += 3.5) { c.moveTo(emb.x0, y); c.lineTo(emb.x1, y); }
        c.stroke(); c.setLineDash([]);
        for (let k = 0; k < (emb.x1 - emb.x0) * 0.8; k++) { const x = emb.x0 + Rc() * (emb.x1 - emb.x0), y = gy(x) + Rc() * 30; c.fillStyle = Rc() < 0.5 ? '#8f8a80' : '#e3cf9c'; c.fillRect(x, y, 0.9, 0.7); }
        c.restore();
        c.strokeStyle = '#3d2c1e'; c.lineWidth = 1.8; c.beginPath(); for (let x = emb.x0; x <= emb.x1; x += 2) { if (x === emb.x0) c.moveTo(x, nat(x)); else c.lineTo(x, nat(x)); } c.stroke();
        const pr = emb.pipeR * VY, pc = nat(emb.xc) - 0.12 * VY - pr;
        c.fillStyle = '#7d7b74'; c.beginPath(); c.ellipse(emb.xc, nat(emb.xc) + 0.5, pr * 1.6, 2.2, 0, 0, TAU); c.fill();
        c.fillStyle = '#a9a69d'; c.beginPath(); c.arc(emb.xc, pc, pr + 1.6, 0, TAU); c.fill();
        c.fillStyle = '#26221e'; c.beginPath(); c.arc(emb.xc, pc, pr - 0.2, 0, TAU); c.fill();
        c.fillStyle = '#3e6f8a'; c.beginPath(); c.arc(emb.xc, pc, pr - 0.2, Math.PI * 0.2, Math.PI * 0.8); c.closePath(); c.fill();
        c.strokeStyle = '#8c897f'; c.lineWidth = 0.4; c.beginPath(); c.arc(emb.xc, pc, pr + 0.8, 0, TAU); c.stroke();
      }
      // дорога: асфальт, щебёночное основание, песок
      if (road && road.e2 > a && road.e1 < b) {
        const lay = (d0, d1, col, x0r, x1r) => { c.fillStyle = col; c.beginPath(); surfPath(c, x0r, x1r, () => d0); for (let x = x1r; x >= x0r; x -= 2) c.lineTo(x, gy(x) + d1); c.closePath(); c.fill(); };
        lay(0, 12, '#cdb47c', road.e1 - 9, road.e2 + 9);
        lay(0, 6, '#8e8b84', road.e1 - 9, road.e2 + 9);
        for (let k = 0; k < 120; k++) { const x = lerp(road.e1 - 8, road.e2 + 8, Rc()), y = gy(x) + 2 + Rc() * 4; c.fillStyle = Rc() < 0.5 ? '#6b6964' : '#b4b1a8'; c.fillRect(x, y, 0.9, 0.8); }
        lay(0, 1.8, '#3a3b3d', road.e1, road.e2);
        c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 0.4; c.beginPath(); surfPath(c, road.e1, road.e2, () => 0.3); c.stroke();
        c.fillStyle = '#f2f2ee'; c.fillRect(road.e1 + 1, gy(road.e1 + 1) - 0.25, 3, 0.5); c.fillRect(road.e2 - 4, gy(road.e2 - 4) - 0.25, 3, 0.5);
      }
      // река: ил по дну, песок пляжа, обнажение берега с норками ласточек
      if (riv) {
        const lay = (x0r, x1r, d1, col) => { if (x1r < a || x0r > b) return; c.fillStyle = col; c.beginPath(); surfPath(c, x0r, x1r); for (let x = x1r; x >= x0r; x -= 2) c.lineTo(x, gy(x) + d1); c.closePath(); c.fill(); };
        lay(riv.b1 - 4, riv.w1 + 12, 7, '#d6bf8a');
        lay(riv.w0, riv.w1, 3.6, '#5b5246');
        if (riv.b1 > a && riv.b0 < b) {
          c.fillStyle = 'rgba(214,190,140,.35)'; c.beginPath(); surfPath(c, riv.b0, riv.b1); for (let x = riv.b1; x >= riv.b0; x -= 2) c.lineTo(x, gy(x) + 6); c.closePath(); c.fill();
          for (let k = 0; k < 40; k++) { const x = lerp(riv.b0 + 2, riv.b1 - 2, Rc()), y = gy(x) + 1 + Rc() * 3; c.fillStyle = 'rgba(90,70,50,.5)'; c.fillRect(x, y, 1.2, 0.4); }
        }
        if (riv.w0 > a && riv.b1 < b) for (let k = 0; k < 30; k++) { const x = lerp(riv.b1, riv.w0 + 6, Rc()), y = gy(x) - 0.4; c.fillStyle = ['#9a9488', '#c4beb0', '#7c766c'][k % 3]; c.beginPath(); c.ellipse(x, y, 0.8 + Rc() * 0.9, 0.5 + Rc() * 0.4, 0, 0, TAU); c.fill(); }
      }
      // канава: вода на дне
      for (const o of ob.ditch) if (o.x1 > a && o.x0 < b) {
        const yb = gy((o.x0 + o.x1) / 2);
        c.fillStyle = 'rgba(70,110,120,.85)'; c.beginPath(); c.moveTo(o.x0 + 3, yb - 3.2); for (let x = o.x0 + 3; x <= o.x1 - 3; x += 1) c.lineTo(x, Math.max(yb - 3.2, gy(x))); c.lineTo(o.x1 - 3, yb - 3.2); c.closePath(); c.fill();
        c.strokeStyle = '#a9d0dc'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(o.x0 + 3.5, yb - 3.2); c.lineTo(o.x1 - 3.5, yb - 3.2); c.stroke();
      }
      c.restore();
      // покров поверхности
      for (let x = a; x < b; x += 2) {
        const m = matAt(x), y0 = gy(x), y1 = gy(x + 2);
        let col = null, lw = 2.2;
        if (m === 'grass' || m === 'mown' || m === 'wet') col = m === 'wet' ? '#3f7a34' : '#4d8a35';
        else if (m === 'field') { col = '#5a3f2a'; lw = 2.6; }
        else if (m === 'sedge') col = '#3c6b31';
        else if (m === 'embank') { col = '#b08f5a'; lw = 1.6; }
        else if (m === 'shoulder') { col = '#9a968c'; lw = 1.6; }
        else if (m === 'sand') { col = '#e2cf9c'; lw = 1.4; }
        else if (m === 'clay') { col = '#8a6a48'; lw = 1.0; }
        if (!col) continue;
        c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(x - 0.2, y0 + lw / 2 - 0.4); c.lineTo(x + 2.2, y1 + lw / 2 - 0.4); c.stroke();
      }
      // травинки, всходы, цветы
      c.lineCap = 'round';
      const blades = { grass: ['#4f8f36', '#6aa647', '#3f7a2e'], mown: ['#7aa84c', '#93b85a'], wet: ['#3a7a34', '#4f8f3a', '#5f9a3f'], sedge: ['#4a7a35', '#5c8c3c'], field: ['#a99a4a', '#7fa046'], embank: ['#8aa04a'] };
      for (const key of Object.keys(blades)) {
        const pal = blades[key];
        for (let ci = 0; ci < pal.length; ci++) {
          c.strokeStyle = pal[ci]; c.lineWidth = key === 'field' ? 0.5 : 0.6; c.beginPath();
          for (let x = a + Rc() * 1.5; x < b; x += key === 'embank' ? 7 : key === 'field' ? 2.6 : 1.4) {
            if (matAt(x) !== key || (Rc() * pal.length | 0) !== ci) continue;
            if (key === 'embank' && Rc() < 0.6) continue;
            const y = gy(x) + 0.4, hgt = key === 'mown' ? 1.2 + Rc() * 1.2 : key === 'wet' || key === 'sedge' ? 3 + Rc() * 4.5 : key === 'field' ? 1.6 + Rc() * 2 : 1.8 + Rc() * 3.4;
            c.moveTo(x, y); c.lineTo(x + (Rc() - 0.4) * 1.8, y - hgt);
          }
          c.stroke();
        }
      }
      for (let x = a; x < b; x += 3) if (matAt(x) === 'field') { c.fillStyle = 'rgba(40,26,16,.5)'; c.beginPath(); c.ellipse(x, gy(x) + 0.6, 1.2, 0.6, 0, 0, TAU); c.fill(); }
      for (let x = a; x < b; x += 5 + Rc() * 9) { const m = matAt(x); if ((m === 'grass' || m === 'wet') && Rc() < 0.45) flowers(c, x, gy(x) + 0.3, Rc, Rc() * 4 | 0); }
      // лужи: зеркальная линза на поверхности
      for (const o of ob.puddle) if (o.x1 > a && o.x0 < b) {
        c.fillStyle = 'rgba(120,170,200,.85)'; c.beginPath(); c.moveTo(o.x0, gy(o.x0) - 0.4);
        for (let x = o.x0; x <= o.x1; x += 1) c.lineTo(x, gy(x) - 0.6); for (let x = o.x1; x >= o.x0; x -= 1) c.lineTo(x, gy(x) + 1.4 * Math.sin(Math.PI * (x - o.x0) / (o.x1 - o.x0)) - 0.4);
        c.closePath(); c.fill();
        c.fillStyle = 'rgba(230,245,255,.7)'; c.fillRect(o.x0 + (o.x1 - o.x0) * 0.25, gy(o.x0 + (o.x1 - o.x0) * 0.25) - 0.7, (o.x1 - o.x0) * 0.3, 0.4);
      }
      // декор позади разреза
      for (const d of deco) {
        const dx = d.x != null ? d.x : d.x0, ex = d.x1 != null ? d.x1 : dx;
        if (ex < a - 70 || dx > b + 70) continue;
        drawDeco(c, d);
      }
      for (const o of ob.log) if (o.x > a - 20 && o.x < b + 20) logSide(c, o.x, gy(o.x) + 0.6, o.r);
    }
    function drawDeco(c, d) {
      switch (d.kind) {
        case 'bm': benchmark(c, d.x, gy(d.x), d.name); break;
        case 'deli': delineator(c, d.x, gy(d.x)); break;
        case 'sign': roadSign(c, d.x, gy(d.x), d.s); break;
        case 'km': kmPost(c, d.x, gy(d.x), d.km); break;
        case 'roller': rollerSide(c, d.x, gy(d.x), d.dir); break;
        case 'gravel': gravelPile(c, d.x, gy(d.x) + 0.5, d.w, d.h, d.seed); break;
        case 'boat': boatSide(c, d.x, gy(d.x) + 0.6, d.dir, Math.atan2(gy(d.x + 20) - gy(d.x - 20), 40) * 0.8); break;
        case 'hay': hayRoll(c, d.x, gy(d.x) + 0.5, d.r); break;
        case 'stack': haystack(c, d.x, gy(d.x) + 0.5, d.w, d.h, d.seed); break;
        case 'cow': cowSide(c, d.x, gy(d.x) + 0.4, d.dir, d.seed); break;
        case 'pole': powerPole(c, d.x, gy(d.x) + 0.5); break;
        case 'bush': bushSide(c, d.x, gy(d.x) + 0.8, d.r, d.seed, null, d.fl); break;
        case 'banya': banya(c, d.x, gy(d.x) + 0.5, d.seed); break;
        case 'fence': picketFence(c, d.x0, d.x1, x => gy(x) + 0.5, '#b9a27a'); break;
        case 'holes': { const Rh = rngOf(d.x0 | 0); c.fillStyle = '#2a1d14'; for (let k = 0; k < 7; k++) { const x = lerp(d.x0, d.x1, Rh()); c.beginPath(); c.ellipse(x, gy(x) + 4 + Rh() * 6, 1.1, 0.8, 0, 0, TAU); c.fill(); } break; }
        case 'roots': { const Rh = rngOf(d.x0 | 7); c.strokeStyle = '#4a3020'; c.lineWidth = 0.4; c.beginPath(); for (let k = 0; k < 10; k++) { const x = lerp(d.x0, d.x1, Rh()), y = gy(x) + 2; c.moveTo(x, y); c.quadraticCurveTo(x + 1.5, y + 3, x + 0.5 + Rh() * 2, y + 4 + Rh() * 5); } c.stroke(); break; }
      }
    }
    const chunks = [];
    for (let x0 = XA; x0 < XB; x0 += CW) {
      const x1 = Math.min(XB, x0 + CW);
      let lo = Infinity; // свой верх у каждого куска — меньше пустой заливки
      for (let x = x0 - 24; x <= x1 + 24; x += 2) lo = Math.min(lo, gy(x));
      const top = Math.max(yTopC, Math.floor(lo - 64)), bot = yBotC; // низ общий — иначе ступеньки слоёв у края экрана
      const ly = layer((x1 - x0 + 2) * Z, (bot - top) * Z, c => { c.scale(Z, Z); c.translate(-x0 + 1, -top); drawChunk(c, x0, x1, bot); });
      // пустые строки сверху не рисуем: ищем первую строку с непрозрачными пикселями
      let row = 0;
      try {
        const cv = ly.canvas, d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, cw4 = cv.width * 4;
        scan: for (; row < cv.height; row++) for (let i = row * cw4 + 3, e = i + cw4; i < e; i += 4) if (d[i]) break scan;
        row = Math.max(0, row - 1);
      } catch (e) { row = 0; }
      const sk = row * (bot - top) / ly.canvas.height;
      chunks.push({ x0, x1, top: top + sk, bot, sy: row, layer: ly });
    }

    // ---------- спрайты: деревья у трассы, крапива и кусты на трассе, камыш у воды ----------
    for (const tr of trees) {
      tr.hw = tr.h * (tr.kind === 'willow' ? 0.5 : 0.42) + 4;
      tr.spr = layer(tr.hw * 2 * Z, (tr.h + 8) * Z, c => { c.scale(Z, Z); treeSide(c, tr.hw, tr.h + 4, tr.h, tr.kind, tr.seed); });
    }
    const front = [];
    for (const o of ob.nettle) { const hgt = 24; front.push({ x0: o.x0 - 2, x1: o.x1 + 2, top: hgt, spr: layer((o.x1 - o.x0 + 4) * Z, (hgt + 2) * Z, c => { c.scale(Z, Z); nettleSide(c, 2, hgt, o.x1 - o.x0, ri(1, 1e6)); }), base: o }); }
    for (const o of ob.bush) { const hh = (o.top - w.hb(o.x)) * VY, wd = o.x1 - o.x0 + 12; front.push({ x0: o.x0 - 6, x1: o.x1 + 6, top: hh + 4, spr: layer(wd * Z, (hh + 6) * Z, c => { c.scale(Z, Z); bushSide(c, wd / 2 - 4, hh + 4, hh * 0.62, o.seed, '#4a7a33', null); bushSide(c, wd / 2 + 4, hh + 4, hh * 0.5, o.seed + 1, '#567f38', '#f4f0e6'); }) }); }
    for (const o of ob.reeds) { const hgt = 36; front.push({ x0: o.x0, x1: o.x1, top: hgt, spr: layer((o.x1 - o.x0) * Z, (hgt + 2) * Z, c => { c.scale(Z, Z); reedsSide(c, 0, hgt, o.x1 - o.x0, ri(1, 1e6), true); }) }); }

    // ---------- дальний и средний планы (параллакс) ----------
    const PF = 0.18, PM = 0.42, FH = 150, FY = 104, MH = 300, MY = 128;
    const FW = Math.ceil((XB - XA) * Z * PF + 900), MW = Math.ceil((XB - XA) * Z * PM + 900);
    const far = layer(FW, FH, c => {
      const Rf = rngOf(seed ^ 0x7777);
      const hill = (base, amp, col, f1, f2) => { c.fillStyle = col; c.beginPath(); c.moveTo(0, FH); for (let x = 0; x <= FW; x += 10) c.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin(x * f1 + base)) - amp * 0.4 * Math.sin(x * f2 + 1.3)); c.lineTo(FW, FH); c.closePath(); c.fill(); };
      hill(FY - 8, 26, TOD.far, 0.006, 0.017);
      // лес по гребню
      c.fillStyle = TOD.far2;
      for (let x = 0; x < FW; x += 3 + Rf() * 4) { const y = FY - 4 - 10 * (0.5 + 0.5 * Math.sin(x * 0.009 + 2)) - 4 * Math.sin(x * 0.023); const r = 2.5 + Rf() * 3; if (Rf() < 0.35) { c.beginPath(); c.moveTo(x - r, y + 2); c.lineTo(x, y - r * 2.4); c.lineTo(x + r, y + 2); c.fill(); } else { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); } }
      c.fillRect(0, FY - 6, FW, FH);
      // деревни, церкви, ЛЭП
      for (let k = 0; k < 4; k++) {
        const vx = 80 + Rf() * (FW - 160), vy = FY - 3;
        for (let j = 0; j < 6; j++) { const hx = vx + j * 9 + Rf() * 4, hw2 = 5 + Rf() * 3; c.fillStyle = mix(TOD.far2, '#e8e0d0', 0.45); c.fillRect(hx, vy - 5, hw2, 5); c.fillStyle = mix(TOD.far2, ['#a04030', '#406a50', '#505a68'][j % 3], 0.5); c.beginPath(); c.moveTo(hx - 1, vy - 5); c.lineTo(hx + hw2 / 2, vy - 9); c.lineTo(hx + hw2 + 1, vy - 5); c.fill(); }
        if (k % 2 === 0) church(c, vx + 64, vy, 0.55, mix(TOD.far2, '#f0ece2', 0.55), mix(TOD.far2, k ? '#3d6fb0' : '#d4a62a', 0.4));
      }
      c.strokeStyle = mix(TOD.far2, '#3a4048', 0.4); c.lineWidth = 0.7;
      let px = 40 + Rf() * 80; const tw = [];
      for (; px < FW; px += 110 + Rf() * 30) tw.push(px);
      for (const x of tw) { c.beginPath(); c.moveTo(x - 4, FY - 4); c.lineTo(x, FY - 30); c.lineTo(x + 4, FY - 4); c.moveTo(x - 6, FY - 24); c.lineTo(x + 6, FY - 24); c.moveTo(x - 2.5, FY - 14); c.lineTo(x + 2.5, FY - 20); c.moveTo(x + 2.5, FY - 14); c.lineTo(x - 2.5, FY - 20); c.stroke(); }
      c.lineWidth = 0.35; c.beginPath();
      for (let i = 0; i + 1 < tw.length; i++) for (const d of [-6, 6]) { c.moveTo(tw[i] + d, FY - 24); c.quadraticCurveTo((tw[i] + tw[i + 1]) / 2 + d, FY - 18, tw[i + 1] + d, FY - 24); }
      c.stroke();
      const g = c.createLinearGradient(0, FY - 40, 0, FH); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, mix(TOD.haze, '#ffffff', 0.2)); c.fillStyle = g; c.globalAlpha = 0.35; c.fillRect(0, FY - 40, FW, FH); c.globalAlpha = 1;
    });
    let distCar = null;
    const midLow = mix('#8fae5a', TOD.haze, 0.3);
    const mid = layer(MW, MH, c => {
      const Rm = rngOf(seed ^ 0x3131);
      const gl = x => MY + 6 * Math.sin(x * 0.004 + 1) + 3 * Math.sin(x * 0.013);
      // поля полосами
      const fields = ['#8fae5a', '#a8b85c', '#c9b864', '#7fa452', '#b4a75a', '#94b866'];
      c.fillStyle = mix('#8fae5a', TOD.haze, 0.35); c.beginPath(); c.moveTo(0, MH); for (let x = 0; x <= MW; x += 8) c.lineTo(x, gl(x)); c.lineTo(MW, MH); c.closePath(); c.fill();
      for (let x = 0; x < MW;) { const len = 60 + Rm() * 140, col = mix(fields[Rm() * fields.length | 0], TOD.haze, 0.3); c.fillStyle = col; c.beginPath(); c.moveTo(x, gl(x) + 4); c.lineTo(x + len, gl(x + len) + 4); c.lineTo(x + len + 30, MH); c.lineTo(x - 30, MH); c.closePath(); c.fill(); x += len; }
      c.strokeStyle = 'rgba(70,90,40,.18)'; c.lineWidth = 0.6; c.beginPath(); for (let y = MY + 16; y < MH; y += 7) { c.moveTo(0, y); c.lineTo(MW, y + 3); } c.stroke();
      // дорога вдали
      if (vid === 'road') { c.fillStyle = mix('#6a6a68', TOD.haze, 0.35); c.beginPath(); for (let x = 0; x <= MW; x += 8) c.lineTo(x, gl(x) + 12); for (let x = MW; x >= 0; x -= 8) c.lineTo(x, gl(x) + 15); c.closePath(); c.fill(); distCar = { y: 0, gl }; }
      else { c.fillStyle = mix('#5d8fae', TOD.haze, 0.35); c.beginPath(); for (let x = 0; x <= MW; x += 8) c.lineTo(x, gl(x) + 20); for (let x = MW; x >= 0; x -= 8) c.lineTo(x, gl(x) + 26 + Math.sin(x * 0.02)); c.closePath(); c.fill(); }
      c.save(); c.scale(0.5, 0.5);
      const S = x => x * 2;
      // опоры с проводами
      const poles = []; for (let x = 30 + Rm() * 60; x < MW; x += 90 + Rm() * 40) poles.push(x);
      c.strokeStyle = mix('#5a4a3a', TOD.haze, 0.3); c.lineWidth = 2;
      for (const x of poles) { const y = S(gl(x)) + 4; c.beginPath(); c.moveTo(S(x), y); c.lineTo(S(x), y - 56); c.moveTo(S(x) - 7, y - 52); c.lineTo(S(x) + 7, y - 52); c.stroke(); }
      c.strokeStyle = 'rgba(40,40,40,.35)'; c.lineWidth = 0.6; c.beginPath();
      for (let i = 0; i + 1 < poles.length; i++) for (const d of [-6, 6]) { const y0 = S(gl(poles[i])) - 48, y1 = S(gl(poles[i + 1])) - 48; c.moveTo(S(poles[i]) + d, y0); c.quadraticCurveTo(S((poles[i] + poles[i + 1]) / 2) + d, (y0 + y1) / 2 + 8, S(poles[i + 1]) + d, y1); }
      c.stroke();
      // деревни: дома с наличниками, заборы; рощи
      for (let x = 20 + Rm() * 100; x < MW - 40;) {
        if (Rm() < 0.45) {
          const n = 2 + (Rm() * 4 | 0);
          for (let j = 0; j < n; j++) { const hx = x + j * (42 + Rm() * 16), wd = 30 + Rm() * 16; houseSide(c, S(hx), S(gl(hx)) + 4, wd * 1.2, 22 + Rm() * 8, Rm); picketFence(c, S(hx) - wd * 0.6 - 6, S(hx) + wd * 0.6 + 14, () => S(gl(hx)) + 4, mix('#b9a27a', TOD.haze, 0.2)); }
          x += n * 50 + 30;
        } else {
          const n = 2 + (Rm() * 5 | 0);
          for (let j = 0; j < n; j++) { const tx = x + j * (8 + Rm() * 12), kinds2 = ['birch', 'oak', 'spruce', 'pine', 'birch', 'willow']; treeSide(c, S(tx), S(gl(tx)) + 4, 60 + Rm() * 60, kinds2[Rm() * kinds2.length | 0], Rm() * 1e6 | 0); }
          x += n * 14 + 40;
          if (Rm() < 0.4) { const sx = x - 10; if (vid === 'road') hayRoll(c, S(sx), S(gl(sx)) + 6, 6); else haystack(c, S(sx), S(gl(sx)) + 6, 22, 26, Rm() * 1e6 | 0); }
        }
      }
      c.restore();
      const g = c.createLinearGradient(0, MY - 90, 0, MH); g.addColorStop(0, mix(TOD.haze, '#ffffff', 0.3)); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.globalAlpha = 0.28; c.fillStyle = g; c.fillRect(0, 0, MW, MH); c.globalAlpha = 1;
    });
    const clouds = [];
    for (let k = 0; k < 5; k++) {
      const cw = 60 + R() * 70, chh = 20 + R() * 12, sd = ri(1, 1e6);
      clouds.push({ x: R() * 1400, y: 38 + R() * 60, w: cw, h: chh, v: 3 + R() * 5, spr: layer(cw, chh, c => {
        const Rc = rngOf(sd);
        c.fillStyle = 'rgba(255,255,255,.85)';
        for (let j = 0; j < 9; j++) { const px = cw * (0.15 + Rc() * 0.7), py = chh * (0.45 + Rc() * 0.25), r = chh * (0.22 + Rc() * 0.2); c.beginPath(); c.arc(px, py, r, 0, TAU); c.fill(); }
        c.fillStyle = 'rgba(200,210,225,.4)'; c.fillRect(cw * 0.12, chh * 0.72, cw * 0.76, chh * 0.1);
      }) });
    }
    const sunSpr = layer(120, 120, c => {
      const g = c.createRadialGradient(60, 60, 4, 60, 60, 60); g.addColorStop(0, TOD.sun); g.addColorStop(0.18, 'rgba(255,245,215,.85)'); g.addColorStop(0.4, 'rgba(255,240,200,.25)'); g.addColorStop(1, 'rgba(255,240,200,0)');
      c.fillStyle = g; c.fillRect(0, 0, 120, 120);
    });

    // ---------- план трассы (Sym, вид сверху) — полоса-навигатор под HUD ----------
    const XR0 = -70, XR1 = L + 70;
    const treeKind = { birch: 'birch', spruce: 'conifer', pine: 'conifer', oak: 'deciduous', willow: 'deciduous' };
    let planCache = null;
    function planLayer(pw, ph) {
      const k = pw / (XR1 - XR0), hh = ph / 2 / k;
      return layer(pw, ph, c => {
        const was = Sym.cache; Sym.cache = false;
        try {
          c.save(); c.scale(k, k); c.translate(-XR0, hh);
          Sym.ground(c, XR0, -hh, XR1 - XR0, 2 * hh, vid === 'road' ? 'meadow' : 'grass', seed & 0xffff);
          for (const z of zones) if (z.m === 'field' && z.x1 > XR0 && z.x0 < XR1) Sym.ground(c, Math.max(XR0, z.x0), -hh, Math.min(XR1, z.x1) - Math.max(XR0, z.x0), 2 * hh, 'field', (z.x0 | 0) + 5);
          if (road) {
            Sym.road(c, [[(road.e1 + road.e2) / 2, -hh - 20], [(road.e1 + road.e2) / 2, hh + 20]], road.e2 - road.e1, 'asphalt', { seed: 3 });
            for (const d of [road.d1, road.d2]) Sym.stream(c, [[d, -hh - 10], [d, hh + 10]], 3, 7);
          }
          if (emb) {
            Sym.stream(c, [[emb.xc - 4, -hh - 10], [emb.xc + 3, hh + 10]], 4, 9);
            Sym.ground(c, emb.x0, -14, emb.x1 - emb.x0, 28, 'sand', 11);
            Sym.ground(c, emb.t0, -9, emb.t1 - emb.t0, 18, 'gravel', 12);
          }
          if (riv) {
            Sym.ground(c, riv.b0, -hh, riv.w0 - riv.b0 + 6, 2 * hh, 'sand', 13);
            Sym.ground(c, riv.w1 - 6, -hh, 18, 2 * hh, 'sand', 14);
            Sym.stream(c, [[(riv.w0 + riv.w1) / 2 - 6, -hh - 20], [(riv.w0 + riv.w1) / 2 + 6, hh + 20]], riv.w1 - riv.w0, 15);
            Sym.slope(c, [[riv.b0, -hh], [riv.b0, hh]], [[riv.b1, -hh], [riv.b1, hh]]);
            Sym.slope(c, [[riv.t1, -hh], [riv.t1, hh]], [[riv.t0, -hh], [riv.t0, hh]]);
          }
          for (const o of ob.ditch) Sym.stream(c, [[(o.x0 + o.x1) / 2 - 3, -hh - 8], [(o.x0 + o.x1) / 2 + 3, hh + 8]], (o.x1 - o.x0) * 0.5, 17);
          for (const o of ob.puddle) Sym.pond(c, [[o.x0, -3], [o.x0 + (o.x1 - o.x0) * 0.5, -5], [o.x1, -2], [o.x1 - 3, 3], [o.x0 + 4, 4]], 19);
          for (const tr of trees) Sym.tree(c, tr.x, (tr.seed % 2 ? -1 : 1) * hh * 0.62, tr.h * 0.11, treeKind[tr.kind], tr.seed);
          for (const d of deco) {
            if (d.kind === 'bush') Sym.bush(c, d.x, (d.seed % 2 ? -1 : 1) * hh * 0.5, d.r * 0.8, d.seed);
            if (d.kind === 'pole') Sym.pole(c, d.x, -hh * 0.55, 'power', Math.PI / 2);
            if (d.kind === 'bm') Sym.marker(c, d.x, hh * 0.4, 'benchmark');
            if (d.kind === 'banya') Sym.house(c, d.x - 16, -hh * 0.9, 32, 20, { roof: 'gable', color: '#8a5a34', seed: d.seed });
          }
          for (const o of ob.bush) Sym.bush(c, o.x, 0, 6, o.seed);
          c.strokeStyle = 'rgba(200,40,30,.85)'; c.lineWidth = 1.6 / k * 0.6; c.setLineDash([6, 3]);
          c.beginPath(); c.moveTo(0, 0); c.lineTo(L, 0); c.stroke(); c.setLineDash([]);
          c.restore();
          c.fillStyle = 'rgba(160,30,20,.9)';
          for (let i = 0; i <= N; i++) { const px = (i * PK - XR0) * k; c.fillRect(px - 0.4, ph / 2 - 3, 0.8, 6); }
        } finally { Sym.cache = was; }
        c.strokeStyle = 'rgba(30,22,16,.85)'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, pw - 1, ph - 1);
      });
    }
    if (Sym.prepare) Sym.prepare(['grass', 'meadow', 'field', 'sand', 'gravel', 'asphalt', 'water', 'paper']);

    // ---------- состояние ----------
    const hero = { auto: null, x: -22, y: 0, vx: 0, vy: 0, jvx: 0, air: false, facing: 1, ph: 0, climb: null, climbT: 0, zone: '', splashT: 0 };
    hero.y = gy(hero.x);
    const st = { x: w.st0, state: 'ready', t: 0, fromX: 0, toX: 0, dir: 1, HI: 0, no: 1, first: true, ph: 0 };
    st.HI = w.hw(st.x) + w.I;
    const bmName = deco[0].name, bmH = w.hb(-66) + 0.15;
    const staff = { on: false, active: false, done: false, blocked: '', x: 0, px0: 0, target: null, r: 0, read: 0, lift: 0 };
    const bub = { b: 0, v: 0, hold: 0, acc: 0, n: 0, ph: [R() * 6, R() * 6, R() * 6], beepT: 0 };
    const input = { kl: false, kr: false, ks: false, drag: 0 };
    const roles = new Map();
    const swipes = new Map();
    let t = 0, clock = 0, over = false, doneAt = -1, relocs = 0, falls = 0, bias = 0, flashMove = 0;
    let banner = null, speech = null, rayVis = null;
    const extras = [];
    const total = pts.length;
    let got = 0;
    const cam = { x: 0, y: 0 };
    const ducks = [];
    if (w.water) for (let k = 0, n = ri(2, 4); k < n; k++) ducks.push({ x: lerp(w.water.x0 + 20, w.water.x1 - 20, R()), dir: R() < 0.5 ? 1 : -1, v: 4 + R() * 4, drake: k % 2 === 0, flee: 0 });
    const lilies = [];
    if (w.water) for (let k = 0; k < 6; k++) lilies.push({ x: lerp(w.water.x0 + 8, w.water.x1 - 8, R()), r: 2 + R() * 1.5, f: R() < 0.4 });
    const birds = [];
    for (let k = 0; k < 4; k++) birds.push({ x: R() * 900, y: 50 + R() * 50, v: 14 + R() * 10, ph: R() * 6 });
    const bflies = [];
    for (let k = 0; k < 3; k++) bflies.push({ x: rnd(0, L), y: 0, ph: R() * 6, col: ['#f6f2a0', '#ffffff', '#f2a24a'][k] });
    if (distCar) distCar.x = R() * MW;

    function centerCam(snap) {
      const VW = api.W / Z, VH = (api.H - api.TOP) / Z;
      let tx = hero.x - VW * (hero.facing > 0 ? 0.42 : 0.58);
      if (st.x < hero.x && st.x > hero.x - VW * 0.66 && st.x - 22 < tx) tx = st.x - 22;
      tx = clamp(tx, XA + 4, XB - VW - 4);
      const gH = gy(hero.x), gA = gy(clamp(hero.x + hero.facing * VW * 0.35, XA, XB));
      const ty = gH - VH * 0.66 + clamp((gA - gH) * 0.6, 0, VH * 0.22); // впереди спуск (к воде) — камера опускается
      if (snap) { cam.x = tx; cam.y = ty; } else { cam.x = lerp(cam.x, tx, 0.08); cam.y = lerp(cam.y, ty, 0.06); }
    }
    centerCam(true);
    const toS = (x, y) => [(x - cam.x) * Z, api.TOP + (y - cam.y) * Z];
    function say(text, color) { speech = { text, color: color || '#1d1d1d', t: 2.2 }; }
    function tell(text, color, dur) { banner = { text, color: color || api.theme.ink, t: dur || 2.6 }; }
    const floats = []; // всплывающие надписи с обводкой (координаты мира — едут вместе с камерой)
    function popAt(x, y, text, color) { for (let k = 0; k < 5 && floats.some(f => Math.abs(f.x - x) * Z < 120 && Math.abs(f.y - y) * Z < 15); k++) y -= 11; floats.push({ x, y, text, color: color || api.theme.accent, life: 1.6 }); if (floats.length > 6) floats.shift(); }
    function staffX() { return hero.x + hero.facing * 4; }
    function ptNear(x, done, tol) { let best = null, bd = tol || TOL; for (const p of pts) { if (!!p.done !== done) continue; const d = Math.abs(p.x - x); if (d <= bd && !ob.log.some(o => (o.x - x) * (o.x - p.x) < 0)) { bd = d; best = p; } } return best; }
    tell(`Ст. 1: отсчёт на ${bmName} ${pad4((st.HI - bmH) * 1000)} → ГИ ${fmt(st.HI, 3)}. Начинайте с ПК0`, api.theme.accent, 4.5);

    // ---------- кнопки ----------
    function buttons() {
      const W = api.W, H = api.H;
      return {
        left: { x: 10, y: H - 64, w: 62, h: 56 },
        right: { x: 80, y: H - 64, w: 62, h: 56 },
        jump: { x: W - 186, y: H - 64, w: 58, h: 56 },
        staff: { x: W - 120, y: H - 64, w: 110, h: 56 },
        move: { x: W - 120, y: H - 112, w: 110, h: 42 },
        done: { x: W - 238, y: H - 112, w: 110, h: 42 },
      };
    }
    const showDone = () => hero.x > L - 30 && got < total;
    const roleCount = r => { let n = 0; for (const v of roles.values()) if (v === r) n++; return n; };
    function walkDir() { return ((roleCount('right') || input.kr) ? 1 : 0) - ((roleCount('left') || input.kl) ? 1 : 0); }

    // ---------- действия ----------
    function jump() {
      if (over || hero.air || hero.climb || staff.on) return;
      const wet = hero.zone === 'water' || hero.zone === 'ditch';
      hero.air = true; hero.vy = -JUMP_V * (wet ? 0.85 : 1);
      hero.jvx = hero.facing * Math.max(Math.abs(hero.vx), SPEED) * (wet ? 0.7 : 1);
      api.sfx('step');
    }
    function staffDown(px) {
      if (over || staff.on || hero.air || hero.climb || hero.auto) return;
      const sn = ptNear(staffX(), false, SNAP);
      if (sn && Math.abs(sn.x - staffX()) > 0.8 && !inZ(ob.ditch, hero.x)) { hero.auto = { to: sn.x - hero.facing * 4, px }; hero.vx = 0; return; } // шаг к колышку
      staff.on = true; staff.done = false; staff.active = false; staff.blocked = ''; staff.px0 = px; staff.lift = 0;
      staff.x = staffX(); hero.vx = 0; input.drag = 0;
      if (ob.ditch.some(o => staff.x > o.x0 + 2 && staff.x < o.x1 - 2)) { staff.blocked = 'ditch'; tell('Из канавы рейку не видно — выбирайтесь', api.theme.bad); api.sfx('bad'); return; }
      const p = ptNear(staff.x, false), pd = ptNear(staff.x, true);
      if (!p && pd) { staff.blocked = 'done'; tell(`${pd.lab} уже снят — идите дальше`, api.theme.dim, 1.8); api.sfx('tap'); return; }
      if (st.state !== 'ready') { staff.blocked = 'move'; say('Погоди, переношу!'); tell('Нивелир переносят — подождите', api.theme.accent, 1.6); api.sfx('bad'); return; }
      const vis = w.sight(staff.x, st.x, st.HI);
      if (!vis.ok) {
        staff.blocked = vis.why; flashMove = 3.5; api.sfx('bad');
        const why = { far: ['Далеко!', 'Дальше 65 м — отсчёт не разобрать'], hill: ['Бугор мешает!', 'Луч упирается в рельеф'], bush: ['Кусты мешают!', 'Кусты закрывают рейку'],
          low: ['Рейка выше луча!', 'Точка выше горизонта прибора — луч проходит под рейкой'], high: ['Луч над рейкой!', 'Точка слишком низко — луч проходит над рейкой'] }[vis.why];
        say(why[0], '#b3261e'); tell(`Не вижу рейку! ${why[1]} → ПЕРЕНОС`, api.theme.bad, 3);
        return;
      }
      if (st.dir !== (staff.x >= st.x ? 1 : -1)) st.dir = staff.x >= st.x ? 1 : -1;
      staff.active = true; staff.target = p; staff.r = vis.r;
      bub.b = (api.rand(0, 1) < 0.5 ? -1 : 1) * api.rand(0.38, 0.68); bub.v = api.rand(-0.3, 0.3); bub.hold = 0; bub.acc = 0; bub.n = 0;
      api.sfx('tap');
    }
    function staffUp() { if (staff.on) { staff.on = false; staff.active = false; } input.drag = 0; hero.auto = null; }
    function takeReading() {
      const p = staff.target, tilt2 = bub.n > 0 ? bub.acc / bub.n : 0.03;
      const err = staff.r * 1000 * tilt2 * 0.06 + api.rand(-0.6, 0.6); // наклонённая рейка даёт отсчёт больше верного
      const read = Math.round(staff.r * 1000 + err);
      const hm = st.HI + bias / 1000 - read / 1000;
      if (st.first) { bias += err; st.first = false; }
      staff.done = true; staff.active = false; staff.read = read;
      const [sx, sy] = toS(staff.x, gy(staff.x) - STAFF * VY - 4);
      if (p) {
        p.done = true; p.read = read; p.hm = hm; p.sx = staff.x; got++;
        const under = Math.abs(sx - api.W / 2) < 140 && sy < api.TOP + 160; // не под окошком отсчёта
        popAt(staff.x, under ? gy(staff.x) + 18 : gy(staff.x) - STAFF * VY - 4, `${p.lab} · ${pad4(read)} → ${fmt(hm, 2)}`, api.theme.good);
        if (p.kind !== 'pk' || p.alt) tell(`${p.lab}: ${p.kind === 'pk' ? p.alt : p.name} — отметка ${fmt(hm, 2)} м`, api.theme.good, 2);
        api.sfx('measure'); api.sfx('good');
        api.burst(sx, sy + 12, '#9dffb5', 8);
      } else {
        extras.push({ x: staff.x, read, hm });
        popAt(staff.x, gy(staff.x) - STAFF * VY - 4, `Лишняя точка · ${pad4(read)}`, '#ffb02e');
        tell('Здесь нет ни пикета, ни перегиба — лишняя точка', api.theme.accent, 2);
        api.sfx('measure'); api.sfx('warn');
      }
      say(pad4(read) + '!');
      if (got === total && doneAt < 0) { doneAt = t; tell('Трасса пронивелирована! Сдаём профиль…', api.theme.good, 3); api.sfx('win'); }
    }
    function relocate() {
      if (over) return;
      if (st.state !== 'ready') { tell('Нивелир уже переносят', api.theme.dim, 1.4); return; }
      const sx = staff.on ? staff.x : staffX();
      const nx = w.reloc(hero.x, hero.facing, sx);
      if (Math.abs(nx - st.x) < 6) { tell(w.sight(sx, nx).ok ? 'Нивелир и так здесь' : 'Отсюда рейку не увидеть — встаньте на точку', api.theme.dim, 1.8); return; }
      st.state = 'pack'; st.t = 0; st.fromX = st.x; st.toX = nx; relocs++;
      say('Переношу!'); tell(`Перенос станции — ${MOVE_T} с`, '#7ec8ff', 1.8); api.sfx('select');
      staffUp(); flashMove = 0;
    }
    function stepStation(dt) {
      if (st.state === 'ready') return;
      st.t += dt; st.ph += dt * 9;
      if (st.state === 'pack' && st.t >= 0.6) { st.state = 'walk'; st.t = 0; st.dir = st.toX >= st.fromX ? 1 : -1; }
      else if (st.state === 'walk') { const k = Math.min(1, st.t / (MOVE_T - 1.4)); st.x = lerp(st.fromX, st.toX, smooth(k)); if (k >= 1) { st.state = 'setup'; st.t = 0; } }
      else if (st.state === 'setup' && st.t >= 0.8) {
        st.state = 'ready'; st.x = st.toX; st.HI = w.hw(st.x) + w.I; st.no++; st.first = true;
        st.dir = staffX() >= st.x ? 1 : -1;
        api.sfx('station'); say(`Готово! ГИ ${fmt(st.HI, 2)}`);
      }
    }

    // ---------- ввод ----------
    function pointerDown(p) {
      if (over) return;
      const b = buttons();
      if (api.hit(b.staff, p)) { roles.set(p.id, 'staff'); staffDown(p.x); return; }
      if (api.hit(b.move, p)) { roles.set(p.id, 'move'); relocate(); return; }
      if (showDone() && api.hit(b.done, p)) { finish(); return; }
      if (api.hit(b.jump, p)) { roles.set(p.id, 'jump'); jump(); return; }
      if (api.hit(b.left, p)) { roles.set(p.id, 'left'); return; }
      if (api.hit(b.right, p)) { roles.set(p.id, 'right'); return; }
      roles.set(p.id, 'swipe'); swipes.set(p.id, { x: p.x, y: p.y, t: clock });
    }
    function pointerMove(p) {
      const r = roles.get(p.id);
      if (!r) return;
      if (r === 'staff') { input.drag = clamp((p.x - staff.px0) / 34, -1, 1); return; }
      if (r === 'left' || r === 'right') { const b = buttons(); if (api.hit(b.left, p)) roles.set(p.id, 'left'); else if (api.hit(b.right, p)) roles.set(p.id, 'right'); return; }
      if (r === 'swipe') {
        const s = swipes.get(p.id);
        if (s && s.y - p.y > 26 && Math.abs(p.x - s.x) < s.y - p.y && clock - s.t < 0.6) { jump(); roles.set(p.id, 'swiped'); }
      }
    }
    function pointerUp(p) {
      const r = roles.get(p.id);
      roles.delete(p.id); swipes.delete(p.id);
      if (r === 'staff') staffUp();
    }
    function key(code, down) {
      if (code === 'ArrowLeft' || code === 'KeyA') input.kl = down;
      else if (code === 'ArrowRight' || code === 'KeyD') input.kr = down;
      else if ((code === 'ArrowUp' || code === 'KeyW') && down) jump();
      else if (code === 'Space' || code === 'ArrowDown' || code === 'KeyS') { input.ks = down; if (down && !staff.on) staffDown(0); else if (!down) staffUp(); }
      else if ((code === 'KeyE' || code === 'KeyR') && down) relocate();
      else if (code === 'KeyF' && down && showDone()) finish();
    }

    // ---------- обновление ----------
    function update(dt) {
      if (over) return;
      t += dt; clock += dt;
      if (doneAt >= 0 && t - doneAt > 1.2) { finish(); return; }
      if (t >= T_LEVEL) { finish(); return; }
      if (banner && (banner.t -= dt) <= 0) banner = null;
      if (speech && (speech.t -= dt) <= 0) speech = null;
      flashMove = Math.max(0, flashMove - dt);
      for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.life -= dt; f.y -= 14 * dt; if (f.life <= 0) floats.splice(i, 1); }
      stepStation(dt);
      let dir = walkDir();
      // после отсчёта (или «не вижу») шаг снимает рейку
      if (staff.on && (staff.done || staff.blocked) && dir !== 0) staffUp();
      if (staff.on) dir = 0;
      // зона под ногами
      let slow = 1, zone = '';
      if (inZ(ob.nettle, hero.x)) { slow *= 0.5; zone = 'nettle'; }
      if (inZ(ob.puddle, hero.x)) { slow *= 0.6; zone = 'puddle'; }
      if (inZ(ob.reeds, hero.x)) slow *= 0.75;
      if (inZ(ob.bush, hero.x)) { slow *= 0.6; zone = zone || 'bush'; }
      if (w.inWater(hero.x)) { slow *= 0.5; zone = 'water'; }
      if (!hero.air && ob.ditch.some(o => hero.x > o.x0 + 2 && hero.x < o.x1 - 2)) { slow *= 0.3; zone = 'ditch'; }
      const sl = w.slope(hero.x) * dir;
      slow *= sl > 0 ? clamp(1 - sl * 1.4, 0.5, 1) : clamp(1 - sl * 0.4, 1, 1.12);
      if (zone !== hero.zone && !hero.air) {
        const [sx, sy] = toS(hero.x, hero.y - 30);
        if (zone === 'nettle') { popAt(hero.x, hero.y - 30, 'Ай! Крапива', '#ffb02e'); api.sfx('warn'); }
        else if (zone === 'puddle') { api.sfx('splash'); api.burst(sx, sy + 40, '#cfe9ff', 8); }
        else if (zone === 'water') { popAt(hero.x, hero.y - 30, 'Брод — медленнее', '#7ec8ff'); api.sfx('splash'); api.burst(sx, sy + 40, '#cfe9ff', 10); }
        else if (zone === 'ditch') { falls++; popAt(hero.x, hero.y - 30, 'Упал в канаву!', api.theme.bad); api.sfx('drop'); api.sfx('splash'); api.shake(3); api.burst(sx, sy + 44, '#a9d0dc', 12); }
        else if (zone === 'bush') { popAt(hero.x, hero.y - 30, 'Продираюсь через кусты', api.theme.dim); api.sfx('step'); }
        hero.zone = zone;
      }
      if ((zone === 'water' || zone === 'puddle') && Math.abs(hero.vx) > 20 && (hero.splashT -= dt) <= 0) { hero.splashT = 0.35; const [sx, sy] = toS(hero.x, gy(hero.x) - (zone === 'water' ? (w.water.Hw - w.hw(hero.x)) * VY : 0)); api.burst(sx, sy, '#d8f0ff', 3); }
      // движение
      if (hero.auto) { // шаг к колышку, пока держат РЕЙКА
        const a = hero.auto, d = a.to - hero.x;
        if (!(roleCount('staff') || input.ks)) { hero.auto = null; hero.vx = 0; }
        else if (Math.abs(d) < 0.3) { hero.x = a.to; hero.y = gy(hero.x); hero.auto = null; hero.vx = 0; staffDown(a.px); }
        else { hero.vx = Math.sign(d) * 150; hero.x += clamp(d, -150 * dt, 150 * dt); hero.y = gy(hero.x); }
      } else if (hero.climb) {
        const c = hero.climb; c.t += dt;
        const k = Math.min(1, c.t / c.dur);
        hero.x = lerp(c.from, c.to, k); hero.y = gy(hero.x) - Math.sin(Math.PI * k) * c.h;
        if (k >= 1) hero.climb = null;
      } else if (hero.air) {
        hero.x += hero.jvx * dt; hero.vy += GRAV * dt; hero.y += hero.vy * dt;
        const g = gy(hero.x);
        if (hero.y >= g && hero.vy > 0) { hero.y = g; hero.air = false; hero.vx = hero.jvx * 0.6; api.sfx('step'); }
      } else {
        if (dir) hero.facing = dir;
        const target = dir * SPEED * slow;
        const dv = target - hero.vx, mx = ACC * dt;
        hero.vx += clamp(dv, -mx, mx);
        let nx = hero.x + hero.vx * dt;
        // бревно: упираемся, через полсекунды перелезаем
        let blocked = false;
        for (const o of ob.log) {
          const edge = o.x - o.r - 2;
          if (hero.vx > 0 && hero.x <= o.x - o.r - 1.9 && nx > edge) { nx = edge; blocked = true; }
          if (hero.vx < 0 && hero.x >= o.x + o.r + 1.9 && nx < o.x + o.r + 2) { nx = o.x + o.r + 2; blocked = true; }
          if (blocked) {
            hero.vx = 0; hero.climbT += dt;
            if (hero.climbT > 0.45) { hero.climb = { from: nx, to: hero.x < o.x ? o.x + o.r + 3 : o.x - o.r - 3, t: 0, dur: 0.75, h: o.r * 2 + 1 }; hero.climbT = 0; popAt(hero.x, hero.y - 30, 'Перелезаю через бревно', api.theme.dim); api.sfx('step'); }
            break;
          }
        }
        if (!blocked) hero.climbT = Math.max(0, hero.climbT - dt * 0.5); // короткие нажатия тоже копятся — не застрять у бревна
        hero.x = clamp(nx, XA + 40, XB - 40);
        hero.y = gy(hero.x);
      }
      hero.ph += Math.abs(hero.climb ? 60 : hero.vx) * dt * 0.17;
      // рейка: пузырёк круглого уровня
      if (staff.active && !staff.done) {
        const u = clamp((walkDir()) + input.drag, -1, 1);
        const shaky = (w.inWater(staff.x) ? 1.7 : 1) * (inZ(ob.nettle, hero.x) ? 1.25 : 1);
        const noise = (Math.sin(clock * 1.7 + bub.ph[0]) * 0.6 + Math.sin(clock * 3.1 + bub.ph[1]) * 0.4 + Math.sin(clock * 5.3 + bub.ph[2]) * 0.3) * 1.5 * shaky;
        // неустойчивость мягкая, демпфирование сильное — пузырёк ловится и с реакцией 0,3–0,4 с (палец, телефон)
        const a = 1.4 * bub.b + noise + 3.4 * u - 5 * bub.v;
        bub.v += a * dt; bub.b += bub.v * dt;
        if (Math.abs(bub.b) > 1) { bub.b = Math.sign(bub.b); bub.v *= -0.2; }
        bub.beepT -= dt;
        if (Math.abs(bub.b) < ZONE) {
          if (bub.hold === 0 && bub.beepT <= 0) { api.sfx('beep'); bub.beepT = 0.4; }
          bub.hold += dt; bub.acc += bub.b * bub.b * dt; bub.n += dt;
        } else bub.hold = Math.max(0, bub.hold - dt * 1.6);
        if (bub.hold >= HOLD) takeReading();
      }
      // видимость рейки — для цвета луча
      if (st.state === 'ready') {
        const sx = staff.on ? staff.x : staffX();
        rayVis = w.sight(sx, st.x, st.HI);
        if (!staff.active) st.dir = sx >= st.x ? 1 : -1;
      } else rayVis = null;
      // пропущенные точки: подсказка, когда ушли дальше
      for (const p of pts) if (!p.done && !p.warned && hero.x - p.x > 70) {
        p.warned = true; popAt(p.x, gy(p.x) - 24, 'Пропуск: ' + p.lab, api.theme.bad);
        tell(`Пропущена точка ${p.lab} (${p.kind === 'pk' ? 'пикет' : p.name}) — вернитесь ◀`, api.theme.bad, 2.6); api.sfx('warn');
      }
      // живность и камера
      for (const d of ducks) {
        const dd = Math.abs(d.x - hero.x);
        if (dd < 40 && w.inWater(hero.x)) { d.dir = d.x > hero.x ? 1 : -1; d.flee = 1; }
        d.flee = Math.max(0, d.flee - dt * 0.5);
        d.x += d.dir * d.v * (1 + d.flee * 3) * dt;
        if (d.x < w.water.x0 + 12) { d.x = w.water.x0 + 12; d.dir = 1; } if (d.x > w.water.x1 - 12) { d.x = w.water.x1 - 12; d.dir = -1; }
      }
      for (const b of birds) { b.x += b.v * dt; if (b.x > api.W + 40) b.x = -40; }
      if (distCar) { distCar.x += 22 * dt; if (distCar.x > MW) distCar.x = 0; }
      centerCam(false);
    }

    // ---------- итог ----------
    function interpM(M, x) {
      if (x <= M[0].x) return M[0].hm;
      for (let i = 1; i < M.length; i++) if (x <= M[i].x) { const a = M[i - 1], b = M[i]; return a.hm + (b.hm - a.hm) * (x - a.x) / ((b.x - a.x) || 1); }
      return M[M.length - 1].hm;
    }
    function measured() { return pts.filter(p => p.done).map(p => ({ x: p.x, hm: p.hm })).concat(extras.map(e => ({ x: e.x, hm: e.hm }))).sort((a, b) => a.x - b.x); }
    function accuracy(M) {
      if (M.length < 2) return 0;
      let dev = 0, n = 0;
      for (let x = 0; x <= L; x += 2) { dev += Math.abs(w.hb(x) - interpM(M, x)); n++; }
      return clamp(1 - dev / n / 0.3, 0, 1);
    }
    let resInfo = null;
    function fitLines(vs) { // строки итога слева от бланка: на узком экране — короткий вариант
      let c = null; try { c = document.createElement('canvas').getContext('2d'); c.font = '600 12px system-ui, sans-serif'; } catch (e) {}
      const room = api.W * 0.52 - 14; // текст центрирован по 0,3·W, бланк — с 0,56·W
      return vs.map(v => (c && c.measureText(v[0]).width <= room ? v[0] : v[1]));
    }
    function finish() {
      if (over) return; over = true;
      staffUp();
      const M = measured(), acc = accuracy(M), c = got / total, full = got === total;
      const fh = Math.round(bias), fdop = Math.round(50 * Math.sqrt(L / MX / 1000));
      const closOK = got >= 2 && Math.abs(fh) <= fdop;
      const tLeft = full ? Math.max(0, T_LEVEL - doneAt) : 0, bonus = full ? Math.round(80 + 140 * tLeft / T_LEVEL) : 0;
      const pen = Math.min(100, extras.length * 12) + Math.min(80, 8 * Math.max(0, relocs - w.relocMin - 1));
      const score = clamp(Math.round(520 * c + 200 * acc * c + (closOK ? 60 * c : 0) + bonus - pen), 0, 1000);
      const stars = score >= 820 ? 3 : score >= 640 ? 2 : score >= 400 ? 1 : 0;
      const cnt = k => pts.filter(p => p.kind === k), dn = a => a.filter(p => p.done).length;
      const pk = cnt('pk'), br = cnt('brk'), ch = cnt('char');
      resInfo = { M, acc, fh, fdop, closOK, miss: pts.filter(p => !p.done), stations: st.no };
      api.finish({
        score, stars, drawResult,
        lines: fitLines([
          [`Точек ${got} из ${total}: ПК ${dn(pk)}/${pk.length}, перегибов ${dn(br)}/${br.length}, хар. ${dn(ch)}/${ch.length}`, `ПК ${dn(pk)}/${pk.length} · перегибы ${dn(br)}/${br.length} · хар. ${dn(ch)}/${ch.length}`],
          [`Точность профиля ${Math.round(acc * 100)} % · лишних точек ${extras.length}`, `Точность ${Math.round(acc * 100)} % · лишних ${extras.length}`],
          [`Невязка ${fh > 0 ? '+' : ''}${fh} мм (доп. ±${fdop}) · станций ${st.no}`, `Невязка ${fh > 0 ? '+' : ''}${fh} мм (±${fdop}) · ст. ${st.no}`],
          full ? [`Пронивелировано за ${mmss(doneAt)} · премия +${bonus}`, `Время ${mmss(doneAt)} · премия +${bonus}`] : ['Время вышло — профиль неполный', 'Время вышло'],
        ]),
      });
    }

    // ---------- отрисовка ----------
    const cam0y = cam.y;
    const fblades = []; // травинки переднего плана (перед ногами)
    for (let x = XA + 2; x < XB - 2; x += 2.6 + R() * 2.2) { const m = matAt(x); if (m === 'grass' || m === 'wet' || m === 'sedge' || m === 'mown' || m === 'field') fblades.push(x, (m === 'wet' || m === 'sedge' ? 3.5 : m === 'mown' ? 1.6 : 2.4) * (0.6 + R() * 0.8), (R() - 0.4) * 1.6); }
    let skyL = null, vignette = null;
    function blit(c, ly, ox, y, W, yMax) { // видимая часть длинной полосы; ниже yMax всё равно перекрыто
      const k = ly.canvas.width / ly.w, sx = Math.max(0, Math.round(-ox * k)), sw = Math.min(Math.ceil(W * k) + 1, ly.canvas.width - sx), sh = Math.min(ly.canvas.height, Math.ceil((yMax - y) * k));
      px(c, ly, sx, 0, sw, sh, Math.max(0, ox), y);
    }
    function draw(ctx) {
      const W = api.W, H = api.H, TOP = api.TOP, VW = W / Z;
      if (!skyL || skyL.w !== W || Math.abs(skyL.k - curK()) > 0.01) skyL = layer(W, H - TOP, c => { // небо с солнцем — один раз под размер экрана
        const g = c.createLinearGradient(0, 0, 0, H * 0.72 - TOP); g.addColorStop(0, TOD.sky0); g.addColorStop(1, TOD.sky1); c.fillStyle = g; c.fillRect(0, 0, W, H - TOP);
        c.drawImage(sunSpr.canvas, W * TOD.sx - 60, 18 + TOD.sy * 160 - 60, 120, 120);
      });
      // экономим заливку: небо — до сплошной части дальнего плана, дальний — до среднего, средний — до верха рельефа
      const fy = TOP + 118 - FY - (cam.y - cam0y) * Z * 0.12, my = TOP + 160 - MY - (cam.y - cam0y) * Z * 0.3;
      let gMax = -1e9; for (let x = cam.x - 12; x < cam.x + VW + 12; x += 4) gMax = Math.max(gMax, gy(x));
      const gTop = TOP + (gMax - cam.y) * Z + 2; // ниже самой низкой точки рельефа в кадре всё закрыто грунтом
      px(ctx, skyL, 0, 0, skyL.canvas.width, Math.min(skyL.canvas.height, Math.ceil((Math.min(H, gTop, fy + FY - 5) - TOP) * skyL.k)), 0, TOP);
      for (const cl of clouds) { const x = ((cl.x + clock * cl.v - cam.x * Z * 0.05) % (W + 320) + W + 320) % (W + 320) - 160; px(ctx, cl.spr, 0, 0, cl.spr.canvas.width, cl.spr.canvas.height, x, TOP + cl.y - 16); }
      ctx.strokeStyle = 'rgba(40,40,50,.55)'; ctx.lineWidth = 1; ctx.beginPath();
      for (const b of birds) { const f = Math.sin(clock * 9 + b.ph) * 2.2; ctx.moveTo(b.x - 4, TOP + b.y - f); ctx.quadraticCurveTo(b.x - 1.5, TOP + b.y - 1, b.x, TOP + b.y); ctx.quadraticCurveTo(b.x + 1.5, TOP + b.y - 1, b.x + 4, TOP + b.y - f); }
      ctx.stroke();
      blit(ctx, far, -(cam.x - XA) * Z * PF, fy, W, Math.min(gTop, my + MY - 10));
      const mox = -(cam.x - XA) * Z * PM;
      blit(ctx, mid, mox, my, W, gTop);
      if (gTop > my + MH) { ctx.fillStyle = midLow; ctx.fillRect(0, my + MH - 1, W, gTop - my - MH + 1); }
      if (distCar) { // машина на дальней дороге
        const cx = mox + distCar.x, cy = my + distCar.gl(distCar.x) + 12.5;
        if (cx > -10 && cx < W + 10) { ctx.fillStyle = '#c0392b'; ctx.fillRect(cx - 4, cy - 2.4, 8, 2.4); ctx.fillRect(cx - 2, cy - 4, 4, 1.8); ctx.fillStyle = '#9ccbe3'; ctx.fillRect(cx - 1.4, cy - 3.6, 2.6, 1.2); ctx.fillStyle = '#222'; ctx.fillRect(cx - 3, cy - 0.4, 1.4, 1); ctx.fillRect(cx + 1.6, cy - 0.4, 1.4, 1); }
      }
      // мир (разрез по оси трассы)
      ctx.save();
      ctx.translate(-cam.x * Z, TOP - cam.y * Z); ctx.scale(Z, Z);
      const x0 = cam.x - 12, x1 = cam.x + VW + 12;
      for (const tr of trees) if (tr.x + tr.hw > x0 && tr.x - tr.hw < x1) px(ctx, tr.spr, 0, 0, tr.spr.canvas.width, tr.spr.canvas.height, tr.x - tr.hw, gy(tr.x) + 2 - tr.h - 4, Z);
      for (const ch of chunks) if (ch.x1 + 1 > x0 && ch.x0 - 1 < x1) { px(ctx, ch.layer, 0, ch.sy, ch.layer.canvas.width, ch.layer.canvas.height - ch.sy, ch.x0 - 1, ch.top, Z); ctx.fillStyle = DEEP; ctx.fillRect(ch.x0 - 0.5, ch.bot - 0.5, ch.x1 - ch.x0 + 1, 400); }
      drawWater(ctx, x0, x1);
      drawStakes(ctx, x0, x1);
      drawStation(ctx);
      drawRay(ctx);
      drawHero(ctx);
      drawFront(ctx, x0, x1);
      ctx.restore();
      drawLabels(ctx, W);
      for (const f of floats) { const [fx, fy] = toS(f.x, f.y); ctx.globalAlpha = Math.min(1, f.life / 0.4); outlined(ctx, f.text, clamp(fx, 90, W - 90), fy, 13, f.color); }
      ctx.globalAlpha = 1;
      drawSpeech(ctx, W);
      drawOffscreen(ctx, W, H);
      drawPlan(ctx, W);
      drawLevelUI(ctx, W);
      if (banner) {
        ctx.font = 'bold 12px system-ui, sans-serif';
        const tw = Math.min(W - 24, ctx.measureText(banner.text).width + 20), a = Math.min(1, banner.t / 0.3);
        ctx.globalAlpha = a; api.roundRect(ctx, W / 2 - tw / 2, TOP + 32, tw, 22, 8); ctx.fillStyle = 'rgba(20,14,10,.8)'; ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.rect(W / 2 - tw / 2 + 4, TOP + 32, tw - 8, 22); ctx.clip();
        api.text(ctx, banner.text, W / 2, TOP + 47, 12, banner.color); ctx.restore(); ctx.globalAlpha = 1;
      }
      drawButtons(ctx);
    }
    function drawWater(c, x0, x1) {
      if (!w.water) return;
      const a = Math.max(w.water.x0, x0), b = Math.min(w.water.x1, x1);
      if (a >= b) return;
      const yw = yOf(w.water.Hw);
      c.beginPath(); c.moveTo(a, yw);
      for (let x = a; x <= b; x += 3) c.lineTo(x, Math.max(yw, gy(x)));
      c.lineTo(b, Math.max(yw, gy(b))); c.lineTo(b, yw); c.closePath();
      const g = c.createLinearGradient(0, yw, 0, yw + 14); g.addColorStop(0, 'rgba(96,160,196,.62)'); g.addColorStop(1, 'rgba(34,82,112,.82)');
      c.fillStyle = g; c.fill();
      c.strokeStyle = 'rgba(225,245,255,.9)'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(a, yw); c.lineTo(b, yw); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 0.5; c.beginPath();
      for (let x = Math.ceil(a / 11) * 11; x < b; x += 11) { const ph = Math.sin(x * 0.7 + clock * 2.2); if (ph < 0) continue; const wx = x + Math.sin(clock + x) * 2; c.moveTo(wx - 2.5, yw + 1.2 + ph); c.quadraticCurveTo(wx, yw + 0.4 + ph, wx + 2.5, yw + 1.2 + ph); }
      c.stroke();
      for (const l of lilies) if (l.x > a && l.x < b) { c.fillStyle = '#4f8a3a'; c.beginPath(); c.ellipse(l.x, yw - 0.2, l.r, 0.7, 0, 0, TAU); c.fill(); if (l.f) { c.fillStyle = '#fbf6ee'; c.beginPath(); c.arc(l.x + 0.5, yw - 1.2, 0.9, 0, TAU); c.fill(); c.fillStyle = '#f2c230'; c.fillRect(l.x + 0.2, yw - 1.5, 0.6, 0.6); } }
      for (const d of ducks) if (d.x > a - 8 && d.x < b + 8) duckSide(c, d.x, yw + 0.4, d.dir, d.drake, clock + d.x);
    }
    function drawStakes(c, x0, x1) {
      for (const p of pts) {
        if (p.x < x0 || p.x > x1) continue;
        const y = gy(p.x), near = Math.abs(p.x - hero.x);
        if (p.kind === 'pk') { // точка (колышек вровень с землёй) и сторожок с надписью
          c.fillStyle = '#6b4a2a'; c.fillRect(p.x - 0.8, y - 0.9, 1.6, 1.4);
          c.fillStyle = '#dcc49a'; c.fillRect(p.x + 2.4, y - 8, 1.4, 8.4);
          c.fillStyle = p.done ? '#2fa84f' : p.warned ? '#d23a2c' : '#e2483a'; c.fillRect(p.x + 2.4, y - 8, 1.4, 2.4);
          c.fillStyle = '#3a2a1a'; c.fillRect(p.x + 2.6, y - 5, 1.0, 0.4); c.fillRect(p.x + 2.6, y - 4, 1.0, 0.4);
        } else {
          const al = p.done || p.warned ? 1 : clamp((95 - near) / 45, 0, 1);
          if (al <= 0) continue;
          c.globalAlpha = al;
          c.fillStyle = '#c9ab78'; c.fillRect(p.x - 0.45, y - 4.8, 0.9, 5.2);
          c.fillStyle = p.done ? '#2fa84f' : p.warned ? '#d23a2c' : p.kind === 'brk' ? '#ff8a1a' : '#2b8fd6';
          c.beginPath(); c.moveTo(p.x + 0.4, y - 4.8); c.lineTo(p.x + 3.2, y - 4.2 + Math.sin(clock * 4 + p.x) * 0.4); c.lineTo(p.x + 0.4, y - 3.6); c.fill();
          c.globalAlpha = 1;
        }
      }
      const cand = candidate();
      if (cand) { const y = gy(cand.x), pu = 0.5 + 0.5 * Math.sin(clock * 8); c.strokeStyle = `rgba(255,215,90,${0.55 + pu * 0.45})`; c.lineWidth = 0.9; c.beginPath(); c.ellipse(cand.x, y, 6 + pu * 1.5, 2, 0, 0, TAU); c.stroke(); }
    }
    const candidate = () => (!staff.on && !hero.air && !hero.climb ? ptNear(staffX(), false, SNAP) : null);
    function drawLabels(c, W) {
      const VW = W / Z, boxes = [];
      c.textBaseline = 'alphabetic';
      // подпись без наложений: если место занято — поднимаем выше (пикеты ставятся первыми)
      const put = (str, x, y, size, color, weight, al) => {
        c.font = `${weight} ${size}px system-ui, sans-serif`;
        const hw = c.measureText(str).width / 2 + 2;
        for (let k = 0; k < 4 && boxes.some(q => x - hw < q.x1 && x + hw > q.x0 && y - size < q.y1 && y + 2 > q.y0); k++) y -= size + 2;
        boxes.push({ x0: x - hw, x1: x + hw, y0: y - size, y1: y + 2 });
        c.globalAlpha = al; outlined(c, str, x, y, size, color, 'center', weight); c.globalAlpha = 1;
      };
      const vis = pts.filter(p => p.x > cam.x - 12 && p.x < cam.x + VW + 12);
      for (const p of vis) if (p.kind === 'pk') {
        const [sx, sy] = toS(p.x, gy(p.x));
        put(p.name + (p.done ? ' ✓' : p.warned ? ' !' : ''), sx + 4, sy - 17, 11, p.done ? '#9dffb5' : p.warned ? '#ff8a7a' : '#ffffff', 'bold', 1);
      }
      for (const p of vis) {
        const [sx, sy] = toS(p.x, gy(p.x)), near = Math.abs(p.x - hero.x);
        if (p.kind === 'pk') { if (p.alt && near < 70 && !p.done) put(p.alt, sx + 4, sy - 30, 9, '#ffe7a0', '600', 1); continue; }
        const al = p.done || p.warned ? 1 : clamp((70 - near) / 30, 0, 1);
        if (al > 0) put(p.done ? '✓' : p.warned ? '!' : p.name, sx, sy - 12, p.done ? 11 : 9, p.done ? '#9dffb5' : p.warned ? '#ff8a7a' : p.kind === 'brk' ? '#ffd7a0' : '#bfe3ff', '600', al);
      }
      const cand = candidate();
      if (cand) { const [sx, sy] = toS(cand.x, gy(cand.x)); outlined(c, cand.lab + ' — держите РЕЙКА', clamp(sx, 80, W - 80), sy + 20, 11, '#ffd76a'); }
    }
    function drawStation(c) {
      const sy = gy(st.x);
      if (st.state === 'walk') {
        const s = person(c, st.x, sy, { dir: st.dir, ph: st.ph, pose: 'carry' }, MATE);
        levelCarried(c, s.sx, s.sy, st.dir);
        return;
      }
      const busy2 = st.state !== 'ready';
      levelSide(c, st.x, sy, w.I, st.dir, !(st.state === 'pack' && st.t > 0.3));
      const look = staff.active || busy2;
      const px = st.x - (look ? 11 : 10.5) * st.dir;
      person(c, px, gy(px), { dir: st.dir, pose: look ? 'bend' : 'book' }, MATE);
    }
    function drawRay(c) {
      if (st.state !== 'ready' || !rayVis) return;
      const yR = yOf(st.HI), ox = st.x + 4.6 * st.dir, dir = st.dir;
      const sx = staff.on ? staff.x : staffX(), ok = rayVis.ok, act = staff.active || staff.done;
      let ex;
      if (rayVis.why === 'hill' || rayVis.why === 'bush') ex = rayVis.at;
      else if (rayVis.why === 'far') ex = st.x + dir * RANGE;
      else ex = sx + dir * (ok ? 0 : 16);
      if (!staff.on && Math.abs(sx - st.x) > RANGE + 60 && !ok) ex = st.x + dir * RANGE;
      c.lineCap = 'round';
      c.strokeStyle = ok ? (act ? 'rgba(255,60,40,.3)' : 'rgba(255,120,80,.18)') : 'rgba(255,50,50,.14)';
      c.lineWidth = act ? 2.6 : 1.6; c.beginPath(); c.moveTo(ox, yR); c.lineTo(ex, yR); c.stroke();
      c.strokeStyle = ok ? (act ? '#ff3b2f' : 'rgba(255,120,80,.85)') : 'rgba(255,70,60,.6)';
      c.lineWidth = act ? 0.6 : 0.45; if (!act) c.setLineDash([3, 2.2]);
      c.beginPath(); c.moveTo(ox, yR); c.lineTo(ex, yR); c.stroke(); c.setLineDash([]);
      if (!ok && staff.on && staff.blocked) { c.strokeStyle = '#ff3b2f'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(ex - 2, yR - 2); c.lineTo(ex + 2, yR + 2); c.moveTo(ex + 2, yR - 2); c.lineTo(ex - 2, yR + 2); c.stroke(); }
      if (ok && act) { c.fillStyle = '#ff2a1a'; c.beginPath(); c.arc(sx, yR, 1.0, 0, TAU); c.fill(); c.fillRect(sx - 2.4, yR - 0.2, 4.8, 0.4); }
    }
    function drawHero(c) {
      const pose = hero.climb ? 'climb' : hero.air ? 'jump' : staff.on ? 'hold' : Math.abs(hero.vx) > 6 ? 'walk' : 'stand';
      const f = hero.facing;
      if (staff.on) staffSide(c, staff.x, gy(staff.x) + 0.3, staff.active ? bub.b * 0.06 : 0);
      else { // рейка на плече: верх назад
        const sk = skel(pose, hero.ph), gx = hero.x + (sk.sh.x + 1.0) * f, gyy = hero.y + sk.sh.y - 0.6;
        const a = -f * 1.05, Ls = STAFF * VY;
        staffSide(c, gx + 0.32 * Ls * Math.sin(a) * -1, gyy + 0.32 * Ls * Math.cos(a), a);
      }
      person(c, hero.x, hero.y, { dir: f, ph: hero.ph, pose }, HERO);
    }
    function drawFront(c, x0, x1) {
      // вода перед ногами вброд
      if (w.water) {
        const yw = yOf(w.water.Hw);
        const wade = (x, half) => { if (!w.inWater(x)) return; const yb = gy(x) + 1; c.fillStyle = 'rgba(70,135,170,.55)'; c.fillRect(x - half, yw, half * 2, yb - yw); c.strokeStyle = 'rgba(230,248,255,.9)'; c.lineWidth = 0.6; c.beginPath(); c.ellipse(x, yw + 0.3, half * 0.8 + Math.sin(clock * 5) * 0.6, 0.8, 0, 0, TAU); c.stroke(); };
        wade(hero.x, 7.5);
        if (staff.on && Math.abs(staff.x - hero.x) > 6) wade(staff.x, 2.5);
        if (st.state === 'walk') wade(st.x, 7.5);
      }
      for (const f of front) if (f.x1 > x0 && f.x0 < x1) { const base = Math.max(gy(f.x0 + 2), gy(f.x1 - 2), gy((f.x0 + f.x1) / 2)); px(c, f.spr, 0, 0, f.spr.canvas.width, f.spr.canvas.height, f.x0, base - f.top + 1.5, Z); }
      // травинки перед ногами
      c.strokeStyle = 'rgba(58,110,40,.95)'; c.lineWidth = 0.7; c.lineCap = 'round'; c.beginPath();
      let i = 0; { let lo = 0, hi = fblades.length / 3 - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (fblades[m * 3] < x0) lo = m + 1; else hi = m; } i = lo * 3; }
      for (; i < fblades.length && fblades[i] < x1; i += 3) {
        const x = fblades[i], y = gy(x) + 1.6, hh = fblades[i + 1], sway = fblades[i + 2] + Math.sin(clock * 2 + x * 0.3) * 0.35;
        const push = Math.abs(x - hero.x) < 4 && !hero.air ? (x - hero.x) * 0.5 : 0;
        c.moveTo(x, y); c.lineTo(x + sway + push, y - hh);
      }
      c.stroke();
      for (const b of bflies) { // бабочки над травой
        const bx = b.x + Math.sin(clock * 0.7 + b.ph) * 30, by = gy(bx) - 14 - Math.sin(clock * 1.9 + b.ph) * 6, fl = Math.abs(Math.sin(clock * 16 + b.ph));
        if (bx < x0 || bx > x1 || w.inWater(bx)) continue;
        c.fillStyle = b.col; c.beginPath(); c.ellipse(bx - 0.9, by, 1.1, 0.5 + fl, 0, 0, TAU); c.ellipse(bx + 0.9, by, 1.1, 0.5 + fl, 0, 0, TAU); c.fill();
      }
    }
    function drawSpeech(c, W) {
      if (!speech) return;
      const px = st.state === 'walk' ? st.x : st.x - 11 * st.dir;
      let [sx, sy] = toS(px, gy(px) - 30);
      if (sx < -30 || sx > W + 30) return;
      sx = clamp(sx, 50, W - 50); sy = Math.max(api.TOP + 64, sy);
      c.font = 'bold 11px system-ui, sans-serif';
      const tw = c.measureText(speech.text).width + 14, a = Math.min(1, speech.t / 0.3);
      if (staff.on && (staff.active || staff.done) && Math.abs(sx - W / 2) < 128 + tw / 2 && sy - 30 < api.TOP + 148) sy = api.TOP + 180; // не под окошком отсчёта
      c.globalAlpha = a;
      api.roundRect(c, sx - tw / 2, sy - 30, tw, 20, 8); c.fillStyle = '#fffdf6'; c.fill(); c.strokeStyle = '#2b2e31'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#fffdf6'; c.beginPath(); c.moveTo(sx - 4, sy - 10.5); c.lineTo(sx, sy - 4); c.lineTo(sx + 4, sy - 10.5); c.fill();
      c.strokeStyle = '#2b2e31'; c.beginPath(); c.moveTo(sx - 4, sy - 10); c.lineTo(sx, sy - 4); c.lineTo(sx + 4, sy - 10); c.stroke();
      api.text(c, speech.text, sx, sy - 16, 11, speech.color);
      c.globalAlpha = 1;
    }
    function drawOffscreen(c, W, H) {
      const [sx] = toS(st.x, 0);
      if (sx > -6 && sx < W + 6) return;
      const left = sx < 0, yR = toS(0, yOf(st.state === 'ready' ? st.HI : w.hw(st.x) + w.I))[1];
      const y = clamp(yR, api.TOP + 70, H - 120), d = Math.round(Math.abs(st.x - hero.x) / MX);
      const txt = left ? `◀ нивелир ${d} м` : `нивелир ${d} м ▶`;
      c.font = 'bold 11px system-ui, sans-serif';
      const tw = c.measureText(txt).width + 12, x = left ? 6 : W - 6 - tw;
      api.roundRect(c, x, y - 11, tw, 18, 6); c.fillStyle = 'rgba(20,14,10,.75)'; c.fill();
      c.strokeStyle = rayVis && rayVis.ok ? 'rgba(108,255,138,.8)' : 'rgba(255,107,91,.8)'; c.lineWidth = 1; c.stroke();
      api.text(c, txt, x + tw / 2, y + 2, 11, '#d6efff');
    }
    function drawPlan(c, W) {
      const pw = W - 16, ph = 22, px = 8, py = api.TOP + 4;
      if (!planCache || planCache.w !== pw) planCache = { w: pw, layer: planLayer(pw, ph) };
      c.drawImage(planCache.layer.canvas, px, py, pw, ph);
      const k = pw / (XR1 - XR0), X = x => px + (x - XR0) * k, VW = W / Z;
      c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(X(cam.x), py + 1, VW * k, ph - 2);
      c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1; c.strokeRect(X(cam.x), py + 1, VW * k, ph - 2);
      for (const p of pts) if (p.done || p.warned) { c.fillStyle = p.done ? '#1fd25a' : '#ff3b2f'; c.fillRect(X(p.x) - 1.3, py + ph / 2 - 1.3, 2.6, 2.6); }
      c.fillStyle = 'rgba(126,200,255,.55)'; c.fillRect(X(st.x - RANGE), py + ph - 3, 2 * RANGE * k, 2);
      const tx = X(st.x);
      c.fillStyle = '#1f6fb5'; c.beginPath(); c.moveTo(tx, py + 4); c.lineTo(tx - 3.5, py + ph - 4); c.lineTo(tx + 3.5, py + ph - 4); c.closePath(); c.fill();
      c.strokeStyle = '#ffffff'; c.lineWidth = 0.8; c.stroke();
      c.fillStyle = '#ff7a1a'; c.beginPath(); c.arc(X(hero.x), py + ph / 2, 3.3, 0, TAU); c.fill(); c.strokeStyle = '#ffffff'; c.lineWidth = 1; c.stroke();
    }
    function drawLevelUI(c, W) {
      if (!staff.on || !(staff.active || staff.done)) return;
      const cx = W / 2, cy = api.TOP + 98, r = 29, tx = cx - 80, lx = cx + 80;
      api.roundRect(c, cx - 128, cy - 41, 256, 88, 12); c.fillStyle = 'rgba(20,14,10,.74)'; c.fill(); c.strokeStyle = 'rgba(255,176,46,.8)'; c.lineWidth = 1.5; c.stroke();
      // поле зрения трубы: рейка с «Е»-шашками, сетка нитей
      const rm = staff.done ? staff.read : staff.r * 1000 + bub.b * bub.b * 45, kk = 0.27;
      c.save(); c.beginPath(); c.arc(tx, cy, r, 0, TAU); c.clip();
      c.fillStyle = '#dfe7da'; c.fillRect(tx - r, cy - r, 2 * r, 2 * r);
      const fw = 24, Y = mm => cy - (mm - rm) * kk;
      c.fillStyle = '#fbf9f1'; c.fillRect(tx - fw / 2, cy - r, fw, 2 * r);
      for (let d = Math.floor((rm - 140) / 100); d <= Math.ceil((rm + 140) / 100); d++) {
        if (d < 0 || d >= 30) continue;
        const base = d * 100; c.fillStyle = Math.floor(base / 1000) % 2 === 1 ? '#cf2f27' : '#1c1c1c';
        c.fillRect(tx - fw / 2, Y(base + 50), 3.4, 50 * kk);
        for (const q of [0, 20, 40]) c.fillRect(tx - fw / 2, Y(base + q + 10), fw / 2, 10 * kk);
        c.font = 'bold 10px system-ui, sans-serif'; c.textAlign = 'left'; c.fillText(String(d).padStart(2, '0'), tx + 1.5, Y(base + 58) + 3.5);
      }
      c.strokeStyle = 'rgba(20,20,20,.9)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(tx - r, cy); c.lineTo(tx + r, cy); c.moveTo(tx, cy - r); c.lineTo(tx, cy + r); c.stroke();
      const sd = Math.abs(staff.x - st.x) / MX * 5 * kk;
      if (sd < r - 3) { c.beginPath(); c.moveTo(tx - 6, cy - sd); c.lineTo(tx + 6, cy - sd); c.moveTo(tx - 6, cy + sd); c.lineTo(tx + 6, cy + sd); c.stroke(); }
      if (!vignette) { vignette = c.createRadialGradient(0, 0, r * 0.55, 0, 0, r); vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.55)'); }
      c.translate(tx, cy); c.fillStyle = vignette; c.fillRect(-r, -r, 2 * r, 2 * r);
      c.restore();
      c.strokeStyle = '#2b2e31'; c.lineWidth = 4; c.beginPath(); c.arc(tx, cy, r + 2, 0, TAU); c.stroke();
      api.text(c, 'труба нивелира', tx, cy + r + 13, 9, api.theme.dim, 'center', '600');
      // круглый уровень на рейке
      const rb = 8.5, rz = rb + ZONE * (r - rb - 3), inC = Math.abs(bub.b) < ZONE;
      c.fillStyle = '#8d969b'; c.beginPath(); c.arc(lx, cy, r + 3, 0, TAU); c.fill();
      c.fillStyle = inC || staff.done ? '#d4f0b0' : '#e8efb8'; c.beginPath(); c.arc(lx, cy, r, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(40,60,30,.35)'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(lx - r, cy); c.lineTo(lx + r, cy); c.moveTo(lx, cy - r); c.lineTo(lx, cy + r); c.stroke();
      c.strokeStyle = '#1d1d1d'; c.lineWidth = 1.2; c.beginPath(); c.arc(lx, cy, rz, 0, TAU); c.stroke();
      const bx = lx + bub.b * (r - rb - 3), by = cy + (staff.done ? 0 : Math.sin(clock * 2.1) * 1.4);
      c.fillStyle = 'rgba(255,255,250,.92)'; c.beginPath(); c.arc(bx, by, rb, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(90,110,70,.6)'; c.lineWidth = 0.8; c.stroke();
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(bx - 2.6, by - 2.8, 2.2, 0, TAU); c.fill();
      if (!staff.done && bub.hold > 0) { c.strokeStyle = '#6cff8a'; c.lineWidth = 3; c.beginPath(); c.arc(lx, cy, r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, bub.hold / HOLD)); c.stroke(); }
      api.text(c, 'круглый уровень', lx, cy + r + 13, 9, api.theme.dim, 'center', '600');
      if (staff.done) { api.text(c, 'отсчёт', cx, cy - 10, 10, api.theme.dim, 'center', '600'); api.text(c, pad4(staff.read), cx, cy + 10, 20, api.theme.good); }
      else { api.text(c, '◀  ▶', cx, cy - 2, 15, '#ffd76a'); api.text(c, 'пузырёк', cx, cy + 14, 9, api.theme.dim, 'center', '600'); api.text(c, 'в центр', cx, cy + 25, 9, api.theme.dim, 'center', '600'); }
    }
    function drawButtons(c) {
      const b = buttons(), cand = candidate(), pu = Math.sin(clock * 7) > 0;
      const lw = staff.active ? '#9fd8ff' : undefined;
      api.button(c, b.left, '◀', { active: roleCount('left') > 0 || input.kl, size: 22, color: lw });
      api.button(c, b.right, '▶', { active: roleCount('right') > 0 || input.kr, size: 22, color: lw });
      api.button(c, b.jump, '▲', { active: hero.air, size: 22, disabled: staff.on });
      api.button(c, b.staff, 'РЕЙКА', { active: staff.on, color: cand ? (pu ? '#6cff8a' : '#b8ffca') : api.theme.accent, size: 17 });
      const moving = st.state !== 'ready';
      const el = st.state === 'pack' ? st.t : st.state === 'walk' ? 0.6 + st.t : st.state === 'setup' ? MOVE_T - 0.8 + st.t : 0;
      api.button(c, b.move, moving ? `ПЕРЕНОС ${fmt(Math.max(0, MOVE_T - el), 1)} с` : 'ПЕРЕНОС', { active: !moving && flashMove > 0 && pu, color: '#7ec8ff', size: moving ? 12 : 14, disabled: moving });
      if (showDone()) api.button(c, b.done, 'СДАТЬ', { color: '#6cff8a', size: 14, active: pu && got / total > 0.9 });
    }

    // ---------- итог: бланк продольного профиля ----------
    const RIVER = ['р. Песчанка', 'р. Каменка', 'р. Липовка', 'р. Сосновка', 'р. Ольховка', 'р. Быстрянка'][ri(0, 5)];
    let sheet = null;
    function drawResult(ctx, x, y, wd, ht) {
      const key = Math.round(wd) + 'x' + Math.round(ht);
      if (!sheet || sheet.key !== key) sheet = { key, layer: layer(wd, ht, c => drawSheet(c, wd, ht)) };
      ctx.drawImage(sheet.layer.canvas, x, y, wd, ht);
    }
    function drawSheet(c, wd, ht) {
      const was = Sym.cache; Sym.cache = false;
      try { sheetBody(c, wd, ht); } finally { Sym.cache = was; }
    }
    function sheetBody(c, wd, ht) {
      const INK = '#1f1d1a', BR = '#a0582a', BL = '#2b6cb0', lab = Sym.plan.label;
      const { M, fh, fdop, miss } = resInfo;
      Sym.plan.paper(c, 0, 0, wd, ht, { stamp: false, grid: -1, margin: 4 });
      lab(c, wd / 2, 12.5, 'ПРОДОЛЬНЫЙ ПРОФИЛЬ ПО ОСИ ТРАССЫ', Math.min(7.4, wd / 34), INK, 0, 700);
      lab(c, wd / 2, 21, `${variant.title} · ПК0 — ПК${N} · Мг 1:2000, Мв 1:200`, 4.6, '#4a443c', 0, 500);
      const rows = [['Отметки земли, м', 30], ['Расстояния, м', 10], ['Пикеты', 10], ['План трассы', 26]];
      const tableH = rows.reduce((s, r) => s + r[1], 0), legH = 15;
      const gx0 = 38, gx1 = wd - 9, gy0 = 27, gy1 = ht - 6 - legH - tableH;
      const X = x => gx0 + x / L * (gx1 - gx0);
      let hmin = Infinity, hmax = -Infinity;
      for (let x = 0; x <= L; x += 4) { const hh = w.hb(x); hmin = Math.min(hmin, hh); hmax = Math.max(hmax, hh); }
      for (const p of M) { hmin = Math.min(hmin, p.hm); hmax = Math.max(hmax, p.hm); }
      const UG = Math.floor(hmin - 0.6), top = hmax + 0.5, ky = (gy1 - gy0 - 6) / (top - UG), Y = hh => gy1 - (hh - UG) * ky;
      // сетка и шкала высот
      c.lineWidth = 0.25; c.strokeStyle = 'rgba(160,88,42,.25)'; c.beginPath();
      for (let m = UG + 1; m <= top; m++) { c.moveTo(gx0, Y(m)); c.lineTo(gx1, Y(m)); }
      for (let k = 0; k <= N; k++) { c.moveTo(X(k * PK), gy0 + 2); c.lineTo(X(k * PK), gy1); }
      c.stroke();
      const stepM = ky < 6 ? 2 : 1;
      for (let m = UG + 1; m <= top; m += stepM) lab(c, gx0 - 2, Y(m), String(m), 3.8, '#6a5a48', 0, 500, 'right');
      c.strokeStyle = INK; c.lineWidth = 0.4; c.beginPath(); c.moveTo(gx0, gy0 + 2); c.lineTo(gx0, gy1); c.stroke();
      // вода, труба, подписи сооружений
      if (w.water) {
        const yw = Y(w.water.Hw);
        c.beginPath(); c.moveTo(X(w.water.x0), yw); for (let x = w.water.x0; x <= w.water.x1; x += 2) c.lineTo(X(x), Math.max(yw, Y(w.hb(x)))); c.lineTo(X(w.water.x1), yw); c.closePath();
        c.fillStyle = '#d3e6f4'; c.fill();
        c.strokeStyle = BL; c.lineWidth = 0.5; c.beginPath(); c.moveTo(X(w.water.x0), yw); c.lineTo(X(w.water.x1), yw); c.stroke();
        lab(c, X((w.water.x0 + w.water.x1) / 2), yw - 3.4, `УВ ${fmt(w.water.Hw, 2)}`, 3.6, BL, 0, 600);
        lab(c, X((w.water.x0 + w.water.x1) / 2), Math.min(gy1 - 3, yw + 5), RIVER, 3.4, BL, 0, 500);
      }
      if (emb) {
        const t = 0.5, hn = lerp(emb.hA, emb.hB, t) - emb.dip, cyP = Y(hn + 0.12 + emb.pipeR), ry = emb.pipeR * ky, rx = Math.max(1.4, emb.pipeR * MX * (gx1 - gx0) / L);
        c.strokeStyle = INK; c.lineWidth = 0.45; c.beginPath(); c.ellipse(X(emb.xc), cyP, rx, ry, 0, 0, TAU); c.stroke();
        c.setLineDash([1.6, 1]); c.strokeStyle = BR; c.lineWidth = 0.35; c.beginPath();
        for (let x = emb.x0; x <= emb.x1; x += 2) { const tt = (x - emb.x0) / (emb.x1 - emb.x0), yy = Y(lerp(emb.hA, emb.hB, tt) - emb.dip * Math.sin(Math.PI * tt)); if (x === emb.x0) c.moveTo(X(x), yy); else c.lineTo(X(x), yy); }
        c.stroke(); c.setLineDash([]);
        lab(c, X(emb.xc), cyP - ry - 3, `труба Ø${fmt(emb.pipeR * 2, 1)}`, 3.5, INK, 0, 600);
        lab(c, X((emb.t0 + emb.t1) / 2), Y(w.hb((emb.t0 + emb.t1) / 2)) - 6, 'насыпь', 3.6, '#6a5a48', 0, 500);
      }
      if (road) lab(c, X((road.e1 + road.e2) / 2), Y(w.hb((road.e1 + road.e2) / 2)) - 5, 'а/д', 3.8, INK, 0, 600);
      // истинный рельеф (пунктир) и профиль по отсчётам (сплошная), ординаты
      c.setLineDash([2, 1.2]); c.strokeStyle = BR; c.lineWidth = 0.55; c.beginPath();
      for (let x = 0; x <= L; x += 2) { if (x === 0) c.moveTo(X(x), Y(w.hb(x))); else c.lineTo(X(x), Y(w.hb(x))); }
      c.stroke(); c.setLineDash([]);
      const rowY = []; { let yy = gy1; for (const r of rows) { rowY.push(yy); yy += r[1]; } rowY.push(yy); }
      c.strokeStyle = 'rgba(31,29,26,.5)'; c.lineWidth = 0.25; c.beginPath();
      for (const p of M) { c.moveTo(X(p.x), Y(p.hm)); c.lineTo(X(p.x), rowY[1]); }
      c.stroke();
      if (M.length > 1) { c.strokeStyle = INK; c.lineWidth = 0.95; c.lineJoin = 'round'; c.beginPath(); M.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.hm)) : c.moveTo(X(p.x), Y(p.hm)))); c.stroke(); }
      for (const p of M) { c.fillStyle = INK; c.beginPath(); c.arc(X(p.x), Y(p.hm), 0.9, 0, TAU); c.fill(); }
      for (const e of extras) { c.strokeStyle = BL; c.lineWidth = 0.5; c.beginPath(); c.arc(X(e.x), Y(e.hm), 1.6, 0, TAU); c.stroke(); }
      for (const p of miss) { const px = X(p.x), py = Y(p.h); c.fillStyle = '#d0302a'; c.beginPath(); c.moveTo(px, py - 2.6); c.lineTo(px - 1.8, py + 0.6); c.lineTo(px + 1.8, py + 0.6); c.closePath(); c.fill(); }
      // таблица
      c.strokeStyle = INK; c.lineWidth = 0.5; c.beginPath();
      for (const yy of rowY) { c.moveTo(6, yy); c.lineTo(wd - 6, yy); }
      c.moveTo(gx0, gy1); c.lineTo(gx0, rowY[rowY.length - 1]);
      c.stroke();
      c.fillStyle = INK; c.font = 'italic 600 3.6px Arial, sans-serif'; c.textBaseline = 'middle';
      rows.forEach((r, i) => {
        const words = r[0].split(' '), y0 = rowY[i], y1 = rowY[i + 1];
        if (words.length > 1 && r[1] > 14) { lab(c, 8, (y0 + y1) / 2 - 2.6, words[0], 3.7, INK, 0, 600, 'left'); lab(c, 8, (y0 + y1) / 2 + 2.6, words.slice(1).join(' '), 3.7, INK, 0, 600, 'left'); }
        else lab(c, 8, (y0 + y1) / 2, r[0], 3.4, INK, 0, 600, 'left');
      });
      // отметки — вертикально, без наложений (пикеты в приоритете)
      const placed = [];
      const order = M.map(p => ({ p, pk: pts.some(q => q.kind === 'pk' && Math.abs(q.x - p.x) < 0.5) })).sort((a, b) => b.pk - a.pk);
      for (const o of order) {
        const px = X(o.p.x);
        if (placed.some(q => Math.abs(q - px) < 4.4)) continue;
        placed.push(px);
        lab(c, px + 0.2, (rowY[0] + rowY[1]) / 2, fmt(o.p.hm, 2), 3.7, INK, -Math.PI / 2, o.pk ? 700 : 500);
      }
      // расстояния между точками
      c.strokeStyle = INK; c.lineWidth = 0.3; c.beginPath();
      for (const p of M) { c.moveTo(X(p.x), rowY[1]); c.lineTo(X(p.x), rowY[2]); }
      c.stroke();
      for (let i = 1; i < M.length; i++) { const a = X(M[i - 1].x), b = X(M[i].x); if (b - a >= 8.5) lab(c, (a + b) / 2, (rowY[1] + rowY[2]) / 2, String(Math.round((M[i].x - M[i - 1].x) / MX)), 3.4, INK, 0, 500); }
      // пикеты
      c.beginPath(); for (let k = 0; k <= N; k++) { c.moveTo(X(k * PK), rowY[2]); c.lineTo(X(k * PK), rowY[2] + 3); } c.stroke();
      for (let k = 0; k <= N; k++) lab(c, X(k * PK) + 1.5, (rowY[2] + rowY[3]) / 2 + 0.8, String(k), 3.8, INK, 0, 600, 'left');
      // план трассы: условные знаки Sym.plan
      const py0 = rowY[3] + 2, py1 = rowY[4] - 2, pm = (py0 + py1) / 2;
      c.save(); c.beginPath(); c.rect(gx0, rowY[3], gx1 - gx0 + 4, rowY[4] - rowY[3]); c.clip();
      if (road) Sym.plan.road(c, [[X((road.e1 + road.e2) / 2), py0 - 4], [X((road.e1 + road.e2) / 2), py1 + 4]], Math.max(5, X(road.e2) - X(road.e1)), null);
      if (road) for (const d of [road.d1, road.d2]) Sym.plan.water(c, [[X(d), py0 - 2], [X(d), py1 + 2]], 1.2);
      if (emb) {
        Sym.plan.slope(c, [[X(emb.t0), py0 + 3], [X(emb.t0), py1 - 3]], [[X(emb.x0), py0 + 3], [X(emb.x0), py1 - 3]]);
        Sym.plan.slope(c, [[X(emb.t1), py0 + 3], [X(emb.t1), py1 - 3]], [[X(emb.x1), py0 + 3], [X(emb.x1), py1 - 3]]);
        Sym.plan.water(c, [[X(emb.xc), py0 - 2], [X(emb.xc), py1 + 2]], 1.5);
      }
      if (riv) {
        Sym.plan.water(c, [[X((riv.w0 + riv.w1) / 2), py0 - 6], [X((riv.w0 + riv.w1) / 2), py1 + 6]], X(riv.w1) - X(riv.w0));
        Sym.plan.slope(c, [[X(riv.b0), py0], [X(riv.b0), py1]], [[X(riv.b1), py0], [X(riv.b1), py1]]);
        Sym.plan.slope(c, [[X(riv.t1), py0], [X(riv.t1), py1]], [[X(riv.t0), py0], [X(riv.t0), py1]]);
        lab(c, X((riv.w0 + riv.w1) / 2), pm, RIVER.replace('р. ', ''), 3.2, BL, -Math.PI / 2, 600);
      }
      for (const o of ob.ditch) Sym.plan.water(c, [[X((o.x0 + o.x1) / 2), py0 - 2], [X((o.x0 + o.x1) / 2), py1 + 2]], 1.0);
      for (const tr of trees) if (tr.x > 0 && tr.x < L) Sym.plan.tree(c, X(tr.x), tr.seed % 2 ? py0 + 3.5 : py1 - 2, treeKind[tr.kind] === 'conifer' ? 'conifer' : tr.kind === 'birch' ? 'birch' : 'deciduous');
      for (const d of deco) if (d.kind === 'pole' && d.x > 0 && d.x < L) Sym.plan.pole(c, X(d.x), py0 + 3, 'power', Math.PI / 2);
      c.strokeStyle = '#c0392b'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(X(0), pm); c.lineTo(X(L), pm); c.stroke();
      c.fillStyle = '#c0392b'; for (let k = 0; k <= N; k++) { c.beginPath(); c.arc(X(k * PK), pm, 0.7, 0, TAU); c.fill(); }
      c.restore();
      // условные обозначения и невязка
      const ly = ht - 6 - legH / 2 - 1;
      c.strokeStyle = INK; c.lineWidth = 0.9; c.beginPath(); c.moveTo(8, ly - 2.6); c.lineTo(17, ly - 2.6); c.stroke();
      lab(c, 19, ly - 2.6, 'по отсчётам', 3.5, INK, 0, 500, 'left');
      c.setLineDash([2, 1.2]); c.strokeStyle = BR; c.lineWidth = 0.55; c.beginPath(); c.moveTo(8, ly + 2.8); c.lineTo(17, ly + 2.8); c.stroke(); c.setLineDash([]);
      lab(c, 19, ly + 2.8, 'истинный рельеф', 3.5, INK, 0, 500, 'left');
      c.fillStyle = '#d0302a'; c.beginPath(); c.moveTo(58, ly - 4.5); c.lineTo(56.4, ly - 1.4); c.lineTo(59.6, ly - 1.4); c.closePath(); c.fill();
      lab(c, 62, ly - 2.6, `пропуск (${miss.length})`, 3.5, INK, 0, 500, 'left');
      c.strokeStyle = BL; c.lineWidth = 0.5; c.beginPath(); c.arc(58, ly + 2.8, 1.5, 0, TAU); c.stroke();
      lab(c, 62, ly + 2.8, `лишние (${extras.length})`, 3.5, INK, 0, 500, 'left');
      lab(c, wd - 8, ly - 2.6, `Нивелир Н-3, рейка РН-3 · станций ${st.no}`, 3.5, INK, 0, 500, 'right');
      lab(c, wd - 8, ly + 2.8, `fh = ${fh > 0 ? '+' : ''}${fh} мм, доп. ±${fdop} мм ${Math.abs(fh) <= fdop ? '— в допуске' : '— НЕ в допуске'}`, 3.5, Math.abs(fh) <= fdop ? '#2e6b3a' : '#b3261e', 0, 600, 'right');
    }

    // ---------- автоигрок: идёт вправо, встаёт на каждую точку, держит пузырёк, переносит нивелир ----------
    const BOT = { walk: 0, staff: false, wait: 0 };
    function botStep(dt) {
      if (over) return;
      const b = buttons();
      const C = (r, id) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, id, button: 0 });
      const tap = (id, r) => { pointerDown(C(r, id)); pointerUp(C(r, id)); };
      const setWalk = d => { if (BOT.walk === d) return; if (BOT.walk) pointerUp(C(BOT.walk > 0 ? b.right : b.left, 901)); BOT.walk = d; if (d) pointerDown(C(d > 0 ? b.right : b.left, 901)); };
      if (BOT.staff) {
        if (hero.auto) return;
        if (!staff.on || staff.done || staff.blocked) { pointerUp(C(b.staff, 902)); BOT.staff = false; BOT.wait = 0.05; return; }
        const u = clamp(-(bub.b * 3.2 + bub.v * 1.15), -1, 1);
        pointerMove({ x: staff.px0 + u * 34, y: b.staff.y + 20, id: 902, down: true });
        return;
      }
      if (BOT.wait > 0) { BOT.wait -= dt; return; }
      let p = null; for (const q of pts) if (!q.done) { p = q; break; }
      if (!p) { setWalk(0); return; }
      if (hero.climb || hero.air) return;
      const want = p.x - hero.facing * 4, dx = want - hero.x, dn = Math.sign(dx);
      if (Math.abs(dx) > 1.6) {
        for (const o of ob.ditch.concat(ob.log)) {
          const edge = dn > 0 ? o.x0 - hero.x : hero.x - o.x1;
          if (edge > 3 && edge < 13 && Math.abs(hero.vx) > 30 && Math.sign(hero.vx) === dn && (dn > 0 ? p.x > o.x0 : p.x < o.x1)) { tap(903, b.jump); return; }
        }
        const stopD = hero.vx * hero.vx / (2 * ACC) + 0.5;
        if (Math.abs(dx) <= stopD && Math.sign(hero.vx) === dn) setWalk(0); else setWalk(dn);
        return;
      }
      setWalk(0);
      if (Math.abs(hero.vx) > 2 || st.state !== 'ready') return;
      if (!w.sight(staffX(), st.x, st.HI).ok) { tap(904, b.move); BOT.wait = 0.15; return; }
      pointerDown(C(b.staff, 902)); BOT.staff = true;
    }

    return {
      update, draw, pointerDown, pointerMove, pointerUp, key,
      hud() { // подпись сжимается, чтобы не наползать на название уровня на узком экране
        const room = api.W - 330 - 52 - titleW;
        const info = room > 118 ? [`Точки ${got}/${total}`, `Ст. ${st.no}`] : room > 40 ? [`${got}/${total}`] : [];
        return { time: Math.max(0, T_LEVEL - t), info, progress: got / total };
      },
      bot(dt) { botStep(dt); },
      _dbg: { w, pts, hero, st, staff, bub, get t() { return t; }, get relocs() { return relocs; }, get bias() { return bias; }, extras },
    };
  }
})();
