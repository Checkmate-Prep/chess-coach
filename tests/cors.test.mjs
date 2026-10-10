// Which origins may call /api (worker/cors.js): our own address and the iOS app, nobody else.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_ORIGINS, allowedOrigin, withCors } from '../worker/cors.js';
import { games } from '../worker/games.js';

const IOS = 'capacitor://localhost';
const OWN = 'https://checkmateprep.com';
const req = (method, origin, headers = {}) => new Request(`${OWN}/api/sync`, { method, headers: { ...(origin ? { origin } : {}), ...headers } });
const ok = () => Response.json({ ok: true });

describe('allowedOrigin', () => {
  test('accepts the Worker\'s own address and capacitor://localhost only', () => {
    assert.deepEqual(APP_ORIGINS, [IOS], 'no other origin is added');
    assert.equal(allowedOrigin(OWN, OWN), true);
    assert.equal(allowedOrigin(IOS, OWN), true);
    for (const o of [null, '', 'null', '*', 'https://evil.example', 'https://www.checkmateprep.com', 'http://localhost', 'capacitor://localhost.evil.example', 'ionic://localhost', 'https://checkmate-prep.github.io'])
      assert.equal(allowedOrigin(o, OWN), false, String(o));
  });
});

describe('withCors', () => {
  test('answers the app\'s preflight for the authorization header', async () => {
    const r = await withCors(req('OPTIONS', IOS, { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' }), () => assert.fail('no handler for a preflight'));
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), IOS);
    assert.match(r.headers.get('access-control-allow-headers'), /authorization/);
    assert.match(r.headers.get('access-control-allow-methods'), /POST/);
    assert.match(r.headers.get('access-control-allow-methods'), /DELETE/);
    assert.equal(r.headers.get('vary'), 'origin');
  });

  test('gives other origins no CORS headers, also on a preflight', async () => {
    for (const o of ['https://evil.example', OWN, 'null', null]) {
      const pre = await withCors(req('OPTIONS', o), () => assert.fail('no handler'));
      assert.equal(pre.status, 204);
      assert.equal(pre.headers.get('access-control-allow-origin'), null, String(o));
      assert.equal(pre.headers.get('access-control-allow-headers'), null);
      const res = await withCors(req('POST', o), ok);
      assert.equal(res.headers.get('access-control-allow-origin'), null, String(o));
      assert.equal(res.headers.get('access-control-allow-origin') === '*', false);
    }
  });

  test('adds the app origin to real responses and keeps status, body and other headers', async () => {
    const r = await withCors(req('POST', IOS), () => new Response('{"error":"x"}', { status: 429, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }));
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('access-control-allow-origin'), IOS);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('vary'), 'origin');
    assert.deepEqual(await r.json(), { error: 'x' });
  });
});

describe('the game store with the app origin', () => {
  test('stores and logs nothing about who asked, whatever the origin', async () => {
    const puts = [], logs = [];
    const env = {
      GAMES: { get: async () => null, put: async (k, v) => { puts.push([k, v]); }, delete: async () => {}, list: async () => ({ objects: [], truncated: false }) },
      PREP: { get: async () => null },
    };
    const realFetch = globalThis.fetch, orig = {};
    for (const m of ['log', 'info', 'warn', 'error']) { orig[m] = console[m]; console[m] = (...a) => logs.push(a); }
    globalThis.fetch = async () => Response.json({ archives: ['https://api.chess.com/pub/player/testplayer/games/2026/07'] });
    try {
      const request = new Request(`${OWN}/api/games?player=testplayer`, { headers: { origin: IOS, 'cf-connecting-ip': '203.0.113.7', authorization: 'Bearer secret-token', 'user-agent': 'iOS-app-test' } });
      const res = await withCors(request, () => games(request, env, Date.UTC(2026, 6, 15)));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), IOS);
    } finally {
      globalThis.fetch = realFetch;
      for (const m of Object.keys(orig)) console[m] = orig[m];
    }
    assert.deepEqual(logs, [], 'nothing logged');
    const all = JSON.stringify(puts);
    for (const s of ['203.0.113.7', 'secret-token', 'capacitor', 'iOS-app-test']) assert.ok(!all.includes(s), `${s} is not stored`);
    assert.deepEqual(puts.map(([k]) => k), ['games/testplayer/archives.json']);
  });

  test('games.js and the store code never read the origin header', () => {
    assert.doesNotMatch(readFileSync(new URL('../worker/games.js', import.meta.url), 'utf8'), /headers\.get\(['"]origin/i);
  });
});

describe('/api/prep origin rule', () => {
  test('uses allowedOrigin, so only the own address and the app pass, with the limits after it', () => {
    const src = readFileSync(new URL('../worker/prep.js', import.meta.url), 'utf8');
    assert.match(src, /allowedOrigin\(request\.headers\.get\('origin'\), url\.origin\)/);
    assert.ok(src.indexOf('allowedOrigin(') < src.indexOf('AI_BURST.limit'), 'origin check first');
    for (const s of ['AI_BURST.limit', 'DAILY_LIMIT', 'PER_IP_DAILY']) assert.ok(src.includes(s), `${s} still applies`);
  });
});
