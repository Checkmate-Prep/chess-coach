// The shared game store: the Worker's /api/games (worker/games.js) on a fake R2 bucket, and chesscom.js using it.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { games, forget, keyOf } from '../worker/games.js';
import { neutral, side, syncGames, useGameStore } from '../app/chesscom.js';
import { installFakeIndexedDB, installFakeLocalStorage } from './helpers.mjs';

const GAMES = JSON.parse(readFileSync(new URL('fixtures/games.json', import.meta.url)));
const API = 'https://api.chess.com/pub/player/';
const JULY = Date.UTC(2026, 6, 15), AUGUST = Date.UTC(2026, 7, 2);

/** An R2 bucket in memory (the calls games.js makes). */
function fakeR2() {
  const data = new Map();
  return {
    data,
    get: async (k) => (data.has(k) ? { json: async () => JSON.parse(data.get(k)) } : null),
    put: async (k, v) => { data.set(k, v); },
    delete: async (keys) => { for (const k of [].concat(keys)) data.delete(k); },
    list: async ({ prefix }) => ({ objects: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
  };
}
let env, upstream, calls;
beforeEach(() => {
  env = { GAMES: fakeR2(), PREP: { data: new Map(), get: async (k) => env.PREP.data.get(k) ?? null } };
  calls = [];
  upstream = { [`${API}testplayer/games/archives`]: { archives: [`${API}testplayer/games/2026/07`] }, [`${API}testplayer/games/2026/07`]: { games: GAMES } };
  globalThis.fetch = async (url, init) => {
    calls.push([url, init?.headers?.['user-agent']]);
    const body = upstream[url];
    if (typeof body === 'number') return new Response('{}', { status: body });
    return body ? Response.json(body) : new Response('{}', { status: 404 });
  };
});
const ask = (q, now = JULY) => games(new Request(`https://x/api/games?${q}`), env, now);
const askJSON = async (q, now) => { const r = await ask(q, now); return [r.status, await r.json()]; };

describe('/api/games', () => {
  test('fetches a month from chess.com once, stores it neutral, then serves the copy', async () => {
    const [status, out] = await askJSON('player=TestPlayer&month=2026/07', AUGUST);
    assert.equal(status, 200);
    assert.equal(out.complete, true, 'fetched after the month ended');
    assert.deepEqual(out.games, GAMES.map(neutral).filter(Boolean));
    assert.equal(out.games.length, 4, 'the chess960 game is not stored');
    assert.equal(calls[0][1], 'CheckmatePrep (https://checkmateprep.com)');
    assert.ok(env.GAMES.data.has('games/testplayer/2026-07.json'));
    await askJSON('player=testplayer&month=2026/07', AUGUST + 365 * 86400e3);
    assert.equal(calls.length, 1, 'a complete month is never fetched again');
  });

  test('the current month and the archive list are fetched again after an hour', async () => {
    await askJSON('player=testplayer&month=2026/07', JULY);
    await askJSON('player=testplayer', JULY);
    await askJSON('player=testplayer&month=2026/07', JULY + 59 * 60e3);
    await askJSON('player=testplayer', JULY + 59 * 60e3);
    assert.equal(calls.length, 2);
    const [, again] = await askJSON('player=testplayer&month=2026/07', JULY + 61 * 60e3);
    const [, list] = await askJSON('player=testplayer', JULY + 61 * 60e3);
    assert.equal(calls.length, 4);
    assert.equal(again.complete, false);
    assert.deepEqual(list.archives, ['2026/07']);
  });

  test('chess.com busy: an old copy is served, else 503 so the app goes to chess.com itself', async () => {
    await askJSON('player=testplayer&month=2026/07', JULY);
    upstream[`${API}testplayer/games/2026/07`] = 429;
    const [status, out] = await askJSON('player=testplayer&month=2026/07', JULY + 2 * 3600e3);
    assert.deepEqual([status, out.games.length], [200, 4]);
    upstream[`${API}testplayer/games/archives`] = 500;
    assert.equal((await ask('player=testplayer')).status, 503);
  });

  test('a player chess.com no longer knows is deleted', async () => {
    await askJSON('player=testplayer&month=2026/07', AUGUST);
    await askJSON('player=testplayer', AUGUST);
    delete upstream[`${API}testplayer/games/archives`];
    assert.equal((await ask('player=testplayer', AUGUST + 2 * 3600e3)).status, 404);
    assert.deepEqual([...env.GAMES.data.keys()], []);
  });

  test('a player on the deny-list is never fetched or stored', async () => {
    env.PREP.data.set('deny:testplayer', '1');
    assert.equal((await ask('player=testplayer&month=2026/07')).status, 404);
    assert.deepEqual([calls.length, env.GAMES.data.size], [0, 0]);
  });

  test('refuses bad input, and says so when the store is not set up', async () => {
    for (const q of ['player=a', 'player=bad%20name', 'player=testplayer&month=2026/13', 'player=testplayer&month=../x']) assert.equal((await ask(q)).status, 400, q);
    assert.equal((await games(new Request('https://x/api/games?player=testplayer', { method: 'POST' }), env)).status, 405);
    assert.equal((await games(new Request('https://x/api/games?player=testplayer'), {})).status, 503);
  });

  test('stores nothing about who asked', async () => {
    await games(new Request('https://x/api/games?player=testplayer&month=2026/07', { headers: { 'cf-connecting-ip': '1.2.3.4', authorization: 'Bearer x' } }), env, AUGUST);
    const stored = [...env.GAMES.data.values()].join('');
    assert.ok(!stored.includes('1.2.3.4') && !stored.includes('Bearer'));
  });

  test('forget removes every file of one player', async () => {
    for (const k of [keyOf('testplayer'), keyOf('testplayer', '2026/07'), keyOf('other', '2026/07')]) env.GAMES.data.set(k, '{}');
    await forget(env, 'testplayer');
    assert.deepEqual([...env.GAMES.data.keys()], ['games/other/2026-07.json']);
  });
});

describe('chesscom.js with the game store', () => {
  const db = installFakeIndexedDB();
  installFakeLocalStorage();
  beforeEach(() => db.clear());
  // the app's fetch reaches the Worker for api/ and chess.com otherwise; `seen` lists the app's own calls
  // (the Worker's calls to chess.com go through the same fetch, with its User-Agent)
  const viaWorker = () => {
    const chesscom = globalThis.fetch, seen = [];
    globalThis.fetch = async (url, init) => {
      if (!init?.headers?.['user-agent']) seen.push(url);
      return url.startsWith('api/games') ? games(new Request(`https://x/${url}`), env, AUGUST) : chesscom(url, init);
    };
    return seen;
  };

  test('side() of a stored game is the record the app always kept, for both players', () => {
    for (const g of GAMES.filter((x) => x.rules === 'chess')) {
      for (const user of [g.white.username, g.black.username].map((u) => u.toLowerCase())) {
        const s = side(neutral(g), user);
        assert.equal(s.color, g.white.username.toLowerCase() === user ? 'white' : 'black');
        assert.equal(s.opp, (s.color === 'white' ? g.black : g.white).username);
      }
    }
  });

  test('downloads through the store when there is one, with the same result as from chess.com', async () => {
    const direct = await syncGames('testplayer');
    db.clear();
    useGameStore(true);
    try {
      const seen = viaWorker();
      const stored = await syncGames('testplayer');
      assert.deepEqual(seen.filter((u) => !u.startsWith('api/')), [], 'the app itself never called chess.com');
      assert.deepEqual(stored.games, direct.games);
    } finally { useGameStore(false); }
  });

  test('falls back to chess.com when the store fails', async () => {
    useGameStore(true);
    try {
      const chesscom = globalThis.fetch;
      globalThis.fetch = async (url, init) => (url.startsWith('api/') ? new Response('{}', { status: 503 }) : chesscom(url, init));
      assert.equal((await syncGames('testplayer')).games.length, 4);
    } finally { useGameStore(false); }
  });
});
