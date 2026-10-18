// Sign-out (app/sync.js): what counts as unsent, that nothing is cleared while changes are unsent,
// and that a forced sign-out clears everything. The Auth0 redirect itself needs a real browser or device.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { signOut, hasUnsent } from '../app/sync.js';
import { fromLocal } from '../app/syncdoc.js';
import { idb, ls } from '../app/store.js';
import { installFakeIndexedDB, installFakeLocalStorage } from './helpers.mjs';

const db = installFakeIndexedDB();
const store = installFakeLocalStorage();
const profile = { me: { user: 'me', username: 'Me' }, opps: [{ user: 'rival', username: 'Rival' }] };
let replaced;
beforeEach(() => { db.clear(); store.clear(); replaced = []; globalThis.location = { pathname: '/', replace: (u) => replaced.push(u) }; });

/** Local data that was synced: sync-doc is the doc the server last returned. */
const synced = (p = profile, done = {}) => { ls.set('profile', p); ls.set('done', done); ls.set('sync-doc', fromLocal(p, done, null, 0)); };

describe('hasUnsent', () => {
  test('a fresh device has nothing to send', () => assert.equal(hasUnsent(), false));
  test('data that was never synced is unsent', () => { ls.set('profile', profile); assert.equal(hasUnsent(), true); });
  test('data that matches the last synced doc is not', () => { synced(); assert.equal(hasUnsent(), false); });
  test('a new opponent, a rename, a removal and new drill progress are each unsent', () => {
    synced();
    ls.set('profile', { ...profile, opps: [...profile.opps, { user: 'new', username: 'New' }] }); assert.equal(hasUnsent(), true);
    ls.set('profile', { ...profile, opps: [{ user: 'rival', username: 'Rival', name: 'Sam' }] }); assert.equal(hasUnsent(), true);
    ls.set('profile', { ...profile, opps: [] }); assert.equal(hasUnsent(), true);
    ls.set('profile', profile); assert.equal(hasUnsent(), false);
    ls.set('done', { d1: true }); assert.equal(hasUnsent(), true);
  });
  test('analysis results waiting to upload are unsent', () => {
    synced();
    ls.set('results-dirty', { rival: { review: 5 } }); assert.equal(hasUnsent(), true);
    ls.set('results-dirty', { rival: {} }); assert.equal(hasUnsent(), false);
  });
});

describe('signOut', () => {
  test('with unsent changes it stops and clears nothing', async () => {
    ls.set('profile', profile); await idb.set('g', 1);
    const out = await signOut();
    assert.deepEqual(out, { unsent: true });
    assert.deepEqual(ls.get('profile', null), profile);
    assert.equal(await idb.get('g'), 1);
    assert.deepEqual(replaced, []);
  });
  test('force clears localStorage and goes back to the welcome screen', async () => {
    ls.set('profile', profile); await idb.set('g', 1);
    assert.deepEqual(await signOut({ force: true }), { unsent: false });
    assert.equal(ls.get('profile', null), null);
    assert.equal(await idb.get('g'), undefined);
    assert.deepEqual(replaced, ['/']);
  });
  test('with everything synced it signs out without asking', async () => {
    synced();
    assert.deepEqual(await signOut(), { unsent: false });
    assert.equal(ls.get('profile', null), null);
  });
  test('send: false (after deleting the account) never asks', async () => {
    ls.set('profile', profile);
    assert.deepEqual(await signOut({ send: false }), { unsent: false });
    assert.equal(ls.get('profile', null), null);
  });
});
