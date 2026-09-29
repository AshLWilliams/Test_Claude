'use strict';
// Участок 10 — плотина ГЭС ночью: сдача объекта приёмочной комиссии и финальный босс. См. THEMES.md.
(() => {
  // состояние темы (сбрасывается в init): отпечатки печатей и трещины на бетоне, салют победы, остов экскаватора
  const S = { decals: [], cel: null, wreck: null };
  const addDecal = d => { d.t = 0; d.r = (Math.random() - 0.5) * 0.3; S.decals.push(d); if (S.decals.length > 14) S.decals.shift(); };

  // ---------- фон ----------
  function ridge(ctx, api, p, step, base, amp, seed, color) { // горный хребет — ломаная по случайным вершинам
    const off = api.camX * p, i0 = Math.floor(off / step) - 1, i1 = Math.ceil((off + api.W) / step) + 1; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(i0 * step - off, 250);
    for (let i = i0; i <= i1; i++) ctx.lineTo(i * step - off, base + api.hash(i * 13 + seed) * amp);
    ctx.lineTo(i1 * step - off, 250); ctx.fill();
  }
  const crestY = xl => 146 + Math.min(46, Math.pow((xl - 800) / 800, 2) * 46); // гребень арочной плотины — дуга
  const glow = (ctx, x, y, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };

  function drawBackground(ctx, api) {
    const { W, camX, hash, now } = api, g = ctx.createLinearGradient(0, 0, 0, 240); g.addColorStop(0, '#030819'); g.addColorStop(0.6, '#0b1b42'); g.addColorStop(1, '#1b3a70');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 250); // ниже всё закрыто парапетом и гребнем
    ctx.fillStyle = '#e4ecff'; // звёзды мерцают
    for (let i = 0; i < 120; i++) {
      const x = ((hash(i * 7 + 1) * 1900 - camX * 0.02) % 1900 + 1900) % 1900, s = hash(i * 7 + 3) > 0.87 ? 2 : 1.1;
      if (x < W) { ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(now * (0.5 + hash(i * 7 + 4) * 1.6) + i)); ctx.fillRect(x, 32 + hash(i * 7 + 2) * 120, s, s); }
    }
    ctx.globalAlpha = 1; const mx = W * 0.24 - camX * 0.01; // луна
    glow(ctx, mx, 66, 28, 'rgba(190,210,255,.08)'); glow(ctx, mx, 66, 13, '#e9efff');
    ctx.fillStyle = '#c5d0ea'; ctx.beginPath(); ctx.arc(mx - 4, 62, 3, 0, 7); ctx.moveTo(mx + 6, 70); ctx.arc(mx + 4, 70, 2, 0, 7); ctx.fill();

    // горы и ЛЭП по хребту: опоры, провода, мигающие красные огни
    ridge(ctx, api, 0.03, 64, 96, 52, 3, '#0a1633'); ridge(ctx, api, 0.07, 48, 122, 44, 11, '#0e1e40'); let off = camX * 0.07;
    const tw = 192, towerY = j => 122 + hash(j * 13 + 11) * 44, k0 = Math.floor(off / tw) - 1, k1 = Math.ceil((off + W) / tw) + 1;
    ctx.strokeStyle = 'rgba(140,160,200,.35)'; ctx.lineWidth = 0.8; ctx.beginPath();
    for (let k = k0; k < k1; k++) {
      const xa = k * tw - off, ya = towerY(k * 4) - 36, xb = xa + tw, yb = towerY(k * 4 + 4) - 36;
      for (const d of [-10, 10]) { ctx.moveTo(xa + d, ya); ctx.quadraticCurveTo((xa + xb) / 2 + d, Math.max(ya, yb) + 16, xb + d, yb); }
    }
    ctx.stroke(); ctx.strokeStyle = '#3e5480'; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = k0; k <= k1; k++) {
      const x = k * tw - off, y = towerY(k * 4);
      ctx.moveTo(x - 7, y + 4); ctx.lineTo(x - 2, y - 40); ctx.lineTo(x + 2, y - 40); ctx.lineTo(x + 7, y + 4); ctx.moveTo(x - 12, y - 36); ctx.lineTo(x + 12, y - 36); ctx.moveTo(x - 9, y - 28); ctx.lineTo(x + 9, y - 28);
      ctx.moveTo(x - 6, y - 4); ctx.lineTo(x + 4, y - 18); ctx.lineTo(x - 3, y - 32); ctx.moveTo(x + 6, y - 4); ctx.lineTo(x - 4, y - 18); ctx.lineTo(x + 3, y - 32);
    }
    ctx.stroke();
    for (let k = k0; k <= k1; k++) if (Math.sin(now * 2.6 + k * 1.7) > 0.2) { const x = k * tw - off, y = towerY(k * 4) - 43; glow(ctx, x, y, 5, 'rgba(255,60,60,.3)'); ctx.fillStyle = '#ff4a4a'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }

    // водохранилище за гребнем: бегущие блики и лунная дорожка
    ctx.fillStyle = '#0d2550'; ctx.fillRect(0, 150, W, 50); ctx.fillStyle = '#28508c'; ctx.fillRect(0, 150, W, 1.5); off = camX * 0.1; ctx.fillStyle = '#9cc4ff';
    for (let i = Math.floor(off / 22) - 1; i < (off + W) / 22 + 1; i++) {
      const h1 = hash(i * 5 + 2), a = Math.sin(now * (0.8 + h1 * 1.5) + i * 2.3);
      if (a > 0.15) { ctx.globalAlpha = a * 0.6; ctx.fillRect(i * 22 - off + hash(i * 5) * 16 + Math.sin(now * 0.6 + i) * 3, 154 + h1 * 40, 4 + hash(i * 5 + 3) * 12, 1); }
    }
    ctx.fillStyle = '#dfe7ff';
    for (let k = 0; k < 7; k++) { const w = 13 - k * 1.3 + Math.sin(now * 2 + k) * 3; ctx.globalAlpha = 0.6 - k * 0.06; ctx.fillRect(mx - w / 2 + Math.sin(now * 1.3 + k * 1.7) * 2, 154 + k * 5, w, 1.4); }
    ctx.globalAlpha = 1;

    // арочная плотина: массив бетона, гребень дугой, швы блоков, огни галерей
    off = camX * 0.2;
    const st = 24, j0 = Math.floor(off / st) - 1, j1 = Math.ceil((off + W) / st) + 1, line = dy => { for (let j = j0; j <= j1; j++) { const x = j * st - off, y = crestY(j * st) + dy; if (j === j0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } };
    ctx.fillStyle = '#46546f'; ctx.beginPath(); ctx.moveTo(j0 * st - off, 250); line(0); ctx.lineTo(j1 * st - off, 250); ctx.fill();
    ctx.strokeStyle = 'rgba(8,16,34,.3)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let j = j0 + (j0 & 1); j <= j1; j += 2) { const x = j * st - off; ctx.moveTo(x, crestY(j * st) + 3); ctx.lineTo(x, 250); }
    ctx.stroke(); ctx.strokeStyle = 'rgba(160,180,220,.1)'; ctx.beginPath(); for (const dy of [16, 34, 56, 82]) line(dy);
    ctx.stroke(); ctx.strokeStyle = '#8b9bba'; ctx.lineWidth = 2.5; ctx.beginPath(); line(0); ctx.stroke(); // парапет гребня в лунном свете
    ctx.fillStyle = '#ffd27a'; for (let j = j0; j <= j1; j++) { const h = hash(j * 3 + 7); if (h > 0.45) ctx.fillRect(j * st - off + 6, crestY(j * st) + 22 + h * 40, 4, 2); }
    for (let j = j0 + (j0 & 1); j <= j1; j += 2) { const x = j * st - off + 12, y = crestY(j * st + 12) - 3; glow(ctx, x, y, 4, 'rgba(255,220,140,.22)'); ctx.fillStyle = '#ffe6a0'; ctx.fillRect(x - 1, y - 1, 2, 2); }
    for (let i = Math.floor(off / 700) - 1; i < (off + W) / 700 + 1; i++) { // водосбросы: быки, падающая вода, брызги у подножия
      const x0 = i * 700 - off + 250, cy = crestY(i * 700 + 290), gx = x0 + 10 + (Math.sin(now * 0.25 + i) * 0.5 + 0.5) * 50; if (x0 > W + 20 || x0 + 100 < 0) continue;
      for (let b = 0; b < 3; b++) {
        const x = x0 + b * 26; ctx.fillStyle = 'rgba(214,236,255,.92)'; ctx.fillRect(x + 6, cy + 2, 20, 250 - cy); ctx.fillStyle = '#86b4e0';
        for (let k = 0; k < 10; k++) ctx.fillRect(x + 8 + (k * 5) % 15, cy + 4 + ((k * 13 + now * 150 + b * 5) % (244 - cy)), 2, 7);
      }
      ctx.fillStyle = '#34405a'; for (let b = 0; b <= 3; b++) ctx.fillRect(x0 + b * 26, cy - 12, 6, 262 - cy);
      ctx.fillStyle = '#5f6f8f'; ctx.fillRect(x0 - 4, cy - 14, 92, 4); // затворный мост и козловой кран
      ctx.strokeStyle = '#d99a00'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(gx, cy - 14); ctx.lineTo(gx + 3, cy - 30); ctx.lineTo(gx + 17, cy - 30); ctx.lineTo(gx + 20, cy - 14); ctx.stroke();
      ctx.fillStyle = '#f4f9ff';
      for (let k = 0; k < 10; k++) { const ph = (now * 0.5 + k / 10) % 1; ctx.globalAlpha = 0.6 * (1 - ph); ctx.beginPath(); ctx.arc(x0 + 8 + (k * 23) % 74, 242 - ph * 36, 3 + ph * 9, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
    }

    // машинный зал у подножия: высокие светлые окна, мостовой кран внутри, неоновая «ГЭС»
    off = camX * 0.3;
    for (let i = Math.floor(off / 1000) - 1; i < (off + W) / 1000 + 1; i++) {
      const x = i * 1000 - off + 460, w = 362, top = 204, cx = x + 40 + (Math.sin(now * 0.2 + i) * 0.5 + 0.5) * 260; if (x > W || x + w < 0) continue;
      ctx.fillStyle = 'rgba(255,190,90,.08)'; ctx.fillRect(x - 12, top - 10, w + 24, 56);
      ctx.fillStyle = '#26324c'; ctx.fillRect(x, top, w, 46); ctx.fillStyle = '#1b2438'; ctx.fillRect(x - 4, top - 5, w + 8, 6);
      ctx.fillStyle = '#ffcf70'; for (let k = 0; k < 14; k++) ctx.fillRect(x + 12 + k * 25, top + 10, 14, 30);
      ctx.fillStyle = '#26324c'; ctx.fillRect(x + 12, top + 22, 350, 2); for (let k = 0; k < 14; k++) ctx.fillRect(x + 18 + k * 25, top + 10, 1.5, 30);
      ctx.fillStyle = 'rgba(30,40,62,.85)'; ctx.fillRect(x + 12, top + 12, 350, 3); ctx.fillRect(cx, top + 12, 18, 7); ctx.fillRect(cx + 8, top + 19, 1.5, 12); // мостовой кран в окнах
      api.text('ГЭС', x + w / 2, top - 8, 16, 'rgba(255,93,93,.3)'); api.text('ГЭС', x + w / 2, top - 9, 14, '#ff5d5d');
    }

    // ближний план: прожекторные мачты с бегущими лучами и парапет с фонарями
    off = camX * 0.5;
    for (let i = Math.floor(off / 540) - 1; i < (off + W) / 540 + 1; i++) {
      const x = i * 540 - off + 120 + hash(i + 40) * 200, ly = 96; if (x < -200 || x > W + 200) continue; ctx.fillStyle = 'rgba(190,215,255,.07)';
      for (let b = 0; b < 2; b++) {
        const a = -Math.PI / 2 + Math.sin(now * (0.3 + b * 0.13) + i * 1.9 + b * 2) * 0.75;
        ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x + Math.cos(a - 0.08) * 420, ly + Math.sin(a - 0.08) * 420); ctx.lineTo(x + Math.cos(a + 0.08) * 420, ly + Math.sin(a + 0.08) * 420); ctx.fill();
      }
      ctx.strokeStyle = '#3a4866'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 4, 250); ctx.lineTo(x - 3, ly + 8); ctx.moveTo(x + 4, 250); ctx.lineTo(x + 3, ly + 8);
      for (let y = 250; y > ly + 20; y -= 12) { ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y - 12); }
      ctx.stroke(); glow(ctx, x, ly, 13, 'rgba(255,248,220,.2)'); ctx.fillStyle = '#26324a'; ctx.fillRect(x - 12, ly - 6, 24, 14);
      ctx.fillStyle = '#fff6d6'; for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) ctx.fillRect(x - 10 + c * 7, ly - 4 + r * 6, 5, 4);
    }
    ctx.fillStyle = '#26314b'; ctx.fillRect(0, 246, W, 60); ctx.fillStyle = '#3e4c6b'; ctx.fillRect(0, 244, W, 4);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let i = Math.floor(off / 60) - 1; i < (off + W) / 60 + 1; i++) ctx.fillRect(i * 60 - off, 248, 1.5, 58);
    for (let i = Math.floor(off / 150) - 1; i < (off + W) / 150 + 1; i++) { // фонари: тёплый конус света на парапет
      const x = i * 150 - off + 40;
      ctx.fillStyle = 'rgba(255,215,140,.08)'; ctx.beginPath(); ctx.moveTo(x + 5, 209); ctx.lineTo(x + 10, 209); ctx.lineTo(x + 24, 245); ctx.lineTo(x - 9, 245); ctx.fill();
      ctx.fillStyle = '#39465f'; ctx.fillRect(x - 1, 206, 2.5, 40); ctx.fillRect(x - 1, 205, 11, 2);
      glow(ctx, x + 7.5, 208.5, 4, 'rgba(255,220,150,.4)'); ctx.fillStyle = '#ffe3a0'; ctx.fillRect(x + 5, 207, 5, 2.5); ctx.fillStyle = 'rgba(255,215,140,.2)'; ctx.fillRect(x - 8, 244, 30, 3);
    }
  }

  // ---------- земля, провалы, платформы, препятствия ----------
  function drawDecals(s, ctx, api) { // отпечатки печатей и трещины от ковша на лицевой грани гребня
    for (const d of S.decals) {
      if (d.x < s.x + 10 || d.x > s.x + s.w - 10 || Math.abs(d.y - s.y) > 2) continue;
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, (6 - d.t) / 1.5)) * 0.9; ctx.translate(d.x, s.y);
      if (d.crack) {
        ctx.strokeStyle = '#161c28'; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(-22, 3); ctx.lineTo(-10, 7); ctx.lineTo(-4, 1); ctx.lineTo(0, 0); ctx.lineTo(8, 6); ctx.lineTo(21, 2);
        ctx.moveTo(0, 0); ctx.lineTo(3, 12); ctx.lineTo(-3, 22); ctx.lineTo(1, 34); ctx.moveTo(3, 12); ctx.lineTo(12, 19); ctx.stroke();
      } else {
        ctx.translate(0, 21); ctx.rotate(d.r); ctx.strokeStyle = d.c;
        ctx.lineWidth = 1.5; ctx.strokeRect(-d.w / 2, -7, d.w, 14); ctx.lineWidth = 0.8; ctx.strokeRect(-d.w / 2 + 2, -5, d.w - 4, 10); api.text(d.txt, 0, 2.5, 6.5, d.c);
      }
      ctx.restore();
    }
  }

  function drawGround(s, ctx, api) { // гребень плотины: бетон, жёлтая разметка края, стойки ограждения
    const { H, hash } = api, A = api.arena, isArena = A && s.x === A.x1; if (isArena) drawArenaBack(s, ctx, api);
    const g = ctx.createLinearGradient(0, s.y, 0, H); g.addColorStop(0, '#8792a6'); g.addColorStop(0.3, '#5d687d'); g.addColorStop(1, '#232a39');
    ctx.fillStyle = g; ctx.fillRect(s.x - 0.5, s.y, s.w + 1, H - s.y + 10); // +1 — без щелей на стыках
    ctx.strokeStyle = '#6c7c9a'; ctx.lineWidth = 2; ctx.beginPath(); // ограждение (позади героя)
    for (let x = Math.ceil((s.x + 8) / 36) * 36; x < s.x + s.w - 4; x += 36) { ctx.moveTo(x, s.y); ctx.lineTo(x, s.y - 17); }
    ctx.stroke(); ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(s.x + 4, s.y - 16); ctx.lineTo(s.x + s.w - 4, s.y - 16); ctx.moveTo(s.x + 4, s.y - 9); ctx.lineTo(s.x + s.w - 4, s.y - 9); ctx.stroke();
    ctx.fillStyle = '#b8c1ce'; ctx.fillRect(s.x, s.y, s.w, 5); ctx.fillStyle = '#e8edf3'; ctx.fillRect(s.x, s.y, s.w, 1);
    ctx.fillStyle = '#f2c230'; for (let x = Math.ceil(s.x / 28) * 28; x < s.x + s.w - 6; x += 28) ctx.fillRect(Math.max(x, s.x), s.y + 6, 16, 3);
    ctx.fillStyle = 'rgba(15,22,36,.35)'; // швы блоков бетонирования
    for (let x = Math.ceil(s.x / 64) * 64; x < s.x + s.w; x += 64) ctx.fillRect(x, s.y + 12, 1.5, H - s.y);
    ctx.fillRect(s.x, s.y + 34, s.w, 1.5); ctx.fillRect(s.x, s.y + 70, s.w, 1.5);
    for (let x = Math.ceil(s.x / 64) * 64 + 32; x < s.x + s.w - 8; x += 64) { // дренажные отверстия и потёки
      glow(ctx, x, s.y + 45, 2.5, '#1b2230'); ctx.fillStyle = 'rgba(20,30,48,.28)'; ctx.fillRect(x - 1.5, s.y + 47, 3, 14 + hash(Math.floor(x)) * 26);
    }
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(s.x, s.y, 2, H - s.y); ctx.fillRect(s.x + s.w - 2, s.y, 2, H - s.y); drawDecals(s, ctx, api);
    if (isArena) drawArenaFront(s, ctx, api);
  }

  function drawPit(p, ctx, api) { // водосброс: бетонный проём, внизу несётся белая вода
    const { H, now, hash } = api, wy = p.y + 34; ctx.fillStyle = '#0b1426'; ctx.fillRect(p.x, p.y, p.w, H - p.y);
    ctx.fillStyle = '#18233a'; ctx.fillRect(p.x, p.y, 6, H - p.y); ctx.fillRect(p.x + p.w - 6, p.y, 6, H - p.y);
    ctx.fillStyle = '#060b16'; ctx.fillRect(p.x + 7, p.y + 4, 3, 28); ctx.fillRect(p.x + p.w - 10, p.y + 4, 3, 28); // пазы затворов
    ctx.fillStyle = 'rgba(200,225,255,.1)'; ctx.fillRect(p.x, wy - 20, p.w, 20); // водяная пыль
    ctx.fillStyle = '#2f6fa8'; ctx.fillRect(p.x, wy, p.w, H - wy); ctx.fillStyle = 'rgba(235,247,255,.9)';
    for (let r = 0; r < 11; r++) {
      const y = wy + 1 + r * 7, o = (now * (190 + r * 25) + hash(r + 3) * 60) % 36;
      for (let x = p.x - 36 + o; x < p.x + p.w; x += 36) { const a = Math.max(x, p.x), b = Math.min(x + 22 - r, p.x + p.w); if (b > a) ctx.fillRect(a, y, b - a, 2); }
    }
    ctx.fillStyle = '#f4faff'; ctx.fillRect(p.x, wy - 1, p.w, 2); // пенный гребень потока
    for (let i = 0; i < p.w / 9; i++) { const ph = (now * 2.2 + hash(i * 3 + Math.floor(p.x))) % 1; ctx.fillRect(p.x + 4 + i * 9 + ph * 6, wy - 2 - Math.sin(ph * 3.14) * 7, 2, 2); }
    const bx = p.x - 26; // столбики с цепью и табличка у края
    for (const x of [bx, bx + 16]) for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#1b1b1b' : '#f2c230'; ctx.fillRect(x - 2, p.y - 16 + i * 4, 4, 4); }
    ctx.strokeStyle = '#c62828'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bx, p.y - 14); ctx.quadraticCurveTo(bx + 8, p.y - 8, bx + 16, p.y - 14); ctx.stroke();
    ctx.fillStyle = '#eef1f6'; ctx.fillRect(bx - 7, p.y - 30, 32, 11); api.text('ВОДОСБРОС', bx + 9, p.y - 22, 5.5, '#b3261e');
  }

  function drawPlatform(p, ctx) { // стальной служебный мостик с решётчатым настилом
    const posts = Math.max(2, Math.round(p.w / 110)), hgt = p.base - p.y - 8;
    for (let i = 0; i <= posts; i++) { const x = p.x + i * p.w / posts; ctx.fillStyle = '#3b4a64'; ctx.fillRect(x - 3, p.y + 8, 6, hgt); ctx.fillStyle = '#2b374d'; ctx.fillRect(x - 3, p.y + 8, 2, hgt); }
    ctx.strokeStyle = 'rgba(80,100,135,.8)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < posts; i++) { const xa = p.x + i * p.w / posts, xb = xa + p.w / posts; ctx.moveTo(xa, p.y + 10); ctx.lineTo(xb, p.base); ctx.moveTo(xb, p.y + 10); ctx.lineTo(xa, p.base); }
    ctx.stroke(); ctx.fillStyle = '#566b8e'; ctx.fillRect(p.x - 4, p.y, p.w + 8, 8);
    ctx.fillStyle = '#1f2a40'; ctx.beginPath(); for (let x = p.x - 2; x < p.x + p.w + 2; x += 5) ctx.rect(x, p.y + 2, 3, 4); ctx.fill();
    ctx.fillStyle = '#e8b923'; ctx.fillRect(p.x - 4, p.y + 8, p.w + 8, 2);
    ctx.strokeStyle = '#e8b923'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x - 4, p.y - 16); ctx.lineTo(p.x + p.w + 4, p.y - 16);
    for (let x = p.x - 3; x <= p.x + p.w + 4; x += 30) { ctx.moveTo(x, p.y); ctx.lineTo(x, p.y - 16); }
    ctx.stroke(); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x - 4, p.y - 8); ctx.lineTo(p.x + p.w + 4, p.y - 8); ctx.stroke();
  }

  function drawObstacle(s, ctx, api) { // бетонные блоки ФБС с разметкой или трансформаторный шкаф
    if (s.v > 0.55) { // трансформатор: рёбра охлаждения, знак молнии, индикатор
      const { x, y, w, h } = s, cx = x + w * 0.76, cy = y + Math.min(h * 0.4, 16);
      ctx.fillStyle = '#4c6b5e'; ctx.fillRect(x, y + 3, w, h - 3); ctx.fillStyle = '#6f9080'; ctx.fillRect(x - 2, y, w + 4, 4);
      ctx.fillStyle = '#3a5448'; for (let fx = x + 4; fx < x + w * 0.55; fx += 4) ctx.fillRect(fx, y + 8, 2, h - 13); ctx.fillStyle = '#2c3f36'; ctx.fillRect(x, y + h - 4, w, 4);
      ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 8, cy + 6); ctx.lineTo(cx - 8, cy + 6); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(cx + 1.5, cy - 4); ctx.lineTo(cx - 2, cy + 1.5); ctx.lineTo(cx + 0.5, cy + 1.5); ctx.lineTo(cx - 1.5, cy + 5); ctx.lineTo(cx + 2.5, cy - 0.5); ctx.lineTo(cx, cy - 0.5); ctx.fill();
      ctx.fillStyle = Math.sin(api.now * 4 + x) > 0 ? '#6cff8a' : '#1f5a2c'; ctx.fillRect(x + w * 0.72, y + h - 10, 3, 3);
      return;
    }
    const bh = s.h / s.stack;
    for (let k = 0; k < s.stack; k++) {
      const y = s.y + k * bh, by = y + bh * 0.4, bhh = Math.min(8, bh * 0.28);
      ctx.fillStyle = '#9aa3b1'; ctx.fillRect(s.x, y, s.w, bh); ctx.fillStyle = '#c4cbd5'; ctx.fillRect(s.x, y, s.w, 3);
      ctx.fillStyle = '#788191'; ctx.fillRect(s.x + s.w - 4, y + 3, 4, bh - 3); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(s.x, y + bh - 1, s.w, 1);
      ctx.save(); ctx.beginPath(); ctx.rect(s.x + 3, by, s.w - 9, bhh); ctx.clip(); // жёлто-чёрная разметка
      ctx.fillStyle = '#f2c230'; ctx.fillRect(s.x, by, s.w, bhh); ctx.fillStyle = '#1d1d1d'; ctx.beginPath();
      for (let x = s.x - 10; x < s.x + s.w; x += 10) { ctx.moveTo(x, by + bhh); ctx.lineTo(x + 5, by + bhh); ctx.lineTo(x + 5 + bhh, by); ctx.lineTo(x + bhh, by); }
      ctx.fill(); ctx.restore(); if (k === s.stack - 1) api.text('ФБС-' + (2 + Math.floor(s.v * 9)), s.x + s.w / 2 - 2, y + bh - 4, 6, '#4a5160');
    }
  }

  function drawDecor(d, ctx, api) {
    const x = d.x, y = d.y, now = api.now;
    if (d.kind === 'flood') { // прожектор на столбе: конус света и пятно на бетоне
      const on = Math.sin(now * 23 + d.v * 50) > -0.97; ctx.fillStyle = on ? 'rgba(255,244,200,.08)' : 'rgba(255,244,200,.03)';
      ctx.beginPath(); ctx.moveTo(x - 6, y - 84); ctx.lineTo(x + 8, y - 84); ctx.lineTo(x + 46, y); ctx.lineTo(x - 30, y); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,190,.12)'; ctx.beginPath(); ctx.ellipse(x + 8, y - 1, 40, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#4a5670'; ctx.fillRect(x - 1.5, y - 86, 3, 86); ctx.fillRect(x - 6, y - 3, 12, 3); ctx.fillStyle = '#2b3448'; ctx.fillRect(x - 9, y - 94, 20, 10);
      ctx.fillStyle = on ? '#fffbe8' : '#b8b29a'; ctx.fillRect(x - 7, y - 87, 7, 3); ctx.fillRect(x + 2, y - 87, 7, 3);
    } else if (d.kind === 'booth') { // будка охраны со светящимся окном и сторожем
      ctx.fillStyle = '#d7dde6'; ctx.fillRect(x - 17, y - 40, 34, 40); ctx.fillStyle = '#2f6fd0'; ctx.fillRect(x - 17, y - 13, 34, 4);
      ctx.fillStyle = '#ffd98a'; ctx.fillRect(x - 13, y - 33, 14, 12); glow(ctx, x - 6, y - 26, 3, '#6b5a3a'); ctx.fillRect(x - 10, y - 23, 8, 2);
      ctx.fillStyle = '#56657d'; ctx.fillRect(x + 4, y - 32, 10, 32); ctx.fillStyle = '#3b4a63'; ctx.fillRect(x - 20, y - 45, 40, 5);
      ctx.fillStyle = Math.sin(now * 5 + d.v * 9) > 0 ? '#ffb02e' : '#7a4f10'; ctx.fillRect(x - 2, y - 49, 4, 4); api.text('ПОСТ', x - 6, y - 10.5, 5, '#fff');
    } else if (d.kind === 'hv') { // табличка «Высокое напряжение»
      ctx.fillStyle = '#5c6a82'; ctx.fillRect(x - 1, y - 46, 2, 46);
      ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.moveTo(x, y - 60); ctx.lineTo(x + 12, y - 39); ctx.lineTo(x - 12, y - 39); ctx.fill();
      ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.moveTo(x, y - 57); ctx.lineTo(x + 9, y - 41); ctx.lineTo(x - 9, y - 41); ctx.fill();
      ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.moveTo(x + 2, y - 53); ctx.lineTo(x - 3, y - 47); ctx.lineTo(x, y - 47); ctx.lineTo(x - 2, y - 42); ctx.lineTo(x + 3, y - 48); ctx.lineTo(x, y - 48); ctx.fill();
      ctx.fillStyle = '#f7f7f2'; ctx.fillRect(x - 27, y - 36, 54, 17); ctx.strokeStyle = '#c62828'; ctx.lineWidth = 1; ctx.strokeRect(x - 26.5, y - 35.5, 53, 16);
      api.text('ВЫСОКОЕ', x, y - 29, 6, '#c62828'); api.text('НАПРЯЖЕНИЕ', x, y - 22, 6, '#c62828');
    } else if (d.kind === 'drum') { // кабельный барабан
      const cy = y - 17; glow(ctx, x + 7, cy, 17, '#6e4a26'); ctx.fillStyle = '#15171c'; ctx.fillRect(x, cy - 12, 7, 24); glow(ctx, x, cy, 17, '#a3703d');
      ctx.strokeStyle = '#7e5329'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.moveTo(x + Math.cos(a) * 4, cy + Math.sin(a) * 4); ctx.lineTo(x + Math.cos(a) * 17, cy + Math.sin(a) * 17); }
      ctx.moveTo(x + 15, cy); ctx.arc(x, cy, 15, 0, 7); ctx.stroke(); glow(ctx, x, cy, 4, '#3b2a18');
      ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x + 12, cy - 11); ctx.quadraticCurveTo(x + 30, cy - 4, x + 32, y - 1.5); ctx.lineTo(x + 48, y - 1.5); ctx.stroke();
    }
  }

  // ---------- арена: транспарант, гирлянда, тент приёмочной комиссии ----------
  function drawTent(ctx, api, x, gy) { // тент комиссии: полосатый навес, стол под красным сукном
    ctx.fillStyle = '#c9ced8'; ctx.fillRect(x + 4, gy - 96, 3, 96); ctx.fillRect(x + 213, gy - 96, 3, 96);
    ctx.fillStyle = '#eef1f6'; ctx.beginPath(); ctx.moveTo(x - 6, gy - 94); ctx.lineTo(x + 50, gy - 124); ctx.lineTo(x + 170, gy - 124); ctx.lineTo(x + 226, gy - 94); ctx.fill();
    for (let i = 0; i < 11; i++) { // фестон
      const fx = x - 6 + i * 21.1; ctx.fillStyle = i % 2 ? '#eef1f6' : '#d32f2f';
      ctx.beginPath(); ctx.moveTo(fx, gy - 94); ctx.lineTo(fx + 21, gy - 94); ctx.lineTo(fx + 21, gy - 84); ctx.quadraticCurveTo(fx + 10.5, gy - 78, fx, gy - 84); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,230,170,.12)'; ctx.fillRect(x + 7, gy - 84, 206, 84);
    ctx.fillStyle = '#3b4a63'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 70 + i * 34, gy - 44, 14, 20); // спинки стульев
    ctx.fillStyle = '#b3261e'; ctx.fillRect(x + 50, gy - 30, 130, 30); ctx.fillStyle = '#e8b923'; ctx.fillRect(x + 50, gy - 30, 130, 2);
    ctx.fillStyle = '#f4f6fb'; ctx.fillRect(x + 66, gy - 34, 14, 4); ctx.fillRect(x + 112, gy - 34, 12, 4);
    ctx.fillStyle = '#9fd3ff'; ctx.fillRect(x + 94, gy - 42, 5, 12); ctx.fillRect(x + 150, gy - 42, 5, 12); // графины
    ctx.fillStyle = '#222'; ctx.fillRect(x + 134, gy - 44, 2, 14); ctx.fillRect(x + 132, gy - 46, 6, 3); // микрофон
    api.text('КОМИССИЯ', x + 115, gy - 11, 9, '#fff3d6');
  }

  function drawArenaBack(s, ctx, api) {
    const A = api.arena, gy = s.y, now = api.now, bx1 = A.x1 + 60, bx2 = A.x1 + 400, top = gy - 186;
    drawTent(ctx, api, A.x2 - 232, gy); ctx.fillStyle = '#4a5670'; ctx.fillRect(bx1 - 2, top - 12, 4, gy - top + 12); ctx.fillRect(bx2 - 2, top - 12, 4, gy - top + 12);
    ctx.fillStyle = '#fff6d6'; ctx.fillRect(bx1 - 6, top - 16, 12, 5); ctx.fillRect(bx2 - 6, top - 16, 12, 5);
    ctx.strokeStyle = '#2a3140'; ctx.lineWidth = 1; ctx.beginPath(); // гирлянда с бегущими огнями
    ctx.moveTo(bx1, top - 8); ctx.quadraticCurveTo((bx1 + bx2) / 2, top + 18, bx2, top - 8);
    ctx.moveTo(bx2, top - 8); ctx.quadraticCurveTo(bx2 + 110, top + 40, A.x2 - 170, gy - 124); ctx.stroke();
    const cols = ['#ff5d5d', '#ffd76a', '#6cff8a', '#7ec8ff'], step = Math.floor(now * 4);
    for (let k = 1; k < 16; k++) {
      const t = k / 16, u = 1 - t, bxk = u * u * bx1 + 2 * t * u * (bx1 + bx2) / 2 + t * t * bx2, byk = u * u * (top - 8) + 2 * t * u * (top + 18) + t * t * (top - 8);
      glow(ctx, bxk, byk + 2, 2.2, cols[(k + step) % 4]);
    }
    ctx.fillStyle = '#b3261e'; ctx.beginPath(); // транспарант
    ctx.moveTo(bx1 + 2, top); ctx.lineTo(bx2 - 2, top); ctx.lineTo(bx2 - 2, top + 26); ctx.quadraticCurveTo((bx1 + bx2) / 2, top + 31 + Math.sin(now * 1.5) * 2, bx1 + 2, top + 26); ctx.fill();
    ctx.fillStyle = '#e8b923'; ctx.fillRect(bx1 + 2, top, bx2 - bx1 - 4, 2); api.text('ПРИЁМОЧНАЯ КОМИССИЯ', (bx1 + bx2) / 2, top + 19, 15, '#fff6e0');
    const closed = A.active && !A.boss.dead, px = A.x1 - 8; // шлагбаум: закрыт, пока идёт бой
    ctx.fillStyle = '#d7dde6'; ctx.fillRect(px - 3, gy - 30, 6, 30); ctx.save(); ctx.translate(px, gy - 26); ctx.rotate(closed ? 0 : 1.35);
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#e53935'; ctx.fillRect(-8 - i * 8, -2, 8, 4); }
    ctx.restore(); ctx.fillStyle = closed && Math.sin(now * 8) > 0 ? '#ff3030' : '#5a1a1a'; ctx.fillRect(px - 2, gy - 34, 4, 4);
  }

  function drawArenaFront(s, ctx, api) { // красная дорожка к комиссии и остов побеждённого экскаватора
    const A = api.arena; ctx.fillStyle = '#b3261e'; ctx.fillRect(A.x1 + 12, s.y - 1, 430, 4); ctx.fillStyle = '#e8b923'; ctx.fillRect(A.x1 + 12, s.y + 3, 430, 1);
    if (S.wreck) { ctx.save(); ctx.translate(S.wreck.x, S.wreck.y); S.wreck.e.t = api.now; drawBoss(S.wreck.e, ctx, api); ctx.restore(); }
  }

  // ---------- снаряды ----------
  function drawPaper(p, ctx) { // лист замечаний
    ctx.fillStyle = '#f4f6fb'; ctx.fillRect(-6, -8, 12, 16); ctx.strokeStyle = '#7d8aa3'; ctx.lineWidth = 0.8; ctx.strokeRect(-6, -8, 12, 16);
    ctx.fillStyle = '#8a96ad'; ctx.fillRect(-4, -5, 8, 1); ctx.fillRect(-4, -2, 8, 1); ctx.fillRect(-4, 1, 5, 1);
    ctx.strokeStyle = '#d63a3a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(2, 4, 2.5, 0, 7); ctx.stroke();
  }
  function drawStamp(p, ctx) { // летящая печать «НЕ СОГЛАСОВАНО» (с ореолом — видна на тёмном небе)
    glow(ctx, 0, 0, 12, 'rgba(255,80,80,.28)'); glow(ctx, 0, -7, 3.5, '#4a2c1a'); ctx.fillRect(-2, -5, 4, 5);
    ctx.fillStyle = '#ff3b3b'; ctx.fillRect(-8, 0, 16, 7); ctx.fillStyle = '#fff'; ctx.fillRect(-6, 2, 12, 1); ctx.fillRect(-6, 4, 9, 1);
    ctx.strokeStyle = '#8e1111'; ctx.lineWidth = 1; ctx.strokeRect(-8, 0, 16, 7);
  }
  function drawWave(p, ctx, api) { // ударная волна по бетону от ковша
    const d = Math.sign(p.vx) || 1, f = Math.sin(api.now * 30) * 1.5; ctx.fillStyle = 'rgba(255,170,60,.3)'; ctx.fillRect(d > 0 ? -34 : 10, 1, 24, 5);
    ctx.fillStyle = '#ffb347'; ctx.strokeStyle = '#7a2e00'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-11, 6); ctx.quadraticCurveTo(d * 3, -17 - f, 11, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff2c4'; ctx.beginPath(); ctx.moveTo(-5, 6); ctx.quadraticCurveTo(d * 2, -6 - f, 5, 6); ctx.fill();
    ctx.fillStyle = '#9aa6b8'; ctx.fillRect(d * 8, -8 + f, 3, 3); ctx.fillRect(-d * 4, -11 - f, 2, 2);
  }

  function throwPaper(e, api) { // бюрократ бросает лист: лёгкий (g=300), парит и покачивается
    const P = api.player, x0 = e.x + e.w / 2 + e.dir * 4, y0 = e.y - 10, g = 300; const dx = P.x + P.w / 2 - x0, ty = P.y + 16, tf = api.clamp(Math.abs(dx) / 200, 0.9, 1.6);
    api.shoot({ x: x0, y: y0, w: 12, h: 14, vx: dx / tf, vy: (ty - y0 - 0.5 * g * tf * tf) / tf, gravity: g, life: 5, color: '#f4f6fb', draw: drawPaper, source: e, pts: 20,
      update(p, dt) { p.age = (p.age || 0) + dt; p.rot = Math.sin(p.age * 7) * 0.5; p.x += Math.cos(p.age * 6) * 18 * dt; } });
  }

  // ---------- враги ----------
  const enemies = {
    clerk: { // бюрократ с папкой: ходит, поднимает папку над головой и бросает лист замечаний
      w: 20, h: 40, hp: 1, pts: 150, hitColor: '#f4f6fb',
      init(e) { e.wind = 0; e.throwT = 0; },
      update(e, dt, api) {
        const dx = api.dx(e), near = Math.abs(dx) < 340 && Math.abs(api.player.y - e.y) < 170, x0 = e.x; e.throwT = Math.max(0, e.throwT - dt);
        if (e.wind > 0) { e.dir = Math.sign(dx) || e.dir; e.wind -= dt; if (e.wind <= 0) { throwPaper(e, api); e.throwT = 0.3; } } // папка поднята — сейчас полетит лист
        else if (near) {
          e.dir = Math.sign(dx) || e.dir; e.cd -= dt; if (e.cd <= 0 && api.projectiles.length < 40) { e.wind = 0.85; e.cd = api.rand(2.2, 3.2); }
          else if (Math.abs(dx) > 170) api.patrol(e, 28, dt);
        } else api.patrol(e, 32, dt);
        e.mv = Math.abs(e.x - x0) > 0.05;
      },
      draw(e, ctx) {
        const leg = e.mv ? Math.sin(e.t * 10) * 3 : 0, k = e.wind > 0 ? Math.min(1, (0.85 - e.wind) / 0.2) : 0;
        ctx.fillStyle = '#4a3d2c'; ctx.fillRect(-6 + leg, -16, 5, 15); ctx.fillRect(1 - leg, -16, 5, 15);
        ctx.fillStyle = '#15171c'; ctx.fillRect(-7 + leg, -2, 7, 2); ctx.fillRect(0 - leg, -2, 8, 2);
        ctx.fillStyle = '#8a7350'; ctx.fillRect(-8, -34, 16, 19); // коричневый костюм
        ctx.fillStyle = '#eef1f6'; ctx.beginPath(); ctx.moveTo(-3, -34); ctx.lineTo(4, -34); ctx.lineTo(0.5, -27); ctx.fill();
        ctx.fillStyle = '#c62828'; ctx.fillRect(-0.5, -32, 2, 9); glow(ctx, 1, -40, 6, '#f0c9a0');
        ctx.strokeStyle = '#6b5a45'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-5, -42); ctx.quadraticCurveTo(0, -48, 6, -44); ctx.stroke(); // зачёс
        ctx.fillStyle = '#cfe8ff'; ctx.fillRect(3, -42, 5, 3); ctx.fillStyle = '#222'; ctx.fillRect(3, -42, 5, 1); ctx.fillRect(5, -41, 1, 1); // очки
        ctx.fillStyle = '#7a3b2e'; ctx.fillRect(3, -36, 4, 1); ctx.strokeStyle = '#8a7350'; ctx.lineWidth = 3; ctx.beginPath();
        if (e.wind > 0) { // обе руки держат папку над головой, из неё торчат листы
          const fy = -58 - k * 4 + Math.sin(e.t * 30) * 0.8; ctx.moveTo(-6, -32); ctx.lineTo(-5, fy + 10); ctx.moveTo(6, -32); ctx.lineTo(6, fy + 10); ctx.stroke();
          ctx.fillStyle = '#f4f6fb'; ctx.fillRect(-6, fy - 4, 7, 6); ctx.fillRect(1, fy - 6, 6, 6);
          ctx.fillStyle = '#c0392b'; ctx.fillRect(-9, fy, 20, 12); ctx.fillStyle = '#f2c230'; ctx.fillRect(-4, fy + 4, 10, 3);
        } else if (e.throwT > 0) { ctx.moveTo(4, -31); ctx.lineTo(14, -38); ctx.stroke(); ctx.fillStyle = '#c0392b'; ctx.fillRect(-11, -30, 6, 13); } // бросок
        else { ctx.moveTo(4, -32); ctx.lineTo(6, -22); ctx.stroke(); ctx.fillStyle = '#c0392b'; ctx.fillRect(-2, -30, 13, 10); ctx.fillStyle = '#f2c230'; ctx.fillRect(1, -27, 7, 2); } // папка под мышкой
      },
    },
    inspdrone: { // дрон ГАСН: луч прожектора обшаривает площадку; поймав героя, краснеет и пикирует
      w: 32, h: 14, hp: 1, pts: 150, flip: false, hitColor: '#bfe3ff',
      init(e, api) { e.baseY = e.y; e.homeX = e.x; e.state = 'hover'; e.beam = 0; e.ph = api.rand(0, 6); if (e.enter) { e.y -= 90; e.state = 'enter'; } },
      update(e, dt, api) {
        const P = api.player, pcx = P.x + P.w / 2, pcy = P.y + P.h / 2, lx = e.x + e.w / 2, ly = e.y + e.h;
        if (e.state === 'enter') { // вызван инспектором — спускается сверху
          e.y += (e.baseY - e.y) * Math.min(1, dt * 2.5); e.beam = Math.sin(e.t * 1.7) * 0.6; if (Math.abs(e.y - e.baseY) < 1) { e.state = 'hover'; e.cd = 1; }
        } else if (e.state === 'hover') {
          e.x = e.homeX + Math.sin(e.t * 1.1 + e.ph) * 50; e.y = e.baseY + Math.sin(e.t * 3) * 5; e.beam = Math.sin(e.t * 1.6 + e.ph) * 0.7; e.cd -= dt;
          const a = Math.atan2(pcx - lx, pcy - ly); // угол на героя от вертикали
          if (e.cd <= 0 && pcy > ly && Math.abs(a - e.beam) < 0.16 && Math.hypot(pcx - lx, pcy - ly) < 240) { e.state = 'lock'; e.lockT = 0.85; e.tx = pcx; e.ty = P.y + 10; }
        } else if (e.state === 'lock') { // луч замер и покраснел — через 0,85 с пике в это место
          e.lockT -= dt; e.beam = Math.atan2(e.tx - lx, e.ty + 14 - ly); if (e.lockT <= 0) e.state = 'dive';
        } else if (e.state === 'dive') {
          const vx = e.tx - lx, vy = e.ty - e.y, d = Math.hypot(vx, vy); if (d < 8) e.state = 'back'; else { e.x += vx / d * 280 * dt; e.y += vy / d * 280 * dt; }
        } else {
          const vx = e.homeX - e.x, vy = e.baseY - e.y, d = Math.hypot(vx, vy); e.beam *= 1 - Math.min(1, dt * 3);
          if (d < 6) { e.state = 'hover'; e.cd = api.rand(1.2, 2); e.t = 0; } else { e.x += vx / d * 130 * dt; e.y += vy / d * 130 * dt; }
        }
      },
      draw(e, ctx, api) {
        const lock = e.state === 'lock' || e.state === 'dive', a = e.beam, bl = Math.sin(e.t * 9) > 0;
        const L = Math.min(260, Math.max(24, (e.groundY - e.y - e.h + 6) / Math.max(0.35, Math.cos(a))));
        ctx.fillStyle = lock ? 'rgba(255,60,50,.26)' : e.cd > 0 || e.state !== 'hover' ? 'rgba(255,245,200,.07)' : 'rgba(255,245,200,.14)';
        ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(Math.sin(a - 0.17) * L, Math.cos(a - 0.17) * L); ctx.lineTo(Math.sin(a + 0.17) * L, Math.cos(a + 0.17) * L); ctx.fill();
        ctx.beginPath(); ctx.ellipse(Math.sin(a) * L, Math.cos(a) * L - 1, 12, 3.5, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#2a2d33'; ctx.fillRect(-17, -13, 34, 2); ctx.fillStyle = 'rgba(210,220,235,.65)';
        for (const rx of [-16, 16]) { ctx.beginPath(); ctx.ellipse(rx, -14, 8 * Math.abs(Math.sin(e.t * 40)) + 2, 1.5, 0, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#e9eef6'; ctx.fillRect(-11, -12, 22, 9); ctx.fillStyle = '#2f6fd0'; ctx.fillRect(-11, -8, 22, 2); api.text('ГАСН', 0, -9.5, 5, '#1d3f7a');
        ctx.fillStyle = bl ? '#ff3030' : '#3b0d0d'; ctx.fillRect(-17, -15, 3, 2); ctx.fillStyle = bl ? '#1d2f5a' : '#3f8bff'; ctx.fillRect(14, -15, 3, 2); // мигалки
        glow(ctx, 0, -3, 3.5, '#1b1d22'); glow(ctx, Math.sin(a) * 1.5, -3 + Math.cos(a) * 1.5, 1.8, lock ? (Math.sin(e.t * 30) > 0 ? '#ff3b3b' : '#ffd0d0') : '#fff3b0');
      },
    },
    stamper: { // печать-прыгун: сжимается и скачет к герою, оставляя на бетоне «ОТКАЗАНО»
      w: 26, h: 30, hp: 2, pts: 200, hitColor: '#ff8a80', deathColor: '#d32f2f',
      init(e) { e.state = 'wait'; },
      update(e, dt, api) {
        const dx = api.dx(e), near = Math.abs(dx) < 330 && Math.abs(api.player.y - e.y) < 150;
        if (e.state === 'wait') {
          e.y = e.groundY - e.h; e.cd -= dt; if (near) e.dir = Math.sign(dx) || e.dir; if (e.cd <= 0) { e.state = 'squash'; e.sT = 0.8; e.big = near; }
        } else if (e.state === 'squash') { // сжатие перед прыжком (0,8 с) — предупреждение
          e.sT -= dt; if (e.big) e.dir = Math.sign(dx) || e.dir;
          if (e.sT <= 0) {
            const dist = e.big ? api.clamp(Math.abs(dx), 30, 115) : 40; e.x0 = e.x; e.x1 = api.clamp(e.x + e.dir * dist, e.minX, e.maxX - e.w);
            if (Math.abs(e.x1 - e.x0) < 4 && !e.big) { e.dir *= -1; e.x1 = api.clamp(e.x + e.dir * dist, e.minX, e.maxX - e.w); } // у края — разворот
            e.state = 'air'; e.aT = 0; e.aDur = e.big ? 0.62 : 0.42; e.aH = e.big ? 70 : 26;
          }
        } else if (e.state === 'air') { // прыжок по параболе
          e.aT += dt; const k = Math.min(1, e.aT / e.aDur); e.x = e.x0 + (e.x1 - e.x0) * k; e.y = e.groundY - e.h - 4 * e.aH * k * (1 - k);
          if (k >= 1) {
            e.state = 'land'; e.lT = 0.22; e.y = e.groundY - e.h; api.burst(e.x + e.w / 2, e.groundY, '#9aa6b8', 6, 90, 300);
            if (e.big) { addDecal({ x: e.x + e.w / 2, y: e.groundY, txt: 'ОТКАЗАНО', w: 52, c: '#e53935' }); api.shake(2); }
          }
        } else { e.lT -= dt; if (e.lT <= 0) { e.state = 'wait'; e.cd = near ? 0.15 : api.rand(0.9, 1.6); } }
      },
      draw(e, ctx) {
        let sy = 1, jx = 0; if (e.state === 'squash') { const k = Math.min(1, (0.8 - e.sT) / 0.3); sy = 1 - 0.3 * k; jx = Math.sin(e.t * 60) * k * (e.big ? 1 : 0.4); }
        else if (e.state === 'air') sy = e.aT < e.aDur / 2 ? 1.12 : 0.97;
        else if (e.state === 'land') sy = 0.78 + (0.22 - e.lT);
        ctx.translate(jx, 0); ctx.scale(1 + (1 - sy) * 0.8, sy); // сжатие и растяжение
        ctx.fillStyle = '#d32f2f'; ctx.fillRect(-13, -5, 26, 5); ctx.fillStyle = '#8e1b1b'; ctx.fillRect(-13, -1, 26, 1); // резина
        ctx.fillStyle = '#d9a441'; ctx.fillRect(-12, -17, 24, 12); ctx.fillStyle = '#b9832a'; ctx.fillRect(-12, -7, 24, 2); // колодка
        ctx.fillStyle = '#6b3a22'; ctx.beginPath(); ctx.moveTo(-5, -17); ctx.lineTo(5, -17); ctx.lineTo(3, -23); ctx.lineTo(-3, -23); ctx.fill(); // шейка
        ctx.save(); ctx.translate(0, -26); ctx.rotate(e.hp < e.maxHp ? 0.35 : Math.sin(e.t * 3) * 0.05); // ручка (после удара — набекрень)
        glow(ctx, 0, 0, 5.5, '#8e2b1e'); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-3, -3, 2, 2); ctx.restore();
        const blink = Math.sin(e.t * 2.3) > 0.96; ctx.fillStyle = '#fff'; ctx.fillRect(1, -15, 5, blink ? 1 : 5); ctx.fillRect(7, -15, 5, blink ? 1 : 5);
        if (!blink) { ctx.fillStyle = '#111'; ctx.fillRect(4, -13, 2, 3); ctx.fillRect(10, -13, 2, 3); }
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, -17.5); ctx.lineTo(6, -15.5); ctx.moveTo(13, -17.5); ctx.lineTo(7, -15.5); ctx.stroke(); // злые брови
        if (e.hp < e.maxHp) { ctx.strokeStyle = '#3a2210'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-9, -17); ctx.lineTo(-6, -12); ctx.lineTo(-8, -8); ctx.stroke(); } // трещина
      },
    },
    inspector: { // БОСС: главный инспектор на шагающем экскаваторе ЭШ-100
      w: 184, h: 112, hp: 24, pts: 5000, flip: false, heavy: true, stompable: false, knockback: false,
      boss: true, bossName: 'Главный инспектор', bossSub: 'на шагающем экскаваторе ЭШ-100', hitColor: '#ffd76a', deathColor: '#ffd76a',
      init(e) {
        if (e.isBoss) e.x = e.maxX - 300 - e.w / 2; // правее середины арены: кабина не уходит под полосу здоровья
        Object.assign(e, { state: 'idle', sT: 0, bow: 0, phase: 1, next: 'stamps', k: 0, tx: -150, armT: 0, hurtT: 0, walk: 0, drT: 0, flash: 0, second: false, say: null,
          tip: { x: -150, y: TIP_Y - 4 }, bk: { x: -150, y: TIP_Y + 62, v: 0 } });
      },
      update: updateBoss,
      draw: drawBoss,
      hurtbox(e) { // слабое место — кабина (в поклоне опускается к земле)
        const c = cabPos(e), ox = e.x + e.w / 2, gy = e.y + e.h;
        return { x: ox + c.x - 25, y: gy + c.y - 21, w: 50, h: 42 + (e.bow > 0.6 ? 18 : 0) };
      },
      bodybox(e) { return { x: e.x, y: e.y, w: e.w, h: e.h }; }, // кузов и опорная база: касание ранит
      onHit(e, api) { const c = cabPos(e); api.burst(e.x + e.w / 2 + c.x, e.y + e.h + c.y, '#ffffff', 10, 180); e.flash = 0.25; },
      onDeath(e, api) { // акт подписан: салют, взрывы, остов остаётся на арене
        const ox = e.x + e.w / 2, gy = e.y + e.h, c = cabPos(e), tx = Math.min(-200, e.tip.x);
        for (const q of api.enemies) if (q !== e && !q.dead) { q.dead = true; api.burst(q.x + q.w / 2, q.y + q.h / 2, '#bfe3ff', 10, 160); }
        for (const p of api.projectiles) p.dead = true; // ничто не ранит героя после победы
        S.cel = { t: 0, acc: 0, n: 0, x: ox, y: gy };
        S.wreck = { x: ox, y: gy, e: { t: 0, state: 'dead', phase: 1, bow: 1, walk: 0, tx: 0, armT: 0, sT: 0, flash: 0, say: { txt: 'ПОДПИСЫВАЮ…', t: 9 }, tip: { x: tx, y: -26 }, bk: { x: tx, y: 0 } } };
        api.popup(ox + c.x, gy + c.y - 30, 'АКТ ПОДПИСАН!', '#ff5d5d'); api.shake(16);
      },
    },
  };

  // ---------- босс: поведение ----------
  const TIP_Y = -196, FOOT = { x: -86, y: -54 }, MAST = { x: -60, y: -186 }; // оголовок стрелы, пята стрелы, вершина мачты
  const HINGE = { x: -52, y: -122 }, CAB_UP = { x: 12, y: -150 }, CAB_BOW = { x: -122, y: -62 };
  const A0 = Math.atan2(CAB_UP.y - HINGE.y, CAB_UP.x - HINGE.x), A1 = Math.atan2(CAB_BOW.y - HINGE.y, CAB_BOW.x - HINGE.x) - Math.PI * 2;
  const R0 = Math.hypot(CAB_UP.x - HINGE.x, CAB_UP.y - HINGE.y), R1 = Math.hypot(CAB_BOW.x - HINGE.x, CAB_BOW.y - HINGE.y);
  const PAUSE = [1.5, 1.1, 0.9], HOLD = [1.05, 0.92, 0.85], GAP = [0.34, 0.28, 0.26];

  function cabPos(e) { // центр кабины: подъёмник поворачивает её через верх вперёд и вниз («поклон»)
    const b = e.bow, k = b * b * (3 - 2 * b), a = A0 + (A1 - A0) * k, r = R0 + (R1 - R0) * k;
    return { x: HINGE.x + Math.cos(a) * r, y: HINGE.y + Math.sin(a) * r };
  }

  function throwStamp(e, api, k) { // печать летит по дуге; рейкой её можно отбить обратно в кабину (−2)
    if (api.projectiles.length > 40) return;
    const P = api.player, ox = e.x + e.w / 2, gy = e.y + e.h, c = cabPos(e), x0 = ox + c.x - 24, y0 = gy + c.y - 4, g = 700;
    const tx = P.x + P.w / 2 + [0, -60, 60, -110, 110][k % 5] * (e.phase > 1 ? 0.85 : 1), ty = P.y + 18, dx = tx - x0, tf = api.clamp(Math.abs(dx) / 330, 0.85, 1.45);
    api.shoot({ x: x0, y: y0, w: 16, h: 16, vx: dx / tf, vy: (ty - y0 - 0.5 * g * tf * tf) / tf, gravity: g, life: 4, spin: -5, color: '#ff3b3b', draw: drawStamp,
      reflectable: true, reflectDamage: 2, source: e, pts: 20,
      onLand(p, api) {
        const x = p.x + p.w / 2, top = api.groundAt(x); api.burst(x, p.y + p.h, '#ff5d5d', 8, 120);
        if (top !== null && Math.abs(top - (p.y + p.h)) < 14) addDecal({ x, y: top, txt: 'НЕ СОГЛАСОВАНО', w: 84, c: '#ff3b3b' });
      } });
  }

  function spawnWave(api, x, dir, stopX, gy) { // низкая волна вдоль бетона (12 в высоту) — перепрыгнуть
    api.shoot({ x, y: gy - 6, w: 20, h: 12, vx: dir * 240, vy: 0, gravity: 0, life: 4, hitsSolids: false, destructible: false, color: '#ffb347', draw: drawWave, pts: 0,
      update(p) { if ((dir > 0 && p.x + p.w > stopX) || (dir < 0 && p.x < stopX)) p.dead = true; } });
  }

  function slamTarget(e, api) { // куда бить ковшом (относительно центра экскаватора): под героя, но не под себя
    const P = api.player, ox = e.x + e.w / 2, hi = -150, lo = Math.min(hi, e.minX + 30 - ox);
    return api.clamp(P.x + P.w / 2 - ox, lo, hi);
  }

  function bucketHurt(e, api) {
    const ox = e.x + e.w / 2, gy = e.y + e.h, b = { x: ox + e.bk.x - 24, y: gy + e.bk.y - 34, w: 48, h: 34 }; if (api.overlap(api.player, b)) api.hurtPlayer(b.x + b.w / 2);
  }

  function impact(e, api) { // ковш врезался в гребень: тряска, пыль, трещина и две волны в стороны
    const gy = e.y + e.h, x = e.x + e.w / 2 + e.tx;
    e.bk.y = 0; e.bk.v = 0; e.hurtT = 0.08; api.shake(10); api.burst(x, gy - 4, '#aeb8c8', 18, 230, 700); api.burst(x, gy - 10, '#ffd76a', 10, 200, 600);
    addDecal({ x, y: gy, crack: true });
    if (api.projectiles.length < 44) { spawnWave(api, x - 32, -1, e.minX, gy); if (x + 32 < e.x - 24) spawnWave(api, x + 32, 1, e.x - 4, gy); }
    if (e.phase === 3 && !e.second) { e.second = true; e.state = 'aim'; e.sT = 0.35; } // фаза 3: двойной удар
    else { e.second = false; e.state = 'bow'; e.sT = 1.6; e.say = { txt: 'УХ…', t: 0.8 }; }
  }

  function park(e, dt) { // стрела поднята, ковш покачивается на канатах
    const T = e.tip, B = e.bk, r = Math.min(1, dt * 3); T.x += (-150 - T.x) * r; T.y += (TIP_Y - 4 - T.y) * r;
    B.x += (T.x + Math.sin(e.t * 1.3) * 5 - B.x) * Math.min(1, dt * 4); B.y += (T.y + 66 - B.y) * Math.min(1, dt * 5);
  }

  function advance(e, dt, api) { // фаза 3: медленно шагает к герою, но оставляет ему место
    if (e.phase === 3 && e.x - (api.player.x + api.player.w) > 150 && e.x > e.minX + 330) { e.x -= 16 * dt; e.walk += dt; }
  }

  function summon(e, api) { // вызвать дронов ГАСН (не больше двух одновременно)
    let n = 0; for (const q of api.enemies) if (q.summoned && !q.dead) n++; const gy = e.y + e.h;
    for (let i = n; i < 2; i++) api.spawnEnemy('inspdrone', e.minX + 130 + i * 190, gy - 128, { minX: e.minX, maxX: e.maxX, air: true, groundY: gy, summoned: true, enter: true });
  }

  function updateBoss(e, dt, api) {
    const P = api.player, T = e.tip, B = e.bk; if (e.hit > 0) { e.flash = Math.max(e.flash, e.hit); e.hit = 0; } // своё мигание кабины вместо исчезновения всей машины
    e.flash = Math.max(0, e.flash - dt); e.armT = Math.max(0, e.armT - dt);
    if (P.inv > 0 && api.overlap(P, e)) { P.x = e.x - P.w; if (P.vx > 0) P.vx = 0; } // в неуязвимости сквозь кузов не пройти — за экскаватором не застрять
    if (e.say) { e.say.t -= dt; if (e.say.t <= 0) e.say = null; }
    const ph = e.hp > e.maxHp * 2 / 3 ? 1 : e.hp > e.maxHp / 3 ? 2 : 3;
    if (ph > e.phase) { // новая фаза: крик, тряска, подмога
      e.phase = ph; api.shake(8); const c = cabPos(e); api.burst(e.x + e.w / 2 + c.x, e.y + e.h + c.y, '#ff5d5d', 20, 220);
      if (ph === 2) { e.say = { txt: 'ВЫЗЫВАЮ ГАСН!', t: 1.6 }; e.drT = 0.6; } else e.say = { txt: 'ОСОБОЕ МНЕНИЕ!', t: 1.6 };
    }
    e.bow = e.state === 'bow' ? Math.min(1, e.bow + dt / 0.35) : Math.max(0, e.bow - dt / 0.45); if (e.hurtT > 0) { e.hurtT -= dt; bucketHurt(e, api); }
    if (e.isBoss && !(api.arena && api.arena.active)) { park(e, dt); return; } // ждёт у тента, пока герой не вошёл
    if (e.phase >= 2) { e.drT -= dt; if (e.drT <= 0) { e.drT = 13; summon(e, api); } }
    e.sT -= dt;
    switch (e.state) {
      case 'idle': e.state = 'pause'; e.sT = 2.6; break; // пока висит заставка «БОСС»
      case 'pause':
        park(e, dt); advance(e, dt, api);
        if (e.sT <= 0) {
          if (e.next === 'stamps') { e.state = 'wind'; e.sT = 0.75; e.say = { txt: 'НЕ СОГЛАСОВАНО!', t: 0.9 }; }
          else { e.state = 'aim'; e.sT = 0.4; }
        }
        break;
      case 'wind': park(e, dt); advance(e, dt, api); if (e.sT <= 0) { e.state = 'throw'; e.k = 0; e.sT = 0; } break; // печать поднята над головой
      case 'throw':
        park(e, dt); advance(e, dt, api);
        if (e.sT <= 0) {
          if (e.k < (e.phase > 1 ? 5 : 3)) { throwStamp(e, api, e.k++); e.armT = 0.18; e.sT = GAP[e.phase - 1]; }
          else { e.state = 'pause'; e.sT = PAUSE[e.phase - 1] + 0.5; e.next = 'slam'; }
        }
        break;
      case 'aim': { // стрела поворачивается к герою, ковш поднят; метка следует за героем
        e.tx = slamTarget(e, api); const r = Math.min(1, dt * 8);
        T.x += (e.tx - T.x) * r; T.y += (TIP_Y - T.y) * r; B.x += (T.x - B.x) * Math.min(1, dt * 6); B.y += (T.y + 64 - B.y) * r;
        if (e.sT <= 0) { e.state = 'hold'; e.sT = HOLD[e.phase - 1]; T.x = e.tx; if (!e.second) e.say = { txt: 'В ПЕРЕДЕЛКУ!', t: 0.9 }; }
        break;
      }
      case 'hold': T.x = B.x = e.tx; B.y += (T.y + 64 - B.y) * Math.min(1, dt * 8); if (e.sT <= 0) { e.state = 'fall'; B.v = 0; } break; // метка замерла, ковш дрожит
      case 'fall': B.v += 2600 * dt; B.y = Math.min(0, B.y + B.v * dt); bucketHurt(e, api); if (B.y >= 0) impact(e, api); break;
      case 'bow': T.y += (-84 - T.y) * Math.min(1, dt * 5); if (e.sT <= 0) { e.state = 'recover'; e.sT = 0.5; } break; // стрела лежит, кабина кланяется — бей рейкой
      case 'recover':
        T.y += (TIP_Y - 4 - T.y) * Math.min(1, dt * 5); B.x = T.x; B.y += (T.y + 66 - B.y) * Math.min(1, dt * 5);
        if (e.sT <= 0) { e.state = 'pause'; e.sT = PAUSE[e.phase - 1]; e.next = 'stamps'; }
        break;
    }
  }

  // ---------- босс: рисунок (смотрит влево, начало координат — середина низа кузова) ----------
  function bubble(ctx, api, x, y, txt, color) { // реплика инспектора
    const w = txt.length * 5.6 + 12; ctx.fillStyle = '#fff'; ctx.fillRect(x - w / 2, y - 11, w, 15);
    ctx.beginPath(); ctx.moveTo(x + w / 2 - 22, y + 4); ctx.lineTo(x + w / 2 - 10, y + 4); ctx.lineTo(x + w / 2 - 4, y + 12); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.strokeRect(x - w / 2, y - 11, w, 15); api.text(txt, x, y, 8, color);
  }

  function drawBucket(ctx, bx, by, hot) { // ковш драглайна: зубья вниз, дуга подвески
    ctx.fillStyle = hot ? '#7a4040' : '#5d626d';
    ctx.beginPath(); ctx.moveTo(bx - 26, by - 30); ctx.lineTo(bx + 24, by - 34); ctx.lineTo(bx + 22, by - 3); ctx.lineTo(bx - 21, by - 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#434852'; ctx.fillRect(bx - 21, by - 11, 43, 8); ctx.fillStyle = '#f2c230'; ctx.fillRect(bx - 25, by - 31, 48, 3);
    ctx.fillStyle = '#d0d5dd'; ctx.beginPath(); for (let k = 0; k < 5; k++) { const x = bx - 20 + k * 10; ctx.moveTo(x, by - 3); ctx.lineTo(x + 6, by - 3); ctx.lineTo(x + 3, by + 2); } ctx.fill();
    ctx.strokeStyle = '#23262d'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(bx - 23, by - 31); ctx.lineTo(bx, by - 46); ctx.lineTo(bx + 21, by - 34); ctx.stroke();
  }

  function drawChief(ctx, e) { // главный инспектор в окне кабины: белая каска, красная печать
    const t = e.t, bob = e.state === 'pause' || e.state === 'idle' ? Math.sin(t * 2) * 0.7 : 0;
    ctx.fillStyle = '#2b3445'; ctx.fillRect(-19, 3, 24, 7); ctx.fillStyle = '#f4f4f4'; ctx.fillRect(-10, 3, 5, 7); ctx.fillStyle = '#c62828'; ctx.fillRect(-9, 4, 2, 6);
    glow(ctx, -8, -3 + bob, 6, '#f1c27d'); ctx.fillStyle = '#1b1b1b'; ctx.fillRect(-13, -5 + bob, 2.5, 2); ctx.fillStyle = '#4a3320'; ctx.fillRect(-15, -1 + bob, 6, 1.8);
    ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-15, -8 + bob); ctx.lineTo(-10, -6.5 + bob); ctx.stroke(); // сердитая бровь
    ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.arc(-8, -7 + bob, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(-17, -8 + bob, 17, 2); // белая каска
    if (e.state === 'dead') { ctx.fillStyle = '#f4f6fb'; ctx.fillRect(-26, -2, 12, 10); glow(ctx, -20, 3, 3, '#2e7d32'); return; } // подписывает акт
    let hx = -21, hy = 3; if (e.state === 'wind') { hy = 3 - Math.min(1, (0.75 - e.sT) / 0.2) * 15; hx = -19; } else if (e.armT > 0) { hx = -26; hy = -3; }
    ctx.strokeStyle = '#2b3445'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-14, 6); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = '#5a3a22'; ctx.fillRect(hx - 1.5, hy - 8, 3, 6); glow(ctx, hx, hy - 9, 2.6, '#5a3a22'); ctx.fillStyle = '#e53935'; ctx.fillRect(hx - 5, hy - 3, 10, 4);
    if (e.state === 'bow') { ctx.fillStyle = '#ffd76a'; for (let k = 0; k < 3; k++) { const a = t * 7 + k * 2.1; ctx.fillRect(-9 + Math.cos(a) * 9, -17 + Math.sin(a) * 2.5, 2.5, 2.5); } } // кружится голова
  }

  function drawBoss(e, ctx, api) {
    const t = e.t, T = e.tip, B = e.bk, dead = e.state === 'dead', rage = e.phase === 3 && !dead, sh = e.state === 'hold' ? Math.sin(t * 70) * 1.6 : 0;
    if (e.state === 'aim' || e.state === 'hold' || e.state === 'fall') { // красная метка удара на бетоне
      const lock = e.state !== 'aim'; ctx.globalAlpha = lock ? (Math.sin(t * 24) > 0 ? 1 : 0.6) : 0.55; ctx.strokeStyle = '#ff2d2d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(e.tx, -1, 30, 6, 0, 0, 7); if (lock) { ctx.fillStyle = 'rgba(255,40,40,.35)'; ctx.fill(); } ctx.stroke();
      ctx.beginPath(); ctx.moveTo(e.tx - 14, -1); ctx.lineTo(e.tx + 14, -1); ctx.moveTo(e.tx, -7); ctx.lineTo(e.tx, 5); ctx.stroke();
      ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(e.tx, B.y + 4); ctx.lineTo(e.tx, -8); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    if (rage) { ctx.fillStyle = `rgba(255,45,45,${0.14 + 0.08 * Math.sin(t * 8)})`; ctx.beginPath(); ctx.ellipse(0, -76, 128, 86, 0, 0, 7); ctx.fill(); } // ярость
    if (dead) { ctx.translate(-92, 0); ctx.rotate(-0.04); ctx.translate(92, 0); } // остов осел на передок

    // стрела: два пояса и решётка раскосов; канаты: подвеска от мачты, подъёмные — к ковшу, тяговый — к кузову
    const dx = T.x - FOOT.x, dy = T.y - FOOT.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, n = Math.max(3, Math.floor(L / 16));
    ctx.strokeStyle = '#e0a000'; ctx.lineWidth = 2.5; ctx.beginPath();
    ctx.moveTo(FOOT.x + nx * 8, FOOT.y + ny * 8); ctx.lineTo(T.x + nx * 3, T.y + ny * 3); ctx.moveTo(FOOT.x - nx * 8, FOOT.y - ny * 8); ctx.lineTo(T.x - nx * 3, T.y - ny * 3); ctx.stroke();
    ctx.strokeStyle = '#b88400'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const k0 = i / n, k1 = (i + 1) / n, w0 = 8 - 5 * k0, w1 = 8 - 5 * k1, s = i % 2 ? 1 : -1;
      ctx.moveTo(FOOT.x + dx * k0 + nx * w0 * s, FOOT.y + dy * k0 + ny * w0 * s); ctx.lineTo(FOOT.x + dx * k1 - nx * w1 * s, FOOT.y + dy * k1 - ny * w1 * s);
    }
    ctx.stroke(); glow(ctx, T.x, T.y, 5, '#2b2f37'); ctx.strokeStyle = '#8a93a6'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(MAST.x, MAST.y); ctx.lineTo(T.x, T.y); ctx.moveTo(MAST.x, MAST.y); ctx.lineTo(FOOT.x + dx * 0.5 + nx * 6, FOOT.y + dy * 0.5 + ny * 6);
    ctx.moveTo(T.x - 2, T.y); ctx.lineTo(B.x + sh - 3, B.y - 46); ctx.moveTo(T.x + 2, T.y); ctx.lineTo(B.x + sh + 3, B.y - 46);
    ctx.moveTo(B.x + sh + 22, B.y - 20); ctx.quadraticCurveTo((B.x - 92) / 2, Math.max(B.y, -40) + 24, -92, -34); ctx.stroke();
    drawBucket(ctx, B.x + sh, B.y, e.state === 'fall');

    // опорная база, эксцентрик шагающего механизма и лыжа
    const wa = e.walk * 4, lift = Math.max(0, Math.sin(wa)) * 7, sx = Math.cos(wa) * 5, ey = -34 - lift * 0.5;
    ctx.fillStyle = '#23272f'; ctx.beginPath(); ctx.ellipse(0, -14, 96, 14, 0, 0, 7); ctx.fill(); glow(ctx, -4 + sx, ey, 15, '#3a3f48');
    ctx.strokeStyle = '#f2b705'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-4 + sx, ey); ctx.lineTo(-4 + sx + Math.cos(wa) * 13, ey + Math.sin(wa) * 13); ctx.stroke();
    ctx.fillStyle = '#3a3f48'; ctx.fillRect(-96 + sx, -18 - lift, 196, 16); ctx.fillStyle = '#f2b705'; ctx.fillRect(-96 + sx, -18 - lift, 196, 3);
    ctx.fillStyle = '#1d2027'; for (let k = -88; k < 96; k += 24) ctx.fillRect(k + sx, -11 - lift, 12, 3);

    // кузов: жёлтый корпус, швы, дверь с трапом, «зебра», окна машинного отделения, противовес, перила
    ctx.fillStyle = '#b07a00'; ctx.fillRect(92, -100, 30, 62); ctx.fillStyle = '#1b1b1b'; for (let y = -94; y < -44; y += 12) ctx.fillRect(96, y, 22, 5);
    ctx.fillStyle = '#f2b705'; ctx.fillRect(-92, -118, 184, 92); ctx.fillStyle = '#c98f00'; ctx.fillRect(-92, -40, 184, 14);
    ctx.fillStyle = 'rgba(0,0,0,.12)'; for (const x of [-48, 4, 56]) ctx.fillRect(x, -118, 1.5, 68);
    ctx.fillStyle = '#d9a200'; ctx.fillRect(-84, -92, 18, 40); ctx.fillStyle = '#2b3b5a'; ctx.fillRect(-80, -88, 10, 8); // дверь
    ctx.strokeStyle = '#3a3f48'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-83, -52); ctx.lineTo(-83, -20); ctx.moveTo(-73, -52); ctx.lineTo(-73, -20);
    for (let y = -26; y > -52; y -= 6) { ctx.moveTo(-83, y); ctx.lineTo(-73, y); } ctx.stroke(); // трап
    ctx.save(); ctx.beginPath(); ctx.rect(-92, -50, 184, 8); ctx.clip(); ctx.fillStyle = '#1b1b1b'; ctx.fillRect(-92, -50, 184, 8); ctx.fillStyle = '#f2c230'; ctx.beginPath();
    for (let x = -104; x < 96; x += 12) { ctx.moveTo(x, -42); ctx.lineTo(x + 6, -42); ctx.lineTo(x + 14, -50); ctx.lineTo(x + 8, -50); }
    ctx.fill(); ctx.restore();
    for (let k = 0; k < 4; k++) { ctx.fillStyle = dead ? '#2b3b5a' : k === 1 && Math.sin(t * 1.3) > 0.8 ? '#fff0c0' : '#ffcf66'; ctx.fillRect(-50 + k * 32, -106, 20, 12); }
    ctx.fillStyle = 'rgba(0,0,0,.2)'; for (let k = 0; k < 4; k++) ctx.fillRect(-50 + k * 32, -100, 20, 1.5); api.text('ЭШ-100', 26, -62, 13, '#1b1b1b');
    ctx.fillStyle = '#d39c00'; ctx.fillRect(-96, -124, 196, 7);
    ctx.strokeStyle = '#3a3f48'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-30, -134); ctx.lineTo(96, -134); for (let x = -30; x <= 96; x += 21) { ctx.moveTo(x, -134); ctx.lineTo(x, -124); } ctx.stroke(); // перила на крыше
    ctx.fillStyle = '#3a3f48'; ctx.fillRect(66, -144, 7, 22); // выхлопная труба и дым
    for (let k = 0; k < 4; k++) {
      const p = (t * 0.7 + k / 4) % 1;
      glow(ctx, 70 + p * 14, -148 - p * 42, 4 + p * 10, rage || dead ? `rgba(40,40,46,${0.55 * (1 - p)})` : `rgba(170,182,205,${0.35 * (1 - p)})`);
    }
    ctx.strokeStyle = '#e0a000'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(-84, -124); ctx.lineTo(MAST.x, MAST.y); ctx.lineTo(-36, -124); ctx.stroke(); // А-образная мачта
    if (!dead) { // проблесковый маячок
      const ba = t * 6; ctx.fillStyle = rage ? 'rgba(255,50,50,.35)' : 'rgba(255,170,40,.3)';
      ctx.beginPath(); ctx.moveTo(-16, -130); ctx.lineTo(-16 + Math.cos(ba - 0.3) * 24, -130 + Math.sin(ba - 0.3) * 10); ctx.lineTo(-16 + Math.cos(ba + 0.3) * 24, -130 + Math.sin(ba + 0.3) * 10); ctx.fill();
      ctx.fillStyle = rage ? '#ff3030' : '#ff9d1a'; ctx.fillRect(-19, -133, 6, 7);
    }

    // кабина на стреле-подъёмнике (слабое место)
    const c = cabPos(e), mx = HINGE.x + (c.x - HINGE.x) * 0.55, my = HINGE.y + (c.y - HINGE.y) * 0.55;
    ctx.lineCap = 'round'; ctx.strokeStyle = '#3a3f48'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(HINGE.x, HINGE.y); ctx.lineTo(mx, my); ctx.stroke();
    ctx.strokeStyle = '#aab3c2'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.lineCap = 'butt';
    glow(ctx, HINGE.x, HINGE.y, 5, '#23272f'); ctx.save(); ctx.translate(c.x + sh * 0.5, c.y); ctx.rotate(-0.25 * e.bow);
    if (e.bow > 0.6 && !dead) { ctx.fillStyle = `rgba(255,230,120,${0.3 + 0.2 * Math.sin(t * 14)})`; ctx.fillRect(-31, -30, 62, 56); } // кабина опущена — подсвечена
    ctx.fillStyle = '#f2b705'; ctx.fillRect(-25, -20, 50, 40); ctx.fillStyle = '#c98f00'; ctx.fillRect(-25, 12, 50, 8); ctx.fillStyle = '#d39c00'; ctx.fillRect(-28, -24, 56, 5);
    ctx.fillStyle = dead ? '#6d8cab' : '#9fd3ff'; ctx.fillRect(-22, -15, 30, 24);
    drawChief(ctx, e); ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.moveTo(-22, -15); ctx.lineTo(-13, -15); ctx.lineTo(-22, -1); ctx.fill();
    ctx.strokeStyle = '#3a3f48'; ctx.lineWidth = 2; ctx.strokeRect(-22, -15, 30, 24); ctx.fillStyle = '#1b1b1b'; ctx.fillRect(12, -14, 9, 2); ctx.fillRect(12, -9, 9, 2);
    ctx.fillStyle = '#c62828'; ctx.fillRect(-21, -33, 42, 9); api.text('ИНСПЕКТОР', 0, -26, 6.5, '#fff');
    if (e.flash > 0 && Math.floor(e.flash * 30) % 2) { ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(-26, -34, 52, 55); } // попадание
    ctx.restore(); if (e.say) bubble(ctx, api, Math.min(c.x - 56, -60), Math.max(-190, c.y - 30), e.say.txt, dead ? '#2e7d32' : '#b3261e');
  }

  // ---------- механики темы: салют победы, брызги водосбросов, ярость ----------
  function update(dt, api) {
    for (const d of S.decals) d.t += dt;
    while (S.decals.length && S.decals[0].t > 6) S.decals.shift(); const c = S.cel;
    if (c) { // салют над плотиной и взрывы на экскаваторе, пока движок не завершил участок (~1,8 с)
      c.t += dt; c.acc += dt; const cols = ['#ff5d5d', '#ffd76a', '#7ec8ff', '#6cff8a', '#ffffff'];
      while (c.acc > 0.12) {
        c.acc -= 0.12; c.n++; api.burst(c.x - 380 + api.hash(c.n * 7) * 520, c.y - 130 - api.hash(c.n * 7 + 1) * 90, cols[c.n % 5], 22, 240, 140);
        if (c.n % 2) api.burst(c.x - 60 + api.hash(c.n * 7 + 2) * 120, c.y - 40 - api.hash(c.n * 7 + 3) * 80, '#ffb347', 10, 180, 400); if (c.n % 3 === 0) api.shake(5);
      }
    }
  }

  function drawForeground(ctx, api) { // брызги над водосбросами — перед героем
    const now = api.now; ctx.fillStyle = '#f4faff';
    for (const p of api.pits) {
      if (p.x + p.w < api.camX - 40 || p.x > api.camX + api.W + 40) continue;
      for (let i = 0; i < 12; i++) {
        const h = api.hash(i * 5 + Math.floor(p.x)), ph = (now * (0.8 + h * 0.5) + h) % 1;
        ctx.globalAlpha = 0.85 * (1 - ph); ctx.fillRect(p.x + p.w * (0.1 + 0.8 * h) + (h - 0.5) * 30 * ph, p.y + 32 - Math.sin(ph * 3.14) * (30 + h * 30), 2, 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawOverlay(ctx, api) {
    const { W, H } = api, A = api.arena; if (A && A.active && !A.boss.dead && A.boss.phase === 3) { // ярость инспектора — красная пульсация по краям
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.72);
      g.addColorStop(0, 'rgba(255,30,30,0)'); g.addColorStop(1, `rgba(255,30,30,${0.2 + 0.08 * Math.sin(api.now * 6)})`); ctx.fillStyle = g; ctx.fillRect(0, 30, W, H - 30);
    }
    if (S.cel && S.cel.t > 0.25) { // печать «АКТ ПОДПИСАН!» падает на экран
      const k = Math.min(1, (S.cel.t - 0.25) / 0.18), sc = 2.2 - 1.2 * k;
      ctx.save(); ctx.globalAlpha = Math.min(1, k * 1.5) * 0.94; ctx.translate(W / 2, 150); ctx.rotate(-0.12); ctx.scale(sc, sc);
      ctx.fillStyle = 'rgba(255,248,238,.88)'; ctx.fillRect(-150, -36, 300, 72);
      ctx.strokeStyle = '#e53935'; ctx.lineWidth = 4; ctx.strokeRect(-146, -32, 292, 64); ctx.lineWidth = 1.5; ctx.strokeRect(-139, -25, 278, 50);
      api.text('АКТ ПОДПИСАН!', 0, 9, 30, '#e53935'); api.text('ПРИЁМОЧНАЯ КОМИССИЯ · ГЭС', 0, 20, 8, '#e53935'); ctx.restore();
    }
  }

  registerTheme({
    index: 10, id: 'dam',
    title: 'ГЭС: сдача объекта', subtitle: 'Плотина, машинный зал и приёмочная комиссия',
    accent: '#ff5d5d', dust: '#9aa6b8', headlamp: true,
    gen: { length: 2800, groundRange: [255, 300], pitW: [72, 108], weights: { pit: 26, platforms: 20, step: 10, obstacle: 16, flat: 28 }, enemyDensity: 1.15, boss: { type: 'inspector', arenaW: 860 } },
    decor: ['flood', 'flood', 'booth', 'hv', 'drum'],
    enemies,
    enemyTable: [
      { type: 'clerk', where: 'ground', weight: 3 },
      { type: 'clerk', where: 'upper', weight: 1 },
      { type: 'inspdrone', where: 'air', weight: 2 },
      { type: 'stamper', where: 'ground', weight: 2, from: 0.15 },
    ],
    init() { S.decals = []; S.cel = null; S.wreck = null; },
    update,
    drawBackground, drawGround, drawPit, drawPlatform, drawObstacle, drawDecor, drawForeground, drawOverlay,
    drawFinish(fx, gy, ctx, api) { drawTent(ctx, api, fx + 140, gy); }, // на участке с боссом не вызывается
  });
})();
