'use strict';
// Участок 3 — метро: проходка тоннеля и строящаяся станция. Тюбинги, лампы, кабельные лотки, пути, служебные мостки.
// Контракт темы: см. THEMES.md, образец — 01-city.js.
(() => {
  // ---------- общее ----------
  const WALL_TOP = 96;                // где стена тоннеля переходит в свод
  const VPY = 190;                    // высота точки схода: стыки колец на своде расходятся от неё к зрителю
  const RING = 56, P_WALL = 0.3;      // ширина кольца-тюбинга на стене и скорость параллакса стены
  const BLOCK = 6, SW = BLOCK * RING; // колец в блоке стены; блок — тоннель, тоннель со сбойкой или участок станции
  const edges = new WeakMap();        // у каких краёв отрезка земли виден торец (сосед ниже или провал)
  const blockType = b => { const m = ((b % 4) + 4) % 4; return m === 2 ? 'station' : m === 0 ? 'portal' : 'tunnel'; };

  // Свет — ступенчатый: несколько вложенных полупрозрачных эллипсов. Выглядит «плоско», как весь стиль игры,
  // и на телефоне в разы дешевле радиальных градиентов (градиенты на весь экран — главный пожиратель кадра).
  const LAMP = '#ffb45a', TBM = '#ff8a2a', RED = '#ff3b30', STEPS = [[1, 0.045], [0.78, 0.06], [0.57, 0.08], [0.38, 0.1], [0.2, 0.13]];
  function glow(ctx, color, x, y, rx, ry, a = 1) {
    ctx.fillStyle = color;
    for (const [k, al] of STEPS) { ctx.globalAlpha = Math.min(1, al * a); ctx.beginPath(); ctx.ellipse(x, y, rx * k, ry * k, 0, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  function archPath(ctx, cx, sy, r, bottom) { // арка: стойки до bottom и полукруглый верх
    ctx.beginPath(); ctx.moveTo(cx - r, bottom); ctx.lineTo(cx - r, sy); ctx.arc(cx, sy, r, Math.PI, 0); ctx.lineTo(cx + r, bottom); ctx.closePath();
  }

  // Обход ошибки генератора: из-за зажима groundRange соседние отрезки иногда различаются на 1–6 ед. — на вид ровно,
  // а герой упирается в «невидимый» порожек (~0,7 % уровней). Поднимаем нижнюю серию отрезков до соседа вместе
  // с блоками, платформами, врагами и краем провала за ней; подъём ≤ 6, так что прыжки остаются с запасом.
  function fixTinySteps(api) {
    const { solids, platforms, enemies, pits, player: P } = api, adj = (a, b) => Math.abs(a.x + a.w - b.x) < 0.5;
    for (let pass = 0; pass < 20; pass++) {
      const g = solids.filter(q => q.kind === 'ground').sort((a, b) => a.x - b.x);
      const i = g.findIndex((q, k) => k > 0 && adj(g[k - 1], q) && q.y !== g[k - 1].y && Math.abs(q.y - g[k - 1].y) <= 6);
      if (i < 0) break;
      const lo = g[i].y > g[i - 1].y ? i : i - 1, y0 = g[lo].y, d = Math.abs(g[i].y - g[i - 1].y);
      let a = lo, b = lo;
      while (a > 0 && adj(g[a - 1], g[a]) && g[a - 1].y === y0) a--;
      while (b + 1 < g.length && adj(g[b], g[b + 1]) && g[b + 1].y === y0) b++;
      const x0 = g[a].x, x1 = g[b].x + g[b].w, on = o => { const c = o.x + o.w / 2; return c >= x0 && c < x1; };
      for (const q of solids) if (on(q) && (q.kind === 'obstacle' || q.y === y0)) { q.y -= d; if (q.kind === 'ground') q.h += d; }
      for (const q of platforms) if (on(q)) { q.y -= d; q.base -= d; }
      for (const e of enemies) if (on(e) && !e.isBoss) { e.y -= d; e.groundY -= d; if (e.baseY != null) e.baseY -= d; }
      for (const q of pits) if (Math.abs(q.x - x1) < 0.5) q.y -= d;
    }
    const top = api.groundAt(P.x + P.w / 2);
    if (top !== null && P.y + P.h > top) P.y = top - P.h; // стартовый отрезок мог подняться
  }

  // ---------- фон ----------
  function drawPortal(ctx, api, cx, cy, R) { // сбойка: вид в поперечный тоннель, в конце — светящийся щит ТПМК
    const { W, now } = api, vx = W / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fillStyle = '#0a0b0e'; ctx.fill(); ctx.clip();
    const ringC = ['#2c3038', '#3a3639', '#4f3f37', '#6e4a31', '#95602e'];
    let s = 1, ex = cx, ey = cy;
    for (let n = 0; n < 5; n++) { // кольца уходят вдаль и смещаются к центру кадра — объём; ближе к щиту — рыжий отсвет
      s *= 0.76; ex = cx + (vx - cx) * (1 - s) * 0.3; ey = cy + (VPY - cy) * (1 - s) * 0.3;
      ctx.strokeStyle = ringC[n]; ctx.lineWidth = Math.max(1.2, 9 * s);
      ctx.beginPath(); ctx.arc(ex, ey, R * s, 0, 7); ctx.stroke();
      ctx.fillStyle = '#ffd98a'; ctx.fillRect(ex - 1, ey - R * s + 4 * s, 2 + 2 * s, 1.5 + 2 * s); // лампы по своду
    }
    const r = R * s * 1.05, pulse = 1 + Math.sin(now * 5) * 0.07;
    glow(ctx, TBM, ex, ey, R * 0.9 * pulse, R * 0.9 * pulse, 2.2);
    ctx.fillStyle = '#ffc45e'; ctx.beginPath(); ctx.arc(ex, ey, r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#7a3a12'; ctx.lineWidth = 1.6; ctx.beginPath(); // вращающийся ротор с резцами
    for (let k = 0; k < 6; k++) { const a = now * 1.4 + k * Math.PI / 3; ctx.moveTo(ex, ey); ctx.lineTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r); }
    ctx.stroke(); ctx.beginPath(); ctx.arc(ex, ey, r, 0, 7); ctx.stroke();
    ctx.fillStyle = '#fff1b0'; ctx.beginPath(); ctx.arc(ex, ey, 2, 0, 7); ctx.fill();
    for (let k = 0; k < 6; k++) { // искры от резцов
      const a = now * 2.3 + k * 1.05, d = r * (1 + ((now * 1.7 + k * 0.19) % 1) * 1.8);
      ctx.fillRect(ex + Math.cos(a) * d, ey + Math.sin(a) * d, 1.5, 1.5);
    }
    ctx.restore();
    ctx.strokeStyle = '#1f232a'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(cx, cy, R + 4, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,190,110,.18)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R + 8, 0, 7); ctx.stroke();
    ctx.fillStyle = '#4b535e';
    for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; ctx.fillRect(cx + Math.cos(a) * (R + 4) - 1.5, cy + Math.sin(a) * (R + 4) - 1.5, 3, 3); } // болты
  }

  function drawHall(ctx, api, ax, aw) { // вид сквозь арку станции: дальний зал с пилонами и огнями
    const off = api.camX * 0.15, step = 46;
    ctx.fillStyle = '#211c1a'; ctx.fillRect(ax, 130, aw, 130);
    ctx.fillStyle = '#121113'; ctx.fillRect(ax, 250, aw, 90);
    for (let i = Math.floor((ax + off) / step) - 1; i * step - off < ax + aw + step; i++) {
      const x = i * step - off;
      ctx.fillStyle = '#3a302a'; ctx.fillRect(x, 146, 14, 104);
      glow(ctx, LAMP, x + 7, 166, 18, 15, 0.9);
      ctx.fillStyle = '#ffd98a'; ctx.fillRect(x + 5, 164, 4, 3);
    }
    ctx.fillStyle = '#5a4536'; ctx.fillRect(ax, 250, aw, 2); // край дальней платформы
    ctx.fillStyle = '#34363b'; ctx.fillRect(ax, 262, aw, 1.5); ctx.fillRect(ax, 268, aw, 1.5);
  }

  function drawStation(ctx, api, x0, b) { // участок будущей станции: мраморные пилоны, арки, бра
    const { hash } = api;
    ctx.fillStyle = '#6e1f1b'; ctx.fillRect(x0, 102, SW, 14); // фриз
    ctx.fillStyle = '#c9a44a'; ctx.fillRect(x0, 102, SW, 1.5); ctx.fillRect(x0, 114, SW, 1.5);
    ctx.fillStyle = '#a89b8c'; ctx.fillRect(x0, 116, SW, 220); // мрамор
    for (let n = 0; n < 3; n++) {
      const cx = x0 + 76 + n * 104, sy = 182, r = 38;
      ctx.save(); archPath(ctx, cx, sy, r, 330); ctx.fillStyle = '#121418'; ctx.fill(); ctx.clip();
      drawHall(ctx, api, cx - r, 2 * r);
      ctx.restore();
      ctx.strokeStyle = '#857869'; ctx.lineWidth = 4; archPath(ctx, cx, sy, r + 2, 330); ctx.stroke();
      if (n === 1 && hash(b * 3 + 1) > 0.4) { // леса в средней арке: станция ещё строится
        ctx.strokeStyle = '#5c7fb0'; ctx.lineWidth = 2; ctx.beginPath();
        for (let y = 196; y < 320; y += 30) { ctx.moveTo(cx - r, y); ctx.lineTo(cx + r, y); ctx.moveTo(cx - r, y); ctx.lineTo(cx + r, y + 30); }
        ctx.moveTo(cx - r + 6, 180); ctx.lineTo(cx - r + 6, 330); ctx.moveTo(cx + r - 6, 180); ctx.lineTo(cx + r - 6, 330); ctx.stroke();
      }
    }
    for (let n = 0; n < 4; n++) { // пилоны: блик, тень, мягкие прожилки, капитель, гранитный цоколь, бра
      const px = x0 + 10 + n * 104;
      ctx.fillStyle = '#c9bdaf'; ctx.fillRect(px, 116, 4, 220);
      ctx.fillStyle = '#8a7e71'; ctx.fillRect(px + 23, 116, 5, 220);
      ctx.fillStyle = '#978878'; ctx.fillRect(px - 3, 116, 34, 7);
      ctx.strokeStyle = 'rgba(140,124,108,.45)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let v = 0; v < 2; v++) {
        const y = 132 + v * 70 + hash(b * 31 + n * 7 + v) * 20, x = px + 5 + hash(b * 17 + n * 5 + v) * 8;
        ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 18, y + 18, x + 8, y + 46);
      }
      ctx.stroke();
      ctx.fillStyle = '#5e2d2a'; ctx.fillRect(px - 2, 284, 32, 40);
      glow(ctx, LAMP, px + 14, 150, 50, 44, 1.4);
      ctx.fillStyle = '#8a6a2a'; ctx.fillRect(px + 12, 150, 4, 8);
      ctx.fillStyle = '#fff0c2'; ctx.beginPath(); ctx.arc(px + 14, 148, 4, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#1d2027'; ctx.fillRect(x0 - 5, 96, 7, 240); ctx.fillRect(x0 + SW - 2, 96, 7, 240); // торцы обделки
  }

  function drawBackground(ctx, api) {
    const { W, H, camX, hash, now } = api;
    const off = camX * P_WALL, vx = W / 2, k = VPY / (VPY - WALL_TOP);
    const i0 = Math.floor(off / RING) - 1, i1 = Math.ceil((off + W) / RING) + 1;
    const tunnel = i => blockType(Math.floor(i / BLOCK)) !== 'station';
    ctx.fillStyle = '#2a3039'; ctx.fillRect(0, WALL_TOP, W, 110);  // стена светлее у ламп, темнее к лотку
    ctx.fillStyle = '#242930'; ctx.fillRect(0, WALL_TOP + 110, W, 60);
    ctx.fillStyle = '#1d2127'; ctx.fillRect(0, WALL_TOP + 170, W, H);

    // свод: кольца в перспективе — стыки расходятся от стены к зрителю
    for (let i = i0; i < i1; i++) {
      const xa = i * RING - off, xb = xa + RING + 0.5;
      ctx.fillStyle = tunnel(i) ? (i & 1 ? '#1a1e25' : '#15181e') : (i & 1 ? '#2b241f' : '#251f1a');
      ctx.beginPath(); ctx.moveTo(xa, WALL_TOP); ctx.lineTo(xb, WALL_TOP); ctx.lineTo(vx + (xb - vx) * k, 0); ctx.lineTo(vx + (xa - vx) * k, 0); ctx.fill();
    }
    ctx.strokeStyle = '#090a0d'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = i0; i < i1; i++) { const xa = i * RING - off; ctx.moveTo(xa, WALL_TOP); ctx.lineTo(vx + (xa - vx) * k, 0); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 72, W, 1.5); ctx.fillRect(0, 44, W, 2); // продольные швы свода
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0, WALL_TOP - 5, W, 5);

    // стена: тюбинги — кольца со ступенчатыми швами сегментов и болтовыми карманами
    ctx.fillStyle = 'rgba(255,255,255,.03)';
    for (let i = i0; i < i1; i++) if (tunnel(i) && (i & 1)) ctx.fillRect(i * RING - off, WALL_TOP, RING, H);
    ctx.fillStyle = '#14171b';
    for (let i = i0; i < i1; i++) {
      if (!tunnel(i)) continue;
      const x = i * RING - off, y1 = 162 + (i & 1) * 24, y2 = 244 - (i & 1) * 16;
      ctx.fillRect(x - 1, WALL_TOP, 2.5, H); ctx.fillRect(x, y1, RING, 1.5); ctx.fillRect(x, y2, RING, 1.5);
    }
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    for (let i = i0; i < i1; i++) {
      if (!tunnel(i)) continue;
      const x = i * RING - off, y1 = 162 + (i & 1) * 24, y2 = 244 - (i & 1) * 16;
      ctx.fillRect(x + 1.5, WALL_TOP, 1, H); ctx.fillRect(x, y1 + 1.5, RING, 1); ctx.fillRect(x, y2 + 1.5, RING, 1);
    }
    ctx.fillStyle = '#181b20';
    for (let i = i0; i < i1; i++) {
      if (!tunnel(i)) continue;
      const x = i * RING - off, y1 = 162 + (i & 1) * 24;
      for (const by of [118, 208, 276]) { ctx.fillRect(x - 7, by, 3, 6); ctx.fillRect(x + 4, by, 3, 6); }
      ctx.fillRect(x + 16, y1 - 7, 4, 5); ctx.fillRect(x + 38, y1 - 7, 4, 5); ctx.fillRect(x + 27, 138, 3, 3);
    }

    // кабельные лотки, провисший кабель и трубопровод — только в тоннеле (над сбойкой трубы нет)
    const nearPortal = i => { const j = ((i % BLOCK) + BLOCK) % BLOCK; return blockType(Math.floor(i / BLOCK)) === 'portal' && j >= 1 && j <= 4; };
    for (let i = i0; i < i1; i++) {
      if (!tunnel(i)) continue;
      const x = i * RING - off;
      ctx.fillStyle = '#0f1114'; ctx.fillRect(x, 127, RING, 4); ctx.fillRect(x, 142, RING, 3);
      ctx.fillStyle = '#8a2c22'; ctx.fillRect(x, 128, RING, 1.5);
      ctx.fillStyle = '#5f6975'; ctx.fillRect(x, 131, RING, 2); ctx.fillRect(x, 145, RING, 2); ctx.fillRect(x + 3, 124, 2, 25);
      if (nearPortal(i)) continue;
      ctx.fillStyle = '#3e4751'; ctx.fillRect(x, 212, RING, 7);
      ctx.fillStyle = '#56616e'; ctx.fillRect(x, 212, RING, 2); ctx.fillRect(x + 1, 209, 4, 13);
    }
    ctx.strokeStyle = '#0c0d10'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = i0; i < i1; i++) {
      if (!tunnel(i) || nearPortal(i)) continue;
      const x = i * RING - off; ctx.moveTo(x + 4, 150); ctx.quadraticCurveTo(x + RING / 2 + 4, 170, x + RING + 4, 150);
    }
    ctx.stroke();

    // сбойки и участки станции
    for (let b = Math.floor(i0 / BLOCK); b <= Math.floor(i1 / BLOCK); b++) {
      const x0 = b * SW - off, t = blockType(b);
      if (t === 'station') drawStation(ctx, api, x0, b);
      else if (t === 'portal') drawPortal(ctx, api, x0 + 2.5 * RING + 28, 212, 50);
    }

    // капель со свода
    ctx.fillStyle = 'rgba(170,215,255,.7)';
    for (let i = i0; i < i1; i++) {
      const h = hash(i * 13 + 5);
      if (h < 0.72 || !tunnel(i)) continue;
      const ph = (now * 0.75 + h * 9) % 1.6, x = i * RING - off + 10 + h * 30;
      if (ph < 1) ctx.fillRect(x, WALL_TOP + 4 + ph * ph * 210, 1.5, 4); else ctx.fillRect(x, WALL_TOP + 1, 2, (ph - 1) * 5);
    }

    // лампы через каждые 200: пятно света, конус в пыльном воздухе, пылинки; некоторые лампы мигают
    const L = 200;
    for (let n = Math.floor((off - 90) / L); n * L - off < W + 90; n++) {
      const lx = n * L - off + 30;
      if (!tunnel(Math.floor((n * L + 30) / RING))) continue;
      const bad = hash(n * 7 + 1) > 0.85, on = !bad || Math.sin(now * 29 + n) > 0.1 || hash(Math.floor(now * 9) + n) > 0.4, a = on ? 1 : 0.25;
      glow(ctx, LAMP, lx, 118, 120, 92, 1.5 * a);
      ctx.fillStyle = LAMP; ctx.globalAlpha = 0.06 * a; ctx.beginPath(); // конус света до пути
      ctx.moveTo(lx - 7, 117); ctx.lineTo(lx + 7, 117); ctx.lineTo(lx + 80, 310); ctx.lineTo(lx - 80, 310); ctx.fill();
      ctx.beginPath(); ctx.moveTo(lx - 5, 117); ctx.lineTo(lx + 5, 117); ctx.lineTo(lx + 40, 310); ctx.lineTo(lx - 40, 310); ctx.fill();
      ctx.globalAlpha = 0.55 * a; ctx.fillStyle = '#ffe2b0';
      for (let q = 0; q < 5; q++) { const t = (now * 0.06 + hash(n * 5 + q)) % 1; ctx.fillRect(lx + Math.sin(now * 0.7 + q * 2.3 + n) * 12 + (hash(n * 9 + q) - 0.5) * 60 * t, 125 + t * 170, 1.5, 1.5); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#23272d'; ctx.fillRect(lx - 8, 106, 16, 5);
      ctx.fillStyle = on ? '#fff3cf' : '#6d6150'; ctx.fillRect(lx - 6, 111, 12, 6);
      ctx.fillStyle = '#23272d'; ctx.fillRect(lx - 3, 111, 1, 6); ctx.fillRect(lx + 2, 111, 1, 6);
    }

    // ближний план: жёлтый вентиляционный рукав под сводом (в нём «бежит» воздух)
    const o2 = camX * 0.8, D = 170, a = Math.floor(o2 / D) - 1, bN = Math.ceil((o2 + W) / D) + 1;
    const sag = (y0, amp) => { ctx.moveTo(a * D - o2, y0); for (let n = a; n < bN; n++) ctx.quadraticCurveTo((n + 0.5) * D - o2, y0 + amp, (n + 1) * D - o2, y0); };
    ctx.fillStyle = '#8f6419'; ctx.beginPath(); sag(38, 10); ctx.lineTo(bN * D - o2, 60);
    for (let n = bN - 1; n >= a; n--) ctx.quadraticCurveTo((n + 0.5) * D - o2, 70, n * D - o2, 60);
    ctx.fill();
    ctx.strokeStyle = '#c99a36'; ctx.lineWidth = 3; ctx.beginPath(); sag(41, 10); ctx.stroke();
    ctx.strokeStyle = '#654510'; ctx.lineWidth = 1.5; ctx.beginPath();
    const ph = (now * 16) % 9;
    for (let x = (a * D - o2) + ph; x < W + 9; x += 9) {
      const tt = (((x + o2) % D) + D) % D / D, y0 = 38 + 20 * tt * (1 - tt);
      if (x > -9) { ctx.moveTo(x, y0 + 5); ctx.lineTo(x, y0 + 21); }
    }
    ctx.stroke();
    ctx.fillStyle = '#0c0d10';
    for (let n = a; n <= bN; n++) { const x = n * D - o2; ctx.fillRect(x - 1, 0, 2, 38); ctx.fillStyle = '#3a3f46'; ctx.fillRect(x - 2.5, 36, 5, 26); ctx.fillStyle = '#0c0d10'; }
  }

  // ---------- земля, провалы, платформы, препятствия ----------
  function edgeOf(s, api) { // торец виден, если сосед ниже или рядом провал
    let e = edges.get(s);
    if (!e) {
      const l = api.groundAt(s.x - 1), r = api.groundAt(s.x + s.w + 1);
      e = { l: l === null || l > s.y + 1, r: r === null || r > s.y + 1 };
      edges.set(s, e);
    }
    return e;
  }

  function drawGround(s, ctx, api) { // путь: рельсы на шпалах, бетонная путевая плита, лоток тоннеля
    const { H, camX } = api, x0 = s.x - 0.5, w = s.w + 1, y = s.y, x1 = s.x + s.w;
    ctx.fillStyle = '#2a2e35'; ctx.fillRect(x0, y, w, H - y + 10);
    ctx.fillStyle = '#3b3934'; ctx.fillRect(x0, y, w, 13);                          // балласт между шпалами
    ctx.fillStyle = '#65615a'; ctx.fillRect(x0, y + 13, w, 17);                     // путевая плита
    ctx.fillStyle = '#7f7a71'; ctx.fillRect(x0, y + 13, w, 1.5);
    ctx.fillStyle = '#24272d'; ctx.fillRect(x0, y + 30, w, 3);
    ctx.fillStyle = '#1e2126';
    for (let x = Math.ceil(s.x / 112) * 112; x < x1; x += 112) { ctx.fillRect(x, y + 14, 1.5, 16); ctx.fillRect(x + 40, y + 33, 2, H - y); } // швы плиты и лотка
    for (let x = Math.ceil(s.x / 24) * 24; x < x1 - 10; x += 24) { // шпалы
      ctx.fillStyle = '#8c867c'; ctx.fillRect(x, y + 3, 14, 6);
      ctx.fillStyle = '#a7a196'; ctx.fillRect(x, y + 3, 14, 1);
      ctx.fillStyle = '#26282c'; ctx.fillRect(x + 2, y + 11, 3, 2); ctx.fillRect(x + 9, y + 11, 3, 2); // скрепления
    }
    ctx.fillStyle = '#737b84'; ctx.fillRect(x0, y, w, 2.5);                         // дальний рельс
    ctx.fillStyle = '#b3bac1'; ctx.fillRect(x0, y, w, 1);
    ctx.fillStyle = '#98a0a8'; ctx.fillRect(x0, y + 7, w, 3);                       // ближний рельс
    ctx.fillStyle = '#e2e7eb'; ctx.fillRect(x0, y + 7, w, 1);
    ctx.fillStyle = '#50565d'; ctx.fillRect(x0, y + 10, w, 2); ctx.fillRect(x0, y + 12, w, 1.5);
    // блики ламп на рельсах: там, где над путём висит лампа
    const base = 30 + camX * (1 - P_WALL);
    ctx.save(); ctx.beginPath(); ctx.rect(s.x, y - 1, s.w, 16); ctx.clip(); // не выливаться за край отрезка
    for (let n = Math.ceil((s.x - base - 60) / 200); n * 200 + base - 60 < x1; n++) {
      const gx = n * 200 + base;
      ctx.fillStyle = LAMP; ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.ellipse(gx, y + 8, 60, 9, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,222,160,.75)'; ctx.fillRect(gx - 22, y + 7, 44, 1); ctx.fillRect(gx - 10, y, 20, 1);
    }
    ctx.restore();
    const e = edgeOf(s, api);
    ctx.fillStyle = '#1a1c20';
    if (e.l) { ctx.fillRect(s.x, y, 3, H - y); ctx.fillStyle = '#b3bac1'; ctx.fillRect(s.x, y + 7, 2, 4); ctx.fillStyle = '#1a1c20'; }
    if (e.r) { ctx.fillRect(x1 - 3, y, 3, H - y); ctx.fillStyle = '#b3bac1'; ctx.fillRect(x1 - 2, y + 7, 2, 4); }
  }

  function drawPit(p, ctx, api) { // провал в нижний тоннель: темнота, далёкий путь, ограждение с фонарём
    const { H, now } = api, x = p.x, y = p.y, w = p.w, ly = Math.min(y + 80, H - 18);
    ctx.fillStyle = '#060709'; ctx.fillRect(x, y, w, H - y);
    ctx.fillStyle = '#12151a'; for (let rx = x + 8; rx < x + w - 4; rx += 18) ctx.fillRect(rx, y + 22, 2, ly - y - 22); // кольца нижнего тоннеля
    glow(ctx, LAMP, x + w / 2, ly - 8, w * 0.6, 26, 0.8);
    ctx.fillStyle = '#3e434a'; ctx.fillRect(x, ly, w, 1.5); ctx.fillRect(x, ly + 5, w, 2);
    ctx.fillStyle = '#2a2b2c'; for (let sx = x + 3; sx < x + w - 4; sx += 11) ctx.fillRect(sx, ly + 2, 6, 3);
    const ry = api.groundAt(x + w + 2) ?? y;
    ctx.strokeStyle = '#98a0a8'; ctx.lineWidth = 2.5; ctx.beginPath(); // оборванные рельсы свисают в провал
    ctx.moveTo(x - 1, y + 8); ctx.quadraticCurveTo(x + 7, y + 8, x + 9, y + 18);
    ctx.moveTo(x + w + 1, ry + 8); ctx.quadraticCurveTo(x + w - 6, ry + 8, x + w - 8, ry + 17); ctx.stroke();
    ctx.strokeStyle = '#8a4a2a'; ctx.lineWidth = 1.5; ctx.beginPath(); // арматура из плиты
    ctx.moveTo(x, y + 20); ctx.lineTo(x + 8, y + 23); ctx.moveTo(x, y + 26); ctx.lineTo(x + 6, y + 31);
    ctx.moveTo(x + w, ry + 21); ctx.lineTo(x + w - 7, ry + 25); ctx.stroke();
    const bx = x - 30; // красно-белый барьер и мигающий фонарь
    ctx.fillStyle = '#ddd'; ctx.fillRect(bx + 1, y - 18, 2, 18); ctx.fillRect(bx + 19, y - 18, 2, 18);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#f4f4f4' : '#e53935'; ctx.fillRect(bx - 1 + i * 5, y - 21, 5, 7); }
    const on = Math.sin(now * 7 + x) > 0;
    if (on) glow(ctx, RED, bx + 11, y - 25, 18, 18, 2);
    ctx.fillStyle = on ? '#ff4a3a' : '#5a1512'; ctx.fillRect(bx + 8, y - 28, 6, 6);
  }

  function drawPlatform(p, ctx) { // служебный мостик: решётчатый настил на кронштейнах, жёлтые перила
    const x = p.x, y = p.y, w = p.w, n = Math.max(2, Math.round(w / 70));
    for (let i = 0; i <= n; i++) {
      const bx = x + 6 + i * (w - 12) / n;
      ctx.fillStyle = '#23282f'; ctx.fillRect(bx - 1.5, y + 6, 3, p.base - y - 6);   // стойка
      ctx.strokeStyle = '#5b6570'; ctx.lineWidth = 3; ctx.beginPath();               // кронштейн-подкос
      ctx.moveTo(bx, y + 26); ctx.lineTo(bx + (i < n ? 18 : -18), y + 7); ctx.stroke();
      ctx.fillStyle = '#5b6570'; ctx.fillRect(bx - 4, y + 6, 8, 5);
    }
    ctx.fillStyle = '#3d4650'; ctx.fillRect(x - 4, y, w + 8, 7);
    ctx.fillStyle = '#171a1f'; for (let gx = x - 2; gx < x + w + 3; gx += 4) ctx.fillRect(gx, y + 2, 2, 3); // решётка
    ctx.fillStyle = '#a3afbb'; ctx.fillRect(x - 4, y, w + 8, 1.5);
    ctx.fillStyle = '#e0b030';
    for (let px = x - 3; px < x + w + 4; px += Math.max(24, (w + 6) / Math.round((w + 6) / 30))) ctx.fillRect(px, y - 16, 2.5, 16);
    ctx.fillRect(x - 4, y - 17, w + 8, 2.5); ctx.fillRect(x - 4, y - 9, w + 8, 1.5);
    ctx.fillStyle = '#1b1b1b'; for (let px = x; px < x + w; px += 16) ctx.fillRect(px, y - 17, 6, 2.5); // чёрно-жёлтая разметка перил
  }

  function drawDrum(ctx, x, y, w, h) { // кабельный барабан: деревянные щёки и намотанный кабель
    ctx.fillStyle = '#16181c'; ctx.fillRect(x + 5, y + 3, w - 10, h - 6);
    ctx.strokeStyle = '#3c424b'; ctx.lineWidth = 1; ctx.beginPath();
    for (let cx = x + 7; cx < x + w - 7; cx += 4) { ctx.moveTo(cx, y + 3); ctx.lineTo(cx + 3, y + h - 3); }
    ctx.stroke();
    ctx.fillStyle = '#e53935'; ctx.fillRect(x + w / 2 - 5, y + h / 2 - 3, 10, 6); // бирка
    for (const fx of [x + 4, x + w - 4]) {
      ctx.fillStyle = '#9a6a3a'; ctx.beginPath(); ctx.ellipse(fx, y + h / 2, 4.5, h / 2, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#6e4a26'; ctx.beginPath(); ctx.ellipse(fx, y + h / 2, 2, h / 5, 0, 0, 7); ctx.fill();
    }
  }

  function drawObstacle(s, ctx) { // штабель шпал; иногда сверху — кабельный барабан
    const drum = s.v > 0.5;
    if (drum && s.stack === 1) { drawDrum(ctx, s.x, s.y, s.w, s.h); return; }
    const top = drum ? s.y + 30 : s.y;
    for (let y = top; y < s.y + s.h - 1; y += 10) {
      ctx.fillStyle = '#8f897f'; ctx.fillRect(s.x, y, s.w, 8);
      ctx.fillStyle = '#aaa399'; ctx.fillRect(s.x, y, s.w, 1.5);
      ctx.fillStyle = '#6c675f'; ctx.fillRect(s.x, y, 4, 8); ctx.fillRect(s.x + s.w - 4, y, 4, 8);
      ctx.fillStyle = '#3a3733'; ctx.fillRect(s.x + 9, y + 2, 5, 2); ctx.fillRect(s.x + s.w - 14, y + 2, 5, 2);
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(s.x + 6, y + 8, 7, 2); ctx.fillRect(s.x + s.w - 13, y + 8, 7, 2); // прокладки
    }
    if (drum) drawDrum(ctx, s.x, s.y, s.w, 30);
  }

  function drawDecor(d, ctx, api) {
    const x = d.x, y = d.y, now = api.now;
    if (d.kind === 'signal') { // путевой светофор
      ctx.fillStyle = '#50565e'; ctx.fillRect(x - 1.5, y - 34, 3, 34); ctx.fillRect(x - 6, y - 2, 12, 2);
      ctx.fillStyle = '#15171a'; ctx.fillRect(x - 6, y - 62, 12, 29);
      const lit = d.v < 0.45 ? 0 : d.v < 0.75 ? 1 : 2, col = ['#ff3b30', '#ffc233', '#3ddc84'][lit];
      const on = lit !== 1 || Math.sin(now * 6) > -0.2; // жёлтый мигает
      for (let k = 0; k < 3; k++) { ctx.fillStyle = k === lit && on ? col : '#2e3136'; ctx.beginPath(); ctx.arc(x, y - 55 + k * 9, 3, 0, 7); ctx.fill(); }
      if (on) { ctx.fillStyle = col; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y - 55 + lit * 9, 8, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    } else if (d.kind === 'exit') { // указатель «Выход»
      ctx.fillStyle = '#50565e'; ctx.fillRect(x - 1, y - 40, 2, 40);
      ctx.fillStyle = 'rgba(90,255,160,.18)'; ctx.fillRect(x - 27, y - 57, 54, 20);
      ctx.fillStyle = '#17864a'; ctx.fillRect(x - 24, y - 54, 48, 14);
      api.text('ВЫХОД →', x, y - 44, 8, '#f4fff8');
    } else if (d.kind === 'toolbox') { // ящик с инструментом
      ctx.fillStyle = '#c62828'; ctx.fillRect(x - 11, y - 11, 22, 11);
      ctx.fillStyle = '#8e1c1c'; ctx.fillRect(x - 11, y - 8, 22, 1.5);
      ctx.fillStyle = '#c8cdd2'; ctx.fillRect(x - 8, y - 7, 3, 2); ctx.fillRect(x + 5, y - 7, 3, 2);
      ctx.strokeStyle = '#26282c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 5, y - 11); ctx.lineTo(x - 4, y - 15); ctx.lineTo(x + 4, y - 15); ctx.lineTo(x + 5, y - 11); ctx.stroke();
    } else if (d.kind === 'barrel') { // бочка с маслом
      ctx.fillStyle = '#d9772b'; ctx.fillRect(x - 8, y - 22, 16, 22);
      ctx.fillStyle = '#a8561a'; ctx.fillRect(x - 8, y - 16, 16, 2); ctx.fillRect(x - 8, y - 7, 16, 2); ctx.fillRect(x + 4, y - 22, 3, 22);
      ctx.fillStyle = '#f1efe8'; ctx.fillRect(x - 5, y - 13, 7, 5);
    } else if (d.kind === 'phone') { // аварийный телефон тоннеля
      ctx.fillStyle = '#50565e'; ctx.fillRect(x - 1, y - 26, 2, 26);
      ctx.fillStyle = '#f0c419'; ctx.fillRect(x - 7, y - 44, 14, 18);
      ctx.fillStyle = '#1b1d20'; ctx.fillRect(x - 4, y - 40, 3, 10); ctx.fillRect(x - 4, y - 40, 6, 2); ctx.fillRect(x - 4, y - 32, 6, 2);
      ctx.fillStyle = '#1b1d20'; for (let k = 0; k < 3; k++) ctx.fillRect(x + 3, y - 40 + k * 3, 2, 2);
      const on = Math.sin(now * 4 + x) > 0.3;
      ctx.fillStyle = on ? '#ff4a3a' : '#6a1a14'; ctx.fillRect(x - 2, y - 48, 4, 4);
      api.text('SOS', x, y - 20, 6, '#f0c419');
    } else if (d.kind === 'coil') { // бухта кабеля
      ctx.strokeStyle = '#15171a'; ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(x + k * 2 - 2, y - 5, 11 - k * 2, 4.5, 0, 0, 7); ctx.stroke(); }
      ctx.strokeStyle = '#8a2c22'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 9, y - 4); ctx.quadraticCurveTo(x + 18, y - 2, x + 22, y); ctx.stroke();
    }
  }

  function drawFinish(fx, gy, ctx, api) { // вход на будущую станцию: мраморный портал, арка с эскалатором, красная «М»
    const x = fx + 140, y = api.groundAt(fx + 150) ?? gy, w = 240, cx = x + w / 2, now = api.now;
    ctx.fillStyle = '#c9bcab'; ctx.fillRect(x, y - 140, w, 140);
    ctx.fillStyle = '#ddd2c4'; ctx.fillRect(x, y - 140, 6, 140); ctx.fillRect(x + w - 60, y - 140, 4, 140);
    ctx.strokeStyle = 'rgba(140,122,104,.4)'; ctx.lineWidth = 1; ctx.beginPath(); // мягкие прожилки мрамора
    for (let v = 0; v < 6; v++) { const vx = x + 14 + v * 42; ctx.moveTo(vx, y - 132); ctx.quadraticCurveTo(vx + 26, y - 104, vx + 10, y - 76); ctx.moveTo(vx + 20, y - 60); ctx.quadraticCurveTo(vx + 4, y - 40, vx + 16, y - 16); }
    ctx.stroke();
    ctx.fillStyle = '#5b2a26'; ctx.fillRect(x - 8, y - 148, w + 16, 9); ctx.fillRect(x - 4, y - 12, w + 8, 12); // карниз и цоколь
    ctx.fillStyle = '#c9a44a'; ctx.fillRect(x - 8, y - 140, w + 16, 2);
    const sy = y - 62, r = 48;
    ctx.fillStyle = '#9d8e7c'; archPath(ctx, cx, sy, r + 6, y); ctx.fill();
    ctx.fillStyle = '#1b1512'; archPath(ctx, cx, sy, r, y); ctx.fill();
    ctx.save(); archPath(ctx, cx, sy, r, y); ctx.clip(); // внутри: тёплый свет и эскалатор вниз
    glow(ctx, LAMP, cx, y - 44, 110, 80, 1.5);
    ctx.fillStyle = '#3a2d24'; ctx.beginPath(); ctx.moveTo(cx - 60, y - 40); ctx.lineTo(cx + 60, y + 10); ctx.lineTo(cx + 60, y + 40); ctx.lineTo(cx - 60, y - 10); ctx.fill();
    ctx.strokeStyle = '#6b5a45'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 60, y - 46); ctx.lineTo(cx + 60, y + 4); ctx.stroke();
    ctx.strokeStyle = '#2a211b'; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k < 12; k++) { const sx = cx - 56 + k * 10; ctx.moveTo(sx, y - 38 + k * 4.2); ctx.lineTo(sx, y - 30 + k * 4.2); }
    ctx.stroke();
    for (let k = 0; k < 5; k++) { // лампы-«факелы» на балюстраде
      const lx = cx - 50 + k * 24, lyy = y - 50 + k * 10;
      ctx.fillStyle = '#6b5a45'; ctx.fillRect(lx - 0.5, lyy, 1, 5);
      ctx.fillStyle = '#fff0c2'; ctx.beginPath(); ctx.ellipse(lx, lyy - 2, 2, 3.5, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
    for (const lx of [cx - 88, cx + 88]) { // бра по сторонам арки
      glow(ctx, LAMP, lx, y - 92, 36, 30, 1.8);
      ctx.fillStyle = '#8a6a2a'; ctx.fillRect(lx - 1.5, y - 90, 3, 12);
      ctx.fillStyle = '#fff0c2'; ctx.beginPath(); ctx.arc(lx, y - 93, 5, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#1d2a3a'; ctx.fillRect(cx - 52, y - 134, 104, 16); // табличка
    ctx.fillStyle = '#c9a44a'; ctx.fillRect(cx - 52, y - 134, 104, 1); ctx.fillRect(cx - 52, y - 119, 104, 1);
    api.text('СТАНЦИЯ', cx, y - 122, 11, '#f4efe6');
    // большая красная «М» на карнизе
    glow(ctx, RED, cx, y - 168, 62, 44, 1.6 + Math.sin(now * 2.5) * 0.4);
    ctx.fillStyle = '#3a3f46'; ctx.fillRect(cx - 3, y - 152, 6, 5);
    ctx.save(); ctx.translate(cx - 22, y - 151);
    ctx.fillStyle = '#e53935'; ctx.beginPath();
    for (const [px, py] of [[0, 0], [9, -36], [17, -36], [22, -20], [27, -36], [35, -36], [44, 0], [36, 0], [31, -21], [26, -8], [18, -8], [13, -21], [8, 0]]) ctx.lineTo(px, py);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(9, -35, 8, 2); ctx.fillRect(27, -35, 8, 2);
    ctx.restore();
  }

  // ---------- враги ----------
  // ударная волна проходчика ползёт по поверхности и гаснет у края, у стенки или над провалом
  function surfaceOk(api, x, y) {
    let under = false;
    for (const s of api.solids) {
      if (x < s.x || x > s.x + s.w) continue;
      if (s.y < y - 3) return false;
      if (Math.abs(s.y - y) <= 3) under = true;
    }
    if (!under) for (const p of api.platforms) if (x >= p.x && x <= p.x + p.w && Math.abs(p.y - y) <= 3) return true;
    return under;
  }
  function waveUpdate(p, dt, api) {
    const lead = p.vx > 0 ? p.x + p.w - 2 : p.x + 2;
    if (!surfaceOk(api, lead, p.baseY)) { p.dead = true; p.hurts = false; api.burst(lead, p.baseY - 4, '#cbbd9f', 8, 120, 500); return; }
    p.dustT -= dt;
    if (p.dustT <= 0) { p.dustT = 0.07; api.burst(p.x + p.w / 2 - Math.sign(p.vx) * 8, p.baseY - 3, '#b9ab90', 1, 60, 300); }
  }
  function drawWave(p, ctx, api) { // гребень из осколков бетона над раскалённой трещиной (центр снаряда — 0,0; низ — y = 6)
    const t = api.now * 28;
    ctx.scale(Math.sign(p.vx) || 1, 1);
    glow(ctx, '#ff8a2a', 2, 4, 22, 9, 2.2);
    ctx.fillStyle = 'rgba(232,214,178,.5)'; ctx.beginPath(); ctx.ellipse(-12, 2, 14, 6, 0, 0, 7); ctx.fill(); // пыльный шлейф
    ctx.fillStyle = '#ff9a3c'; // остывающая трещина за волной
    for (let k = 0; k < 3; k++) { ctx.globalAlpha = 0.6 - k * 0.2; ctx.fillRect(-38 - k * 18, 5, 18, 1.5); }
    ctx.globalAlpha = 1; ctx.fillStyle = '#ffb347'; ctx.fillRect(-20, 4.5, 32, 2);
    ctx.fillStyle = '#fff0c0'; ctx.fillRect(-4, 5, 14, 1);
    ctx.fillStyle = '#dccdb2'; ctx.strokeStyle = '#4a3f33'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(-13, 6); ctx.lineTo(-9, -1 - Math.sin(t) * 2); ctx.lineTo(-4, 6);
    ctx.moveTo(-5, 6); ctx.lineTo(1, -8 - Math.sin(t + 2) * 2); ctx.lineTo(7, 6);
    ctx.moveTo(5, 6); ctx.lineTo(10, -3 - Math.sin(t + 4) * 2); ctx.lineTo(14, 6);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#ffe7b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(8, 6, 11, -1.4, -0.15); ctx.stroke(); // фронт волны
  }

  const WIND = 0.8; // замах проходчика, с
  const enemies = {
    trolley: { // мотодрезина: носится по своему пути; перед разворотом тормозит (искры) и звонит в колокол
      w: 54, h: 34, hp: 2, pts: 200, heavy: true, hitColor: '#ffd76a', deathColor: '#f2b705',
      init(e) {
        const c = e.x + e.w / 2;
        e.hi = Math.min(e.maxX, Math.max(e.minX, c - 110) + 220 + e.w); e.lo = Math.max(e.minX, e.hi - 220 - e.w);
        e.state = 'run'; e.v = 0; e.st = 0; e.rot = 0; e.sparkT = 0;
      },
      update(e, dt, api) {
        const DEC = 420;
        e.st -= dt;
        if (e.state === 'ring') { if (e.st <= 0) { e.dir = -e.dir; e.state = 'run'; } return; }
        const ahead = e.dir > 0 ? e.hi - (e.x + e.w) : e.x - e.lo;
        if (e.state === 'run' && ahead <= e.v * e.v / (2 * DEC) + 2) e.state = 'brake';
        if (e.state === 'brake') {
          e.v = Math.max(0, e.v - DEC * dt); e.sparkT -= dt;
          if (e.sparkT <= 0 && e.v > 30) { e.sparkT = 0.05; api.burst(e.x + e.w / 2 + e.dir * 15, e.y + e.h - 2, '#ffb347', 2, 120, 500); }
          if (e.v <= 0 || ahead <= 0) { e.v = 0; e.state = 'ring'; e.st = 0.9; }
        } else e.v = Math.min(165, e.v + 260 * dt);
        e.x = api.clamp(e.x + e.dir * e.v * dt, e.lo, e.hi - e.w);
        e.rot += e.v * dt / 6;
      },
      draw(e, ctx) {
        const moving = e.state !== 'ring', ring = e.state === 'ring', bob = moving ? Math.sin(e.t * 30) * 0.5 : 0;
        if (moving) { // луч фары и пятно света на рельсах
          ctx.fillStyle = 'rgba(255,236,160,.16)'; ctx.beginPath(); ctx.moveTo(27, -22); ctx.lineTo(125, -36); ctx.lineTo(125, 0); ctx.lineTo(27, -15); ctx.fill();
          ctx.fillStyle = 'rgba(255,240,190,.35)'; ctx.fillRect(40, -2, 80, 2);
        }
        ctx.fillStyle = '#16171a';
        for (const wx of [-15, 15]) { ctx.beginPath(); ctx.arc(wx, -6, 6.5, 0, 7); ctx.fill(); }
        ctx.strokeStyle = '#8b9096'; ctx.lineWidth = 1.5; ctx.beginPath();
        for (const wx of [-15, 15]) { ctx.moveTo(wx - Math.cos(e.rot) * 4, -6 - Math.sin(e.rot) * 4); ctx.lineTo(wx + Math.cos(e.rot) * 4, -6 + Math.sin(e.rot) * 4); }
        ctx.stroke();
        ctx.translate(0, bob);
        ctx.fillStyle = '#30343a'; ctx.fillRect(-27, -16, 54, 6);                            // рама
        ctx.fillStyle = '#f2b705'; ctx.fillRect(18, -16, 9, 6);
        ctx.fillStyle = '#1b1b1b'; ctx.fillRect(20, -16, 2, 6); ctx.fillRect(24, -16, 2, 6); // «зебра» на отбойнике
        ctx.fillStyle = '#e53935'; ctx.fillRect(-29, -15, 3, 5);
        ctx.fillStyle = '#7a5a34'; ctx.fillRect(1, -19, 25, 3);                              // платформа с рельсами
        ctx.fillStyle = '#8c939a'; ctx.fillRect(3, -22, 21, 2); ctx.fillRect(5, -24, 17, 2);
        ctx.fillStyle = '#f2b705'; ctx.fillRect(-25, -34, 25, 18);                           // кабина
        ctx.fillStyle = '#c78f00'; ctx.fillRect(-27, -36, 29, 3); ctx.fillRect(-25, -20, 25, 2);
        ctx.fillStyle = '#ffe7a3'; ctx.fillRect(-21, -31, 11, 8); ctx.fillStyle = '#fff4cf'; ctx.fillRect(-7, -31, 5, 8);
        ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.arc(-15, -25, 3, Math.PI, 0); ctx.fill(); // машинист
        const beacon = Math.sin(e.t * 12) > 0;
        ctx.fillStyle = beacon ? '#ff3b30' : '#6d1a14'; ctx.fillRect(-21, -40, 5, 4);        // маячок
        ctx.fillStyle = moving ? '#fffbe0' : '#8a826a'; ctx.beginPath(); ctx.arc(26, -19, 3.5, 0, 7); ctx.fill(); // фара
        ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.moveTo(20, -26); ctx.lineTo(30, -23); ctx.lineTo(30, -21); ctx.lineTo(20, -24); ctx.fill(); // «бровь»
        ctx.fillStyle = '#50565e'; ctx.fillRect(-9, -42, 2, 7); ctx.fillRect(-9, -42, 6, 2);   // колокол
        ctx.save(); ctx.translate(-4, -40); ctx.rotate(ring ? Math.sin(e.t * 32) * 0.6 : 0);
        ctx.fillStyle = '#e0b040'; ctx.beginPath(); ctx.moveTo(-3.5, 6); ctx.quadraticCurveTo(-3.5, 0, 0, 0); ctx.quadraticCurveTo(3.5, 0, 3.5, 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8a6a20'; ctx.fillRect(-1, 6, 2, 2);
        ctx.restore();
        if (ring) { // звон — расходящиеся дуги
          const ph = (e.t * 3) % 1;
          ctx.strokeStyle = `rgba(255,230,120,${1 - ph})`; ctx.lineWidth = 2; ctx.beginPath();
          for (const r0 of [6, 12]) { const r = r0 + ph * 8; ctx.moveTo(-4 + Math.cos(-0.7) * r, -37 + Math.sin(-0.7) * r); ctx.arc(-4, -37, r, -0.7, 0.7); ctx.moveTo(-4 + Math.cos(2.44) * r, -37 + Math.sin(2.44) * r); ctx.arc(-4, -37, r, 2.44, 3.84); }
          ctx.stroke();
        }
        if (e.hp < e.maxHp) { // подбита: дымит
          for (let k = 0; k < 3; k++) { const q = (e.t * 0.9 + k / 3) % 1; ctx.fillStyle = `rgba(90,90,95,${0.55 * (1 - q)})`; ctx.beginPath(); ctx.arc(-14 - q * 8, -38 - q * 18, 2 + q * 4, 0, 7); ctx.fill(); }
        }
      },
    },
    bat: { // летучая мышь: порхает по синусоиде; перед броском визжит (0,85 с) и пикирует дугой через героя
      w: 30, h: 18, hp: 1, pts: 100, hitColor: '#e0c0ff', deathColor: '#9a78a0',
      init(e) { e.homeX = e.x; e.baseY = e.y; e.state = 'fly'; e.ft = Math.random() * 6; e.st = 0; },
      update(e, dt, api) {
        const P = api.player, pcx = P.x + P.w / 2, pcy = P.y + P.h / 2, cx = e.x + e.w / 2;
        const home = () => [e.homeX + Math.sin(e.ft * 1.2) * 56, e.baseY + Math.sin(e.ft * 3.3) * 11];
        if (e.state === 'fly') {
          e.ft += dt;
          const [hx, hy] = home();
          e.dir = hx >= e.x ? 1 : -1; e.x = hx; e.y = hy;
          e.cd -= dt;
          if (e.cd <= 0 && Math.abs(pcx - cx) < 230 && pcy > e.y + 20) { e.state = 'screech'; e.st = 0.85; }
        } else if (e.state === 'screech') {
          e.st -= dt; e.dir = pcx >= cx ? 1 : -1; e.y -= 10 * dt;
          if (e.st <= 0) { // запоминаем точку и летим дугой: через неё и вверх на другую сторону
            const tx = pcx + P.vx * 0.3 - e.w / 2, ty = Math.min(pcy - e.h / 2, e.groundY - e.h - 2); // с упреждением на бег героя
            e.p = [e.x, e.y, tx, 2 * ty - e.y, 2 * tx - e.x, e.y];
            e.sd = api.clamp(Math.hypot(tx - e.x, ty - e.y) / 140, 0.9, 1.5); e.s = 0; e.state = 'swoop';
          }
        } else if (e.state === 'swoop') {
          e.s = Math.min(1, e.s + dt / e.sd);
          const s = e.s, a = (1 - s) * (1 - s), b = 2 * s * (1 - s), c = s * s, p = e.p, nx = a * p[0] + b * p[2] + c * p[4];
          if (Math.abs(nx - e.x) > 0.01) e.dir = nx > e.x ? 1 : -1;
          e.x = nx; e.y = a * p[1] + b * p[3] + c * p[5];
          if (s >= 1) e.state = 'back';
        } else { // возвращается на свою «орбиту»
          const [hx, hy] = home(), vx = hx - e.x, vy = hy - e.y, d = Math.hypot(vx, vy);
          if (d < 5) { e.state = 'fly'; e.cd = api.rand(1.6, 2.8); }
          else { e.x += vx / d * 130 * dt; e.y += vy / d * 130 * dt; e.dir = vx >= 0 ? 1 : -1; }
        }
      },
      draw(e, ctx) {
        const scr = e.state === 'screech', fast = scr || e.state === 'swoop';
        const f = Math.sin(e.t * (fast ? 28 : 15));
        if (scr) ctx.translate(Math.sin(e.t * 90) * 1.3, 0);
        ctx.fillStyle = '#8a64a0'; ctx.strokeStyle = 'rgba(255,214,170,.75)'; ctx.lineWidth = 1;
        for (const sx of [-1, 1]) { // перепончатые крылья с фестонами
          ctx.beginPath(); ctx.moveTo(sx * 2, -11); ctx.lineTo(sx * 10, -16 - f * 7); ctx.lineTo(sx * 19, -9 - f * 9);
          ctx.lineTo(sx * 15, -6 - f * 5); ctx.lineTo(sx * 11, -8 - f * 3); ctx.lineTo(sx * 7, -5 - f); ctx.lineTo(sx * 2, -6);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(60,34,70,.8)'; ctx.beginPath(); // «пальцы» крыла
        for (const sx of [-1, 1]) { ctx.moveTo(sx * 3, -10); ctx.lineTo(sx * 15, -7 - f * 5); ctx.moveTo(sx * 3, -10); ctx.lineTo(sx * 10, -7 - f * 3); }
        ctx.stroke();
        ctx.fillStyle = '#5a3a66'; ctx.beginPath(); ctx.ellipse(0, -9, 6.5, 5.5, 0, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(6, -11, 4.5, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.moveTo(3, -13); ctx.lineTo(4, -20); ctx.lineTo(6.5, -14); ctx.moveTo(6.5, -14); ctx.lineTo(9.5, -19); ctx.lineTo(10, -12); ctx.fill(); // уши
        ctx.fillStyle = '#c9a8d8'; ctx.beginPath(); ctx.ellipse(0, -7, 3.5, 2.5, 0, 0, 7); ctx.fill(); // светлое брюшко
        ctx.fillStyle = scr ? '#ff3b30' : '#ffe14a'; ctx.fillRect(7, -12.5, scr ? 3 : 2.2, scr ? 3 : 2.2);
        if (scr) { // пасть открыта, визг — расходящиеся дуги в сторону героя
          ctx.fillStyle = '#fff'; ctx.fillRect(7.5, -9, 1, 2); ctx.fillRect(9, -9, 1, 2);
          ctx.strokeStyle = 'rgba(255,110,110,.85)'; ctx.lineWidth = 1.5; ctx.beginPath();
          for (const o of [0, 0.33, 0.66]) { const r = 5 + ((e.t * 3 + o) % 1) * 18; ctx.moveTo(10 + Math.cos(-0.7) * r, -11 + Math.sin(-0.7) * r); ctx.arc(10, -11, r, -0.7, 0.7); }
          ctx.stroke();
        }
      },
    },
    driller: { // проходчик с отбойным молотком: замах 0,8 с (дрожь, пыль), удар — по земле к герою бежит волна
      w: 24, h: 42, hp: 2, pts: 250, hitColor: '#ffb347',
      init(e) { e.state = 'idle'; e.st = 0; e.dustT = 0; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e);
        e.st -= dt;
        if (e.state === 'idle') {
          if (Math.abs(dx) > 4) e.dir = Math.sign(dx);
          e.cd -= dt;
          if (e.cd <= 0 && Math.abs(dx) < 260 && Math.abs(P.y + P.h - e.groundY) < 40) { e.state = 'wind'; e.st = WIND; } // только когда герой на его уровне
        } else if (e.state === 'wind') {
          e.dustT -= dt;
          if (e.dustT <= 0) { e.dustT = 0.1; api.burst(e.x + e.w / 2 + e.dir * 16, e.y + 4, '#cbbd9f', 2, 50, 400); }
          if (e.st <= 0) {
            e.state = 'slam'; e.st = 0.45;
            const bx = e.x + e.w / 2 + e.dir * 16;
            api.burst(bx, e.groundY - 2, '#ffb347', 10, 200, 700); api.burst(bx, e.groundY - 2, '#cbbd9f', 8, 120, 400);
            if (e.x > api.camX - 20 && e.x < api.camX + api.W + 20) api.shake(3);
            api.shoot({ x: bx + e.dir * 12, y: e.groundY - 6, w: 22, h: 12, vx: e.dir * 200, vy: 0, gravity: 0, life: 2.5, hitsSolids: false, destructible: false,
              color: '#cbbd9f', draw: drawWave, update: waveUpdate, source: e, baseY: e.groundY, dustT: 0 });
          }
        } else if (e.state === 'slam' && e.st <= 0) { e.state = 'idle'; e.cd = api.rand(1.6, 2.4); }
      },
      draw(e, ctx) {
        const wind = e.state === 'wind', slam = e.state === 'slam';
        const lift = wind ? Math.min(1, (1 - e.st / WIND) * 1.7) : 0, sh = wind ? Math.sin(e.t * 70) * 1.8 * lift : 0;
        const hx = 16 + sh, hy = -lift * 34 + (slam ? 2 : wind ? 0 : Math.sin(e.t * 60) * 0.5), ang = lift * 0.12;
        const gx = hx + Math.sin(ang) * 31, gy = hy - Math.cos(ang) * 31; // рукоять молотка
        if (wind) { // замах: вздрагивающая трещина на земле — отсюда пойдёт волна
          ctx.globalAlpha = lift * (0.55 + Math.sin(e.t * 30) * 0.45); ctx.fillStyle = '#ff9a3c';
          ctx.fillRect(hx - 2, -1.5, 34, 2); ctx.fillRect(hx + 8, -3, 3, 2); ctx.fillRect(hx + 20, -3.5, 2, 2); ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = '#141414'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(hx + 2, hy - 24); ctx.bezierCurveTo(hx + 12, hy - 8, 6, -2, -22, 0); ctx.stroke(); // шланг
        ctx.fillStyle = '#2a2622'; ctx.fillRect(-9, -4, 7, 4); ctx.fillRect(2, -4, 8, 4);                   // сапоги
        ctx.fillStyle = '#a8412a'; ctx.fillRect(-8, -19, 6, 15); ctx.fillRect(2, -19, 6, 15);               // роба
        ctx.fillRect(-10, -35, 20, 17);
        ctx.fillStyle = '#e8eef0'; ctx.fillRect(-10, -27, 20, 2.5); ctx.fillRect(-8, -12, 6, 2); ctx.fillRect(2, -12, 6, 2); // светоотражатели
        ctx.fillStyle = '#3a2a20'; ctx.fillRect(-10, -20, 20, 2);
        ctx.fillStyle = '#e0ac7c'; ctx.beginPath(); ctx.arc(1, -39, 5.5, 0, 7); ctx.fill();
        ctx.fillStyle = '#7d8288'; ctx.fillRect(2, -38, 6, 5); ctx.fillStyle = '#4a4f55'; ctx.beginPath(); ctx.arc(7, -35.5, 2, 0, 7); ctx.fill(); // респиратор
        ctx.fillStyle = '#1d2226'; ctx.fillRect(-1, -43, 8, 3); ctx.fillStyle = '#9fd3ff'; ctx.fillRect(3, -42.5, 2.5, 1.5); // очки
        ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.arc(1, -43, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -44, 16, 2); // каска
        ctx.fillStyle = '#fff6b0'; ctx.fillRect(6, -48, 3, 3);
        ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang); // отбойный молоток
        ctx.fillStyle = '#2b2f35'; ctx.fillRect(-6, -32, 12, 3);
        ctx.fillStyle = '#5d646d'; ctx.fillRect(-3, -29, 6, 17); ctx.fillStyle = '#434951'; for (let k = 0; k < 4; k++) ctx.fillRect(-3, -27 + k * 4, 6, 1.5);
        ctx.fillStyle = lift > 0.6 ? '#ff7a3d' : '#b0b6bc'; ctx.fillRect(-1, -12, 2, 12);
        ctx.restore();
        const ex = (6 + gx) / 2 - 3, ey = (-31 + gy) / 2 + (lift > 0.3 ? 2 : 4); // локоть
        ctx.strokeStyle = '#a8412a'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); // руки держат рукоять
        ctx.moveTo(4, -31); ctx.lineTo(ex, ey); ctx.lineTo(gx - 3, gy); ctx.stroke();
        ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(gx - 3, gy, 2.5, 0, 7); ctx.fill();
        if (slam && e.st > 0.3) { // вспышка удара
          ctx.strokeStyle = '#ffe2a0'; ctx.lineWidth = 2; ctx.beginPath();
          for (let k = 0; k < 5; k++) { const a = -Math.PI + 0.3 + k * 0.63; ctx.moveTo(hx + Math.cos(a) * 5, Math.sin(a) * 5); ctx.lineTo(hx + Math.cos(a) * 13, Math.sin(a) * 13); }
          ctx.stroke();
        } else if (!wind && !slam && Math.sin(e.t * 40) > 0.3) { ctx.fillStyle = 'rgba(210,198,175,.7)'; ctx.fillRect(hx - 4, -3, 3, 3); ctx.fillRect(hx + 2, -4, 2, 2); }
      },
    },
    rail: { // оголённый контактный рельс под напряжением: искрит, перепрыгнуть
      w: 58, h: 14, hp: 1, pts: 0, invulnerable: true, stompable: false, knockback: false, flip: false,
      init(e) { e.zapT = 0.4; },
      update(e, dt, api) { e.zapT -= dt; if (e.zapT <= 0) { e.zapT = api.rand(0.25, 0.8); api.burst(e.x + api.rand(6, e.w - 6), e.y + 3, '#9fe8ff', 5, 130, 500); } },
      draw(e, ctx, api) {
        glow(ctx, '#6fd8ff', 0, -8, 40, 16, 1.2 + Math.sin(e.t * 11) * 0.4);
        for (const x of [-22, 0, 22]) { ctx.fillStyle = '#2c3036'; ctx.fillRect(x - 4, -4, 8, 4); ctx.fillStyle = '#e6dfc9'; ctx.fillRect(x - 2.5, -8, 5, 4); ctx.fillStyle = '#a89f86'; ctx.fillRect(x - 2.5, -6, 5, 1); } // изоляторы
        ctx.fillStyle = '#b8c0c8'; ctx.fillRect(-29, -10, 58, 3);                                   // рельс
        ctx.fillStyle = '#f0c419'; ctx.fillRect(-29, -14, 58, 4);                                   // защитный короб
        ctx.fillStyle = '#1b1b1b'; for (let x = -27; x < 27; x += 8) { ctx.beginPath(); ctx.moveTo(x, -10); ctx.lineTo(x + 3, -14); ctx.lineTo(x + 6, -14); ctx.lineTo(x + 3, -10); ctx.fill(); }
        ctx.fillStyle = '#f0c419'; ctx.beginPath(); ctx.moveTo(-6, -15); ctx.lineTo(0, -25); ctx.lineTo(6, -15); ctx.fill(); // знак «высокое напряжение»
        ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.moveTo(0.5, -23); ctx.lineTo(-2, -19); ctx.lineTo(0.5, -19); ctx.lineTo(-1, -16); ctx.lineTo(2.5, -20); ctx.lineTo(0, -20); ctx.fill();
        const ph = Math.floor(e.t * 16);
        for (let k = 0; k < 2; k++) { // дуги разрядов прыгают по рельсу
          if (api.hash(ph * 3 + k) < 0.35) continue;
          const x0 = -26 + api.hash(ph * 7 + k) * 34, x1 = x0 + 10 + api.hash(ph * 5 + k) * 14, top = -16 - api.hash(ph * 13 + k) * 8;
          ctx.beginPath(); ctx.moveTo(x0, -10);
          for (let q = 1; q < 5; q++) ctx.lineTo(x0 + (x1 - x0) * q / 5 + (api.hash(ph * 11 + k * 5 + q) - 0.5) * 5, -10 + (top + 10) * Math.sin(Math.PI * q / 5));
          ctx.lineTo(x1, -10);
          ctx.strokeStyle = 'rgba(110,210,255,.7)'; ctx.lineWidth = 3.5; ctx.stroke();
          ctx.strokeStyle = '#f2fdff'; ctx.lineWidth = 1.3; ctx.stroke();
        }
      },
    },
  };

  registerTheme({
    index: 3, id: 'metro',
    title: 'Метро', subtitle: 'Проходка тоннеля и строящаяся станция',
    accent: '#e53935', dust: '#9a948a', headlamp: true,
    gen: { obstacleW: 46, hazardChance: 0.3 },
    decor: ['signal', 'exit', 'toolbox', 'barrel', 'phone', 'coil', 'signal', 'toolbox'],
    enemies,
    init: fixTinySteps,
    enemyTable: [
      { type: 'bat', where: 'air', weight: 3 },
      { type: 'trolley', where: 'ground', weight: 2, from: 0.1 },
      { type: 'driller', where: 'ground', weight: 2, from: 0.2 },
      { type: 'driller', where: 'upper', weight: 1 },
      { type: 'rail', where: 'hazard', weight: 1 },
    ],
    drawBackground, drawGround, drawPit, drawPlatform, drawObstacle, drawDecor, drawFinish,
  });
})();
