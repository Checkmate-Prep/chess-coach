import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastSentences } from '../worker/thought.js';

test('lastSentences keeps the last complete sentences and drops the one still being written', () => {
  assert.equal(lastSentences('They play 1.e4 in most games. They lose after 3.Bc4. Now look at'), 'They play 1.e4 in most games. They lose after 3.Bc4.');
});

test('lastSentences stays under the limit, keeping the newest sentence', () => {
  const s = `${'A'.repeat(150)}. ${'B'.repeat(100)}.`;
  assert.equal(lastSentences(s), `${'B'.repeat(100)}.`);
});

test('lastSentences cuts a single sentence that is too long', () => {
  const out = lastSentences(`${'C'.repeat(300)}.`);
  assert.equal(out.length, 200);
  assert.ok(out.endsWith('…'));
});

test('lastSentences returns nothing until a sentence is complete, and joins lines', () => {
  assert.equal(lastSentences('Thinking about'), '');
  assert.equal(lastSentences(''), '');
  assert.equal(lastSentences('First\nline done.\n\nNext'), 'First line done.');
});
