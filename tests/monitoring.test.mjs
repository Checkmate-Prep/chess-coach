// Usage stats (app/track.js -> worker/events.js), the sign-up notification Action and its deploy helpers.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { track, startTracking, screenOf, setSharing, resetTracking, SCREENS } from '../app/track.js';
import { event } from '../worker/events.js';
import { brandingPatch, prodClientId, withBinding } from '../ops/auth0/deploy-actions.mjs';
import { queries } from '../scripts/stats.mjs';
import { installFakeLocalStorage, installBrowserGlobals, flush } from './helpers.mjs';

const store = installFakeLocalStorage();
installBrowserGlobals();
const DEVICE = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** fetch() that records each request's url, headers and parsed body. */
function recordFetch() {
  const sent = [];
  globalThis.fetch = async (url, opts) => { sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body) }); return { ok: true, status: 204 }; };
  return sent;
}

describe('screenOf', () => {
  test('keeps the kind of screen, never an opponent or a drill', () => {
    assert.equal(screenOf('prep', 'someone'), 'prep-opp');
    assert.equal(screenOf('drill', 'trap%3Asomeone'), 'drill-item');
    assert.equal(screenOf('prep'), 'prep');
    assert.equal(screenOf('drill'), 'drill');
    for (const t of ['me', 'explore', 'setup', 'add']) assert.equal(screenOf(t), t);
  });
  test('unknown tabs show the Prep list, as route() does', () => assert.equal(screenOf('nonsense'), 'prep'));
  test('before setup, every tab but start and signin is the welcome screen', () => {
    assert.equal(screenOf('me', undefined, true), 'welcome');
    assert.equal(screenOf('start', undefined, true), 'start');
    assert.equal(screenOf('signin', undefined, true), 'signin');
  });
  test('start and signin after setup only redirect', () => assert.equal(screenOf('start'), null));
  test('every screen it can give is one the Worker accepts', () => {
    for (const t of ['me', 'prep', 'explore', 'drill', 'setup', 'add', 'x', 'start', 'signin'])
      for (const a of [undefined, 'arg']) for (const setup of [false, true]) {
        const s = screenOf(t, a, setup);
        if (s !== null) assert.ok(SCREENS.includes(s), s);
      }
  });
});

describe('track', () => {
  let sent;
  beforeEach(() => { store.clear(); resetTracking(); sent = recordFetch(); });

  test('nothing is sent without /api', async () => {
    track('me'); startTracking({ api: false, token: async () => null }); track('prep'); await flush();
    assert.equal(sent.length, 0);
  });
  test('the screen opened before /api was known is sent once it is', async () => {
    track('welcome'); track('me');
    startTracking({ api: true, token: async () => null }); await flush();
    assert.deepEqual(sent.map((s) => s.body.screen), ['me']);
    assert.equal(sent[0].url, 'api/event');
    assert.equal(sent[0].headers.authorization, undefined);
  });
  test('one device id, kept across events; the same screen twice in a row is sent once', async () => {
    startTracking({ api: true, token: async () => null });
    track('me'); await flush(); track('me'); await flush(); track('prep'); await flush();
    assert.deepEqual(sent.map((s) => s.body.screen), ['me', 'prep']);
    assert.match(sent[0].body.device, /^[0-9a-f-]{36}$/);
    assert.equal(sent[0].body.device, sent[1].body.device);
  });
  test('a signed-in device sends its token', async () => {
    startTracking({ api: true, token: async () => 'tok' }); track('drill'); await flush();
    assert.equal(sent[0].headers.authorization, 'Bearer tok');
  });
  test('turned off in Settings: nothing is sent', async () => {
    setSharing(false);
    startTracking({ api: true, token: async () => null }); track('me'); await flush();
    assert.equal(sent.length, 0);
  });
  test('a failed request is ignored', async () => {
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    startTracking({ api: true, token: async () => null });
    track('me'); await flush();
  });
});

describe('/api/event', () => {
  const post = (body, headers = {}) => new Request('https://x/api/event', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const setup = (extra = {}) => {
    const points = [];
    return { points, env: { EVENTS: { writeDataPoint: (p) => points.push(p) }, ...extra } };
  };
  const anon = async () => null;

  test('records the screen, device, account and country, nothing else', async () => {
    const { points, env } = setup();
    const req = post({ screen: 'prep-opp', device: DEVICE, username: 'someone' }, { authorization: 'Bearer good' });
    Object.defineProperty(req, 'cf', { value: { country: 'FR' } });
    const r = await event(req, env, async (rq) => (rq.headers.get('authorization') === 'Bearer good' ? 'google-oauth2|1' : null));
    assert.equal(r.status, 204);
    assert.deepEqual(points, [{ indexes: [DEVICE], blobs: ['prep-opp', DEVICE, 'google-oauth2|1', 'FR'] }]);
  });
  test('signed out or a bad token: recorded without an account', async () => {
    const { points, env } = setup();
    assert.equal((await event(post({ screen: 'me', device: DEVICE }), env, anon)).status, 204);
    assert.equal(points[0].blobs[2], '');
  });
  test('rejects unknown screens, bad device ids, bad JSON, big bodies and GET', async () => {
    const { points, env } = setup();
    assert.equal((await event(post({ screen: 'prep/someone', device: DEVICE }), env, anon)).status, 400);
    assert.equal((await event(post({ screen: 'me', device: 'x' }), env, anon)).status, 400);
    assert.equal((await event(post({ screen: 'me' }), env, anon)).status, 400);
    assert.equal((await event(post('{'), env, anon)).status, 400);
    assert.equal((await event(post('null'), env, anon)).status, 400);
    assert.equal((await event(post('x'.repeat(2000)), env, anon)).status, 413);
    assert.equal((await event(new Request('https://x/api/event'), env, anon)).status, 405);
    assert.equal(points.length, 0);
  });
  test('without the Analytics Engine binding it accepts and drops the event', async () => {
    assert.equal((await event(post({ screen: 'me', device: DEVICE }), {}, anon)).status, 204);
  });
  test('over the rate limit: 429 and nothing written', async () => {
    const keys = [];
    const { points, env } = setup({ BURST: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } });
    assert.equal((await event(post({ screen: 'me', device: DEVICE }), env, anon)).status, 429);
    assert.deepEqual(keys, [`event:${DEVICE}`]);
    assert.equal(points.length, 0);
  });
});

describe('sign-up notification (Auth0 Action)', () => {
  const load = () => { const exports = {}; new Function('exports', readFileSync(new URL('../ops/auth0/notify-signup.js', import.meta.url), 'utf8'))(exports); return exports.onExecutePostLogin; };
  const run = async (over = {}) => {
    const calls = [];
    globalThis.fetch = async (url, opts) => { calls.push({ url, ...opts }); return { ok: true }; };
    await load()({ stats: { logins_count: 1 }, client: { client_id: 'prod' }, user: { email: 'a@b.c', user_id: 'email|1' },
      connection: { name: 'email' }, secrets: { NTFY_TOPIC: 'topic', PROD_CLIENT_ID: 'prod' }, ...over });
    return calls;
  };
  test('first sign-in on production: one notification with the email', async () => {
    const calls = await run();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://ntfy.sh/topic');
    assert.match(calls[0].body, /a@b\.c/);
  });
  test('not on later sign-ins, the dev application, or without a topic', async () => {
    assert.equal((await run({ stats: { logins_count: 2 } })).length, 0);
    assert.equal((await run({ client: { client_id: 'dev' } })).length, 0);
    assert.equal((await run({ secrets: { PROD_CLIENT_ID: 'prod' } })).length, 0);
  });
  test('ntfy being down never blocks the sign-in', async () => {
    globalThis.fetch = async () => { throw new TypeError('down'); };
    const log = console.log; console.log = () => {};
    try {
      await load()({ stats: { logins_count: 1 }, client: { client_id: 'p' }, user: {}, secrets: { NTFY_TOPIC: 't', PROD_CLIENT_ID: 'p' } });
    } finally { console.log = log; }
  });
});

describe('Auth0 deploy helpers', () => {
  test('reads the production Client ID from wrangler.toml', () => {
    assert.equal(prodClientId(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')), '2tQ9JSSnfNd6GraU8bmoe9bQ5P64yMnm');
    assert.equal(prodClientId('[env.production]\nvars = { AUTH0_CLIENT_ID = "" }'), null);
  });
  test('adds the Action after the ones already in the Login flow, once', () => {
    const existing = [{ action: { id: 'a1' }, display_name: 'other' }];
    assert.deepEqual(withBinding(existing, 'n1'), [
      { ref: { type: 'action_id', value: 'a1' }, display_name: 'other' },
      { ref: { type: 'action_id', value: 'n1' }, display_name: 'notify-signup' },
    ]);
    assert.equal(withBinding([...existing, { action: { id: 'n1' }, display_name: 'notify-signup' }], 'n1'), null);
  });
});

describe('stats queries', () => {
  test('read the environment dataset over the chosen days', () => {
    for (const q of Object.values(queries('checkmate_events_dev', 7))) {
      assert.match(q, /FROM checkmate_events_dev WHERE timestamp > NOW\(\) - INTERVAL '7' DAY/);
    }
  });
});

test('brandingPatch sets the login favicon only when it is missing or different', () => {
  assert.deepEqual(brandingPatch({}), { favicon_url: 'https://checkmateprep.com/icon-192.png' });
  assert.deepEqual(brandingPatch({ favicon_url: 'https://example.com/x.ico' }), { favicon_url: 'https://checkmateprep.com/icon-192.png' });
  assert.equal(brandingPatch({ favicon_url: 'https://checkmateprep.com/icon-192.png' }), null);
});
