import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess } from '../app/vendor/chess.js';
import { winProb, pvToSan, summarize, findTraps, cachedTraps, trapScan, trapCandidates, reviewGames, reviewCache, isGoodMove, BLUNDER } from '../app/analysis.js';
import { installFakeIndexedDB, installBrowserGlobals, FakeWorker, game, node } from './helpers.mjs';

const db = installFakeIndexedDB();
installBrowserGlobals();
beforeEach(() => { db.clear(); FakeWorker.reset(); });

const fenAfter = (...sans) => { const g = new Chess(); for (const m of sans) g.move(m); return g.fen(); };
const START = new Chess().fen();

describe('winProb', () => {
  test('matches the Python pipeline (shared parity values)', () => {
    const { winProb: cases } = JSON.parse(readFileSync(new URL('fixtures/parity.json', import.meta.url)));
    for (const [cp, want] of cases) assert.ok(Math.abs(winProb(cp) - want) < 1e-6, `cp ${cp}`);
  });
  test('is symmetric around 50 and increasing', () => {
    assert.equal(winProb(0), 50);
    assert.ok(Math.abs(winProb(300) + winProb(-300) - 100) < 1e-9);
    assert.ok(winProb(100) < winProb(200));
  });
});

describe('pvToSan', () => {
  test('converts a UCI line to SAN', () => assert.deepEqual(pvToSan(START, ['e2e4', 'e7e5', 'g1f3']), ['e4', 'e5', 'Nf3']));
  test('stops at the first illegal move', () => assert.deepEqual(pvToSan(START, ['e2e4', 'e2e4', 'g1f3']), ['e4']));
  test('respects the maximum length', () => assert.deepEqual(pvToSan(START, ['e2e4', 'e7e5', 'g1f3'], 2), ['e4', 'e5']));
  test('handles promotion', () => assert.deepEqual(pvToSan('8/P7/8/8/8/8/8/k6K w - - 0 1', ['a7a8q']), ['a8=Q+']));
});

describe('summarize', () => {
  // A White game of 24 plies. Own moves are the even indexes.
  const loss = Array(24).fill(0), pieces = Array(24).fill(30), evals = Array(24).fill(0);
  loss[0] = 30;                      // opening blunder
  loss[1] = 30; evals[2] = 350;      // they blunder; we keep it (loss[2] = 0)
  pieces[20] = 20;                   // middlegame move
  loss[22] = 25; pieces[22] = 10;    // endgame blunder, low on the clock
  const clk = []; clk[0] = 170; clk[20] = 100; clk[22] = 5;
  const w = game({ url: 'w', color: 'white', pts: 2, base: 180, clk, opp: 'OppOne' });
  const b = game({ url: 'b', color: 'black', pts: 1 });
  const cache = {
    w: {
      loss, pieces, evals, bad: [
        { ply: 1, fen: START, played: 'f3', best: 'e4', loss: 30, before: 0, line: ['e4'] },
        { ply: 23, fen: 'x', played: 'Kg2', best: 'Kh1', loss: 25, before: 250, line: [] },
        { ply: 2, fen: 'y', played: 'g5', best: 'e5', loss: 30, before: 0, line: [] },   // theirs
        { ply: 3, fen: 'z', played: 'a3', best: 'd4', loss: 24, before: 0, line: [] },   // too small
        { ply: 5, fen: 'z', played: 'd4', best: 'd4', loss: 40, before: 0, line: [] },   // not a mistake
      ],
    },
    b: { loss: [0, 0, 0, 0], pieces: [32, 32, 32, 32], evals: [0, -400, 0, -350], bad: [] },
  };
  const s = summarize([w, b, game({ url: 'not reviewed' })], cache);

  test('counts only reviewed games', () => assert.equal(s.reviewed, 2));
  test('splits moves by phase', () => {
    assert.deepEqual(s.phases.opening, { moves: 12, blunders: 8.3, avgLoss: 2.5 }); // 10 White + 2 Black moves
    assert.deepEqual(s.phases.middlegame, { moves: 1, blunders: 0, avgLoss: 0 });
    assert.deepEqual(s.phases.endgame, { moves: 1, blunders: 100, avgLoss: 25 });
  });
  test('blunder rate by clock', () => assert.deepEqual(s.clock, { low: 100, normal: 50, lowShare: 33 }));
  test('conversion, saves and punishing blunders', () => {
    assert.deepEqual(s.convert, { games: 1, pct: 100 });
    assert.deepEqual(s.save, { games: 1, pct: 100 });
    assert.deepEqual(s.punish, { chances: 1, pct: 100 });
  });
  test('puzzles come from your own big mistakes, worst first', () => {
    assert.deepEqual(s.puzzles.map((p) => p.id), ['w#1', 'w#23']);
    assert.equal(s.puzzles[1].winning, true);
    assert.match(s.puzzles[0].game, /^vs OppOne · blitz · .* · move 1$/);
    assert.equal(s.givenBack, 1);
  });
  test('no games gives nulls, not NaN', () => {
    const e = summarize([], {});
    assert.deepEqual(e.phases.opening, { moves: 0, blunders: null, avgLoss: null });
    assert.deepEqual(e.clock, { low: null, normal: null, lowShare: null });
  });
  test('puzzles are capped at 20', () => {
    const bad = Array.from({ length: 30 }, (_, i) => ({ ply: 2 * i + 1, fen: START, played: 'a3', best: 'e4', loss: 30 + i, before: 0, line: [] }));
    const r = summarize([game({ url: 'g' })], { g: { loss: [], pieces: [], evals: [], bad } });
    assert.equal(r.puzzles.length, 20);
    assert.equal(r.puzzles[0].loss, 59);
  });
});

describe('findTraps', () => {
  // As White, they play 1.f3 in 8 of 10 games, and after 1…e5 play 2.g4 in 6 of 8.
  const tree = () => node(10, 50, { f3: node(8, 40, { e5: node(8, 40, { g4: node(6, 0) }) }), e4: node(2, 50) });
  const afterF3E5 = fenAfter('f3', 'e5'), afterG4 = fenAfter('f3', 'e5', 'g4'), afterF3 = fenAfter('f3');
  const script = (evals) => (fen) => evals[fen] || { cp: 0 };

  test('finds a repeated move the engine refutes, with the punishment', async () => {
    FakeWorker.script = script({
      [START]: { cp: 30, best: 'e2e4' }, [afterF3]: { cp: 20, best: 'e7e5' },
      [afterF3E5]: { cp: -40, best: 'b1c3' }, [afterG4]: { mate: 1, pv: ['d8h4'] },
    });
    const progress = [];
    const traps = await findTraps('p1', tree(), 'white', (i, n) => progress.push([i, n]));
    assert.equal(traps.length, 1);
    const t = traps[0];
    assert.deepEqual([t.path, t.san, t.played, t.times, t.of, t.bestForHim, t.punish], [['f3', 'e5'], 'g4', 'g4', 6, 8, 'Nc3', ['Qh4#']]);
    assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]);
    assert.deepEqual(await cachedTraps('p1', 'white'), traps);
    assert.equal((await trapScan('p1', 'white', tree())).checked, 2);
  });

  test('counts the positions it checks, even when it finds nothing', async () => {
    FakeWorker.script = script({});
    assert.equal(await trapScan('p6', 'white', tree()), null);
    assert.deepEqual(await findTraps('p6', tree(), 'white'), []);
    assert.deepEqual(await trapScan('p6', 'white', tree()), { traps: [], current: true, checked: 2 });
  });

  test('a scan is out of date once their games change, and a new scan replaces it', async () => {
    FakeWorker.script = script({});
    await findTraps('p7', tree(), 'white');
    // two more games as White (after a Refresh)
    const more = node(12, 60, { f3: node(8, 40, { e5: node(8, 40, { g4: node(6, 0) }) }), e4: node(4, 60) });
    assert.deepEqual(await trapScan('p7', 'white', more), { traps: [], current: false, checked: null });
    FakeWorker.script = script({
      [START]: { cp: 30, best: 'e2e4' }, [afterF3]: { cp: 20, best: 'e7e5' },
      [afterF3E5]: { cp: -40, best: 'b1c3' }, [afterG4]: { mate: 1, pv: ['d8h4'] },
    });
    assert.equal((await findTraps('p7', more, 'white')).length, 1);
    const scan = await trapScan('p7', 'white', more);
    assert.deepEqual([scan.current, scan.checked, scan.traps.length], [true, 2, 1]);
  });

  test('a scan saved before positions were counted uses the candidates of the same games', async () => {
    db.set('traps:p8:white', { n: 10, traps: [] });
    assert.deepEqual(await trapScan('p8', 'white', tree()), { traps: [], current: true, checked: 2 });
  });

  test('candidates need the same position at least 6 times', () => {
    assert.deepEqual(trapCandidates(tree(), 'white').map((c) => [c.path, c.san]), [[[], 'f3'], [['f3', 'e5'], 'g4']]);
    // 6 games as Black, split after White's first move: nothing repeats often enough
    const few = node(6, 6, { e4: node(4, 4, { e5: node(4, 4) }), d4: node(2, 2, { d5: node(2, 2) }) });
    assert.deepEqual(trapCandidates(few, 'black'), []);
  });

  test('a later trap inside an earlier trap\'s line is dropped', async () => {
    FakeWorker.script = script({ [START]: { cp: 30, best: 'e2e4' }, [afterF3]: { cp: 900, pv: ['e7e5'] },
      [afterF3E5]: { cp: -40, best: 'b1c3' }, [afterG4]: { mate: 1, pv: ['d8h4'] } });
    const traps = await findTraps('p2', tree(), 'white');
    assert.deepEqual(traps.map((t) => t.san), ['f3']);
  });

  test('skips positions that are already decided, and small drops', async () => {
    FakeWorker.script = script({ [afterF3E5]: { cp: 500 }, [afterG4]: { mate: 1, pv: ['d8h4'] }, [afterF3]: { cp: 30 } });
    assert.deepEqual(await findTraps('p3', tree(), 'white'), []);
  });

  test('uses the cache while the tree has the same number of games', async () => {
    db.set('traps:p4:white', { n: 10, traps: ['cached'] });
    assert.deepEqual(await findTraps('p4', tree(), 'white'), ['cached']);
    assert.equal(FakeWorker.posted.filter((l) => l.startsWith('go')).length, 0);
    const bigger = tree(); bigger.n = 11;
    await findTraps('p4', bigger, 'white');
    assert.ok(FakeWorker.posted.some((l) => l.startsWith('go')));
  });

  test('as Black, candidates are at odd plies', async () => {
    const t = node(10, 50, { e4: node(10, 50, { f6: node(8, 10) }) });
    const afterE4 = fenAfter('e4'), afterF6 = fenAfter('e4', 'f6');
    FakeWorker.script = script({ [afterE4]: { cp: -20, best: 'e7e5' }, [afterF6]: { cp: 200, pv: ['d2d4'] } });
    const traps = await findTraps('p5', t, 'black');
    assert.deepEqual(traps.map((x) => [x.path, x.san, x.punish]), [[['e4'], 'f6', ['d4']]]);
  });
});

describe('reviewGames', () => {
  const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2'];
  const g = game({ url: 'r1', sans });
  const after = new Set([7, 8, 9, 10].map((k) => fenAfter(...sans.slice(0, k)))); // from 4.Nxe5 on
  const beforeBlunder = fenAfter(...sans.slice(0, 6));

  test('evaluates every move and details the bad ones', async () => {
    FakeWorker.script = (fen, nodes) => {
      if (fen === beforeBlunder) return nodes > 20000 ? { cp: 0, pv: ['e1g1', 'd8g5'] } : { cp: 0 };
      if (after.has(fen)) return { cp: fen.split(' ')[1] === 'b' ? 400 : -400 }; // Black is winning from here
      return { cp: 0 };
    };
    const progress = [];
    const cache = await reviewGames('u', [g, game({ url: 'short', sans: ['e4'] })], 5, (i, n) => progress.push([i, n]));
    const r = cache.r1;
    assert.equal(r.loss.length, sans.length);
    assert.ok(r.loss[6] >= BLUNDER, 'Nxe5 threw the game away');
    assert.equal(r.pieces[0], 32);
    assert.deepEqual(r.bad.map((b) => [b.ply, b.played, b.best, b.line]), [[7, 'Nxe5', 'O-O', ['O-O', 'Qg5']]]);
    assert.deepEqual(progress, [[0, 1], [1, 1]], 'games under 10 plies are skipped');
    assert.deepEqual(Object.keys(await reviewCache('u')), ['r1']);
  });

  test('does not review a game twice, and stops when asked', async () => {
    db.set('review:u', { r1: { loss: [] } });
    await reviewGames('u', [g], 5);
    assert.equal(FakeWorker.posted.filter((l) => l.startsWith('go')).length, 0);
    const out = await reviewGames('v', [g], 5, () => {}, { stop: true });
    assert.deepEqual(out, {});
  });

  test('a game the engine cannot analyse is skipped, not fatal', async () => {
    FakeWorker.script = () => 'crash';
    assert.deepEqual(await reviewGames('w', [g], 5), {});
  });

  test('checkmate ends the evaluation with a decisive score', async () => {
    const mate = ['f3', 'e5', 'g4', 'Qh4#'];
    const long = game({ url: 'm', color: 'black', sans: [...mate, 'x', 'x', 'x', 'x', 'x', 'x'] }); // junk after mate is ignored
    const out = await reviewGames('m', [long], 1);
    assert.equal(out.m.loss.length, 4);
    assert.equal(out.m.pieces.length, 4);
  });
});

describe('isGoodMove', () => {
  test('accepts moves close to the best, rejects bad and illegal ones', async () => {
    const good = fenAfter('e4'), bad = fenAfter('f3');
    FakeWorker.script = (fen) => (fen === START ? { cp: 30 } : fen === good ? { cp: -30 } : fen === bad ? { cp: 200 } : { cp: 0 });
    assert.equal(await isGoodMove(START, 'e4', 'd4'), true);
    assert.equal(await isGoodMove(START, 'f3', 'd4'), false);
    assert.equal(await isGoodMove(START, 'f3', 'f3'), true); // the stored answer always counts
    assert.equal(await isGoodMove(START, 'Ke2', 'd4'), false);
  });
});
