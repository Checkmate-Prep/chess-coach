// Deleting an account also deletes the Auth0 user (worker/account.js), with Auth0 faked.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteUsers, deleteAuth0User } from '../worker/account.js';

const env = { AUTH0_MGMT_CLIENT_ID: 'id', AUTH0_MGMT_CLIENT_SECRET: 'secret' };
const reply = (status, body) => new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status });

/** A fake Auth0: records calls; `token` and `del` are the statuses it answers with. */
function fakeAuth0({ token = 200, del = 204 } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return url.endsWith('/oauth/token') ? reply(token, token === 200 ? { access_token: 't0k' } : { error: 'access_denied' }) : reply(del);
  };
  return { calls, fetcher };
}

describe('deleting the Auth0 user', () => {
  test('needs both credentials', () => {
    assert.equal(canDeleteUsers(env), true);
    assert.equal(canDeleteUsers({ AUTH0_MGMT_CLIENT_ID: 'id' }), false);
    assert.equal(canDeleteUsers({}), false);
  });

  test('gets a token from the tenant domain and deletes that user only', async () => {
    const a = fakeAuth0();
    await deleteAuth0User({ ...env, AUTH0_DOMAIN: 'login.checkmateprep.com' }, 'google-oauth2|123', a.fetcher);
    assert.equal(a.calls[0].url, 'https://checkmateprep.us.auth0.com/oauth/token');
    assert.equal(JSON.parse(a.calls[0].init.body).audience, 'https://checkmateprep.us.auth0.com/api/v2/');
    assert.equal(a.calls[1].url, 'https://checkmateprep.us.auth0.com/api/v2/users/google-oauth2%7C123');
    assert.equal(a.calls[1].init.method, 'DELETE');
    assert.equal(a.calls[1].init.headers.authorization, 'Bearer t0k');
  });

  test('a user that is already gone counts as deleted', async () => {
    await deleteAuth0User(env, 'auth0|1', fakeAuth0({ del: 404 }).fetcher);
  });

  test('says so when Auth0 refuses, so the app can try again', async () => {
    await assert.rejects(deleteAuth0User(env, 'auth0|1', fakeAuth0({ token: 401 }).fetcher), /Try again/);
    await assert.rejects(deleteAuth0User(env, 'auth0|1', fakeAuth0({ del: 403 }).fetcher), /Try again/);
    await assert.rejects(deleteAuth0User(env, 'auth0|1', async () => { throw new TypeError('offline'); }), /Try again/);
  });
});
