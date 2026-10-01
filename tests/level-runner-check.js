// Проверка тем Level Runner в headless Chromium.
// Запуск: NODE_PATH=$(npm root -g) node tests/level-runner-check.js --out /tmp/out [--seeds 40] [--level N] themes/03-metro.js [...]
// Без указания тем берутся все surveyor/themes/*.js. Каждая тема проверяется как свой участок кампании:
//  - загрузка и 3 с игры без ошибок в консоли;
//  - проходимость: бот-бегун без врагов на N случайных уровнях (падений в провалы быть не должно);
//  - враги: каждый тип живёт 5 с без NaN и исключений, убивается рейкой (кроме неуязвимых), наносит урон при касании;
//  - производительность: среднее время кадра (update + draw);
//  - скриншоты: три точки участка, «парад врагов» и финиш (или арена босса).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');

const ROOT = path.resolve(__dirname, '..', 'surveyor');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const OUT = path.resolve(opt('--out', path.join(os.tmpdir(), 'lr-check')));
const SEEDS = +opt('--seeds', 40);
const ONLY = opt('--level', null);
let themes = args.length ? args.map(a => path.resolve(a)) : fs.readdirSync(path.join(ROOT, 'themes')).filter(f => f.endsWith('.js')).sort().map(f => path.join(ROOT, 'themes', f));
fs.mkdirSync(OUT, { recursive: true });

function harness(files) {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="file://${ROOT}/">
<link rel="stylesheet" href="file://${ROOT}/style.css"></head><body><main><h1>test</h1><div id="stage"><canvas id="game"></canvas>
<form id="nameForm" hidden><input id="nameInput"><button>ok</button></form></div><p class="hint">h</p></main>
<script src="file://${ROOT}/audio.js"></script><script src="file://${ROOT}/engine.js"></script>${files.map(f => `<script src="file://${f}"></script>`).join('')}
<script>startGame();</script></body></html>`;
  const file = path.join(OUT, `harness-${process.pid}.html`);
  fs.writeFileSync(file, html);
  return 'file://' + file;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const report = {};
  for (const file of themes) {
    const name = path.basename(file, '.js');
    if (ONLY && !name.startsWith(String(ONLY).padStart(2, '0'))) continue;
    const r = report[name] = { errors: [] };
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', e => r.errors.push(String(e.message).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error' && !/manifest\.json|net::ERR_FAILED/.test(m.text())) r.errors.push(m.text().slice(0, 300)); }); // file:// не даёт fetch музыки — на сайте её грузит https
    await page.route('https://star-dodger.ashlwilliams.workers.dev/**', rt => rt.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"s":"S","top":[]}' }));
    try {
      await page.goto(harness([file]));
      await page.waitForTimeout(200);
      r.theme = await page.evaluate(() => ({ count: THEMES.length, id: THEMES[0] && THEMES[0].id, title: THEMES[0] && THEMES[0].title, enemies: THEMES[0] ? Object.keys(THEMES[0].enemies) : [], W }));
      if (r.theme.count !== 1) { r.errors.push('тема не зарегистрировалась'); continue; }

      // 1) 3 секунды настоящей игры
      await page.evaluate(() => { startOrToggle(); });
      await page.keyboard.down('ArrowRight'); await page.waitForTimeout(1500);
      await page.keyboard.press('KeyJ'); await page.keyboard.press('Space'); await page.waitForTimeout(1500);
      await page.keyboard.up('ArrowRight');
      r.liveMode = await page.evaluate(() => mode);

      // 2) проходимость: бот-бегун без врагов и снарядов
      r.passability = await page.evaluate(n => {
        const res = { ok: 0, fail: [], times: [] };
        for (let k = 0; k < n; k++) {
          reset(0); mode = 'play'; enemies = []; lives = 99; banner = null;
          for (const kk in kb) kb[kk] = false; kb.right = true; syncInput();
          let deaths = 0, last = lives, reached = false;
          for (let i = 0; i < 60 * 150 && mode === 'play'; i++) {
            const P = player, ahead = P.x + P.w + 22, feet = P.y + P.h;
            const groundAhead = solids.some(s => ahead >= s.x && ahead <= s.x + s.w && s.y >= feet - 2 && s.y < feet + 70);
            const wallAhead = solids.some(s => ahead + 10 >= s.x && ahead - 22 <= s.x + s.w && s.y < feet - 4 && s.y + s.h > P.y);
            const hazardAhead = false;
            const wl = ladders.find(l => l.wall && P.x + P.w > l.x + 3 && P.x < l.x + l.w - 3 && P.y + P.h > l.top - 2 && P.y + P.h <= l.bottom + 2);
            if (P.climb || (wl && P.y + P.h > wl.top + 2)) { kb.up = true; kb.right = !!P.climb && P.y + P.h <= P.climb.top + 1; kb.jump = false; syncInput(); } // стена: вверх по лестнице
            else { if (kb.up || !kb.right) { kb.up = false; kb.right = true; syncInput(); }
              if (P.onGround && (!groundAhead || wallAhead || hazardAhead)) { jumpBuf = 0.12; kb.jump = true; syncInput(); } }
            if (P.vy > 0) { kb.jump = false; syncInput(); }
            enemies = enemies.filter(e => e.isBoss); projectiles = [];
            player.inv = Math.max(player.inv, 0.5); // урон от механик темы не считаем — только падения
            const yBefore = P.y;
            update(1 / 60);
            if (lives < last) { if (yBefore > H) deaths++; last = lives; }
            if (arena && player.x > arena.x1 + 40) { reached = true; break; }
          }
          if (mode === 'clear' || mode === 'win') reached = true;
          if (reached && deaths === 0) { res.ok++; res.times.push(Math.round(levelTime)); }
          else res.fail.push({ seed, mode, deaths, x: Math.round(player.x), goal: Math.round(arena ? arena.x1 : finishX) });
        }
        kb.right = false; kb.jump = false; syncInput(); mode = 'menu';
        res.fail = res.fail.slice(0, 5);
        res.timeRange = res.times.length ? [Math.min(...res.times), Math.max(...res.times)] : null; delete res.times;
        return res;
      }, SEEDS);

      // 2б) геометрия ярусов и этажей: проём в перекрытии роняет не больше чем на один ярус/этаж (иначе — урон от падения)
      r.geometry = await page.evaluate(n => {
        const res = { levels: 0, deepDrops: [] };
        for (let k = 0; k < n; k++) {
          reset(0); res.levels++;
          const step = G.indoor ? FH : TUN_H, slabs = solids.filter(s => s.slab);
          for (const Y of [...new Set(slabs.map(s => s.y))]) {
            const row = slabs.filter(s => s.y === Y), x0 = Math.min(...row.map(s => s.x)), x1 = Math.max(...row.map(s => s.x + s.w));
            for (let x = x0; x <= x1; x += 6) {
              if (solids.some(s => x >= s.x && x <= s.x + s.w && Y + 1 >= s.y && Y + 1 <= s.y + s.h)) continue; // не проём
              if (platforms.some(p => p.hatch && x >= p.x && x <= p.x + p.w && Math.abs(p.y - Y) < 2)) continue; // люк
              const g = groundBelow(x, Y + 1);
              if (g === null || g > Y + step + 2) { res.deepDrops.push({ seed, x, y: Y, landing: g }); break; }
            }
          }
        }
        res.deepDrops = res.deepDrops.slice(0, 5);
        return res;
      }, Math.min(SEEDS, 20));
      if (r.geometry.deepDrops.length) r.errors.push('проём роняет больше чем на ярус: ' + JSON.stringify(r.geometry.deepDrops[0]));

      // 3) враги по одному
      r.enemies = await page.evaluate(() => {
        const out = {};
        for (const type of Object.keys(THEMES[0].enemies)) {
          const def = THEMES[0].enemies[type];
          const res = out[type] = {};
          try {
            reset(0); mode = 'play'; enemies = []; projectiles = []; banner = null;
            const gy = solids[0].y;
            Object.assign(player, { x: 100, y: gy - 40, vx: 0, vy: 0, inv: 999 });
            const air = (THEMES[0].enemyTable || []).some(o => o.type === type && o.where === 'air');
            const e = spawnEnemy(type, 330, air ? gy - (G.indoor ? 95 : 120) : gy, { minX: 180, maxX: 450, air, groundY: gy });
            // 5 секунд жизни
            let bad = null;
            for (let i = 0; i < 300; i++) {
              player.inv = 999; update(1 / 60);
              for (const q of enemies) if (![q.x, q.y, q.w, q.h, q.hp].every(Number.isFinite)) bad = 'NaN у ' + q.type;
              for (const p of projectiles) if (![p.x, p.y].every(Number.isFinite)) bad = 'NaN у снаряда';
              if (mode !== 'play') { bad = 'режим ' + mode; break; }
            }
            res.alive5s = !bad && !e.dead; if (bad) res.problem = bad;
            res.projectiles = projectiles.length;
            // убиваемость рейкой
            if (def.invulnerable) res.killable = 'неуязвим (как задумано)';
            else if (e.dead) res.killable = 'умер сам';
            else {
              let t = 0;
              while (!e.dead && t < 15) {
                const hb = def.hurtbox ? def.hurtbox(e, api) : e;
                Object.assign(player, { x: hb.x - 40, y: Math.min(hb.y + hb.h, (typeof groundBelow === "function" ? groundBelow(hb.x - 30, hb.y + hb.h - 40) : groundAt(hb.x - 30)) ?? gy) - 40, vx: 0, vy: 0, face: 1, inv: 999 });
                attackQueued = true;
                for (let i = 0; i < 24; i++) { player.inv = 999; update(1 / 60); t += 1 / 60; }
                projectiles = [];
              }
              res.killable = e.dead ? `да, ${t.toFixed(1)} с` : 'НЕТ за 15 с';
            }
            // урон при касании
            if (def.contact !== false) {
              reset(0); mode = 'play'; enemies = []; projectiles = []; banner = null;
              const e2 = spawnEnemy(type, 330, air ? gy - (G.indoor ? 95 : 120) : gy, { minX: 180, maxX: 450, air, groundY: gy });
              e2.awake = true;
              // враг может двигаться — несколько кадров ставим героя прямо в него (не сверху)
              const before = lives;
              for (let i = 0; i < 90 && lives === before && !e2.dead && mode === 'play'; i++) {
                const body = def.bodybox ? def.bodybox(e2, api) : e2;
                Object.assign(player, { x: body.x + body.w / 2 - 9, y: body.y + body.h - 40, vx: 0, vy: 0, inv: 0 });
                update(1 / 60);
              }
              res.hurtsOnTouch = lives < before;
            } else res.hurtsOnTouch = 'contact: false';
          } catch (err) { res.error = String(err && err.stack || err).slice(0, 300); }
        }
        mode = 'menu';
        return out;
      });

      // 4) производительность (с врагами середины участка)
      r.perfMs = await page.evaluate(() => {
        reset(0); mode = 'play'; banner = null;
        const mid = (arena ? arena.x1 : finishX) * 0.5, gyAt = groundAt(mid) ?? solids[0].y;
        Object.assign(player, { x: mid, y: gyAt - 40, inv: 999 }); camX = mid - W * 0.35;
        const t0 = performance.now();
        for (let i = 0; i < 300; i++) { player.inv = 999; update(1 / 60); draw(); }
        return +((performance.now() - t0) / 300).toFixed(2);
      });

      // 5) скриншоты
      const shot = async (label, fn, argv) => {
        await page.evaluate(() => { window.__upd = window.__upd || update; window.update = window.__upd; });
        await page.evaluate(fn, argv);
        await page.evaluate(() => { const u = window.__upd; window.update = dt => { if (mode === 'play') { enemies.forEach(e => { e.t += dt; }); particles.forEach(p => { p.life -= dt; }); } }; });
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(OUT, `${name}-${label}.png`) });
        await page.evaluate(() => { window.update = window.__upd; });
      };
      for (const f of [0.15, 0.45, 0.75]) {
        await shot('p' + Math.round(f * 100), frac => {
          reset(0); mode = 'play'; banner = null;
          const goal = arena ? arena.x1 : finishX, x = goal * frac;
          let gx = x; while (groundAt(gx) === null) gx += 20;
          Object.assign(player, { x: gx, y: groundAt(gx) - 40, inv: 0 });
          camX = Math.max(0, gx - W * 0.35);
          for (let i = 0; i < 40; i++) { update(1 / 60); player.inv = 999; }
          camX = Math.max(0, player.x - W * 0.35);
        }, f);
      }
      await shot('lineup', () => {
        reset(0); mode = 'play'; enemies = []; projectiles = []; banner = null;
        const gy = solids[0].y, types = Object.keys(THEMES[0].enemies);
        Object.assign(player, { x: 40, y: gy - 40, inv: 999, face: 1 });
        camX = 0;
        types.forEach((t, i) => {
          const air = (THEMES[0].enemyTable || []).some(o => o.type === t && o.where === 'air');
          const e = spawnEnemy(t, 130 + i * (W - 160) / Math.max(1, types.length), air ? gy - (G.indoor ? 95 : 120) : gy, { minX: 0, maxX: 2000, air, groundY: gy });
          e.awake = true; e.dir = -1;
        });
      });
      await shot('finish', () => {
        reset(0); mode = 'play'; banner = null;
        const x = arena ? arena.x1 + 200 : finishX - 120;
        Object.assign(player, { x, y: (groundAt(x) ?? solids[solids.length - 1].y) - 40, inv: 999 });
        if (arena) { arena.active = true; arena.boss.awake = true; }
        for (let i = 0; i < 30; i++) { update(1 / 60); player.inv = 999; }
        camX = arena ? Math.max(arena.x1, Math.min(player.x - W * 0.35, arena.x2 - W)) : Math.max(0, x - W * 0.45);
      });
    } catch (err) { r.errors.push('СТЕНД: ' + String(err && err.stack || err).slice(0, 400)); }
    r.errors = [...new Set(r.errors)].slice(0, 10);
    await context.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
})();
