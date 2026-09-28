// Optional account: sign in with Auth0 to keep the same opponents, names and drill progress on every device.
// Only works when the app is served by the Worker (worker/index.js), which says whether accounts are set up
// at /api/config. On GitHub Pages or a plain static server there is no /api, and accounts stay hidden.
// What syncs and how conflicts merge: syncdoc.js. Analysis results (reviews, traps, AI plans) sync alongside: results.js.
import { idb, ls } from './store.js';
import { fromLocal, merge, toLocal } from './syncdoc.js';
import { syncResults, expectPull, endPull } from './results.js';

const SYNCED = ['profile', 'done'];
/** What the UI shows. `at`: last successful sync. */
export const account = { enabled: false, signedIn: false, email: '', at: ls.get('sync-at', 0), busy: false, error: '' };
/** True once this server answered /api/config (the Worker). False on GitHub Pages, a static server, or offline. */
export let hasApi = false;
let client = null, applying = false, timer = null, resTimer = null, running = null, again = false;
let onData = () => {}, onStatus = () => {}, onResults = () => {};
const RESULTS_DELAY = 20000;            // new results upload this long after the last one (reviews come every few seconds)

const isCallback = () => { const q = new URLSearchParams(location.search); return q.has('state') && (q.has('code') || q.has('error')); };
/** True when the page was opened by Auth0 returning from sign-in: finish that before showing anything. */
export const returningFromSignIn = isCallback;

/**
 * Set up accounts if this server offers them. `data()` runs after synced data arrived from another device,
 * `results(players)` after analysis results for those players arrived, `status()` after anything shown in the
 * account card changed.
 */
export async function startSync({ data, status, results = () => {} }) {
  onData = data; onStatus = status; onResults = results;
  // Offline, the last answer is reused so a signed-in device keeps its account; a server without /api clears it.
  let cfg = ls.get('auth-config', null);
  try {
    const r = await fetch('api/config', { cache: 'no-store' });
    cfg = r.ok ? (await r.json()).auth || null : null;
    hasApi = r.ok;
    if (cfg) ls.set('auth-config', cfg); else ls.del('auth-config');
  } catch { /* offline, or no server */ }
  if (!cfg) { if (isCallback()) history.replaceState(null, '', location.pathname); return; }
  try {
    const { createAuth0Client } = await import('./vendor/auth0/auth0-spa-js.production.esm.js');
    // Refresh tokens in localStorage: Safari blocks the third-party cookies Auth0's other silent sign-in needs,
    // and an installed app must stay signed in across launches.
    client = await createAuth0Client({
      domain: cfg.domain, clientId: cfg.clientId, cacheLocation: 'localstorage', useRefreshTokens: true,
      authorizationParams: { audience: cfg.audience, redirect_uri: location.origin + location.pathname },
    });
  } catch (e) { console.error(e); return; }
  account.enabled = true;
  if (isCallback()) {
    let hash = '';
    try { hash = (await client.handleRedirectCallback()).appState?.hash || ''; } catch (e) { account.error = `Sign-in didn't finish (${e.message}). Try again.`; }
    history.replaceState(null, '', location.pathname + hash);
  }
  account.signedIn = await client.isAuthenticated().catch(() => false);
  if (account.signedIn) account.email = (await client.getUser())?.email || '';
  ls.watch((k) => {
    if (!applying && account.signedIn && SYNCED.includes(k)) schedule(1500);
    if (k === 'results-dirty' && account.signedIn) { clearTimeout(resTimer); resTimer = setTimeout(syncNow, RESULTS_DELAY); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
  window.addEventListener('online', () => schedule(0));
  onStatus();
  if (account.signedIn) await syncNow();
}

function schedule(ms) {
  if (!account.signedIn) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

/** Send this device's data, get back the merge with every other device's, and apply it here. */
export async function syncNow() {
  if (!client || !account.signedIn) return;
  if (running) { again = true; return running; }
  expectPull(); clearTimeout(resTimer); // this sync uploads everything marked so far
  running = (async () => {
    account.busy = true; onStatus();
    try {
      for (let attempt = 0; ; attempt++) {
        const prev = ls.get('sync-doc', null);
        const mine = fromLocal(ls.get('profile', null), ls.get('done', {}), prev, Date.now());
        const token = await client.getTokenSilently();
        const r = await fetch('api/sync', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ doc: mine }) });
        const out = await r.json().catch(() => ({}));
        if (r.status === 409 && attempt < 3) { await new Promise((ok) => setTimeout(ok, 400 * (attempt + 1))); continue; }
        if (!r.ok) throw Object.assign(new Error(out.error || `The server answered ${r.status}.`), { status: r.status });
        apply(out.doc, prev);
        break;
      }
      const p = ls.get('profile', null);
      const players = p?.me ? [p.me.user, ...p.opps.map((o) => o.user)] : [];
      const changed = await syncResults(await client.getTokenSilently(), players);
      if (changed.length) onResults(changed);
      if (!Object.keys(ls.get('results-dirty', {})).length) clearTimeout(resTimer); // (the upload itself rewrote the list)
      account.at = Date.now(); ls.set('sync-at', account.at); account.error = '';
    } catch (e) {
      if (['login_required', 'missing_refresh_token', 'invalid_grant'].includes(e.error) || e.status === 401) {
        account.signedIn = false; account.error = 'You were signed out. Sign in again to keep syncing.';
      } else account.error = e instanceof TypeError || navigator.onLine === false ? "Offline. Changes sync when you're back online." : e.message;
    } finally {
      endPull();
      account.busy = false; running = null; onStatus();
      if (again) { again = false; schedule(0); }
    }
  })();
  return running;
}

/** Store the server's merged doc. Changes made here while the request was out are kept and sent next. */
function apply(merged, prev) {
  const combined = merge(merged, fromLocal(ls.get('profile', null), ls.get('done', {}), prev, Date.now()));
  ls.set('sync-doc', merged);
  if (JSON.stringify(combined) !== JSON.stringify(merged)) again = true;
  const next = toLocal(combined), profile = ls.get('profile', null), done = ls.get('done', {});
  const keys = (o) => Object.keys(o).sort().join('\n');
  const newProfile = next.profile && JSON.stringify(next.profile) !== JSON.stringify(profile);
  const newDone = keys(next.done) !== keys(done);
  if (!newProfile && !newDone) return;
  applying = true;
  try { if (newProfile) ls.set('profile', next.profile); if (newDone) ls.set('done', next.done); } finally { applying = false; }
  onData();
}

/** The account's access token for /api calls, or null when signed out or it can't be had. */
export async function token() {
  if (!client || !account.signedIn) return null;
  try { return await client.getTokenSilently(); } catch { return null; }
}

export function signIn() {
  return client?.loginWithRedirect({ appState: { hash: location.hash } });
}

/**
 * Sign out and remove everything this app stored on this device, so the next visit starts like a new one
 * (welcome screen). The account keeps its copy; recent changes are sent first when the server is reachable,
 * unless `send` is false (after deleting the account's data, sending would bring it back).
 */
export async function signOut({ send = true } = {}) {
  if (send) await syncNow().catch(() => {});
  clearTimeout(timer);
  Object.assign(account, { signedIn: false, email: '', at: 0, error: '' });
  await idb.clear(); ls.clear();
  if (client) await client.logout({ logoutParams: { returnTo: location.origin + location.pathname } });
  else location.replace(location.pathname);
}

/** Delete this account's synced data on the server, then sign out (which also clears this device). */
/** Not signed in: delete everything this app saved on this device, and start again from the welcome screen. */
export async function forgetDevice() {
  clearTimeout(timer);
  await idb.clear(); ls.clear();
  location.replace(location.pathname);
}
export async function deleteSynced() {
  clearTimeout(timer); await running; // a sync landing after the delete would store the data again
  try {
    const token = await client.getTokenSilently();
    const r = await fetch('api/sync', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `The server answered ${r.status}.`);
  } catch (e) {
    account.error = e instanceof TypeError ? "Couldn't reach the server. Check your connection." : e.message;
    onStatus();
    return false;
  }
  await signOut({ send: false });
  return true;
}
