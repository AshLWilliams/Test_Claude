'use strict';
// Участок 7 — мост через широкую реку на рассвете. На дальнем берегу лес и городок с золотым куполом, в дымке —
// опоры и вантовый пилон соседнего моста, на фарватере качается плавкран с балкой на крюке. Герой бежит по плите
// пролёта: под ней стальная балка и бетонные опоры, в разрывах настила далеко внизу плещется вода.
// Каждые 6–10 с налетает порыв ветра — он чуть сносит героя по настилу, но никогда не в воздухе и не в разрыв.
// Контракт темы: см. THEMES.md, образец — 01-city.js.
(() => {
  // ---------- общее ----------
  const TAU = Math.PI * 2;
  const HORIZON = 184;   // линия дальнего берега: выше — небо, ниже — река
  const WATER = 342;     // вода прямо под мостом: видна в разрывах настила, в неё уходят опоры
  const DECK = 36;       // высота пролётного строения: плита, окаймляющая балка и главная балка
  const WIND_V = 34, WIND_WARN = 0.9, WIND_LEN = 2; // снос героя порывом (ед/с), предупреждение и длина порыва (с)
  const st = { bg: null, glow: null, wind: { phase: 'calm', t: 6, dir: 1, k: 0 }, splashes: [], wet: false };

  const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
  const oval = (ctx, x, y, rx, ry, rot = 0) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill(); };
  function poly(ctx, p) { ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); ctx.closePath(); ctx.fill(); }

  // Обход особенности генератора: у края groundRange соседние отрезки изредка получают перепад в 1–4 ед. — глазу
  // незаметно, а герой упирается в «порожек». Поднимаем нижнюю серию отрезков вровень с соседом вместе с блоками,
  // платформами, врагами и провалом за ней. Декор и чекпоинты (их нет в api) сдвигаются относительно плиты на ≤ 4 ед. — не видно.
  function fixTinySteps(api) {
    const { solids, platforms, enemies, pits, player: P } = api, adj = (a, b) => Math.abs(a.x + a.w - b.x) < 0.5;
    for (let pass = 0; pass < 10; pass++) {
      const g = solids.filter(s => s.kind === 'ground').sort((a, b) => a.x - b.x);
      const i = g.findIndex((B, k) => k > 0 && adj(g[k - 1], B) && B.y !== g[k - 1].y && Math.abs(B.y - g[k - 1].y) <= 4);
      if (i < 0) break;
      const run = k => { let a = k, b = k; const y = g[k].y;
        while (a > 0 && adj(g[a - 1], g[a]) && g[a - 1].y === y) a--;
        while (b + 1 < g.length && adj(g[b], g[b + 1]) && g[b + 1].y === y) b++;
        return [a, b]; };
      // обычно поднимаем нижнюю серию; если в ней финиш (его высоту движок уже запомнил) — опускаем верхнюю
      let lo = g[i - 1].y > g[i].y ? i - 1 : i, d = -Math.abs(g[i].y - g[i - 1].y), [a, b] = run(lo);
      if (b === g.length - 1) { lo = lo === i ? i - 1 : i; d = -d; [a, b] = run(lo); }
      const y0 = g[lo].y;
      const x0 = g[a].x, x1 = g[b].x + g[b].w, inRun = o => { const c = o.x + (o.w || 0) / 2; return c >= x0 && c < x1; };
      for (const s of solids) if (inRun(s) && (s.kind === 'obstacle' || s.y === y0)) { s.y += d; if (s.kind !== 'obstacle') s.h -= d; }
      for (const p of platforms) if (inRun(p)) { p.y += d; p.base += d; }
      for (const e of enemies) if (inRun(e)) { e.y += d; e.groundY += d; }
      for (const p of pits) if (Math.abs(p.x - x1) < 0.5) p.y += d;
      for (const l of api.ladders || []) { // лестницы вышки едут вместе с ярусами, у стены — только нижний конец
        const c = l.x + l.w / 2; if (c < x0 || c >= x1) continue;
        if (!l.wall) { l.top += d; l.bottom += d; } else if (l.bottom === y0) l.bottom += d;
      }
    }
    const top = api.groundAt(P.x + P.w / 2);
    if (top !== null && P.y + P.h > top) P.y = top - P.h; // стартовый отрезок мог подняться — ставим героя на него
    let n = 0; // номера пролётов по порядку: «П-1», «П-2», … без пропусков
    for (const s of solids) if (s.kind === 'ground') s.span = ++n;
  }

  // ---------- фон: рассветное небо, река, дальний берег, соседний мост, плавкран ----------
  function church(ctx, x, y) { // белёная церковь с золотой луковкой и колокольней
    ctx.fillStyle = '#6573a6'; ctx.fillRect(x - 8, y - 18, 16, 18); ctx.fillRect(x - 4, y - 26, 8, 8); ctx.fillRect(x + 11, y - 34, 7, 34);
    ctx.fillStyle = '#f2c66a'; oval(ctx, x, y - 29, 5, 5); poly(ctx, [x - 3, y - 32, x, y - 39, x + 3, y - 32]);
    poly(ctx, [x + 11, y - 34, x + 14.5, y - 44, x + 18, y - 34]);
    ctx.fillRect(x - 0.5, y - 44, 1, 6); ctx.fillRect(x - 2, y - 42, 4, 1);
    ctx.fillStyle = '#ffd98a'; ctx.fillRect(x - 2, y - 13, 4, 5); ctx.fillRect(x + 13, y - 27, 3, 4);
  }

  function barge(ctx, x, wl, now, i) { // плавкран: понтон, рубка и жёлтая стрела с балкой на крюке, качается на волне
    const y = wl + Math.sin(now * 1.1 + i) * 1.5, tipX = x + 118, tipY = y - 112, sway = Math.sin(now * 0.9 + i) * 5;
    ctx.fillStyle = 'rgba(28,44,74,.35)'; ctx.fillRect(x + 2, wl + 1, 126, 7);               // отражение
    ctx.fillStyle = 'rgba(230,242,255,.45)'; ctx.fillRect(x - 6, wl, 10, 1.4); ctx.fillRect(x + 128, wl + 1, 8, 1.4);
    ctx.fillStyle = '#354157'; poly(ctx, [x, y - 13, x + 130, y - 13, x + 124, y, x + 6, y]); // понтон
    ctx.fillStyle = '#c4452f'; ctx.fillRect(x + 4, y - 4, 122, 2.5);
    ctx.fillStyle = '#f0c21d'; ctx.fillRect(x, y - 14, 130, 2);
    ctx.fillStyle = '#e8ecf1'; ctx.fillRect(x + 8, y - 30, 28, 16);                         // рубка
    ctx.fillStyle = '#7fb4d8'; ctx.fillRect(x + 11, y - 26, 5, 5); ctx.fillRect(x + 19, y - 26, 5, 5); ctx.fillRect(x + 27, y - 26, 5, 5);
    ctx.fillStyle = '#d23a2a'; ctx.fillRect(x + 20, y - 36, 3, 6);
    ctx.fillStyle = '#f0c21d'; ctx.fillRect(x + 62, y - 26, 22, 12);                        // поворотная платформа
    ctx.strokeStyle = '#f0c21d'; ctx.lineWidth = 2; ctx.beginPath();                        // решётчатая стрела
    ctx.moveTo(x + 70, y - 22); ctx.lineTo(tipX, tipY); ctx.moveTo(x + 78, y - 22); ctx.lineTo(tipX + 2, tipY + 3);
    for (let k = 1; k < 9; k++) { const u = k / 9; ctx.moveTo(x + 70 + (tipX - x - 70) * u, y - 22 + (tipY - y + 22) * u); ctx.lineTo(x + 78 + (tipX - x - 76) * (u + 0.05), y - 22 + (tipY - y + 25) * (u + 0.05)); }
    ctx.stroke();
    ctx.strokeStyle = '#2a3140'; ctx.lineWidth = 1; ctx.beginPath();                        // ванта, трос и груз
    ctx.moveTo(x + 66, y - 50); ctx.lineTo(x + 66, y - 24); ctx.moveTo(x + 66, y - 50); ctx.lineTo(tipX, tipY);
    ctx.moveTo(tipX, tipY); ctx.lineTo(tipX + sway, y - 52); ctx.stroke();
    ctx.save(); ctx.translate(tipX + sway, y - 50); ctx.rotate(sway * 0.02);
    ctx.fillStyle = '#9b3f2b'; ctx.fillRect(-24, 0, 48, 7); ctx.fillStyle = '#c0583f'; ctx.fillRect(-24, 0, 48, 1.5);
    ctx.restore();
    ctx.fillStyle = Math.sin(now * 4 + i) > 0 ? '#ff4a3a' : '#6a1a14'; circle(ctx, tipX, tipY - 2, 2);
  }

  // Небо и река — неподвижные вертикальные градиенты во весь экран. Заливка градиентом на телефоне дорогая,
  // поэтому рисуем их один раз в запасной холст размером с экран (в пикселях устройства) и каждый кадр только копируем.
  function skyCache(ctx, api) {
    const { W, H } = api, m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1, w = Math.round(W * k), h = Math.round(H * k);
    if (!st.bg || st.bg.width !== w || st.bg.height !== h) {
      const c = st.bg || document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.scale(k, k);
      const sky = g.createLinearGradient(0, 0, 0, HORIZON);
      sky.addColorStop(0, '#26356a'); sky.addColorStop(0.36, '#5b6aa8'); sky.addColorStop(0.7, '#d596ae'); sky.addColorStop(0.9, '#f9b18d'); sky.addColorStop(1, '#ffd89c');
      const river = g.createLinearGradient(0, HORIZON, 0, H);
      river.addColorStop(0, '#c7abc2'); river.addColorStop(0.16, '#8195c2'); river.addColorStop(0.6, '#3c6792'); river.addColorStop(1, '#1c3d62');
      g.fillStyle = sky; g.fillRect(0, 0, W, HORIZON + 1);
      g.fillStyle = river; g.fillRect(0, HORIZON, W, H - HORIZON);
      st.bg = c;
    }
    ctx.drawImage(st.bg, 0, 0, W, H);
  }

  function skyLayer(ctx, api) { // небо, солнце над дальним берегом, облака, стая чаек
    const { W, camX, hash, now } = api;
    skyCache(ctx, api);

    // солнце встаёт над дальним берегом
    const sx = W * 0.27 - camX * 0.012, sy = HORIZON - 12;
    if (!st.glow) {
      st.glow = ctx.createRadialGradient(0, 0, 18, 0, 0, 90);
      st.glow.addColorStop(0, 'rgba(255,236,190,.7)'); st.glow.addColorStop(0.35, 'rgba(255,212,160,.28)'); st.glow.addColorStop(1, 'rgba(255,200,160,0)');
    }
    ctx.save(); ctx.translate(sx, sy); ctx.fillStyle = st.glow; ctx.fillRect(-90, -90, 180, 180); ctx.restore(); // мягкое сияние
    ctx.fillStyle = '#fff1c8'; circle(ctx, sx, sy, 20);
    const off = camX * 0.03 + now * 2, step = 210;                                   // перистые облака, подсвеченные снизу
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const h1 = hash(i + 400), h2 = hash(i * 3 + 77);
      if (h1 < 0.3) continue;
      const x = i * step - off + h2 * 70, y = 46 + h1 * 76, w = 50 + h2 * 80;
      ctx.fillStyle = 'rgba(255,188,196,.5)'; oval(ctx, x, y, w, 4 + h1 * 3);
      ctx.fillStyle = 'rgba(255,228,176,.6)'; oval(ctx, x + w * 0.15, y + 3, w * 0.7, 2);
    }
    // стая чаек вдалеке
    ctx.strokeStyle = 'rgba(38,48,92,.55)'; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const span = W + 80, x = ((hash(k + 9) * span + now * (10 + k * 3) - camX * 0.05) % span + span) % span - 40;
      const y = 62 + k * 16 + Math.sin(now * 0.8 + k * 2) * 6, f = Math.sin(now * 7 + k * 1.7) * 3;
      ctx.moveTo(x - 5, y - f); ctx.quadraticCurveTo(x - 2, y - 2, x, y); ctx.quadraticCurveTo(x + 2, y - 2, x + 5, y - f);
    }
    ctx.stroke();
    return sx;
  }

  function bankLayer(ctx, api) { // дальний берег: городок (дома, церковь, дымящая труба), перед ним лес
    const { W, camX, hash, now } = api;
    let off = camX * 0.07, step = 84;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const h = hash(i + 600), x = i * step - off;
      if (h < 0.45) continue;
      if (h > 0.9) { church(ctx, x + 30, HORIZON - 4); continue; }
      for (let k = 0; k < 3; k++) {
        const hw = 12 + hash(i * 5 + k) * 10, hh = 8 + hash(i * 7 + k) * 13, hx = x + k * 24, top = HORIZON - 5 - hh;
        ctx.fillStyle = '#5a68a0'; ctx.fillRect(hx, top, hw, hh + 5);
        ctx.fillStyle = '#7270a6'; poly(ctx, [hx - 2, top, hx + hw / 2, top - 6, hx + hw + 2, top]);
        ctx.fillStyle = '#ffd27a'; if (hash(i * 11 + k) > 0.45) ctx.fillRect(hx + 3, top + 3, 2, 2.5); if (hash(i * 13 + k) > 0.55) ctx.fillRect(hx + hw - 6, top + 3, 2, 2.5);
      }
      if (h > 0.75) { // заводская труба с дымом, который сносит ветром
        const cx = x + 70;
        ctx.fillStyle = '#5a68a0'; ctx.fillRect(cx, HORIZON - 44, 5, 44);
        ctx.fillStyle = '#c85a4a'; ctx.fillRect(cx, HORIZON - 44, 5, 3);
        for (let j = 0; j < 4; j++) {
          const ph = (now * 0.22 + j / 4) % 1;
          ctx.fillStyle = `rgba(222,214,230,${(0.4 * (1 - ph)).toFixed(3)})`;
          circle(ctx, cx + 2 + ph * (16 + st.wind.k * 30) * st.wind.dir, HORIZON - 48 - ph * 30, 2.5 + ph * 6);
        }
      }
    }
    off = camX * 0.07; step = 22;
    ctx.fillStyle = '#3c4977'; ctx.beginPath();
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off, h = hash(i * 3 + 7), r = 5 + h * 8, y = HORIZON - 4 - h * 7;
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
      if (hash(i * 7 + 1) > 0.8) { ctx.moveTo(x + 11, HORIZON - 4); ctx.ellipse(x + 8, HORIZON - 16, 3.5, 13, 0, 0, TAU); } // тополь
    }
    ctx.rect(-5, HORIZON - 6, W + 10, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,222,214,.25)'; ctx.fillRect(0, HORIZON - 3, W, 6);   // утренняя дымка над водой
    ctx.fillStyle = 'rgba(40,52,96,.3)'; ctx.fillRect(0, HORIZON + 3, W, 6);       // отражение берега
  }

  function waterLayer(ctx, api, sx) { // солнечная дорожка и рябь на реке
    const { W, camX, hash, now } = api;
    ctx.fillStyle = '#ffe2a6';
    for (let k = 0; k < 18; k++) {
      const y = HORIZON + 6 + k * 8, hw = 6 + k * 2.6, j = Math.sin(now * 2.2 + k * 1.9) * hw * 0.35;
      ctx.globalAlpha = 0.8 - k * 0.04;
      ctx.fillRect(sx - hw * 0.5 + j, y, hw * (0.45 + 0.55 * Math.abs(Math.sin(now * 1.7 + k))), 1.6 + k * 0.08);
    }
    ctx.globalAlpha = 1;
    // рябь: светлые штрихи; чем ближе к зрителю, тем крупнее и сильнее смещаются с камерой
    ctx.fillStyle = 'rgba(226,236,255,.32)'; ctx.beginPath();
    for (let r = 0; r < 11; r++) {
      const y = HORIZON + 9 + r * 6 + r * r * 0.9, par = 0.1 + r * 0.06, sp = 46 + r * 9, len = 6 + r * 2;
      const o = camX * par + now * (3 + r * 0.6);
      for (let j = Math.floor(o / sp) - 1; j < (o + W) / sp + 1; j++) {
        const hj = hash(j * 31 + r * 977); if (hj < 0.35) continue;
        ctx.rect(j * sp - o + hj * sp * 0.6 + Math.sin(now * 2 + j + r) * 2, y + hj * 3, len * (0.6 + hj * 0.6), 1.2);
      }
    }
    ctx.fill();
  }

  function farBridgeLayer(ctx, api) { // соседний мост в дымке: опоры, готовые пролёты, консоли с кранами и сваркой, вантовый пилон
    const { W, camX, hash, now } = api, off = camX * 0.2, step = 150;
    const DB = 140, DW = HORIZON + 16, pylon = i => hash(i + 90) > 0.8;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off;
      ctx.fillStyle = 'rgba(58,74,122,.35)'; ctx.fillRect(x - 5, DW, 10, 12);
      ctx.fillStyle = '#5d6d9d'; ctx.fillRect(x - 5, DB + 8, 10, DW - DB - 8); ctx.fillRect(x - 10, DB + 6, 20, 4);
      if (hash(i + 50) > 0.3 || pylon(i) || pylon(i + 1)) {
        ctx.fillStyle = '#7181ad'; ctx.fillRect(x, DB, step, 5); ctx.fillStyle = '#56669a'; ctx.fillRect(x, DB + 5, step, 3);
      } else { // недостроенный пролёт: две консоли навстречу и кран на конце
        ctx.fillStyle = '#7181ad'; ctx.fillRect(x, DB, 38, 5); ctx.fillRect(x + step - 38, DB, 38, 5);
        const cx = x + 34, hs = Math.sin(now * 1.2 + i) * 2;
        ctx.strokeStyle = '#8e97b8'; ctx.lineWidth = 1.3; ctx.beginPath();
        ctx.moveTo(cx, DB); ctx.lineTo(cx, DB - 24); ctx.lineTo(cx + 28, DB - 18); ctx.moveTo(cx, DB - 2); ctx.lineTo(cx + 28, DB - 18);
        ctx.moveTo(cx + 28, DB - 18); ctx.lineTo(cx + 28 + hs, DB + 6); ctx.stroke();
        ctx.fillStyle = '#8a4a44'; ctx.fillRect(cx + 18 + hs, DB + 6, 20, 4);
        ctx.fillStyle = Math.sin(now * 3 + i) > 0 ? '#ffd24a' : '#6a5a3a'; circle(ctx, cx, DB - 26, 1.6);
        const wx = x + step - 40;                                                   // сварка на встречной консоли: вспышка и искры
        if (Math.sin(now * 5 + i * 2) + Math.sin(now * 13 + i) > 0.4) { ctx.fillStyle = '#e8f6ff'; circle(ctx, wx, DB + 2, 2.2); ctx.fillStyle = 'rgba(160,220,255,.35)'; circle(ctx, wx, DB + 2, 6); }
        ctx.fillStyle = '#ffb347';
        for (let j = 0; j < 5; j++) { const ph = (now * 1.3 + j / 5) % 1; ctx.fillRect(wx + (hash(j + i * 7) - 0.5) * 14 * ph, DB + 4 + ph * ph * 40, 1.3, 1.3); }
      }
      if (pylon(i)) { // вантовый пилон: А-образная стойка и веер вант
        ctx.fillStyle = '#7384b0'; poly(ctx, [x - 8, DB, x - 2, DB - 84, x + 2, DB - 84, x + 8, DB]); ctx.fillRect(x - 6, DB - 30, 12, 3);
        ctx.strokeStyle = 'rgba(214,222,242,.55)'; ctx.lineWidth = 0.8; ctx.beginPath();
        for (let k = 1; k <= 6; k++) { const yy = DB - 80 + k * 5; ctx.moveTo(x, yy); ctx.lineTo(x - k * 22, DB); ctx.moveTo(x, yy); ctx.lineTo(x + k * 22, DB); }
        ctx.stroke();
        ctx.fillStyle = Math.sin(now * 2.5 + i) > 0.3 ? '#ff3b30' : '#5a1a18'; circle(ctx, x, DB - 87, 2);
      }
    }
  }

  function riverLayer(ctx, api) { // ближний план реки: плавкраны, буи и буксиры
    const { W, camX, hash, now } = api, off = camX * 0.42, step = 620;
    const WL = 221;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x0 = i * step - off;
      if (hash(i + 200) > 0.35) barge(ctx, x0 + hash(i + 201) * 160, WL, now, i);
      const bx = x0 + 430 + hash(i + 202) * 120, by = WL + 6 + Math.sin(now * 2 + i) * 1.2, red = i % 2 === 0;
      ctx.fillStyle = 'rgba(28,44,74,.3)'; ctx.fillRect(bx - 4, by + 1, 8, 6);
      ctx.fillStyle = red ? '#d6392b' : '#2e9a5a'; ctx.fillRect(bx - 4, by - 9, 8, 9);
      if (red) ctx.fillRect(bx - 3, by - 13, 6, 4); else poly(ctx, [bx - 4, by - 9, bx, by - 16, bx + 4, by - 9]);
      ctx.fillStyle = '#f2f2f2'; ctx.fillRect(bx - 4, by - 5, 8, 1.5);
    }
    for (let k = 0; k < 3; k++) { // буксиры медленно идут вверх по реке
      const x = 300 + k * 1500 + now * 15 - off;
      if (x < -60 || x > W + 60) continue;
      const y = WL - 4 + Math.sin(now * 1.6 + k) * 1;
      ctx.fillStyle = 'rgba(235,245,255,.5)'; for (let j = 0; j < 5; j++) ctx.fillRect(x - 14 - j * 11, WL - 3 + (j % 2), 9 - j, 1.2);
      ctx.fillStyle = '#b8402e'; poly(ctx, [x - 14, y - 7, x + 20, y - 7, x + 15, y, x - 11, y]);
      ctx.fillStyle = '#eef1f4'; ctx.fillRect(x - 4, y - 15, 13, 8);
      ctx.fillStyle = '#6ea6cc'; ctx.fillRect(x - 2, y - 13, 3, 3); ctx.fillRect(x + 3, y - 13, 3, 3);
      ctx.fillStyle = '#20252c'; ctx.fillRect(x - 10, y - 19, 4, 12);
      for (let j = 0; j < 3; j++) { const ph = (now * 0.5 + j / 3) % 1; ctx.fillStyle = `rgba(90,90,100,${(0.35 * (1 - ph)).toFixed(3)})`; circle(ctx, x - 8 - ph * 16, y - 22 - ph * 14, 2 + ph * 4); }
    }
  }

  function nearWaves(ctx, api) { // вода прямо под мостом: крупные гребни привязаны к миру — видны в разрывах настила
    const { W, camX, now } = api;
    ctx.strokeStyle = 'rgba(196,228,255,.5)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let r = 0; r < 3; r++) {
      const y = WATER + 4 + r * 7, sp = 30 + r * 6, o = camX + now * (8 - r * 3) + r * 13;
      for (let j = Math.floor(o / sp) - 1; j < (o + W) / sp + 1; j++) {
        const x = j * sp - o, yy = y + Math.sin(j * 1.7 + now * 2.4) * 1.5;
        ctx.moveTo(x, yy); ctx.quadraticCurveTo(x + sp * 0.25, yy - 3.5, x + sp * 0.5, yy);
      }
    }
    ctx.stroke();
  }

  function drawBackground(ctx, api) {
    const sx = skyLayer(ctx, api);
    bankLayer(ctx, api);
    waterLayer(ctx, api, sx);
    farBridgeLayer(ctx, api);
    riverLayer(ctx, api);
    nearWaves(ctx, api);
  }

  // ---------- настил, разрывы, фермы, препятствия ----------
  function drawPier(s, ctx, api) { // стена: русловая опора-«бык» выше настила — бетонное тело, оголовок, ледорез у воды
    const { now, text } = api, y = s.y, L = s.x - 0.5, Wd = s.w + 1, x1 = s.x + s.w, top = y + 16, h = WATER + 2 - top;
    ctx.fillStyle = 'rgba(12,22,44,.4)'; ctx.fillRect(L, WATER, Wd, api.H - WATER + 10);       // отражение в воде
    ctx.fillStyle = '#7d7a84'; ctx.fillRect(L, top, Wd, h);                                    // тело опоры
    ctx.fillStyle = '#98939b'; ctx.fillRect(L, top, Math.min(28, Wd), h);                     // грань в лучах восхода
    ctx.fillStyle = '#5d5a66'; ctx.fillRect(x1 - 16, top, 16.5, h);                           // теневая грань
    ctx.fillStyle = 'rgba(40,40,56,.3)'; ctx.beginPath();                                      // захватки опалубки и отверстия от стяжек
    for (let yy = top + 30; yy < WATER - 30; yy += 30) {
      ctx.rect(L, yy, Wd, 1.5);
      for (let xx = s.x + 18; xx < x1 - 12; xx += 34) ctx.rect(xx, yy - 15, 2.2, 2.2);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(70,60,50,.25)';                                                       // потёки от оголовка
    for (let xx = s.x + 40; xx < x1 - 20; xx += 57) ctx.fillRect(xx + (s.v * 20) % 9, top, 3, 18 + ((xx * 7) % 23));
    ctx.fillStyle = '#4b5561'; ctx.fillRect(L, WATER - 30, Wd, 32);                           // гранитный ледорезный пояс
    ctx.fillStyle = '#65717d'; ctx.fillRect(L, WATER - 30, Wd, 2); ctx.fillRect(L, WATER - 16, Wd, 1.2);
    ctx.fillStyle = 'rgba(230,245,255,.6)'; oval(ctx, s.x + s.w / 2, WATER + 1, s.w / 2 + 6 + Math.sin(now * 3 + s.x) * 2, 2.4); // бурун у опоры
    // опорные площадки: соседние пролёты лежат на консолях опоры
    for (const [ex, d] of [[s.x, -1], [x1, 1]]) {
      const ny = api.groundAt(ex + d * 3);
      if (ny === null || ny < y + 20) continue;
      ctx.fillStyle = '#6a6770'; ctx.fillRect(d < 0 ? ex - 7 : ex, ny + DECK, 7, 8);
      ctx.fillStyle = '#23262c'; ctx.fillRect(d < 0 ? ex - 6 : ex + 1, ny + DECK - 3, 5, 3);
    }
    ctx.fillStyle = '#f4f1e8'; ctx.fillRect(s.x + s.w / 2 - 20, top + 34, 40, 14);             // номер опоры по трафарету
    text('ОП-' + (s.span || 1), s.x + s.w / 2, top + 44.5, 9, '#2a2d34');
    ctx.fillStyle = '#d6392b'; for (let k = 0; k < 3; k++) ctx.fillRect(x1 - 30, top + 60 + k * 16, 8, 8); // судоходная разметка
    ctx.fillStyle = '#f4f4f4'; for (let k = 0; k < 3; k++) ctx.fillRect(x1 - 30, top + 68 + k * 16, 8, 8);
    ctx.fillStyle = '#5b5862'; ctx.fillRect(s.x - 3, y + 4, s.w + 6, 12);                      // оголовок (ригель) с капельником
    ctx.fillStyle = '#86828b'; ctx.fillRect(s.x - 3, y + 4, s.w + 6, 2);
    ctx.fillStyle = '#3e3c45'; ctx.fillRect(s.x - 3, y + 14.5, s.w + 6, 1.5);
    ctx.fillStyle = '#bab3a5'; ctx.fillRect(s.x - 3, y, s.w + 6, 5);                          // верхняя площадка — по ней ходят
    ctx.fillStyle = '#e6decd'; ctx.fillRect(s.x - 3, y, s.w + 6, 1.5);
    ctx.fillStyle = '#44525f'; ctx.beginPath();                                                // перила по дальнему краю
    for (let x = s.x + 30; x < x1 - 3; x += 26) ctx.rect(x, y - 13, 2, 13);
    ctx.rect(s.x + 30, y - 14, s.w - 33, 2); ctx.rect(s.x + 30, y - 8, s.w - 33, 1.2);
    ctx.fill();
    const on = Math.sin(now * 2.6 + s.x) > 0;                                                  // сигнальный огонь на углу
    ctx.fillStyle = '#44525f'; ctx.fillRect(x1 - 9, y - 18, 3, 18);
    ctx.fillStyle = on ? '#ffcf33' : '#6a5a1d'; circle(ctx, x1 - 7.5, y - 20, 3);
    if (on) { ctx.fillStyle = 'rgba(255,210,80,.25)'; circle(ctx, x1 - 7.5, y - 20, 8); }
  }

  function drawGround(s, ctx, api) { // пролёт: бетонная плита, окаймляющая балка, главная балка; под ним тень и опоры
    if (s.wall) { drawPier(s, ctx, api); return; }
    const { H, W, camX, now } = api, y = s.y, L = s.x - 0.5, Wd = s.w + 1, bot = y + DECK;
    const x0 = Math.max(s.x, camX - 30), x1 = Math.min(s.x + s.w, camX + W + 30); // мелкие детали — только в кадре
    ctx.fillStyle = 'rgba(12,22,44,.45)'; ctx.fillRect(s.x, bot, s.w, H - bot + 10);  // тень пролёта, сквозь неё видна река
    for (let px = Math.ceil((s.x + 34) / 240) * 240; px < s.x + s.w - 34; px += 240) { // бетонные опоры: тело, ригель, опорные части
      if (px < camX - 60 || px > camX + W + 60) continue;
      const top = bot + 9;
      ctx.fillStyle = '#6a6770'; ctx.fillRect(px - 12, top, 24, WATER - top + 2);
      ctx.fillStyle = '#8b878c'; ctx.fillRect(px - 12, top, 8, WATER - top + 2);
      ctx.fillStyle = 'rgba(40,40,52,.35)'; for (let yy = top + 12; yy < WATER - 4; yy += 12) ctx.fillRect(px - 12, yy, 24, 1);
      ctx.fillStyle = '#3f5a4e'; ctx.fillRect(px - 12, WATER - 6, 24, 6);            // тёмный пояс у воды
      ctx.fillStyle = '#57555e'; ctx.fillRect(px - 20, bot + 3, 40, 7);              // ригель
      ctx.fillStyle = '#76737a'; ctx.fillRect(px - 20, bot + 3, 40, 1.5);
      ctx.fillStyle = '#23262c'; ctx.fillRect(px - 15, bot, 7, 3); ctx.fillRect(px + 8, bot, 7, 3);
      const blink = Math.sin(now * 2.4 + px * 0.01) > 0.2;                         // сигнальный огонь судоходного пролёта
      ctx.fillStyle = blink ? '#ff4a3a' : '#5a1d18'; ctx.fillRect(px - 2, bot + 4, 4, 3);
      if (blink) { ctx.fillStyle = 'rgba(255,90,60,.25)'; circle(ctx, px, bot + 5.5, 6); }
      ctx.fillStyle = 'rgba(230,245,255,.6)'; oval(ctx, px, WATER + 1, 17 + Math.sin(now * 3 + px) * 2, 2.2);
    }
    ctx.fillStyle = '#9b3f2b'; ctx.fillRect(L, y + 11, Wd, 21);                  // стенка главной балки (грунт-сурик)
    ctx.fillStyle = '#7a2e1f'; ctx.beginPath();                                    // рёбра жёсткости
    for (let x = Math.ceil(x0 / 22) * 22; x < x1 - 2; x += 22) ctx.rect(x, y + 13, 3, 19);
    ctx.fill();
    ctx.fillStyle = '#c0583f'; ctx.fillRect(L, y + 11, Wd, 1.5);
    ctx.fillStyle = '#5c2118'; ctx.fillRect(L, y + 32, Wd, 4);                    // нижний пояс
    for (let x = Math.ceil((x0 + 8) / 150) * 150; x < x1 - 8; x += 150) {         // монтажные стыки: накладки на болтах
      ctx.fillStyle = '#86352a'; ctx.fillRect(x - 7, y + 12.5, 16, 19);
      ctx.fillStyle = '#d98a70'; for (let by = y + 15; by < y + 30; by += 4) { ctx.fillRect(x - 5, by, 1.5, 1.5); ctx.fillRect(x + 5.5, by, 1.5, 1.5); }
    }
    if (s.w > 150 && s.x + 30 > camX - 40 && s.x + 30 < camX + W) api.text('П-' + (s.span || 1 + Math.floor(s.x / 300)), s.x + 34, y + 25, 8, 'rgba(255,236,214,.7)'); // номер пролёта
    ctx.fillStyle = '#2c8391'; ctx.fillRect(L, y + 5, Wd, 6);                     // окаймляющая стальная балка с болтами
    ctx.fillStyle = '#a3e6ec'; ctx.beginPath();
    for (let x = Math.ceil(x0 / 12) * 12 + 4; x < x1 - 2; x += 12) ctx.rect(x, y + 7.2, 1.6, 1.6);
    ctx.fill();
    ctx.fillStyle = '#bab3a5'; ctx.fillRect(L, y, Wd, 5);                         // бетонная плита
    ctx.fillStyle = '#e6decd'; ctx.fillRect(L, y, Wd, 1.5);
    ctx.fillStyle = '#55504a'; for (let x = Math.ceil(x0 / 150) * 150; x < x1 - 4; x += 150) ctx.fillRect(x, y, 2, 11); // деформационные швы
    ctx.fillStyle = '#4a1a12'; ctx.fillRect(s.x, y + 5, 2, DECK - 5); ctx.fillRect(s.x + s.w - 2, y + 5, 2, DECK - 5);  // торцы
    ctx.fillStyle = '#44525f'; ctx.beginPath();                                   // перила по дальнему краю
    for (let x = Math.ceil((x0 + 3) / 26) * 26; x < x1 - 3; x += 26) ctx.rect(x, y - 13, 2, 13);
    ctx.rect(x0, y - 14, x1 - x0, 2); ctx.rect(x0, y - 8, x1 - x0, 1.2);
    ctx.fill();
  }

  function drawPit(p, ctx, api) { // разрыв настила: торцы плиты с арматурой, свисающий трос, далеко внизу — вода
    const { now, hash } = api, L = p.x, R = p.x + p.w, yr = api.groundAt(R + 2) ?? p.y;
    ctx.fillStyle = 'rgba(160,200,235,.12)'; ctx.fillRect(L, p.y + 12, p.w, WATER - p.y - 12); // светлый просвет
    ctx.strokeStyle = 'rgba(240,252,255,.85)'; ctx.lineWidth = 1.4; ctx.beginPath();          // солнечные блики на воде
    for (let x = L + 5; x < R - 8; x += 13) { const yy = WATER + 1 + Math.sin(x * 0.4 + now * 3) * 1.3; ctx.moveTo(x, yy); ctx.lineTo(x + 7, yy); }
    ctx.stroke();
    ctx.strokeStyle = '#9a5530'; ctx.lineWidth = 1.5; ctx.beginPath();                         // арматура из торцов плиты
    for (let k = 0; k < 3; k++) {
      ctx.moveTo(L, p.y + 2 + k * 4); ctx.lineTo(L + 5 + hash(Math.floor(L) + k) * 7, p.y + 3 + k * 4);
      ctx.moveTo(R, yr + 2 + k * 4); ctx.lineTo(R - 5 - hash(Math.floor(R) + k) * 7, yr + 3 + k * 4);
    }
    ctx.stroke();
    const sw = Math.sin(now * 1.6 + p.v * 9) * 6, end = p.y + 96 + p.v * 30;                   // трос качается над водой
    ctx.strokeStyle = '#262a31'; ctx.lineWidth = 1.2; ctx.beginPath();
    ctx.moveTo(L + 4, p.y + DECK - 4); ctx.quadraticCurveTo(L + 7 + sw * 0.4, (p.y + end) / 2 + 20, L + 10 + sw, end); ctx.stroke();
    ctx.fillStyle = '#f0c21d'; ctx.fillRect(L + 7 + sw, end, 6, 5);
    const bx = L - 30;                                                                          // ограждение перед разрывом
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(bx, p.y - 20, 2, 20); ctx.fillRect(bx + 22, p.y - 20, 2, 20);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#f4f4f4' : '#d8322a'; ctx.fillRect(bx - 2 + i * 4.7, p.y - 22, 4.7, 5); }
  }

  function footAt(x, y, api) { // на что опирается стойка в точке x под высотой y: ближайший нижний ярус или настил
    let b = api.groundAt(x); if (b === null) b = WATER;
    for (const q of api.platforms) if (q.y > y + 1 && q.y < b && x >= q.x && x <= q.x + q.w) b = q.y;
    return b;
  }

  function drawPlatform(p, ctx, api) { // стальная ферма-переход: треугольная решётка, настил-решётка, перила и стойки
    const x = p.x, y = p.y, w = p.w, D = 20, n = Math.max(2, Math.round(w / 26)), pw = w / n;
    const posts = w > 240 || p.tower ? [x + 10, x + w / 2 - 2, x + w - 14] : [x + 10, x + w - 14];
    const feet = posts.map(sx => footAt(sx + 2, y, api));
    if (p.tower) { // вышка — временная монтажная опора: башенки из уголков с крестовыми связями
      ctx.strokeStyle = '#1d5f6b'; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let i = 0; i < posts.length - 1; i++) {
        const a = posts[i] + 2, b = posts[i + 1] + 2, lo = Math.min(feet[i], feet[i + 1]);
        for (let yy = y + D; yy < lo - 20; yy += 36) {
          const y2 = Math.min(yy + 36, lo); ctx.moveTo(a, yy); ctx.lineTo(b, y2); ctx.moveTo(b, yy); ctx.lineTo(a, y2);
          ctx.moveTo(a, y2); ctx.lineTo(b, y2);
        }
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#1d5f6b';                                                         // стойки до опоры
    posts.forEach((sx, i) => { ctx.fillRect(sx, y + D, p.tower ? 5 : 4, feet[i] - y - D); ctx.fillRect(sx - 3, feet[i] - 3, 10, 3); });
    if (p.tower) { ctx.fillStyle = '#44bccb'; posts.forEach((sx, i) => ctx.fillRect(sx, y + D, 1.5, feet[i] - y - D)); }
    ctx.strokeStyle = '#2a8f9c'; ctx.lineWidth = 2.5; ctx.beginPath();                 // решётка Уоррена
    for (let i = 0; i < n; i++) { const a = x + i * pw; ctx.moveTo(a, y + 5); ctx.lineTo(a + pw / 2, y + D); ctx.lineTo(a + pw, y + 5); }
    ctx.stroke();
    ctx.fillStyle = '#1f6f7b'; ctx.fillRect(x + pw / 2 - 2, y + D - 1.5, w - pw + 4, 4); // нижний пояс
    ctx.fillStyle = '#16505a'; for (let i = 0; i < n; i++) ctx.fillRect(x + i * pw + pw / 2 - 2.5, y + D - 3, 5, 5); // фасонки
    ctx.fillStyle = '#44bccb'; ctx.fillRect(x - 4, y, w + 8, 6);                       // настил
    ctx.fillStyle = '#1f6f7b'; ctx.beginPath(); for (let a = x; a < x + w; a += 6) ctx.rect(a, y + 2.5, 3, 2); ctx.fill();
    ctx.fillStyle = '#b3f1f7'; ctx.fillRect(x - 4, y, w + 8, 1.3);
    ctx.fillStyle = '#2a8f9c'; ctx.fillRect(x - 4, y - 14, w + 8, 2);                  // перила
    for (let i = 0; i <= n; i++) ctx.fillRect(x - 3 + i * (w + 4) / n, y - 14, 1.6, 14);
  }

  function drawLadder(l, ctx) { // стремянка в цвет ферм; на опоре — с ограждением-«корзиной» из дуг
    const t = l.top - 12, h = l.bottom - t, r = l.x + l.w;
    ctx.fillStyle = 'rgba(10,20,40,.28)'; ctx.fillRect(l.x + 3, l.top, l.w - 2, l.bottom - l.top);
    ctx.fillStyle = '#1f6f7b'; ctx.fillRect(l.x, t, 3, h); ctx.fillRect(r - 3, t, 3, h);
    ctx.fillStyle = '#b3f1f7'; ctx.fillRect(l.x, t, 1, h);
    ctx.fillStyle = '#44bccb'; ctx.beginPath(); for (let y = l.top + 6; y < l.bottom; y += 12) ctx.rect(l.x + 2, y, l.w - 4, 2.5); ctx.fill();
    if (l.wall && h > 90) {
      ctx.strokeStyle = 'rgba(42,143,156,.85)'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let y = l.top + 4; y < l.bottom - 56; y += 26) { ctx.moveTo(l.x - 1, y); ctx.quadraticCurveTo(l.x + l.w / 2, y + 7, r + 1, y); }
      ctx.moveTo(l.x - 1, l.top + 4); ctx.lineTo(l.x - 1, l.bottom - 60); ctx.moveTo(r + 1, l.top + 4); ctx.lineTo(r + 1, l.bottom - 60);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffcf33'; ctx.fillRect(l.x - 1, l.top - 14, 5, 3); ctx.fillRect(r - 4, l.top - 14, 5, 3); // поручни сверху
  }

  function drum(ctx, x, y, w, h) { // кабельный барабан в три четверти: щёки-диски и намотанный чёрный кабель
    const ry = h / 2, cy = y + ry;
    ctx.fillStyle = '#a8763e'; oval(ctx, x + 6, cy, 5, ry);                   // дальняя щека
    ctx.fillStyle = '#2a2e34'; ctx.fillRect(x + 6, y + 4, w - 13, h - 8);        // кабель
    ctx.strokeStyle = '#59616b'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = x + 10; i < x + w - 8; i += 4) { ctx.moveTo(i, y + 4); ctx.lineTo(i - 3, y + h - 4); }
    ctx.moveTo(x + 8, y + 4.5); ctx.quadraticCurveTo(x + 2, y + 2, x + 1, y - 1);          // конец кабеля
    ctx.stroke();
    ctx.fillStyle = '#f2c230'; ctx.fillRect(x + w / 2 - 8, cy - 3, 12, 6);        // бирка
    ctx.fillStyle = '#dcab6c'; oval(ctx, x + w - 7, cy, 6.5, ry);               // ближняя щека: видна плоскость диска
    ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#c38f52'; oval(ctx, x + w - 7, cy, 3.6, ry * 0.55);
    ctx.fillStyle = '#4a2f14'; oval(ctx, x + w - 7, cy, 1.6, 3);                // ступица
  }

  function crate(ctx, x, y, w, h, api) { // ящик с болтами М24
    ctx.fillStyle = '#a8763e'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#8a5d2c'; ctx.fillRect(x, y + h / 3, w, 1.5); ctx.fillRect(x, y + h * 2 / 3, w, 1.5);
    ctx.fillStyle = '#6f4a22'; ctx.fillRect(x, y, 3, h); ctx.fillRect(x + w - 3, y, 3, h); ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y + h - 2, w, 2);
    api.text('БОЛТЫ', x + w / 2, y + h / 2 - 1, 7, '#3b2712'); api.text('М24', x + w / 2, y + h / 2 + 7, 7, '#3b2712');
  }

  function drawObstacle(s, ctx, api) { // стопка: ящики с болтами и кабельные барабаны
    const n = s.stack || 1, bh = s.h / n;
    for (let k = 0; k < n; k++) {
      const y = s.y + s.h - (k + 1) * bh;
      if (n > 1 ? k > 0 : api.hash(Math.floor(s.v * 1e4)) > 0.5) drum(ctx, s.x, y, s.w, bh); else crate(ctx, s.x, y, s.w, bh, api);
    }
  }

  // ---------- декор ----------
  function waveStrip(ctx, x, top, h, d, len, amp, sp, now, droop) { // полотнище флага: лента из 7 точек сверху и снизу
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) { const u = i / 6; ctx.lineTo(x + d * u * len, top + Math.sin(now * sp - i * 0.9) * amp * u + droop * u); }
    for (let i = 6; i >= 0; i--) { const u = i / 6; ctx.lineTo(x + d * u * len, top + h + Math.sin(now * sp - i * 0.9) * amp * u + droop * u * 1.4); }
    ctx.fill();
  }

  function drawDecor(d, ctx, api) {
    const x = d.x, y = d.y, w = st.wind, now = api.now;
    if (d.kind === 'lamp') { // фонарь моста: ещё горит на рассвете
      ctx.fillStyle = '#56616d'; ctx.fillRect(x - 1.5, y - 80, 3, 80); ctx.fillRect(x - 4, y - 6, 8, 6);
      ctx.strokeStyle = '#56616d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 78); ctx.quadraticCurveTo(x + 2, y - 87, x + 14, y - 85); ctx.stroke();
      ctx.fillStyle = '#3a434d'; ctx.fillRect(x + 9, y - 88, 14, 4);
      const on = api.hash(Math.floor(now * 7) + Math.floor(d.v * 1000)) > 0.04;
      ctx.fillStyle = on ? '#fff4c9' : '#9a8f70'; ctx.fillRect(x + 11, y - 84, 10, 2.5);
      if (on) { ctx.fillStyle = 'rgba(255,236,170,.22)'; circle(ctx, x + 16, y - 81, 11); ctx.fillStyle = 'rgba(255,236,170,.1)'; circle(ctx, x + 16, y - 78, 22); }
    } else if (d.kind === 'rope') { // бухта каната
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) { ctx.strokeStyle = i % 2 ? '#b08c55' : '#8b6c3e'; ctx.beginPath(); ctx.ellipse(x, y - 3 - i * 3.2, 13 - i * 1.6, 3.4, 0, 0, TAU); ctx.stroke(); }
      ctx.strokeStyle = '#8b6c3e'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x + 10, y - 3); ctx.quadraticCurveTo(x + 20, y - 1, x + 24, y - 1); ctx.stroke();
    } else if (d.kind === 'buoy') { // спасательный круг на стойке
      ctx.fillStyle = '#6b7680'; ctx.fillRect(x - 1, y - 42, 2, 42); ctx.fillRect(x - 5, y - 42, 10, 2);
      ctx.save(); ctx.translate(x, y - 41); ctx.rotate(Math.sin(now * (2 + w.k * 9)) * (0.05 + w.k * 0.22));
      ctx.lineWidth = 4.5;
      for (let i = 0; i < 4; i++) { ctx.strokeStyle = i % 2 ? '#f4f4f4' : '#ff5a2a'; ctx.beginPath(); ctx.arc(0, 14, 9, i * Math.PI / 2, (i + 1) * Math.PI / 2); ctx.stroke(); }
      ctx.strokeStyle = '#6b7680'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 5); ctx.stroke();
      ctx.restore();
    } else if (d.kind === 'flag') { // триколор: в штиль лениво колышется, в порыв — бьётся по ветру
      const dir = w.k > 0.2 ? w.dir : 1, k = w.k, top = y - 58;
      ctx.fillStyle = '#9aa3ab'; ctx.fillRect(x - 1, top - 2, 2, 60); circle(ctx, x, top - 3, 2);
      const cols = ['#f7f7f7', '#1f5fbf', '#d6302a'];
      for (let b = 0; b < 3; b++) { ctx.fillStyle = cols[b]; waveStrip(ctx, x, top + b * 5.3, 5.6, dir, 26 + k * 4, 1.5 + k * 3.5, 4 + k * 12, now, (1 - k) * 5); }
    } else if (d.kind === 'windsock') { // ветроуказатель: висит в штиль, вытягивается по ветру ещё до порыва
      ctx.fillStyle = '#9aa3ab'; ctx.fillRect(x - 1, y - 52, 2, 52);
      ctx.save(); ctx.translate(x, y - 50); ctx.scale(w.k > 0.05 ? w.dir : 1, 1);
      ctx.rotate((1 - w.k) * 1.2 + Math.sin(now * (3 + w.k * 14)) * (0.04 + w.k * 0.09));
      for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#f4f4f4' : '#ff6a2b'; poly(ctx, [i * 7, -5 + i, (i + 1) * 7, -4 + i, (i + 1) * 7, 4 - i, i * 7, 5 - i]); }
      ctx.fillStyle = '#6a737c'; ctx.fillRect(-1, -6, 2, 12);
      ctx.restore();
    } else if (d.kind === 'sign') { // временный знак «Мост строится»
      ctx.fillStyle = '#5b6570'; ctx.fillRect(x - 24, y - 26, 2, 26); ctx.fillRect(x + 22, y - 26, 2, 26);
      ctx.fillStyle = '#26262a'; ctx.fillRect(x - 31, y - 51, 62, 28);
      ctx.fillStyle = '#ffcf33'; ctx.fillRect(x - 29, y - 49, 58, 24);
      api.text('МОСТ', x, y - 39, 9, '#1d1d1f'); api.text('СТРОИТСЯ', x, y - 29, 8, '#1d1d1f');
    }
  }

  function drawFinish(fx, gy, ctx, api) { // открытие моста: гранитная стела с бронзовой табличкой и красная лента
    const x = fx + 130, y = gy, now = api.now;
    ctx.fillStyle = '#3a404d'; ctx.fillRect(x + 32, y - 12, 170, 12);
    ctx.fillStyle = '#4b5361'; ctx.fillRect(x + 42, y - 100, 150, 88);
    ctx.fillStyle = '#626c7c'; ctx.fillRect(x + 42, y - 100, 150, 5); ctx.fillRect(x + 42, y - 100, 5, 88);
    ctx.fillStyle = '#7a5a2c'; ctx.fillRect(x + 52, y - 90, 130, 62);
    ctx.fillStyle = '#c9a466'; ctx.fillRect(x + 55, y - 87, 124, 56);
    ctx.fillStyle = '#e3c58a'; ctx.fillRect(x + 55, y - 87, 124, 2);
    ctx.strokeStyle = '#7a5a2c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 90, y - 76); ctx.quadraticCurveTo(x + 117, y - 90, x + 144, y - 76); ctx.stroke(); // эмблема-арка
    ctx.fillStyle = '#7a5a2c'; for (let i = 0; i < 5; i++) ctx.fillRect(x + 96 + i * 10, y - 81 + Math.abs(i - 2) * 2, 1.5, 5);
    api.text('МОСТ', x + 117, y - 62, 10, '#3e2a10');
    api.text('«ГЕОДЕЗИЧЕСКИЙ»', x + 117, y - 48, 11, '#3e2a10');
    api.text('2026', x + 117, y - 36, 8, '#6b4e24');
    for (const px of [x + 4, x + 226]) { // столбики с фонарями
      ctx.fillStyle = '#d9dbde'; ctx.fillRect(px - 3, y - 36, 6, 36); ctx.fillStyle = '#9aa0a6'; ctx.fillRect(px - 5, y - 38, 10, 3);
      ctx.fillStyle = '#fff2c2'; circle(ctx, px, y - 43, 4); ctx.fillStyle = 'rgba(255,236,170,.2)'; circle(ctx, px, y - 43, 12);
    }
    const sag = 7 + Math.sin(now * 2) * 1.5, mx = x + 115, my = y - 30 + sag; // красная лента с бантом
    ctx.strokeStyle = '#e0302a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x + 7, y - 31); ctx.quadraticCurveTo(mx, y - 30 + sag * 2, x + 223, y - 31); ctx.stroke();
    ctx.fillStyle = '#e0302a'; oval(ctx, mx - 8, my - 3, 8, 5, -0.4); oval(ctx, mx + 8, my - 3, 8, 5, 0.4);
    poly(ctx, [mx - 2, my, mx - 9, my + 16, mx - 4, my + 14, mx, my + 2]); poly(ctx, [mx + 2, my, mx + 9, my + 16, mx + 4, my + 14, mx, my + 2]);
    ctx.fillStyle = '#b01e1a'; circle(ctx, mx, my - 1, 3);
    ctx.fillStyle = '#26c6da'; // флажки-гирлянда над стелой
    for (let i = 0; i < 8; i++) { const fx2 = x + 50 + i * 18, fy = y - 112 + Math.sin(i / 7 * Math.PI) * 6; ctx.fillStyle = i % 2 ? '#26c6da' : '#ffcf33'; poly(ctx, [fx2, fy, fx2 + 10, fy, fx2 + 5, fy + 9 + Math.sin(now * 4 + i)]); }
    ctx.strokeStyle = '#8a8f96'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 44, y - 112); ctx.quadraticCurveTo(x + 117, y - 100, x + 192, y - 112); ctx.stroke();
  }

  // ---------- враги ----------
  function drawChip(p, ctx) { // щепка: светлая древесина с волокнами
    ctx.fillStyle = '#ecc27e'; poly(ctx, [-5, -2, 3, -3.5, 5.5, 1, -3, 3]);
    ctx.fillStyle = '#a8703a'; ctx.fillRect(-3, -1, 6, 1);
    ctx.strokeStyle = 'rgba(60,35,15,.7)'; ctx.lineWidth = 0.8; ctx.stroke();
  }
  function drawHelmet(p, ctx) { ctx.fillStyle = '#d8342a'; ctx.beginPath(); ctx.arc(0, 2, 6, Math.PI, 0); ctx.fill(); ctx.fillRect(-7, 1, 14, 2); }
  function splashIn(p, dt, api) { // щепка или каска упала в разрыв — маленький всплеск
    if (!p.wet && p.y + p.h > WATER && api.groundAt(p.x + p.w / 2) === null) { p.wet = true; api.burst(p.x + p.w / 2, WATER, '#e6f8ff', 6, 110, 700); }
  }
  const lerp = (a, b, u) => a + (b - a) * u;
  const onScreen = (e, api) => e.y + e.h > api.camY + 40 && e.y < api.camY + api.H - 10 && e.x + e.w > api.camX && e.x < api.camX + api.W; // враг виден — стрелять можно
  function drawRivet(p, ctx) { // раскалённая заклёпка с огненным хвостом
    ctx.fillStyle = 'rgba(255,140,40,.4)'; ctx.fillRect(-16, -2.5, 16, 5);
    ctx.fillStyle = '#ff7a1f'; ctx.fillRect(-4, -2.5, 6, 5); ctx.fillStyle = '#ffe2a0'; oval(ctx, 3, 0, 3.5, 3.5);
  }
  const rivetUpd = p => { p.rot = Math.atan2(p.vy, p.vx); };

  function placeRigger(e) { // маятник: подвес (ax, ay), длина троса len, угол cth; хитбокс — по телу вдоль троса
    const th = e.th * Math.sin(e.ph), r = e.len + 19;
    e.cth = th;
    e.x = e.ax + r * Math.sin(th) - e.w / 2; e.y = e.ay + r * Math.cos(th) - 19;
  }

  const enemies = {
    gull: { // чайка: кружит над настилом, кричит (0,85 с) и пикирует по дуге сквозь героя
      w: 28, h: 14, hp: 1, pts: 120, knockback: false, hitColor: '#ffffff', deathColor: '#eef3f6',
      init(e) { e.hx = e.x; e.hy = e.y; e.ang = Math.random() * TAU; e.spin = Math.random() < 0.5 ? -1 : 1; e.state = 'circle'; e.cd = 1.2 + Math.random(); },
      update(e, dt, api) {
        const P = api.player, pcx = P.x + P.w / 2, ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
        if (e.state === 'circle') {
          e.ang += e.spin * 1.7 * dt;
          const nx = e.hx + Math.cos(e.ang) * 44, ny = e.hy + Math.sin(e.ang) * 14;
          if (Math.abs(nx - e.x) > 0.01) e.dir = Math.sign(nx - e.x);
          e.x = nx; e.y = ny; e.cd -= dt;
          if (e.cd <= 0 && Math.abs(pcx - ecx) < 230 && P.y > e.y + 10 && P.y - e.y < 260) { e.state = 'scream'; e.st = 0.85; }
        }
        if (e.state === 'scream') { // телеграф: зависла, кричит, пунктир показывает дугу (с небольшим упреждением)
          e.st -= dt; e.dir = Math.sign(pcx - ecx) || e.dir;
          e.tx = api.clamp(pcx + P.vx * 0.3, ecx - 260, ecx + 260); e.ty = P.y + P.h / 2;
          if (e.st <= 0) {
            e.sx = ecx; e.sy = ecy; e.ex = ecx + 2 * (e.tx - ecx); e.ey = ecy - 6;
            e.cx = 2 * e.tx - 0.5 * (e.sx + e.ex); e.cy = 2 * e.ty - 0.5 * (e.sy + e.ey);
            e.u = 0; e.dur = api.clamp(Math.hypot(e.ex - e.sx, e.ty - e.sy) / 300, 0.9, 1.4); e.state = 'dive';
          }
        } else if (e.state === 'dive') { // квадратичная кривая Безье: в середине пути — точка, где стоял герой
          e.u = Math.min(1, e.u + dt / e.dur);
          const u = e.u, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
          const vx = 2 * (1 - u) * (e.cx - e.sx) + 2 * u * (e.ex - e.cx), vy = 2 * (1 - u) * (e.cy - e.sy) + 2 * u * (e.ey - e.cy);
          e.x = a * e.sx + b * e.cx + c * e.ex - e.w / 2; e.y = a * e.sy + b * e.cy + c * e.ey - e.h / 2;
          if (Math.abs(vx) > 1) e.dir = Math.sign(vx);
          e.tilt = Math.atan2(vy, Math.abs(vx) + 1);
          if (u >= 1) e.state = 'back';
        } else if (e.state === 'back') { // возвращается на свой круг
          const tx = e.hx + Math.cos(e.ang) * 44, ty = e.hy + Math.sin(e.ang) * 14, vx = tx - e.x, vy = ty - e.y, d = Math.hypot(vx, vy);
          if (d < 4) { e.state = 'circle'; e.cd = api.rand(1.8, 2.8); }
          else { e.x += vx / d * 150 * dt; e.y += vy / d * 150 * dt; if (Math.abs(vx) > 1) e.dir = Math.sign(vx); }
        }
      },
      draw(e, ctx) {
        const dive = e.state === 'dive', scream = e.state === 'scream';
        if (scream && e.tx != null) { // пунктир будущей дуги — та же кривая Безье, в мировых осях (снимаем отражение движка)
          ctx.save(); ctx.scale(e.dir || 1, 1);
          const ox = e.x + e.w / 2, oy = e.y + e.h, sx = 0, sy = -e.h / 2, tx = e.tx - ox, ty = e.ty - oy, ex = 2 * tx, ey = sy - 6;
          ctx.strokeStyle = `rgba(255,70,56,${(0.45 + 0.4 * Math.abs(Math.sin(e.t * 12))).toFixed(3)})`; ctx.lineWidth = 2; ctx.setLineDash([5, 6]);
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(2 * tx - 0.5 * ex, 2 * ty - 0.5 * (sy + ey), ex, ey); ctx.stroke(); ctx.setLineDash([]);
          ctx.restore();
        }
        ctx.translate(0, -7);
        if (dive) ctx.rotate(e.tilt || 0);
        const fl = dive ? 0 : Math.sin(e.t * (scream ? 24 : 10));
        const tipX = dive ? -18 : -11 - Math.abs(fl) * 2, tipY = dive ? -3 : -2 - fl * 15;
        ctx.fillStyle = '#6c7887'; poly(ctx, [3, -2, -5, -1, tipX + 3, tipY - (dive ? 2 : fl * 2)]);  // дальнее крыло
        ctx.fillStyle = '#e9edf1'; poly(ctx, [-8, -2.5, -17, -3.5, -17, 2, -8, 2.5]);              // хвост
        ctx.strokeStyle = 'rgba(28,36,50,.6)'; ctx.lineWidth = 1;
        ctx.fillStyle = '#fbfcfd'; oval(ctx, 0, 0, 11, 5); ctx.stroke();                           // тело
        circle(ctx, 9, -3.5, 4.6); ctx.stroke();                                                    // голова
        ctx.fillStyle = '#ffc233';                                                                  // клюв
        if (scream) { poly(ctx, [12.5, -5, 19.5, -7, 13, -3]); poly(ctx, [12.5, -2, 18, 1.5, 13, -0.8]); ctx.fillStyle = '#c62828'; ctx.fillRect(13, -3.2, 3, 1.4); }
        else { poly(ctx, [12.5, -4.8, 19.5, -3.2, 12.5, -1.8]); ctx.fillStyle = '#e53935'; ctx.fillRect(16.2, -3.3, 1.4, 1.2); }
        ctx.fillStyle = scream ? '#ff2d20' : '#1b1f24'; circle(ctx, 10.4, -4.6, 1.2);             // глаз
        ctx.fillStyle = '#8d9aa8'; poly(ctx, [5, -2.5, -5, -1.5, tipX, tipY]);                     // ближнее крыло
        ctx.fillStyle = '#1f252c'; poly(ctx, [tipX, tipY, lerp(tipX, 5, 0.3), lerp(tipY, -2.5, 0.3), lerp(tipX, -5, 0.35), lerp(tipY, -1.5, 0.35)]);
        if (dive) { ctx.fillStyle = '#ff9f1a'; ctx.fillRect(-6, 4, 5, 1.5); }                      // поджатые лапы
        if (scream) { // крик: красные дуги перед клювом
          ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 1.6;
          for (let k = 0; k < 3; k++) { const r = 4 + ((e.t * 26 + k * 5) % 15); ctx.globalAlpha = Math.max(0, 1 - r / 19); ctx.beginPath(); ctx.arc(18, -3, r, -0.75, 0.75); ctx.stroke(); }
          ctx.globalAlpha = 1;
        }
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2, e.y + e.h / 2, '#ffffff', 10, 120, 120); }, // перья медленно планируют
    },

    rigger: { // монтажник на тросе: качается маятником поперёк пути (±90 ед., период 3 с)
      w: 22, h: 38, hp: 2, pts: 250, flip: false, knockback: false, hitColor: '#ffe066', deathColor: '#ffd23f',
      init(e, api) {
        const span = e.maxX - e.minX, cx = e.x + e.w / 2;
        const gl = api.groundAt(e.minX - 12);                  // сразу за разрывом или над лестницей — место, чтобы выйти не под трос
        const land = gl === null || gl > e.groundY + 20 ? 44 : 0;
        e.amp = api.clamp((span - land) / 2 - 24, 26, 90);
        const lo = e.minX + land + e.amp + 14, hi = e.maxX - e.amp - 14;
        e.ax = lo > hi ? (e.minX + land + e.maxX) / 2 : api.clamp(cx, lo, hi);
        const hy = e.groundY - 18 - e.h;               // в нижней точке ноги на уровне груди героя
        e.len = api.clamp(hy - 46, 90, 150); e.ay = hy - e.len;
        e.th = Math.asin(Math.min(0.9, e.amp / (e.len + 19)));
        e.ph = Math.random() * TAU; e.face = 1;
        placeRigger(e);
        // над фермами маятнику тесно: трос прошёл бы сквозь настил — вместо монтажника прилетает чайка
        if (api.platforms.some(p => p.x < e.ax + e.amp + 30 && p.x + p.w > e.ax - e.amp - 30)) {
          e.gone = true; e.dead = true;
          api.spawnEnemy('gull', e.ax, e.groundY - 110 - Math.random() * 40, { minX: e.minX, maxX: e.maxX, air: true, groundY: e.groundY });
        }
      },
      update(e, dt) { e.ph += TAU / 3 * dt; placeRigger(e); e.face = Math.cos(e.ph) >= 0 ? 1 : -1; },
      onHit(e, api, source) { // удар рейкой отбрасывает маятник обратно — качнётся от героя
        if (source === 'staff' && Math.sign(Math.cos(e.ph)) === Math.sign(api.dx(e))) e.ph = Math.PI - e.ph;
      },
      draw(e, ctx, api) {
        if (e.gone) return;
        const ox = e.x + e.w / 2, oy = e.y + e.h, s = Math.sin(e.cth), c = Math.cos(e.cth);
        const ax = e.ax - ox, ay = e.ay - oy, hx = -19 * s, hy = -19 - 19 * c;  // подвес и руки относительно начала
        ctx.strokeStyle = 'rgba(255,214,90,.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 6]);   // дуга качания ног
        ctx.beginPath(); ctx.arc(ax, ay, e.len + 38, Math.PI / 2 - e.th, Math.PI / 2 + e.th); ctx.stroke(); ctx.setLineDash([]);
        const gy = e.groundY - oy, k = api.clamp(1 - (e.groundY - oy + e.h) / 120, 0.3, 1);      // тень на настиле
        ctx.fillStyle = `rgba(20,20,30,${(0.28 * k).toFixed(3)})`; oval(ctx, 0, gy - 1, 14 * k + 4, 3);
        ctx.strokeStyle = '#1e2329'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ax, Math.min(api.camY - 8, e.ay - 12) - oy); ctx.lineTo(ax, ay - 12); ctx.stroke(); // трос крана сверху
        ctx.fillStyle = '#f2c230'; ctx.fillRect(ax - 7, ay - 16, 14, 11);                       // крюковая обойма
        ctx.fillStyle = '#1e2329'; for (let i = 0; i < 3; i++) poly(ctx, [ax - 7 + i * 5, ay - 5, ax - 3 + i * 5, ay - 16, ax - 1 + i * 5, ay - 16, ax - 5 + i * 5, ay - 5]);
        ctx.strokeStyle = '#1e2329'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ax, ay - 1, 3.5, -0.5, Math.PI); ctx.stroke();
        ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.stroke();   // трос к монтажнику
        ctx.save(); ctx.translate(hx, hy); ctx.rotate(-e.cth); ctx.scale(e.face, 1);
        const lg = Math.sin(e.ph) * 0.35, hurt = e.hp < e.maxHp;
        ctx.strokeStyle = '#23305a'; ctx.lineWidth = 4.5; ctx.lineCap = 'round';                 // ноги болтаются
        ctx.beginPath(); ctx.moveTo(-2.5, 27); ctx.lineTo(-2.5 - Math.sin(lg) * 10, 36); ctx.moveTo(2.5, 27); ctx.lineTo(2.5 + Math.sin(lg + 0.5) * 9, 36); ctx.stroke();
        ctx.fillStyle = '#4a3320'; ctx.fillRect(-2.5 - Math.sin(lg) * 10 - 2, 35, 6, 3.5); ctx.fillRect(2.5 + Math.sin(lg + 0.5) * 9 - 2, 35, 6, 3.5);
        ctx.strokeStyle = '#e8b400'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(-5, 15); ctx.lineTo(-1, 1); ctx.stroke(); // дальняя рука
        ctx.fillStyle = '#ffd23f'; ctx.fillRect(-6.5, 13, 13, 15);                               // сигнальная куртка
        ctx.fillStyle = '#e4eef0'; ctx.fillRect(-6.5, 19, 13, 1.8); ctx.fillRect(-6.5, 23.5, 13, 1.8);
        ctx.strokeStyle = '#1e2329'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-6, 13); ctx.lineTo(5, 26); ctx.moveTo(6, 13); ctx.lineTo(-5, 26); ctx.stroke(); // страховочная привязь
        ctx.fillStyle = '#5a3a1e'; ctx.fillRect(-6.5, 26, 13, 2.5);
        ctx.fillStyle = '#f1c27d'; circle(ctx, 0.5, 9, 4.8);                                      // голова
        ctx.fillStyle = '#222'; ctx.fillRect(2.5, 7.5, 1.6, 1.6); ctx.fillStyle = '#5a3a20'; ctx.fillRect(1.5, 10.5, 4, 1.4);
        ctx.save(); ctx.translate(0.5, 6); if (hurt) ctx.rotate(-0.5);                             // каска: после удара съехала
        ctx.fillStyle = '#d8342a'; ctx.beginPath(); ctx.arc(0, 0, 5.6, Math.PI, 0); ctx.fill(); ctx.fillRect(-6.5, -1, 13, 2);
        ctx.restore();
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(5, 15); ctx.lineTo(1, 1); ctx.stroke(); // ближняя рука
        ctx.fillStyle = '#33383f'; circle(ctx, 0, 0.5, 2.6);                                      // перчатки на тросе
        ctx.restore();
      },
      onDeath(e, api) {
        api.shoot({ x: e.x + e.w / 2, y: e.y + 6, w: 12, h: 7, vx: api.rand(-60, 60), vy: -220, spin: 9, hurts: false, destructible: false, pts: 0, color: '#d8342a', draw: drawHelmet, update: splashIn });
      },
    },

    beaver: { // бобр-строитель: ходит, замирает, бьёт хвостом (0,9 с) и швыряет щепки по короткой дуге
      w: 30, h: 22, hp: 2, pts: 200, hitColor: '#e2b872', deathColor: '#8a5a33',
      init(e) { e.state = 'walk'; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e);
        if (e.state === 'walk') {
          api.patrol(e, 40, dt); e.cd -= dt;
          if (e.cd <= 0 && Math.abs(dx) < 300 && Math.abs(P.y + P.h - e.y - e.h) < 180) { e.state = 'wind'; e.st = 0.9; }
          return;
        }
        e.st -= dt;
        if (e.state === 'wind') {
          e.dir = Math.sign(dx) || e.dir;
          if (e.st > 0) return;
          const tail = e.x + e.w / 2 - e.dir * 26, sx = e.x + e.w / 2 + e.dir * 10, sy = e.y + 4; // шлёп хвостом и бросок
          api.burst(tail, e.y + e.h, '#d7ccb8', 8, 110, 500); api.shake(1.5);
          const aim = api.clamp(P.x + P.w / 2 + P.vx * 0.35 - sx, -250, 250); // с небольшим упреждением
          for (const k of [0.8, 1.1]) {
            const tx = aim * k, tf = api.clamp(Math.abs(tx) / 240, 0.45, 0.85), ty = P.y + P.h * 0.5;
            api.shoot({ x: sx, y: sy, w: 9, h: 7, vx: tx / tf, vy: (ty - sy - 450 * tf * tf) / tf, spin: 11 * (Math.sign(tx) || 1), color: '#e2b872', draw: drawChip, source: e, update: splashIn });
          }
          e.state = 'throw'; e.st = 0.45;
        } else if (e.st <= 0) { e.state = 'walk'; e.cd = api.rand(2.2, 3.2); }
      },
      draw(e, ctx) {
        const walk = e.state === 'walk', wind = e.state === 'wind', thr = e.state === 'throw';
        const leg = walk ? Math.sin(e.t * 14) * 3 : 0, bob = walk ? Math.abs(Math.sin(e.t * 14)) * 1.2 : Math.sin(e.t * 3) * 0.5;
        // хвост-лопата: лежит сзади; перед броском поднимается над спиной и дрожит, затем — шлёп!
        const up = wind ? Math.min(1, (0.9 - e.st) / 0.4) : 0;
        const ta = wind ? up * 1.7 + Math.sin(e.t * 40) * 0.12 * up : thr ? -0.3 : -0.12 + Math.sin(e.t * 2) * 0.05;
        if (wind) ctx.rotate(-0.12 * up);                                            // откидывается назад для броска
        ctx.save(); ctx.translate(-12, -6); ctx.rotate(ta);
        ctx.fillStyle = '#3a271c'; oval(ctx, -12, 0, 12.5, 5);
        ctx.strokeStyle = '#7a5840'; ctx.lineWidth = 0.9; ctx.beginPath();
        for (let i = -21; i < -3; i += 3.5) { ctx.moveTo(i, -3.8); ctx.lineTo(i + 2.5, 3.8); ctx.moveTo(i + 2.5, -3.8); ctx.lineTo(i, 3.8); }
        ctx.stroke();
        ctx.restore();
        if (thr && e.st > 0.3) { ctx.strokeStyle = 'rgba(240,230,210,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(-26, -1, 6 + (0.45 - e.st) * 40, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
        ctx.translate(0, -bob);
        ctx.fillStyle = '#3d2a1e'; oval(ctx, -7 + leg, -1.8, 4.2, 2.2); oval(ctx, 5 - leg, -1.8, 3.6, 2.2); // лапы
        ctx.fillStyle = '#8a5a33'; oval(ctx, -2, -10, 13, 9.5);                                            // туловище
        ctx.fillStyle = '#b58352'; oval(ctx, 3, -7, 7.5, 5.5);                                             // брюшко
        ctx.fillStyle = '#946139'; circle(ctx, 10, -15, 7);                                                // голова
        ctx.fillStyle = '#b58352'; oval(ctx, 15, -12.5, 4.8, 3.6);
        ctx.fillStyle = '#1b1411'; circle(ctx, 19.3, -14.2, 1.9);
        ctx.fillStyle = '#fff'; circle(ctx, 12.4, -17, 2.1); ctx.fillStyle = '#111'; circle(ctx, 13.1, -17, 1.15);
        ctx.fillStyle = '#ff9d2e'; ctx.fillRect(14.6, -10.2, 2.2, 3.8); ctx.fillRect(17, -10.2, 2.2, 3.8);  // оранжевые резцы
        ctx.strokeStyle = 'rgba(30,20,12,.7)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(17, -12.5); ctx.lineTo(23, -13.5); ctx.moveTo(17, -11.5); ctx.lineTo(23, -10.5); ctx.stroke();
        ctx.fillStyle = '#6e4526'; circle(ctx, 4.5, -19, 2.2);                                              // ухо
        ctx.fillStyle = '#ffcf33'; ctx.beginPath(); ctx.arc(9, -20.5, 6.5, Math.PI, 0); ctx.fill(); ctx.fillRect(2, -21, 15, 2); // каска
        ctx.fillStyle = '#e0a800'; ctx.fillRect(8.3, -26.5, 1.4, 5.5);
        if (wind) { const f = Math.floor(e.t * 12) % 2; ctx.fillStyle = f ? '#ff3b1f' : '#ffb300'; ctx.fillRect(7, -29.5, 4, 3); if (f) { ctx.fillStyle = 'rgba(255,80,40,.35)'; circle(ctx, 9, -28, 6); } } // мигалка на каске
        ctx.fillStyle = '#7a4d2b';                                                                          // передние лапы
        if (wind) { oval(ctx, 13, -10 - Math.min(1, (0.9 - e.st) / 0.4) * 4, 2.6, 2.2); ctx.fillStyle = '#ecc27e'; poly(ctx, [11, -16, 16, -17, 17, -13, 12, -12]); }
        else if (thr) oval(ctx, 17, -9, 2.6, 2.2);
        else oval(ctx, 12 + leg * 0.4, -4, 2.4, 2);
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2, e.y + e.h / 2, '#ecc27e', 8, 160); },
    },

    riveter: { // клепальщик: у жаровни на ферме, 1 с ведёт лазерным прицелом и выстреливает раскалённой заклёпкой (её можно отбить)
      w: 24, h: 38, hp: 2, pts: 260, hitColor: '#ffb347', deathColor: '#3b5ba8',
      init(e) { e.state = 'walk'; e.st = 0; e.cd = 1.2 + Math.random(); },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e), tx = P.x + P.w / 2, ty = P.y + P.h * 0.4;
        if (e.state === 'walk') {
          if (Math.abs(dx) < 380) e.dir = Math.sign(dx) || e.dir; else api.patrol(e, 16, dt);
          e.cd -= dt;
          if (e.cd <= 0 && onScreen(e, api) && Math.abs(dx) > 30 && Math.abs(dx) < 340 && Math.abs(ty - e.y) < 280) { e.state = 'aim'; e.st = 1.05; e.tx = tx; e.ty = ty; }
          return;
        }
        e.st -= dt;
        if (e.state === 'aim') {
          if (e.st > 0.35) { e.dir = Math.sign(dx) || e.dir; e.tx = tx; e.ty = ty; } // ведёт цель; последние 0,35 с прицел замер и мигает
          if (e.st > 0) return;
          const ox = e.x + e.w / 2 + e.dir * 19, oy = e.y + e.h - 24, vx = e.tx - ox, vy = e.ty - oy, d = Math.hypot(vx, vy) || 1;
          api.shoot({ x: ox, y: oy, w: 10, h: 6, vx: vx / d * 330, vy: vy / d * 330, gravity: 0, life: 1.7, reflectable: true, source: e, pts: 15, color: '#ff9a3c', draw: drawRivet, update: rivetUpd });
          api.burst(ox, oy, '#ffd27a', 5, 90, 200);
          e.state = 'cool'; e.st = 0.6;
        } else if (e.st <= 0) { e.state = 'walk'; e.cd = api.rand(2.2, 3.2); }
      },
      draw(e, ctx, api) {
        const aim = e.state === 'aim', t = e.t, lock = aim && e.st <= 0.35;
        if (aim && e.tx != null) { // лазерный прицел — в мировых осях (снимаем отражение движка)
          ctx.save(); ctx.scale(e.dir || 1, 1);
          const ox = (e.dir || 1) * 19, oy = -24, px = e.tx - (e.x + e.w / 2), py = e.ty - (e.y + e.h);
          ctx.strokeStyle = lock ? (Math.floor(t * 18) % 2 ? '#ff2d20' : '#ffd0c8') : 'rgba(255,60,50,.55)';
          ctx.lineWidth = lock ? 1.6 : 1; if (!lock) ctx.setLineDash([6, 5]);
          ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(px, py, lock ? 6 : 9, 0, TAU); ctx.moveTo(px - 12, py); ctx.lineTo(px - 4, py); ctx.moveTo(px + 4, py); ctx.lineTo(px + 12, py); ctx.stroke();
          ctx.restore();
        }
        const fl = 0.5 + 0.5 * Math.sin(t * 13) * Math.sin(t * 7);                           // жаровня с заклёпками за спиной
        ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(-15, -12); ctx.moveTo(-8, 0); ctx.lineTo(-13, -12); ctx.stroke();
        ctx.fillStyle = `rgba(255,140,40,${(0.18 + 0.15 * fl).toFixed(3)})`; circle(ctx, -14, -16, 9);
        ctx.fillStyle = '#3a3d44'; poly(ctx, [-22, -16, -6, -16, -9, -11, -19, -11]);
        ctx.fillStyle = fl > 0.5 ? '#ffb347' : '#ff7a1f'; for (let k = 0; k < 4; k++) circle(ctx, -18.5 + k * 3, -16.5, 1.6);
        ctx.fillStyle = '#ffd27a'; for (let k = 0; k < 2; k++) { const ph = (t * 0.9 + k * 0.5) % 1; ctx.fillRect(-15 + k * 3 + Math.sin(t * 5 + k) * 2, -19 - ph * 16, 1.2, 1.2); }
        const walk = e.state === 'walk' && Math.abs(api.dx(e)) >= 380, sw = walk ? Math.sin(t * 8) * 4 : 0;
        ctx.strokeStyle = '#26324f'; ctx.lineWidth = 4.5; ctx.lineCap = 'round';          // ноги
        ctx.beginPath(); ctx.moveTo(-2, -16); ctx.lineTo(-3 + sw, -2); ctx.moveTo(2, -16); ctx.lineTo(3 - sw, -2); ctx.stroke();
        ctx.fillStyle = '#3a2718'; ctx.fillRect(-6 + sw, -3, 7, 3); ctx.fillRect(-1 - sw, -3, 7, 3);
        ctx.fillStyle = '#3b5ba8'; ctx.fillRect(-7, -33, 14, 18);                             // синяя роба
        ctx.fillStyle = '#7a5231'; poly(ctx, [-2, -29, 8, -29, 9, -12, -1, -12]);             // кожаный фартук
        ctx.fillStyle = '#5c3b22'; ctx.fillRect(-2, -29, 10, 1.5);
        ctx.fillStyle = '#f1c27d'; circle(ctx, 1, -38, 5.5);                                  // голова
        ctx.fillStyle = '#1b1f24'; ctx.fillRect(1, -40.5, 6, 3); ctx.fillStyle = aim ? '#ff4a3a' : '#7fd3e6'; ctx.fillRect(3, -40, 3, 2); // очки
        ctx.fillStyle = '#e8e8e8'; ctx.beginPath(); ctx.arc(0.5, -41, 6.5, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -42, 15, 2); // белая каска
        ctx.save(); ctx.translate(4, -25); if (!aim) ctx.rotate(0.35 + Math.sin(t * 2) * 0.05);   // пневмомолоток
        ctx.fillStyle = '#6b7380'; ctx.fillRect(0, -3.5, 14, 7); ctx.fillStyle = '#9aa3ae'; ctx.fillRect(0, -3.5, 14, 1.5);
        ctx.fillStyle = '#2b2f36'; ctx.fillRect(2, 3, 4, 6); ctx.fillRect(13, -2, 4, 4);
        if (aim) { ctx.fillStyle = `rgba(255,120,40,${(0.4 + 0.5 * Math.abs(Math.sin(t * 20))).toFixed(3)})`; circle(ctx, 17, 0, 3 + (lock ? 2 : 0)); }
        ctx.restore();
        ctx.strokeStyle = '#3b5ba8'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(-1, -30); ctx.lineTo(5, -24); ctx.stroke(); // рука
        ctx.strokeStyle = '#2d2f36'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(4, -19); ctx.quadraticCurveTo(-4, -8, -9, -12); ctx.stroke(); // шланг к компрессору
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2, e.y + e.h - 14, '#ff9a3c', 10, 150, 500); },
    },

    fencer: { // монтажник со щитом ограждения: спереди рейка звенит о щит; 0,9 с упирается — и таранит, потом выдыхается
      w: 26, h: 40, hp: 2, pts: 280, heavy: true, hitColor: '#f4f4f4', deathColor: '#d6392b',
      init(e) { e.state = 'walk'; e.st = 0; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e), same = Math.abs(P.y + P.h - e.y - e.h) < 40;
        if (e.state === 'walk') {
          if (Math.abs(dx) < 260 && same) e.dir = Math.sign(dx) || e.dir; // держит щит к герою
          api.patrol(e, Math.abs(dx) < 260 && same ? 14 : 34, dt);
          e.cd -= dt;
          if (e.cd <= 0 && same && Math.abs(dx) < 230 && Math.abs(dx) > 26) { e.state = 'brace'; e.st = 0.9; e.dir = Math.sign(dx) || e.dir; }
          return;
        }
        e.st -= dt;
        if (e.state === 'brace') { if (e.st <= 0) { e.state = 'rush'; e.st = 1.3; } }
        else if (e.state === 'rush') { // бежит, пока не упрётся в край своего пролёта
          const x0 = e.x; e.x = api.clamp(e.x + e.dir * 190 * dt, e.minX, e.maxX - e.w);
          if (Math.random() < dt * 20) api.burst(e.x + e.w / 2 - e.dir * 10, e.y + e.h, '#cfc6b4', 1, 60, 300);
          if (e.st <= 0 || Math.abs(e.x - x0) < 0.01) { e.state = 'tired'; e.st = 1.7; api.shake(2); }
        } else if (e.state === 'tired') { if (e.st <= 0) { e.state = 'walk'; e.cd = api.rand(1.4, 2.4); } }
      },
      onHit(e, api, source) { // щит держит удары спереди; сзади, сверху или пока отдыхает — больно
        if (source === 'stomp' || e.state === 'tired') return;
        if (Math.sign(api.dx(e)) === e.dir) { api.burst(e.x + e.w / 2 + e.dir * 14, e.y + 16, '#fff6d0', 6, 140); return false; }
      },
      draw(e, ctx, api) {
        const t = e.t, st = e.state, rush = st === 'rush', tired = st === 'tired', brace = st === 'brace';
        const sw = rush ? Math.sin(t * 22) * 7 : st === 'walk' ? Math.sin(t * 9) * 3 : 0;
        const lean = rush ? 0.22 : brace ? -0.08 + Math.sin(t * 40) * 0.03 : tired ? 0.35 : 0;
        if (brace) { ctx.fillStyle = 'rgba(207,198,180,.6)'; for (let k = 0; k < 3; k++) oval(ctx, -8 - k * 5 - ((t * 30) % 6), -2, 3 + k, 1.6); }
        ctx.strokeStyle = '#2f3a2a'; ctx.lineWidth = 5; ctx.lineCap = 'round';              // ноги
        ctx.beginPath(); ctx.moveTo(-1, -17); ctx.lineTo(-3 + sw, -2); ctx.moveTo(1, -17); ctx.lineTo(3 - sw, -2); ctx.stroke();
        ctx.fillStyle = '#3a2718'; ctx.fillRect(-7 + sw, -3.5, 8, 3.5); ctx.fillRect(-1 - sw, -3.5, 8, 3.5);
        ctx.save(); ctx.translate(0, -17); ctx.rotate(lean);
        ctx.fillStyle = '#4f7a3a'; ctx.fillRect(-7, -19, 13, 19);                              // зелёная куртка
        ctx.fillStyle = '#c6ff3a'; ctx.fillRect(-7, -12, 13, 2.5); ctx.fillRect(-7, -6, 13, 2.5); // светоотражающие полосы
        ctx.fillStyle = '#f1c27d'; circle(ctx, 1, -24, 5.5);
        ctx.fillStyle = '#222'; ctx.fillRect(3, -26, 2, 2);
        ctx.fillStyle = '#ff8a1a'; ctx.beginPath(); ctx.arc(0.5, -27, 6.5, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -28, 15, 2); // оранжевая каска
        ctx.strokeStyle = '#4f7a3a'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(9, -11); ctx.stroke(); // руки к щиту
        if (tired) { ctx.fillStyle = '#9fd8ff'; oval(ctx, -6, -30 - ((t * 20) % 8), 1.4, 2); api.text('уф', -12, -34, 8, '#f4f1e8'); }
        ctx.restore();
        ctx.save(); ctx.translate(12, 0); ctx.rotate(tired ? 0.45 : rush ? 0.12 : 0);             // щит: секция ограждения, в конце тарана опущена
        ctx.fillStyle = '#2b2f36'; ctx.fillRect(-1, -40, 3, 38); ctx.fillRect(6, -40, 3, 38);
        ctx.save(); ctx.beginPath(); ctx.rect(1, -39, 6, 34); ctx.clip();
        ctx.fillStyle = '#f4f4f4'; ctx.fillRect(1, -39, 6, 34);
        ctx.fillStyle = '#d6392b'; for (let y = -46; y < -4; y += 10) poly(ctx, [1, y + 6, 7, y, 7, y + 5, 1, y + 11]);
        ctx.restore();
        ctx.fillStyle = '#cfd6dc'; ctx.fillRect(-2, -3, 12, 3);
        ctx.restore();
        if (brace) { const on = Math.floor(t * 10) % 2; ctx.fillStyle = on ? '#ff3b30' : '#ffd23a'; poly(ctx, [2, -60, -5, -48, 9, -48]); api.text('!', 2, -49.5, 9, '#1d1d1f'); }
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2 + e.dir * 12, e.y + 20, '#f4f4f4', 8, 160); },
    },
  };

  // ---------- механика участка: порывы ветра и всплески ----------
  function supportAt(x, feet, api) { // есть ли в точке x опора на уровне ног (настил, блок или ферма)
    for (const s of api.solids) if (x >= s.x && x <= s.x + s.w && Math.abs(s.y - feet) < 2) return true;
    for (const p of api.platforms) if (x >= p.x && x <= p.x + p.w && Math.abs(p.y - feet) < 2) return true;
    return false;
  }
  function windPush(P, d, api) { // сносит, только если по ветру ещё есть опора (запас 14 ед. до края) и нет стены
    const nx = P.x + d, probe = d > 0 ? nx + P.w + 14 : nx - 14;
    if (!supportAt(probe, P.y + P.h, api)) return;
    const box = { x: nx, y: P.y, w: P.w, h: P.h - 1 };
    for (const s of api.solids) if (api.overlap(box, s)) return;
    P.x = nx;
  }

  function update(dt, api) {
    const w = st.wind, P = api.player;
    w.t -= dt;
    if (w.phase === 'calm' && w.t <= 0) { w.phase = 'warn'; w.t = WIND_WARN; w.dir = Math.random() < 0.5 ? -1 : 1; }
    else if (w.phase === 'warn' && w.t <= 0) { w.phase = 'gust'; w.t = WIND_LEN; }
    else if (w.phase === 'gust' && w.t <= 0) { w.phase = 'calm'; w.t = api.rand(4, 7); } // с предупреждением и порывом — цикл 7–10 с
    w.k += ((w.phase === 'gust' ? 1 : w.phase === 'warn' ? 0.4 : 0) - w.k) * Math.min(1, dt * 5);
    if (w.phase === 'gust' && P.onGround && !P.climb) windPush(P, w.dir * WIND_V * Math.min(1, (WIND_LEN - w.t) * 4, w.t * 4) * dt, api);
    // падение в разрыв: всплеск и расходящиеся круги (герой просто пролетает сквозь воду — дальше движок)
    const feet = P.y + P.h;
    if (!st.wet && feet > WATER && api.groundAt(P.x + P.w / 2) === null) {
      st.wet = true;
      api.burst(P.x + P.w / 2, WATER, '#eafcff', 18, 280, 900); api.burst(P.x + P.w / 2, WATER, '#7fd3e6', 10, 200, 900);
      if (st.splashes.length < 4) st.splashes.push({ x: P.x + P.w / 2, t: 0 });
    }
    if (feet < WATER - 60) st.wet = false;
    for (let i = st.splashes.length - 1; i >= 0; i--) if ((st.splashes[i].t += dt) > 0.9) st.splashes.splice(i, 1);
  }

  function drawForeground(ctx) { // всплески: столб воды и расходящиеся круги
    for (const s of st.splashes) {
      const k = s.t / 0.9, h = Math.sin(Math.min(1, k * 1.6) * Math.PI) * 42;
      ctx.fillStyle = 'rgba(232,250,255,.85)'; if (h > 1) poly(ctx, [s.x - 7, WATER, s.x - 2, WATER - h, s.x + 2, WATER - h * 0.8, s.x + 7, WATER]);
      ctx.strokeStyle = `rgba(235,250,255,${(0.9 * (1 - k)).toFixed(3)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(s.x, WATER + 1, 8 + k * 34, 2 + k * 5, 0, 0, TAU); ctx.stroke();
    }
  }

  function drawOverlay(ctx, api) { // порыв: белые струи, листья и табло-предупреждение под полосой HUD
    const w = st.wind;
    if (w.k < 0.03) return;
    const { W, now, hash } = api, d = w.dir, span = W + 240;
    ctx.strokeStyle = `rgba(255,255,255,${(0.16 + 0.44 * w.k).toFixed(3)})`; ctx.lineWidth = 1.3; ctx.beginPath();
    const n = Math.round(4 + 26 * w.k);
    for (let i = 0; i < n; i++) {
      const h1 = hash(i * 7 + 3), h2 = hash(i * 13 + 11), len = 34 + h1 * 80;
      let x = (h2 * span + now * (560 + h1 * 420)) % span - 120; if (d < 0) x = W - x;
      const y = 40 + hash(i * 29 + 5) * 290;
      ctx.moveTo(x, y); ctx.quadraticCurveTo(x - d * len * 0.5, y + Math.sin(now * 5 + i) * 3, x - d * len, y - 2);
    }
    ctx.stroke();
    if (w.phase === 'gust') for (let i = 0; i < 9; i++) { // листья и клочки бумаги кувыркаются по ветру
      const h1 = hash(i * 17 + 1), h2 = hash(i * 23 + 9);
      let x = (h1 * span + now * (380 + h2 * 200)) % span - 120; if (d < 0) x = W - x;
      ctx.save(); ctx.translate(x, 60 + h2 * 260 + Math.sin(now * 3 + i) * 14); ctx.rotate(now * (4 + h1 * 6));
      ctx.fillStyle = i % 3 ? (i % 2 ? '#e0a040' : '#7fae4a') : '#f4f1e8'; ctx.fillRect(-3, -1.5, 6, 3);
      ctx.restore();
    }
    const on = w.phase !== 'warn' || Math.floor(now * 8) % 2 === 0, cx = W / 2;
    ctx.globalAlpha = Math.min(1, w.k * 2.5);
    ctx.fillStyle = 'rgba(6,28,42,.72)'; ctx.fillRect(cx - 74, 35, 148, 21);
    ctx.fillStyle = on ? '#26c6da' : '#0e5561'; ctx.fillRect(cx - 74, 35, 148, 2);
    api.text('ПОРЫВ ВЕТРА', cx - d * 10, 50, 11, on ? '#e6fcff' : '#8cc6cf');
    ctx.strokeStyle = on ? '#26c6da' : '#2f7580'; ctx.lineWidth = 2; ctx.beginPath();
    for (let k = 0; k < 3; k++) { const ax = cx + d * (46 + k * 7); ctx.moveTo(ax - d * 3, 41); ctx.lineTo(ax + d * 2, 45.5); ctx.lineTo(ax - d * 3, 50); }
    ctx.stroke();
    if (w.phase === 'gust') { ctx.fillStyle = '#26c6da'; ctx.fillRect(cx - 74, 54, 148 * w.t / WIND_LEN, 2); }
    ctx.globalAlpha = 1;
  }

  registerTheme({
    index: 7, id: 'bridge',
    title: 'Мост через реку', subtitle: 'Монтаж пролётов над водой',
    accent: '#26c6da', dust: '#cfc6b4',
    gen: { length: 3900, weights: { pit: 28, platforms: 20, step: 10, obstacle: 14, flat: 28 }, groundRange: [232, 288], obstacleH: 30, obstacleW: 46 },
    decor: ['lamp', 'lamp', 'rope', 'buoy', 'flag', 'windsock', 'sign'],
    enemies,
    enemyTable: [
      { type: 'beaver', where: 'ground', weight: 3 },
      { type: 'gull', where: 'air', weight: 3 },
      { type: 'rigger', where: 'air', weight: 2, from: 0.12 },
      { type: 'fencer', where: 'ground', weight: 2, from: 0.2 },
      { type: 'beaver', where: 'upper', weight: 1 },
      { type: 'riveter', where: 'upper', weight: 3, from: 0.08 },
    ],
    init(api) {
      Object.assign(st.wind, { phase: 'calm', t: api.rand(5, 7), k: 0 });
      st.splashes.length = 0; st.wet = false;
      fixTinySteps(api);
    },
    update, drawBackground, drawGround, drawPit, drawPlatform, drawObstacle, drawDecor, drawFinish, drawLadder, drawForeground, drawOverlay,
  });
})();
