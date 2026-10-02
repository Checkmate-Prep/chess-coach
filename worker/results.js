// /api/results: the signed-in user's analysis results (app/resultsdoc.js), one D1 row per item.
//   GET  ?since=<ms>              -> { at, items: [{player, item, data}], more? }  rows changed since then
//   POST {items: [{player, item, data}]}  -> { saved, rejected }   (invalid items are skipped, not retried)
// A review is written once; a trap scan or a plan replaces the stored one only when its rank is higher.
// Only the account's own rows are read or written. DELETE /api/sync removes them with the rest (dropResults).
// `userOf` is worker/auth.js's, passed in so tests don't need its dependency.
import { json } from './http.js';
import { USER, clean, rankOf } from '../app/resultsdoc.js';

const MAX_BODY = 1_000_000;    // characters per upload
const MAX_ITEMS = 200;         // items per upload
const PAGE = 1000;             // rows per pull
const MAX_ROWS = 50_000;       // rows per account

let ready = null;
// D1's exec runs one statement per line.
const schema = (env) => (ready ||= env.DB.exec([
  'CREATE TABLE IF NOT EXISTS results (sub TEXT NOT NULL, player TEXT NOT NULL, item TEXT NOT NULL, rank INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (sub, player, item))',
  'CREATE INDEX IF NOT EXISTS results_updated ON results (sub, updated)',
].join('\n')).catch((e) => { ready = null; throw e; }));

export async function results(request, env, userOf, now = Date.now()) {
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Use GET or POST.' }, 405);
  const sub = await userOf(request, env);
  if (!sub) return json({ error: 'Sign in again.' }, 401);
  if (env.BURST && !(await env.BURST.limit({ key: sub })).success) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
  await schema(env);

  if (request.method === 'GET') {
    const since = Math.max(0, Math.floor(+new URL(request.url).searchParams.get('since') || 0));
    const { results: rows } = await env.DB.prepare('SELECT player, item, data, updated FROM results WHERE sub = ? AND updated >= ? ORDER BY updated LIMIT ?')
      .bind(sub, since, PAGE).all();
    const items = rows.map((r) => ({ player: r.player, item: r.item, data: JSON.parse(r.data) }));
    // A full page: ask again from the last row's time (rows written together share a time and fit in a page).
    return rows.length === PAGE ? json({ at: rows.at(-1).updated, items, more: true }) : json({ at: now, items });
  }

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'Too much data.' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const list = body?.items;
  if (!Array.isArray(list) || list.length > MAX_ITEMS) return json({ error: 'Invalid results.' }, 400);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM results WHERE sub = ?').bind(sub).first();
  if (count.n + list.length > MAX_ROWS) return json({ error: 'Too many results stored on this account.' }, 413);

  const stmts = [], rejected = [];
  list.forEach((it, i) => {
    let data;
    try {
      if (typeof it?.player !== 'string' || !USER.test(it.player)) throw new Error('player');
      data = clean(it.item, it.data);
    } catch { rejected.push(i); return; }
    const args = [sub, it.player, it.item, rankOf(it.item, data), JSON.stringify(data), now];
    stmts.push(it.item.startsWith('review:')
      ? env.DB.prepare('INSERT INTO results (sub, player, item, rank, data, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (sub, player, item) DO NOTHING').bind(...args)
      : env.DB.prepare('INSERT INTO results (sub, player, item, rank, data, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (sub, player, item) DO UPDATE SET rank = excluded.rank, data = excluded.data, updated = excluded.updated WHERE excluded.rank > results.rank').bind(...args));
  });
  if (stmts.length) await env.DB.batch(stmts);
  return json({ saved: stmts.length, rejected });
}

/** Delete every result of an account (with the rest of its data, DELETE /api/sync). */
export async function dropResults(env, sub) {
  await schema(env);
  await env.DB.prepare('DELETE FROM results WHERE sub = ?').bind(sub).run();
}
