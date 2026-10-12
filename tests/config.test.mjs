import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authConfig } from '../worker/config.js';

const base = { AUTH0_DOMAIN: 'login.example.test', AUTH0_CLIENT_ID: 'web-client', AUTH0_AUDIENCE: 'https://api.example.test' };

test('without the three Auth0 values there is no auth config', () => {
  assert.equal(authConfig({}), null);
  assert.equal(authConfig({ ...base, AUTH0_CLIENT_ID: '' }), null);
  assert.equal(authConfig({ AUTH0_NATIVE_CLIENT_ID: 'native-client' }), null, 'a native id alone is not enough');
});

test('the web config has no native client id unless one is set', () => {
  assert.deepEqual(authConfig(base), { domain: 'login.example.test', clientId: 'web-client', audience: 'https://api.example.test' });
  assert.equal('nativeClientId' in authConfig({ ...base, AUTH0_NATIVE_CLIENT_ID: '' }), false);
});

test('the native client id is added when set', () => {
  const a = authConfig({ ...base, AUTH0_NATIVE_CLIENT_ID: 'native-client' });
  assert.equal(a.nativeClientId, 'native-client');
  assert.equal(a.clientId, 'web-client', 'the web client id is unchanged');
});
