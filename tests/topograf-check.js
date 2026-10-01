// Проверка «Топографа» в headless Chromium.
// Запуск: NODE_PATH=$(npm root -g) node tests/topograf-check.js --out /tmp/out [--seeds 20] [modes/1-piket.js ...]
// Без указания файлов берутся все topograf/modes/*.js. Для каждого вида работ и каждого варианта:
//  - загрузка без ошибок; на N случайных участках бот (inst.bot) доводит уровень до finish; звёзды ≥ 2 у всех;
//  - время уровня (игровое), очки, среднее время кадра update+draw;
//  - скриншоты: карточка правил, начало игры, середина, итог уровня.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');

const ROOT = path.resolve(__dirname, '..', 'topograf');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const OUT = path.resolve(opt('--out', path.join(os.tmpdir(), 'topo-check')));
const SEEDS = +opt('--seeds', 20);
const MAXT = +opt('--maxtime', 300);
const files = args.length ? args.map(a => path.resolve(a)) : fs.readdirSync(path.join(ROOT, 'modes')).filter(f => f.endsWith('.js')).sort().map(f => path.join(ROOT, 'modes', f));
fs.mkdirSync(OUT, { recursive: true });

function harness(modeFiles) {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><base href="file://${ROOT}/">
<link rel="stylesheet" href="style.css"></head><body><main><h1>test</h1><div id="stage"><canvas id="game"></canvas>
<form id="nameForm" hidden><input id="nameInput"><button>ok</button></form></div><p class="hint">h</p></main>
<script src="music.js"></script><script src="audio.js"></script><script src="core.js"></script><script src="symbols.js"></script>${modeFiles.map(f => `<script src="file://${f}"></script>`).join('')}
<script>startGame();</script></body></html>`;
  const file = path.join(OUT, `harness-${process.pid}.html`);
  fs.writeFileSync(file, html);
  return 'file://' + file;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const report = {};
  for (const file of files) {
    const name = path.basename(file, '.js');
    const r = report[name] = { errors: [] };
    const page = await browser.newPage({ viewport: { width: 1100, height: 660 } });
    page.on('pageerror', e => r.errors.push(String(e.message).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') r.errors.push(m.text().slice(0, 300)); });
    await page.route('https://star-dodger.ashlwilliams.workers.dev/**', rt => rt.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"s":"S","top":[]}' }));
    try {
      await page.goto(harness([file])); await page.waitForTimeout(300);
      await page.evaluate(() => { window.requestAnimationFrame = () => 0; }); // кадры гоняем сами
      r.levels = await page.evaluate(() => LEVELS.map(L => L.key));
      if (!r.levels.length) { r.errors.push('мода не зарегистрировалась'); continue; }
      r.variants = {};
      for (let li = 0; li < r.levels.length; li++) {
        const v = r.variants[r.levels[li]] = await page.evaluate(([li, n, maxT]) => {
          const res = { runs: 0, finished: 0, stars: [], scores: [], times: [], frameMs: [], problems: [] };
          for (let k = 0; k < n; k++) {
            startRun(0); loadLevel(li); mode = 'play'; res.runs++;
            if (typeof inst.bot !== 'function') { res.problems.push('нет bot()'); break; }
            let t = 0, frames = 0, ms = 0;
            try {
              while (mode === 'play' && t < maxT) {
                const t0 = performance.now();
                inst.bot(1 / 60); update(1 / 60);
                if (frames % 6 === 0) { draw(); ms += performance.now() - t0; }
                else ms += 0; t += 1 / 60; frames++;
              }
            } catch (e) { res.problems.push('исключение: ' + String(e && e.message).slice(0, 160)); }
            if (mode === 'clear' && result) { res.finished++; res.stars.push(result.stars); res.scores.push(result.score); res.times.push(Math.round(t)); }
            else res.problems.push(`не закончен за ${maxT} с (режим ${mode})`);
            res.frameMs.push(ms / Math.max(1, Math.ceil(frames / 6)));
          }
          res.minStars = res.stars.length ? Math.min(...res.stars) : null;
          res.avgScore = res.scores.length ? Math.round(res.scores.reduce((a, b) => a + b, 0) / res.scores.length) : null;
          res.timeRange = res.times.length ? [Math.min(...res.times), Math.max(...res.times)] : null;
          res.avgFrameMs = +(res.frameMs.reduce((a, b) => a + b, 0) / Math.max(1, res.frameMs.length)).toFixed(2);
          res.problems = [...new Set(res.problems)].slice(0, 5);
          delete res.frameMs; delete res.times; delete res.scores;
          return res;
        }, [li, SEEDS, MAXT]);
        if (v.minStars !== null && v.minStars < 2) r.errors.push(`${r.levels[li]}: бот получил меньше 2 звёзд`);
        if (v.finished < v.runs) r.errors.push(`${r.levels[li]}: закончено ${v.finished}/${v.runs}`);
        // скриншоты
        const shot = async (label) => page.screenshot({ path: path.join(OUT, `${name}-${li}-${label}.png`) });
        await page.evaluate(li => { startRun(0); loadLevel(li); draw(); }, li); await shot('intro');
        await page.evaluate(() => { mode = 'play'; for (let i = 0; i < 30; i++) update(1 / 60); draw(); }); await shot('start');
        await page.evaluate(() => { for (let i = 0; i < 60 * 25 && mode === 'play'; i++) { inst.bot(1 / 60); update(1 / 60); } draw(); }); await shot('mid');
        await page.evaluate(() => { for (let i = 0; i < 60 * 300 && mode === 'play'; i++) { inst.bot(1 / 60); update(1 / 60); } overAt = 0; draw(); }); await shot('result');
      }
    } catch (e) { r.errors.push('СТЕНД: ' + String(e && e.stack || e).slice(0, 400)); }
    r.errors = [...new Set(r.errors)].slice(0, 10);
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
})();
