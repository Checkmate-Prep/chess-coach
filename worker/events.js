// /api/event: usage stats (app/track.js). POST {screen, device} records that a screen was opened, in
// Workers Analytics Engine (binding EVENTS, see wrangler.toml; kept 3 months). Read them with `npm run stats`.
// Stored: the screen, the device's random id, the Auth0 user id when the token is valid, and the country
// Cloudflare saw. Not stored: the IP address, the browser, usernames or anything else from the app.
// `userOf` is worker/auth.js's, passed in so tests don't need its dependency.
import { json } from './http.js';
import { SCREENS } from '../app/track.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const done = (status = 204) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export async function event(request, env, userOf) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const text = await request.text();
  if (text.length > 1000) return json({ error: 'Too much data.' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const { screen, device } = body || {};
  if (!SCREENS.includes(screen)) return json({ error: 'Unknown screen.' }, 400);
  if (typeof device !== 'string' || !UUID.test(device)) return json({ error: 'Invalid device id.' }, 400);
  if (env.BURST && !(await env.BURST.limit({ key: `event:${device}` })).success) return done(429);
  if (!env.EVENTS) return done();
  const sub = await userOf(request, env);
  env.EVENTS.writeDataPoint({ indexes: [device], blobs: [screen, device, sub || '', request.cf?.country || ''] });
  return done();
}
