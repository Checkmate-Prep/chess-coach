// /api/games: a shared copy of chess.com's public game archives, in R2 (binding GAMES), used by every user.
//   GET ?player=<user>                -> { fetched, archives: ['YYYY/MM', …] }   (kept 1 hour)
//   GET ?player=<user>&month=YYYY/MM  -> { fetched, complete, games: [stored game, …] }
// Stored games are neutral (app/chesscom.js `neutral`): from neither player's side, without the PGN.
// A month fetched after it ended never changes; the current month is fetched again once its copy is an hour old.
// Nothing here records who asked: no account, no address, no log of which player was looked up. So deleting an
// account never touches this store. A player who asks to be removed is deleted and put on a deny-list
// (KV `deny:<user>`, see scripts/forget-player.mjs); a player chess.com no longer knows is deleted.
// An R2 lifecycle rule (deploy.yml) deletes files 180 days after they were written.
import { json } from './http.js';
import { neutral, monthEnd } from '../app/chesscom.js';

const API = 'https://api.chess.com/pub/player/';
const USER = /^[a-z0-9_-]{2,30}$/;
const MONTH = /^\d{4}\/(0[1-9]|1[0-2])$/;
const FRESH = 3600_000;                    // ms a copy of the archive list or the current month is reused
const UA = 'CheckmatePrep (https://checkmateprep.com)';

export const keyOf = (user, month) => `games/${user}/${month ? month.replace('/', '-') : 'archives'}.json`;

export async function games(request, env, now = Date.now()) {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  if (!env.GAMES) return json({ error: 'The game store is not set up on this server.' }, 503);
  const q = new URL(request.url).searchParams;
  const user = (q.get('player') || '').toLowerCase(), month = q.get('month');
  if (!USER.test(user) || (month !== null && !MONTH.test(month))) return json({ error: 'Unknown player or month.' }, 400);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (env.GAMES_BURST && !(await env.GAMES_BURST.limit({ key: ip })).success) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
  if (env.PREP && (await env.PREP.get(`deny:${user}`)) !== null) return json({ error: 'Not found.' }, 404);

  const key = keyOf(user, month);
  const saved = await env.GAMES.get(key).then((o) => o?.json()).catch(() => null);
  if (saved && (saved.complete || now - saved.fetched < FRESH)) return json(saved);

  let r;
  try { r = await fetch(`${API}${user}/games/${month || 'archives'}`, { headers: { 'user-agent': UA } }); } catch { r = null; }
  if (r?.status === 404 || r?.status === 410) { await forget(env, user); return json({ error: 'Not found.' }, 404); }
  if (!r?.ok) return saved ? json(saved) : json({ error: 'chess.com is busy. Try again later.' }, 503);
  let body;
  try { body = await r.json(); } catch { return saved ? json(saved) : json({ error: 'chess.com answered badly.' }, 502); }
  const out = month
    ? { fetched: now, complete: now >= monthEnd(month), games: (body.games || []).map(neutral).filter(Boolean) }
    : { fetched: now, archives: (body.archives || []).map((u) => String(u).split('/').slice(-2).join('/')).filter((m) => MONTH.test(m)) };
  await env.GAMES.put(key, JSON.stringify(out), { httpMetadata: { contentType: 'application/json' } });
  return json(out);
}

/** Delete everything stored for a player. */
export async function forget(env, user) {
  const prefix = `games/${user}/`;
  let cursor;
  do {
    const page = await env.GAMES.list({ prefix, cursor });
    if (page.objects.length) await env.GAMES.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
