'use strict';
// «Топограф» — ядро: холст и раскладка, кампания из 10 уровней (5 видов работ × 2 участка), меню, карточка правил,
// HUD, итог уровня, рейтинги (тот же сервер, что у Star Dodger и Level Runner), Telegram, ввод. Устройство — в MODES.md.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const H = 360, TOP = 30;
let W = 640, scale = 1, cssScale = 1, rotated = false;
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const stage = document.getElementById('stage');
if (IS_TOUCH) document.body.classList.add('touch');

const GAME = 'topograf';
const API = 'https://star-dodger.ashlwilliams.workers.dev';
const PARAMS = new URLSearchParams(location.search);
let TICKET = PARAMS.get('t');
const MINIAPP = !!window.TG_APP; // открыта как Telegram Mini App: билет без чата — только мировой рейтинг
if (!TICKET && window.tgTicket) tgTicket(API, GAME).then(t => { if (t) TICKET = t; });
const STORAGE_KEY = 'topograf-best', UNLOCK_KEY = 'topograf-unlocked', STARS_KEY = 'topograf-stars', NAME_KEY = 'star-dodger-name';
const GROUP_URL = 'https://t.me/bearsurveyor';
let best = 0, unlocked = 1, starsMem = {};
try { best = +localStorage.getItem(STORAGE_KEY) || 0; unlocked = +localStorage.getItem(UNLOCK_KEY) || 1; starsMem = JSON.parse(localStorage.getItem(STARS_KEY) || '{}'); } catch (e) {}
const forcedLevel = Math.max(0, (parseInt(PARAMS.get('level'), 10) || 1) - 1); // ?level=N — тренировка с уровня N

const THEME = { accent: '#ffb02e', ink: '#f1e6d6', dim: '#c9b89e', good: '#6cff8a', bad: '#ff6b5b', panel: 'rgba(20,14,10,.78)' };

// ---------- раскладка: горизонтальный кадр на любом экране (как в Level Runner) ----------
function layout() {
  const ins = window.tgInsets ? tgInsets() : { t: 0, b: 0, l: 0, r: 0 }; // Telegram Mini App на весь экран: обходим вырез и кнопки Telegram
  const vw = innerWidth - ins.l - ins.r, vh = innerHeight - ins.t - ins.b;
  stage.style.left = ins.l ? ins.l + 'px' : ''; stage.style.top = ins.t ? ins.t + 'px' : '';
  rotated = IS_TOUCH && vh > vw;
  document.body.classList.toggle('rotated', rotated);
  let sw = rotated ? vh : vw, sh = rotated ? vw : vh;
  if (!IS_TOUCH) { sw = Math.min(vw * 0.96, 1100, vh * 0.78 * 16 / 9); sh = sw * 9 / 16; }
  stage.style.width = sw + 'px'; stage.style.height = sh + 'px';
  W = Math.round(Math.max(560, Math.min(860, H * sw / sh)));
  cssScale = Math.min(sw / W, sh / H);
  const cw = W * cssScale, ch = H * cssScale;
  Object.assign(canvas.style, { width: cw + 'px', height: ch + 'px', left: (sw - cw) / 2 + 'px', top: (sh - ch) / 2 + 'px' });
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  scale = canvas.width / W;
}
addEventListener('resize', layout);
addEventListener('orientationchange', () => setTimeout(layout, 250));
function toGame(e) {
  let x = e.clientX, y = e.clientY;
  if (rotated) { const ins = window.tgInsets ? tgInsets() : { t: 0, r: 0 }, t = x; x = y - ins.t; y = innerWidth - ins.r - t; }
  else { const r = stage.getBoundingClientRect(); x -= r.left; y -= r.top; }
  return { x: (x - canvas.offsetLeft) / cssScale, y: (y - canvas.offsetTop) / cssScale };
}

// ---------- утилиты ----------
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function text(c, str, x, y, size, color = '#fff', align = 'center', weight = 'bold') {
  c.fillStyle = color; c.font = `${weight} ${size}px system-ui, sans-serif`; c.textAlign = align; c.fillText(str, x, y);
}
function segSeg(ax, ay, bx, by, cx, cy, dx, dy) { // пересекаются ли отрезки AB и CD
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
function segHitsRect(ax, ay, bx, by, r) {
  const inside = (x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (inside(ax, ay) || inside(bx, by)) return true;
  const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
  return segSeg(ax, ay, bx, by, x1, y1, x2, y1) || segSeg(ax, ay, bx, by, x2, y1, x2, y2) || segSeg(ax, ay, bx, by, x2, y2, x1, y2) || segSeg(ax, ay, bx, by, x1, y2, x1, y1);
}
function segHitsCircle(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((cx - ax) * dx + (cy - ay) * dy) / l2, 0, 1) : 0;
  const px = ax + dx * t - cx, py = ay + dy * t - cy;
  return px * px + py * py <= r * r;
}
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0] ?? poly[i].x, yi = poly[i][1] ?? poly[i].y, xj = poly[j][0] ?? poly[j].x, yj = poly[j][1] ?? poly[j].y;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function button(c, b, label, o = {}) { // кнопка в кадре
  c.save();
  roundRect(c, b.x, b.y, b.w, b.h, Math.min(10, b.h / 3));
  c.fillStyle = o.disabled ? 'rgba(60,50,40,.55)' : o.active ? (o.color || THEME.accent) : 'rgba(30,22,16,.78)'; c.fill();
  c.lineWidth = 2; c.strokeStyle = o.disabled ? 'rgba(255,255,255,.15)' : (o.color || THEME.accent); c.stroke();
  const size = o.size || Math.min(14, b.h * 0.42);
  text(c, label, b.x + b.w / 2, b.y + b.h / 2 + size * 0.36, size, o.active ? '#1a120a' : o.disabled ? 'rgba(241,230,214,.4)' : THEME.ink);
  c.restore();
}
const hit = (b, p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
function makeLayer(w, h, draw) { // статичный фон в отдельный холст (с запасом по плотности пикселей)
  const k = Math.max(1, Math.min(3, Math.ceil(scale))), cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
  const c = cv.getContext('2d'); c.scale(k, k); draw(c);
  return { canvas: cv, w, h };
}

// ---------- виды работ и кампания ----------
const MODES = [];
let LEVELS = [];
function registerMode(m) {
  MODES.push(m); MODES.sort((a, b) => a.index - b.index);
  LEVELS = []; for (const md of MODES) md.variants.forEach((v, k) => LEVELS.push({ mode: md, variant: v, num: LEVELS.length + 1, key: md.id + '/' + v.id }));
}

let mode = 'menu'; // menu | intro | play | pause | clear | over
let levelIdx = 0, startLevel = 0, practice = false, inst = null, result = null, overAt = 0, menuLevel = 0;
// песочница: все уровни открыты, время не ограничено, без рейтинга; выбор режима запоминается
const SANDBOX_KEY = 'topograf-sandbox', LEVEL_TIME = 420; // в смене каждый уровень — 7 минут (свои сроки у «Пикета» — 6, у последних «Горизонталей» — 15, у SLAM — 8)
let sandbox = false; try { sandbox = localStorage.getItem(SANDBOX_KEY) === '1'; } catch (e) {}
function setSandbox(on) { sandbox = on; try { localStorage.setItem(SANDBOX_KEY, on ? '1' : '0'); } catch (e) {} menuLevel = clamp(menuLevel, 0, maxSelectable() - 1); Sound.play('select'); }
const maxSelectable = () => sandbox ? LEVELS.length : Math.min(Math.max(unlocked, forcedLevel + 1), LEVELS.length);
let score = 0, time = 0, levelTime = 0, shake = 0, results = [];
let popups = [], particles = [], hudDrawn = false;
let board = null, globalBoard = null, session = null, final = null;
const nameForm = document.getElementById('nameForm'), nameInput = document.getElementById('nameInput');
try { nameInput.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}

const api = {
  get W() { return W; }, H, TOP, IS_TOUCH, get now() { return performance.now() / 1000; }, get levelTime() { return levelTime; },
  rng: s => mulberry32(s >>> 0), rand, randi: (a, b) => Math.floor(rand(a, b + 1)), pick: a => a[Math.floor(Math.random() * a.length)],
  clamp, lerp: (a, b, t) => a + (b - a) * t, dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
  segHitsRect, segHitsCircle, segSeg, pointInPoly,
  text, button, hit, roundRect,
  sfx: n => Sound.play(n),
  popup(x, y, t, color = THEME.accent) { popups.push({ x, y, text: t, color, life: 1.2 }); },
  burst(x, y, color = '#fff', n = 10) { for (let i = 0; i < n; i++) { const a = rand(0, 7), s = rand(30, 140); particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: rand(0.3, 0.8), max: 0.8, color }); } },
  shake(n) { shake = Math.max(shake, n); },
  layer: makeLayer,
  finish(r) { if (mode === 'play' && !result) finishLevel(r); },
  get sandbox() { return sandbox; },
  timeLimit(base) { return sandbox ? 1e6 : LEVEL_TIME; }, // время уровня: в смене 7 минут (просьба пользователя; base моды больше не влияет), в песочнице без предела
  theme: THEME,
};

function startRun(from) {
  score = 0; time = 0; results = []; board = null; globalBoard = null; final = null; nameForm.hidden = true;
  startLevel = clamp(from, 0, LEVELS.length - 1); practice = sandbox || startLevel > 0;
  loadLevel(startLevel);
  if (!practice) newSession();
}
function loadLevel(i) {
  levelIdx = i; result = null; levelTime = 0; popups = []; particles = [];
  const L = LEVELS[i], seed = (Math.random() * 2 ** 32) >>> 0;
  inst = L.mode.create(api, L.variant, seed);
  mode = 'intro';
  Sound.play('select');
}
function finishLevel(r) {
  result = { score: clamp(Math.round(r.score || 0), 0, 1000), stars: clamp(r.stars | 0, 0, 3), lines: r.lines || [], drawResult: r.drawResult || null };
  score += result.score; results[levelIdx] = result;
  const k = LEVELS[levelIdx].key; if (!sandbox && (starsMem[k] || 0) < result.stars) starsMem[k] = result.stars;
  if (!sandbox && levelIdx + 2 > unlocked) unlocked = Math.min(LEVELS.length, levelIdx + 2);
  try { localStorage.setItem(UNLOCK_KEY, unlocked); localStorage.setItem(STARS_KEY, JSON.stringify(starsMem)); } catch (e) {}
  Sound.play(result.stars >= 1 ? 'clear' : 'bad');
  mode = 'clear'; overAt = performance.now();
}
function nextLevel() {
  if (levelIdx >= LEVELS.length - 1) { endRun(); return; }
  loadLevel(levelIdx + 1);
}
function endRun() {
  mode = 'over'; overAt = performance.now(); Sound.play('win');
  final = { score, duration: time, level: levelIdx + 1 };
  if (score > best && !practice) { best = score; try { localStorage.setItem(STORAGE_KEY, best); } catch (e) {} }
  if (practice) return;
  if (TICKET) { if (!MINIAPP) submitScore(); submitGlobal(); } else { loadGlobal(); nameForm.hidden = false; }
}

// ---------- цикл ----------
function update(dt) {
  for (const p of particles) { p.vy += 300 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  for (const p of popups) { p.y -= 30 * dt; p.life -= dt; }
  popups = popups.filter(p => p.life > 0);
  shake = Math.max(0, shake - dt * 20);
  if (mode !== 'play') return;
  time += dt; levelTime += dt;
  try { inst.update(dt); } catch (e) { console.error(e); api.finish({ score: 0, stars: 0, lines: ['Ошибка уровня: ' + e.message] }); }
}

function draw() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#1b2418'; ctx.fillRect(0, 0, W, H);
  if (inst && mode !== 'menu') {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    try { inst.draw(ctx); } catch (e) { console.error(e); }
    ctx.restore();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
    ctx.globalAlpha = 1;
    for (const p of popups) { ctx.globalAlpha = Math.min(1, p.life / 0.4); text(ctx, p.text, p.x, p.y, 13, p.color); }
    ctx.globalAlpha = 1;
    drawHUD();
  } else drawMenuBackground();
  groupLink = null;
  if (mode === 'menu') drawMenu();
  if (mode === 'intro') drawIntro();
  if (mode === 'pause') drawPause();
  if (mode === 'clear') drawClear();
  if (mode === 'over') drawEnd();
  if (!hudDrawn) { drawSoundButton(); drawMusicButton(); }
  drawNotice(); hudDrawn = false;
}

// ---------- HUD ----------
const SOUND_BTN = () => ({ x: W - 22, y: 15, r: 12 });
const PAUSE_BTN = () => ({ x: W - 52, y: 15, r: 13 });
// выбор музыки рядом со звуком: «синт» — синтез с ускорением в конце, «файл» — петли локального генератора (music/)
const MUSIC_BTN = () => ({ x: W - (mode === 'play' ? 112 : 82), y: 4, w: 46, h: 22 });
let notice = null; // короткое сообщение под HUD: { text, life }
function drawMusicButton() {
  const b = MUSIC_BTN(), files = Sound.source === 'files';
  ctx.fillStyle = 'rgba(255,255,255,.12)'; roundRect(ctx, b.x, b.y, b.w, b.h, 6); ctx.fill();
  ctx.strokeStyle = files ? THEME.accent : 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; roundRect(ctx, b.x, b.y, b.w, b.h, 6); ctx.stroke();
  text(ctx, files ? '♪ файл' : '♪ синт', b.x + b.w / 2, b.y + 15, 10, files ? THEME.accent : THEME.ink, 'center', '700');
}
function drawNotice() {
  if (!notice) return;
  ctx.globalAlpha = Math.min(1, notice.life / 0.4);
  ctx.font = '600 12px system-ui, sans-serif'; const w = ctx.measureText(notice.text).width + 24;
  ctx.fillStyle = 'rgba(20,14,10,.9)'; roundRect(ctx, W / 2 - w / 2, TOP + 6, w, 24, 8); ctx.fill();
  text(ctx, notice.text, W / 2, TOP + 22, 12, THEME.ink, 'center', '600'); ctx.globalAlpha = 1;
}
function toggleMusicSource() {
  Sound.toggleSource().then(r => {
    notice = { life: 2.6, text: r.source === 'synth' ? 'Музыка: синтез (в конце уровня ускоряется)'
      : r.files ? 'Музыка: треки из файлов' : 'Треков пока нет — играет синтез; появятся сами' };
  });
  Sound.play('select');
}
function drawSoundButton() {
  const b = SOUND_BTN(), m = Sound.muted;
  ctx.save(); ctx.translate(b.x, b.y);
  ctx.fillStyle = m ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(-4, -3); ctx.lineTo(1, -8); ctx.lineTo(1, 8); ctx.lineTo(-4, 3); ctx.lineTo(-8, 3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
  if (m) { ctx.strokeStyle = THEME.bad; ctx.beginPath(); ctx.moveTo(4, -5); ctx.lineTo(10, 5); ctx.moveTo(10, -5); ctx.lineTo(4, 5); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(2, 0, 5, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(2, 0, 9, -0.9, 0.9); ctx.stroke(); }
  ctx.restore();
}
function drawHUD() {
  ctx.fillStyle = 'rgba(20,14,10,.82)'; ctx.fillRect(0, 0, W, TOP);
  const L = LEVELS[levelIdx];
  text(ctx, `${L.num}/${LEVELS.length}`, 10, 19, 12, THEME.accent, 'left');
  ctx.font = 'bold 12px system-ui, sans-serif'; const numW = ctx.measureText(`${L.num}/${LEVELS.length}`).width;
  text(ctx, `${L.mode.title} · ${L.variant.title}`, 18 + numW, 19, 12, THEME.ink, 'left');
  text(ctx, 'Очки: ' + Math.floor(score + (result ? 0 : 0)), W - 122, 19, 12, THEME.ink, 'right');
  let h = null; try { h = inst && inst.hud ? inst.hud() : null; } catch (e) {}
  if (h) {
    let x = W - 200;
    if (h.time != null && sandbox) { text(ctx, '∞', x, 20, 16, THEME.good, 'right'); x -= 50; }
    else if (h.time != null) { const t = Math.max(0, Math.ceil(h.time)); text(ctx, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, x, 19, 13, t <= 10 ? THEME.bad : THEME.ink, 'right'); x -= 50; }
    if (h.progress != null) { const pw = 70; ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x - pw, 12, pw, 5); ctx.fillStyle = THEME.accent; ctx.fillRect(x - pw, 12, pw * clamp(h.progress, 0, 1), 5); x -= pw + 10; }
    if (h.info && h.info.length) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x, TOP); ctx.clip(); text(ctx, h.info.join(' · '), x, 19, 11, THEME.dim, 'right', '600'); ctx.restore(); }
  }
  drawSoundButton(); drawMusicButton(); hudDrawn = true;
  if (mode === 'play') { const pb = PAUSE_BTN(); ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(pb.x - 6, pb.y - 7, 4, 14); ctx.fillRect(pb.x + 2, pb.y - 7, 4, 14); }
}

// ---------- экраны ----------
const logo = new Image(); logo.src = '../surveyor/img/bear-surveyor.jpg';
function drawLogo(x, y, r) {
  ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(x + 2, y + 3, r + 2, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
  if (logo.complete && logo.naturalWidth) ctx.drawImage(logo, x - r, y - r, r * 2, r * 2); else { ctx.fillStyle = '#c9ad7f'; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  ctx.restore(); ctx.strokeStyle = '#c9ad7f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
}
let groupLink = null;
function drawGroupLink(x, y, size) {
  const label = 'Игра сделана для группы ', url = 't.me/bearsurveyor';
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  const w1 = ctx.measureText(label).width, w2 = ctx.measureText(url).width, x0 = x - (w1 + w2) / 2;
  text(ctx, label, x0, y, size, THEME.dim, 'left'); text(ctx, url, x0 + w1, y, size, '#7ec8ff', 'left');
  ctx.fillStyle = '#7ec8ff'; ctx.fillRect(x0 + w1, y + 2, w2, 1);
  groupLink = { x: x0 - 6, y: y - size - 6, w: w1 + w2 + 12, h: size + 14 };
}
const inLink = p => groupLink && hit(groupLink, p);
function openGroup() { try { window.open(GROUP_URL, '_blank'); } catch (e) { location.href = GROUP_URL; } }

function drawMenuBackground() { // ожившая карта: горизонтали медленно плывут, пикеты мигают
  const t = performance.now() / 1000;
  ctx.fillStyle = '#f3ecd9'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(160,110,60,.35)'; ctx.lineWidth = 1;
  const f = (x, y) => Math.sin(x * 0.012 + t * 0.05) * 40 + Math.cos(y * 0.017 - t * 0.04) * 35 + Math.sin((x + y) * 0.007) * 50;
  for (let lv = -100; lv <= 100; lv += 14) { // грубые изолинии по сетке (marching squares без сглаживания)
    ctx.lineWidth = lv % 70 === 0 ? 1.6 : 0.8; ctx.beginPath();
    const s = 16;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      const a = f(x, y) - lv, b = f(x + s, y) - lv, c = f(x + s, y + s) - lv, d = f(x, y + s) - lv;
      const pts = [];
      if ((a > 0) !== (b > 0)) pts.push([x + s * a / (a - b), y]);
      if ((b > 0) !== (c > 0)) pts.push([x + s, y + s * b / (b - c)]);
      if ((c > 0) !== (d > 0)) pts.push([x + s * (1 - c / (c - d)), y + s]);
      if ((d > 0) !== (a > 0)) pts.push([x, y + s * (1 - d / (d - a))]);
      if (pts.length >= 2) { ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); }
    }
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(80,80,80,.18)'; // сетка крестов, как на листе плана
  for (let x = 40; x < W; x += 80) for (let y = 40; y < H; y += 80) { ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke(); }
}
function modeButtons() { return { shift: { x: W / 2 - 124, y: 212, w: 120, h: 30 }, sand: { x: W / 2 + 4, y: 212, w: 120, h: 30 } }; }
function menuArrows() { return { left: { x: W / 2 - 200, y: 268, w: 36, h: 32 }, right: { x: W / 2 + 164, y: 268, w: 36, h: 32 } }; }
function drawMenu() {
  ctx.fillStyle = 'rgba(15,10,8,.66)'; ctx.fillRect(0, 0, W, H);
  drawLogo(W / 2, 48, 32);
  text(ctx, 'ТОПОГРАФ', W / 2, 116, 34, THEME.accent);
  text(ctx, 'Шесть видов полевых и камеральных работ — двенадцать участков, каждый раз новых.', W / 2, 142, 13, THEME.ink);
  text(ctx, 'Пикет · Невязка · Реечник · Трассоискатель · Горизонтали · SLAM', W / 2, 162, 12, THEME.dim);
  text(ctx, sandbox ? (IS_TOUCH ? 'Тап — в песочницу' : 'Пробел, Enter или клик — в песочницу') : (IS_TOUCH ? 'Тап — начать смену' : 'Пробел, Enter или клик — начать смену'), W / 2, 198, 15, '#ffd76a');
  const mb = modeButtons();
  button(ctx, mb.shift, 'Смена', { active: !sandbox }); button(ctx, mb.sand, 'Песочница', { active: sandbox });
  text(ctx, sandbox ? 'Без времени и без рейтинга · все уровни открыты' : (best ? 'На время, в рейтинг · рекорд: ' + best : 'На время, в рейтинг'), W / 2, 256, 11, THEME.dim);
  const maxSel = maxSelectable();
  if (maxSel > 1) {
    const L = LEVELS[menuLevel], a = menuArrows(), st = starsMem[L.key] || 0;
    text(ctx, `Старт: ${L.num}. ${L.mode.title} — ${L.variant.title}`, W / 2, 289, 14, THEME.accent);
    text(ctx, sandbox ? 'песочница — можно играть сколько угодно' : '★'.repeat(st) + '☆'.repeat(3 - st) + (menuLevel ? ' · тренировка — не в рейтинг' : ' · с первого уровня — в рейтинг'), W / 2, 308, 11, THEME.dim);
    button(ctx, a.left, '◀'); button(ctx, a.right, '▶');
  }
  drawGroupLink(W / 2, H - 14, 12);
}
function wrapLines(str, maxW, size) { // перенос строки по ширине
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const out = []; let cur = '';
  for (const w of str.split(' ')) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  return out;
}
function drawIntro() { // карточка правил перед уровнем
  ctx.fillStyle = 'rgba(15,10,8,.72)'; ctx.fillRect(0, 0, W, H);
  const L = LEVELS[levelIdx], pw = Math.min(560, W - 40), px = (W - pw) / 2;
  roundRect(ctx, px, 46, pw, 270, 14); ctx.fillStyle = 'rgba(32,24,18,.94)'; ctx.fill(); ctx.strokeStyle = THEME.accent; ctx.lineWidth = 2; ctx.stroke();
  text(ctx, `Уровень ${L.num} из ${LEVELS.length}`, W / 2, 70, 12, THEME.dim);
  text(ctx, L.mode.title + ' — ' + L.variant.title, W / 2, 96, 22, THEME.accent);
  text(ctx, L.variant.subtitle || L.mode.subtitle || '', W / 2, 116, 12, THEME.ink, 'center', '600');
  const lines = [...(L.mode.howto || []), ...(L.variant.howto || [])];
  let y = 144;
  for (const ln of lines) for (const w of wrapLines('• ' + ln, pw - 48, 12)) { if (y > 286) break; text(ctx, w, px + 24, y, 12, THEME.ink, 'left', '600'); y += 17; }
  text(ctx, IS_TOUCH ? 'Тап — начать' : 'Пробел или клик — начать', W / 2, 306, 13, '#ffd76a');
}
function pauseButtons() { return { go: { x: W / 2 - 134, y: 160, w: 128, h: 44 }, menu: { x: W / 2 + 6, y: 160, w: 128, h: 44 } }; }
function toMenu() { mode = 'menu'; inst = null; result = null; menuLevel = sandbox ? levelIdx : startLevel; nameForm.hidden = true; pointers.clear(); Sound.play('select'); }
function drawPause() {
  ctx.fillStyle = 'rgba(15,10,8,.7)'; ctx.fillRect(0, 0, W, H);
  text(ctx, 'ПАУЗА', W / 2, 130, 34, THEME.accent);
  const pb = pauseButtons(); button(ctx, pb.go, 'Продолжить', { active: true }); button(ctx, pb.menu, 'В меню');
  text(ctx, sandbox ? 'Песочница: участок можно бросить и выбрать другой' : 'В меню — смена прервётся, результат не засчитается', W / 2, 236, 12, THEME.dim);
}
function drawStars(x, y, n, size = 22) { for (let i = 0; i < 3; i++) text(ctx, i < n ? '★' : '☆', x + (i - 1) * size * 1.2, y, size, i < n ? '#ffd24a' : 'rgba(255,255,255,.35)'); }
function drawClear() {
  ctx.fillStyle = 'rgba(15,10,8,.8)'; ctx.fillRect(0, 0, W, H);
  const L = LEVELS[levelIdx], r = result;
  const hasPic = !!r.drawResult, tx = hasPic ? W * 0.3 : W / 2;
  text(ctx, r.stars ? 'УЧАСТОК СДАН!' : 'УЧАСТОК НЕ ПРИНЯТ', tx, 62, 24, r.stars ? THEME.good : THEME.bad);
  text(ctx, `${L.num}. ${L.mode.title} — ${L.variant.title}`, tx, 86, 13, THEME.ink);
  drawStars(tx, 120, r.stars);
  r.lines.slice(0, 5).forEach((ln, i) => text(ctx, ln, tx, 152 + i * 19, 12, THEME.dim, 'center', '600'));
  text(ctx, `+${r.score} · всего ${Math.floor(score)}`, tx, 258, 16, '#ffd76a');
  text(ctx, levelIdx < LEVELS.length - 1 ? (IS_TOUCH ? 'Тап — следующий участок' : 'Пробел или клик — следующий участок') : (IS_TOUCH ? 'Тап — итоги смены' : 'Пробел или клик — итоги смены'), tx, 300, 13, '#ffd76a');
  if (hasPic) { const x = W * 0.56, w = W * 0.42, y = 44, h = 290; ctx.save(); try { r.drawResult(ctx, x, y, w, h); } catch (e) { console.error(e); } ctx.restore(); }
}
function drawTable(b, title, x1, x2, y, maxRows = 6) {
  const cx = (x1 + x2) / 2;
  text(ctx, title, cx, y, 14, THEME.accent);
  if (!b) return;
  if (b.state !== 'ok') { text(ctx, b.state === 'loading' ? 'Загрузка…' : 'Нет связи с сервером', cx, y + 22, 12, THEME.dim); return; }
  if (!b.rows.length) { text(ctx, 'Пока пусто — будьте первым!', cx, y + 22, 12, THEME.dim); return; }
  const rows = b.rows.slice().sort((a, c) => a.pos - c.pos).slice(0, maxRows), me = b.rows.find(r => r.me);
  if (me && !rows.includes(me)) rows[rows.length - 1] = me;
  for (const r of rows) {
    y += 19; const color = r.me ? '#ffd76a' : THEME.ink, name = r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name;
    text(ctx, `${r.pos}. ${name}`, x1, y, 12, color, 'left'); text(ctx, String(r.score), x2, y, 12, color, 'right');
  }
  let note = '';
  if (b.sent) note = b.rank ? `Ваше место: ${b.rank}${b.improved ? ' · рекорд!' : ''}` : 'Вы пока вне топ-100';
  else if (b.newRecord) note = 'Новый рекорд чата!';
  if (note) text(ctx, note, cx, y + 20, 11, THEME.dim);
}
function drawEnd() {
  ctx.fillStyle = 'rgba(15,10,8,.88)'; ctx.fillRect(0, 0, W, H);
  drawLogo(40, 48, 26);
  const stars = results.reduce((s, r) => s + (r ? r.stars : 0), 0);
  text(ctx, 'СМЕНА ЗАКРЫТА', W / 2, 50, 28, THEME.good);
  text(ctx, `Очки: ${final.score} · Рекорд: ${best} · Звёзды: ${stars}/${3 * (LEVELS.length - startLevel)} · Время: ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`, W / 2, 76, 13, THEME.ink);
  // звёзды по уровням
  const n = LEVELS.length, cw = Math.min(70, (W - 40) / n), x0 = W / 2 - cw * n / 2;
  for (let i = 0; i < n; i++) { const r = results[i]; text(ctx, String(i + 1), x0 + cw * (i + 0.5), 100, 10, THEME.dim); text(ctx, r ? '★'.repeat(r.stars) || '—' : '·', x0 + cw * (i + 0.5), 114, 10, r && r.stars ? '#ffd24a' : THEME.dim); }
  text(ctx, (IS_TOUCH ? 'Тап' : 'Пробел или клик') + ' — в меню', W / 2, 136, 12, THEME.dim);
  const y = 162, ox = (W - 640) / 2;
  if (practice) text(ctx, sandbox ? 'Песочница — результат не идёт в рейтинг' : 'Тренировка не с первого уровня — результат не идёт в рейтинг', W / 2, y + 10, 12, THEME.dim);
  else if (TICKET && MINIAPP) drawTable(globalBoard, 'Мировой рейтинг', ox + 190, ox + 450, y, 5);
  else if (TICKET) { drawTable(globalBoard, 'Мировой рейтинг', ox + 40, ox + 300, y); drawTable(board, 'Рекорды чата', ox + 340, ox + 600, y); }
  else { drawTable(globalBoard, 'Мировой рейтинг', ox + 190, ox + 450, y, 5); if (!nameForm.hidden) text(ctx, 'Введите имя, чтобы попасть в рейтинг', W / 2, y + 126, 12, THEME.dim); }
  drawGroupLink(W / 2, nameForm.hidden ? H - 12 : H - 62, 11);
}

// ---------- рейтинги ----------
function newSession() { session = fetch(`${API}/session?game=${GAME}`).then(r => r.json()).then(d => d.s).catch(() => null); }
async function submitScore() {
  const b = board = { state: 'loading', rows: [] };
  try {
    const res = await fetch(API + '/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: TICKET, score: final.score, duration: final.duration }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error);
    Object.assign(b, { state: 'ok', rows: data.scores, newRecord: data.newRecord });
  } catch (e) { b.state = 'error'; }
}
async function loadGlobal() {
  const g = globalBoard = { state: 'loading', rows: [] };
  try { Object.assign(g, { state: 'ok', rows: (await (await fetch(`${API}/global?game=${GAME}`)).json()).top }); } catch (e) { g.state = 'error'; }
}
async function submitGlobal(name) {
  const g = globalBoard = { state: 'loading', rows: [] };
  try {
    const s = await session; if (!s) throw new Error('no session');
    const res = await fetch(API + '/global', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ s, t: TICKET, name, score: final.score, duration: final.duration }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error);
    Object.assign(g, { state: 'ok', rows: data.top, rank: data.rank, improved: data.improved, sent: true });
  } catch (e) { g.state = 'error'; }
}
nameForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  try { localStorage.setItem(NAME_KEY, name); } catch (err) {}
  nameForm.hidden = true; nameInput.blur(); submitGlobal(name);
});

// ---------- ввод ----------
function advance() { // «тап по экрану» вне игры
  if (mode === 'menu') { startRun(menuLevel); return; }
  if (mode === 'intro') { mode = 'play'; Sound.play('tap'); return; }
  if (mode === 'pause') { mode = 'play'; return; }
  if (performance.now() - overAt < 500) return;
  if (mode === 'clear') nextLevel();
  else if (mode === 'over') { mode = 'menu'; inst = null; menuLevel = startLevel; nameForm.hidden = true; }
}
function selectLevel(d) { menuLevel = clamp(menuLevel + d, 0, maxSelectable() - 1); Sound.play('select'); }
const pointers = new Set();
canvas.addEventListener('pointerdown', e => {
  e.preventDefault(); Sound.unlock();
  const p = toGame(e); p.id = e.pointerId; p.button = e.button;
  const sb = SOUND_BTN();
  if (Math.hypot(p.x - sb.x, p.y - sb.y) < sb.r * 1.8) { Sound.toggleMute(); return; }
  { const mb = MUSIC_BTN(); if (p.x > mb.x - 4 && p.x < mb.x + mb.w + 4 && p.y > mb.y - 4 && p.y < mb.y + mb.h + 10) { toggleMusicSource(); return; } }
  if (mode !== 'play' && inLink(p)) { openGroup(); return; }
  if (mode === 'menu') {
    const a = menuArrows();
    if (maxSelectable() > 1) { if (hit(a.left, p)) { selectLevel(-1); return; } if (hit(a.right, p)) { selectLevel(1); return; } }
    const mb = modeButtons(); if (hit(mb.shift, p)) { if (sandbox) setSandbox(false); return; } if (hit(mb.sand, p)) { if (!sandbox) setSandbox(true); return; }
    advance(); return;
  }
  if (mode === 'play') {
    const pb = PAUSE_BTN(); if (Math.hypot(p.x - pb.x, p.y - pb.y) < pb.r * 1.8) { mode = 'pause'; return; }
    pointers.add(e.pointerId);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    if (inst.pointerDown) inst.pointerDown(p);
    return;
  }
  if (mode === 'pause' && hit(pauseButtons().menu, p)) { toMenu(); return; }
  advance();
});
canvas.addEventListener('pointermove', e => { if (mode !== 'play' || !inst.pointerMove) return; const p = toGame(e); p.id = e.pointerId; p.down = pointers.has(e.pointerId); inst.pointerMove(p); });
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, e => { const was = pointers.delete(e.pointerId); if (mode === 'play' && was && inst.pointerUp) { const p = toGame(e); p.id = e.pointerId; inst.pointerUp(p); } });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  if (e.target === nameInput) return;
  Sound.unlock();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyM') { Sound.toggleMute(); return; }
  if (mode === 'menu' && !e.repeat && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { selectLevel(e.code === 'ArrowLeft' ? -1 : 1); return; }
  if (mode === 'play') {
    if (e.code === 'KeyP' || e.code === 'Escape') { mode = 'pause'; return; }
    if (inst.key) inst.key(e.code, true);
    return;
  }
  if (mode === 'pause' && (e.code === 'KeyP' || e.code === 'Escape')) { mode = 'play'; return; }
  if (!e.repeat && (e.code === 'Space' || e.code === 'Enter')) advance();
});
addEventListener('keyup', e => { if (mode === 'play' && inst && inst.key && e.target !== nameInput) inst.key(e.code, false); });
addEventListener('blur', () => { if (mode === 'play') mode = 'pause'; });

// ---------- запуск ----------
let last = 0;
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (notice && (notice.life -= dt) <= 0) notice = null;
  while (dt > 0) { const s = Math.min(dt, 1 / 60); update(s); dt -= s; }
  draw();
  // музыка: в меню и на итогах смены — главная тема, на уровне — своя; мало времени — напряжённый слой
  let tense = 0; if (mode === 'play' && inst && inst.hud) { try { const h = inst.hud(); if (h && h.time != null && h.time < 20) tense = 1; } catch (e) {} }
  Sound.music(mode === 'menu' || mode === 'over' || !LEVELS[levelIdx] ? 'menu' : LEVELS[levelIdx].key, mode !== 'pause', tense);
  requestAnimationFrame(frame);
}
function startGame() {
  if (!MODES.length) throw new Error('Не загружено ни одного вида работ');
  layout();
  menuLevel = clamp(PARAMS.has('level') ? forcedLevel : 0, 0, LEVELS.length - 1);
  last = performance.now();
  requestAnimationFrame(frame);
}
