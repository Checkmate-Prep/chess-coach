import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pct, buildTree, walk, mergeTrees, profile, weakLines, headToHead, DEPTH } from '../app/stats.js';
import { game, node } from './helpers.mjs';

describe('pct', () => {
  test('points are stored x2: win 2, draw 1, loss 0', () => {
    assert.equal(pct(2, 1), 100);
    assert.equal(pct(1, 1), 50);
    assert.equal(pct(0, 1), 0);
    assert.equal(pct(3, 4), 38); // 1.5 of 4 = 37.5% rounds up
  });
  test('no games gives 0, not NaN', () => assert.equal(pct(0, 0), 0));
});

describe('buildTree', () => {
  const games = [
    game({ color: 'white', pts: 2, sans: ['e4', 'e5', 'Nf3'] }),
    game({ color: 'white', pts: 0, sans: ['e4', 'c5'] }),
    game({ color: 'black', pts: 2, sans: ['d4', 'd5'] }),
  ];
  test('keeps only games with the given colour and counts every node', () => {
    const t = buildTree(games, 'white');
    assert.deepEqual([t.n, t.p], [2, 2]);
    assert.deepEqual(Object.keys(t.c), ['e4']);
    assert.deepEqual([t.c.e4.n, t.c.e4.p], [2, 2]);
    assert.deepEqual([t.c.e4.c.e5.n, t.c.e4.c.e5.p], [1, 2]);
    assert.deepEqual([t.c.e4.c.c5.n, t.c.e4.c.c5.p], [1, 0]);
  });
  test('stops at the depth limit', () => {
    const t = buildTree(games, 'white', 1);
    assert.deepEqual(t.c.e4.c, {});
    const long = game({ sans: Array.from({ length: 40 }, () => 'x') });
    let n = buildTree([long], 'white'), plies = 0;
    while (Object.keys(n.c).length) { n = n.c.x; plies++; }
    assert.equal(plies, DEPTH);
  });
  test('empty input gives an empty root', () => assert.deepEqual(buildTree([], 'white'), { n: 0, p: 0, c: {} }));
});

describe('walk', () => {
  const t = { n: 2, p: 2, c: { e4: node(2, 50, { e5: node(1, 100) }) } };
  test('follows a known path', () => assert.equal(walk(t, ['e4', 'e5']).n, 1));
  test('empty path is the root', () => assert.equal(walk(t, []), t));
  test('unknown move gives null', () => assert.equal(walk(t, ['e4', 'c5']), null));
  test('a null tree gives null', () => assert.equal(walk(null, ['e4']), null));
});

describe('mergeTrees', () => {
  test('adds counts and keeps branches from both sides', () => {
    const a = { n: 3, p: 4, c: { e4: { n: 3, p: 4, c: {} } } };
    const b = { n: 2, p: 1, c: { e4: { n: 1, p: 1, c: {} }, d4: { n: 1, p: 0, c: {} } } };
    const m = mergeTrees(a, b);
    assert.deepEqual([m.n, m.p], [5, 5]);
    assert.deepEqual([m.c.e4.n, m.c.e4.p], [4, 5]);
    assert.deepEqual([m.c.d4.n, m.c.d4.p], [1, 0]);
  });
  test('a missing side returns the other', () => {
    const a = { n: 1, p: 2, c: {} };
    assert.equal(mergeTrees(a, null), a);
    assert.equal(mergeTrees(undefined, a), a);
  });
  test('does not modify its inputs', () => {
    const a = { n: 1, p: 2, c: { e4: { n: 1, p: 2, c: {} } } };
    const copy = structuredClone(a);
    mergeTrees(a, a);
    assert.deepEqual(a, copy);
  });
});

describe('profile', () => {
  const castleW = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O', 'Be7'];
  const castleLongB = ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nc6', 'Nf3', 'Bg4', 'Be2', 'O-O-O'];
  const noCastle = (n) => Array.from({ length: n }, (_, i) => (i % 2 ? 'Nf6' : 'Nf3'));

  test('empty input does not throw and has no NaN', () => {
    const p = profile([]);
    assert.equal(p.n, 0);
    assert.equal(p.onTimePct, 0);
    assert.deepEqual(p.castling, { pct: 0, queensidePct: 0, avgMove: null, neverPct: 0 });
    assert.equal(p.since, null);
  });

  test('results by time control, most-played first', () => {
    const p = profile([
      game({ tc: 'rapid', pts: 2 }),
      game({ tc: 'blitz', pts: 0 }), game({ tc: 'blitz', pts: 1 }), game({ tc: 'blitz', pts: 2 }),
    ]);
    assert.deepEqual(Object.keys(p.byTc), ['blitz', 'rapid']);
    assert.deepEqual(p.byTc.blitz, { n: 3, score: 50 });
    assert.deepEqual(p.byTc.rapid, { n: 1, score: 100 });
  });

  test('castling counts only the player\'s own castle move', () => {
    const p = profile([
      game({ color: 'white', sans: castleW }),        // White castles on move 4
      game({ color: 'black', sans: castleLongB }),    // Black castles queenside on move 6
      game({ color: 'black', sans: castleW }),        // only the opponent (White) castled
      game({ color: 'white', sans: noCastle(31) }),   // long game, never castled
    ]);
    assert.equal(p.castling.pct, 50);
    assert.equal(p.castling.queensidePct, 50);
    assert.equal(p.castling.avgMove, 5); // (4 + 6) / 2
    assert.equal(p.castling.neverPct, 25); // short uncastled games don't count as "never"
  });

  test('how games end, and the share lost or won on time', () => {
    const p = profile([
      game({ pts: 2, how: 'timeout' }), game({ pts: 2, how: 'resigned' }),
      game({ pts: 0, how: 'checkmated' }), game({ pts: 0, how: 'timeout' }),
      game({ pts: 1, how: 'agreed' }),
    ]);
    assert.deepEqual(p.ends, { win: { timeout: 1, resigned: 1 }, loss: { checkmated: 1, timeout: 1 } });
    assert.equal(p.onTimePct, 50); // 2 of 4 decisive games
  });

  test('short (< 50 plies) and long (>= 90 plies) buckets', () => {
    const p = profile([
      game({ pts: 2, sans: noCastle(10) }), game({ pts: 0, sans: noCastle(49) }),
      game({ pts: 2, sans: noCastle(90) }), game({ pts: 1, sans: noCastle(60) }),
    ]);
    assert.deepEqual(p.lengthScore.short, { n: 2, score: 50 });
    assert.deepEqual(p.lengthScore.long, { n: 1, score: 100 });
  });

  test('first moves and replies need 3 games', () => {
    const games = [
      ...Array.from({ length: 3 }, () => game({ color: 'white', sans: ['d4'] })),
      ...Array.from({ length: 2 }, () => game({ color: 'white', sans: ['e4'] })),
      ...Array.from({ length: 4 }, () => game({ color: 'black', pts: 0, sans: ['e4', 'c5'] })),
    ];
    const p = profile(games);
    assert.deepEqual(p.firstMove, [{ san: 'd4', n: 3, score: 100 }]);
    assert.deepEqual(p.vsE4, [{ san: 'c5', n: 4, score: 0 }]);
    assert.deepEqual(p.vsD4, []);
  });

  test('openings by ECO family per colour, 3+ games', () => {
    const games = Array.from({ length: 3 }, () => game({ color: 'white', eco: 'Italian Game' }));
    games.push(game({ color: 'black', eco: 'French Defense' }), game({ color: 'white', eco: '' }));
    const p = profile(games);
    assert.deepEqual(p.openings.white, [{ name: 'Italian Game', n: 3, score: 100 }]);
    assert.deepEqual(p.openings.black, []);
  });

  test('since is the oldest game (games come newest first)', () => {
    assert.equal(profile([game({ t: 300 }), game({ t: 200 }), game({ t: 100 })]).since, 100);
  });
});

describe('weakLines', () => {
  test('finds positions reached often where the player scores badly', () => {
    const t = node(100, 50, {
      e4: node(60, 50, { c5: node(20, 20), e5: node(40, 60) }),
      d4: node(40, 50, { d5: node(9, 30), Nf6: node(7, 0) }), // Nf6: below minN
    });
    const lines = weakLines(t);
    assert.deepEqual(lines.map((l) => l.moves.join(' ')), ['e4 c5', 'd4 d5']);
    assert.deepEqual(lines[0], { moves: ['e4', 'c5'], n: 20, score: 20 });
  });

  test('single-move lines are ignored', () => {
    assert.deepEqual(weakLines(node(20, 10, { e4: node(20, 10) })), []);
  });

  test('a longer line is dropped when a shorter prefix already explains it', () => {
    const t = node(50, 50, { e4: node(50, 50, {
      c5: node(20, 20, {
        Nf3: node(15, 24),               // same games, similar score: redundant
        c3: node(10, 5, { d5: node(10, 5) }), // fewer games and much worse: kept
      }),
    }) });
    const lines = weakLines(t).map((l) => l.moves.join(' '));
    assert.deepEqual(lines, ['e4 c5 c3', 'e4 c5']);
  });

  test('respects minN, maxScore and maxDepth, and returns at most 6', () => {
    const c = {};
    for (let i = 0; i < 10; i++) c[`m${i}`] = node(10, i * 5); // scores 0, 5 … 45
    const t = node(100, 50, { e4: node(100, 50, c) });
    const lines = weakLines(t);
    assert.equal(lines.length, 6);
    assert.deepEqual(lines.map((l) => l.score), [0, 5, 10, 15, 20, 25]);
    assert.equal(weakLines(t, { minN: 11 }).length, 0);
    assert.equal(weakLines(t, { maxScore: 5 }).length, 2);
    assert.equal(weakLines(t, { maxDepth: 1 }).length, 0);
  });

  test('ties on score go to the line with more games', () => {
    const t = node(100, 50, { e4: node(100, 50, { a: node(10, 20), b: node(30, 20) }) });
    assert.deepEqual(weakLines(t).map((l) => l.moves[1]), ['b', 'a']);
  });
});

describe('headToHead', () => {
  const mine = [game({ url: 'a', opp: 'Rival', pts: 2, t: 100 }), game({ url: 'b', opp: 'rival', pts: 1, t: 300 }), game({ url: 'c', opp: 'other', pts: 0, t: 400 })];
  const theirs = [game({ url: 'b', opp: 'Me', pts: 1, t: 300 }), game({ url: 'd', opp: 'me', pts: 2, t: 200 }), game({ url: 'e', opp: 'someone', pts: 2, t: 500 })];

  test('counts only games between the two players, from your side', () => {
    assert.deepEqual(headToHead(mine, [], 'rival', 'me'), { n: 2, rec: [1, 1, 0], p: 3, last: 300 });
  });
  test('turns their results round when only their games are downloaded', () => {
    assert.deepEqual(headToHead(null, theirs, 'rival', 'me'), { n: 2, rec: [0, 1, 1], p: 1, last: 300 });
  });
  test('a game in both downloads counts once', () => {
    assert.deepEqual(headToHead(mine, theirs, 'rival', 'me'), { n: 3, rec: [1, 1, 1], p: 3, last: 300 });
  });
  test('nothing downloaded gives no games', () => {
    assert.deepEqual(headToHead(null, undefined, 'rival', 'me'), { n: 0, rec: [0, 0, 0], p: 0, last: 0 });
  });
});
