'use strict';
// Level Runner — геодезист с нивелирной рейкой бежит через стройку.
// Уровень один, но каждый раз генерируется заново. Рейка — оружие, на врагов можно и прыгать сверху.
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
const TICKET = new URLSearchParams(location.search).get('t'); // билет от Telegram-бота
const STORAGE_KEY = 'level-runner-best', NAME_KEY = 'star-dodger-name';
let best = 0;
try { best = +localStorage.getItem(STORAGE_KEY) || 0; } catch (e) {}

// ---------- физика ----------
const GRAVITY = 1800, JUMP_V = 620, RUN = 220, ACCEL = 2200, FRICTION = 2400;
const COYOTE = 0.1, JUMP_BUFFER = 0.12;
const DEATH_Y = H + 60;

// ---------- враги ----------
// hp — сколько ударов выдерживает, pts — очки, w/h — размер
const ENEMY = {
  dog:     { w: 34, h: 22, hp: 1, pts: 100 },
  drone:   { w: 30, h: 14, hp: 1, pts: 150 },
  mixer:   { w: 58, h: 42, hp: 3, pts: 300 },
  foreman: { w: 20, h: 40, hp: 2, pts: 200 },
};

// ---------- состояние ----------
let seed, solids, platforms, pits, decor, pickups, enemies, bricks, checkpoints, particles, popups;
let player, camX, levelEnd, finishX, respawn;
let score, lives, kills, time, shake;
let mode = 'menu'; // menu | play | pause | over | win
let overAt = 0;
let board = null, globalBoard = null, session = null, final = null;

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
layout();

// точка на экране → координаты игры (с учётом поворота сцены)
function toGame(e) {
  let x = e.clientX, y = e.clientY;
  if (rotated) { const t = x; x = y; y = innerWidth - t; }
  else { const r = stage.getBoundingClientRect(); x -= r.left; y -= r.top; }
  return { x: (x - canvas.offsetLeft) / cssScale, y: (y - canvas.offsetTop) / cssScale };
}

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ---------- генерация уровня ----------
function generateLevel(s) {
  const R = mulberry32(s);
  const r = (a, b) => a + R() * (b - a), ri = (a, b) => Math.floor(r(a, b + 1)), pick = arr => arr[Math.floor(R() * arr.length)];
  solids = []; platforms = []; pits = []; decor = []; pickups = []; enemies = []; checkpoints = [];
  const LENGTH = 5600;
  let x = 0, gy = 290, lastCP = 0;

  const ground = (x0, w, y) => solids.push({ x: x0, y, w, h: H + 200 - y, kind: 'ground' });
  const progress = () => x / LENGTH; // сложность растёт к концу уровня

  function decorate(x0, w, y) {
    for (let i = 0; i < ri(0, 2); i++) decor.push({ kind: pick(['cone', 'cone', 'sign', 'sand', 'bags', 'barrel']), x: x0 + r(20, w - 20), y });
  }
  function blueprints(x0, w, y) {
    const n = ri(0, 3), h = r(40, 95);
    for (let i = 0; i < n; i++) pickups.push({ x: x0 + w / 2 + (i - (n - 1) / 2) * 34, y: Math.max(50, y - h), t: R() * 6 });
  }
  function enemiesOn(x0, w, y, extra = 0) {
    const chance = 0.45 + progress() * 0.4 + extra;
    if (x0 < 500 || R() > chance) return;
    const type = pick(progress() < 0.3 ? ['dog', 'dog', 'drone'] : ['dog', 'drone', 'mixer', 'mixer', 'drone']);
    const e = spawnEnemy(type, x0 + r(w * 0.4, w * 0.8), y);
    e.minX = x0 + 6; e.maxX = x0 + w - 6;
  }

  ground(0, 460, gy); decorate(200, 240, gy); x = 460;
  checkpoints.push({ x: 90, y: gy, on: true, start: true });

  while (x < LENGTH) {
    const t = R();
    if (t < 0.24) { // котлован
      const w = ri(70, 112);
      pits.push({ x, w, y: gy });
      x += w;
      gy = clamp(gy + ri(-1, 1) * 28, 235, 305);
      const len = ri(180, 330);
      ground(x, len, gy); decorate(x, len, gy); blueprints(x, len, gy); enemiesOn(x, len, gy);
      x += len;
    } else if (t < 0.44) { // строительные леса: два яруса настилов
      const len = ri(320, 470);
      ground(x, len, gy);
      const px = x + 50, pw = len - 100;
      platforms.push({ x: px, y: gy - 72, w: pw, h: 10, kind: 'scaffold', base: gy });
      if (R() < 0.7) {
        const p2 = { x: px + pw * 0.25, y: gy - 138, w: pw * 0.55, h: 10, kind: 'scaffold', base: gy - 72 };
        platforms.push(p2);
        blueprints(p2.x, p2.w, p2.y);
        if (x > 700 && R() < 0.55 + progress() * 0.3) { const f = spawnEnemy('foreman', p2.x + p2.w * 0.6, p2.y); f.minX = p2.x; f.maxX = p2.x + p2.w; }
      } else blueprints(px, pw, gy - 72);
      enemiesOn(x, len, gy, -0.1);
      x += len;
    } else if (t < 0.58) { // перепад высот
      gy = clamp(gy + (R() < 0.5 ? -1 : 1) * ri(30, 55), 225, 305);
      const len = ri(200, 320);
      ground(x, len, gy); decorate(x, len, gy); blueprints(x, len, gy); enemiesOn(x, len, gy);
      x += len;
    } else if (t < 0.72) { // поддоны с кирпичом
      const len = ri(330, 440);
      ground(x, len, gy);
      const stacks = ri(1, 2), bx = x + len * 0.3; // после поддонов остаётся не меньше ~150 px разбега
      for (let i = 0; i < stacks; i++) solids.push({ x: bx + i * 44, y: gy - 30 * (i + 1), w: 44, h: 30 * (i + 1), kind: 'pallet' });
      pickups.push({ x: bx + stacks * 22, y: gy - 30 * stacks - 50, t: 0 });
      const after = bx + stacks * 44 + 10;
      decorate(x, len * 0.4, gy); if (x + len - after > 80) enemiesOn(after, x + len - after, gy, 0.1);
      x += len;
    } else { // ровный участок
      const len = ri(260, 420);
      ground(x, len, gy); decorate(x, len, gy); blueprints(x, len, gy); enemiesOn(x, len, gy, 0.15);
      x += len;
    }
    if (x - lastCP > 1600 && x < LENGTH - 400) { // чекпоинт — нивелир на штативе
      checkpoints.push({ x: x - 60, y: gy, on: false });
      lastCP = x;
    }
  }
  // финиш: ровная площадка, флаг и прорабская
  ground(x, 900, gy);
  finishX = x + 240;
  levelEnd = x + 700;
  decor.push({ kind: 'cabin', x: x + 380, y: gy });
}

function spawnEnemy(type, x, groundY) {
  const T = ENEMY[type];
  const e = { type, x: x - T.w / 2, y: groundY - T.h, w: T.w, h: T.h, hp: T.hp, dir: Math.random() < 0.5 ? -1 : 1, t: rand(0, 6), hit: 0, cd: rand(1, 2), minX: -1e9, maxX: 1e9 };
  if (type === 'drone') { e.y = groundY - 120 - rand(0, 30); e.baseY = e.y; e.homeX = e.x; e.state = 'hover'; }
  enemies.push(e);
  return e;
}

function reset() {
  seed = (Math.random() * 2 ** 32) >>> 0;
  generateLevel(seed);
  player = { x: 80, y: checkpoints[0].y - 40, w: 18, h: 40, vx: 0, vy: 0, face: 1, onGround: false, coyote: 0, inv: 0, attackT: 0, attackCd: 0, hitSet: null, anim: 0, drop: 0 };
  respawn = { x: 80, y: checkpoints[0].y - 60 };
  bricks = []; particles = []; popups = [];
  camX = 0; score = 0; lives = 3; kills = 0; time = 0; shake = 0;
  board = null; globalBoard = null; final = null;
  nameForm.hidden = true;
}
reset();

// ---------- эффекты ----------
function burst(x, y, color, n = 10, speed = 180, grav = 600) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(40, speed);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: rand(0.3, 0.7), max: 0.7, color, grav, size: rand(2, 4) });
  }
}
function popup(x, y, text, color = '#ffd76a') { popups.push({ x, y, text, color, life: 1 }); }
function addScore(n, x, y) { score += n; popup(x, y, '+' + n); }

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
  // настилы лесов проходимы снизу; сквозь них можно спрыгнуть (↓ + прыжок)
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

function endGame(won) {
  mode = won ? 'win' : 'over'; overAt = performance.now();
  if (won) {
    const timeBonus = Math.max(0, Math.round(2000 - time * 10)), lifeBonus = lives * 300;
    score += 1000 + timeBonus + lifeBonus;
    final = { score: Math.floor(score), duration: time, bonus: { timeBonus, lifeBonus } };
  } else final = { score: Math.floor(score), duration: time };
  if (final.score > best) { best = final.score; try { localStorage.setItem(STORAGE_KEY, best); } catch (e) {} }
  if (TICKET) { submitScore(); submitGlobal(); } else { loadGlobal(); nameForm.hidden = false; }
}

// ---------- игровой цикл ----------
function update(dt) {
  for (const p of particles) { p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  for (const p of popups) { p.y -= 40 * dt; p.life -= dt; }
  popups = popups.filter(p => p.life > 0);
  shake = Math.max(0, shake - dt * 25);
  if (mode !== 'play') return;
  time += dt;
  const P = player;

  // бег
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir) { P.vx = clamp(P.vx + dir * ACCEL * dt, -RUN, RUN); P.face = dir; }
  else { const f = FRICTION * dt; P.vx = Math.abs(P.vx) <= f ? 0 : P.vx - Math.sign(P.vx) * f; }

  // прыжок с «временем койота» и буфером нажатия — управление прощает мелкие промахи
  P.coyote = P.onGround ? COYOTE : P.coyote - dt;
  jumpBuf -= dt; P.drop -= dt;
  if (jumpBuf > 0 && P.coyote > 0) {
    if (input.down && P.onGround && platforms.some(p => Math.abs(P.y + P.h - p.y) < 2 && P.x + P.w > p.x && P.x < p.x + p.w)) { P.drop = 0.25; P.y += 2; }
    else { P.vy = -JUMP_V; burst(P.x + P.w / 2, P.y + P.h, '#b9a58a', 6, 80, 300); }
    jumpBuf = 0; P.coyote = 0;
  }
  if (!input.jumpHeld && P.vy < -250) P.vy = -250; // короткое нажатие — низкий прыжок
  P.vy = Math.min(P.vy + GRAVITY * dt, 900);
  const wasAir = !P.onGround;
  moveX(P, P.vx * dt);
  moveY(P, P.vy * dt);
  if (P.onGround && wasAir && P.vy === 0) burst(P.x + P.w / 2, P.y + P.h, '#b9a58a', 5, 70, 300);
  P.x = clamp(P.x, 0, levelEnd);
  P.anim += Math.abs(P.vx) * dt * 0.05;
  P.inv = Math.max(0, P.inv - dt);

  // удар рейкой: широкая дуга перед геодезистом
  P.attackCd -= dt;
  if (attackQueued && P.attackCd <= 0) { P.attackT = 0.26; P.attackCd = 0.36; P.hitSet = new Set(); }
  attackQueued = false;
  if (P.attackT > 0) {
    P.attackT -= dt;
    const phase = 1 - P.attackT / 0.26;
    if (phase > 0.15 && phase < 0.75) {
      const hb = { x: P.face > 0 ? P.x + P.w / 2 : P.x + P.w / 2 - 78, y: P.y - 22, w: 78, h: P.h + 20 };
      for (const e of enemies) if (!P.hitSet.has(e) && overlap(hb, e)) { P.hitSet.add(e); damageEnemy(e, P.face * 220); }
      for (const b of bricks) if (overlap(hb, b)) { b.dead = true; addScore(10, b.x, b.y); burst(b.x, b.y, '#c0533a', 8); }
    }
  }

  // падение в котлован
  if (P.y > DEATH_Y) {
    lives--; shake = 6;
    if (lives <= 0) { endGame(false); return; }
    Object.assign(P, { x: respawn.x, y: respawn.y, vx: 0, vy: 0, inv: 1.5 });
  }

  updateEnemies(dt);

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
  if (P.x > finishX) { burst(P.x, P.y, '#ffd76a', 40, 260); endGame(true); }

  // камера с небольшим «заглядыванием» вперёд
  const target = clamp(P.x - W * 0.35 + P.face * 40, 0, levelEnd - W);
  camX += (target - camX) * Math.min(1, dt * 6);
}

function damageEnemy(e, knock) {
  e.hp--; e.hit = 0.12;
  burst(e.x + e.w / 2, e.y + e.h / 2, e.type === 'drone' || e.type === 'mixer' ? '#ffd76a' : '#e8d3b0', 8, 160);
  if (e.type !== 'drone') e.x += Math.sign(knock) * (e.type === 'mixer' ? 10 : 20);
  if (e.hp <= 0) {
    e.dead = true; kills++;
    addScore(ENEMY[e.type].pts, e.x + e.w / 2, e.y);
    burst(e.x + e.w / 2, e.y + e.h / 2, '#ffffff', 14, 220);
    shake = Math.max(shake, e.type === 'mixer' ? 7 : 3);
  }
}

function updateEnemies(dt) {
  const P = player, pcx = P.x + P.w / 2;
  for (const e of enemies) {
    e.t += dt; e.hit = Math.max(0, e.hit - dt);
    const ecx = e.x + e.w / 2, dx = pcx - ecx, near = Math.abs(dx) < 240 && Math.abs(P.y - e.y) < 120;
    if (e.type === 'dog') { // патрулирует, а заметив — бросается
      const sp = near ? 190 : 55; if (near) e.dir = Math.sign(dx) || e.dir;
      e.x += e.dir * sp * dt;
      if (e.x < e.minX) { e.x = e.minX; e.dir = 1; } if (e.x + e.w > e.maxX) { e.x = e.maxX - e.w; e.dir = -1; }
    } else if (e.type === 'mixer') { // медленно, но упорно катится к игроку
      if (near) e.dir = Math.sign(dx) || e.dir;
      e.x += e.dir * (near ? 70 : 40) * dt;
      if (e.x < e.minX) { e.x = e.minX; e.dir = 1; } if (e.x + e.w > e.maxX) { e.x = e.maxX - e.w; e.dir = -1; }
    } else if (e.type === 'drone') { // висит, затем пикирует на игрока и возвращается
      if (e.state === 'hover') {
        e.x = e.homeX + Math.sin(e.t * 1.3) * 60; e.y = e.baseY + Math.sin(e.t * 3) * 6;
        e.cd -= dt;
        if (e.cd <= 0 && Math.abs(dx) < 200 && P.y > e.y) { e.state = 'dive'; e.tx = pcx; e.ty = P.y + 10; }
      } else if (e.state === 'dive') {
        const vx = e.tx - ecx, vy = e.ty - e.y, d = Math.hypot(vx, vy);
        if (d < 8) e.state = 'back'; else { e.x += vx / d * 260 * dt; e.y += vy / d * 260 * dt; }
      } else {
        const vx = e.homeX - e.x, vy = e.baseY - e.y, d = Math.hypot(vx, vy);
        if (d < 6) { e.state = 'hover'; e.cd = rand(1.2, 2.2); e.t = 0; } else { e.x += vx / d * 120 * dt; e.y += vy / d * 120 * dt; }
      }
    } else if (e.type === 'foreman') { // стоит на лесах и кидает кирпичи по дуге
      e.dir = Math.sign(dx) || 1;
      e.cd -= dt;
      if (e.cd <= 0 && Math.abs(dx) < 380) {
        e.cd = rand(1.8, 2.6); e.throwT = 0.3;
        const tFlight = clamp(Math.abs(dx) / 260, 0.6, 1.3);
        const vx = dx / tFlight, vy = ((P.y + 20) - e.y - 0.5 * 900 * tFlight * tFlight) / tFlight;
        bricks.push({ x: ecx, y: e.y + 6, w: 14, h: 8, vx, vy, rot: 0 });
      }
      e.throwT = Math.max(0, (e.throwT || 0) - dt);
    }
    // контакт с игроком: прыжок сверху — удар по врагу, иначе урон игроку
    if (!e.dead && overlap(P, e)) {
      if (P.vy > 50 && P.y + P.h - e.y < 16) { damageEnemy(e, 0); P.vy = -430; }
      else hurtPlayer(ecx);
    }
  }
  enemies = enemies.filter(e => !e.dead);
  for (const b of bricks) {
    b.vy += 900 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += dt * 10;
    if (overlap(P, b)) { b.dead = true; hurtPlayer(b.x); }
    for (const s of solids) if (!b.dead && overlap(b, s)) { b.dead = true; burst(b.x, b.y, '#c0533a', 6, 120); }
    if (b.y > H + 50) b.dead = true;
  }
  bricks = bricks.filter(b => !b.dead);
}

// ---------- отрисовка: фон ----------
const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#26325c'); g.addColorStop(0.55, '#c86b5a'); g.addColorStop(1, '#f6b36b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,220,150,.9)'; ctx.beginPath(); ctx.arc(W * 0.78 - camX * 0.02, 150, 34, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,200,120,.25)'; ctx.beginPath(); ctx.arc(W * 0.78 - camX * 0.02, 150, 56, 0, 7); ctx.fill();
}

function drawCity() { // дальний план: город с огнями окон
  const par = 0.15, off = camX * par, step = 46;
  for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
    const h = 60 + hash(i) * 90, x = i * step - off, y = 250 - h;
    ctx.fillStyle = '#3a3552'; ctx.fillRect(x, y, step - 4, h + 60);
    ctx.fillStyle = 'rgba(255,214,120,.55)';
    for (let wy = y + 8; wy < 240; wy += 12) for (let wx = x + 5; wx < x + step - 10; wx += 9) if (hash(i * 131 + wx * 7 + wy) > 0.62) ctx.fillRect(wx, wy, 4, 5);
  }
}

function drawCranes() { // средний план: башенные краны и каркасы домов
  const par = 0.35, off = camX * par, step = 420;
  for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
    const x = i * step - off + hash(i + 7) * 120;
    // каркас недостроенного дома
    const bw = 120 + hash(i + 3) * 60, floors = 4 + Math.floor(hash(i + 5) * 4), bx = x + 90, fh = 22, by = 262;
    ctx.fillStyle = 'rgba(70,62,80,.9)';
    for (let f = 0; f <= floors; f++) ctx.fillRect(bx, by - f * fh, bw, 4);
    for (let c = 0; c <= 4; c++) ctx.fillRect(bx + c * (bw / 4) - 2, by - floors * fh, 5, floors * fh);
    // кран
    const mh = 190 + hash(i + 11) * 40, top = 262 - mh;
    ctx.strokeStyle = '#e0a526'; ctx.lineWidth = 2;
    ctx.strokeRect(x, top, 10, mh);
    ctx.beginPath(); for (let y = top; y < 262; y += 12) { ctx.moveTo(x, y); ctx.lineTo(x + 10, y + 12); } ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 50, top); ctx.lineTo(x + 170, top); ctx.lineTo(x + 170, top + 7); ctx.lineTo(x - 50, top + 7); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 5, top - 22); ctx.lineTo(x + 170, top); ctx.moveTo(x + 5, top - 22); ctx.lineTo(x - 50, top); ctx.stroke();
    ctx.fillStyle = '#6b6470'; ctx.fillRect(x - 48, top + 7, 22, 14); // противовес
    ctx.fillStyle = '#e0a526'; ctx.fillRect(x - 6, top + 8, 18, 12); // кабина
    const hx = x + 110 + Math.sin(performance.now() / 1200 + i) * 30, hy = top + 70 + hash(i) * 40;
    ctx.strokeStyle = '#2b2733'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, top + 7); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = '#2b2733'; ctx.fillRect(hx - 4, hy, 8, 6);
  }
}

function drawFence() { // ближний фон: забор стройплощадки
  const par = 0.6, off = camX * par, step = 70;
  for (let i = Math.floor(off / step) - 1; i < (off + W) / step + 1; i++) {
    const x = i * step - off;
    ctx.fillStyle = i % 2 ? '#3d5a45' : '#355040'; ctx.fillRect(x, 232, step - 2, 60);
    ctx.fillStyle = '#6d7d70'; ctx.fillRect(x, 230, 4, 70);
    if (hash(i + 99) > 0.8) { // баннер
      ctx.fillStyle = '#e8e2d0'; ctx.fillRect(x + 8, 244, step - 18, 18);
      ctx.fillStyle = '#b3261e'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center'; ctx.fillText('СТРОЙКА', x + step / 2 - 5, 256);
    }
  }
}

// ---------- отрисовка: уровень ----------
function drawGround(s) {
  const g = ctx.createLinearGradient(0, s.y, 0, H);
  g.addColorStop(0, '#7a5a3c'); g.addColorStop(1, '#3d2b1d');
  ctx.fillStyle = g; ctx.fillRect(s.x - 0.5, s.y, s.w + 1, H - s.y + 10); // +1 px — без щелей на стыках
  ctx.fillStyle = '#9d917f'; ctx.fillRect(s.x, s.y, s.w, 7); // утрамбованный щебень
  ctx.fillStyle = '#6f6556';
  for (let x = s.x + 3; x < s.x + s.w - 3; x += 7) { const h = hash(Math.floor(x) * 3); ctx.fillRect(x, s.y + 1 + h * 4, 2 + h * 2, 2); }
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  for (let x = s.x + 10; x < s.x + s.w - 10; x += 23) { const h = hash(Math.floor(x)); ctx.fillRect(x, s.y + 18 + h * 50, 5 + h * 6, 3); }
}

function drawPit(p) { // котлован: арматура и лента-ограждение по краям
  ctx.fillStyle = '#1d1510'; ctx.fillRect(p.x, p.y, p.w, H);
  ctx.strokeStyle = '#8a4a2a'; ctx.lineWidth = 2;
  for (let x = p.x + 8; x < p.x + p.w - 4; x += 12) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + 2, H - 30 - hash(Math.floor(x)) * 20); ctx.stroke(); }
  // полосатый барьер на краю котлована
  const bx = p.x - 26;
  ctx.fillStyle = '#ddd'; ctx.fillRect(bx, p.y - 18, 2, 18); ctx.fillRect(bx + 18, p.y - 18, 2, 18);
  for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#111' : '#f2c230'; ctx.fillRect(bx - 2 + i * 5, p.y - 20, 5, 6); }
}

function drawPallet(s) { // поддон с кирпичом
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

function drawScaffold(p) { // строительные леса: трубы, раскосы, дощатый настил
  ctx.strokeStyle = '#5c7fb0'; ctx.lineWidth = 3;
  const posts = Math.max(2, Math.round(p.w / 70));
  for (let i = 0; i <= posts; i++) { const x = p.x + i * p.w / posts; ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.base); ctx.stroke(); }
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(92,127,176,.8)';
  for (let i = 0; i < posts; i++) { const x = p.x + i * p.w / posts; ctx.beginPath(); ctx.moveTo(x, p.base); ctx.lineTo(x + p.w / posts, p.y + 10); ctx.stroke(); }
  ctx.fillStyle = '#c98a4b'; ctx.fillRect(p.x - 6, p.y, p.w + 12, 7);
  ctx.fillStyle = '#8e5c2c'; for (let x = p.x; x < p.x + p.w; x += 24) ctx.fillRect(x, p.y, 1, 7);
  ctx.fillStyle = '#5c7fb0'; ctx.fillRect(p.x - 6, p.y - 16, p.w + 12, 2); // перила
}

function drawDecor(d) {
  const x = d.x, y = d.y;
  if (d.kind === 'cone') {
    ctx.fillStyle = '#ff6d1a'; ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x, y - 20); ctx.lineTo(x + 7, y); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 4, y - 11, 8, 3); ctx.fillStyle = '#333'; ctx.fillRect(x - 9, y - 2, 18, 2);
  } else if (d.kind === 'sign') {
    ctx.fillStyle = '#666'; ctx.fillRect(x - 1, y - 30, 2, 30);
    ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.moveTo(x, y - 48); ctx.lineTo(x + 13, y - 26); ctx.lineTo(x - 13, y - 26); ctx.fill();
    ctx.fillStyle = '#111'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', x, y - 29);
  } else if (d.kind === 'sand') {
    ctx.fillStyle = '#d9b77a'; ctx.beginPath(); ctx.ellipse(x, y, 26, 14, 0, Math.PI, 0); ctx.fill();
  } else if (d.kind === 'bags') {
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i % 2 ? '#cfc6b3' : '#bfb49e'; ctx.fillRect(x - 16 + (i % 2) * 8, y - 8 - Math.floor(i / 2) * 8, 18, 8); }
  } else if (d.kind === 'barrel') {
    ctx.fillStyle = '#2f6db3'; ctx.fillRect(x - 8, y - 22, 16, 22); ctx.fillStyle = '#244f80'; ctx.fillRect(x - 8, y - 16, 16, 2); ctx.fillRect(x - 8, y - 8, 16, 2);
  } else if (d.kind === 'cabin') { // прорабская
    ctx.fillStyle = '#2f6db3'; ctx.fillRect(x, y - 70, 130, 70);
    ctx.fillStyle = '#244f80'; for (let i = 0; i < 130; i += 10) ctx.fillRect(x + i, y - 70, 2, 70);
    ctx.fillStyle = '#bfe3ff'; ctx.fillRect(x + 14, y - 52, 34, 22);
    ctx.fillStyle = '#6b4a2f'; ctx.fillRect(x + 88, y - 56, 24, 56);
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 20, y - 84, 92, 16);
    ctx.fillStyle = '#b3261e'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText('ПРОРАБСКАЯ', x + 66, y - 72);
  }
}

function drawCheckpoint(c) { // нивелир на штативе
  const x = c.x, y = c.y;
  ctx.strokeStyle = '#d9c24a'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x, y - 46); ctx.lineTo(x - 14, y); ctx.moveTo(x, y - 46); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 46); ctx.lineTo(x + 2, y); ctx.stroke();
  ctx.fillStyle = '#6b6b6b'; ctx.fillRect(x - 8, y - 50, 16, 4);
  ctx.fillStyle = c.on ? '#3cb371' : '#f2c230'; ctx.fillRect(x - 11, y - 62, 22, 12); // корпус нивелира
  ctx.fillStyle = '#333'; ctx.fillRect(x - 15, y - 60, 6, 7); ctx.fillStyle = '#9fd3ff'; ctx.fillRect(x + 11, y - 59, 4, 5); // окуляр и объектив
  if (c.on && !c.start) { ctx.fillStyle = '#6cff8a'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.fillText('✓', x, y - 70); }
}

function drawFinish() {
  const x = finishX, gy = solids[solids.length - 1].y;
  ctx.fillStyle = '#ddd'; ctx.fillRect(x, gy - 110, 4, 110);
  const wave = Math.sin(performance.now() / 200) * 4;
  ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.moveTo(x + 4, gy - 110); ctx.quadraticCurveTo(x + 24, gy - 104 + wave, x + 44, gy - 106); ctx.lineTo(x + 44, gy - 84); ctx.quadraticCurveTo(x + 24, gy - 82 + wave, x + 4, gy - 88); ctx.fill();
  for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; ctx.fillRect(x - 14 + i * 4, gy + j * 4, 4, 4); } // финишная клетка
}

function drawBlueprint(k) { // рулон чертежей
  const y = k.y + Math.sin(k.t * 3) * 3;
  ctx.save(); ctx.translate(k.x, y); ctx.rotate(-0.4);
  ctx.shadowColor = '#7ec8ff'; ctx.shadowBlur = 10;
  ctx.fillStyle = '#2f6fd0'; ctx.fillRect(-11, -4, 22, 8);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#cfe6ff'; ctx.fillRect(-9, -1, 18, 1); ctx.fillRect(-9, 2, 12, 1);
  ctx.fillStyle = '#1d4f9a'; ctx.beginPath(); ctx.ellipse(11, 0, 2, 4, 0, 0, 7); ctx.fill();
  ctx.restore();
}

// ---------- отрисовка: персонажи ----------
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
  const cx = e.x + e.w / 2, by = e.y + e.h;
  ctx.save(); ctx.translate(cx, by);
  const face = e.type === 'drone' ? 1 : (e.dir || 1);
  ctx.scale(face, 1);
  if (e.type === 'dog') {
    const leg = Math.sin(e.t * 16) * 4;
    ctx.fillStyle = '#8d5a2b'; ctx.fillRect(-12, -16, 22, 10);
    ctx.fillRect(-10 + leg, -7, 3, 7); ctx.fillRect(4 - leg, -7, 3, 7);
    ctx.beginPath(); ctx.arc(12, -17, 7, 0, 7); ctx.fill();
    ctx.fillStyle = '#6b4220'; ctx.fillRect(8, -26, 4, 6); ctx.fillRect(16, -12, 6, 3);
    ctx.strokeStyle = '#8d5a2b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-12, -14); ctx.lineTo(-18, -20 + Math.sin(e.t * 20) * 3); ctx.stroke();
    ctx.fillStyle = '#ff3b3b'; ctx.fillRect(13, -20, 3, 2);
    ctx.fillStyle = '#d32f2f'; ctx.fillRect(3, -17, 4, 7); // ошейник
  } else if (e.type === 'drone') {
    ctx.fillStyle = '#4a4f5a'; ctx.fillRect(-10, -12, 20, 8);
    ctx.fillStyle = '#2a2d33'; ctx.fillRect(-15, -14, 30, 2);
    ctx.fillStyle = 'rgba(200,210,220,.6)';
    for (const rx of [-15, 15]) { ctx.beginPath(); ctx.ellipse(rx, -15, 8 * Math.abs(Math.sin(e.t * 40)) + 2, 1.5, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = Math.sin(e.t * 8) > 0 ? '#ff2d2d' : '#661111'; ctx.fillRect(-2, -12, 4, 3);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, -3, 3, 0, 7); ctx.fill();
  } else if (e.type === 'mixer') {
    ctx.fillStyle = '#333'; for (const wx of [-18, 16]) { ctx.beginPath(); ctx.arc(wx, -7, 7, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#555'; ctx.fillRect(-27, -16, 54, 8);
    ctx.fillStyle = '#f2c230'; ctx.fillRect(14, -34, 14, 20); ctx.fillStyle = '#9fd3ff'; ctx.fillRect(18, -31, 8, 7); // кабина
    // вращающийся барабан
    ctx.save(); ctx.translate(-5, -28); ctx.rotate(-0.3);
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 13, 0, 0, 7); ctx.fillStyle = '#e8e4da'; ctx.fill(); ctx.clip();
    ctx.fillStyle = '#ff7a1a';
    for (let i = -3; i < 4; i++) { const o = ((e.t * 30) % 16) + i * 16; ctx.beginPath(); ctx.moveTo(o - 6, -14); ctx.lineTo(o + 2, -14); ctx.lineTo(o - 6, 14); ctx.lineTo(o - 14, 14); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = '#b3261e'; ctx.fillRect(-12, -32, 5, 3); ctx.fillRect(-2, -32, 5, 3); // злые глаза
    for (let i = 0; i < ENEMY.mixer.hp - e.hp; i++) { ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-15 + i * 8, -38); ctx.lineTo(-10 + i * 8, -26); ctx.stroke(); } // трещины
  } else if (e.type === 'foreman') {
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
  }
  ctx.restore();
}

function drawBrick(b) {
  ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
  ctx.fillStyle = '#b5503a'; ctx.fillRect(-7, -4, 14, 8); ctx.fillStyle = '#8a3522'; ctx.fillRect(-7, 2, 14, 2);
  ctx.restore();
}

// ---------- интерфейс ----------
function text(str, x, y, size, color = '#fff', align = 'center') {
  ctx.fillStyle = color; ctx.font = `bold ${size}px system-ui, sans-serif`; ctx.textAlign = align; ctx.fillText(str, x, y);
}

function drawHUD() {
  ctx.fillStyle = 'rgba(20,14,10,.55)'; ctx.fillRect(0, 0, W, 30);
  text('Очки: ' + Math.floor(score), 12, 20, 15, '#fff', 'left');
  for (let i = 0; i < 3; i++) { // жизни — каски
    ctx.fillStyle = i < lives ? '#f7f7f7' : 'rgba(255,255,255,.2)';
    ctx.beginPath(); ctx.arc(128 + i * 22, 20, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(120 + i * 22, 19, 16, 2);
  }
  // прогресс до финиша
  const right = IS_TOUCH ? W - 46 : W - 12; // на телефоне справа кнопка паузы
  const px = 205, pw = clamp(right - 150 - px, 120, 320), prog = clamp(player.x / finishX, 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(px, 13, pw, 4);
  ctx.fillStyle = '#ffb02e'; ctx.fillRect(px, 13, pw * prog, 4);
  for (const c of checkpoints) if (!c.start) { ctx.fillStyle = c.on ? '#6cff8a' : '#aaa'; ctx.fillRect(px + pw * c.x / finishX - 1, 9, 2, 12); }
  ctx.fillStyle = '#e53935'; ctx.fillRect(px + pw - 2, 6, 6, 6);
  ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(px + pw * prog, 15, 5, 0, 7); ctx.fill();
  text(`${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`, right, 20, 14, '#f1e6d6', 'right');
  text('Рекорд: ' + best, right - 48, 20, 12, '#c9b89e', 'right');
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
  ctx.fillStyle = 'rgba(15,10,8,.84)'; ctx.fillRect(0, 0, W, H);
  const won = mode === 'win';
  text(won ? 'ОБЪЕКТ СДАН!' : 'СМЕНА ОКОНЧЕНА', W / 2, 52, 30, won ? '#6cff8a' : '#ffb02e');
  let line = `Очки: ${final.score}   Рекорд: ${best}   Врагов: ${kills}   Время: ${Math.floor(time)} с`;
  text(line, W / 2, 80, 14, '#f1e6d6');
  if (won) text(`Бонусы: финиш +1000 · время +${final.bonus.timeBonus} · каски +${final.bonus.lifeBonus}`, W / 2, 100, 12, '#c9b89e');
  text((IS_TOUCH ? 'Тап' : 'Пробел или тап') + ' — новая смена (новый участок)', W / 2, won ? 122 : 104, 12, '#c9b89e');
  const y = 150, ox = (W - 640) / 2;
  if (TICKET) { drawTable(globalBoard, 'Мировой рейтинг', ox + 40, ox + 300, y); drawTable(board, 'Рекорды чата', ox + 340, ox + 600, y); }
  else {
    drawTable(globalBoard, 'Мировой рейтинг', ox + 190, ox + 450, y, 5); // внизу остаётся место для поля имени
    if (!nameForm.hidden) text('Введите имя, чтобы попасть в рейтинг', W / 2, y + 128, 12, '#c9b89e');
  }
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
  drawSky(); drawCity(); drawCranes(); drawFence();
  ctx.save(); ctx.translate(-Math.round(camX), 0);
  const vis = o => o.x + (o.w || 140) > camX - 60 && o.x < camX + W + 60;
  for (const p of pits) if (vis(p)) drawPit(p);
  for (const p of platforms) if (vis(p)) drawScaffold(p);
  for (const d of decor) if (vis(d)) drawDecor(d);
  for (const s of solids) if (vis(s)) (s.kind === 'pallet' ? drawPallet : drawGround)(s);
  for (const c of checkpoints) if (vis(c)) drawCheckpoint(c);
  drawFinish();
  for (const k of pickups) if (vis(k)) drawBlueprint(k);
  for (const e of enemies) if (vis(e)) drawEnemy(e);
  for (const b of bricks) drawBrick(b);
  if (mode !== 'over') drawPlayer();
  for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }
  ctx.globalAlpha = 1;
  for (const p of popups) { ctx.globalAlpha = Math.min(1, p.life / 0.4); text(p.text, p.x, p.y, 13, p.color); }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.restore();
  drawHUD();
  if (IS_TOUCH && mode === 'play') drawControls();
  const how = IS_TOUCH ? 'Слева — бег и ▼ (спрыгнуть с лесов), справа — прыжок и рейка' : '← → бег · пробел прыжок · J удар рейкой';
  if (mode === 'menu') overlay('LEVEL RUNNER', ['Геодезист спешит сдать объект. Беги через стройку,', 'отбивайся нивелирной рейкой, собирай чертежи.', how, `Участок № ${seed % 10000}`], IS_TOUCH ? 'Тап — начать смену' : 'Пробел или тап — начать смену');
  if (mode === 'pause') overlay('ПАУЗА', [], IS_TOUCH ? 'Тап — продолжить' : 'P, пробел или тап — продолжить');
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
  if (mode === 'menu') { mode = 'play'; newSession(); }
  else if (mode === 'pause') mode = 'play';
  else if (mode === 'play') mode = 'pause';
  else if (performance.now() - overAt > 700) { reset(); mode = 'play'; newSession(); } // пауза после финала, чтобы не перезапустить случайно
}
function pressJump() { if (mode === 'play') jumpBuf = JUMP_BUFFER; else startOrToggle(); }
function pressAttack() { if (mode === 'play') attackQueued = true; }

const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowDown: 'down', KeyS: 'down' };
const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW', 'KeyK'];
addEventListener('keydown', e => {
  if (e.target === nameInput) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
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

let last = performance.now();
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  while (dt > 0) { const step = Math.min(dt, 1 / 60); update(step); dt -= step; } // мелкие шаги — стабильная физика
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
