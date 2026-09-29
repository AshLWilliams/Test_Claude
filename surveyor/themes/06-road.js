'use strict';
// Участок 6 — дорожная стройка: новая трасса в летний полдень. Асфальтобетонный завод, недостроенная эстакада,
// слоёный «пирог» дороги, катки, дорожники с лопатами и лужи горячего битума. Над асфальтом дрожит марево.
// Контракт темы: см. THEMES.md, образец — 01-city.js.
(() => {
  // ---------- общее ----------
  let skyG = null;                           // градиент неба создаётся один раз
  const st = { splats: [], berm: null, bermT: 0 }; // состояние темы: остывающие кляксы асфальта; высота насыпи ближнего фона
  const MAX_SPLATS = 8, SPLAT_LIFE = 2.6;
  const BALLOONS = ['#e53935', '#fdd835', '#1e88e5', '#43a047', '#ffffff'];
  const STONE = ['#a09a90', '#6e6a64', '#b0aca3'];                     // цвета щебня
  const FLOOR = 312;                         // ниже фон всегда закрыт грунтом или траншеей — туда не рисуем

  // Обход особенности генератора: зажим высоты земли изредка (≈1 уровень из 170) даёт соседние отрезки с перепадом
  // 1–4 ед. — на вид ровно, а герой упирается. Поднимаем нижнюю «серию» отрезков до соседа вместе с блоками,
  // платформами, врагами и провалом за ней (декор и чекпоинты уходят в грунт на ≤ 4 ед. — незаметно).
  function fixTinySteps(api) {
    const { solids, platforms, enemies, pits, player: P } = api, adj = (a, b) => Math.abs(b.x - a.x - a.w) < 0.5;
    for (let pass = 0; pass < 8; pass++) {
      const g = solids.filter(s => s.kind === 'ground').sort((a, b) => a.x - b.x);
      const i = g.findIndex((B, k) => k > 0 && adj(g[k - 1], B) && B.y !== g[k - 1].y && Math.abs(B.y - g[k - 1].y) <= 4);
      if (i < 0) break;
      const low = g[i - 1].y > g[i].y ? i - 1 : i, y0 = g[low].y, d = -Math.abs(g[i].y - g[i - 1].y);
      let a = low, b = low;
      while (a > 0 && adj(g[a - 1], g[a]) && g[a - 1].y === y0) a--;
      while (b + 1 < g.length && adj(g[b], g[b + 1]) && g[b + 1].y === y0) b++;
      const x0 = g[a].x, x1 = g[b].x + g[b].w, inRun = o => { const c = o.x + (o.w || 0) / 2; return c >= x0 && c < x1; };
      for (const s of solids) if (inRun(s) && (s.kind === 'obstacle' || s.y === y0)) { s.y += d; if (s.kind !== 'obstacle') s.h -= d; }
      for (const p of platforms) if (inRun(p)) { p.y += d; p.base += d; }
      for (const e of enemies) if (inRun(e)) { e.y += d; e.groundY += d; }
      for (const p of pits) if (Math.abs(p.x - x1) < 0.5) p.y += d;
    }
    const top = api.groundAt(P.x + P.w / 2);
    if (top !== null && P.y + P.h > top) P.y = top - P.h; // стартовый отрезок мог подняться — ставим героя на него
  }

  function cloud(ctx, x, y, k) { // кучевое облако: плоское дно, пухлый верх
    ctx.fillStyle = '#d6eaf7'; ctx.beginPath(); ctx.ellipse(x + 2 * k, y + 10 * k, 36 * k, 5 * k, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath();
    for (const [cx, cy, r] of [[-24, 2, 10], [-9, -6, 15], [10, -9, 17], [27, 1, 11]]) { ctx.moveTo(x + (cx + r) * k, y + cy * k); ctx.arc(x + cx * k, y + cy * k, r * k, 0, 7); }
    ctx.rect(x - 24 * k, y, 51 * k, 10 * k); ctx.fill();
  }

  function drawPlant(ctx, api, x) { // асфальтобетонный завод: битумные ёмкости, силосы, смесительная башня, сушильный барабан, труба
    const { now, text } = api;
    ctx.fillStyle = '#4a5058'; // битумные ёмкости
    for (let k = 0; k < 2; k++) { const ty = 222 + k * 18; ctx.beginPath(); ctx.ellipse(x + 8, ty + 8, 5, 8, 0, 0, 7); ctx.ellipse(x + 52, ty + 8, 5, 8, 0, 0, 7); ctx.rect(x + 8, ty, 44, 16); ctx.fill(); }
    ctx.fillStyle = '#6b737c'; ctx.fillRect(x + 8, 224, 44, 2); ctx.fillRect(x + 8, 242, 44, 2);
    for (let k = 0; k < 3; k++) { // силосы минерального порошка
      const sx = x + 66 + k * 26;
      ctx.fillStyle = '#9aa7b1'; ctx.fillRect(sx + 4, 214, 2, 48); ctx.fillRect(sx + 16, 214, 2, 48);
      ctx.fillStyle = '#e3e8ec'; ctx.fillRect(sx, 104 + k * 6, 22, 96 - k * 6);
      ctx.fillStyle = '#c8d0d7'; ctx.fillRect(sx + 13, 104 + k * 6, 9, 96 - k * 6);
      ctx.beginPath(); ctx.moveTo(sx, 200); ctx.lineTo(sx + 22, 200); ctx.lineTo(sx + 13, 216); ctx.lineTo(sx + 9, 216); ctx.fill();
      ctx.fillStyle = '#b9c3cb'; ctx.beginPath(); ctx.ellipse(sx + 11, 104 + k * 6, 11, 4, 0, Math.PI, 0); ctx.fill();
    }
    ctx.strokeStyle = '#8795a1'; ctx.lineWidth = 4; // наклонный транспортёр к башне
    ctx.beginPath(); ctx.moveTo(x + 150, 258); ctx.lineTo(x + 176, 96); ctx.stroke();
    ctx.lineWidth = 1; ctx.beginPath(); for (let k = 1; k < 9; k++) { const t = k / 9; ctx.moveTo(x + 150 + 26 * t - 4, 258 - 162 * t); ctx.lineTo(x + 150 + 26 * t + 4, 258 - 162 * t - 6); } ctx.stroke();
    ctx.fillStyle = '#6f9fc4'; ctx.fillRect(x + 176, 80, 46, 182); // смесительная башня
    ctx.fillStyle = '#5a88ac'; ctx.fillRect(x + 206, 80, 16, 182);
    ctx.fillStyle = '#4e5c69'; ctx.fillRect(x + 172, 72, 54, 10);
    ctx.fillStyle = '#d4ecf9'; for (let wy = 100; wy < 240; wy += 34) ctx.fillRect(x + 182, wy, 22, 6);
    text('АБЗ', x + 199, 158, 11, '#ffffff');
    ctx.save(); ctx.translate(x + 226, 212); ctx.rotate(-0.08); // сушильный барабан с горелкой
    ctx.fillStyle = '#8b959e'; ctx.fillRect(0, -9, 74, 18); ctx.fillStyle = '#6f7a84'; ctx.fillRect(12, -9, 4, 18); ctx.fillRect(56, -9, 4, 18);
    ctx.fillStyle = '#d0473a'; ctx.fillRect(74, -6, 8, 12); ctx.restore();
    ctx.fillStyle = '#9aa7b1'; ctx.fillRect(x + 236, 222, 3, 40); ctx.fillRect(x + 290, 218, 3, 44);
    ctx.fillStyle = '#d6dbdf'; ctx.fillRect(x + 306, 70, 11, 192); // дымовая труба
    ctx.fillStyle = '#d84a3a'; ctx.fillRect(x + 306, 70, 11, 6); ctx.fillRect(x + 306, 84, 11, 5);
    for (let k = 0; k < 5; k++) { // пар из трубы уносит ветром
      const ph = (now * 0.22 + k / 5) % 1;
      ctx.fillStyle = `rgba(246,249,251,${(0.75 * (1 - ph)).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(x + 312 + ph * 70, 64 - ph * 22, 5 + ph * 14, 0, 7); ctx.fill();
    }
  }

  // ---------- фон ----------
  function drawBackground(ctx, api) {
    const { W, camX, hash, now } = api;
    if (!skyG) {
      skyG = ctx.createLinearGradient(0, 0, 0, 225);
      skyG.addColorStop(0, '#2c8ad8'); skyG.addColorStop(0.6, '#86cbf1'); skyG.addColorStop(1, '#e6f6fd');
    }
    ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, 206); // ниже неба всё закрывают холмы, поля и насыпь
    const sx = W * 0.14 - camX * 0.01; // полуденное солнце
    ctx.fillStyle = 'rgba(255,250,210,.22)'; ctx.beginPath(); ctx.arc(sx, 72, 48, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,248,200,.45)'; ctx.beginPath(); ctx.arc(sx, 72, 31, 0, 7); ctx.fill();
    ctx.fillStyle = '#fffbe3'; ctx.beginPath(); ctx.arc(sx, 72, 19, 0, 7); ctx.fill();

    // облака медленно плывут
    let off = camX * 0.05 + now * 5, step = 230;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      if (hash(i + 500) < 0.35) continue;
      cloud(ctx, i * step - off + hash(i + 501) * 90, 56 + hash(i + 502) * 56, 0.7 + hash(i + 503) * 0.6);
    }

    // дальний план: голубые холмы, кромка леса, поля и ЛЭП
    off = camX * 0.06;
    ctx.fillStyle = '#9fc6bb'; ctx.beginPath(); ctx.moveTo(0, 230);
    for (let x = 0; x <= W + 16; x += 16) { const wx = x + off; ctx.lineTo(x, 190 + Math.sin(wx * 0.006) * 9 + Math.sin(wx * 0.017 + 1) * 4); }
    ctx.lineTo(W + 16, 230); ctx.fill();
    off = camX * 0.09; step = 11;
    ctx.fillStyle = '#4f8d57'; ctx.beginPath(); // кромка леса — один контур из крон-горбиков
    const i0 = Math.floor(off / step) - 1;
    ctx.moveTo(i0 * step - off - step, 214);
    for (let i = i0; i < (off + W) / step + 1; i++) {
      const x = i * step - off, r = 6 + hash(i + 40) * 5, y = 205 - hash(i + 41) * 5 + Math.sin(i * 0.13) * 3;
      ctx.lineTo(x - step / 2, y - r * 0.2); ctx.quadraticCurveTo(x, y - r * 2, x + step / 2, y - r * 0.2);
    }
    ctx.lineTo(W + step, 214); ctx.fill();
    ctx.fillStyle = '#3f7447'; ctx.fillRect(0, 210, W, 4);
    off = camX * 0.12; step = 170;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off, c = hash(i + 60);
      ctx.fillStyle = c < 0.35 ? '#e2cd6c' : c < 0.7 ? '#a6d06c' : '#c8dc7d';
      ctx.beginPath(); ctx.moveTo(x, 213); ctx.lineTo(x + step + 1, 213); ctx.lineTo(x + step + 41, 272); ctx.lineTo(x + 40, 272); ctx.fill();
      ctx.fillStyle = 'rgba(60,80,20,.08)'; ctx.beginPath(); for (let fy = 220; fy < 272; fy += 9) ctx.rect(x + (fy - 213) * 0.68, fy, step, 2); ctx.fill(); // борозды
      if (c < 0.35 && hash(i + 61) > 0.3) { ctx.fillStyle = '#c9a646'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x + 40 + k * 38 + hash(i + k) * 12, 226 + k * 3, 3.5, 0, 7); ctx.fill(); } } // рулоны сена
    }
    step = 360; ctx.strokeStyle = 'rgba(80,100,110,.55)'; ctx.lineWidth = 1; // опоры ЛЭП и провода
    ctx.beginPath();
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off + 60;
      ctx.moveTo(x - 7, 214); ctx.lineTo(x, 164); ctx.lineTo(x + 7, 214); ctx.moveTo(x - 10, 170); ctx.lineTo(x + 10, 170);
      ctx.moveTo(x - 10, 170); ctx.quadraticCurveTo(x + step / 2 - 10, 184, x + step - 10, 170);
      ctx.moveTo(x + 10, 170); ctx.quadraticCurveTo(x + step / 2 + 10, 184, x + step + 10, 170);
    }
    ctx.stroke();
    // марево у горизонта: дрожащие светлые полосы
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath();
    for (let k = 0; k < 3; k++) for (let x = 0; x < W; x += 12) ctx.rect(x, 211 + k * 5 + Math.sin(x * 0.05 + now * (3 + k) + k) * 1.3, 12, 1.4);
    ctx.fill();

    // средний план: асфальтобетонный завод
    off = camX * 0.2; step = 1250;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off + hash(i + 80) * 300;
      if (x < W + 10 && x + 400 > -10) drawPlant(ctx, api, x);
    }

    // недостроенная эстакада: опоры с ригелями, готовые пролёты и пролёт под монтажом
    off = camX * 0.32; step = 190;
    const dy = 116;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off, built = ((i % 5) + 5) % 5 !== 3; // каждый пятый пролёт ещё монтируют
      ctx.fillStyle = '#aab6c0'; ctx.fillRect(x - 8, dy + 20, 16, 262 - dy - 20);
      ctx.fillStyle = '#95a2ad'; ctx.fillRect(x + 3, dy + 20, 5, 262 - dy - 20);
      ctx.fillStyle = '#b5c0c9'; ctx.beginPath(); ctx.moveTo(x - 26, dy + 10); ctx.lineTo(x + 26, dy + 10); ctx.lineTo(x + 14, dy + 22); ctx.lineTo(x - 14, dy + 22); ctx.fill();
      if (built) {
        ctx.fillStyle = '#bcc7d0'; ctx.fillRect(x - 1, dy, step + 2, 10);
        ctx.fillStyle = '#98a5b0'; ctx.fillRect(x, dy + 7, step, 3);
        ctx.fillStyle = '#8795a1'; ctx.fillRect(x, dy - 6, step, 2);
        for (let px = x + 6; px < x + step; px += 16) ctx.fillRect(px, dy - 6, 2, 6);
      } else { // монтаж балки: козловой кран поднимает пролётную балку, под пролётом подмости
        ctx.strokeStyle = '#9aa7b1'; ctx.lineWidth = 1; ctx.beginPath();
        for (let r = 0; r < 5; r++) { ctx.moveTo(x + 10 + r * 3, dy + 10); ctx.lineTo(x + 12 + r * 3, dy + 2); ctx.moveTo(x + step - 10 - r * 3, dy + 10); ctx.lineTo(x + step - 12 - r * 3, dy + 2); }
        const tx = x + step / 2 - 24;
        for (let fy = dy + 30; fy < 262; fy += 22) { ctx.rect(tx, fy, 48, 22); ctx.moveTo(tx, fy); ctx.lineTo(tx + 48, fy + 22); }
        ctx.stroke();
        ctx.fillStyle = '#d6b95e'; ctx.fillRect(x + 22, dy - 36, 3, 46); ctx.fillRect(x + step - 25, dy - 36, 3, 46); ctx.fillRect(x + 18, dy - 39, step - 36, 4);
        const gx = x + step / 2 + Math.sin(now * 0.3 + i) * 20, hy = dy - 10 + Math.sin(now * 0.8 + i) * 4; // тележка ездит, балка покачивается
        ctx.strokeStyle = '#56616b'; ctx.beginPath(); ctx.moveTo(gx - 26, dy - 35); ctx.lineTo(gx - 26, hy); ctx.moveTo(gx + 26, dy - 35); ctx.lineTo(gx + 26, hy); ctx.stroke();
        ctx.fillStyle = '#56616b'; ctx.fillRect(gx - 30, dy - 37, 60, 3);
        ctx.fillStyle = '#c3ccd4'; ctx.fillRect(gx - 60, hy, 120, 7); ctx.fillStyle = '#a4b0ba'; ctx.fillRect(gx - 60, hy + 5, 120, 2);
      }
    }

    // ближний фон: насыпь, бытовки, самосвал, асфальтоукладчик, дорожные знаки.
    // Бровка насыпи плавно держится чуть выше самой высокой видимой дороги — иначе при высокой земле
    // над асфальтом торчат только крыши бытовок и кузова, и их легко принять за препятствия.
    let top = 255;
    for (const s of api.solids) if (s.kind === 'ground' && s.x < camX + W && s.x + s.w > camX && s.y - 3 < top) top = s.y - 3;
    const bdt = api.clamp(now - st.bermT, 0, 0.1); st.bermT = now;
    st.berm = st.berm === null ? top : st.berm + (top - st.berm) * Math.min(1, bdt * 3);
    const by = Math.round(st.berm * 2) / 2;
    off = camX * 0.55;
    ctx.fillStyle = '#7fae55'; ctx.fillRect(0, by - 1, W, FLOOR - by + 1);
    ctx.fillStyle = '#6c9b47'; ctx.beginPath();
    step = 13;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) { const x = i * step - off, h = 3 + hash(i + 200) * 5; ctx.moveTo(x, by); ctx.lineTo(x + 3, by - h); ctx.lineTo(x + 6, by); }
    ctx.fill();
    step = 300;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off + hash(i + 210) * 90, c = hash(i + 211), y = by;
      if (c < 0.22) { // бытовки
        for (let k = 0; k < 2; k++) {
          const bx = x + k * 50;
          ctx.fillStyle = k ? '#3f7ec2' : '#e9edf0'; ctx.fillRect(bx, y - 28, 46, 28);
          ctx.fillStyle = k ? '#346aa5' : '#cfd6dc'; for (let r = 0; r < 46; r += 6) ctx.fillRect(bx + r, y - 28, 1, 28);
          ctx.fillStyle = '#bfe3f7'; ctx.fillRect(bx + 8, y - 21, 12, 8);
        }
      } else if (c < 0.44) { // самосвал
        ctx.fillStyle = '#d9772b'; ctx.fillRect(x, y - 30, 48, 18); ctx.fillStyle = '#6b5d4a'; ctx.fillRect(x + 2, y - 34, 44, 5);
        ctx.fillStyle = '#3f7ec2'; ctx.fillRect(x + 50, y - 32, 20, 20); ctx.fillStyle = '#cbe7f7'; ctx.fillRect(x + 58, y - 29, 10, 8);
        ctx.fillStyle = '#34383d'; ctx.fillRect(x, y - 13, 70, 4);
        for (const wx of [12, 28, 60]) { ctx.beginPath(); ctx.arc(x + wx, y - 6, 6, 0, 7); ctx.fill(); }
      } else if (c < 0.64) { // асфальтоукладчик: бункер, кабина, дымок над горячей смесью
        ctx.fillStyle = '#c9b67a'; ctx.fillRect(x, y - 22, 60, 14); ctx.fillStyle = '#b09c5e'; ctx.beginPath(); ctx.moveTo(x + 44, y - 22); ctx.lineTo(x + 70, y - 34); ctx.lineTo(x + 70, y - 22); ctx.fill();
        ctx.fillStyle = '#5d646b'; ctx.fillRect(x + 12, y - 38, 2, 16); ctx.fillRect(x + 32, y - 38, 2, 16); ctx.fillRect(x + 8, y - 40, 30, 3);
        ctx.fillStyle = '#50565c'; ctx.fillRect(x - 10, y - 10, 80, 7); ctx.fillStyle = '#44494f'; ctx.fillRect(x - 16, y - 6, 22, 5);
        for (let k = 0; k < 2; k++) { const ph = (now * 0.5 + k / 2 + i * 0.3) % 1; ctx.fillStyle = `rgba(240,240,240,${(0.5 * (1 - ph)).toFixed(2)})`; ctx.beginPath(); ctx.arc(x - 8 - ph * 6, y - 12 - ph * 22, 3 + ph * 6, 0, 7); ctx.fill(); }
      } else if (c < 0.84) { // синий указатель объезда
        ctx.fillStyle = '#8c959d'; ctx.fillRect(x + 6, y - 44, 3, 44); ctx.fillRect(x + 57, y - 44, 3, 44);
        ctx.fillStyle = '#fff'; ctx.fillRect(x, y - 70, 66, 30); ctx.fillStyle = '#1f62b5'; ctx.fillRect(x + 2, y - 68, 62, 26);
        api.text('ОБЪЕЗД', x + 26, y - 51, 9, '#fff');
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x + 51, y - 60); ctx.lineTo(x + 61, y - 55); ctx.lineTo(x + 51, y - 50); ctx.fill();
      } else { // ограничение скорости
        ctx.fillStyle = '#8c959d'; ctx.fillRect(x - 1, y - 40, 3, 40);
        ctx.fillStyle = '#d32f2f'; ctx.beginPath(); ctx.arc(x, y - 50, 12, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y - 50, 9, 0, 7); ctx.fill();
        api.text('40', x, y - 46, 10, '#111');
      }
    }
  }

  // ---------- земля, провалы, платформы, препятствия ----------
  function drawGround(s, ctx, api) { // «пирог» дороги: свежий асфальт с разметкой, щебень, песчаная подушка
    const { H, hash, camX, W } = api, x0 = s.x - 0.5, w = s.w + 1, y = s.y;
    // мелкие узоры рисуем только в кадре (отрезок у финиша — 900 ед.), шаг привязан к отрезку — узор не «плывёт»
    const xa = Math.max(s.x, camX - 12), xb = Math.min(s.x + s.w, camX + W + 12);
    const from = (o, step) => s.x + o + Math.max(0, Math.ceil((xa - s.x - o) / step)) * step;
    const bot = H + 10; // песчаная подушка, ниже — пласты природного суглинка (плоские заливки дешевле градиента)
    ctx.fillStyle = '#e0bb78'; ctx.fillRect(x0, y + 30, w, 6);
    ctx.fillStyle = '#d4aa65'; ctx.fillRect(x0, y + 36, w, 34);
    ctx.fillStyle = '#86603f'; ctx.fillRect(x0, y + 70, w, Math.max(0, Math.min(40, bot - y - 70)));
    if (y + 110 < bot) { ctx.fillStyle = '#6f4e33'; ctx.fillRect(x0, y + 110, w, Math.min(45, bot - y - 110)); }
    if (y + 155 < bot) { ctx.fillStyle = '#5a3e28'; ctx.fillRect(x0, y + 155, w, bot - y - 155); }
    ctx.fillStyle = 'rgba(150,110,60,.45)'; ctx.beginPath();
    for (let x = from(8, 13); x < xb - 8; x += 13) { const h = hash(Math.floor(x) * 7 + 3); ctx.rect(x, y + 34 + h * 32, 2 + h * 3, 1.5); }
    ctx.fill();
    ctx.fillStyle = 'rgba(30,18,8,.35)'; ctx.beginPath(); // камешки и корни в суглинке
    for (let x = from(6, 17); x < xb - 8; x += 17) { const h = hash(Math.floor(x) * 11 + 5); ctx.rect(x, y + 76 + h * 70, 4 + h * 6, 2 + h * 2); }
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x0, y + 70, w, 2);
    ctx.fillStyle = '#ece6d6'; ctx.fillRect(x0, y + 29, w, 1.5); // геотекстиль
    ctx.fillStyle = '#8f8b84'; ctx.fillRect(x0, y + 14, w, 15); // щебёночное основание
    for (let c = 0; c < 3; c++) {
      ctx.fillStyle = STONE[c]; ctx.beginPath();
      for (let x = from(2, 5); x < xb - 3; x += 5) {
        const h = hash(Math.floor(x) * 13 + 1);
        if (Math.min(2, Math.floor(h * 3)) === c) ctx.rect(x, y + 16 + h * 9, 3 + h * 2, 2 + (1 - h) * 2);
      }
      ctx.fill();
    }
    ctx.fillStyle = '#26282c'; ctx.fillRect(x0, y + 4, w, 10); // слой асфальтобетона в разрезе
    ctx.fillStyle = '#4a4d53'; ctx.beginPath();
    for (let x = from(3, 6); x < xb - 2; x += 6) { const h = hash(Math.floor(x) * 5 + 9); ctx.rect(x, y + 6 + h * 6, 1.5, 1.5); }
    ctx.fill();
    ctx.fillStyle = '#44474d'; ctx.fillRect(x0, y, w, 5); // поверхность полотна
    ctx.fillStyle = '#5d6168'; ctx.fillRect(x0, y, w, 1);
    ctx.fillStyle = '#f4f4ef'; ctx.beginPath(); // прерывистая осевая разметка (сквозная по миру)
    for (let dx = Math.floor(xa / 44) * 44 - 44; dx < xb; dx += 44) {
      const a = Math.max(dx, s.x + 2), b = Math.min(dx + 24, s.x + s.w - 2);
      if (b > a) ctx.rect(a, y + 1.5, b - a, 2);
    }
    ctx.fill();
    drawSplats(s.x, s.x + s.w, y, ctx);
  }

  function drawSplats(x0, x1, y, ctx) { // остывающие кляксы асфальта от бросков дорожника
    for (const sp of st.splats) {
      if (sp.x < x0 || sp.x >= x1 || Math.abs(sp.y - y) > 2) continue;
      const k = sp.t / SPLAT_LIFE, a = 1 - k;
      ctx.globalAlpha = a; ctx.fillStyle = '#141210'; ctx.beginPath(); ctx.ellipse(sp.x, y, 10, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff7a1a'; ctx.globalAlpha = Math.max(0, 1 - k * 1.8); ctx.fillRect(sp.x - 5, y - 1, 3, 1.5); ctx.fillRect(sp.x + 2, y - 1.5, 4, 1.5);
      ctx.fillStyle = '#c8c8c8'; ctx.globalAlpha = a * 0.4; ctx.beginPath(); ctx.arc(sp.x + Math.sin(sp.t * 4) * 3, y - 8 - k * 22, 3 + k * 6, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawPit(p, ctx, api) { // траншея под коммуникации: крепь из досок, трубы на дне, оградительная сетка
    const { H, hash, now } = api, x = p.x, w = p.w, y = p.y;
    ctx.fillStyle = '#4b3726'; ctx.fillRect(x, y, w, 40); // задняя стенка: светлее у бровки, темнее в глубине
    ctx.fillStyle = '#3a2a1c'; ctx.fillRect(x, y + 40, w, H - y - 40);
    ctx.fillStyle = '#8d6a45'; // щиты крепления стенок
    for (let px = x + 4; px < x + w - 8; px += 16) ctx.fillRect(px, y + 8, 12, H - y - 50);
    ctx.fillStyle = '#6b4f33'; for (let px = x + 4; px < x + w - 8; px += 16) ctx.fillRect(px + 10, y + 8, 2, H - y - 50);
    ctx.fillStyle = '#5c6770'; ctx.fillRect(x, y + 22, w, 4); ctx.fillRect(x, y + 70, w, 4); // стальные распорные пояса
    ctx.fillStyle = '#2a2018'; ctx.fillRect(x, H - 16, w, 16); // дно с песчаной подсыпкой
    ctx.fillStyle = '#6e5a3e'; for (let px = x + 3; px < x + w; px += 7) ctx.fillRect(px, H - 16 + hash(Math.floor(px)) * 4, 3, 2);
    const cx = x + w * 0.34; // трубы: бетонная, водопровод, газ
    ctx.fillStyle = '#a9a39a'; ctx.beginPath(); ctx.arc(cx, H - 36, 21, 0, 7); ctx.fill();
    ctx.fillStyle = '#21180f'; ctx.beginPath(); ctx.arc(cx, H - 36, 15, 0, 7); ctx.fill();
    ctx.fillStyle = '#2f7fd1'; ctx.beginPath(); ctx.arc(x + w * 0.72, H - 25, 10, 0, 7); ctx.fill();
    ctx.fillStyle = '#9fd0ff'; ctx.beginPath(); ctx.arc(x + w * 0.72 - 3, H - 28, 3, 0, 7); ctx.fill();
    ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.arc(x + w * 0.72 + 14, H - 20, 5, 0, 7); ctx.fill();
    for (const [fx, side] of [[x - 24, 0], [x + w + 4, 1]]) { // сетка-ограждение по краям траншеи
      const gy = side ? (api.groundAt(x + w + 12) ?? y) : y;
      ctx.fillStyle = '#9aa3ab'; ctx.fillRect(fx, gy - 20, 2, 20); ctx.fillRect(fx + 18, gy - 20, 2, 20);
      ctx.fillStyle = '#ff6d1a'; ctx.fillRect(fx + 2, gy - 17, 16, 11);
      ctx.strokeStyle = '#c24a0d'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0; k < 16; k += 4) { ctx.moveTo(fx + 2 + k, gy - 17); ctx.lineTo(fx + 6 + k, gy - 6); ctx.moveTo(fx + 6 + k, gy - 17); ctx.lineTo(fx + 2 + k, gy - 6); }
      ctx.stroke();
      const on = Math.sin(now * 6 + p.v * 9 + side * 3) > 0; // мигающий фонарь на столбике
      ctx.fillStyle = on ? '#ffd23a' : '#8a6d1c'; ctx.fillRect(fx - 1, gy - 25, 4, 5);
      if (on) { ctx.fillStyle = 'rgba(255,210,60,.3)'; ctx.beginPath(); ctx.arc(fx + 1, gy - 23, 6, 0, 7); ctx.fill(); }
    }
  }

  function drawPlatform(p, ctx) { // опалубка пролёта эстакады: телескопические стойки, балки, фанера, свежий бетон
    const n = Math.max(2, Math.round(p.w / 46));
    ctx.strokeStyle = 'rgba(110,122,134,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); // связи между стойками
    for (let i = 0; i < n; i++) { const a = p.x + 6 + i * (p.w - 12) / n, b = a + (p.w - 12) / n; ctx.moveTo(a, p.base - 4); ctx.lineTo(b, p.y + 16); ctx.moveTo(a, p.y + 16); ctx.lineTo(b, p.base - 4); }
    ctx.stroke();
    for (let i = 0; i <= n; i++) {
      const x = p.x + 6 + i * (p.w - 12) / n, mid = (p.y + 14 + p.base) / 2;
      ctx.fillStyle = '#d0342c'; ctx.fillRect(x - 2.5, mid, 5, p.base - mid);
      ctx.fillStyle = '#b4bcc4'; ctx.fillRect(x - 1.5, p.y + 13, 3, mid - p.y - 13);
      ctx.fillStyle = '#f2c230'; ctx.fillRect(x - 3.5, mid - 2, 7, 4);
      ctx.fillStyle = '#555c63'; ctx.fillRect(x - 5, p.base - 2, 10, 2);
    }
    ctx.fillStyle = '#c98f1c'; ctx.fillRect(p.x - 4, p.y + 11, p.w + 8, 3); // прогон
    ctx.fillStyle = '#eab332'; for (let x = p.x - 2; x < p.x + p.w; x += 17) ctx.fillRect(x, p.y + 7, 9, 5); // торцы балок опалубки
    ctx.fillStyle = '#9b4a2a'; ctx.fillRect(p.x - 6, p.y + 3, p.w + 12, 5); // ламинированная фанера
    ctx.fillStyle = '#cfcbc2'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 4); // свежий бетон
    ctx.fillStyle = '#a9a59c'; for (let x = p.x - 2; x < p.x + p.w + 4; x += 11) ctx.fillRect(x, p.y + 1, 2, 1);
    ctx.strokeStyle = '#6b7178'; ctx.lineWidth = 1.5; ctx.beginPath(); // выпуски арматуры на торцах
    for (const ex of [p.x - 6, p.x + p.w + 6]) for (let k = 0; k < 3; k++) { ctx.moveTo(ex, p.y + 1 + k * 2); ctx.lineTo(ex + (ex < p.x ? -6 : 6), p.y + k * 2); }
    ctx.stroke();
    ctx.fillStyle = '#222'; ctx.fillRect(p.x - 4, p.y - 14, 2, 14); ctx.fillRect(p.x + p.w + 2, p.y - 14, 2, 14); // ограждение края
    for (let x = p.x - 4; x < p.x + p.w + 4; x += 10) { ctx.fillStyle = (Math.floor((x - p.x) / 10) % 2) ? '#222' : '#f2c230'; ctx.fillRect(x, p.y - 14, Math.min(10, p.x + p.w + 4 - x), 2); }
  }

  function drawObstacle(s, ctx, api) { // бетонные блоки «нью-джерси» с бело-красными полосами
    const bh = s.h / s.stack;
    for (let k = 0; k < s.stack; k++) {
      const x = s.x, w = s.w, y = s.y + k * bh;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(x, y + bh); ctx.lineTo(x, y + bh * 0.8); ctx.lineTo(x + 3, y + bh * 0.62); ctx.lineTo(x + 4, y);
      ctx.lineTo(x + w - 4, y); ctx.lineTo(x + w - 3, y + bh * 0.62); ctx.lineTo(x + w, y + bh * 0.8); ctx.lineTo(x + w, y + bh); ctx.closePath();
      ctx.fillStyle = '#efefe9'; ctx.fill(); ctx.clip();
      ctx.fillStyle = '#d7322b'; ctx.beginPath();
      for (let sx = x - bh + ((k + Math.floor(s.v * 3)) % 2) * 8; sx < x + w; sx += 16) { ctx.moveTo(sx, y + bh); ctx.lineTo(sx + 8, y + bh); ctx.lineTo(sx + 8 + bh, y); ctx.lineTo(sx + bh, y); }
      ctx.fill();
      ctx.fillStyle = 'rgba(40,30,30,.18)'; ctx.fillRect(x, y + bh * 0.62, w, bh * 0.38); // нижний скос в тени
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x, y, w, 2);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x, y + bh * 0.62, w, 1);
      ctx.restore();
      ctx.fillStyle = '#34363a'; ctx.fillRect(x + w * 0.3, y + bh - 3, w * 0.4, 3); // паз для захвата
      ctx.fillStyle = '#ffd23a'; ctx.fillRect(x + w / 2 - 3, y + 5, 6, 3); // световозвращатель
      if (api.hash(Math.floor(s.x) + k * 17) > 0.5) { ctx.fillStyle = '#9a9a92'; ctx.beginPath(); ctx.moveTo(x + w - 4, y); ctx.lineTo(x + w - 11, y); ctx.lineTo(x + w - 5, y + 5); ctx.fill(); } // скол
    }
    drawSplats(s.x, s.x + s.w, s.y, ctx);
  }

  function drawDecor(d, ctx, api) {
    const x = d.x, y = d.y;
    if (d.kind === 'cone') { // конус со световозвращающими полосами
      ctx.fillStyle = '#ff5a14'; ctx.beginPath(); ctx.moveTo(x - 7, y - 2); ctx.lineTo(x - 2, y - 24); ctx.lineTo(x + 2, y - 24); ctx.lineTo(x + 7, y - 2); ctx.fill();
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(x - 4.5, y - 17, 9, 3); ctx.fillRect(x - 6, y - 10, 12, 3);
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(x - 10, y - 3, 20, 3);
    } else if (d.kind === 'worksign') { // знак «Дорожные работы» и табличка расстояния
      ctx.fillStyle = '#9aa0a6'; ctx.fillRect(x - 1.5, y - 40, 3, 40);
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 13, y - 34, 26, 11); ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(x - 13, y - 34, 26, 11);
      api.text('500 м', x, y - 25.5, 8, '#111');
      ctx.fillStyle = '#d32f2f'; ctx.beginPath(); ctx.moveTo(x, y - 68); ctx.lineTo(x + 18, y - 37); ctx.lineTo(x - 18, y - 37); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x, y - 61); ctx.lineTo(x + 12.5, y - 40); ctx.lineTo(x - 12.5, y - 40); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x - 3, y - 51, 1.8, 0, 7); ctx.fill(); // человечек с лопатой
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.6; ctx.beginPath();
      ctx.moveTo(x - 3, y - 49); ctx.lineTo(x - 1, y - 45); ctx.lineTo(x - 4, y - 41); ctx.moveTo(x - 1, y - 45); ctx.lineTo(x + 1, y - 41);
      ctx.moveTo(x - 2, y - 47); ctx.lineTo(x + 4, y - 44); ctx.moveTo(x - 6, y - 50); ctx.lineTo(x + 5, y - 42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 3, y - 40); ctx.lineTo(x + 7, y - 44); ctx.lineTo(x + 10, y - 40); ctx.fill();
    } else if (d.kind === 'barrel') { // сигнальная бочка с мигающим фонарём
      ctx.fillStyle = '#ff6a00'; ctx.fillRect(x - 9, y - 24, 18, 23);
      ctx.beginPath(); ctx.ellipse(x, y - 24, 9, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#f7f7f2'; ctx.fillRect(x - 9, y - 19, 18, 4); ctx.fillRect(x - 9, y - 10, 18, 4);
      ctx.fillStyle = '#222'; ctx.fillRect(x - 11, y - 2, 22, 2);
      const on = Math.sin(api.now * 5 + d.v * 7) > 0.2;
      ctx.fillStyle = '#5a5f66'; ctx.fillRect(x - 1, y - 30, 2, 4);
      ctx.fillStyle = on ? '#ffc400' : '#8a6d1c'; ctx.beginPath(); ctx.arc(x, y - 32, 3.5, 0, 7); ctx.fill();
      if (on) { ctx.fillStyle = 'rgba(255,196,0,.28)'; ctx.beginPath(); ctx.arc(x, y - 32, 8, 0, 7); ctx.fill(); }
    } else if (d.kind === 'post') { // сигнальный столбик
      ctx.fillStyle = '#f4f4f0'; ctx.fillRect(x - 2.5, y - 30, 5, 30);
      ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.moveTo(x - 2.5, y - 22); ctx.lineTo(x + 2.5, y - 26); ctx.lineTo(x + 2.5, y - 20); ctx.lineTo(x - 2.5, y - 16); ctx.fill();
      ctx.fillStyle = '#ff3d00'; ctx.fillRect(x - 1.5, y - 28, 3, 2);
    } else if (d.kind === 'kmpost') { // километровый столбик
      ctx.fillStyle = '#e9e9e4'; ctx.fillRect(x - 1.5, y - 30, 3, 30); ctx.fillStyle = '#222'; ctx.fillRect(x - 1.5, y - 10, 3, 5);
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 11, y - 46, 22, 17); ctx.strokeStyle = '#222'; ctx.lineWidth = 1.2; ctx.strokeRect(x - 11, y - 46, 22, 17);
      api.text(String(118 + Math.floor(d.x / 900)), x, y - 34, 9, '#111'); // номер растёт вдоль трассы
    }
  }

  function drawFinish(fx, gy, ctx, api) { // новый указатель «Трасса открыта», красная лента и воздушные шары
    const now = api.now, x = fx + 122;
    ctx.fillStyle = '#9aa3ab'; ctx.fillRect(x + 20, gy - 104, 5, 104); ctx.fillRect(x + 145, gy - 104, 5, 104);
    ctx.fillStyle = '#fff'; ctx.fillRect(x, gy - 164, 170, 64);
    ctx.fillStyle = '#1b7f3b'; ctx.fillRect(x + 3, gy - 161, 164, 58);
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 69, gy - 157, 32, 15); ctx.fillStyle = '#1f62b5'; ctx.fillRect(x + 71, gy - 155, 28, 11);
    api.text('Р-6', x + 85, gy - 146, 9, '#fff');
    api.text('ТРАССА ОТКРЫТА', x + 85, gy - 124, 14, '#fff');
    api.text('счастливого пути!', x + 85, gy - 109, 10, '#d9f2e0');
    const l = fx + 118, r = fx + 390, ly = gy - 34; // стойки с лентой
    for (const px of [l, r]) { ctx.fillStyle = '#d4d8dc'; ctx.fillRect(px - 2, ly - 6, 4, 40); ctx.fillStyle = '#e0b43a'; ctx.beginPath(); ctx.arc(px, ly - 7, 3.5, 0, 7); ctx.fill(); }
    const mx = (l + r) / 2, sag = 9 + Math.sin(now * 2) * 2;
    ctx.strokeStyle = '#e53935'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(l, ly); ctx.quadraticCurveTo(mx, ly + sag * 2, r, ly); ctx.stroke();
    const by = ly + sag; // бант посередине
    ctx.fillStyle = '#e53935';
    ctx.beginPath(); ctx.ellipse(mx - 8, by - 3, 8, 5, -0.4, 0, 7); ctx.ellipse(mx + 8, by - 3, 8, 5, 0.4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(mx - 2, by); ctx.lineTo(mx - 9, by + 16); ctx.lineTo(mx - 4, by + 14); ctx.lineTo(mx + 1, by); ctx.moveTo(mx + 2, by); ctx.lineTo(mx + 9, by + 16); ctx.lineTo(mx + 4, by + 14); ctx.lineTo(mx - 1, by); ctx.fill();
    ctx.fillStyle = '#b71c1c'; ctx.beginPath(); ctx.arc(mx, by - 2, 3.5, 0, 7); ctx.fill();
    for (const [px, side] of [[l, -1], [r, 1]]) { // шары
      for (let k = 0; k < 5; k++) {
        const bx = px + side * (k - 2) * 7 + Math.sin(now * 1.4 + k * 1.7 + side) * 3, byy = ly - 44 - (k % 3) * 11 - (k === 2 ? 8 : 0);
        ctx.strokeStyle = 'rgba(60,60,60,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, ly - 8); ctx.lineTo(bx, byy + 9); ctx.stroke();
        ctx.fillStyle = BALLOONS[(k + (side > 0 ? 2 : 0)) % 5]; ctx.beginPath(); ctx.ellipse(bx, byy, 6, 8, 0, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(bx - 2, byy - 3, 1.5, 2.5, 0, 0, 7); ctx.fill();
      }
    }
  }

  // ---------- враги ----------
  function drum(ctx, x, y, r, a) { // стальной валец катка: вращающиеся спицы боковины
    ctx.fillStyle = '#2b2f34'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#737c85'; ctx.beginPath(); ctx.arc(x, y, r - 3, 0, 7); ctx.fill();
    ctx.strokeStyle = '#454c53'; ctx.lineWidth = 2.5; ctx.beginPath();
    for (let k = 0; k < 4; k++) { const b = a + k * Math.PI / 2; ctx.moveTo(x + Math.cos(b) * 3, y + Math.sin(b) * 3); ctx.lineTo(x + Math.cos(b) * (r - 4), y + Math.sin(b) * (r - 4)); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r - 1.5, -2.6, -1.4); ctx.stroke();
    ctx.fillStyle = '#f2b705'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill();
  }

  const drawClump = (p, ctx) => { // ком горячего асфальта: дымный след, жар, трещины
    ctx.save(); ctx.rotate(-p.rot); // след — в мировой ориентации
    const sp = Math.hypot(p.vx, p.vy) || 1, ux = -p.vx / sp, uy = -p.vy / sp;
    for (let k = 1; k <= 3; k++) { ctx.globalAlpha = 0.5 - k * 0.12; ctx.fillStyle = '#9a9a9a'; ctx.beginPath(); ctx.arc(ux * k * 8, uy * k * 8 - k * 2, 3 + k * 1.6, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#ff8a2a'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.restore();
    ctx.fillStyle = '#1c1a18'; ctx.beginPath(); ctx.moveTo(-7, -2); ctx.lineTo(-3, -6); ctx.lineTo(4, -5); ctx.lineTo(7, 0); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-4, -2); ctx.lineTo(0, 0); ctx.lineTo(3, -3); ctx.moveTo(0, 0); ctx.lineTo(1, 3); ctx.stroke();
    ctx.fillStyle = '#77716a'; ctx.fillRect(-5, 1, 2, 2); ctx.fillRect(3, 1, 2, 2);
  };

  function landClump(p, api) { // шлепок об асфальт: брызги и остывающая клякса
    const cx = p.x + p.w / 2, gy = api.groundAt(cx);
    api.burst(cx, p.y + p.h / 2, '#2a2522', 7, 120);
    api.burst(cx, p.y + p.h / 2, '#ff8a2a', 3, 90);
    if (gy === null) return;
    if (st.splats.length >= MAX_SPLATS) st.splats.shift();
    st.splats.push({ x: cx, y: gy, t: 0 });
  }

  function throwClump(e, api) { // бросок по дуге в героя; вершина дуги не заходит под полосу HUD
    const P = api.player, g = 900, sx = e.x + e.w / 2 + e.dir * 12, sy = e.y + 2;
    const tx = P.x + P.w / 2, D = P.y + 22 - sy;
    let A = api.clamp(50 + Math.abs(tx - sx) * 0.22, 40, 150);
    A = Math.max(6, Math.min(Math.max(A, -D + 24), sy - 44));
    const vy = -Math.sqrt(2 * g * A), disc = vy * vy + 2 * g * D;
    const t = disc > 0 ? (-vy + Math.sqrt(disc)) / g : -2 * vy / g;
    api.shoot({ x: sx, y: sy, w: 12, h: 10, vx: api.clamp((tx - sx) / Math.max(0.35, t), -360, 360), vy, gravity: g, spin: 7,
      color: '#2a2522', draw: drawClump, source: e, onLand: landClump, pts: 20 });
  }

  const enemies = {
    roller: { // каток: тяжёлый вальцовый каток — медленно, но неотвратимо катит на героя
      w: 68, h: 52, hp: 4, pts: 400, heavy: true, hitColor: '#ffd76a', deathColor: '#f2b705',
      init(e) { e.dist = 0; e.chase = 0; },
      update(e, dt, api) {
        const near = api.near(e, 260, 120);
        if (near) e.dir = Math.sign(api.dx(e)) || e.dir;
        const x0 = e.x;
        api.patrol(e, near ? 60 : 26, dt);
        e.dist += (e.x - x0) * e.dir;
        e.chase += ((near ? 1 : 0) - e.chase) * Math.min(1, dt * 4);
      },
      draw(e, ctx) {
        const jit = e.chase > 0.5 ? Math.sin(e.t * 70) * 0.6 : 0; // дрожь вибровальцов
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 36, 3, 0, 0, 7); ctx.fill();
        ctx.save(); ctx.translate(0, jit);
        const rate = e.chase > 0.5 ? 1.7 : 0.8; // выхлоп: чаще и гуще, когда каток в погоне
        for (let k = 0; k < 3; k++) {
          const ph = (e.t * rate + k / 3) % 1;
          ctx.fillStyle = e.chase > 0.5 ? '#8f9296' : '#eceff1'; ctx.globalAlpha = 0.75 * (1 - ph);
          ctx.beginPath(); ctx.arc(-4 - ph * 12, -50 - ph * 20, 2.5 + ph * 6, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
        drum(ctx, -20, -14, 14, e.dist / 14);
        ctx.fillStyle = '#f2b705'; // корпус с двигателем над задним вальцом
        ctx.beginPath(); ctx.moveTo(-34, -19); ctx.lineTo(-34, -31); ctx.quadraticCurveTo(-34, -37, -28, -37); ctx.lineTo(3, -37); ctx.lineTo(7, -31); ctx.lineTo(7, -19); ctx.fill();
        ctx.fillStyle = '#c99400'; ctx.fillRect(-34, -21, 41, 3);
        ctx.fillStyle = '#2b2b2b'; for (let k = 0; k < 4; k++) ctx.fillRect(-30 + k * 5, -33, 3, 7); // решётка радиатора
        ctx.fillStyle = '#1d1d1d'; ctx.beginPath(); // чёрно-жёлтые полосы на боку
        for (let k = 0; k < 4; k++) { ctx.moveTo(-10 + k * 4, -21); ctx.lineTo(-8 + k * 4, -21); ctx.lineTo(-5 + k * 4, -29); ctx.lineTo(-7 + k * 4, -29); }
        ctx.fill();
        ctx.fillStyle = '#333'; ctx.fillRect(-5, -47, 3, 10); ctx.fillRect(-6, -48, 5, 2); // выхлопная труба
        drum(ctx, 16, -18, 18, e.dist / 18);
        ctx.strokeStyle = '#f2b705'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(16, -18, 21, -Math.PI * 0.98, -Math.PI * 0.06); ctx.stroke(); // передняя рама-скребок
        ctx.strokeStyle = '#c99400'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(16, -18, 18.5, -Math.PI * 0.95, -Math.PI * 0.1); ctx.stroke();
        ctx.strokeStyle = '#f2b705'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(4, -28); ctx.lineTo(16, -18); ctx.stroke(); // кронштейн вальца
        ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(16, -18, 3, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff3a0'; ctx.beginPath(); ctx.moveTo(30, -37); ctx.lineTo(37, -33); ctx.lineTo(30, -31); ctx.fill(); // фара — «злой глаз»
        ctx.fillStyle = '#b3261e'; ctx.beginPath(); ctx.moveTo(27, -41); ctx.lineTo(37, -37); ctx.lineTo(36, -35); ctx.lineTo(27, -39); ctx.fill();
        ctx.fillStyle = '#3a3a3a'; ctx.fillRect(-29, -44, 4, 7); // сиденье
        ctx.fillStyle = '#e0a07a'; ctx.beginPath(); ctx.arc(-20, -42, 4.5, 0, 7); ctx.fill(); // катковщик в тёмных очках
        ctx.fillStyle = '#ff8f00'; ctx.beginPath(); ctx.arc(-20, -44, 5, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#111'; ctx.fillRect(-19, -44, 6, 2);
        ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-14, -37); ctx.lineTo(-10, -42); ctx.stroke(); // руль
        ctx.fillStyle = '#222'; ctx.fillRect(-32, -51, 2.5, 14); ctx.fillRect(-10, -51, 2.5, 14); // каркас кабины
        ctx.fillStyle = '#f7f7f7'; ctx.fillRect(-36, -54, 31, 4); ctx.fillStyle = '#b9bec3'; ctx.fillRect(-36, -50.5, 31, 1);
        const flash = e.chase > 0.5 && Math.sin(e.t * 14) > 0; // маячок: мигает, когда каток погнался
        ctx.fillStyle = flash ? '#ffea00' : '#e07b00'; ctx.fillRect(-23, -58, 6, 4);
        if (flash) { ctx.fillStyle = 'rgba(255,200,0,.35)'; ctx.beginPath(); ctx.arc(-20, -57, 8, 0, 7); ctx.fill(); }
        ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1.5; ctx.beginPath(); // вмятины от ударов рейкой
        for (let i = 0; i < e.maxHp - e.hp; i++) { ctx.moveTo(-31 + i * 7, -36); ctx.lineTo(-28 + i * 7, -30); ctx.lineTo(-30 + i * 7, -25); }
        ctx.stroke();
        ctx.restore();
      },
    },
    bitumen: { // лужа горячего битума: неуязвима, обжигает — только перепрыгнуть
      w: 52, h: 10, hp: 1, pts: 0, invulnerable: true, stompable: false, knockback: false, flip: false,
      draw(e, ctx) {
        const pulse = 0.5 + Math.sin(e.t * 4) * 0.5;
        ctx.globalAlpha = 0.35 + pulse * 0.25; ctx.fillStyle = '#ff5a14'; // раскалённый ореол вокруг лужи
        ctx.beginPath(); ctx.ellipse(0, -1.5, 33, 7, 0, 0, 7); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = '#0f0d0c'; // сама лужа — вязкая, чуть выпуклая
        ctx.beginPath(); ctx.moveTo(-28, 0); ctx.quadraticCurveTo(-26, -9, 0, -9.5); ctx.quadraticCurveTo(26, -9, 28, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ff7a1a'; ctx.fillRect(-28, -1.5, 56, 1.5); // раскалённая кромка
        ctx.fillStyle = '#ffb347'; ctx.fillRect(-20 + pulse * 6, -1.5, 8, 1.5); ctx.fillRect(9 - pulse * 5, -1.5, 6, 1.5);
        ctx.fillStyle = 'rgba(200,225,255,.5)'; ctx.fillRect(-14, -8, 11, 1.2); ctx.fillRect(5, -7.5, 5, 1); // глянцевый блик
        ctx.fillStyle = '#ff8a2a'; // отсветы жара на поверхности
        for (let k = 0; k < 3; k++) if (Math.sin(e.t * 7 + k * 2.1) > 0.2) ctx.fillRect(-18 + k * 14, -5 + (k % 2), 4, 1);
        for (let k = 0; k < 5; k++) { // пузыри вздуваются и лопаются, разбрызгивая капли
          const per = 0.8 + k * 0.27, ph = ((e.t + k * 0.41) / per) % 1, bx = -19 + k * 9.5 + Math.sin(k * 5.3) * 2;
          if (ph < 0.78) {
            const r = 1.2 + ph * 3.8;
            ctx.fillStyle = '#2d2825'; ctx.beginPath(); ctx.arc(bx, -8.5, r, Math.PI, 0); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(bx - r * 0.5, -8.5 - r * 0.75, 1.2, 1.2);
          } else {
            const q = (ph - 0.78) / 0.22;
            ctx.fillStyle = '#1a1716'; ctx.fillRect(bx - 1 - q * 5, -10 - q * 9 + q * q * 6, 2, 2); ctx.fillRect(bx + q * 5, -11 - q * 10 + q * q * 7, 2, 2);
            ctx.fillStyle = '#ff9a3c'; ctx.fillRect(bx - 1, -9.5, 2, 1);
          }
        }
        ctx.lineCap = 'round'; // струйки пара поднимаются вверх; серая подложка — чтобы пар читался и на светлой траве
        for (let k = 0; k < 3; k++) {
          const ph = (e.t * 0.7 + k / 3) % 1, bx = -13 + k * 13, y0 = -8 - ph * 36, s = ph * 7 + k;
          ctx.globalAlpha = 0.7 * Math.sin(ph * Math.PI);
          ctx.beginPath(); ctx.moveTo(bx + Math.sin(s) * 3, y0 + 8); ctx.quadraticCurveTo(bx + Math.sin(s + 1.5) * 6, y0 + 2, bx + Math.sin(s + 3) * 3, y0 - 5);
          ctx.strokeStyle = 'rgba(70,70,74,.45)'; ctx.lineWidth = 5; ctx.stroke();
          ctx.strokeStyle = '#f7f7f7'; ctx.lineWidth = 3; ctx.stroke();
        }
        ctx.globalAlpha = 1;
      },
    },
    paver: { // дорожник с лопатой: стоит на месте и швыряет по дуге комья горячего асфальта
      w: 22, h: 46, hp: 2, pts: 200, hitColor: '#ffd76a', deathColor: '#cddc39',
      init(e) { e.windT = 0; e.throwT = 0; },
      update(e, dt, api) {
        const dx = api.dx(e), inRange = Math.abs(dx) < 420 && Math.abs(api.player.y - e.y) < 240;
        if (inRange && !(e.throwT > 0)) e.dir = Math.sign(dx) || e.dir;
        e.throwT = Math.max(0, e.throwT - dt);
        if (e.windT > 0) { // замах 0,8 с: зачерпнул, лопата за спиной, ком раскалился — затем бросок
          e.windT -= dt;
          if (e.windT <= 0) { e.windT = 0; throwClump(e, api); e.throwT = 0.3; e.cd = 1.4; }
        } else {
          e.cd -= dt;
          const seen = e.x + e.w > api.camX + 8 && e.x < api.camX + api.W - 8; // замах начинается только в кадре — его видно
          if (e.cd <= 0 && inRange && seen) e.windT = 0.8;
        }
      },
      draw(e, ctx) {
        let ang = 1.05 + Math.sin(e.t * 2) * 0.05, load = false, glow = 0, lean = 0;
        if (e.windT > 0) {
          const w = 1 - e.windT / 0.8;
          if (w < 0.3) { ang = 1.05 + (w / 0.3) * 0.35; load = w > 0.18; }
          else { const k = (w - 0.3) / 0.7; ang = 1.4 - 3.9 * (1 - (1 - k) * (1 - k)); load = true; glow = k; lean = -0.12 * k; }
        } else if (e.throwT > 0) { const k = 1 - e.throwT / 0.3; ang = -2.5 + 2.1 * k; lean = 0.1 * (1 - k); }
        ctx.rotate(lean);
        const bob = e.windT > 0 ? 0 : Math.sin(e.t * 3) * 0.6;
        ctx.fillStyle = '#1d1d1d'; ctx.fillRect(-8, -4, 8, 4); ctx.fillRect(1, -4, 9, 4); // сапоги
        ctx.fillStyle = '#3f4c5a'; ctx.fillRect(-6, -19, 5, 15); ctx.fillRect(1, -19, 5, 15); // комбинезон
        ctx.translate(0, bob);
        ctx.fillRect(-7, -35, 14, 17);
        ctx.fillStyle = '#cddc39'; ctx.fillRect(-7, -34, 14, 12); // салатовый жилет
        ctx.fillStyle = '#eceff1'; ctx.fillRect(-7, -28, 14, 2); ctx.fillRect(-4, -34, 2, 6);
        ctx.fillStyle = '#d9956a'; ctx.beginPath(); ctx.arc(1, -41, 5.5, 0, 7); ctx.fill(); // загорелое лицо
        ctx.fillStyle = '#c2574a'; ctx.fillRect(4, -40, 2, 2);
        ctx.fillStyle = '#5d4030'; ctx.fillRect(2, -38.5, 6, 2); // усы
        ctx.fillStyle = '#222'; ctx.fillRect(3.5, -43, 2, 2);
        ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(2, -45.5); ctx.lineTo(7, -44); ctx.stroke(); // сердитая бровь
        ctx.fillStyle = '#ff8f00'; ctx.beginPath(); ctx.arc(1, -44, 6.5, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -45, 15, 2); // оранжевая каска
        ctx.save(); ctx.translate(2, -27); ctx.rotate(ang); // лопата
        ctx.fillStyle = '#8a6440'; ctx.fillRect(-8, -1.5, 30, 3);
        ctx.fillStyle = '#8b949c'; ctx.beginPath(); ctx.moveTo(21, -4); ctx.lineTo(30, -5); ctx.lineTo(32, 0); ctx.lineTo(30, 5); ctx.lineTo(21, 4); ctx.fill();
        if (load) {
          const pulse = 0.5 + Math.sin(e.t * 18) * 0.5;
          ctx.fillStyle = `rgba(255,${110 + Math.round(pulse * 60)},30,${(0.25 + glow * 0.35).toFixed(2)})`; ctx.beginPath(); ctx.arc(27, 0, 7 + glow * 4, 0, 7); ctx.fill();
          ctx.fillStyle = '#1c1a18'; ctx.beginPath(); ctx.ellipse(27, 0, 5, 4, 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#ff7a1a'; ctx.fillRect(25, -1, 4, 1.5);
        }
        ctx.restore();
        ctx.strokeStyle = '#3f4c5a'; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.beginPath(); // руки на черенке
        const ca = Math.cos(ang), sa = Math.sin(ang);
        ctx.moveTo(-3, -32); ctx.lineTo(2 - ca * 5, -27 - sa * 5); ctx.moveTo(4, -32); ctx.lineTo(2 + ca * 7, -27 + sa * 7); ctx.stroke();
        if (load) for (let k = 0; k < 2; k++) { // дым над раскалённым комом
          const ph = (e.t * 1.5 + k / 2) % 1, bx = 2 + ca * 27, by = -27 + sa * 27;
          ctx.fillStyle = `rgba(170,170,170,${(0.55 * (1 - ph)).toFixed(2)})`; ctx.beginPath(); ctx.arc(bx + Math.sin(ph * 6 + k) * 2, by - 6 - ph * 16, 2 + ph * 4, 0, 7); ctx.fill();
        }
      },
    },
  };

  registerTheme({
    index: 6, id: 'road',
    title: 'Дорожная стройка', subtitle: 'Новая трасса: асфальт, катки и горячий битум',
    accent: '#4fc3f7', dust: '#a9a49b',
    gen: { hazardChance: 0.45, obstacleW: 40, obstacleH: 30, decorCount: [1, 2] },
    decor: ['cone', 'cone', 'worksign', 'barrel', 'post', 'post', 'kmpost'],
    enemies,
    enemyTable: [
      { type: 'paver', where: 'ground', weight: 3 },
      { type: 'roller', where: 'ground', weight: 2, from: 0.12 },
      { type: 'paver', where: 'upper', weight: 1 },
      { type: 'bitumen', where: 'hazard', weight: 1 },
    ],
    init(api) { st.splats.length = 0; st.berm = null; fixTinySteps(api); },
    update(dt) { // кляксы остывают и исчезают
      for (const sp of st.splats) sp.t += dt;
      while (st.splats.length && st.splats[0].t > SPLAT_LIFE) st.splats.shift();
    },
    drawBackground, drawGround, drawPit, drawPlatform, drawObstacle, drawDecor, drawFinish,
    drawForeground(ctx, api) { // марево: над раскалённым асфальтом дрожат струи горячего воздуха (несколько линий — дёшево)
      const { camX, W, now } = api, x0 = camX - 10, x1 = camX + W + 10;
      ctx.fillStyle = '#fffbe8';
      for (let k = 0; k < 3; k++) { // три полосы на разной высоте: поднимаются и тают; каждая — один путь из коротких отрезков
        const ph = (now * 0.4 + k / 3) % 1;
        ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.32; ctx.beginPath();
        for (const s of api.solids) {
          if (s.kind !== 'ground' || s.x > x1 || s.x + s.w < x0) continue;
          const b = Math.min(s.x + s.w, x1), y0 = s.y - 4 - ph * 36;
          for (let x = Math.max(s.x, x0); x < b; x += 12) ctx.rect(x, y0 + Math.sin(x * 0.06 + now * 5 + k * 2) * 1.8, Math.min(12, b - x), 1.2);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  });
})();
