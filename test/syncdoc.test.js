// Merge rules for synced data (app/syncdoc.js). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY, fromLocal, merge, toLocal, clean } from '../app/syncdoc.js';

const me = { user: 'alice', username: 'Alice' };
const prof = (...opps) => ({ me, opps });
const sync = (doc) => clean(JSON.parse(JSON.stringify(doc)), 1e13);

test('a first sync adds local data with the lowest priority', () => {
  const server = fromLocal(prof({ user: 'bob', username: 'Bob', name: 'Bobby' }), {}, EMPTY, 100);
  const local = fromLocal(prof({ user: 'bob', username: 'Bob' }, { user: 'carol', username: 'carol' }), { 'trap:bob:white:0': true }, null, 500);
  const out = toLocal(merge(server, local));
  assert.deepEqual(out.profile.opps, [{ user: 'bob', username: 'Bob', name: 'Bobby' }, { user: 'carol', username: 'carol' }]);
  assert.deepEqual(out.done, { 'trap:bob:white:0': true });
});

test('the latest change to an opponent wins, on either side', () => {
  const base = fromLocal(prof({ user: 'bob', username: 'Bob' }), {}, EMPTY, 100);
  const phone = fromLocal(prof({ user: 'bob', username: 'Bob', name: 'B' }), {}, base, 200);
  const laptop = fromLocal(prof({ user: 'bob', username: 'Bob', name: 'Robert' }), {}, base, 300);
  assert.equal(toLocal(merge(phone, laptop)).profile.opps[0].name, 'Robert');
  assert.equal(toLocal(merge(laptop, phone)).profile.opps[0].name, 'Robert');
});

test('adds on two devices are both kept, in the order they were added', () => {
  const base = fromLocal(prof(), {}, EMPTY, 100);
  const phone = fromLocal(prof({ user: 'bob', username: 'bob' }), {}, base, 300);
  const laptop = fromLocal(prof({ user: 'carol', username: 'carol' }), {}, base, 200);
  assert.deepEqual(toLocal(merge(phone, laptop)).profile.opps.map((o) => o.user), ['carol', 'bob']);
});

test('a removal reaches other devices, and adding again later brings the opponent back', () => {
  const base = fromLocal(prof({ user: 'bob', username: 'bob' }), {}, EMPTY, 100);
  const removed = fromLocal(prof(), {}, base, 200);
  assert.equal(removed.opps.bob.del, true);
  assert.deepEqual(toLocal(merge(base, removed)).profile.opps, []);
  const back = fromLocal(prof({ user: 'bob', username: 'bob' }), {}, removed, 300);
  assert.deepEqual(toLocal(merge(removed, back)).profile.opps.map((o) => o.user), ['bob']);
});

test('an unchanged device keeps the old times, so it does not undo a newer change', () => {
  const base = fromLocal(prof({ user: 'bob', username: 'bob' }), {}, EMPTY, 100);
  const again = fromLocal(prof({ user: 'bob', username: 'bob' }), {}, base, 900);
  assert.equal(again.opps.bob.t, 100);
});

test('a cleared name ("") is different from no name', () => {
  const base = fromLocal(prof({ user: 'bob', username: 'bob' }), {}, EMPTY, 100);
  const cleared = fromLocal(prof({ user: 'bob', username: 'bob', name: '' }), {}, base, 200);
  assert.equal(cleared.opps.bob.t, 200);
  assert.deepEqual(toLocal(sync(cleared)).profile.opps[0], { user: 'bob', username: 'bob', name: '' });
});

test('drill progress only grows', () => {
  const a = fromLocal(prof(), { x: true }, EMPTY, 100), b = fromLocal(prof(), { y: true }, EMPTY, 100);
  assert.deepEqual(toLocal(merge(a, b)).done, { x: true, y: true });
});

test('merge picks the same winner in any order, even on equal times', () => {
  const a = { ...EMPTY, opps: { bob: { username: 'bob', name: 'A', a: 1, t: 5 } } };
  const b = { ...EMPTY, opps: { bob: { username: 'bob', name: 'B', a: 1, t: 5 } } };
  assert.deepEqual(merge(a, b), merge(b, a));
});

test('your name and username sync, latest change wins', () => {
  const base = fromLocal({ me, opps: [] }, {}, EMPTY, 100);
  const renamed = fromLocal({ me: { ...me, name: 'Al' }, opps: [] }, {}, base, 200);
  assert.deepEqual(toLocal(merge(base, renamed)).profile.me, { ...me, name: 'Al' });
});

test('clean rejects bad input and caps times from a clock far ahead', () => {
  assert.throws(() => clean(null));
  assert.throws(() => clean({ v: 2 }));
  assert.throws(() => clean({ v: 1, opps: { 'Bad Name': { username: 'x', a: 1, t: 1 } } }));
  assert.throws(() => clean({ v: 1, opps: { bob: { username: 'x'.repeat(41), a: 1, t: 1 } } }));
  assert.throws(() => clean({ v: 1, done: Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`d${i}`, 1])) }));
  const c = clean({ v: 1, me: null, opps: { bob: { username: 'bob', a: 1, t: 9e15, extra: 'dropped' } }, done: { x: true } }, 1000);
  assert.deepEqual(c, { v: 1, me: null, opps: { bob: { username: 'bob', a: 1, t: 1000 + 864e5 } }, done: { x: 1 } });
});
