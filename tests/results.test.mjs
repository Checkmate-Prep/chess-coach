// Analysis results on the account: the Worker's /api/results (worker/results.js) on a D1 stand-in, and the app's
// side (app/results.js) talking to it, as two devices of one account.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { results, dropResults } from '../worker/results.js';
import { syncResults, markDirty, expectPull, resultsReady } from '../app/results.js';
import { installFakeIndexedDB, installFakeLocalStorage, fakeD1, flush, review, traps, plan } from './helpers.mjs';

const URL1 = 'https://www.chess.com/game/live/1', URL2 = 'https://www.chess.com/game/live/2';
const env = { DB: await fakeD1() };
const idb = installFakeIndexedDB();
const ls = installFakeLocalStorage();
beforeEach(async () => { await env.DB.prepare('DELETE FROM results').run().catch(() => {}); idb.clear(); ls.clear(); });

/** Call the Worker as `sub` (null = signed out). */
const call = (sub, method, { since, body, raw, now } = {}) => results(
  new Request(`https://x/api/results${since != null ? `?since=${since}` : ''}`, { method, body: raw ?? (body && JSON.stringify(body)) }),
  env, async () => sub, now);
const post = (sub, items, now) => call(sub, 'POST', { body: { items }, now }).then((r) => r.json());
const pull = (sub, since = 0, now) => call(sub, 'GET', { since, now }).then((r) => r.json());
const byItem = (out) => Object.fromEntries(out.items.map((i) => [`${i.player} ${i.item}`, i.data]));

describe('/api/results', () => {
  test('needs sign-in, and only GET and POST', async () => {
    assert.equal((await call(null, 'GET')).status, 401);
    assert.equal((await call('a', 'PUT')).status, 405);
  });

  test('saves items and gives them back to the same account only', async () => {
    assert.deepEqual(await post('a', [{ player: 'bob', item: `review:${URL1}`, data: review() }, { player: 'bob', item: 'aiprep', data: plan(5) }], 1000), { saved: 2, rejected: [] });
    const out = await pull('a', 0, 2000);
    assert.equal(out.at, 2000);
    assert.deepEqual(byItem(out), { [`bob review:${URL1}`]: review(), 'bob aiprep': plan(5) });
    assert.deepEqual((await pull('b')).items, []);
  });

  test('a review is written once; a trap scan or plan replaces only a lower rank', async () => {
    await post('a', [{ player: 'bob', item: `review:${URL1}`, data: review() }, { player: 'bob', item: 'traps:white', data: traps(10) }, { player: 'bob', item: 'aiprep', data: plan(5) }], 1000);
    await post('a', [{ player: 'bob', item: `review:${URL1}`, data: review({ loss: [9, 9, 9] }) }, { player: 'bob', item: 'traps:white', data: traps(8) }, { player: 'bob', item: 'aiprep', data: plan(4) }], 2000);
    assert.deepEqual((await pull('a', 1500)).items, [], 'nothing changed');
    await post('a', [{ player: 'bob', item: 'traps:white', data: traps(12) }, { player: 'bob', item: 'aiprep', data: plan(6) }], 3000);
    const got = byItem(await pull('a', 2500));
    assert.deepEqual(got, { 'bob traps:white': traps(12), 'bob aiprep': plan(6) });
  });

  test('invalid items are skipped and reported; the others are saved', async () => {
    const out = await post('a', [
      { player: 'bob', item: 'aiprep', data: plan(5) },
      { player: 'Bad Name', item: 'aiprep', data: plan(5) },
      { player: 'bob', item: 'traps:white', data: { n: 'x' } },
      { player: 'bob', item: 'review:https://evil.com/1', data: review() },
    ]);
    assert.deepEqual(out, { saved: 1, rejected: [1, 2, 3] });
  });

  test('refuses malformed or oversized uploads', async () => {
    assert.equal((await call('a', 'POST', { raw: '{' })).status, 400);
    assert.equal((await call('a', 'POST', { body: { items: 'x' } })).status, 400);
    assert.equal((await call('a', 'POST', { body: { items: Array(201).fill({}) } })).status, 400);
    assert.equal((await call('a', 'POST', { raw: 'x'.repeat(1_000_001) })).status, 413);
  });

  test('a large account is pulled page by page', async () => {
    for (let b = 0; b < 6; b++) {
      await post('a', Array.from({ length: 200 }, (_, i) => ({ player: 'bob', item: `review:https://www.chess.com/game/live/${b}x${i}`, data: review() })), 1000 + b);
    }
    const first = await pull('a', 0, 9000);
    assert.equal(first.items.length, 1000);
    assert.equal(first.more, true);
    const rest = await pull('a', first.at, 9000);
    assert.equal(rest.more, undefined);
    assert.equal(new Set([...first.items, ...rest.items].map((i) => i.item)).size, 1200);
  });

  test('deleting an account removes its results, not anyone else\'s', async () => {
    await post('a', [{ player: 'bob', item: 'aiprep', data: plan(5) }]);
    await post('b', [{ player: 'bob', item: 'aiprep', data: plan(5) }]);
    await dropResults(env, 'a');
    assert.deepEqual((await pull('a')).items, []);
    assert.equal((await pull('b')).items.length, 1);
  });
});

// ---------- the app's side, two devices of one account ----------
globalThis.fetch = async (url, init = {}) => results(new Request(`https://x/${url}`, init), env, async () => 'acct');
/** Switch device: this device's IndexedDB and localStorage are put away and the other's brought back. */
const devices = { phone: [new Map(), new Map()], laptop: [new Map(), new Map()] };
let on = null;
function useDevice(name) {
  if (on) devices[on] = [new Map(idb), new Map(ls)];
  idb.clear(); ls.clear();
  for (const [k, v] of devices[name][0]) idb.set(k, v);
  for (const [k, v] of devices[name][1]) ls.set(k, v);
  on = name;
}

describe('syncResults', () => {
  beforeEach(() => { on = null; devices.phone = [new Map(), new Map()]; devices.laptop = [new Map(), new Map()]; });

  test('a new device gets what another device worked out, without redoing it', async () => {
    useDevice('laptop');
    idb.set('review:bob', { [URL1]: review() });
    idb.set('traps:bob:black', traps(40));
    idb.set('aiprep:bob', plan(7));
    // work done before signing in: uploaded on the device's first sync
    assert.deepEqual(await syncResults('t', ['me', 'bob']), []);
    assert.equal(ls.get('results-dirty'), '{}');

    useDevice('phone');
    assert.deepEqual(await syncResults('t', ['me', 'bob']), ['bob']);
    assert.deepEqual(idb.get('review:bob'), { [URL1]: review() });
    assert.deepEqual(idb.get('traps:bob:black'), traps(40));
    assert.deepEqual(idb.get('aiprep:bob'), plan(7));
  });

  test('new results travel both ways and merge with what is there', async () => {
    useDevice('laptop'); await syncResults('t', ['bob']);
    useDevice('phone'); await syncResults('t', ['bob']);
    idb.set('review:bob', { [URL2]: review() }); markDirty('bob', `review:${URL2}`);
    await syncResults('t', ['bob']);

    useDevice('laptop');
    idb.set('review:bob', { [URL1]: review() }); markDirty('bob', `review:${URL1}`);
    assert.deepEqual(await syncResults('t', ['bob']), ['bob']);
    assert.deepEqual(Object.keys(idb.get('review:bob')).sort(), [URL1, URL2]);

    useDevice('phone');
    await syncResults('t', ['bob']);
    assert.deepEqual(Object.keys(idb.get('review:bob')).sort(), [URL1, URL2]);
  });

  test('an older plan does not replace a newer one', async () => {
    useDevice('laptop'); idb.set('aiprep:bob', plan(9)); await syncResults('t', ['bob']);
    useDevice('phone'); idb.set('aiprep:bob', plan(3));
    await syncResults('t', ['bob']);
    assert.deepEqual(idb.get('aiprep:bob'), plan(9));
  });

  test('something marked while an upload is out is sent next time', async () => {
    useDevice('laptop');
    await syncResults('t', ['bob']);
    idb.set('aiprep:bob', plan(1)); markDirty('bob', 'aiprep');
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => { if (init?.method === 'POST') { idb.set('aiprep:bob', plan(2)); markDirty('bob', 'aiprep'); } return real(url, init); };
    try { await syncResults('t', ['bob']); } finally { globalThis.fetch = real; }
    assert.ok(JSON.parse(ls.get('results-dirty')).bob.aiprep, 'still marked');
    await syncResults('t', ['bob']);
    assert.equal(ls.get('results-dirty'), '{}');
    assert.deepEqual(byItem(await pull('acct')), { 'bob aiprep': plan(2) });
  });

  test('analysis waits for the pull of a sync in progress', async () => {
    useDevice('laptop');
    expectPull();
    let waited = false;
    resultsReady().then(() => { waited = true; });
    await flush();
    assert.equal(waited, false);
    await syncResults('t', []);
    await flush();
    assert.equal(waited, true);
  });
});
