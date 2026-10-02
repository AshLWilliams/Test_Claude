#!/usr/bin/env python3
# Браузерные версии игр — без Telegram: из index.html каждой игры делается web.html
# (без telegram-web-app.js и webapp.js, без билета ?t=, ссылки ведут на браузерные версии)
# и общая страница web/index.html. Рейтинг тот же: игры шлют результаты под теми же ключами.
# Запуск: python3 tools/make_web.py <папка сайта>   (в .github/workflows/pages.yml — после копирования файлов)
import re, sys, pathlib

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '_site')
src = pathlib.Path(__file__).resolve().parent.parent
GAMES = [('index.html', 'web.html'), ('surveyor/index.html', 'surveyor/web.html'), ('topograf/index.html', 'topograf/web.html')]
LINKS = {'surveyor/': 'surveyor/web.html', '../topograf/': '../topograf/web.html', 'topograf/': 'topograf/web.html',
         '../surveyor/': '../surveyor/web.html', '../': '../web.html'}

for s, d in GAMES:
    t = (src / s).read_text(encoding='utf-8')
    t = re.sub(r'<script src="https://telegram\.org/js/telegram-web-app\.js"></script>\n?', '', t)
    t = re.sub(r'<script src="(?:\.\./)?webapp\.js[^"]*"></script>\n?', '<script>window.WEB_ONLY = true; // браузерная версия: без Telegram</script>\n', t)
    t = re.sub(r'<title>(.*?)</title>', r'<title>\1 — в браузере</title>', t, count=1)
    t = re.sub(r'href="(surveyor/|topograf/|\.\./topograf/|\.\./surveyor/|\.\./)"', lambda m: f'href="{LINKS[m.group(1)]}"', t)
    hub = '../web/' if '/' in d else 'web/'
    t = t.replace('</main>', f'  <p class="hint"><a href="{hub}">Все игры в браузере</a></p>\n</main>', 1)
    assert 'telegram' not in t.lower() or 'WEB_ONLY' in t, d
    (out / d).parent.mkdir(parents=True, exist_ok=True)
    (out / d).write_text(t, encoding='utf-8')

(out / 'web').mkdir(parents=True, exist_ok=True)
(out / 'web' / 'index.html').write_text('''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Игры в браузере</title>
<style>
  :root { --bg: #14110f; --card: #2a2219; --ink: #f1e6d6; --dim: #c9b89e; --accent: #ffb02e; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink); font-family: system-ui, sans-serif;
         display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px 16px; box-sizing: border-box; }
  h1 { margin: 0; color: var(--accent); letter-spacing: .06em; font-size: 1.6rem; text-align: center; }
  p { margin: 0; color: var(--dim); text-align: center; max-width: 560px; line-height: 1.45; }
  .games { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; width: 100%; max-width: 760px; }
  a.game { display: block; background: var(--card); border: 2px solid #5a4632; border-radius: 12px; padding: 18px; color: var(--ink); text-decoration: none; }
  a.game:hover, a.game:focus { border-color: var(--accent); }
  a.game b { display: block; color: var(--accent); font-size: 1.2rem; margin-bottom: 6px; }
  a.game span { color: var(--dim); font-size: .9rem; }
</style>
</head>
<body>
  <h1>Игры в браузере</h1>
  <p>Отдельные версии без Telegram — открываются прямо в браузере, на компьютере и телефоне.
     Рейтинг общий с Telegram: после игры введи имя, и результат попадёт в тот же мировой топ.</p>
  <div class="games">
    <a class="game" href="../web.html"><b>★ Star Dodger</b><span>Космос, астероиды, стрельба</span></a>
    <a class="game" href="../surveyor/web.html"><b>⛑ Level Runner</b><span>Геодезист сдаёт объект: 10 участков и босс</span></a>
    <a class="game" href="../topograf/web.html"><b>🗺 Топограф</b><span>Топосъёмка: 12 участков, каждый раз новых</span></a>
  </div>
</body>
</html>
''', encoding='utf-8')
print('web versions written to', out)
