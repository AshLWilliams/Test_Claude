'use strict';
// Участок 8 — небоскрёб: монтаж стального каркаса на высоте 200 метров. Закат, море облаков под ногами,
// крошечный город далеко внизу, соседние высотки с башенными кранами. Под каждым перекрытием — открытый каркас
// и пустота. Сверху время от времени срываются балки. Контракт темы: см. THEMES.md, образец — 01-city.js.
(() => {
  // ---------- общее ----------
  const TAU = Math.PI * 2;
  const SLAB = 24;     // толщина перекрытия: бетон по профнастилу
  const FLOOR = 46;    // высота этажа каркаса под перекрытием
  const COL = 72;      // шаг колонн каркаса
  const WARN = 1.25;   // сколько секунд горит метка перед тем, как балка сорвётся
  const BEAM_W = 58;   // длина падающей балки
  const st = { fallT: 6, warns: [], landed: [], wind: 0.6, sky: null, skyCtx: null }; // состояние участка
  const PUFFS = [[-40, 4, 16], [-20, -4, 22], [4, -10, 26], [28, -3, 20], [48, 5, 14]]; // «клубы» кучевого облака

  const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
  const line = (ctx, x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const poly = (ctx, p) => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); ctx.closePath(); };
  const rr = (ctx, x, y, w, h, r) => { // скруглённый прямоугольник (без ctx.roundRect — для старых телефонов)
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  };
  const blink = (now, period, phase, on) => ((now + phase) % period) < on;

  function cloud(ctx, cx, cy, s) { // кучевое облако ниже героя: тень снизу, розовые макушки в лучах заката
    ctx.fillStyle = '#b07fa8'; ctx.beginPath(); ctx.ellipse(cx + 5 * s, cy + 8 * s, 58 * s, 9 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d9a0bf'; ctx.beginPath();
    for (const [dx, dy, r] of PUFFS) { ctx.moveTo(cx + (dx + r) * s, cy + dy * s); ctx.arc(cx + dx * s, cy + dy * s, r * s, 0, TAU); }
    ctx.fill();
    ctx.fillStyle = '#ffd2c2'; ctx.beginPath();
    for (const [dx, dy, r] of PUFFS) { const x = cx + (dx + r * 0.28) * s, y = cy + (dy - r * 0.38) * s; ctx.moveTo(x + r * 0.58 * s, y); ctx.arc(x, y, r * 0.58 * s, 0, TAU); }
    ctx.fill();
  }

  function ibeam(ctx, x, y, w, h) { // двутавр в красном грунте: полки, стенка, рёбра жёсткости и болты
    ctx.fillStyle = '#c24f37'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#f39068'; ctx.fillRect(x, y, w, 2.5);              // верхняя полка ловит закат
    ctx.fillStyle = '#8a3324'; ctx.fillRect(x, y + h - 2.5, w, 2.5);    // нижняя полка
    ctx.fillStyle = '#a3402b'; ctx.fillRect(x, y + 2.5, w, 1.2);
    ctx.fillStyle = '#9c3c2a'; for (let bx = x + 26; bx < x + w - 12; bx += 40) ctx.fillRect(bx, y + 3.5, 2, h - 6);
    ctx.fillStyle = '#f6c9b2';
    for (const bx of [x + 4, x + w - 9]) { ctx.fillRect(bx, y + 4, 2, 2); ctx.fillRect(bx + 3, y + 4, 2, 2); ctx.fillRect(bx, y + h - 5.5, 2, 2); ctx.fillRect(bx + 3, y + h - 5.5, 2, 2); }
  }

  // ---------- фон: закат над морем облаков ----------
  function drawNeighbour(ctx, x, top, bw, i, api) { // соседняя высотка: внизу стекло, наверху голый каркас и башенный кран
    const { H, now, hash } = api, open = 45;
    ctx.fillStyle = '#3b2c5a'; ctx.fillRect(x, top + open, bw, H - top - open);
    ctx.fillStyle = '#6c436c'; poly(ctx, [x + bw * 0.55, top + open, x + bw * 0.85, top + open, x + bw * 0.4, H, x + bw * 0.1, H]); ctx.fill(); // отражение заката
    ctx.fillStyle = '#2e2248'; ctx.beginPath(); for (let y = top + open + 8; y < H; y += 9) ctx.rect(x, y, bw, 1.5); ctx.fill();
    ctx.fillStyle = '#e88a8e'; ctx.fillRect(x + bw - 2, top + open, 2, H - top - open); // грань в лучах солнца
    ctx.fillStyle = '#2b203f'; ctx.beginPath();
    for (let f = 0; f <= 3; f++) ctx.rect(x, top + f * 15, bw, 2.5);
    for (let c = 0; c <= 5; c++) ctx.rect(x + c * (bw - 3) / 5, top, 3, open);
    ctx.fill();
    for (let k = 0; k < 2; k++) { // вспышки сварки на каркасе
      if (hash(i * 31 + k * 7 + Math.floor(now * 9)) < 0.55) continue;
      const wx = x + 8 + hash(i * 13 + k) * (bw - 16), wy = top + 6 + hash(i * 17 + k) * (open - 12);
      ctx.fillStyle = 'rgba(170,220,255,.45)'; circle(ctx, wx, wy, 4.5);
      ctx.fillStyle = '#fff'; ctx.fillRect(wx - 1, wy - 1, 2, 2);
      ctx.fillStyle = '#ffd36a'; for (let j = 0; j < 3; j++) ctx.fillRect(wx - 3 + j * 3, wy + 3 + ((now * 60 + j * 5) % 14), 1, 1.5);
    }
    // башенный кран на макушке: решётчатая башня, стрела, противовес, тележка с крюком
    const cx = x + bw * 0.35, mt = top - 72, jib = 110 + hash(i + 205) * 50;
    ctx.strokeStyle = '#2b203f'; ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - 3, mt, 6, 72);
    ctx.beginPath();
    for (let y = mt; y < top - 6; y += 8) { ctx.moveTo(cx - 3, y); ctx.lineTo(cx + 3, y + 8); }
    for (let x2 = cx - 46; x2 < cx + jib - 6; x2 += 8) { ctx.moveTo(x2, mt - 2); ctx.lineTo(x2 + 8, mt + 3); }
    ctx.moveTo(cx - 48, mt - 2); ctx.lineTo(cx + jib, mt - 2); ctx.moveTo(cx - 48, mt + 3); ctx.lineTo(cx + jib - 4, mt + 3);
    ctx.moveTo(cx - 48, mt - 2); ctx.lineTo(cx, mt - 18); ctx.lineTo(cx + jib * 0.7, mt - 2); ctx.moveTo(cx, mt - 18); ctx.lineTo(cx, mt);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,160,110,.75)'; ctx.lineWidth = 1; line(ctx, cx - 48, mt - 2.5, cx + jib, mt - 2.5); // блик заката на стреле
    ctx.fillStyle = '#2b203f'; ctx.fillRect(cx - 48, mt + 3, 15, 10);
    ctx.fillRect(cx + 3, mt + 3, 9, 8); ctx.fillStyle = '#ffcf8a'; ctx.fillRect(cx + 7, mt + 5, 4, 3);
    const tx = cx + 30 + (Math.sin(now * 0.25 + i) * 0.5 + 0.5) * (jib - 50), hl = 34 + hash(i + 206) * 36 + Math.sin(now * 0.4 + i) * 6;
    ctx.strokeStyle = '#2b203f'; line(ctx, tx, mt + 3, tx, mt + hl);
    ctx.fillStyle = '#2b203f'; ctx.fillRect(tx - 4, mt + 1, 8, 4); ctx.fillRect(tx - 3, mt + hl, 6, 5);
    if (blink(now, 1.4, hash(i) * 1.4, 0.5)) { ctx.fillStyle = '#ff3b3b'; circle(ctx, cx, mt - 19, 2); circle(ctx, cx + jib, mt - 3, 2); }
  }

  function drawBackground(ctx, api) {
    const { W, H, camX, hash, now } = api;
    if (st.skyCtx !== ctx) { // градиент неба создаём один раз
      const g = ctx.createLinearGradient(0, 0, 0, 236);
      g.addColorStop(0, '#1b1640'); g.addColorStop(0.35, '#4b2a6b'); g.addColorStop(0.72, '#c4587e'); g.addColorStop(1, '#ffb574');
      st.sky = g; st.skyCtx = ctx;
    }
    ctx.fillStyle = st.sky; ctx.fillRect(0, 0, W, 228); // ниже неба всё закрывает город
    const sx = W * 0.72 - camX * 0.01; // солнце садится в облака
    ctx.fillStyle = 'rgba(255,180,120,.24)'; circle(ctx, sx, 204, 66);
    ctx.fillStyle = '#ffe3a6'; circle(ctx, sx, 204, 32);

    // перистые облака высоко в небе
    let off = camX * 0.02 + now * 2, step = 260;
    ctx.fillStyle = 'rgba(255,165,190,.26)';
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off, y = 48 + hash(i + 40) * 70, w = 90 + hash(i + 41) * 110;
      ctx.beginPath(); ctx.ellipse(x, y, w / 2, 2.5 + hash(i + 42) * 2, 0, 0, TAU); ctx.ellipse(x + 34, y + 7, w / 3, 1.8, 0, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(40,20,55,.55)'; ctx.lineWidth = 1; // далёкая стая птиц
    for (let i = 0; i < 4; i++) {
      const bx = ((i * 211 + now * (14 + i * 3) - camX * 0.05) % (W + 80) + W + 80) % (W + 80) - 40, by = 84 + i * 15 + Math.sin(now + i) * 4, f = Math.sin(now * 8 + i * 2) * 2.2;
      ctx.beginPath(); ctx.moveTo(bx - 4, by - f); ctx.lineTo(bx, by); ctx.lineTo(bx + 4, by - f); ctx.stroke();
    }

    // дальний план: высотки в дымке, их подножия тонут в облаках
    off = camX * 0.05; step = 70;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      if (hash(i * 5 + 3) < 0.35) continue;
      const tw = 16 + hash(i + 7) * 20, x = i * step - off + hash(i + 9) * (step - tw), top = 80 + hash(i + 13) * 100;
      ctx.fillStyle = '#6a5590'; ctx.fillRect(x, top, tw, 232 - top);
      ctx.fillStyle = '#8a70a8'; ctx.fillRect(x + tw * 0.62, top, tw * 0.38, 232 - top);
      ctx.fillStyle = 'rgba(255,190,170,.22)'; ctx.beginPath(); for (let y = top + 6; y < 222; y += 9) ctx.rect(x + 2, y, tw - 4, 1.2); ctx.fill();
      ctx.fillStyle = '#6a5590'; ctx.fillRect(x + tw / 2 - 1, top - 12, 2, 12);
      if (blink(now, 1.6, hash(i) * 1.6, 0.35)) { ctx.fillStyle = '#ff4a3b'; circle(ctx, x + tw / 2, top - 13, 1.8); }
    }

    // далеко внизу — город в дымке: кварталы, огни улиц и река
    off = camX * 0.1; step = 26;
    const rows = [244, 262, 284, 312, 346];
    ctx.fillStyle = '#4a4378'; ctx.fillRect(0, 226, W, H - 226);
    ctx.fillStyle = '#5a5190'; for (const y of rows) ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = '#7f86c9'; ctx.fillRect(0, 296, W, 5);
    const i0 = Math.floor(off / step) - 1, i1 = (off + W) / step + 1;
    ctx.fillStyle = '#3d3668'; ctx.beginPath();
    for (let i = i0; i < i1; i++) for (let r = 0; r < 5; r++) {
      const hv = hash(i * 7 + r * 131); if (hv < 0.3) continue;
      const bh = 3 + r * 2.2 + hv * 4; ctx.rect(i * step - off + hash(i + r * 17) * 8, rows[r] - bh, 8 + hv * 12, bh);
    }
    ctx.fill();
    ctx.fillStyle = '#f0c486'; ctx.beginPath();
    for (let i = i0; i < i1; i++) for (let r = 0; r < 5; r++) {
      if (hash(i * 11 + r * 53) < 0.4) continue;
      const s = 1.3 + r * 0.3; ctx.rect(i * step - off + hash(i * 5 + r) * 20, rows[r] + 1, s, s);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(225,220,255,.7)'; // блики на реке
    for (let i = i0; i < i1; i++) if (hash(i * 3 + 900) > 0.6) ctx.fillRect(i * step - off + ((now * 6 + hash(i) * 20) % 20), 297 + hash(i + 901) * 3, 4, 1);

    // облачный вал на горизонте прячет подножия дальних башен
    off = camX * 0.07 + now * 1.5; step = 44;
    ctx.fillStyle = '#a97da6'; ctx.fillRect(0, 216, W, 16);
    ctx.fillStyle = '#c38dae'; ctx.beginPath();
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) { const x = i * step - off, r = 13 + hash(i + 60) * 13, cy = 219 - hash(i + 62) * 8; ctx.moveTo(x + r, cy); ctx.arc(x, cy, r, 0, TAU); }
    ctx.fill();
    ctx.fillStyle = '#f5b9a6'; ctx.beginPath();
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) { const x = i * step - off + 4, r = (13 + hash(i + 60) * 13) * 0.6, cy = 214 - hash(i + 62) * 8 - r * 0.4; ctx.moveTo(x + r, cy); ctx.arc(x, cy, r, 0, TAU); }
    ctx.fill();

    // средний план: соседние высотки с башенными кранами
    off = camX * 0.2; step = 340;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      if (hash(i + 200) < 0.2) continue;
      const bw = 80 + hash(i + 201) * 50;
      drawNeighbour(ctx, i * step - off + hash(i + 202) * (step - bw - 70), 118 + hash(i + 203) * 52, bw, i, api);
    }

    // море облаков под ногами — медленно плывёт
    off = camX * 0.33 + now * 4; step = 180;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 2; i++) {
      if (hash(i + 500) < 0.18) continue;
      cloud(ctx, i * step - off + hash(i + 501) * 60, 290 + hash(i + 502) * 42, 0.7 + hash(i + 503) * 0.6);
    }
    // быстрые клочья тумана ближе к нам
    off = camX * 0.6 + now * 9; step = 340;
    ctx.fillStyle = 'rgba(255,222,228,.33)';
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 2; i++) {
      ctx.beginPath(); ctx.ellipse(i * step - off + hash(i + 700) * 90, 316 + hash(i + 701) * 34, 70 + hash(i + 702) * 60, 6 + hash(i + 703) * 4, 0, 0, TAU); ctx.fill();
    }
  }

  // ---------- метки падающих балок и упавшие балки (рисуются на поверхности, под героем) ----------
  const R_FX = BEAM_W / 2 + 6; // полуширина метки и лежащей балки
  function drawSurfaceFx(x0, x1, y, ctx, api) { // каждая захватка рисует свою часть метки — соседняя плита на той же высоте её не закроет
    let any = false;
    for (const o of st.landed) if (Math.abs(o.y - y) <= 1 && o.x + R_FX > x0 && o.x - R_FX < x1) any = true;
    for (const o of st.warns) if (Math.abs(o.y - y) <= 1 && o.x + R_FX > x0 && o.x - R_FX < x1) any = true;
    if (!any) return;
    ctx.save(); ctx.beginPath(); ctx.rect(x0 - 0.5, 0, x1 - x0 + 1, y + 2); ctx.clip();
    for (const b of st.landed) {
      if (Math.abs(b.y - y) > 1 || b.x + R_FX < x0 || b.x - R_FX > x1) continue;
      ctx.globalAlpha = api.clamp((1.8 - b.t) / 0.6, 0, 1);
      ctx.save(); ctx.translate(b.x, y - 5); ctx.rotate(b.rot); ibeam(ctx, -BEAM_W / 2, -5, BEAM_W, 10); ctx.restore();
      ctx.globalAlpha = 1;
    }
    for (const w of st.warns) {
      if (Math.abs(w.y - y) > 1 || w.x + R_FX < x0 || w.x - R_FX > x1) continue;
      const k = w.p ? 1 : api.clamp(1 - w.t / WARN, 0, 1), fl = Math.floor(api.now * (w.p ? 16 : 7)) % 2, r = BEAM_W / 2 + 4;
      ctx.fillStyle = `rgba(30,10,35,${0.22 + 0.4 * k})`; ctx.beginPath(); ctx.ellipse(w.x, y - 1, 10 + (r - 10) * k, 2.5 + 2 * k, 0, 0, TAU); ctx.fill(); // тень растёт
      ctx.strokeStyle = fl ? '#ff3b30' : '#ffd23a'; ctx.lineWidth = 2; ctx.beginPath(); // уголки-скобы вокруг места падения
      ctx.moveTo(w.x - r, y - 8); ctx.lineTo(w.x - r, y - 1); ctx.lineTo(w.x - r + 8, y - 1);
      ctx.moveTo(w.x + r, y - 8); ctx.lineTo(w.x + r, y - 1); ctx.lineTo(w.x + r - 8, y - 1);
      ctx.stroke();
      ctx.fillStyle = fl ? '#ff3b30' : '#ffd23a'; poly(ctx, [w.x, y - 22, w.x - 7, y - 10, w.x + 7, y - 10]); ctx.fill();
      api.text('!', w.x, y - 11.5, 9, '#1d1a22');
    }
    ctx.restore();
  }

  // ---------- земля: перекрытие над пустотой ----------
  function edgeGuard(ctx, ex, y, d, now) { // открытый край: полосатая кромка, стойка и обрывок сигнальной ленты над пропастью
    const x = d > 0 ? ex - 26 : ex;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, 26, 15); ctx.clip();
    ctx.fillStyle = '#f2c230'; ctx.fillRect(x, y, 26, 15);
    ctx.fillStyle = '#1d1a22'; for (let k = -2; k < 5; k++) { const bx = x + k * 9; poly(ctx, [bx, y + 15, bx + 4.5, y + 15, bx + 13.5, y, bx + 9, y]); ctx.fill(); }
    ctx.restore();
    const px = ex - d * 7;
    ctx.fillStyle = '#e8e0ea'; ctx.fillRect(px - 1, y - 26, 2.5, 26); ctx.fillStyle = '#5a5566'; ctx.fillRect(px - 3, y - 2, 7, 2);
    let w0 = 0;
    for (let k = 0; k < 5; k++) {
      const w1 = Math.sin(now * 9 + k * 0.9 + ex * 0.01) * (1 + k * 0.8) + k * 0.8;
      ctx.fillStyle = k % 2 ? '#f4f1ea' : '#e53935';
      poly(ctx, [px + d * k * 5, y - 25 + w0, px + d * (k + 1) * 5, y - 25 + w1, px + d * (k + 1) * 5, y - 22 + w1, px + d * k * 5, y - 22 + w0]); ctx.fill();
      w0 = w1;
    }
  }

  function drawCore(s, ctx, api) { // стена: ядро жёсткости — монолитная шахта лифтов обгоняет перекрытия на три этажа
    const { H, now } = api, x0 = s.x, x1 = s.x + s.w, y = s.y, bot = H + 10;
    ctx.fillStyle = '#8e84a0'; ctx.fillRect(x0 - 0.5, y, s.w + 1, bot - y);                  // бетон
    ctx.fillStyle = '#b0a6bf'; ctx.fillRect(x0 - 0.5, y, 22, bot - y);                        // грань в лучах заката
    ctx.fillStyle = '#6c6280'; ctx.fillRect(x1 - 14, y, 14.5, bot - y);                        // теневая грань
    ctx.fillStyle = 'rgba(50,38,70,.35)'; ctx.beginPath();                                   // рабочие швы захваток и отверстия от стяжек
    for (let fy = y + SLAB + FLOOR; fy < bot; fy += FLOOR) {
      ctx.rect(x0, fy, s.w, 1.5);
      for (let xx = x0 + 16; xx < x1 - 10; xx += 30) ctx.rect(xx, fy - 23, 2, 2);
    }
    ctx.fill();
    for (let fy = y + SLAB + 10, f = 0; fy < bot - 30; fy += FLOOR, f++) {                   // дверные проёмы шахт, закрытые полосатыми щитами
      for (let dx = 34 + (f % 2) * 30; dx < s.w - 50; dx += 90) {
        const dx0 = x0 + dx;
        ctx.fillStyle = '#2b203f'; ctx.fillRect(dx0, fy, 26, 34);
        ctx.fillStyle = '#f2c230'; ctx.fillRect(dx0 - 2, fy + 12, 30, 5);
        ctx.fillStyle = '#1d1a22'; for (let k = 0; k < 4; k++) ctx.fillRect(dx0 + 1 + k * 8, fy + 12, 4, 5);
      }
    }
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(x1 - 58, y + SLAB + 8, 40, 12);                  // трафарет
    api.text('ЯДРО', x1 - 38, y + SLAB + 17, 8, '#5a2f6a');
    // оголовок: плита с жёлтой кромкой, как у перекрытий, по верху — выпуски арматуры по краям
    ctx.fillStyle = '#a89eb2'; ctx.fillRect(x0 - 0.5, y, s.w + 1, 13);
    ctx.fillStyle = '#958aa2'; ctx.fillRect(x0 - 0.5, y + 9, s.w + 1, 4);
    ctx.fillStyle = '#ece2e6'; ctx.fillRect(x0 - 0.5, y, s.w + 1, 2.5);
    ctx.fillStyle = '#f2c230'; ctx.fillRect(x0 - 0.5, y + 12, s.w + 1, 3);
    ctx.fillStyle = '#8c5436'; for (let xx = x1 - 26; xx < x1 - 4; xx += 5) ctx.fillRect(xx, y - 9, 1.6, 9);
    ctx.fillStyle = '#d23b3b'; for (let xx = x1 - 26; xx < x1 - 4; xx += 5) ctx.fillRect(xx - 0.4, y - 10, 2.4, 2);
    if (blink(now, 1.3, s.v * 1.3, 0.55)) { ctx.fillStyle = 'rgba(255,60,50,.35)'; circle(ctx, x1 - 30, y - 15, 6); } // заградительный огонь
    ctx.fillStyle = '#5a5566'; ctx.fillRect(x1 - 31, y - 12, 2, 12); ctx.fillStyle = '#ff3b30'; circle(ctx, x1 - 30, y - 14, 2.2);
    drawSurfaceFx(x0, x1, y, ctx, api);
  }

  function drawGround(s, ctx, api) { // одинаковые детали собираем в один путь — меньше вызовов отрисовки
    if (s.wall) { drawCore(s, ctx, api); return; }
    const { H, hash, now } = api, x0 = s.x, x1 = s.x + s.w, y = s.y, top = y + SLAB;
    const nl = api.groundAt(x0 - 3), nr = api.groundAt(x1 + 3);
    const openL = x0 > 0 && nl === null, openR = nr === null;
    const cols = [], floors = [];
    for (let cx = Math.ceil((x0 + 12) / COL) * COL; cx < x1 - 12; cx += COL) cols.push(cx);
    for (let by = top + FLOOR; by < H; by += FLOOR) floors.push(by);
    const rects = (color, fn) => { ctx.fillStyle = color; ctx.beginPath(); fn(); ctx.fill(); };
    // каркас нижних этажей: балки и колонны, а между ними — небо и облака
    rects('#6a2c2a', () => { ctx.rect(x0, top, s.w, 6); for (const by of floors) ctx.rect(x0, by, s.w, 6); });
    rects('#a24b40', () => { for (const by of floors) ctx.rect(x0, by, s.w, 1.5); });
    ctx.strokeStyle = '#5a2322'; ctx.lineWidth = 2; ctx.beginPath(); // связи-раскосы в некоторых пролётах
    for (const cx of cols) if (hash(cx * 3 + 1) > 0.55 && cx + COL < x1 - 12) { ctx.moveTo(cx, top + 6); ctx.lineTo(cx + COL, top + FLOOR); ctx.moveTo(cx + COL, top + 6); ctx.lineTo(cx, top + FLOOR); }
    ctx.stroke();
    if (openL || nl > y + 2) cols.push(x0 + 5); // открытый торец или уступ вниз — крайняя колонна
    if (openR || nr > y + 2) cols.push(x1 - 5);
    rects('#7a3230', () => { for (const cx of cols) ctx.rect(cx - 4, top, 8, H - top); });
    rects('#a84d42', () => { for (const cx of cols) ctx.rect(cx - 4, top, 1.5, H - top); });
    rects('#4e1d1c', () => { for (const cx of cols) ctx.rect(cx + 2.5, top, 1.5, H - top); });
    rects('#8f3d36', () => { for (const cx of cols) for (const by of floors) ctx.rect(cx - 7, by - 4, 14, 14); }); // узлы на болтах
    rects('#e3a592', () => { for (const cx of cols) for (const by of floors) { ctx.rect(cx - 5, by - 2, 2, 2); ctx.rect(cx + 3, by - 2, 2, 2); ctx.rect(cx - 5, by + 6, 2, 2); ctx.rect(cx + 3, by + 6, 2, 2); } });
    // плита: профнастил снизу, бетон сверху, жёлтая бортовая кромка
    ctx.fillStyle = '#56627a'; ctx.fillRect(x0 - 0.5, y + 15, s.w + 1, SLAB - 15);
    rects('#7d8ca6', () => { for (let x = Math.ceil(x0 / 12) * 12; x < x1 - 5; x += 12) ctx.rect(x, y + 15, 6, SLAB - 17); });
    ctx.fillStyle = '#a89eb2'; ctx.fillRect(x0 - 0.5, y, s.w + 1, 13);
    ctx.fillStyle = '#958aa2'; ctx.fillRect(x0 - 0.5, y + 9, s.w + 1, 4);
    ctx.fillStyle = '#ece2e6'; ctx.fillRect(x0 - 0.5, y, s.w + 1, 2.5);
    ctx.fillStyle = '#f2c230'; ctx.fillRect(x0 - 0.5, y + 12, s.w + 1, 3);
    rects('rgba(70,55,85,.28)', () => { for (let x = Math.ceil(x0 / 11) * 11; x < x1 - 4; x += 11) { const h = hash(x * 7); ctx.rect(x + h * 5, y + 4 + h * 5, 2 + h * 2, 1.5); } });
    rects('rgba(60,45,70,.4)', () => { for (let x = Math.ceil(x0 / 96) * 96; x < x1 - 4; x += 96) ctx.rect(x, y + 2.5, 1, 9.5); }); // швы бетонирования
    if (openL) edgeGuard(ctx, x0, y, -1, now);
    if (openR) edgeGuard(ctx, x1, y, 1, now);
    drawSurfaceFx(x0, x1, y, ctx, api);
  }

  function netFlap(ctx, ax, ay, len, d, now, v) { // обрывок страховочной сетки: трос провис, край рваный и колышется
    const sw = Math.sin(now * 1.7 + v * 5) * 3, ex = ax + d * len, ey = ay + 9 + sw * 0.4;
    const b1 = ay + 30 + v * 12 + sw, b2 = ey + 16 + sw * 1.5;
    ctx.save();
    poly(ctx, [ax, ay, ax + d * len * 0.5, ay + 6, ex, ey, ex - d * 5, b2, ax + d * len * 0.55, (b1 + b2) / 2 + 7, ax + d * len * 0.3, b1 - 4, ax + d * 2, b1]);
    ctx.clip();
    ctx.strokeStyle = 'rgba(44,120,104,.9)'; ctx.lineWidth = 1; ctx.beginPath();
    const mx = Math.min(ax, ex) - 60;
    for (let bx = mx; bx < mx + len + 120; bx += 7) { ctx.moveTo(bx, ay - 4); ctx.lineTo(bx + 64, ay + 60); ctx.moveTo(bx + 64, ay - 4); ctx.lineTo(bx, ay + 60); }
    ctx.stroke(); ctx.restore();
    ctx.strokeStyle = '#e8e0cc'; ctx.lineWidth = 1.6; ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.quadraticCurveTo(ax + d * len * 0.5, ay + 8, ex, ey); ctx.quadraticCurveTo(ex + d * 3, ey + 8, ex + d * 1 + sw, ey + 18); // оборванный конец
    ctx.stroke();
  }

  function drawPit(p, ctx, api) { // открытый край перекрытия: внизу только облака и обрывки сетки
    const yr = api.groundAt(p.x + p.w + 3);
    netFlap(ctx, p.x, p.y + SLAB + 3, p.w * (0.28 + p.v * 0.14), 1, api.now, p.v);
    netFlap(ctx, p.x + p.w, (yr === null ? p.y : yr) + SLAB + 3, p.w * (0.22 + (1 - p.v) * 0.14), -1, api.now, p.v + 1);
  }

  // ---------- платформы: двутавры на стойках или на крюке крана ----------
  function hookBlock(ctx, x, y) { // крюковая обойма
    ctx.fillStyle = '#5a5566'; circle(ctx, x, y - 13, 4);
    ctx.fillStyle = '#f2c230'; ctx.fillRect(x - 7, y - 13, 14, 12);
    ctx.fillStyle = '#1d1a22'; ctx.fillRect(x - 7, y - 9, 14, 2); ctx.fillRect(x - 7, y - 5, 14, 2);
    ctx.strokeStyle = '#3a3440'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(x, y + 4, 4, -Math.PI / 2, Math.PI * 1.15); ctx.stroke();
  }

  function footAt(x, y, api) { // на что опирается стойка в точке x под высотой y: ближайший нижний ярус или плита
    let b = api.groundAt(x); if (b === null) b = api.H + 10;
    for (const q of api.platforms) if (q.y > y + 1 && q.y < b && x >= q.x && x <= q.x + q.w) b = q.y;
    return b;
  }

  function scaffold(p, ctx, api) { // ярус вышки на лесах: трубы-стойки, ригели, диагонали и хомуты
    const n = Math.max(2, Math.round(p.w / 75)), xs = [];
    for (let k = 0; k <= n; k++) xs.push(p.x + 8 + k * (p.w - 16) / n);
    const feet = xs.map(x => footAt(x, p.y, api));
    ctx.strokeStyle = '#6f7a94'; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const lo = Math.min(feet[k], feet[k + 1]);
      for (let yy = p.y + 11 + 30, j = 0; yy <= lo + 1; yy += 30, j++) { // ригели и диагональ в каждом ярусе лесов
        ctx.moveTo(xs[k], yy); ctx.lineTo(xs[k + 1], yy);
        if ((j + k) % 2) { ctx.moveTo(xs[k], yy - 30); ctx.lineTo(xs[k + 1], yy); } else { ctx.moveTo(xs[k + 1], yy - 30); ctx.lineTo(xs[k], yy); }
      }
    }
    ctx.stroke();
    ctx.fillStyle = '#586580'; xs.forEach((x, k) => ctx.fillRect(x - 2, p.y + 11, 4, feet[k] - p.y - 11));
    ctx.fillStyle = '#8795b0'; xs.forEach((x, k) => ctx.fillRect(x - 2, p.y + 11, 1.3, feet[k] - p.y - 11));
    ctx.fillStyle = '#f2c230'; xs.forEach((x, k) => { for (let yy = p.y + 41; yy < feet[k] - 4; yy += 30) ctx.fillRect(x - 3, yy - 1.5, 6, 3); });
    ctx.fillStyle = '#3f4860'; xs.forEach((x, k) => ctx.fillRect(x - 6, feet[k] - 2, 12, 2));
    // сетка-«юбка» под ярусом: край страховочной сетки провисает между стойками
    ctx.strokeStyle = 'rgba(44,120,104,.75)'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(xs[0], p.y + 14); for (let k = 1; k <= n; k++) ctx.quadraticCurveTo((xs[k - 1] + xs[k]) / 2, p.y + 24, xs[k], p.y + 14);
    ctx.stroke();
  }

  function drawPlatform(p, ctx, api) {
    if (p.tower) { scaffold(p, ctx, api); ibeam(ctx, p.x - 4, p.y, p.w + 8, 11); drawSurfaceFx(p.x, p.x + p.w, p.y, ctx, api); return; }
    const hang = p.tier === 2 ? p.v > 0.3 : p.v > 0.55 && !api.platforms.some(q => q.tier === 2 && q.base === p.y && q.x < p.x + p.w && q.x + q.w > p.x);
    const cx = p.x + p.w / 2;
    if (hang) { // висит на стропах: трос уходит вверх к невидимому крану
      const wide = p.w > 150, hy = p.y - 72, ry = Math.min(api.camY - 8, hy - 12); // крюк высоко — робот на балке под ним помещается целиком
      ctx.strokeStyle = '#2a2332'; ctx.lineWidth = 1.2; line(ctx, cx - 2, ry, cx - 2, hy - 12); line(ctx, cx + 2, ry, cx + 2, hy - 12);
      ctx.strokeStyle = '#3b3545'; ctx.lineWidth = 1.5;
      if (wide) { // широкая балка — через траверсу
        const sw = p.w * 0.36, sy = p.y - 54;
        line(ctx, cx, hy + 6, cx - sw, sy); line(ctx, cx, hy + 6, cx + sw, sy); line(ctx, cx - sw, sy, cx - sw, p.y); line(ctx, cx + sw, sy, cx + sw, p.y);
        ctx.fillStyle = '#e2b23a'; ctx.fillRect(cx - sw - 3, sy - 2, sw * 2 + 6, 4); ctx.fillStyle = '#1d1a22'; ctx.fillRect(cx - 6, sy - 2, 12, 4);
      } else { const a = p.w * 0.36; line(ctx, cx, hy + 6, cx - a, p.y); line(ctx, cx, hy + 6, cx + a, p.y); }
      hookBlock(ctx, cx, hy);
    } else { // телескопические стойки с опорными плитами
      const n = Math.max(2, Math.round(p.w / 95)), h = p.base - p.y - 11;
      ctx.strokeStyle = 'rgba(70,80,108,.85)'; ctx.lineWidth = 1.5;
      for (let k = 0; k < n; k += 2) line(ctx, p.x + 10 + k * (p.w - 20) / n, p.base - 4, p.x + 10 + (k + 1) * (p.w - 20) / n, p.y + 14);
      for (let k = 0; k <= n; k++) {
        const px = p.x + 10 + k * (p.w - 20) / n;
        ctx.fillStyle = '#586580'; ctx.fillRect(px - 2.5, p.y + 11, 5, h);
        ctx.fillStyle = '#8795b0'; ctx.fillRect(px - 1.5, p.y + 11, 3, h * 0.45);
        ctx.fillStyle = '#f2c230'; ctx.fillRect(px - 3.5, p.y + 11 + h * 0.45, 7, 3);
        ctx.fillStyle = '#3f4860'; ctx.fillRect(px - 6, p.base - 2, 12, 2);
      }
    }
    ibeam(ctx, p.x - 4, p.y, p.w + 8, 11);
    drawSurfaceFx(p.x, p.x + p.w, p.y, ctx, api);
  }

  function drawLadder(l, ctx) { // монтажная лестница: жёлтые тетивы, на высоких — дуги ограждения
    const t = l.top - 12, h = l.bottom - t, r = l.x + l.w;
    ctx.fillStyle = 'rgba(30,15,40,.25)'; ctx.fillRect(l.x + 3, l.top, l.w - 2, l.bottom - l.top);
    ctx.fillStyle = '#d9a91c'; ctx.fillRect(l.x, t, 3, h); ctx.fillRect(r - 3, t, 3, h);
    ctx.fillStyle = '#ffe07a'; ctx.fillRect(l.x, t, 1, h);
    ctx.fillStyle = '#c9c2cf'; ctx.beginPath(); for (let y = l.top + 6; y < l.bottom; y += 12) ctx.rect(l.x + 2, y, l.w - 4, 2.5); ctx.fill();
    if (h > 110) {
      ctx.strokeStyle = 'rgba(217,169,28,.8)'; ctx.lineWidth = 1.4; ctx.beginPath();
      for (let y = l.top + 6; y < l.bottom - 56; y += 24) { ctx.moveTo(l.x - 1, y); ctx.quadraticCurveTo(l.x + l.w / 2, y + 7, r + 1, y); }
      ctx.stroke();
    }
    ctx.fillStyle = '#e53935'; ctx.fillRect(l.x - 1, l.top - 14, 5, 3); ctx.fillRect(r - 4, l.top - 14, 5, 3); // поручни сверху
  }

  // ---------- препятствия: пачки арматуры и профнастила на брусьях ----------
  function sleepers(ctx, x, y, w) {
    ctx.fillStyle = '#8a6440'; ctx.fillRect(x + 4, y - 4, 10, 4); ctx.fillRect(x + w - 14, y - 4, 10, 4);
    ctx.fillStyle = '#5e4229'; ctx.fillRect(x + 4, y - 1.5, 10, 1.5); ctx.fillRect(x + w - 14, y - 1.5, 10, 1.5);
  }
  function rebar(ctx, x, y, w, h, v, api) { // пачка арматуры: рифлёные прутки, концы торчат вразнобой, стянута проволокой
    sleepers(ctx, x, y + h, w);
    const n = 6, bh = (h - 4) / n, seed = Math.floor(v * 9973), ends = [];
    for (let j = 0; j < n; j++) ends.push([api.hash(seed + j * 7) * 3, api.hash(seed + j * 7 + 3) * 3]);
    const bars = (color, fn) => { ctx.fillStyle = color; ctx.beginPath(); for (let j = 0; j < n; j++) fn(y + j * bh, ends[j][0], ends[j][1]); ctx.fill(); };
    bars('#8c5436', (by, a, b) => ctx.rect(x - a, by, w + a + b, bh - 0.7));
    bars('#c98a5c', (by, a, b) => ctx.rect(x - a, by, w + a + b, 0.9));                                // блик
    bars('#5f3522', (by, a) => { for (let k = x - a + 2; k < x + w; k += 3) ctx.rect(k, by + 0.9, 1, bh - 1.8); }); // рифление
    bars('#d23b3b', (by, a) => ctx.rect(x - a, by, 1.8, bh - 0.7));                                    // торцы в краске
    ctx.fillStyle = '#2d2a33'; ctx.fillRect(x + 8, y - 0.5, 2.2, h - 3.5); ctx.fillRect(x + w - 11, y - 0.5, 2.2, h - 3.5); // вязальная проволока
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(x + w - 15, y + 5, 8, 6); ctx.fillStyle = '#5a5566'; ctx.fillRect(x + w - 14, y + 7, 6, 1); // бирка
  }
  function deck(ctx, x, y, w, h) { // стопка листов профнастила, стянутая лентами
    sleepers(ctx, x, y + h, w);
    const n = 4, lh = (h - 4) / n;
    for (let j = 0; j < n; j++) {
      const ly = y + j * lh;
      ctx.fillStyle = '#8e9bb1'; ctx.fillRect(x, ly + lh * 0.4, w, lh * 0.6);
      ctx.fillStyle = '#c8d2df'; for (let k = 0; k < w - 3; k += 9) ctx.fillRect(x + k + 1, ly, 5, lh * 0.45);
      ctx.fillStyle = '#eef3f8'; ctx.fillRect(x, ly + lh * 0.4, w, 1);
      ctx.fillStyle = '#5f6c83'; ctx.fillRect(x, ly + lh - 1, w, 1);
    }
    ctx.fillStyle = '#3d5fc4'; ctx.fillRect(x + 9, y, 3, h - 4); ctx.fillRect(x + w - 12, y, 3, h - 4);
    ctx.fillStyle = '#c7d0dc'; ctx.fillRect(x + 8, y + h * 0.5 - 2, 5, 4); ctx.fillRect(x + w - 13, y + h * 0.5 - 2, 5, 4);
  }
  function drawObstacle(s, ctx, api) {
    const bh = s.h / s.stack;
    for (let k = 0; k < s.stack; k++) {
      const by = s.y + s.h - (k + 1) * bh;
      if ((s.v > 0.5) === (k % 2 === 0)) rebar(ctx, s.x, by, s.w, bh, s.v + k * 0.37, api); else deck(ctx, s.x, by, s.w, bh);
    }
    drawSurfaceFx(s.x, s.x + s.w, s.y, ctx, api);
  }

  // ---------- декор ----------
  function drawDecor(d, ctx, api) {
    const { now } = api, x = d.x, y = d.y;
    if (d.kind === 'stanchion') { // стойки страховочного троса с карабином
      ctx.fillStyle = '#d7cfd9'; ctx.fillRect(x - 21, y - 30, 3, 30); ctx.fillRect(x + 18, y - 30, 3, 30);
      ctx.fillStyle = '#5a5566'; ctx.fillRect(x - 24, y - 3, 9, 3); ctx.fillRect(x + 15, y - 3, 9, 3);
      ctx.fillStyle = '#e53935'; ctx.fillRect(x - 21, y - 30, 3, 4); ctx.fillRect(x + 18, y - 30, 3, 4);
      const sag = Math.sin(now * 2 + d.v * 6) * 1.5;
      ctx.strokeStyle = '#f2c230'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 19, y - 28); ctx.quadraticCurveTo(x, y - 20 + sag, x + 19, y - 28); ctx.stroke();
      ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + 5, y - 23 + sag * 0.5); ctx.quadraticCurveTo(x + 8 + sag, y - 12, x + 4, y - 5); ctx.stroke();
      ctx.fillStyle = '#c0c4cc'; ctx.fillRect(x + 3, y - 25 + sag * 0.5, 3, 4);
    } else if (d.kind === 'windsock') { // ветроуказатель: полосатый конус полощется на ветру
      ctx.fillStyle = '#d7cfd9'; ctx.fillRect(x - 1, y - 46, 2.5, 46); ctx.fillStyle = '#5a5566'; ctx.fillRect(x - 4, y - 2, 9, 2);
      ctx.strokeStyle = '#b8b0bc'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x + 2, y - 44, 1.5, 5, 0, 0, TAU); ctx.stroke();
      ctx.save(); ctx.translate(x + 2, y - 44); ctx.rotate((1 - st.wind) * 1.1 + Math.sin(now * 3.1 + d.v * 9) * 0.05);
      for (let k = 0; k < 5; k++) {
        const a = Math.sin(now * 11 - k * 1.1 + d.v * 7) * (0.4 + k * 0.3), b = Math.sin(now * 11 - (k + 1) * 1.1 + d.v * 7) * (0.4 + (k + 1) * 0.3);
        const r0 = 5 - k * 0.55, r1 = 5 - (k + 1) * 0.55;
        ctx.fillStyle = k % 2 ? '#f4f1ea' : '#ff6a1f'; poly(ctx, [k * 7, a - r0, k * 7 + 7.4, b - r1, k * 7 + 7.4, b + r1, k * 7, a + r0]); ctx.fill();
      }
      ctx.restore();
    } else if (d.kind === 'welder') { // сварочный аппарат на колёсиках, кабели в бухте
      ctx.strokeStyle = '#1d1a22'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(x + 19, y - 4, 7, 3.5, 0, 0, TAU); ctx.ellipse(x + 19, y - 6, 6, 3, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#2d6f9c'; rr(ctx, x - 14, y - 24, 27, 18, 2); ctx.fill();
      ctx.fillStyle = '#245a80'; ctx.fillRect(x - 14, y - 10, 27, 4);
      ctx.strokeStyle = '#1d2a36'; ctx.lineWidth = 2; ctx.strokeRect(x - 11, y - 29, 21, 5);
      ctx.fillStyle = '#16202a'; ctx.fillRect(x - 10, y - 21, 11, 7);
      api.text('160', x - 4.5, y - 15.5, 5.5, blink(now, 1.2, d.v, 0.9) ? '#7dff9a' : '#2f7a45');
      ctx.fillStyle = '#e53935'; circle(ctx, x + 7, y - 17, 2.2); ctx.fillStyle = '#1d1a22'; circle(ctx, x + 7, y - 17, 0.9);
      ctx.fillStyle = '#3a3440'; circle(ctx, x - 9, y - 3, 3); circle(ctx, x + 8, y - 3, 3);
      ctx.fillStyle = '#c33'; ctx.fillRect(x + 24, y - 3, 8, 2.5);
    } else if (d.kind === 'spot') { // прожектор на треноге подсвечивает перекрытие
      const a = 0.12 + Math.sin(now * 13 + d.v * 20) * 0.015;
      ctx.fillStyle = `rgba(255,240,190,${a})`; poly(ctx, [x + 6, y - 34, x + 70, y, x + 24, y]); ctx.fill();
      ctx.strokeStyle = '#3a3440'; ctx.lineWidth = 1.8; ctx.beginPath();
      ctx.moveTo(x, y - 28); ctx.lineTo(x - 10, y); ctx.moveTo(x, y - 28); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 28); ctx.lineTo(x + 1, y); ctx.stroke();
      ctx.save(); ctx.translate(x, y - 33); ctx.rotate(0.55);
      ctx.fillStyle = '#4a4552'; ctx.fillRect(-7, -6, 12, 12); ctx.fillStyle = '#fff4c8'; ctx.fillRect(5, -5, 2.5, 10);
      ctx.restore();
    } else if (d.kind === 'sign') { // табличка «Работы на высоте»
      ctx.fillStyle = '#6b6472'; ctx.fillRect(x - 1, y - 32, 2.5, 32);
      ctx.fillStyle = '#f4f1ea'; ctx.fillRect(x - 27, y - 60, 54, 28);
      ctx.strokeStyle = '#c62828'; ctx.lineWidth = 2; ctx.strokeRect(x - 26, y - 59, 52, 26);
      api.text('РАБОТЫ', x, y - 49, 8, '#1d1a22'); api.text('НА ВЫСОТЕ', x, y - 39, 7.5, '#c62828');
      ctx.fillStyle = '#f2c230'; poly(ctx, [x, y - 74, x - 8, y - 61, x + 8, y - 61]); ctx.fill();
      api.text('!', x, y - 62.5, 9, '#1d1a22');
    } else if (d.kind === 'bottles') { // тележка с баллонами: кислород и пропан
      ctx.fillStyle = '#2f6fd0'; rr(ctx, x - 9, y - 32, 7, 28, 3); ctx.fill();
      ctx.fillStyle = '#d23b3b'; rr(ctx, x - 1, y - 28, 8, 24, 3); ctx.fill();
      ctx.fillStyle = '#9aa0ab'; ctx.fillRect(x - 7, y - 35, 3, 3); ctx.fillRect(x + 1.5, y - 31, 3, 3);
      ctx.fillStyle = '#f4f1ea'; ctx.fillRect(x - 9, y - 22, 7, 1.5); ctx.fillRect(x - 1, y - 19, 8, 1.5);
      ctx.strokeStyle = '#3a3440'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(x - 12, y - 30); ctx.lineTo(x - 12, y - 4); ctx.lineTo(x + 10, y - 4); ctx.stroke();
      ctx.fillStyle = '#1d1a22'; circle(ctx, x - 7, y - 2.5, 2.8); circle(ctx, x + 6, y - 2.5, 2.8);
      ctx.strokeStyle = '#1d1a22'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 5, y - 35); ctx.quadraticCurveTo(x + 14, y - 42, x + 12, y - 6); ctx.stroke();
    }
  }

  function drawFinish(fx, gy, ctx, api) { // крыша: знак высотной отметки, машинное помещение, мачта с флагом
    const { now } = api, sx = fx + 90, mx = fx + 200;
    ctx.fillStyle = '#5a5566'; ctx.fillRect(sx + 8, gy - 34, 3, 34); ctx.fillRect(sx + 75, gy - 34, 3, 34);
    ctx.fillStyle = '#f7f4ee'; ctx.fillRect(sx, gy - 76, 86, 44);
    ctx.strokeStyle = '#b388ff'; ctx.lineWidth = 2.5; ctx.strokeRect(sx, gy - 76, 86, 44);
    api.text('+200.000', sx + 48, gy - 55, 13, '#1d1a22'); // отметка над полкой, треугольник указывает уровень
    ctx.strokeStyle = '#1d1a22'; ctx.lineWidth = 1.5; line(ctx, sx + 8, gy - 51, sx + 80, gy - 51);
    ctx.fillStyle = '#1d1a22'; poly(ctx, [sx + 8, gy - 51, sx + 14, gy - 51, sx + 14, gy - 42]); ctx.fill();
    ctx.lineWidth = 1; poly(ctx, [sx + 8, gy - 51, sx + 20, gy - 51, sx + 14, gy - 42]); ctx.stroke();
    ctx.fillStyle = '#1d1a22'; ctx.fillRect(sx + 6, gy - 42, 16, 1);
    api.text('верх каркаса', sx + 50, gy - 40, 7, '#5a5566');
    // машинное помещение лифтов на кровле
    ctx.fillStyle = '#b9aec4'; ctx.fillRect(mx, gy - 62, 124, 62);
    ctx.fillStyle = '#d3c9dc'; ctx.fillRect(mx + 96, gy - 62, 28, 62);
    ctx.fillStyle = '#ece4ee'; ctx.fillRect(mx - 3, gy - 67, 130, 5);
    ctx.fillStyle = '#5b4a7a'; ctx.fillRect(mx + 44, gy - 42, 20, 42); ctx.fillStyle = '#f2c230'; ctx.fillRect(mx + 59, gy - 22, 3, 2);
    ctx.fillStyle = '#8a7e99'; for (let k = 0; k < 5; k++) ctx.fillRect(mx + 76, gy - 46 + k * 5, 30, 2.5);
    ctx.fillStyle = '#7a6f88'; ctx.fillRect(mx + 100, gy - 82, 2, 15); ctx.fillRect(mx + 94, gy - 82, 14, 2); // антенна
    // мачта с флагом и заградительным огнём
    const px = mx + 16;
    ctx.fillStyle = '#e0d8e4'; ctx.fillRect(px, gy - 160, 3, 93);
    for (let c = 0; c < 11; c++) {
      const w = Math.sin(now * 5 - c * 0.6) * 2.2 * (c / 10), fxc = px + 3 + c * 4;
      ctx.fillStyle = '#f7f7f7'; ctx.fillRect(fxc, gy - 158 + w, 4.3, 9);
      ctx.fillStyle = '#1e5ec8'; ctx.fillRect(fxc, gy - 149 + w, 4.3, 9);
      ctx.fillStyle = '#d52b1e'; ctx.fillRect(fxc, gy - 140 + w, 4.3, 9);
    }
    if (blink(now, 1.2, 0, 0.5)) { ctx.fillStyle = 'rgba(255,60,50,.35)'; circle(ctx, px + 1.5, gy - 164, 6); }
    ctx.fillStyle = '#ff3b30'; circle(ctx, px + 1.5, gy - 163, 2.5);
  }

  // ---------- враги ----------
  const drawSpark = (p, ctx) => { // раскалённая искра с огненным хвостом
    ctx.fillStyle = 'rgba(255,150,40,.45)'; ctx.fillRect(-14, -2.5, 20, 5);
    ctx.fillStyle = '#ff8a1f'; ctx.fillRect(-11, -1, 8, 2); ctx.fillStyle = '#fff4b8'; ctx.fillRect(-4, -1.5, 9, 3);
  };
  const sparkUpd = p => { p.rot = Math.atan2(p.vy, p.vx); };
  const lerp = (a, b, u) => a + (b - a) * u;
  const droneTilt = e => (e.vx || 0) * 0.004; // наклон дрона по ходу полёта

  function drawBasket(ctx, t) { // корзина фасадной люльки: пол, полосатый бортик, перила, стремена с лебёдками
    for (const sx of [-24, 24]) {
      ctx.strokeStyle = '#5b6474'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx - 5, 0); ctx.lineTo(sx, -30); ctx.lineTo(sx + 5, 0); ctx.stroke();
      ctx.fillStyle = '#4c5566'; ctx.fillRect(sx - 4.5, -31, 9, 10); ctx.fillStyle = '#8994a8'; ctx.fillRect(sx - 4.5, -31, 9, 2);
    }
    ctx.fillStyle = 'rgba(201,161,38,.55)'; for (let x = -26; x < 28; x += 5) ctx.fillRect(x, -20, 1, 11); // сетчатое ограждение
    ctx.fillStyle = '#f2c230'; ctx.fillRect(-30, -22, 60, 3); ctx.fillRect(-30, -15, 60, 2);
    for (const px of [-30, -10, 8, 27.5]) ctx.fillRect(px, -22, 2.5, 19);
    ctx.save(); ctx.beginPath(); ctx.rect(-30, -9, 60, 6); ctx.clip(); // бортик в полоску
    ctx.fillStyle = '#f2c230'; ctx.fillRect(-30, -9, 60, 6);
    ctx.fillStyle = '#1d1a22'; for (let x = -34; x < 32; x += 8) { poly(ctx, [x, -3, x + 4, -3, x + 8, -9, x + 4, -9]); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = '#2f2c33'; ctx.fillRect(-31, -3, 62, 3);
    ctx.fillStyle = blink(t, 0.8, 0, 0.35) ? '#ffb300' : '#7a5200'; circle(ctx, -24, -33, 2.2); // маячок на лебёдке
  }

  const onScreen = (e, api) => e.y + e.h > api.camY + 40 && e.y < api.camY + api.H - 10 && e.x + e.w > api.camX && e.x < api.camX + api.W; // враг в кадре — атаковать честно

  function spiderTarget(e, api) { // куда прыгнуть: на ту опору, где стоит герой (ярус, плита), в пределах 250 по X и 260 по высоте
    const P = api.player;
    if (!P.onGround || P.climb || !onScreen(e, api)) return null;
    const ex = e.x + e.w / 2, ey = e.y + e.h, px = P.x + P.w / 2, feet = P.y + P.h, dx = px - ex, dy = feet - ey;
    if (Math.abs(dx) > 250 || (Math.abs(dx) < 60 && Math.abs(dy) < 20) || Math.abs(dy) > 260) return null;
    let lo = null, hi = 0, y = feet, plat = false;
    for (const q of api.platforms) if (px >= q.x && px <= q.x + q.w && Math.abs(q.y - feet) < 2) { lo = q.x; hi = q.x + q.w; plat = true; }
    if (lo === null) for (const g of api.solids) if (g.kind === 'ground' && px >= g.x && px <= g.x + g.w && Math.abs(g.y - feet) < 2) { lo = g.x + 4; hi = g.x + g.w - 4; break; }
    if (lo === null) return null;
    if (!plat) for (const o of api.solids) { // по плите — не дальше пачек арматуры
      if (o.kind !== 'obstacle' || o.x > hi || o.x + o.w < lo || Math.abs(o.y + o.h - y) > 2) continue;
      if (o.x + o.w / 2 < px) lo = Math.max(lo, o.x + o.w + 2); else hi = Math.min(hi, o.x - 2);
    }
    if (hi - lo < e.w + 24) return null;
    const jx = api.clamp(px, lo + e.w / 2, hi - e.w / 2);
    return { jx, jy: y, nMin: lo, nMax: hi, dur: 0.7 + Math.hypot(jx - ex, y - ey) / 700 };
  }

  function drawBoltBag(p, ctx) { // брезентовый мешок с болтами
    ctx.fillStyle = '#8a7a5a'; ctx.beginPath(); ctx.ellipse(0, 1, 6.5, 5.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5e5238'; ctx.fillRect(-2.5, -6, 5, 3); ctx.fillStyle = '#c9c2cf'; ctx.fillRect(-4, 0, 2, 2); ctx.fillRect(1, 2, 2, 2);
  }

  const enemies = {
    pigeon: { // голубь: порхает рядом, «курлыкает» и ныряет на героя коротким броском
      w: 26, h: 18, hp: 1, pts: 80, hitColor: '#eef0f6', deathColor: '#dfe3ea',
      init(e) { e.baseY = Math.max(e.y, Math.min(70, e.groundY - 100)); e.y = e.baseY; e.homeX = e.x; e.state = 'fly'; e.vx = 0; e.s = 0; }, // над ядром-стеной держится выше
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e);
        if (e.state === 'fly') { // держится в стороне от героя и подбирается поближе
          const want = Math.abs(dx) < 320 ? api.clamp(dx - Math.sign(dx) * 90, -70, 70) : Math.sin(e.t * 0.7) * 40;
          e.vx += (want - e.vx) * Math.min(1, dt * 2);
          e.x = api.clamp(e.x + e.vx * dt, e.homeX - 220, e.homeX + 220);
          e.y += (e.baseY + Math.sin(e.t * 2.3) * 7 - e.y) * Math.min(1, dt * 3);
          if (Math.abs(e.vx) > 8) e.dir = Math.sign(e.vx);
          e.cd -= dt;
          if (e.cd <= 0 && Math.abs(dx) < 170 && Math.abs(dx) > 24 && P.y > e.y + 10) { e.state = 'aim'; e.aim = 0.85; }
        } else if (e.state === 'aim') { // замах: взмывает, топорщится, «курлык!» — 0,85 с на реакцию
          e.aim -= dt; e.y -= 14 * dt; e.dir = Math.sign(dx) || e.dir;
          if (e.aim <= 0) {
            const sx = e.x + e.w / 2, sy = e.y + e.h / 2, tx = api.clamp(P.x + P.w / 2, sx - 150, sx + 150);
            const surf = api.groundAt(tx), ty = Math.max(sy + 10, Math.min(P.y + 12, (surf === null ? P.y + P.h : surf) - 14));
            const ex = api.clamp(tx + (tx - sx) * 0.7, e.homeX + e.w / 2 - 240, e.homeX + e.w / 2 + 240), ey = sy - 6;
            Object.assign(e, { state: 'dive', s: 0, sx, sy, ex, ey, qx: 2 * tx - 0.5 * (sx + ex), qy: 2 * ty - 0.5 * (sy + ey), dur: api.clamp(Math.hypot(tx - sx, ty - sy) / 220, 0.55, 1) });
          }
        } else { // бросок по дуге: вниз к герою и снова вверх
          e.s = Math.min(1, e.s + dt / e.dur);
          const s = e.s, u = 1 - s;
          e.x = u * u * e.sx + 2 * u * s * e.qx + s * s * e.ex - e.w / 2;
          e.y = u * u * e.sy + 2 * u * s * e.qy + s * s * e.ey - e.h / 2;
          if (s >= 1) { e.state = 'fly'; e.cd = api.rand(1.4, 2.4); e.vx = 0; }
        }
      },
      draw(e, ctx, api) {
        const aim = e.state === 'aim', dive = e.state === 'dive';
        const flap = dive ? 0.3 : Math.sin(e.t * (aim ? 36 : 20)), puff = aim ? 1.14 : 1;
        ctx.save(); ctx.translate(0, -9); ctx.scale(1.12, 1.12);
        ctx.rotate(dive ? (0.5 - e.s) * 1.1 : aim ? -0.3 : Math.sin(e.t * 2.3) * 0.06);
        ctx.strokeStyle = '#353848'; ctx.lineWidth = 1;
        ctx.fillStyle = '#6c7388'; poly(ctx, [-8, -2, -17, -4, -18, 2, -8, 2]); ctx.fill(); ctx.stroke(); // хвост
        ctx.fillStyle = '#2f3240'; ctx.fillRect(-18, -3.5, 3, 5);
        ctx.strokeStyle = '#e27a8c'; ctx.lineWidth = 1.3; // лапки
        if (dive) line(ctx, 3, 4, 8, 8); else line(ctx, -2, 5, -5, 8);
        ctx.strokeStyle = '#353848'; ctx.lineWidth = 1;
        ctx.fillStyle = '#9ea6ba'; ctx.beginPath(); ctx.ellipse(-1, 0, 10 * puff, 6 * puff, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#bcc3d2'; ctx.beginPath(); ctx.ellipse(0, 2.5, 7, 3.2, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5fa58b'; ctx.beginPath(); ctx.ellipse(6, -3, 4.6 * puff, 4.3 * puff, -0.5, 0, TAU); ctx.fill(); // шея с отливом
        ctx.fillStyle = '#9a67b5'; ctx.beginPath(); ctx.ellipse(7, -0.8, 3, 2.3, -0.3, 0, TAU); ctx.fill();
        ctx.fillStyle = '#80889f'; circle(ctx, 9, -6.5, 3.8); ctx.stroke();
        ctx.fillStyle = aim ? '#ff3b30' : '#ff8a3a'; circle(ctx, 10.3, -7.3, 1.3); ctx.fillStyle = '#111'; ctx.fillRect(10.4, -7.8, 1, 1);
        ctx.fillStyle = '#ece6e0'; ctx.fillRect(11.8, -7.3, 1.8, 1.5);
        ctx.fillStyle = '#3a3036'; poly(ctx, [12.6, -6.6, 16.8, -5.6, 12.6, -4.8]); ctx.fill();
        ctx.save(); ctx.translate(-1, -3); ctx.scale(1, flap); // крыло: взмах — сжатие по вертикали
        ctx.fillStyle = '#b0b7ca'; poly(ctx, [3, 0, -3, -3, -14, -15, -19, -13, -10, -2]); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2f3240'; poly(ctx, [-14, -15, -19, -13, -16, -9, -11, -11]); ctx.fill();
        ctx.fillStyle = '#3d4152'; ctx.fillRect(-9, -7, 5, 1.5); ctx.fillRect(-7, -4.5, 5, 1.5);
        ctx.restore();
        ctx.restore();
        if (aim) { // подпись не отражаем вместе с птицей
          ctx.save(); ctx.scale(e.dir || 1, 1);
          ctx.fillStyle = 'rgba(30,18,40,.72)'; rr(ctx, -18, -36, 36, 11, 3); ctx.fill();
          api.text('курлык!', 0, -27.5, 7.5, '#ffe9f0');
          ctx.restore();
        }
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2, e.y + e.h / 2, '#f4f5fa', 10, 110, 60); api.burst(e.x + e.w / 2, e.y + e.h / 2, '#6c7388', 5, 90, 80); },
    },

    welderbot: { // сварочный робот: патрулирует, замирает, 0,8 с разжигает дугу и выбрасывает веер искр
      w: 34, h: 40, hp: 3, pts: 300, heavy: true, hitColor: '#ffd76a', deathColor: '#ff9d3a',
      init(e) { e.state = 'walk'; e.tt = 0; e.pause = 0; e.tread = 0; },
      update(e, dt, api) {
        const dx = api.dx(e), near = api.near(e, 190, 70);
        if (e.state === 'walk') {
          if (near) e.dir = Math.sign(dx) || e.dir;
          if (e.pause > 0) e.pause -= dt;
          else {
            const x0 = e.x; api.patrol(e, near ? 46 : 30, dt); e.tread += e.x - x0;
            if (!near && api.rand(0, 1) < dt * 0.3) e.pause = api.rand(0.6, 1.2); // постоял, «подумал»
          }
          e.cd -= dt;
          if (e.cd <= 0 && near && Math.abs(dx) < 150) { e.state = 'charge'; e.tt = 0.8; e.dir = Math.sign(dx) || e.dir; }
        } else if (e.state === 'charge') { // разгорается дуга — направление уже не меняет
          if ((e.tt -= dt) <= 0) {
            const d = e.dir || 1, ox = e.x + e.w / 2 + d * 29, oy = e.y + e.h - 32;
            for (let k = 0; k < 6; k++) {
              const a = -0.1 - k * 0.21 + api.rand(-0.05, 0.05), sp = api.rand(170, 235);
              api.shoot({ x: ox, y: oy, w: 7, h: 7, vx: d * Math.cos(a) * sp, vy: Math.sin(a) * sp, gravity: 560, life: 0.9, color: '#ffd36a', pts: 5, draw: drawSpark, update: sparkUpd });
            }
            api.burst(ox, oy, '#bfe8ff', 6, 120, 200);
            e.state = 'cool'; e.tt = 0.45;
          }
        } else if ((e.tt -= dt) <= 0) { e.state = 'walk'; e.cd = api.rand(1.6, 2.4); }
      },
      draw(e, ctx, api) {
        const charge = e.state === 'charge', cool = e.state === 'cool', k = charge ? 1 - e.tt / 0.8 : 0, t = e.t;
        if (charge) { ctx.fillStyle = `rgba(150,215,255,${0.12 + 0.28 * k})`; ctx.beginPath(); ctx.ellipse(28, -1, 10 + 18 * k, 3, 0, 0, TAU); ctx.fill(); } // отсвет дуги на плите
        ctx.fillStyle = '#c93434'; rr(ctx, -19, -33, 6, 22, 2.5); ctx.fill(); ctx.fillStyle = '#5a5566'; ctx.fillRect(-18, -36, 4, 3); // баллон с газом
        ctx.strokeStyle = '#1d1a22'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-16, -36); ctx.quadraticCurveTo(-6, -48, 6, -30); ctx.stroke();
        ctx.fillStyle = '#26222c'; rr(ctx, -16, -10, 32, 10, 5); ctx.fill(); // гусеницы
        ctx.fillStyle = '#5d5866'; for (const wx of [-10, 0, 10]) circle(ctx, wx, -5, 3.2);
        ctx.fillStyle = '#26222c'; for (const wx of [-10, 0, 10]) circle(ctx, wx, -5, 1.2);
        ctx.fillStyle = '#77727f'; for (let j = 0; j < 7; j++) ctx.fillRect(-14 + (((j * 4 - e.tread) % 28) + 28) % 28, -10, 2, 1.6);
        ctx.fillStyle = '#f58a1f'; rr(ctx, -14, -23, 26, 13, 3); ctx.fill(); // корпус
        ctx.fillStyle = '#c86a12'; ctx.fillRect(-14, -13, 26, 3);
        ctx.fillStyle = '#1d1a22'; for (let j = 0; j < 3; j++) ctx.fillRect(-10 + j * 4, -20, 2, 6);
        ctx.fillStyle = '#f2c230'; ctx.fillRect(6, -22, 5, 9); ctx.fillStyle = '#1d1a22'; ctx.fillRect(6, -19, 5, 2); ctx.fillRect(6, -15, 5, 1.5);
        ctx.fillStyle = '#ff9d3a'; rr(ctx, -8, -33, 15, 11, 3); ctx.fill(); // башня
        ctx.fillStyle = '#343946'; rr(ctx, -7, -44, 15, 12, 3); ctx.fill(); // голова-маска сварщика
        ctx.fillStyle = charge ? (Math.floor(t * 20) % 2 ? '#4a9d93' : '#23514b') : '#1b3531'; ctx.fillRect(1, -42, 7, 5);
        ctx.fillStyle = charge ? '#ffffff' : '#7ff7ff'; ctx.fillRect(3, -40.5, 4, 1.6);
        ctx.strokeStyle = '#343946'; ctx.lineWidth = 1; line(ctx, -4, -44, -6, -50);
        ctx.fillStyle = Math.sin(t * 6) > 0 ? '#ff5a3c' : '#6a1d15'; circle(ctx, -6, -50.5, 1.5);
        const a1 = charge || cool ? -0.32 : 0.55 + Math.sin(t * 2.5) * 0.12, a2 = charge || cool ? 0.3 : 0.5;
        ctx.save(); ctx.translate(6, -28); ctx.rotate(a1); // рука с горелкой
        ctx.fillStyle = '#f58a1f'; ctx.fillRect(0, -2.5, 11, 5); ctx.fillStyle = '#343946'; circle(ctx, 0, 0, 2.8); circle(ctx, 11, 0, 2.6);
        ctx.translate(11, 0); ctx.rotate(a2);
        ctx.fillStyle = '#e07a14'; ctx.fillRect(0, -2, 8, 4); ctx.fillStyle = '#4b4b57'; ctx.fillRect(7, -1.5, 5, 3);
        if (charge) { // дуга разгорается: растущий голубой ореол и треск разрядов
          const r = 3 + 9 * k + Math.sin(t * 50) * 1.5;
          ctx.fillStyle = 'rgba(120,200,255,.28)'; circle(ctx, 13, 0, r * 1.8);
          ctx.fillStyle = 'rgba(200,238,255,.75)'; circle(ctx, 13, 0, r);
          ctx.fillStyle = '#fff'; circle(ctx, 13, 0, 1.5 + 2 * k);
          ctx.strokeStyle = '#e8f8ff'; ctx.lineWidth = 1; ctx.beginPath();
          for (let j = 0; j < 3; j++) {
            const aa = api.hash(Math.floor(t * 30) * 3 + j) * TAU, L = 6 + 9 * k;
            ctx.moveTo(13, 0); ctx.lineTo(13 + Math.cos(aa) * L * 0.5 + 2, Math.sin(aa) * L * 0.5 - 2); ctx.lineTo(13 + Math.cos(aa) * L, Math.sin(aa) * L);
          }
          ctx.stroke();
        } else { ctx.fillStyle = '#7fc8ff'; circle(ctx, 13, 0, 1.4 + Math.sin(t * 9) * 0.5); }
        ctx.restore();
        for (let j = 0; j < e.maxHp - e.hp; j++) { // дымит от ударов
          const ph = (t * 0.8 + j * 0.5) % 1;
          ctx.fillStyle = `rgba(80,74,90,${0.55 * (1 - ph)})`; circle(ctx, -3 + j * 6 + ph * 3, -46 - ph * 16, 2 + ph * 4);
        }
      },
      onDeath(e, api) { const cx = e.x + e.w / 2, cy = e.y + e.h / 2; api.burst(cx, cy, '#ffd36a', 12, 240, 500); api.burst(cx, cy, '#3a3440', 8, 180, 700); },
    },

    cradle: { // люлька-беглянка: пустая фасадная люлька на двух тросах катается на уровне головы
      w: 60, h: 22, hp: 2, pts: 250, flip: false, hitColor: '#ffe27a', deathColor: '#f2c230',
      init(e, api) {
        e.tilt = 0; e.sw = 0;
        const fits = (cx, bot) => { // под люлькой ровная плита без провалов и уступов (иначе её не перепрыгнуть честно), сверху нет платформ
          for (const x of [cx - e.w / 2 - 6, cx, cx + e.w / 2 + 6]) {
            const g = api.groundAt(x);
            if (g === null || Math.abs(g - bot - 58) > 4) return false;
            for (const p of api.platforms) if (x > p.x - 4 && x < p.x + p.w + 4) return false;
          }
          return true;
        };
        const hc = e.x + e.w / 2;
        for (let k = 0; k <= 16; k++) { // ищем ближайшее свободное место: 0, +40, −40, +80…
          const c = hc + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 40, g = api.groundAt(c), bot = g - 58;
          if (g === null || !fits(c, bot)) continue;
          let a = c, b = c;
          while (a - 8 > c - 170 && fits(a - 8, bot)) a -= 8;
          while (b + 8 < c + 170 && fits(b + 8, bot)) b += 8;
          if (b - a < 60) continue;
          Object.assign(e, { x: c - e.w / 2, y: bot - e.h, groundY: g, lo: a - e.w / 2, hi: b - e.w / 2, vx: 52 * (e.dir || 1) });
          return;
        }
        e.dead = e.gone = true; // вокруг одни платформы и уступы — люльки здесь нет
      },
      update(e, dt) {
        e.x += e.vx * dt;
        if (e.x < e.lo) { e.x = e.lo; e.vx = Math.abs(e.vx); } else if (e.x > e.hi) { e.x = e.hi; e.vx = -Math.abs(e.vx); }
        e.dir = Math.sign(e.vx) || 1;
        e.sw += (-e.vx / 52 * 2.5 - e.sw) * Math.min(1, dt * 2); // корзина чуть отстаёт от тросов
      },
      draw(e, ctx, api) {
        if (e.gone) return;
        const top = api.camY - 8 - (e.y + e.h), sw = e.sw || 0, t = e.t; // тросы уходят за верхний край кадра
        ctx.strokeStyle = '#2a2332'; ctx.lineWidth = 1.3; // тросы уходят к консолям на крыше
        line(ctx, -24, top, -24 + sw, -31);
        if (e.tilt) { ctx.beginPath(); ctx.moveTo(24, top); ctx.lineTo(24, -70); ctx.quadraticCurveTo(30 + Math.sin(t * 3) * 4, -55, 22 + Math.sin(t * 3) * 6, -44); ctx.stroke(); }
        else line(ctx, 24, top, 24 + sw, -31);
        ctx.save(); ctx.translate(sw, 0);
        if (e.tilt) { ctx.translate(-24, -31); ctx.rotate(e.tilt); ctx.translate(24, 31); }
        const ba = Math.sin(t * 2.4) * 0.35; // ведро с краской на верёвке
        ctx.save(); ctx.translate(12, 0); ctx.rotate(ba);
        ctx.strokeStyle = '#3a3440'; ctx.lineWidth = 1; line(ctx, 0, 0, 0, 3);
        ctx.fillStyle = '#e8e4ea'; poly(ctx, [-4, 3, 4, 3, 3, 10, -3, 10]); ctx.fill(); ctx.fillStyle = '#b388ff'; ctx.fillRect(-4, 3, 8, 2); ctx.fillRect(1, 5, 1.5, 3);
        ctx.restore();
        drawBasket(ctx, t);
        if (e.tilt && Math.sin(t * 17) > 0.6) { ctx.fillStyle = '#ffd36a'; for (let j = 0; j < 3; j++) ctx.fillRect(23 + j * 2, -30 + ((t * 80 + j * 7) % 16), 1.5, 1.5); } // искрит оборванная лебёдка
        ctx.restore();
      },
      hurtbox(e) { return { x: e.x, y: e.y, w: e.w, h: e.h + 8 }; }, // вместе с ведром — достаётся рейкой снизу
      onHit(e, api) { if (!e.tilt) { e.tilt = 0.14; api.burst(e.x + e.w - 6, e.y + 2, '#ffd36a', 8, 160); } },
      onDeath(e, api) {
        const cx = e.x + e.w / 2;
        api.burst(cx, e.y + 6, '#f2c230', 12, 220);
        api.shoot({ x: cx, y: e.y + e.h / 2, w: e.w, h: e.h, vx: e.vx * 0.3, vy: -80, gravity: 900, spin: 1.8, hurts: false, destructible: false, life: 2.5, color: '#f2c230',
          draw: (p, c, a) => { c.translate(0, p.h / 2); drawBasket(c, a.now); },
          onLand: (p, a) => { a.burst(p.x + p.w / 2, p.y + p.h, '#c9bccf', 14, 170, 500); a.burst(p.x + p.w / 2, p.y + p.h / 2, '#f2c230', 8, 200); a.shake(4); } });
      },
    },
  };

  Object.assign(enemies, {
    spider: { // монтажный робот-паук: ходит по ярусу и перепрыгивает туда, где стоит герой — 0,9 с приседает, место посадки мигает
      w: 30, h: 20, hp: 2, pts: 320, hitColor: '#ffe27a', deathColor: '#f2c230',
      init(e) { e.state = 'walk'; e.leg = 0; e.st = 0; e.cd = 1.5 + Math.random(); },
      update(e, dt, api) {
        if (e.state === 'walk') {
          const x0 = e.x; api.patrol(e, 40, dt); e.leg += e.x - x0;
          if ((e.cd -= dt) > 0) return;
          const tg = spiderTarget(e, api);
          if (!tg) { e.cd = 0.4; return; }
          Object.assign(e, tg, { state: 'crouch', st: 0.9 }); e.dir = Math.sign(tg.jx - e.x - e.w / 2) || e.dir;
        } else if (e.state === 'crouch') {
          if ((e.st -= dt) > 0) return;
          Object.assign(e, { state: 'jump', u: 0, sx: e.x + e.w / 2, sy: e.y + e.h });
          e.arc = e.jy < e.sy ? 34 + (e.sy - e.jy) * 0.55 : 40; api.sfx('jump');
        } else if (e.state === 'jump') { // парабола: по X равномерно, по Y — с подлётом выше точки посадки
          const u = e.u = Math.min(1, e.u + dt / e.dur);
          e.x = lerp(e.sx, e.jx, u) - e.w / 2; e.y = lerp(e.sy, e.jy, u) - e.arc * 4 * u * (1 - u) - e.h;
          if (u < 1) return;
          Object.assign(e, { groundY: e.jy, minX: e.nMin, maxX: e.nMax, state: 'land', st: 0.7 });
          api.burst(e.x + e.w / 2, e.jy, '#cbbfd0', 10, 150, 500); api.shake(2);
        } else if ((e.st -= dt) <= 0) { e.state = 'walk'; e.cd = api.rand(2, 3); }
      },
      draw(e, ctx, api) {
        const st = e.state, t = e.t, crouch = st === 'crouch', jump = st === 'jump', land = st === 'land';
        if ((crouch || jump) && e.jx != null) { // место посадки: мигающее кольцо и пунктир дуги (в мировых осях)
          ctx.save(); ctx.scale(e.dir || 1, 1);
          const ox = e.x + e.w / 2, oy = e.y + e.h, mx = e.jx - ox, my = e.jy - oy, on = Math.floor(t * 10) % 2;
          ctx.strokeStyle = on ? '#ff3b30' : '#ffd23a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(mx, my - 1, 18, 4, 0, 0, TAU); ctx.stroke();
          ctx.fillStyle = 'rgba(255,59,48,.25)'; ctx.beginPath(); ctx.ellipse(mx, my - 1, 18, 4, 0, 0, TAU); ctx.fill();
          if (crouch) {
            const sx = 0, sy = -e.h / 2, arc = my < 0 ? 34 - my * 0.55 : 40;
            ctx.strokeStyle = 'rgba(255,210,60,.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]); ctx.beginPath();
            for (let k = 0; k <= 12; k++) { const u = k / 12, x = lerp(sx, mx, u), y = lerp(sy, my - e.h / 2, u) - arc * 4 * u * (1 - u); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
            ctx.stroke(); ctx.setLineDash([]);
          }
          ctx.restore();
        }
        const squash = crouch ? 5 + Math.sin(t * 40) * 0.8 : land ? 3 * Math.min(1, e.st / 0.3) : 0, by = -12 + squash;
        const walk = st === 'walk', ph = e.leg * 0.25;
        ctx.strokeStyle = '#3a3440'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath(); // четыре пары ног: колено вверх
        for (let k = 0; k < 4; k++) {
          const hx = -9 + k * 6, sw = walk ? Math.sin(ph + k * 1.6) * 3 : 0, fx = jump ? hx * 1.6 + (k < 2 ? -6 : 6) : hx * 1.5 + (k < 2 ? -4 : 4) + sw;
          const fy = jump ? by + 12 : 0, kx = (hx + fx) / 2 + (k < 2 ? -4 : 4), ky = jump ? by + 2 : by - 8 + squash * 0.3 - (walk ? Math.max(0, sw) : 0);
          ctx.moveTo(hx, by + 2); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy);
        }
        ctx.stroke();
        ctx.fillStyle = '#2f2c33'; ctx.beginPath(); ctx.ellipse(0, by, 13, 7, 0, 0, TAU); ctx.fill();              // корпус
        ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.ellipse(0, by - 2, 12, 5.5, 0, Math.PI, 0); ctx.fill();   // жёлтый колпак
        ctx.fillStyle = '#1d1a22'; for (let k = 0; k < 3; k++) ctx.fillRect(-8 + k * 5, by - 6, 2.5, 4);          // полосы
        ctx.fillStyle = '#4c5566'; ctx.fillRect(7, by - 3, 8, 5);                                                    // голова с сенсором
        const eye = crouch ? (Math.floor(t * 14) % 2 ? '#ff3b30' : '#ffd23a') : '#ff5a3c';
        ctx.fillStyle = eye; circle(ctx, 13, by - 0.5, 2);
        if (crouch) { ctx.fillStyle = 'rgba(255,60,50,.3)'; circle(ctx, 13, by - 0.5, 5); }
        ctx.strokeStyle = '#4c5566'; ctx.lineWidth = 1.2; line(ctx, -4, by - 7, -7, by - 14);                      // антенна
        ctx.fillStyle = Math.sin(t * 5) > 0 ? '#7dff9a' : '#2f7a45'; circle(ctx, -7, by - 14.5, 1.5);
        for (let j = 0; j < e.maxHp - e.hp; j++) { const q = (t * 0.9 + j * 0.5) % 1; ctx.fillStyle = `rgba(80,74,90,${(0.5 * (1 - q)).toFixed(3)})`; circle(ctx, -2 + q * 3, by - 10 - q * 14, 2 + q * 3); }
      },
      onDeath(e, api) { const cx = e.x + e.w / 2, cy = e.y + e.h / 2; api.burst(cx, cy, '#f2c230', 10, 200, 500); api.burst(cx, cy, '#3a3440', 8, 160, 700); },
    },

    drone: { // дрон технадзора: следует за героем по воздуху, над ним 0,95 с светит прожектором (жёлтый → красный) и роняет мешок болтов
      w: 34, h: 14, hp: 1, pts: 180, flip: false, hitColor: '#e6f4ff', deathColor: '#9aa3b4',
      init(e) { e.homeX = e.x; e.baseY = Math.max(e.y, Math.min(60, e.groundY - 125)); e.y = e.baseY; e.state = 'fly'; e.vx = 0; e.st = 0; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e);
        if (e.state === 'fly') {
          const want = Math.abs(dx) < 360 ? api.clamp(dx * 1.6, -90, 90) : Math.sin(e.t * 0.6) * 35;
          e.vx += (want - e.vx) * Math.min(1, dt * 1.6);
          e.x = api.clamp(e.x + e.vx * dt, e.homeX - 260, e.homeX + 260);
          e.y += (e.baseY + Math.sin(e.t * 1.9) * 6 - e.y) * Math.min(1, dt * 3);
          e.cd -= dt;
          if (e.cd <= 0 && Math.abs(dx) < 24 && P.y > e.y + 40 && P.y - e.y < 300 && onScreen(e, api)) { e.state = 'scan'; e.st = 0.95; e.coneY = P.y + P.h; }
        } else if (e.state === 'scan') { // завис: прожектор сужается и краснеет — пора отойти
          e.vx *= Math.max(0, 1 - dt * 8); e.x += e.vx * dt;
          if ((e.st -= dt) <= 0) {
            api.shoot({ x: e.x + e.w / 2, y: e.y + e.h + 5, w: 12, h: 11, vx: 0, vy: 30, gravity: 900, life: 2.5, pts: 15, color: '#8a7a5a', source: e, draw: drawBoltBag,
              onLand: (p, a) => { a.burst(p.x + p.w / 2, p.y + p.h, '#c9c2cf', 10, 150, 600); a.burst(p.x + p.w / 2, p.y + p.h, '#8a7a5a', 5, 90, 500); } });
            e.state = 'cool'; e.st = 0.6;
          }
        } else if ((e.st -= dt) <= 0) { e.state = 'fly'; e.cd = api.rand(2.2, 3.2); }
      },
      draw(e, ctx) {
        const t = e.t, scan = e.state === 'scan', tilt = droneTilt(e);
        if (scan && e.coneY != null) { // конус прожектора до опоры под героем
          const k = 1 - Math.max(0, e.st) / 0.95, d = e.coneY - (e.y + e.h), w = 34 - 18 * k, red = k > 0.55 && Math.floor(t * 14) % 2;
          ctx.fillStyle = red ? 'rgba(255,60,50,.28)' : `rgba(255,236,150,${(0.16 + 0.14 * k).toFixed(3)})`;
          poly(ctx, [-3, -2, 3, -2, w, d, -w, d]); ctx.fill();
          ctx.strokeStyle = red ? '#ff3b30' : '#ffd23a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, d - 1, w, 3.5, 0, 0, TAU); ctx.stroke();
        }
        ctx.save(); ctx.translate(0, -7); ctx.rotate(tilt);
        ctx.strokeStyle = '#2f2c33'; ctx.lineWidth = 2; line(ctx, -13, -2, 13, -2);                        // лучи рамы
        ctx.fillStyle = '#2f2c33'; ctx.fillRect(-15, -5, 3, 4); ctx.fillRect(12, -5, 3, 4);
        const sp = Math.abs(Math.sin(t * 60)) * 8 + 2;                                                        // винты
        ctx.fillStyle = 'rgba(220,230,240,.55)'; ctx.fillRect(-13.5 - sp, -7, sp * 2, 1.6); ctx.fillRect(13.5 - sp, -7, sp * 2, 1.6);
        ctx.fillStyle = '#e8e4ea'; rr(ctx, -8, -4, 16, 8, 3); ctx.fill();                                   // корпус
        ctx.fillStyle = '#b388ff'; ctx.fillRect(-8, -1, 16, 2);
        ctx.fillStyle = '#3a3440'; ctx.fillRect(-2, 4, 4, 3);                                                // подвес
        ctx.fillStyle = scan ? '#fff4c8' : '#5a5566'; circle(ctx, 0, 7.5, 2.2);                              // прожектор
        if (e.state !== 'cool') { ctx.fillStyle = '#8a7a5a'; ctx.beginPath(); ctx.ellipse(0, 11, 4.5, 3.5, 0, 0, TAU); ctx.fill(); } // мешок в захвате (после сброса — пусто)
        ctx.fillStyle = Math.floor(t * 3) % 2 ? '#ff3b30' : '#7dff9a'; circle(ctx, -6, -4.5, 1.2); circle(ctx, 6, -4.5, 1.2);
        ctx.restore();
      },
      onDeath(e, api) { const cx = e.x + e.w / 2, cy = e.y + e.h / 2; api.burst(cx, cy, '#e8e4ea', 8, 160, 700); api.burst(cx, cy, '#b388ff', 5, 120, 600); },
    },
  });

  // ---------- механика участка: падающие балки ----------
  function surfaceAt(x, api) { // верх ближайшей опоры сверху: платформа, блок или плита (null — пропасть)
    let y = api.groundAt(x);
    if (y === null) return null;
    for (const p of api.platforms) if (x >= p.x && x <= p.x + p.w && p.y < y) y = p.y;
    return y;
  }

  function dropBeam(w, api) { // урон считаем сами (hurts:false): движок гасит ранящий снаряд при касании, а балка должна долететь и лечь
    return api.shoot({ x: w.x, y: w.top + 3, w: BEAM_W, h: 10, vy: 120, gravity: 1150, life: 3, destructible: false, hitsSolids: false, hurts: false, pts: 0, color: '#c24f37',
      draw: (p, ctx) => ibeam(ctx, -BEAM_W / 2, -5, BEAM_W, 10),
      update(p, dt, a) {
        p.rot = Math.sin(a.now * 11) * 0.05;
        if (!p.hitP && a.overlap(p, a.player)) { p.hitP = true; a.hurtPlayer(p.x + p.w / 2); }
        if (p.y + p.h < w.y) return;
        p.y = w.y - p.h; p.dead = true; // грохнулась: пыль, дрожь, балка лежит ещё мгновение
        a.burst(w.x, w.y - 2, '#d3c6d6', 16, 180, 500); a.burst(w.x, w.y - 4, '#ffd36a', 5, 200, 700); a.shake(4);
        st.landed.push({ x: w.x, y: w.y, t: 0, rot: a.rand(-0.05, 0.05) });
        if (st.landed.length > 4) st.landed.shift();
      } });
  }

  function update(dt, api) {
    const P = api.player, now = api.now;
    st.wind = 0.55 + Math.sin(now * 0.5) * 0.35 + Math.sin(now * 2.3) * 0.1;
    // соседние захватки перекрытия изредка стыкуются с перепадом в несколько единиц — поднимаем героя на такой порожек
    if (P.onGround) {
      const feet = P.y + P.h;
      for (const s of api.solids) {
        if (s.y >= feet || s.y < feet - 8) continue;
        if (P.face > 0 ? Math.abs(P.x + P.w - s.x) < 0.01 : Math.abs(P.x - s.x - s.w) < 0.01) { P.y = s.y - P.h; break; }
      }
    }
    for (let i = st.warns.length - 1; i >= 0; i--) {
      const w = st.warns[i];
      w.t -= dt;
      if (!w.p && w.t <= 0) w.p = dropBeam(w, api);
      if ((w.p && w.p.dead) || w.t < -3) st.warns.splice(i, 1);
    }
    for (let i = st.landed.length - 1; i >= 0; i--) if ((st.landed[i].t += dt) > 1.8) st.landed.splice(i, 1);
    if ((st.fallT -= dt) > 0) return;
    st.fallT = 0.5; // неудачный момент — попробуем чуть позже
    if (P.x < 600 || api.progress > 0.93 || st.warns.length >= 2 || api.arena) return;
    const x = P.x + P.w / 2 + P.vx * api.rand(0.9, 1.4) + api.rand(-20, 70), y = surfaceAt(x, api);
    for (const d of [-52, -20, 20, 52]) if (y === null || surfaceAt(x + d, api) !== y) return; // вся балка и запас на отброс — над ровной опорой, не у края
    if (Math.abs(y - P.y - P.h) > 60) return; // балка падает на тот уровень, где герой (а не на ярус вышки над ним)
    // балка висит у верхнего края кадра: на вышке камера поднята — стропа тоже выше
    st.warns.push({ x, y, t: WARN, p: null, top: Math.min(38, Math.max(y - 190, api.camY + 40)) });
    st.fallT = api.rand(6, 9);
  }

  function drawForeground(ctx, api) { // над местом падения: балка сползает со стропы, сыплются болты
    const { now } = api;
    for (const w of st.warns) {
      if (w.p) continue;
      const k = api.clamp(1 - w.t / WARN, 0, 1), ang = 0.1 + 0.2 * k + Math.sin(now * 14) * 0.06 * k;
      const lx = w.x - BEAM_W / 2 + 6, T = w.top - 38, ry = Math.min(api.camY - 8, T); // T — «ноль» стропы; сверху она уходит за край кадра
      ctx.strokeStyle = '#2a2332'; ctx.lineWidth = 1.5; line(ctx, lx, ry, lx, T + 36);
      ctx.save(); ctx.translate(lx, T + 38); ctx.rotate(ang); ibeam(ctx, -6, -3, BEAM_W, 10); ctx.restore();
      ctx.strokeStyle = '#2a2332'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(w.x + 16, ry); ctx.lineTo(w.x + 16, T); ctx.quadraticCurveTo(w.x + 22 + Math.sin(now * 5) * 3, T + 18, w.x + 18, T + 30); ctx.stroke(); // лопнувшая стропа
      ctx.fillStyle = '#3a3040';
      for (let j = 0; j < 4; j++) ctx.fillRect(w.x - 10 + j * 6, T + 52 + ((now * 260 + j * 57) % Math.max(20, w.y - T - 64)), 2.5, 2.5);
    }
  }

  function drawOverlay(ctx, api) { // низкие клочья облаков проплывают перед нижними ярусами каркаса (на вышке — уходят вниз)
    const { W, now, camX, hash } = api, step = 520, off = camX * 1.25 + now * 22;
    if (api.camY < -60) return;
    ctx.fillStyle = 'rgba(250,215,226,.2)';
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 2; i++) {
      ctx.beginPath(); ctx.ellipse(i * step - off + hash(i + 300) * 200, 338 - api.camY * 0.8 + hash(i + 301) * 14, 120 + hash(i + 302) * 80, 9, 0, 0, TAU); ctx.fill();
    }
  }

  registerTheme({
    index: 8, id: 'tower',
    title: 'Небоскрёб', subtitle: 'Монтаж каркаса на высоте 200 метров',
    accent: '#b388ff', dust: '#cbbfd0',
    gen: { length: 3900, groundRange: [220, 292], weights: { pit: 26, platforms: 22, step: 12, obstacle: 14, flat: 26 }, obstacleH: 28, obstacleW: 48 },
    decor: ['stanchion', 'stanchion', 'windsock', 'welder', 'spot', 'sign', 'bottles'],
    enemies,
    enemyTable: [
      { type: 'pigeon', where: 'air', weight: 3 },
      { type: 'welderbot', where: 'ground', weight: 3, from: 0.1 },
      { type: 'cradle', where: 'air', weight: 2, from: 0.2 },
      { type: 'welderbot', where: 'upper', weight: 1, from: 0.4 },
      { type: 'spider', where: 'upper', weight: 3, from: 0.08 },
      { type: 'spider', where: 'ground', weight: 1, from: 0.45 },
      { type: 'drone', where: 'air', weight: 2, from: 0.15 },
    ],
    init() { st.fallT = 6; st.warns.length = 0; st.landed.length = 0; },
    update, drawBackground, drawGround, drawPit, drawPlatform, drawObstacle, drawDecor, drawFinish, drawLadder, drawForeground, drawOverlay,
  });
})();
