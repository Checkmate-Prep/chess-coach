// The one-time note before the first AI plan (app/aiconsent.js): asked once per device, remembered, cleared with the device.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeLocalStorage } from './helpers.mjs';
import { hasAiConsent, giveAiConsent } from '../app/aiconsent.js';
import { ls } from '../app/store.js';

let data;
beforeEach(() => { data = installFakeLocalStorage(); });

test('nobody has agreed on a fresh device', () => {
  assert.equal(hasAiConsent(), false);
});

test('agreeing is remembered on this device', () => {
  giveAiConsent();
  assert.equal(hasAiConsent(), true);
  assert.equal(JSON.parse(data.get('aiconsent')).v, 1);
});

test('clearing the device (sign out, delete account) asks again', () => {
  giveAiConsent();
  ls.clear();
  assert.equal(hasAiConsent(), false);
});

test('an answer to an older version of the note does not count', () => {
  data.set('aiconsent', JSON.stringify({ v: 0, at: 1 }));
  assert.equal(hasAiConsent(), false);
});

test('storage that is blocked never counts as agreement', () => {
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(hasAiConsent(), false);
  giveAiConsent();
  assert.equal(hasAiConsent(), false);
});
