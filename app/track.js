// Usage stats: which screens are opened, and when, sent to the Worker (/api/event, worker/events.js).
// Each device has a random id; a signed-in device also sends its token, so the Worker knows the account.
// Never sent: usernames, opponents, games, drill ids. Only works with /api (not on GitHub Pages or a static
// server), and the user can turn it off in Settings.
import { ls } from './store.js';

/** Every screen name the Worker accepts. A route with an argument (an opponent, a drill) keeps only its kind. */
export const SCREENS = ['welcome', 'start', 'signin', 'me', 'prep', 'prep-opp', 'add', 'explore', 'drill', 'drill-item', 'setup'];
const NEW_VISIT = 30 * 60 * 1000;   // back after this long counts as a new visit to the same screen

/**
 * The screen `route()` in app.js shows for `#tab/arg`, or null when it only redirects.
 * `setup` is true until the user has entered their username.
 */
export function screenOf(tab, arg, setup = false) {
  if (setup) return tab === 'start' || tab === 'signin' ? tab : 'welcome';
  if (tab === 'start' || tab === 'signin') return null;
  if (tab === 'drill') return arg ? 'drill-item' : 'drill';
  if (['setup', 'add', 'explore', 'me'].includes(tab)) return tab;
  return arg ? 'prep-opp' : 'prep';
}

export const sharing = () => ls.get('usage-stats', true) !== false;
export function setSharing(on) { ls.set('usage-stats', !!on); }

let server = null, current = null, last = '', lastAt = 0;

/** Record that a screen was opened. Before `startTracking`, only the latest screen is kept. */
export function track(screen) {
  if (!screen) return;
  current = screen;
  if (server) send(false);
}

/**
 * Start sending once the app knows whether this server has /api. `token()` gives the account's access token,
 * or null when signed out.
 */
export function startTracking({ api, token }) {
  if (!api) return;
  server = { token };
  send(false);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') send(true); });
}

/** Send the current screen unless it was just sent; `revisit`: only if the last event is old (a new visit). */
async function send(revisit) {
  if (!current || !sharing()) return;
  const now = Date.now();
  if (revisit ? now - lastAt < NEW_VISIT : current === last) return;
  last = current; lastAt = now;
  let device = ls.get('device-id', null);
  if (!device) { device = crypto.randomUUID(); ls.set('device-id', device); }
  const headers = { 'content-type': 'application/json' };
  try {
    const token = await server.token();
    if (token) headers.authorization = `Bearer ${token}`;
    await fetch('api/event', { method: 'POST', headers, keepalive: true, body: JSON.stringify({ screen: last, device }) });
  } catch { /* offline or blocked: stats are best effort */ }
}

/** For tests: forget everything. */
export function resetTracking() { server = null; current = null; last = ''; lastAt = 0; }
