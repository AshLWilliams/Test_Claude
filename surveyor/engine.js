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
const FH = 176, SLAB_T = 24; // здание (gen.indoor): высота этажа и толщина перекрытия (в свету — 152, прыжок не упирается в потолок)
const DEEP = 560;        // насколько ниже кадра уходит земля на участках с подземельем (gen.underground)
const TUN_H = 118, TUN_SLAB = 34; // ярус подземелья: высота от пола до пола и толщина перекрытия

// ---------- темы ----------
const THEMES = [];
function registerTheme(t) { THEMES.push(t); THEMES.sort((a, b) => a.index - b.index); }

// параметры генератора по умолчанию; тема может переопределить их в gen
const GEN = {
  length: 3800,                                                   // базовая длина участка до финиша (умножается на LENGTH_SCALE)
  weights: { pit: 24, platforms: 20, step: 14, obstacle: 14, flat: 28, wall: 9, tower: 8, under: 0 }, // частоты видов отрезков
  pitW: [70, 112],                                                // ширина провалов
  groundRange: [225, 305],                                        // высота земли
  upperChance: 0.7,                                               // вероятность второго яруса платформ
  enemyDensity: 1,                                                // множитель плотности врагов
  hazardChance: 0.35,                                             // вероятность статичной опасности на ровном отрезке
  obstacleH: 30, obstacleW: 44,                                   // размер блока препятствия (стопки 1–2 блока)
  decorCount: [0, 2],
  friction: 1,                                                    // <1 — скользко (лёд)
  boss: null,                                                     // { type, arenaW } — вместо финиша арена с боссом
  underground: null,                                              // 'metro' | 'mine' — часть провалов ведёт в подземный ход
  indoor: false,                                                  // true — участок внутри здания: этажи, финиш на крыше
  breakables: ['crate', 'barrel'],                                // какие разрушаемые предметы стоят на участке (см. BREAKABLES)
  foreman: false,                                                 // true — на участке бегает разгневанный прораб
};

// ---------- состояние ----------
let levelIdx = 0, startLevel = 0, practice = false, theme = null, G = GEN;
let skyTop = '#000';
let seed, solids, platforms, pits, decor, pickups, enemies, projectiles, checkpoints, particles, popups, ladders, helmets;
let ghosts, secrets, hintsShown = new Set();
let tunnels = [], rooms = [], crowds = []; // подземные ходы, этажи здания, толпы рабочих на заднем плане
let treasures = [], relicTaken = false, relicPlaced = false, maxLives = 3; // клады подземелья; Золотая каска даёт 4 каски до конца смены // ghosts — стены с тайником (рисуются целиком, сталкиваемся по кускам); secrets — ниши-тайники
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
  hurtPlayer: (fromX, dmg) => hurtPlayer(fromX, dmg),
  groundBelow: (x, y) => groundBelow(x, y), solidAt: (x, y) => solidAt(x, y),
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
  get tunnels() { return tunnels; }, get rooms() { return rooms; },
};
const apiDeep = Object.create(api, { H: { value: H + DEEP } }); // для отрисовки земли на участках с подземельем

// ---------- генерация участка ----------
function generateLevel(s) {
  const R = mulberry32(s);
  const r = (a, b) => a + R() * (b - a), ri = (a, b) => Math.floor(r(a, b + 1)), pick = arr => arr[Math.floor(R() * arr.length)];
  solids = []; platforms = []; pits = []; decor = []; pickups = []; enemies = []; checkpoints = []; ladders = []; helmets = []; ghosts = []; secrets = [];
  tunnels = []; rooms = []; crowds = []; treasures = []; relicPlaced = false;
  arena = null;
  const bottom = H + (G.underground ? DEEP : 200); // низ земли: под подземельем она уходит глубже кадра
  let floorStart = 0, floorLen = ri(900, 1250);   // здание: где начался текущий этаж и какой он длины
  const floorsInfo = [];                            // этажи здания: { y, start, end } — новая часть каждого этажа
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
    solids.push({ x: x0, y, w, h: bottom - y, kind: 'ground' });
  };
  const progress = () => x / LENGTH; // сложность растёт к концу участка
  const decorKinds = theme.decor && theme.decor.length ? theme.decor : null;

  function decorate(x0, w, y) {
    if (!decorKinds) return;
    const n = ri(G.decorCount[0], G.decorCount[1]) + (R() < 0.5 ? 1 : 0); // окружения стало больше
    for (let i = 0; i < n; i++) decor.push({ kind: pick(decorKinds), x: x0 + r(20, w - 20), y, v: R() });
  }
  function blueprints(x0, w, y, maxH = 95) {
    const n = ri(0, 3), h = r(40, Math.max(41, maxH));
    for (let i = 0; i < n; i++) pickups.push({ x: x0 + w / 2 + (i - (n - 1) / 2) * 34, y: Math.max(y < 120 ? -5000 : 50, y - h), t: R() * 6 });
  }
  function helmet(x0, y, chanceWhite) { // каска восстанавливает жизни: белая — две, оранжевая — одну; встречаются редко
    helmets.push({ x: x0, y: y - 26, kind: R() < chanceWhite ? 'white' : 'orange', t: R() * 6 });
  }
  const ladder = (lx, top, bottom, wall = false) => ladders.push({ x: lx, w: 22, top, bottom, wall, v: R() });
  function crates(x0, y, xEnd = Infinity) { // разрушаемые предметы участка (1–3 одинаковых рядом): одни ломаются с удара, другие — с нескольких; возвращает правый край
    const kinds = (G.breakables || ['crate']).filter(k => BREAKABLES[k]), sort = pick(kinds), b = BREAKABLES[sort];
    const n = R() < 0.3 ? 2 : R() < 0.12 ? 3 : 1; // одинаковые — одной высоты, чтобы поверху не спотыкаться
    if (x0 + n * (b.w + 2) > xEnd - 170) return x0; // после предмета нужен разбег до края отрезка (там может быть провал)
    for (let i = 0; i < n; i++) {
      const l = R();
      solids.push({ x: x0, y: y - b.h, w: b.w, h: b.h, kind: 'breakable', sort, hp: b.hp, maxHp: b.hp, v: R(), hit: 0,
        loot: l < 0.35 ? 'blueprint' : l < 0.43 ? 'helmet' : null });
      x0 += b.w + 2;
    }
    return x0;
  }
  function crowd(x0, w, y) { // бригада рабочих на заднем плане
    if (w < 240 || R() > 0.5) return;
    const n = ri(3, 7), sp = ambOf().special, type = sp && R() < sp.chance ? sp.type : 'workers'; // иногда вместо бригады — особая компания
    crowds.push({ x: x0 + r(20, Math.max(21, w - n * 20 - 110)), y, n, seed: Math.floor(R() * 1e6), type, x0, x1: x0 + w }); // x0..x1 — свой отрезок земли
  }
  function tunnel() { // подземный ход: под верхним тоннелем — ещё ярусы вниз; в тупиках нижних ярусов — завалы и клады
    const first = !tunnels.length, len = first ? ri(1900, 2500) : ri(1300, 1800), top = gy, deep = first ? ri(3, 4) : ri(2, 3); // первый ход на участке — самый длинный и глубокий
    const holes = []; let hx = x + ri(170, 260);
    while (hx < x + len - 420) { const w = ri(70, 100); holes.push([hx, w]); hx += w + ri(300, 520); }
    const exitX = x + len - 60;
    holes.push([exitX, 30]); // шахта выхода с лестницей
    let sx = x;
    for (const [h0, hw] of holes) {
      if (h0 > sx) { solids.push({ x: sx, y: top, w: h0 - sx, h: TUN_SLAB, kind: 'ground', slab: true, v: R() }); decorate(sx, h0 - sx, top); enemiesOn(sx, h0 - sx, top, -0.2); }
      if (hw > 40 && R() < 0.4) ladder(h0 + hw / 2 - 11, top, top + TUN_H, true); // под некоторыми дырами — лестница обратно наверх
      sx = h0 + hw;
    }
    solids.push({ x: sx, y: top, w: x + len - sx, h: TUN_SLAB, kind: 'ground', slab: true, v: R() });
    ladder(exitX + 4, top, top + TUN_H, true);
    tunLevel(x, x + len, top, 1, deep, holes, first);
    x += len; prevGy = null;
    ground(x, 220, gy); decorate(x, 220, gy); x += 220; // после выхода наверх — разбег перед следующим провалом
  }
  // один ярус подземелья [a, b]: потолок — перекрытие на высоте top с дырами topHoles; пол — земля или перекрытие над следующим ярусом
  function tunLevel(a, b, top, depth, maxDepth, topHoles, first) {
    const floor = top + TUN_H, t = { x1: a, x2: b, top, slabBot: top + TUN_SLAB, floor, depth, v: R() };
    tunnels.push(t);
    const vault = depth >= 2; // нижние ярусы: справа тупик-сокровищница за завалом
    let sub = null;
    if (depth < maxDepth) {
      const sa = a + ri(150, 260), sb = b - (vault ? ri(330, 420) : ri(150, 260));
      if (sb - sa >= 520) sub = [sa, sb];
    }
    const pieces = []; // куски пола, на которых можно стоять: [x0, x1]
    // дыры вниз — все с лестницами; не под дырами потолка (иначе пролетишь два яруса и разобьёшься) и не над сокровищницей следующего яруса
    const fh = [];
    if (sub) {
      const far = sub[1] - 300, clash = (hx, w) => topHoles.find(([h0, hw]) => hx < h0 + hw + 70 && hx + w > h0 - 70);
      for (let hx = sub[0] + ri(60, 120); hx < far;) {
        const w = ri(60, 86), c = clash(hx, w);
        if (c) { hx = c[0] + c[1] + 71; continue; } // сдвигаемся за дыру потолка
        if (hx + w > far) break;
        fh.push([hx, w]); hx += w + ri(200, 320);
      }
      if (!fh.length) for (let hx = sub[0] + 30; hx + 70 < far; hx += 8) if (!clash(hx, 70)) { fh.push([hx, 70]); break; }
      if (!fh.length) sub = null; // некуда пробить проём — ярус ниже не строим
    }
    if (sub) {
      solids.push({ x: a, y: floor, w: sub[0] - a, h: bottom - floor, kind: 'ground', under: true, v: R() });
      solids.push({ x: sub[1], y: floor, w: b - sub[1], h: bottom - floor, kind: 'ground', under: true, v: R() });
      pieces.push([a, sub[0]], [sub[1], b]);
      let sx = sub[0];
      for (const [h0, hw] of fh) {
        if (h0 > sx) { solids.push({ x: sx, y: floor, w: h0 - sx, h: TUN_SLAB, kind: 'ground', slab: true, under: true, v: R() }); pieces.push([sx, h0]); }
        ladder(h0 + hw / 2 - 11, floor, floor + TUN_H, true);
        sx = h0 + hw;
      }
      solids.push({ x: sx, y: floor, w: sub[1] - sx, h: TUN_SLAB, kind: 'ground', slab: true, under: true, v: R() }); pieces.push([sx, sub[1]]);
      tunLevel(sub[0], sub[1], floor, depth + 1, maxDepth, fh, first);
    } else {
      solids.push({ x: a, y: floor, w: b - a, h: bottom - floor, kind: 'ground', under: true, v: R() });
      pieces.push([a, b]);
    }
    // сокровищница: завал поперёк хода (5–10 ударов), за ним клад или Золотая каска, рядом — охрана
    let vx0 = b;
    if (vault) {
      const rw = 34, rx = b - ri(200, 240), deepest = !sub; // самый нижний ярус этого хода
      vx0 = rx;
      solids.push({ x: rx, y: t.slabBot, w: rw, h: floor - t.slabBot, kind: 'breakable', sort: 'rubble', hp: ri(5, 10), maxHp: 0, v: R(), hit: 0 });
      solids[solids.length - 1].maxHp = solids[solids.length - 1].hp;
      const relic = deepest && first && !relicTaken && !relicPlaced; // Золотая каска — в самом глубоком тупике первого хода
      if (relic) relicPlaced = true;
      treasures.push({ x: b - 70, y: floor - 22, kind: relic ? 'relic' : pick(theme.id === 'mine' ? ['nugget', 'lamp', 'theodolite', 'benchmark'] : ['coins', 'tokens', 'theodolite', 'benchmark']), t: R() * 6 });
      if (deepest && R() < 0.6) treasures.push({ x: b - 130, y: floor - 22, kind: pick(['map', 'benchmark']), t: R() * 6 });
      const o = pickType(['ground']);
      if (o && (deepest || R() < 0.5)) spawnEnemy(o.type, rx + rw + 60, floor, { minX: rx + rw + 8, maxX: b - 6, groundY: floor }); // сторож внутри
      for (let k = 0; k < (deepest ? 2 : 1); k++) { // охрана перед завалом
        const g = pickType(['ground']);
        if (g) spawnEnemy(g.type, rx - 70 - k * 110, floor, { minX: Math.max(a + 10, rx - 260), maxX: rx - 6, groundY: floor });
      }
    }
    // наполнение яруса: враги, ящики, чертежи; на первом ярусе — бригада проходчиков и каска
    for (const [p0, p1] of pieces) {
      const q1 = Math.min(p1, vx0 - 10);
      for (let ux = p0 + 50; ux < q1 - 200; ux += ri(300, 420)) {
        const w = Math.min(300, q1 - 60 - ux);
        if (w < 140) break;
        const ex = R() < 0.5 ? crates(ux + r(10, 60), floor, q1 + 170) + 20 : ux;
        enemiesOn(ex, ux + w - ex, floor, depth > 1 ? 0.25 : 0.1, true);
        blueprints(ux, w, floor);
        if (depth === 1) crowd(ux, w, floor);
      }
    }
    if (depth === 1 && R() < 0.45) helmet(a + (b - a) * r(0.3, 0.7), floor, 0.3);
    else if (depth > 1 && R() < 0.35) helmet(a + (vx0 - a) * r(0.2, 0.6), floor, 0.4);
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
  function enemiesOn(x0, w, y, extra = 0, groundOnly = false) {
    const chance = (0.42 + progress() * 0.35 + levelIdx * 0.02 + extra) * G.enemyDensity;
    if (x0 < 500 || w < 60 || R() > chance) return;
    const o = pickType(groundOnly ? ['ground'] : ['ground', 'air']);
    if (!o) return;
    const air = o.where === 'air';
    const ex = x0 + r(w * 0.4, w * 0.8);
    spawnEnemy(o.type, ex, air ? y - (G.indoor ? 88 + r(0, 12) : 110 + r(0, 40)) : y, { minX: x0 + 6, maxX: x0 + w - 6, air, groundY: y }); // в здании летают под потолком
  }
  function hazardOn(x0, w, y) { // статичная опасность посередине ровного отрезка — её надо перепрыгнуть
    if (x0 < 600 || w < 260 || R() > G.hazardChance) return false;
    const o = pickType(['hazard']);
    if (!o) return false;
    const e = spawnEnemy(o.type, x0 + w / 2, y, { minX: x0 + w / 2 - 40, maxX: x0 + w / 2 + 40, groundY: y, hazard: true });
    if (e.w > MAX_HAZARD_W) { e.x += (e.w - MAX_HAZARD_W) / 2; e.w = MAX_HAZARD_W; }
    return true;
  }

  // здание: у каждого этажа новая часть справа (сгенерирована основным циклом) и старая слева — перекрытие над этажом ниже.
  // Этажи связаны лестницами с люками; в перекрытиях есть проёмы вниз. Над последним этажом — открытая крыша.
  function building() {
    const F = floorsInfo.concat([{ y: gy, start: floorStart, end: Infinity }]), saveX = x;
    let belowHoles = [];
    rooms = F.slice(0, -1).map((f, k) => ({ x1: 0, x2: f.end, y: f.y, top: F[k + 1].y + SLAB_T }));
    for (let k = 1; k < F.length; k++) {
      const f = F[k], below = F[k - 1], y = f.y, L = f.start; // перекрытие над этажом ниже: [0, L]
      const holes = [[L - 30, 30, 'hatch']]; // проём над лестницей перехода
      const shafts = pits.filter(p => p.x < L + 40);
      const free = (h0, hw, m) => !holes.some(([a, w]) => h0 < a + w + m && h0 + hw > a - m) && !shafts.some(p => h0 < p.x + p.w + 70 && h0 + hw > p.x - 70)
        && !belowHoles.some(([a, w]) => h0 < a + w + 70 && h0 + hw > a - 70) // не над проёмом этажом ниже — иначе пролетишь два этажа
        && !solids.some(s => (s.kind === 'obstacle' || s.kind === 'breakable') && Math.abs(s.y + s.h - below.y) < 2 && s.x < h0 + hw + 30 && s.x + s.w > h0 - 30) // лестница не упирается в ящик
        && !platforms.some(p => p.y < below.y && p.y > y && p.x < h0 + hw + 20 && p.x + p.w > h0 - 20); // и не проходит сквозь настил
      for (let n = ri(1, 2), tries = 0; n > 0 && tries < 20; tries++) { // лестничные клетки: вниз и вверх в любом месте
        const hx = r(180, L - 260);
        if (free(hx, 30, 160)) { holes.push([hx, 30, 'stair']); n--; }
      }
      for (let n = ri(1, 3), tries = 0; n > 0 && tries < 20; tries++) { // проёмы в перекрытии — можно спрыгнуть этажом ниже
        const hw = ri(60, 90), hx = r(220, L - 200);
        if (free(hx, hw, 140)) { holes.push([hx, hw, 'drop']); n--; }
      }
      holes.sort((a, b) => a[0] - b[0]);
      let sx = 0;
      for (const [h0, hw, kind] of holes) {
        if (h0 > sx) {
          const w = h0 - sx;
          solids.push({ x: sx, y, w, h: SLAB_T, kind: 'ground', slab: true, v: R() });
          if (w > 140) { // наполнение куска перекрытия
            x = sx + w / 2; // для сложности врагов — по месту
            decorate(sx, w, y); blueprints(sx, w, y);
            const ex = sx > 200 && R() < 0.5 ? crates(sx + r(20, Math.max(21, w * 0.3)), y, h0) + 16 : sx;
            enemiesOn(Math.max(ex, 520), sx + w - Math.max(ex, 520), y, 0.1); crowd(sx, w, y);
            if (R() < 0.18) helmet(sx + w * r(0.3, 0.7), y, 0.25);
          }
        }
        if (kind === 'stair') ladder(h0 + 4, y, below.y); // у перехода лестница уже стоит
        if (kind !== 'drop') platforms.push({ x: h0, y, w: hw, h: 8, hatch: true, v: R() }); // люк над лестницей: по нему можно пройти, ↓ — спуститься
        sx = h0 + hw;
      }
      belowHoles = holes;
    }
    x = saveX;
  }

  ground(0, 460, gy); decorate(200, 240, gy); x = 460;
  checkpoints.push({ x: 90, y: gy, on: true, start: true });

  const wts = G.weights, wsum = Object.values(wts).reduce((a, b) => a + b, 0);
  while (x < LENGTH) {
    let t = R() * wsum;
    let kind = ['pit', 'platforms', 'step', 'obstacle', 'flat', 'wall', 'tower', 'under'].find(k => (t -= wts[k] || 0) < 0) || 'flat';
    if ((kind === 'wall' || kind === 'tower') && x < 700) kind = 'flat'; // в начале участка — без высотных конструкций
    if (kind === 'under' && (!G.underground || x < 900 || x > LENGTH - 1500 || tunnels.filter(t => t.depth === 1).length >= 3)) kind = 'flat';
    if (G.underground && !tunnels.length && progress() > 0.4 && x < LENGTH - 1500) kind = 'under'; // подземный ход есть всегда
    if (!secrets.length && progress() > 0.6) kind = 'wall'; // тайник есть на каждом участке
    if (G.indoor) { // здание: этажи ровные, стены — только переходы на этаж выше
      if (['step', 'tower', 'under', 'wall'].includes(kind)) kind = 'flat';
      if (progress() > 0.4 && kind === 'flat' && R() < 0.35) kind = 'pit';          // наверху — больше шахт с шаткими мостками
      if (progress() > 0.4 && kind === 'obstacle' && R() < 0.5) kind = 'platforms'; // и неустойчивых лесов
      if (x - floorStart > floorLen && x < LENGTH - 700) kind = 'wall';
    }
    if (kind === 'under') tunnel();
    else if (kind === 'pit') {
      const w = ri(pitMin, pitMax);
      pits.push({ x, w, y: gy, v: R() });
      if (G.indoor && progress() > 0.4 && R() < 0.8) platforms.push({ x: x - 6, y: gy, w: w + 12, h: 8, crumble: true, walk: true, v: R() }); // шаткие мостки над шахтой
      x += w;
      if (!G.indoor) gy = clamp(gy + ri(-1, 1) * 28, Math.max(gMin, 235), gMax);
      const len = ri(180, 330);
      ground(x, len, gy); decorate(x, len, gy); blueprints(x, len, gy);
      const ex = x > 600 && R() < 0.5 ? crates(x + r(len * 0.3, len * 0.45), gy, x + len) + 20 : x;
      enemiesOn(ex, x + len - ex, gy); crowd(x, len, gy);
      x += len;
    } else if (kind === 'platforms') { // два яруса проходимых снизу платформ
      const len = ri(320, 470);
      ground(x, len, gy);
      const px = x + 50, pw = len - 100;
      const shaky = G.indoor && progress() > 0.4 && R() < 0.8; // наверху небоскрёба — неустойчивые леса
      platforms.push({ x: px, y: gy - 72, w: pw, h: 10, base: gy, tier: 1, v: R(), crumble: shaky });
      if (!shaky && R() < 0.35 && pw > 120) crates(px + r(20, pw - 70), gy - 72, px + pw + 170); // ящик на настиле
      if (!G.indoor && R() < G.upperChance) {
        const p2 = { x: px + pw * 0.25, y: gy - 138, w: pw * 0.55, h: 10, base: gy - 72, tier: 2, v: R() };
        platforms.push(p2);
        if (R() < 0.1) helmet(p2.x + p2.w / 2, p2.y, 0.15); else blueprints(p2.x, p2.w, p2.y);
        const o = x > 700 && R() < 0.55 + progress() * 0.3 ? pickType(['upper']) : null;
        if (o) spawnEnemy(o.type, p2.x + p2.w * 0.6, p2.y, { minX: p2.x, maxX: p2.x + p2.w, groundY: p2.y, upper: true });
      } else blueprints(px, pw, gy - 72, G.indoor ? 62 : 95); // в здании над настилом — перекрытие
      enemiesOn(x, len, gy, -0.1);
      x += len;
    } else if (kind === 'step') { // перепад высот
      gy = clamp(gy + (R() < 0.5 ? -1 : 1) * ri(30, MAX_STEP), gMin, gMax);
      const len = ri(200, 320);
      ground(x, len, gy); decorate(x, len, gy); blueprints(x, len, gy);
      const ex = x > 600 && R() < 0.6 ? crates(x + r(len * 0.2, len * 0.35), gy, x + len) + 20 : x;
      enemiesOn(ex, x + len - ex, gy); crowd(x, len, gy);
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
      const wh = G.indoor ? FH : ri(130, 150), ww = ri(170, 260), top = baseY - wh;
      if (G.indoor) { floorsInfo.push({ y: baseY, start: floorStart, end: x }); floorStart = x; floorLen = ri(900, 1250); } // этаж закончился
      ladder(x - 24, top, baseY, true);
      const wall = { x, y: top, w: ww, h: H + 200 - top, kind: 'ground', wall: true, v: R() };
      if (x > 900 && (R() < 0.45 || (!secrets.length && progress() > 0.55))) secretNiche(wall, baseY); // на каждом участке — хотя бы один тайник
      else solids.push(wall);
      prevGy = null;
      blueprints(x, ww, top);
      if (R() < 0.3) helmet(x + ww / 2, top, 0.25);
      else { const ex = R() < 0.4 ? crates(x + 30, top, x + ww + 120) + 16 : x; enemiesOn(ex, x + ww - ex, top, -0.15); } // на стене — ящик
      x += ww;
      if (G.indoor) { gy = top; prevGy = top; } // дальше — этаж выше
      else {
        ground(x, ri(200, 300), baseY); decorate(x, 150, baseY);
        x = solids[solids.length - 1].x + solids[solids.length - 1].w;
      }
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
        const ex = x > 500 && R() < 0.7 ? crates(x + r(30, len * 0.22), gy, x + len) + 24 : x;
        if (R() < 0.05) helmet(x + len * 0.65, gy, 0); // изредка каска лежит прямо на земле
        enemiesOn(ex, x + len - ex, gy, 0.15); crowd(x, len, gy);
        spots.push({ x0: x, w: len, y: gy, p: progress() });
      }
      x += len;
    }
    if (x - lastCP > 1800 && x < LENGTH - 400) { // чекпоинт — нивелир на штативе
      checkpoints.push({ x: x - 60, y: groundBelow(x - 60, gy - 60) ?? gy, on: false });
      lastCP = x;
    }
  }
  if (G.indoor) building(); // этажи проходят через всё здание: можно вернуться назад по верхним этажам
  // геодезист-халтурщик с GPS на вешке — один на участок, в середине пути; у каждого участка свой
  let mid = spots.filter(o => o.p > 0.25 && o.p < 0.85 && o.w > 220);
  if (!mid.length) mid = spots.filter(o => o.p > 0.12);
  let gpsSpot = null;
  if (mid.length) { gpsSpot = pick(mid); spawnEnemy('gps', gpsSpot.x0 + gpsSpot.w * 0.6, gpsSpot.y, { groundY: gpsSpot.y, variant: GPS_VARIANTS[levelIdx % GPS_VARIANTS.length] }); }
  if (G.foreman) { // разгневанный прораб — 1–2 на участок
    let fs = spots.filter(o => o !== gpsSpot && o.p > 0.12 && o.p < 0.9 && o.w > 200);
    if (!fs.length) fs = spots.filter(o => o !== gpsSpot && o.p > 0.05 && o.w > 150);
    if (!fs.length && gpsSpot) fs = [{ ...gpsSpot, x0: gpsSpot.x0 - gpsSpot.w * 0.35 }]; // в крайнем случае — рядом с халтурщиком
    for (let k = ri(1, 2); k > 0 && fs.length; k--) { const o = fs.splice(Math.floor(R() * fs.length), 1)[0]; spawnEnemy('angryForeman', o.x0 + o.w * 0.5, o.y, { groundY: o.y }); }
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

function groundBelow(x, y) { // верх ближайшей опоры в точке x на уровне y или ниже (для этажей и ярусов подземелья)
  let top = null;
  for (const s of solids) if (s.kind !== 'ceiling' && x >= s.x && x <= s.x + s.w && s.y >= y && (top === null || s.y < top)) top = s.y;
  return top;
}
function solidAt(x, y) { for (const s of solids) if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s; return null; }
const fmtLives = n => Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
function groundAt(x) { // верх самой высокой твёрдой поверхности в точке x (или null — провал)
  let top = null;
  for (const s of solids) if (s.kind !== 'ceiling' && x >= s.x && x <= s.x + s.w && (top === null || s.y < top)) top = s.y; // потолок этажа — не опора
  return top;
}

// ---------- ходьба «пешеходов» движка (халтурщик, прораб): по земле, этажам и ярусам подземелья ----------
// want — направление (−1, 0, 1); возвращает фактическую скорость по x (0 — упёрся или остановился у провала)
function walkerStep(e, dt, want, speed, jumpPits = true) {
  const feet = e.y + e.h;
  let vx = want * speed * (e.onG ? 1 : 1.35);
  if (want && e.onG) {
    const fx = want > 0 ? e.x + e.w + 6 : e.x - 6, blk = solidAt(fx, feet - 4);
    if (blk) { // уступ — запрыгнуть, стена — стоп
      if (feet - blk.y <= 70 && !solidAt(fx, blk.y - 24)) { e.vy = -640; e.onG = false; } else vx = 0;
    } else {
      const g = groundBelow(fx, feet - 2);
      if (g === null || g > feet + 70) { // провал: перепрыгнуть, если на той стороне есть опора
        const far = groundBelow(fx + want * 118, feet - 60);
        if (jumpPits && far !== null && far < feet + 60 && far > feet - 60) { e.vy = -600; e.onG = false; } else vx = 0;
      }
    }
  }
  if (vx) {
    const nx = e.x + vx * dt, probe = vx > 0 ? nx + e.w : nx;
    if (!solidAt(probe, feet - 3) && !solidAt(probe, e.y + 4)) e.x = nx; else if (!e.onG) vx = 0;
  }
  if (arena && e.x + e.w > arena.x1 - 30) e.x = arena.x1 - 30 - e.w; // на арену босса не ходит
  e.vxNow = vx;
  e.vy = Math.min(e.vy + GRAVITY * dt, 900);
  const prevFeet = e.y + e.h; e.y += e.vy * dt;
  if (e.vy < 0 && solidAt(e.x + e.w / 2, e.y)) { e.y -= e.vy * dt; e.vy = 0; } // потолок
  const g1 = groundBelow(e.x + 3, prevFeet - 8), g2 = groundBelow(e.x + e.w - 3, prevFeet - 8);
  const gc = g1 === null ? g2 : g2 === null ? g1 : Math.min(g1, g2);
  if (gc !== null && e.vy >= 0 && e.y + e.h >= gc) { e.y = gc - e.h; e.vy = 0; e.onG = true; }
  else e.onG = false;
  return vx;
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

// реплики прораба — по мотивам типичных претензий к геодезистам (оси, отметки, исполнительная, переделка за свой счёт)
const FOREMAN_SHOUT = ['Геодезист! Опять спишь?!', 'Лентяй! Бетон едет, а осей нет!', 'Кто такие отметки дал?!', 'Котлован на метр развернул!',
  'Опять не то вынес! Всё ломать!', 'Колонну на полметра увело!', 'Где исполнительная?! Вчера надо было!', 'Кабель на абрисе где?!', 'Опалубку из-за тебя переставлять!'];
const FOREMAN_RETURN = ['А ну стой, геодезист!', 'Сейчас я тебе объясню проект!', 'Иди сюда, разбивщик!'];
const FOREMAN_HIT = ['Вот тебе чертежи! Читай!', 'Демонтаж — за твой счёт!', 'Всё ломать и заново строить!', 'По проекту смотри, по проекту!', 'Переделывать будешь сам!'];
const FOREMAN_OUCH = ['Ай! Я жаловаться буду!', 'На прораба руку поднял?!', 'Ох, в журнал запишу!'];
const FOREMAN_DEATH = ['Всё, я к главному инженеру!', 'Ладно… перемеряй и приходи.', 'Сам ты лентяй… ой.'];
const pickLine = (list, e) => e ? list[(e.lineI = (e.lineI || 0) + 1) % list.length] : list[Math.floor(Math.random() * list.length)];

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
        want = adx < 12 && !level ? 0 : toP; // герой прямо над ним — не дёргается туда-сюда
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
      else if (e.state === 'turn') { if (adx > 12) e.dir = toP; if (e.st <= 0) e.state = 'chase'; } // оглядывается — и снова в погоню
      if (want) e.dir = want;
      const vx = walkerStep(e, dt, want, speed, e.state !== 'flee'); // удирая, через провалы не прыгает
      if (want && !vx && e.onG && e.state === 'flee') { e.state = 'turn'; e.st = 0.45; } // упёрся — разворачивается
      if (e.y > deathLimit(e)) { e.dead = true; popup(e.x, e.y - 60, 'Халтурщик провалился!', '#c6ff00'); }
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
  // разгневанный прораб: пробегает мимо с криками, возвращается с рулоном чертежей и бьёт по каске (на пол-каски)
  angryForeman: {
    w: 22, h: 44, hp: 3, pts: 400, touchHurts: false, hitColor: '#ffd0a0', deathColor: '#2f6fd0',
    init(e) {
      e.hp = e.maxHp = 2 + Math.floor(Math.random() * 4); // 2–5 ударов
      e.state = 'wait'; e.st = 0; e.vx = 0; e.vy = 0; e.onG = true; e.dir = -1; e.roll = false; e.say = null; e.sayT = 0; e.lineI = Math.floor(Math.random() * 9);
    },
    onHit(e) { if (e.state === 'swing') { e.state = 'runby'; e.dir = -e.dir; } e.say = pickLine(FOREMAN_OUCH); e.sayT = 1.2; },
    onDeath(e) {
      popup(e.x + e.w / 2, e.y - 34, pickLine(FOREMAN_DEATH), '#ffd0a0');
      if (e.roll) for (let i = 0; i < 6; i++) particles.push({ x: e.x + e.w / 2, y: e.y + 10, vx: rand(-140, 140), vy: -rand(120, 260), life: rand(1.4, 2.2), max: 2.2, color: '#cfe6ff', grav: 260, size: 4, w: 8, h: 10, rot: rand(0, 6), vr: rand(-6, 6), chunk: true, paper: true, ph: rand(0, 6) });
    },
    update(e, dt) {
      const P = player, dx = api.dx(e), adx = Math.abs(dx), toP = Math.sign(dx) || 1, level = Math.abs(P.y + P.h - (e.y + e.h)) < 40;
      e.st -= dt; e.sayT -= dt;
      const shout = (list, t = 1.6) => { e.say = pickLine(list, e); e.sayT = t; Sound.play('shout'); };
      let want = 0, speed = 270;
      if (e.state === 'wait') { if (adx > 12) e.dir = toP; if (e.st <= 0 && adx < 380 && Math.abs(P.y - e.y) < 120) { e.state = 'runby'; e.dir = toP; shout(FOREMAN_SHOUT); } }
      else if (e.state === 'fume') { if (adx > 12) e.dir = toP; if (e.st <= 0) { e.state = 'wait'; e.st = 1.5; } } // упёрся — стоит и пыхтит, потом снова ждёт
      else if (e.state === 'runby') { // бежит на героя и мимо него, ругается
        want = e.dir;
        if (e.sayT < 0.2) shout(FOREMAN_SHOUT);
        if (e.onG && Math.sign(dx) === -e.dir && adx > (e.roll ? 300 : 440)) { e.state = 'turn'; e.st = e.roll ? 0.8 : 1; if (!e.roll) { e.roll = true; e.say = 'Сейчас я тебе покажу проект!'; e.sayT = 1.2; } } // за чертежами
      } else if (e.state === 'turn') { if (adx > 12) e.dir = toP; if (e.st <= 0) { e.state = 'return'; shout(FOREMAN_RETURN); } }
      else if (e.state === 'return') { // возвращается с рулоном
        want = adx < 12 && !level ? 0 : toP; speed = 240; // герой прямо над ним — стоит и орёт вверх
        if (adx < 34 && level && e.onG) { e.state = 'swing'; e.st = 0.34; e.hitDone = false; Sound.play('swing'); }
        else if (adx > 900 && e.onG) { e.state = 'wait'; e.st = 0; }
      } else if (e.state === 'swing') {
        const hb = { x: e.dir > 0 ? e.x + e.w / 2 : e.x + e.w / 2 - 40, y: e.y - 24, w: 40, h: e.h + 24 };
        if (!e.hitDone && e.st < 0.16 && overlap(hb, P)) {
          e.hitDone = true; const had = P.inv <= 0;
          hurtPlayer(e.x + e.w / 2, 0.5);
          if (had) { Sound.play('whack'); popup(P.x + P.w / 2, P.y - 16, 'БАЦ! −½ каски', '#ffd0a0'); burst(P.x + P.w / 2, P.y - 4, '#cfe6ff', 10, 140); }
          shout(FOREMAN_HIT, 1.8);
        }
        if (e.st <= 0) { e.state = 'runby'; e.dir = toP; } // и снова мимо — дальше ругаться
      }
      if (want) e.dir = want;
      const vx = walkerStep(e, dt, want, speed, true);
      if (want && !vx && e.onG && (e.state === 'runby' || e.state === 'return')) { e.state = 'fume'; e.st = 2.5; e.roll = true; e.say = 'Ну я тебе устрою!'; e.sayT = 1.2; } // упёрся в стену или провал — стоит и пыхтит
      if (Math.random() < dt * (e.state === 'wait' ? 0.6 : 2.5)) particles.push({ x: e.x + e.w / 2 + rand(-4, 4), y: e.y - 6, vx: rand(-15, 15), vy: -rand(30, 60), life: 0.7, max: 0.7, color: 'rgba(235,235,235,.7)', grav: -20, size: rand(2, 4) }); // пар из ушей
      if (e.y > deathLimit(e)) e.dead = true;
    },
    draw(e, ctx) {
      const run = e.onG && Math.abs(e.vxNow || 0) > 10, sw = run ? Math.sin(e.t * 16) * 0.8 : 0, now = e.t;
      ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      for (const s of [sw, -sw]) { ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(Math.sin(s) * 13, -2); ctx.stroke(); }
      ctx.fillStyle = '#3a2a1a'; for (const s of [sw, -sw]) ctx.fillRect(Math.sin(s) * 13 - 4, -5, 11, 5);
      ctx.fillStyle = '#34405a'; ctx.beginPath(); ctx.ellipse(1, -28, 12, 13, 0, 0, 7); ctx.fill(); // живот
      ctx.fillStyle = '#ff7a1a'; ctx.fillRect(-10, -38, 21, 14); ctx.fillStyle = '#e9f2f2'; ctx.fillRect(-10, -31, 21, 2);
      ctx.fillStyle = '#fff'; ctx.fillRect(-4, -27, 9, 5); ctx.fillStyle = '#2f6fd0'; ctx.fillRect(-3, -26, 7, 1); ctx.fillRect(-3, -24, 5, 1); // бейдж «ПРОРАБ»
      const red = e.state === 'wait' ? '#e8a07a' : '#e0604a'; // лицо красное от злости
      ctx.fillStyle = red; ctx.beginPath(); ctx.arc(2, -46, 7, 0, 7); ctx.fill();
      ctx.fillStyle = '#222'; ctx.fillRect(4, -49, 3, 2); ctx.fillRect(2, -51, 5, 1.2); // злая бровь
      ctx.fillStyle = '#5a3a20'; ctx.fillRect(3, -43, 6, 2); // усы
      if (e.sayT > 0) { ctx.fillStyle = '#5a1010'; ctx.beginPath(); ctx.ellipse(7, -40, 2, 1.5 + Math.abs(Math.sin(now * 20)) * 1.5, 0, 0, 7); ctx.fill(); } // орёт
      ctx.fillStyle = '#f5f5f5'; ctx.beginPath(); ctx.arc(2, -50, 8, Math.PI, 0); ctx.fill(); ctx.fillRect(-7, -51, 19, 2.5); ctx.fillStyle = '#c62828'; ctx.fillRect(-1, -56, 6, 2); // белая каска ИТР
      // руки: без рулона — кулак трясётся; с рулоном — рулон чертежей, при ударе — сверху по голове
      let ang = -0.6;
      if (e.state === 'swing') { const k = 1 - Math.max(0, e.st) / 0.34; ang = k < 0.5 ? -2.4 + k * 0.6 : -2.1 + (k - 0.5) * 5.4; }
      else if (!e.roll) ang = -2.3 + Math.sin(now * 18) * 0.3; // грозит кулаком
      ctx.save(); ctx.translate(6, -34); ctx.rotate(ang);
      ctx.strokeStyle = '#34405a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, 0); ctx.stroke();
      ctx.fillStyle = '#e8a07a'; ctx.beginPath(); ctx.arc(13, 0, 3, 0, 7); ctx.fill();
      if (e.roll) { ctx.fillStyle = '#2f6fd0'; ctx.fillRect(12, -3, 30, 7); ctx.fillStyle = '#cfe6ff'; ctx.fillRect(14, -2, 26, 1.5); ctx.fillStyle = '#1d4f9a'; ctx.beginPath(); ctx.ellipse(42, 0.5, 2, 3.5, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#e53935'; ctx.fillRect(24, -3, 2, 7); }
      ctx.restore();
      if (e.state === 'swing' && e.st < 0.2) { ctx.strokeStyle = 'rgba(207,230,255,.5)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(6, -34, 40, -2, 0.4); ctx.stroke(); }
      if (e.sayT > 0 && e.say) { // облачко с руганью (текст не зеркалим)
        ctx.save(); ctx.scale(e.dir || 1, 1);
        let fs = 10; ctx.font = `bold ${fs}px system-ui, sans-serif`;
        const tw = ctx.measureText(e.say).width; if (tw > 210) { fs = 10 * 210 / tw; ctx.font = `bold ${fs}px system-ui, sans-serif`; } // длинная фраза — мельче шрифт, но целиком в облачке
        const w = Math.min(tw, 210) + 12, y = -84;
        ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = '#c62828'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(-w / 2, y - 14, w, 20); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-4, y + 6); ctx.lineTo(2, y + 16); ctx.lineTo(6, y + 6); ctx.fill();
        ctx.fillStyle = '#b71c1c'; ctx.textAlign = 'center'; ctx.fillText(e.say, 0, y);
        ctx.restore();
      }
    },
  },
};

// ---------- кампания ----------
function loadLevel(i) {
  levelIdx = i; theme = THEMES[i];
  G = Object.assign({}, GEN, theme.gen || {});
  G.weights = Object.assign({}, GEN.weights, (theme.gen || {}).weights || {});
  if (!(theme.gen || {}).breakables && THEME_BREAKABLES[theme.id]) G.breakables = THEME_BREAKABLES[theme.id];
  resetAmbient();
  seed = (Math.random() * 2 ** 32) >>> 0;
  projectiles = []; particles = []; popups = [];
  generateLevel(seed);
  player = { x: 80, y: checkpoints[0].y - 40, w: 18, h: 40, vx: 0, vy: 0, face: 1, onGround: false, coyote: 0, inv: 0, attackT: 0, attackCd: 0, hitSet: null, anim: 0, drop: 0, climb: null, peakY: 0, snow: 0.3, stepK: 0, rungK: 0, domeSnow: 1 };
  respawn = { x: 80, y: checkpoints[0].y - 60 };
  camX = 0; camY = 0; levelTime = 0; lives = maxLives; shake = 0; hintsShown = new Set();
  banner = { top: `Участок ${i + 1} из ${THEMES.length}`, title: theme.title, sub: (theme.subtitle || '') + ' · в руках: ' + WEAPONS[weaponOf()].name.toLowerCase(), t: 3.2 };
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
  score = 0; kills = 0; time = 0; maxLives = 3; relicTaken = false; // новая смена — снова три каски
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
const BREAK_COLORS = { crack: ['#8d8173', '#6e6357', '#b3a794', '#4d443a'] };
function hitBreakable(s) { // удар рейкой по бочке, ящику или кладке с трещинами
  s.hp--; s.hit = 0.15;
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  const b = BREAKABLES[s.sort], mat = b ? b.mat : 'stone', colors = b ? b.colors : BREAK_COLORS.crack;
  if (s.hp > 0) { Sound.play(s.sort === 'crack' ? 'crack' : MAT_SFX[mat][0]); debris(cx, cy, colors, 4, 140); shake = Math.max(shake, 2); if (s.maxHp >= 5) popup(cx, s.y - 14, 'ещё ' + s.hp, '#ffb02e'); else if (s.hp === 1 && s.maxHp > 2) popup(cx, s.y - 8, 'ещё удар!', '#f1e6d6'); return; }
  s.dead = true; solids = solids.filter(o => o !== s);
  debris(cx, cy, colors, s.sort === 'crack' ? 22 : 10 + s.maxHp * 4, s.sort === 'crack' ? 300 : 240 + s.maxHp * 20);
  burst(cx, cy, mat === 'soft' ? colors[0] : s.sort === 'crack' ? '#cfc6b8' : '#e8d8c0', mat === 'soft' ? 22 : 10, mat === 'soft' ? 90 : 140, mat === 'soft' ? -30 : 200); // пыль (мешки — облако)
  if (mat === 'paper') for (let i = 0; i < 5; i++) particles.push({ x: cx, y: cy, vx: rand(-120, 120), vy: -rand(100, 240), life: rand(1.2, 2), max: 2, color: '#f4f1e6', grav: 260, size: 4, w: 7, h: 9, rot: rand(0, 6), vr: rand(-6, 6), chunk: true, paper: true, ph: rand(0, 6) });
  shake = Math.max(shake, s.sort === 'crack' ? 6 : 3);
  if (s.sort === 'crack') {
    Sound.play('rubble'); Sound.play('secret');
    s.secret.open = true; addScore(100);
    popup(s.x + 40, s.y - 16, 'ТАЙНИК!', '#ffd24a');
    burst(s.x + 40, s.y + s.h / 2, '#ffd24a', 18, 200, 100);
    return;
  }
  Sound.play(MAT_SFX[mat][1]);
  addScore(10 + s.maxHp * 10, cx, s.y - 6); // прочнее — дороже
  if (s.sort === 'rubble') { shake = Math.max(shake, 8); Sound.play('thud'); popup(cx, s.y - 20, 'Завал разобран!', '#ffd24a'); return; }
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
      if (p.state === 'fall' || p.state === 'gone') continue; // рухнувшие леса и мостки
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

function hurtPlayer(fromX, dmg = 1) { // dmg — сколько касок отнять (прораб бьёт на пол-каски)
  if (player.inv > 0 || mode !== 'play') return;
  lives -= dmg; if (lives < 0.01) lives = 0; player.inv = 1.4; shake = 8; Sound.play('hurt');
  player.vx = (player.x + player.w / 2 < fromX ? -1 : 1) * 260; player.vy = -380;
  burst(player.x + player.w / 2, player.y + 20, '#ff5d5d', 16);
  if (lives <= 0) endGame(false);
}

// ---------- игровой цикл ----------
function update(dt) {
  for (const p of particles) { if (p.paper) { p.vx = p.vx * (1 - dt * 1.5) + Math.sin(p.life * 5 + p.ph) * 120 * dt; p.vy = Math.min(p.vy, 90); } // бумага планирует
    p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; if (p.chunk) { p.rot += p.vr * dt; const g = p.vy > 0 ? groundBelow(p.x, p.y - 14) : null; if (g !== null && p.y > g - 2 && p.y < g + 14) { p.y = g - 2; p.vy *= -0.3; p.vx *= 0.6; p.vr *= 0.5; } } } // обломки падают на землю
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
    else { P.vy = -JUMP_V; Sound.play('jump'); burst(P.x + P.w / 2, P.y + P.h, theme.dust || '#b9a58a', 6, 80, 300); shakeSnow(0.6); papers(); }
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
    P.snow = Math.min(1, Math.max(P.snow + dt * (Math.abs(P.vx) < 20 ? 0.12 : 0.05), api.progress * 0.95)); // к концу участка герой весь в снегу
    if (Math.random() < dt * 1.2) particles.push({ x: P.x + P.w / 2 + P.face * 6, y: P.y + 4, vx: P.face * rand(10, 30), vy: -rand(5, 20), life: 0.9, max: 0.9, color: 'rgba(235,245,255,.55)', grav: -30, size: rand(2, 4) }); // пар изо рта
  }

  updateCrumble(dt);
  if (heroOf().domeSnow) P.domeSnow = Math.min(1, P.domeSnow + dt * 0.22); // сугроб на приёмнике постепенно намерзает
  if (heroOf().dirty && P.onGround && Math.abs(P.vx) > 60 && Math.random() < dt * 4) burst(P.x + P.w / 2, P.y + P.h - 4, '#2a2622', 2, 40, -40); // угольная пыль с одежды
  if (theme.update) theme.update(dt, api);
  if (mode !== 'play') return; // тема могла закончить игру (урон)

  // удар рейкой: широкая дуга перед геодезистом
  P.attackCd -= dt;
  if (attackQueued && P.attackCd <= 0) { P.attackT = 0.26; P.attackCd = 0.36; P.hitSet = new Set(); Sound.play(weaponOf() === 'staff' || weaponOf() === 'invar' ? 'swing' : 'swingPole'); shakeSnow(0.3); domeSnowFall(); }
  attackQueued = false;
  if (P.attackT > 0) {
    P.attackT -= dt;
    const phase = 1 - P.attackT / 0.26;
    if (phase > 0.15 && phase < 0.75) {
      const reach = WEAPONS[weaponOf()].reach;
      const hb = { x: P.face > 0 ? P.x + P.w / 2 : P.x + P.w / 2 - reach, y: P.y - 22, w: reach, h: P.h + 20 };
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

  // падение в провал (в подземный ход — не смерть: там пол)
  if (P.y > deathLimit(P)) {
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
    lives = Math.min(maxLives, lives + add);
    if (lives > was) popup(k.x - 20, k.y - 14, (k.kind === 'white' ? 'Белая каска +' : 'Каска +') + fmtLives(lives - was), '#9cff9c');
    else addScore(150, k.x, k.y - 10);
    Sound.play('helmet'); burst(k.x, k.y, k.kind === 'white' ? '#ffffff' : '#ff9a3c', 16, 160, 200);
  }
  helmets = helmets.filter(k => !k.got);
  for (const k of treasures) { // клады нижних ярусов
    k.t += dt;
    if (k.got || Math.abs(k.x - (P.x + P.w / 2)) > 22 || Math.abs(k.y - (P.y + P.h / 2)) > 30) continue;
    k.got = true; const T = TREASURES[k.kind];
    addScore(T.pts, k.x, k.y - 16);
    burst(k.x, k.y, T.color, 30, 220, 150); burst(k.x, k.y, '#ffffff', 12, 160, 100);
    if (k.kind === 'relic') {
      relicTaken = true; maxLives = 4; lives = Math.min(maxLives, lives + 1);
      Sound.play('relic');
      banner = { top: 'НАХОДКА', title: 'Золотая каска!', sub: 'Теперь у геодезиста 4 каски — до конца смены', t: 3.2 };
    } else { Sound.play('treasure'); popup(k.x, k.y - 34, T.name, T.color); }
  }
  treasures = treasures.filter(k => !k.got);

  // подсказки: трещины и бочки ломаются рейкой
  for (const s of solids) {
    if (s.kind !== 'breakable' || Math.abs(s.x - P.x) > 170 || Math.abs(s.y - P.y) > 120) continue;
    const key = s.sort === 'crack' || s.sort === 'rubble' ? s.sort : 'crate';
    if (key === 'rubble' && Math.abs(s.y + s.h - (P.y + P.h)) > 10) continue; // подсказка про завал — только на его ярусе
    if (hintsShown.has(key) || (key === 'crate' && levelIdx > 0)) continue;
    hintsShown.add(key);
    popup(s.x + s.w / 2, s.y - 24, key === 'crack' ? 'Трещина! Ударь рейкой' : key === 'rubble' ? 'Завал! За ним что-то блестит — 5–10 ударов' : 'Ящики, бочки и прочее ломаются рейкой', key === 'crate' ? '#f1e6d6' : '#ffd24a');
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
  const ty0 = P.y + P.h / 2 - H * 0.52;
  let tun = null; // самый глубокий ярус, в который опустился герой
  for (const t of tunnels) if (P.x + P.w / 2 > t.x1 && P.x + P.w / 2 < t.x2 && P.y + P.h > t.top + 8 && (!tun || t.floor > tun.floor)) tun = t;
  const ty = tun ? clamp(ty0, 0, Math.max(0, tun.floor + 34 - H)) : Math.min(0, ty0); // в подземном ходе камера опускается
  camY += (ty - camY) * Math.min(1, dt * 5);
  updateAmbient(dt);
}

function updateCrumble(dt) { // неустойчивые леса и мостки: встал — трясутся и рушатся (вместе с тем, кто на них стоит)
  const P = player;
  for (const p of platforms) {
    if (!p.crumble) continue;
    if (p.state === undefined) { p.state = 'idle'; p.y0 = p.y; }
    const on = P.onGround && !P.climb && Math.abs(P.y + P.h - p.y) < 2 && P.x + P.w > p.x && P.x < p.x + p.w;
    if (p.state === 'idle') { if (on) { p.state = 'shake'; p.t = p.walk ? 0.9 : 1; Sound.play('creak'); } }
    else if (p.state === 'shake') {
      p.t -= dt;
      if (Math.random() < dt * 8) burst(p.x + rand(0, p.w), p.y + 4, '#8a6a40', 2, 50, 600); // сыплется труха
      if (p.t <= 0) { p.state = 'fall'; p.vy = 0; p.rot = 0; Sound.play('collapse'); debris(p.x + p.w / 2, p.y, ['#8a5a2b', '#c49a6c', '#9aa4b0'], 8, 160); }
    } else if (p.state === 'fall') {
      p.vy = Math.min(p.vy + GRAVITY * dt, 900); p.y += p.vy * dt; p.rot += dt * (p.v - 0.5) * 2;
      const floorY = p.walk ? null : (p.base ?? groundBelow(p.x + p.w / 2, p.y0 + 1)); // леса падают на свой этаж, мостки — в шахту
      if (floorY != null && p.y >= floorY - 6) { p.state = 'gone'; p.t = 6; debris(p.x + p.w / 2, floorY - 4, ['#8a5a2b', '#c49a6c', '#9aa4b0'], 10, 150); Sound.play('thud'); }
      else if (p.y > p.y0 + 600) { p.state = 'gone'; p.t = 6; }
    } else if (p.state === 'gone') { p.t -= dt; if (p.t <= 0 && Math.abs(P.x + P.w / 2 - (p.x + p.w / 2)) > 280) { p.state = 'idle'; p.y = p.y0; p.rot = 0; } } // потом снова ставят
  }
}
function deathLimit(P) { // глубина, ниже которой герой считается упавшим
  const cx = P.x + P.w / 2;
  let deep = null;
  for (const t of tunnels) if (cx >= t.x1 - 10 && cx <= t.x2 + 10 && (deep === null || t.floor > deep)) deep = t.floor;
  if (deep !== null) return deep + 150;
  for (const p of pits) if (cx >= p.x - 20 && cx <= p.x + p.w + 20) return Math.min(DEATH_Y, p.y + 170); // в здании шахта лифта — смерть сразу под этажом
  return DEATH_Y;
}
function moveHelmet(k, dt) { // летящая каска: подпрыгивает на земле и замирает
  k.vy = Math.min(k.vy + 900 * dt, 700);
  const nx = k.x + (k.vx || 0) * dt;
  if (solidAt(nx, k.y + 6)) k.vx = -(k.vx || 0) * 0.5; else k.x = nx; // стенка — отскок
  if (arena && arena.active) k.x = clamp(k.x, arena.x1 + 20, arena.x2 - 20);
  const prev = k.y; k.y += k.vy * dt;
  const g = groundBelow(k.x, prev + 4);
  if (g !== null && k.vy > 0 && k.y + 14 >= g) {
    k.y = g - 14;
    if (k.vy > 220) { k.vy *= -0.35; k.vx = (k.vx || 0) * 0.6; } else { k.vy = 0; k.vx = 0; k.rest = true; }
  }
  if (k.y > deathLimit({ x: k.x, w: 0 }) + 40) k.got = true;
}
function bossDrop() {
  const b = arena.boss, hb = b.def.hurtbox ? b.def.hurtbox(b, api) : b;
  const cx = hb.x + hb.w / 2, cy = hb.y + hb.h * 0.3, dir = Math.sign(player.x - cx) || (Math.random() < 0.5 ? -1 : 1);
  helmets.push({ x: cx, y: cy, kind: Math.random() < 0.25 ? 'white' : 'orange', t: 0, vx: dir * rand(90, 230), vy: -rand(430, 560), life: 7.5 });
  Sound.play('bossDrop'); burst(cx, cy, '#ffffff', 12, 180);
  popup(cx, cy - 16, 'Каска!', '#9cff9c');
}
function domeSnowFall() { // сугроб с купола приёмника слетает от удара и потом снова намерзает
  const P = player;
  if (!heroOf().domeSnow || P.domeSnow < 0.15) return;
  const hx = P.x + P.w / 2 - P.face * 13, hy = P.y + P.h - 80; // купол приёмника над плечом
  debris(hx, hy, ['#ffffff', '#eef6ff', '#d8e8f8'], Math.round(6 + P.domeSnow * 10), 150);
  burst(hx, hy, '#f4faff', 8, 90, 400);
  Sound.play('snowFall'); P.domeSnow = 0;
}
function papers() { // из рюкзака при прыжке вылетают бумаги и разлетаются в стороны
  const P = player;
  if (!heroOf().backpack) return;
  const bx = P.x + P.w / 2 - P.face * 10, by = P.y + 6, n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) particles.push({ x: bx, y: by, vx: rand(-150, 150) - P.face * 40, vy: -rand(120, 260), life: rand(1.4, 2.2), max: 2.2, color: '#f4f1e6',
    grav: 260, size: 4, w: 7, h: 9, rot: rand(0, 6), vr: rand(-6, 6), chunk: true, paper: true, ph: rand(0, 6) });
  Sound.play('paper');
}
function shakeSnow(k) { // стряхнуть снег (снежный участок)
  const P = player;
  if (!theme.snowy || P.snow < 0.25) return;
  burst(P.x + P.w / 2, P.y + 6, '#f4faff', Math.round(P.snow * 10), 110, 500);
  P.snow = Math.max(api.progress * 0.95, P.snow * (1 - k)); // налипший за участок снег не стряхнуть
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

// ---------- разрушаемые предметы: у каждого участка свой набор (gen.breakables) ----------
// hp — сколько ударов рейкой выдерживает; mat — материал: от него звук удара, звук разрушения и обломки
const BREAKABLES = {
  crate:    { name: 'ящик', w: 30, h: 28, hp: 1, mat: 'wood', colors: ['#b07a42', '#8a5a2b', '#d2a26b', '#5e3b1a'] },
  barrel:   { name: 'бочка', w: 24, h: 30, hp: 2, mat: 'metal', colors: ['#3d6fa8', '#28507c', '#9fb4c8', '#c9a227'] },
  box:      { name: 'коробка', w: 26, h: 20, hp: 1, mat: 'paper', colors: ['#c8a06a', '#a47c48', '#e0c49a'] },
  bricks:   { name: 'поддон кирпича', w: 34, h: 26, hp: 3, mat: 'stone', colors: ['#b5523b', '#8e3b2a', '#d0765c', '#8a6a40'] },
  cement:   { name: 'мешки цемента', w: 32, h: 18, hp: 1, mat: 'soft', colors: ['#d8d2c4', '#b9b1a0', '#9e9686'] },
  tubing:   { name: 'блок тюбинга', w: 34, h: 24, hp: 3, mat: 'stone', colors: ['#8d9096', '#6c7076', '#b0b4ba'] },
  sack:     { name: 'мешок угля', w: 24, h: 18, hp: 1, mat: 'soft', colors: ['#2a2622', '#4a4238', '#161310'] },
  props:    { name: 'клеть крепи', w: 30, h: 28, hp: 2, mat: 'wood', colors: ['#7a5836', '#5a3e22', '#9a7448'] },
  boulder:  { name: 'валун', w: 30, h: 26, hp: 4, mat: 'stone', colors: ['#a0856a', '#7d6550', '#c4ab90'] },
  cones:    { name: 'стопка конусов', w: 18, h: 26, hp: 1, mat: 'plastic', colors: ['#ff6d00', '#ffffff', '#d85a00'] },
  bitumen:  { name: 'бочка битума', w: 24, h: 30, hp: 2, mat: 'metal', colors: ['#1e1e20', '#3a3a3e', '#0c0c0e', '#c9a227'] },
  reel:     { name: 'кабельный барабан', w: 30, h: 30, hp: 3, mat: 'wood', colors: ['#b07a42', '#7a5230', '#1e1e1e'] },
  glass:    { name: 'стеклопакеты', w: 30, h: 30, hp: 1, mat: 'glass', colors: ['#bfe6ff', '#8fcdf2', '#ffffff', '#7a6a50'] },
  drywall:  { name: 'гипсокартон', w: 34, h: 16, hp: 1, mat: 'soft', colors: ['#e8e6e0', '#c8c4ba', '#f6f4ee'] },
  ice:      { name: 'ледяная глыба', w: 28, h: 26, hp: 2, mat: 'ice', colors: ['#dff4ff', '#a8d8f0', '#ffffff'] },
  firewood: { name: 'поленница', w: 32, h: 22, hp: 2, mat: 'wood', colors: ['#8a5a2b', '#c49a6c', '#5e3b1a'] },
  cabinet:  { name: 'шкаф с документацией', w: 22, h: 32, hp: 3, mat: 'metal', colors: ['#8a9096', '#6a7076', '#b4bac0'] },
  folders:  { name: 'коробка с папками', w: 26, h: 18, hp: 1, mat: 'paper', colors: ['#c8a06a', '#2f6fd0', '#e53935', '#f4f1e6'] },
  rubble:   { name: 'завал', w: 34, h: 84, hp: 7, mat: 'stone', colors: ['#6e6357', '#8d8173', '#4d443a', '#7a5836'] }, // поперёк хода к сокровищнице: 5–10 ударов
};
// клады нижних ярусов подземелья и Золотая каска (4 каски до конца смены)
const TREASURES = {
  theodolite: { name: 'Золотой теодолит', pts: 2000, color: '#ffd24a' },
  benchmark:  { name: 'Стенная марка 1913 года', pts: 1200, color: '#d9b36c' },
  map:        { name: 'Секретная карта-планшет', pts: 800, color: '#9fd3ff' },
  nugget:     { name: 'Золотой самородок', pts: 1500, color: '#ffd24a' },
  lamp:       { name: 'Шахтёрская лампа Вольфа', pts: 1000, color: '#ffb74d' },
  coins:      { name: 'Клад старинных монет', pts: 1500, color: '#ffd24a' },
  tokens:     { name: 'Жетоны метро 1935 года', pts: 1000, color: '#e0c080' },
  relic:      { name: 'Золотая каска', pts: 500, color: '#ffe066' },
};
const THEME_BREAKABLES = { // набор разрушаемых предметов участка, если тема не задала свой (gen.breakables)
  city: ['crate', 'barrel', 'box', 'bricks'], pit: ['cement', 'barrel', 'crate', 'bricks'], metro: ['crate', 'tubing', 'box', 'barrel'],
  mine: ['sack', 'props', 'crate', 'barrel'], quarry: ['boulder', 'crate', 'barrel', 'sack'], road: ['cones', 'bitumen', 'crate', 'box'],
  bridge: ['reel', 'crate', 'barrel', 'box'], tower: ['glass', 'drywall', 'crate', 'reel'], tundra: ['ice', 'firewood', 'barrel', 'crate'],
  dam: ['cabinet', 'folders', 'box', 'crate'],
};
const MAT_SFX = { // звук удара и звук разрушения
  wood: ['crack', 'break'], metal: ['clang', 'barrel'], stone: ['crack', 'rubble'], paper: ['crack', 'paper'], soft: ['thump', 'bag'],
  plastic: ['thump', 'pop'], glass: ['clink', 'glass'], ice: ['clink', 'glass'],
};

function drawBreakableBody(s, b) { // рисунок предмета в своих координатах (0,0 — левый верх)
  const w = s.w, h = s.h, c = b.colors, dmg = s.maxHp - s.hp;
  const R = (col, x, y, ww, hh) => { ctx.fillStyle = col; ctx.fillRect(x, y, ww, hh); };
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(2, h - 2, w, 3);
  switch (s.sort) {
    case 'rubble': { // завал: глыбы породы, обломки крепи и арматуры от пола до потолка
      const rocks = [[0.1, 0.84, 0.3], [0.5, 0.86, 0.28], [0.25, 0.62, 0.3], [0.7, 0.62, 0.26], [0.1, 0.4, 0.26], [0.5, 0.38, 0.3], [0.3, 0.16, 0.28], [0.72, 0.16, 0.24]];
      rocks.forEach(([rx, ry, rs], k) => { const cx = rx * w + 6, cy = ry * h, r = rs * w * 0.75 + 4; ctx.fillStyle = c[k % 3]; ctx.beginPath(); ctx.moveTo(cx - r, cy + r * 0.6); ctx.lineTo(cx - r * 0.6, cy - r * 0.7); ctx.lineTo(cx + r * 0.5, cy - r * 0.8); ctx.lineTo(cx + r, cy + r * 0.2); ctx.lineTo(cx + r * 0.5, cy + r * 0.8); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(cx - r * 0.5, cy - r * 0.6, r * 0.6, 2); });
      ctx.fillStyle = c[3]; ctx.save(); ctx.translate(w / 2, h * 0.5); ctx.rotate(0.9); ctx.fillRect(-26, -3, 52, 6); ctx.restore(); // сломанная стойка крепи
      ctx.strokeStyle = '#8a4a2a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(4, h * 0.25); ctx.lineTo(w - 2, h * 0.3); ctx.moveTo(6, h * 0.72); ctx.lineTo(w, h * 0.66); ctx.stroke(); // арматура
      ctx.fillStyle = '#f2c230'; ctx.fillRect(w / 2 - 8, h * 0.45, 16, 9); ctx.fillStyle = '#111'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', w / 2, h * 0.45 + 8);
      if (s.maxHp - s.hp > 0) { const k = s.hp / s.maxHp; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(-2, -10, w + 4, 6); ctx.fillStyle = '#ffb02e'; ctx.fillRect(0, -8, w * k, 2); } // сколько осталось
      break;
    }
    case 'barrel': case 'bitumen': {
      const blue = s.sort === 'barrel' && s.v >= 0.5, main = s.sort === 'barrel' ? (blue ? '#b0402f' : c[0]) : c[0], dark = s.sort === 'barrel' ? (blue ? '#7c2a1e' : c[1]) : c[1];
      R(main, 0, 2, w, h - 4); ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(w / 2, 3, w / 2, 3, 0, 0, 7); ctx.fill();
      R(dark, 0, 8, w, 3); R(dark, 0, h - 10, w, 3); R(dark, 0, h - 3, w, 3);
      R('rgba(255,255,255,.25)', 4, 4, 3, h - 8);
      if (s.sort === 'barrel') { R('#f2c230', w / 2 - 5, 14, 10, 6); R('#222', w / 2 - 1, 15, 2, 4); }
      else { R('#111', 2, -1, w - 4, 3); R('#f2c230', w / 2 - 6, 15, 12, 5); R('#111', w / 2 - 4, 16, 8, 1); R('#111', w / 2 - 4, 18, 5, 1); } // потёки битума и этикетка
      break;
    }
    case 'crate': case 'props': {
      if (s.sort === 'crate') {
        R(c[0], 0, 0, w, h); R(c[1], 0, 0, w, 3); R(c[1], 0, h - 3, w, 3); R(c[1], 0, 0, 3, h); R(c[1], w - 3, 0, 3, h);
        ctx.strokeStyle = c[1]; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(3, 3); ctx.lineTo(w - 3, h - 3); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1; for (let y = 9; y < h - 3; y += 7) { ctx.beginPath(); ctx.moveTo(3, y); ctx.lineTo(w - 3, y); ctx.stroke(); }
      } else { // клеть: брусья крест-накрест в четыре яруса
        for (let k = 0; k < 4; k++) { const y = h - (k + 1) * 7; if (k % 2) { R(c[0], 0, y, w, 6); R(c[1], 0, y + 4, w, 2); } else { R(c[0], 1, y, 7, 6); R(c[0], w - 8, y, 7, 6); R(c[2], 2, y + 1, 5, 1); R(c[2], w - 7, y + 1, 5, 1); } }
      }
      break;
    }
    case 'box': case 'folders': {
      R(c[0], 0, 0, w, h); R(c[1], 0, 0, w, 3); R('rgba(0,0,0,.15)', w / 2 - 1, 0, 2, h);
      R('#e8dcc0', w / 2 - 6, 6, 12, 1.5);
      if (s.sort === 'folders') { R(c[1], 3, -5, 5, 7); R(c[2], 9, -6, 5, 8); R(c[3], 15, -4, 6, 6); R('#4a4a4a', 5, h - 8, 10, 4); } // корешки папок торчат
      else { R('#6a5030', 4, h - 7, 9, 1); R('#6a5030', 4, h - 5, 6, 1); ctx.fillStyle = '#6a5030'; ctx.beginPath(); ctx.moveTo(w - 9, h - 8); ctx.lineTo(w - 6, h - 11); ctx.lineTo(w - 3, h - 8); ctx.fill(); } // «верх»
      break;
    }
    case 'bricks': {
      R('#8a6a40', 0, h - 5, w, 5); R('#5e4526', 3, h - 4, 4, 4); R('#5e4526', w / 2 - 2, h - 4, 4, 4); R('#5e4526', w - 7, h - 4, 4, 4); // поддон
      for (let y = 0, row = 0; y < h - 6; y += 5, row++) for (let x = row % 2 ? -5 : 0; x < w; x += 10) R(row % 2 ? c[0] : c[2], Math.max(0, x), y, Math.min(9, w - Math.max(0, x)), 4);
      R('rgba(255,255,255,.35)', 0, 0, w, 1); ctx.strokeStyle = 'rgba(40,40,60,.5)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, h - 6); // плёнка и лента
      break;
    }
    case 'cement': case 'sack': case 'drywall': {
      if (s.sort === 'drywall') { for (let k = 0; k < 4; k++) { R(k % 2 ? c[1] : c[0], 0, k * 4, w, 4); } R('#b0aca2', 0, h - 1, w, 1); R('#7a8a9a', 3, 2, 10, 1); break; }
      const n = s.sort === 'cement' ? 2 : 1;
      for (let k = 0; k < n; k++) { const y = h - (k + 1) * (h / n); ctx.fillStyle = c[0]; ctx.beginPath(); ctx.ellipse(w / 2, y + h / n / 2, w / 2, h / n / 2, 0, 0, 7); ctx.fill(); ctx.fillStyle = c[1]; ctx.fillRect(3, y + h / n / 2, w - 6, 1.5); }
      if (s.sort === 'cement') { R('#c62828', w / 2 - 5, h / 2 - 7, 10, 3); R('#1e5bb8', w / 2 - 5, h - 7, 10, 3); } else { R('#161310', w / 2 - 3, 0, 6, 3); ctx.fillStyle = '#111'; for (let k = 0; k < 4; k++) ctx.fillRect(3 + k * 5, 1 + (k % 2), 3, 2); }
      break;
    }
    case 'tubing': {
      ctx.fillStyle = c[0]; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, 6); ctx.quadraticCurveTo(w / 2, -4, w, 6); ctx.lineTo(w, h); ctx.fill();
      R(c[1], 0, h - 4, w, 4); R(c[2], 3, 8, w - 6, 1.5);
      ctx.fillStyle = '#3e4248'; for (const x of [7, w / 2, w - 7]) { ctx.beginPath(); ctx.arc(x, h / 2 + 3, 2.2, 0, 7); ctx.fill(); } // болтовые отверстия
      R('#f2c230', 3, h - 10, 8, 2);
      break;
    }
    case 'boulder': {
      ctx.fillStyle = c[0]; ctx.beginPath(); ctx.moveTo(2, h); ctx.lineTo(0, h * 0.5); ctx.lineTo(6, 4); ctx.lineTo(w * 0.55, 0); ctx.lineTo(w - 3, 7); ctx.lineTo(w, h * 0.6); ctx.lineTo(w - 2, h); ctx.fill();
      ctx.fillStyle = c[2]; ctx.beginPath(); ctx.moveTo(6, 5); ctx.lineTo(w * 0.55, 1); ctx.lineTo(w * 0.5, 8); ctx.lineTo(10, 11); ctx.fill();
      ctx.fillStyle = c[1]; ctx.beginPath(); ctx.moveTo(w - 3, 8); ctx.lineTo(w, h * 0.6); ctx.lineTo(w - 2, h); ctx.lineTo(w * 0.62, h); ctx.fill();
      break;
    }
    case 'cones': {
      for (let k = 0; k < 3; k++) { const y = h - 8 - k * 5; ctx.fillStyle = c[0]; ctx.beginPath(); ctx.moveTo(1, y + 8); ctx.lineTo(w / 2 - 2, y - 10 + k); ctx.lineTo(w / 2 + 2, y - 10 + k); ctx.lineTo(w - 1, y + 8); ctx.fill(); }
      R(c[1], 4, h - 16, w - 8, 3); R(c[1], 6, h - 23, w - 12, 2); R('#222', 0, h - 3, w, 3);
      break;
    }
    case 'reel': {
      R(c[1], 3, 3, w - 6, h - 6);
      ctx.fillStyle = c[2]; for (let y = 6; y < h - 6; y += 3) ctx.fillRect(4, y, w - 8, 2); // намотанный кабель
      ctx.fillStyle = c[0]; ctx.beginPath(); ctx.arc(w / 2, h / 2, h / 2, 0, 7); ctx.fill(); // щека барабана (смотрит на нас)
      ctx.fillStyle = c[1]; ctx.beginPath(); ctx.arc(w / 2, h / 2, h / 2 - 3, 0, 7); ctx.fill();
      ctx.strokeStyle = c[0]; ctx.lineWidth = 2; ctx.beginPath(); for (let a = 0; a < 6; a++) { ctx.moveTo(w / 2, h / 2); ctx.lineTo(w / 2 + Math.cos(a) * 12, h / 2 + Math.sin(a) * 12); } ctx.stroke();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 3, 0, 7); ctx.fill();
      break;
    }
    case 'glass': {
      R(c[3], 0, h - 4, w, 4); R(c[3], 0, 0, 3, h); R(c[3], w - 3, 0, 3, h); // деревянная обрешётка
      for (let k = 0; k < 3; k++) { R(k % 2 ? c[1] : c[0], 4 + k * 2, 2, w - 10 - k * 2, h - 8); }
      R(c[2], 8, 5, 2, h - 14); R(c[2], 11, 5, 1, h - 18);
      R('#e53935', 4, h / 2 - 2, w - 8, 4); R('#fff', w / 2 - 6, h / 2 - 1, 12, 1.5); // лента «ОСТОРОЖНО, СТЕКЛО»
      break;
    }
    case 'ice': {
      ctx.fillStyle = c[1]; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(1, 5); ctx.lineTo(8, 0); ctx.lineTo(w - 4, 2); ctx.lineTo(w, h); ctx.fill();
      ctx.fillStyle = c[0]; ctx.beginPath(); ctx.moveTo(3, h - 3); ctx.lineTo(4, 7); ctx.lineTo(9, 3); ctx.lineTo(w * 0.6, 4); ctx.lineTo(w * 0.5, h - 3); ctx.fill();
      R(c[2], 6, 6, 3, 10); R(c[2], 11, 5, 5, 2); R('rgba(255,255,255,.9)', 0, -2, w - 2, 3); // снежная шапка
      break;
    }
    case 'firewood': {
      for (let row = 0; row < 3; row++) for (let k = 0; k < 4 - (row === 2 ? 1 : 0); k++) {
        const cx = 4 + k * 8 + (row === 2 ? 4 : 0), cy = h - 4 - row * 7;
        ctx.fillStyle = c[0]; ctx.beginPath(); ctx.arc(cx, cy, 3.8, 0, 7); ctx.fill(); ctx.fillStyle = c[1]; ctx.beginPath(); ctx.arc(cx, cy, 2.4, 0, 7); ctx.fill();
      }
      break;
    }
    case 'cabinet': {
      R(c[0], 0, 0, w, h); R(c[1], 0, h / 2 - 0.5, w, 1); R(c[1], 0, 0, w, 1); R(c[2], 1, 1, 2, h - 2);
      R('#333', w / 2 - 3, h / 4, 6, 2); R('#333', w / 2 - 3, h * 3 / 4, 6, 2); R('#f4f1e6', w / 2 - 5, h / 4 + 3, 10, 3); R('#f4f1e6', w / 2 - 5, h * 3 / 4 + 3, 10, 3); // ручки и таблички
      R('#f4f1e6', 2, -3, 8, 3); R('#e0dccf', 11, -2, 8, 2); // стопка бумаг сверху
      break;
    }
  }
  if (dmg > 0) { // следы ударов: трещины, вмятины, щепа
    ctx.strokeStyle = b.mat === 'metal' ? 'rgba(0,0,0,.55)' : b.mat === 'ice' || b.mat === 'glass' ? 'rgba(255,255,255,.9)' : 'rgba(30,20,10,.75)'; ctx.lineWidth = 1.3; ctx.beginPath();
    ctx.moveTo(w * 0.7, 3); ctx.lineTo(w * 0.55, h * 0.35); ctx.lineTo(w * 0.72, h * 0.55);
    if (dmg > 1) { ctx.moveTo(w * 0.2, h * 0.3); ctx.lineTo(w * 0.38, h * 0.55); ctx.lineTo(w * 0.25, h * 0.85); }
    if (dmg > 2) { ctx.moveTo(w * 0.45, h * 0.6); ctx.lineTo(w * 0.62, h * 0.9); ctx.moveTo(w * 0.1, h * 0.7); ctx.lineTo(w * 0.3, h * 0.65); }
    ctx.stroke();
  }
}

function drawTreasure(k) { // клад: сияние, искры и свой значок
  const T = TREASURES[k.kind], y = k.y + Math.sin(k.t * 2.5) * 3, now = performance.now() / 1000;
  ctx.save(); ctx.translate(k.x, y);
  const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 30); g.addColorStop(0, T.color + 'aa'); g.addColorStop(1, T.color + '00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 30, 0, 7); ctx.fill();
  for (let i = 0; i < 4; i++) { const a = now * 1.5 + i * 1.57, r = 18 + Math.sin(now * 3 + i) * 3; ctx.fillStyle = '#fff'; ctx.fillRect(Math.cos(a) * r - 1, Math.sin(a) * r - 1, 2, 2); }
  switch (k.kind) {
    case 'relic': ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(0, 2, 12, Math.PI, 0); ctx.fill(); ctx.fillRect(-16, 1, 32, 4); ctx.fillStyle = '#fff3b0'; ctx.fillRect(-2, -10, 4, 11); ctx.fillStyle = '#c99a1a'; ctx.fillRect(-16, 4, 32, 1.5); text('4', 0, -14, 10, '#fff3b0'); break;
    case 'theodolite': ctx.strokeStyle = '#c99a1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8, 14); ctx.moveTo(0, 0); ctx.lineTo(8, 14); ctx.stroke(); ctx.fillStyle = '#ffd24a'; ctx.fillRect(-7, -12, 14, 11); ctx.fillStyle = '#c99a1a'; ctx.fillRect(-10, -9, 4, 5); ctx.fillStyle = '#9fd3ff'; ctx.fillRect(6, -9, 3, 4); break;
    case 'benchmark': ctx.fillStyle = '#b08a4a'; ctx.beginPath(); ctx.arc(0, -2, 10, 0, 7); ctx.fill(); ctx.fillStyle = '#e0c080'; ctx.beginPath(); ctx.arc(0, -2, 7, 0, 7); ctx.fill(); ctx.fillStyle = '#6a4a20'; ctx.fillRect(-1, -8, 2, 12); ctx.fillRect(-5, -2, 10, 2); text('1913', 0, 16, 7, '#fff0c0'); break;
    case 'map': ctx.fillStyle = '#e8e0c8'; ctx.fillRect(-11, -9, 22, 16); ctx.strokeStyle = '#6a8a5a'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i < 3; i++) { ctx.moveTo(-10, -5 + i * 4); ctx.quadraticCurveTo(0, -8 + i * 4, 10, -4 + i * 4); } ctx.stroke(); ctx.fillStyle = '#c62828'; ctx.fillRect(2, -3, 3, 3); break;
    case 'nugget': ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.moveTo(-10, 4); ctx.lineTo(-6, -7); ctx.lineTo(3, -9); ctx.lineTo(10, -2); ctx.lineTo(7, 6); ctx.fill(); ctx.fillStyle = '#fff3b0'; ctx.fillRect(-4, -5, 5, 2); ctx.fillStyle = '#b8860b'; ctx.fillRect(2, 1, 5, 3); break;
    case 'lamp': ctx.fillStyle = '#8a6a3a'; ctx.fillRect(-5, -2, 10, 12); ctx.fillStyle = '#ffe9a0'; ctx.fillRect(-4, -12, 8, 10); ctx.strokeStyle = '#6a4a20'; ctx.lineWidth = 1.5; ctx.strokeRect(-4, -12, 8, 10); ctx.beginPath(); ctx.arc(0, -15, 4, Math.PI, 0); ctx.stroke(); break;
    case 'coins': ctx.fillStyle = '#6a4a2a'; ctx.fillRect(-12, -2, 24, 12); ctx.fillStyle = '#ffd24a'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(-8 + i * 4, -3 - (i % 2) * 3, 4, 2.5, 0, 0, 7); ctx.fill(); } ctx.fillStyle = '#4a3218'; ctx.fillRect(-12, 3, 24, 2); break;
    case 'tokens': ctx.fillStyle = '#e0c080'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-7 + i * 7, -2 + (i % 2) * 3, 5, 0, 7); ctx.fill(); ctx.fillStyle = '#c62828'; ctx.fillRect(-9 + i * 7, -3 + (i % 2) * 3, 4, 2); ctx.fillStyle = '#e0c080'; } break;
  }
  ctx.restore();
}

function drawBreakable(s) { // бочка, ящик или кладка с трещинами — всё ломается рейкой
  const now = performance.now() / 1000;
  ctx.save(); ctx.translate(s.x, s.y);
  if (s.hit > 0) ctx.translate(Math.sin(now * 90) * 1.5, 0);
  const dmg = s.maxHp - s.hp;
  if (s.sort !== 'crack') { drawBreakableBody(s, BREAKABLES[s.sort]); ctx.restore(); return; }
  { // кладка, закрывающая тайник: трещины, из которых пробивается золотой свет
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

// ---------- подземные ходы и этажи здания: задники по умолчанию (тема может нарисовать свои: drawTunnel, drawRoom, drawCeiling) ----------
function drawHatch(p) { // люк над лестницей: решётчатый настил
  ctx.fillStyle = '#4a4f5a'; ctx.fillRect(p.x, p.y, p.w, 5);
  ctx.fillStyle = '#8a93a0'; for (let x = p.x + 2; x < p.x + p.w - 1; x += 4) ctx.fillRect(x, p.y, 1.5, 5);
  ctx.fillStyle = '#f2c230'; ctx.fillRect(p.x, p.y, 3, 5); ctx.fillRect(p.x + p.w - 3, p.y, 3, 5);
}
function drawCrumble(p) { // шаткие мостки из досок или леса на хлипких трубах; трясутся, потом падают
  if (p.state === 'gone') return;
  const sh = p.state === 'shake' ? Math.sin(performance.now() / 18) * 1.6 : 0;
  ctx.translate(p.x + p.w / 2 + sh, p.y + (p.state === 'shake' ? Math.abs(sh) * 0.6 : 0)); if (p.rot) ctx.rotate(p.rot);
  const w = p.w;
  if (!p.walk) { // леса: две хлипкие стойки и раскос висят без опоры
    ctx.strokeStyle = '#9aa4b0'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(-w / 2 + 8, 6); ctx.lineTo(-w / 2 + 10, 40); ctx.moveTo(w / 2 - 8, 6); ctx.lineTo(w / 2 - 12, 34); ctx.moveTo(-w / 2 + 8, 30); ctx.lineTo(w / 2 - 10, 10); ctx.stroke();
  }
  for (let x = -w / 2, k = 0; x < w / 2; x += 11, k++) { // доски, одна-две с зазором или треснувшие
    if (hash(k * 7 + p.v * 100) < 0.12) continue;
    ctx.fillStyle = k % 2 ? '#a0703a' : '#b88048'; ctx.fillRect(x, 0, Math.min(10, w / 2 - x), 6);
    ctx.fillStyle = '#6a4a22'; ctx.fillRect(x, 5, Math.min(10, w / 2 - x), 1.5);
    if (hash(k * 3 + 1) < 0.25) { ctx.fillStyle = '#3a2a14'; ctx.fillRect(x + 4, 1, 1, 4); }
  }
  ctx.fillStyle = '#e53935'; ctx.fillRect(-w / 2, -14, 3, 14); ctx.fillRect(w / 2 - 3, -14, 3, 14); // сигнальная лента
  for (let x = -w / 2; x < w / 2; x += 8) { ctx.fillStyle = (x / 8) % 2 ? '#fff' : '#e53935'; ctx.fillRect(x, -13 + Math.sin(x * 0.2) * 1.2, 8, 2); }
}
function drawTunnelBack(t) {
  const x0 = t.x1, x1 = t.x2, y0 = t.top, y1 = t.floor, sb = t.slabBot, mine = G.underground === 'mine';
  ctx.fillStyle = mine ? '#1a130d' : '#1f2227'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  const vx0 = Math.max(x0, camX - 40), vx1 = Math.min(x1, camX + W + 40);
  if (mine) { // порода и деревянная крепь: стойки и верхняки
    for (let x = Math.floor(vx0 / 23) * 23; x < vx1; x += 23) { const h = hash(x * 3 + 7); ctx.fillStyle = h > 0.5 ? '#120d09' : '#2c2118'; ctx.fillRect(x, sb + 6 + h * (y1 - sb - 20), 6 + h * 8, 3 + h * 4); }
    for (let x = Math.ceil((vx0 - 40) / 90) * 90 + 20; x < vx1; x += 90) {
      if (x < x0 + 8 || x > x1 - 8) continue;
      ctx.fillStyle = '#5a3e22'; ctx.fillRect(x - 22, sb, 5, y1 - sb); ctx.fillRect(x + 17, sb, 5, y1 - sb);
      ctx.fillStyle = '#6e4c2a'; ctx.fillRect(x - 26, sb, 52, 6); ctx.fillStyle = '#3a2816'; ctx.fillRect(x - 26, sb + 5, 52, 1.5);
    }
  } else { // тоннель из тюбингов: кольца, кабельные лотки, лампы
    ctx.fillStyle = '#2b2f36'; for (let x = Math.floor(vx0 / 28) * 28; x < vx1; x += 28) ctx.fillRect(x, sb, 2, y1 - sb);
    ctx.fillStyle = '#3a3f47'; ctx.fillRect(x0, sb + 16, x1 - x0, 2); ctx.fillRect(x0, sb + 24, x1 - x0, 2);
    ctx.fillStyle = '#1a1c20'; ctx.fillRect(x0, sb + 20, x1 - x0, 3);
    ctx.fillStyle = '#c24f37'; ctx.fillRect(x0, sb + 30, x1 - x0, 1.5);
  }
  for (let x = Math.ceil((vx0 - 60) / 240) * 240 + 60; x < vx1 + 60; x += 240) { // лампы
    if (x < x0 + 20 || x > x1 - 20) continue;
    const g = ctx.createRadialGradient(x, sb + 14, 2, x, sb + 14, 70); g.addColorStop(0, 'rgba(255,214,140,.35)'); g.addColorStop(1, 'rgba(255,214,140,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 70, sb, 140, y1 - sb);
    ctx.fillStyle = '#ffe2a0'; ctx.fillRect(x - 4, sb + 10, 8, 5); ctx.fillStyle = '#333'; ctx.fillRect(x - 1, sb, 2, 10);
  }
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x0, sb, x1 - x0, 8); // тень под перекрытием
}
function drawRoomBack(rm) { // этаж здания по умолчанию: стены и окна
  ctx.fillStyle = 'rgba(40,40,56,.35)'; ctx.fillRect(rm.x1, rm.y - FH, rm.x2 - rm.x1, FH);
}
function drawCeilingDefault(s) {
  ctx.fillStyle = '#6d7280'; ctx.fillRect(s.x, s.y, s.w, s.h); ctx.fillStyle = '#50545f'; ctx.fillRect(s.x, s.y + s.h - 3, s.w, 3);
}

// ---------- задний план: бригады рабочих, птицы, самолёты, крысы — у каждого участка своё ----------
const AMBIENT = {
  city:   { birds: 'pigeon', plane: true, special: { type: 'kids', chance: 0.4 }, look: { vests: ['#ff7a1a', '#c6ff00', '#ff7a1a'], helmets: ['#f2c230', '#ffffff', '#ff7a1a'], jacket: '#34405a' } },
  pit:    { birds: 'crow', look: { vests: ['#ff7a1a', '#c6ff00'], helmets: ['#f2c230', '#ff7a1a', '#ffffff'], jacket: '#4a3a2a' } },
  metro:  { rats: true, drips: true, look: { vests: ['#ff7a1a', '#ffb300'], helmets: ['#ff7a1a', '#ffffff'], jacket: '#2a3140' } },
  mine:   { rats: true, bats: true, special: { type: 'drunks', chance: 0.35 }, look: { vests: ['#6a4a2a', '#5a4030'], helmets: ['#9a9a94', '#b4a060'], jacket: '#1e232c', lamp: true, dirty: true } },
  quarry: { birds: 'raven', plane: true, look: { vests: ['#ff9800', '#ffc107'], helmets: ['#ffffff', '#f2c230'], jacket: '#5d4037' } },
  road:   { birds: 'sparrow', plane: true, look: { vests: ['#ff6d00', '#c6ff00'], helmets: ['#ff6d00', '#ffffff'], jacket: '#424242' } },
  bridge: { birds: 'gull', look: { vests: ['#00e5ff', '#ff7a1a'], helmets: ['#ff9800', '#ffffff'], jacket: '#1a237e' } },
  tower:  { birds: 'pigeon', heli: true, jumpers: 2, look: { vests: ['#ff7a1a', '#b388ff'], helmets: ['#e53935', '#ffffff', '#f2c230'], jacket: '#263238', harness: true } },
  tundra: { birds: 'raven', look: { vests: ['#ff3d00', '#ff7a1a'], helmets: ['#ff7a1a', '#ffffff'], jacket: '#1b5e20', coat: true } },
  dam:    { birds: 'gull', heli: true, look: { vests: ['#ff7a1a', null, null], helmets: ['#ffffff', '#ffffff', '#1e5bb8'], jacket: '#263238', suits: true } },
};
const ambOf = () => AMBIENT[theme && theme.id] || AMBIENT.city;
let amb = null;
function resetAmbient() { amb = { jumpers: [], jumpLeft: (ambOf().jumpers || 0), jumpT: rand(6, 12), flocks: [], flockT: rand(1, 4), plane: null, planeT: rand(8, 18), heli: null, heliT: rand(12, 25), rats: [], ratT: rand(2, 5), bats: [], batT: rand(3, 6), drips: [], dripT: 1, lastCam: camX }; }

function updateAmbient(dt) {
  if (!amb) resetAmbient();
  const A = ambOf(), dc = camX - amb.lastCam; amb.lastCam = camX;
  if (A.birds && (amb.flockT -= dt) <= 0) {
    amb.flockT = rand(6, 12);
    const dir = Math.random() < 0.5 ? -1 : 1, n = 3 + Math.floor(rand(0, 6)), birds = [];
    for (let i = 0; i < n; i++) birds.push({ dx: -dir * i * rand(10, 18), dy: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * rand(4, 8), ph: rand(0, 6) });
    amb.flocks.push({ x: dir > 0 ? -60 : W + 60, y: rand(28, 130), vx: dir * rand(45, 80), dir, birds, kind: A.birds });
  }
  if (ambOf().special && ambOf().special.type === 'drunks' && Math.random() < dt * 0.6) // храп спящих шахтёров — когда герой рядом
    for (const c of crowds) if (c.type === 'drunks' && Math.abs(player.x - c.x) < 120 && Math.abs(player.y + player.h - c.y) < 60) { Sound.play('snore'); break; }
  for (const f of amb.flocks) { f.x += f.vx * dt - dc * 0.3; f.y += Math.sin(performance.now() / 700 + f.dir) * 4 * dt; }
  amb.flocks = amb.flocks.filter(f => f.x > -250 && f.x < W + 250);
  if (A.plane && !amb.plane && (amb.planeT -= dt) <= 0) { const d = Math.random() < 0.5 ? -1 : 1; amb.plane = { x: d > 0 ? -40 : W + 40, y: rand(22, 55), vx: d * rand(22, 34), trail: [] }; amb.planeT = rand(22, 38); }
  if (amb.plane) { const p = amb.plane; p.x += p.vx * dt - dc * 0.05; p.trail.push({ x: p.x, y: p.y, t: 0 }); for (const q of p.trail) { q.t += dt; q.x -= dc * 0.05; } p.trail = p.trail.filter(q => q.t < 9); if (p.x < -300 || p.x > W + 300) amb.plane = null; }
  if (amb.jumpLeft > 0 && camY < -120 && (amb.jumpT -= dt) <= 0) { // бейсджампер с крыши соседнего небоскрёба (не больше двух за участок)
    amb.jumpLeft--; amb.jumpT = rand(12, 22);
    amb.jumpers.push({ x: rand(W * 0.15, W * 0.85), y: -30, vx: rand(-25, 25), vy: 60, t: 0, open: false, col: ['#e53935', '#1e88e5', '#fdd835', '#8e24aa'][Math.floor(rand(0, 4))] });
  }
  for (const j of amb.jumpers) {
    j.t += dt;
    if (!j.open && j.t > 1.4) { j.open = true; j.vy = 70; }
    j.vy = j.open ? Math.max(28, j.vy - 120 * dt) : Math.min(260, j.vy + 400 * dt);
    j.x += (j.vx + (j.open ? Math.sin(j.t * 1.2) * 12 : 0)) * dt - dc * 0.35; j.y += j.vy * dt;
  }
  amb.jumpers = amb.jumpers.filter(j => j.y < H + 60);
  if (A.heli && !amb.heli && (amb.heliT -= dt) <= 0) { const d = Math.random() < 0.5 ? -1 : 1; amb.heli = { x: d > 0 ? -50 : W + 50, y: rand(40, 90), vx: d * rand(30, 45) }; amb.heliT = rand(25, 40); }
  if (amb.heli) { amb.heli.x += amb.heli.vx * dt - dc * 0.15; if (amb.heli.x < -100 || amb.heli.x > W + 100) amb.heli = null; }
  if (A.rats && (amb.ratT -= dt) <= 0) { // крыса перебегает по земле где-то в кадре
    amb.ratT = rand(4, 9);
    const d = Math.random() < 0.5 ? -1 : 1, x = camX + rand(W * 0.2, W * 0.9), g = groundBelow(x, player.y - 60);
    if (g !== null) amb.rats.push({ x, y: g, vx: d * rand(110, 160), t: rand(1.6, 2.6) });
  }
  for (const r of amb.rats) { r.x += r.vx * dt; r.t -= dt; const g = groundBelow(r.x, r.y - 20); if (g === null || Math.abs(g - r.y) > 4) r.t = 0; }
  amb.rats = amb.rats.filter(r => r.t > 0);
  if (A.bats && (amb.batT -= dt) <= 0) { amb.batT = rand(5, 10); const d = Math.random() < 0.5 ? -1 : 1; for (let i = 0; i < 1 + Math.floor(rand(0, 3)); i++) amb.bats.push({ x: d > 0 ? -20 - i * 25 : W + 20 + i * 25, y: rand(40, 120), vx: d * rand(80, 120), ph: rand(0, 6) }); }
  for (const b of amb.bats) { b.x += b.vx * dt - dc * 0.5; b.ph += dt * 3; }
  amb.bats = amb.bats.filter(b => b.x > -80 && b.x < W + 80);
  if (A.drips && (amb.dripT -= dt) <= 0) { amb.dripT = rand(0.4, 1.1); const x = camX + rand(0, W), g = groundBelow(x, player.y - 40); if (g !== null) { let c = null; for (const q of solids) if (q.kind !== 'breakable' && x >= q.x && x <= q.x + q.w && q.y + q.h <= g - 40 && q.y + q.h > g - 300 && (!c || q.y + q.h > c.y + c.h)) c = q; amb.drips.push({ x, y: c ? c.y + c.h : Math.max(camY - 10, g - 300), vy: 0, g }); } } // капает с ближайшего свода
  for (const d of amb.drips) { d.vy += 900 * dt; d.y += d.vy * dt; if (d.y >= d.g) { d.done = true; burst(d.x, d.g - 1, 'rgba(160,200,230,.8)', 3, 50, 400); } }
  amb.drips = amb.drips.filter(d => !d.done);
}

function drawBird(kind, x, y, ph) { // птица — «галочка» с машущими крыльями
  const k = Math.sin(ph) * 0.6, col = kind === 'gull' ? '#f4f6f8' : kind === 'pigeon' ? '#7d8592' : kind === 'sparrow' ? '#6d5540' : '#1c1c22', s = kind === 'sparrow' ? 0.7 : kind === 'gull' ? 1.2 : 1;
  ctx.strokeStyle = col; ctx.lineWidth = 1.6 * s; ctx.beginPath();
  ctx.moveTo(x - 6 * s, y - 3 * s * k); ctx.quadraticCurveTo(x - 3 * s, y - 4 * s * k - 1, x, y); ctx.quadraticCurveTo(x + 3 * s, y - 4 * s * k - 1, x + 6 * s, y - 3 * s * k); ctx.stroke();
  ctx.fillStyle = col; ctx.fillRect(x - 1, y - 0.5, 2.5, 2);
}
function drawSkyAmbient(bgShift) { // в экранных координатах, поверх фона темы
  if (!amb) return;
  const now = performance.now() / 1000;
  if (amb.plane) {
    const p = amb.plane;
    for (const q of p.trail) { ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - q.t / 9)})`; ctx.fillRect(q.x - 1, q.y + bgShift + 1, 3, 1.5 + q.t * 0.4); }
    ctx.fillStyle = '#e8ecf0'; ctx.fillRect(p.x - 7, p.y + bgShift, 14, 2.5); ctx.fillRect(p.x - 2, p.y + bgShift - 2, 4, 7); ctx.fillRect(p.x - (p.vx > 0 ? 7 : -5), p.y + bgShift - 3, 2, 3);
  }
  if (amb.heli) {
    const h = amb.heli, y = h.y + bgShift, d = Math.sign(h.vx);
    ctx.fillStyle = '#3a4250'; ctx.beginPath(); ctx.ellipse(h.x, y, 9, 5, 0, 0, 7); ctx.fill(); ctx.fillRect(h.x - d * 20, y - 2, 13, 2.5); ctx.fillRect(h.x - d * 21, y - 5, 2, 6);
    ctx.fillStyle = '#9fd3ff'; ctx.fillRect(h.x + d * 3, y - 3, 4 * d, 3);
    ctx.fillStyle = 'rgba(40,40,50,.5)'; ctx.fillRect(h.x - 14 + Math.sin(now * 40) * 3, y - 7, 28, 1.5); ctx.fillRect(h.x - 5, y + 5, 11, 1.2);
  }
  for (const f of amb.flocks) for (const b of f.birds) drawBird(f.kind, f.x + b.dx, f.y + b.dy + bgShift, now * 11 + b.ph);
  for (const j of amb.jumpers) { // бейсджампер: сначала свободное падение в вингсьюте, потом купол-крыло
    ctx.save(); ctx.translate(j.x, j.y); ctx.scale(0.7, 0.7);
    if (j.open) {
      ctx.fillStyle = j.col; ctx.beginPath(); ctx.moveTo(-22, -40); ctx.quadraticCurveTo(0, -52, 22, -40); ctx.lineTo(20, -34); ctx.quadraticCurveTo(0, -44, -20, -34); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.5)'; for (let k = -16; k <= 16; k += 8) ctx.fillRect(k, -44, 1.5, 7);
      ctx.strokeStyle = 'rgba(40,40,40,.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-20, -34); ctx.lineTo(0, -8); ctx.lineTo(20, -34); ctx.moveTo(-8, -38); ctx.lineTo(0, -8); ctx.lineTo(8, -38); ctx.stroke();
      ctx.fillStyle = '#263238'; ctx.fillRect(-3, -8, 6, 11); ctx.fillStyle = '#fdd835'; ctx.beginPath(); ctx.arc(0, -10, 3.5, 0, 7); ctx.fill();
      ctx.strokeStyle = '#263238'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-2, 3); ctx.lineTo(-3, 10); ctx.moveTo(2, 3); ctx.lineTo(3, 10); ctx.stroke();
    } else { // руки-ноги раскинуты, вингсьют
      ctx.fillStyle = j.col; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-14, 0); ctx.lineTo(-6, 4); ctx.lineTo(0, 10); ctx.lineTo(6, 4); ctx.lineTo(14, 0); ctx.fill();
      ctx.fillStyle = '#263238'; ctx.fillRect(-3, -8, 6, 14); ctx.fillStyle = '#fdd835'; ctx.beginPath(); ctx.arc(0, -11, 3.5, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  for (const b of amb.bats) { const y = b.y + Math.sin(b.ph * 2) * 10; ctx.fillStyle = '#0a0808'; ctx.beginPath(); ctx.moveTo(b.x - 7, y - 3 * Math.sin(b.ph * 6)); ctx.lineTo(b.x, y + 2); ctx.lineTo(b.x + 7, y - 3 * Math.sin(b.ph * 6)); ctx.lineTo(b.x, y - 1); ctx.fill(); }
}
function drawWorldAmbient() { // в координатах мира: крысы, капли
  if (!amb) return;
  for (const r of amb.rats) { const d = Math.sign(r.vx), b = Math.sin(r.t * 40) * 0.8; ctx.fillStyle = '#5a5550'; ctx.beginPath(); ctx.ellipse(r.x, r.y - 3 + b * 0.3, 6, 3, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(r.x + d * 6, r.y - 4, 2.2, 0, 7); ctx.fill();
    ctx.strokeStyle = '#8a7a70'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r.x - d * 5, r.y - 2); ctx.quadraticCurveTo(r.x - d * 11, r.y - 6 + b, r.x - d * 14, r.y - 2); ctx.stroke(); }
  ctx.fillStyle = 'rgba(170,210,240,.8)'; for (const d of amb.drips) ctx.fillRect(d.x - 0.8, d.y - 3, 1.6, 4);
}

// ---------- особые компании на заднем плане: подростки на городской стройке, спящие шахтёры ----------
const GRAFFITI = ['ЦОЙ ЖИВ', 'ВАСЯ', 'ЙО!', 'ГЕО', 'BEAR'];
function drawKids(c) { // хулиганят: рисуют граффити, курят, лазят по лесам, кидают камни; герой близко — «Шухер!» и врассыпную
  const now = performance.now() / 1000, near = Math.abs(player.x - (c.x + 50)) < 110 && Math.abs(player.y + player.h - c.y) < 60;
  c.off = clamp((c.off || 0) + (near ? 3 : -0.6) * 0.016, 0, 1); // убегают и потихоньку возвращаются
  const run = c.off * 90;
  // стенка под граффити и кусок лесов
  const wx = c.x - 6, tag = GRAFFITI[c.seed % GRAFFITI.length], prog = ((now * 0.05 + (c.seed % 97) / 97) % 1.3);
  ctx.fillStyle = '#8f8b84'; ctx.fillRect(wx, c.y - 38, 58, 38); ctx.fillStyle = '#7b776f'; ctx.fillRect(wx, c.y - 38, 58, 3); ctx.fillRect(wx + 28, c.y - 38, 2, 38);
  ctx.save(); ctx.beginPath(); ctx.rect(wx + 3, c.y - 34, 52 * Math.min(1, prog), 30); ctx.clip();
  ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.lineWidth = 3; ctx.strokeStyle = '#1a1a1a'; ctx.strokeText(tag, wx + 4, c.y - 14);
  ctx.fillStyle = ['#ff3d7f', '#00e5ff', '#c6ff00', '#ffb02e'][c.seed % 4]; ctx.fillText(tag, wx + 4, c.y - 14); ctx.restore();
  const sx = c.x + 78; ctx.strokeStyle = '#7a8aa0'; ctx.lineWidth = 2; ctx.strokeRect(sx, c.y - 58, 26, 58); ctx.beginPath(); ctx.moveTo(sx, c.y - 29); ctx.lineTo(sx + 26, c.y - 29); ctx.stroke();
  const acts = ['spray', 'smoke', 'climb', 'throw', 'smoke'];
  for (let i = 0; i < Math.min(c.n, 5); i++) {
    const act = acts[(i + c.seed) % acts.length], h = hash(c.seed + i * 13);
    let x = c.x + 12 + i * 22, y = c.y, dir = 1;
    if (act === 'spray') x = wx + 60;
    if (act === 'climb') { x = sx + 13; y = c.y - (8 + Math.abs(Math.sin(now * 0.8 + h * 6)) * 34) * (1 - c.off); } // убегая, сначала слезает
    if (run > 0) { x += run * (i % 2 ? 1 : -1); dir = i % 2 ? 1 : -1; if (c.x0 != null) x = clamp(x, c.x0 + 8, c.x1 - 8); } // не дальше своего куска земли
    ctx.save(); ctx.translate(x, y); ctx.scale(0.62 * (act === 'spray' && !run ? -1 : dir), 0.62);
    const hood = ['#e53935', '#3949ab', '#43a047', '#8e24aa', '#fb8c00'][(c.seed + i) % 5], sw = run ? Math.sin(now * 18 + i) * 0.8 : 0;
    ctx.strokeStyle = '#263238'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (const s of [sw, -sw]) { ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(Math.sin(s) * 11 + (act === 'climb' ? 4 : 0), -2); ctx.stroke(); }
    ctx.fillStyle = '#fafafa'; for (const s of [sw, -sw]) ctx.fillRect(Math.sin(s) * 11 - 3, -4, 9, 4); // кеды
    ctx.fillStyle = hood; ctx.fillRect(-7, -35, 14, 19); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(-7, -22, 14, 2);
    ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(1, -41, 6, 0, 7); ctx.fill(); ctx.fillStyle = '#222'; ctx.fillRect(3, -43, 2, 2);
    ctx.fillStyle = i % 2 ? hood : '#212121'; ctx.beginPath(); ctx.arc(1, -44, 6.5, Math.PI, 0); ctx.fill(); ctx.fillRect(-9, -45, 8, 2); // кепка козырьком назад
    ctx.strokeStyle = hood; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(0, -31);
    if (run) { ctx.lineTo(8, -40); ctx.stroke(); }
    else if (act === 'spray') { ctx.lineTo(10, -33); ctx.stroke(); ctx.fillStyle = '#d32f2f'; ctx.fillRect(9, -38, 4, 8); ctx.fillStyle = 'rgba(255,255,255,.35)'; for (let k = 0; k < 4; k++) ctx.fillRect(14 + k * 3 + Math.sin(now * 20 + k) * 2, -36 + Math.cos(now * 17 + k) * 3, 2, 2); }
    else if (act === 'smoke') { ctx.lineTo(5, -38); ctx.stroke(); ctx.fillStyle = '#eee'; ctx.fillRect(5, -40, 6, 1.5); ctx.fillStyle = '#ff5722'; ctx.fillRect(11, -40, 1.5, 1.5);
      for (let k = 0; k < 3; k++) { const t = (now * 0.6 + k / 3 + h) % 1; ctx.fillStyle = `rgba(220,220,220,${0.5 * (1 - t)})`; ctx.beginPath(); ctx.arc(12 + t * 6 + Math.sin(t * 9) * 2, -42 - t * 22, 2 + t * 4, 0, 7); ctx.fill(); } }
    else if (act === 'climb') { ctx.lineTo(3, -48); ctx.stroke(); }
    else { const a = (now * 1.3 + h * 5) % 2; ctx.lineTo(a < 0.3 ? -6 : 9, a < 0.3 ? -42 : -30); ctx.stroke(); if (a > 0.3 && a < 1.1) { const t = (a - 0.3) / 0.8; ctx.fillStyle = '#6d6d6d'; ctx.fillRect(12 + t * 60, -34 - Math.sin(t * Math.PI) * 26, 3, 3); } } // кидает камень
    ctx.restore();
  }
  if (run > 20) text('Шухер!', c.x + 40, c.y - 70, 11, '#ffeb3b');
}
function drawDrunks(c) { // уставшие шахтёры спят в обнимку с бутылкой, вокруг пустая тара, над ними «Z-z-z»
  const now = performance.now() / 1000;
  ctx.fillStyle = '#3a2a1a'; ctx.fillRect(c.x - 6, c.y - 5, 70, 5); // подстелили доски
  for (let i = 0; i < Math.min(c.n, 2); i++) {
    const x = c.x + i * 34, br = Math.sin(now * 1.6 + i * 2) * 1.2; // дышат
    ctx.save(); ctx.translate(x, c.y);
    ctx.strokeStyle = '#1e232c'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(4, -5); ctx.lineTo(24, -4); ctx.moveTo(4, -6); ctx.lineTo(22, -9); ctx.stroke(); // ноги
    ctx.fillStyle = '#5a4030'; ctx.fillRect(22, -8, 5, 7); ctx.fillRect(20, -13, 5, 6); // сапоги
    ctx.fillStyle = '#252c38'; ctx.fillRect(-16, -12 - br, 22, 11 + br); ctx.fillStyle = 'rgba(15,15,15,.45)'; ctx.fillRect(-12, -10 - br, 5, 3); // туловище
    ctx.fillStyle = '#b98f60'; ctx.beginPath(); ctx.arc(-21, -7, 5.5, 0, 7); ctx.fill(); ctx.fillStyle = '#c0504a'; ctx.beginPath(); ctx.arc(-22, -5, 2, 0, 7); ctx.fill(); // красный нос
    ctx.fillStyle = '#9a9a94'; ctx.beginPath(); ctx.arc(-29, -3, 6, Math.PI * 1.3, Math.PI * 2.3); ctx.fill(); ctx.fillStyle = '#fff6b0'; ctx.fillRect(-35, -4, 2, 2); // каска съехала
    ctx.fillStyle = 'rgba(210,235,245,.85)'; ctx.fillRect(-10, -18 - br, 16, 5); ctx.fillRect(6, -17 - br, 4, 3); // бутылка в обнимку
    ctx.fillStyle = '#fff'; ctx.fillRect(-6, -18 - br, 7, 5); ctx.fillStyle = '#c62828'; ctx.fillRect(-5, -16 - br, 5, 1);
    ctx.strokeStyle = '#252c38'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(-12, -12); ctx.quadraticCurveTo(-4, -22 - br, 4, -14); ctx.stroke(); // рука обнимает
    ctx.restore();
    for (let k = 0; k < 3; k++) { const t = (now * 0.35 + k / 3 + i * 0.5) % 1; ctx.globalAlpha = 1 - t; text('z', x - 20 + t * 14 + Math.sin(t * 8) * 3, c.y - 22 - t * 30, 8 + t * 6, '#cfd8dc'); ctx.globalAlpha = 1; }
  }
  ctx.fillStyle = 'rgba(210,235,245,.7)'; ctx.save(); ctx.translate(c.x + 62, c.y - 3); ctx.rotate(1.4); ctx.fillRect(-3, -8, 6, 14); ctx.restore(); ctx.fillRect(c.x + 70, c.y - 13, 5, 13); // пустая тара
}

function drawCrowd(c) { // бригада на заднем плане: мельче и темнее героя, каждый занят своим делом
  if (c.type === 'kids') { drawKids(c); return; }
  if (c.type === 'drunks') { drawDrunks(c); return; }
  const L = ambOf().look, now = performance.now() / 1000;
  for (let i = 0; i < c.n; i++) {
    const h = hash(c.seed + i * 17), h2 = hash(c.seed * 3 + i * 31), act = Math.floor(h * 7);
    let x = c.x + i * 19 + h2 * 6;
    if (act === 2) x += Math.sin(now * 0.7 + h2 * 6) * 22; // носит доску туда-сюда
    const dir = act === 2 ? (Math.cos(now * 0.7 + h2 * 6) > 0 ? 1 : -1) : (h2 > 0.5 ? 1 : -1);
    const near = Math.abs(player.x - x) < 80 && Math.abs(player.y + player.h - c.y) < 50;
    ctx.save(); ctx.translate(x, c.y); ctx.scale(0.78 * dir, 0.78); ctx.globalAlpha = 0.92;
    drawWorker(L, act, now + h * 10, i + c.seed, near);
    ctx.restore();
  }
}
function drawWorker(L, act, t, id, wave) {
  const suit = L.suits && hash(id * 7) > 0.55, vest = suit ? null : L.vests[id % L.vests.length], helmet = L.helmets[id % L.helmets.length];
  const walk = act === 2, sw = walk ? Math.sin(t * 8) * 0.6 : 0, sit = act === 4;
  ctx.strokeStyle = suit ? '#1a1d24' : '#262c38'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  if (sit) { ctx.fillStyle = '#5a6068'; ctx.fillRect(-7, -12, 14, 12); ctx.beginPath(); ctx.moveTo(-2, -14); ctx.lineTo(8, -14); ctx.lineTo(9, -2); ctx.stroke(); } // ведро-сиденье
  else for (const s of [sw, -sw]) { ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(Math.sin(s) * 11, -2); ctx.stroke(); }
  const by = sit ? 12 : 0; // сидящий — ниже
  ctx.fillStyle = L.coat ? L.jacket : suit ? '#2b2f3a' : L.jacket; ctx.fillRect(-7, -36 + by, 14, 20 + (L.coat ? 6 : 0));
  if (vest) { ctx.fillStyle = vest; ctx.fillRect(-7, -35 + by, 14, 15); ctx.fillStyle = 'rgba(235,240,240,.8)'; ctx.fillRect(-7, -27 + by, 14, 2); }
  if (suit) { ctx.fillStyle = '#fff'; ctx.fillRect(-2, -36 + by, 4, 9); ctx.fillStyle = '#c62828'; ctx.fillRect(-1, -35 + by, 2, 8); }
  if (L.harness) { ctx.strokeStyle = '#f2c230'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-6, -35 + by); ctx.lineTo(5, -20 + by); ctx.stroke(); }
  if (L.dirty) { ctx.fillStyle = 'rgba(15,15,15,.45)'; ctx.fillRect(-5, -32 + by, 4, 3); ctx.fillRect(2, -26 + by, 4, 3); }
  ctx.fillStyle = L.dirty ? '#b98f60' : '#e8b88a'; ctx.beginPath(); ctx.arc(1, -42 + by, 6, 0, 7); ctx.fill();
  if (L.coat) { ctx.fillStyle = '#6d4c41'; ctx.beginPath(); ctx.ellipse(1, -47 + by, 8, 4.5, 0, 0, 7); ctx.fill(); ctx.fillStyle = helmet; ctx.fillRect(-5, -52 + by, 12, 3); }
  else { ctx.fillStyle = helmet; ctx.beginPath(); ctx.arc(1, -45 + by, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -46 + by, 16, 2); }
  if (L.lamp) { ctx.fillStyle = '#fff6b0'; ctx.fillRect(6, -48 + by, 3, 3); }
  // руки и то, чем занят
  ctx.strokeStyle = L.jacket; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(0, -32 + by);
  if (wave) { ctx.lineTo(4, -44 + by); ctx.lineTo(6 + Math.sin(t * 12) * 3, -54 + by); ctx.stroke(); return; } // машет герою
  if (act === 0) { ctx.lineTo(7, -26 + by + Math.sin(t * 3) * 3); ctx.stroke(); }                                    // разговаривает, жестикулирует
  else if (act === 1) { const a = Math.sin(t * 7); ctx.lineTo(8, -30 - a * 8 + by); ctx.stroke(); ctx.fillStyle = '#5a5a5a'; ctx.fillRect(7, -38 - a * 8 + by, 3, 8); ctx.fillStyle = '#8a5a2b'; ctx.fillRect(8, -32 - a * 8 + by, 1.5, 7); } // молоток
  else if (act === 2) { ctx.lineTo(4, -38 + by); ctx.stroke(); ctx.fillStyle = '#c49a6c'; ctx.fillRect(-22, -42 + by, 44, 3); }   // доска на плече
  else if (act === 3) { const a = Math.sin(t * 3) * 0.3; ctx.lineTo(8, -22 + by); ctx.stroke(); ctx.save(); ctx.translate(8, -24 + by); ctx.rotate(0.5 + a); ctx.fillStyle = '#6d5040'; ctx.fillRect(-1, 0, 2, 22); ctx.fillStyle = '#707880'; ctx.fillRect(-4, 20, 8, 6); ctx.restore(); } // лопата
  else if (act === 4) { ctx.lineTo(6, -40 + by + Math.max(0, Math.sin(t)) * 4); ctx.stroke(); ctx.fillStyle = '#e8e2d0'; ctx.fillRect(5, -44 + by + Math.max(0, Math.sin(t)) * 4, 4, 5); } // пьёт чай
  else if (act === 5) { ctx.lineTo(8, -30 + by); ctx.stroke(); ctx.fillStyle = '#cfe6ff'; ctx.fillRect(6, -38 + by, 12, 9); ctx.fillStyle = '#2f6fd0'; ctx.fillRect(7, -37 + by, 10, 1); ctx.fillRect(7, -34 + by, 7, 1); } // прораб с чертежом
  else { ctx.lineTo(5, -42 + by); ctx.stroke(); ctx.fillStyle = '#222'; ctx.fillRect(4, -46 + by, 3, 6); }             // говорит по телефону
}

// ---------- снаряжение героя: на каждом участке свой геодезический инструмент (theme.hero.weapon) ----------
// Инструмент рисуется вдоль оси x (от руки наружу); голова инструмента — на конце, «вверх» у неё — наружу по оси.
const WEAPONS = {
  // len — длина в игровых единицах (герой — 40 единиц ≈ 1,8 м), reach — дальность удара
  staff:     { name: 'Нивелирная рейка', len: 52, reach: 64 },
  gnss:      { name: 'GNSS-приёмник на вешке', len: 42, reach: 64 },
  prism:     { name: 'Вешка с отражателем', len: 42, reach: 64 },
  slam:      { name: 'SLAM-сканер на вешке', len: 40, reach: 64 },
  prism360:  { name: 'Вешка с отражателем 360°', len: 40, reach: 66 },
  prismMark: { name: 'Большой отражатель с маркой', len: 42, reach: 70 },
  invar:     { name: 'Инварная рейка', len: 56, reach: 68 },
};
const heroOf = () => (theme && theme.hero) || {};
const weaponOf = () => WEAPONS[heroOf().weapon] ? heroOf().weapon : 'staff';

function drawPole(len, color = '#f2c230') { // вешка: секции, резиновая ручка, наконечник и круглый уровень
  ctx.fillStyle = '#9e9e9e'; ctx.fillRect(-16, -0.8, 7, 1.6);
  ctx.fillStyle = color; ctx.fillRect(-10, -1.7, len + 10, 3.4);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(len * 0.45, -1.7, 1.5, 3.4);
  ctx.fillStyle = '#263238'; ctx.fillRect(-4, -2.2, 12, 4.4);
  ctx.fillStyle = '#7cc47c'; ctx.beginPath(); ctx.arc(12, -3.5, 2.2, 0, 7); ctx.fill();
}

function drawWeapon(kind, len) {
  const now = performance.now() / 1000, h = heroOf();
  if (kind === 'staff') { drawStaff(len); return; }
  if (kind === 'invar') { // инварная рейка: алюминиевый профиль, в пазу — штрихкод, ручки и круглый уровень
    const L = len;
    ctx.fillStyle = '#b8c2ca'; ctx.fillRect(-12, -4, L, 8);
    ctx.fillStyle = '#f4f4f0'; ctx.fillRect(-9, -2.6, L - 6, 5.2);
    ctx.fillStyle = '#111';
    for (let x = -8, i = 0; x < L - 16; i++) { const w = 1 + Math.floor(hash(i * 13 + 7) * 3); if (i % 2 === 0) ctx.fillRect(x, -2.6, w, 5.2); x += w; }
    ctx.fillStyle = '#6d7880'; ctx.fillRect(-12, -4, 3, 8); ctx.fillRect(L - 15, -4, 3, 8); ctx.fillRect(10, 3.5, 7, 3); ctx.fillRect(28, 3.5, 7, 3);
    ctx.fillStyle = '#7cc47c'; ctx.beginPath(); ctx.arc(14, -6, 2.3, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.strokeRect(-12, -4, L, 8);
    return;
  }
  const big = kind === 'prismMark';
  drawPole(len, kind === 'slam' ? '#37474f' : kind === 'gnss' ? '#263238' : '#f2c230');
  if (kind === 'gnss') { ctx.fillStyle = '#263238'; ctx.fillRect(len * 0.5, 2, 8, 6); ctx.fillStyle = '#7cffb2'; ctx.fillRect(len * 0.5 + 1, 3, 6, 4); } // контроллер на кронштейне
  ctx.save(); ctx.translate(len, 0); ctx.rotate(Math.PI / 2); // дальше «вверх» = наружу по вешке
  if (big) ctx.scale(1.3, 1.3); // на мосту отражатель крупнее
  if (kind === 'gnss') { // приёмник: корпус и купол антенны; на снежном участке на куполе растёт сугроб
    ctx.fillStyle = '#607d8b'; ctx.fillRect(-7, -5, 14, 5);
    ctx.fillStyle = '#f5f5f5'; ctx.beginPath(); ctx.ellipse(0, -5, 8, 6, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = Math.floor(now * 3) % 2 ? '#39ff6a' : '#1b5e20'; ctx.fillRect(3, -4, 2, 2);
    if (h.domeSnow && player.domeSnow > 0.05) {
      const s = player.domeSnow;
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(0, -9, 7 + 3 * s, 2 + 7 * s, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(190,215,240,.8)'; ctx.fillRect(-6 - 3 * s, -9.5, 12 + 6 * s, 1.2);
      if (s > 0.8) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-1, -9 - 7 * s, 2.5, 0, 7); ctx.fill(); }
    }
  } else if (kind === 'prism' || kind === 'prismMark') { // однопризменный отражатель в оранжевой оправе
    ctx.fillStyle = '#555'; ctx.fillRect(-1.5, -4, 3, 4);
    ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(0, -11, 7, 0, 7); ctx.fill();
    ctx.fillStyle = '#c85a0c'; ctx.fillRect(-9, -12.5, 2, 3); ctx.fillRect(7, -12.5, 2, 3); // оси вилки
    const g = ctx.createRadialGradient(-1.5, -12.5, 0.5, 0, -11, 5); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#a8e0ff'); g.addColorStop(1, '#2d6c9c');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -11, 4.6, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(0, -15.5); ctx.lineTo(0, -11); ctx.lineTo(-3.9, -8.7); ctx.moveTo(0, -11); ctx.lineTo(3.9, -8.7); ctx.stroke();
    if (kind === 'prismMark') { // визирная марка: оранжево-белые треугольники над призмой
      ctx.fillStyle = '#ffffff'; ctx.fillRect(-7, -27, 14, 9);
      ctx.fillStyle = '#ff6d00'; ctx.beginPath(); ctx.moveTo(-7, -27); ctx.lineTo(0, -22.5); ctx.lineTo(-7, -18); ctx.fill();
      ctx.beginPath(); ctx.moveTo(7, -27); ctx.lineTo(0, -22.5); ctx.lineTo(7, -18); ctx.fill();
      ctx.strokeStyle = '#c85a0c'; ctx.lineWidth = 0.8; ctx.strokeRect(-7, -27, 14, 9);
    }
  } else if (kind === 'prism360') { // отражатель 360°: кольцо из шести призм между жёлтыми крышками
    ctx.fillStyle = '#555'; ctx.fillRect(-1.5, -4, 3, 4);
    ctx.fillStyle = '#f2c230'; ctx.fillRect(-7, -7, 14, 3); ctx.fillRect(-7, -23, 14, 3); ctx.fillRect(-2, -26, 4, 3);
    for (let i = 0; i < 3; i++) { // видны три грани кольца
      const x = -7 + i * 4.67, w = 4.67;
      const g = ctx.createLinearGradient(x, -20, x + w, -7); g.addColorStop(0, '#dff4ff'); g.addColorStop(0.5, i === 1 ? '#7fc4ee' : '#4f93c4'); g.addColorStop(1, '#1f4f78');
      ctx.fillStyle = g; ctx.fillRect(x, -20, w, 13);
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(x + w / 2, -20); ctx.lineTo(x + w / 2, -13.5); ctx.lineTo(x, -7); ctx.moveTo(x + w / 2, -13.5); ctx.lineTo(x + w, -7); ctx.stroke();
    }
    ctx.strokeStyle = '#1b2a36'; ctx.lineWidth = 0.8; ctx.strokeRect(-7, -20, 14, 13);
  } else if (kind === 'slam') { // SLAM-сканер: корпус с ручкой, наверху — наклонённый вращающийся лидар
    ctx.fillStyle = '#263238'; ctx.fillRect(-2, -5, 4, 5);
    ctx.fillStyle = '#eceff1'; ctx.fillRect(-7, -16, 14, 11);
    ctx.fillStyle = '#ff6d00'; ctx.fillRect(-7, -9, 14, 2);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-3, -12, 1.6, 0, 7); ctx.arc(3, -12, 1.6, 0, 7); ctx.fill(); // камеры
    ctx.save(); ctx.translate(0, -16); ctx.rotate(-0.45);
    ctx.fillStyle = '#37474f'; ctx.fillRect(-4.5, -12, 9, 12);
    ctx.fillStyle = '#90a4ae'; for (let i = 0; i < 3; i++) { const y = -11 + ((now * 30 + i * 4) % 12); ctx.fillRect(-4.5, y, 9, 1.2); } // вращение
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(-5, -13.5, 10, 2);
    ctx.fillStyle = `rgba(255,40,40,${0.5 + 0.5 * Math.sin(now * 25)})`; ctx.fillRect(4, -7, 2, 2);
    ctx.restore();
  }
  ctx.restore();
}

function drawPlayer() {
  const P = player;
  if (P.inv > 0 && Math.floor(P.inv * 14) % 2) return;
  const cx = P.x + P.w / 2, feet = P.y + P.h;
  ctx.save(); ctx.translate(cx, feet); ctx.scale(P.face, 1);
  const running = P.onGround && Math.abs(P.vx) > 20 && !P.climb, sw = P.climb ? Math.sin(P.anim * 3) * 0.5 : running ? Math.sin(P.anim * 2) * 0.7 : (P.onGround ? 0 : 0.5);
  const hero = heroOf(), dirty = hero.dirty;
  if (hero.backpack) { // полурасстёгнутый рюкзак с исполнительной документацией
    ctx.fillStyle = '#5d4030'; ctx.fillRect(-15, -37, 9, 18);
    ctx.fillStyle = '#f4f1e6'; ctx.save(); ctx.translate(-12, -37); ctx.rotate(-0.25); ctx.fillRect(-3, -7, 6, 8); ctx.restore();
    ctx.save(); ctx.translate(-9, -38); ctx.rotate(0.2); ctx.fillRect(-2, -6, 5, 7); ctx.fillStyle = '#9ab'; ctx.fillRect(-1, -4, 3, 0.8); ctx.fillRect(-1, -2.5, 3, 0.8); ctx.restore();
    ctx.fillStyle = '#4a3326'; ctx.save(); ctx.translate(-15, -37); ctx.rotate(-0.9); ctx.fillRect(0, -2, 10, 3); ctx.restore(); // откинутый клапан
    ctx.fillStyle = '#3b2a20'; ctx.fillRect(-15, -27, 9, 2); ctx.fillStyle = '#c9a227'; ctx.fillRect(-11, -27, 2, 2);
  }
  // ноги
  ctx.strokeStyle = '#2b3445'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (const s of [sw, -sw]) { ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(Math.sin(s) * 12, -2); ctx.stroke(); }
  ctx.fillStyle = '#4a3320'; for (const s of [sw, -sw]) ctx.fillRect(Math.sin(s) * 12 - 3, -4, 9, 4);
  // корпус: тёмная куртка и сигнальный жилет со световозвращающими полосами
  ctx.fillStyle = dirty ? '#252c38' : '#2f4a7a'; ctx.fillRect(-7, -36, 14, 20);
  ctx.fillStyle = dirty ? '#a4551a' : '#ff7a1a'; ctx.fillRect(-7, -35, 14, 17);
  ctx.fillStyle = dirty ? '#8e9090' : '#e9f2f2'; ctx.fillRect(-7, -28, 14, 2); ctx.fillRect(-7, -23, 14, 2); ctx.fillRect(-3, -35, 2, 7);
  if (hero.backpack) { ctx.fillStyle = '#3b2a20'; ctx.fillRect(-7, -35, 3, 12); } // лямка рюкзака
  // голова и белая каска инженера
  ctx.fillStyle = dirty ? '#b98f60' : '#f1c27d'; ctx.beginPath(); ctx.arc(1, -42, 6, 0, 7); ctx.fill();
  ctx.fillStyle = '#222'; ctx.fillRect(3, -44, 2, 2);
  if (dirty) { ctx.fillStyle = '#fff'; ctx.fillRect(3, -44, 1, 1); } // на чумазом лице блестят глаза
  ctx.fillStyle = dirty ? '#b4b4ae' : '#f7f7f7'; ctx.beginPath(); ctx.arc(1, -45, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -46, 16, 2);
  if (dirty) { // угольная пыль: пятна на каске, лице, жилете и штанах
    ctx.fillStyle = 'rgba(20,20,20,.55)';
    ctx.fillRect(-4, -50, 4, 2); ctx.fillRect(3, -48, 3, 2); ctx.fillRect(-3, -41, 3, 2); ctx.fillRect(4, -40, 3, 1.5);
    ctx.fillRect(-6, -33, 4, 3); ctx.fillRect(2, -30, 4, 4); ctx.fillRect(-5, -21, 5, 2); ctx.fillRect(1, -19, 5, 3);
    ctx.fillStyle = 'rgba(10,10,10,.35)'; ctx.fillRect(-7, -17, 14, 3);
  }
  if (theme.headlamp) { ctx.fillStyle = '#fff6b0'; ctx.fillRect(6, -48, 3, 3); } // налобный фонарь (шахта)
  if (theme.snowy) { // снег на каске, плечах и рукавах
    const k = clamp(P.snow, 0, 1);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(1, -51.5, 5 + 3 * k, 1.5 + 2.2 * k, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(245,250,255,.95)';
    ctx.fillRect(-8, -37 - k * 2, 6, 1.5 + k * 2); ctx.fillRect(3, -37 - k * 2, 5, 1.5 + k * 2);
    if (k > 0.4) { ctx.fillRect(-7, -30, 2, 2); ctx.fillRect(4, -22, 2, 2); ctx.fillRect(-1, -3, 4, 2); }
    if (k > 0.7) { ctx.fillStyle = 'rgba(200,225,255,.6)'; ctx.fillRect(-7, -18, 14, 2); } // иней на куртке
    if (k > 0.55) { ctx.fillStyle = '#fff'; for (const s of [sw, -sw]) ctx.fillRect(Math.sin(s) * 12 - 3, -6, 9, 2.5); } // снег на ботинках
    if (k > 0.85) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(-7, -35, 3, 10); ctx.fillRect(4, -26, 3, 5); ctx.beginPath(); ctx.arc(-4, -53, 2.5, 0, 7); ctx.fill(); } // облеплен снегом
  }
  // рейка: в покое — на плече, при ударе — дуга вперёд
  let ang = P.climb ? -1.35 : -1.9 + (running ? Math.sin(P.anim * 2) * 0.05 : 0); // на лестнице рейка за спиной
  if (P.attackT > 0) {
    const ph = 1 - P.attackT / 0.26, e = ph < 0.6 ? ph / 0.6 : 1;
    ang = -2.4 + (2.4 + 0.35) * (1 - Math.pow(1 - e, 3));
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(4, -26, WEAPONS[weaponOf()].reach - 12, -2.2, ang); ctx.stroke();
  }
  ctx.save(); ctx.translate(4, -26); ctx.rotate(ang); drawWeapon(weaponOf(), WEAPONS[weaponOf()].len); ctx.restore();
  // рука, держащая инструмент
  ctx.strokeStyle = dirty ? '#252c38' : '#2f4a7a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(4, -26); ctx.stroke();
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
  for (let i = 0; i < maxLives; i++) { // жизни — каски (четвёртая — Золотая); половинка — после удара прораба
    const x = 128 + i * 22, gold = i === 3;
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.arc(x, 20, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(x - 8, 19, 16, 2);
    const f = clamp(lives - i, 0, 1);
    if (f > 0) { ctx.save(); ctx.beginPath(); ctx.rect(x - 9, 10, 18 * f, 14); ctx.clip(); ctx.fillStyle = gold ? '#ffd24a' : '#f7f7f7'; ctx.beginPath(); ctx.arc(x, 20, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(x - 8, 19, 16, 2); ctx.restore(); }
  }
  const right = IS_TOUCH ? W - 74 : W - 44; // справа кнопки звука (и паузы на телефоне)
  drawSoundButton();
  const hx = 186 + (maxLives - 3) * 22;
  text(`Уч. ${levelIdx + 1}/${THEMES.length}`, hx, 20, 12, theme.accent || '#ffb02e', 'left');
  // прогресс до финиша (или до арены босса)
  const px = hx + 64, pw = clamp(right - 60 - px, 100, 300), goal = arena ? arena.x1 : finishX, prog = clamp(player.x / goal, 0, 1);
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
  if (bgShift < 0) { ctx.fillStyle = '#0d0a08'; ctx.fillRect(0, H + bgShift - 4, W, 8 - bgShift); } // под землёй — низ кадра тёмный
  ctx.save(); ctx.translate(0, bgShift); theme.drawBackground(ctx, api); ctx.restore();
  drawSkyAmbient(bgShift);
  ctx.save(); ctx.translate(-Math.round(camX), -Math.round(camY));
  const vis = o => o.x + (o.w || 160) > camX - 80 && o.x < camX + W + 80;
  const T = theme, A = G.underground ? apiDeep : api; // на участках с подземельем земля рисуется глубже кадра
  const vis2 = o => o.x2 > camX - 80 && o.x1 < camX + W + 80;
  for (const t of tunnels) if (vis2(t)) { ctx.save(); (T.drawTunnel || drawTunnelBack)(t, ctx, A); ctx.restore(); }
  for (const rm of rooms) if (vis2(rm)) { ctx.save(); (T.drawRoom || drawRoomBack)(rm, ctx, A); ctx.restore(); }
  for (const c of crowds) if (c.x + 120 > camX - 40 && c.x - 40 < camX + W + 40) drawCrowd(c);
  for (const p of pits) if (vis(p)) { ctx.save(); T.drawPit(p, ctx, A); ctx.restore(); }
  for (const p of platforms) if (vis(p)) { ctx.save(); if (p.hatch) drawHatch(p); else if (p.crumble) drawCrumble(p); else T.drawPlatform(p, ctx, A); ctx.restore(); }
  for (const d of decor) if (vis(d)) { ctx.save(); T.drawDecor(d, ctx, A); ctx.restore(); }
  for (const s of ghosts) if (vis(s)) { ctx.save(); T.drawGround(s, ctx, A); ctx.restore(); } // стены с тайником — целиком
  for (const s of solids) {
    if (!vis(s) || s.hidden || s.kind === 'breakable') continue;
    ctx.save();
    if (s.kind === 'ceiling') (T.drawCeiling || drawCeilingDefault)(s, ctx, A);
    else {
      if (s.slab) { ctx.beginPath(); ctx.rect(s.x - 1, s.y - 80, s.w + 2, s.h + 80); ctx.clip(); } // перекрытие над подземным ходом — не глубже своей толщины
      (s.kind === 'obstacle' ? T.drawObstacle : T.drawGround)(s, ctx, A);
    }
    ctx.restore();
  }
  drawWorldAmbient();
  for (const q of secrets) if (q.open && vis(q)) drawSecret(q);
  for (const s of solids) if (s.kind === 'breakable' && vis(s)) drawBreakable(s);
  for (const l of ladders) if (vis(l)) { ctx.save(); (T.drawLadder || drawLadder)(l, ctx, A); ctx.restore(); }
  for (const c of checkpoints) if (vis(c)) drawCheckpoint(c);
  if (finishX !== Infinity && finishX > camX - 300 && finishX < camX + W + 300) { ctx.save(); if (T.drawFinish) T.drawFinish(finishX, finishY, ctx, api); ctx.restore(); drawFinishFlag(); }
  for (const k of pickups) if (vis(k) && !(k.secret && !k.secret.open)) drawBlueprint(k);
  for (const k of helmets) if (vis(k) && !(k.secret && !k.secret.open)) drawHelmetPickup(k);
  for (const k of treasures) if (vis(k)) drawTreasure(k);
  for (const e of enemies) if (vis(e)) drawEnemy(e);
  for (const p of projectiles) drawProjectile(p);
  if (mode !== 'over') drawPlayer();
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color;
    if (p.chunk) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      if (p.paper) { ctx.fillStyle = '#8a9aa8'; for (let y = -2.5; y < 3; y += 2) ctx.fillRect(-2.5, y, 5, 0.7); ctx.fillStyle = '#c62828'; ctx.fillRect(1, 2.5, 2, 1.5); } // строки и печать
      ctx.restore(); }
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
