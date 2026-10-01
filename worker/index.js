// Сервер Star Dodger на Cloudflare Workers:
//  POST /telegram  — webhook бота (/start, /play, кнопка «Play», inline-режим)
//  POST /score     — игра присылает очки { t: билет, score, duration } → setGameScore
//  GET  /scores?t= — таблица рекордов чата → getGameHighScores
//  GET  /session?game= — подписанная сессия партии (игра и время старта), нужна для общего рейтинга
//  POST /global    — результат в общий рейтинг { s: сессия, t?: билет Telegram, name?, score, duration }
//  GET  /global?game= — топ-10 общего рейтинга игры (хранится в KV)
//  POST /webapp   — игра открыта как Mini App (на весь экран): проверка initData Telegram → билет игрока без чата
// Билет выдаётся при нажатии «Play»: кто играет и в каком сообщении, с HMAC-подписью.

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const TICKET_TTL = 24 * 3600; // секунд

// Игры бота: короткое имя из @BotFather → папка на сайте, команда бота и граница правдоподобия (очков в секунду + запас)
const GAMES = {
  stardodger:  { path: '',          cmd: 'play', rate: 40, base: 100, title: 'Star Dodger', app: 'stardodgernew' },
  levelrunner: { path: 'surveyor/', cmd: 'run',  rate: 400, base: 10000, title: 'Level Runner', app: 'levelrunnernew' }, // кампания из 10 участков с бонусами за каждый
  // «Топограф»: 10 уровней по 0..1000 очков. hidden: true — скрыть игру из /start и inline-режима,
  // пока её нет в @BotFather (иначе Telegram отклонит ответ); рейтинги на сайте работают и со скрытой
  topograf:    { path: 'topograf/', cmd: 'survey', rate: 60, base: 2000, title: 'Топограф', app: 'topografnew' },
};
const listed = () => Object.keys(GAMES).filter(g => !GAMES[g].hidden); // игры, которые бот показывает в Telegram
const gameOf = name => (GAMES[name] ? name : 'stardodger'); // старые билеты без игры — Star Dodger
const plausible = (g, score, duration) => score >= 0 && duration > 0 && duration < 3600 && score <= GAMES[g].rate * duration + GAMES[g].base;
const topKey = g => (g === 'stardodger' ? 'top' : 'top:' + g);

async function hmacKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('star-dodger:' + env.BOT_TOKEN));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function webhookSecret(env) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode('webhook:' + env.BOT_TOKEN));
  return b64url(h).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

async function makeTicket(env, data) {
  const body = b64url(enc.encode(JSON.stringify({ ...data, ts: Math.floor(Date.now() / 1000) })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body));
  return body + '.' + b64url(sig);
}

async function readTicket(env, ticket) {
  const [body, sig] = String(ticket || '').split('.');
  if (!body || !sig) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64url(sig), enc.encode(body)); } catch (e) { return null; }
  if (!ok) return null;
  const data = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  if (Date.now() / 1000 - data.ts > TICKET_TTL) return null;
  return data;
}

async function tg(env, method, params) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
  });
  return res.json();
}

// куда писать очки: обычное сообщение (chat_id + message_id) или сообщение из inline-режима; у билета Mini App чата нет
const target = t => t.i ? { inline_message_id: t.i } : { chat_id: t.c, message_id: t.m };
const hasChat = t => !!(t.i || t.c);

// Mini App: проверка подписи initData (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function hmac(keyBytes, data) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, typeof data === 'string' ? enc.encode(data) : data);
}
async function checkInitData(env, initData) {
  const q = new URLSearchParams(String(initData || '')), hash = q.get('hash');
  if (!hash) return null;
  q.delete('hash');
  const check = [...q.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  const secret = await hmac(enc.encode('WebAppData'), env.BOT_TOKEN);
  if (hex(await hmac(secret, check)) !== hash) return null;
  if (Date.now() / 1000 - Number(q.get('auth_date') || 0) > TICKET_TTL) return null;
  try { return JSON.parse(q.get('user') || 'null'); } catch (e) { return null; }
}
// кнопка «на весь экран»: в личке — Mini App прямо в чате (web_app); в группе web_app запрещены — прямая ссылка
// на Mini App из @BotFather (/newapp, короткое имя — GAMES[g].app)
const BOT = env => env.BOT_USERNAME || 'ashlwilliamsgithubio_bot';
const fullBtn = (env, g, priv) => priv || !GAMES[g].app
  ? { text: '🖥 ' + GAMES[g].title + ' — на весь экран', web_app: { url: env.GAME_URL + GAMES[g].path } }
  : { text: '🖥 ' + GAMES[g].title + ' — на весь экран', url: `https://t.me/${BOT(env)}/${GAMES[g].app}` };

async function handleUpdate(env, u) {
  const m = u.message;
  const cmd = m && (m.text || '').match(/^\/(\w+)/);
  if (cmd) {
    const games = cmd[1] === 'start' ? listed() : listed().filter(g => GAMES[g].cmd === cmd[1]);
    if (cmd[1] === 'start') await tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Выберите игру: /play — Star Dodger, /run — Level Runner' + (listed().includes('topograf') ? ', /survey — Топограф' : '') + '. Чтобы сыграть с друзьями, наберите в любом чате @' + (env.BOT_USERNAME || 'ashlwilliamsgithubio_bot') + '.' });
    for (const g of games) await tg(env, 'sendGame', { chat_id: m.chat.id, game_short_name: g });
    const priv = m.chat.type === 'private', full = games.filter(g => priv || GAMES[g].app);
    if (full.length) // ещё и запуск на весь экран (Mini App, без шапки Telegram)
      await tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Играть на весь экран, без верхней полосы Telegram (таблица рекордов чата там не ведётся, мировой рейтинг — да):', reply_markup: { inline_keyboard: full.map(g => [fullBtn(env, g, priv)]) } });
  }
  const q = u.callback_query;
  if (q && GAMES[q.game_short_name]) {
    const place = q.inline_message_id ? { i: q.inline_message_id } : { c: q.message.chat.id, m: q.message.message_id };
    const name = [q.from.first_name, q.from.last_name].filter(Boolean).join(' ').slice(0, 20);
    const g = q.game_short_name;
    const ticket = await makeTicket(env, { u: q.from.id, n: name, g, ...place });
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, url: `${env.GAME_URL}${GAMES[g].path}?t=${encodeURIComponent(ticket)}` });
  }
  const iq = u.inline_query;
  if (iq) {
    await tg(env, 'answerInlineQuery', { inline_query_id: iq.id, cache_time: 300, results: listed().map(g => ({ type: 'game', id: g, game_short_name: g })) });
  }
}

async function highScores(env, t) {
  const r = await tg(env, 'getGameHighScores', { user_id: t.u, ...target(t) });
  if (!r.ok || !Array.isArray(r.result)) return [];
  return r.result.map(s => ({
    pos: s.position, score: s.score, me: s.user.id === t.u,
    name: [s.user.first_name, s.user.last_name].filter(Boolean).join(' ').slice(0, 24),
  }));
}

// Общий рейтинг: один JSON-список лучших результатов игроков (до 100) в KV.
// Игрок из Telegram определяется по id, игрок с сайта — по имени.
const TOP_SIZE = 100;
const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);

async function loadTop(env, g) { return JSON.parse(await env.LB.get(topKey(g)) || '[]'); }
const publicRow = (e, i, meId) => ({ pos: i + 1, name: e.name, score: e.score, src: e.src, me: e.id === meId });

async function submitGlobal(env, body) {
  const sess = await readTicket(env, body.s);
  if (!sess || !sess.sid) return [{ error: 'bad session' }, 403];
  const score = Math.floor(Number(body.score)), duration = Number(body.duration);
  const elapsed = Date.now() / 1000 - sess.ts;
  // длительность партии не больше реально прошедшего с выдачи сессии времени, очки — правдоподобные
  const g = gameOf(sess.g);
  if (!(plausible(g, score, duration) && duration <= elapsed + 3)) return [{ error: 'implausible score' }, 400];
  let player;
  const t = body.t && await readTicket(env, body.t);
  if (t && t.u) player = { id: 'tg:' + t.u, name: t.n || 'Игрок', src: 'tg' };
  else {
    const name = cleanName(body.name);
    if (!name) return [{ error: 'name required' }, 400];
    player = { id: 'web:' + name.toLowerCase(), name, src: 'web' };
  }
  // одна сессия — один результат
  if (await env.LB.get('used:' + sess.sid)) return [{ error: 'session already used' }, 409];
  await env.LB.put('used:' + sess.sid, '1', { expirationTtl: TICKET_TTL });

  const top = await loadTop(env, g);
  let entry = top.find(e => e.id === player.id), improved = false;
  if (!entry) { entry = { ...player, score, at: Date.now() }; top.push(entry); improved = true; }
  else if (score > entry.score) { Object.assign(entry, player, { score, at: Date.now() }); improved = true; }
  top.sort((a, b) => b.score - a.score || a.at - b.at);
  const kept = top.slice(0, TOP_SIZE);
  if (improved) await env.LB.put(topKey(g), JSON.stringify(kept));
  const idx = kept.findIndex(e => e.id === player.id);
  return [{
    improved, best: entry.score, rank: idx >= 0 ? idx + 1 : null,
    top: kept.slice(0, 10).map((e, i) => publicRow(e, i, player.id)),
  }, 200];
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/telegram' && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== await webhookSecret(env)) return new Response('forbidden', { status: 403 });
      await handleUpdate(env, await req.json());
      return new Response('ok');
    }

    if (url.pathname === '/score' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const t = await readTicket(env, body.t);
      if (!t || !t.u) return json({ error: 'bad ticket' }, 403);
      if (!hasChat(t)) return json({ newRecord: false, scores: [] }); // Mini App: чата нет — только мировой рейтинг
      const score = Math.floor(Number(body.score)), duration = Number(body.duration);
      // простая проверка правдоподобия: не больше 40 очков за секунду полёта
      if (!plausible(gameOf(t.g), score, duration)) return json({ error: 'implausible score' }, 400);
      const r = await tg(env, 'setGameScore', { user_id: t.u, score, ...target(t) });
      // «не больше текущего рекорда» — не ошибка, просто рекорд не побит
      const newRecord = r.ok;
      if (!r.ok && !/BOT_SCORE_NOT_MODIFIED/.test(r.description || '')) return json({ error: r.description }, 502);
      return json({ newRecord, scores: await highScores(env, t) });
    }

    if (url.pathname === '/scores' && req.method === 'GET') {
      const t = await readTicket(env, url.searchParams.get('t'));
      if (!t || !t.u) return json({ error: 'bad ticket' }, 403);
      return json({ scores: hasChat(t) ? await highScores(env, t) : [] });
    }

    if (url.pathname === '/webapp' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const user = await checkInitData(env, body.initData);
      if (!user || !user.id) return json({ error: 'bad initData' }, 403);
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 20) || 'Игрок';
      return json({ t: await makeTicket(env, { u: user.id, n: name, g: gameOf(body.game) }) });
    }

    if (url.pathname === '/session' && req.method === 'GET') {
      return json({ s: await makeTicket(env, { sid: crypto.randomUUID(), g: gameOf(url.searchParams.get('game')) }) });
    }

    if (url.pathname === '/global' && req.method === 'POST') {
      const [data, status] = await submitGlobal(env, await req.json().catch(() => ({})));
      return json(data, status);
    }

    if (url.pathname === '/global' && req.method === 'GET') {
      return json({ top: (await loadTop(env, gameOf(url.searchParams.get('game')))).slice(0, 10).map((e, i) => publicRow(e, i, null)) });
    }

    return new Response('Star Dodger server', { headers: cors });
  },
};
