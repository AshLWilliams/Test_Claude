# «Топограф» — устройство игры

Игра на чистом JS + Canvas, без сборки. Пять видов работ топографа, у каждого — два варианта участка: **10 уровней кампании**.
Каждый уровень генерируется заново при каждом запуске (своё зерно `seed`).

```
topograf/
  index.html        — загружает audio.js, core.js, symbols.js, modes/*.js и вызывает startGame()
  style.css
  audio.js          — Sound: синтезированные эффекты + саундтрек (../surveyor/music/kish-geodeziya.mp3)
  core.js           — ядро: холст, кампания, меню, карточка правил, HUD, итог уровня, рейтинги, Telegram, ввод
  symbols.js        — Sym: детальная отрисовка объектов местности (вид сверху) и условные знаки топоплана
  modes/1-piket.js        — «Пикет»: тахеометрическая съёмка участка (вид сверху, реальное время)
  modes/2-traverse.js     — «Невязка»: теодолитный ход, головоломка
  modes/3-staffman.js     — «Реечник»: продольный профиль, вид сбоку
  modes/4-locator.js      — «Трассоискатель»: поиск подземных коммуникаций, логика
  modes/5-contours.js     — «Горизонтали»: камеральная обработка, рисование горизонталей
```

## Экран и координаты
Логический кадр: высота `H = 360`, ширина `W` от 560 до 860 (подстраивается под экран; узнавайте через `api.W` каждый кадр).
Начало координат — левый верхний угол, единица — «игровой пиксель». Ядро уже масштабирует контекст (DPR, размер окна);
мода рисует в логических единицах. Верхние **30 единиц** занимает HUD ядра — игровое поле `y ∈ [30, H]`.
На телефоне кадр всегда горизонтальный (ядро поворачивает сцену), управление — пальцем (тап, перетаскивание), мышь — так же.

## Вид работ (мода)
```js
registerMode({
  index: 1,                       // 1..5 — порядок в кампании
  id: 'piket',
  title: 'Пикет',                 // название вида работ
  subtitle: 'Тахеометрическая съёмка участка',
  howto: ['Строка правил 1', '…'], // 3–5 коротких строк для карточки перед уровнем (общие для обоих вариантов)
  variants: [                     // ровно два варианта участка
    { id: 'village', title: 'Частный сектор', subtitle: '…', howto: [/* необязательно: доп. строки */], params: { /* что угодно */ } },
    { id: 'park',    title: 'Парк с оврагом', subtitle: '…', params: {} },
  ],
  create(api, variant, seed) {    // вызывается при старте уровня; seed — 32-битное зерно генерации
    return {                      // экземпляр уровня
      update(dt) {},              // dt ≤ 0.05 с; вызывается только в режиме игры
      draw(ctx) {},               // рисует всё игровое поле (фон тоже); HUD ядро рисует поверх
      pointerDown(p) {}, pointerMove(p) {}, pointerUp(p) {}, // p = { x, y, id, button } в логических координатах
      key(code, down) {},         // клавиатура (необязательно): code — KeyboardEvent.code
      hud() { return { time: 75, info: ['Пикетов: 12'], progress: 0.4 }; }, // для верхней панели: оставшееся время (с) или null, 1–2 строки, прогресс 0..1 или null
      bot(dt) {},                 // ОБЯЗАТЕЛЬНО для тестов: «автоигрок» — вызывается стендом каждый кадр перед update(dt) вместо ввода
                                  // и играет уровень сам через те же pointerDown/…; должен доводить уровень до finish со звёздами ≥ 2
                                  // за отведённое время (это доказательство, что сгенерированный уровень решаем)
    };
  },
});
```
Уровень заканчивается вызовом `api.finish(result)` (один раз):
```js
api.finish({
  score: 0..1000,                 // целое; сумма по 10 уровням — результат кампании в рейтинг
  stars: 0..3,                    // 1 — зачёт, 2 — хорошо, 3 — отлично
  lines: ['Полнота съёмки: 92 %', 'Пикетов: 41 (лишних 3)', 'Время: 1:12'], // 2–4 строки итога
  drawResult(ctx, x, y, w, h) {}, // необязательно: картинка итога (например, готовый топоплан) в прямоугольнике
});
```
Уровень не «проигрывается» — по истечении времени мода сама вызывает `finish` с тем, что успели (очки меньше).

## Тесты
`node tests/topograf-check.js` — для каждого вида и варианта: 20 зёрен, без ошибок в консоли, `bot()` доводит до `finish` (звёзды ≥ 2),
время кадра, скриншоты (начало, середина, итог). Мода должна проходить его целиком.

## api — что ядро даёт моде
- `api.W`, `api.H`, `api.TOP` (=30, высота HUD), `api.IS_TOUCH`, `api.now` (секунды, для анимаций), `api.levelTime` (с начала уровня)
- `api.rng(seed)` → функция `() => [0,1)` (детерминированный генератор mulberry32); `api.rand(a, b)`, `api.randi(a, b)`, `api.pick(arr)` — НЕдетерминированные (для эффектов)
- `api.clamp(v,a,b)`, `api.lerp(a,b,t)`, `api.dist(ax,ay,bx,by)`, `api.segHitsRect(ax,ay,bx,by,rect)`, `api.segHitsCircle(ax,ay,bx,by,cx,cy,r)`, `api.pointInPoly(x,y,poly)`
- `api.text(ctx, str, x, y, size, color, align='center', weight='bold')`
- `api.button(ctx, rect, label, opts)` — нарисовать кнопку в кадре (`rect = {x,y,w,h}`, `opts: {active, disabled, color, icon}`), `api.hit(rect, p)` — попал ли тап
- `api.sfx(name)` — звук: `tap, select, point, good, bad, warn, station, measure, beep, dig, paper, drop, step, splash, bark, car, wind, win, clear`
- `api.popup(x, y, text, color)` — всплывающая надпись (экранные координаты), `api.burst(x, y, color, n)` — искры, `api.shake(n)`
- `api.layer(w, h, draw)` → `{ canvas, w, h }`: отрисовать статичный фон один раз в отдельный холст (рисовать потом `ctx.drawImage(layer.canvas, x, y, w, h)`); для производительности
- `api.finish(result)` — см. выше
- `api.timeLimit(base)` — время уровня: в смене 240 с (4 минуты; `base` оставлен для совместимости), в **песочнице** — 10⁶ с (фактически без предела; HUD ядра показывает «∞»). Мода берёт свой предел только так; `api.sandbox` — true в песочнице
- `api.theme` — общая палитра интерфейса: `{ accent: '#ffb02e', ink: '#f1e6d6', dim: '#c9b89e', good: '#6cff8a', bad: '#ff6b5b', panel: 'rgba(20,14,10,.78)' }`

## Sym — библиотека объектов (symbols.js)
Все функции рисуют в текущих координатах `ctx` (мода сама делает translate/scale камеры). Масштаб: **1 единица ≈ 0,25 м**
(дом 8×10 м ≈ 32×40 ед., дерево — крона 16–28 ед., люк — 3–4 ед., ширина дороги 6 м ≈ 24 ед.). Свет — с северо-запада (тени на юго-восток).
Детерминированность: всё «случайное» в рисунке объекта берётся из `seed`, чтобы объект не мерцал между кадрами.
Тяжёлые текстуры (трава, асфальт) кэшируются во внутренних offscreen-паттернах.

Местность (вид сверху, «как с дрона»):
- `Sym.ground(ctx, x, y, w, h, kind, seed)` — kind: `grass, lawn, meadow, dirt, sand, gravel, asphalt, concrete, tiles, swamp, water, field, forestFloor`
- `Sym.road(ctx, pts, width, kind)` — `asphalt` (бордюры, разметка), `dirt` (колеи), `path` (тротуарная плитка), `gravel`
- `Sym.house(ctx, x, y, w, h, opt)` — жилой дом: `{ roof: 'gable'|'hip'|'flat', color, rot, chimney, seed }`
- `Sym.building(ctx, x, y, w, h, opt)` — многоэтажка/цех с плоской кровлей: `{ color, floors, kind: 'flat'|'industrial', seed }`
- `Sym.shed(ctx, x, y, w, h, opt)`, `Sym.garages(ctx, x, y, n, opt)`, `Sym.greenhouse(ctx, x, y, w, h)`
- `Sym.fence(ctx, pts, kind)` — `wood, metal, chain, concrete`; `Sym.gate(ctx, x, y, w, rot)`
- `Sym.tree(ctx, x, y, r, kind, seed)` — `deciduous, conifer, birch, apple`; `Sym.bush(ctx, x, y, r, seed)`; `Sym.flowerbed(ctx, x, y, w, h, seed)`
- `Sym.manhole(ctx, x, y, kind)` — `water, sewer, gas, tele, heat, storm` (у каждого свой рисунок крышки); `Sym.hydrant(ctx, x, y)`
- `Sym.pole(ctx, x, y, kind)` — `power, lamp, tele`; `Sym.wires(ctx, x1, y1, x2, y2)`
- `Sym.car(ctx, x, y, rot, color, seed)`, `Sym.bench(ctx, x, y, rot)`, `Sym.playground(ctx, x, y, w, h, seed)`, `Sym.well(ctx, x, y)`
- `Sym.pond(ctx, pts, seed)`, `Sym.stream(ctx, pts, width, seed)`, `Sym.swamp(ctx, pts, seed)`
- `Sym.slope(ctx, topPts, bottomPts)` — откос/бровка оврага (бергштрихи), `Sym.hillshade(ctx, x, y, w, h, heightFn, opt)` — отмывка рельефа по функции высот
- `Sym.marker(ctx, x, y, kind)` — пункт ГГС/репер/межевой знак: `ggs, benchmark, boundary`

Люди и приборы (вид сверху):
- `Sym.surveyorTop(ctx, x, y, dir, t, opt)` — топограф/реечник сверху (каска, жилет; `opt.pole` — вешка с отражателем; `t` — анимация шага; `dir` — угол в радианах)
- `Sym.tripodTop(ctx, x, y, t, opt)` — тахеометр на штативе сверху (`opt.aim` — угол трубы), `Sym.dogTop(ctx, x, y, dir, t)`, `Sym.personTop(ctx, x, y, dir, t, seed)`

Топоплан (условные знаки, «на бумаге»):
- `Sym.plan.paper(ctx, x, y, w, h, opt)` — лист с рамкой, сеткой крестов, штампом (`opt.title`, `opt.scale`)
- `Sym.plan.house(ctx, poly, label)` (подпись вроде `кж2`, `н`), `Sym.plan.tree(ctx, x, y, kind)`, `Sym.plan.manhole(ctx, x, y, kind)`, `Sym.plan.pole(ctx, x, y, kind)`,
  `Sym.plan.fence(ctx, pts, kind)`, `Sym.plan.road(ctx, pts, width)`, `Sym.plan.water(ctx, pts)`, `Sym.plan.slope(ctx, topPts, bottomPts)`,
  `Sym.plan.contour(ctx, pts, h, main)` (утолщённая каждая 5-я, с подписью), `Sym.plan.spot(ctx, x, y, h)` (высотная отметка), `Sym.plan.utility(ctx, pts, kind)` (подземная сеть: цвет и буква)

## Правила для мод
- Мода — один файл в `modes/`, всё внутри IIFE, наружу — только вызов `registerMode`. Не трогать глобальные переменные ядра.
- Генерация — только из `api.rng(seed)`, уровень должен быть **всегда проходим** (решаем) и каждый раз разный.
- Длительность уровня — 60–150 с. Счёт 0..1000, звёзды по понятным порогам.
- Управление пальцем обязательно; кнопки — крупные (не меньше 40×40 ед.), в кадре.
- Производительность: статичное — в `api.layer`, кадр (update+draw) — в пределах ~6 мс в headless Chromium.
