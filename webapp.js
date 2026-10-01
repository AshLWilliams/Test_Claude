'use strict';
// Общее для трёх игр: запуск как Telegram Mini App — на весь экран, без закрытия свайпом вниз,
// отступы от кнопок Telegram (safe area) и билет игрока для мирового рейтинга (имя из Telegram).
// Подключается после https://telegram.org/js/telegram-web-app.js; вне Telegram ничего не делает.
(() => {
  const WA = window.Telegram && window.Telegram.WebApp;
  const inApp = !!(WA && WA.initData);
  window.TG_APP = inApp; // игра открыта как Mini App (а не как Telegram Game и не на сайте)
  // отступы от краёв: вырез экрана + кнопки «Закрыть» и «⋯» Telegram в полноэкранном режиме
  window.tgInsets = () => {
    if (!inApp) return { t: 0, b: 0, l: 0, r: 0 };
    const a = WA.safeAreaInset || {}, c = WA.contentSafeAreaInset || {};
    return { t: (a.top || 0) + (c.top || 0), b: (a.bottom || 0) + (c.bottom || 0), l: (a.left || 0) + (c.left || 0), r: (a.right || 0) + (c.right || 0) };
  };
  if (!inApp) { window.tgTicket = () => Promise.resolve(null); return; }
  document.documentElement.classList.add('tgapp');
  try { WA.ready(); WA.expand(); } catch (e) {}
  try { if (WA.isVersionAtLeast('8.0')) WA.requestFullscreen(); } catch (e) {}
  try { if (WA.isVersionAtLeast('7.7')) WA.disableVerticalSwipes(); } catch (e) {} // свайп по игре не закрывает её
  try { WA.setHeaderColor('#000000'); WA.setBackgroundColor('#000000'); } catch (e) {}
  const relayout = () => dispatchEvent(new Event('resize')); // игры пересчитывают сцену по событию resize
  for (const ev of ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged', 'viewportChanged']) { try { WA.onEvent(ev, relayout); } catch (e) {} }
  let req = null;
  // сервер проверяет подпись initData и выдаёт такой же билет, как кнопка «Играть» у Telegram Game (без чата)
  window.tgTicket = (api, game) => req || (req = fetch(api + '/webapp', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: WA.initData, game }),
  }).then(r => (r.ok ? r.json() : null)).then(j => (j && j.t) || null).catch(() => null));
})();
