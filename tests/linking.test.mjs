// Account linking (ops/auth0/link-accounts.js, with Auth0 faked), the Login flow order, and merging existing
// duplicates (ops/auth0/merge-accounts.mjs, on an in-memory D1).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeD1, review, traps } from './helpers.mjs';
import { withBinding } from '../ops/auth0/deploy-actions.mjs';
import { mergeSql } from '../ops/auth0/merge-accounts.mjs';

const load = (file) => { const exports = {}; new Function('exports', readFileSync(new URL(`../ops/auth0/${file}`, import.meta.url), 'utf8'))(exports); return exports; };
const link = load('link-accounts.js');

const google = { user_id: 'google-oauth2|9', email: 'Ann@Example.com', email_verified: true, identities: [{ provider: 'google-oauth2', user_id: '9' }] };
const password = { user_id: 'auth0|1', email: 'ann@example.com', email_verified: true, created_at: '2026-01-01T00:00:00.000Z', identities: [{ provider: 'auth0', user_id: '1' }] };

describe('who gets linked', () => {
  test('a verified login links to the existing verified user with the same email, ignoring case', () => {
    assert.equal(link.pickPrimary(google, [password]).user_id, 'auth0|1');
  });
  test('never when the email is not verified, on the login or on the existing user', () => {
    assert.equal(link.pickPrimary({ ...google, email_verified: false }, [password]), null);
    assert.equal(link.pickPrimary({ ...google, email_verified: undefined }, [password]), null);
    assert.equal(link.pickPrimary(google, [{ ...password, email_verified: false }]), null);
    assert.equal(link.pickPrimary(google, [{ ...password, email_verified: 'true' }]), null);
  });
  test('not to itself, a blocked user, another address, or when already linked', () => {
    assert.equal(link.pickPrimary(google, [google]), null);
    assert.equal(link.pickPrimary(google, [{ ...password, blocked: true }]), null);
    assert.equal(link.pickPrimary(google, [{ ...password, email: 'bob@example.com' }]), null);
    assert.equal(link.pickPrimary({ ...google, identities: [...google.identities, { provider: 'auth0', user_id: '1' }] }, [password]), null);
    assert.equal(link.pickPrimary(google, []), null);
  });
  test('with several candidates, the oldest account stays the primary', () => {
    const newer = { ...password, user_id: 'auth0|2', created_at: '2026-06-01T00:00:00.000Z' };
    assert.equal(link.pickPrimary(google, [newer, password]).user_id, 'auth0|1');
  });
  test('links the identity the login came with', () => {
    assert.deepEqual(link.identityToLink(google), { provider: 'google-oauth2', user_id: '9' });
    assert.deepEqual(link.identityToLink({ user_id: 'email|abc' }), { provider: 'email', user_id: 'abc' });
    assert.equal(link.identityToLink({}), null);
  });
});

describe('the Action', () => {
  const secrets = { MGMT_DOMAIN: 't.auth0.com', MGMT_CLIENT_ID: 'id', MGMT_CLIENT_SECRET: 's' };
  /** Runs the Action against a fake Management API; returns the calls and what it asked Auth0 to do. */
  async function run(user, { candidates = [password], linkStatus = 200, token = 't0k' } = {}) {
    const calls = [], primary = [], meta = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body });
      if (url.endsWith('/oauth/token')) return new Response(JSON.stringify(token ? { access_token: token } : { error: 'denied' }));
      if (url.includes('/users-by-email')) return new Response(JSON.stringify(candidates));
      return new Response('[]', { status: linkStatus });
    };
    const api = { authentication: { setPrimaryUser: (id) => primary.push(id) }, user: { setAppMetadata: (k, v) => meta.push([k, v]) } };
    const log = console.log; console.log = () => {};
    try { await link.onExecutePostLogin({ user, secrets }, api); } finally { console.log = log; }
    return { calls, primary, meta };
  }

  test('links the secondary identity to the primary and makes the primary the login user', async () => {
    const r = await run(google);
    const post = r.calls.find((c) => c.method === 'POST' && c.url.includes('/identities'));
    assert.equal(post.url, 'https://t.auth0.com/api/v2/users/auth0%7C1/identities');
    assert.deepEqual(JSON.parse(post.body), { provider: 'google-oauth2', user_id: '9' });
    assert.deepEqual(r.primary, ['auth0|1']);
    assert.deepEqual(r.meta, [['linked_to', 'auth0|1']]);
  });
  test('an unverified email makes no call at all', async () => {
    const r = await run({ ...google, email_verified: false });
    assert.equal(r.calls.length, 0);
    assert.deepEqual(r.primary, []);
  });
  test('nothing to link: it looks and leaves', async () => {
    const r = await run(google, { candidates: [] });
    assert.equal(r.calls.some((c) => c.method === 'POST' && c.url.includes('/identities')), false);
    assert.deepEqual(r.primary, []);
  });
  test('Auth0 failing never blocks the sign-in and never switches the user', async () => {
    assert.deepEqual((await run(google, { linkStatus: 500 })).primary, []);
    assert.deepEqual((await run(google, { token: null })).primary, []);
    globalThis.fetch = async () => { throw new TypeError('down'); };
    const log = console.log; console.log = () => {};
    try { await link.onExecutePostLogin({ user: google, secrets }, { authentication: { setPrimaryUser() { throw new Error('no'); } } }); } finally { console.log = log; }
  });
  test('without its secrets it does nothing', async () => {
    globalThis.fetch = async () => { throw new Error('should not be called'); };
    await link.onExecutePostLogin({ user: google, secrets: {} }, {});
  });
});

describe('sign-up notification after a link', () => {
  const notify = load('notify-signup.js').onExecutePostLogin;
  const event = (user) => ({ stats: { logins_count: 1 }, client: { client_id: 'p' }, user, secrets: { NTFY_TOPIC: 't', PROD_CLIENT_ID: 'p' } });
  async function sent(user) {
    let n = 0; globalThis.fetch = async () => { n++; return { ok: true }; };
    await notify(event(user)); return n;
  }
  test('a genuinely new user is announced', async () => assert.equal(await sent({ user_id: 'auth0|1', identities: [{}] }), 1));
  test('a login that was linked to an existing user is not', async () => {
    assert.equal(await sent({ user_id: 'auth0|1', identities: [{}, {}] }), 0);
    assert.equal(await sent({ user_id: 'google-oauth2|9', identities: [{}], app_metadata: { linked_to: 'auth0|1' } }), 0);
  });
});

describe('the Login flow', () => {
  const b = (id, name) => ({ action: { id }, display_name: name });
  test('linking is bound before the notification, and once', () => {
    const out = withBinding([b('n', 'notify-signup')], 'l', 'link-accounts', 'n');
    assert.deepEqual(out.map((x) => x.ref.value), ['l', 'n']);
    assert.equal(withBinding([b('l', 'link-accounts'), b('n', 'notify-signup')], 'l', 'link-accounts', 'n'), null);
  });
  test('without the notification bound, it goes last', () => {
    assert.deepEqual(withBinding([b('x', 'x')], 'l', 'link-accounts', 'n').map((x) => x.ref.value), ['x', 'l']);
  });
});

describe('deleting a linked account', () => {
  // The token's sub is the primary's, and Auth0 deletes the primary together with the identities linked to it,
  // so the one DELETE of worker/sync.js removes the whole user; the data is keyed on that same sub.
  test('the Worker deletes by the token sub only (the primary after linking; see tests/account.test.mjs)', () => {
    const src = readFileSync(new URL('../worker/sync.js', import.meta.url), 'utf8');
    assert.match(src, /deleteAuth0User\(env, sub\)/);
  });
});

describe('merging existing duplicates', () => {
  const doc = (opps, done = {}) => ({ v: 1, me: null, opps, done });
  async function setup() {
    const db = await fakeD1();
    await db.exec([
      'CREATE TABLE docs (sub TEXT PRIMARY KEY, doc TEXT NOT NULL, ver INTEGER NOT NULL, updated INTEGER NOT NULL)',
      'CREATE TABLE results (sub TEXT NOT NULL, player TEXT NOT NULL, item TEXT NOT NULL, rank INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (sub, player, item))',
    ].join('\n'));
    return db;
  }
  const put = (db, sub, player, item, rank, data) => db.prepare('INSERT INTO results VALUES (?, ?, ?, ?, ?, 1)').bind(sub, player, item, rank, JSON.stringify(data)).run();
  const A = 'google-oauth2|9', B = 'auth0|1';

  test('docs merge by the sync rules, results by the results rules, and the secondary is gone', async () => {
    const db = await setup();
    const a = doc({ bob: { username: 'bob', a: 1, t: 50 }, cy: { username: 'cy', a: 2, t: 10 } }, { d1: 1 });
    const b = doc({ bob: { username: 'bob', a: 1, t: 20, del: true } }, { d2: 1 });
    await db.prepare('INSERT INTO docs VALUES (?, ?, 1, 1)').bind(A, JSON.stringify(a)).run();
    await db.prepare('INSERT INTO docs VALUES (?, ?, 3, 1)').bind(B, JSON.stringify(b)).run();
    await put(db, A, 'bob', 'review:https://x/1', 0, review());
    await put(db, A, 'bob', 'traps:white:30', 9, traps(9));
    await put(db, B, 'bob', 'traps:white:30', 5, traps(5));
    await put(db, A, 'cy', 'traps:black:30', 5, traps(5));
    await put(db, B, 'cy', 'traps:black:30', 9, traps(9));

    const sql = mergeSql(A, B, a, b, 1000);
    for (const s of sql) await db.exec(s);
    for (const s of sql) await db.exec(s);   // applying it again changes nothing more

    const d = JSON.parse((await db.prepare('SELECT doc FROM docs WHERE sub = ?').bind(B).first()).doc);
    assert.equal(d.opps.bob.del, undefined, 'the later change (not removed) wins');
    assert.ok(d.opps.cy);
    assert.deepEqual(Object.keys(d.done).sort(), ['d1', 'd2']);
    assert.equal(await db.prepare('SELECT * FROM docs WHERE sub = ?').bind(A).first(), null);
    assert.equal(await db.prepare('SELECT * FROM results WHERE sub = ?').bind(A).first(), null);
    const rows = (await db.prepare('SELECT player, item, rank FROM results WHERE sub = ? ORDER BY player, item').bind(B).all()).results;
    assert.deepEqual(rows, [
      { player: 'bob', item: 'review:https://x/1', rank: 0 },
      { player: 'bob', item: 'traps:white:30', rank: 9 },
      { player: 'cy', item: 'traps:black:30', rank: 9 },
    ]);
  });
  test('refuses ids that are not provider|id, or the same account', () => {
    assert.throws(() => mergeSql("x'; DROP TABLE docs; --", B, null, null), /provider\|id/);
    assert.throws(() => mergeSql(A, A, null, null), /Same/);
  });
});
