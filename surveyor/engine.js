'use strict';
// Level Runner — движок кампании. Геодезист с нивелирной рейкой проходит участки один за другим.
// Каждый участок — «тема» в своём файле themes/NN-*.js: фон, земля, препятствия, враги, особые механики.
// Тема регистрируется вызовом registerTheme({...}); контракт тем описан в THEMES.md.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const H = 360;       // высота кадра в игровых единицах постоянна
let W = 640;         // ширина подстраивается под экран: на вытянутом телефоне видно больше уровня
let scale = 1;       // пикселей холста на игровую единицу (с учётом плотности экрана)
let cssScale = 1;    // CSS-пикселей на игровую единицу
let rotated = false; // телефон держат вертикально — сцена повёрнута на 90°
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const stage = document.getElementById('stage');
if (IS_TOUCH) document.body.classList.add('touch');

const GAME = 'levelrunner';
const API = 'https://star-dodger.ashlwilliams.workers.dev';
const PARAMS = new URLSearchParams(location.search);
const TICKET = PARAMS.get('t'); // билет от Telegram-бота
const STORAGE_KEY = 'level-runner-best', UNLOCK_KEY = 'level-runner-unlocked', NAME_KEY = 'star-dodger-name';
let best = 0, unlocked = 1;
try { best = +localStorage.getItem(STORAGE_KEY) || 0; unlocked = +localStorage.getItem(UNLOCK_KEY) || 1; } catch (e) {}

// ---------- физика ----------
const GRAVITY = 1800, JUMP_V = 620, RUN = 220, ACCEL = 2200, FRICTION = 2400;
const COYOTE = 0.1, JUMP_BUFFER = 0.12;
const DEATH_Y = H + 60;
const MAX_PIT = 112, MAX_STEP = 55, MAX_HAZARD_W = 64; // пределы, при которых любой уровень проходим

// ---------- темы ----------
const THEMES = [];
function registerTheme(t) { THEMES.push(t); THEMES.sort((a, b) => a.index - b.index); }

// параметры генератора по умолчанию; тема может переопределить их в gen
const GEN = {
  length: 3800,                                                   // длина участка до финиша
  weights: { pit: 24, platforms: 20, step: 14, obstacle: 14, flat: 28 }, // частоты видов отрезков
  pitW: [70, 112],                                                // ширина провалов
  groundRange: [225, 305],                                        // высота земли
  upperChance: 0.7,                                               // вероятность второго яруса платформ
  enemyDensity: 1,                                                // множитель плотности врагов
  hazardChance: 0.35,                                             // вероятность статичной опасности на ровном отрезке
  obstacleH: 30, obstacleW: 44,                                   // размер блока препятствия (стопки 1–2 блока)
  decorCount: [0, 2],
  friction: 1,                                                    // <1 — скользко (лёд)
  boss: null,                                                     // { type, arenaW } — вместо финиша арена с боссом
};

// ---------- состояние ----------
let levelIdx = 0, startLevel = 0, practice = false, theme = null, G = GEN;
let seed, solids, platforms, pits, decor, pickups, enemies, projectiles, checkpoints, particles, popups;
let player, camX, levelEnd, finishX, finishY, respawn, arena = null;
let score, lives, kills, time, levelTime, shake, banner = null, clearInfo = null;
let mode = 'menu'; // menu | play | pause | clear | over | win
let overAt = 0, menuLevel = 0;
let board = null, globalBoard = null, session = null, final = null;
const forcedLevel = Math.max(0, (parseInt(PARAMS.get('level'), 10) || 1) - 1); // ?level=N — тренировка с участка N

const input = { left: false, right: false, down: false, jumpHeld: false }; // итоговое состояние: клавиатура + сенсорные кнопки
const kb = { left: false, right: false, down: false, jump: false };
let jumpBuf = 0, attackQueued = false;

const nameForm = document.getElementById('nameForm'), nameInput = document.getElementById('nameInput');
try { nameInput.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}

// детерминированный генератор случайных чисел: уровень целиком задаётся числом seed
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ---------- раскладка: горизонтальный кадр на любом экране ----------
function layout() {
  const vw = innerWidth, vh = innerHeight;
  rotated = IS_TOUCH && vh > vw;
  document.body.classList.toggle('rotated', rotated);
  let sw = rotated ? vh : vw, sh = rotated ? vw : vh; // размеры сцены в её собственной, горизонтальной системе
  if (!IS_TOUCH) { sw = Math.min(vw * 0.96, 1100, vh * 0.78 * 16 / 9); sh = sw * 9 / 16; } // компьютер — окно 16:9
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

// точка на экране → координаты игры (с учётом поворота сцены)
function toGame(e) {
  let x = e.clientX, y = e.clientY;
  if (rotated) { const t = x; x = y; y = innerWidth - t; }
  else { const r = stage.getBoundingClientRect(); x -= r.left; y -= r.top; }
  return { x: (x - canvas.offsetLeft) / cssScale, y: (y - canvas.offsetTop) / cssScale };
}

// ---------- интерфейс для тем ----------
// Один объект на всю игру: темы получают его во все свои функции.
const api = {
  get W() { return W; }, H,
  get camX() { return camX; }, get player() { return player; },
  get time() { return levelTime; },                 // секунд с начала участка
  get now() { return performance.now() / 1000; },   // для анимаций
  get enemies() { return enemies; }, get solids() { return solids; }, get platforms() { return platforms; }, get pits() { return pits; },
  get projectiles() { return projectiles; },
  get levelIndex() { return levelIdx; }, get levels() { return THEMES.length; },
  get progress() { return clamp(player.x / (arena ? arena.x1 : finishX), 0, 1); },
  get arena() { return arena; }, get mode() { return mode; }, get theme() { return theme; },
  rand, clamp, hash, overlap,
  text: (...a) => text(...a), drawStaff: len => drawStaff(len),
  hurtPlayer: fromX => hurtPlayer(fromX),
  burst: (...a) => burst(...a), popup: (...a) => popup(...a), addScore: (...a) => addScore(...a),
  shake(n) { shake = Math.max(shake, n); },
  spawnEnemy: (...a) => spawnEnemy(...a),
  shoot: p => shoot(p),
  damageEnemy: (e, n, source) => damageEnemy(e, n, source, 0),
  groundAt: x => groundAt(x),
  patrol(e, speed, dt) { // ходьба в пределах своего отрезка [minX, maxX] с разворотом у края
    e.x += (e.dir || 1) * speed * dt;
    if (e.x < e.minX) { e.x = e.minX; e.dir = 1; }
    if (e.x + e.w > e.maxX) { e.x = e.maxX - e.w; e.dir = -1; }
  },
  dx(e) { return player.x + player.w / 2 - (e.x + e.w / 2); }, // >0 — игрок справа
  near(e, rx = 240, ry = 120) { return Math.abs(api.dx(e)) < rx && Math.abs(player.y - e.y) < ry; },
  toScreen(x, y) { return { x: x - camX, y }; },
};

// ---------- генерация участка ----------
function generateLevel(s) {
  const R = mulberry32(s);
  const r = (a, b) => a + R() * (b - a), ri = (a, b) => Math.floor(r(a, b + 1)), pick = arr => arr[Math.floor(R() * arr.length)];
  solids = []; platforms = []; pits = []; decor = []; pickups = []; enemies = []; checkpoints = [];
  arena = null;
  const LENGTH = G.length;
  const [gMin, gMax] = [clamp(G.groundRange[0], 200, 310), clamp(G.groundRange[1], 200, 310)];
  const pitMin = clamp(G.pitW[0], 50, MAX_PIT), pitMax = clamp(G.pitW[1], pitMin, MAX_PIT);
  const obH = clamp(G.obstacleH, 20, 32), obW = clamp(G.obstacleW, 30, 60);
  let x = 0, gy = Math.round((gMin + gMax) / 2 + 20), lastCP = 0;
  gy = clamp(gy, gMin, gMax);

  let prevGy = null; // перепад меньше 20 единиц незаметен глазу, но о него спотыкаются — выравниваем
  const ground = (x0, w, y) => {
    if (prevGy !== null && y !== prevGy && Math.abs(y - prevGy) < 20) y = prevGy;
    prevGy = y; gy = y;
    solids.push({ x: x0, y, w, h: H + 200 - y, kind: 'ground' });
  };
  const progress = () => x / LENGTH; // сложность растёт к концу участка
  const decorKinds = theme.decor && theme.decor.length ? theme.decor : null;

  function decorate(x0, w, y) {
    if (!decorKinds) return;
    const n = ri(G.decorCount[0], G.decorCount[1]);
    for (let i = 0; i < n; i++) decor.push({ kind: pick(decorKinds), x: x0 + r(20, w - 20), y, v: R() });
  }
  function blueprints(x0, w, y) {
    const n = ri(0, 3), h = r(40, 95);
    for (let i = 0; i < n; i++) pickups.push({ x: x0 + w / 2 + (i - (n - 1) / 2) * 34, y: Math.max(50, y - h), t: R() * 6 });
  }
  function pickType(wheres) { // случайный тип врага из таблицы темы с учётом весов и прогресса
    const p = progress();
    const opts = (theme.enemyTable || []).filter(o => wheres.includes(o.where) && (o.from || 0) <= p && (o.to == null || o.to >= p) && theme.enemies[o.type]);
    const total = opts.reduce((s, o) => s + (o.weight || 1), 0);
    if (!total) return null;
    let v = R() * total;
    for (const o of opts) { v -= o.weight || 1; if (v <= 0) return o; }
    return opts[opts.length - 1];
  }
  function enemiesOn(x0, w, y, extra = 0) {
    const chance = (0.42 + progress() * 0.35 + levelIdx * 0.02 + extra) * G.enemyDensity;
    if (x0 < 500 || R() > chance) return;
    const o = pickType(['ground', 'air']);
    if (!o) return;
    const air = o.where === 'air';
    const ex = x0 + r(w * 0.4, w * 0.8);
    spawnEnemy(o.type, ex, air ? y - 110 - r(0, 40) : y, { minX: x0 + 6, maxX: x0 + w - 6, air, groundY: y });
  }
  function hazardOn(x0, w, y) { // статичная опасность посередине ровного отрезка — её надо перепрыгнуть
    if (x0 < 600 || w < 260 || R() > G.hazardChance) return false;
    const o = pickType(['hazard']);
    if (!o) return false;
    const e = spawnEnemy(o.type, x0 + w / 2, y, { minX: x0 + w / 2 - 40, maxX: x0 + w / 2 + 40, groundY: y, hazard: true });
    if (e.w > MAX_HAZARD_W) { e.x += (e.w - MAX_HAZARD_W) / 2; e.w = MAX_HAZARD_W; }
    return true;
  }

  ground(0, 460, gy); decorate(200, 240, gy); x = 460;
  checkpoints.push({ x: 90, y: gy, on: true, start: true });

  const wts = G.weights, wsum = Object.values(wts).reduce((a, b) => a + b, 0);
  while (x < LENGTH) {
    let t = R() * wsum;
    const kind = ['pit', 'platforms', 'step', 'obstacle', 'flat'].find(k => (t -= wts[k] || 0) < 0) || 'flat';
    if (kind === 'pit') {
      const w = ri(pitMin, pitMax);
      pits.push({ x, w, y: gy, v: R() });
      x += w;
      gy = clamp(gy + ri(-1, 1) * 28, Math.max(gMin, 235), gMax);
      const len = ri(180, 330);
      ground(x, len, gy); decorate(x, len, gy); blueprints(x, len, gy); enemiesOn(x, len, gy);
      x += len;
    } else if (kind === 'platforms') { // два яруса проходимых снизу платформ
      const len = ri(320, 470);
      ground(x, len, gy);
      const px = x + 50, pw = len - 100;
      platforms.push({ x: px, y: gy - 72, w: pw, h: 10, base: gy, tier: 1, v: R() });
      if (R() < G.upperChance) {
        const p2 = { x: px + pw * 0.25, y: gy - 138, w: pw * 0.55, h: 10, base: gy - 72, tier: 2, v: R() };
        platforms.push(p2);
        blueprints(p2.x, p2.w, p2.y);
        const o = x > 700 && R() < 0.55 + progress() * 0.3 ? pickType(['upper']) : null;
        if (o) spawnEnemy(o.type, p2.x + p2.w * 0.6, p2.y, { minX: p2.x, maxX: p2.x + p2.w, groundY: p2.y, upper: true });
      } else blueprints(px, pw, gy - 72);
      enemiesOn(x, len, gy, -0.1);
      x += len;
    } else if (kind === 'step') { // перепад высот
      gy = clamp(gy + (R() < 0.5 ? -1 : 1) * ri(30, MAX_STEP), gMin, gMax);
      const len = ri(200, 320);
      ground(x, len, gy); decorate(x, len, gy); blueprints(x, len, gy); enemiesOn(x, len, gy);
      x += len;
    } else if (kind === 'obstacle') { // препятствия: 1–2 стопки блоков, после них не меньше ~150 px разбега
      const len = ri(330, 440);
      ground(x, len, gy);
      const stacks = ri(1, 2), bx = x + len * 0.3;
      for (let i = 0; i < stacks; i++) solids.push({ x: bx + i * obW, y: gy - obH * (i + 1), w: obW, h: obH * (i + 1), kind: 'obstacle', stack: i + 1, v: R() });
      pickups.push({ x: bx + stacks * obW / 2, y: gy - obH * stacks - 50, t: 0 });
      const after = bx + stacks * obW + 10;
      decorate(x, len * 0.3, gy); if (x + len - after > 80) enemiesOn(after, x + len - after, gy, 0.1);
      x += len;
    } else { // ровный отрезок
      const len = ri(260, 420);
      ground(x, len, gy); decorate(x, len, gy); blueprints(x, len, gy);
      if (!hazardOn(x, len, gy)) enemiesOn(x, len, gy, 0.15);
      x += len;
    }
    if (x - lastCP > 1500 && x < LENGTH - 400) { // чекпоинт — нивелир на штативе
      checkpoints.push({ x: x - 60, y: gy, on: false });
      lastCP = x;
    }
  }
  if (G.boss) { // финальная арена: ровная площадка, закрывается, пока босс жив
    const aw = Math.max(860, G.boss.arenaW || 860);
    ground(x, 200, gy); x += 200;
    checkpoints.push({ x: x - 100, y: gy, on: false });
    ground(x, aw, gy);
    arena = { x1: x, x2: x + aw, y: gy, active: false, doneT: 0 };
    const b = spawnEnemy(G.boss.type, x + aw - 180, gy, { minX: x + 20, maxX: x + aw - 20, groundY: gy, isBoss: true });
    arena.boss = b;
    finishX = Infinity; finishY = gy;
    levelEnd = x + aw;
    return;
  }
  // финиш: ровная площадка, флаг и постройка темы
  ground(x, 900, gy);
  finishX = x + 240; finishY = gy;
  levelEnd = x + 700;
}

function spawnEnemy(type, x, groundY, props = {}) {
  const def = theme.enemies[type];
  if (!def) throw new Error('Неизвестный враг ' + type);
  const e = {
    type, def, x: x - def.w / 2, y: groundY - def.h, w: def.w, h: def.h, hp: def.hp || 1, maxHp: def.hp || 1,
    dir: Math.random() < 0.5 ? -1 : 1, t: rand(0, 6), hit: 0, cd: rand(1, 2), minX: -1e9, maxX: 1e9, groundY,
  };
  Object.assign(e, props);
  if (def.init) def.init(e, api);
  enemies.push(e);
  return e;
}

// снаряд: { x, y, w, h, vx, vy, gravity=900, life=6, draw(p, ctx, api), color, spin,
//          reflectable (рейка отбивает во врага), destructible=true (рейка разбивает), hitsSolids=true, pts=10, source }
function shoot(p) {
  const q = Object.assign({ w: 10, h: 10, vx: 0, vy: 0, gravity: 900, life: 6, rot: 0, spin: 0, color: '#c9b89e', reflectable: false, destructible: true, hitsSolids: true, hurts: true, pts: 10 }, p);
  q.x -= q.w / 2; q.y -= q.h / 2; // x, y передаются как центр
  projectiles.push(q);
  return q;
}

function groundAt(x) { // верх самой высокой твёрдой поверхности в точке x (или null — провал)
  let top = null;
  for (const s of solids) if (x >= s.x && x <= s.x + s.w && (top === null || s.y < top)) top = s.y;
  return top;
}

// ---------- кампания ----------
function loadLevel(i) {
  levelIdx = i; theme = THEMES[i];
  G = Object.assign({}, GEN, theme.gen || {});
  G.weights = Object.assign({}, GEN.weights, (theme.gen || {}).weights || {});
  seed = (Math.random() * 2 ** 32) >>> 0;
  projectiles = []; particles = []; popups = [];
  generateLevel(seed);
  player = { x: 80, y: checkpoints[0].y - 40, w: 18, h: 40, vx: 0, vy: 0, face: 1, onGround: false, coyote: 0, inv: 0, attackT: 0, attackCd: 0, hitSet: null, anim: 0, drop: 0 };
  respawn = { x: 80, y: checkpoints[0].y - 60 };
  camX = 0; levelTime = 0; lives = 3; shake = 0;
  banner = { top: `Участок ${i + 1} из ${THEMES.length}`, title: theme.title, sub: theme.subtitle || '', t: 3.2 };
  if (theme.init) theme.init(api);
}

function reset(start = menuLevel) { // новая смена (прохождение); с 1-го участка — в рейтинг, с других — тренировка
  score = 0; kills = 0; time = 0;
  startLevel = clamp(start, 0, THEMES.length - 1);
  practice = startLevel > 0;
  board = null; globalBoard = null; final = null; clearInfo = null;
  nameForm.hidden = true;
  loadLevel(startLevel);
}

function levelComplete() {
  const timeBonus = Math.max(0, Math.round(1500 - levelTime * 12)), lifeBonus = lives * 200, finishBonus = 500 + (G.boss ? 5000 : 0);
  score += timeBonus + lifeBonus + finishBonus;
  clearInfo = { timeBonus, lifeBonus, finishBonus, level: levelIdx, time: levelTime };
  if (levelIdx + 2 > unlocked) { unlocked = Math.min(THEMES.length, levelIdx + 2); try { localStorage.setItem(UNLOCK_KEY, unlocked); } catch (e) {} }
  burst(player.x, player.y, '#ffd76a', 40, 260);
  if (levelIdx >= THEMES.length - 1) endGame(true);
  else { mode = 'clear'; overAt = performance.now(); }
}

function nextLevel() { loadLevel(levelIdx + 1); mode = 'play'; }

function endGame(won) {
  mode = won ? 'win' : 'over'; overAt = performance.now();
  final = { score: Math.floor(score), duration: time, level: levelIdx + 1 };
  if (final.score > best && !practice) { best = final.score; try { localStorage.setItem(STORAGE_KEY, best); } catch (e) {} }
  if (practice) return;
  if (TICKET) { submitScore(); submitGlobal(); } else { loadGlobal(); nameForm.hidden = false; }
}

// ---------- эффекты ----------
function burst(x, y, color, n = 10, speed = 180, grav = 600) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(40, speed);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: rand(0.3, 0.7), max: 0.7, color, grav, size: rand(2, 4) });
  }
  if (particles.length > 600) particles.splice(0, particles.length - 600);
}
function popup(x, y, text, color = '#ffd76a') { popups.push({ x, y, text, color, life: 1 }); }
function addScore(n, x, y) { score += n; if (x != null) popup(x, y, '+' + n); }

// ---------- столкновения игрока ----------
function moveX(o, dx) {
  o.x += dx;
  for (const s of solids) {
    if (s.x > o.x + 60 || s.x + s.w < o.x - 60) continue;
    if (overlap(o, s)) { o.x = dx > 0 ? s.x - o.w : s.x + s.w; o.vx = 0; }
  }
}
function moveY(o, dy) {
  const prevBottom = o.y + o.h;
  o.y += dy; o.onGround = false;
  for (const s of solids) {
    if (s.x > o.x + 60 || s.x + s.w < o.x - 60) continue;
    if (overlap(o, s)) {
      if (dy > 0) { o.y = s.y - o.h; o.onGround = true; } else o.y = s.y + s.h;
      o.vy = 0;
    }
  }
  // платформы проходимы снизу; сквозь них можно спрыгнуть (↓ + прыжок)
  if (dy > 0 && o.drop <= 0) {
    for (const p of platforms) {
      if (o.x + o.w > p.x && o.x < p.x + p.w && prevBottom <= p.y + 1 && o.y + o.h >= p.y) { o.y = p.y - o.h; o.vy = 0; o.onGround = true; }
    }
  }
}

function hurtPlayer(fromX) {
  if (player.inv > 0 || mode !== 'play') return;
  lives--; player.inv = 1.4; shake = 8;
  player.vx = (player.x + player.w / 2 < fromX ? -1 : 1) * 260; player.vy = -380;
  burst(player.x + player.w / 2, player.y + 20, '#ff5d5d', 16);
  if (lives <= 0) endGame(false);
}

// ---------- игровой цикл ----------
function update(dt) {
  for (const p of particles) { p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  for (const p of popups) { p.y -= 40 * dt; p.life -= dt; }
  popups = popups.filter(p => p.life > 0);
  shake = Math.max(0, shake - dt * 25);
  if (mode !== 'play') return;
  time += dt; levelTime += dt;
  if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
  const P = player;

  // бег
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir) { P.vx = clamp(P.vx + dir * ACCEL * dt, -RUN, RUN); P.face = dir; }
  else { const f = FRICTION * clamp(G.friction, 0.2, 1) * dt; P.vx = Math.abs(P.vx) <= f ? 0 : P.vx - Math.sign(P.vx) * f; }

  // прыжок с «временем койота» и буфером нажатия — управление прощает мелкие промахи
  P.coyote = P.onGround ? COYOTE : P.coyote - dt;
  jumpBuf -= dt; P.drop -= dt;
  if (jumpBuf > 0 && P.coyote > 0) {
    if (input.down && P.onGround && platforms.some(p => Math.abs(P.y + P.h - p.y) < 2 && P.x + P.w > p.x && P.x < p.x + p.w)) { P.drop = 0.25; P.y += 2; }
    else { P.vy = -JUMP_V; burst(P.x + P.w / 2, P.y + P.h, theme.dust || '#b9a58a', 6, 80, 300); }
    jumpBuf = 0; P.coyote = 0;
  }
  if (!input.jumpHeld && P.vy < -250) P.vy = -250; // короткое нажатие — низкий прыжок
  P.vy = Math.min(P.vy + GRAVITY * dt, 900);
  const wasAir = !P.onGround;
  moveX(P, P.vx * dt);
  moveY(P, P.vy * dt);
  if (P.onGround && wasAir && P.vy === 0) burst(P.x + P.w / 2, P.y + P.h, theme.dust || '#b9a58a', 5, 70, 300);
  if (arena && arena.active) P.x = clamp(P.x, arena.x1, arena.x2 - P.w);
  P.x = clamp(P.x, 0, levelEnd);
  P.anim += Math.abs(P.vx) * dt * 0.05;
  P.inv = Math.max(0, P.inv - dt);

  if (theme.update) theme.update(dt, api);
  if (mode !== 'play') return; // тема могла закончить игру (урон)

  // удар рейкой: широкая дуга перед геодезистом
  P.attackCd -= dt;
  if (attackQueued && P.attackCd <= 0) { P.attackT = 0.26; P.attackCd = 0.36; P.hitSet = new Set(); }
  attackQueued = false;
  if (P.attackT > 0) {
    P.attackT -= dt;
    const phase = 1 - P.attackT / 0.26;
    if (phase > 0.15 && phase < 0.75) {
      const hb = { x: P.face > 0 ? P.x + P.w / 2 : P.x + P.w / 2 - 78, y: P.y - 22, w: 78, h: P.h + 20 };
      for (const e of enemies) {
        if (e.dead || P.hitSet.has(e) || e.def.invulnerable) continue;
        if (overlap(hb, e.def.hurtbox ? e.def.hurtbox(e, api) : e)) { P.hitSet.add(e); damageEnemy(e, 1, 'staff', P.face * 220); }
      }
      for (const p of projectiles) {
        if (p.dead || p.reflected || !overlap(hb, p)) continue;
        if (p.reflectable) reflect(p);
        else if (p.destructible) { p.dead = true; addScore(p.pts, p.x, p.y); burst(p.x + p.w / 2, p.y + p.h / 2, p.color, 8); }
      }
    }
  }

  // падение в провал
  if (P.y > DEATH_Y) {
    lives--; shake = 6;
    if (lives <= 0) { endGame(false); return; }
    const rp = arena && arena.active ? { x: arena.x1 + 60, y: arena.y - 60 } : respawn;
    Object.assign(P, { x: rp.x, y: rp.y, vx: 0, vy: 0, inv: 1.5 });
  }

  updateEnemies(dt);
  if (mode !== 'play') return;
  updateProjectiles(dt);
  if (mode !== 'play') return;

  // подбор чертежей
  for (const k of pickups) {
    k.t += dt;
    if (!k.got && Math.abs(k.x - (P.x + P.w / 2)) < 20 && Math.abs(k.y - (P.y + P.h / 2)) < 30) { k.got = true; addScore(50, k.x, k.y - 10); burst(k.x, k.y, '#7ec8ff', 10, 140, 200); }
  }
  pickups = pickups.filter(k => !k.got);

  // чекпоинты
  for (const c of checkpoints) {
    if (!c.on && P.x + P.w > c.x - 10 && P.x < c.x + 20) { c.on = true; respawn = { x: c.x, y: c.y - 60 }; addScore(100, c.x, c.y - 90); burst(c.x, c.y - 70, '#6cff8a', 16); }
  }

  // арена босса: закрывается, когда игрок вошёл; открывается победой
  if (arena) {
    if (!arena.active && P.x > arena.x1 + 30) {
      arena.active = true;
      const bd = arena.boss.def;
      banner = { top: 'БОСС', title: bd.bossName || 'Босс', sub: bd.bossSub || '', t: 3 };
    }
    if (arena.boss.dead) { arena.doneT += dt; if (arena.doneT > 1.8) { levelComplete(); return; } }
  } else if (P.x > finishX) { levelComplete(); return; }

  // камера с небольшим «заглядыванием» вперёд
  let lo = 0, hi = levelEnd - W;
  if (arena && arena.active) { lo = arena.x1 - Math.max(0, (W - (arena.x2 - arena.x1)) / 2); hi = Math.max(lo, arena.x2 - W); }
  const target = clamp(P.x - W * 0.35 + P.face * 40, lo, hi);
  camX += (target - camX) * Math.min(1, dt * 6);
}

function damageEnemy(e, n, source, knock) {
  const def = e.def;
  if (e.dead || def.invulnerable) return;
  if (def.onHit && def.onHit(e, api, source) === false) return; // тема может отказать в уроне (броня, неуязвимая фаза)
  e.hp -= n; e.hit = 0.12;
  burst(e.x + e.w / 2, e.y + e.h / 2, def.hitColor || '#e8d3b0', 8, 160);
  if (knock && def.knockback !== false && !e.isBoss) e.x = clamp(e.x + Math.sign(knock) * (def.heavy ? 10 : 20), Math.min(e.minX, e.x), Math.max(e.maxX - e.w, e.x));
  if (e.hp <= 0) {
    e.dead = true; kills++;
    addScore(def.pts || 100, e.x + e.w / 2, e.y);
    burst(e.x + e.w / 2, e.y + e.h / 2, def.deathColor || '#ffffff', e.isBoss ? 60 : 14, e.isBoss ? 320 : 220);
    shake = Math.max(shake, e.isBoss ? 14 : def.heavy ? 7 : 3);
    if (def.onDeath) def.onDeath(e, api);
  }
}

function updateEnemies(dt) {
  const P = player, lo = camX - 400, hi = camX + W + 400;
  for (const e of enemies) {
    if (e.dead) continue;
    if (!e.awake) { if (e.x + e.w < lo || e.x > hi) continue; e.awake = true; } // враги оживают, когда попадают в кадр
    e.t += dt; e.hit = Math.max(0, e.hit - dt);
    if (e.def.update) e.def.update(e, dt, api);
    if (e.dead) continue;
    // контакт с игроком: прыжок сверху — удар по врагу, иначе урон игроку
    if (e.def.contact === false) continue;
    const body = e.def.bodybox ? e.def.bodybox(e, api) : e;
    if (!overlap(P, body)) continue;
    if (e.def.stompable !== false && !e.def.invulnerable && P.vy > 50 && P.y + P.h - body.y < 16) { damageEnemy(e, 1, 'stomp', 0); P.vy = -430; }
    else hurtPlayer(body.x + body.w / 2);
    if (mode !== 'play') return;
  }
  enemies = enemies.filter(e => !e.dead);
}

function reflect(p) { // отбитый рейкой снаряд летит прямо во врага, который его бросил (или вперёд)
  const P = player;
  p.reflected = true; p.gravity = 0; p.life = 3;
  const src = p.source && !p.source.dead ? p.source : null;
  const sp = 480;
  if (src) {
    const hb = src.def.hurtbox ? src.def.hurtbox(src, api) : src;
    const dx = hb.x + hb.w / 2 - (p.x + p.w / 2), dy = hb.y + hb.h / 2 - (p.y + p.h / 2), d = Math.hypot(dx, dy) || 1;
    p.vx = dx / d * sp; p.vy = dy / d * sp;
  } else { p.vx = P.face * sp; p.vy = -60; }
  addScore(10, p.x, p.y);
  burst(p.x + p.w / 2, p.y + p.h / 2, '#ffffff', 8, 160);
}

function updateProjectiles(dt) {
  const P = player;
  for (const p of projectiles) {
    if (p.dead) continue;
    p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt; p.life -= dt;
    if (p.update) p.update(p, dt, api);
    if (p.reflected) {
      for (const e of enemies) {
        if (e.dead || e.def.invulnerable) continue;
        if (overlap(p, e.def.hurtbox ? e.def.hurtbox(e, api) : e)) { p.dead = true; damageEnemy(e, p.reflectDamage || 1, 'projectile', 0); break; }
      }
    } else if (p.hurts && overlap(P, p)) { p.dead = true; hurtPlayer(p.x + p.w / 2); if (mode !== 'play') return; }
    if (!p.dead && p.hitsSolids) {
      for (const s of solids) {
        if (s.x > p.x + 40 || s.x + s.w < p.x - 40) continue;
        if (overlap(p, s)) { p.dead = true; if (p.onLand) p.onLand(p, api); else burst(p.x + p.w / 2, p.y + p.h / 2, p.color, 6, 120); break; }
      }
    }
    if (p.life <= 0 || p.y > H + 60 || p.x < camX - 600 || p.x > camX + W + 600) p.dead = true;
  }
  projectiles = projectiles.filter(p => !p.dead);
}

// ---------- отрисовка: общие элементы (одинаковы во всех темах) ----------
function text(str, x, y, size, color = '#fff', align = 'center') {
  ctx.fillStyle = color; ctx.font = `bold ${size}px system-ui, sans-serif`; ctx.textAlign = align; ctx.fillText(str, x, y);
}

function drawCheckpoint(c) { // нивелир на штативе — инструмент героя, общий для всех участков
  const x = c.x, y = c.y;
  ctx.strokeStyle = '#d9c24a'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x, y - 46); ctx.lineTo(x - 14, y); ctx.moveTo(x, y - 46); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 46); ctx.lineTo(x + 2, y); ctx.stroke();
  ctx.fillStyle = '#6b6b6b'; ctx.fillRect(x - 8, y - 50, 16, 4);
  ctx.fillStyle = c.on ? '#3cb371' : '#f2c230'; ctx.fillRect(x - 11, y - 62, 22, 12); // корпус нивелира
  ctx.fillStyle = '#333'; ctx.fillRect(x - 15, y - 60, 6, 7); ctx.fillStyle = '#9fd3ff'; ctx.fillRect(x + 11, y - 59, 4, 5); // окуляр и объектив
  if (c.on && !c.start) text('✓', x, y - 70, 14, '#6cff8a');
}

function drawFinishFlag() {
  const x = finishX, gy = finishY;
  ctx.fillStyle = '#ddd'; ctx.fillRect(x, gy - 110, 4, 110);
  const wave = Math.sin(performance.now() / 200) * 4;
  ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.moveTo(x + 4, gy - 110); ctx.quadraticCurveTo(x + 24, gy - 104 + wave, x + 44, gy - 106); ctx.lineTo(x + 44, gy - 84); ctx.quadraticCurveTo(x + 24, gy - 82 + wave, x + 4, gy - 88); ctx.fill();
  for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; ctx.fillRect(x - 14 + i * 4, gy + j * 4, 4, 4); } // финишная клетка
}

function drawBlueprint(k) { // рулон чертежей
  const y = k.y + Math.sin(k.t * 3) * 3;
  ctx.save(); ctx.translate(k.x, y); ctx.rotate(-0.4);
  ctx.fillStyle = 'rgba(126,200,255,.25)'; ctx.fillRect(-14, -7, 28, 14);
  ctx.fillStyle = '#2f6fd0'; ctx.fillRect(-11, -4, 22, 8);
  ctx.fillStyle = '#cfe6ff'; ctx.fillRect(-9, -1, 18, 1); ctx.fillRect(-9, 2, 12, 1);
  ctx.fillStyle = '#1d4f9a'; ctx.beginPath(); ctx.ellipse(11, 0, 2, 4, 0, 0, 7); ctx.fill();
  ctx.restore();
}

function drawStaff(len) { // нивелирная рейка: белая, шашечная Е-шкала красная/чёрная
  ctx.fillStyle = '#f5f4ee'; ctx.fillRect(-10, -3, len, 6);
  for (let i = 0; i < len - 10; i += 4) {
    if ((i / 4) % 2) continue;
    ctx.fillStyle = Math.floor(i / 20) % 2 ? '#c62828' : '#151515';
    ctx.fillRect(-8 + i, -3, 4, 3);
  }
  ctx.fillStyle = '#8b8b8b'; ctx.fillRect(-12, -3, 3, 6); ctx.fillRect(len - 12, -3, 2, 6);
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.strokeRect(-10, -3, len, 6);
}

function drawPlayer() {
  const P = player;
  if (P.inv > 0 && Math.floor(P.inv * 14) % 2) return;
  const cx = P.x + P.w / 2, feet = P.y + P.h;
  ctx.save(); ctx.translate(cx, feet); ctx.scale(P.face, 1);
  const running = P.onGround && Math.abs(P.vx) > 20, sw = running ? Math.sin(P.anim * 2) * 0.7 : (P.onGround ? 0 : 0.5);
  // ноги
  ctx.strokeStyle = '#2b3445'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (const s of [sw, -sw]) { ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(Math.sin(s) * 12, -2); ctx.stroke(); }
  ctx.fillStyle = '#4a3320'; for (const s of [sw, -sw]) ctx.fillRect(Math.sin(s) * 12 - 3, -4, 9, 4);
  // корпус: тёмная куртка и сигнальный жилет со световозвращающими полосами
  ctx.fillStyle = '#2f4a7a'; ctx.fillRect(-7, -36, 14, 20);
  ctx.fillStyle = '#ff7a1a'; ctx.fillRect(-7, -35, 14, 17);
  ctx.fillStyle = '#e9f2f2'; ctx.fillRect(-7, -28, 14, 2); ctx.fillRect(-7, -23, 14, 2); ctx.fillRect(-3, -35, 2, 7);
  // голова и белая каска инженера
  ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(1, -42, 6, 0, 7); ctx.fill();
  ctx.fillStyle = '#222'; ctx.fillRect(3, -44, 2, 2);
  ctx.fillStyle = '#f7f7f7'; ctx.beginPath(); ctx.arc(1, -45, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -46, 16, 2);
  if (theme.headlamp) { ctx.fillStyle = '#fff6b0'; ctx.fillRect(6, -48, 3, 3); } // налобный фонарь (шахта)
  // рейка: в покое — на плече, при ударе — дуга вперёд
  let ang = -1.9 + (running ? Math.sin(P.anim * 2) * 0.05 : 0);
  if (P.attackT > 0) {
    const ph = 1 - P.attackT / 0.26, e = ph < 0.6 ? ph / 0.6 : 1;
    ang = -2.4 + (2.4 + 0.35) * (1 - Math.pow(1 - e, 3));
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(4, -26, 62, -2.2, ang); ctx.stroke();
  }
  ctx.save(); ctx.translate(4, -26); ctx.rotate(ang); drawStaff(76); ctx.restore();
  // рука, держащая рейку
  ctx.strokeStyle = '#2f4a7a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(4, -26); ctx.stroke();
  ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(4, -26, 2.5, 0, 7); ctx.fill();
  ctx.restore();
}

function drawEnemy(e) {
  if (e.hit > 0 && Math.floor(e.hit * 50) % 2) return; // мигание при попадании
  ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h); // начало координат — середина низа врага
  if (e.def.flip !== false) ctx.scale(e.dir || 1, 1);    // по умолчанию враг смотрит по направлению dir (рисуйте «вправо»)
  e.def.draw(e, ctx, api);
  ctx.restore();
}

function drawProjectile(p) {
  ctx.save(); ctx.translate(p.x + p.w / 2, p.y + p.h / 2); ctx.rotate(p.rot);
  if (p.draw) p.draw(p, ctx, api);
  else { ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
  if (p.reflected) { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2; ctx.strokeRect(-p.w / 2 - 2, -p.h / 2 - 2, p.w + 4, p.h + 4); }
  ctx.restore();
}

// ---------- интерфейс ----------
function drawHUD() {
  ctx.fillStyle = 'rgba(20,14,10,.55)'; ctx.fillRect(0, 0, W, 30);
  text('Очки: ' + Math.floor(score), 12, 20, 15, '#fff', 'left');
  for (let i = 0; i < 3; i++) { // жизни — каски
    ctx.fillStyle = i < lives ? '#f7f7f7' : 'rgba(255,255,255,.2)';
    ctx.beginPath(); ctx.arc(128 + i * 22, 20, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(120 + i * 22, 19, 16, 2);
  }
  const right = IS_TOUCH ? W - 46 : W - 12; // на телефоне справа кнопка паузы
  text(`Уч. ${levelIdx + 1}/${THEMES.length}`, 186, 20, 12, theme.accent || '#ffb02e', 'left');
  // прогресс до финиша (или до арены босса)
  const px = 250, pw = clamp(right - 60 - px, 100, 300), goal = arena ? arena.x1 : finishX, prog = clamp(player.x / goal, 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(px, 13, pw, 4);
  ctx.fillStyle = theme.accent || '#ffb02e'; ctx.fillRect(px, 13, pw * prog, 4);
  for (const c of checkpoints) if (!c.start && c.x < goal) { ctx.fillStyle = c.on ? '#6cff8a' : '#aaa'; ctx.fillRect(px + pw * c.x / goal - 1, 9, 2, 12); }
  ctx.fillStyle = arena ? '#b3261e' : '#e53935'; ctx.fillRect(px + pw - 2, 6, 6, 6);
  ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(px + pw * prog, 15, 5, 0, 7); ctx.fill();
  text(`${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`, right, 20, 14, '#f1e6d6', 'right');
  if (practice) text('тренировка', right - 44, 20, 10, '#c9b89e', 'right');
  // полоса здоровья босса
  if (arena && arena.active && !arena.boss.dead) {
    const b = arena.boss, bw = Math.min(360, W - 120), bx = (W - bw) / 2;
    text(b.def.bossName || 'Босс', W / 2, 46, 12, '#ffd0c0');
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(bx - 2, 51, bw + 4, 10);
    ctx.fillStyle = '#e53935'; ctx.fillRect(bx, 53, bw * clamp(b.hp / b.maxHp, 0, 1), 6);
  }
}

function drawBanner() {
  if (!banner || mode !== 'play') return;
  const a = Math.min(1, banner.t / 0.6, (3.2 - banner.t) / 0.3 + 0.2);
  ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
  ctx.fillStyle = 'rgba(15,10,8,.55)'; ctx.fillRect(0, 70, W, 78);
  text(banner.top, W / 2, 90, 12, '#c9b89e');
  text(banner.title, W / 2, 118, 24, theme.accent || '#ffb02e');
  if (banner.sub) text(banner.sub, W / 2, 138, 12, '#f1e6d6');
  ctx.restore();
}

function drawTable(b, title, x1, x2, y, maxRows = 7) {
  const cx = (x1 + x2) / 2, maxName = x2 - x1 < 260 ? 12 : 18;
  text(title, cx, y, 14, '#ffb02e');
  if (!b) return;
  if (b.state !== 'ok') { text(b.state === 'loading' ? 'Загрузка…' : 'Нет связи с сервером', cx, y + 22, 12, '#c9b89e'); return; }
  if (!b.rows.length) { text('Пока пусто — будьте первым!', cx, y + 22, 12, '#c9b89e'); return; }
  const rows = b.rows.slice().sort((a, c) => a.pos - c.pos).slice(0, maxRows);
  const me = b.rows.find(r => r.me);
  if (me && !rows.includes(me)) rows[rows.length - 1] = me;
  for (const r of rows) {
    y += 19;
    const color = r.me ? '#ffd76a' : '#f1e6d6';
    const name = r.name.length > maxName ? r.name.slice(0, maxName - 1) + '…' : r.name;
    text(`${r.pos}. ${name}`, x1, y, 12, color, 'left');
    text(String(r.score), x2, y, 12, color, 'right');
  }
  let note = '';
  if (b.sent) note = b.rank ? `Ваше место: ${b.rank}${b.improved ? ' · рекорд!' : ''}` : 'Вы пока вне топ-100';
  else if (b.newRecord) note = 'Новый рекорд чата!';
  if (note) text(note, cx, y + 20, 11, '#c9b89e');
}

function drawEnd() {
  ctx.fillStyle = 'rgba(15,10,8,.86)'; ctx.fillRect(0, 0, W, H);
  const won = mode === 'win';
  text(won ? 'ОБЪЕКТ СДАН!' : 'СМЕНА ОКОНЧЕНА', W / 2, 50, 30, won ? '#6cff8a' : '#ffb02e');
  text(won ? 'Акт приёмки подписан. Все 10 участков пройдены!' : `Дошли до участка ${final.level}: ${THEMES[final.level - 1].title}`, W / 2, 74, 13, '#f1e6d6');
  text(`Очки: ${final.score}   Рекорд: ${best}   Врагов: ${kills}   Время: ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`, W / 2, 96, 13, '#f1e6d6');
  text((IS_TOUCH ? 'Тап' : 'Пробел или тап') + ' — в меню (новая смена)', W / 2, 116, 12, '#c9b89e');
  const y = 146, ox = (W - 640) / 2;
  if (practice) { text('Тренировка не с первого участка — результат не идёт в рейтинг', W / 2, y + 10, 12, '#c9b89e'); return; }
  if (TICKET) { drawTable(globalBoard, 'Мировой рейтинг', ox + 40, ox + 300, y); drawTable(board, 'Рекорды чата', ox + 340, ox + 600, y); }
  else {
    drawTable(globalBoard, 'Мировой рейтинг', ox + 190, ox + 450, y, 5); // внизу остаётся место для поля имени
    if (!nameForm.hidden) text('Введите имя, чтобы попасть в рейтинг', W / 2, y + 128, 12, '#c9b89e');
  }
}

function drawClear() {
  ctx.fillStyle = 'rgba(15,10,8,.8)'; ctx.fillRect(0, 0, W, H);
  const c = clearInfo, next = THEMES[levelIdx + 1];
  text('УЧАСТОК СДАН!', W / 2, 78, 30, '#6cff8a');
  text(`${levelIdx + 1}. ${theme.title} — ${Math.floor(c.time)} с`, W / 2, 104, 14, '#f1e6d6');
  text(`Финиш +${c.finishBonus} · время +${c.timeBonus} · каски +${c.lifeBonus}`, W / 2, 128, 13, '#c9b89e');
  text(`Очки: ${Math.floor(score)}`, W / 2, 152, 16, '#ffd76a');
  text('Далее', W / 2, 190, 12, '#c9b89e');
  text(`Участок ${levelIdx + 2}: ${next.title}`, W / 2, 214, 20, next.accent || '#ffb02e');
  if (next.subtitle) text(next.subtitle, W / 2, 236, 12, '#f1e6d6');
  text(IS_TOUCH ? 'Тап — дальше' : 'Пробел или тап — дальше', W / 2, 272, 13, '#c9b89e');
}

function menuArrows() { return { left: { x: W / 2 - 190, y: 262, r: 16 }, right: { x: W / 2 + 190, y: 262, r: 16 } }; }

function drawMenu() {
  ctx.fillStyle = 'rgba(15,10,8,.72)'; ctx.fillRect(0, 0, W, H);
  text('LEVEL RUNNER', W / 2, 92, 38, '#ffb02e');
  text('Геодезист сдаёт объект: 10 участков от городской стройки до плотины ГЭС.', W / 2, 128, 13, '#f1e6d6');
  text('Отбивайся нивелирной рейкой, собирай чертежи, в конце — главный инспектор.', W / 2, 148, 13, '#f1e6d6');
  text(IS_TOUCH ? 'Слева — бег и ▼ (спрыгнуть), справа — прыжок и рейка' : '← → бег · пробел прыжок · J удар рейкой · P пауза', W / 2, 176, 12, '#c9b89e');
  const maxSel = Math.max(unlocked, forcedLevel + 1);
  if (maxSel > 1) { // выбор стартового участка
    const t = THEMES[menuLevel], a = menuArrows();
    text(`Старт: участок ${menuLevel + 1} — ${t.title}`, W / 2, 267, 15, t.accent || '#ffb02e');
    text(menuLevel === 0 ? 'С первого участка — результат идёт в рейтинг' : 'Тренировка — результат не идёт в рейтинг', W / 2, 288, 11, '#c9b89e');
    for (const k of ['left', 'right']) {
      const b = a[k]; ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
      text(k === 'left' ? '◀' : '▶', b.x, b.y + 5, 14, '#f1e6d6');
    }
  }
  text(IS_TOUCH ? 'Тап — начать смену' : 'Пробел или тап — начать смену', W / 2, 226, 14, '#ffd76a');
}

function overlay(title, lines, hint) {
  ctx.fillStyle = 'rgba(15,10,8,.72)'; ctx.fillRect(0, 0, W, H);
  text(title, W / 2, 110, 38, '#ffb02e');
  lines.forEach((l, i) => text(l, W / 2, 150 + i * 22, 14, '#f1e6d6'));
  text(hint, W / 2, 170 + lines.length * 22, 13, '#c9b89e');
}

function draw() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0); // рисуем в игровых единицах, холст — в пикселях экрана
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  ctx.save(); theme.drawBackground(ctx, api); ctx.restore();
  ctx.save(); ctx.translate(-Math.round(camX), 0);
  const vis = o => o.x + (o.w || 160) > camX - 80 && o.x < camX + W + 80;
  const T = theme;
  for (const p of pits) if (vis(p)) { ctx.save(); T.drawPit(p, ctx, api); ctx.restore(); }
  for (const p of platforms) if (vis(p)) { ctx.save(); T.drawPlatform(p, ctx, api); ctx.restore(); }
  for (const d of decor) if (vis(d)) { ctx.save(); T.drawDecor(d, ctx, api); ctx.restore(); }
  for (const s of solids) if (vis(s)) { ctx.save(); (s.kind === 'obstacle' ? T.drawObstacle : T.drawGround)(s, ctx, api); ctx.restore(); }
  for (const c of checkpoints) if (vis(c)) drawCheckpoint(c);
  if (finishX !== Infinity && finishX > camX - 300 && finishX < camX + W + 300) { ctx.save(); if (T.drawFinish) T.drawFinish(finishX, finishY, ctx, api); ctx.restore(); drawFinishFlag(); }
  for (const k of pickups) if (vis(k)) drawBlueprint(k);
  for (const e of enemies) if (vis(e)) drawEnemy(e);
  for (const p of projectiles) drawProjectile(p);
  if (mode !== 'over') drawPlayer();
  for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }
  ctx.globalAlpha = 1;
  if (T.drawForeground) { ctx.save(); T.drawForeground(ctx, api); ctx.restore(); } // слой перед игроком (в координатах мира)
  for (const p of popups) { ctx.globalAlpha = Math.min(1, p.life / 0.4); text(p.text, p.x, p.y, 13, p.color); }
  ctx.globalAlpha = 1;
  ctx.restore();
  if (T.drawOverlay) { ctx.save(); T.drawOverlay(ctx, api); ctx.restore(); } // слой поверх мира в экранных координатах (темнота, метель)
  ctx.restore();
  drawHUD();
  drawBanner();
  if (IS_TOUCH && mode === 'play') drawControls();
  if (mode === 'menu') drawMenu();
  if (mode === 'pause') overlay('ПАУЗА', [`Участок ${levelIdx + 1}: ${theme.title}`], IS_TOUCH ? 'Тап — продолжить' : 'P, пробел или тап — продолжить');
  if (mode === 'clear') drawClear();
  if (mode === 'over' || mode === 'win') drawEnd();
}

// ---------- рейтинги (тот же сервер, что у Star Dodger) ----------
function newSession() { session = fetch(`${API}/session?game=${GAME}`).then(r => r.json()).then(d => d.s).catch(() => null); }

async function submitScore() { // таблица чата в Telegram
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
  nameForm.hidden = true; nameInput.blur();
  submitGlobal(name);
});

// ---------- управление ----------
function startOrToggle() {
  if (mode === 'menu') { reset(menuLevel); mode = 'play'; if (!practice) newSession(); }
  else if (mode === 'pause') mode = 'play';
  else if (mode === 'play') mode = 'pause';
  else if (performance.now() - overAt < 600) return; // пауза после экрана, чтобы не пролистать его случайно
  else if (mode === 'clear') nextLevel();
  else { mode = 'menu'; menuLevel = startLevel; nameForm.hidden = true; } // после финала — в меню: можно выбрать участок
}
function selectLevel(d) { const maxSel = Math.max(unlocked, forcedLevel + 1); menuLevel = clamp(menuLevel + d, 0, Math.min(maxSel, THEMES.length) - 1); }
function pressJump() { if (mode === 'play') jumpBuf = JUMP_BUFFER; else startOrToggle(); }
function pressAttack() { if (mode === 'play') attackQueued = true; }

const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowDown: 'down', KeyS: 'down' };
const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW', 'KeyK'];
addEventListener('keydown', e => {
  if (e.target === nameInput) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (mode === 'menu' && KEYMAP[e.code] && !e.repeat) { if (KEYMAP[e.code] !== 'down') selectLevel(KEYMAP[e.code] === 'left' ? -1 : 1); return; }
  if (KEYMAP[e.code]) { kb[KEYMAP[e.code]] = true; syncInput(); return; }
  if (e.repeat) return;
  if (JUMP_KEYS.includes(e.code)) { kb.jump = true; syncInput(); pressJump(); }
  else if (e.code === 'KeyJ' || e.code === 'KeyX' || e.code === 'KeyF') pressAttack();
  else if (e.code === 'KeyP' || e.code === 'Escape') { if (mode === 'play' || mode === 'pause') startOrToggle(); }
  else if (e.code === 'Enter' && mode !== 'play') startOrToggle();
});
addEventListener('keyup', e => {
  if (e.target === nameInput) return;
  if (KEYMAP[e.code]) kb[KEYMAP[e.code]] = false;
  if (JUMP_KEYS.includes(e.code)) kb.jump = false;
  syncInput();
});

// ---------- сенсорное управление: полупрозрачные кнопки прямо в кадре ----------
// Кнопка срабатывает и чуть за своим кругом; палец можно вести между ◀ и ▶ не отрывая. Работает мультитач.
const buttons = () => ({
  left:   { x: 62,      y: H - 62,  r: 36 },
  right:  { x: 152,     y: H - 62,  r: 36 },
  down:   { x: 107,     y: H - 140, r: 24 },
  attack: { x: W - 166, y: H - 54,  r: 38 },
  jump:   { x: W - 68,  y: H - 92,  r: 44 },
});
const PAUSE_BTN = () => ({ x: W - 22, y: 15, r: 13 });
const touches = new Map(); // pointerId → кнопка

function buttonAt(p) {
  const b = buttons(); let hit = null, bestD = Infinity;
  for (const k in b) { const d = Math.hypot(p.x - b[k].x, p.y - b[k].y); if (d < b[k].r * 1.5 && d < bestD) { hit = k; bestD = d; } }
  return hit;
}
function syncInput() {
  const held = new Set(touches.values());
  input.left = kb.left || held.has('left');
  input.right = kb.right || held.has('right');
  input.down = kb.down || held.has('down');
  input.jumpHeld = kb.jump || held.has('jump');
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  const p = toGame(e);
  if (mode === 'menu') { // стрелки выбора участка
    const a = menuArrows();
    if (Math.max(unlocked, forcedLevel + 1) > 1) for (const k of ['left', 'right']) if (Math.hypot(p.x - a[k].x, p.y - a[k].y) < a[k].r * 2) { selectLevel(k === 'left' ? -1 : 1); return; }
    startOrToggle(); return;
  }
  if (mode === 'play' && e.pointerType !== 'mouse') {
    const pb = PAUSE_BTN();
    if (Math.hypot(p.x - pb.x, p.y - pb.y) < pb.r * 2) { startOrToggle(); return; }
    const k = buttonAt(p);
    if (!k) return;
    touches.set(e.pointerId, k);
    if (k === 'jump') pressJump(); else if (k === 'attack') pressAttack();
    syncInput();
  } else if (mode === 'play') pressAttack(); // мышь: клик — удар
  else startOrToggle();
});
canvas.addEventListener('pointermove', e => {
  const old = touches.get(e.pointerId);
  if (!old || (old !== 'left' && old !== 'right')) return;
  const k = buttonAt(toGame(e));
  if (k === 'left' || k === 'right') { touches.set(e.pointerId, k); syncInput(); }
});
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, e => { if (touches.delete(e.pointerId)) syncInput(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => {
  if (mode === 'play') mode = 'pause';
  for (const k in kb) kb[k] = false;
  touches.clear(); syncInput();
});

function drawControls() {
  const b = buttons(), held = new Set(touches.values());
  ctx.save();
  for (const k in b) {
    const c = b[k], on = held.has(k);
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 7);
    ctx.fillStyle = on ? 'rgba(255,176,46,.35)' : 'rgba(255,255,255,.10)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = on ? 'rgba(255,176,46,.8)' : 'rgba(255,255,255,.32)'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath();
    if (k === 'left') { ctx.moveTo(c.x - 12, c.y); ctx.lineTo(c.x + 8, c.y - 12); ctx.lineTo(c.x + 8, c.y + 12); }
    else if (k === 'right') { ctx.moveTo(c.x + 12, c.y); ctx.lineTo(c.x - 8, c.y - 12); ctx.lineTo(c.x - 8, c.y + 12); }
    else if (k === 'down') { ctx.moveTo(c.x, c.y + 8); ctx.lineTo(c.x - 9, c.y - 6); ctx.lineTo(c.x + 9, c.y - 6); }
    else if (k === 'jump') { ctx.moveTo(c.x, c.y - 16); ctx.lineTo(c.x + 14, c.y + 2); ctx.lineTo(c.x - 14, c.y + 2); }
    ctx.fill();
    if (k === 'jump') text('прыжок', c.x, c.y + 20, 11, 'rgba(255,255,255,.7)');
    if (k === 'attack') { // значок — маленькая нивелирная рейка
      ctx.save(); ctx.globalAlpha = 0.8; ctx.translate(c.x - 14, c.y + 12); ctx.rotate(-0.85); ctx.scale(0.5, 0.8); drawStaff(66); ctx.restore();
      text('рейка', c.x, c.y + 26, 11, 'rgba(255,255,255,.7)');
    }
  }
  const pb = PAUSE_BTN(); // пауза
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(pb.x - 6, pb.y - 7, 4, 14); ctx.fillRect(pb.x + 2, pb.y - 7, 4, 14);
  ctx.restore();
}

// ---------- запуск: вызывается после загрузки всех тем ----------
let last = 0;
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  while (dt > 0) { const step = Math.min(dt, 1 / 60); update(step); dt -= step; } // мелкие шаги — стабильная физика
  draw();
  requestAnimationFrame(frame);
}
function startGame() {
  if (!THEMES.length) throw new Error('Не загружено ни одной темы');
  layout();
  menuLevel = clamp(PARAMS.has('level') ? forcedLevel : 0, 0, THEMES.length - 1);
  reset(menuLevel);
  last = performance.now();
  requestAnimationFrame(frame);
}
