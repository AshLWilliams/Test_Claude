// Сквозная проверка кампании Level Runner (surveyor/index.html со всеми темами) в headless Chromium.
// Запуск: NODE_PATH=$(npm root -g) node tests/level-runner-campaign.js --out /tmp/lr-campaign
//  - все темы загружены, номера 1..N без пропусков, id уникальны, ошибок в консоли нет;
//  - бот проходит все участки подряд (враги убираются, босса «добивает» тест), экраны «Участок сдан» и финал работают;
//  - после победы открыты все участки, выбор участка в меню даёт тренировку (без рейтинга), ?level=N стартует с участка N;
//  - время кадра на каждом участке; скриншоты заставок, экрана перехода, финала и меню.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const args = process.argv.slice(2);
const OUT = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(os.tmpdir(), 'lr-campaign'));
fs.mkdirSync(OUT, { recursive: true });
const PAGE = 'file://' + path.resolve(__dirname, '..', 'surveyor', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.route('https://star-dodger.ashlwilliams.workers.dev/**', r => {
    requests.push(new URL(r.request().url()).pathname);
    r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"s":"S","top":[],"rank":1,"improved":true}' });
  });
  const report = {};
  await page.goto(PAGE);
  await page.waitForTimeout(300);
  report.themes = await page.evaluate(() => THEMES.map(t => ({ index: t.index, id: t.id, title: t.title, enemies: Object.keys(t.enemies).length, boss: !!(t.gen && t.gen.boss) })));
  const idx = report.themes.map(t => t.index);
  report.indicesOk = idx.every((v, i) => v === i + 1) && new Set(report.themes.map(t => t.id)).size === idx.length;
  report.bossOnlyLast = report.themes.every((t, i) => t.boss === (i === idx.length - 1));
  await page.screenshot({ path: path.join(OUT, 'menu.png') });

  // сквозной проход: бот бежит вправо и прыгает перед ямами и стенами; враги убраны; босса добивает тест
  report.run = await page.evaluate(async () => {
    const levels = [];
    localStorage.clear(); unlocked = 1; menuLevel = 0;
    startOrToggle(); // из меню: смена с 1-го участка
    const res = { practiceAtStart: practice, levels };
    let guard = 0;
    while (guard++ < 20) {
      const li = levelIdx, t0 = performance.now();
      for (const k in kb) kb[k] = false; kb.right = true; syncInput();
      let steps = 0, deaths = 0, lastLives = lives;
      while (mode === 'play' && steps < 60 * 200) {
        const P = player, ahead = P.x + P.w + 22, feet = P.y + P.h;
        const groundAhead = solids.some(s => ahead >= s.x && ahead <= s.x + s.w && s.y >= feet - 2 && s.y < feet + 70);
        const wallAhead = solids.some(s => ahead + 10 >= s.x && ahead - 22 <= s.x + s.w && s.y < feet - 4 && s.y + s.h > P.y);
        const wl = ladders.find(l => l.wall && P.x + P.w > l.x + 3 && P.x < l.x + l.w - 3 && P.y + P.h > l.top - 2 && P.y + P.h <= l.bottom + 2);
        if (P.climb || (wl && P.y + P.h > wl.top + 2)) { kb.up = true; kb.right = !!P.climb && P.y + P.h <= P.climb.top + 1; kb.jump = false; syncInput(); } // стена: вверх по лестнице
        else { if (kb.up || !kb.right) { kb.up = false; kb.right = true; syncInput(); }
          if (P.onGround && (!groundAhead || wallAhead)) { jumpBuf = 0.12; kb.jump = true; syncInput(); } }
        if (P.vy > 0) { kb.jump = false; syncInput(); }
        enemies = enemies.filter(e => e.isBoss); projectiles = [];
        player.inv = Math.max(player.inv, 0.5);
        if (arena && arena.active && !arena.boss.dead) { arena.boss.hp = 1; damageEnemy(arena.boss, 1, 'staff', 0); }
        update(1 / 60); steps++;
        if (lives < lastLives) { deaths++; lastLives = lives; }
      }
      levels.push({ level: li + 1, id: theme.id, mode, seconds: +levelTime.toFixed(1), deaths, score: Math.floor(score), ms: +((performance.now() - t0) / steps).toFixed(2) });
      if (mode === 'clear') { overAt = -1e9; startOrToggle(); continue; }
      break;
    }
    kb.right = false; syncInput();
    res.finalMode = mode; res.final = final; res.unlocked = unlocked; res.storedUnlock = localStorage.getItem('level-runner-unlocked');
    return res;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'win.png') });

  // экран перехода между участками
  await page.evaluate(() => { reset(0); mode = 'play'; levelComplete(); });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, 'clear.png') });
  report.clearScreen = await page.evaluate(() => mode);

  // заставка каждого участка и вид в начале
  report.frameMs = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < THEMES.length; i++) {
      reset(0); loadLevel(i); mode = 'play';
      const mid = (arena ? arena.x1 : finishX) * 0.5; Object.assign(player, { x: mid, y: (groundAt(mid) ?? 250) - 40, inv: 999 }); camX = mid - W * 0.35;
      const t0 = performance.now();
      for (let k = 0; k < 120; k++) { player.inv = 999; update(1 / 60); draw(); }
      out.push({ level: i + 1, ms: +((performance.now() - t0) / 120).toFixed(2) });
    }
    return out;
  });
  for (let i = 0; i < report.themes.length; i++) {
    await page.evaluate(n => { reset(0); loadLevel(n); mode = 'play'; banner.t = 2; window.__u = window.__u || update; window.update = () => {}; }, i);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(OUT, `intro-${String(i + 1).padStart(2, '0')}.png`) });
    await page.evaluate(() => { window.update = window.__u; });
  }

  // меню: выбор участка → тренировка
  report.menu = await page.evaluate(() => {
    mode = 'menu'; menuLevel = 0;
    for (let i = 0; i < 12; i++) selectLevel(1);
    const maxSel = menuLevel;
    selectLevel(-1); selectLevel(-1);
    const chosen = menuLevel;
    startOrToggle();
    return { maxSel, chosen, startedAt: levelIdx, practice, mode };
  });
  await page.evaluate(() => { mode = 'menu'; });
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, 'menu-select.png') });

  // ?level=5 — тренировка с 5-го участка
  const p2 = await ctx.newPage();
  await p2.route('https://star-dodger.ashlwilliams.workers.dev/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"s":"S","top":[]}' }));
  await p2.goto(PAGE + '?level=5'); await p2.waitForTimeout(200);
  report.levelParam = await p2.evaluate(() => { const m = menuLevel; startOrToggle(); return { menuLevel: m, levelIdx, practice }; });

  report.requests = [...new Set(requests)];
  report.errors = [...new Set(errors)];
  fs.writeFileSync(path.join(OUT, 'campaign.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})();
