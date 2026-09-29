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

  function drawPit(p, ctx, api) { // котлован с арматурой и полосатый барьер на краю
    const { H, hash } = api;
    ctx.fillStyle = '#1d1510'; ctx.fillRect(p.x, p.y, p.w, H);
    ctx.strokeStyle = '#8a4a2a'; ctx.lineWidth = 2;
    for (let x = p.x + 8; x < p.x + p.w - 4; x += 12) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + 2, H - 30 - hash(Math.floor(x)) * 20); ctx.stroke(); }
    const bx = p.x - 26;
    ctx.fillStyle = '#ddd'; ctx.fillRect(bx, p.y - 18, 2, 18); ctx.fillRect(bx + 18, p.y - 18, 2, 18);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#111' : '#f2c230'; ctx.fillRect(bx - 2 + i * 5, p.y - 20, 5, 6); }
  }

  function drawPlatform(p, ctx) { // строительные леса: трубы, раскосы, дощатый настил
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
        if (e.cd <= 0 && Math.abs(dx) < 380) {
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
  };

  registerTheme({
    index: 1, id: 'city',
    title: 'Городская стройка', subtitle: 'Жилой квартал на закате: краны, леса, котлованы',
    accent: '#ffb02e', dust: '#b9a58a',
    gen: {},
    decor: ['cone', 'cone', 'sign', 'sand', 'bags', 'barrel'],
    enemies,
    enemyTable: [
      { type: 'dog', where: 'ground', weight: 3 },
      { type: 'drone', where: 'air', weight: 2 },
      { type: 'mixer', where: 'ground', weight: 2, from: 0.3 },
      { type: 'foreman', where: 'upper', weight: 1 },
    ],
    drawBackground, drawGround, drawPit, drawPlatform, drawObstacle, drawDecor, drawFinish,
  });
})();
