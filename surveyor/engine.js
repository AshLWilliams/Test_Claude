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
const FALL_HURT = 260;   // падение с высоты больше этой (≈6 ростов героя) отнимает каску
const CLIMB = 150;       // скорость лазания по лестнице
const LENGTH_SCALE = 1.6; // участки стали длиннее: длина из темы умножается на это число

// ---------- темы ----------
const THEMES = [];
function registerTheme(t) { THEMES.push(t); THEMES.sort((a, b) => a.index - b.index); }

// параметры генератора по умолчанию; тема может переопределить их в gen
const GEN = {
  length: 3800,                                                   // базовая длина участка до финиша (умножается на LENGTH_SCALE)
  weights: { pit: 24, platforms: 20, step: 14, obstacle: 14, flat: 28, wall: 9, tower: 8 }, // частоты видов отрезков
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
let skyTop = '#000';
let seed, solids, platforms, pits, decor, pickups, enemies, projectiles, checkpoints, particles, popups, ladders, helmets;
let ghosts, secrets, hintsShown = new Set(); // ghosts — стены с тайником (рисуются целиком, сталкиваемся по кускам); secrets — ниши-тайники
let player, camX, camY = 0, levelEnd, finishX, finishY, respawn, arena = null;
let score, lives, kills, time, levelTime, shake, banner = null, clearInfo = null;
let mode = 'menu'; // menu | play | pause | clear | over | win
let overAt = 0, menuLevel = 0;
let board = null, globalBoard = null, session = null, final = null;
const forcedLevel = Math.max(0, (parseInt(PARAMS.get('level'), 10) || 1) - 1); // ?level=N — тренировка с участка N

const input = { left: false, right: false, down: false, up: false, jumpHeld: false }; // итоговое состояние: клавиатура + сенсорные кнопки
const kb = { left: false, right: false, down: false, up: false, jump: false };
let jumpBuf = 0, attackQueued = false, upWas = false;

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
  get camX() { return camX; }, get camY() { return camY; }, get player() { return player; }, // camY ≤ 0: камера поднялась вверх
  get time() { return levelTime; },                 // секунд с начала участка
  get now() { return performance.now() / 1000; },   // для анимаций
  get enemies() { return enemies; }, get solids() { return solids; }, get platforms() { return platforms; }, get pits() { return pits; },
  get projectiles() { return projectiles; }, get ladders() { return ladders; },
  get levelIndex() { return levelIdx; }, get levels() { return THEMES.length; },
  get progress() { return clamp(player.x / (arena ? arena.x1 : finishX), 0, 1); },
  get arena() { return arena; }, get mode() { return mode; }, get theme() { return theme; },
  rand, clamp, hash, overlap,
  text: (...a) => text(...a), drawStaff: len => drawStaff(len),
  hurtPlayer: fromX => hurtPlayer(fromX),
  burst: (...a) => burst(...a), popup: (...a) => popup(...a), addScore: (...a) => addScore(...a),
  shake(n) { shake = Math.max(shake, n); if (n >= 4) Sound.play('thud'); }, // сильная тряска — глухой удар (ковш, обвал, балка)
  sfx: name => Sound.play(name), // звуковой эффект: jump, swing, hit, kill, clang, hurt, smash, explosion, reflect, …
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
  toScreen(x, y) { return { x: x - camX, y: y - camY }; },
};

// ---------- генерация участка ----------
function generateLevel(s) {
  const R = mulberry32(s);
  const r = (a, b) => a + R() * (b - a), ri = (a, b) => Math.floor(r(a, b + 1)), pick = arr => arr[Math.floor(R() * arr.length)];
  solids = []; platforms = []; pits = []; decor = []; pickups = []; enemies = []; checkpoints = []; ladders = []; helmets = []; ghosts = []; secrets = [];
  arena = null;
  const spots = []; // ровные отрезки середины участка — отсюда выбирается место для геодезиста-халтурщика
  const LENGTH = Math.round(G.length * LENGTH_SCALE);
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
    for (let i = 0; i < n; i++) pickups.push({ x: x0 + w / 2 + (i - (n - 1) / 2) * 34, y: Math.max(y < 120 ? -400 : 50, y - h), t: R() * 6 });
  }
  function helmet(x0, y, chanceWhite) { // каска восстанавливает жизни: белая — две, оранжевая — одну; встречаются редко
    helmets.push({ x: x0, y: y - 26, kind: R() < chanceWhite ? 'white' : 'orange', t: R() * 6 });
  }
  const ladder = (lx, top, bottom, wall = false) => ladders.push({ x: lx, w: 22, top, bottom, wall, v: R() });
  function crates(x0, y) { // бочка или ящик (иногда оба рядом) — ломаются рейкой, внутри бывает добыча; возвращает правый край
    const n = R() < 0.25 ? 2 : 1, sort = R() < 0.55 ? 'barrel' : 'crate'; // пара — одинаковой высоты, чтобы поверху не спотыкаться
    for (let i = 0; i < n; i++) {
      const w = sort === 'barrel' ? 24 : 30, h = sort === 'barrel' ? 30 : 28, l = R();
      solids.push({ x: x0, y: y - h, w, h, kind: 'breakable', sort, hp: sort === 'barrel' ? 2 : 1, maxHp: sort === 'barrel' ? 2 : 1, v: R(), hit: 0,
        loot: l < 0.4 ? 'blueprint' : l < 0.5 ? 'helmet' : null });
      x0 += w + 2;
    }
    return x0;
  }
  function secretNiche(wall, baseY) { // тайник в стене: вход закрыт кладкой с трещинами, внутри — золотые чертежи
    const nw = Math.min(wall.w - 50, ri(96, 124)), nh = 58, ny = baseY - nh;
    ghosts.push(wall);
    solids.push({ x: wall.x, y: wall.y, w: wall.w, h: ny - wall.y, kind: 'ground', wall: true, hidden: true, v: wall.v }); // стена над нишей
    solids.push({ x: wall.x + nw, y: ny, w: wall.w - nw, h: H + 200 - ny, kind: 'hidden', hidden: true });                // стена за нишей
    solids.push({ x: wall.x, y: baseY, w: nw, h: H + 200 - baseY, kind: 'hidden', hidden: true });                         // пол ниши
    const door = { x: wall.x, y: ny, w: 20, h: nh, kind: 'breakable', sort: 'crack', hp: 3, maxHp: 3, v: R(), hit: 0 };
    const sec = { x: wall.x, y: ny, w: nw, h: nh, door, open: false };
    door.secret = sec; solids.push(door); secrets.push(sec);
    const n = ri(2, 3);
    for (let i = 0; i < n; i++) pickups.push({ x: wall.x + 36 + i * (nw - 52) / (n - 1), y: baseY - 20, t: R() * 6, gold: true, secret: sec });
    if (R() < 0.35) helmets.push({ x: wall.x + nw - 14, y: baseY - 44, kind: R() < 0.3 ? 'white' : 'orange', t: R() * 6, secret: sec });
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
    let kind = ['pit', 'platforms', 'step', 'obstacle', 'flat', 'wall', 'tower'].find(k => (t -= wts[k] || 0) < 0) || 'flat';
    if ((kind === 'wall' || kind === 'tower') && x < 700) kind = 'flat'; // в начале участка — без высотных конструкций
    if (!secrets.length && progress() > 0.6) kind = 'wall'; // тайник есть на каждом участке
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
        if (R() < 0.1) helmet(p2.x + p2.w / 2, p2.y, 0.15); else blueprints(p2.x, p2.w, p2.y);
        const o = x > 700 && R() < 0.55 + progress() * 0.3 ? pickType(['upper']) : null;
        if (o) spawnEnemy(o.type, p2.x + p2.w * 0.6, p2.y, { minX: p2.x, maxX: p2.x + p2.w, groundY: p2.y, upper: true });
      } else blueprints(px, pw, gy - 72);
      enemiesOn(x, len, gy, -0.1);
      x += len;
    } else if (kind === 'step') { // перепад высот
      gy = clamp(gy + (R() < 0.5 ? -1 : 1) * ri(30, MAX_STEP), gMin, gMax);
      const len = ri(200, 320);
      ground(x, len, gy); decorate(x, len, gy); blueprints(x, len, gy);
      const ex = x > 600 && R() < 0.25 ? crates(x + r(len * 0.25, len * 0.4), gy) + 20 : x;
      enemiesOn(ex, x + len - ex, gy);
      spots.push({ x0: x, w: len, y: gy, p: progress() });
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
    } else if (kind === 'wall') { // стена выше прыжка: подняться по лестнице, пройти поверху и спрыгнуть
      const baseY = gy;
      ground(x, 140, baseY); decorate(x, 90, baseY); x += 140;
      const wh = ri(130, 150), ww = ri(170, 260), top = baseY - wh;
      ladder(x - 24, top, baseY, true);
      const wall = { x, y: top, w: ww, h: H + 200 - top, kind: 'ground', wall: true, v: R() };
      if (x > 900 && (R() < 0.45 || (!secrets.length && progress() > 0.55))) secretNiche(wall, baseY); // на каждом участке — хотя бы один тайник
      else solids.push(wall);
      prevGy = null;
      blueprints(x, ww, top);
      if (R() < 0.3) helmet(x + ww / 2, top, 0.25);
      else enemiesOn(x, ww, top, -0.15);
      x += ww;
      ground(x, ri(200, 300), baseY); decorate(x, 150, baseY);
      x = solids[solids.length - 1].x + solids[solids.length - 1].w;
    } else if (kind === 'tower') { // вышка в три яруса по лестницам — необязательный маршрут наверх, выше края экрана
      const len = ri(520, 640);
      ground(x, len, gy);
      const t1 = { x: x + 70, y: gy - 110, w: 230, h: 10, base: gy, tier: 1, v: R(), tower: true };
      const t2 = { x: x + 190, y: gy - 230, w: 230, h: 10, base: t1.y, tier: 2, v: R(), tower: true };
      const t3 = { x: x + 80, y: gy - 350, w: 220, h: 10, base: t2.y, tier: 3, v: R(), tower: true };
      platforms.push(t1, t2, t3);
      // лестницы стоят там, где ярусы перекрываются: нижний конец каждой — на предыдущем ярусе
      ladder(t1.x + 18, t1.y, gy); ladder(x + 262, t2.y, t1.y); ladder(x + 202, t3.y, t2.y);
      if (R() < 0.25) helmet(t2.x + 40, t2.y, 0); blueprints(t2.x + 60, t2.w - 60, t2.y);
      if (R() < 0.8) helmet(t3.x + t3.w - 60, t3.y, 0.4); else blueprints(t3.x, t3.w, t3.y); // каски прячутся наверху вышек
      const o = R() < 0.5 + progress() * 0.3 ? pickType(['upper']) : null;
      if (o) spawnEnemy(o.type, t3.x + t3.w * 0.5, t3.y, { minX: t3.x, maxX: t3.x + t3.w, groundY: t3.y, upper: true });
      const o2 = R() < 0.5 ? pickType(['upper']) : null;
      if (o2) spawnEnemy(o2.type, t2.x + t2.w * 0.35, t2.y, { minX: t2.x, maxX: t2.x + t2.w, groundY: t2.y, upper: true });
      enemiesOn(x, len, gy, -0.1);
      x += len;
    } else { // ровный отрезок
      const len = ri(260, 420);
      ground(x, len, gy); decorate(x, len, gy); blueprints(x, len, gy);
      if (!hazardOn(x, len, gy)) {
        const ex = x > 500 && R() < 0.35 ? crates(x + r(30, len * 0.22), gy) + 24 : x;
        if (R() < 0.05) helmet(x + len * 0.65, gy, 0); // изредка каска лежит прямо на земле
        enemiesOn(ex, x + len - ex, gy, 0.15);
        spots.push({ x0: x, w: len, y: gy, p: progress() });
      }
      x += len;
    }
    if (x - lastCP > 1800 && x < LENGTH - 400) { // чекпоинт — нивелир на штативе
      checkpoints.push({ x: x - 60, y: groundAt(x - 60) ?? gy, on: false });
      lastCP = x;
    }
  }
  // геодезист-халтурщик с GPS на вешке — один на участок, в середине пути; у каждого участка свой
  let mid = spots.filter(o => o.p > 0.25 && o.p < 0.85 && o.w > 220);
  if (!mid.length) mid = spots.filter(o => o.p > 0.12);
  if (mid.length) { const o = pick(mid); spawnEnemy('gps', o.x0 + o.w * 0.6, o.y, { groundY: o.y, variant: GPS_VARIANTS[levelIdx % GPS_VARIANTS.length] }); }
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
  const def = theme.enemies[type] || ENGINE_ENEMIES[type];
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
  if (q.hurts && q.x > camX - 20 && q.x < camX + W + 20 && !q.silent) Sound.play('throw'); // свист брошенного на экране
  projectiles.push(q);
  return q;
}

function groundAt(x) { // верх самой высокой твёрдой поверхности в точке x (или null — провал)
  let top = null;
  for (const s of solids) if (x >= s.x && x <= s.x + s.w && (top === null || s.y < top)) top = s.y;
  return top;
}

// ---------- геодезист-халтурщик с GPS-приёмником на вешке (враг движка, встречается раз за участок) ----------
// Ровер: купол антенны на карбоновой вешке, на вешке зажат контроллер. Халтурщик подбегает, бьёт вешкой,
// убегает с отговоркой и снова догоняет. На каждом участке — свой: имя, одежда, скорость, отговорки, приём атаки.
const GPS_VARIANTS = [
  { name: 'Халтурщик Витёк', vest: '#c6ff00', jacket: '#3e4a5a', hat: 'cap', hatColor: '#1e5bb8', dome: '#f5f5f5', pole: '#ffd600', speed: 150, hp: 2,
    lines: ['Фиксация есть — сдаём!', 'Плюс-минус метр — норма!'], death: 'Ладно, перемеряю…' },
  { name: 'Студент-заочник с ровером', vest: '#ff9800', jacket: '#546e7a', hat: 'beanie', hatColor: '#8e24aa', dome: '#e0e0e0', pole: '#ffd600', speed: 160, hp: 2,
    lines: ['В камералке поправлю!', 'Методичку не читал!'], death: 'Зачёт не поставят…' },
  { name: 'Халтурщик «Ноль спутников»', vest: '#ffeb3b', jacket: '#37474f', hat: 'hood', hatColor: '#455a64', dome: '#90a4ae', pole: '#263238', speed: 150, hp: 3,
    lines: ['Под землёй тоже ловит!', 'Спутников ноль — я уверен!'], death: 'Сигнал потерян…' },
  { name: 'Шахтёр с ровером', vest: '#ff5722', jacket: '#212121', hat: 'lamp', hatColor: '#fdd835', dome: '#cfd8dc', pole: '#263238', speed: 145, hp: 3,
    lines: ['RTK? Тут и так видно!', 'Координаты — на глаз!'], death: 'Обвал точности…' },
  { name: 'Бригадир «Плюс-минус метр»', vest: '#ffc107', jacket: '#6d4c41', hat: 'helmet', hatColor: '#ffffff', dome: '#ffffff', pole: '#ffd600', speed: 165, hp: 3, combo: true,
    lines: ['Объём — по навигатору!', 'Карьер большой, метр не беда!'], death: 'Маркшейдер узнает…' },
  { name: 'Дорожный халтурщик', vest: '#ff6d00', jacket: '#424242', hat: 'cap', hatColor: '#ff6d00', dome: '#fafafa', pole: '#ffd600', speed: 175, hp: 3,
    lines: ['Ось — по навигатору!', 'Разбивка есть в телефоне!'], death: 'Асфальт переложат…' },
  { name: 'Мостовик «Float-решение»', vest: '#00e5ff', jacket: '#1a237e', hat: 'helmet', hatColor: '#ff9800', dome: '#eceff1', pole: '#263238', speed: 165, hp: 3, leap: true,
    lines: ['Float — тоже решение!', 'Опору и так видно!'], death: 'Пролёт не сошёлся…' },
  { name: 'Высотник с вешкой', vest: '#e040fb', jacket: '#263238', hat: 'helmet', hatColor: '#e53935', dome: '#ffffff', pole: '#ffd600', speed: 170, hp: 3, leap: true,
    lines: ['Вертикаль — на глаз!', 'На 200 метрах тоже точно!'], death: 'Отвес не врёт…' },
  { name: 'Северный халтурщик', vest: '#ff3d00', jacket: '#1b5e20', hat: 'fur', hatColor: '#6d4c41', dome: '#e3f2fd', pole: '#263238', speed: 155, hp: 4, combo: true,
    lines: ['Замёрз — ставлю наугад!', 'Батарея села, пишу по памяти!'], death: 'Отморозил точность…' },
  { name: 'Субподрядчик ООО «Точка»', vest: null, jacket: '#263238', hat: 'suit', hatColor: '#111', dome: '#ffd76a', pole: '#b0bec5', speed: 180, hp: 4, combo: true, leap: true,
    lines: ['Исполнительная уже готова!', 'Подпишите, не глядя!'], death: 'Договор расторгнут!' },
];

const ENGINE_ENEMIES = {
  gps: {
    w: 18, h: 40, hp: 3, pts: 300, touchHurts: false, hitColor: '#ffe082', deathColor: '#c6ff00',
    init(e) {
      const v = e.v = e.variant || GPS_VARIANTS[0];
      e.hp = e.maxHp = v.hp; e.state = 'lurk'; e.st = 0; e.vx = 0; e.vy = 0; e.onG = true; e.dir = -1; e.combo = 0; e.lineI = 0;
    },
    onHit(e) { if (e.state === 'windup') { e.state = 'flee'; e.st = 1.2; } }, // сбили замах — убегает
    onDeath(e) {
      popup(e.x - 10, e.y - 20, e.v.death, '#c6ff00');
      burst(e.x + e.w / 2, e.y - 10, e.v.dome, 10, 200); burst(e.x + e.w / 2, e.y - 10, '#263238', 6, 160);
    },
    hurtbox(e) { return e; },
    update(e, dt) {
      const P = player, v = e.v, dx = api.dx(e), adx = Math.abs(dx), toP = Math.sign(dx) || 1;
      e.st -= dt;
      if (!e.seen && e.x < camX + W && e.x + e.w > camX) { e.seen = true; popup(e.x + e.w / 2, e.y - 34, v.name, '#c6ff00'); Sound.play('gps'); }
      let want = 0, speed = v.speed;
      const level = Math.abs(P.y + P.h - (e.y + e.h)) < 34;
      if (e.state === 'lurk') { e.dir = toP; if (adx < 320 && Math.abs(P.y - e.y) < 160) e.state = 'chase'; } // «меряет точку», пока герой не подойдёт
      else if (e.state === 'chase') {
        want = toP;
        if (adx < 42 && level && e.onG) { e.state = 'windup'; e.st = 0.42; e.dir = toP; Sound.play('gps'); }
        else if (adx > 900) e.state = 'lurk';
      } else if (e.state === 'windup') {
        if (e.st <= 0) { e.state = 'strike'; e.st = 0.22; e.hitDone = false; Sound.play('swing'); if (v.leap && e.onG) { e.vy = -360; e.onG = false; } }
      } else if (e.state === 'strike') {
        if (v.leap && !e.onG) want = e.dir;
        const hb = { x: e.dir > 0 ? e.x + e.w / 2 : e.x + e.w / 2 - 52, y: e.y - 24, w: 52, h: e.h + 24 };
        if (!e.hitDone && overlap(hb, P)) { e.hitDone = true; hurtPlayer(e.x + e.w / 2); }
        if (e.st <= 0) {
          if (v.combo && !e.combo) { e.combo = 1; e.state = 'windup'; e.st = 0.24; }
          else { // удрать с отговоркой, потом вернуться
            e.combo = 0; e.state = 'flee'; e.st = rand(1.4, 2.2);
            popup(e.x + e.w / 2, e.y - 30, v.lines[e.lineI++ % v.lines.length], '#e6ffb0'); Sound.play('laugh');
          }
        }
      } else if (e.state === 'flee') { want = -toP; speed *= 1.3; if (e.st <= 0) { e.state = 'turn'; e.st = 0.45; } }
      else if (e.state === 'turn') { e.dir = toP; if (e.st <= 0) e.state = 'chase'; } // оглядывается — и снова в погоню
      if (want) e.dir = want;
      // своя простая физика: ходит по земле, запрыгивает на уступы, перепрыгивает провалы
      const feet = e.y + e.h;
      let vx = want * speed * (e.onG ? 1 : 1.35);
      if (want && e.onG) {
        const fx = want > 0 ? e.x + e.w + 6 : e.x - 6, g = groundAt(fx);
        if (g === null) { const far = groundAt(fx + want * 118); if (far !== null && far > feet - 60 && e.state !== 'flee') { e.vy = -600; e.onG = false; } else vx = 0; } // удирая, через провалы не прыгает
        else if (g < feet - 4) { if (feet - g <= 70) { e.vy = -640; e.onG = false; } else vx = 0; }
        if (!vx && e.state === 'flee') { e.state = 'turn'; e.st = 0.45; } // упёрся — разворачивается
      }
      if (vx) {
        const nx = e.x + vx * dt, probe = vx > 0 ? nx + e.w : nx, g = groundAt(probe);
        if (g === null || g >= feet - 2) e.x = nx;
      }
      if (arena && e.x + e.w > arena.x1 - 30) e.x = arena.x1 - 30 - e.w; // на арену босса не ходит
      e.vxNow = vx;
      e.vy = Math.min(e.vy + GRAVITY * dt, 900);
      const prevFeet = e.y + e.h; e.y += e.vy * dt;
      const g1 = groundAt(e.x + 3), g2 = groundAt(e.x + e.w - 3);
      const gc = g1 === null ? g2 : g2 === null ? g1 : Math.min(g1, g2);
      if (gc !== null && e.vy >= 0 && e.y + e.h >= gc && prevFeet <= gc + 8) { e.y = gc - e.h; e.vy = 0; e.onG = true; }
      else e.onG = false;
      if (e.y > H + 100) { e.dead = true; popup(e.x, H - 40, 'Халтурщик провалился!', '#c6ff00'); }
    },
    draw(e, ctx) {
      const v = e.v, run = e.onG && Math.abs(e.vxNow || 0) > 10, sw = run ? Math.sin(e.t * 15) * 0.7 : e.onG ? 0 : 0.5;
      ctx.strokeStyle = v.hat === 'suit' ? '#263238' : '#37474f'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      for (const s of [sw, -sw]) { ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(Math.sin(s) * 12, -2); ctx.stroke(); }
      ctx.fillStyle = v.hat === 'suit' ? '#111' : '#5d4037'; for (const s of [sw, -sw]) ctx.fillRect(Math.sin(s) * 12 - 3, -4, 9, 4);
      ctx.fillStyle = v.jacket; ctx.fillRect(-7, -36, 14, 20);
      if (v.vest) { ctx.fillStyle = v.vest; ctx.fillRect(-7, -35, 14, 15); ctx.fillStyle = '#e0e0e0'; ctx.fillRect(-7, -27, 14, 2); }
      else { ctx.fillStyle = '#fff'; ctx.fillRect(-2, -36, 5, 12); ctx.fillStyle = '#c62828'; ctx.fillRect(0, -35, 2, 10); } // костюм, рубашка и галстук
      ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(1, -42, 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#222'; ctx.fillRect(3, -44, 2, 2);
      if (e.state === 'flee' || e.state === 'turn') { ctx.fillStyle = '#7a2a1a'; ctx.fillRect(2, -39, 4, 1.5); } // ухмылка
      const hc = v.hatColor; ctx.fillStyle = hc;
      if (v.hat === 'cap') { ctx.beginPath(); ctx.arc(1, -45, 6.5, Math.PI, 0); ctx.fill(); ctx.fillRect(3, -46, 9, 2); }
      else if (v.hat === 'beanie') { ctx.beginPath(); ctx.arc(1, -45, 6.5, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -46, 14, 3); ctx.beginPath(); ctx.arc(1, -52, 2.5, 0, 7); ctx.fill(); }
      else if (v.hat === 'hood') { ctx.beginPath(); ctx.arc(0, -43, 8.5, Math.PI * 0.8, Math.PI * 2.1); ctx.fill(); ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(2, -42, 5, -1.2, 1.4); ctx.fill(); ctx.fillStyle = '#222'; ctx.fillRect(3, -44, 2, 2); }
      else if (v.hat === 'fur') { ctx.beginPath(); ctx.ellipse(1, -47, 9, 5, 0, 0, 7); ctx.fill(); ctx.fillRect(-7, -46, 4, 8); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-6, -50, 12, 2); }
      else if (v.hat === 'suit') { ctx.beginPath(); ctx.arc(1, -45, 6.3, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#111'; ctx.fillRect(1, -44, 6, 2); } // зализанные волосы и тёмные очки
      else { ctx.beginPath(); ctx.arc(1, -45, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -46, 16, 2); if (v.hat === 'lamp') { ctx.fillStyle = '#fff6b0'; ctx.fillRect(6, -49, 3, 3); } }
      // вешка с ровером: в покое стоит у ног, на бегу — на плече, при атаке — замах и удар сверху
      let ang = 0.12;
      if (e.state === 'chase' || e.state === 'flee') ang = 0.45;
      else if (e.state === 'windup') ang = -0.4 - 1.2 * Math.min(1, (0.42 - e.st) / 0.3);
      else if (e.state === 'strike') { const k = 1 - Math.max(0, e.st) / 0.22; ang = -1.6 + 3.1 * Math.min(1, k * 1.6); }
      ctx.save(); ctx.translate(6, -24); ctx.rotate(ang);
      if (e.state === 'strike') { ctx.strokeStyle = 'rgba(230,255,176,.35)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(0, 0, 36, -Math.PI / 2 - 1.6 - ang, -Math.PI / 2 - ang + 0.1); ctx.stroke(); }
      ctx.fillStyle = v.pole; ctx.fillRect(-1.2, -34, 2.4, 56);
      ctx.fillStyle = '#b71c1c'; ctx.fillRect(-1.2, 12, 2.4, 3); ctx.fillStyle = '#9e9e9e'; ctx.fillRect(-0.8, 20, 1.6, 4); // метка и наконечник
      ctx.fillStyle = '#263238'; ctx.fillRect(1, -8, 7, 10); ctx.fillStyle = '#7cffb2'; ctx.fillRect(2, -7, 5, 5); // контроллер на кронштейне
      ctx.fillStyle = '#607d8b'; ctx.fillRect(-6, -38, 12, 4); // корпус приёмника
      ctx.fillStyle = v.dome; ctx.beginPath(); ctx.ellipse(0, -38, 7, 5, 0, Math.PI, 0); ctx.fill(); // купол антенны
      ctx.fillStyle = Math.floor(e.t * 3) % 2 ? '#39ff6a' : '#1b5e20'; ctx.fillRect(3, -37, 2, 2); // мигающий диод «FIX»
      ctx.restore();
      ctx.strokeStyle = v.jacket; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(6, -24); ctx.stroke();
      ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(6, -24, 2.5, 0, 7); ctx.fill();
      if (e.state === 'windup') text('!', 0, -60, 14, '#ffd76a');
    },
  },
};

// ---------- кампания ----------
function loadLevel(i) {
  levelIdx = i; theme = THEMES[i];
  G = Object.assign({}, GEN, theme.gen || {});
  G.weights = Object.assign({}, GEN.weights, (theme.gen || {}).weights || {});
  seed = (Math.random() * 2 ** 32) >>> 0;
  projectiles = []; particles = []; popups = [];
  generateLevel(seed);
  player = { x: 80, y: checkpoints[0].y - 40, w: 18, h: 40, vx: 0, vy: 0, face: 1, onGround: false, coyote: 0, inv: 0, attackT: 0, attackCd: 0, hitSet: null, anim: 0, drop: 0, climb: null, peakY: 0, snow: 0.3, stepK: 0, rungK: 0 };
  respawn = { x: 80, y: checkpoints[0].y - 60 };
  camX = 0; camY = 0; levelTime = 0; lives = 3; shake = 0; hintsShown = new Set();
  banner = { top: `Участок ${i + 1} из ${THEMES.length}`, title: theme.title, sub: theme.subtitle || '', t: 3.2 };
  if (theme.init) theme.init(api);
  skyTop = sampleSkyTop();
}

function sampleSkyTop() { // цвет верхнего края фона темы — один раз при загрузке участка
  try {
    const c = document.createElement('canvas'); c.width = W; c.height = 4;
    const x = c.getContext('2d'); theme.drawBackground(x, api);
    const d = x.getImageData(0, 1, W, 1).data; let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
  } catch (e) { return '#000'; }
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
  const timeBonus = Math.max(0, Math.round(2200 - levelTime * 12)), lifeBonus = lives * 200, finishBonus = 500 + (G.boss ? 5000 : 0);
  score += timeBonus + lifeBonus + finishBonus;
  clearInfo = { timeBonus, lifeBonus, finishBonus, level: levelIdx, time: levelTime, secrets: secrets.filter(q => q.open).length, secretsTotal: secrets.length };
  if (levelIdx + 2 > unlocked) { unlocked = Math.min(THEMES.length, levelIdx + 2); try { localStorage.setItem(UNLOCK_KEY, unlocked); } catch (e) {} }
  burst(player.x, player.y, '#ffd76a', 40, 260);
  if (levelIdx < THEMES.length - 1) Sound.play('clear');
  if (levelIdx >= THEMES.length - 1) endGame(true);
  else { mode = 'clear'; overAt = performance.now(); }
}

function nextLevel() { loadLevel(levelIdx + 1); mode = 'play'; Sound.play('intro'); }

function endGame(won) {
  mode = won ? 'win' : 'over'; overAt = performance.now();
  Sound.play(won ? 'win' : 'over');
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
function debris(x, y, colors, n = 12, speed = 260) { // обломки: вращающиеся куски, падают и гаснут
  for (let i = 0; i < n; i++) {
    const a = rand(-Math.PI * 0.95, -Math.PI * 0.05), s = rand(80, speed);
    particles.push({ x: x + rand(-8, 8), y: y + rand(-8, 8), vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.7, 1.3), max: 1.3, color: colors[i % colors.length], grav: 1100,
      size: rand(3, 6), w: rand(3, 9), h: rand(2, 5), rot: rand(0, 6), vr: rand(-14, 14), chunk: true });
  }
  if (particles.length > 600) particles.splice(0, particles.length - 600);
}
const BREAK_COLORS = { barrel: ['#3d6fa8', '#28507c', '#9fb4c8', '#c9a227'], crate: ['#b07a42', '#8a5a2b', '#d2a26b', '#5e3b1a'], crack: ['#8d8173', '#6e6357', '#b3a794', '#4d443a'] };
function hitBreakable(s) { // удар рейкой по бочке, ящику или кладке с трещинами
  s.hp--; s.hit = 0.15;
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  if (s.hp > 0) { Sound.play(s.sort === 'barrel' ? 'clang' : 'crack'); debris(cx, cy, BREAK_COLORS[s.sort], 4, 140); shake = Math.max(shake, 2); return; }
  s.dead = true; solids = solids.filter(o => o !== s);
  debris(cx, cy, BREAK_COLORS[s.sort], s.sort === 'crack' ? 22 : 14, s.sort === 'crack' ? 300 : 260);
  burst(cx, cy, s.sort === 'crack' ? '#cfc6b8' : '#e8d8c0', 10, 140, 200); // пыль
  shake = Math.max(shake, s.sort === 'crack' ? 6 : 3);
  if (s.sort === 'crack') {
    Sound.play('rubble'); Sound.play('secret');
    s.secret.open = true; addScore(100);
    popup(s.x + 40, s.y - 16, 'ТАЙНИК!', '#ffd24a');
    burst(s.x + 40, s.y + s.h / 2, '#ffd24a', 18, 200, 100);
    return;
  }
  Sound.play(s.sort === 'barrel' ? 'barrel' : 'break');
  addScore(20, cx, s.y - 6);
  if (s.loot === 'blueprint') pickups.push({ x: cx, y: s.y - 12, t: 0 });
  else if (s.loot === 'helmet') helmets.push({ x: cx, y: s.y, kind: 'orange', t: 0, vx: rand(-40, 40), vy: -380 });
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

function fallHurt(h) {
  if (mode !== 'play') return;
  lives--; player.inv = Math.max(player.inv, 1); shake = 9; Sound.play('hurt'); Sound.play('thud');
  burst(player.x + player.w / 2, player.y + player.h, '#ff5d5d', 14, 160);
  popup(player.x, player.y - 10, 'Высоко! −каска', '#ff8a7a');
  if (lives <= 0) endGame(false);
}

function hurtPlayer(fromX) {
  if (player.inv > 0 || mode !== 'play') return;
  lives--; player.inv = 1.4; shake = 8; Sound.play('hurt');
  player.vx = (player.x + player.w / 2 < fromX ? -1 : 1) * 260; player.vy = -380;
  burst(player.x + player.w / 2, player.y + 20, '#ff5d5d', 16);
  if (lives <= 0) endGame(false);
}

// ---------- игровой цикл ----------
function update(dt) {
  for (const p of particles) { p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; if (p.chunk) { p.rot += p.vr * dt; const g = p.vy > 0 ? groundAt(p.x) : null; if (g !== null && p.y > g - 2 && p.y < g + 14) { p.y = g - 2; p.vy *= -0.3; p.vx *= 0.6; p.vr *= 0.5; } } } // обломки падают на землю
  if (solids) for (const s of solids) if (s.hit > 0) s.hit -= dt;
  particles = particles.filter(p => p.life > 0);
  for (const p of popups) { p.y -= 40 * dt; p.life -= dt; }
  popups = popups.filter(p => p.life > 0);
  shake = Math.max(0, shake - dt * 25);
  if (mode !== 'play') return;
  time += dt; levelTime += dt;
  if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
  const P = player;

  // лестницы: ↑ (или кнопка прыжка на телефоне) — лезть вверх, ↓ — вниз, пробел — спрыгнуть
  const upEdge = input.up && !upWas; upWas = input.up;
  const onLad = l => P.x + P.w > l.x + 3 && P.x < l.x + l.w - 3 && P.y + P.h > l.top - 2 && P.y + P.h <= l.bottom + 2;
  if (!P.climb) {
    const l = ladders.find(onLad);
    if (l && ((input.up && (P.onGround || upEdge) && P.y + P.h > l.top + 2) || (input.down && P.onGround && P.y + P.h < l.bottom - 4))) {
      P.climb = l; jumpBuf = 0; P.vx = 0; P.vy = 0; P.x = l.x + l.w / 2 - P.w / 2;
    }
  } else if (!onLad(P.climb)) P.climb = null;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (P.climb) {
    const l = P.climb;
    P.vy = input.up ? -CLIMB : input.down ? CLIMB : 0;
    P.y = clamp(P.y + P.vy * dt, l.top - P.h, l.bottom - P.h);
    if (dir) { P.face = dir; moveX(P, dir * 90 * dt); } // шаг в сторону — сойти с лестницы
    P.anim += Math.abs(P.vy) * dt * 0.05;
    P.onGround = P.y + P.h >= l.bottom - 1 || P.y + P.h <= l.top + 1; P.coyote = COYOTE; P.peakY = P.y;
    const rung = Math.floor(P.y / 12); if (rung !== P.rungK) { P.rungK = rung; Sound.play('ladder'); } // ступеньки
    if (jumpBuf > 0 && !input.up) { P.climb = null; P.vy = -JUMP_V * 0.6; jumpBuf = 0; Sound.play('jump'); } // пробел — спрыгнуть
    if (P.climb && P.y + P.h >= l.bottom - 1 && input.down) P.climb = null; // спустился
    if (!onLad(l)) P.climb = null;
  }
  if (!P.climb) {
  // бег
  if (dir) { P.vx = clamp(P.vx + dir * ACCEL * dt, -RUN, RUN); P.face = dir; }
  else { const f = FRICTION * clamp(G.friction, 0.2, 1) * dt; P.vx = Math.abs(P.vx) <= f ? 0 : P.vx - Math.sign(P.vx) * f; }

  // прыжок с «временем койота» и буфером нажатия — управление прощает мелкие промахи
  P.coyote = P.onGround ? COYOTE : P.coyote - dt;
  jumpBuf -= dt; P.drop -= dt;
  if (jumpBuf > 0 && P.coyote > 0) {
    if (input.down && P.onGround && platforms.some(p => Math.abs(P.y + P.h - p.y) < 2 && P.x + P.w > p.x && P.x < p.x + p.w)) { P.drop = 0.25; P.y += 2; }
    else { P.vy = -JUMP_V; Sound.play('jump'); burst(P.x + P.w / 2, P.y + P.h, theme.dust || '#b9a58a', 6, 80, 300); shakeSnow(0.6); }
    jumpBuf = 0; P.coyote = 0;
  }
  if (!input.jumpHeld && P.vy < -250) P.vy = -250; // короткое нажатие — низкий прыжок
  P.vy = Math.min(P.vy + GRAVITY * dt, 900);
  const wasAir = !P.onGround;
  moveX(P, P.vx * dt);
  moveY(P, P.vy * dt);
  if (P.onGround && wasAir && P.vy === 0) {
    burst(P.x + P.w / 2, P.y + P.h, theme.dust || '#b9a58a', 5, 70, 300);
    if (P.y - P.peakY > FALL_HURT && P.inv <= 0) fallHurt(P.y - P.peakY); // урон от падения с большой высоты (не после отброса от удара — это уже урон)
    else if (P.y - P.peakY > 40) Sound.play('land');
  }
  if (P.onGround && Math.abs(P.vx) > 60) { const k = Math.floor(P.anim / (Math.PI / 2)); if (k !== P.stepK) { P.stepK = k; Sound.play(theme.snowy ? 'stepSnow' : 'step'); } } // шаги
  if (P.onGround) P.peakY = P.y; else P.peakY = Math.min(P.peakY, P.y);
  }
  if (arena && arena.active) P.x = clamp(P.x, arena.x1, arena.x2 - P.w);
  P.x = clamp(P.x, 0, levelEnd);
  P.anim += Math.abs(P.vx) * dt * 0.05;
  P.inv = Math.max(0, P.inv - dt);
  if (theme.snowy) { // снег налипает на каску и плечи, особенно когда стоишь; прыжок и удар его стряхивают
    P.snow = Math.min(1, P.snow + dt * (Math.abs(P.vx) < 20 ? 0.12 : 0.05));
    if (Math.random() < dt * 1.2) particles.push({ x: P.x + P.w / 2 + P.face * 6, y: P.y + 4, vx: P.face * rand(10, 30), vy: -rand(5, 20), life: 0.9, max: 0.9, color: 'rgba(235,245,255,.55)', grav: -30, size: rand(2, 4) }); // пар изо рта
  }

  if (theme.update) theme.update(dt, api);
  if (mode !== 'play') return; // тема могла закончить игру (урон)

  // удар рейкой: широкая дуга перед геодезистом
  P.attackCd -= dt;
  if (attackQueued && P.attackCd <= 0) { P.attackT = 0.26; P.attackCd = 0.36; P.hitSet = new Set(); Sound.play('swing'); shakeSnow(0.3); }
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
      for (const s of solids) if (s.kind === 'breakable' && !s.dead && !P.hitSet.has(s) && overlap(hb, s)) { P.hitSet.add(s); hitBreakable(s); }
      for (const p of projectiles) {
        if (p.dead || p.reflected || !overlap(hb, p)) continue;
        if (p.reflectable) reflect(p);
        else if (p.destructible) { p.dead = true; Sound.play('smash'); addScore(p.pts, p.x, p.y); burst(p.x + p.w / 2, p.y + p.h / 2, p.color, 8); }
      }
    }
  }

  // падение в провал
  if (P.y > DEATH_Y) {
    lives--; shake = 6; Sound.play('fall');
    if (lives <= 0) { endGame(false); return; }
    const rp = arena && arena.active ? { x: arena.x1 + 60, y: arena.y - 60 } : respawn;
    Object.assign(P, { x: rp.x, y: rp.y, vx: 0, vy: 0, inv: 1.5, climb: null, peakY: rp.y });
  }

  updateEnemies(dt);
  if (mode !== 'play') return;
  updateProjectiles(dt);
  if (mode !== 'play') return;

  // подбор чертежей
  for (const k of pickups) {
    k.t += dt;
    if (k.got || (k.secret && !k.secret.open) || Math.abs(k.x - (P.x + P.w / 2)) >= 20 || Math.abs(k.y - (P.y + P.h / 2)) >= 30) continue;
    k.got = true;
    if (k.gold) { Sound.play('gold'); addScore(300, k.x, k.y - 10); burst(k.x, k.y, '#ffd24a', 16, 170, 200); } // золотой чертёж из тайника
    else { Sound.play('pickup'); addScore(50, k.x, k.y - 10); burst(k.x, k.y, '#7ec8ff', 10, 140, 200); }
  }
  pickups = pickups.filter(k => !k.got);
  for (const k of helmets) { // каски: белая +2 жизни, оранжевая +1; при полном здоровье — очки
    k.t += dt;
    if (k.vy !== undefined && !k.rest) moveHelmet(k, dt); // летит: выпала из бочки или из босса
    if (k.life !== undefined && (k.life -= dt) <= 0) { k.got = true; Sound.play('vanish'); burst(k.x, k.y, '#dddddd', 8, 90, 100); continue; }
    if (k.secret && !k.secret.open) continue;
    if (k.got || Math.abs(k.x - (P.x + P.w / 2)) > 22 || Math.abs(k.y - (P.y + P.h / 2)) > 30) continue;
    k.got = true; const add = k.kind === 'white' ? 2 : 1, was = lives;
    lives = Math.min(3, lives + add);
    if (lives > was) popup(k.x - 20, k.y - 14, (k.kind === 'white' ? 'Белая каска +' : 'Каска +') + (lives - was), '#9cff9c');
    else addScore(150, k.x, k.y - 10);
    Sound.play('helmet'); burst(k.x, k.y, k.kind === 'white' ? '#ffffff' : '#ff9a3c', 16, 160, 200);
  }
  helmets = helmets.filter(k => !k.got);

  // подсказки: трещины и бочки ломаются рейкой
  for (const s of solids) {
    if (s.kind !== 'breakable' || Math.abs(s.x - P.x) > 170 || Math.abs(s.y - P.y) > 120) continue;
    const key = s.sort === 'crack' ? 'crack' : 'crate';
    if (hintsShown.has(key) || (key === 'crate' && levelIdx > 0)) continue;
    hintsShown.add(key);
    popup(s.x + s.w / 2, s.y - 24, key === 'crack' ? 'Трещина! Ударь рейкой' : 'Бочки и ящики ломаются рейкой', key === 'crack' ? '#ffd24a' : '#f1e6d6');
  }

  // чекпоинты
  for (const c of checkpoints) {
    if (!c.on && P.x + P.w > c.x - 10 && P.x < c.x + 20) { c.on = true; Sound.play('checkpoint'); respawn = { x: c.x, y: c.y - 60 }; addScore(100, c.x, c.y - 90); burst(c.x, c.y - 70, '#6cff8a', 16); }
  }

  // арена босса: закрывается, когда игрок вошёл; открывается победой
  if (arena) {
    if (!arena.active && P.x > arena.x1 + 30) {
      arena.active = true; Sound.play('boss');
      const bd = arena.boss.def;
      banner = { top: 'БОСС', title: bd.bossName || 'Босс', sub: bd.bossSub || '', t: 3 };
    }
    if (arena.active && !arena.boss.dead) { // из босса иногда вылетают каски — успей схватить, пока не пропали
      arena.dropT = (arena.dropT ?? rand(6, 8)) - dt * (lives <= 1 ? 1.8 : 1);
      if (arena.dropT <= 0) { arena.dropT = rand(9, 13); bossDrop(); }
    }
    if (arena.boss.dead) { arena.doneT += dt; if (arena.doneT > 1.8) { levelComplete(); return; } }
  } else if (P.x > finishX) { levelComplete(); return; }

  // камера с небольшим «заглядыванием» вперёд
  let lo = 0, hi = levelEnd - W;
  if (arena && arena.active) { lo = arena.x1 - Math.max(0, (W - (arena.x2 - arena.x1)) / 2); hi = Math.max(lo, arena.x2 - W); }
  const target = clamp(P.x - W * 0.35 + P.face * 40, lo, hi);
  camX += (target - camX) * Math.min(1, dt * 6);
  // по вертикали камера поднимается, когда герой высоко (вышки, стены), и не опускается ниже обычного кадра
  const ty = Math.min(0, P.y + P.h / 2 - H * 0.52);
  camY += (ty - camY) * Math.min(1, dt * 5);
}

function moveHelmet(k, dt) { // летящая каска: подпрыгивает на земле и замирает
  k.vy = Math.min(k.vy + 900 * dt, 700);
  const nx = k.x + (k.vx || 0) * dt, gw = groundAt(nx);
  if (gw !== null && gw < k.y + 6) k.vx = -(k.vx || 0) * 0.5; else k.x = nx; // стенка — отскок
  if (arena && arena.active) k.x = clamp(k.x, arena.x1 + 20, arena.x2 - 20);
  const prev = k.y; k.y += k.vy * dt;
  const g = groundAt(k.x);
  if (g !== null && k.vy > 0 && k.y + 14 >= g && prev + 14 <= g + 10) {
    k.y = g - 14;
    if (k.vy > 220) { k.vy *= -0.35; k.vx = (k.vx || 0) * 0.6; } else { k.vy = 0; k.vx = 0; k.rest = true; }
  }
  if (k.y > H + 80) k.got = true;
}
function bossDrop() {
  const b = arena.boss, hb = b.def.hurtbox ? b.def.hurtbox(b, api) : b;
  const cx = hb.x + hb.w / 2, cy = hb.y + hb.h * 0.3, dir = Math.sign(player.x - cx) || (Math.random() < 0.5 ? -1 : 1);
  helmets.push({ x: cx, y: cy, kind: Math.random() < 0.25 ? 'white' : 'orange', t: 0, vx: dir * rand(90, 230), vy: -rand(430, 560), life: 7.5 });
  Sound.play('bossDrop'); burst(cx, cy, '#ffffff', 12, 180);
  popup(cx, cy - 16, 'Каска!', '#9cff9c');
}
function shakeSnow(k) { // стряхнуть снег (снежный участок)
  const P = player;
  if (!theme.snowy || P.snow < 0.25) return;
  burst(P.x + P.w / 2, P.y + 6, '#f4faff', Math.round(P.snow * 10), 110, 500);
  P.snow *= 1 - k;
}

function damageEnemy(e, n, source, knock) {
  const def = e.def;
  if (e.dead || def.invulnerable) return;
  if (def.onHit && def.onHit(e, api, source) === false) { Sound.play('clang'); return; } // тема может отказать в уроне (броня, неуязвимая фаза)
  e.hp -= n; e.hit = 0.12;
  if (e.hp > 0) Sound.play(e.isBoss ? 'bossHit' : 'hit');
  burst(e.x + e.w / 2, e.y + e.h / 2, def.hitColor || '#e8d3b0', 8, 160);
  if (knock && def.knockback !== false && !e.isBoss) e.x = clamp(e.x + Math.sign(knock) * (def.heavy ? 10 : 20), Math.min(e.minX, e.x), Math.max(e.maxX - e.w, e.x));
  if (e.hp <= 0) {
    e.dead = true; kills++;
    Sound.play(e.isBoss ? 'explosion' : 'kill');
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
    if (e.def.stompable !== false && !e.def.invulnerable && P.vy > 50 && P.y + P.h - body.y < 16) { Sound.play('stomp'); damageEnemy(e, 1, 'stomp', 0); P.vy = -430; }
    else if (e.def.touchHurts !== false) hurtPlayer(body.x + body.w / 2);
    if (mode !== 'play') return;
  }
  enemies = enemies.filter(e => !e.dead);
}

function reflect(p) { // отбитый рейкой снаряд летит прямо во врага, который его бросил (или вперёд)
  const P = player;
  p.reflected = true; p.gravity = 0; p.life = 3; Sound.play('reflect');
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

function drawLadder(l) { // лестница по умолчанию: стальные тетивы и ступени (тема может нарисовать свою — drawLadder)
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(l.x + 3, l.top, l.w - 2, l.bottom - l.top);
  ctx.fillStyle = '#c9c2b0'; ctx.fillRect(l.x, l.top - 12, 3, l.bottom - l.top + 12); ctx.fillRect(l.x + l.w - 3, l.top - 12, 3, l.bottom - l.top + 12);
  ctx.fillStyle = '#e8e2d0'; for (let y = l.top + 6; y < l.bottom; y += 12) ctx.fillRect(l.x + 2, y, l.w - 4, 3);
  ctx.fillStyle = '#f2c230'; ctx.fillRect(l.x - 1, l.top - 14, 5, 3); ctx.fillRect(l.x + l.w - 4, l.top - 14, 5, 3); // поручни сверху
}

function drawHelmetPickup(k) { // каска-аптечка с ореолом: белая +2, оранжевая +1
  if (k.life !== undefined && k.life < 2 && Math.floor(k.life * 8) % 2) return; // скоро пропадёт — мигает
  const y = k.y + (k.vy !== undefined && !k.rest ? 0 : Math.sin(k.t * 3) * 3), white = k.kind === 'white';
  ctx.save(); ctx.translate(k.x, y);
  ctx.fillStyle = white ? 'rgba(255,255,255,.22)' : 'rgba(255,150,60,.22)'; ctx.beginPath(); ctx.arc(0, -3, 17 + Math.sin(k.t * 5) * 2, 0, 7); ctx.fill();
  ctx.fillStyle = white ? '#f7f7f7' : '#ff8a1a'; ctx.beginPath(); ctx.arc(0, 0, 10, Math.PI, 0); ctx.fill(); ctx.fillRect(-13, -1, 26, 3);
  ctx.fillStyle = white ? '#d0d4d8' : '#c2600e'; ctx.fillRect(-2, -10, 4, 9);
  ctx.fillStyle = '#e53935'; ctx.fillRect(-4, -6, 8, 2); ctx.fillRect(-1, -9, 2, 8); // крестик: восстанавливает здоровье
  if (white) text('+2', 0, -16, 9, '#ffffff'); else text('+1', 0, -16, 9, '#ffd0a0');
  ctx.restore();
}

function drawBlueprint(k) { // рулон чертежей (золотой — из тайника, дороже)
  const y = k.y + Math.sin(k.t * 3) * 3, g = k.gold;
  ctx.save(); ctx.translate(k.x, y);
  if (g) { ctx.fillStyle = `rgba(255,210,74,${0.18 + 0.1 * Math.sin(k.t * 6)})`; ctx.beginPath(); ctx.arc(0, 0, 17, 0, 7); ctx.fill(); }
  ctx.rotate(-0.4);
  ctx.fillStyle = g ? 'rgba(255,220,120,.3)' : 'rgba(126,200,255,.25)'; ctx.fillRect(-14, -7, 28, 14);
  ctx.fillStyle = g ? '#e0a800' : '#2f6fd0'; ctx.fillRect(-11, -4, 22, 8);
  ctx.fillStyle = g ? '#fff3c0' : '#cfe6ff'; ctx.fillRect(-9, -1, 18, 1); ctx.fillRect(-9, 2, 12, 1);
  ctx.fillStyle = g ? '#a87400' : '#1d4f9a'; ctx.beginPath(); ctx.ellipse(11, 0, 2, 4, 0, 0, 7); ctx.fill();
  if (g && Math.sin(k.t * 4) > 0.7) { ctx.fillStyle = '#fff'; ctx.fillRect(-6, -7, 2, 6); ctx.fillRect(-8, -5, 6, 2); } // блик
  ctx.restore();
}

function drawBreakable(s) { // бочка, ящик или кладка с трещинами — всё ломается рейкой
  const now = performance.now() / 1000;
  ctx.save(); ctx.translate(s.x, s.y);
  if (s.hit > 0) ctx.translate(Math.sin(now * 90) * 1.5, 0);
  const dmg = s.maxHp - s.hp;
  if (s.sort === 'barrel') { // металлическая бочка: обручи, крышка, вмятины после удара
    const blue = s.v < 0.5, c = blue ? '#3d6fa8' : '#b0402f', d = blue ? '#28507c' : '#7c2a1e';
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(2, s.h - 2, s.w, 3);
    ctx.fillStyle = c; ctx.fillRect(0, 2, s.w, s.h - 4); ctx.beginPath(); ctx.ellipse(s.w / 2, 3, s.w / 2, 3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = d; ctx.fillRect(0, 8, s.w, 3); ctx.fillRect(0, s.h - 10, s.w, 3); ctx.fillRect(0, s.h - 3, s.w, 3);
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(4, 4, 3, s.h - 8);
    ctx.fillStyle = '#f2c230'; ctx.fillRect(s.w / 2 - 5, 14, 10, 6); ctx.fillStyle = '#222'; ctx.fillRect(s.w / 2 - 1, 15, 2, 4); // табличка «!»
    if (dmg) { ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(s.w - 6, 6); ctx.lineTo(s.w - 10, 12); ctx.lineTo(s.w - 5, 17); ctx.stroke(); }
  } else if (s.sort === 'crate') { // деревянный ящик с распоркой
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(2, s.h - 2, s.w, 3);
    ctx.fillStyle = '#b07a42'; ctx.fillRect(0, 0, s.w, s.h);
    ctx.fillStyle = '#8a5a2b'; ctx.fillRect(0, 0, s.w, 3); ctx.fillRect(0, s.h - 3, s.w, 3); ctx.fillRect(0, 0, 3, s.h); ctx.fillRect(s.w - 3, 0, 3, s.h);
    ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(3, 3); ctx.lineTo(s.w - 3, s.h - 3); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1; for (let y = 9; y < s.h - 3; y += 7) { ctx.beginPath(); ctx.moveTo(3, y); ctx.lineTo(s.w - 3, y); ctx.stroke(); }
  } else { // кладка, закрывающая тайник: трещины, из которых пробивается золотой свет
    ctx.fillStyle = '#8d8173'; ctx.fillRect(0, 0, s.w, s.h);
    ctx.strokeStyle = 'rgba(40,32,24,.45)'; ctx.lineWidth = 1;
    for (let y = 0; y < s.h; y += 9) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s.w, y); ctx.stroke(); const o = (y / 9) % 2 ? 4 : 12; ctx.beginPath(); ctx.moveTo(o, y); ctx.lineTo(o, y + 9); ctx.stroke(); }
    const glow = 0.55 + 0.45 * Math.sin(now * 4 + s.v * 6);
    ctx.strokeStyle = `rgba(255,210,74,${0.25 + 0.35 * glow})`; ctx.lineWidth = 2; ctx.strokeRect(-1, -1, s.w + 2, s.h + 2); // контур светится — видно, что это можно сломать
    const cracks = [[[3, 8], [9, 18], [6, 27], [12, 36], [8, 47]], [[16, 4], [11, 14], [15, 22]], [[4, 40], [10, 44], [17, 52]], [[14, 28], [18, 34], [13, 41]]];
    for (let i = 0; i < Math.min(cracks.length, 2 + dmg); i++) {
      const c = cracks[i];
      ctx.strokeStyle = `rgba(255,210,74,${0.35 * glow})`; ctx.lineWidth = 4; ctx.beginPath(); c.forEach(([x, y], j) => j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      ctx.strokeStyle = '#1e1812'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // трещины переходят на стену — видно издалека; сверху мигает искра
    ctx.strokeStyle = 'rgba(30,24,18,.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(18, 12); ctx.lineTo(28, 6); ctx.lineTo(34, 10); ctx.moveTo(19, 44); ctx.lineTo(30, 48); ctx.stroke();
    const tw = (now * 0.8 + s.v) % 1.6;
    if (tw < 0.5) { const a = Math.sin(tw / 0.5 * Math.PI); ctx.fillStyle = `rgba(255,236,150,${a})`; ctx.beginPath(); const cx = 10, cy = 20, r = 7 * a;
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.25, cy - r * 0.25); ctx.lineTo(cx + r, cy); ctx.lineTo(cx + r * 0.25, cy + r * 0.25); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.25, cy + r * 0.25); ctx.lineTo(cx - r, cy); ctx.lineTo(cx - r * 0.25, cy - r * 0.25); ctx.fill(); }
  }
  ctx.restore();
}

function drawSecret(q) { // открытая ниша: тёмная полость с тёплым светом от золота
  const g = ctx.createLinearGradient(q.x, 0, q.x + q.w, 0);
  g.addColorStop(0, '#1d1510'); g.addColorStop(1, '#3a2a18');
  ctx.fillStyle = g; ctx.fillRect(q.x, q.y, q.w, q.h);
  ctx.fillStyle = 'rgba(255,200,80,.12)'; ctx.fillRect(q.x, q.y + q.h * 0.4, q.w, q.h * 0.6);
  ctx.fillStyle = '#4d443a'; ctx.fillRect(q.x, q.y, q.w, 3); ctx.fillRect(q.x + q.w - 3, q.y, 3, q.h);
  ctx.fillStyle = '#5e5346'; for (let x = q.x + 6; x < q.x + q.w - 8; x += 17) ctx.fillRect(x, q.y + q.h - 4, 9, 4); // обломки на полу
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
  const running = P.onGround && Math.abs(P.vx) > 20 && !P.climb, sw = P.climb ? Math.sin(P.anim * 3) * 0.5 : running ? Math.sin(P.anim * 2) * 0.7 : (P.onGround ? 0 : 0.5);
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
  if (theme.snowy) { // снег на каске, плечах и рукавах
    const k = clamp(P.snow, 0, 1);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(1, -51.5, 5 + 3 * k, 1.5 + 2.2 * k, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(245,250,255,.95)';
    ctx.fillRect(-8, -37 - k * 2, 6, 1.5 + k * 2); ctx.fillRect(3, -37 - k * 2, 5, 1.5 + k * 2);
    if (k > 0.4) { ctx.fillRect(-7, -30, 2, 2); ctx.fillRect(4, -22, 2, 2); ctx.fillRect(-1, -3, 4, 2); }
    if (k > 0.7) { ctx.fillStyle = 'rgba(200,225,255,.6)'; ctx.fillRect(-7, -18, 14, 2); } // иней на куртке
  }
  // рейка: в покое — на плече, при ударе — дуга вперёд
  let ang = P.climb ? -1.35 : -1.9 + (running ? Math.sin(P.anim * 2) * 0.05 : 0); // на лестнице рейка за спиной
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
const SOUND_BTN = () => ({ x: IS_TOUCH ? W - 52 : W - 22, y: 15, r: 12 });
function drawSoundButton() { // динамик: перечёркнут, если звук выключен
  const b = SOUND_BTN(), m = Sound.muted;
  ctx.save(); ctx.translate(b.x, b.y);
  ctx.fillStyle = m ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(-4, -3); ctx.lineTo(1, -8); ctx.lineTo(1, 8); ctx.lineTo(-4, 3); ctx.lineTo(-8, 3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
  if (m) { ctx.strokeStyle = '#ff6b5b'; ctx.beginPath(); ctx.moveTo(4, -5); ctx.lineTo(10, 5); ctx.moveTo(10, -5); ctx.lineTo(4, 5); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(2, 0, 5, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(2, 0, 9, -0.9, 0.9); ctx.stroke(); }
  ctx.restore();
}

function drawHUD() {
  ctx.fillStyle = 'rgba(20,14,10,.55)'; ctx.fillRect(0, 0, W, 30);
  text('Очки: ' + Math.floor(score), 12, 20, 15, '#fff', 'left');
  for (let i = 0; i < 3; i++) { // жизни — каски
    ctx.fillStyle = i < lives ? '#f7f7f7' : 'rgba(255,255,255,.2)';
    ctx.beginPath(); ctx.arc(128 + i * 22, 20, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(120 + i * 22, 19, 16, 2);
  }
  const right = IS_TOUCH ? W - 74 : W - 44; // справа кнопки звука (и паузы на телефоне)
  drawSoundButton();
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
  drawLogo(40, 50, 28);
  drawGroupLink(W / 2, nameForm.hidden ? H - 12 : H - 62, 11);
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
  text(`Финиш +${c.finishBonus} · время +${c.timeBonus} · каски +${c.lifeBonus}` + (c.secretsTotal ? ` · тайники ${c.secrets}/${c.secretsTotal}` : ''), W / 2, 128, 13, '#c9b89e');
  text(`Очки: ${Math.floor(score)}`, W / 2, 152, 16, '#ffd76a');
  text('Далее', W / 2, 190, 12, '#c9b89e');
  text(`Участок ${levelIdx + 2}: ${next.title}`, W / 2, 214, 20, next.accent || '#ffb02e');
  if (next.subtitle) text(next.subtitle, W / 2, 236, 12, '#f1e6d6');
  text(IS_TOUCH ? 'Тап — дальше' : 'Пробел или тап — дальше', W / 2, 272, 13, '#c9b89e');
}

// ---------- логотип и ссылка на группу, для которой сделана игра ----------
const GROUP_URL = 'https://t.me/bearsurveyor';
const logo = new Image(); logo.src = 'img/bear-surveyor.jpg';
function drawLogo(x, y, r) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(x + 2, y + 3, r + 2, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
  if (logo.complete && logo.naturalWidth) ctx.drawImage(logo, x - r, y - r, r * 2, r * 2);
  else { ctx.fillStyle = '#c9ad7f'; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  ctx.restore();
  ctx.strokeStyle = '#c9ad7f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
}
let groupLink = null; // прямоугольник ссылки в текущем кадре — по нему ловится нажатие
function drawGroupLink(x, y, size, align = 'center') {
  const label = 'Игра сделана для группы ', url = 't.me/bearsurveyor';
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  const w1 = ctx.measureText(label).width, w2 = ctx.measureText(url).width, x0 = align === 'center' ? x - (w1 + w2) / 2 : x;
  text(label, x0, y, size, '#c9b89e', 'left');
  text(url, x0 + w1, y, size, '#7ec8ff', 'left');
  ctx.fillStyle = '#7ec8ff'; ctx.fillRect(x0 + w1, y + 2, w2, 1);
  groupLink = { x: x0 - 6, y: y - size - 6, w: w1 + w2 + 12, h: size + 14 };
}
function openGroup() { try { window.open(GROUP_URL, '_blank'); } catch (e) { location.href = GROUP_URL; } }
const inLink = p => groupLink && p.x > groupLink.x && p.x < groupLink.x + groupLink.w && p.y > groupLink.y && p.y < groupLink.y + groupLink.h;

function menuArrows() { return { left: { x: W / 2 - 190, y: 262, r: 16 }, right: { x: W / 2 + 190, y: 262, r: 16 } }; }

function drawMenu() {
  ctx.fillStyle = 'rgba(15,10,8,.72)'; ctx.fillRect(0, 0, W, H);
  drawLogo(W / 2, 50, 34);
  text('LEVEL RUNNER', W / 2, 122, 34, '#ffb02e');
  text('Геодезист сдаёт объект: 10 участков от городской стройки до плотины ГЭС.', W / 2, 148, 13, '#f1e6d6');
  text('Ломай бочки, ищи тайники с золотыми чертежами, в конце — главный инспектор.', W / 2, 166, 13, '#f1e6d6');
  text(IS_TOUCH ? 'Слева — бег и ▼ (спрыгнуть), справа — прыжок и рейка' : '← → бег · пробел прыжок · J удар рейкой · P пауза', W / 2, 188, 12, '#c9b89e');
  drawGroupLink(W / 2, H - 14, 12);
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
  groupLink = null;
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  const bgShift = Math.round(-camY * 0.35); // при подъёме фон чуть опускается (параллакс по вертикали)
  if (bgShift > 0) { ctx.fillStyle = skyTop; ctx.fillRect(0, 0, W, bgShift + 2); } // открывшуюся полосу заливаем цветом верха неба
  ctx.save(); ctx.translate(0, bgShift); theme.drawBackground(ctx, api); ctx.restore();
  ctx.save(); ctx.translate(-Math.round(camX), -Math.round(camY));
  const vis = o => o.x + (o.w || 160) > camX - 80 && o.x < camX + W + 80;
  const T = theme;
  for (const p of pits) if (vis(p)) { ctx.save(); T.drawPit(p, ctx, api); ctx.restore(); }
  for (const p of platforms) if (vis(p)) { ctx.save(); T.drawPlatform(p, ctx, api); ctx.restore(); }
  for (const d of decor) if (vis(d)) { ctx.save(); T.drawDecor(d, ctx, api); ctx.restore(); }
  for (const s of ghosts) if (vis(s)) { ctx.save(); T.drawGround(s, ctx, api); ctx.restore(); } // стены с тайником — целиком
  for (const s of solids) if (vis(s) && !s.hidden && s.kind !== 'breakable') { ctx.save(); (s.kind === 'obstacle' ? T.drawObstacle : T.drawGround)(s, ctx, api); ctx.restore(); }
  for (const q of secrets) if (q.open && vis(q)) drawSecret(q);
  for (const s of solids) if (s.kind === 'breakable' && vis(s)) drawBreakable(s);
  for (const l of ladders) if (vis(l)) { ctx.save(); (T.drawLadder || drawLadder)(l, ctx, api); ctx.restore(); }
  for (const c of checkpoints) if (vis(c)) drawCheckpoint(c);
  if (finishX !== Infinity && finishX > camX - 300 && finishX < camX + W + 300) { ctx.save(); if (T.drawFinish) T.drawFinish(finishX, finishY, ctx, api); ctx.restore(); drawFinishFlag(); }
  for (const k of pickups) if (vis(k) && !(k.secret && !k.secret.open)) drawBlueprint(k);
  for (const k of helmets) if (vis(k) && !(k.secret && !k.secret.open)) drawHelmetPickup(k);
  for (const e of enemies) if (vis(e)) drawEnemy(e);
  for (const p of projectiles) drawProjectile(p);
  if (mode !== 'over') drawPlayer();
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color;
    if (p.chunk) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
    else ctx.fillRect(p.x, p.y, p.size, p.size);
  }
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
  if (mode === 'menu') { reset(menuLevel); mode = 'play'; Sound.play('intro'); if (!practice) newSession(); }
  else if (mode === 'pause') mode = 'play';
  else if (mode === 'play') mode = 'pause';
  else if (performance.now() - overAt < 600) return; // пауза после экрана, чтобы не пролистать его случайно
  else if (mode === 'clear') nextLevel();
  else { mode = 'menu'; menuLevel = startLevel; nameForm.hidden = true; } // после финала — в меню: можно выбрать участок
}
function selectLevel(d) { Sound.play('select');
 const maxSel = Math.max(unlocked, forcedLevel + 1); menuLevel = clamp(menuLevel + d, 0, Math.min(maxSel, THEMES.length) - 1); }
function pressJump() { if (mode === 'play') jumpBuf = JUMP_BUFFER; else startOrToggle(); }
function pressAttack() { if (mode === 'play') attackQueued = true; }

const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowDown: 'down', KeyS: 'down' };
const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW', 'KeyK'];
const UP_KEYS = ['ArrowUp', 'KeyW']; // на лестнице ↑/W — лезть вверх, пробел — спрыгнуть
addEventListener('keydown', e => {
  if (e.target === nameInput) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (mode === 'menu' && KEYMAP[e.code] && !e.repeat) { if (KEYMAP[e.code] !== 'down') selectLevel(KEYMAP[e.code] === 'left' ? -1 : 1); return; }
  if (KEYMAP[e.code]) { kb[KEYMAP[e.code]] = true; syncInput(); return; }
  if (e.repeat) return;
  if (JUMP_KEYS.includes(e.code)) { kb.jump = true; if (UP_KEYS.includes(e.code)) kb.up = true; syncInput(); pressJump(); }
  else if (e.code === 'KeyJ' || e.code === 'KeyX' || e.code === 'KeyF') pressAttack();
  else if (e.code === 'KeyM') Sound.toggleMute();
  else if (e.code === 'KeyP' || e.code === 'Escape') { if (mode === 'play' || mode === 'pause') startOrToggle(); }
  else if (e.code === 'Enter' && mode !== 'play') startOrToggle();
});
addEventListener('keyup', e => {
  if (e.target === nameInput) return;
  if (KEYMAP[e.code]) kb[KEYMAP[e.code]] = false;
  if (JUMP_KEYS.includes(e.code)) kb.jump = false;
  if (UP_KEYS.includes(e.code)) kb.up = false;
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
  input.up = kb.up || held.has('jump'); // на телефоне кнопка прыжка у лестницы — лезть вверх
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  const p = toGame(e);
  const sb = SOUND_BTN();
  if (Math.hypot(p.x - sb.x, p.y - sb.y) < sb.r * 1.8) { Sound.unlock(); Sound.toggleMute(); return; } // кнопка звука работает в любом режиме
  if (mode !== 'play' && inLink(p)) { openGroup(); return; } // ссылка на группу в меню и на финальном экране
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
  Sound.music(levelIdx, mode !== 'pause'); // музыка участка; на паузе молчит
  requestAnimationFrame(frame);
}
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => Sound.unlock(), { capture: true, passive: true }); // звук разрешается первым нажатием

function startGame() {
  if (!THEMES.length) throw new Error('Не загружено ни одной темы');
  layout();
  menuLevel = clamp(PARAMS.has('level') ? forcedLevel : 0, 0, THEMES.length - 1);
  reset(menuLevel);
  last = performance.now();
  requestAnimationFrame(frame);
}
