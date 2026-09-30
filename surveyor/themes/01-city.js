'use strict';
// Участок 1 — городская стройка. Эталон темы: см. THEMES.md.
(() => {
  // ---------- фон ----------
  function drawBackground(ctx, api) {
    const { W, H, camX, hash, now } = api;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#26325c'); g.addColorStop(0.55, '#c86b5a'); g.addColorStop(1, '#f6b36b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,220,150,.9)'; ctx.beginPath(); ctx.arc(W * 0.78 - camX * 0.02, 150, 34, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,200,120,.25)'; ctx.beginPath(); ctx.arc(W * 0.78 - camX * 0.02, 150, 56, 0, 7); ctx.fill();

    // дальний план: город с огнями окон
    let off = camX * 0.15, step = 46;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const h = 60 + hash(i) * 90, x = i * step - off, y = 250 - h;
      ctx.fillStyle = '#3a3552'; ctx.fillRect(x, y, step - 4, h + 60);
      ctx.fillStyle = 'rgba(255,214,120,.55)';
      for (let wy = y + 8; wy < 240; wy += 12) for (let wx = x + 5; wx < x + step - 10; wx += 9) if (hash(i * 131 + wx * 7 + wy) > 0.62) ctx.fillRect(wx, wy, 4, 5);
    }

    // средний план: башенные краны и каркасы домов
    off = camX * 0.35; step = 420;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off + hash(i + 7) * 120;
      const bw = 120 + hash(i + 3) * 60, floors = 4 + Math.floor(hash(i + 5) * 4), bx = x + 90, fh = 22, by = 262;
      ctx.fillStyle = 'rgba(70,62,80,.9)';
      for (let f = 0; f <= floors; f++) ctx.fillRect(bx, by - f * fh, bw, 4);
      for (let c = 0; c <= 4; c++) ctx.fillRect(bx + c * (bw / 4) - 2, by - floors * fh, 5, floors * fh);
      const mh = 190 + hash(i + 11) * 40, top = 262 - mh;
      ctx.strokeStyle = '#e0a526'; ctx.lineWidth = 2;
      ctx.strokeRect(x, top, 10, mh);
      ctx.beginPath(); for (let y = top; y < 262; y += 12) { ctx.moveTo(x, y); ctx.lineTo(x + 10, y + 12); } ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 50, top); ctx.lineTo(x + 170, top); ctx.lineTo(x + 170, top + 7); ctx.lineTo(x - 50, top + 7); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 5, top - 22); ctx.lineTo(x + 170, top); ctx.moveTo(x + 5, top - 22); ctx.lineTo(x - 50, top); ctx.stroke();
      ctx.fillStyle = '#6b6470'; ctx.fillRect(x - 48, top + 7, 22, 14); // противовес
      ctx.fillStyle = '#e0a526'; ctx.fillRect(x - 6, top + 8, 18, 12); // кабина
      const hx = x + 110 + Math.sin(now / 1.2 + i) * 30, hy = top + 70 + hash(i) * 40;
      ctx.strokeStyle = '#2b2733'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, top + 7); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = '#2b2733'; ctx.fillRect(hx - 4, hy, 8, 6);
    }

    // ближний фон: забор стройплощадки
    off = camX * 0.6; step = 70;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off;
      ctx.fillStyle = i % 2 ? '#3d5a45' : '#355040'; ctx.fillRect(x, 232, step - 2, 60);
      ctx.fillStyle = '#6d7d70'; ctx.fillRect(x, 230, 4, 70);
      if (hash(i + 99) > 0.8) {
        ctx.fillStyle = '#e8e2d0'; ctx.fillRect(x + 8, 244, step - 18, 18);
        api.text('СТРОЙКА', x + step / 2 - 5, 256, 8, '#b3261e');
      }
    }
  }

  // ---------- земля, провалы, платформы, препятствия ----------
  function drawGround(s, ctx, api) {
    if (s.wall) return drawWall(s, ctx, api);
    const { H, hash } = api;
    const g = ctx.createLinearGradient(0, s.y, 0, H);
    g.addColorStop(0, '#7a5a3c'); g.addColorStop(1, '#3d2b1d');
    ctx.fillStyle = g; ctx.fillRect(s.x - 0.5, s.y, s.w + 1, H - s.y + 10); // +1 px — без щелей на стыках
    ctx.fillStyle = '#9d917f'; ctx.fillRect(s.x, s.y, s.w, 7); // утрамбованный щебень
    ctx.fillStyle = '#6f6556';
    for (let x = s.x + 3; x < s.x + s.w - 3; x += 7) { const h = hash(Math.floor(x) * 3); ctx.fillRect(x, s.y + 1 + h * 4, 2 + h * 2, 2); }
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    for (let x = s.x + 10; x < s.x + s.w - 10; x += 23) { const h = hash(Math.floor(x)); ctx.fillRect(x, s.y + 18 + h * 50, 5 + h * 6, 3); }
  }

  // стена — штабель строительных бытовок в два этажа; по крыше ходят
  const CABIN_C = [['#2f6db3', '#244f80'], ['#b8402f', '#8a2d20'], ['#d99a1e', '#a8740f'], ['#3d7a4f', '#2b5a39'], ['#8a8f96', '#62676e']];
  function drawWall(s, ctx, api) {
    const { H, hash } = api;
    if (s.baseY === undefined) s.baseY = api.groundAt(s.x - 4) ?? s.y + 140; // уровень земли у подножия (кэш)
    const base = Math.max(s.y + 60, s.baseY);
    drawGround({ x: s.x, y: base, w: s.w }, ctx, api);                       // грунт под штабелем
    const rows = 2, rh = (base - s.y) / rows, n = Math.max(1, Math.round(s.w / 110)), cw = s.w / n;
    for (let r = 0; r < rows; r++) for (let c = 0; c < n; c++) {
      const x = s.x + c * cw, y = s.y + r * rh, k = Math.floor(hash(Math.floor(s.x) + r * 7 + c * 3) * CABIN_C.length), [cb, cd] = CABIN_C[k];
      ctx.fillStyle = cb; ctx.fillRect(x, y, cw, rh);
      ctx.fillStyle = cd; for (let rx = x + 5; rx < x + cw - 3; rx += 7) ctx.fillRect(rx, y + 4, 2, rh - 8); // гофра
      ctx.fillStyle = '#2b2d33'; ctx.fillRect(x, y, cw, 4); ctx.fillRect(x, y + rh - 4, cw, 4); ctx.fillRect(x, y, 3, rh); ctx.fillRect(x + cw - 3, y, 3, rh); // рама
      ctx.fillStyle = '#c9ccd2'; for (const [cx, cy] of [[x, y], [x + cw - 6, y], [x, y + rh - 5], [x + cw - 6, y + rh - 5]]) ctx.fillRect(cx, cy, 6, 5); // фитинги
      const v = hash(Math.floor(s.x) * 3 + r * 11 + c);
      if (r === rows - 1 && v > 0.45 && cw > 70) { // дверь с табличкой
        const dx = x + cw * (0.2 + v * 0.3);
        ctx.fillStyle = '#5a4a3a'; ctx.fillRect(dx, y + rh - 46, 20, 42); ctx.fillStyle = '#d9c58a'; ctx.fillRect(dx + 15, y + rh - 26, 3, 3);
        ctx.fillStyle = '#e8e2d0'; ctx.fillRect(dx - 2, y + rh - 58, 26, 9); api.text(v > 0.75 ? 'ОТК' : 'ПТО', dx + 11, y + rh - 51, 7, '#b3261e');
      }
      for (let w = 0; w < (cw > 90 ? 2 : 1); w++) { // окна с тёплым светом и решёткой
        const wx = x + cw * (w ? 0.72 : 0.5) - 11, wy = y + 12;
        if (r === rows - 1 && v > 0.45 && Math.abs(wx - (x + cw * (0.2 + v * 0.3))) < 26) continue;
        ctx.fillStyle = '#e6e8ec'; ctx.fillRect(wx - 2, wy - 2, 26, 20);
        ctx.fillStyle = hash(Math.floor(wx)) > 0.4 ? '#ffd98a' : '#8fb8d8'; ctx.fillRect(wx, wy, 22, 16);
        ctx.fillStyle = '#6b6f78'; ctx.fillRect(wx + 10, wy, 2, 16); ctx.fillRect(wx, wy + 7, 22, 2);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(s.x, s.y + 4, 4, base - s.y - 4); // тень на торце у лестницы
    // крыша-проход: настил с сигнальной кромкой
    ctx.fillStyle = '#6d6f76'; ctx.fillRect(s.x - 1, s.y, s.w + 2, 6);
    ctx.fillStyle = '#9ea1a8'; ctx.fillRect(s.x - 1, s.y, s.w + 2, 2);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#111' : '#f2c230'; ctx.fillRect(s.x - 1 + i * 6, s.y, 6, 4); ctx.fillRect(s.x + s.w - 23 + i * 6, s.y, 6, 4); }
    if (s.v > 0.5) { ctx.fillStyle = '#d0d3d8'; ctx.fillRect(s.x + s.w * 0.6, s.y - 9, 14, 9); ctx.fillStyle = '#9ea1a8'; ctx.fillRect(s.x + s.w * 0.6 + 2, s.y - 7, 10, 1); } // кондиционер на крыше
  }

  function drawPit(p, ctx, api) { // котлован с арматурой и полосатый барьер на краю
    const { H, hash } = api;
    ctx.fillStyle = '#1d1510'; ctx.fillRect(p.x, p.y, p.w, H);
    ctx.strokeStyle = '#8a4a2a'; ctx.lineWidth = 2;
    for (let x = p.x + 8; x < p.x + p.w - 4; x += 12) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + 2, H - 30 - hash(Math.floor(x)) * 20); ctx.stroke(); }
    const bx = p.x - 26;
    ctx.fillStyle = '#ddd'; ctx.fillRect(bx, p.y - 18, 2, 18); ctx.fillRect(bx + 18, p.y - 18, 2, 18);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#111' : '#f2c230'; ctx.fillRect(bx - 2 + i * 5, p.y - 20, 5, 6); }
  }

  // стойки ярусов вышки: каждая доходит до ближайшего яруса под ней или до земли (считается один раз)
  function towerPosts(p, api) {
    if (p.posts) return p.posts;
    const n = Math.max(2, Math.round(p.w / 58)), out = [];
    for (let i = 0; i <= n; i++) {
      const x = p.x + i * p.w / n;
      let b = api.groundAt(x) ?? p.base;
      for (const q of api.platforms) if (q.tower && q !== p && q.y > p.y + 20 && q.y < b && x >= q.x - 2 && x <= q.x + q.w + 2) b = q.y;
      out.push({ x, b });
    }
    return (p.posts = out);
  }

  function drawTower(p, ctx, api) { // ярус вышки: леса из синих труб с раскосами по каждому ярусу-«ходу», сетка, настил
    const posts = towerPosts(p, api), LIFT = 56;
    ctx.fillStyle = 'rgba(60,130,80,.18)'; // строительная сетка сзади
    for (let i = 0; i < posts.length - 1; i++) { const a = posts[i], b = posts[i + 1]; ctx.fillRect(a.x, p.y + 10, b.x - a.x, Math.min(a.b, b.b) - p.y - 10); }
    ctx.strokeStyle = '#4d6f9e'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < posts.length - 1; i++) { // ригели и раскосы крест-накрест
      const a = posts[i], b = posts[i + 1], bot = Math.min(a.b, b.b);
      for (let y = p.y + 10, k = 0; y < bot - 8; y += LIFT, k++) {
        const y2 = Math.min(bot, y + LIFT);
        ctx.moveTo(a.x, y2); ctx.lineTo(b.x, y2);
        if ((i + k) % 2) { ctx.moveTo(a.x, y); ctx.lineTo(b.x, y2); } else { ctx.moveTo(a.x, y2); ctx.lineTo(b.x, y); }
      }
    }
    ctx.stroke();
    for (const q of posts) { // стойки-трубы с хомутами и башмаками
      ctx.fillStyle = '#5c7fb0'; ctx.fillRect(q.x - 2, p.y, 4, q.b - p.y);
      ctx.fillStyle = '#8fb0d8'; ctx.fillRect(q.x - 2, p.y, 1, q.b - p.y);
      ctx.fillStyle = '#2f3f58'; for (let y = p.y + 10 + LIFT; y < q.b - 8; y += LIFT) ctx.fillRect(q.x - 3, y - 2, 6, 4);
      ctx.fillStyle = '#3a3f48'; ctx.fillRect(q.x - 6, q.b - 3, 12, 3);
    }
    // настил, бортовая доска, перила
    ctx.fillStyle = '#c98a4b'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 7);
    ctx.fillStyle = '#8e5c2c'; for (let x = p.x; x < p.x + p.w; x += 24) ctx.fillRect(x, p.y, 1, 7);
    ctx.fillStyle = '#e0a526'; ctx.fillRect(p.x - 6, p.y + 7, p.w + 12, 3);
    ctx.fillStyle = '#5c7fb0'; ctx.fillRect(p.x - 6, p.y - 16, p.w + 12, 2); ctx.fillRect(p.x - 6, p.y - 8, p.w + 12, 1.5);
    ctx.fillRect(p.x - 6, p.y - 16, 2, 16); ctx.fillRect(p.x + p.w + 4, p.y - 16, 2, 16);
    if (p.tier === 3) { // верх: флажок и проблесковый фонарь для крана
      const fx = p.x + p.w + 5;
      ctx.fillStyle = '#5c7fb0'; ctx.fillRect(fx - 1, p.y - 40, 2, 26);
      ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.moveTo(fx + 1, p.y - 40); ctx.lineTo(fx + 17, p.y - 35 + Math.sin(api.now * 5) * 2); ctx.lineTo(fx + 1, p.y - 30); ctx.fill();
      ctx.fillStyle = Math.sin(api.now * 4) > 0 ? '#ff3b3b' : '#6a1a1a'; ctx.fillRect(p.x - 8, p.y - 21, 6, 5);
    }
  }

  function drawPlatform(p, ctx, api) { // строительные леса: трубы, раскосы, дощатый настил
    if (p.tower) return drawTower(p, ctx, api);
    ctx.strokeStyle = '#5c7fb0'; ctx.lineWidth = 3;
    const posts = Math.max(2, Math.round(p.w / 70));
    for (let i = 0; i <= posts; i++) { const x = p.x + i * p.w / posts; ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.base); ctx.stroke(); }
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(92,127,176,.8)';
    for (let i = 0; i < posts; i++) { const x = p.x + i * p.w / posts; ctx.beginPath(); ctx.moveTo(x, p.base); ctx.lineTo(x + p.w / posts, p.y + 10); ctx.stroke(); }
    ctx.fillStyle = '#c98a4b'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 7);
    ctx.fillStyle = '#8e5c2c'; for (let x = p.x; x < p.x + p.w; x += 24) ctx.fillRect(x, p.y, 1, 7);
    ctx.fillStyle = '#5c7fb0'; ctx.fillRect(p.x - 6, p.y - 16, p.w + 12, 2); // перила
  }

  function drawObstacle(s, ctx, api) { // поддон с кирпичом
    const { hash } = api;
    ctx.fillStyle = '#9c6b3e'; ctx.fillRect(s.x, s.y + s.h - 7, s.w, 7);
    ctx.fillStyle = '#6e4a2a'; for (let i = 0; i < 3; i++) ctx.fillRect(s.x + 2 + i * (s.w - 8) / 2, s.y + s.h - 7, 4, 7);
    for (let y = s.y; y < s.y + s.h - 7; y += 8) {
      const row = Math.round((y - s.y) / 8);
      for (let x = s.x - (row % 2) * 7; x < s.x + s.w; x += 14) {
        ctx.fillStyle = hash(Math.floor(x * 7 + y)) > 0.5 ? '#b5503a' : '#a3452f';
        ctx.fillRect(Math.max(x, s.x) + 1, y + 1, Math.min(13, s.x + s.w - Math.max(x, s.x) - 1), 7);
      }
    }
  }

  function drawDecor(d, ctx, api) {
    const x = d.x, y = d.y;
    if (d.kind === 'cone') {
      ctx.fillStyle = '#ff6d1a'; ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x, y - 20); ctx.lineTo(x + 7, y); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 4, y - 11, 8, 3); ctx.fillStyle = '#333'; ctx.fillRect(x - 9, y - 2, 18, 2);
    } else if (d.kind === 'sign') {
      ctx.fillStyle = '#666'; ctx.fillRect(x - 1, y - 30, 2, 30);
      ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.moveTo(x, y - 48); ctx.lineTo(x + 13, y - 26); ctx.lineTo(x - 13, y - 26); ctx.fill();
      api.text('!', x, y - 29, 13, '#111');
    } else if (d.kind === 'sand') {
      ctx.fillStyle = '#d9b77a'; ctx.beginPath(); ctx.ellipse(x, y, 26, 14, 0, Math.PI, 0); ctx.fill();
    } else if (d.kind === 'bags') {
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i % 2 ? '#cfc6b3' : '#bfb49e'; ctx.fillRect(x - 16 + (i % 2) * 8, y - 8 - Math.floor(i / 2) * 8, 18, 8); }
    } else if (d.kind === 'barrel') {
      ctx.fillStyle = '#2f6db3'; ctx.fillRect(x - 8, y - 22, 16, 22); ctx.fillStyle = '#244f80'; ctx.fillRect(x - 8, y - 16, 16, 2); ctx.fillRect(x - 8, y - 8, 16, 2);
    }
  }

  function drawFinish(fx, gy, ctx, api) { // прорабская за финишным флагом
    const x = fx + 140, y = gy;
    ctx.fillStyle = '#2f6db3'; ctx.fillRect(x, y - 70, 130, 70);
    ctx.fillStyle = '#244f80'; for (let i = 0; i < 130; i += 10) ctx.fillRect(x + i, y - 70, 2, 70);
    ctx.fillStyle = '#bfe3ff'; ctx.fillRect(x + 14, y - 52, 34, 22);
    ctx.fillStyle = '#6b4a2f'; ctx.fillRect(x + 88, y - 56, 24, 56);
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 20, y - 84, 92, 16);
    api.text('ПРОРАБСКАЯ', x + 66, y - 72, 10, '#b3261e');
  }

  // ---------- враги ----------
  // враг виден в кадре (с учётом подъёма камеры) — стреляют только видимые, из-за края кадра не бьют
  const onScreen = (e, api) => e.y + e.h > api.camY + 12 && e.y < api.camY + api.H - 10 && e.x + e.w > api.camX && e.x < api.camX + api.W;
  function drawBolt(p, ctx) { // импульс тахеометра: красная «пуля» света с хвостом
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.fillStyle = 'rgba(255,60,60,.35)'; ctx.fillRect(-16, -3, 22, 6);
    ctx.fillStyle = '#ff3030'; ctx.fillRect(-8, -2, 14, 4);
    ctx.fillStyle = '#fff0f0'; ctx.fillRect(0, -1, 6, 2);
  }
  const drawBrick = (p, ctx) => { ctx.fillStyle = '#b5503a'; ctx.fillRect(-7, -4, 14, 8); ctx.fillStyle = '#8a3522'; ctx.fillRect(-7, 2, 14, 2); };

  const enemies = {
    dog: { // сторожевой пёс: патрулирует, а заметив — бросается
      w: 34, h: 22, hp: 1, pts: 100,
      update(e, dt, api) {
        const near = api.near(e);
        if (near) e.dir = Math.sign(api.dx(e)) || e.dir;
        api.patrol(e, near ? 190 : 55, dt);
      },
      draw(e, ctx) {
        const leg = Math.sin(e.t * 16) * 4;
        ctx.fillStyle = '#8d5a2b'; ctx.fillRect(-12, -16, 22, 10);
        ctx.fillRect(-10 + leg, -7, 3, 7); ctx.fillRect(4 - leg, -7, 3, 7);
        ctx.beginPath(); ctx.arc(12, -17, 7, 0, 7); ctx.fill();
        ctx.fillStyle = '#6b4220'; ctx.fillRect(8, -26, 4, 6); ctx.fillRect(16, -12, 6, 3);
        ctx.strokeStyle = '#8d5a2b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-12, -14); ctx.lineTo(-18, -20 + Math.sin(e.t * 20) * 3); ctx.stroke();
        ctx.fillStyle = '#ff3b3b'; ctx.fillRect(13, -20, 3, 2);
        ctx.fillStyle = '#d32f2f'; ctx.fillRect(3, -17, 4, 7); // ошейник
      },
    },
    drone: { // дрон-инспектор: висит, затем пикирует на игрока и возвращается
      w: 30, h: 14, hp: 1, pts: 150, flip: false, hitColor: '#ffd76a',
      init(e, api) { e.baseY = e.y; e.homeX = e.x; e.state = 'hover'; },
      update(e, dt, api) {
        const P = api.player, pcx = P.x + P.w / 2, ecx = e.x + e.w / 2;
        if (e.state === 'hover') {
          e.x = e.homeX + Math.sin(e.t * 1.3) * 60; e.y = e.baseY + Math.sin(e.t * 3) * 6;
          e.cd -= dt;
          if (e.cd <= 0 && Math.abs(pcx - ecx) < 200 && P.y > e.y) { e.state = 'dive'; e.tx = pcx; e.ty = P.y + 10; }
        } else if (e.state === 'dive') {
          const vx = e.tx - ecx, vy = e.ty - e.y, d = Math.hypot(vx, vy);
          if (d < 8) e.state = 'back'; else { e.x += vx / d * 260 * dt; e.y += vy / d * 260 * dt; }
        } else {
          const vx = e.homeX - e.x, vy = e.baseY - e.y, d = Math.hypot(vx, vy);
          if (d < 6) { e.state = 'hover'; e.cd = api.rand(1.2, 2.2); e.t = 0; } else { e.x += vx / d * 120 * dt; e.y += vy / d * 120 * dt; }
        }
      },
      draw(e, ctx) {
        ctx.fillStyle = '#4a4f5a'; ctx.fillRect(-10, -12, 20, 8);
        ctx.fillStyle = '#2a2d33'; ctx.fillRect(-15, -14, 30, 2);
        ctx.fillStyle = 'rgba(200,210,220,.6)';
        for (const rx of [-15, 15]) { ctx.beginPath(); ctx.ellipse(rx, -15, 8 * Math.abs(Math.sin(e.t * 40)) + 2, 1.5, 0, 0, 7); ctx.fill(); }
        ctx.fillStyle = Math.sin(e.t * 8) > 0 ? '#ff2d2d' : '#661111'; ctx.fillRect(-2, -12, 4, 3);
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, -3, 3, 0, 7); ctx.fill();
      },
    },
    mixer: { // бетономешалка: медленно, но упорно катится к игроку
      w: 58, h: 42, hp: 3, pts: 300, heavy: true, hitColor: '#ffd76a',
      update(e, dt, api) {
        const near = api.near(e);
        if (near) e.dir = Math.sign(api.dx(e)) || e.dir;
        api.patrol(e, near ? 70 : 40, dt);
      },
      draw(e, ctx) {
        ctx.fillStyle = '#333'; for (const wx of [-18, 16]) { ctx.beginPath(); ctx.arc(wx, -7, 7, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#555'; ctx.fillRect(-27, -16, 54, 8);
        ctx.fillStyle = '#f2c230'; ctx.fillRect(14, -34, 14, 20); ctx.fillStyle = '#9fd3ff'; ctx.fillRect(18, -31, 8, 7); // кабина
        ctx.save(); ctx.translate(-5, -28); ctx.rotate(-0.3); // вращающийся барабан
        ctx.beginPath(); ctx.ellipse(0, 0, 20, 13, 0, 0, 7); ctx.fillStyle = '#e8e4da'; ctx.fill(); ctx.clip();
        ctx.fillStyle = '#ff7a1a';
        for (let i = -3; i < 4; i++) { const o = ((e.t * 30) % 16) + i * 16; ctx.beginPath(); ctx.moveTo(o - 6, -14); ctx.lineTo(o + 2, -14); ctx.lineTo(o - 6, 14); ctx.lineTo(o - 14, 14); ctx.fill(); }
        ctx.restore();
        ctx.fillStyle = '#b3261e'; ctx.fillRect(-12, -32, 5, 3); ctx.fillRect(-2, -32, 5, 3); // злые глаза
        for (let i = 0; i < e.maxHp - e.hp; i++) { ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-15 + i * 8, -38); ctx.lineTo(-10 + i * 8, -26); ctx.stroke(); } // трещины
      },
    },
    foreman: { // прораб на лесах: кидает кирпичи по дуге
      w: 20, h: 40, hp: 2, pts: 200,
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e);
        e.dir = Math.sign(dx) || 1;
        e.cd -= dt;
        if (e.cd <= 0 && Math.abs(dx) < 380 && onScreen(e, api)) {
          e.cd = api.rand(1.8, 2.6); e.throwT = 0.3;
          const tf = api.clamp(Math.abs(dx) / 260, 0.6, 1.3);
          api.shoot({ x: e.x + e.w / 2, y: e.y + 6, w: 14, h: 8, vx: dx / tf, vy: ((P.y + 20) - e.y - 0.5 * 900 * tf * tf) / tf, spin: 10, color: '#c0533a', draw: drawBrick, source: e });
        }
        e.throwT = Math.max(0, (e.throwT || 0) - dt);
      },
      draw(e, ctx) {
        ctx.fillStyle = '#2b3445'; ctx.fillRect(-6, -18, 5, 18); ctx.fillRect(1, -18, 5, 18);
        ctx.fillStyle = '#f5f5f5'; ctx.fillRect(-8, -36, 16, 19);
        ctx.fillStyle = '#1f3d7a'; ctx.fillRect(-1, -35, 2, 12); // галстук
        ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(0, -42, 6, 0, 7); ctx.fill();
        ctx.fillStyle = '#4a3320'; ctx.fillRect(0, -40, 7, 2); // усы
        ctx.fillStyle = '#d32f2f'; ctx.beginPath(); ctx.arc(0, -45, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(-7, -46, 16, 2);
        const arm = e.throwT > 0 ? -2.2 : -0.6;
        ctx.save(); ctx.translate(6, -32); ctx.rotate(arm); ctx.fillStyle = '#f5f5f5'; ctx.fillRect(0, -2, 12, 4);
        if (!(e.throwT > 0) && e.cd < 0.8) { ctx.fillStyle = '#b5503a'; ctx.fillRect(10, -4, 8, 6); }
        ctx.restore();
      },
    },
    rival: { // геодезист-конкурент на ярусе: наводит лазер тахеометра (1 с), фиксирует луч (0,4 с) и бьёт импульсом
      w: 22, h: 40, hp: 2, pts: 250, hitColor: '#ff8080', deathColor: '#ff5050',
      init(e) { e.st = 'idle'; e.sT = 0; e.tx = 0; e.ty = 0; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e), px = P.x + P.w / 2, py = P.y + P.h * 0.45;
        const ox = e.x + e.w / 2 + e.dir * 16, oy = e.y + 10; // объектив прибора
        e.sT += dt;
        if (e.st === 'idle') { // переминается у штатива, поглядывает на героя
          if (Math.abs(dx) > 10) e.dir = Math.sign(dx);
          e.cd -= dt;
          if (e.cd <= 0 && Math.abs(dx) < 420 && Math.abs(dx) > 30 && onScreen(e, api)) { e.st = 'aim'; e.sT = 0; }
        } else if (e.st === 'aim') { // луч следит за героем
          if (Math.abs(dx) > 10) e.dir = Math.sign(dx);
          e.tx = px; e.ty = py;
          if (e.sT >= 1) { e.st = 'lock'; e.sT = 0; api.sfx('select'); }
          else if (Math.abs(dx) > 480) { e.st = 'idle'; e.cd = 0.6; }
        } else if (e.st === 'lock') { // луч замер — пора уходить с линии
          if (e.sT >= 0.4) {
            const vx = e.tx - ox, vy = e.ty - oy, d = Math.hypot(vx, vy) || 1;
            api.shoot({ x: ox, y: oy, w: 10, h: 10, vx: vx / d * 430, vy: vy / d * 430, gravity: 0, life: 2.2, color: '#ff4040', draw: drawBolt, reflectable: true, source: e, pts: 20 });
            e.st = 'rest'; e.sT = 0;
          }
        } else if (e.sT >= 0.5) { e.st = 'idle'; e.cd = api.rand(1.6, 2.3); }
      },
      draw(e, ctx, api) {
        const t = e.t, aim = e.st === 'aim', lock = e.st === 'lock', bob = Math.sin(t * 2) * 0.6;
        // лазер: от объектива к точке прицела (локальные координаты с учётом отражения)
        if (aim || lock) {
          const lx = (e.tx - (e.x + e.w / 2)) * e.dir, ly = e.ty - (e.y + e.h), ox = 16, oy = -30;
          const vx = lx - ox, vy = ly - oy, d = Math.hypot(vx, vy) || 1, L = Math.min(d, 520);
          ctx.strokeStyle = lock ? (Math.floor(e.sT * 20) % 2 ? '#ffffff' : '#ff2020') : `rgba(255,40,40,${0.35 + 0.3 * Math.abs(Math.sin(t * (6 + e.sT * 18)))})`;
          ctx.lineWidth = lock ? 2.5 : 1; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + vx / d * L, oy + vy / d * L); ctx.stroke();
          if (d < 520) { ctx.fillStyle = 'rgba(255,40,40,.7)'; ctx.beginPath(); ctx.arc(lx, ly, lock ? 5 : 3, 0, 7); ctx.fill(); } // точка на цели
        }
        // штатив с тахеометром впереди
        ctx.strokeStyle = '#d9c24a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(14, -26); ctx.lineTo(6, 0); ctx.moveTo(14, -26); ctx.lineTo(22, 0); ctx.moveTo(14, -26); ctx.lineTo(15, 0); ctx.stroke();
        ctx.fillStyle = '#3a3a40'; ctx.fillRect(8, -36, 14, 10);
        ctx.fillStyle = '#e6e6e6'; ctx.fillRect(9, -35, 12, 3);
        ctx.fillStyle = aim || lock ? '#ff3030' : '#8b1a1a'; ctx.fillRect(20, -32, 3, 4);
        // сам конкурент: чёрная куртка, синяя каска, очки
        ctx.fillStyle = '#23262d'; ctx.fillRect(-7, -18, 5, 18); ctx.fillRect(0, -18, 5, 18);
        ctx.fillStyle = '#2e3440'; ctx.fillRect(-9, -36 + bob, 16, 19);
        ctx.fillStyle = '#c7ff3a'; ctx.fillRect(-9, -28 + bob, 16, 2); // светоотражающая полоса
        ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(-1, -42 + bob, 6, 0, 7); ctx.fill();
        ctx.fillStyle = '#1f3d7a'; ctx.beginPath(); ctx.arc(-1, -45 + bob, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(-8, -46 + bob, 16, 2);
        ctx.fillStyle = '#111'; ctx.fillRect(1, -44 + bob, 6, 2);
        // рука у прибора: при наводке прильнул к окуляру
        ctx.fillStyle = '#2e3440'; ctx.save(); ctx.translate(4, -32 + bob); ctx.rotate(aim || lock ? -0.1 : 0.6); ctx.fillRect(0, -2, 10, 4); ctx.restore();
        if (lock) api.text('!', -1, -56, 13, '#ff3030');
      },
    },
    guard: { // охранник ЧОП со щитом: щит спереди держит удар рейки (и оглушает его), со спины и сверху уязвим
      w: 26, h: 40, hp: 2, pts: 250, hitColor: '#c9d6e6', deathColor: '#7aa0d0',
      init(e) { e.st = 'walk'; e.sT = 0; e.stun = 0; e.lx = 0; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e), same = Math.abs(P.y + P.h - e.groundY) < 50;
        e.sT += dt; e.stun = Math.max(0, e.stun - dt);
        if (e.stun > 0) return; // оглушён: щит поднят, стоит на месте
        if (e.st === 'walk') {
          const near = Math.abs(dx) < 230 && same;
          if (near && Math.abs(dx) > 8) e.dir = Math.sign(dx);
          api.patrol(e, near ? 60 : 35, dt);
          e.cd -= dt;
          if (near && e.cd <= 0 && Math.abs(dx) < 80) { e.st = 'wind'; e.sT = 0; }
        } else if (e.st === 'wind') { // замах дубинкой из-за щита — телеграф рывка
          if (e.sT >= 0.85) { e.st = 'bash'; e.sT = 0; }
        } else if (e.st === 'bash') { // рывок щитом вперёд
          e.x = api.clamp(e.x + e.dir * 240 * dt, e.minX, e.maxX - e.w);
          if (e.sT >= 0.25) { e.st = 'rest'; e.sT = 0; }
        } else if (e.sT >= 0.8) { e.st = 'walk'; e.cd = api.rand(0.8, 1.4); } // отдышка: щит опущен
      },
      onHit(e, api, source) {
        if (source !== 'staff' || e.stun > 0 || e.st === 'rest') return true;
        const front = Math.sign(api.dx(e)) === e.dir;
        if (!front) return true;
        e.stun = 1.1; e.st = 'walk'; e.sT = 0; e.cd = 1; // щит выбит вверх — открыт на ~1 с
        api.burst(e.x + e.w / 2 + e.dir * 14, e.y + 18, '#e8f0ff', 6, 140, 400);
        return false;
      },
      draw(e, ctx, api) {
        const t = e.t, st = e.st, stun = e.stun > 0, walk = st === 'walk' && !stun ? Math.sin(t * 9) * 3 : 0;
        const lean = st === 'bash' ? 4 : 0;
        ctx.fillStyle = '#1d2230'; ctx.fillRect(-7 + walk * 0.5, -18, 5, 18); ctx.fillRect(1 - walk * 0.5, -18, 5, 18); // брюки
        ctx.fillStyle = '#111'; ctx.fillRect(-8 + walk * 0.5, -3, 7, 3); ctx.fillRect(0 - walk * 0.5, -3, 7, 3);
        ctx.save(); ctx.translate(lean, 0);
        ctx.fillStyle = '#2b2f38'; ctx.fillRect(-9, -37, 17, 20); // чёрная форма
        ctx.fillStyle = '#e8e2d0'; ctx.fillRect(-8, -33, 6, 3);
        ctx.save(); ctx.translate(-1, -22); ctx.scale(e.dir || 1, 1); api.text('ЧОП', 0, 0, 6, '#e8e2d0'); ctx.restore(); // надпись не зеркалим
        ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(0, -42, 6, 0, 7); ctx.fill();
        ctx.fillStyle = '#1b1d22'; ctx.beginPath(); ctx.arc(0, -45, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(-7, -46, 17, 2); // кепи
        ctx.fillStyle = '#111'; ctx.fillRect(2, -43, 5, 2);
        // дубинка: в замахе поднята и мигает
        const club = st === 'wind' ? -2.3 + Math.sin(e.sT * 30) * 0.08 : st === 'bash' ? -0.4 : 0.9;
        ctx.save(); ctx.translate(-4, -32); ctx.rotate(club);
        ctx.fillStyle = '#2b2f38'; ctx.fillRect(0, -2, 9, 4);
        ctx.fillStyle = st === 'wind' && Math.floor(e.sT * 10) % 2 ? '#ffd76a' : '#111'; ctx.fillRect(8, -1.5, 14, 3);
        ctx.restore();
        // щит: в оглушении задран вверх, при отдышке опущен
        ctx.save();
        if (stun) { ctx.translate(12, -40); ctx.rotate(-1.2 + Math.sin(t * 25) * 0.1); ctx.translate(-12, 40); }
        else if (st === 'rest') ctx.translate(-2, 8);
        ctx.fillStyle = 'rgba(170,200,230,.55)'; ctx.fillRect(9, -44, 8, 40);
        ctx.strokeStyle = '#dfe8f2'; ctx.lineWidth = 1.5; ctx.strokeRect(9, -44, 8, 40);
        ctx.fillStyle = '#e8f0ff'; ctx.fillRect(10, -40, 2, 30);
        ctx.fillStyle = '#1b1d22'; ctx.fillRect(10, -30, 6, 4);
        ctx.restore();
        ctx.restore();
        if (stun) for (let k = 0; k < 3; k++) { const a = t * 6 + k * 2.1; ctx.fillStyle = '#ffd76a'; ctx.fillRect(Math.cos(a) * 9 - 1, -56 + Math.sin(a) * 3, 3, 3); } // звёздочки
      },
    },
  };

  registerTheme({
    index: 1, id: 'city', hero: { weapon: 'staff' },
    title: 'Городская стройка', subtitle: 'Жилой квартал на закате: краны, леса, котлованы',
    accent: '#ffb02e', dust: '#b9a58a',
    gen: { foreman: true }, // разгневанный прораб
    decor: ['cone', 'cone', 'sign', 'sand', 'bags', 'barrel'],
    enemies,
    enemyTable: [
      { type: 'dog', where: 'ground', weight: 3 },
      { type: 'drone', where: 'air', weight: 2 },
      { type: 'mixer', where: 'ground', weight: 2, from: 0.3 },
      { type: 'foreman', where: 'upper', weight: 1 },
      { type: 'rival', where: 'upper', weight: 1.4, from: 0.1 },
      { type: 'guard', where: 'ground', weight: 1.5, from: 0.2 },
    ],
    drawBackground, drawGround, drawPit, drawPlatform, drawObstacle, drawDecor, drawFinish,
  });
})();
