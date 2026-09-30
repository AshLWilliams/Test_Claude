'use strict';
// Участок 4 — угольная шахта. Кромешная тьма: видно лишь то, что освещают фонарь на каске и шахтные светильники.
// Контракт темы: см. THEMES.md, образец — 01-city.js.
(() => {
  // ---------- общее ----------
  const TAU = Math.PI * 2;
  const CEIL = 46;                  // нижний край кровли выработки (ниже полосы HUD)
  const SKY = -150;                 // фон рисуется вверх до сюда: при подъёме камеры движок сдвигает его вниз (до ~120)
  const ceilY = api => CEIL + 0.65 * api.camY; // где кровля фона сейчас — в координатах мира (фон сдвинут на −camY·0,35)
  const WARN = 1.2;                 // сколько секунд сыплется порода перед обвалом
  const st = { caveT: 7, warns: [], rubble: [], lights: [] }; // обвалы, завалы после них, источники света кадра
  // Большие градиенты на телефоне дороги (каждый — заливка на весь экран), поэтому стена, грунт и шурфы —
  // из сплошных полос, а мягкий свет считается в маленькой «карте света» (см. drawOverlay).

  const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
  const ellipse = (ctx, x, y, rx, ry) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); };
  const addLight = (x, y, r, a, cool) => { if (st.lights.length < 24) st.lights.push({ x, y, r, a, cool }); }; // экранные координаты
  const flick = (api, k) => (api.hash(k * 13 + Math.floor(api.now * 9)) > 0.97 ? 0.4 : 1); // лампа изредка моргает
  const noop = () => {};
  // Обход особенности движка: после прыжка сверху героя подбрасывает, но не выталкивает из врага, и на следующем
  // кадре он, ещё «внутри» и уже летя вверх, получает урон. Пока враг мигает от удара (e.hit > 0), он не ранит.
  const NOBOX = { x: -1e6, y: -1e6, w: 0, h: 0 };
  const bodyAfterHit = e => (e.hit > 0 ? NOBOX : e);

  function post(ctx, xb, xt, w) { // наклонная стойка крепи: низ за грунтом, верх под верхняком
    ctx.beginPath(); ctx.moveTo(xb - w / 2, 312); ctx.lineTo(xb + w / 2, 312); ctx.lineTo(xt + w / 2, CEIL + 8); ctx.lineTo(xt - w / 2, CEIL + 8); ctx.fill();
  }
  function logEnd(ctx, x, y, r) { // торец бревна с годовыми кольцами
    ctx.fillStyle = '#9a7245'; circle(ctx, x, y, r);
    ctx.strokeStyle = '#5e4126'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#5e4126'; ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
  }
  function drawRock(ctx) { // глыба породы из кровли
    ctx.scale(1.2, 1.2);
    ctx.fillStyle = '#5b5047'; ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(-4, -8); ctx.lineTo(5, -7); ctx.lineTo(9, -1); ctx.lineTo(6, 7); ctx.lineTo(-5, 7); ctx.fill();
    ctx.fillStyle = '#8f8172'; ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(-4, -8); ctx.lineTo(5, -7); ctx.lineTo(1, -2); ctx.fill();
    ctx.fillStyle = '#16161b'; ctx.fillRect(-2, 1, 5, 3); ctx.fillStyle = '#bcd4ff'; ctx.fillRect(0, 1, 1.5, 1.5); // прожилка угля
  }

  // ---------- фон ----------
  const SEAMS = [ // пласты: верх, толщина, цвет, угольный ли (угольные — с блёстками антрацита)
    [54, 18, '#2c2520', 0], [80, 15, '#0e0e13', 1], [104, 30, '#3b3129', 0], [146, 24, '#0d0d12', 1], [182, 20, '#2f2722', 0], [214, 38, '#0f0f14', 1],
  ];
  function drawSeams(ctx, api) {
    const { W, camX, hash, now } = api, off = camX * 0.1, u0 = Math.floor(off / 40) * 40 - 40, n = Math.ceil((W + 80) / 40) + 1;
    for (let b = 0; b < SEAMS.length; b++) {
      const [y0, th, col, coal] = SEAMS[b];
      const top = u => y0 + Math.sin(u * 0.011 + b * 1.7) * 7 + Math.sin(u * 0.043 + b) * 2;
      ctx.fillStyle = col; ctx.beginPath();
      for (let j = 0; j <= n; j++) { const u = u0 + j * 40; ctx.lineTo(u - off, top(u)); }
      for (let j = n; j >= 0; j--) { const u = u0 + j * 40; ctx.lineTo(u - off, top(u) + th + Math.sin(u * 0.019 + b * 2.3) * 4); }
      ctx.fill();
      if (!coal) continue;
      ctx.fillStyle = '#bcd4ff';
      for (let u = Math.floor(off / 23) * 23 - 23; u < off + W + 23; u += 23) {
        const h = hash(u * 3 + b); if (h < 0.5) continue;
        ctx.globalAlpha = 0.15 + 0.85 * Math.max(0, Math.sin(now * 1.3 + h * 40));
        ctx.fillRect(u - off + h * 18, top(u) + 3 + h * (th - 7), 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawBackground(ctx, api) {
    const { W, H, camX, hash, now } = api;
    st.lights.length = 0; // источники света собираются заново каждый кадр: фон, декор, финиш
    ctx.fillStyle = '#1b1612'; ctx.fillRect(0, SKY, W, H - SKY);   // стена выработки: к середине чуть светлее
    ctx.fillStyle = '#231c17'; ctx.fillRect(0, 96, W, 150);
    drawSeams(ctx, api); // дальний план: пласты породы и угля

    // второй план: устья боковых штреков — рамы крепи уходят в темноту к далёкой лампе
    let off = camX * 0.25, step = 520;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const v = hash(i + 20); if (v < 0.4) continue;
      const x = i * step - off + v * 200, w = 74, top = 118, c = x + w / 2;
      ctx.fillStyle = '#060608'; ctx.beginPath(); ctx.moveTo(x, 300); ctx.lineTo(x, top + 22); ctx.quadraticCurveTo(c, top - 14, x + w, top + 22); ctx.lineTo(x + w, 300); ctx.fill();
      for (const q of [0.66, 0.42, 0.24]) { // рамы в перспективе: чем дальше, тем меньше и темнее
        const hw = w / 2 * q, t2 = 196 - (196 - top - 18) * q, b2 = 196 + 104 * q;
        ctx.strokeStyle = q > 0.5 ? '#21170d' : q > 0.3 ? '#191109' : '#120c07'; ctx.lineWidth = 5 * q;
        ctx.beginPath(); ctx.moveTo(c - hw, b2); ctx.lineTo(c - hw, t2); ctx.lineTo(c + hw, t2); ctx.lineTo(c + hw, b2); ctx.stroke();
      }
      ctx.fillStyle = '#2a1c11'; ctx.fillRect(x - 6, top + 14, 7, 290 - top); ctx.fillRect(x + w - 1, top + 14, 7, 290 - top); ctx.fillRect(x - 10, top + 8, w + 20, 8);
      ctx.fillStyle = '#ffcf6b'; circle(ctx, c, 188, 1.6);
      addLight(c, 188 + Math.round(-api.camY * 0.35), 40, 0.6 * flick(api, i + 3)); // фон сдвинут движком на −camY·0.35
    }

    // кровля: порода и затяжки над верхняками
    off = camX * 0.45;
    ctx.fillStyle = '#0b0908'; ctx.beginPath(); ctx.moveTo(-10, SKY); // порода кровли уходит вверх за край кадра (камера на вышке)
    for (let u = Math.floor(off / 30) * 30 - 30; u < off + W + 30; u += 30) ctx.lineTo(u - off, CEIL - 6 + hash(u + 7) * 10);
    ctx.lineTo(W + 30, SKY); ctx.fill();
    if (api.camY < -10) { // над кровлей — слоистая порода восстающего (видна лишь с вышки)
      for (const [y0, col] of [[-120, '#15110e'], [-66, '#0e0d10'], [-16, '#17120e']]) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-10, y0 + 30);
        for (let u = Math.floor(off / 40) * 40 - 40; u < off + W + 40; u += 40) ctx.lineTo(u - off, y0 + hash(u + y0) * 12);
        ctx.lineTo(W + 40, y0 + 30); ctx.fill();
      }
    }
    ctx.fillStyle = '#2b1d12'; ctx.fillRect(0, CEIL - 4, W, 7);
    ctx.fillStyle = '#170f08'; for (let u = Math.floor(off / 9) * 9; u < off + W; u += 9) ctx.fillRect(u - off, CEIL - 4, 1, 7);

    // средний план: вентиляционный рукав, кабели по стене, рамы крепи со светильниками
    step = 180;
    const i0 = Math.floor(off / step) - 1, i1 = (off + W) / step + 1;
    const duct = dy => { // рукав-гофра провисает между подвесами
      ctx.beginPath();
      for (let i = i0; i < i1; i++) { const x = i * step - off + 64; if (i === i0) ctx.moveTo(x, CEIL + 20 + dy); ctx.quadraticCurveTo(x + 90, CEIL + 34 + dy, x + 180, CEIL + 20 + dy); }
    };
    duct(1); ctx.lineWidth = 15; ctx.strokeStyle = '#3a2d0c'; ctx.stroke();
    duct(0); ctx.lineWidth = 11; ctx.strokeStyle = '#6e5416'; ctx.stroke();
    ctx.setLineDash([2, 4]); ctx.strokeStyle = '#4a390e'; ctx.stroke(); ctx.setLineDash([]);
    duct(-3); ctx.lineWidth = 1.5; ctx.strokeStyle = '#a3842f'; ctx.stroke();
    for (const [dy, col, lw] of [[0, '#0a0a0a', 2.5], [7, '#7a2e14', 2]]) { // два кабеля на крючьях
      ctx.beginPath();
      for (let i = i0; i < i1; i++) { const x = i * step - off; ctx.moveTo(x + 6, 104 + dy); ctx.quadraticCurveTo(x + 96, 122 + dy, x + 186, 104 + dy); }
      ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.stroke();
    }
    for (let i = i0; i < i1; i++) {
      const x = i * step - off, v = hash(i + 50);
      ctx.fillStyle = '#2c1d11'; post(ctx, x + 2, x + 10, 10); post(ctx, x + 126, x + 118, 10);
      ctx.fillStyle = '#4b3220'; post(ctx, x - 1.5, x + 6.5, 3); post(ctx, x + 122.5, x + 114.5, 3);
      ctx.fillStyle = '#3b2716'; ctx.fillRect(x - 8, CEIL + 2, 144, 12);  // верхняк
      ctx.fillStyle = '#5a3d22'; ctx.fillRect(x - 8, CEIL + 2, 144, 2);
      logEnd(ctx, x - 8, CEIL + 8, 6); logEnd(ctx, x + 136, CEIL + 8, 6);
      ctx.fillStyle = '#6d737a'; ctx.fillRect(x + 60, CEIL + 14, 2, 8);    // подвес рукава
      if (v > 0.55) { // шахтный светильник под верхняком; часть перегорела — тьма гуще
        const lx = x + 96, ly = CEIL + 40, live = v > 0.8, a = live ? flick(api, i) : 0;
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx, CEIL + 14); ctx.lineTo(lx, ly - 6); ctx.stroke();
        ctx.fillStyle = '#23252a'; ctx.beginPath(); ctx.arc(lx, ly - 2, 6, Math.PI, 0); ctx.fill();
        ctx.fillStyle = a === 1 ? '#fff1c2' : a > 0 ? '#9a8a60' : '#3a3630'; circle(ctx, lx, ly + 1, 3.5);
        ctx.strokeStyle = '#3a3c40'; ctx.beginPath(); ctx.moveTo(lx - 4, ly - 1); ctx.lineTo(lx - 2, ly + 5); ctx.moveTo(lx + 4, ly - 1); ctx.lineTo(lx + 2, ly + 5); ctx.moveTo(lx - 4, ly + 2); ctx.lineTo(lx + 4, ly + 2); ctx.stroke();
        if (live) addLight(lx, ly + 3 + Math.round(-api.camY * 0.35), 92, a);
      }
      if (v < 0.35) { // капель с верхняка
        const ph = (now * (0.55 + v) + v * 5) % 1;
        ctx.fillStyle = '#6f97b3'; ctx.fillRect(x + 30 + v * 150, CEIL + 14 + ph * ph * 240, 1.5, 4);
      }
    }

    // ближний план: толстые стойки-подхваты, почти силуэты
    off = camX * 0.8; step = 640;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const v = hash(i + 90); if (v < 0.4) continue;
      const x = i * step - off + v * 300;
      ctx.fillStyle = '#0c0805'; ctx.fillRect(x, CEIL - 12, 16, 330);
      ctx.fillStyle = '#21160d'; ctx.fillRect(x + 2, CEIL - 12, 3, 330);
      ctx.fillStyle = '#6b5a2a'; ctx.fillRect(x + 4, 150, 8, 10); // латунный номерок
      ctx.fillStyle = '#0c0805'; ctx.fillRect(x + 7, 153, 2, 4);
    }
  }

  // ---------- земля, провалы, платформы, препятствия ----------
  function lampPost(ctx, api, px, gy, dir, k) { // столбик с кронштейном и светильником (px — столбик, gy — пол); настоящий источник света
    const a = flick(api, k), x = px + dir * 13, y = gy - 32;
    ctx.fillStyle = '#3f2a17'; ctx.fillRect(px - 2, gy - 46, 4, 46); ctx.fillStyle = '#654529'; ctx.fillRect(px - 2, gy - 46, 1.5, 46);
    ctx.fillStyle = '#2a2c30'; ctx.fillRect(Math.min(px, x) - 1, gy - 46, 16, 3);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 5); ctx.stroke();
    ctx.fillStyle = '#23252a'; ctx.beginPath(); ctx.arc(x, y - 2, 6, Math.PI, 0); ctx.fill();
    ctx.fillStyle = a === 1 ? '#fff4c8' : '#9a8a60'; circle(ctx, x, y + 1, 3.5);
    addLight(x - Math.round(api.camX), y + 3 - Math.round(api.camY), 100, a);
  }

  function drawWall(s, ctx, api) { // целик — уступ породы, забранный крепью: стойки, дощатые затяжки, угольный пласт в окне; поверху настил
    const { H, hash, camY } = api, x = s.x, y = s.y, w = s.w, x1 = x + w, bot = camY + H + 10;
    ctx.fillStyle = '#1a120b'; ctx.fillRect(x - 0.5, y, w + 1, bot - y);
    const n = Math.max(2, Math.round((w - 20) / 70)), bay = (w - 20) / n;
    for (let yy = y + 18, r = 0; yy < bot; yy += 13, r++) { // затяжки: доски между стойками, в окне посередине — пласт
      if (yy + 13 < camY) continue;
      const win = r >= 2 && r <= 4;
      for (let i = 0; i < n; i++) {
        const bx = x + 10 + i * bay;
        if (win && i === (n >> 1)) { // окно без затяжек: видна порода с углём
          ctx.fillStyle = r === 3 ? '#0f0f14' : '#3a3029'; ctx.fillRect(bx, yy, bay, 13);
          if (r === 3) { ctx.fillStyle = '#9bb4d6'; ctx.fillRect(bx + 8 + hash(Math.floor(x)) * 20, yy + 5, 1.6, 1.6); ctx.fillRect(bx + bay - 16, yy + 8, 1.6, 1.6); }
          continue;
        }
        const h = hash(Math.floor(bx) * 7 + r);
        ctx.fillStyle = h > 0.5 ? '#5a3d22' : '#4e3520'; ctx.fillRect(bx + 1, yy + 1, bay - 2, 11);
        ctx.fillStyle = '#7a5634'; ctx.fillRect(bx + 1, yy + 1, bay - 2, 1.5);
        ctx.fillStyle = '#35230f'; ctx.fillRect(bx + 4 + h * (bay - 30), yy + 6, 14, 1); // волокна
      }
    }
    for (let i = 0; i <= n; i++) { // стойки
      const px = x + 10 + i * bay - 5;
      ctx.fillStyle = '#3f2a17'; ctx.fillRect(px, y + 10, 10, bot - y - 10);
      ctx.fillStyle = '#6d4c2c'; ctx.fillRect(px, y + 10, 3, bot - y - 10);
      ctx.fillStyle = '#b9bec4'; for (let yy = y + 24; yy < bot; yy += 26) ctx.fillRect(px + 4, yy, 2, 2); // скобы
    }
    ctx.fillStyle = '#3b2716'; ctx.fillRect(x, y + 8, w, 10); ctx.fillStyle = '#5a3d22'; ctx.fillRect(x, y + 8, w, 2); // верхняк
    logEnd(ctx, x + 5, y + 13, 5.5); logEnd(ctx, x1 - 5, y + 13, 5.5);
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - 2, y, w + 4, 8);                                        // настил
    ctx.fillStyle = '#a57c4c'; ctx.fillRect(x - 2, y, w + 4, 2);
    ctx.fillStyle = '#3f2a17'; for (let k = x + 16; k < x1; k += 30) ctx.fillRect(k, y, 1.5, 8);
    for (const r of st.rubble) if (r.x > x + 8 && r.x < x1 - 8 && Math.abs(r.y - y) <= 1) { ctx.fillStyle = '#4e443c'; ctx.beginPath(); ctx.moveTo(r.x - 14, y); ctx.lineTo(r.x - 4, y - 6); ctx.lineTo(r.x + 13, y); ctx.fill(); }
    lampPost(ctx, api, x1 - 20, y, -1, Math.floor(x)); // светильник у дальнего края
  }

  function drawGround(s, ctx, api) { // порода с угольной мелочью, по верху — узкоколейка
    if (s.wall) { drawWall(s, ctx, api); return; }
    const { H, hash } = api;
    ctx.fillStyle = '#231d19'; ctx.fillRect(s.x - 0.5, s.y, s.w + 1, H - s.y + 10); // +1 — без щелей на стыках
    ctx.fillStyle = '#342c25'; ctx.fillRect(s.x - 0.5, s.y + 8, s.w + 1, 16);
    ctx.fillStyle = '#161210'; ctx.fillRect(s.x - 0.5, s.y + 66, s.w + 1, H - s.y);
    ctx.fillStyle = 'rgba(8,8,12,.6)'; ctx.fillRect(s.x, s.y + 24, s.w, 10); ctx.fillRect(s.x, s.y + 56, s.w, 6); // угольные прослойки
    ctx.fillStyle = 'rgba(140,118,92,.2)'; ctx.fillRect(s.x, s.y + 38, s.w, 2);
    for (let x = s.x + 6; x < s.x + s.w - 8; x += 17) { const h = hash(Math.floor(x) * 5 + 1); ctx.fillStyle = h > 0.5 ? '#121216' : '#4c4238'; ctx.fillRect(x, s.y + 12 + h * 60, 3 + h * 5, 2 + h * 2); }
    // полотно узкоколейки: подсыпка из угольной мелочи, торцы шпал, рельс
    ctx.fillStyle = '#1c1916'; ctx.fillRect(s.x - 0.5, s.y, s.w + 1, 10);
    ctx.fillStyle = '#5a3d25'; for (let x = s.x + 4; x < s.x + s.w - 6; x += 13) ctx.fillRect(x, s.y + 3, 8, 5);
    ctx.fillStyle = '#626a73'; ctx.fillRect(s.x - 0.5, s.y, s.w + 1, 3);
    ctx.fillStyle = '#c3ccd5'; ctx.fillRect(s.x - 0.5, s.y, s.w + 1, 1);
    for (const r of st.rubble) { // завал после обвала
      if (r.x < s.x + 8 || r.x > s.x + s.w - 8 || Math.abs(r.y - s.y) > 1) continue;
      ctx.fillStyle = '#4e443c'; ctx.beginPath(); ctx.moveTo(r.x - 14, s.y); ctx.lineTo(r.x - 6, s.y - 5); ctx.lineTo(r.x + 3, s.y - 6); ctx.lineTo(r.x + 13, s.y); ctx.fill();
      ctx.fillStyle = '#8f8172'; ctx.fillRect(r.x - 6, s.y - 5, 5, 2); ctx.fillStyle = '#16161b'; ctx.fillRect(r.x + 3, s.y - 3, 4, 3);
    }
  }

  function drawPit(p, ctx, api) { // шурф: ствол с венцовой крепью и лестницей, уходящей в темноту
    const { H } = api;
    ctx.fillStyle = '#1d150f'; ctx.fillRect(p.x, p.y, p.w, H - p.y);
    ctx.fillStyle = '#2a1e14'; for (let x = p.x + 10; x < p.x + p.w - 10; x += 12) ctx.fillRect(x, p.y, 1, 140); // доски задней стенки
    for (let y = p.y + 2, k = 0; y < p.y + 140; y += 14, k++) { // венцы крепи по стенкам
      ctx.fillStyle = k % 2 ? '#43301c' : '#3a2816'; ctx.fillRect(p.x, y, 8, 12); ctx.fillRect(p.x + p.w - 8, y, 8, 12);
    }
    const lx = p.x + p.w / 2 - 11; // лестница торчит над краем и уходит вниз
    ctx.fillStyle = '#7a5836'; ctx.fillRect(lx, p.y - 16, 3, H - p.y + 16); ctx.fillRect(lx + 19, p.y - 16, 3, H - p.y + 16);
    ctx.fillStyle = '#6a4a2c'; for (let y = p.y - 11; y < p.y + 150; y += 11) ctx.fillRect(lx + 3, y, 16, 2);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; // темнота сгущается ступенями: 30 % → 100 %
    for (let k = 0; k < 4; k++) ctx.fillRect(p.x, p.y + 20 + k * 22, p.w, H - p.y);
    ctx.fillStyle = '#000'; ctx.fillRect(p.x, p.y + 108, p.w, H - p.y);
    const bx = p.x - 24; // ограждение с отражающей полосой (она же светится в темноте — см. drawOverlay)
    ctx.fillStyle = '#5a3d22'; ctx.fillRect(bx, p.y - 22, 3, 22); ctx.fillRect(bx + 17, p.y - 22, 3, 22);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#111' : '#f2c230'; ctx.fillRect(bx - 1 + i * 4.4, p.y - 20, 4.4, 4); }
  }

  // опоры вышки: каждая стойка стоит на ближайшем настиле под ней или на почве (считаем один раз)
  const legs = new WeakMap();
  function towerLegs(p, api) {
    let L = legs.get(p);
    if (!L) {
      L = [];
      for (let i = 0; i <= 2; i++) {
        const lx = p.x + 8 + i * (p.w - 16) / 2;
        let b = api.groundAt(lx) ?? p.base;
        for (const q of api.platforms) if (q !== p && q.y > p.y && q.y < b && lx >= q.x && lx <= q.x + q.w) b = q.y;
        L.push([lx, b]);
      }
      legs.set(p, L);
    }
    return L;
  }
  function drawTimberTower(p, ctx, api) { // вышка в восстающем: бревенчатые стойки, дощатые раскосы, на каждом ярусе — светильник
    const L = towerLegs(p, api), y = p.y;
    for (let i = 0; i < L.length - 1; i++) { // раскосы-доски и схватки между стойками
      const [xa, ba] = L[i], [xb, bb] = L[i + 1], b = Math.min(ba, bb);
      for (let yy = y + 10; yy < b - 10; yy += 60) {
        const y2 = Math.min(b - 2, yy + 60);
        ctx.strokeStyle = '#3b2716'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(xa, yy); ctx.lineTo(xb, y2); ctx.stroke();
        ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xa, yy - 1.5); ctx.lineTo(xb, y2 - 1.5); ctx.stroke();
        ctx.fillStyle = '#4a3220'; ctx.fillRect(xa, yy - 2, xb - xa, 4);
      }
    }
    for (const [lx, b] of L) { // круглые стойки с подкладкой
      ctx.fillStyle = '#3f2a17'; ctx.fillRect(lx - 4, y + 8, 8, b - y - 8);
      ctx.fillStyle = '#654529'; ctx.fillRect(lx - 4, y + 8, 2.5, b - y - 8);
      ctx.fillStyle = '#2a1b0f'; ctx.fillRect(lx - 7, y + 7, 14, 4); ctx.fillRect(lx - 7, b - 3, 14, 3);
    }
    // светильники над настилами — в стороне от лестниц (ярус 1: лестницы у краёв, ярус 2: слева, ярус 3: посередине)
    if (p.tier === 1) lampPost(ctx, api, p.x + p.w * 0.5 - 10, y, -1, Math.floor(p.x) + 1);
    else if (p.tier === 2) lampPost(ctx, api, p.x + p.w - 14, y, -1, Math.floor(p.x) + 2);
    else lampPost(ctx, api, p.x + 14, y, 1, Math.floor(p.x) + 3);
    if (p.tier === 3) { // табличка на верхнем ярусе
      const sx = p.x + 62;
      ctx.fillStyle = '#b3261e'; ctx.fillRect(sx - 27, y + 12, 54, 13); ctx.fillStyle = '#f5d63d'; ctx.fillRect(sx - 26, y + 13, 52, 11);
      api.text('ВОССТАЮЩИЙ', sx, y + 21.5, 6, '#111');
    }
  }

  function drawPlatform(p, ctx, api) { // дощатый полок: нижний — на стойках, верхний — подвешен к кровле на цепях
    if (p.tower) drawTimberTower(p, ctx, api);
    else if (p.tier === 2) {
      const top = Math.min(ceilY(api) + 4, p.y - 20); // цепи — до кровли фона, где бы ни была камера
      ctx.strokeStyle = '#6d737a'; ctx.lineWidth = 2; ctx.setLineDash([3, 2]);
      ctx.beginPath(); for (const cx of [p.x + 6, p.x + p.w - 6]) { ctx.moveTo(cx, top); ctx.lineTo(cx, p.y); } ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#44494f'; for (const cx of [p.x + 6, p.x + p.w - 6]) ctx.fillRect(cx - 3, p.y - 3, 6, 4);
    } else {
      const n = Math.max(2, Math.round(p.w / 64));
      ctx.strokeStyle = '#3b2716'; ctx.lineWidth = 3; ctx.beginPath();
      for (let i = 0; i < n; i++) { const x = p.x + 6 + i * (p.w - 12) / n; ctx.moveTo(x, p.base - 4); ctx.lineTo(x + (p.w - 12) / n, p.y + 12); }
      ctx.stroke();
      for (let i = 0; i <= n; i++) { // круглые стойки с подкладкой
        const x = p.x + 6 + i * (p.w - 12) / n;
        ctx.fillStyle = '#3f2a17'; ctx.fillRect(x - 3.5, p.y + 8, 7, p.base - p.y - 8);
        ctx.fillStyle = '#654529'; ctx.fillRect(x - 3.5, p.y + 8, 2, p.base - p.y - 8);
        ctx.fillStyle = '#2a1b0f'; ctx.fillRect(x - 6, p.y + 7, 12, 4);
      }
    }
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 8);
    ctx.fillStyle = '#a57c4c'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 2);
    ctx.fillStyle = '#3f2a17'; for (let x = p.x + 16; x < p.x + p.w; x += 30) ctx.fillRect(x, p.y, 1.5, 8);
    ctx.fillStyle = '#b9bec4'; for (let x = p.x + 12; x < p.x + p.w; x += 30) { ctx.fillRect(x, p.y + 3, 1.5, 1.5); ctx.fillRect(x + 8, p.y + 3, 1.5, 1.5); }
    logEnd(ctx, p.x - 6, p.y + 4, 4); logEnd(ctx, p.x + p.w + 6, p.y + 4, 4);
  }

  function drawLadder(l, ctx) { // деревянная лестница, как в шурфах: брусья-тетивы и перекладины, торчит над краем
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(l.x + 3, l.top, l.w - 2, l.bottom - l.top);
    ctx.fillStyle = '#7a5836'; ctx.fillRect(l.x, l.top - 14, 3.5, l.bottom - l.top + 14); ctx.fillRect(l.x + l.w - 3.5, l.top - 14, 3.5, l.bottom - l.top + 14);
    ctx.fillStyle = '#a57c4c'; ctx.fillRect(l.x, l.top - 14, 1.2, l.bottom - l.top + 14);
    ctx.fillStyle = '#6a4a2c'; for (let y = l.top + 6; y < l.bottom; y += 12) ctx.fillRect(l.x + 3, y, l.w - 6, 2.5);
    ctx.fillStyle = '#f2c230'; ctx.fillRect(l.x - 1, l.top - 16, 5, 3); ctx.fillRect(l.x + l.w - 4, l.top - 16, 5, 3); // отражатели на концах
  }

  function drawObstacle(s, ctx, api) { // гружёная вагонетка (стоит на месте) или клеть из брусьев — «костёр»
    const { hash } = api, x = s.x, y = s.y, w = s.w, h = s.h;
    if (s.stack >= 2) { // костровая крепь: ряды брусьев вдоль и торцами
      for (let r = 0, yy = y; yy < y + h - 1; r++, yy += 10) {
        if (r % 2 === 0) {
          ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x, yy, w, 10);
          ctx.fillStyle = '#a57c4c'; ctx.fillRect(x, yy, w, 2);
          ctx.fillStyle = '#4a3220'; ctx.fillRect(x + 6, yy + 5, w * 0.4, 1); ctx.fillRect(x + w * 0.55, yy + 7, w * 0.3, 1);
        } else {
          ctx.fillStyle = '#1a120b'; ctx.fillRect(x + 4, yy, w - 8, 10);
          logEnd(ctx, x + 6, yy + 5, 5); logEnd(ctx, x + w - 6, yy + 5, 5); logEnd(ctx, x + w / 2, yy + 5, 5);
        }
      }
      ctx.fillStyle = '#6d737a'; ctx.fillRect(x + w * 0.3, y, 2, h); // стяжная проволока
      return;
    }
    if (s.v < 0.3) { // штабель круглого леса на подкладках, стянут цепью
      ctx.fillStyle = '#2a1b0f'; ctx.fillRect(x + 4, y + h - 3, w - 8, 3);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) logEnd(ctx, x + 5 + c * (w - 10) / 4 + (r % 2) * 2, y + 5 + r * 9, 4.6);
      ctx.strokeStyle = '#8a9096'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 1.5]); ctx.beginPath(); ctx.moveTo(x + w * 0.5, y); ctx.lineTo(x + w * 0.5, y + h); ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    // вагонетка с углём: колёса, клёпаный кузов, горка угля с блёстками
    for (const wx of [x + 11, x + w - 11]) { ctx.fillStyle = '#1b1c20'; circle(ctx, wx, y + h - 5.5, 5.5); ctx.fillStyle = '#6f757c'; circle(ctx, wx, y + h - 5.5, 2.5); }
    ctx.fillStyle = '#26282c'; ctx.fillRect(x + 3, y + h - 12, w - 6, 3);
    ctx.fillStyle = '#4b5663'; ctx.beginPath(); ctx.moveTo(x + 5, y + h - 10); ctx.lineTo(x + w - 5, y + h - 10); ctx.lineTo(x + w, y + 6); ctx.lineTo(x, y + 6); ctx.fill();
    ctx.fillStyle = '#6f7d8c'; ctx.fillRect(x - 1, y + 5, w + 2, 3);
    ctx.fillStyle = '#37414c'; ctx.fillRect(x + 2, y + 14, w - 4, 2);
    ctx.fillStyle = '#8d9aa8'; for (let k = 0; k < 5; k++) ctx.fillRect(x + 5 + k * (w - 10) / 4, y + 10, 1.5, 1.5);
    api.text('№' + (10 + Math.floor(s.v * 80)), x + w / 2, y + h - 12.5, 6, 'rgba(230,230,220,.7)');
    ctx.fillStyle = '#131317'; ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.quadraticCurveTo(x + w * 0.3, y - 2, x + w * 0.5, y + 1); ctx.quadraticCurveTo(x + w * 0.75, y - 3, x + w, y + 6); ctx.fill();
    ctx.fillStyle = '#9bb4d6'; for (let k = 0; k < 4; k++) if (hash(Math.floor(x) + k) > 0.4) ctx.fillRect(x + 6 + k * (w - 12) / 3, y + 1 + (k % 2) * 2, 1.5, 1.5);
  }

  function drawDecor(d, ctx, api) {
    const { now } = api, x = d.x, y = d.y;
    if (d.kind === 'lamp') { // шахтный светильник на стойке — настоящий источник света
      const a = flick(api, Math.floor(x));
      ctx.fillStyle = '#3a2716'; ctx.fillRect(x - 3, y - 60, 6, 60); ctx.fillStyle = '#5a3d22'; ctx.fillRect(x - 3, y - 60, 2, 60);
      ctx.fillStyle = '#2a2c30'; ctx.fillRect(x - 2, y - 57, 16, 3);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 11, y - 54); ctx.lineTo(x + 11, y - 49); ctx.moveTo(x + 2, y - 40); ctx.quadraticCurveTo(x + 8, y - 8, x + 18, y); ctx.stroke();
      ctx.fillStyle = '#23252a'; ctx.beginPath(); ctx.arc(x + 11, y - 45, 6.5, Math.PI, 0); ctx.fill();
      ctx.fillStyle = a === 1 ? '#fff4c8' : '#9a8a60'; circle(ctx, x + 11, y - 42, 4);
      ctx.strokeStyle = '#3a3c40'; ctx.beginPath(); ctx.moveTo(x + 7, y - 44); ctx.lineTo(x + 9, y - 37); ctx.moveTo(x + 15, y - 44); ctx.lineTo(x + 13, y - 37); ctx.stroke();
      addLight(x + 11 - Math.round(api.camX), y - 40 - Math.round(api.camY), 118, a);
    } else if (d.kind === 'helmet') { // каска на гвозде, вбитом в стойку
      ctx.fillStyle = '#3f2a17'; ctx.fillRect(x - 4, y - 50, 8, 50); ctx.fillStyle = '#654529'; ctx.fillRect(x - 4, y - 50, 2, 50);
      ctx.fillStyle = '#a0a6ad'; ctx.fillRect(x + 3, y - 38, 5, 1.5);
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 5, y - 37); ctx.lineTo(x + 3, y - 26); ctx.lineTo(x + 16, y - 26); ctx.stroke();
      ctx.fillStyle = '#f28c1c'; ctx.beginPath(); ctx.arc(x + 10, y - 30, 7.5, Math.PI, 0); ctx.fill(); ctx.fillRect(x + 1, y - 31, 18, 2.5);
      ctx.fillStyle = '#c96d0c'; ctx.fillRect(x + 9, y - 37, 2, 7);
      ctx.fillStyle = '#d9d2a0'; ctx.fillRect(x + 15, y - 34, 3, 3); // фонарь каски выключен
    } else if (d.kind === 'toolbox') { // ящик с инструментом и кайло
      ctx.strokeStyle = '#7a5634'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x + 10, y); ctx.lineTo(x + 22, y - 30); ctx.stroke();
      ctx.strokeStyle = '#9aa1a8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 12, y - 32); ctx.quadraticCurveTo(x + 22, y - 36, x + 32, y - 27); ctx.stroke();
      ctx.fillStyle = '#8b2d24'; ctx.fillRect(x - 16, y - 13, 28, 13); ctx.fillStyle = '#a8392e'; ctx.fillRect(x - 17, y - 15, 30, 4);
      ctx.fillStyle = '#222'; ctx.fillRect(x - 6, y - 19, 8, 2); ctx.fillRect(x - 6, y - 19, 2, 4); ctx.fillRect(x, y - 19, 2, 4);
      ctx.fillStyle = '#c9c9c0'; ctx.fillRect(x - 3, y - 11, 4, 3);
    } else if (d.kind === 'phone') { // шахтный телефон на стойке: железный ящик, трубка, мигающий огонёк
      ctx.fillStyle = '#3f2a17'; ctx.fillRect(x - 3, y - 48, 6, 48);
      ctx.fillStyle = '#3e5a46'; ctx.fillRect(x - 10, y - 52, 20, 24); ctx.fillStyle = '#56785f'; ctx.fillRect(x - 10, y - 52, 20, 3);
      ctx.fillStyle = '#141414'; ctx.fillRect(x + 10, y - 49, 4, 16); ctx.fillRect(x + 8, y - 50, 8, 3); ctx.fillRect(x + 8, y - 35, 8, 3);
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 12, y - 32); ctx.quadraticCurveTo(x + 18, y - 24, x + 8, y - 30); ctx.stroke();
      ctx.fillStyle = '#d6d2c0'; ctx.fillRect(x - 7, y - 46, 12, 5); api.text('ТЕЛ', x - 1, y - 42, 4.5, '#222');
      ctx.fillStyle = Math.sin(now * 3 + x) > 0.6 ? '#ff4a3a' : '#5a1a14'; ctx.fillRect(x - 6, y - 36, 3, 3);
    } else if (d.kind === 'sign') { // табличка «Осторожно, метан!»
      ctx.fillStyle = '#3f2a17'; ctx.fillRect(x - 2, y - 40, 4, 40);
      ctx.fillStyle = '#b3261e'; ctx.fillRect(x - 31, y - 66, 62, 28);
      ctx.fillStyle = '#f5d63d'; ctx.fillRect(x - 29, y - 64, 58, 24);
      api.text('ОСТОРОЖНО,', x, y - 55, 7, '#111');
      api.text('МЕТАН!', x, y - 44, 9, '#b3261e');
    }
  }

  function drawFinish(fx, gy, ctx, api) { // клеть подъёмника в стволе: сверху дневной свет, канаты уходят вверх
    const { now } = api, x = fx + 150, cw = 80, bob = Math.sin(now * 1.4) * 0.8, top = gy - 104 + bob, c = x + cw / 2;
    ctx.fillStyle = '#1d2630'; ctx.fillRect(x - 24, 0, cw + 48, gy);
    ctx.fillStyle = 'rgba(200,228,255,.13)'; ctx.beginPath(); ctx.moveTo(x - 10, 0); ctx.lineTo(x + cw + 10, 0); ctx.lineTo(x + cw + 34, gy); ctx.lineTo(x - 34, gy); ctx.fill();
    ctx.fillStyle = '#38424c'; for (let y = 38; y < top - 20; y += 46) ctx.fillRect(x - 24, y, cw + 48, 6);   // расстрелы
    ctx.fillStyle = '#6b7784'; ctx.fillRect(x - 9, 0, 5, gy); ctx.fillRect(x + cw + 4, 0, 5, gy);          // проводники
    ctx.fillStyle = '#2a1c11'; ctx.fillRect(x - 30, 0, 8, gy); ctx.fillRect(x + cw + 22, 0, 8, gy);         // крепь устья
    ctx.strokeStyle = '#a8b2bc'; ctx.lineWidth = 1.5; ctx.beginPath();                                       // канаты
    ctx.moveTo(c - 5, 0); ctx.lineTo(c - 5, top - 14); ctx.moveTo(c + 5, 0); ctx.lineTo(c + 5, top - 14); ctx.stroke();
    ctx.fillStyle = '#4a545e'; ctx.beginPath(); ctx.moveTo(c - 16, top - 3); ctx.lineTo(c, top - 16); ctx.lineTo(c + 16, top - 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,222,150,.22)'; ctx.fillRect(x, top, cw, gy - top);                             // свет внутри клети
    ctx.fillStyle = '#fff4c8'; circle(ctx, c, top + 10, 3.5);
    ctx.fillStyle = '#56616c'; ctx.fillRect(x - 3, top - 4, cw + 6, 6); ctx.fillRect(x - 3, top, 5, gy - top); ctx.fillRect(x + cw - 2, top, 5, gy - top);
    ctx.fillRect(x, gy - 5, cw, 5); ctx.fillRect(x, top + 50, cw, 3);
    ctx.strokeStyle = '#7d8995'; ctx.lineWidth = 1; ctx.beginPath();                                         // сетка и раздвижная дверь
    for (let k = x + 8; k < x + cw * 0.55; k += 8) { ctx.moveTo(k, top + 2); ctx.lineTo(k, gy - 5); }
    for (let k = 0; k < 6; k++) { const yy = top + 4 + k * 16; ctx.moveTo(x + cw * 0.6, yy); ctx.lineTo(x + cw - 3, yy + 16); ctx.moveTo(x + cw - 3, yy); ctx.lineTo(x + cw * 0.6, yy + 16); }
    ctx.stroke();
    ctx.fillStyle = '#39424b'; ctx.fillRect(x - 20, gy - 3, cw + 40, 3);                                   // посадочная площадка
    const sx = fx + 64, sy = gy - 132;                                                                      // вывеска «Подъём»
    ctx.fillStyle = '#3f2a17'; ctx.fillRect(sx + 34, sy + 28, 4, gy - sy - 28);
    ctx.fillStyle = '#e9efe9'; ctx.fillRect(sx - 2, sy - 2, 76, 32);
    ctx.fillStyle = '#1f8a4c'; ctx.fillRect(sx, sy, 72, 28);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(sx + 11, sy + 4); ctx.lineTo(sx + 18, sy + 13); ctx.lineTo(sx + 4, sy + 13); ctx.fill(); ctx.fillRect(sx + 8, sy + 13, 6, 10);
    api.text('ПОДЪЁМ', sx + 44, sy + 18, 10, '#fff');
    const on = Math.sin(now * 5) > 0;                                                                       // сигнальный фонарь стволового
    ctx.fillStyle = on ? '#6cff8a' : '#1d6b35'; circle(ctx, x + cw + 14, gy - 86, 4);
    const sc = x + cw / 2 - Math.round(api.camX);
    const cy = Math.round(api.camY); addLight(sc, gy - 64 - cy, 210, 1, true); addLight(sc, 70 - cy, 150, 0.8, true);
  }

  // ---------- враги ----------
  function cartPose(ctx, e) { // дребезг перед рывком, наклон на ходу, «клевок» при резкой остановке
    if (e.st === 'rattle') ctx.translate(Math.sin(e.t * 70) * 1.6, -Math.abs(Math.sin(e.t * 45)) * 1.5);
    if (e.st === 'roll') ctx.rotate(0.05);
    if (e.st === 'stop' && e.sT < 0.3) ctx.rotate(-Math.sin(e.sT / 0.3 * Math.PI) * 0.12);
  }
  function cartEyes(ctx, e, bright) { // сердитые глаза-фонари на боковой стенке
    const hot = e.st === 'rattle' || e.st === 'roll';
    for (const ex of [5, 14]) {
      ctx.fillStyle = bright ? (hot ? '#ff6a3c' : '#ffe38a') : (hot ? '#c8402a' : '#d8b860'); ellipse(ctx, ex, -22, 3.2, hot ? 3.4 : 2.6);
      ctx.fillStyle = '#1a0c06'; ctx.fillRect(ex + 0.5, -23, 1.8, 2.5);
    }
  }

  // жаба: куда прыгнуть — на тот же настил/почву к герою или на соседний ярус, где он стоит (не дальше 210 и 130 по высоте)
  const CROUCH = 0.9, HOP = 0.7;
  function toadTarget(e, api) {
    const P = api.player, feet = P.y + P.h, hx = P.x + P.w / 2;
    if (!P.onGround || P.climb) return null;
    let surf = null;
    if (Math.abs(feet - e.groundY) < 3 && hx > e.minX - 30 && hx < e.maxX + 30) surf = { y: e.groundY, x0: e.minX, x1: e.maxX };
    else for (const q of api.platforms) {
      if (Math.abs(q.y - feet) > 3 || Math.abs(q.y - e.groundY) > 130 || hx < q.x || hx > q.x + q.w) continue;
      if (Math.max(q.x - (e.x + e.w), e.x - (q.x + q.w)) > 150) continue; // настил слишком далеко по горизонтали
      surf = { y: q.y, x0: q.x, x1: q.x + q.w };
    }
    if (!surf) return null;
    const c = e.x + e.w / 2, tx = api.clamp(api.clamp(hx, c - 210, c + 210), surf.x0 + e.w / 2 + 2, surf.x1 - e.w / 2 - 2);
    if (surf.x1 - surf.x0 < e.w + 4 || (Math.abs(tx - c) < 20 && surf.y === e.groundY)) return null;
    return { x: tx, y: surf.y, x0: surf.x0, x1: surf.x1 };
  }
  // крот: под землёй виден бугор (он и ранит), рейка его не берёт; вылезает — открыт
  const MOUND = e => ({ x: e.x + 5, y: e.groundY - 8, w: e.w - 10, h: 8 });
  const moleBox = e => (e.st === 'dig' || e.st === 'warn' ? MOUND(e) : e.st === 'up' ? { x: e.x - 15, y: e.y - 6, w: e.w + 30, h: e.h + 6 } : e);

  const enemies = {
    cart: { // вагонетка: стоит, пока герой не подойдёт; дребезжит 0,8 с и катится на него до края отрезка
      w: 44, h: 30, hp: 2, pts: 200, heavy: true, hitColor: '#ffb347', deathColor: '#8e3a22', glowR: 56,
      bodybox: bodyAfterHit,
      init(e) { e.st = 'idle'; e.sT = 0; e.v = 0; e.wheel = 0; e.spark = 0; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e), ox = e.x;
        e.sT += dt;
        if (e.st === 'idle') {
          e.cd -= dt;
          if (Math.abs(dx) < 420 && Math.abs(dx) > 6) e.dir = Math.sign(dx); // глаза следят за героем
          if (e.cd <= 0 && Math.abs(dx) < 300 && Math.abs(P.y + P.h - e.groundY) < 90) {
            const room = e.dir > 0 ? e.maxX - e.x - e.w : e.x - e.minX;
            if (room > 36) { e.st = 'rattle'; e.sT = 0; }
          }
        } else if (e.st === 'rattle') {
          if (e.sT >= 0.8) { e.st = 'roll'; e.sT = 0; e.v = 30; }
        } else if (e.st === 'roll') { // разгон до 260, из-под колёс искры
          e.v = Math.min(260, e.v + 400 * dt);
          e.x += e.dir * e.v * dt;
          e.spark -= dt;
          if (e.spark <= 0) { e.spark = 0.06; api.burst(e.x + e.w / 2 - e.dir * 12, e.y + e.h - 1, '#ffb347', 2, 90, 500); }
          if (e.x <= e.minX || e.x + e.w >= e.maxX) {
            e.x = api.clamp(e.x, e.minX, e.maxX - e.w); e.st = 'stop'; e.sT = 0; e.v = 0; api.shake(3);
            api.burst(e.x + e.w / 2 + e.dir * 22, e.y + e.h - 4, '#7a6e62', 10, 150, 600);
          }
        } else if (e.sT >= 1.3) { e.st = 'idle'; e.cd = api.rand(0.5, 1); }
        e.wheel += e.x - ox;
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2, e.y + 4, '#141418', 14, 200, 700); api.burst(e.x + e.w / 2, e.y + 4, '#9bb4d6', 5, 160, 700); },
      draw(e, ctx) {
        const t = e.t, rat = e.st === 'rattle', roll = e.st === 'roll';
        if (roll) { ctx.fillStyle = 'rgba(210,195,170,.35)'; for (let k = 0; k < 3; k++) ctx.fillRect(-44 - ((t * 320 + k * 11) % 26), -27 + k * 8, 14, 2); }
        cartPose(ctx, e);
        for (const wx of [-12, 12]) { // колёса со спицами
          ctx.fillStyle = '#1b1c20'; circle(ctx, wx, -6.5, 6.5);
          ctx.fillStyle = '#6f757c'; circle(ctx, wx, -6.5, 4.2);
          ctx.strokeStyle = '#2a2c30'; ctx.lineWidth = 1.5; ctx.beginPath();
          for (let k = 0; k < 3; k++) { const a = e.wheel / 6.5 + k * 2.09; ctx.moveTo(wx, -6.5); ctx.lineTo(wx + Math.cos(a) * 4.2, -6.5 + Math.sin(a) * 4.2); }
          ctx.stroke();
        }
        ctx.fillStyle = '#26282c'; ctx.fillRect(-19, -14, 38, 4); ctx.fillRect(21, -21, 4, 7); ctx.fillRect(-25, -18, 4, 3); // рама, буфер, сцепка
        ctx.fillStyle = '#8e3a22'; ctx.beginPath(); ctx.moveTo(-17, -12); ctx.lineTo(17, -12); ctx.lineTo(22, -30); ctx.lineTo(-22, -30); ctx.fill();
        ctx.fillStyle = '#6a2716'; ctx.fillRect(-19, -19, 38, 3); ctx.fillRect(-21, -27, 42, 2);
        ctx.fillStyle = '#d07a50'; for (let k = 0; k < 6; k++) ctx.fillRect(-16 + k * 6.4, -18.5, 1.5, 1.5);
        ctx.fillStyle = '#b8552f'; ctx.fillRect(-23, -31, 46, 3);
        ctx.fillStyle = '#141418'; ctx.beginPath(); ctx.moveTo(-21, -31); ctx.quadraticCurveTo(-12, -41, -2, -36); ctx.quadraticCurveTo(8, -43, 20, -31); ctx.fill();
        for (let k = 0; k < 3; k++) { const hop = rat ? Math.abs(Math.sin(t * 25 + k * 2)) * 5 : 0; ctx.fillStyle = '#1d1d23'; ctx.fillRect(-13 + k * 11, -39 - hop + (k % 2) * 3, 5, 4); }
        ctx.fillStyle = '#9bb4d6'; ctx.fillRect(-8, -36, 1.5, 1.5); ctx.fillRect(9, -38, 1.5, 1.5);
        ctx.fillStyle = '#3d1409'; ctx.beginPath(); ctx.moveTo(1, -29); ctx.lineTo(9, -26); ctx.lineTo(9, -24.5); ctx.lineTo(1, -27); ctx.moveTo(18, -29); ctx.lineTo(10, -26); ctx.lineTo(10, -24.5); ctx.lineTo(18, -27); ctx.fill(); // брови
        cartEyes(ctx, e, false);
        if (e.hp < e.maxHp) { ctx.strokeStyle = '#2a0e06'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-14, -28); ctx.lineTo(-10, -20); ctx.lineTo(-13, -14); ctx.stroke(); } // вмятина
      },
      glow(e, ctx) { // в темноте светятся глаза, при разгоне — искры из-под колёс
        cartPose(ctx, e);
        cartEyes(ctx, e, true);
        if (e.st === 'rattle') { ctx.fillStyle = '#ffd27a'; for (let k = 0; k < 4; k++) { const ph = (e.t * 5 + k / 4) % 1; ctx.fillRect(-12 + (k % 2) * 24 + (ph - 0.5) * 10, -2 - Math.sin(ph * Math.PI) * 6, 1.5, 1.5); } }
        if (e.st === 'roll') {
          for (let k = 0; k < 8; k++) {
            const ph = (e.t * 7 + k / 8) % 1, wx = k % 2 ? -12 : 12;
            ctx.fillStyle = k % 3 ? '#ffcf5a' : '#ff8a2a'; ctx.fillRect(wx - 4 - ph * 26, -1 - Math.sin(ph * 3) * 9, 2, 2);
          }
        }
      },
    },

    toad: { // пещерная жаба на ярусах: приседает 0,9 с (мешок светится, на месте приземления — метка) и прыгает к герою, в т. ч. на соседний ярус
      w: 30, h: 22, hp: 2, pts: 250, hitColor: '#b6d27a', deathColor: '#ffb347', glowR: 48,
      bodybox: bodyAfterHit,
      init(e) { e.st = 'sit'; e.sT = 0; e.tg = null; e.jx = 0; e.jy = 0; },
      update(e, dt, api) {
        const dx = api.dx(e), inView = e.y + e.h > api.camY + 20 && e.y < api.camY + api.H && e.x + e.w > api.camX && e.x < api.camX + api.W;
        e.sT += dt;
        if (e.st === 'sit') {
          if (Math.abs(dx) > 6 && Math.abs(dx) < 400) e.dir = Math.sign(dx);
          e.cd -= dt;
          if (e.cd <= 0 && inView && Math.abs(dx) < 340) {
            const t = toadTarget(e, api);
            if (t) { e.tg = t; e.st = 'crouch'; e.sT = 0; e.dir = t.x > e.x + e.w / 2 ? 1 : -1; } else e.cd = 0.3;
          }
        } else if (e.st === 'crouch') {
          if (e.sT >= CROUCH) { e.st = 'jump'; e.sT = 0; e.jx = e.x; e.jy = e.y; api.burst(e.x + e.w / 2, e.groundY - 2, '#7a6e62', 5, 90, 500); }
        } else if (e.st === 'jump') { // дуга: подъём на высоту яруса + 50, приземление ровно в метку
          const s = Math.min(1, e.sT / HOP), t = e.tg, x1 = t.x - e.w / 2, y1 = t.y - e.h, up = Math.max(0, e.jy - y1) + 50;
          e.x = e.jx + (x1 - e.jx) * s; e.y = e.jy + (y1 - e.jy) * s - up * 4 * s * (1 - s);
          if (s >= 1) {
            e.x = x1; e.y = y1; e.groundY = t.y; e.minX = t.x0; e.maxX = t.x1; e.tg = null; e.st = 'land'; e.sT = 0;
            api.burst(e.x + e.w / 2, e.groundY - 2, '#8a7d70', 8, 130, 600);
            if (inView) api.shake(2);
          }
        } else if (e.sT >= 1.1) { e.st = 'sit'; e.cd = api.rand(0.8, 1.4); }
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2, e.y + 8, '#ff9a2a', 8, 150, 500); },
      draw(e, ctx) { toadBody(e, ctx, false); },
      glow(e, ctx) {
        if (e.st === 'crouch' && e.tg) { // метка приземления: мигающий круг на полу — отсюда надо уйти
          const k = Math.min(1, e.sT / CROUCH), lx = (e.tg.x - (e.x + e.w / 2)) * e.dir, ly = e.tg.y - (e.y + e.h);
          ctx.strokeStyle = `rgba(255,150,60,${0.45 + 0.45 * Math.sin(e.t * 18) * k})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(lx, ly - 1, 10 + 10 * k, 3 + k, 0, 0, TAU); ctx.stroke();
          ctx.fillStyle = 'rgba(255,150,60,.25)'; ctx.beginPath(); ctx.ellipse(lx, ly - 1, 6 + 8 * k, 2 + k, 0, 0, TAU); ctx.fill();
        }
        toadBody(e, ctx, true);
      },
    },

    mole: { // крот-проходчик: бугром ползёт под почвой к герою, у цели 0,9 с трескается земля — и он выскакивает; потом оглушён 1,6 с
      w: 30, h: 26, hp: 2, pts: 250, hitColor: '#c9a27a', deathColor: '#7a5a3a', glowR: 40, knockback: false,
      bodybox: e => (e.hit > 0 ? NOBOX : moleBox(e)),
      hurtbox: moleBox,
      init(e) { e.st = 'dig'; e.sT = 0; e.cd = 0.6; e.crumb = 0; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e), same = Math.abs(P.y + P.h - e.groundY) < 30;
        e.sT += dt; e.cd -= dt;
        if (e.st === 'dig') { // к герою, а после вылазки — немного прочь от него
          const toward = e.cd <= 0, dir = Math.sign(dx) * (toward ? 1 : -1) || e.dir;
          if (Math.abs(dx) > 3 || !toward) { e.dir = dir; e.x = api.clamp(e.x + dir * 58 * dt, e.minX, e.maxX - e.w); }
          const stuck = (e.x <= e.minX + 0.5 && dx < 0) || (e.x >= e.maxX - e.w - 0.5 && dx > 0);
          e.crumb -= dt;
          if (e.crumb <= 0 && e.x > api.camX - 40 && e.x < api.camX + api.W + 40) { e.crumb = 0.12; api.burst(e.x + e.w / 2, e.groundY - 3, '#6e5c48', 1, 60, 500); }
          if (toward && same && (Math.abs(dx) < 26 || (stuck && Math.abs(dx) < 120))) { e.st = 'warn'; e.sT = 0; } // останавливается, не доходя до героя: бугор его не задевает
        } else if (e.st === 'warn') {
          e.crumb -= dt;
          if (e.crumb <= 0 && e.x > api.camX - 40 && e.x < api.camX + api.W + 40) { e.crumb = 0.08; api.burst(e.x + e.w / 2 + api.rand(-20, 20), e.groundY - 2, '#8a7d70', 1, 90, 700); } // скачут камешки
          if (e.sT >= 0.9) { e.st = 'up'; e.sT = 0; api.burst(e.x + e.w / 2, e.groundY - 4, '#7a6e62', 14, 190, 700); if (e.x > api.camX - 40 && e.x < api.camX + api.W + 40) api.shake(3); }
        } else if (e.st === 'up') { if (e.sT >= 0.3) { e.st = 'daze'; e.sT = 0; } }
        else if (e.st === 'daze') { if (e.sT >= 1.6) { e.st = 'down'; e.sT = 0; } }
        else if (e.sT >= 0.4) { e.st = 'dig'; e.sT = 0; e.cd = 1.4; }
      },
      onHit(e, api, source) { // под землёй рейка бьёт по камням; прыжок на бугор выбивает его наружу
        if (e.st !== 'dig' && e.st !== 'warn') return true;
        if (source === 'stomp') { e.st = 'daze'; e.sT = 0; api.burst(e.x + e.w / 2, e.groundY - 4, '#7a6e62', 10, 160, 600); }
        else api.burst(e.x + e.w / 2, e.groundY - 4, '#6e5c48', 5, 120, 600); // рейка лишь сбивает землю с бугра
        return false;
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2, e.groundY - 4, '#6e5c48', 12, 170, 600); },
      draw(e, ctx) {
        const s = e.st, t = e.t;
        if (s === 'dig' || s === 'warn') { // бугор свежей породы; при тревоге — трещины и подпрыгивающие камешки
          const w = s === 'warn' ? 1 + Math.sin(t * 40) * 0.08 : 1, hop = s === 'warn' ? Math.abs(Math.sin(t * 22)) * 3 : 0;
          ctx.fillStyle = '#54463a'; ctx.beginPath(); ctx.ellipse(0, 0, 14 * w, 8 + hop * 0.5, 0, Math.PI, 0); ctx.fill();
          ctx.fillStyle = '#6e5c48'; ctx.beginPath(); ctx.ellipse(-3, -3, 7, 3, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#8a7660'; for (let k = 0; k < 4; k++) ctx.fillRect(-9 + k * 5, -4 - ((t * 6 + k * 0.7) % 1) * 3 - (k % 2) * 2 - hop, 3, 2.5);
          if (s === 'warn') {
            ctx.strokeStyle = '#140c06'; ctx.lineWidth = 1.5; ctx.beginPath();
            for (const sx of [-1, 1]) { ctx.moveTo(sx * 10, 0); ctx.lineTo(sx * 18, -2); ctx.lineTo(sx * 24, 0); ctx.moveTo(sx * 16, -1); ctx.lineTo(sx * 20, -5); }
            ctx.stroke();
            ctx.fillStyle = '#c9c2b0'; ctx.fillRect(4, -9 - hop, 2, 3); ctx.fillRect(7, -8 - hop, 2, 3); // когти показались
          }
          return;
        }
        const rise = s === 'up' ? Math.min(1, e.sT / 0.15) : s === 'down' ? 1 - Math.min(1, e.sT / 0.4) : 1;
        ctx.save(); ctx.beginPath(); ctx.rect(-40, -60, 80, 60); ctx.clip(); ctx.translate(0, (1 - rise) * 26); // вылезает из-под земли
        ctx.fillStyle = '#6b5a4a'; ctx.beginPath(); ctx.ellipse(-1, -11, 12, 13, 0, 0, TAU); ctx.fill();   // тело
        ctx.fillStyle = '#8a7662'; ctx.beginPath(); ctx.ellipse(-4, -15, 6, 7, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e4a0a0'; ctx.beginPath(); ctx.moveTo(9, -16); ctx.lineTo(17, -13); ctx.lineTo(9, -10); ctx.fill(); // нос
        ctx.fillStyle = '#ff9a9a'; circle(ctx, 17, -13, 1.8);
        const claw = s === 'up' ? -8 : Math.sin(t * 6) * 2;
        ctx.fillStyle = '#e4a0a0'; ctx.fillRect(4, -10 + claw, 8, 5); ctx.fillRect(-12, -9 - claw, 6, 5);  // лапы-лопаты
        ctx.fillStyle = '#e8e0d0'; for (let k = 0; k < 3; k++) ctx.fillRect(12, -10 + claw + k * 1.8, 3, 1.2);
        ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.arc(-1, -22, 8, Math.PI, 0); ctx.fill(); ctx.fillRect(-9, -23, 18, 2); // шахтёрская каска (нашёл)
        ctx.fillStyle = '#fff4c8'; ctx.fillRect(5, -27, 3, 3);
        ctx.restore();
        ctx.fillStyle = '#3b3128'; ctx.beginPath(); ctx.ellipse(0, 0, 18, 4, 0, Math.PI, 0); ctx.fill(); // вал земли вокруг норы
      },
      glow(e, ctx, api) {
        const s = e.st;
        if (s === 'warn') { // земля светится трещинами — через 0,9 с он вылетит, задевая всё в полуметре
          const k = Math.min(1, e.sT / 0.9);
          ctx.fillStyle = `rgba(255,120,40,${0.18 + 0.25 * k})`; ctx.beginPath(); ctx.ellipse(0, -1, 30, 4, 0, 0, TAU); ctx.fill(); // зона выброса ±30
          ctx.strokeStyle = `rgba(255,150,60,${0.55 + 0.4 * Math.sin(e.t * 24)})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(0, -1, 30, 4, 0, 0, TAU); ctx.stroke();
          ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 1.5; ctx.beginPath(); // светящиеся трещины расходятся от бугра
          for (const sx of [-1, 1]) { ctx.moveTo(sx * 8, -1); ctx.lineTo(sx * (8 + 10 * k), -2); ctx.lineTo(sx * (10 + 18 * k), 0); }
          ctx.stroke();
          for (let i = 0; i < 3; i++) { const ph = (e.t * 1.6 + i / 3) % 1; ctx.fillStyle = `rgba(230,210,180,${0.4 * (1 - ph) * k})`; ellipse(ctx, -9 + i * 9, -3 - ph * 16, 3 + ph * 4, 2 + ph * 3); } // пыль курится
        }
        if (s === 'dig' || s === 'warn') { ctx.fillStyle = s === 'warn' ? '#ff5a3a' : 'rgba(255,200,120,.55)'; ctx.fillRect(3, -5, 2, 2); ctx.fillRect(7, -5, 2, 2); return; } // глазки из-под земли
        if (s === 'daze') { // звёздочки над каской
          ctx.fillStyle = '#ffe38a';
          for (let k = 0; k < 3; k++) { const a = e.t * 4 + k * 2.1; ctx.fillRect(-1 + Math.cos(a) * 11, -34 + Math.sin(a) * 3, 2.5, 2.5); }
        }
        const rise = s === 'up' ? Math.min(1, e.sT / 0.15) : s === 'down' ? 1 - Math.min(1, e.sT / 0.4) : 1;
        if (rise > 0.5) { ctx.fillStyle = '#fff4c8'; ctx.fillRect(5, -27 + (1 - rise) * 26, 3, 3); }
      },
    },

    methane: { // облако метана: медленно дрейфует к герою; прыгать на него нельзя, рейка разгоняет с одного взмаха
      w: 44, h: 30, hp: 1, pts: 150, stompable: false, knockback: false, hitColor: '#e6f78a', deathColor: '#cde86a', glowR: 50,
      init(e) { e.puff = 0; },
      update(e, dt, api) {
        const P = api.player, dx = P.x + P.w / 2 - (e.x + e.w / 2), dy = P.y + 16 - (e.y + e.h / 2), d = Math.hypot(dx, dy) || 1;
        e.puff = api.clamp(1 - (d - 30) / 110, 0, 1);
        if (d < 360) { e.x += dx / d * 30 * dt; e.y += dy / d * 30 * dt; if (Math.abs(dx) > 4) e.dir = Math.sign(dx); }
        e.x += Math.sin(e.t * 0.8) * 10 * dt; e.y += Math.cos(e.t * 1.1) * 6 * dt; // клубится
        e.x = api.clamp(e.x, e.minX - 200, e.maxX + 200);
        const g = api.groundAt(e.x + e.w / 2);
        const lo = (g === null ? e.groundY : g) - e.h - 2;
        e.y = api.clamp(e.y, Math.min(CEIL + 6, lo), lo);
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2, e.y + e.h / 2, '#cde86a', 18, 140, 40); api.burst(e.x + e.w / 2, e.y + e.h / 2, '#f4ffb0', 6, 90, 20); },
      draw(e, ctx, api) { methaneBody(e, ctx, 1); ctx.scale(e.dir || 1, 1); api.text('CH₄', 0, -3, 7, 'rgba(50,70,10,.8)'); }, // надпись не зеркалим
      glow(e, ctx) { methaneBody(e, ctx, 0.35); },
    },

    beetle: { // жук-камнеед: каменный лоб рейку не берёт — бить сзади или прыгать сверху
      w: 42, h: 22, hp: 2, pts: 200, hitColor: '#d9895b', deathColor: '#6fd6ff', glowR: 46,
      bodybox: bodyAfterHit,
      init(e) { e.st = 'walk'; e.sT = 0; e.clangT = 0; e.rx = e.x; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e), same = Math.abs(P.y + P.h - e.groundY) < 40;
        e.sT += dt; e.clangT = Math.max(0, e.clangT - dt);
        if (e.st === 'walk') { // ползёт вдоль отрезка; видит только вперёд
          api.patrol(e, 34, dt);
          e.cd -= dt;
          const room = e.dir > 0 ? e.maxX - e.x - e.w : e.x - e.minX;
          if (e.cd <= 0 && same && Math.sign(dx) === e.dir && Math.abs(dx) < 170 && room > 40) { e.st = 'scrape'; e.sT = 0; }
          else if (e.cd < -2 && Math.abs(dx) > 260 && Math.random() < dt * 0.5) { e.st = 'chew'; e.sT = 0; }
        } else if (e.st === 'chew') { // грызёт породу
          if (e.sT > 1.4) { e.st = 'walk'; e.cd = 0.5; }
        } else if (e.st === 'scrape') { // роет лапами и щёлкает жвалами — сейчас бросится
          if (e.sT >= 0.8) { e.st = 'rush'; e.sT = 0; e.rx = e.x; }
        } else if (e.st === 'rush') {
          e.x += e.dir * 200 * dt;
          const edge = e.x <= e.minX || e.x + e.w >= e.maxX;
          if (edge || Math.abs(e.x - e.rx) > 150) {
            e.x = api.clamp(e.x, e.minX, e.maxX - e.w); e.st = 'tired'; e.sT = 0;
            api.burst(e.x + e.w / 2 + e.dir * 18, e.y + e.h - 3, '#7a6e62', 6, 110, 600);
          }
        } else if (e.sT >= 1.1) { e.st = 'walk'; e.dir = -e.dir; e.cd = api.rand(1, 1.6); } // отдышался и развернулся
      },
      onHit(e, api, source) {
        if (source !== 'staff' || (api.dx(e) > 0 ? 1 : -1) !== e.dir) return true; // сзади или сверху — по мягкому брюшку
        e.clangT = 0.25; // удар в каменный лоб: звон, искры, героя отталкивает
        api.burst(e.x + e.w / 2 + e.dir * 17, e.y + 6, '#fff2b0', 7, 190, 500);
        api.popup(e.x + e.w / 2, e.y - 12, 'дзынь!', '#cfd8dc');
        api.player.vx = e.dir * 170;
        return false;
      },
      onDeath(e, api) { api.burst(e.x + e.w / 2, e.y + 6, '#6fd6ff', 8, 170, 600); },
      draw(e, ctx) {
        const t = e.t, s = e.st, sc = s === 'scrape', ru = s === 'rush', ti = s === 'tired', ch = s === 'chew';
        const lp = t * (ru ? 30 : s === 'walk' ? 11 : sc ? 22 : 0), low = sc ? 2 : ti ? 2.5 + Math.sin(t * 7) : 0;
        ctx.scale(1.1, 1.1); // рисунок в масштабе 38×20, хитбокс 42×22
        if (ru) { ctx.fillStyle = 'rgba(210,195,170,.35)'; for (let k = 0; k < 3; k++) ctx.fillRect(-40 - ((t * 300 + k * 9) % 22), -16 + k * 5, 12, 1.5); }
        if (sc) { // роет: трясётся, опускает лоб, из-под лап летит порода
          ctx.fillStyle = '#8a7d70'; for (let k = 0; k < 8; k++) { const ph = (t * 4 + k / 8) % 1; ctx.fillRect(-4 - ph * 30, -2 - Math.sin(ph * Math.PI) * (10 + (k % 3) * 5), 2.5, 2.5); }
          ctx.translate(Math.sin(t * 60) * 1.2, 0); ctx.rotate(0.06);
        }
        for (const [col, sh] of [['#1b1f25', 0], ['#303844', Math.PI]]) { // лапы: дальние темнее, ближние светлее
          ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.beginPath();
          for (let k = 0; k < 3; k++) { const lx = -9 + k * 9, sw = Math.sin(lp + k * 2.1 + sh) * 3; ctx.moveTo(lx, -7 + low); ctx.lineTo(lx + 3 + sw, -4); ctx.lineTo(lx + 5 + sw * 1.4, 0); }
          ctx.stroke();
        }
        ctx.fillStyle = '#d9895b'; ellipse(ctx, -12, -9 + low, 9, 7);                     // мягкое брюшко — слабое место
        ctx.strokeStyle = '#a4592f'; ctx.lineWidth = 1; ctx.beginPath();
        for (let k = 0; k < 3; k++) { ctx.moveTo(-18 + k * 4, -15 + low); ctx.lineTo(-18 + k * 4, -3 + low); }
        ctx.stroke();
        ctx.fillStyle = '#48566a'; ctx.beginPath(); ctx.ellipse(1, -6 + low, 16, 13, 0, Math.PI, 0); ctx.fill(); // панцирь
        ctx.fillStyle = '#35404f'; ctx.fillRect(-15, -7 + low, 32, 2);
        ctx.strokeStyle = '#2b3440'; ctx.beginPath(); ctx.moveTo(1, -19 + low); ctx.lineTo(1, -7 + low); ctx.moveTo(-8, -16 + low); ctx.lineTo(-6, -7 + low); ctx.moveTo(10, -16 + low); ctx.lineTo(8, -7 + low); ctx.stroke();
        ctx.strokeStyle = '#8397ab'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(1, -6 + low, 13, 10, 0, Math.PI * 1.15, Math.PI * 1.6); ctx.stroke();
        ctx.fillStyle = '#5fc8f0'; for (const [cx, h] of [[-5, 5], [0, 7], [5, 4]]) { ctx.beginPath(); ctx.moveTo(cx - 2, -17 + low); ctx.lineTo(cx, -17 - h + low); ctx.lineTo(cx + 2, -17 + low); ctx.fill(); } // кристаллы
        const open = ch ? Math.abs(Math.sin(t * 9)) : sc ? 0.8 + Math.sin(t * 30) * 0.2 : ru ? 1 : 0.3 + Math.sin(t * 3) * 0.1;
        ctx.fillStyle = '#23282f'; // жвалы
        for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(22, -8 + low); ctx.quadraticCurveTo(29, -8 + sgn * (2 + open * 4) + low, 30, -8 + sgn * open * 2 + low); ctx.lineTo(24, -8 + sgn * 1 + low); ctx.fill(); }
        ctx.fillStyle = '#6c7a88'; ctx.beginPath(); ctx.moveTo(12, -3 + low); ctx.lineTo(12, -16 + low); ctx.quadraticCurveTo(22, -18 + low, 24, -8 + low); ctx.lineTo(21, -3 + low); ctx.fill(); // каменный лоб-щит
        ctx.fillStyle = '#aebccb'; ctx.fillRect(12, -16 + low, 8, 2);
        ctx.fillStyle = '#4c5866'; circle(ctx, 16, -6 + low, 1.3); circle(ctx, 20, -12 + low, 1.3);
        if (ch && Math.sin(t * 9) > 0) { ctx.fillStyle = '#7a6e62'; ctx.fillRect(31, -12 + low, 2, 2); ctx.fillRect(33, -6 + low, 2, 2); } // крошки породы
        if (ti) { ctx.fillStyle = '#9fd3ff'; const ph = (t * 1.5) % 1; ctx.fillRect(14 + ph * 4, -22 + ph * 10, 1.5, 2.5); } // пот — выдохся
      },
      glow(e, ctx) { // янтарные глаза (красные перед рывком), тусклые кристаллы, вспышка звона на лбу
        const low = e.st === 'scrape' ? 2 : e.st === 'tired' ? 2.5 + Math.sin(e.t * 7) : 0, mad = e.st === 'scrape' || e.st === 'rush';
        ctx.scale(1.1, 1.1);
        if (e.st === 'scrape') { ctx.translate(Math.sin(e.t * 60) * 1.2, 0); ctx.rotate(0.06); }
        ctx.fillStyle = mad ? '#ff4a2a' : '#ffb300'; circle(ctx, 17.5, -11.5 + low, mad ? 2.4 : 1.9);
        ctx.fillStyle = 'rgba(95,200,240,.5)'; ctx.fillRect(-1, -22 + low, 2, 4);
        if (e.clangT > 0) {
          ctx.globalAlpha = e.clangT / 0.25; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(20, -10 + low, 10 - e.clangT * 16, -1.3, 1.3); ctx.stroke(); ctx.globalAlpha = 1;
        }
      },
    },
  };

  function toadBody(e, ctx, bright) { // приземистая пещерная жаба: бородавки с угольной крошкой, горловой мешок светится
    const s = e.st, cr = s === 'crouch', jp = s === 'jump', k = cr ? Math.min(1, e.sT / CROUCH) : 0;
    const breathe = s === 'sit' ? Math.sin(e.t * 3) * 0.8 : 0, sq = cr ? 3 * k : s === 'land' && e.sT < 0.15 ? 3 : 0;
    ctx.translate(0, sq);
    if (!bright) {
      ctx.fillStyle = '#3e4a2e';
      if (jp) { ctx.fillRect(-16, -8, 10, 3); ctx.fillRect(-18, -6, 6, 3); } // задние лапы вытянуты
      else { ctx.beginPath(); ctx.ellipse(-9, -4, 8, 5, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#56663c'; ctx.beginPath(); ctx.ellipse(0, -10 - breathe, 15, 10 - sq * 0.6 + breathe, 0, 0, TAU); ctx.fill(); // тело
      ctx.fillStyle = '#6f8150'; ctx.beginPath(); ctx.ellipse(-2, -14 - breathe, 10, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1b1c20'; for (const [bx, by] of [[-8, -15], [-2, -18], [5, -15], [-10, -9]]) circle(ctx, bx, by - breathe, 1.4); // бородавки-угольки
      ctx.fillStyle = '#3e4a2e'; ctx.fillRect(7, -4, 7, 4); ctx.fillRect(-3, -4, 5, 4);                  // передние лапы
      ctx.fillStyle = '#56663c'; circle(ctx, 9, -18 - breathe, 5);                                        // бугор глаза
    }
    const th = cr ? 3 + k * 5 : 2.5 + Math.sin(e.t * 3) * 0.6; // горловой мешок раздувается перед прыжком
    ctx.fillStyle = bright ? (cr ? '#ff9a2a' : 'rgba(255,190,90,.8)') : '#d9b56a'; ctx.beginPath(); ctx.ellipse(10, -7, th + 2, th, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = bright ? (cr ? '#ff4a2a' : '#ffd54f') : '#e8d890'; circle(ctx, 10, -19 - breathe, 2.6); // глаз
    ctx.fillStyle = '#140c06'; ctx.fillRect(10, -20 - breathe, 1.4, 2.4);
  }

  function methaneBody(e, ctx, a) { // клубы жёлто-зелёного газа и сонная ухмылка
    const t = e.t, sc = 1 + (e.puff || 0) * 0.18;
    ctx.save(); ctx.translate(0, -15); ctx.scale(sc, sc); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(160,205,60,.24)';
    for (let k = 0; k < 6; k++) { const an = k * 1.047 + t * 0.5; circle(ctx, Math.cos(an) * 13, Math.sin(an) * 6, 13 + Math.sin(t * 1.9 + k * 1.3) * 2.5); }
    ctx.fillStyle = 'rgba(210,238,100,.32)';
    for (let k = 0; k < 5; k++) { const an = k * 1.257 - t * 0.7; circle(ctx, Math.cos(an) * 9, Math.sin(an) * 4, 8 + Math.sin(t * 2.3 + k) * 1.5); }
    ctx.fillStyle = 'rgba(240,252,170,.4)'; ellipse(ctx, 2, -1, 10, 6);
    const bl = t % 3.4 < 0.14 ? 0.2 : 1;
    ctx.fillStyle = a < 1 ? '#f4ffa0' : '#3b4a0c'; ellipse(ctx, 4, -3, 2.6, 3 * bl); ellipse(ctx, 12, -3, 2.6, 3 * bl);
    if (a === 1) { ctx.fillStyle = '#f4ffa0'; ctx.fillRect(4.5, -5, 1.2, 1.2); ctx.fillRect(12.5, -5, 1.2, 1.2); }
    ctx.strokeStyle = a < 1 ? '#f4ffa0' : '#3b4a0c'; ctx.lineWidth = 1.2; ctx.beginPath();
    ctx.moveTo(3, 4); ctx.quadraticCurveTo(6, 6 + Math.sin(t * 4), 9, 4); ctx.quadraticCurveTo(12, 2, 15, 4); ctx.stroke();
    ctx.restore();
  }

  // ---------- механика участка: обвалы кровли ----------
  function tryCaveIn(api) { // точка впереди героя над ровной землёй (не у края шурфа и не на перепаде)
    const P = api.player, f = P.face || 1;
    if (api.camY < -20 || P.climb) return false; // герой на вышке или на лестнице — кровля далеко, не сыплем
    for (let k = 0; k < 6; k++) {
      const x = P.x + P.w / 2 + f * api.rand(80, 260), g = api.groundAt(x);
      if (g === null || api.groundAt(x - 46) !== g || api.groundAt(x + 46) !== g) continue;
      if (st.warns.some(w => Math.abs(w.x - x) < 60)) continue;
      if (api.platforms.some(p => x > p.x - 24 && x < p.x + p.w + 24) || api.ladders.some(l => x > l.x - 30 && x < l.x + l.w + 30)) continue;
      st.warns.push({ x, gy: g, t: 0, rock: null, top: ceilY(api) + 4 });
      return true;
    }
    return false;
  }
  function dropRock(w, api) {
    w.rock = api.shoot({
      x: w.x, y: w.top + 4, w: 18, h: 16, vx: 0, vy: 30, gravity: 1100, life: 3, spin: api.rand(-5, 5), color: '#8a7d70', pts: 20, caveRock: true, draw: noop,
      onLand(p, api) {
        const x = p.x + p.w / 2;
        api.burst(x, p.y + p.h, '#8a7d70', 12, 170, 800); api.burst(x, p.y + p.h, '#cbb89a', 6, 80, 150); api.shake(3);
        if (api.groundAt(x) !== null) { st.rubble.push({ x, y: api.groundAt(x) }); if (st.rubble.length > 10) st.rubble.shift(); }
      },
    });
  }
  function stepAssist(api) { // обход особенности генератора: порожек в 1–6 ед. между отрезками герой перешагивает сам
    const P = api.player;
    if (!P.onGround) return;
    const f = P.face || 1, top = api.groundAt(f > 0 ? P.x + P.w + 1 : P.x - 1), feet = P.y + P.h;
    if (top !== null && top < feet - 0.5 && feet - top <= 6) { P.y = top - P.h; P.x += f; }
  }

  function drawWarn(ctx, w, api) { // трещина в кровле, струйки породы, пыльный столб и метка на земле
    const k = Math.min(1, w.t / WARN), top = w.top, x = w.x, gy = w.gy, hash = api.hash, falling = w.t < WARN;
    ctx.strokeStyle = `rgba(255,214,140,${0.35 + 0.55 * k})`; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(x - 6 - 14 * k, top); ctx.lineTo(x - 5, top + 5); ctx.lineTo(x + 3, top + 1); ctx.lineTo(x + 6 + 14 * k, top + 6); ctx.stroke();
    if (falling) {
      ctx.fillStyle = `rgba(215,195,165,${0.08 + 0.12 * k})`; ctx.fillRect(x - 8 - 5 * k, top, 16 + 10 * k, gy - top);
      ctx.fillStyle = '#eadbc0';
      for (let i = 0; i < 10; i++) {
        const ph = (w.t * (1.2 + hash(i + 3) * 0.8) + hash(i * 7)) % 1;
        if (w.t < hash(i * 5) * 0.4) continue; // струйка густеет
        const sz = 1.5 + (i % 3) * 0.8;
        ctx.fillRect(x + (hash(i * 11) - 0.5) * (12 + 12 * k), top + ph * ph * (gy - top), sz, sz);
      }
    }
    ctx.fillStyle = `rgba(255,190,90,${0.2 + 0.35 * k})`; ellipse(ctx, x, gy - 1, 9 + 10 * k, 2.5 + k);
    ctx.fillStyle = `rgba(230,210,180,${0.45 * k})`;
    for (let i = 0; i < 3; i++) { const ph = (w.t * 1.5 + i / 3) % 1; ellipse(ctx, x + (i - 1) * 10 * (0.5 + ph), gy - 2 - ph * 6, 2 + ph * 3, 1.5 + ph * 2); }
  }

  // ---------- темнота и свет ----------
  // Карта света — маленький холст (1 пиксель на LS ед.): заливаем тьмой и «выжигаем» пятна одним радиальным
  // градиентом, затем подкрашиваем их тёплым светом. На экран она ложится одной картинкой без сглаживания —
  // шаги прозрачности меньше 2 %, их не видно, а это в разы дешевле сглаженного масштабирования на телефоне.
  const LS = 2, LM = 24; // шаг карты света и запас по краям (тряска экрана)
  let lm = null, lx = null, lg = null, tg = null;
  function spot(x, y, rx, ry, a, rot) { // пятно: единичный градиент, растянутый в эллипс и повёрнутый
    const c = Math.cos(rot) / LS, s = Math.sin(rot) / LS;
    lx.setTransform(c * rx, s * rx, -s * ry, c * ry, (x + LM) / LS, (y + LM) / LS);
    lx.globalAlpha = a; lx.fillRect(-1, -1, 2, 2);
  }
  function drawOverlay(ctx, api) {
    const { W, H, player: P, now, hash } = api, cx = Math.round(api.camX), cy = Math.round(api.camY); // свет считается в экранных координатах
    const w = Math.ceil((W + LM * 2) / LS), h = Math.ceil((H + LM * 2) / LS);
    if (!lm) lm = document.createElement('canvas');
    if (lm.width !== w || lm.height !== h || !lx) { lm.width = w; lm.height = h; lx = lm.getContext('2d'); lg = null; }
    if (!lg) { // свет фонаря: ясное ядро до 0,28 радиуса (~70 из 250), дальше быстро сгущается тьма
      lg = lx.createRadialGradient(0, 0, 0, 0, 0, 1);
      for (const [o, a] of [[0, 1], [0.28, 1], [0.4, 0.72], [0.55, 0.32], [0.75, 0.08], [1, 0]]) lg.addColorStop(o, `rgba(0,0,0,${a})`);
      tg = lx.createRadialGradient(0, 0, 0, 0, 0, 1); tg.addColorStop(0, 'rgba(255,186,96,.2)'); tg.addColorStop(1, 'rgba(255,160,70,0)');
    }
    lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'source-over'; lx.globalAlpha = 1;
    lx.clearRect(0, 0, w, h); lx.fillStyle = 'rgba(3,4,8,.94)'; lx.fillRect(0, 0, w, h);
    lx.globalCompositeOperation = 'destination-out'; lx.fillStyle = lg;
    const hx = P.x + P.w / 2 - cx, hy = P.y - 2 - cy, f = P.face || 1;
    spot(hx, hy, 250, 250, 1, 0);                              // фонарь на каске: пятно вокруг героя
    spot(hx + f * 150, hy + 30, 240, 64, 0.95, f * 0.12);      // и узкий луч вперёд, чуть вниз
    for (const L of st.lights) spot(L.x, L.y, L.r, L.r, L.a, 0);
    for (const e of api.enemies) { // враги подсвечены своими огоньками — силуэт читается и во тьме
      if (e.dead || e.x + e.w < cx - 60 || e.x > cx + W + 60) continue;
      const r = e.def.glowR || 44, hot = e.st === 'rattle' || e.st === 'roll' || e.st === 'scrape' || e.st === 'rush' || e.st === 'crouch' || e.st === 'warn';
      spot(e.x + e.w / 2 - cx, e.y + e.h / 2 - cy, r, r, hot ? 0.92 : 0.7, 0); // перед атакой — ярче
    }
    lx.globalCompositeOperation = 'source-over'; lx.fillStyle = tg; // тёплая дымка в свете ламп и фонаря
    for (const L of st.lights) if (!L.cool) spot(L.x, L.y, L.r * 0.8, L.r * 0.8, L.a, 0);
    spot(hx + f * 110, hy + 24, 190, 52, 0.7, f * 0.12);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lm, -LM, -LM, w * LS, h * LS);
    ctx.imageSmoothingEnabled = true;

    // то, что должно читаться в темноте: отражатели у шурфов, обвалы, глыбы, глаза врагов
    ctx.save(); ctx.translate(-cx, -cy);
    for (const p of api.pits) {
      if (p.x + p.w < cx - 60 || p.x > cx + W + 60) continue;
      for (let i = 0; i < 5; i += 2) { ctx.fillStyle = 'rgba(242,194,48,.75)'; ctx.fillRect(p.x - 25 + i * 4.4, p.y - 20, 4.4, 4); }
    }
    for (const wn of st.warns) drawWarn(ctx, wn, api);
    for (const p of api.projectiles) if (p.caveRock && !p.dead) { ctx.save(); ctx.translate(p.x + p.w / 2, p.y + p.h / 2); ctx.rotate(p.rot); drawRock(ctx); ctx.restore(); }
    for (const e of api.enemies) {
      if (e.dead || !e.def.glow || e.x + e.w < cx - 40 || e.x > cx + W + 40) continue;
      if (e.hit > 0 && Math.floor(e.hit * 50) % 2) continue; // мигание при попадании, как в движке
      ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h); if (e.def.flip !== false) ctx.scale(e.dir || 1, 1);
      e.def.glow(e, ctx, api); ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = '#fff1c8'; // пылинки в луче фонаря
    for (let k = 0; k < 14; k++) {
      const u = (hash(k * 7 + 1) + now * (0.04 + 0.02 * (k % 3))) % 1;
      ctx.globalAlpha = 0.55 * Math.sin(u * Math.PI);
      ctx.fillRect(hx + f * (16 + u * 260), hy + 20 + (hash(k * 13 + 5) - 0.5) * 70 + u * 34 + Math.sin(now * 0.9 + k) * 6, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
  }

  registerTheme({
    index: 4, id: 'mine',
    title: 'Угольная шахта', subtitle: 'Глубоко под землёй — светит только фонарь на каске',
    accent: '#ffd54f', dust: '#7a6e62', headlamp: true,
    gen: { groundRange: [232, 300], obstacleW: 50, obstacleH: 30, weights: { pit: 26, platforms: 18, step: 16, obstacle: 14, flat: 26 } },
    decor: ['lamp', 'lamp', 'helmet', 'toolbox', 'phone', 'sign', 'lamp'],
    enemies,
    enemyTable: [
      { type: 'beetle', where: 'ground', weight: 3 },
      { type: 'cart', where: 'ground', weight: 2, from: 0.12 },
      { type: 'methane', where: 'air', weight: 2, from: 0.08 },
      { type: 'beetle', where: 'upper', weight: 1 },
      { type: 'toad', where: 'upper', weight: 3 },
      { type: 'mole', where: 'ground', weight: 2, from: 0.18 },
    ],
    init(api) { st.caveT = api.rand(6, 9); st.warns.length = 0; st.rubble.length = 0; st.lights.length = 0; },
    update(dt, api) {
      stepAssist(api);
      for (let i = st.warns.length - 1; i >= 0; i--) { // предупреждения: сыплется порода → глыба → убираем
        const w = st.warns[i];
        w.t += dt;
        if (!w.rock && w.t >= WARN) dropRock(w, api);
        if (w.t > WARN + 2 || (w.rock && w.rock.dead)) st.warns.splice(i, 1);
      }
      if (api.progress < 0.1 || api.progress > 0.96) return;
      st.caveT -= dt;
      if (st.caveT <= 0) st.caveT = st.warns.length < 3 && tryCaveIn(api) ? api.rand(6, 9) : 0.7;
    },
    drawBackground, drawGround, drawPit, drawPlatform, drawObstacle, drawDecor, drawFinish, drawOverlay, drawLadder,
  });
})();
