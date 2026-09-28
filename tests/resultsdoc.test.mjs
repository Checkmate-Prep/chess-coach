// Analysis results kept per account (app/resultsdoc.js): what's accepted from the network and how copies merge.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clean, apply, idbKey, rankOf, itemsOf, isItem } from '../app/resultsdoc.js';
import { review, traps, plan } from './helpers.mjs';

const URL1 = 'https://www.chess.com/game/live/123', URL2 = 'https://www.chess.com/game/daily/456';
describe('items', () => {
  test('names: a chess.com game review, a trap scan per colour, the plan', () => {
    for (const ok of [`review:${URL1}`, `review:${URL2}`, 'traps:white', 'traps:black', 'aiprep']) assert.ok(isItem(ok), ok);
    for (const bad of ['review:https://evil.com/game/live/1', 'review:', 'traps:red', 'plan', '', 3]) assert.ok(!isItem(bad), String(bad));
  });
  test('each item lives in the IndexedDB key the app already uses', () => {
    assert.equal(idbKey('bob', `review:${URL1}`), 'review:bob');
    assert.equal(idbKey('bob', 'traps:black'), 'traps:bob:black');
    assert.equal(idbKey('bob', 'aiprep'), 'aiprep:bob');
  });
  test('itemsOf lists what an IndexedDB value holds', () => {
    assert.deepEqual(itemsOf('review:bob', { [URL1]: review(), [URL2]: review() }), [`review:${URL1}`, `review:${URL2}`]);
    assert.deepEqual(itemsOf('traps:bob:white', traps(4)), ['traps:white']);
    assert.deepEqual(itemsOf('aiprep:bob', plan(1)), ['aiprep']);
    assert.deepEqual(itemsOf('aiprep:bob', undefined), []);
  });
  test('rank: reviews never change, more games win for traps, newer wins for plans', () => {
    assert.equal(rankOf(`review:${URL1}`, review()), 0);
    assert.equal(rankOf('traps:white', traps(42)), 42);
    assert.equal(rankOf('aiprep', plan(1234)), 1234);
  });
});

describe('clean', () => {
  test('keeps the app\'s shapes as they are', () => {
    assert.deepEqual(clean(`review:${URL1}`, review()), review());
    assert.deepEqual(clean('traps:white', traps(10)), traps(10));
    assert.deepEqual(clean('traps:white', { n: 5, traps: [] }), { n: 5, traps: [] }, 'an empty scan, saved before `checked` existed');
    assert.deepEqual(clean('aiprep', plan(5)), plan(5));
  });
  test('drops unknown fields', () => {
    assert.deepEqual(clean(`review:${URL1}`, review({ extra: 'x' })), review());
    assert.deepEqual(clean('aiprep', plan(5, { html: '<script>' })), plan(5));
  });
  test('rejects what the app could not have written', () => {
    const bad = [
      [`review:${URL1}`, review({ pieces: [32] })],                          // arrays of different lengths
      [`review:${URL1}`, review({ evals: [0, 'x', 1] })],
      [`review:${URL1}`, review({ bad: [{ ...review().bad[0], fen: 'x'.repeat(200) }] })],
      ['traps:white', traps(-1)],
      ['traps:white', traps(3, { traps: Array(9).fill(traps(1).traps[0]) })],
      ['aiprep', plan(5, { plan: { ...plan(5).plan, plans: [{ ...plan(5).plan.plans[0], you_play: 'red' }] } })],
      ['aiprep', plan(5, { plan: { ...plan(5).plan, summary: 'x'.repeat(5000) } })],
      ['aiprep', plan(5, { plan: { ...plan(5).plan, weak: Array(12).fill('x'.repeat(4000)), checklist: Array(12).fill('x'.repeat(4000)) } })], // too big
      ['aiprep', null], ['aiprep', []], ['nothing', {}],
    ];
    for (const [item, data] of bad) assert.throws(() => clean(item, data), /Invalid result/, `${item} ${JSON.stringify(data)?.slice(0, 60)}`);
  });
});

describe('apply', () => {
  test('reviews add up, game by game; a review already here stays', () => {
    const local = { [URL1]: review({ loss: [1, 1, 1] }) };
    assert.deepEqual(apply(local, `review:${URL2}`, review()), { ...local, [URL2]: review() });
    assert.equal(apply(local, `review:${URL1}`, review()), null);
    assert.deepEqual(apply(undefined, `review:${URL1}`, review()), { [URL1]: review() });
  });
  test('the trap scan of more games wins; a tie keeps the local one', () => {
    assert.deepEqual(apply(traps(10), 'traps:white', traps(12)), traps(12));
    assert.equal(apply(traps(12), 'traps:white', traps(10)), null);
    assert.equal(apply(traps(12), 'traps:white', traps(12, { checked: 9 })), null);
    assert.deepEqual(apply(undefined, 'traps:white', traps(1)), traps(1));
  });
  test('the newest plan wins', () => {
    assert.deepEqual(apply(plan(1), 'aiprep', plan(2)), plan(2));
    assert.equal(apply(plan(2), 'aiprep', plan(1)), null);
  });
  test('the order copies arrive in does not matter', () => {
    const copies = [traps(3), traps(9), traps(5)];
    const fold = (list) => list.reduce((v, c) => apply(v, 'traps:black', c) || v, undefined);
    assert.deepEqual(fold(copies), fold([...copies].reverse()));
  });
});
