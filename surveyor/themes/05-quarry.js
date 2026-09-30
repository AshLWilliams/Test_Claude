'use strict';
// Участок 5 — карьер открытой добычи. Яркий пыльный день: террасы уступов уходят вдаль, по бермам ползут БелАЗы,
// работают экскаваторы и буровые станки, вдали гремят взрывы. С борта иногда срываются камни — тень предупреждает.
// Контракт темы: см. THEMES.md, образец — 01-city.js.
(() => {
  // ---------- общее ----------
  const TAU = Math.PI * 2;
  const WARN = 0.9;  // сколько секунд видна тень, прежде чем камень сорвётся с борта (и ещё ~0,6 с он падает)
  const BELT = 26;   // скорость ленты конвейера: стоящего на ней героя везёт вперёд
  const st = { pebT: 6, warns: [], flashes: [], sky: null }; // камнепад, вспышки взрывов, градиент неба (создаётся один раз)

  const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
  function path(ctx, pts, sx = 1, sy = 1, dx = 0, dy = 0) { // замкнутый контур из плоского массива [x0,y0,x1,y1…]
    ctx.beginPath(); ctx.moveTo(dx + pts[0] * sx, dy + pts[1] * sy);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(dx + pts[i] * sx, dy + pts[i + 1] * sy);
    ctx.closePath();
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
  }

  // контур валуна: неровный десятиугольник радиусом ~15
  const ROCK = [];
  [1.2, -1, 0.8, -0.2, -1.4, 1, 0.4, -1.1, 1.3, -0.6].forEach((d, i) => { const a = i / 10 * TAU; ROCK.push(Math.cos(a) * (15 + d), Math.sin(a) * (15 + d)); });
  const CHUNK = [-7, -1, -4, -6, 3, -6, 7, -2, 5, 5, -3, 6]; // глыба-снаряд

  function drawChunk(p, ctx) { // камень из кузова или с борта: цвет p.color, светлая грань сверху
    ctx.fillStyle = p.color; path(ctx, CHUNK); ctx.fill();
    ctx.strokeStyle = 'rgba(40,24,12,.8)'; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.fillStyle = 'rgba(255,240,215,.5)'; path(ctx, [-6, -1, -3.5, -5, 2.5, -5, 0, -1.5]); ctx.fill();
  }
  function drawStick(ctx, lit, now) { // связка динамита: три красные шашки, изолента и фитиль
    ctx.fillStyle = '#d32f2f'; ctx.fillRect(-5, -6, 10, 13);
    ctx.fillStyle = '#9a1c1c'; ctx.fillRect(-1.8, -6, 1, 13); ctx.fillRect(1.6, -6, 1, 13);
    ctx.fillStyle = '#26221f'; ctx.fillRect(-5.5, -1, 11, 2.5);
    ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -6); ctx.quadraticCurveTo(3, -9, 1, -11); ctx.stroke();
    if (lit) { ctx.fillStyle = Math.floor(now * 20) % 2 ? '#fff6a0' : '#ff9f1a'; circle(ctx, 1, -11.5, 2.2); }
  }
  function boom(x, y, api) { // взрыв шашки: вспышка, огонь, камешки, тряска
    api.burst(x, y, '#ffb13b', 16, 230, 500); api.burst(x, y, '#fff1b8', 6, 120, 200); api.burst(x, y, '#7a5a40', 8, 170, 900);
    api.shake(4);
    if (st.flashes.length < 8) st.flashes.push({ x, y, t: 0.35 });
  }
  const dynLand = (p, api) => boom(p.x + p.w / 2, p.y + p.h, api);
  function dynHit(p, dt, api) { // попадание в героя: движок снимает шашку без onLand — взрыв показываем сами (урон наносит движок)
    if (p.reflected || p.boomed) return;
    if (api.overlap(api.player, p)) { p.boomed = true; boom(p.x + p.w / 2, p.y + p.h / 2, api); return; }
    const cx = p.x + p.w / 2, b = p.y + p.h;
    for (const q of api.platforms) if (cx >= q.x && cx <= q.x + q.w && b >= q.y && b - p.vy * dt - 1 <= q.y) { p.dead = true; dynLand(p, api); return; } // упала на ленту или мостки
  }
  function rockLand(p, api) { // глыба раскололась о землю
    api.burst(p.x + p.w / 2, p.y + p.h, p.color, 8, 150, 700); api.burst(p.x + p.w / 2, p.y + p.h, '#e6cfa6', 5, 80, 200);
  }
  function wallRockLand(p, api) { rockLand(p, api); api.shake(1.5); }
  function wallRockFall(p, dt, api) { if (p.y + p.h >= p.gy) { p.dead = true; wallRockLand(p, api); } } // долетел до своей опоры (в т.ч. платформы)

  // ---------- фон: небо в дымке и три борта карьера ----------
  // Уступы борта — параллельные ступени: светлая берма, под ней откос с бороздами и тенью у подошвы, по диагонали —
  // съезды для самосвалов. Каждая полоса заливается только между своей бермой и следующей (без лишней перерисовки).
  const FAR = { y: [100, 118, 136, 154, 172], face: ['#e3d1b6', '#dcc5a6', '#d5ba98', '#cfaf8b', '#c9a680'], top: '#f4ead8', shade: 'rgba(150,112,80,.3)', groove: 'rgba(150,112,80,.28)', tw: 2.5, gs: 13, bottom: 204 };
  const MID = { y: [158, 184, 210], face: ['#dca06a', '#cd8d57', '#bf7f4b'], top: '#f3cf9f', shade: 'rgba(110,52,22,.3)', groove: 'rgba(110,52,22,.24)', tw: 3.5, gs: 11, bottom: 238 };
  const NEAR_BANDS = [[20, 6, '#a65f35'], [34, 2.5, '#c88650'], [52, 9, '#9b5630'], [74, 4, '#bd7a47']]; // пласты ближнего борта
  const pFar = u => Math.sin(u * 0.0052) * 6 + Math.sin(u * 0.017 + 1) * 2;
  const pMid = u => Math.sin(u * 0.0024) * 12 + Math.sin(u * 0.0083 + 1) * 5 + Math.sin(u * 0.031) * 1.2;
  const pNear = u => 222 + Math.sin(u * 0.0042) * 6 + Math.sin(u * 0.017 + 2) * 2.5;
  const frac = v => v - Math.floor(v);
  function surfaceAt(api, x, y) { // верх ближайшей опоры не выше y в точке x: земля, препятствие или платформа (null — провал)
    let top = api.groundAt(x); for (const p of api.platforms) if (x >= p.x && x <= p.x + p.w && p.y >= y && (top === null || p.y < top)) top = p.y; return top;
  }
  const prof = new Float32Array(96); // профиль бровки видимой части слоя: считается один раз на слой за кадр
  let pu0 = 0, pn = 0;
  function profile(f, off, W, step) {
    pu0 = Math.floor(off / step) * step - step; pn = Math.min(96, Math.ceil(W / step) + 4);
    for (let j = 0; j < pn; j++) prof[j] = f(pu0 + j * step);
  }
  function polyline(ctx, off, step, dy) { for (let j = 0; j < pn; j++) ctx.lineTo(pu0 + j * step - off, prof[j] + dy); }

  function terraces(ctx, L, f, off, W, step, api) { // уступы одного борта
    profile(f, off, W, step);
    const n = L.y.length;
    for (let k = 0; k < n; k++) { // откосы: от бермы до следующей бермы
      ctx.fillStyle = L.face[k]; ctx.beginPath(); polyline(ctx, off, step, L.y[k]);
      if (k === n - 1) { ctx.lineTo(W + step, L.bottom); ctx.lineTo(-step, L.bottom); }
      else for (let j = pn - 1; j >= 0; j--) ctx.lineTo(pu0 + j * step - off, prof[j] + L.y[k + 1] + 0.5);
      ctx.fill();
    }
    ctx.strokeStyle = L.shade; ctx.lineWidth = 3; ctx.beginPath(); // тень у подошвы откосов
    for (let k = 1; k < n; k++) { ctx.moveTo(pu0 - off, prof[0] + L.y[k] - 2); polyline(ctx, off, step, L.y[k] - 2); }
    ctx.stroke();
    ctx.strokeStyle = L.top; ctx.lineWidth = L.tw; ctx.beginPath(); // бермы
    for (let k = 0; k < n; k++) { ctx.moveTo(pu0 - off, prof[0] + L.y[k] + L.tw / 2); polyline(ctx, off, step, L.y[k] + L.tw / 2); }
    ctx.stroke();
    const gs = L.gs, bh = L.y[1] - L.y[0]; // борозды на откосах (узкие прямоугольники дешевле штрихов)
    ctx.fillStyle = L.groove;
    for (let u = Math.floor(off / gs) * gs; u < off + W; u += gs) {
      const p = f(u);
      for (let k = 0; k < n; k++) {
        const h = api.hash(Math.floor(u) * 3 + k); if (h < 0.45) continue;
        ctx.fillRect(u - off, L.y[k] + p + L.tw + 1, 1.3, 3 + h * (bh - 9));
      }
    }
  }
  function ramps(ctx, L, f, off, W, S, len, api) { // диагональные съезды между бермами
    for (let i = Math.floor(off / S) - 1; i < (off + W) / S + 1; i++) {
      const h = api.hash(i * 23 + L.y[0]); if (h < 0.35) continue;
      const k = Math.floor(h * 10) % (L.y.length - 1), u = i * S + h * S * 0.5, x = u - off;
      const ya = L.y[k] + f(u) + 1, yb = L.y[k + 1] + f(u + len) + 1;
      ctx.strokeStyle = L.shade; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, ya + 3); ctx.lineTo(x + len, yb + 3); ctx.stroke();
      ctx.strokeStyle = L.top; ctx.lineWidth = L.tw + 1; ctx.beginPath(); ctx.moveTo(x - 4, ya); ctx.lineTo(x + len, yb); ctx.stroke();
    }
  }
  function trucks(ctx, L, f, off, W, k, v, S, s, col, dark, api) { // самосвалы ползут по берме k
    const sh = api.now * v;
    for (let i = Math.floor((off - sh) / S) - 1; i < (off + W - sh) / S + 1; i++) {
      if (api.hash(i * 5 + k + S) < 0.4) continue;
      const u = i * S + sh;
      truck(ctx, u - off, L.y[k] + f(u) + 1, s, Math.sign(v), col, dark);
    }
  }
  function truck(ctx, x, y, s, dir, col, dark) { // самосвал вдали: s — масштаб, dir — куда едет
    ctx.save(); ctx.translate(x, y); ctx.scale(s * dir, s);
    ctx.fillStyle = 'rgba(244,230,204,.6)'; circle(ctx, -22, -7, 7); circle(ctx, -31, -10, 5); // пыль из-под колёс
    ctx.fillStyle = dark; circle(ctx, -9, -4, 4); circle(ctx, 9, -4, 4); ctx.fillRect(-15, -9, 30, 3);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-15, -9); ctx.lineTo(-17, -19); ctx.lineTo(7, -20); ctx.lineTo(4, -9); ctx.fill();
    ctx.fillRect(7, -16, 8, 8);
    ctx.restore();
  }
  function excavator(ctx, x, y, t) { // карьерная мехлопата: гусеницы, кузов с противовесом, стрела, рукоять с ковшом
    const a = 0.5 + Math.sin(t * 0.7) * 0.45, hx = x + 14, hy = y - 30, bx = hx + Math.cos(a) * 26, by = hy + Math.sin(a) * 26;
    ctx.fillStyle = '#5e5047'; rrect(ctx, x - 20, y - 7, 40, 7, 3.5);
    ctx.fillStyle = '#3f352f'; for (let i = -16; i < 18; i += 6) ctx.fillRect(x + i, y - 5, 2, 3);
    ctx.fillStyle = '#d6a73f'; ctx.fillRect(x - 18, y - 24, 30, 16);
    ctx.fillStyle = '#b8862a'; ctx.fillRect(x - 23, y - 21, 6, 11);
    ctx.fillStyle = '#5e5047'; ctx.fillRect(x - 19, y - 26, 32, 2.5); ctx.fillRect(x - 18, y - 11, 30, 2);
    ctx.fillStyle = '#bfe0ee'; ctx.fillRect(x + 4, y - 21, 6, 5);
    ctx.strokeStyle = '#d6a73f'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(x + 8, y - 20); ctx.lineTo(x + 40, y - 56); ctx.stroke();
    ctx.strokeStyle = '#5e5047'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 8, y - 26); ctx.lineTo(x, y - 42); ctx.lineTo(x + 40, y - 56);
    ctx.moveTo(x + 40, y - 56); ctx.lineTo(bx + 3, by - 4); ctx.stroke();
    ctx.strokeStyle = '#a07a2a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = '#5e5047'; path(ctx, [bx - 4, by - 5, bx + 6, by - 5, bx + 7, by + 5, bx - 3, by + 6]); ctx.fill();
    ctx.fillStyle = '#41362f'; circle(ctx, x + 40, y - 56, 2);
  }
  function drill(ctx, x, y, t) { // буровой станок: высокая решётчатая мачта, у скважины клубится пыль
    ctx.fillStyle = '#6f5d4f'; rrect(ctx, x - 12, y - 5, 24, 5, 2);
    ctx.fillStyle = '#b9b3a0'; ctx.fillRect(x - 11, y - 14, 16, 9); ctx.fillStyle = '#6f5d4f'; ctx.fillRect(x - 8, y - 12, 5, 4);
    ctx.strokeStyle = '#8a8478'; ctx.lineWidth = 1; ctx.strokeRect(x + 5, y - 56, 4, 50);
    ctx.beginPath(); for (let yy = y - 56; yy < y - 8; yy += 6) { ctx.moveTo(x + 5, yy); ctx.lineTo(x + 9, yy + 6); } ctx.stroke();
    ctx.fillStyle = 'rgba(245,232,208,.8)'; const k = frac(t * 0.7);
    circle(ctx, x + 12 + k * 8, y - 3 - k * 10, 3 + k * 5); circle(ctx, x + 16, y - 2, 3);
  }
  function blast(ctx, x, y, t) { // далёкий массовый взрыв: вспышка, растущее облако пыли и разлёт камней
    if (t < 0.18) { ctx.fillStyle = 'rgba(255,244,200,.9)'; circle(ctx, x, y - 4, 5 + t * 50); }
    ctx.globalAlpha = Math.max(0, 0.85 * (1 - t / 3.2));
    for (let j = 0; j < 6; j++) {
      ctx.fillStyle = j % 2 ? '#e8d2b2' : '#d3b793';
      circle(ctx, x + Math.sin(j * 2.4) * 12 * (0.5 + t * 0.6), y - 3 - j * 4 - t * (6 + j * 3), (4 + j * 1.3) * (0.5 + Math.min(t, 1.6) * 0.7));
    }
    ctx.globalAlpha = 1;
    if (t < 1.2) { ctx.fillStyle = '#8a6d52'; for (let j = 0; j < 6; j++) ctx.fillRect(x + (j - 2.5) * 14 * t, y - (60 + (j % 3) * 18) * t + 70 * t * t, 1.6, 1.6); }
  }

  function drawBackground(ctx, api) {
    const { W, camX, hash, now } = api;
    if (!st.sky) { // бледное небо; к горизонту — тёплая пыльная дымка
      st.sky = ctx.createLinearGradient(0, 24, 0, 112);
      st.sky.addColorStop(0, '#9cc3dd'); st.sky.addColorStop(0.6, '#dbe4df'); st.sky.addColorStop(1, '#f3e3c6');
    }
    ctx.fillStyle = st.sky; ctx.fillRect(0, 0, W, 114); // ниже неба всё закрывают борта карьера
    const sx = W * 0.2 - camX * 0.012; // солнце в дымке
    ctx.fillStyle = 'rgba(255,248,225,.3)'; circle(ctx, sx, 64, 42);
    ctx.fillStyle = 'rgba(255,250,232,.55)'; circle(ctx, sx, 64, 26);
    ctx.fillStyle = '#fffbea'; circle(ctx, sx, 64, 16);
    let off = camX * 0.03 + now * 4, step = 260; // перистые облака медленно плывут
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      if (hash(i + 300) < 0.4) continue;
      const x = i * step - off + hash(i + 301) * 120, y = 44 + hash(i + 302) * 28;
      ctx.beginPath(); ctx.ellipse(x, y, 46 + hash(i + 303) * 40, 3.5, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 34, y + 6, 32, 2.5, 0, 0, TAU); ctx.fill();
    }

    // дальний борт: бледные уступы в дымке, опоры ЛЭП на бровке, крошечные БелАЗы на бермах и взрывы
    off = camX * 0.06;
    terraces(ctx, FAR, pFar, off, W, 40, api);
    ramps(ctx, FAR, pFar, off, W, 260, 70, api);
    ctx.strokeStyle = 'rgba(140,128,116,.75)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = Math.floor(off / 150) - 1; i < (off + W) / 150 + 1; i++) {
      const x = i * 150 - off, y = FAR.y[0] + pFar(i * 150);
      ctx.moveTo(x - 3, y); ctx.lineTo(x, y - 15); ctx.lineTo(x + 3, y); ctx.moveTo(x - 5, y - 12); ctx.lineTo(x + 5, y - 12);
      ctx.moveTo(x + 5, y - 12); ctx.quadraticCurveTo(x + 75, y - 4, x + 145, FAR.y[0] + pFar(i * 150 + 150) - 12);
    }
    ctx.stroke();
    trucks(ctx, FAR, pFar, off, W, 1, 9, 170, 0.42, '#dbbd5e', '#8a7866', api);
    trucks(ctx, FAR, pFar, off, W, 3, -7, 210, 0.45, '#dbbd5e', '#8a7866', api);
    for (let i = Math.floor(off / 300) - 1; i < (off + W) / 300 + 1; i++) {
      const ph = frac((now + hash(i * 11 + 3) * 13) / 13) * 13, u = i * 300 + hash(i + 40) * 180;
      if (ph < 3.2) blast(ctx, u - off, FAR.y[3] + pFar(u), ph);
    }

    // средний борт: оранжевые уступы, экскаваторы, буровые станки и самосвалы крупнее
    off = camX * 0.16;
    terraces(ctx, MID, pMid, off, W, 36, api);
    ramps(ctx, MID, pMid, off, W, 520, 110, api);
    step = 250; // слой сдвигается всего на ~700 за участок — машины стоят часто: две трети — экскаваторы
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      if (hash(i * 17 + 2) < 0.22) continue;
      const u = i * step + hash(i + 9) * 110, y = MID.y[i & 1] + pMid(u) + 1;
      if (i % 3 !== 2) excavator(ctx, u - off, y, now + i * 1.7); else drill(ctx, u - off, y, now + hash(i) * 5);
    }
    trucks(ctx, MID, pMid, off, W, 1, -15, 430, 0.85, '#ecc03c', '#5a4a3e', api);
    trucks(ctx, MID, pMid, off, W, 2, 12, 380, 0.9, '#ecc03c', '#5a4a3e', api);

    // ближний борт: ржавые пласты, следы взрывных скважин, деревянные опоры ЛЭП на бровке
    off = camX * 0.36;
    profile(pNear, off, W, 30);
    ctx.fillStyle = '#b76e3d'; ctx.beginPath(); polyline(ctx, off, 30, 0); ctx.lineTo(W + 30, 362); ctx.lineTo(-30, 362); ctx.fill(); // до низа кадра: при подъёме камеры фон сдвигается вниз
    for (const [dy, lw, col] of NEAR_BANDS) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); polyline(ctx, off, 30, dy); ctx.stroke(); }
    for (let u = Math.floor(off / 26) * 26; u < off + W + 26; u += 26) { // полустаканы: светлая выемка и тёмная кромка
      const h = hash(u + 71); if (h < 0.4) continue;
      const x = u - off, y = pNear(u) + 5, len = 21 + h * 40;
      ctx.fillStyle = 'rgba(255,222,176,.25)'; ctx.fillRect(x - 1, y, 2.5, len);
      ctx.fillStyle = 'rgba(80,40,20,.3)'; ctx.fillRect(x + 1.5, y, 1, len);
    }
    ctx.strokeStyle = '#dca872'; ctx.lineWidth = 3.5; ctx.beginPath(); polyline(ctx, off, 30, 1); ctx.stroke();
    step = 230;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const u = i * step, x = u - off, top = pNear(u) - 46, nx = x + step, ntop = pNear(u + step) - 46;
      ctx.strokeStyle = '#6a4a33'; ctx.lineWidth = 2.5; ctx.beginPath();
      ctx.moveTo(x, top + 46); ctx.lineTo(x, top); ctx.moveTo(x - 9, top + 4); ctx.lineTo(x + 9, top + 4); ctx.stroke();
      ctx.strokeStyle = 'rgba(70,55,45,.7)'; ctx.lineWidth = 0.8; ctx.beginPath();
      for (const s of [-8, 8]) { ctx.moveTo(x + s, top + 3); ctx.quadraticCurveTo((x + nx) / 2 + s, (top + ntop) / 2 + 16, nx + s, ntop + 3); }
      ctx.stroke();
    }
  }

  // ---------- земля, провалы, платформы, препятствия ----------
  // пласты уступа по абсолютной высоте: на перепадах слои «продолжаются», как в настоящем карьере
  const STRATA = [[0, '#c98f58'], [242, '#bb7f4c'], [255, '#cd9860'], [266, '#aa7045'], [283, '#c08853'], [296, '#9c6441'],
    [312, '#b17b4f'], [327, '#90593a'], [343, '#a26c48'], [356, '#80502f']];

  function shadows(s, ctx, api) { // тень камня, который вот-вот сорвётся с борта (рисуется на своём отрезке)
    for (const w of st.warns) {
      if (w.x < s.x || w.x > s.x + s.w || Math.abs(w.gy - s.y) > 1) continue;
      const k = w.p ? 0.5 + 0.5 * api.clamp((w.p.y + 14) / (w.gy + 14), 0, 1) : 0.5 * (1 - Math.max(0, w.t) / WARN);
      ctx.fillStyle = `rgba(60,28,10,${(0.22 + 0.4 * k).toFixed(2)})`;
      ctx.beginPath(); ctx.ellipse(w.x, s.y + 1, 5 + 10 * k, 2 + 2.5 * k, 0, 0, TAU); ctx.fill();
      if (Math.floor(api.now * 8) % 2) {
        ctx.strokeStyle = 'rgba(255,60,30,.8)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(w.x, s.y + 1, 10 + 8 * k, 3.5 + 2 * k, 0, 0, TAU); ctx.stroke();
      }
    }
  }

  function strata(s, y0, ctx, api) { // пласты по абсолютной высоте от y0 до низа экрана
    const { H, hash } = api, x0 = s.x - 0.5, w = s.w + 1; // +1 px — без щелей на стыках
    for (let i = 0; i < STRATA.length; i++) {
      const top = Math.max(y0, STRATA[i][0]), bot = i + 1 < STRATA.length ? STRATA[i + 1][0] : H + 10;
      if (bot > top) { ctx.fillStyle = STRATA[i][1]; ctx.fillRect(x0, top, w, bot - top); }
    }
    ctx.fillStyle = 'rgba(80,40,18,.25)'; // неровные границы пластов
    for (let i = 1; i < STRATA.length; i++) {
      const b = STRATA[i][0]; if (b < y0 + 10) continue;
      for (let x = s.x + 2; x < s.x + s.w - 8; x += 21) { const h = hash(Math.floor(x) * 5 + i); ctx.fillRect(x, b - 1 + h * 2.5, 5 + h * 7, 1.6); }
    }
    ctx.fillStyle = 'rgba(50,22,8,.16)'; ctx.fillRect(x0, Math.max(y0 + 30, 318), w, H); ctx.fillRect(x0, Math.max(y0 + 60, 340), w, H);
  }
  function berm(s, ctx, api) { // берма сверху: утрамбованный гравий с камешками
    const { hash } = api, x0 = s.x - 0.5, w = s.w + 1;
    ctx.fillStyle = '#e0b984'; ctx.fillRect(x0, s.y, w, 6);
    ctx.fillStyle = 'rgba(95,52,24,.55)'; ctx.fillRect(x0, s.y + 6, w, 2);
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? '#9a8f8c' : '#b88a5a';
      for (let x = s.x + 2; x < s.x + s.w - 3; x += 6) {
        const h = hash(Math.floor(x) * 7 + 3); if ((h > 0.5) !== !!pass) continue;
        ctx.fillRect(x + h * 3, s.y + 1 + (h * 7 % 3), 2 + h * 2, 1.5 + h * 1.5);
      }
    }
  }

  function drawGround(s, ctx, api) { // уступ: гравийная берма сверху, под ней — слоистый откос
    if (s.wall) { drawWall(s, ctx, api); return; }
    const { hash } = api;
    strata(s, s.y, ctx, api);
    for (let x = Math.ceil(s.x / 34) * 34 + 10; x < s.x + s.w - 8; x += 34) { // полустаканы — следы взрывных скважин на откосе
      const h = hash(x * 3 + 7); if (h < 0.45) continue;
      ctx.fillStyle = 'rgba(255,226,180,.22)'; ctx.fillRect(x - 1.5, s.y + 10, 3, 24 + h * 50);
      ctx.fillStyle = 'rgba(70,35,15,.3)'; ctx.fillRect(x + 1.8, s.y + 10, 1.2, 24 + h * 50);
    }
    berm(s, ctx, api);
    shadows(s, ctx, api);
  }

  // стена — высокий скальный уступ: пачки песчаника и известняка, трещины, следы скважин, сетка на анкерах
  const CLIFF = [[10, '#d29a60'], [16, '#b0703f'], [7, '#dcaa70'], [22, '#9a5e36'], [12, '#c48853'], [19, '#a4683d'], [8, '#cf9a62'], [25, '#8c5431']];
  function drawWall(s, ctx, api) {
    const { hash } = api, x0 = s.x - 0.5, w = s.w + 1;
    if (s.foot == null) { const a = api.groundAt(s.x - 6), b = api.groundAt(s.x + s.w + 6); s.foot = Math.max(a ?? s.y + 140, b ?? s.y + 140); } // подошва — уровень соседних уступов
    const foot = s.foot;
    strata(s, foot, ctx, api); // ниже подошвы — те же пласты, что у соседей
    let y = s.y + 6, i = Math.floor(s.v * 8);
    const seams = [];
    while (y < foot) { const [t, c] = CLIFF[i % CLIFF.length]; ctx.fillStyle = c; ctx.fillRect(x0, y, w, Math.min(t, foot - y)); y += t; i++; if (y < foot - 4) seams.push(y); }
    ctx.fillStyle = 'rgba(70,32,12,.35)'; // неровные кромки пачек
    for (let k = 0; k < seams.length; k++) for (let x = s.x + 3; x < s.x + s.w - 6; x += 17) { const h = hash(Math.floor(x) * 3 + k * 31); ctx.fillRect(x, seams[k] - 1 + h * 2, 4 + h * 9, 1.5); }
    ctx.fillStyle = 'rgba(255,232,196,.2)';
    for (let k = 0; k < seams.length; k++) for (let x = s.x + 9; x < s.x + s.w - 6; x += 29) { const h = hash(Math.floor(x) * 7 + k * 13); ctx.fillRect(x, seams[k] + 1, 6 + h * 8, 1.2); }
    ctx.strokeStyle = 'rgba(60,26,8,.5)'; ctx.lineWidth = 1.3; ctx.beginPath(); // вертикальные трещины-отдельности
    for (let x = s.x + 22; x < s.x + s.w - 12; x += 41) {
      const h = hash(Math.floor(x) * 11 + 5); if (h < 0.35) continue;
      let cy = s.y + 10 + h * 20, cx = x; ctx.moveTo(cx, cy);
      const end = Math.min(foot - 4, cy + 40 + h * 70);
      while (cy < end) { cy = Math.min(end, cy + 9 + h * 6); cx += (hash(Math.floor(cy) + Math.floor(x)) - 0.5) * 7; ctx.lineTo(cx, cy); }
    }
    ctx.stroke();
    for (let x = Math.ceil(s.x / 30) * 30 + 12; x < s.x + s.w - 10; x += 30) { // полустаканы скважин
      const h = hash(x * 5 + 3); if (h < 0.5) continue;
      const len = Math.min(foot - s.y - 30, 30 + h * 60);
      ctx.fillStyle = 'rgba(255,226,180,.24)'; ctx.fillRect(x - 1.5, s.y + 26, 3, len);
      ctx.fillStyle = 'rgba(70,35,15,.32)'; ctx.fillRect(x + 1.8, s.y + 26, 1.2, len);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(s.x + 4, s.y + 8, s.w - 8, 44); ctx.clip(); // сетка на анкерах — удерживает заколы
    ctx.strokeStyle = 'rgba(70,74,80,.45)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = s.x - 44; x < s.x + s.w + 4; x += 11) { ctx.moveTo(x, s.y + 8); ctx.lineTo(x + 44, s.y + 52); ctx.moveTo(x + 44, s.y + 8); ctx.lineTo(x, s.y + 52); }
    ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#5d6168'; for (let x = s.x + 16; x < s.x + s.w - 8; x += 38) { ctx.fillRect(x - 2, s.y + 11, 4, 4); ctx.fillRect(x + 17, s.y + 43, 4, 4); } // анкеры
    ctx.fillStyle = 'rgba(60,28,10,.3)'; ctx.fillRect(x0, s.y + 6, 6, foot - s.y - 6); // кромки откоса: слева тень, справа свет, контур
    ctx.fillStyle = 'rgba(255,232,196,.22)'; ctx.fillRect(s.x + s.w - 5, s.y + 6, 5, foot - s.y - 6);
    ctx.fillStyle = '#5e331b'; ctx.fillRect(x0, s.y + 6, 1.5, foot - s.y - 6); ctx.fillRect(s.x + s.w - 1, s.y + 6, 1.5, foot - s.y - 6);
    ctx.fillStyle = 'rgba(50,22,8,.35)'; ctx.fillRect(x0, s.y + 8, w, 5); // тень под бровкой
    if (foot - s.y > 100) { // знак «Опасная зона» на откосе
      const sx = s.x + s.w * (0.45 + s.v * 0.3), sy = foot - 34;
      ctx.fillStyle = '#6b6f76'; ctx.fillRect(sx - 1, sy, 2, 16);
      ctx.fillStyle = '#f2c230'; path(ctx, [sx, sy - 18, sx + 11, sy + 1, sx - 11, sy + 1]); ctx.fill();
      ctx.strokeStyle = '#26221f'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#26221f'; ctx.fillRect(sx - 1, sy - 11, 2, 7); ctx.fillRect(sx - 1, sy - 3, 2, 2);
    }
    berm(s, ctx, api);
    shadows(s, ctx, api);
  }

  const PIT = ['#7c4a30', '#8c5738', '#744429', '#86523a']; // пласты задней стены провала — в тени, темнее
  function drawPit(p, ctx, api) { // край уступа: обрыв к нижнему уступу — слоистая стена уходит в пыльную дымку
    const { H, now } = api, x = p.x, w = p.w;
    for (let y = p.y, i = 0; y < H; y += 15, i++) { ctx.fillStyle = PIT[i % 4]; ctx.fillRect(x, y, w, 15); }
    ctx.fillStyle = 'rgba(35,15,5,.4)'; ctx.fillRect(x, p.y, w, 22);                                               // тень от кромки
    ctx.fillStyle = '#5a321d'; path(ctx, [x, p.y, x + 13, p.y + 26, x + 9, p.y + 64, x + 15, H, x, H]); ctx.fill();  // левый откос в тени
    ctx.fillStyle = '#b98050'; path(ctx, [x + w, p.y, x + w - 9, p.y + 34, x + w - 6, H, x + w, H]); ctx.fill();    // правый — на солнце
    ctx.fillStyle = 'rgba(238,218,186,.3)'; // пыльная дымка: чем глубже, тем гуще
    for (let i = 1; i <= 3; i++) { const y = p.y + 18 + i * 20; if (y < H) ctx.fillRect(x, y, w, H - y); }
    for (let j = 0; j < 2; j++) { // пыль поднимается со дна и тает, не выходя из провала
      const k = frac(now * 0.22 + j * 0.5 + p.v), y = H - k * (H - p.y - 16);
      ctx.globalAlpha = 0.5 * (1 - k); ctx.fillStyle = '#f2e3c8'; circle(ctx, x + w * (0.35 + j * 0.3), y, 5 + k * 5);
    }
    ctx.globalAlpha = 1;
    const bx = x - 10; // полосатый столбик на бровке
    for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#f4f1ea' : '#d8322a'; ctx.fillRect(bx - 2, p.y - 24 + i * 6, 4, 6); }
    ctx.fillStyle = '#ffb000'; ctx.fillRect(bx - 2, p.y - 21, 4, 2);
  }

  function drawTowerDeck(p, ctx, api) { // ярус вышки — стальная эстакада дробильного комплекса: двутавровые стойки со связями, решётчатый настил
    const cols = p.w > 170 ? [p.x + 10, p.x + p.w / 2, p.x + p.w - 10] : [p.x + 10, p.x + p.w - 10];
    const feet = p.feet || (p.feet = cols.map(cx => surfaceAt(api, cx, p.y + 12) ?? p.base)); // стойка опирается на нижний ярус или на землю (считаем один раз)
    ctx.strokeStyle = '#5f7383'; ctx.lineWidth = 1.6; ctx.beginPath(); // крестовые связи и распорки между стойками
    for (let k = 0; k + 1 < cols.length; k++) {
      const a = cols[k] + 3, b = cols[k + 1] - 3, bot = Math.min(feet[k], feet[k + 1]) - 4, n = Math.max(1, Math.round((bot - p.y - 12) / 58)), ph = (bot - p.y - 12) / n;
      for (let j = 0; j < n; j++) { const y1 = p.y + 12 + j * ph, y2 = y1 + ph; ctx.moveTo(a, y1); ctx.lineTo(b, y2); ctx.moveTo(b, y1); ctx.lineTo(a, y2); }
    }
    ctx.stroke();
    ctx.strokeStyle = '#4b5d6b'; ctx.lineWidth = 2.5; ctx.beginPath();
    for (let k = 0; k + 1 < cols.length; k++) {
      const bot = Math.min(feet[k], feet[k + 1]) - 4, n = Math.max(1, Math.round((bot - p.y - 12) / 58)), ph = (bot - p.y - 12) / n;
      for (let j = 1; j <= n; j++) { ctx.moveTo(cols[k], p.y + 12 + j * ph); ctx.lineTo(cols[k + 1], p.y + 12 + j * ph); }
    }
    ctx.stroke();
    cols.forEach((cx, k) => { // стойки-двутавры с опорными плитами
      ctx.fillStyle = '#445866'; ctx.fillRect(cx - 3.5, p.y + 8, 7, feet[k] - p.y - 8);
      ctx.fillStyle = '#7b91a1'; ctx.fillRect(cx - 3.5, p.y + 8, 1.5, feet[k] - p.y - 8);
      ctx.fillStyle = '#2e3a43'; ctx.fillRect(cx - 7, feet[k] - 3, 14, 3);
    });
    ctx.fillStyle = '#3b4852'; ctx.fillRect(p.x - 2, p.y + 6, p.w + 4, 5);            // балка
    ctx.fillStyle = '#7d8a94'; ctx.fillRect(p.x - 4, p.y, p.w + 8, 6.5);              // решётчатый настил
    ctx.fillStyle = '#56626b'; for (let x = p.x - 1; x < p.x + p.w + 2; x += 5) ctx.fillRect(x, p.y + 2, 2, 3);
    ctx.fillStyle = '#b9c4cc'; ctx.fillRect(p.x - 4, p.y, p.w + 8, 1);
    for (let x = p.x - 4, i = 0; x < p.x + p.w + 4; x += 8, i++) { ctx.fillStyle = i % 2 ? '#26221f' : '#f2b705'; ctx.fillRect(x, p.y + 6.5, Math.min(8, p.x + p.w + 4 - x), 2); } // бортик в полосах опасности
    ctx.fillStyle = '#f2b705'; ctx.fillRect(p.x - 4, p.y - 18, p.w + 8, 2.5); ctx.fillRect(p.x - 4, p.y - 9, p.w + 8, 2); // жёлтые перила
    const n = Math.max(2, Math.round(p.w / 46));
    for (let i = 0; i <= n; i++) ctx.fillRect(p.x - 4 + i * (p.w + 6) / n, p.y - 18, 2.5, 18);
    if (p.tier === 3) { // на верхнем ярусе — мачта с проблесковым маячком и ветроуказателем
      const mx = p.x + p.w - 8, t = api.now;
      ctx.fillStyle = '#8b9099'; ctx.fillRect(mx - 1, p.y - 52, 2.5, 34);
      const on = (t * 1.3 + p.v) % 1 < 0.4;
      if (on) { ctx.fillStyle = 'rgba(255,150,40,.35)'; circle(ctx, mx, p.y - 55, 7); }
      ctx.fillStyle = on ? '#ffb13b' : '#9a5a1a'; ctx.fillRect(mx - 2.5, p.y - 58, 5.5, 5);
      const wv = Math.sin(t * 4 + p.v * 5) * 2;
      for (let k = 0; k < 4; k++) { ctx.fillStyle = k % 2 ? '#f4f1ea' : '#e0452f'; path(ctx, [mx + 2 + k * 6, p.y - 49 - 3.5 + k * 0.7, mx + 8 + k * 6, p.y - 49 - 2.8 + k * 0.7 + wv * (k + 1) / 4, mx + 8 + k * 6, p.y - 49 + 2.8 - k * 0.7 + wv * (k + 1) / 4, mx + 2 + k * 6, p.y - 49 + 3.5 - k * 0.7]); ctx.fill(); }
    }
    shadows(p, ctx, api);
  }

  function drawLadder(l, ctx) { // стальная лестница; на стене — на анкерах, с ограждающими дугами
    const top = l.top - 14, h = l.bottom - top;
    ctx.fillStyle = 'rgba(40,20,8,.22)'; ctx.fillRect(l.x + 3, l.top, l.w - 2, l.bottom - l.top);
    if (l.wall) { ctx.fillStyle = '#3f4549'; for (let y = l.top + 12; y < l.bottom - 6; y += 40) ctx.fillRect(l.x + l.w - 2, y, 4, 3); } // кронштейны в скалу
    ctx.fillStyle = '#6f777e'; ctx.fillRect(l.x, top + 2, 3, h - 2); ctx.fillRect(l.x + l.w - 3, top + 2, 3, h - 2);
    ctx.fillStyle = '#c3cad0'; for (let y = l.top + 6; y < l.bottom; y += 12) ctx.fillRect(l.x + 2, y, l.w - 4, 2.5);
    ctx.fillStyle = '#f2b705'; ctx.fillRect(l.x - 1, top, 5, 3); ctx.fillRect(l.x + l.w - 4, top, 5, 3);
    if (l.wall && h > 90) { // дуги ограждения: кольца и продольные полосы
      const y0 = l.top + 8, y1 = l.bottom - 46;
      ctx.strokeStyle = 'rgba(120,128,135,.85)'; ctx.lineWidth = 1.4; ctx.beginPath();
      for (let y = y0; y <= y1; y += 24) { ctx.moveTo(l.x + l.w + 5, y); ctx.ellipse(l.x + l.w / 2, y, l.w / 2 + 5, 3, 0, 0, TAU); }
      ctx.moveTo(l.x - 5, y0); ctx.lineTo(l.x - 5, y1); ctx.moveTo(l.x + l.w / 2, y0 + 3); ctx.lineTo(l.x + l.w / 2, y1 + 3);
      ctx.stroke();
    }
  }

  function drawPlatform(p, ctx, api) {
    const { now } = api;
    if (p.tower) drawTowerDeck(p, ctx, api);
    else if (p.tier === 1) { // ленточный конвейер на эстакаде
      const x0 = p.x - 2, x1 = p.x + p.w + 2, y = p.y, n = Math.max(2, Math.round(p.w / 80));
      ctx.strokeStyle = '#5b626c'; ctx.lineWidth = 3; ctx.beginPath();
      for (let i = 0; i <= n; i++) { const x = p.x + 12 + i * (p.w - 24) / n; ctx.moveTo(x - 9, p.base); ctx.lineTo(x, y + 12); ctx.lineTo(x + 9, p.base); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(91,98,108,.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x + 12, (y + p.base) / 2 + 6); ctx.lineTo(p.x + p.w - 12, (y + p.base) / 2 + 6); ctx.stroke();
      ctx.fillStyle = '#707985'; ctx.fillRect(x0, y + 4, x1 - x0, 6);     // став
      ctx.fillStyle = '#4b515a'; ctx.fillRect(x0, y + 10, x1 - x0, 2);
      ctx.fillStyle = '#2a2624'; ctx.fillRect(x0, y + 14, x1 - x0, 2);    // холостая ветвь ленты
      ctx.fillStyle = '#b3bac4'; for (let x = p.x + 8; x < p.x + p.w - 4; x += 18) ctx.fillRect(x, y + 6, 4, 3); // ролики
      ctx.fillStyle = '#2c2825'; ctx.fillRect(x0, y, x1 - x0, 4.5);        // лента
      const o = (now * BELT) % 14;
      ctx.fillStyle = '#524a43'; for (let x = x0 + o; x < x1 - 4; x += 14) ctx.fillRect(x, y + 1, 5, 2);
      const o2 = (now * BELT) % 23;
      ctx.fillStyle = '#a9a5ab'; for (let x = x0 + o2; x < x1 - 5; x += 23) { ctx.fillRect(x, y - 2, 4, 2.5); ctx.fillRect(x + 3, y - 1.5, 3, 2); } // щебень едет
      const a = now * BELT / 5.5;
      for (const cx of [x0, x1]) { // приводной и хвостовой барабаны вращаются
        ctx.fillStyle = '#3a3d44'; circle(ctx, cx, y + 5, 5.5);
        ctx.strokeStyle = '#d3d8df'; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 4.5, y + 5 + Math.sin(a) * 4.5); ctx.lineTo(cx - Math.cos(a) * 4.5, y + 5 - Math.sin(a) * 4.5);
        ctx.moveTo(cx - Math.sin(a) * 4.5, y + 5 + Math.cos(a) * 4.5); ctx.lineTo(cx + Math.sin(a) * 4.5, y + 5 - Math.cos(a) * 4.5); ctx.stroke();
      }
      ctx.fillStyle = '#3f7d5a'; ctx.fillRect(x1 - 6, y + 12, 13, 9); ctx.fillStyle = '#2d5a41'; ctx.fillRect(x1 - 6, y + 15, 13, 2); // привод
      shadows(p, ctx, api);
    } else { // деревянные мостки над конвейером
      const n = Math.max(1, Math.round(p.w / 60));
      ctx.strokeStyle = '#7a5434'; ctx.lineWidth = 3; ctx.beginPath();
      for (let i = 0; i <= n; i++) { const x = p.x + 6 + i * (p.w - 12) / n; ctx.moveTo(x, p.y + 6); ctx.lineTo(x, p.base); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(122,84,52,.8)'; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i < n; i++) { const x = p.x + 6 + i * (p.w - 12) / n; ctx.moveTo(x, p.base - 4); ctx.lineTo(x + (p.w - 12) / n, p.y + 8); }
      ctx.stroke();
      ctx.fillStyle = '#c99760'; ctx.fillRect(p.x - 4, p.y, p.w + 8, 7);
      ctx.fillStyle = '#8f6238'; for (let x = p.x - 4; x < p.x + p.w + 4; x += 11) ctx.fillRect(x, p.y, 1.2, 7);
      ctx.fillStyle = '#a97a47'; ctx.fillRect(p.x - 4, p.y + 5, p.w + 8, 2);
      ctx.fillStyle = '#7a5434'; ctx.fillRect(p.x - 4, p.y - 16, p.w + 8, 2);
      for (let x = p.x - 4; x <= p.x + p.w + 2; x += Math.max(24, (p.w + 6) / 4)) ctx.fillRect(x, p.y - 16, 2.5, 16);
      for (let x = p.x - 4, i = 0; x < p.x + p.w + 4; x += 8, i++) { ctx.fillStyle = i % 2 ? '#f2efe6' : '#e0452f'; ctx.fillRect(x, p.y - 10, Math.min(8, p.x + p.w + 4 - x), 2); } // сигнальная лента
      shadows(p, ctx, api);
    }
  }

  const PILE1 = [[0, 1, 0.02, 0.35, 0.18, 0.04, 0.55, 0, 0.68, 0.3, 0.64, 1], [0.58, 1, 0.6, 0.45, 0.76, 0.12, 0.96, 0.2, 1, 0.55, 1, 1]];
  const PILE2 = [[0, 1, 0, 0.55, 0.12, 0.42, 0.5, 0.4, 0.6, 0.6, 0.56, 1], [0.5, 1, 0.52, 0.62, 0.66, 0.45, 0.95, 0.46, 1, 0.7, 1, 1],
    [0.06, 0.5, 0.1, 0.1, 0.3, 0, 0.78, 0.02, 0.94, 0.2, 0.9, 0.5]];
  function drawObstacle(s, ctx, api) {
    const { x, y, w, h } = s;
    if (s.v < 0.55) { // шина БелАЗа: одна лежит плашмя, высокая стоит на протекторе
      const lying = s.stack === 1, top = lying ? y + 13 : y + 5;
      ctx.fillStyle = '#26221f'; rrect(ctx, x, y, w, h, lying ? 7 : 10);
      ctx.strokeStyle = '#433c36'; ctx.lineWidth = 3; ctx.beginPath(); // протектор-ёлочка
      for (let yy = top; yy < y + h - 6; yy += 8) { ctx.moveTo(x + 4, yy); ctx.lineTo(x + w / 2, yy + 4); ctx.lineTo(x + w - 4, yy); }
      ctx.stroke();
      ctx.fillStyle = '#141110'; ctx.fillRect(x + w / 2 - 1, top, 2, y + h - 5 - top);
      if (lying) { // видна боковина и жёлтый обод
        ctx.fillStyle = '#39342f'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + 7, w / 2 - 1, 6.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#d9a514'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + 7, 12, 3.6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#1a1614'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + 7.4, 7, 2, 0, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x + 3, y + h - 9, w - 6, 6);
        ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fillRect(x + 5, y + 5, 6, h - 12);
        ctx.fillStyle = 'rgba(222,180,128,.65)'; ctx.fillRect(x + 6, y, w - 12, 2.5); // пыль сверху
      }
    } else { // гора негабаритов: угловатые глыбы песчаника со следами скважин
      const rocks = s.stack === 1 ? PILE1 : PILE2, cols = ['#a89684', '#9b8a79', '#b3a18c'];
      rocks.forEach((r, i) => {
        const n = r.length / 2, P = (j, a) => a ? y + r[j * 2 + 1] * h : x + r[j * 2] * w; // вершина j: a=0 — x, a=1 — y
        let cx = 0, cy = 0; for (let j = 0; j < n; j++) { cx += P(j, 0) / n; cy += P(j, 1) / n; }
        ctx.fillStyle = cols[i]; path(ctx, r, w, h, x, y); ctx.fill();
        ctx.fillStyle = 'rgba(255,246,228,.38)'; ctx.beginPath(); ctx.moveTo(P(1, 0), P(1, 1)); ctx.lineTo(P(2, 0), P(2, 1)); ctx.lineTo(P(3, 0), P(3, 1)); ctx.lineTo(cx, cy); ctx.fill(); // верхняя грань на свету
        ctx.fillStyle = 'rgba(45,28,15,.22)'; ctx.beginPath(); ctx.moveTo(P(n - 2, 0), P(n - 2, 1)); ctx.lineTo(P(n - 1, 0), P(n - 1, 1)); ctx.lineTo(cx, cy); ctx.fill(); // правая — в тени
        ctx.strokeStyle = '#4f4338'; ctx.lineWidth = 1.5; path(ctx, r, w, h, x, y); ctx.stroke();
      });
      ctx.fillStyle = '#4f4338'; ctx.fillRect(x + w * 0.3, y + h * 0.62, 2.5, 2.5); ctx.fillRect(x + w * 0.8, y + h * 0.78, 2.5, 2.5);
    }
    shadows(s, ctx, api);
  }

  function drawDecor(d, ctx, api) {
    const x = d.x, y = d.y, { now, hash } = api;
    if (d.kind === 'pole') { // геодезическая веха с флажком на бетонном пикете
      ctx.fillStyle = '#8a8f96'; ctx.fillRect(x - 5, y - 4, 10, 4);
      for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#f4f1ea' : '#d8322a'; ctx.fillRect(x - 1.5, y - 53 + i * 7, 3, 7); }
      const wv = Math.sin(now * 5 + d.v * 9) * 3;
      ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.moveTo(x + 1.5, y - 53); ctx.quadraticCurveTo(x + 9, y - 51 + wv, x + 17, y - 48 + wv); ctx.lineTo(x + 1.5, y - 43); ctx.fill();
    } else if (d.kind === 'sign') { // щит «Взрывные работы!»
      ctx.fillStyle = '#6b6f76'; ctx.fillRect(x - 20, y - 36, 2.5, 36); ctx.fillRect(x + 17.5, y - 36, 2.5, 36);
      ctx.fillStyle = '#d8322a'; ctx.fillRect(x - 26, y - 52, 52, 25);
      ctx.fillStyle = '#fbf6ea'; ctx.fillRect(x - 24, y - 50, 48, 21);
      api.text('ВЗРЫВНЫЕ', x, y - 41, 7.5, '#c62828'); api.text('РАБОТЫ!', x, y - 32, 8, '#c62828');
    } else if (d.kind === 'barrel') { // бочка с дизтопливом
      ctx.fillStyle = '#2b5f8a'; ctx.fillRect(x - 9, y - 24, 18, 24);
      ctx.fillStyle = '#1f4868'; ctx.fillRect(x - 9, y - 17, 18, 2); ctx.fillRect(x - 9, y - 8, 18, 2);
      ctx.fillStyle = '#3d78a8'; ctx.beginPath(); ctx.ellipse(x, y - 24, 9, 2.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x - 6, y - 22, 3, 21);
      api.text('ДТ', x + 1, y - 10, 7, '#f1e6d6');
    } else if (d.kind === 'pile') { // куча гранитного щебня
      ctx.fillStyle = '#8e8c93'; ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.quadraticCurveTo(x - 8, y - 30, x + 4, y - 20); ctx.quadraticCurveTo(x + 14, y - 14, x + 24, y); ctx.fill();
      for (let i = 0; i < 22; i++) {
        const h1 = hash(i * 13 + Math.floor(x)), h2 = hash(i * 7 + 5 + Math.floor(x)), px = x - 20 + h1 * 40, top = y - 17 * (1 - Math.abs(px - x + 3) / 26);
        ctx.fillStyle = i % 3 ? '#b9b7bf' : '#636169'; ctx.fillRect(px, top + h2 * (y - top - 3), 2.5, 2);
      }
    } else if (d.kind === 'cone') { // дорожный конус
      ctx.fillStyle = '#ff6d1a'; ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x, y - 21); ctx.lineTo(x + 7, y); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 4, y - 12, 8, 3); ctx.fillStyle = '#333'; ctx.fillRect(x - 9, y - 2, 18, 2);
    } else if (d.kind === 'bucket') { // старый ковш экскаватора с зубьями
      ctx.fillStyle = '#8a6a3e'; path(ctx, [x - 18, y, x - 20, y - 18, x + 10, y - 22, x + 16, y - 6, x + 12, y]); ctx.fill();
      ctx.fillStyle = '#6b5030'; ctx.fillRect(x - 18, y - 15, 30, 3);
      ctx.fillStyle = '#b5a48c'; for (let i = 0; i < 4; i++) { path(ctx, [x + 11, y - 1 - i * 5, x + 20, y - 3 - i * 5, x + 12, y - 5 - i * 5]); ctx.fill(); } // зубья
      ctx.fillStyle = 'rgba(214,176,128,.8)'; ctx.fillRect(x - 17, y - 5, 26, 5); // внутри — песок
    }
  }

  function drawFinish(fx, gy, ctx, api) { // пост взрывника-диспетчера: вагончик на полозьях, антенна и сигнальный флаг
    const x = fx + 130, y = gy, { now } = api;
    ctx.fillStyle = '#4a4540'; ctx.fillRect(x - 8, y - 6, 146, 6);                    // полозья
    ctx.fillStyle = '#2f7f74'; ctx.fillRect(x, y - 68, 130, 62);                      // корпус
    ctx.fillStyle = '#276b62'; for (let i = 4; i < 130; i += 8) ctx.fillRect(x + i, y - 68, 2, 62); // гофра
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(x, y - 30, 130, 4);
    ctx.fillStyle = '#e9e4d8'; ctx.fillRect(x - 5, y - 74, 140, 7);                   // крыша
    ctx.fillStyle = '#23303a'; ctx.fillRect(x + 12, y - 60, 46, 24);
    ctx.fillStyle = '#bfe7ff'; ctx.fillRect(x + 14, y - 58, 42, 20);
    ctx.fillStyle = '#2f4a7a'; ctx.fillRect(x + 28, y - 45, 12, 7);                   // диспетчер в окне
    ctx.fillStyle = '#f1c27d'; circle(ctx, x + 34, y - 49, 3.5);
    ctx.fillStyle = '#ff9f43'; ctx.beginPath(); ctx.arc(x + 34, y - 51, 4.2, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x + 16, y - 57, 6, 18);
    ctx.fillStyle = '#5b4030'; ctx.fillRect(x + 86, y - 62, 24, 56); ctx.fillStyle = '#e0c060'; ctx.fillRect(x + 104, y - 36, 3, 3); // дверь
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 8, y - 94, 114, 17);                    // вывеска
    ctx.strokeStyle = '#c62828'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 8, y - 94, 114, 17);
    api.text('ДИСПЕТЧЕРСКАЯ', x + 65, y - 81, 10, '#c62828');
    ctx.strokeStyle = '#8b9099'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 124, y - 74); ctx.lineTo(x + 124, y - 150); ctx.stroke(); // антенна
    ctx.lineWidth = 1; ctx.beginPath(); for (let yy = y - 146; yy < y - 76; yy += 8) { ctx.moveTo(x + 120, yy); ctx.lineTo(x + 128, yy + 8); } ctx.moveTo(x + 124, y - 138); ctx.lineTo(x + 136, y - 138); ctx.stroke();
    if ((now * 1.2) % 1 < 0.5) { ctx.fillStyle = 'rgba(255,50,40,.35)'; circle(ctx, x + 124, y - 152, 6); }
    ctx.fillStyle = '#ff3b30'; circle(ctx, x + 124, y - 152, 2.5);
    ctx.fillStyle = '#9aa0a8'; path(ctx, [x + 60, y - 97, x + 72, y - 104, x + 72, y - 110, x + 60, y - 103]); ctx.fill(); ctx.fillRect(x + 58, y - 104, 3, 10); // сирена
    ctx.fillStyle = '#ddd'; ctx.fillRect(x + 2, y - 124, 3, 50);                     // сигнальный флаг
    const wv = Math.sin(now * 4) * 3;
    ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.moveTo(x + 5, y - 124); ctx.quadraticCurveTo(x + 18, y - 120 + wv, x + 32, y - 121); ctx.lineTo(x + 32, y - 104); ctx.quadraticCurveTo(x + 18, y - 104 + wv, x + 5, y - 107); ctx.fill();
  }

  // ---------- враги ----------
  function wheel(ctx, x, y, a) { // колесо БелАЗа: протектор, жёлтый диск, болты — крутится
    ctx.fillStyle = '#1d1a18'; circle(ctx, x, y, 16);
    ctx.strokeStyle = '#3d3632'; ctx.lineWidth = 3.5; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const b = a + i * TAU / 10, c = Math.cos(b), s = Math.sin(b); ctx.moveTo(x + c * 11.5, y + s * 11.5); ctx.lineTo(x + c * 15.5, y + s * 15.5); }
    ctx.stroke();
    ctx.fillStyle = '#e0a800'; circle(ctx, x, y, 8);
    ctx.fillStyle = '#7d5c00'; for (let i = 0; i < 5; i++) { const b = a + i * TAU / 5; ctx.fillRect(x + Math.cos(b) * 5 - 1, y + Math.sin(b) * 5 - 1, 2, 2); }
    ctx.fillStyle = '#3a3632'; circle(ctx, x, y, 2.5);
  }
  const BODY = [-8, 0, -10, -24, 58, -26, 78, -26, 78, -22, 58, -20, 54, 0]; // кузов с козырьком над кабиной (от заднего шарнира)

  function dumpRocks(e, api) { // из поднятого кузова назад-вверх летят 2–3 глыбы
    const n = Math.random() < 0.5 ? 2 : 3, back = -e.dir, sx = e.x + e.w / 2 + back * 48, sy = e.y + 16;
    const base = api.clamp(Math.abs(api.dx(e)) / 0.8, 90, 230);
    for (let i = 0; i < n; i++) {
      api.shoot({ x: sx, y: sy - i * 4, w: 14, h: 12, vx: back * base * (0.6 + i * 0.4), vy: -330 - i * 20, spin: back * api.rand(4, 9),
        color: i % 2 ? '#8e8a94' : '#a07a58', draw: drawChunk, pts: 15, source: e, onLand: rockLand });
    }
    api.burst(sx, sy, '#d8b98f', 10, 120, 300); api.shake(2);
  }

  const SIG_AIM = 1.05, SIG_LOCK = 0.4, SIG_MX = 22, SIG_MY = -31; // сигнальщик: время прицеливания, фиксации и дуло (в его координатах)
  function drawFlare(p, ctx, api) { // сигнальная ракета: яркая звезда с искрящимся хвостом
    ctx.fillStyle = 'rgba(255,90,60,.35)'; circle(ctx, 0, 0, 9);
    ctx.fillStyle = Math.floor(api.now * 24) % 2 ? '#fff1b8' : '#ffd0a0'; circle(ctx, 0, 0, 4);
    ctx.fillStyle = '#ff3b30'; circle(ctx, 0, 0, 2.2);
  }
  function fireFlare(e, api) { // выстрел по зафиксированной точке, прямо и без гравитации; рейка отбивает ракету обратно
    const c = Math.cos, s = Math.sin, bx = e.x + e.w / 2, by = e.y + e.h;
    const a = Math.atan2(e.ty - (by + SIG_MY), (e.tx - bx) * e.dir - 2), ox = bx + e.dir * (2 + c(a) * SIG_MX), oy = by + SIG_MY + s(a) * SIG_MX;
    const dx = e.tx - ox, dy = e.ty - oy, d = Math.hypot(dx, dy) || 1, v = 300;
    api.shoot({ x: ox, y: oy, w: 10, h: 10, vx: dx / d * v, vy: dy / d * v, gravity: 0, life: 2.2, color: '#ff5a3c', draw: drawFlare,
      reflectable: true, pts: 25, source: e, update: (p, dt, a2) => { if (Math.random() < dt * 25) a2.burst(p.x + 5, p.y + 5, '#ffb13b', 1, 40, 150); },
      onLand: (p, a2) => a2.burst(p.x + 5, p.y + 5, '#ff8a3c', 10, 150, 400) });
    api.burst(ox, oy, '#fff1b8', 6, 120, 200);
  }

  const enemies = {
    boulder: { // валун: дремлет на уступе; заметив героя, раскачивается 0,8 с и катится к нему до края уступа
      w: 30, h: 30, hp: 2, pts: 150, stompable: false, hitColor: '#d9dce6', deathColor: '#8d90a0',
      init(e) { e.state = 'rest'; e.rot = 0; e.wob = 0; e.cd = 0.3; },
      update(e, dt, api) {
        const dx = api.dx(e), P = api.player, d = Math.sign(dx) || e.dir;
        if (e.state === 'rest') {
          const room = d > 0 ? e.maxX - e.x - e.w : e.x - e.minX; // есть куда катиться?
          const pc = P.x + P.w / 2, home = pc > e.minX - 4 && pc < e.maxX + 4; // только если герой на этом уступе (иначе валун запрёт место приземления за провалом)
          if ((e.cd -= dt) <= 0 && home && room > 24 && Math.abs(dx) < 260 && Math.abs(P.y + P.h - e.y - e.h) < 150) { e.state = 'wobble'; e.wob = 0.8; e.dir = d; }
        } else if (e.state === 'wobble') {
          if ((e.wob -= dt) <= 0) { e.state = 'roll'; api.burst(e.x + e.w / 2, e.y + e.h, '#d8b98f', 6, 90, 300); }
        } else {
          e.x += e.dir * 180 * dt; e.rot += 180 * dt / 15;
          if (Math.random() < dt * 14) api.burst(e.x + e.w / 2 - e.dir * 12, e.y + e.h - 2, '#d8b98f', 1, 50, 200);
          if (e.x <= e.minX || e.x + e.w >= e.maxX) { // упёрся в край уступа
            e.x = api.clamp(e.x, e.minX, e.maxX - e.w); e.state = 'rest'; e.cd = 1.3;
            api.burst(e.x + e.w / 2 + e.dir * 14, e.y + e.h - 6, '#cdb08a', 8, 120, 500); api.shake(2);
          }
        }
      },
      draw(e, ctx, api) {
        const wob = e.state === 'wobble' ? Math.sin(e.t * 40) * 0.13 : 0, ox = wob * 10, rolling = e.state === 'roll';
        ctx.fillStyle = 'rgba(70,40,20,.28)'; ctx.beginPath(); ctx.ellipse(0, -1, 15, 3, 0, 0, TAU); ctx.fill();
        ctx.save(); ctx.translate(ox, -15); ctx.rotate(e.rot + wob);
        ctx.fillStyle = '#7f8395'; path(ctx, ROCK); ctx.fill();
        ctx.strokeStyle = '#353743'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#a9adbd'; ctx.fillRect(-9, -3, 3, 3); ctx.fillRect(4, 7, 3, 2); ctx.fillRect(-2, -11, 2, 2); // вкрапления — видно вращение
        ctx.fillStyle = '#5a5d6c'; ctx.fillRect(6, -8, 3, 3); ctx.fillRect(-7, 6, 2, 2);
        ctx.strokeStyle = '#464855'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-12, 2); ctx.lineTo(-5, 4); ctx.lineTo(-1, 11);
        if (e.hp < e.maxHp) { ctx.moveTo(8, -10); ctx.lineTo(2, -2); ctx.lineTo(6, 5); ctx.moveTo(2, -2); ctx.lineTo(-6, -6); } // трещина от удара
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,.17)'; circle(ctx, ox - 5, -21, 6);                          // свет сверху-слева
        ctx.fillStyle = 'rgba(20,20,45,.2)'; ctx.beginPath(); ctx.arc(ox, -15, 13, -0.3, 1.9); ctx.fill(); // тень справа-снизу
        const fy = rolling ? Math.sin(e.t * 22) : 0;
        if (e.state === 'rest') { // спит: глаза закрыты
          ctx.strokeStyle = '#23242c'; ctx.lineWidth = 1.6; ctx.beginPath();
          ctx.moveTo(ox + 1, -19); ctx.quadraticCurveTo(ox + 4, -17, ox + 7, -19); ctx.moveTo(ox + 9, -19); ctx.quadraticCurveTo(ox + 12, -17, ox + 15, -19); ctx.stroke();
        } else { // проснулся: злые глаза
          ctx.fillStyle = '#fff'; circle(ctx, ox + 4, -18 + fy, 3.2); circle(ctx, ox + 11.5, -18 + fy, 3.2);
          ctx.fillStyle = '#d61f1f'; circle(ctx, ox + 5.2, -18 + fy, 1.6); circle(ctx, ox + 12.7, -18 + fy, 1.6);
          ctx.strokeStyle = '#1f2029'; ctx.lineWidth = 2; ctx.beginPath();
          ctx.moveTo(ox + 0.5, -23.5 + fy); ctx.lineTo(ox + 7, -21 + fy); ctx.moveTo(ox + 15, -23.5 + fy); ctx.lineTo(ox + 9, -21 + fy); ctx.stroke();
        }
        if (e.state === 'wobble') { // из-под валуна сыплется пыль, над ним — «!»
          const k = frac(e.t * 5);
          ctx.fillStyle = 'rgba(216,185,143,.8)'; circle(ctx, -14 - k * 7, -3 - k * 5, 2.5 + k * 2.5); circle(ctx, 14 + k * 7, -3 - k * 5, 2.5 + k * 2.5);
          api.text('!', 0, -35, 16, '#ff3b30');
        }
      },
      onDeath(e, api) { const cx = e.x + e.w / 2, cy = e.y + e.h / 2; api.burst(cx, cy, '#7f8395', 12, 220, 800); api.burst(cx, cy, '#d8b98f', 8, 120, 300); },
    },

    belaz: { // карьерный самосвал: ездит по уступу; разворачивается кормой к герою, поднимает кузов и вываливает глыбы
      w: 96, h: 58, hp: 5, pts: 500, heavy: true, hitColor: '#ffd76a', deathColor: '#f2b705',
      init(e, api) { e.state = 'drive'; e.tilt = 0; e.act = 0; e.wr = 0; e.cd = api.rand(1.2, 2.2); },
      bodybox(e) { return { x: e.x + 4, y: e.y + 8, w: e.w - 8, h: e.h - 8 }; },
      update(e, dt, api) {
        const dx = api.dx(e), P = api.player;
        if (e.state === 'drive') {
          const x0 = e.x; api.patrol(e, 50, dt); e.wr += Math.abs(e.x - x0) / 16;
          e.tilt = Math.max(0, e.tilt - dt * 1.4);
          const roof = api.platforms.some(p => p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y > e.y - 50); // под конвейером кузов не поднять
          if ((e.cd -= dt) <= 0 && e.tilt === 0 && !roof && Math.abs(dx) < 330 && Math.abs(P.y + P.h - e.y - e.h) < 160) {
            e.state = 'raise'; e.act = 0.8; e.dir = dx > 0 ? -1 : 1; // кормой к герою
          }
        } else if (e.state === 'raise') { // предупреждение: мигает красный маячок, кузов медленно поднимается
          e.act -= dt; e.tilt = Math.min(0.62, e.tilt + dt * 0.62 / 0.8);
          if (e.act <= 0) { dumpRocks(e, api); e.state = 'hold'; e.act = 0.6; }
        } else if ((e.act -= dt) <= 0) { e.state = 'drive'; e.cd = api.rand(2.6, 3.8); }
      },
      draw(e, ctx) {
        const t = e.t, raising = e.state === 'raise', bob = e.state === 'drive' ? Math.sin(t * 10) * 0.7 : 0;
        ctx.fillStyle = 'rgba(70,40,20,.3)'; ctx.fillRect(-46, -2, 92, 2);
        ctx.fillStyle = '#3b3632'; ctx.fillRect(-46, -31 + bob, 90, 7); // рама
        if (e.tilt > 0.02) { // гидроцилиндр подъёма
          const ex = -40 + 34 * Math.cos(e.tilt), ey = -30 + bob - 34 * Math.sin(e.tilt);
          ctx.strokeStyle = '#8f959c'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -27 + bob); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.strokeStyle = '#dde1e6'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-4, -28 + bob); ctx.lineTo(ex, ey); ctx.stroke();
        }
        ctx.save(); ctx.translate(-40, -30 + bob); ctx.rotate(-e.tilt); // кузов вращается вокруг заднего шарнира
        const sl = e.tilt * 18; // порода сползает к корме
        ctx.fillStyle = '#8c8894'; circle(ctx, 8 - sl, -26, 6); circle(ctx, 30 - sl, -28, 7);
        ctx.fillStyle = '#a67c56'; circle(ctx, 19 - sl, -28, 6); circle(ctx, 42 - sl, -27, 6);
        ctx.fillStyle = '#f2b705'; path(ctx, BODY); ctx.fill();
        ctx.strokeStyle = '#8a6400'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#d39a00'; for (let x = 4; x < 54; x += 12) ctx.fillRect(x, -21, 3, 19); // рёбра жёсткости
        ctx.fillStyle = '#b98700'; ctx.fillRect(-9, -25, 67, 3);
        if (e.hp < e.maxHp) { // вмятины от ударов
          ctx.strokeStyle = '#4a3a10'; ctx.lineWidth = 1.5; ctx.beginPath();
          for (let i = 0; i < e.maxHp - e.hp; i++) { ctx.moveTo(8 + i * 10, -18); ctx.lineTo(12 + i * 10, -11); ctx.lineTo(9 + i * 10, -5); }
          ctx.stroke();
        }
        const on = raising ? (t * 10) % 1 < 0.5 : (t * 1.5) % 1 < 0.3; // маячок на козырьке
        if (on) { ctx.fillStyle = raising ? 'rgba(255,60,40,.4)' : 'rgba(255,190,40,.35)'; circle(ctx, 70, -29, raising ? 9 : 6); }
        ctx.fillStyle = on ? (raising ? '#ff3b30' : '#ffc12e') : '#7a4a10'; ctx.fillRect(67.5, -31, 5, 4);
        ctx.restore();
        ctx.fillStyle = '#e8ad00'; ctx.fillRect(16, -51, 20, 17); // кабина под козырьком
        ctx.fillStyle = '#1f2a33'; path(ctx, [21, -49, 35, -46, 35, -37, 21, -37]); ctx.fill();
        ctx.fillStyle = '#8fd0ea'; path(ctx, [23, -47, 33, -44.5, 33, -39, 23, -39]); ctx.fill();
        ctx.fillStyle = '#4a4540'; ctx.fillRect(37, -52, 3, 16); // выхлопная труба и дым
        ctx.fillStyle = 'rgba(80,76,72,.45)';
        for (let j = 0; j < 3; j++) { const k = frac(t * (raising ? 1.8 : 0.9) + j / 3); circle(ctx, 38.5 - k * 8, -55 - k * 16, 2 + k * 4); }
        ctx.fillStyle = '#f2b705'; ctx.fillRect(18, -36, 29, 12); // капот
        ctx.fillStyle = '#2d2a26'; ctx.fillRect(42, -34, 5, 9);
        ctx.fillStyle = '#6b6258'; ctx.fillRect(42, -32, 5, 1); ctx.fillRect(42, -29, 5, 1);
        ctx.fillStyle = raising ? '#ff5a3c' : '#fff3b0'; circle(ctx, 43.5, -38.5, 2.6); // фара-«глаз» и насупленная бровь
        ctx.strokeStyle = '#26221f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(38.5, -43.5); ctx.lineTo(47.5, -40.5); ctx.stroke();
        for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#1d1d1d' : '#f2b705'; ctx.fillRect(37 + i * 2.8, -24, 2.8, 4); } // полосатый бампер
        ctx.strokeStyle = '#3a3632'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(40, -20); ctx.lineTo(34, -36); // лестница в кабину
        for (let i = 1; i < 4; i++) { ctx.moveTo(40 - i * 1.5 - 2, -20 - i * 4); ctx.lineTo(40 - i * 1.5 + 2, -20 - i * 4); }
        ctx.stroke();
        ctx.strokeStyle = '#c99400'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-24, -16, 19, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); // крылья
        ctx.beginPath(); ctx.arc(26, -16, 19, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
        wheel(ctx, -24, -16, e.wr); wheel(ctx, 26, -16, e.wr);
      },
      onDeath(e, api) { const cx = e.x + e.w / 2, cy = e.y + e.h / 2; api.burst(cx, cy, '#8c8894', 14, 240, 800); api.burst(cx, cy - 10, '#3b3632', 8, 200, 600); },
    },

    blastdrone: { // дрон-взрывник: подлетает сверху, мигает красным 0,8 с и роняет шашку (её можно отбить рейкой обратно)
      w: 36, h: 18, hp: 1, pts: 150, flip: false, hitColor: '#ffd76a', deathColor: '#ff8a1f',
      init(e) { e.baseY = e.y; e.homeX = e.x; e.state = 'fly'; e.vx = 0; e.arm = 0; e.reload = 0; e.carry = true; },
      update(e, dt, api) {
        const dx = api.dx(e), P = api.player;
        e.y = e.baseY + Math.sin(e.t * 2.6) * 5;
        if (e.state === 'fly') {
          const want = Math.abs(dx) < 340 && P.y > e.y ? api.clamp(dx * 1.6, -100, 100) : Math.sin(e.t * 0.8) * 40;
          e.vx += (want - e.vx) * Math.min(1, dt * 3);
          if (!e.carry && (e.reload -= dt) <= 0) e.carry = true;
          if (e.carry && (e.cd -= dt) <= 0 && Math.abs(dx) < 40 && P.y > e.y + e.h) { e.state = 'arm'; e.arm = 0.8; }
        } else { // отсчёт: зависает и мигает, затем сброс
          e.vx *= Math.max(0, 1 - dt * 6);
          if ((e.arm -= dt) <= 0) {
            api.shoot({ x: e.x + e.w / 2, y: e.y + e.h + 7, w: 10, h: 14, vx: e.vx * 0.5, vy: 40, spin: 2.5, color: '#d32f2f',
              draw: (p, c, a) => drawStick(c, true, a.now), reflectable: true, pts: 20, source: e, onLand: dynLand, update: dynHit });
            e.state = 'fly'; e.carry = false; e.reload = 1.4; e.cd = api.rand(1.6, 2.4);
          }
        }
        e.x = api.clamp(e.x + e.vx * dt, e.homeX - 280, e.homeX + 280);
      },
      draw(e, ctx, api) {
        const arming = e.state === 'arm', blink = arming ? Math.floor(e.t * 14) % 2 === 0 : Math.sin(e.t * 5) > 0.6;
        if (arming) { // прицел на земле: пунктир вниз и мигающее кольцо
          const gy = surfaceAt(api, e.x + e.w / 2, e.y + e.h); // кольцо — там, куда шашка действительно упадёт
          if (gy !== null) {
            const d = gy - (e.y + e.h), r = 10 + 8 * (e.arm / 0.8);
            ctx.fillStyle = 'rgba(255,50,40,.5)'; for (let y = 16; y < d - 8; y += 10) ctx.fillRect(-1, y, 2, 5);
            ctx.strokeStyle = blink ? 'rgba(255,40,30,.95)' : 'rgba(255,40,30,.45)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(0, d - 1, r, 3.5, 0, 0, TAU); ctx.moveTo(-r - 8, d - 1); ctx.lineTo(-r + 3, d - 1); ctx.moveTo(r - 3, d - 1); ctx.lineTo(r + 8, d - 1); ctx.stroke();
          }
        }
        ctx.fillStyle = '#2e3138'; ctx.fillRect(-19, -15, 38, 3); ctx.fillRect(-17, -19, 3, 5); ctx.fillRect(14, -19, 3, 5); // рама
        ctx.fillStyle = 'rgba(235,240,245,.75)';
        for (const rx of [-15.5, 15.5]) { ctx.beginPath(); ctx.ellipse(rx, -20, 9 * Math.abs(Math.sin(e.t * 43)) + 3, 1.6, 0, 0, TAU); ctx.fill(); }
        ctx.fillStyle = '#ff8f1f'; rrect(ctx, -10, -17, 20, 11, 3); // корпус в полосах опасности
        ctx.strokeStyle = '#1f1f22'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#1f1f22'; for (let i = -1; i < 2; i++) { path(ctx, [-2 + i * 7, -17, 1.5 + i * 7, -17, -2.5 + i * 7, -6, -6 + i * 7, -6]); ctx.fill(); }
        if (blink) { ctx.fillStyle = 'rgba(255,40,30,.4)'; circle(ctx, 0, -20, arming ? 8 : 4.5); }
        ctx.fillStyle = blink ? '#ff2d20' : '#6a1410'; ctx.fillRect(-2, -21, 4, 3);
        ctx.fillStyle = '#111'; circle(ctx, 0, -5, 2.4); ctx.fillStyle = '#7ec8ff'; ctx.fillRect(0, -6, 1, 1); // камера
        ctx.strokeStyle = '#2e3138'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-5, -6); ctx.lineTo(-6, 0); ctx.moveTo(5, -6); ctx.lineTo(6, 0); ctx.stroke();
        if (e.carry) { ctx.save(); ctx.translate(0, 6); drawStick(ctx, arming, api.now); ctx.restore(); }
      },
      onDeath(e, api) { boom(e.x + e.w / 2, e.y + e.h / 2, api); },
    },

    signalman: { // сигнальщик взрывников с ракетницей: на верхних ярусах ведёт героя лучом ~0,65 с, 0,4 с держит прицел — и стреляет
      w: 20, h: 44, hp: 2, pts: 250, hitColor: '#ffd76a', deathColor: '#e53935',
      init(e) { e.state = 'walk'; e.aim = 0; e.tx = 0; e.ty = 0; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e), px = P.x + P.w / 2, py = P.y + P.h * 0.45;
        if (e.state === 'walk') {
          api.patrol(e, 20, dt);
          e.cd -= dt;
          const cx = e.x + e.w / 2, sy = e.y + e.h - api.camY; // прицеливание — только в кадре: луч должен быть виден
          const seen = cx > api.camX + 10 && cx < api.camX + api.W - 10 && sy > 40 && sy < api.H;
          if (e.cd <= 0 && seen && Math.abs(dx) < 380 && py > e.y - 30 && py - e.y < 380) {
            e.state = 'aim'; e.aim = SIG_AIM; e.dir = Math.sign(dx) || e.dir; e.tx = px; e.ty = py;
          }
        } else if (e.state === 'aim') {
          e.aim -= dt;
          if (e.aim > SIG_LOCK) { // ведёт цель; последние 0,4 с прицел неподвижен — можно уйти с линии
            e.dir = Math.sign(dx) || e.dir; const k = Math.min(1, dt * 7);
            e.tx += (px - e.tx) * k; e.ty += (py - e.ty) * k;
          }
          if (e.aim <= 0) { fireFlare(e, api); e.state = 'recoil'; e.aim = 0.5; }
        } else if ((e.aim -= dt) <= 0) { e.state = 'walk'; e.cd = api.rand(2.2, 3.4); }
      },
      draw(e, ctx, api) {
        const aiming = e.state === 'aim', walk = e.state === 'walk', sw = walk ? Math.sin(e.t * 7) * 0.45 : 0;
        const bx = e.x + e.w / 2, by = e.y + e.h;
        let ang = 0.9; // рука с ракетницей: в покое опущена, при прицеливании — на цель
        const mx = 2, my = SIG_MY; // плечо
        if (aiming || e.state === 'recoil') ang = Math.atan2(e.ty - (by + my), (e.tx - bx) * e.dir - mx);
        if (e.state === 'recoil') ang -= 0.35 * (e.aim / 0.5);
        if (aiming) { // лазерный целеуказатель: тонкий — пока ведёт, яркий и мигающий — когда прицел зафиксирован
          const lock = e.aim <= SIG_LOCK, lx = (e.tx - bx) * e.dir, ly = e.ty - by, d = Math.hypot(lx - mx, ly - my) || 1, L = Math.min(d + 60, 460);
          const ux = (lx - mx) / d, uy = (ly - my) / d;
          ctx.strokeStyle = lock ? (Math.floor(e.t * 16) % 2 ? 'rgba(255,40,30,.95)' : 'rgba(255,120,90,.7)') : 'rgba(255,60,40,.4)';
          ctx.lineWidth = lock ? 2 : 1; ctx.setLineDash(lock ? [] : [6, 5]);
          ctx.beginPath(); ctx.moveTo(mx + ux * SIG_MX, my + uy * SIG_MX); ctx.lineTo(mx + ux * L, my + uy * L); ctx.stroke(); ctx.setLineDash([]);
          const r = lock ? 7 : 7 + 9 * (e.aim - SIG_LOCK) / (SIG_AIM - SIG_LOCK);
          ctx.beginPath(); ctx.arc(lx, ly, r, 0, TAU); ctx.moveTo(lx - r - 4, ly); ctx.lineTo(lx + r + 4, ly); ctx.moveTo(lx, ly - r - 4); ctx.lineTo(lx, ly + r + 4); ctx.stroke();
          if (lock) api.text('!', 0, -54, 15, '#ff3b30');
        }
        ctx.strokeStyle = '#34363d'; ctx.lineWidth = 5; ctx.lineCap = 'round'; // ноги
        for (const k of [sw, -sw]) { ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(Math.sin(k) * 9, -3); ctx.stroke(); }
        ctx.fillStyle = '#1d1d1d'; for (const k of [sw, -sw]) ctx.fillRect(Math.sin(k) * 9 - 3, -4, 8, 4);
        const fw = Math.sin(e.t * (walk ? 6 : 12)) * 3; // красный флажок в другой руке
        ctx.fillStyle = '#8a6440'; ctx.fillRect(-11, -46, 2, 22);
        ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.moveTo(-11, -46); ctx.quadraticCurveTo(-18, -44 + fw, -25, -43 + fw); ctx.lineTo(-11, -36); ctx.fill();
        ctx.strokeStyle = '#3b3f47'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(-3, -32); ctx.lineTo(-9, -30); ctx.stroke();
        ctx.fillStyle = '#3b3f47'; ctx.fillRect(-7, -35, 14, 18);                           // куртка
        ctx.fillStyle = '#e53935'; ctx.fillRect(-7, -34, 14, 13);                           // красный жилет взрывника
        ctx.fillStyle = '#f4f1ea'; ctx.fillRect(-7, -27, 14, 2); ctx.fillRect(-7, -23, 14, 1.5);
        ctx.fillStyle = '#26221f'; ctx.fillRect(-7, -21, 14, 2.5);                          // пояс с подсумком
        ctx.fillStyle = '#f1c27d'; circle(ctx, 1, -40, 5.5);                                // лицо
        ctx.fillStyle = '#222'; ctx.fillRect(3.5, -42, 2, 2);
        ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(2, -44.5); ctx.lineTo(6.5, -43); ctx.stroke();
        ctx.fillStyle = '#f2b705'; ctx.beginPath(); ctx.arc(1, -43, 6.5, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -44, 14, 2); // жёлтая каска
        ctx.fillStyle = '#e53935'; ctx.fillRect(-1, -49, 3, 2);
        ctx.save(); ctx.translate(2, -31); ctx.rotate(ang);                                   // рука и ракетница
        ctx.strokeStyle = '#3b3f47'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 0); ctx.stroke();
        ctx.fillStyle = '#f1c27d'; circle(ctx, 11, 0, 2);
        ctx.fillStyle = '#ff6d1a'; ctx.fillRect(10, -3, 9, 5); ctx.fillStyle = '#26221f'; ctx.fillRect(10, 1, 3, 4); ctx.fillRect(18, -3, 2, 5);
        if (e.state === 'recoil' && e.aim > 0.35) { ctx.fillStyle = '#fff1b8'; circle(ctx, 22, -0.5, 4); ctx.fillStyle = 'rgba(200,190,180,.6)'; circle(ctx, 26, -3, 4); }
        ctx.restore();
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2, e.y + 10, '#ff5a3c', 10, 200, 300); },
    },

    scaler: { // оборщик на страховке: висит на верёвке, сползает к герою, 0,9 с трясёт верёвку (тень внизу) и спрыгивает с ломом
      w: 22, h: 34, hp: 2, pts: 200, hitColor: '#ffd76a', deathColor: '#ff8f1f',
      init(e) { e.homeY = e.y; e.state = 'hang'; e.vy = 0; e.act = 0; e.floor = null; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e), below = P.y > e.y + e.h - 16;
        if (e.state === 'hang') {
          e.y = e.homeY;
          if (Math.abs(dx) < 260 && below) { // сползает вдоль верёвки в сторону героя, не покидая свой отрезок
            e.x = api.clamp(e.x + api.clamp(dx * 1.5, -38, 38) * dt, e.minX, e.maxX - e.w);
            if (Math.abs(dx) > 6) e.dir = Math.sign(dx);
          }
          if ((e.cd -= dt) <= 0 && Math.abs(dx) < 44 && below) {
            const f = surfaceAt(api, e.x + e.w / 2, e.y + e.h);
            if (f !== null && f - e.y - e.h > 24) { e.state = 'warn'; e.act = 0.9; e.floor = f; e.lockX = e.x; }
            else e.cd = 0.5;
          }
        } else if (e.state === 'warn') {
          e.x = e.lockX; // точка приземления уже показана — не смещается (и от удара тоже)
          if (Math.random() < dt * 10) api.burst(e.x + e.w / 2 + api.rand(-8, 8), e.y + 4, '#c9a27a', 1, 40, 700); // сыплются камешки
          if ((e.act -= dt) <= 0) { e.state = 'drop'; e.vy = 60; }
        } else if (e.state === 'drop') {
          e.x = e.lockX;
          e.vy = Math.min(620, e.vy + 1500 * dt); e.y += e.vy * dt;
          if (e.y + e.h >= e.floor) {
            e.y = e.floor - e.h; e.state = 'down'; e.act = 1.3;
            api.burst(e.x + e.w / 2, e.floor, '#d8b98f', 12, 140, 500); api.shake(2.5);
          }
        } else if (e.state === 'down') { // стоит на уступе и машет ломом
          if (Math.abs(dx) > 6) e.dir = Math.sign(dx);
          const f = surfaceAt(api, e.x + e.w / 2, e.y + e.h - 4); // отбросило с края мостков — сразу наверх, не висит в воздухе
          if ((e.act -= dt) <= 0 || f === null || Math.abs(f - e.y - e.h) > 2) e.state = 'up';
        } else { // подтягивается по верёвке обратно
          e.y = Math.max(e.homeY, e.y - 85 * dt);
          if (e.y <= e.homeY) { e.state = 'hang'; e.cd = api.rand(1.4, 2.4); }
        }
      },
      draw(e, ctx, api) {
        const st2 = e.state, bot = e.y + e.h, shakeX = st2 === 'warn' ? Math.sin(e.t * 50) * 1.8 : 0;
        if ((st2 === 'warn' || st2 === 'drop') && e.floor !== null) { // тень и мигающее кольцо там, куда он приземлится
          const d = e.floor - bot, k = st2 === 'warn' ? 1 - e.act / 0.9 : 1;
          ctx.fillStyle = `rgba(60,28,10,${(0.2 + 0.3 * k).toFixed(2)})`; ctx.beginPath(); ctx.ellipse(0, d, 8 + 8 * k, 2.5 + 1.5 * k, 0, 0, TAU); ctx.fill();
          if (Math.floor(e.t * 10) % 2) { ctx.strokeStyle = 'rgba(255,60,30,.85)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, d, 18, 4.5, 0, 0, TAU); ctx.stroke(); }
        }
        const ropeTop = Math.min(api.camY, e.homeY) - 20 - bot; // верёвка уходит за верх кадра — к анкеру на бровке
        ctx.strokeStyle = '#e8d9b0'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(shakeX * 2, ropeTop);
        if (st2 === 'down') ctx.quadraticCurveTo(-14, (ropeTop - 30) / 2, 0, -30); else ctx.lineTo(shakeX, -30);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(150,120,70,.8)'; ctx.lineWidth = 0.8; ctx.stroke();
        if (st2 === 'warn') api.text('!', 8, -46, 15, '#ff3b30');
        ctx.translate(shakeX, 0);
        const hang = st2 === 'hang' || st2 === 'warn' || st2 === 'up', kick = hang ? Math.sin(e.t * 2.2) * 0.25 : 0;
        ctx.strokeStyle = '#2f5d8a'; ctx.lineWidth = 5; ctx.lineCap = 'round'; // ноги: в висе упираются вперёд, как в откос
        if (hang) { ctx.beginPath(); ctx.moveTo(-1, -16); ctx.lineTo(7, -9 + kick * 6); ctx.lineTo(10, -2 + kick * 6); ctx.moveTo(1, -16); ctx.lineTo(4, -6 - kick * 5); ctx.lineTo(9, 0 - kick * 5); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(-2, -16); ctx.lineTo(-5, -2); ctx.moveTo(2, -16); ctx.lineTo(6, -2); ctx.stroke(); }
        ctx.fillStyle = '#1d1d1d'; if (hang) { ctx.fillRect(8, -3 + kick * 6, 6, 4); ctx.fillRect(7, -2 - kick * 5, 6, 4); } else { ctx.fillRect(-8, -4, 7, 4); ctx.fillRect(3, -4, 8, 4); }
        ctx.fillStyle = '#2f5d8a'; ctx.fillRect(-6, -30, 12, 15);                              // спецовка
        ctx.fillStyle = '#ff8f1f'; ctx.fillRect(-6, -29, 12, 10); ctx.fillStyle = '#f4f1ea'; ctx.fillRect(-6, -24, 12, 1.5); // жилет
        ctx.fillStyle = '#26221f'; ctx.fillRect(-7, -19, 14, 3); ctx.fillRect(-1, -30, 2, 11);   // страховочная обвязка
        ctx.fillStyle = '#c0c4c8'; ctx.fillRect(-1.5, -32, 3, 3);                               // карабин
        ctx.fillStyle = '#d9956a'; circle(ctx, 1, -35, 4.8);
        ctx.fillStyle = '#222'; ctx.fillRect(3, -37, 2, 2);
        ctx.fillStyle = '#f7f7f7'; ctx.beginPath(); ctx.arc(1, -37.5, 5.6, Math.PI, 0); ctx.fill(); ctx.fillRect(-5, -38.5, 12, 2); // белая каска
        const la = st2 === 'down' ? -0.6 + Math.sin(e.t * 9) * 0.9 : st2 === 'drop' ? -1.9 : -0.9 + Math.sin(e.t * 1.6) * 0.15; // лом
        ctx.save(); ctx.translate(3, -25); ctx.rotate(la);
        ctx.fillStyle = '#4f5359'; ctx.fillRect(-4, -1.2, 26, 2.4); ctx.fillRect(20, -3, 2.4, 4);
        ctx.restore();
        ctx.strokeStyle = '#2f5d8a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(3 + Math.cos(la) * 4, -25 + Math.sin(la) * 4); ctx.stroke();
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2, e.y + 12, '#e8d9b0', 8, 160, 400); },
    },
  };

  // ---------- механика участка: лента конвейера и камнепад с борта ----------
  function update(dt, api) {
    const P = api.player;
    if (P.onGround) {
      for (const p of api.platforms) if (p.tier === 1 && !p.tower && Math.abs(P.y + P.h - p.y) < 1.5 && P.x + P.w > p.x && P.x < p.x + p.w) { P.x += BELT * dt; break; }
      // генератор иногда ставит соседние уступы с перепадом 1–7 ед. (зажим по groundRange): о такой «ступеньку» герой
      // упирается, как в стену. Приподнимаем его на неё, как на бордюр
      const feet = P.y + P.h;
      for (const s of api.solids) {
        if (s.y >= feet || s.y < feet - 8) continue;
        if (P.face > 0 ? Math.abs(P.x + P.w - s.x) < 0.01 : Math.abs(P.x - s.x - s.w) < 0.01) { P.y = s.y - P.h; break; }
      }
    }
    for (let i = st.flashes.length - 1; i >= 0; i--) if ((st.flashes[i].t -= dt) <= 0) st.flashes.splice(i, 1);
    for (let i = st.warns.length - 1; i >= 0; i--) {
      const w = st.warns[i];
      w.t -= dt;
      if (!w.p && w.t <= 0) w.p = api.shoot({ x: w.x, y: Math.min(-14, api.camY - 14), w: 14, h: 12, vy: 140, spin: api.rand(-7, 7), color: '#9c8672', draw: drawChunk, pts: 15, gy: w.gy, onLand: wallRockLand, update: wallRockFall });
      if ((w.p && w.p.dead) || w.t < -2) st.warns.splice(i, 1);
    }
    if ((st.pebT -= dt) > 0) return;
    st.pebT = 0.6; // неудачное место — попробуем чуть позже
    const x = P.x + P.w / 2 + P.vx * api.rand(0.5, 1.3) + api.rand(-30, 50), gy = api.groundAt(x);
    if (P.x > 600 && api.progress < 0.95 && gy !== null && st.warns.length < 3) {
      st.warns.push({ x, gy: surfaceAt(api, x, P.y + P.h - 4), t: WARN, p: null }); // камень ляжет на ту опору, где герой (лента, мостки или земля)
      st.pebT = api.rand(3.4, 5.6) - api.progress * 1.2;
    }
  }

  function drawForeground(ctx, api) {
    const { now } = api, top = Math.min(0, api.camY) + 34; // от верхнего края кадра (камера могла подняться)
    for (const w of st.warns) { // струйка песка сыплется с борта над местом будущего камнепада, наверху клубится пыль
      if (w.p) continue;
      ctx.fillStyle = 'rgba(214,176,128,.75)'; circle(ctx, w.x, top, 5 + Math.sin(now * 17) * 1.5); circle(ctx, w.x + 5, top + 2, 3.5);
      ctx.fillStyle = '#6e4526';
      for (let j = 0; j < 9; j++) ctx.fillRect(w.x - 1.5 + Math.sin(j * 2.1 + now * 9) * 2.5, top + ((now * 240 + j * 13) % 116), 3, 3);
    }
    for (const f of st.flashes) { // вспышки взрывов
      const k = f.t / 0.35;
      ctx.globalAlpha = k * 0.5; ctx.fillStyle = '#ff8a1f'; circle(ctx, f.x, f.y - 6, 14 + (1 - k) * 34);
      ctx.globalAlpha = k * 0.85; ctx.fillStyle = '#fff1b8'; circle(ctx, f.x, f.y - 6, 8 + (1 - k) * 22);
    }
    ctx.globalAlpha = 1;
  }

  function drawOverlay(ctx, api) { // пылинки висят в воздухе и медленно дрейфуют
    const { W, now, hash, camX } = api, span = W + 40;
    ctx.fillStyle = 'rgba(246,228,196,.6)';
    for (let i = 0; i < 18; i++) {
      const h1 = hash(i * 7 + 1), h2 = hash(i * 13 + 5), s = 1.2 + h1 * 1.8;
      const x = ((h1 * 997 + now * (8 + h2 * 20) - camX * (0.3 + h2 * 0.5)) % span + span) % span - 20;
      ctx.fillRect(x, 40 + h2 * 270 + Math.sin(now * (0.7 + h1) + i) * 8, s, s);
    }
  }

  registerTheme({
    index: 5, id: 'quarry', hero: { weapon: 'slam' },
    title: 'Карьер', subtitle: 'Открытая добыча: уступы, БелАЗы и взрывные работы',
    accent: '#ff9f43', dust: '#d8b98f',
    gen: { length: 3900, weights: { pit: 22, platforms: 18, step: 22, obstacle: 14, flat: 24 }, obstacleH: 32, obstacleW: 48 },
    decor: ['pole', 'sign', 'barrel', 'pile', 'pile', 'cone', 'cone', 'bucket'],
    enemies,
    enemyTable: [
      { type: 'boulder', where: 'ground', weight: 3 },
      { type: 'blastdrone', where: 'air', weight: 2, from: 0.1 },
      { type: 'belaz', where: 'ground', weight: 2, from: 0.25 },
      { type: 'scaler', where: 'air', weight: 2, from: 0.2 },
      { type: 'signalman', where: 'upper', weight: 3 },
    ],
    init() { st.pebT = 6; st.warns.length = 0; st.flashes.length = 0; },
    update, drawBackground, drawGround, drawPit, drawPlatform, drawObstacle, drawDecor, drawFinish, drawLadder, drawForeground, drawOverlay,
  });
})();
