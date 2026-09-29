// Сервер Star Dodger на Cloudflare Workers:
//  POST /telegram  — webhook бота (/start, /play, кнопка «Play», inline-режим)
//  POST /score     — игра присылает очки { t: билет, score, duration } → setGameScore
//  GET  /scores?t= — таблица рекордов чата → getGameHighScores
// Билет выдаётся при нажатии «Play»: кто играет и в каком сообщении, с HMAC-подписью.

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const TICKET_TTL = 24 * 3600; // секунд

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

// куда писать очки: обычное сообщение (chat_id + message_id) или сообщение из inline-режима
const target = t => t.i ? { inline_message_id: t.i } : { chat_id: t.c, message_id: t.m };

async function handleUpdate(env, u) {
  const m = u.message;
  if (m && /^\/(start|play)\b/.test(m.text || '')) {
    await tg(env, 'sendGame', { chat_id: m.chat.id, game_short_name: env.GAME_SHORT_NAME });
  }
  const q = u.callback_query;
  if (q && q.game_short_name === env.GAME_SHORT_NAME) {
    const place = q.inline_message_id ? { i: q.inline_message_id } : { c: q.message.chat.id, m: q.message.message_id };
    const ticket = await makeTicket(env, { u: q.from.id, ...place });
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, url: `${env.GAME_URL}?t=${encodeURIComponent(ticket)}` });
  }
  const iq = u.inline_query;
  if (iq) {
    await tg(env, 'answerInlineQuery', { inline_query_id: iq.id, cache_time: 300, results: [{ type: 'game', id: 'stardodger', game_short_name: env.GAME_SHORT_NAME }] });
  }
}

async function highScores(env, t) {
  const r = await tg(env, 'getGameHighScores', { user_id: t.u, ...target(t) });
  if (!r.ok) return [];
  return r.result.map(s => ({
    pos: s.position, score: s.score, me: s.user.id === t.u,
    name: [s.user.first_name, s.user.last_name].filter(Boolean).join(' ').slice(0, 24),
  }));
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
      if (!t) return json({ error: 'bad ticket' }, 403);
      const score = Math.floor(Number(body.score)), duration = Number(body.duration);
      // простая проверка правдоподобия: не больше 40 очков за секунду полёта
      if (!(score >= 0 && duration > 0 && duration < 3600 && score <= 40 * duration + 100)) return json({ error: 'implausible score' }, 400);
      const r = await tg(env, 'setGameScore', { user_id: t.u, score, ...target(t) });
      // «не больше текущего рекорда» — не ошибка, просто рекорд не побит
      const newRecord = r.ok;
      if (!r.ok && !/BOT_SCORE_NOT_MODIFIED/.test(r.description || '')) return json({ error: r.description }, 502);
      return json({ newRecord, scores: await highScores(env, t) });
    }

    if (url.pathname === '/scores' && req.method === 'GET') {
      const t = await readTicket(env, url.searchParams.get('t'));
      if (!t) return json({ error: 'bad ticket' }, 403);
      return json({ scores: await highScores(env, t) });
    }

    return new Response('Star Dodger server', { headers: cors });
  },
};
