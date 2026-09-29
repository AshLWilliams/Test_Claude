'use strict';
// Участок 9 — газопровод в тундре. Полярная ночь: звёзды, северное сияние, снежные сопки и огни компрессорной.
// Особенности: скользкий наст (gen.friction), метель поверх кадра и редкие порывы ветра,
// которые слегка сносят героя, пока он стоит на земле (никогда — к краю провала).
(() => {
  const TAU = Math.PI * 2;
  const GUST_WARN = 1.1, GUST_LEN = 1.8, GUST_V = 42; // предупреждение, длительность и сила порыва (ед./с)
  const SNOW = '#eef7ff', SNOW_SH = '#a9c8e0', ICE = '#9fdcf2';
  // состояние темы: кэш градиентов, порыв ветра, смещение метели
  const st = { ctx: null, sky: null, aur: null, aurCv: null, gust: { phase: 'calm', t: 6, k: 0, dir: -1 }, snowX: 0, last: 0 };

  const poly = (ctx, p) => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); ctx.closePath(); ctx.fill(); };
  const oval = (ctx, x, y, rx, ry, rot = 0) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill(); };
  // тёплый ореол огня: цвет прибавляется к ночному небу (режим 'lighter'), а не мутнеет до бурого пятна
  function glow(ctx, x, y, r, k) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,110,30,.07)'; oval(ctx, x, y, r * k, r * 1.1 * k); // три кольца — мягкий спад яркости
    ctx.fillStyle = 'rgba(255,130,40,.1)'; oval(ctx, x, y + r * 0.1, r * 0.68 * k, r * 0.78 * k);
    ctx.fillStyle = 'rgba(255,170,70,.3)'; oval(ctx, x, y + r * 0.25, r * 0.36 * k, r * 0.46 * k);
    ctx.globalCompositeOperation = 'source-over';
  }

  // градиенты создаются один раз на холст: небо и две ленты сияния (зелёная и сиренево-бирюзовая)
  function gradients(ctx, H) {
    if (st.ctx === ctx) return;
    st.ctx = ctx;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#02060f'); g.addColorStop(0.4, '#081a33'); g.addColorStop(0.62, '#11315a'); g.addColorStop(1, '#1d4a72');
    st.sky = g;
    st.aur = [['rgba(190,110,255,0)', 'rgba(160,120,255,.22)', 'rgba(80,255,170,.62)', 'rgba(170,255,210,.85)'],
      ['rgba(120,90,255,0)', 'rgba(110,140,255,.2)', 'rgba(70,230,220,.5)', 'rgba(160,250,255,.7)']].map(c => {
      // лента сияния — маленький холст 4×160 с градиентом (яркий нижний край); по экрану его «штампует» drawImage
      const cv = document.createElement('canvas'); cv.width = 4; cv.height = 160;
      const cx = cv.getContext('2d'), a = cx.createLinearGradient(0, 0, 0, 160);
      a.addColorStop(0, c[0]); a.addColorStop(0.45, c[1]); a.addColorStop(0.82, c[2]); a.addColorStop(0.93, c[3]); a.addColorStop(1, 'rgba(80,255,170,0)');
      cx.fillStyle = a; cx.fillRect(0, 0, 4, 160);
      return cv;
    });
  }

  // ---------- фон ----------
  // сияние рисуется в маленький холст в половину разрешения (y 20…160) и растягивается одним drawImage:
  // так дёшево для телефонов, а размытость при растяжении делает занавеси мягкими
  const AUR_Y = 20, AUR_H = 140, AUR_K = 0.5;
  function drawAurora(ctx, api) {
    const { W, camX, now } = api, step = 10;
    let cv = st.aurCv;
    if (!cv || cv.width !== Math.ceil(W * AUR_K)) { cv = st.aurCv = document.createElement('canvas'); cv.width = Math.ceil(W * AUR_K); cv.height = AUR_H * AUR_K; }
    const ac = cv.getContext('2d');
    ac.setTransform(1, 0, 0, 1, 0, 0); ac.clearRect(0, 0, cv.width, cv.height);
    ac.setTransform(AUR_K, 0, 0, AUR_K, 0, -AUR_Y * AUR_K);
    for (let b = 0; b < 2; b++) { // две ленты: зелёная и сиренево-бирюзовая; яркость «дышит», складки бегут вдоль
      const base = 88 + b * 30, img = st.aur[b], pulse = 0.55 + 0.35 * Math.sin(now * 0.45 + b * 2.1);
      for (let x = -step; x < W + step; x += step) {
        const u = x + camX * 0.04 + b * 400;
        const bottom = base + Math.sin(u * 0.006 + now * 0.22 + b) * 22 + Math.sin(u * 0.017 - now * 0.5) * 7;
        const fold = 0.5 + 0.5 * Math.sin(u * 0.045 + now * (0.9 + b * 0.3)) * Math.sin(u * 0.011 - now * 0.35);
        ac.globalAlpha = pulse * (0.25 + 0.75 * fold);
        ac.drawImage(img, x, bottom - 80, step + 0.6, 80);
      }
    }
    ac.globalAlpha = 1;
    ctx.drawImage(cv, 0, AUR_Y, cv.width / AUR_K, AUR_H);
  }

  function drawBackground(ctx, api) {
    const { W, H, camX, hash, now } = api;
    gradients(ctx, H);
    ctx.fillStyle = st.sky; ctx.fillRect(0, 0, W, 212); // ниже неба всё закрывают сопки, а ниже ~300 — земля

    // звёзды: неподвижная сетка, мерцание — размер точки
    let off = camX * 0.02, step = 26;
    ctx.fillStyle = '#dfe9ff';
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off + hash(i) * step, y = 34 + hash(i * 7 + 3) * 150, tw = Math.sin(now * (1 + hash(i * 3) * 2) + i) > 0.55;
      const s = hash(i * 11) > 0.85 ? 2 : tw ? 1.6 : 1;
      if (hash(i * 5 + 1) > 0.35) ctx.fillRect(x, y, s, s);
    }
    // тонкий месяц
    const mx = W * 0.84 - camX * 0.01;
    ctx.fillStyle = '#eaf2ff'; oval(ctx, mx, 64, 12, 12);
    ctx.fillStyle = st.sky; oval(ctx, mx + 5, 61, 11, 11);
    ctx.fillStyle = 'rgba(200,220,255,.1)'; oval(ctx, mx, 64, 22, 22); // ореол поверх — без тёмного диска внутри

    drawAurora(ctx, api);

    // дальний план: заснеженный хребет
    off = camX * 0.06; step = 110;
    ctx.fillStyle = '#152a49'; ctx.beginPath(); ctx.moveTo(0, 212);
    const i0 = Math.floor(off / step) - 1, i1 = Math.ceil((off + W) / step) + 1;
    for (let i = i0; i <= i1; i++) ctx.lineTo(i * step - off, 150 + hash(i + 40) * 45);
    ctx.lineTo(W + 200, 212); ctx.fill();
    ctx.fillStyle = '#4a6f98'; // снежные шапки на вершинах
    for (let i = i0; i <= i1; i++) {
      const x = i * step - off, y = 150 + hash(i + 40) * 45, yl = 150 + hash(i + 39) * 45, yr = 150 + hash(i + 41) * 45;
      if (y < yl && y < yr) poly(ctx, [x, y, x - step * 0.22, y + (yl - y) * 0.22, x - 4, y + 6, x + 5, y + 4, x + step * 0.22, y + (yr - y) * 0.22]);
    }

    // сопки и равнина
    off = camX * 0.14; step = 90;
    ctx.fillStyle = '#284a70'; ctx.beginPath(); ctx.moveTo(-10, 212);
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 2; i++) {
      const x = i * step - off, y = 184 + hash(i + 70) * 26;
      ctx.quadraticCurveTo(x - step / 2, y - 10, x, y);
    }
    ctx.lineTo(W + 10, 212); ctx.fill();
    ctx.fillStyle = '#31587f'; ctx.fillRect(0, 208, W, 46);

    // средний план: газопровод на опорах, П-образные компенсаторы и компрессорные станции с факелом
    off = camX * 0.3; step = 26;
    const py = 199;
    ctx.fillStyle = '#1b3150';
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) ctx.fillRect(i * step - off, py + 5, 2, 9);
    ctx.fillStyle = '#8ea4ba'; ctx.fillRect(0, py, W, 5);
    ctx.fillStyle = '#c9dbea'; ctx.fillRect(0, py - 1, W, 1.5);
    step = 260;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) { // компенсатор — «горб» трубы
      if (hash(i + 5) < 0.5) continue;
      const x = i * step - off + 40;
      ctx.fillStyle = '#8ea4ba'; ctx.fillRect(x, py - 16, 5, 16); ctx.fillRect(x + 22, py - 16, 5, 16); ctx.fillRect(x, py - 18, 27, 5);
      ctx.fillStyle = '#c9dbea'; ctx.fillRect(x, py - 19, 27, 1.5);
      ctx.fillStyle = '#31587f'; ctx.fillRect(x + 5, py - 13, 17, 13); ctx.fillStyle = '#8ea4ba'; ctx.fillRect(x + 5, py, 17, 5);
    }
    step = 780;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off + 300 + hash(i + 17) * 200;
      if (x < -160 || x > W + 60) continue;
      ctx.fillStyle = 'rgba(255,190,110,.1)'; oval(ctx, x + 50, 212, 110, 12); // отблеск огней на снегу
      ctx.fillStyle = '#16294a'; ctx.fillRect(x, 170, 70, 42); ctx.fillRect(x + 76, 184, 40, 28); ctx.fillRect(x + 20, 158, 24, 12);
      ctx.fillStyle = '#9fbbd6'; ctx.fillRect(x, 168, 70, 2); ctx.fillRect(x + 76, 182, 40, 2); // снег на крышах
      ctx.fillStyle = '#ffc86b';
      for (let wx = 0; wx < 5; wx++) for (let wy = 0; wy < 2; wy++) if (hash(i * 37 + wx * 5 + wy) > 0.3) ctx.fillRect(x + 6 + wx * 13, 177 + wy * 14, 6, 5);
      ctx.fillRect(x + 84, 192, 6, 5); ctx.fillRect(x + 100, 192, 6, 5);
      ctx.fillStyle = '#16294a'; ctx.fillRect(x + 126, 120, 4, 92); // факел
      const f = Math.sin(now * 13 + i) * 2, f2 = Math.sin(now * 7.3 + i * 2) * 1.5;
      glow(ctx, x + 128, 112, 15, 1 + f * 0.04);
      ctx.fillStyle = '#ff8a2a'; poly(ctx, [x + 123, 120, x + 128 + f2, 100 + f, x + 133, 120]);
      ctx.fillStyle = '#ffe08a'; poly(ctx, [x + 125.5, 120, x + 128 + f2 * 0.6, 108 + f * 0.6, x + 130.5, 120]);
      ctx.strokeStyle = '#16294a'; ctx.lineWidth = 1.2; ctx.beginPath(); // мачта связи с красным огнём
      ctx.moveTo(x - 20, 212); ctx.lineTo(x - 14, 130); ctx.lineTo(x - 8, 212); ctx.moveTo(x - 18, 180); ctx.lineTo(x - 10, 160); ctx.stroke();
      ctx.fillStyle = Math.sin(now * 3 + i) > 0 ? '#ff3b3b' : '#5a1616'; ctx.fillRect(x - 15.5, 127, 3, 3);
    }

    // ближний фон: сугробы и занесённая техника
    off = camX * 0.55; step = 150;
    ctx.fillStyle = '#4f75a0';
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) oval(ctx, i * step - off + hash(i + 3) * 60, 252, 70 + hash(i) * 40, 14 + hash(i + 9) * 10);
    ctx.fillRect(0, 252, W, 52); // ниже y≈300 всегда земля или провал
    step = 540;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const kind = Math.floor(hash(i + 23) * 3), x = i * step - off + 120 + hash(i + 29) * 220;
      if (x < -140 || x > W + 40) continue;
      if (kind === 0) { // бульдозер под снегом
        ctx.fillStyle = '#1e3150'; ctx.fillRect(x, 222, 64, 20); ctx.fillRect(x + 12, 204, 26, 20); ctx.fillRect(x + 66, 216, 6, 30);
        ctx.fillStyle = '#132238'; ctx.fillRect(x - 2, 238, 70, 10);
        ctx.fillStyle = '#b9d2e8'; oval(ctx, x + 25, 204, 16, 4); oval(ctx, x + 50, 222, 16, 3); oval(ctx, x + 69, 216, 5, 2);
        ctx.fillStyle = 'rgba(255,214,120,.8)'; ctx.fillRect(x + 30, 208, 6, 5);
      } else if (kind === 1) { // штабель труб
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) {
          const cx = x + 12 + c * 20 + r * 10, cy = 238 - r * 17;
          ctx.fillStyle = '#243a5c'; oval(ctx, cx, cy, 9, 9); ctx.fillStyle = '#0f1c30'; oval(ctx, cx, cy, 5, 5);
        }
        ctx.fillStyle = '#b9d2e8'; oval(ctx, x + 32, 196, 11, 3); oval(ctx, x + 22, 214, 22, 3);
      } else { // вездеход-«Трэкол» с горящей фарой
        ctx.fillStyle = '#1e3150'; ctx.fillRect(x, 214, 56, 20); ctx.fillRect(x + 30, 200, 24, 16);
        ctx.fillStyle = '#132238'; for (const wx of [x + 10, x + 44]) oval(ctx, wx, 238, 11, 10);
        ctx.fillStyle = '#b9d2e8'; oval(ctx, x + 42, 200, 13, 3); oval(ctx, x + 14, 214, 14, 3);
        ctx.fillStyle = '#ffe9a8'; ctx.fillRect(x + 54, 220, 3, 4);
        ctx.fillStyle = 'rgba(255,233,168,.07)'; poly(ctx, [x + 56, 222, x + 110, 212, x + 110, 234]);
      }
    }
  }

  // ---------- земля, провалы, платформы, препятствия ----------
  function drawGround(s, ctx, api) { // наст поверх вечной мерзлоты: снег, синие тени, ледяные проплешины
    const { H, hash, now } = api, x0 = s.x, x1 = s.x + s.w;
    // тёмное тело — без нахлёста слева, а светлые слои — с нахлёстом 1 ед.: иначе на стыке
    // сглаженный край тёмной заливки просвечивает сквозь снег тонкой тёмной чертой
    ctx.fillStyle = '#243041'; ctx.fillRect(x0, s.y, s.w + 1, H - s.y + 10);
    ctx.fillStyle = '#34445a'; ctx.fillRect(x0 - 1, s.y + 12, s.w + 2, 8);
    ctx.fillStyle = 'rgba(120,180,220,.45)'; // ледяные линзы в мерзлоте
    for (let x = x0 + 6; x < x1 - 20; x += 27) { const h = hash(Math.floor(x) * 5); ctx.fillRect(x, s.y + 28 + h * 55, 8 + h * 16, 2); }
    ctx.fillStyle = '#161e2a';
    for (let x = x0 + 14; x < x1 - 10; x += 31) { const h = hash(Math.floor(x) * 3 + 1); ctx.fillRect(x, s.y + 24 + h * 70, 4 + h * 5, 3 + h * 2); }
    // снежный покров
    ctx.fillStyle = SNOW_SH; ctx.fillRect(x0 - 1, s.y, s.w + 2, 13);
    ctx.fillStyle = SNOW; ctx.fillRect(x0 - 1, s.y, s.w + 2, 9);
    ctx.beginPath(); // бугорки наста
    for (let x = x0 + 8; x < x1 - 8; x += 15) { const h = hash(Math.floor(x) * 9); ctx.ellipse(x, s.y + 1, 6 + h * 5, 1.5 + h, 0, Math.PI, TAU); }
    ctx.fill();
    ctx.fillStyle = 'rgba(120,160,215,.35)'; // синие тени
    for (let x = x0 + 20; x < x1 - 20; x += 38) { const h = hash(Math.floor(x) * 13); ctx.fillRect(x, s.y + 4 + h * 3, 10 + h * 12, 2); }
    // наледь: гладкий голубой лёд с бегущим бликом
    for (let x = x0 + 30; x < x1 - 70; x += 110) {
      const h = hash(Math.floor(x) * 17 + 7);
      if (h < 0.5) continue;
      const w = 28 + h * 36;
      ctx.fillStyle = ICE; ctx.fillRect(x, s.y, w, 4);
      ctx.fillStyle = '#6fb7d8'; ctx.fillRect(x, s.y + 4, w, 1.5);
      const g = ((now * 0.6 + h * 3) % 2) / 2 * (w + 30) - 15;
      if (g > 0 && g < w - 6) { ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(x + g, s.y + 1, 6, 1.5); }
    }
  }

  function drawPit(p, ctx, api) { // полынья с льдинами и паром — или ледяная трещина до мерзлоты
    const { H, now, hash } = api, wy = p.y + 44;
    if (p.v < 0.35) { // трещина: сине-чёрная щель с ледяными стенками
      ctx.fillStyle = '#07111e'; ctx.fillRect(p.x, p.y, p.w, H - p.y);
      ctx.fillStyle = '#3f7ea8';
      for (let y = p.y + 8; y < H; y += 22) {
        const h = hash(Math.floor(y + p.x));
        poly(ctx, [p.x, y, p.x + 8 + h * 10, y + 9, p.x, y + 20]);
        poly(ctx, [p.x + p.w, y + 6, p.x + p.w - 8 - h * 10, y + 15, p.x + p.w, y + 24]);
      }
      ctx.fillStyle = 'rgba(128,222,234,.18)'; ctx.fillRect(p.x + 6, H - 40, p.w - 12, 40);
    } else {
      ctx.fillStyle = '#12304b'; ctx.fillRect(p.x, p.y, p.w, wy - p.y);
      ctx.fillStyle = 'rgba(160,215,240,.28)'; ctx.fillRect(p.x, p.y + 12, 5, wy - p.y - 12); ctx.fillRect(p.x + p.w - 5, p.y + 12, 5, wy - p.y - 12);
      ctx.fillStyle = '#061726'; ctx.fillRect(p.x, wy, p.w, H - wy);
      ctx.fillStyle = '#2f7aa3'; ctx.fillRect(p.x, wy, p.w, 1.5);
      ctx.fillStyle = 'rgba(128,222,234,.5)'; // рябь
      for (let i = 0; i < 4; i++) { const o = (now * 14 + i * p.w / 4 + p.v * 50) % p.w; ctx.fillRect(p.x + o, wy + 5 + (i % 2) * 6, 8, 1); }
      for (let k = 0; k < 2; k++) { // льдины покачиваются у поверхности
        const fx = p.x + p.w * (0.28 + 0.44 * k) + Math.sin(now * 0.7 + k * 3 + p.v * 6) * 5, fy = wy + Math.sin(now * 1.7 + k * 2) * 1.2;
        ctx.fillStyle = '#7fa9c6'; poly(ctx, [fx - 9, fy, fx + 9, fy, fx + 7, fy + 3, fx - 7, fy + 3]);
        ctx.fillStyle = '#e4f3fc'; poly(ctx, [fx - 8, fy - 2, fx + 7, fy - 3, fx + 9, fy, fx - 9, fy]);
      }
      for (let k = 0; k < 3; k++) { // пар над открытой водой: тонкие светлые клочья поднимаются выше кромки
        const ph = (now * 0.25 + k / 3 + p.v) % 1, a = Math.sin(ph * Math.PI) * 0.32;
        ctx.fillStyle = `rgba(230,242,255,${a.toFixed(3)})`;
        oval(ctx, p.x + p.w * (0.3 + 0.2 * k) + Math.sin(ph * 4 + k) * 8, wy - 6 - ph * 70, 6 + ph * 10, 1.8 + ph * 2.5);
      }
    }
    for (const ex of [p.x + 2, p.x + p.w - 10]) { // сосульки со снежной кромки
      ctx.fillStyle = '#cdeaf8'; poly(ctx, [ex, p.y + 12, ex + 4, p.y + 21 + hash(Math.floor(ex)) * 6, ex + 8, p.y + 12]);
    }
    const bx = p.x - 12; // вешка: предупреждение о провале
    ctx.fillStyle = '#e9eef2'; ctx.fillRect(bx, p.y - 26, 2, 26);
    ctx.fillStyle = '#ff6d1a'; ctx.fillRect(bx, p.y - 26, 2, 5); ctx.fillRect(bx, p.y - 15, 2, 4);
    ctx.beginPath(); ctx.moveTo(bx + 2, p.y - 26); ctx.lineTo(bx + 12 + Math.sin(now * 5 + p.x) * 2, p.y - 23); ctx.lineTo(bx + 2, p.y - 20); ctx.fill();
  }

  function drawPlatform(p, ctx, api) {
    const { hash } = api;
    if (p.tier === 1) { // утеплённый магистральный газопровод на опорах, сверху — ровный снег
      const D = 24, n = Math.max(2, Math.round(p.w / 80));
      for (let i = 0; i <= n; i++) {
        const x = p.x + 12 + i * (p.w - 24) / n;
        ctx.fillStyle = '#3a4a5e'; ctx.fillRect(x - 8, p.y + D, 4, p.base - p.y - D); ctx.fillRect(x + 4, p.y + D, 4, p.base - p.y - D);
        ctx.fillStyle = '#56687f'; ctx.fillRect(x - 11, p.y + D, 22, 4); ctx.fillRect(x - 7, p.y + D + 18, 14, 2);
        ctx.fillStyle = SNOW; ctx.fillRect(x - 11, p.y + D - 0.5, 22, 1.5);
      }
      ctx.fillStyle = '#a9b6c3'; ctx.fillRect(p.x - 6, p.y, p.w + 12, D);
      ctx.fillStyle = '#d9e3ec'; ctx.fillRect(p.x - 6, p.y + 3, p.w + 12, 5);
      ctx.fillStyle = '#76879a'; ctx.fillRect(p.x - 6, p.y + D - 6, p.w + 12, 6);
      ctx.fillStyle = '#8c9aa9'; for (let x = p.x + 8; x < p.x + p.w; x += 28) ctx.fillRect(x, p.y + 2, 1, D - 2); // швы кожуха
      ctx.fillStyle = '#f2c230'; // жёлтые кольца-маркеры газа
      for (let i = 0; i <= n; i += 2) { const x = p.x + 12 + i * (p.w - 24) / n; ctx.fillRect(x - 3, p.y + 1, 6, D - 1); }
      ctx.fillStyle = '#5d6d80'; oval(ctx, p.x - 6, p.y + D / 2, 3.5, D / 2); oval(ctx, p.x + p.w + 6, p.y + D / 2, 3.5, D / 2);
      ctx.fillStyle = '#cdeaf8'; // сосульки снизу
      for (let x = p.x + 6; x < p.x + p.w - 4; x += 17) { const h = hash(Math.floor(x) * 7); if (h > 0.45) poly(ctx, [x, p.y + D, x + 2, p.y + D + 3 + h * 7, x + 4, p.y + D]); }
      ctx.fillStyle = SNOW; ctx.fillRect(p.x - 6, p.y - 2, p.w + 12, 4);
      ctx.beginPath(); for (let x = p.x; x < p.x + p.w; x += 18) ctx.ellipse(x + hash(Math.floor(x)) * 6, p.y - 1.5, 6, 1.6, 0, Math.PI, TAU); ctx.fill();
      api.text('ГАЗ', p.x + p.w / 2, p.y + 17, 8, '#4d5c6d');
    } else { // эстакада обслуживания: решётчатый настил, жёлтые перила, ноги с раскосами
      const legs = Math.max(2, Math.round(p.w / 60));
      ctx.strokeStyle = '#3a4a5e'; ctx.lineWidth = 3;
      ctx.beginPath(); for (let i = 0; i <= legs; i++) { const x = p.x + i * p.w / legs; ctx.moveTo(x, p.y + 6); ctx.lineTo(x, p.base); } ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(80,100,125,.9)'; ctx.beginPath();
      for (let i = 0; i < legs; i++) { const x = p.x + i * p.w / legs, x2 = x + p.w / legs; ctx.moveTo(x, p.y + 8); ctx.lineTo(x2, p.base - 4); ctx.moveTo(x2, p.y + 8); ctx.lineTo(x, p.base - 4); }
      ctx.stroke();
      ctx.fillStyle = '#4f6680'; ctx.fillRect(p.x - 4, p.y, p.w + 8, 7);
      ctx.fillStyle = '#34465c'; for (let x = p.x; x < p.x + p.w; x += 6) ctx.fillRect(x, p.y + 2, 2, 4);
      ctx.fillStyle = '#f2c230';
      for (let x = p.x; x <= p.x + p.w; x += 32) ctx.fillRect(x - 1, p.y - 15, 2, 15);
      ctx.fillRect(p.x - 4, p.y - 16, p.w + 8, 2); ctx.fillRect(p.x - 4, p.y - 8, p.w + 8, 1);
      ctx.fillStyle = SNOW; ctx.fillRect(p.x - 4, p.y - 1.5, p.w + 8, 3); ctx.fillRect(p.x - 4, p.y - 17.5, p.w + 8, 1.5);
    }
  }

  function drawObstacle(s, ctx, api) { // ящики под снегом и ледяные глыбы
    const { hash } = api, bh = s.h / s.stack;
    for (let k = 0; k < s.stack; k++) {
      const y = s.y + s.h - (k + 1) * bh, ice = (s.v + k * 0.37) % 1 < 0.45;
      if (ice) {
        ctx.fillStyle = '#6fb3d6'; ctx.fillRect(s.x, y, s.w, bh);
        ctx.fillStyle = '#a8def3'; ctx.fillRect(s.x + 2, y + 2, s.w - 4, bh - 5);
        ctx.fillStyle = 'rgba(255,255,255,.7)'; poly(ctx, [s.x + 5, y + bh - 6, s.x + 12, y + 3, s.x + 16, y + 3, s.x + 9, y + bh - 6]);
        ctx.strokeStyle = '#4d97bf'; ctx.lineWidth = 1; ctx.beginPath();
        const c = s.x + s.w * (0.5 + hash(Math.floor(s.x) + k) * 0.3);
        ctx.moveTo(c, y + 2); ctx.lineTo(c - 5, y + bh * 0.45); ctx.lineTo(c + 2, y + bh * 0.6); ctx.lineTo(c - 2, y + bh - 3); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(s.x + s.w - 10, y + 6, 2, 2); ctx.fillRect(s.x + s.w - 14, y + 12, 1.5, 1.5);
      } else {
        ctx.fillStyle = '#6a4a31'; ctx.fillRect(s.x, y, s.w, bh);
        ctx.fillStyle = '#50351f'; for (let i = 1; i < 3; i++) ctx.fillRect(s.x, y + i * bh / 3, s.w, 1.5);
        ctx.strokeStyle = '#3f2a18'; ctx.lineWidth = 3; ctx.strokeRect(s.x + 1.5, y + 1.5, s.w - 3, bh - 3);
        ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(s.x + 3, y + bh - 3); ctx.lineTo(s.x + s.w - 3, y + 3); ctx.stroke();
        ctx.fillStyle = 'rgba(238,247,255,.8)'; ctx.fillRect(s.x + 3, y + bh / 3 - 1.5, s.w * 0.4, 1.5); // снег в щелях
      }
    }
    ctx.fillStyle = SNOW; // снежная шапка сверху
    ctx.beginPath(); ctx.moveTo(s.x - 3, s.y + 4); ctx.quadraticCurveTo(s.x - 2, s.y - 5, s.x + s.w * 0.4, s.y - 4);
    ctx.quadraticCurveTo(s.x + s.w + 4, s.y - 6, s.x + s.w + 2, s.y + 4); ctx.lineTo(s.x + s.w - 6, s.y + 7); ctx.lineTo(s.x + 6, s.y + 5); ctx.fill();
    ctx.fillStyle = '#cdeaf8';
    for (let x = s.x + 4; x < s.x + s.w - 4; x += 9) { const h = hash(Math.floor(x) * 3); if (h > 0.4) poly(ctx, [x, s.y + 5, x + 1.5, s.y + 9 + h * 6, x + 3, s.y + 5]); }
  }

  function drawDecor(d, ctx, api) {
    const x = d.x, y = d.y, now = api.now;
    if (d.kind === 'pole') { // снегомерная рейка
      for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#1c1c22' : '#f4f4f0'; ctx.fillRect(x - 1.5, y - 42 + i * 7, 3, 7); }
      ctx.fillStyle = SNOW; oval(ctx, x, y, 8, 3);
    } else if (d.kind === 'snowman') { // снеговик в каске
      ctx.fillStyle = SNOW_SH; oval(ctx, x + 1, y - 9, 11, 9);
      ctx.fillStyle = SNOW; oval(ctx, x, y - 10, 10, 9); oval(ctx, x, y - 25, 7.5, 7); oval(ctx, x, y - 37, 5.5, 5.5);
      ctx.fillStyle = '#1c1c22'; ctx.fillRect(x + 1, y - 39, 1.5, 1.5); ctx.fillRect(x - 3, y - 39, 1.5, 1.5); ctx.fillRect(x - 0.5, y - 27, 1.5, 1.5); ctx.fillRect(x - 0.5, y - 22, 1.5, 1.5);
      ctx.fillStyle = '#ff7a1a'; poly(ctx, [x, y - 37.5, x + 8, y - 36, x, y - 35.5]);
      ctx.fillStyle = '#f7f7f7'; ctx.beginPath(); ctx.arc(x, y - 41, 6, Math.PI, 0); ctx.fill(); ctx.fillRect(x - 7, y - 42, 14, 2);
      ctx.strokeStyle = '#5a3d25'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(x - 6, y - 26); ctx.lineTo(x - 15, y - 32); ctx.moveTo(x + 6, y - 26); ctx.lineTo(x + 14, y - 31 + Math.sin(now * 2 + x) * 2); ctx.stroke();
    } else if (d.kind === 'flag') { // геодезическая вешка с флажком
      ctx.fillStyle = '#d7dde2'; ctx.fillRect(x - 1, y - 40, 2, 40);
      const w = Math.sin(now * 6 + x * 0.1) * 2.5;
      ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.moveTo(x + 1, y - 40); ctx.quadraticCurveTo(x + 8, y - 38 + w, x + 16, y - 36 + w); ctx.lineTo(x + 1, y - 30); ctx.fill();
      ctx.fillStyle = SNOW; oval(ctx, x, y, 6, 2.5);
    } else if (d.kind === 'km') { // километровый знак трассы
      ctx.fillStyle = '#3a4a5e'; ctx.fillRect(x - 1.5, y - 30, 3, 30);
      ctx.fillStyle = '#f2c230'; ctx.fillRect(x - 17, y - 46, 34, 17);
      ctx.fillStyle = '#fbfbf4'; ctx.fillRect(x - 15, y - 44, 30, 13);
      api.text('Км 1024', x, y - 34.5, 8, '#1c2a3a');
      ctx.fillStyle = SNOW; ctx.fillRect(x - 18, y - 48, 36, 2.5); oval(ctx, x, y, 7, 2.5);
    } else if (d.kind === 'barrel') { // вмёрзшая бочка в ледяной корке
      ctx.fillStyle = '#b03a2e'; ctx.fillRect(x - 8, y - 22, 16, 22);
      ctx.fillStyle = '#7e271f'; ctx.fillRect(x - 8, y - 16, 16, 2); ctx.fillRect(x - 8, y - 8, 16, 2);
      ctx.fillStyle = 'rgba(170,225,245,.55)'; ctx.fillRect(x - 9, y - 12, 18, 12);
      ctx.fillStyle = SNOW; oval(ctx, x, y - 22, 9, 3); oval(ctx, x, y, 12, 3);
      ctx.fillStyle = '#cdeaf8'; poly(ctx, [x - 7, y - 21, x - 6, y - 14, x - 5, y - 21]); poly(ctx, [x + 3, y - 21, x + 4, y - 16, x + 5, y - 21]);
    }
  }

  function drawFinish(fx, gy, ctx, api) { // вагончик на санях и компрессорная станция с факелом
    const now = api.now;
    // факельная труба стоит за зданием и поднимается выше крыши
    let x = fx + 172;
    const sx = x + 112;
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#e9eef2' : '#c62828'; ctx.fillRect(sx, gy - 160 + i * 25, 7, 25); }
    const f = Math.sin(now * 14) * 3, f2 = Math.sin(now * 8.3) * 2;
    glow(ctx, sx + 3.5, gy - 172, 20, 1 + f * 0.03);
    ctx.fillStyle = '#ff7a1a'; poly(ctx, [sx - 1, gy - 160, sx + 3.5 + f2, gy - 190 + f, sx + 8, gy - 160]);
    ctx.fillStyle = '#ffe08a'; poly(ctx, [sx + 1.5, gy - 160, sx + 3.5 + f2 * 0.5, gy - 176 + f * 0.5, sx + 5.5, gy - 160]);
    // здание КС
    ctx.fillStyle = 'rgba(255,200,120,.12)'; oval(ctx, x + 65, gy, 100, 9);
    ctx.fillStyle = '#35587b'; ctx.fillRect(x, gy - 84, 130, 84);
    ctx.fillStyle = '#2b4a69'; for (let i = 4; i < 130; i += 8) ctx.fillRect(x + i, gy - 84, 2, 84);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
      if (r === 1 && (c === 1 || c === 2)) continue; // место под дверь
      const flick = (c * 3 + r) % 7 === 2 && Math.sin(now * 9) > 0.7;
      ctx.fillStyle = flick ? '#b99450' : '#ffd27a'; ctx.fillRect(x + 12 + c * 29, gy - 70 + r * 28, 16, 12);
    }
    ctx.fillStyle = '#ffe9b0'; ctx.fillRect(x + 52, gy - 30, 26, 30);
    ctx.fillStyle = '#2b4a69'; ctx.fillRect(x + 64, gy - 30, 2, 30);
    ctx.fillStyle = '#1f5fa8'; ctx.fillRect(x + 10, gy - 102, 110, 16);
    api.text('КС «СЕВЕРНАЯ»', x + 65, gy - 90, 10, '#ffffff');
    ctx.fillStyle = SNOW; ctx.fillRect(x - 4, gy - 87, 138, 5); ctx.fillRect(x + 8, gy - 104, 114, 3);
    ctx.fillStyle = '#d7dde2'; ctx.fillRect(x + 6, gy - 134, 2, 48); // флаг на крыше
    const w = Math.sin(now * 5) * 3;
    ctx.fillStyle = '#80deea'; ctx.beginPath(); ctx.moveTo(x + 8, gy - 134); ctx.quadraticCurveTo(x + 18, gy - 132 + w, x + 30, gy - 130 + w); ctx.lineTo(x + 30, gy - 118 + w); ctx.quadraticCurveTo(x + 18, gy - 120 + w, x + 8, gy - 122); ctx.fill();
    ctx.fillStyle = '#1f5fa8'; ctx.fillRect(x + 8, gy - 129 + w * 0.5, 22, 3);
    // вагончик-бытовка на полозьях, из трубы идёт дым
    x = fx + 66;
    ctx.fillStyle = '#4b5563'; ctx.fillRect(x - 4, gy - 5, 96, 3);
    ctx.beginPath(); ctx.moveTo(x - 4, gy - 5); ctx.quadraticCurveTo(x - 14, gy - 5, x - 12, gy - 14); ctx.lineTo(x - 9, gy - 13); ctx.quadraticCurveTo(x - 10, gy - 7, x - 2, gy - 2); ctx.fill();
    ctx.fillRect(x + 8, gy - 8, 3, 4); ctx.fillRect(x + 76, gy - 8, 3, 4);
    ctx.fillStyle = '#c0453a'; ctx.fillRect(x, gy - 50, 88, 42);
    ctx.fillStyle = '#e9eef2'; ctx.fillRect(x, gy - 30, 88, 4);
    ctx.fillStyle = '#ffd27a'; ctx.fillRect(x + 10, gy - 44, 18, 12); ctx.fillStyle = '#8a3128'; ctx.fillRect(x + 62, gy - 44, 16, 36);
    ctx.fillStyle = SNOW; ctx.fillRect(x - 3, gy - 54, 94, 5);
    ctx.fillStyle = '#3a4a5e'; ctx.fillRect(x + 40, gy - 66, 5, 13);
    for (let k = 0; k < 3; k++) { const ph = (now * 0.4 + k / 3) % 1; ctx.fillStyle = `rgba(200,210,225,${(0.4 * (1 - ph)).toFixed(3)})`; oval(ctx, x + 42 - ph * 18, gy - 70 - ph * 30, 4 + ph * 7, 3 + ph * 5); }
  }

  // ---------- враги ----------
  const FOX = '#f4f9fd', FOX_SH = '#bcd2e4', OUT = 'rgba(28,52,88,.65)';
  const BEAR = '#f2eedd', BEAR_SH = '#cfc7a8';

  function resizeBall(e, size) { // снежный ком меняет размер, оставаясь на земле и на своём отрезке
    const cx = e.x + e.w / 2;
    e.w = e.h = size;
    e.x = Math.max(e.minX, Math.min(e.maxX - size, cx - size / 2));
    e.y = e.groundY - size;
  }

  const enemies = {
    fox: { // песец: быстрые прыжки зигзагом — два скачка к герою, один назад
      w: 30, h: 20, hp: 1, pts: 100, hitColor: '#e3f2fd', deathColor: '#ffffff',
      init(e) { e.hopT = 0; e.crouch = 0.3; e.n = 0; e.hopH = 12; },
      update(e, dt, api) {
        const gy = e.groundY - e.h;
        if (e.hopT > 0) {
          e.hopT -= dt;
          e.x += e.vx * dt;
          if (e.x < e.minX) { e.x = e.minX; e.vx = Math.abs(e.vx); e.dir = 1; }
          if (e.x + e.w > e.maxX) { e.x = e.maxX - e.w; e.vx = -Math.abs(e.vx); e.dir = -1; }
          const k = 1 - Math.max(0, e.hopT) / 0.36;
          e.y = gy - Math.sin(k * Math.PI) * e.hopH;
          if (e.hopT <= 0) { e.y = gy; e.crouch = 0.16; }
        } else {
          e.crouch -= dt;
          if (e.crouch <= 0) {
            const near = api.near(e, 300, 100), to = Math.sign(api.dx(e)) || e.dir;
            e.n++;
            const d = near ? (e.n % 3 === 0 ? -to : to) : (Math.random() < 0.3 ? -e.dir : e.dir);
            e.dir = d; e.vx = d * (near ? 200 : 95); e.hopT = 0.36; e.hopH = e.n % 2 ? 9 : 18;
          }
        }
      },
      draw(e, ctx) {
        const air = e.hopT > 0, sq = !air && e.crouch > 0 ? 0.84 : 1;
        const run = air ? 0 : Math.sin(e.t * 20) * 1.2, tail = Math.sin(e.t * 7) * 1.5;
        ctx.fillStyle = 'rgba(20,40,70,.25)'; oval(ctx, 0, e.groundY - e.y - e.h, 12, 2); // тень остаётся на снегу
        ctx.save(); ctx.scale(1, sq);
        ctx.strokeStyle = OUT; ctx.lineWidth = 1;
        ctx.fillStyle = FOX; ctx.beginPath(); ctx.ellipse(-16, -13 + tail, 9, 4.5, air ? -0.15 : -0.45, 0, TAU); ctx.fill(); ctx.stroke(); // пушистый хвост
        ctx.fillStyle = FOX_SH;
        const a = air ? 3 : run;
        ctx.fillRect(-10 - a, -8, 3, 8); ctx.fillRect(-5 + a, -8, 3, 8); ctx.fillRect(4 + a, -8, 3, 8); ctx.fillRect(8 - a, -8, 3, 8);
        ctx.fillStyle = FOX; ctx.beginPath(); ctx.ellipse(-1, -12, 12, 6.5, air ? -0.12 : 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#d6e5f1'; oval(ctx, -1, -8.5, 8, 2.2);
        ctx.fillStyle = FOX; ctx.beginPath(); ctx.arc(10, -16, 5.5, 0, TAU); ctx.fill(); ctx.stroke();
        poly(ctx, [13, -19, 20, -14.5, 13, -12]);
        poly(ctx, [6, -19, 7, -26, 10.5, -20]); poly(ctx, [10, -21, 12.5, -27, 14, -19]);
        ctx.fillStyle = '#9fb8cc'; poly(ctx, [7.5, -20, 8, -24, 10, -20.5]);
        ctx.fillStyle = '#15151c'; ctx.fillRect(19, -15.5, 2.2, 2.2); ctx.fillRect(11.5, -18, 2, 2);
        ctx.restore();
      },
    },

    bear: { // белый медведь: бродит, заметив — ревёт (0,9 с) и несётся до края своего отрезка
      w: 70, h: 44, hp: 5, pts: 500, heavy: true, hitColor: '#fff3d0', deathColor: '#f2eedd',
      init(e) { e.state = 'walk'; e.st = 0; e.puff = 0; },
      update(e, dt, api) {
        if (e.state === 'walk') {
          api.patrol(e, 32, dt);
          e.cd -= dt;
          if (e.cd <= 0 && api.near(e, 290, 90)) { e.state = 'roar'; e.st = 0.9; e.dir = Math.sign(api.dx(e)) || e.dir; api.shake(2); }
        } else if (e.state === 'roar') {
          e.st -= dt;
          if (e.st <= 0) e.state = 'charge';
        } else if (e.state === 'charge') {
          e.x += e.dir * 270 * dt;
          e.puff -= dt;
          if (e.puff <= 0) { e.puff = 0.07; api.burst(e.x + e.w / 2 - e.dir * 30, e.y + e.h - 2, '#e8f4ff', 2, 90, 500); }
          if (e.x <= e.minX || e.x + e.w >= e.maxX) { // упёрся в край отрезка: тормозит, выдыхается
            e.x = api.clamp(e.x, e.minX, e.maxX - e.w);
            e.state = 'tired'; e.st = 1.2; api.shake(4);
            api.burst(e.x + e.w / 2 + e.dir * 30, e.y + e.h - 4, '#e8f4ff', 10, 160, 600);
          }
        } else {
          e.st -= dt;
          if (e.st <= 0) { e.state = 'walk'; e.cd = api.rand(1.2, 2); e.dir = -e.dir; }
        }
      },
      draw(e, ctx) {
        const s = e.state, roar = s === 'roar', ch = s === 'charge', tired = s === 'tired';
        const sp = ch ? 24 : s === 'walk' ? 7 : 0, L = sp ? Math.sin(e.t * sp) * (ch ? 6 : 3.5) : 0;
        const rear = roar ? Math.min(1, (0.9 - e.st) / 0.25) : 0, br = tired ? Math.sin(e.t * 10) * 1.3 : Math.sin(e.t * 2) * 0.6;
        ctx.fillStyle = 'rgba(20,40,70,.3)'; oval(ctx, 0, 0, 33, 3);
        ctx.save();
        ctx.translate(-24, -6); ctx.rotate(-0.2 * rear + (ch ? 0.05 : 0)); ctx.translate(24, 6); // на рёве привстаёт на задние лапы
        ctx.fillStyle = BEAR_SH; ctx.fillRect(-22 - L, -18, 10, 18); ctx.fillRect(14 + L, -18, 10, 18);
        ctx.fillStyle = BEAR; oval(ctx, -4, -24, 30, 16 + br * 0.4); oval(ctx, 8, -30, 14, 10); oval(ctx, -26, -22, 8, 11);
        ctx.fillStyle = BEAR_SH; oval(ctx, -4, -11, 23, 4);
        ctx.fillStyle = BEAR; ctx.fillRect(-28 + L, -17, 11, 17); ctx.fillRect(9 - L, -17, 11, 17);
        ctx.fillStyle = '#2b2b30';
        for (const fx of [-28 + L, 9 - L]) { ctx.fillRect(fx + 8, -2, 2, 2); ctx.fillRect(fx + 10.5, -2, 1.5, 2); }
        ctx.save(); ctx.translate(20, -28); ctx.rotate(roar ? -0.4 * rear : ch ? 0.18 : tired ? 0.25 : 0);
        ctx.fillStyle = BEAR; oval(ctx, 1, 3, 9, 9); oval(ctx, 9, 0, 10, 8); oval(ctx, 17, 2.5, 6.5, 4.8);
        oval(ctx, 3, -7, 3.2, 3.2);
        ctx.fillStyle = BEAR_SH; oval(ctx, 3, -7, 1.6, 1.6);
        ctx.fillStyle = '#111'; ctx.fillRect(10, -3.5, 2.4, 2.4); ctx.fillRect(21.5, 0, 3, 3);
        if (roar) { // пасть открыта: видно зубы
          const o = 3 + 4 * rear;
          ctx.fillStyle = '#7a1f2a'; poly(ctx, [11, 5, 23, 4, 22, 5 + o, 12, 6 + o * 0.6]);
          ctx.fillStyle = '#fff'; poly(ctx, [14, 5, 15, 7, 16, 5]); poly(ctx, [19, 4.5, 20, 6.5, 21, 4.5]);
        } else if (tired) { ctx.fillStyle = '#c2455a'; ctx.fillRect(16, 6, 3, 3 + br); } // высунул язык
        ctx.restore();
        ctx.restore();
        if (roar) { // рёв: расходящиеся дуги и пар изо рта — сигнал к рывку
          const ph = (e.t * 3) % 1;
          ctx.strokeStyle = '#ff6e57'; ctx.lineWidth = 2;
          for (let k = 0; k < 3; k++) {
            const r = 8 + ((ph + k / 3) % 1) * 22;
            ctx.globalAlpha = 1 - ((ph + k / 3) % 1);
            ctx.beginPath(); ctx.arc(40, -38, r, -0.7, 0.7); ctx.stroke();
          }
          ctx.globalAlpha = 0.7; ctx.fillStyle = '#e8f4ff'; oval(ctx, 44 + rear * 6, -36, 4 + rear * 5, 3 + rear * 3);
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#ff6e57'; ctx.fillRect(-2, -70, 4, 13); ctx.fillRect(-2, -54, 4, 4); // «!» над головой
        }
      },
    },

    snowball: { // снежный ком: катится к герою и растёт от 20 до 40; сверху не запрыгнуть
      w: 20, h: 20, hp: 2, pts: 150, stompable: false, flip: false, hitColor: '#ffffff', deathColor: '#e8f4ff',
      init(e) { e.vx = 0; e.roll = 0; },
      update(e, dt, api) {
        const near = api.near(e, 320, 130), to = Math.sign(api.dx(e)) || e.dir;
        const target = near ? to * (55 + (e.w - 20) * 1.6) : e.dir * 22;
        e.vx += api.clamp(target - e.vx, -110 * dt, 110 * dt); // разгоняется и разворачивается не сразу
        e.x += e.vx * dt;
        if (e.x < e.minX) { e.x = e.minX; e.vx = Math.abs(e.vx) * 0.3; e.dir = 1; }
        if (e.x + e.w > e.maxX) { e.x = e.maxX - e.w; e.vx = -Math.abs(e.vx) * 0.3; e.dir = -1; }
        if (Math.abs(e.vx) > 5) e.dir = Math.sign(e.vx);
        e.roll += e.vx * dt / (e.w / 2);
        const size = Math.min(40, e.w + Math.abs(e.vx) * dt * 0.07);
        if (size !== e.w) resizeBall(e, size);
      },
      onHit(e, api) { // удар сбивает снег — ком уменьшается
        api.burst(e.x + e.w / 2, e.y + e.h / 3, '#f4f9ff', 8, 170);
        resizeBall(e, Math.max(18, e.w - 8));
      },
      draw(e, ctx) {
        const r = e.w / 2;
        ctx.fillStyle = 'rgba(20,40,70,.3)'; oval(ctx, 0, 0, r + 3, 2.5);
        if (Math.abs(e.vx) > 30) { // снежная пыль из-под кома
          ctx.fillStyle = 'rgba(235,245,255,.6)';
          for (let k = 0; k < 3; k++) { const ph = (e.t * 3 + k / 3) % 1; oval(ctx, -Math.sign(e.vx) * (r + ph * 14), -2 - ph * 8, 2 + ph * 3, 2 + ph * 2); }
        }
        ctx.fillStyle = '#f2f8fd'; ctx.strokeStyle = OUT; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(0, -r, r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#b8d0e6'; ctx.beginPath(); ctx.arc(0, -r, r, -0.2, Math.PI * 0.95); ctx.arc(-r * 0.15, -r * 1.12, r * 0.92, Math.PI * 0.95, -0.2, true); ctx.fill();
        ctx.save(); ctx.translate(0, -r); ctx.rotate(e.roll); // вмёрзшие камни и ветки показывают вращение
        ctx.fillStyle = '#3c4656';
        for (let k = 0; k < 3; k++) { const a = k * 2.1; ctx.fillRect(Math.cos(a) * r * 0.6 - 1.5, Math.sin(a) * r * 0.6 - 1.5, 3 + k, 3); }
        ctx.strokeStyle = '#6b4a2f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(r * 0.2, -r * 0.4); ctx.lineTo(r * 1.15, -r * 0.8); ctx.stroke();
        ctx.fillStyle = '#9fdcf2'; poly(ctx, [-r * 0.7, r * 0.3, -r * 1.12, r * 0.55, -r * 0.62, r * 0.62]);
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,.9)'; oval(ctx, -r * 0.35, -r * 1.45, r * 0.28, r * 0.16, -0.5);
      },
    },
  };

  // ---------- метель и порывы ветра ----------
  function supportAt(x, feet, api) { // есть ли под точкой опора на уровне ног героя
    const g = api.groundAt(x);
    if (g !== null && Math.abs(g - feet) < 3) return true;
    for (const p of api.platforms) if (x >= p.x && x <= p.x + p.w && Math.abs(p.y - feet) < 2) return true;
    return false;
  }
  function windPush(P, d, api) { // сносит, только если по ветру ещё есть опора (запас 14 ед.) и нет стены
    const nx = P.x + d, probe = d > 0 ? nx + P.w + 14 : nx - 14;
    if (!supportAt(probe, P.y + P.h, api)) return;
    const box = { x: nx, y: P.y, w: P.w, h: P.h - 1 };
    for (const s of api.solids) if (s.x < nx + 60 && s.x + s.w > nx - 60 && api.overlap(box, s)) return;
    P.x = nx;
  }

  // генератор, упираясь в край groundRange, изредка оставляет «ступеньку» в 1–5 ед.; движок не умеет
  // на неё подшагивать, и бег упирается в невидимую стенку. Подсаживаем героя, если он прижат к такому краю.
  function stepUp(P, api) {
    const feet = P.y + P.h, d = P.face, edge = d > 0 ? P.x + P.w : P.x;
    for (const s of api.solids) {
      if (s.kind !== 'ground' || s.y >= feet || s.y < feet - 6) continue;
      if (Math.abs((d > 0 ? s.x : s.x + s.w) - edge) > 0.01) continue;
      const box = { x: P.x + d, y: s.y - P.h, w: P.w, h: P.h - 0.5 };
      for (const o of api.solids) if (o.x < box.x + 60 && o.x + o.w > box.x - 60 && api.overlap(box, o)) return;
      P.x = box.x; P.y = box.y; return;
    }
  }

  function update(dt, api) {
    const g = st.gust, P = api.player;
    if (P.onGround) stepUp(P, api);
    g.t -= dt;
    if (g.phase === 'calm' && g.t <= 0) { g.phase = 'warn'; g.t = GUST_WARN; g.dir = Math.random() < 0.65 ? -1 : 1; }
    else if (g.phase === 'warn' && g.t <= 0) { g.phase = 'gust'; g.t = GUST_LEN; }
    else if (g.phase === 'gust' && g.t <= 0) { g.phase = 'calm'; g.t = api.rand(5, 8); }
    g.k += ((g.phase === 'gust' ? 1 : g.phase === 'warn' ? 0.35 : 0) - g.k) * Math.min(1, dt * 4);
    if (g.phase === 'gust' && P.onGround) windPush(P, g.dir * GUST_V * Math.min(1, (GUST_LEN - g.t) * 4, g.t * 4) * dt, api);
  }

  function drawForeground(ctx, api) { // позёмка: снег струится по насту у самых ног
    const g = st.gust, { camX, W, now, hash } = api;
    const a = 0.18 + 0.5 * g.k, d = g.k > 0.05 ? g.dir : -1, sp = 40 + 260 * g.k;
    ctx.strokeStyle = `rgba(240,248,255,${a.toFixed(3)})`; ctx.lineWidth = 1.2; ctx.beginPath();
    for (const s of api.solids) {
      if (s.kind !== 'ground' || s.x > camX + W || s.x + s.w < camX) continue;
      const x0 = Math.max(s.x, camX - 20), x1 = Math.min(s.x + s.w, camX + W + 20);
      for (let i = Math.floor(x0 / 70); i * 70 < x1; i++) {
        const h = hash(i * 7 + 2), len = 14 + h * 26;
        let x = i * 70 + ((now * sp * (0.7 + h * 0.6) * d) % 70 + 70) % 70;
        if (x < s.x + 4 || x + len > s.x + s.w) continue;
        const y = s.y - 2 - h * 5;
        ctx.moveTo(x, y); ctx.quadraticCurveTo(x + len * 0.5, y - 2, x + len, y + 1);
      }
    }
    ctx.stroke();
  }

  function drawOverlay(ctx, api) { // метель в экранных координатах: штрихи и хлопья, в порыв — гуще и косее
    const { W, H, now, hash, camX } = api, g = st.gust, k = g.k;
    const dt = Math.min(0.1, Math.max(0, now - st.last)); st.last = now;
    const wind = -60 + g.dir * 480 * k;
    st.snowX = (st.snowX + wind * dt) % 100000;
    if (k > 0.03) { ctx.fillStyle = `rgba(205,225,248,${(0.12 * k).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
    const span = W + 140, n = Math.round(W / 12 + 50 * k);
    ctx.strokeStyle = `rgba(232,242,255,${(0.45 + 0.3 * k).toFixed(3)})`; ctx.lineWidth = 1.1; ctx.beginPath();
    ctx.fillStyle = 'rgba(245,250,255,.85)';
    for (let i = 0; i < n; i++) {
      const h1 = hash(i * 7 + 1), h2 = hash(i * 13 + 5), h3 = hash(i * 29 + 3);
      const m = 0.6 + h1 * 0.8, vy = 38 + h2 * 60, vx = wind * m;
      let x = (h3 * span + st.snowX * m - camX * (0.2 + h1 * 0.6)) % span; if (x < 0) x += span; x -= 70;
      x += Math.sin(now * (1 + h2) + i) * 6;
      const y = (h2 * 997 + now * vy) % (H + 30) - 15;
      if (i % 3 === 0) { const s = 1.5 + h1 * 1.5; ctx.fillRect(x, y, s, s); }
      else { const l = 0.045 + 0.03 * k; ctx.moveTo(x, y); ctx.lineTo(x - vx * l, y - vy * l); }
    }
    ctx.stroke();
    if (k < 0.03) return;
    // табло под полосой HUD: «ПОРЫВ ВЕТРА», стрелки по ветру; в предупреждение мигает
    const on = g.phase !== 'warn' || Math.floor(now * 8) % 2 === 0, cx = W / 2, d = g.dir;
    ctx.globalAlpha = Math.min(1, k * 3);
    ctx.fillStyle = 'rgba(6,20,40,.75)'; ctx.fillRect(cx - 78, 35, 156, 21);
    ctx.fillStyle = on ? '#80deea' : '#2f6e78'; ctx.fillRect(cx - 78, 35, 156, 2);
    api.text('❄ ПОРЫВ ВЕТРА', cx - d * 10, 50, 11, on ? '#eafcff' : '#8cc6cf');
    ctx.strokeStyle = on ? '#80deea' : '#2f6e78'; ctx.lineWidth = 2; ctx.beginPath();
    for (let j = 0; j < 3; j++) { const ax = cx + d * (50 + j * 7); ctx.moveTo(ax - d * 3, 41); ctx.lineTo(ax + d * 2, 45.5); ctx.lineTo(ax - d * 3, 50); }
    ctx.stroke();
    if (g.phase === 'gust') { ctx.fillStyle = '#80deea'; ctx.fillRect(cx - 78, 54, 156 * g.t / GUST_LEN, 2); }
    ctx.globalAlpha = 1;
  }

  registerTheme({
    index: 9, id: 'tundra',
    title: 'Газопровод в тундре', subtitle: 'Северная стройка: метель, мерзлота и медведи',
    accent: '#80deea', dust: '#e3f0fa', headlamp: true,
    gen: { length: 3900, friction: 0.65, groundRange: [232, 298], obstacleH: 28, obstacleW: 44, weights: { pit: 24, platforms: 22, step: 12, obstacle: 14, flat: 28 } },
    decor: ['pole', 'pole', 'snowman', 'flag', 'flag', 'km', 'barrel'],
    enemies,
    enemyTable: [
      { type: 'fox', where: 'ground', weight: 3 },
      { type: 'snowball', where: 'ground', weight: 2, from: 0.1 },
      { type: 'bear', where: 'ground', weight: 2, from: 0.25 },
      { type: 'fox', where: 'upper', weight: 1 },
    ],
    init(api) {
      Object.assign(st.gust, { phase: 'calm', t: api.rand(4, 6), k: 0, dir: -1 });
    },
    update, drawBackground, drawGround, drawPit, drawPlatform, drawObstacle, drawDecor, drawFinish, drawForeground, drawOverlay,
  });
})();
