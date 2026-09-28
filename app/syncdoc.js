// The synced part of a player's data, shared by the app (sync.js) and the Worker (worker/sync.js).
// Only what the user typed or earned travels: who they are, their opponents and names, drill progress.
// Games and engine results are rebuilt on each device.
//
// Doc: { v, me: {user, username, name?, t} | null, opps: {user: {username, name?, a, t, del?}}, done: {id: 1} }
// `t` = when that entry last changed (the latest change wins), `a` = when the opponent was added (list order),
// `del` = removed (kept so the removal reaches other devices). Drill progress only grows, so it merges by union.

export const EMPTY = { v: 1, me: null, opps: {}, done: {} };
const USER = /^[a-z0-9_-]{1,40}$/;
const MAX = { opps: 500, done: 5000, name: 60, id: 100 };

// 'name' may be absent (use the hand-written prep's name) or '' (cleared: show the username), so keep the difference.
const withName = (x, o) => ('name' in o ? { ...x, name: o.name } : x);
const same = (a, b) => a.username === b.username && ('name' in a) === ('name' in b) && (a.name ?? '') === (b.name ?? '');
// Deterministic tie-break, so every device and the server pick the same winner.
const later = (a, b) => (a.t !== b.t ? (a.t > b.t ? a : b) : JSON.stringify(a) >= JSON.stringify(b) ? a : b);

/**
 * The doc for the device's current data. `prev` is the last doc this device synced; entries that differ from it
 * get `now` as their time. With no `prev` (first sync on this device), local entries get time 0, so data already
 * on the account wins and only what's missing there is added.
 */
export function fromLocal(profile, done, prev, now) {
  const base = prev || EMPTY, t = prev ? now : 0;
  const doc = { v: 1, me: base.me, opps: { ...base.opps }, done: { ...base.done } };
  const me = profile?.me;
  if (me && (!base.me || base.me.user !== me.user || !same(base.me, me))) doc.me = withName({ user: me.user, username: me.username }, me.name != null ? me : {}), doc.me.t = t;
  const here = new Set();
  (profile?.opps || []).forEach((o, i) => {
    here.add(o.user);
    const old = base.opps[o.user];
    if (old && !old.del && same(old, o)) return;
    doc.opps[o.user] = { ...withName({ username: o.username }, o), a: old && !old.del ? old.a : now + i, t };
  });
  if (prev) for (const [u, o] of Object.entries(base.opps)) if (!o.del && !here.has(u)) doc.opps[u] = { username: o.username, a: o.a, t, del: true };
  for (const id of Object.keys(done || {})) doc.done[id] = 1;
  return doc;
}

/** Combine two docs: per entry the latest change wins; drill progress is the union. Order doesn't matter. */
export function merge(a, b) {
  const me = a.me && b.me ? later(a.me, b.me) : a.me || b.me;
  const opps = { ...a.opps };
  for (const [u, o] of Object.entries(b.opps)) opps[u] = opps[u] ? later(opps[u], o) : o;
  return { v: 1, me, opps, done: { ...a.done, ...b.done } };
}

/** The app's local shapes: profile {me, opps:[...]} (opponents in the order they were added) and done {id: true}. */
export function toLocal(doc) {
  const profile = doc.me ? {
    me: withName({ user: doc.me.user, username: doc.me.username }, doc.me),
    opps: Object.entries(doc.opps).filter(([, o]) => !o.del).sort((x, y) => x[1].a - y[1].a || (x[0] < y[0] ? -1 : 1))
      .map(([user, o]) => withName({ user, username: o.username }, o)),
  } : null;
  return { profile, done: Object.fromEntries(Object.keys(doc.done).map((id) => [id, true])) };
}

/** Validate a doc from outside (the network): returns a clean copy with only known fields, or throws. */
export function clean(doc, now = Date.now()) {
  const bad = (why) => { throw new Error(`Invalid sync data: ${why}.`); };
  if (!doc || typeof doc !== 'object' || doc.v !== 1) bad('version');
  const str = (s, max, what) => (typeof s === 'string' && s.length <= max ? s : bad(what));
  // Times from a device clock that runs far ahead would win every merge: cap them a day ahead of the server.
  const time = (t) => (Number.isFinite(t) && t >= 0 ? Math.min(Math.floor(t), now + 864e5) : bad('time'));
  const user = (u) => (typeof u === 'string' && USER.test(u) ? u : bad('username'));
  const name = (x, o) => ('name' in o ? { ...x, name: str(o.name, MAX.name, 'name') } : x);
  let me = null;
  if (doc.me != null) me = { ...name({ user: user(doc.me.user), username: str(doc.me.username, 40, 'username') }, doc.me), t: time(doc.me.t) };
  const entries = Object.entries(doc.opps || {});
  if (entries.length > MAX.opps) bad('too many opponents');
  const opps = {};
  for (const [u, o] of entries) {
    if (!o || typeof o !== 'object') bad('opponent');
    opps[user(u)] = { ...name({ username: str(o.username, 40, 'username') }, o), a: time(o.a), t: time(o.t), ...(o.del ? { del: true } : {}) };
  }
  const ids = Object.keys(doc.done || {});
  if (ids.length > MAX.done) bad('too many drills');
  const done = {};
  for (const id of ids) done[str(id, MAX.id, 'drill')] = 1;
  return { v: 1, me, opps, done };
}
