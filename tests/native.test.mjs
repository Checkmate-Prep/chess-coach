// The iOS shell (Capacitor): when the app counts as native and where its /api calls go.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNative, API_BASE, apiUrl, SITE } from '../app/native.js';
import { syncGames, useGameStore } from '../app/chesscom.js';
import { installFakeIndexedDB, installFakeLocalStorage, installFakeFetch } from './helpers.mjs';

const db = installFakeIndexedDB();
const store = installFakeLocalStorage();
beforeEach(() => { db.clear(); store.clear(); });
afterEach(() => { delete globalThis.Capacitor; useGameStore(false); });

describe('API base', () => {
  test('in a browser, api paths stay relative', () => {
    assert.equal(isNative(), false);
    assert.equal(API_BASE(), '');
    assert.equal(apiUrl('api/sync'), 'api/sync');
  });
  test('with window.Capacitor they point at the site', () => {
    globalThis.Capacitor = {};
    assert.equal(isNative(), true);
    assert.equal(SITE, 'https://checkmateprep.com/');
    assert.equal(apiUrl('api/sync'), 'https://checkmateprep.com/api/sync');
    assert.equal(apiUrl('api/results?since=5'), 'https://checkmateprep.com/api/results?since=5');
  });
  test('Capacitor loaded in a plain browser (isNativePlatform false) is not native', () => {
    globalThis.Capacitor = { isNativePlatform: () => false };
    assert.equal(apiUrl('api/sync'), 'api/sync');
    globalThis.Capacitor = { isNativePlatform: () => true };
    assert.equal(apiUrl('api/sync'), 'https://checkmateprep.com/api/sync');
  });
  test('the game store is asked at the site in the native app, and chess.com is the fallback', async () => {
    globalThis.Capacitor = {};
    useGameStore(true);
    const calls = installFakeFetch({
      'https://checkmateprep.com/api/games?player=testplayer': { archives: [] },
    });
    await syncGames('testplayer');
    assert.equal(calls[0], 'https://checkmateprep.com/api/games?player=testplayer');
  });
});

describe('no build step', () => {
  test('every app file still calls api/ through apiUrl', () => {
    for (const f of ['app.js', 'chesscom.js', 'results.js', 'sync.js', 'track.js']) {
      const src = readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
      assert.doesNotMatch(src, /fetch\(\s*['"`]api\//, `${f} fetches a bare api/ path`);
    }
  });
});
