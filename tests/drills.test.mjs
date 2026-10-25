import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortHash, trapDrillId, lineDrillId, migrateDone } from '../app/drills.js';

const trap = (path, san) => ({ path, san });

test('shortHash is stable and short', () => {
  assert.equal(shortHash('e4 e5'), shortHash('e4 e5'));
  assert.notEqual(shortHash('e4 e5'), shortHash('e4 c5'));
  assert.match(shortHash(''), /^[0-9a-f]{8}$/);
  assert.equal(shortHash('a'), 'e40c292c', 'FNV-1a: the same value on every device');
});

test('drill ids come from the trap or the line, not from a place in a list', () => {
  const a = trap(['e4', 'e5'], 'Nf3'), b = trap(['e4', 'c5'], 'Nf3');
  assert.equal(trapDrillId('bob', 'black', a), trapDrillId('bob', 'black', { ...a, times: 9 }), 'counts can change');
  assert.notEqual(trapDrillId('bob', 'black', a), trapDrillId('bob', 'black', b));
  assert.notEqual(trapDrillId('bob', 'black', a), trapDrillId('bob', 'white', a));
  assert.match(lineDrillId('bob', 'e4 e5 Nf3'), /^ailine:bob:[0-9a-f]{8}$/);
  assert.ok(trapDrillId('a'.repeat(40), 'white', a).length <= 100, 'fits the synced id limit');
});

test('old ticks move to the drill now at their place; others are ignored', () => {
  const traps = { 'bob:white': [trap(['f3'], 'g4'), trap(['e4'], 'Ke2')], 'bob:black': [] };
  const lines = { bob: ['', 'e4 e5 Nf3'] };
  const done = { 'trap:bob:white:1': true, 'ailine:bob:1': true, 'ailine:bob:0': true, 'trap:bob:white:7': true, 'mine:x#3': true };
  const out = migrateDone(done, ['bob'], (u, c) => traps[`${u}:${c}`], (u) => lines[u]);
  assert.deepEqual(out, { [trapDrillId('bob', 'white', traps['bob:white'][1])]: true, [lineDrillId('bob', 'e4 e5 Nf3')]: true });
});
