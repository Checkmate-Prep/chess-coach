import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sansOf, syncGames, player, cachedGames } from '../app/chesscom.js';
import { installFakeIndexedDB, installFakeFetch } from './helpers.mjs';

const fixture = (f) => JSON.parse(readFileSync(new URL(`fixtures/${f}`, import.meta.url)));
const GAMES = fixture('games.json');
const API = 'https://api.chess.com/pub/player/';
const db = installFakeIndexedDB();
beforeEach(() => db.clear());

describe('sansOf', () => {
  test('matches the shared parity cases (same as explore.sans_of in Python)', () => {
    for (const { pgn, sans } of fixture('parity.json').sans) assert.deepEqual(sansOf(pgn), sans);
  });
  test('drops variations, NAGs, comments and result; handles wrapped lines', () => {
    const pgn = '[Event "x"]\n[Site "y"]\n\n1. e4 $1 {good} 1... e5 (1... c5 2. Nf3) 2. Nf3\nNc6 3. Bb5 a6 *';
    assert.deepEqual(sansOf(pgn), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
  });
  test('a PGN without moves gives no moves', () => assert.deepEqual(sansOf('[Event "x"]\n\n*'), []));
});

// ---------- syncGames ----------
const monthUrl = (m) => `${API}testplayer/games/${m}`;
const months = (from, count) => Array.from({ length: count }, (_, i) => {
  const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5) - 1 + i, 1));
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
});
/** Routes for an account with games in `list` (oldest first); each month holds `perMonth(m)` games. */
function account(list, perMonth = () => []) {
  const routes = { [`${API}testplayer/games/archives`]: { archives: list.map(monthUrl) } };
  for (const m of list) routes[monthUrl(m)] = { games: perMonth(m) };
  return installFakeFetch(routes);
}
const gameIn = (m, i = 0, extra = {}) => ({
  ...GAMES[0], url: `https://www.chess.com/game/live/${m.replace('/', '')}${i}`,
  end_time: Date.UTC(+m.slice(0, 4), +m.slice(5) - 1, 2 + (i % 25)) / 1000 + i, ...extra,
});

describe('syncGames', () => {
  test('turns chess.com games into compact records', async () => {
    account(['2026/08'], () => GAMES);
    const { games } = await syncGames('TestPlayer');
    assert.equal(games.length, 4); // the chess960 game is dropped
    const [a, b, c, d] = games; // newest first
    assert.deepEqual(a, {
      url: 'https://www.chess.com/game/live/1', t: 1780000400, tc: 'blitz', base: 180, color: 'white',
      rating: 1210, opp: 'OppOne', oppR: 1190, pts: 2, how: 'resigned', eco: 'Italian Game Two',
      sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O', 'Be7'], clk: [179, 178, 175, 170, 170, 165, 160, 150.5],
    });
    assert.deepEqual([b.color, b.pts, b.how, b.base, b.eco], ['black', 0, 'timeout', 600, 'Queens Gambit Declined']);
    assert.deepEqual([c.pts, c.how, c.clk], [1, 'agreed', []]);
    assert.deepEqual([d.color, d.pts, d.how, d.base], ['black', 2, 'checkmated', 180]);
  });

  test('games without a PGN are dropped', async () => {
    account(['2026/08'], () => [{ ...GAMES[0], pgn: undefined }]);
    assert.equal((await syncGames('testplayer')).games.length, 0);
  });

  test('fetches only the newest 12 months, newest first, and reports progress', async () => {
    const list = months('2025/08', 14);
    const calls = account(list);
    const progress = [];
    await syncGames('testplayer', (i, n) => progress.push([i, n]));
    assert.deepEqual(calls.slice(1), list.slice(-12).reverse().map(monthUrl));
    assert.deepEqual(progress[0], [1, 12]);
    assert.deepEqual(progress.at(-1), [12, 12]);
  });

  test('skips months fetched after they ended, fetches again ones fetched before', async () => {
    const list = ['2026/05', '2026/06', '2026/07', '2026/08'];
    db.set('games:testplayer', {
      games: [],
      months: {
        '2026/05': Date.UTC(2026, 5, 3),        // fetched in June: complete
        '2026/06': true,                         // old cache format: fetch once more
        '2026/07': Date.UTC(2026, 6, 31, 23),    // fetched on its last day: late games were missing
        '2026/08': Date.UTC(2026, 8, 1, 0, 0, 1), // fetched just after it ended: complete
      },
    });
    const calls = account(list, (m) => [gameIn(m)]);
    const out = await syncGames('testplayer');
    assert.deepEqual(calls.slice(1), [monthUrl('2026/07'), monthUrl('2026/06')]);
    assert.ok(out.months['2026/07'] >= Date.UTC(2026, 7, 1), 'the refetched month is now marked complete');
    assert.equal(out.games.length, 2);
  });

  test('merges with cached games by URL', async () => {
    const old = { url: gameIn('2026/08').url, t: 1, sans: [], stale: true };
    const other = { url: 'https://www.chess.com/game/live/older', t: 0, sans: [] };
    db.set('games:testplayer', { months: {}, games: [old, other] });
    account(['2026/08'], (m) => [gameIn(m)]);
    const { games } = await syncGames('testplayer');
    assert.equal(games.length, 2);
    assert.equal(games[0].stale, undefined, 'the fresh copy replaces the cached one');
    assert.equal(games[1].url, other.url);
  });

  test('stops at 1500 games and keeps the newest', async () => {
    const calls = account(['2026/07', '2026/08'], (m) => Array.from({ length: 1600 }, (_, i) => gameIn(m, i)));
    const { games } = await syncGames('testplayer');
    assert.equal(games.length, 1500);
    assert.deepEqual(calls.slice(1), [monthUrl('2026/08')]);
    assert.ok(games.every((g, i) => i === 0 || games[i - 1].t >= g.t));
  });

  test('saves the result so cachedGames can read it', async () => {
    account(['2026/08'], (m) => [gameIn(m)]);
    const out = await syncGames('TestPlayer');
    assert.deepEqual(await cachedGames('TESTPLAYER'), out);
    assert.equal(typeof out.fetched, 'number');
  });

  test('an unknown player throws with code 404', async () => {
    installFakeFetch({});
    await assert.rejects(syncGames('nobody'), { code: 404 });
  });

  test('a server error is reported with its status', async () => {
    installFakeFetch({ [`${API}testplayer/games/archives`]: 503 });
    await assert.rejects(syncGames('testplayer'), /chess\.com answered 503/);
  });
});

describe('player', () => {
  test('profile and ratings; username is trimmed and lower-cased', async () => {
    installFakeFetch({
      [`${API}testplayer`]: { username: 'TestPlayer', name: 'Test Player', avatar: 'https://x/a.png' },
      [`${API}testplayer/stats`]: {
        chess_blitz: { last: { rating: 1210 }, record: { win: 10, loss: 5, draw: 1 } },
        chess_rapid: { best: { rating: 1400 } }, // no current rating: skipped
      },
    });
    assert.deepEqual(await player('  TestPlayer '), {
      user: 'testplayer', name: 'Test Player', username: 'TestPlayer', avatar: 'https://x/a.png',
      ratings: { blitz: { r: 1210, w: 10, l: 5, d: 1 } },
    });
  });

  test('a failing stats call still returns the profile', async () => {
    installFakeFetch({ [`${API}testplayer`]: { username: 'TestPlayer' }, [`${API}testplayer/stats`]: 500 });
    const p = await player('testplayer');
    assert.deepEqual([p.name, p.avatar, p.ratings], ['TestPlayer', null, {}]);
  });

  test('unknown username rejects with code 404', async () => {
    installFakeFetch({});
    await assert.rejects(player('nobody'), { code: 404, message: 'not found' });
  });
});
