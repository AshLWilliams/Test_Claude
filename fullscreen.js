'use strict';
// Кнопка «⛶ На весь экран» для браузерных версий игр (web.html). Fullscreen API работает только по нажатию игрока;
// где браузер его не умеет (Safari на iPhone), кнопки нет — там полный экран даёт «На экран „Домой“» (см. web/).
// Кнопка видна в меню, на паузе и на итоге; во время игры — клавиша F. Игры сами пересчитывают сцену по resize.
(() => {
  const d = document, el = d.documentElement;
  const can = !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
  const isFull = () => !!(d.fullscreenElement || d.webkitFullscreenElement);
  async function toggle() {
    try {
      if (isFull()) await (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else {
        await (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
        const land = !d.querySelector('#stage') ? null : 'landscape'; // Level Runner и Топограф — горизонтальные
        if (land && screen.orientation && screen.orientation.lock) screen.orientation.lock(land).catch(() => {});
      }
    } catch (e) {}
  }
  if (!can) return;
  const sync = () => { el.classList.toggle('fs', isFull()); dispatchEvent(new Event('resize')); }; // html.fs — стили полного экрана, сцена пересчитывается
  d.addEventListener('fullscreenchange', sync); d.addEventListener('webkitfullscreenchange', sync);
  const b = d.createElement('button');
  b.type = 'button'; b.textContent = '⛶ На весь экран'; b.title = 'На весь экран (F)';
  Object.assign(b.style, { position: 'fixed', zIndex: 5, padding: '6px 10px', font: 'bold 13px system-ui, sans-serif', color: '#f1e6d6',
    background: 'rgba(20,14,10,.78)', border: '1px solid #ffb02e', borderRadius: '8px', cursor: 'pointer', display: 'none' });
  b.addEventListener('pointerdown', e => e.stopPropagation()); // нажатие не должно стартовать игру
  b.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  d.body.appendChild(b);
  addEventListener('keydown', e => { if (e.code === 'KeyF' && !e.repeat && !(e.target && e.target.tagName === 'INPUT')) toggle(); });
  function place() { // в левый верхний угол холста; показываем только вне игры
    let m = 'menu'; try { m = mode; } catch (e) {} // mode — глобальное состояние игры
    const show = m !== 'play' && m !== 'intro';
    b.style.display = show ? 'block' : 'none';
    b.textContent = isFull() ? '⛶ Выйти из полного экрана' : '⛶ На весь экран';
    if (!show) return;
    const c = d.querySelector('canvas'); if (!c) return;
    const r = c.getBoundingClientRect();
    b.style.left = Math.max(4, r.left + 8) + 'px'; b.style.top = Math.max(4, r.top + 40) + 'px';
  }
  setInterval(place, 250); place();
})();
