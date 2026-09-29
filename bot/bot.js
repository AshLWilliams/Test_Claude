'use strict';
// Минимальный Telegram-бот для игры Star Dodger (long polling, без зависимостей).
// Запуск: BOT_TOKEN=... GAME_SHORT_NAME=stardodger node bot/bot.js
const TOKEN = process.env.BOT_TOKEN;
const GAME = process.env.GAME_SHORT_NAME || 'stardodger';
const GAME_URL = process.env.GAME_URL || 'https://ashlwilliams.github.io/Test_Claude/';
if (!TOKEN) { console.error('Задайте BOT_TOKEN'); process.exit(1); }

const api = async (method, params = {}) => {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
};

async function handle(update) {
  const m = update.message;
  if (m && /^\/(start|play)/.test(m.text || '')) {
    await api('sendGame', { chat_id: m.chat.id, game_short_name: GAME });
  }
  const q = update.callback_query;
  if (q && q.game_short_name === GAME) {
    await api('answerCallbackQuery', { callback_query_id: q.id, url: GAME_URL });
  }
}

(async () => {
  console.log('Бот запущен:', (await api('getMe')).username);
  let offset = 0;
  for (;;) {
    try {
      const updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        await handle(u).catch(e => console.error(e.message));
      }
    } catch (e) { console.error(e.message); await new Promise(r => setTimeout(r, 3000)); }
  }
})();
