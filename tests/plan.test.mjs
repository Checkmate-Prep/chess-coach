import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gamePlan, numbered } from '../app/plan.js';
import { node } from './helpers.mjs';

const empty = () => ({ n: 0, p: 0, c: {} });
const plan = (d) => gamePlan({ pr: null, tw: empty(), tb: empty(), trW: null, trB: null, ...d });
// A tree of the moves you play, with each move seen `n` times.
const mine = (moves) => ({ n: 10, p: 10, c: Object.fromEntries(moves.map(([san, c]) => [san, { n: 5, p: 5, c: c || {} }])) });

describe('numbered', () => {
  test('numbers White moves only', () => assert.equal(numbered(['e4', 'e5', 'Nf3']), '1.e4 e5 2.Nf3'));
  test('empty list', () => assert.equal(numbered([]), ''));
});

describe('gamePlan: no games', () => {
  test('gives an empty plan without throwing', () => {
    const p = plan({});
    assert.deepEqual(p.white, { points: [], line: null, keyFrom: null, trap: null });
    assert.deepEqual(p.black, { points: [], line: null, keyFrom: null, trap: null });
    assert.deepEqual(p.manage, []);
    assert.equal(p.trapsChecked, false);
  });
});

describe('gamePlan: your first move as White', () => {
  // Their tree as Black. Scores are theirs: lower is better for you.
  const tb = () => node(1140, 46, {
    f4: node(600, 60),
    e4: node(500, 30, { c5: node(300, 50), e5: node(200, 50) }),
    d4: node(40, 25),
  });

  test('a small sample does not outrank a large one on raw score', () => {
    // d4: 25% over 40 games vs e4: 30% over 500. Pulled toward their 46% average, d4 ranks worse.
    const w = plan({ tb: tb() }).white;
    assert.equal(w.points[0], 'Open 1.e4. They score 30% against it (500 games), against 60% after 1.f4.');
    assert.equal(w.points[1], 'Expect 1…c5: they play it in 60% of those games.');
    assert.deepEqual(w.line, ['e4']);
    assert.equal(w.keyFrom, 0);
  });

  test('a move you don\'t play needs 40 games before it is recommended', () => {
    const t = tb();
    t.c.d4 = node(39, 0);
    assert.match(plan({ tb: t }).white.points[0], /^Open 1\.e4\./);
  });

  test('a move you already play wins when it is nearly as good', () => {
    const t = tb();
    t.c.d4 = node(40, 35); // adjusted ~40 vs e4 ~31: not close
    assert.match(plan({ tb: t, myW: mine([['d4']]) }).white.points[0], /^Open 1\.e4\./);
    t.c.d4 = node(40, 25); // adjusted ~33 vs ~31: within 5 points
    const w = plan({ tb: t, myW: mine([['d4']]) }).white;
    assert.match(w.points[0], /^Open 1\.d4\. .*You already play it\.$/);
  });

  test('a trap decides the opening and supplies the line', () => {
    const trap = { path: ['d4', 'd5'], san: 'Bf5', played: 'Bf5', times: 5, of: 8, punish: ['c4', 'e6', 'Qb3', 'Nc6'] };
    const t = tb();
    t.c.d4 = node(40, 25, { d5: node(30, 20) });
    const w = plan({ tb: t, trB: [trap] }).white;
    assert.equal(w.points[0], 'Open 1.d4. It leads to their repeated mistake below. They score 25% against it (40 games).');
    assert.ok(w.points.includes('Trap: after 1.d4 d5, they play Bf5 in 5 of 8 games. Punish it with c4.'));
    assert.deepEqual(w.line, ['d4', 'd5', 'Bf5', 'c4', 'e6', 'Qb3']);
    assert.equal(w.keyFrom, 2);
    assert.equal(w.trap, trap);
  });

  test('a trap after a move you play is preferred over one you don\'t', () => {
    const a = { path: ['e4', 'e5'], played: 'Nc6', times: 5, of: 8, punish: ['Bb5'] };
    const b = { path: ['d4', 'd5'], played: 'Bf5', times: 9, of: 9, punish: ['c4'] };
    const w = plan({ tb: tb(), trB: [b, a], myW: mine([['e4']]) }).white;
    assert.equal(w.trap, a);
  });

  test('a weak line is only shown when it follows the recommended opening', () => {
    const t = tb();
    t.c.f4.c.e5 = node(50, 10, { fxe5: node(50, 10) }); // weak, but after 1.f4, which isn't recommended
    const w = plan({ tb: t }).white;
    assert.ok(!w.points.some((p) => p.startsWith('They struggle')));

    t.c.e4.c.c5 = node(300, 50, { Nf3: node(100, 20) });
    const w2 = plan({ tb: t }).white;
    assert.ok(w2.points.includes('They struggle after 1.e4 c5 2.Nf3: 20% in 100 games.'));
    assert.deepEqual(w2.line, ['e4', 'c5', 'Nf3']);
    assert.equal(w2.keyFrom, 1);
  });
});

describe('gamePlan: your reply as Black', () => {
  const tw = () => node(200, 50, {
    e4: node(150, 55, { e5: node(100, 60), c5: node(50, 30) }),
    d4: node(50, 40),
  });

  test('names their usual first move and the best reply', () => {
    const b = plan({ tw: tw() }).black;
    assert.equal(b.points[0], 'They open 1.e4 in 75% of their games.');
    assert.equal(b.points[1], 'Answer 1…c5. They score 30% against it (50 games), against 60% after the more common 1…e5.');
    assert.deepEqual(b.line, ['e4', 'c5']);
  });

  test('a trap must start from their usual first move', () => {
    const off = { path: ['d4', 'd5'], played: 'Bf4', times: 4, of: 6, punish: ['e5'] };
    const on = { path: ['e4', 'e5'], played: 'Qh5', times: 4, of: 6, punish: ['Nc6'] };
    assert.equal(plan({ tw: tw(), trW: [off] }).black.trap, null);
    const b = plan({ tw: tw(), trW: [off, on] }).black;
    assert.equal(b.trap, on);
    assert.equal(b.points[1], 'Answer 1…e5. It leads to their repeated mistake below. They score 60% against it (100 games).');
  });
});

describe('gamePlan: managing the game', () => {
  const pr = (o = {}) => ({
    byTc: { blitz: { n: 60, score: 50 }, rapid: { n: 40, score: 50 } },
    onTimePct: 0,
    lengthScore: { short: { n: 20, score: 50 }, long: { n: 20, score: 50 } },
    castling: { queensidePct: 0, neverPct: 0 },
    ...o,
  });
  const manage = (o) => plan({ pr: pr(o) }).manage;

  test('nothing to say about a balanced player', () => assert.deepEqual(manage(), []));

  test('suggests a slower time control when they mostly play one', () => {
    const m = manage({ byTc: { blitz: { n: 90, score: 50 }, rapid: { n: 10, score: 50 } } });
    assert.equal(m.length, 1);
    assert.match(m[0], /^They play mostly blitz \(90% of their games\)\. Ask for a (daily|rapid) game/);
    assert.deepEqual(manage({ byTc: { blitz: { n: 69, score: 50 }, rapid: { n: 31, score: 50 } } }), []);
    assert.deepEqual(manage({ byTc: { daily: { n: 100, score: 50 } } }), []); // nothing slower than daily
  });

  test('weakest time control needs 20 games and 45% or less', () => {
    assert.deepEqual(manage({ byTc: { blitz: { n: 30, score: 50 }, rapid: { n: 20, score: 45 } } }),
      ['Their weakest time control is rapid: 45% over 20 games.']);
    assert.deepEqual(manage({ byTc: { blitz: { n: 30, score: 50 }, rapid: { n: 19, score: 10 } } }), []);
  });

  test('clock, game length and king safety thresholds', () => {
    assert.equal(manage({ onTimePct: 29 }).length, 0);
    assert.match(manage({ onTimePct: 30 })[0], /^30% of their decisive games end on the clock/);
    assert.match(manage({ lengthScore: { short: { n: 10, score: 40 }, long: { n: 10, score: 48 } } })[0], /stronger as games go on \(48%/);
    assert.match(manage({ lengthScore: { short: { n: 10, score: 48 }, long: { n: 10, score: 40 } } })[0], /fade in long games \(40%/);
    assert.deepEqual(manage({ lengthScore: { short: { n: 9, score: 0 }, long: { n: 10, score: 100 } } }), []);
    assert.deepEqual(manage({ lengthScore: { short: { n: 10, score: 50 }, long: { n: 10, score: 57 } } }), []);
    assert.match(manage({ castling: { queensidePct: 25, neverPct: 0 } })[0], /castle queenside in 25%/);
    assert.match(manage({ castling: { queensidePct: 0, neverPct: 15 } })[0], /king in the centre in 15%/);
    assert.deepEqual(manage({ castling: { queensidePct: 24, neverPct: 14 } }), []);
  });

  test('trapsChecked is true once either colour was scanned', () => {
    assert.equal(plan({ trW: [] }).trapsChecked, true);
  });
});
