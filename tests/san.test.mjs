import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSan } from '../app/san.js';

test('isSan accepts every kind of move and nothing else', () => {
  for (const m of ['e4', 'exd5', 'Nf3', 'Nbd7', 'R1e2', 'Qh4xe1', 'e8=Q', 'exd8=N+', 'O-O', 'O-O-O#', 'Kxf7', 'Bb5+']) assert.ok(isSan(m), m);
  for (const m of ['', 'e9', 'i4', 'Pe4', 'e8=K', 'O-O-O-O', '0-0', 'e4!', '1-0', '<b>', 'e4<img', null, 42]) assert.ok(!isSan(m), String(m));
});
