// /api/sync: keeps one doc per signed-in user (app/syncdoc.js) in D1.
//   POST {doc}  merges the device's doc into the stored one and returns the result.
//   DELETE      deletes the user's synced data, analysis results included (worker/results.js).
// Only the account's own data is stored: the Auth0 user id, the doc and when it changed.
import { json } from './http.js';
import { userOf } from './auth.js';
import { clean, merge, EMPTY } from '../app/syncdoc.js';
import { dropResults } from './results.js';

const MAX_BODY = 1_000_000;   // characters; a doc at the limits of clean() fits

let ready = null;
const schema = (env) => (ready ||= env.DB.exec('CREATE TABLE IF NOT EXISTS docs (sub TEXT PRIMARY KEY, doc TEXT NOT NULL, ver INTEGER NOT NULL, updated INTEGER NOT NULL)')
  .catch((e) => { ready = null; throw e; }));

export async function sync(request, env) {
  if (request.method !== 'POST' && request.method !== 'DELETE') return json({ error: 'Use POST or DELETE.' }, 405);
  const sub = await userOf(request, env);
  if (!sub) return json({ error: 'Sign in again.' }, 401);
  if (env.BURST && !(await env.BURST.limit({ key: sub })).success) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
  await schema(env);

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM docs WHERE sub = ?').bind(sub).run();
    await dropResults(env, sub);
    return json({ deleted: true });
  }

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'Too much data.' }, 413);
  let mine;
  try { mine = clean(JSON.parse(text).doc); } catch (e) { return json({ error: e instanceof SyntaxError ? 'Invalid JSON.' : e.message }, 400); }

  // Read, merge, write only if nobody wrote in between (two devices syncing at once); otherwise merge again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await env.DB.prepare('SELECT doc, ver FROM docs WHERE sub = ?').bind(sub).first();
    const merged = merge(row ? JSON.parse(row.doc) : EMPTY, mine);
    const text = JSON.stringify(merged), now = Date.now();
    if (row && text === row.doc) return json({ doc: merged });
    const res = row
      ? await env.DB.prepare('UPDATE docs SET doc = ?, ver = ver + 1, updated = ? WHERE sub = ? AND ver = ?').bind(text, now, sub, row.ver).run()
      : await env.DB.prepare('INSERT INTO docs (sub, doc, ver, updated) VALUES (?, ?, 1, ?) ON CONFLICT (sub) DO NOTHING').bind(sub, text, now).run();
    if (res.meta.changes === 1) return json({ doc: merged });
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 80 * (attempt + 1)));
  }
  return json({ error: 'Another device is syncing. Try again.' }, 409);
}
