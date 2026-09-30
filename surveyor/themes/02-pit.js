'use strict';
// Участок 2 — котлован: подземная часть дома. Стены из шпунта Ларсена, распорки, прожекторы, водоотлив.
// Контракт темы: см. THEMES.md, образец — 01-city.js.
(() => {
  // ---------- общее ----------
  const FLOOR = 306;                      // ниже этой линии фон всегда закрыт грунтом или приямком
  let skyG = null;                        // градиент неба создаётся один раз
  // шпунт по зонам глубины (стыки зон спрятаны за обвязочными поясами): впадина, светлая грань, выступ, тень
  const PILE_Z = [[0, 110], [124, 202], [216, FLOOR]];
  const PILE_C = [['#5b321f', '#a4633b', '#7e4529', '#40220f'], ['#4b2919', '#844f2f', '#663821', '#361c0d'], ['#3a2013', '#623a23', '#4d2a19', '#2b170a']];
  const PILE_S = [[-8, 12.5], [4, 2.5], [6, 11.5], [17, 3.5]]; // смещение и ширина полос внутри листа (шаг 28)
  const groundG = new Map();              // градиенты грунта по высоте земли (их немного)
  const puddleCache = new WeakMap();      // лужи на отрезке земли — считаются один раз
  const st = { splashT: 0 };              // состояние темы (брызги из луж)

  // Обход ошибки генератора: зажим groundRange иногда даёт соседние отрезки с перепадом 1–4 ед. — на вид ровно,
  // а герой упирается (на уступ движок не шагает). Поднимаем нижнюю «серию» отрезков до соседней высоты вместе
  // с блоками, платформами, врагами и приямком за ней. Высоты остаются в groundRange, поэтому перепады ≤ 55.
  // Декор и чекпоинты (их нет в api) при подъёме уходят в грунт на ≤ 4 ед. — это незаметно, не «висят».
  function fixTinySteps(api) {
    const { solids, platforms, enemies, pits, player: P } = api, adj = (a, b) => Math.abs(b.x - a.x - a.w) < 0.5;
    for (let pass = 0; pass < 12; pass++) {
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
      for (const l of api.ladders || []) if (inRun(l)) { // лестницы вышки поднимаются вместе с ярусами, у стены — только низ
        if (!l.wall) { l.top += d; l.bottom += d; } else if (Math.abs(l.bottom - y0) < 0.5) l.bottom += d;
      }
    }
    const top = api.groundAt(P.x + P.w / 2);
    if (top !== null && P.y + P.h > top) P.y = top - P.h; // стартовый отрезок мог подняться — ставим героя на него
  }

  function puddlesOf(s, hash) { // лужи на верхней грани грунта: детерминированы по x отрезка
    let arr = puddleCache.get(s);
    if (arr) return arr;
    arr = [];
    for (let x = s.x + 40; x < s.x + s.w - 60; x += 150) {
      const h = hash(Math.floor(x) * 5 + 17);
      if (h > 0.45) arr.push({ x: x + h * 50, w: 26 + h * 30 });
    }
    puddleCache.set(s, arr);
    return arr;
  }

  // ---------- фон ----------
  function drawBackground(ctx, api) {
    const { W, camX, hash, now } = api;
    if (!skyG) {
      skyG = ctx.createLinearGradient(0, 0, 0, 80);
      skyG.addColorStop(0, '#3f5f7e'); skyG.addColorStop(0.55, '#8ea8b8'); skyG.addColorStop(1, '#e2d5b8');
    }
    // узкая полоска утреннего неба и города над краем котлована
    ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, 80);
    let off = camX * 0.05, step = 30;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const h = 12 + hash(i + 300) * 30, x = i * step - off, y = 74 - h;
      ctx.fillStyle = hash(i + 301) > 0.5 ? '#72879a' : '#62778a'; ctx.fillRect(x, y, step - 2, h);
      ctx.fillStyle = 'rgba(255,214,140,.75)';
      for (let r = 0; y + 4 + r * 7 < 70; r++) for (let c = 0; c < 4; c++) if (hash(i * 97 + r * 13 + c) > 0.78) ctx.fillRect(x + 3 + c * 6, y + 4 + r * 7, 2, 3);
    }
    // далёкий башенный кран: только стрела и кабина видны над бровкой
    off = camX * 0.08; step = 760;
    ctx.strokeStyle = '#4b5d6e'; ctx.lineWidth = 1.5;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off + hash(i + 70) * 300;
      ctx.strokeRect(x, 36, 5, 40);
      ctx.beginPath(); ctx.moveTo(x - 34, 41); ctx.lineTo(x + 120, 41); ctx.moveTo(x + 2, 33); ctx.lineTo(x + 120, 41); ctx.moveTo(x + 2, 33); ctx.lineTo(x - 34, 41); ctx.stroke();
      const tx = x + 60 + Math.sin(now * 0.3 + i) * 40;
      ctx.beginPath(); ctx.moveTo(tx, 41); ctx.lineTo(tx, 64); ctx.stroke();
      ctx.fillStyle = '#4b5d6e'; ctx.fillRect(tx - 3, 64, 6, 4); ctx.fillRect(x - 32, 41, 12, 6);
    }
    // бровка котлована и ограждение
    off = camX * 0.12; step = 24;
    ctx.fillStyle = '#5a4535'; ctx.fillRect(0, 72, W, 9);
    ctx.fillStyle = '#7a6049'; ctx.fillRect(0, 72, W, 2);
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off;
      ctx.fillStyle = '#d6d6d6'; ctx.fillRect(x, 57, 2, 16);
      ctx.fillStyle = i % 2 ? '#d23a2a' : '#f0ece4'; ctx.fillRect(x, 59, step, 3); ctx.fillRect(x, 66, step, 2);
    }

    // стена из шпунта Ларсена: гофрированная ржавая сталь
    off = camX * 0.22; step = 28;
    const i0 = Math.floor(off / step) - 1, i1 = (off + W) / step + 1;
    for (let z = 0; z < 3; z++) for (let k = 0; k < 4; k++) { // каждая полоса — один раз, без перекрытий; к дну темнее
      ctx.fillStyle = PILE_C[z][k];
      const [sx, sw] = PILE_S[k], lift = k === 1 || k === 2 ? 2 : 0;
      for (let i = i0; i < i1; i++) {
        const y0 = z ? PILE_Z[z][0] : 77 + hash(i + 1000) * 4 - lift;
        ctx.fillRect(i * step - off + sx, y0, sw, PILE_Z[z][1] - y0);
      }
    }
    for (let i = i0; i < i1; i++) {
      const x = i * step - off, v = hash(i + 1000);
      if (v > 0.45) { ctx.fillStyle = 'rgba(40,16,5,.4)'; ctx.fillRect(x + 7 + v * 6, 90 + v * 50, 3, 40 + v * 90); } // потёк ржавчины
      if (v < 0.22) { ctx.fillStyle = 'rgba(40,70,80,.35)'; ctx.fillRect(x + 19, 124 + v * 220, 6, 80); }             // течь в замке шпунта
    }
    // обвязочные пояса из двутавра (приглушены — это фон, а не платформы)
    for (const wy of [110, 202]) {
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0, wy + 14, W, 5);
      ctx.fillStyle = wy > 150 ? '#24272c' : '#2f3339'; ctx.fillRect(0, wy, W, 14);
      ctx.fillStyle = wy > 150 ? '#373c43' : '#474e57'; ctx.fillRect(0, wy, W, 2); ctx.fillRect(0, wy + 11, W, 2);
    }
    step = 140;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off, v = hash(i + 1500);
      ctx.fillStyle = '#23272c'; ctx.fillRect(x + 20, 112, 2, 10); ctx.fillRect(x + 90, 204, 2, 10); // рёбра жёсткости
      // торец поперечной распорки (труба уходит к противоположной стене)
      const cx = x + 70, cy = 117;
      ctx.fillStyle = '#545c65'; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, 7); ctx.fill();
      ctx.fillStyle = '#3a4047'; ctx.beginPath(); ctx.arc(cx + 1, cy + 1, 8, 0, 7); ctx.fill();
      ctx.fillStyle = '#7d8690'; for (let b = 0; b < 4; b++) ctx.fillRect(cx + (b % 2 ? 9 : -10), cy + (b < 2 ? -6 : 4), 2, 2);
      if (v > 0.6 && hash(i + 1499) <= 0.6) { // насос водоотлива на нижнем поясе (не два подряд): дрожит, по рукаву вода уходит наверх, за бровку
        const px = x + 14 + Math.sin(now * 50 + i) * 0.5, hx = x + 46;
        ctx.strokeStyle = '#263a4d'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(px + 24, 195); ctx.quadraticCurveTo(hx, 195, hx, 178); ctx.lineTo(hx, 92); ctx.quadraticCurveTo(hx, 76, hx + 16, 74); ctx.stroke();
        ctx.fillStyle = 'rgba(160,220,235,.8)'; for (let k = 0; k < 8; k++) ctx.fillRect(hx - 1, 178 - ((now * 40 + k * 11) % 86), 2, 3); // вода бежит вверх
        ctx.fillStyle = '#8d969f'; ctx.fillRect(hx - 5, 126, 10, 3); ctx.fillRect(hx - 5, 160, 10, 3); // хомуты
        ctx.fillStyle = '#2f6aa3'; ctx.fillRect(px, 188, 20, 14);
        ctx.fillStyle = '#23527f'; for (let f = 0; f < 4; f++) ctx.fillRect(px + 2 + f * 5, 188, 2, 14);
        ctx.fillStyle = '#b3342a'; ctx.beginPath(); ctx.arc(px + 22, 195, 6, 0, 7); ctx.fill();
      }
    }

    // средний план: трубчатая распорка через весь котлован, стойки, прожекторы
    off = camX * 0.42; const sy = 148;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, sy + 16, W, 6);
    ctx.fillStyle = '#414850'; ctx.fillRect(0, sy, W, 16);
    ctx.fillStyle = '#6f7a85'; ctx.fillRect(0, sy + 3, W, 3);
    ctx.fillStyle = '#2d3238'; ctx.fillRect(0, sy + 12, W, 4);
    step = 330;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off, px = x + 165;
      ctx.fillStyle = '#2d3238'; ctx.fillRect(x - 4, sy - 3, 8, 22);                         // фланцевый стык
      ctx.fillStyle = '#a3acb5'; for (let b = 0; b < 3; b++) ctx.fillRect(x - 1, sy + 1 + b * 6, 2, 2);
      ctx.fillStyle = '#343a41'; ctx.fillRect(px - 5, sy + 16, 10, FLOOR - sy - 16);          // стойка до дна
      ctx.fillStyle = '#4f5862'; ctx.fillRect(px - 5, sy + 16, 2, FLOOR - sy - 16);
      ctx.strokeStyle = '#343a41'; ctx.lineWidth = 4;                                          // подкосы
      ctx.beginPath(); ctx.moveTo(px - 60, sy + 15); ctx.lineTo(px - 4, sy + 66); ctx.moveTo(px + 60, sy + 15); ctx.lineTo(px + 4, sy + 66); ctx.stroke();
      // прожектор: конус света и пылинки в нём (изредка мигает)
      const lx = px + 30, ly = sy + 22, fl = hash(i * 7 + Math.floor(now * 9)) > 0.96 ? 0.3 : 1;
      ctx.fillStyle = `rgba(255,236,170,${0.07 * fl})`;
      ctx.beginPath(); ctx.moveTo(lx - 6, ly + 4); ctx.lineTo(lx + 8, ly + 4); ctx.lineTo(lx + 140, 300); ctx.lineTo(lx - 40, 300); ctx.fill();
      ctx.fillStyle = `rgba(255,246,205,${0.08 * fl})`;
      ctx.beginPath(); ctx.moveTo(lx - 2, ly + 4); ctx.lineTo(lx + 4, ly + 4); ctx.lineTo(lx + 85, 300); ctx.lineTo(lx + 5, 300); ctx.fill();
      ctx.fillStyle = 'rgba(255,245,210,.55)';
      for (let k = 0; k < 7; k++) {
        const u = (hash(i * 31 + k) + now * 0.04 * (1 + k % 3)) % 1, dy = 30 + ((hash(i * 17 + k) * 150 + now * 7) % 120);
        ctx.fillRect(lx + dy * (u * 0.9 - 0.15), ly + dy, 1.5, 1.5);
      }
      ctx.fillStyle = '#343a41'; ctx.fillRect(px + 4, sy + 16, 26, 3);
      ctx.fillStyle = '#23272c'; ctx.fillRect(lx - 9, ly - 6, 18, 11);
      ctx.fillStyle = fl < 1 ? '#8a8060' : '#fff6cc'; ctx.fillRect(lx - 7, ly + 3, 14, 3);
      ctx.fillStyle = `rgba(255,240,180,${0.22 * fl})`; ctx.beginPath(); ctx.arc(lx, ly + 5, 13, 0, 7); ctx.fill();
      // искры сварки на стыке распорки — рабочий где-то наверху
      if (hash(i + 2600) > 0.5) {
        const burstOn = (now * 0.7 + hash(i)) % 1 < 0.35;
        if (burstOn) {
          ctx.fillStyle = '#fff2a8'; ctx.beginPath(); ctx.arc(x + 6, sy + 2, 3, 0, 7); ctx.fill();
          ctx.fillStyle = '#ffb040';
          for (let k = 0; k < 6; k++) { const a = (now * 3 + k * 0.37) % 1; ctx.fillRect(x + 6 + (k - 2.5) * a * 12, sy + 2 + a * a * 40, 1.5, 1.5); }
        }
      }
    }
    // капель с распорки
    step = 70; ctx.fillStyle = '#a8d8e4';
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const v = hash(i + 3000); if (v < 0.5) continue;
      const ph = (now * (0.45 + v * 0.4) + v * 7) % 1;
      ctx.fillRect(i * step - off + v * 40, sy + 16 + ph * ph * 140, 1.5, 4);
    }
    // бадья с бетоном на крюке крана
    step = 900;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off + 420 + hash(i + 4000) * 200, sw = Math.sin(now * 0.8 + i) * 5, hy = 88 + Math.sin(now * 0.33 + i * 2) * 10;
      ctx.strokeStyle = '#1b1f23'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x + sw, hy); ctx.stroke();
      ctx.fillStyle = '#e0a526'; ctx.fillRect(x + sw - 4, hy, 8, 6);
      ctx.strokeStyle = '#1b1f23'; ctx.beginPath(); ctx.moveTo(x + sw, hy + 6); ctx.lineTo(x + sw - 12, hy + 16); ctx.moveTo(x + sw, hy + 6); ctx.lineTo(x + sw + 12, hy + 16); ctx.stroke();
      ctx.fillStyle = '#5c646c'; ctx.beginPath(); ctx.moveTo(x + sw - 14, hy + 16); ctx.lineTo(x + sw + 14, hy + 16); ctx.lineTo(x + sw + 5, hy + 40); ctx.lineTo(x + sw - 5, hy + 40); ctx.fill();
      ctx.fillStyle = '#7a838c'; ctx.fillRect(x + sw - 14, hy + 16, 28, 3);
    }

    // ближний фон: каркасы будущих колонн и мачты с прожекторами
    off = camX * 0.68; step = 260;
    for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
      const x = i * step - off, v = hash(i + 5000);
      if (v < 0.55) { // арматурные каркасы будущих круглых колонн: стержни и спираль хомутов
        for (let c = 0; c < 2; c++) {
          const cx = x + 50 + c * 74, top = 132 + hash(i * 3 + c) * 50;
          ctx.strokeStyle = '#34190d'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - 11, top + 10); // спираль сбоку — зигзаг
          for (let y = top + 14, s = 1; y < FLOOR; y += 4, s = -s) ctx.lineTo(cx + s * 11, y);
          ctx.stroke();
          for (let b = -2; b <= 2; b++) {
            const bt = top + hash(i * 11 + c * 5 + b + 2) * 10;
            ctx.fillStyle = b % 2 ? '#3f2114' : '#5c3220'; ctx.fillRect(cx + b * 5 - 1, bt, 2, FLOOR - bt);
            ctx.fillStyle = '#c85a18'; ctx.fillRect(cx + b * 5 - 2, bt - 3, 4, 3); // защитные колпачки
          }
        }
      } else if (v < 0.8) {
        const mx = x + 80;
        ctx.fillStyle = '#2a2e33'; ctx.fillRect(mx - 2, 120, 4, FLOOR - 120);
        ctx.fillRect(mx - 16, 118, 32, 3);
        for (const d of [-12, 12]) {
          ctx.fillStyle = '#1d2024'; ctx.fillRect(mx + d - 6, 108, 12, 10);
          ctx.fillStyle = '#fff4c4'; ctx.fillRect(mx + d - 5, 116, 10, 2);
        }
        ctx.fillStyle = 'rgba(255,238,175,.06)';
        ctx.beginPath(); ctx.moveTo(mx - 20, 118); ctx.lineTo(mx + 20, 118); ctx.lineTo(mx + 90, 300); ctx.lineTo(mx - 90, 300); ctx.fill();
      }
    }
  }

  // ---------- земля, провалы, платформы, препятствия ----------
  function drawGround(s, ctx, api) { // мокрая глина: блестящая кромка, лужи, следы сапог, слои суглинка
    if (s.wall) return drawWall(s, ctx, api);
    const { H, hash, now } = api;
    let g = groundG.get(s.y);
    if (!g) {
      if (groundG.size > 40) groundG.clear();
      g = ctx.createLinearGradient(0, s.y, 0, H);
      g.addColorStop(0, '#9a5a2e'); g.addColorStop(0.3, '#7c4322'); g.addColorStop(1, '#3a1f11');
      groundG.set(s.y, g);
    }
    ctx.fillStyle = g; ctx.fillRect(s.x - 0.5, s.y, s.w + 1, H - s.y + 10); // +1 — без щелей на стыках
    // верхняя грань шире на 1,5 — перекрывает сглаженный край соседнего отрезка, шва не видно
    ctx.fillStyle = '#b8703d'; ctx.fillRect(s.x - 1.5, s.y, s.w + 3, 7);      // верхняя грань
    ctx.fillStyle = '#d9925a'; ctx.fillRect(s.x - 1.5, s.y, s.w + 3, 1.5);    // мокрый блик по кромке
    ctx.fillStyle = '#8a4b25'; ctx.fillRect(s.x - 1.5, s.y + 7, s.w + 3, 2);
    // слои суглинка и камешки (полупрозрачное — строго в границах отрезка, чтобы не двоилось на стыке)
    ctx.fillStyle = 'rgba(214,150,90,.16)'; ctx.fillRect(s.x, s.y + 26, s.w, 5); ctx.fillRect(s.x, s.y + 58, s.w, 3);
    ctx.fillStyle = 'rgba(30,14,6,.28)';
    for (let x = s.x + 8; x < s.x + s.w - 8; x += 19) { const h = hash(Math.floor(x) * 3 + 1); ctx.fillRect(x, s.y + 14 + h * 60, 4 + h * 6, 2); }
    ctx.fillStyle = '#8f8a82';
    for (let x = s.x + 14; x < s.x + s.w - 8; x += 31) { const h = hash(Math.floor(x) * 11); if (h > 0.5) ctx.fillRect(x, s.y + 32 + h * 30, 3, 2); }
    // следы сапог на грани
    ctx.fillStyle = '#8c4c26';
    for (let x = s.x + 12; x < s.x + s.w - 12; x += 22) {
      const h = hash(Math.floor(x) * 7 + 3);
      if (h > 0.55) { const y = s.y + 2 + (Math.floor(x / 22) % 2) * 2; ctx.fillRect(x, y, 5, 1.6); ctx.fillRect(x + 6, y, 2, 1.6); }
    }
    // лужи с бликом
    for (const q of puddlesOf(s, hash)) {
      const cx = q.x + q.w / 2;
      ctx.fillStyle = '#6b3a1d'; ctx.beginPath(); ctx.ellipse(cx, s.y + 3.8, q.w / 2 + 2, 3.8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#3d6a78'; ctx.beginPath(); ctx.ellipse(cx, s.y + 3.8, q.w / 2, 2.8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(200,235,240,.7)'; ctx.fillRect(cx - q.w * 0.3 + Math.sin(now * 1.7 + q.x) * 3, s.y + 2.6, q.w * 0.35, 1);
    }
    // затенение открытых боковых стенок (у приямков и перепадов)
    const lt = api.groundAt(s.x - 3), rt = api.groundAt(s.x + s.w + 3);
    ctx.fillStyle = 'rgba(35,15,6,.4)';
    if (lt === null || lt > s.y + 2) ctx.fillRect(s.x - 0.5, s.y + 2, 5, (lt === null ? H : lt) - s.y);
    if (rt === null || rt > s.y + 2) ctx.fillRect(s.x + s.w - 4.5, s.y + 2, 5, (rt === null ? H : rt) - s.y);
  }

  // стена — подпорная стенка из блоков ФБС под монолитной плитой; по плите ходят
  function drawWall(s, ctx, api) {
    const { H, hash } = api;
    if (s.baseY === undefined) s.baseY = api.groundAt(s.x - 4) ?? s.y + 140; // уровень земли у подножия (кэш)
    const base = Math.max(s.y + 60, s.baseY), top = s.y + 12, rows = Math.max(3, Math.round((base - top) / 30)), bh = (base - top) / rows;
    let g = groundG.get(base);
    if (!g) { if (groundG.size > 40) groundG.clear(); g = ctx.createLinearGradient(0, base, 0, H); g.addColorStop(0, '#9a5a2e'); g.addColorStop(0.3, '#7c4322'); g.addColorStop(1, '#3a1f11'); groundG.set(base, g); }
    ctx.fillStyle = g; ctx.fillRect(s.x - 0.5, base, s.w + 1, H - base + 10);               // глина под стенкой
    ctx.fillStyle = '#6e7478'; ctx.fillRect(s.x, top, s.w, base - top);                      // растворные швы
    for (let r = 0; r < rows; r++) { // блоки вперевязку
      const y = top + r * bh, off = r % 2 ? 36 : 0;
      for (let x = s.x - off; x < s.x + s.w; x += 72) {
        const x0 = Math.max(x, s.x) + 1, x1 = Math.min(x + 72, s.x + s.w) - 1;
        if (x1 - x0 < 4) continue;
        const v = hash(Math.floor(x) * 7 + r * 13);
        ctx.fillStyle = v > 0.5 ? '#9da2a6' : '#959a9e'; ctx.fillRect(x0, y + 1, x1 - x0, bh - 2);
        ctx.fillStyle = '#b8bcbf'; ctx.fillRect(x0, y + 1, x1 - x0, 2);
        ctx.fillStyle = '#80868a'; ctx.fillRect(x0 + 6 + v * (x1 - x0 - 14), y + 6 + v * (bh - 12), 2, 1.5);
        if (v > 0.78 && x1 - x0 > 50) api.text('ФБС 24.4.6', x0 + 5, y + bh / 2 + 3, 6, 'rgba(150,40,30,.85)', 'left');
      }
    }
    for (let x = s.x + 14; x < s.x + s.w - 8; x += 38) { const v = hash(Math.floor(x) * 3 + 5); if (v > 0.55) { ctx.fillStyle = 'rgba(40,60,70,.3)'; ctx.fillRect(x, top + 10, 3, (base - top) * (0.4 + v * 0.5)); } } // потёки
    ctx.fillStyle = 'rgba(60,30,12,.4)'; ctx.fillRect(s.x, base - 12, s.w, 12);             // мокрый низ
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(s.x, top, 5, base - top); ctx.fillRect(s.x + s.w - 5, top, 5, base - top); // тень торцов
    // монолитная плита поверху: по ней ходят
    ctx.fillStyle = '#a9aeb1'; ctx.fillRect(s.x - 3, s.y, s.w + 6, 12);
    ctx.fillStyle = '#c9cdd0'; ctx.fillRect(s.x - 3, s.y, s.w + 6, 2);
    ctx.fillStyle = '#7b8185'; ctx.fillRect(s.x - 3, s.y + 10, s.w + 6, 2);
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i % 2 ? '#1b1b1b' : '#f2c230'; ctx.fillRect(s.x - 3 + i * 5, s.y + 3, 5, 6); ctx.fillRect(s.x + s.w - 12 + i * 5, s.y + 3, 5, 6); } // окраска торцов
    ctx.strokeStyle = '#5b4a3f'; ctx.lineWidth = 2; // монтажные петли
    for (let x = s.x + 30; x < s.x + s.w - 20; x += 90) { ctx.beginPath(); ctx.arc(x, s.y, 3, Math.PI, 0); ctx.stroke(); }
  }

  function drawLadder(l, ctx, api) { // у стены — деревянная приставная лестница, на вышке — стальная с ограждением-«корзиной»
    const h = l.bottom - l.top;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(l.x + 3, l.top, l.w - 2, h);
    if (l.wall) {
      ctx.fillStyle = '#8a5a2e'; ctx.fillRect(l.x, l.top - 12, 4, h + 12); ctx.fillRect(l.x + l.w - 4, l.top - 12, 4, h + 12);
      ctx.fillStyle = '#b07a44'; ctx.fillRect(l.x, l.top - 12, 1.5, h + 12); ctx.fillRect(l.x + l.w - 4, l.top - 12, 1.5, h + 12);
      for (let y = l.top + 6; y < l.bottom; y += 12) { ctx.fillStyle = '#c08a52'; ctx.fillRect(l.x + 3, y, l.w - 6, 4); ctx.fillStyle = '#6e4520'; ctx.fillRect(l.x + 3, y + 3, l.w - 6, 1); }
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(l.x - 1, l.bottom - 3, 6, 3); ctx.fillRect(l.x + l.w - 5, l.bottom - 3, 6, 3); // резиновые башмаки
      return;
    }
    ctx.fillStyle = '#3f5a73'; ctx.fillRect(l.x, l.top - 12, 3, h + 12); ctx.fillRect(l.x + l.w - 3, l.top - 12, 3, h + 12);
    ctx.fillStyle = '#c9d2da'; for (let y = l.top + 6; y < l.bottom; y += 12) ctx.fillRect(l.x + 2, y, l.w - 4, 3);
    ctx.strokeStyle = 'rgba(242,194,48,.75)'; ctx.lineWidth = 1.5; ctx.beginPath(); // дуги ограждения
    for (let y = l.top + 20; y < l.bottom - 50; y += 26) { ctx.moveTo(l.x - 2, y); ctx.quadraticCurveTo(l.x + l.w / 2, y - 7, l.x + l.w + 2, y); }
    ctx.stroke();
    ctx.fillStyle = '#f2c230'; ctx.fillRect(l.x - 1, l.top - 14, 5, 3); ctx.fillRect(l.x + l.w - 4, l.top - 14, 5, 3);
  }

  function drawPit(p, ctx, api) { // затопленный приямок: крепь из досок, тёмная вода с рябью, ведро на плаву
    const { H, hash, now } = api, wl = p.y + 24;
    ctx.fillStyle = '#34200f'; ctx.fillRect(p.x, p.y, p.w, wl - p.y + 2);
    for (let x = p.x + 3, k = 0; x < p.x + p.w - 3; x += 10, k++) { // доски крепи
      ctx.fillStyle = k % 2 ? '#5a3b22' : '#4f331d'; ctx.fillRect(x, p.y + 4, 9, wl - p.y - 2);
    }
    ctx.fillStyle = '#2a1a0c'; ctx.fillRect(p.x, p.y + 10, p.w, 2);
    ctx.fillStyle = '#16303a'; ctx.fillRect(p.x, wl, p.w, 18);                           // вода
    ctx.fillStyle = '#0d1f27'; ctx.fillRect(p.x, wl + 18, p.w, H - wl);
    ctx.fillStyle = 'rgba(120,190,205,.35)'; ctx.fillRect(p.x, wl, p.w, 2);              // линия уреза
    ctx.fillStyle = 'rgba(170,220,230,.55)';                                              // рябь
    for (let k = 0; k < 5; k++) {
      const u = (hash(Math.floor(p.x) + k * 13) + now * 0.06 * (k % 2 ? 1 : -1) + 1) % 1, y = wl + 5 + k * 6;
      const len = 6 + 6 * Math.sin(now * 2 + k), rx = p.x + 4 + u * Math.max(1, p.w - 22);
      ctx.fillRect(rx, y, len, 1);
    }
    ctx.fillStyle = 'rgba(255,240,180,.12)'; ctx.fillRect(p.x + p.w * 0.3, wl + 3, p.w * 0.3, 1.5); // отблеск прожектора
    if (p.v > 0.35) { // ведро на плаву покачивается
      const bx = p.x + p.w * (0.3 + 0.4 * ((p.v * 7) % 1)) + Math.sin(now * 0.5 + p.v * 9) * 5, by = wl + 2 + Math.sin(now * 2.2 + p.v * 5) * 1.5;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.sin(now * 1.6 + p.v * 3) * 0.18);
      ctx.fillStyle = p.v > 0.7 ? '#d8d8d0' : '#e2632b';
      ctx.beginPath(); ctx.moveTo(-8, -9); ctx.lineTo(8, -9); ctx.lineTo(6, 3); ctx.lineTo(-6, 3); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-8, -9, 16, 2);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, -9, 7, Math.PI, 0); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(170,220,230,.5)'; ctx.fillRect(bx - 11, wl + 3, 22, 1);
    }
    // ограждение приямка: стойки с красно-белой лентой
    const bx = p.x - 22;
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(bx, p.y - 20, 2, 20); ctx.fillRect(bx + 16, p.y - 20, 2, 20);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#e8e8e8' : '#d23a2a'; ctx.fillRect(bx - 1 + i * 4, p.y - 19, 4, 4); }
  }

  // стойки ярусов вышки: каждая доходит до ближайшего яруса под ней или до земли (считается один раз)
  function towerPosts(p, api) {
    if (p.posts) return p.posts;
    const n = Math.max(2, Math.round(p.w / 76)), out = [];
    for (let i = 0; i <= n; i++) {
      const x = p.x + 4 + i * (p.w - 8) / n;
      let b = api.groundAt(x) ?? p.base;
      for (const q of api.platforms) if (q.tower && q !== p && q.y > p.y + 20 && q.y < b && x >= q.x - 2 && x <= q.x + q.w + 2) b = q.y;
      out.push({ x, b });
    }
    return (p.posts = out);
  }

  function drawTower(p, ctx, api) { // ярус вышки: стальные колонны-двутавры, связи крестом, решётчатый настил
    const posts = towerPosts(p, api);
    ctx.strokeStyle = '#2d3a46'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < posts.length - 1; i++) { // связи крестом по «этажам» высотой ~60
      const a = posts[i], b = posts[i + 1], bot = Math.min(a.b, b.b) - 4, n = Math.max(1, Math.round((bot - p.y - 12) / 60)), hh = (bot - p.y - 12) / n;
      for (let k = 0; k < n; k++) {
        const y0 = p.y + 12 + k * hh, y1 = y0 + hh;
        ctx.moveTo(a.x, y0); ctx.lineTo(b.x, y1); ctx.moveTo(b.x, y0); ctx.lineTo(a.x, y1); ctx.moveTo(a.x, y1); ctx.lineTo(b.x, y1);
      }
    }
    ctx.stroke();
    for (const q of posts) {
      ctx.fillStyle = '#34495c'; ctx.fillRect(q.x - 3, p.y + 10, 6, q.b - p.y - 12);  // колонна
      ctx.fillStyle = '#6f8ca6'; ctx.fillRect(q.x - 3, p.y + 10, 1.5, q.b - p.y - 12);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(q.x - 3, q.b - 16, 6, 6);                  // винтовой домкрат
      ctx.fillStyle = '#2b3b4a'; ctx.fillRect(q.x - 7, q.b - 3, 14, 3);                  // опорная плита
    }
    // настил из решётки на балке
    ctx.fillStyle = '#4c5660'; ctx.fillRect(p.x - 6, p.y + 6, p.w + 12, 5);
    ctx.fillStyle = '#8d98a2'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 6);
    ctx.fillStyle = '#5d6872'; for (let x = p.x - 4; x < p.x + p.w + 4; x += 6) ctx.fillRect(x, p.y + 1, 2, 4);
    ctx.fillStyle = '#b7c1ca'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 1);
    for (const ex of [p.x - 6, p.x + p.w - 6]) for (let k = 0; k < 3; k++) { ctx.fillStyle = k % 2 ? '#1b1b1b' : '#f2c230'; ctx.fillRect(ex + k * 4, p.y + 6, 4, 5); }
    // перила с сигнальной лентой (как на остальных ярусах)
    const ly = p.y - 15;
    ctx.fillStyle = '#9aa3ab'; ctx.fillRect(p.x - 4, ly, 2, 15); ctx.fillRect(p.x + p.w + 2, ly, 2, 15);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#f0ece4';
    ctx.beginPath(); ctx.moveTo(p.x - 3, ly); ctx.quadraticCurveTo(p.x + p.w / 2, ly + 7 + Math.sin(api.now * 2 + p.v * 6) * 1.5, p.x + p.w + 3, ly); ctx.stroke();
    ctx.strokeStyle = '#d23a2a'; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
    if (p.tier === 3) { // на верху — прожектор, светит вниз, в котлован
      const lx = p.x + p.w - 14, fl = 0.85 + 0.15 * Math.sin(api.now * 9 + p.v * 20);
      ctx.fillStyle = `rgba(255,240,170,${0.1 * fl})`; ctx.beginPath(); ctx.moveTo(lx - 4, p.y - 22); ctx.lineTo(lx + 8, p.y - 22); ctx.lineTo(lx + 90, p.y + 160); ctx.lineTo(lx + 10, p.y + 160); ctx.fill();
      ctx.fillStyle = '#5d646b'; ctx.fillRect(lx - 1, p.y - 22, 2, 22);
      ctx.fillStyle = '#23272c'; ctx.fillRect(lx - 7, p.y - 30, 14, 9);
      ctx.fillStyle = '#fff6cc'; ctx.fillRect(lx - 5, p.y - 22, 10, 2);
    }
  }

  function drawPlatform(p, ctx, api) { // ярус 1 — дощатый настил на стойках; ярус 2 — стальная балка-распорка
    if (p.tower) return drawTower(p, ctx, api);
    const posts = Math.max(2, Math.round(p.w / 80));
    for (let i = 0; i <= posts; i++) { // телескопические стойки с винтовым домкратом
      const x = p.x + 4 + i * (p.w - 8) / posts;
      ctx.fillStyle = '#3f5a73'; ctx.fillRect(x - 2, p.y + 10, 4, p.base - p.y - 12);
      ctx.fillStyle = '#6f8ca6'; ctx.fillRect(x - 2, p.y + 10, 1, p.base - p.y - 12);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(x - 3, p.base - 16, 6, 6);
      ctx.fillStyle = '#2b3b4a'; ctx.fillRect(x - 6, p.base - 3, 12, 3);
    }
    if (p.tier === 2) {
      ctx.fillStyle = '#7c3322'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 3);          // полка двутавра
      ctx.fillStyle = '#5e2618'; ctx.fillRect(p.x - 4, p.y + 3, p.w + 8, 9);        // стенка
      ctx.fillStyle = '#7c3322'; ctx.fillRect(p.x - 6, p.y + 11, p.w + 12, 3);
      ctx.fillStyle = '#9b4a33'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 1);
      ctx.fillStyle = '#4a1c12'; for (let x = p.x + 10; x < p.x + p.w - 6; x += 26) ctx.fillRect(x, p.y + 3, 2, 8); // рёбра
      for (const ex of [p.x - 6, p.x + p.w - 6]) for (let k = 0; k < 3; k++) { // сигнальная окраска торцов
        ctx.fillStyle = k % 2 ? '#1b1b1b' : '#f2c230'; ctx.fillRect(ex + k * 4, p.y + 3, 4, 8);
      }
    } else {
      ctx.fillStyle = '#4c5660'; ctx.fillRect(p.x - 6, p.y + 7, p.w + 12, 4);        // швеллер под настилом
      ctx.fillStyle = '#b98a52'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 7);            // доски
      ctx.fillStyle = '#d7aa6c'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 1);
      ctx.fillStyle = '#7d5a31'; for (let x = p.x; x < p.x + p.w; x += 20) ctx.fillRect(x, p.y, 1, 7);
    }
    // сигнальная лента на стойках-ограждениях
    const t = api.now, ly = p.y - 15;
    ctx.fillStyle = '#9aa3ab'; ctx.fillRect(p.x - 4, ly, 2, 15); ctx.fillRect(p.x + p.w + 2, ly, 2, 15);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#f0ece4';
    ctx.beginPath(); ctx.moveTo(p.x - 3, ly); ctx.quadraticCurveTo(p.x + p.w / 2, ly + 7 + Math.sin(t * 2 + p.v * 6) * 1.5, p.x + p.w + 3, ly); ctx.stroke();
    ctx.strokeStyle = '#d23a2a'; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
  }

  function drawObstacle(s, ctx, api) { // фундаментные блоки ФБС: серый бетон, монтажные петли, маркировка
    const { hash } = api, bh = s.h / (s.stack || 1);
    for (let k = 0; k < (s.stack || 1); k++) {
      const y = s.y + k * bh;
      ctx.fillStyle = '#9da2a6'; ctx.fillRect(s.x, y, s.w, bh);
      ctx.fillStyle = '#c3c7ca'; ctx.fillRect(s.x, y, s.w, 3);                 // верхняя фаска
      ctx.fillStyle = '#7b8185'; ctx.fillRect(s.x, y + bh - 3, s.w, 3); ctx.fillRect(s.x + s.w - 3, y, 3, bh);
      ctx.fillStyle = '#b3b7ba'; ctx.fillRect(s.x, y, 2, bh);
      ctx.fillStyle = '#80868a';                                                  // раковины в бетоне
      for (let i = 0; i < 5; i++) ctx.fillRect(s.x + 5 + hash(Math.floor(s.x) + k * 31 + i) * (s.w - 10), y + 5 + hash(Math.floor(s.x) * 3 + k + i * 7) * (bh - 11), 2, 1.5);
      api.text('ФБС 24.4.6', s.x + 5, y + bh / 2 + 3, 6, 'rgba(150,40,30,.85)', 'left');
      if (k === s.stack - 1) { ctx.fillStyle = 'rgba(60,30,12,.35)'; ctx.fillRect(s.x, y + bh - 7, s.w, 4); } // мокрый низ
    }
    ctx.strokeStyle = '#5b4a3f'; ctx.lineWidth = 2;                               // монтажные петли
    for (const f of [0.22, 0.78]) { ctx.beginPath(); ctx.arc(s.x + s.w * f, s.y, 3.5, Math.PI, 0); ctx.stroke(); }
  }

  function drawDecor(d, ctx, api) {
    const { now } = api, x = d.x, y = d.y;
    if (d.kind === 'pump') { // дренажный насос на салазках: дрожит, по шлангу бежит вода
      ctx.strokeStyle = '#1d1f22'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x + 9, y - 18); ctx.bezierCurveTo(x + 22, y - 44, x + 46, y - 6, x + 64, y - 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(150,215,230,.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 7]); ctx.lineDashOffset = -now * 40; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#9fd0dc'; for (let k = 0; k < 3; k++) { const ph = (now * 2.5 + k / 3) % 1; ctx.fillRect(x + 66 + ph * 8, y - 3 + ph * ph * 3 - ph * 5, 1.5, 1.5); }
      ctx.translate(Math.sin(now * 55 + d.v * 9) * 0.5, 0);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(x - 17, y - 4, 34, 4);
      ctx.fillStyle = '#2f6aa3'; ctx.fillRect(x - 15, y - 19, 18, 15);
      ctx.fillStyle = '#23527f'; for (let i = 0; i < 4; i++) ctx.fillRect(x - 14 + i * 4.5, y - 19, 2, 15);
      ctx.fillStyle = '#b3342a'; ctx.beginPath(); ctx.arc(x + 8, y - 11, 8, 0, 7); ctx.fill();
      ctx.fillStyle = '#7d2019'; ctx.beginPath(); ctx.arc(x + 8, y - 11, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#333'; ctx.fillRect(x + 6, y - 22, 5, 4);
      ctx.fillStyle = Math.sin(now * 6) > 0 ? '#6cff8a' : '#1d6b35'; ctx.fillRect(x - 12, y - 17, 3, 3); // индикатор работы
    } else if (d.kind === 'hose') { // бухта напорного шланга
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = '#1f2124'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.ellipse(x, y - 3 - i * 3.2, 17 - i * 0.8, 5, 0, 0, 7); ctx.stroke();
        ctx.strokeStyle = '#2f6aa3'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, y - 3 - i * 3.2, 17 - i * 0.8, 5, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      }
      ctx.strokeStyle = '#1f2124'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(x + 15, y - 12); ctx.quadraticCurveTo(x + 30, y - 4, x + 40, y - 2); ctx.stroke();
      ctx.fillStyle = '#b0b5ba'; ctx.fillRect(x + 38, y - 5, 5, 5); // соединительная головка
    } else if (d.kind === 'flood') { // прожектор на треноге
      const s = d.v > 0.5 ? 1 : -1, fl = 0.85 + 0.15 * Math.sin(now * 11 + d.v * 30);
      ctx.fillStyle = `rgba(255,240,170,${0.13 * fl})`;
      ctx.beginPath(); ctx.moveTo(x + s * 6, y - 60); ctx.lineTo(x + s * 10, y - 50); ctx.lineTo(x + s * 95, y); ctx.lineTo(x + s * 18, y); ctx.fill();
      ctx.strokeStyle = '#5d646b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y - 52); ctx.lineTo(x - 13, y); ctx.moveTo(x, y - 52); ctx.lineTo(x + 13, y); ctx.moveTo(x, y - 56); ctx.lineTo(x, y); ctx.stroke();
      ctx.save(); ctx.translate(x, y - 58); ctx.scale(s, 1); ctx.rotate(0.55);
      ctx.fillStyle = '#23272c'; ctx.fillRect(-9, -7, 16, 14);
      ctx.fillStyle = '#fff6cc'; ctx.fillRect(6, -6, 3, 12);
      ctx.fillStyle = `rgba(255,240,180,${0.3 * fl})`; ctx.beginPath(); ctx.arc(8, 0, 10, 0, 7); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#d8661c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - 30); ctx.quadraticCurveTo(x - 14, y - 4, x - 30, y - 1); ctx.stroke(); // кабель
    } else if (d.kind === 'rebar') { // пачка арматуры на подкладках
      ctx.fillStyle = '#6e4e32'; ctx.fillRect(x - 28, y - 5, 8, 5); ctx.fillRect(x + 20, y - 5, 8, 5);
      for (let k = 0; k < 6; k++) { ctx.fillStyle = k % 2 ? '#8c5334' : '#a4623c'; ctx.fillRect(x - 42 + (k % 3), y - 7 - k * 1.8, 84, 1.8); }
      ctx.fillStyle = '#c0c4c8'; ctx.fillRect(x - 10, y - 18, 2, 12); ctx.fillRect(x + 12, y - 18, 2, 12);
      ctx.fillStyle = '#5a321e'; for (let k = 0; k < 6; k++) ctx.fillRect(x + 41 + (k % 3), y - 7 - k * 1.8, 2, 1.8);
    } else if (d.kind === 'cage') { // выпуски арматуры из подколонника с оранжевыми колпачками
      ctx.fillStyle = '#8d9296'; ctx.fillRect(x - 15, y - 10, 30, 10); ctx.fillStyle = '#a9aeb2'; ctx.fillRect(x - 15, y - 10, 30, 2);
      ctx.strokeStyle = '#80492e'; ctx.lineWidth = 2; ctx.beginPath();
      for (let b = 0; b < 4; b++) { ctx.moveTo(x - 9 + b * 6, y - 10); ctx.lineTo(x - 9 + b * 6, y - 46); }
      ctx.stroke();
      ctx.strokeStyle = '#6a3a22'; ctx.lineWidth = 1; ctx.beginPath();
      for (let yy = y - 16; yy > y - 44; yy -= 8) { ctx.moveTo(x - 11, yy); ctx.lineTo(x + 11, yy); }
      ctx.stroke();
      ctx.fillStyle = '#ff7a1a'; for (let b = 0; b < 4; b++) { ctx.beginPath(); ctx.arc(x - 9 + b * 6, y - 47, 2.6, Math.PI, 0); ctx.fill(); }
    } else if (d.kind === 'sign') { // табличка «Осторожно! Котлован»
      ctx.fillStyle = '#676b70'; ctx.fillRect(x - 1, y - 36, 2, 36);
      ctx.fillStyle = '#b3261e'; ctx.fillRect(x - 30, y - 60, 60, 26);
      ctx.fillStyle = '#f5d63d'; ctx.fillRect(x - 28, y - 58, 56, 22);
      api.text('ОСТОРОЖНО!', x, y - 49, 7, '#b3261e');
      api.text('КОТЛОВАН', x, y - 40, 7, '#111');
    }
  }

  function drawFinish(fx, gy, ctx, api) { // лестничная башня-трап: выход из котлована наверх
    const { now, hash } = api, x = fx + 130, w = 84, top = 80, hgt = gy - top, wx = x + w + 26;
    // торцевая стена котлована из шпунта (в масштабе мира) и бровка наверху
    for (let i = 0; i < 16; i++) {
      const sx = wx + i * 32;
      ctx.fillStyle = '#6a3a22'; ctx.fillRect(sx, top, 32.5, hgt);
      ctx.fillStyle = '#8c4e2e'; ctx.fillRect(sx + 5, top, 15, hgt);
      ctx.fillStyle = '#b06a40'; ctx.fillRect(sx + 5, top, 2, hgt);
      ctx.fillStyle = '#4a2814'; ctx.fillRect(sx + 20, top, 3, hgt);
      if (hash(i + 77) > 0.5) { ctx.fillStyle = 'rgba(40,16,5,.35)'; ctx.fillRect(sx + 9, top + 30 + hash(i) * 60, 3, 70); }
    }
    ctx.fillStyle = '#343940'; ctx.fillRect(wx, top + 50, 520, 14); ctx.fillStyle = '#5d6670'; ctx.fillRect(wx, top + 50, 520, 2);
    ctx.fillStyle = '#6b5240'; ctx.fillRect(wx - 30, top - 8, 560, 8); ctx.fillStyle = '#8a6c52'; ctx.fillRect(wx - 30, top - 8, 560, 2);
    // лестничные марши зигзагом
    const n = Math.max(3, Math.round(hgt / 46)), fh = hgt / n;
    ctx.fillStyle = 'rgba(30,70,50,.3)'; ctx.fillRect(x, top, w, hgt); // сетка ограждения
    for (let k = 0; k < n; k++) {
      const y0 = gy - k * fh, y1 = y0 - fh, ax = k % 2 ? x + w - 6 : x + 6, bx = k % 2 ? x + 6 : x + w - 6;
      ctx.strokeStyle = '#7d8893'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ax, y0); ctx.lineTo(bx, y1); ctx.stroke();
      ctx.fillStyle = '#d0d5da'; for (let s = 1; s < 9; s++) { const f = s / 9; ctx.fillRect(ax + (bx - ax) * f - 4, y0 + (y1 - y0) * f - 1.5, 8, 2); }
      ctx.strokeStyle = '#f2c230'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax, y0 - 20); ctx.lineTo(bx, y1 - 20); ctx.stroke();
      ctx.fillStyle = '#3e6f9f'; ctx.fillRect(x - 3, y1 - 2, w + 6, 4);
    }
    ctx.fillStyle = '#2f5d8a'; for (const cx of [x, x + w]) ctx.fillRect(cx - 3, top - 22, 6, hgt + 22);
    ctx.fillStyle = '#3e6f9f'; ctx.fillRect(x - 3, top - 2, wx - x + 40, 4); // мостик на бровку
    ctx.fillStyle = '#f2c230'; ctx.fillRect(x - 3, top - 20, wx - x + 40, 2);
    // мигающий зелёный фонарь и табличка «Выход наверх»
    const on = Math.sin(now * 5) > 0;
    ctx.fillStyle = on ? '#6cff8a' : '#1d6b35'; ctx.beginPath(); ctx.arc(x + w / 2, top - 12, 4, 0, 7); ctx.fill();
    if (on) { ctx.fillStyle = 'rgba(108,255,138,.25)'; ctx.beginPath(); ctx.arc(x + w / 2, top - 12, 11, 0, 7); ctx.fill(); }
    const sx = x - 40, sy = gy - 124;
    ctx.fillStyle = '#676b70'; ctx.fillRect(sx + 44, sy + 30, 3, gy - sy - 30);
    ctx.fillStyle = '#f0f0ea'; ctx.fillRect(sx - 2, sy - 2, 96, 34);
    ctx.fillStyle = '#1f8a4c'; ctx.fillRect(sx, sy, 92, 30);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(sx + 13, sy + 5); ctx.lineTo(sx + 21, sy + 14); ctx.lineTo(sx + 5, sy + 14); ctx.fill(); ctx.fillRect(sx + 10, sy + 14, 6, 11);
    api.text('ВЫХОД', sx + 56, sy + 13, 10, '#fff');
    api.text('НАВЕРХ', sx + 56, sy + 25, 10, '#fff');
  }

  // ---------- враги ----------
  // враг виден в кадре (с учётом подъёма камеры) — атакуют только видимые, из-за края кадра не бьют
  const onScreen = (e, api) => e.y + e.h > api.camY + 12 && e.y < api.camY + api.H - 10 && e.x + e.w > api.camX && e.x < api.camX + api.W;
  function drawWave(p, ctx) { // ударная волна трамбовки: вал брызг глины по настилу
    const f = 0.6 + 0.4 * Math.sin(p.ph * 20);
    ctx.fillStyle = 'rgba(154,90,46,.9)'; ctx.beginPath(); ctx.ellipse(0, 3, 9, 6 * f, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#d08b52'; for (let k = 0; k < 3; k++) ctx.fillRect(-6 + k * 5, -4 - ((p.ph * 6 + k * 0.3) % 1) * 6, 2.5, 2.5);
  }
  function drawBlob(p, ctx) { // ком бетона из бадьи
    ctx.fillStyle = '#8d9398'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#b4babe'; ctx.beginPath(); ctx.arc(-3, -3, 3, 0, 7); ctx.fill();
    ctx.fillStyle = '#6b7075'; ctx.fillRect(2, 2, 3, 2);
  }
  const moleUp = e => e.st === 'up' || (e.st === 'down' && e.sT < 0.12); // крот снаружи: его можно бить, он ранит

  function drawSlag(p, ctx) { // капля раскалённого шлака с огненным хвостом
    ctx.strokeStyle = 'rgba(255,120,30,.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-p.vx * 0.035, -p.vy * 0.035); ctx.stroke();
    ctx.fillStyle = 'rgba(255,110,30,.35)'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff8a2a'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(-1, -1, 2, 0, 7); ctx.fill();
  }

  const enemies = {
    mole: { // крот-землерой: бугорком ползёт под землёй, выныривает рядом с героем
      w: 30, h: 24, hp: 1, pts: 120, hitColor: '#c98a55', deathColor: '#6e5a50',
      init(e) { e.st = 'dig'; e.sT = 0; e.cd = 0.3; },
      update(e, dt, api) {
        const dx = api.dx(e);
        e.sT += dt;
        if (e.st === 'dig') { // под землёй: ползёт к герою, неуязвим и безвреден
          e.cd -= dt;
          if (Math.abs(dx) > 26) e.dir = Math.sign(dx);
          api.patrol(e, Math.abs(dx) < 300 ? 70 : 30, dt);
          if (e.cd <= 0 && Math.abs(dx) < 120) { e.st = 'warn'; e.sT = 0; }
        } else if (e.st === 'warn') { // земля дрожит и фонтанирует — сейчас вынырнет
          if (e.sT >= 0.8) { e.st = 'up'; e.sT = 0; e.dir = Math.sign(dx) || e.dir; api.burst(e.x + e.w / 2, e.y + e.h - 4, '#9a5a2e', 10, 150, 700); }
        } else if (e.st === 'up') {
          if (Math.abs(dx) > 6) e.dir = Math.sign(dx);
          if (e.sT >= 1.3) { e.st = 'down'; e.sT = 0; }
        } else if (e.sT >= 0.25) { e.st = 'dig'; e.sT = 0; e.cd = api.rand(1.2, 1.8); }
      },
      bodybox(e) { return moleUp(e) ? e : { x: e.x + e.w / 2, y: -900, w: 0, h: 0 }; }, // под землёй тела «нет»
      onHit(e, api) {
        if (moleUp(e)) return true;
        api.burst(e.x + e.w / 2, e.y + e.h - 2, '#9a5a2e', 4, 90, 700); // рейка лишь ковырнула глину
        return false;
      },
      draw(e, ctx) {
        const t = e.t;
        if (e.st === 'dig' || e.st === 'warn') {
          const w = e.st === 'warn' ? Math.min(1, e.sT / 0.8) : 0, sx = w ? Math.sin(t * 70) * 1.8 * w : 0;
          ctx.fillStyle = '#5e3219'; ctx.beginPath(); ctx.ellipse(sx, 0, 18 + w * 4, 8 + w * 6 + Math.sin(t * 9), 0, Math.PI, 0); ctx.fill();
          ctx.fillStyle = '#8e5029'; ctx.beginPath(); ctx.ellipse(sx - 2, -1, 12 + w * 2, 5 + w * 4, 0, Math.PI, 0); ctx.fill();
          ctx.fillStyle = '#6e3a1c'; for (let k = 0; k < 4; k++) ctx.fillRect(sx - 14 + k * 8, -4 - ((t * 3 + k * 0.4) % 1) * 4, 3, 3); // комья
          ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.arc(sx + 3, -6 - w * 5, 5.5, Math.PI, 0); ctx.fill(); // макушка каски
          ctx.fillStyle = Math.sin(t * 8) > 0 ? '#fffbd0' : '#b09a50'; ctx.fillRect(sx + 7, -9 - w * 5, 2, 2);
          ctx.fillStyle = '#ff7f95'; ctx.beginPath(); ctx.arc(sx + 15 + Math.sin(t * 14) * 0.8, -3 - w * 2, 2.6, 0, 7); ctx.fill(); // нос принюхивается
          if (w) { // фонтан глины и трещины по земле — телеграф атаки
            ctx.strokeStyle = '#4a240f'; ctx.lineWidth = 1.5; ctx.beginPath();
            for (const s of [-1, 1]) { const L = 18 + w * 16; ctx.moveTo(s * 16, 1); ctx.lineTo(s * (16 + L * 0.4), 3); ctx.lineTo(s * (16 + L * 0.7), 1.5); ctx.lineTo(s * (16 + L), 4); }
            ctx.stroke();
            for (let k = 0; k < 11; k++) {
              const ph = (e.sT * 2.4 + k / 11) % 1, spread = (k - 5) * 5;
              ctx.fillStyle = k % 3 ? '#8e5029' : '#d08b52';
              ctx.fillRect(sx + spread * ph * 1.4, -10 - Math.sin(ph * Math.PI) * (26 + w * 22), 3.5, 3.5);
            }
            if (w > 0.6) { // из земли уже показались когти
              ctx.fillStyle = '#f0dcc0'; for (let k = 0; k < 3; k++) ctx.fillRect(sx - 6 + k * 5, -14 - (w - 0.6) * 20, 3, 6);
            }
          }
          return;
        }
        const r = e.st === 'up' ? Math.min(1, e.sT / 0.15) : Math.max(0, 1 - e.sT / 0.25);
        ctx.save(); ctx.beginPath(); ctx.rect(-40, -70, 80, 70); ctx.clip(); ctx.translate(0, (1 - r) * 30);
        const claw = Math.sin(t * 7) * 0.5, sniff = Math.sin(t * 14) * 0.8;
        ctx.fillStyle = '#4d4046'; ctx.beginPath(); ctx.ellipse(0, -12, 13, 14, 0, 0, 7); ctx.fill();          // тело
        ctx.fillStyle = '#7d6a60'; ctx.beginPath(); ctx.ellipse(4, -8, 7, 8, 0, 0, 7); ctx.fill();            // брюшко
        ctx.fillStyle = '#e59aa3'; ctx.beginPath(); ctx.ellipse(13 + sniff, -13, 6, 4, 0, 0, 7); ctx.fill();  // рыльце
        ctx.fillStyle = '#ff5f7a'; ctx.beginPath(); ctx.arc(18 + sniff, -13, 2.2, 0, 7); ctx.fill();
        ctx.fillStyle = '#1b1b1b'; ctx.fillRect(4, -19, 8, 4);                                                 // очки
        ctx.fillStyle = '#9fd3ff'; ctx.fillRect(5, -18, 3, 2); ctx.fillRect(9, -18, 2, 2);
        ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.arc(0, -23, 10, Math.PI, 0); ctx.fill(); ctx.fillRect(-11, -24, 24, 3); // каска
        ctx.fillStyle = '#fffbd0'; ctx.fillRect(8, -30, 3, 4);
        ctx.fillStyle = 'rgba(255,250,200,.25)'; ctx.beginPath(); ctx.moveTo(11, -30); ctx.lineTo(34, -36); ctx.lineTo(34, -20); ctx.lineTo(11, -26); ctx.fill();
        for (const [cx, cy, a] of [[11, -5, claw], [-9, -5, -claw]]) { // лапы-лопаты
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(a - 0.3);
          ctx.fillStyle = '#f0dcc0'; ctx.beginPath(); ctx.ellipse(4, 0, 6, 4, 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#c9b090'; for (let k = 0; k < 3; k++) ctx.fillRect(8, -3 + k * 2.5, 4, 1.5);
          ctx.restore();
        }
        ctx.restore();
        ctx.fillStyle = '#5e3219'; ctx.beginPath(); ctx.ellipse(0, 0, 20, 5, 0, Math.PI, 0); ctx.fill(); // вал выброшенной глины
        ctx.fillStyle = '#8e5029'; ctx.beginPath(); ctx.ellipse(-8, 0, 7, 3, 0, Math.PI, 0); ctx.fill(); ctx.beginPath(); ctx.ellipse(10, 0, 6, 3, 0, Math.PI, 0); ctx.fill();
      },
    },
    loader: { // мини-погрузчик: газует и таранит до края своего отрезка
      w: 50, h: 36, hp: 3, pts: 300, heavy: true, hitColor: '#ffd76a', deathColor: '#f2b41b',
      init(e) { e.st = 'patrol'; e.sT = 0; e.wheel = 0; },
      update(e, dt, api) {
        const dx = api.dx(e), P = api.player, ox = e.x;
        e.sT += dt;
        if (e.st === 'patrol') {
          e.cd -= dt;
          api.patrol(e, 45, dt);
          if (e.cd <= 0 && Math.abs(dx) < 230 && Math.abs(P.y + P.h - e.groundY) < 60) { e.st = 'rev'; e.sT = 0; e.dir = Math.sign(dx) || e.dir; }
        } else if (e.st === 'rev') { // газует на месте: трясётся, дымит, мигает фарами
          e.wheel += e.dir * dt * 40;
          if (e.sT >= 0.8) { e.st = 'charge'; e.sT = 0; api.shake(2); }
        } else if (e.st === 'charge') { // таран до края отрезка
          e.x += e.dir * 260 * dt;
          if (e.x <= e.minX || e.x + e.w >= e.maxX) {
            e.x = api.clamp(e.x, e.minX, e.maxX - e.w); e.st = 'stop'; e.sT = 0; api.shake(3);
            api.burst(e.x + e.w / 2 + e.dir * 28, e.y + e.h - 6, '#b8703d', 8, 140, 700);
          }
        } else if (e.sT >= 0.9) { e.dir = -e.dir; e.st = 'patrol'; e.cd = api.rand(1.2, 1.8); }
        e.wheel += e.x - ox;
      },
      draw(e, ctx) {
        const t = e.t, rev = e.st === 'rev', chg = e.st === 'charge', stop = e.st === 'stop';
        if (chg) { // полосы скорости и глина из-под колёс
          ctx.fillStyle = 'rgba(255,255,255,.35)'; for (let k = 0; k < 3; k++) ctx.fillRect(-48 - ((t * 400 + k * 13) % 30), -30 + k * 9, 16, 2);
          ctx.fillStyle = '#8e5029'; for (let k = 0; k < 4; k++) { const ph = (t * 5 + k / 4) % 1; ctx.fillRect(-22 - ph * 22, -4 - Math.sin(ph * 3) * 10, 3, 3); }
        }
        if (rev) { ctx.fillStyle = '#8e5029'; for (let k = 0; k < 5; k++) { const ph = (t * 6 + k / 5) % 1; ctx.fillRect(-18 - ph * 24, -3 - Math.sin(ph * 3) * 14, 3, 3); } }
        ctx.save();
        if (rev) ctx.translate(Math.sin(t * 63) * 1.2, Math.sin(t * 80) * 1.2);
        if (stop && e.sT < 0.25) { ctx.translate(18, 0); ctx.rotate(Math.sin(e.sT / 0.25 * Math.PI) * 0.08); ctx.translate(-18, 0); }
        // выхлоп: при газовке — густые клубы, вспышки из трубы и «дрожь» корпуса
        const k0 = rev ? 5 : 1.2, al = rev ? 0.8 : 0.3;
        for (let k = 0; k < 3; k++) {
          const ph = (t * k0 + k / 3) % 1;
          ctx.fillStyle = rev ? `rgba(185,185,178,${(1 - ph) * al})` : `rgba(95,95,95,${(1 - ph) * al})`;
          ctx.beginPath(); ctx.arc(-19 - ph * (chg ? 20 : 10), -44 - ph * 18, 2.5 + ph * (rev ? 9 : 5), 0, 7); ctx.fill();
        }
        if (rev) {
          if (Math.sin(t * 37) > 0) { ctx.fillStyle = '#ffb040'; ctx.beginPath(); ctx.moveTo(-22, -42); ctx.lineTo(-19, -51 - Math.sin(t * 90) * 3); ctx.lineTo(-16, -42); ctx.fill(); }
          ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5; ctx.beginPath();
          for (let k = 0; k < 2; k++) { ctx.moveTo(-32 - k * 6, -30); ctx.quadraticCurveTo(-36 - k * 6, -20, -32 - k * 6, -10); }
          ctx.stroke();
        }
        if (e.hp < e.maxHp) { ctx.fillStyle = 'rgba(200,200,200,.45)'; const ph = (t * 1.5) % 1; ctx.beginPath(); ctx.arc(-14 + ph * 4, -32 - ph * 18, 3 + ph * 6, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#333'; ctx.fillRect(-21, -42, 4, 12);                                     // выхлопная труба
        ctx.fillStyle = '#f2b41b'; ctx.fillRect(-25, -22, 44, 12);                                 // корпус
        ctx.fillStyle = '#d99a0e'; ctx.fillRect(-26, -32, 16, 11);                                 // капот двигателя
        ctx.fillStyle = '#7a5a10'; for (let k = 0; k < 3; k++) ctx.fillRect(-24 + k * 5, -30, 2, 7); // решётка
        ctx.fillStyle = '#1e1f22'; ctx.fillRect(-11, -46, 3, 25); ctx.fillRect(8, -46, 3, 25); ctx.fillRect(-12, -47, 24, 4); // каркас кабины
        ctx.fillStyle = 'rgba(110,170,205,.75)'; ctx.fillRect(-8, -43, 16, 20);
        ctx.fillStyle = '#e8e8e8'; ctx.beginPath(); ctx.arc(-1, -32, 4.5, Math.PI, 0); ctx.fill();  // каска оператора
        ctx.fillStyle = (Math.floor(t * (rev || chg ? 10 : 4)) % 2) ? '#ffb020' : '#8a4a10';       // проблесковый маячок
        ctx.fillRect(-4, -51, 7, 4);
        const lift = rev ? -6 : chg ? 3 : 0;                                                         // стрела и ковш
        ctx.strokeStyle = '#d99a0e'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-6, -36); ctx.lineTo(20, -18 + lift); ctx.stroke();
        ctx.fillStyle = '#6d7378'; ctx.beginPath(); ctx.moveTo(18, -25 + lift); ctx.lineTo(29, -24 + lift); ctx.lineTo(31, -3 + lift * 0.3); ctx.lineTo(17, -4 + lift * 0.3); ctx.fill();
        ctx.fillStyle = '#9aa0a5'; for (let k = 0; k < 3; k++) ctx.fillRect(31, -9 + k * 3 + lift * 0.3, 3, 2); // зубья
        if (rev) { // фары-вспышки: телеграф тарана
          const fl = Math.sin(t * 30) > 0;
          ctx.fillStyle = fl ? '#fffbd0' : '#c9b060'; ctx.fillRect(9, -30, 4, 4);
          if (fl) { ctx.fillStyle = 'rgba(255,250,210,.3)'; ctx.beginPath(); ctx.moveTo(13, -30); ctx.lineTo(60, -40); ctx.lineTo(60, -12); ctx.lineTo(13, -26); ctx.fill(); }
        } else { ctx.fillStyle = '#e8d890'; ctx.fillRect(9, -30, 4, 4); }
        for (const wx of [-15, 9]) { // колёса с вращающимися дисками
          ctx.fillStyle = '#18191b'; ctx.beginPath(); ctx.arc(wx, -8, 8, 0, 7); ctx.fill();
          ctx.fillStyle = '#8f949a'; ctx.beginPath(); ctx.arc(wx, -8, 3.5, 0, 7); ctx.fill();
          ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5; ctx.beginPath();
          for (let k = 0; k < 3; k++) { const a = e.wheel / 8 + k * 2.09; ctx.moveTo(wx, -8); ctx.lineTo(wx + Math.cos(a) * 7, -8 + Math.sin(a) * 7); }
          ctx.stroke();
        }
        for (let i = 0; i < e.maxHp - e.hp; i++) { ctx.strokeStyle = '#3a2a10'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-20 + i * 12, -21); ctx.lineTo(-15 + i * 12, -13); ctx.stroke(); } // вмятины
        ctx.restore();
      },
    },
    welder: { // сварщик на балке: вспышка дуги, затем веер раскалённого шлака
      w: 20, h: 40, hp: 2, pts: 200, hitColor: '#ffb040', deathColor: '#ff9a30',
      init(e, api) { e.st = 'idle'; e.sT = 0; e.cd = api.rand(0.8, 1.5); e.throwT = 0; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e);
        e.sT += dt; e.throwT = Math.max(0, e.throwT - dt);
        if (e.st === 'idle') {
          if (Math.abs(dx) > 8) e.dir = Math.sign(dx);
          e.cd -= dt;
          if (e.cd <= 0 && Math.abs(dx) < 380 && onScreen(e, api)) { e.st = 'arc'; e.sT = 0; }
        } else if (e.sT >= 0.8) { // после вспышки — веер из трёх капель шлака
          e.st = 'idle'; e.cd = api.rand(1.5, 1.9); e.throwT = 0.3;
          const ox = e.x + e.w / 2 + e.dir * 14, oy = e.y + 12, tx = P.x + P.w / 2, ty = P.y + P.h - 8;
          const dy = ty - oy, vyMin = 30 - Math.sqrt(1800 * Math.max(0, oy - 46 - api.camY)); // вершина дуги (и у боковых капель) не выше 46 от верха кадра — шлак не прячется под HUD
          let tf = api.clamp(Math.abs(tx - ox) / 230, 0.55, 1.2), vy = (dy - 450 * tf * tf) / tf;
          if (vy < vyMin) { vy = vyMin; tf = (-vy + Math.sqrt(Math.max(0, vy * vy + 1800 * dy))) / 900; } // дальний бросок — площе и быстрее
          const vx = (tx - ox) / tf;
          for (let i = -1; i <= 1; i++) api.shoot({ x: ox, y: oy, w: 8, h: 8, vx: vx + i * 75, vy: vy - Math.abs(i) * 30, color: '#ff9a30', draw: drawSlag, source: e, pts: 15 });
          api.burst(ox, oy, '#fff3b0', 6, 120, 300);
        }
      },
      draw(e, ctx) {
        const t = e.t, arc = e.st === 'arc', ph = arc ? Math.min(1, e.sT / 0.8) : 0, bob = Math.sin(t * 2.5) * 0.6;
        // кабель держака
        ctx.strokeStyle = '#141414'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-6, -22); ctx.quadraticCurveTo(-16, -8, -24, 0); ctx.stroke();
        ctx.fillStyle = '#34485c'; ctx.fillRect(-6, -17, 5, 17); ctx.fillRect(1, -17, 5, 17);    // брюки (светлее распорки за спиной)
        ctx.fillStyle = '#111'; ctx.fillRect(-7, -3, 7, 3); ctx.fillRect(1, -3, 7, 3);            // сапоги
        ctx.fillStyle = '#3f6f94'; ctx.fillRect(-8, -36 + bob, 16, 20);                           // синяя роба
        ctx.fillStyle = '#e9f2f2'; ctx.fillRect(-8, -24 + bob, 4, 2);                             // светоотражающая полоса
        ctx.fillStyle = '#6b4a2e'; ctx.fillRect(-3, -31 + bob, 10, 17);                           // кожаный фартук
        ctx.fillStyle = '#8d949c'; ctx.fillRect(-7, -50 + bob, 16, 15);                           // светлый кант маски — читается на тёмном фоне
        ctx.fillStyle = '#3a4049'; ctx.fillRect(-6, -49 + bob, 14, 13);                           // сварочная маска
        ctx.fillStyle = '#e0a526'; ctx.fillRect(-7, -51 + bob, 12, 4);                            // оголовье маски
        ctx.fillStyle = arc ? '#d8ffe4' : '#2e7d4f'; ctx.fillRect(2, -45 + bob, 6, 4);            // светофильтр
        // рука с держаком: в покое варит у ног, на вспышке поднята, при броске — вперёд
        const ang = e.throwT > 0 ? -0.2 : arc ? -0.9 : 0.75 + Math.sin(t * 3) * 0.08;
        ctx.save(); ctx.translate(5, -32 + bob); ctx.rotate(ang);
        ctx.fillStyle = '#3f6f94'; ctx.fillRect(0, -2.5, 11, 5);
        ctx.fillStyle = '#a0522d'; ctx.fillRect(10, -3, 4, 6);                                    // краги
        ctx.fillStyle = '#222'; ctx.fillRect(13, -1.5, 6, 3); ctx.fillStyle = '#bbb'; ctx.fillRect(19, -0.5, 5, 1);
        if (arc) { // вспышка дуги — телеграф: ярко, растёт, лучи
          const r = 3 + ph * 4 + Math.sin(t * 60) * 1.2;
          ctx.fillStyle = `rgba(160,220,255,${0.25 + ph * 0.25})`; ctx.beginPath(); ctx.arc(24, 0, 10 + ph * 16, 0, 7); ctx.fill();
          ctx.strokeStyle = '#e8f6ff'; ctx.lineWidth = 1.5; ctx.beginPath();
          for (let k = 0; k < 6; k++) { const a = k * 1.05 + t * 8; ctx.moveTo(24 + Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(24 + Math.cos(a) * (r + 6 + ph * 10), Math.sin(a) * (r + 6 + ph * 10)); }
          ctx.stroke();
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(24, 0, r, 0, 7); ctx.fill();
        } else if (e.throwT <= 0 && Math.sin(t * 5) > 0.2) { // мелкие искры обычной работы
          ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(24, 0, 2, 0, 7); ctx.fill();
          ctx.fillStyle = '#ffb040'; for (let k = 0; k < 5; k++) { const a = (t * 4 + k * 0.23) % 1; ctx.fillRect(24 + (k - 2) * a * 7, a * a * 14 - a * 6, 1.5, 1.5); }
        }
        ctx.restore();
      },
    },
    rammer: { // вибротрамбовка «лягушка» на ярусе: дрожит и приседает (0,85 с), прыгает к герою, при ударе о настил — волна в обе стороны
      w: 22, h: 30, hp: 2, pts: 220, heavy: true, hitColor: '#ffd76a', deathColor: '#f2b41b',
      init(e) { e.st = 'idle'; e.sT = 0; e.tx = e.x; e.x0 = e.x; e.hop = 0; },
      update(e, dt, api) {
        const P = api.player, dx = api.dx(e), feet = P.y + P.h;
        e.sT += dt;
        if (e.st === 'idle') { // мелкие подскоки на месте
          e.hop = Math.abs(Math.sin(e.t * 9)) * 2;
          if (Math.abs(dx) > 6) e.dir = Math.sign(dx);
          e.cd -= dt;
          if (e.cd <= 0 && Math.abs(dx) < 280 && feet > e.groundY - 90 && feet < e.groundY + 60 && onScreen(e, api)) {
            e.st = 'crouch'; e.sT = 0; e.x0 = e.x;
            e.tx = api.clamp(e.x + api.clamp(dx, -130, 130), e.minX, e.maxX - e.w); // точка приземления — отмечена на настиле
          }
        } else if (e.st === 'crouch') {
          e.hop = 0;
          if (e.sT >= 0.85) { e.st = 'jump'; e.sT = 0; }
        } else if (e.st === 'jump') { // дуга 0,55 с, высота 60
          const k = Math.min(1, e.sT / 0.55);
          e.x = e.x0 + (e.tx - e.x0) * k; e.hop = Math.sin(k * Math.PI) * 60;
          if (k >= 1) {
            e.st = 'land'; e.sT = 0; e.hop = 0; api.shake(3);
            api.burst(e.x + e.w / 2, e.groundY - 2, '#9a5a2e', 10, 150, 700);
            const lo = e.minX, hi = e.maxX, cx = e.x + e.w / 2;
            for (const s of [-1, 1]) {
              const room = s < 0 ? cx - lo : hi - cx;
              if (room < 24) continue;
              api.shoot({ x: cx + s * 16, y: e.groundY - 6, w: 16, h: 12, vx: s * 170, vy: 0, gravity: 0, life: Math.min(1.2, (room - 16) / 170), hitsSolids: false, color: '#9a5a2e', draw: drawWave, pts: 5, ph: 0, update(q, dt2) { q.ph += dt2; } });
            }
          }
        } else if (e.sT >= 0.7) { e.st = 'idle'; e.cd = api.rand(1.3, 1.9); }
        e.y = e.groundY - e.h - e.hop;
      },
      draw(e, ctx) {
        const t = e.t, cr = e.st === 'crouch', k = cr ? Math.min(1, e.sT / 0.85) : 0;
        const shx = cr ? Math.sin(t * 90) * (0.8 + k * 1.5) : Math.sin(t * 60) * 0.4, sq = cr ? k * 5 : 0;
        if (cr) { // метка приземления на настиле: мигающий круг
          const lx = (e.tx - e.x) * e.dir, on = Math.floor(e.sT * 10) % 2;
          ctx.strokeStyle = on ? '#ff5a2a' : '#ffd76a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(lx, -1, 12 + k * 6, 3, 0, 0, 7); ctx.stroke();
        }
        if (e.hop > 4) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, e.hop, 12, 3, 0, 0, 7); ctx.fill(); } // тень на настиле
        ctx.save(); ctx.translate(shx, sq);
        ctx.fillStyle = '#3a3d42'; ctx.fillRect(-12, -6, 24, 6);                 // башмак-плита
        ctx.fillStyle = '#23262a'; ctx.fillRect(-12, -1, 24, 1);
        ctx.fillStyle = '#6d7378'; ctx.fillRect(-5, -16, 10, 11);                // гармошка-сильфон
        ctx.fillStyle = '#4a4f54'; for (let y = -15; y < -6; y += 3) ctx.fillRect(-6, y, 12, 1.5);
        ctx.fillStyle = '#f2b41b'; ctx.fillRect(-9, -28 + sq * 0.3, 16, 13);     // двигатель
        ctx.fillStyle = '#c98a10'; ctx.fillRect(-9, -18 + sq * 0.3, 16, 3);
        ctx.fillStyle = '#1e1f22'; ctx.fillRect(-6, -26 + sq * 0.3, 7, 5);       // бак
        ctx.fillStyle = cr && Math.floor(e.sT * 12) % 2 ? '#ff3b3b' : '#5e1a1a'; ctx.fillRect(3, -25 + sq * 0.3, 3, 3); // «глаз»-лампа
        ctx.strokeStyle = '#1e1f22'; ctx.lineWidth = 2.5; ctx.beginPath();       // ручка-скоба
        ctx.moveTo(-8, -26 + sq * 0.3); ctx.lineTo(-17, -38 + sq * 0.5); ctx.lineTo(-10, -44 + sq * 0.5); ctx.stroke();
        ctx.restore();
        if (cr || e.st === 'jump') { // выхлоп
          ctx.fillStyle = 'rgba(120,120,120,.5)'; for (let i = 0; i < 2; i++) { const ph = (t * 4 + i / 2) % 1; ctx.beginPath(); ctx.arc(-12 - ph * 10, -30 - ph * 14, 2 + ph * 4, 0, 7); ctx.fill(); }
        }
        for (let i = 0; i < e.maxHp - e.hp; i++) { ctx.strokeStyle = '#3a2a10'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-6 + i * 6, -28); ctx.lineTo(-3 + i * 6, -21); ctx.stroke(); }
      },
    },
    bucket: { // бадья с бетоном на крюке крана: подползает, над героем раскачивается и капает (0,9 с), затем опрокидывает ком
      w: 30, h: 30, hp: 2, pts: 200, flip: false, heavy: true, hitColor: '#c9ced2', deathColor: '#8d9398',
      init(e, api) {
        e.st = 'move'; e.sT = 0; e.tilt = 0; e.homeY = e.y;
        // не висеть над настилами (герой на ярусе упёрся бы в бадью головой): сужаем ход до свободного от платформ участка
        const bl = api.platforms.filter(p => p.x < e.maxX && p.x + p.w > e.minX && p.y > e.y - 40 && p.y < e.y + e.h + 70).map(p => [p.x - 24, p.x + p.w + 24, p.y]).sort((a, b) => a[0] - b[0]);
        if (!bl.length) return;
        let best = null, x = e.minX;
        for (const [a, b] of [...bl, [e.maxX, e.maxX]]) { if (a - x > (best ? best[1] - best[0] : 0)) best = [x, Math.min(a, e.maxX)]; x = Math.max(x, b); }
        if (best && best[1] - best[0] >= e.w + 20) { e.minX = best[0]; e.maxX = best[1]; e.x = api.clamp(e.x, e.minX, e.maxX - e.w); }
        else { e.homeY = e.y = Math.min(...bl.map(q => q[2])) - 75 - e.h; } // места нет — поднимается над настилом
      },
      update(e, dt, api) {
        const dx = api.dx(e);
        e.sT += dt;
        if (e.st === 'move') { // едет за героем по стреле крана, медленнее бега
          if (Math.abs(dx) > 4) e.x = api.clamp(e.x + Math.sign(dx) * Math.min(Math.abs(dx), 55 * dt), e.minX, e.maxX - e.w);
          e.y = e.homeY + Math.sin(e.t * 1.4) * 4;
          e.tilt = Math.sin(e.t * 1.1) * 0.08;
          e.cd -= dt;
          if (e.cd <= 0 && Math.abs(dx) < 30 && onScreen(e, api)) { e.st = 'warn'; e.sT = 0; }
        } else if (e.st === 'warn') { // раскачивается и капает — внизу мигает тень: сейчас будет ком
          e.tilt = Math.sin(e.sT * 14) * (0.1 + e.sT * 0.25);
          if (e.sT >= 0.9) {
            e.st = 'pour'; e.sT = 0; e.tilt = 0.9;
            api.shoot({ x: e.x + e.w / 2, y: e.y + e.h + 6, w: 16, h: 14, vx: 0, vy: 60, color: '#8d9398', draw: drawBlob, pts: 15,
              onLand(p, a) { a.burst(p.x + p.w / 2, p.y + p.h, '#9aa0a5', 10, 150, 700); } });
          }
        } else if (e.st === 'pour') {
          e.tilt = 0.9 * Math.max(0, 1 - e.sT / 0.6);
          if (e.sT >= 1.2) { e.st = 'move'; e.cd = api.rand(1.8, 2.6); }
        }
      },
      draw(e, ctx, api) {
        const warn = e.st === 'warn', ropeTop = api.camY - 10 - (e.y + e.h);
        if (warn) { // тень-мишень на земле под бадьёй
          const gy = e.groundY - (e.y + e.h), on = Math.floor(e.sT * 10) % 2;
          ctx.fillStyle = on ? 'rgba(210,58,42,.45)' : 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, gy - 1, 12 + e.sT * 8, 3.5, 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#a8b0b6'; for (let k = 0; k < 3; k++) { const ph = (e.sT * 3 + k / 3) % 1; ctx.fillRect(-4 + k * 4, 2 + ph * Math.max(0, gy - 6), 2, 3); } // капли раствора
        }
        ctx.strokeStyle = '#1b1f23'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, ropeTop); ctx.lineTo(0, -40); ctx.stroke(); // трос
        ctx.save(); ctx.translate(0, -40); ctx.rotate(e.tilt);
        ctx.fillStyle = '#e0a526'; ctx.fillRect(-5, -2, 10, 7);                                   // крюк-обойма
        ctx.strokeStyle = '#1b1f23'; ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(-13, 14); ctx.moveTo(0, 5); ctx.lineTo(13, 14); ctx.stroke(); // стропы
        ctx.fillStyle = '#e2632b'; ctx.beginPath(); ctx.moveTo(-15, 12); ctx.lineTo(15, 12); ctx.lineTo(6, 40); ctx.lineTo(-6, 40); ctx.fill(); // оранжевый конус бадьи — ярче фоновой
        ctx.fillStyle = '#b3461c'; ctx.beginPath(); ctx.moveTo(4, 12); ctx.lineTo(15, 12); ctx.lineTo(6, 40); ctx.lineTo(2, 40); ctx.fill(); // тень на грани
        ctx.fillStyle = '#3a4047'; ctx.fillRect(-16, 11, 32, 4);
        ctx.fillStyle = '#9aa0a5'; ctx.beginPath(); ctx.ellipse(0, 12, 13, 3, 0, Math.PI, 0); ctx.fill(); // бетон горкой
        ctx.fillStyle = '#f2c230'; ctx.fillRect(-11, 20, 22, 4); ctx.fillStyle = '#1b1b1b'; for (let k = 0; k < 3; k++) ctx.fillRect(-9 + k * 8, 20, 4, 4); // полоса
        ctx.fillStyle = warn && Math.floor(e.sT * 10) % 2 ? '#ff3b3b' : '#6a1a1a'; ctx.fillRect(-2, 28, 4, 4); // «глаз»-затвор
        ctx.fillStyle = '#3a4047'; ctx.fillRect(-4, 38, 8, 3);                                    // затвор
        ctx.restore();
        for (let i = 0; i < e.maxHp - e.hp; i++) { ctx.strokeStyle = '#2b2f33'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-8 + i * 8, -24); ctx.lineTo(-4 + i * 8, -16); ctx.stroke(); }
      },
    },
  };

  registerTheme({
    index: 2, id: 'pit', hero: { weapon: 'gnss' },
    title: 'Котлован', subtitle: 'Подземная часть: фундамент и паркинг ниже уровня земли',
    accent: '#e0a060', dust: '#a8683c',
    gen: { groundRange: [250, 305], obstacleW: 50, decorCount: [0, 2] },
    decor: ['pump', 'hose', 'flood', 'rebar', 'cage', 'sign', 'flood', 'hose'],
    enemies,
    enemyTable: [
      { type: 'mole', where: 'ground', weight: 3 },
      { type: 'loader', where: 'ground', weight: 2, from: 0.2 },
      { type: 'welder', where: 'upper', weight: 1 },
      { type: 'rammer', where: 'upper', weight: 1.3, from: 0.1 },
      { type: 'bucket', where: 'air', weight: 1.5, from: 0.15 },
    ],
    init(api) { st.splashT = 0; fixTinySteps(api); },
    update(dt, api) { // брызги, когда геодезист бежит по луже
      const P = api.player;
      st.splashT -= dt;
      if (st.splashT > 0 || !P.onGround || Math.abs(P.vx) < 80) return;
      const fx = P.x + P.w / 2, fy = P.y + P.h;
      for (const s of api.solids) {
        if (s.kind !== 'ground' || fx < s.x || fx > s.x + s.w || Math.abs(s.y - fy) > 2) continue;
        for (const q of puddlesOf(s, api.hash)) if (fx > q.x && fx < q.x + q.w) { api.burst(fx, fy - 2, '#a8d8e4', 4, 90, 800); st.splashT = 0.12; }
      }
    },
    drawBackground, drawGround, drawPit, drawPlatform, drawObstacle, drawDecor, drawFinish, drawLadder,
  });
})();
